import "server-only"

import { randomUUID } from "node:crypto"
import { and, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { sourceItem } from "@/db/schema"
import {
  CHAT_ATTACHMENT_EXCERPT_CHARS,
  CHAT_ATTACHMENT_TEXT_CHARS,
  CHAT_UPLOAD_CHUNK_BYTES,
  chatFileKind,
  chatFileProblem,
  chatFileUrl,
  chatUploadParts,
  type ChatAttachmentPart,
  type ChatFileKind,
} from "@/lib/chat/files"
import { storeDocumentOriginal } from "@/server/documents-ingest"
import { parseSourceItem } from "@/server/parse-source-item"
import { assembleMarkdown, buildFrontmatter } from "@/server/parsers/_shared"
import { getOrCreateAiChatSource } from "@/server/sources"
import { deleteObjects, getObject, getTextObject, putObject } from "@/server/storage"
import { messageContent } from "@/server/topics/signals/evidence"

// Files of the AI chat (docs/specs/ai-chat-tools/01-specification.md §5,
// decision Q22). A file is DETACHED from the chat when it is uploaded: it
// becomes a source item of the org's «AI Chat» source with its original
// (like an attachment of a mail), is parsed by the parser of its type
// (`parseSourceItem` → the drop-off path → image / PDF / Office / audio /
// video parsers, each an AI process of its own) and the chat model gets
// only the resulting TEXT. Org-explicit; every function checks that the item
// belongs to the org AND was uploaded by the user.
//
// Upload in chunks of ≤ 4 MB through our own route (a Vercel function takes
// ≤ 4.5 MB per request): parts go to storage as separate objects and are
// joined on «complete».

export class ChatFileError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message)
  }
}

type UploadMeta = { userId: string; parts: number; size: number; complete: boolean }

const partKey = (orgId: string, itemId: string, n: number) => `org_${orgId}/chat-uploads/${itemId}/part-${n}`

async function loadUpload(orgId: string, userId: string, itemId: string) {
  const [row] = await db
    .select({
      id: sourceItem.id,
      filename: sourceItem.filename,
      mimeType: sourceItem.mimeType,
      metadataJson: sourceItem.metadataJson,
      fileStatus: sourceItem.fileStatus,
    })
    .from(sourceItem)
    .where(and(eq(sourceItem.id, itemId), eq(sourceItem.organizationId, orgId)))
    .limit(1)
  const meta = (row?.metadataJson ?? {}) as { chatUpload?: UploadMeta }
  if (!row || meta.chatUpload?.userId !== userId) throw new ChatFileError("Файл не найден", 404)
  return { row, upload: meta.chatUpload }
}

/** Step 1: a source item for the file; returns its id and the number of parts to send. */
export async function createChatUpload(
  orgId: string,
  userId: string,
  input: { name: string; mediaType: string; size: number },
): Promise<{ itemId: string; parts: number; chunkBytes: number }> {
  const name = (input.name ?? "").trim().slice(0, 200) || "file"
  const problem = chatFileProblem(input.mediaType, name, input.size)
  if (problem) throw new ChatFileError(problem)
  const src = await getOrCreateAiChatSource(orgId)
  const itemId = randomUUID()
  const parts = chatUploadParts(input.size)
  const now = new Date()
  await db.insert(sourceItem).values({
    id: itemId,
    sourceId: src.id,
    organizationId: orgId,
    externalId: `aichat-file:${itemId}`,
    externalType: "attachment",
    filename: name,
    mimeType: input.mediaType || "application/octet-stream",
    sizeBytes: input.size,
    sourceCreatedAt: now,
    fetchedAt: now,
    parseStatus: "pending",
    fileStatus: "not_stored",
    orgAttribution: "own_org",
    // Becomes a CHILD of the chat segment item at ingest (CH6); never a root
    // of its own for the signal extractor.
    signalStatus: "skipped",
    signalReason: "not_root",
    metadataJson: {
      provider: "aichat",
      fileName: name,
      uploadedBy: userId,
      chatUpload: { userId, parts, size: input.size, complete: false } satisfies UploadMeta,
    },
  })
  return { itemId, parts, chunkBytes: CHAT_UPLOAD_CHUNK_BYTES }
}

/** Step 2: one part (1-based). */
export async function putChatUploadPart(
  orgId: string,
  userId: string,
  itemId: string,
  n: number,
  bytes: Uint8Array,
): Promise<void> {
  const { upload } = await loadUpload(orgId, userId, itemId)
  if (upload.complete) throw new ChatFileError("Файл уже загружен", 409)
  if (!Number.isInteger(n) || n < 1 || n > upload.parts) throw new ChatFileError("Неверный номер части")
  if (bytes.byteLength === 0 || bytes.byteLength > CHAT_UPLOAD_CHUNK_BYTES) throw new ChatFileError("Неверный размер части")
  await putObject(partKey(orgId, itemId, n), bytes, "application/octet-stream")
}

/** Step 3: join the parts, store the original, drop the parts. */
export async function completeChatUpload(
  orgId: string,
  userId: string,
  itemId: string,
): Promise<{ itemId: string; url: string }> {
  const { row, upload } = await loadUpload(orgId, userId, itemId)
  if (upload.complete && row.fileStatus === "stored") return { itemId, url: chatFileUrl(itemId) }
  const keys = Array.from({ length: upload.parts }, (_, i) => partKey(orgId, itemId, i + 1))
  const chunks: Uint8Array[] = []
  for (const k of keys) {
    const obj = await getObject(k)
    if (!obj) throw new ChatFileError("Загрузка не завершена — отправьте файл ещё раз", 409)
    chunks.push(obj.bytes)
  }
  const size = chunks.reduce((a, c) => a + c.byteLength, 0)
  if (size !== upload.size) throw new ChatFileError("Размер файла не совпадает — отправьте файл ещё раз", 409)
  const bytes = new Uint8Array(size)
  let off = 0
  for (const c of chunks) {
    bytes.set(c, off)
    off += c.byteLength
  }
  const status = await storeDocumentOriginal(orgId, itemId, bytes, { name: row.filename, mime: row.mimeType })
  if (status !== "stored") throw new ChatFileError("Не удалось сохранить файл", 500)
  await db
    .update(sourceItem)
    .set({
      metadataJson: sql`jsonb_set(${sourceItem.metadataJson}, '{chatUpload,complete}', 'true'::jsonb)`,
    })
    .where(eq(sourceItem.id, itemId))
  await deleteObjects(keys).catch((e) => console.error("[chat/files] part cleanup failed", itemId, e))
  return { itemId, url: chatFileUrl(itemId) }
}

// ── Reading the files of a message ────────────────────────────────────

type ItemRow = {
  id: string
  filename: string | null
  mimeType: string | null
  parseStatus: string
  parseError: string | null
  parsedMarkdown: string | null
  markdownR2Key: string | null
  metadataJson: unknown
  fileStatus: string | null
}

async function loadItems(orgId: string, ids: string[]): Promise<ItemRow[]> {
  if (!ids.length) return []
  return db
    .select({
      id: sourceItem.id,
      filename: sourceItem.filename,
      mimeType: sourceItem.mimeType,
      parseStatus: sourceItem.parseStatus,
      parseError: sourceItem.parseError,
      parsedMarkdown: sourceItem.parsedMarkdown,
      markdownR2Key: sourceItem.markdownR2Key,
      metadataJson: sourceItem.metadataJson,
      fileStatus: sourceItem.fileStatus,
    })
    .from(sourceItem)
    .where(and(eq(sourceItem.organizationId, orgId), inArray(sourceItem.id, ids)))
}

async function markdownOf(r: { parsedMarkdown: string | null; markdownR2Key: string | null }): Promise<string> {
  if (r.parsedMarkdown) return r.parsedMarkdown
  if (!r.markdownR2Key) return ""
  return getTextObject(r.markdownR2Key).catch(() => "")
}

/** A text file needs no model: its content is the text. */
async function parseTextFile(itemId: string, row: ItemRow, fileKey: string | null): Promise<void> {
  const obj = fileKey ? await getObject(fileKey) : null
  if (!obj) throw new Error("text file missing in storage")
  const text = new TextDecoder("utf-8", { fatal: false }).decode(obj.bytes)
  const now = new Date()
  const name = row.filename ?? "file.txt"
  const markdown = assembleMarkdown(
    buildFrontmatter({
      sourceId: `aichat-file:${itemId}`,
      parentSourceId: null,
      threadId: null,
      sourceSystem: "AI Chat",
      sourceCreatedAt: now.toISOString(),
      sourceReceivedAt: now.toISOString(),
      processedAt: now.toISOString(),
      language: "ru",
      senders: [],
      recipients: [],
      mentions: [],
      companies: [],
      products: [],
      urls: [],
    }),
    "",
    name.toLowerCase().endsWith(".csv") || name.toLowerCase().endsWith(".json") ? "```\n" + text + "\n```" : text,
  )
  await db
    .update(sourceItem)
    .set({ parsedMarkdown: markdown, parseStatus: "complete", parsedAt: now, parseError: null })
    .where(eq(sourceItem.id, itemId))
}

const STATUS_VERB: Record<ChatFileKind, string> = {
  image: "Читаю изображение",
  pdf: "Читаю файл",
  office: "Читаю файл",
  text: "Читаю файл",
  audio: "Расшифровываю аудио",
  video: "Смотрю видео",
}

/** Russian reason of a skipped / failed parse. */
function reasonText(err: string | null): string {
  const e = (err ?? "").toLowerCase()
  if (e.includes("too large")) return "файл слишком большой"
  if (e.includes("unsupported")) return "такой тип файла не читается"
  if (e.includes("excluded")) return "отправитель исключён из анализа"
  return "файл не удалось прочитать"
}

/**
 * The files of a new user message: check they are the user's uploads in the
 * org, record the thread / message on them, parse what is not parsed yet
 * (`onStatus` gets a Russian status line per file) and return one
 * attachment part per file — with the full text for the current turn.
 * Unknown / foreign ids are dropped.
 */
export async function prepareChatAttachments(
  orgId: string,
  userId: string,
  itemIds: string[],
  where: { threadId: string; messageId: string },
  onStatus?: (label: string) => void,
): Promise<ChatAttachmentPart[]> {
  const rows = (await loadItems(orgId, [...new Set(itemIds)])).filter((r) => {
    const m = (r.metadataJson ?? {}) as { chatUpload?: UploadMeta }
    return m.chatUpload?.userId === userId && r.fileStatus === "stored"
  })
  const order = new Map(itemIds.map((id, i) => [id, i]))
  rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
  if (!rows.length) return []
  await db
    .update(sourceItem)
    .set({
      metadataJson: sql`coalesce(${sourceItem.metadataJson}, '{}'::jsonb) || ${JSON.stringify({ chat: where })}::jsonb`,
    })
    .where(and(eq(sourceItem.organizationId, orgId), inArray(sourceItem.id, rows.map((r) => r.id))))

  for (const r of rows) {
    if (r.parseStatus === "complete" || r.parseStatus === "skipped") continue
    const name = r.filename ?? "file"
    const kind = chatFileKind(r.mimeType ?? "", name) ?? "pdf"
    onStatus?.(`${STATUS_VERB[kind]}: «${name}»…`)
    try {
      if (kind === "text") {
        const [k] = await db.select({ key: sourceItem.fileKey }).from(sourceItem).where(eq(sourceItem.id, r.id))
        await parseTextFile(r.id, r, k?.key ?? null)
      } else {
        await parseSourceItem(r.id, { userId })
      }
    } catch (e) {
      console.error("[chat/files] parse failed", r.id, e)
    }
  }
  return readChatAttachments(orgId, rows.map((r) => r.id), true)
}

/**
 * Attachment parts of already prepared files (`withText` = the full text for
 * the model of the current turn; else only the excerpt for storage). Videos
 * add the transcript of their derived audio item.
 */
export async function readChatAttachments(orgId: string, itemIds: string[], withText: boolean): Promise<ChatAttachmentPart[]> {
  const rows = await loadItems(orgId, itemIds)
  const byId = new Map(rows.map((r) => [r.id, r]))
  const audio = itemIds.length
    ? await db
        .select({ parentId: sourceItem.parentSourceItemId, parsedMarkdown: sourceItem.parsedMarkdown, markdownR2Key: sourceItem.markdownR2Key })
        .from(sourceItem)
        .where(
          and(
            eq(sourceItem.organizationId, orgId),
            inArray(sourceItem.parentSourceItemId, itemIds),
            eq(sourceItem.externalType, "derived_audio"),
            eq(sourceItem.parseStatus, "complete"),
          ),
        )
    : []
  const out: ChatAttachmentPart[] = []
  for (const id of itemIds) {
    const r = byId.get(id)
    if (!r) continue
    const name = r.filename ?? "file"
    const mediaType = r.mimeType ?? "application/octet-stream"
    const kind = chatFileKind(mediaType, name) ?? "pdf"
    if (r.parseStatus !== "complete") {
      out.push({
        itemId: id,
        name,
        mediaType,
        kind,
        status: r.parseStatus === "skipped" ? "skipped" : "failed",
        reason: reasonText(r.parseError),
      })
      continue
    }
    let text = messageContent(await markdownOf(r))
    const track = audio.find((a) => a.parentId === id)
    if (track) {
      const transcript = messageContent(await markdownOf(track)).trim()
      if (transcript) text = `${text}\n\n### Расшифровка звука\n${transcript}`
    }
    const meta = (r.metadataJson ?? {}) as {
      summary?: string
      companies?: string[]
      mentionedPeople?: { name?: string; email?: string; phone?: string; organization?: string }[]
    }
    const facts: string[] = []
    if (meta.summary) facts.push(`Сводка: ${meta.summary}`)
    if (meta.companies?.length) facts.push(`Компании: ${meta.companies.join(", ")}`)
    const people = (meta.mentionedPeople ?? [])
      .map((p) => [p.name, p.organization, p.email, p.phone].filter(Boolean).join(", "))
      .filter(Boolean)
    if (people.length) facts.push(`Люди: ${people.join("; ")}`)
    const full = [facts.join("\n"), text.trim()].filter(Boolean).join("\n\n")
    out.push({
      itemId: id,
      name,
      mediaType,
      kind,
      status: "parsed",
      excerpt: full.slice(0, CHAT_ATTACHMENT_EXCERPT_CHARS),
      ...(withText
        ? {
            text:
              full.length > CHAT_ATTACHMENT_TEXT_CHARS
                ? `${full.slice(0, CHAT_ATTACHMENT_TEXT_CHARS)}\n[… текст обрезан — остальное через readSource]`
                : full,
          }
        : {}),
    })
  }
  return out
}

import "server-only"

import { randomUUID } from "node:crypto"
import { Output } from "ai"
import { and, asc, eq, gt, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db/drizzle"
import { aiChatMessage, aiChatThread, sourceItem, user } from "@/db/schema"
import {
  CHAT_INGEST_IDLE_MINUTES,
  CHAT_INGEST_MAX_WAIT_HOURS,
  chatIngestDue,
  chatSegmentExternalId,
  chatThreadKey,
  dataUrlBytes,
  messageAttachments,
  messageFiles,
  segmentContent,
  segmentHasUserContent,
  segmentTranscript,
  type SegmentMessage,
} from "@/lib/chat/ingest"
import { ATTENTION_DEFAULTS } from "@/lib/topics/attention-params"
import { AiBudgetExceededError, aiCallInfo, aiGenerateText } from "@/server/ai/runtime"
import { getOwnOrgContext } from "@/server/identity/own-org"
import {
  assembleMarkdown,
  buildFrontmatter,
  buildOwnOrgPromptLine,
  DEFAULT_RELEVANCE,
  parserAiContext,
  uniqueStrings,
  type MetadataAnalysis,
} from "@/server/parsers/_shared"
import { parseDropoffFile } from "@/server/parsers/dropoff"
import { getOrCreateAiChatSource } from "@/server/sources"
import { loadAttentionParams } from "@/server/topics/attention/store"

// The AI chat as a source of the org (docs/specs/ai-chat/01-specification.md
// §16.3, CH6). One source item per SEGMENT = the messages of a thread since
// the last ingest (`ai_chat_thread.ingested_seq`), in the org's «AI Chat»
// source. Org-explicit, `server-only`.
//
// - Idempotent: external id `aichat:<thread>:<from>-<to>` is unique per
//   source, so two runs that race write one item; `ingested_seq` moves only
//   after the item exists.
// - Gate (cheap): `chat.session_analysis` → `hasNewBusinessInfo`; false →
//   `signal_status = skipped` / `no_new_info`, no extraction cost.
// - The item is the employee's note: `org_attribution = own_org`; the
//   extractor reads it as a relayed message (envelope, src/server/topics/
//   signals/item-input.ts), never as internal.
// - A thread with `ingest_mode = off` («Не передавать в источники») is never
//   ingested; a thread the user deleted is still ingested within its grace
//   period (Q21: business data; Q23: items stay).

const DEFAULT_MAX_THREADS = 50
const TRANSCRIPT_MAX_CHARS = 40_000

export type ChatIngestOutcome =
  | { status: "ingested"; itemId: string; fromSeq: number; toSeq: number; newInfo: boolean; files: number }
  | { status: "nothing" }
  | { status: "off" }
  | { status: "not_found" }
  | { status: "budget" }

// ── Gate model ────────────────────────────────────────────────────────

const gateSchema = z.object({
  language: z.string().describe("ISO 639-1 code of the employee's language, e.g. 'ru'."),
  summary: z.string().describe("1–2 sentences in Russian: what the employee said or asked in this part of the chat."),
  mentions: z.array(z.string()).describe("People named by the employee (not by the AI)."),
  companies: z.array(z.string()).describe("Companies named by the employee (not by the AI)."),
  products: z.array(z.string()).describe("Products named by the employee (not by the AI)."),
  hasNewBusinessInfo: z
    .boolean()
    .describe(
      "true ONLY when the EMPLOYEE states new facts a CRM needs: what a client / partner / supplier said or wants, a call or meeting result, prices, quantities, terms, dates, promises, problems, decisions, people changes. Questions to the AI, requests for data, greetings, comments on the AI's answers and anything only the AI wrote = false.",
    ),
  facts: z
    .array(z.string())
    .describe("Each new business fact the employee stated, one short Russian sentence; [] when none. Never facts from the AI answers."),
  relayedFrom: z
    .string()
    .describe(
      "Who originally said the relayed information, as the employee names it (e.g. 'Петров (Норлекс)'); '' when the employee states own facts or names nobody.",
    ),
})

type GateResult = z.infer<typeof gateSchema>

async function analyseSegment(
  orgId: string,
  transcript: string,
): Promise<{ gate: GateResult; model: string | null }> {
  const text =
    transcript.length > TRANSCRIPT_MAX_CHARS ? `${transcript.slice(0, TRANSCRIPT_MAX_CHARS)}\n[… обрезано]` : transcript
  const result = await aiGenerateText({
    process: "chat.session_analysis",
    orgId,
    userId: null,
    output: Output.object({ schema: gateSchema }),
    temperature: 0,
    instructions:
      "You read a part of a conversation between an EMPLOYEE of a company and the company's AI assistant inside its CRM. Decide whether the employee told the AI NEW business information (facts about clients, deals, orders, calls, meetings, prices, people) that the CRM does not have yet. The AI's answers come from the CRM and the web and are NEVER new information — ignore them except to understand the employee. Never invent facts.",
    prompt: `--- НАЧАЛО ФРАГМЕНТА ЧАТА ---\n${text || "(пусто)"}\n--- КОНЕЦ ФРАГМЕНТА ЧАТА ---`,
  })
  const info = aiCallInfo(result)
  return { gate: result.output, model: info?.responseModel ?? info?.requestModel ?? null }
}

// ── Loading ───────────────────────────────────────────────────────────

type ThreadRow = {
  id: string
  organizationId: string
  userId: string
  title: string
  ingestMode: string
  ingestedSeq: number
}

async function loadThread(threadId: string): Promise<ThreadRow | null> {
  const [t] = await db
    .select({
      id: aiChatThread.id,
      organizationId: aiChatThread.organizationId,
      userId: aiChatThread.userId,
      title: aiChatThread.title,
      ingestMode: aiChatThread.ingestMode,
      ingestedSeq: aiChatThread.ingestedSeq,
    })
    .from(aiChatThread)
    .where(eq(aiChatThread.id, threadId))
    .limit(1)
  return t ?? null
}

async function pendingMessages(threadId: string, afterSeq: number): Promise<SegmentMessage[]> {
  const rows = await db
    .select({ seq: aiChatMessage.seq, role: aiChatMessage.role, createdAt: aiChatMessage.createdAt, parts: aiChatMessage.parts })
    .from(aiChatMessage)
    .where(and(eq(aiChatMessage.threadId, threadId), gt(aiChatMessage.seq, afterSeq)))
    .orderBy(asc(aiChatMessage.seq))
  return rows.map((r) => ({ ...r, role: r.role === "assistant" ? "assistant" : "user" }))
}

/** Threads with un-ingested messages, ingest on, due by the quiet / max-wait rule. */
export async function listDueChatThreads(orgId: string | null, now: Date, limit: number): Promise<string[]> {
  const idle = new Date(now.getTime() - CHAT_INGEST_IDLE_MINUTES * 60_000)
  // Written with explicit table names: in a SELECT list Drizzle renders
  // columns without their table, which made the subquery compare the
  // message's own id (always null).
  const pendingSince = sql<string | null>`(select min(m.created_at) from ai_chat_message m where m.thread_id = "ai_chat_thread"."id" and m.seq > "ai_chat_thread"."ingested_seq")`
  const rows = await db
    .select({ id: aiChatThread.id, lastMessageAt: aiChatThread.lastMessageAt, oldestPendingAt: pendingSince })
    .from(aiChatThread)
    .where(
      and(
        orgId ? eq(aiChatThread.organizationId, orgId) : undefined,
        eq(aiChatThread.ingestMode, "on"),
        sql`exists (select 1 from ${aiChatMessage} where ${aiChatMessage.threadId} = ${aiChatThread.id} and ${aiChatMessage.seq} > ${aiChatThread.ingestedSeq})`,
        sql`(${aiChatThread.lastMessageAt} <= ${idle.toISOString()} or ${pendingSince} <= ${new Date(now.getTime() - CHAT_INGEST_MAX_WAIT_HOURS * 3_600_000).toISOString()})`,
      ),
    )
    .orderBy(asc(aiChatThread.lastMessageAt))
    .limit(limit)
  return rows
    .filter((r) => chatIngestDue({ lastMessageAt: r.lastMessageAt, oldestPendingAt: r.oldestPendingAt ? new Date(`${String(r.oldestPendingAt).replace(" ", "T")}Z`) : null }, now))
    .map((r) => r.id)
}

// ── Ingest one thread ─────────────────────────────────────────────────

/**
 * Turn the un-ingested messages of ONE thread into one source item.
 * `force` = «Передать в источники сейчас» (no quiet-time wait). The caller
 * checks who may ask for it (the thread's own user).
 */
export async function ingestChatThread(threadId: string): Promise<ChatIngestOutcome> {
  const t = await loadThread(threadId)
  if (!t) return { status: "not_found" }
  if (t.ingestMode !== "on") return { status: "off" }
  const msgs = await pendingMessages(t.id, t.ingestedSeq)
  if (!msgs.length) return { status: "nothing" }
  const fromSeq = msgs[0].seq
  const toSeq = msgs[msgs.length - 1].seq

  // Only AI answers (e.g. «Повторить»): nothing new from the user — just move on.
  if (!segmentHasUserContent(msgs)) {
    await moveIngested(t.id, t.ingestedSeq, toSeq)
    return { status: "nothing" }
  }

  const [author] = await db.select({ name: user.name, email: user.email }).from(user).where(eq(user.id, t.userId)).limit(1)
  const authorName = author?.name?.trim() || author?.email || "Сотрудник"
  const timeZone = await loadAttentionParams(t.organizationId)
    .then((p) => p.timeZone)
    .catch(() => ATTENTION_DEFAULTS.timeZone)

  let analysis
  try {
    analysis = await analyseSegment(t.organizationId, segmentTranscript(msgs, authorName))
  } catch (e) {
    if (e instanceof AiBudgetExceededError) return { status: "budget" }
    throw e
  }
  const { gate, model } = analysis
  const facts = uniqueStrings(gate.facts.map((f) => f.trim()).filter(Boolean))
  const newInfo = gate.hasNewBusinessInfo && facts.length > 0
  const relayedFrom = gate.relayedFrom.trim()

  const src = await getOrCreateAiChatSource(t.organizationId)
  const externalId = chatSegmentExternalId(t.id, fromSeq, toSeq)
  const last = msgs[msgs.length - 1].createdAt
  const meta: MetadataAnalysis = {
    language: gate.language || "ru",
    summary: gate.summary,
    mentions: uniqueStrings(gate.mentions),
    companies: uniqueStrings(gate.companies),
    products: uniqueStrings(gate.products),
    relevance: DEFAULT_RELEVANCE,
    mentionedPeople: [],
  }
  const content = segmentContent(msgs, authorName, timeZone)
  const markdown = assembleMarkdown(
    buildFrontmatter({
      sourceId: externalId,
      parentSourceId: null,
      threadId: chatThreadKey(t.id),
      sourceSystem: "AI Chat",
      sourceCreatedAt: last.toISOString(),
      sourceReceivedAt: last.toISOString(),
      processedAt: new Date().toISOString(),
      language: meta.language,
      senders: [authorName],
      recipients: [],
      mentions: meta.mentions,
      companies: meta.companies,
      products: meta.products,
      urls: [],
    }),
    meta.summary,
    content,
  )

  const itemId = randomUUID()
  const now = new Date()
  const inserted = await db
    .insert(sourceItem)
    .values({
      id: itemId,
      sourceId: src.id,
      organizationId: t.organizationId,
      externalId,
      externalType: "aichat_session",
      threadExternalId: t.id,
      threadKey: chatThreadKey(t.id),
      filename: t.title,
      mimeType: "text/markdown",
      sizeBytes: new TextEncoder().encode(markdown).byteLength,
      sourceCreatedAt: last,
      fetchedAt: now,
      parseStatus: "complete",
      parsedAt: now,
      parserModel: model,
      parsedMarkdown: markdown,
      orgAttribution: "own_org",
      ...(newInfo
        ? {}
        : { signalStatus: "skipped", signalReason: "no_new_info", signalScannedAt: now }),
      metadataJson: {
        provider: "aichat",
        title: t.title,
        threadId: t.id,
        fromSeq,
        toSeq,
        messageCount: msgs.length,
        savedByUserId: t.userId,
        from: [{ name: authorName, email: author?.email ?? null }],
        chatNote: { hasNewBusinessInfo: newInfo, facts, relayedFrom: relayedFrom || null },
        ...meta,
      },
    })
    .onConflictDoNothing({ target: [sourceItem.sourceId, sourceItem.externalId] })
    .returning({ id: sourceItem.id })
  if (!inserted.length) {
    // Another run wrote this segment first.
    await moveIngested(t.id, t.ingestedSeq, toSeq)
    return { status: "nothing" }
  }

  // Files detached + parsed at send (ai-chat-tools §5.2): they become children
  // of this segment item — no second parse; the signal extractor reads them
  // as attachment blocks, like the attachments of a mail.
  const attachmentIds = msgs.filter((m) => m.role === "user").flatMap((m) => messageAttachments(m.parts).map((a) => a.itemId))
  if (attachmentIds.length) {
    await db
      .update(sourceItem)
      .set({ parentSourceItemId: itemId })
      .where(
        and(
          eq(sourceItem.organizationId, t.organizationId),
          inArray(sourceItem.id, attachmentIds),
          isNull(sourceItem.parentSourceItemId),
        ),
      )
  }
  // Older messages carried files as data URLs (before ai-chat-tools T0).
  const files = msgs.filter((m) => m.role === "user").flatMap((m) => messageFiles(m.parts))
  if (files.length) {
    await insertFileChildren(t.organizationId, src.id, itemId, externalId, files, now).catch((e) =>
      console.error("[chat/ingest] files failed", t.id, e),
    )
  }
  await moveIngested(t.id, t.ingestedSeq, toSeq)
  return { status: "ingested", itemId, fromSeq, toSeq, newInfo, files: files.length }
}

/** Move `ingested_seq` forward (only from the value we read — no lost update). */
async function moveIngested(threadId: string, from: number, to: number) {
  await db
    .update(aiChatThread)
    .set({ ingestedSeq: to })
    .where(and(eq(aiChatThread.id, threadId), lte(aiChatThread.ingestedSeq, from)))
}

/** Files the user attached → parsed child items (drop-off parsers). */
async function insertFileChildren(
  orgId: string,
  sourceId: string,
  parentId: string,
  parentExternalId: string,
  files: { url: string; mediaType: string; filename: string }[],
  now: Date,
) {
  const ai = parserAiContext(orgId, null, buildOwnOrgPromptLine(await getOwnOrgContext(orgId).catch(() => null)))
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    const bytes = dataUrlBytes(f.url)
    const externalId = `${parentExternalId}:file:${i}`
    const base = {
      sourceId,
      organizationId: orgId,
      externalId,
      externalType: "attachment" as const,
      parentSourceItemId: parentId,
      filename: f.filename,
      mimeType: f.mediaType,
      sizeBytes: bytes?.byteLength ?? null,
      sourceCreatedAt: now,
      fetchedAt: now,
      orgAttribution: "own_org" as const,
    }
    if (!bytes) {
      await db.insert(sourceItem).values({ id: randomUUID(), ...base, parseStatus: "skipped", parseError: "file data not readable" }).onConflictDoNothing()
      continue
    }
    try {
      const parsed = await parseDropoffFile(
        { bytes, fileName: f.filename, mediaType: f.mediaType, dropoffId: `${parentId}-${i}`, description: "Файл из ИИ чата" },
        ai,
      )
      const first = parsed.blocks[0]
      const childId = randomUUID()
      await db
        .insert(sourceItem)
        .values({
          id: childId,
          ...base,
          mimeType: parsed.mediaType,
          parseStatus: "complete",
          parsedAt: now,
          parserModel: first.parserModel ?? null,
          parsedMarkdown: first.markdown,
          metadataJson: { provider: "aichat", parentItemId: parentId, ...first.analysis },
        })
        .onConflictDoNothing()
      for (let b = 1; b < parsed.blocks.length; b++) {
        const extra = parsed.blocks[b]
        await db
          .insert(sourceItem)
          .values({
            id: randomUUID(),
            ...base,
            externalId: `${externalId}:audio`,
            externalType: extra.kind === "video_audio" ? "derived_audio" : "attachment",
            parentSourceItemId: childId,
            parseStatus: "complete",
            parsedAt: now,
            parserModel: extra.parserModel ?? null,
            parsedMarkdown: extra.markdown,
            metadataJson: { provider: "aichat", ...extra.analysis },
          })
          .onConflictDoNothing()
      }
    } catch (e) {
      // Unsupported / too large / parser error: a placeholder row says why.
      await db
        .insert(sourceItem)
        .values({
          id: randomUUID(),
          ...base,
          parseStatus: "skipped",
          parsedAt: now,
          parseError: e instanceof Error ? e.message.slice(0, 500) : String(e),
        })
        .onConflictDoNothing()
    }
  }
}

// ── Batch runs ────────────────────────────────────────────────────────

export type ChatIngestRunResult = {
  threads: number
  ingested: number
  newInfo: number
  nothing: number
  failed: number
  budgetStopped: boolean
}

/**
 * Ingest the due threads of one org (hourly topics phase «intake») or of
 * every org (`orgId = null`, daily pipeline). One failing thread never stops
 * the others; a budget stop ends the run (the rest waits for the next one).
 */
export async function ingestDueChatThreads(
  orgId: string | null,
  opts: { now?: Date; maxThreads?: number } = {},
): Promise<ChatIngestRunResult> {
  const now = opts.now ?? new Date()
  const ids = await listDueChatThreads(orgId, now, opts.maxThreads ?? DEFAULT_MAX_THREADS)
  const res: ChatIngestRunResult = { threads: ids.length, ingested: 0, newInfo: 0, nothing: 0, failed: 0, budgetStopped: false }
  for (const id of ids) {
    try {
      const r = await ingestChatThread(id)
      if (r.status === "ingested") {
        res.ingested++
        if (r.newInfo) res.newInfo++
      } else if (r.status === "budget") {
        res.budgetStopped = true
        break
      } else res.nothing++
    } catch (e) {
      res.failed++
      console.error("[chat/ingest] thread failed", id, e)
    }
  }
  return res
}

/** Source items made from one thread (for tests / admin views). */
export async function chatSegmentItems(orgId: string, threadId: string) {
  return db
    .select({ id: sourceItem.id, externalId: sourceItem.externalId, signalStatus: sourceItem.signalStatus, signalReason: sourceItem.signalReason })
    .from(sourceItem)
    .where(
      and(
        eq(sourceItem.organizationId, orgId),
        eq(sourceItem.threadKey, chatThreadKey(threadId)),
        isNotNull(sourceItem.externalId),
        inArray(sourceItem.externalType, ["aichat_session"]),
      ),
    )
    .orderBy(asc(sourceItem.createdAt))
}

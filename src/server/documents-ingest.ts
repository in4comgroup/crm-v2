import "server-only"

// Ingest side of documents (docs/specs/attachments): the ORIGINAL bytes of
// source documents, the automatic links after parse / topic / deal changes,
// the reparse carry-over of a person's links, and the one-time backfill
// (Q12). Org-explicit; every function here is best effort and never throws
// to its caller (failures are logged and reported as a status / count).
//
//   - storeOriginalForItem: lazy re-fetch of ONE document from its provider
//     (Nylas / IMAP / Google Chat / Drive) → storage
//   - storeRootOriginal: parse-time store of a root document (Drive / drop-off)
//   - autoLinkAfterParse / autoLinkDocumentsOfItems / autoLinkDocumentsOfTopics
//   - carryDocumentLinksForReparse / restoreCarriedLinks (reparse)
//   - backfillDocuments (Q12)

import { randomUUID } from "node:crypto"
import { simpleParser } from "mailparser"
import { and, asc, eq, gt, inArray, or, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { documentLink, source, sourceItem, topicItem } from "@/db/schema"
import { DOCUMENT_ITEM_KINDS, DOCUMENT_MAX_BYTES, type FileStatus } from "@/lib/documents"
import { getNylasClient } from "@/lib/nylas"
import { downloadTelegramFile } from "@/lib/telegram"
import { isTooLargeForBot, readTelegramFileRefs } from "@/lib/telegram-files"
import { downloadChatAttachmentBytes, getChatClient } from "@/lib/google-chat"
import { computeAutoLinks, isDecorativeSkip, notDecorativeSql, storeDocumentFile } from "@/server/documents"
import { fetchDriveOriginal } from "@/server/parsers/drive"
import { fetchImapMessageSource, imapFileAttachments } from "@/server/parsers/imap"
import {
  isGoogleChatItemMissing,
  isGoogleDriveItemMissing,
  isImapItemMissing,
  isNylasItemMissing,
} from "@/server/parsers/_provider-errors"
import {
  getGchatCredentials,
  getGdriveCredentials,
  getImapCredentials,
  getNylasCredentials,
  getTelegramCredentials,
} from "@/server/providers/credentials"
import { imapProviderConfigSchema } from "@/server/providers/handlers"
import { deleteObjects } from "@/server/storage"

const DOC_KINDS = [...DOCUMENT_ITEM_KINDS] as string[]
/** Documents handled per auto-link call (keeps hooks cheap). */
const AUTO_LINK_BATCH = 50

type BatchOps = Parameters<typeof db.batch>[0]
const asBatch = (ops: unknown[]) => ops as unknown as BatchOps

async function setFileStatus(orgId: string, itemId: string, status: FileStatus, extra: { size?: number; mime?: string } = {}) {
  await db
    .update(sourceItem)
    .set({
      fileStatus: status,
      ...(extra.size != null ? { fileSizeBytes: extra.size } : {}),
      ...(extra.mime ? { fileMime: extra.mime } : {}),
    })
    .where(and(eq(sourceItem.organizationId, orgId), eq(sourceItem.id, itemId)))
}

// ── Original bytes ────────────────────────────────────────────────────────

/**
 * PURE. A Content-Type safe for the storage request header. Providers send
 * values like `application/pdf; name="Счёт.pdf"` — non-ASCII in a header
 * makes the S3 client throw — so anything that is not plain printable ASCII
 * is cut to its base type (or octet-stream).
 */
export function storageSafeMime(mime: string | null | undefined): string | null {
  const m = (mime ?? "").trim()
  if (!m) return null
  if (/^[\x20-\x7e]+$/.test(m)) return m
  const base = m.split(";")[0].trim().toLowerCase()
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(base) ? base : "application/octet-stream"
}

/** `storeDocumentFile` with a header-safe mime. Never throws. */
export async function storeDocumentOriginal(
  orgId: string,
  itemId: string,
  bytes: Uint8Array,
  meta: { name: string | null; mime: string | null },
): Promise<FileStatus> {
  return storeDocumentFile(orgId, itemId, bytes, { name: meta.name, mime: storageSafeMime(meta.mime) })
}

/** Provider says the message / file is gone → the original is lost. */
class OriginalGoneError extends Error {}

type FetchedOriginal = { bytes: Uint8Array; name: string | null; mime: string | null }

/**
 * Fetch the original bytes of ONE document item from its provider (mail /
 * IMAP / Google Chat / Drive) and store them (`storeDocumentFile`). Returns
 * the resulting status; `not_stored` when the provider has no copy
 * (drop-off without stored bytes / WhatsApp / derived audio / AI chat /
 * gone at the provider) or the item is not a document. Never throws: a
 * provider error is logged and stored as `failed`.
 */
export async function storeOriginalForItem(orgId: string, itemId: string): Promise<FileStatus> {
  try {
    const [row] = await db
      .select({
        id: sourceItem.id,
        kind: sourceItem.externalType,
        externalId: sourceItem.externalId,
        parentId: sourceItem.parentSourceItemId,
        filename: sourceItem.filename,
        mimeType: sourceItem.mimeType,
        sizeBytes: sourceItem.sizeBytes,
        fileStatus: sourceItem.fileStatus,
        fileKey: sourceItem.fileKey,
        parseStatus: sourceItem.parseStatus,
        parseError: sourceItem.parseError,
        sourceId: source.id,
        provider: source.provider,
        credentialsRef: source.credentialsRef,
      })
      .from(sourceItem)
      .innerJoin(source, eq(source.id, sourceItem.sourceId))
      .where(and(eq(sourceItem.organizationId, orgId), eq(sourceItem.id, itemId)))
    // Not a document (or a decorative inline image): never write file_*.
    if (!row || !DOC_KINDS.includes(row.kind) || isDecorativeSkip(row.parseStatus, row.parseError)) return "not_stored"
    if (row.fileStatus === "stored" && row.fileKey) return "stored"
    if (row.fileStatus === "too_large") return "too_large"

    const remote = row.provider === "nylas" || row.provider === "imap" || row.provider === "gchat" || row.provider === "gdrive"
    // derived_audio: the bytes live in its video. WhatsApp (Q13), drop-off
    // without stored bytes, AI chat: no copy anywhere.
    if (!remote || row.kind === "derived_audio") {
      await setFileStatus(orgId, itemId, "not_stored")
      return "not_stored"
    }
    if (row.sizeBytes != null && row.sizeBytes > DOCUMENT_MAX_BYTES) {
      await setFileStatus(orgId, itemId, "too_large", { size: row.sizeBytes, mime: row.mimeType ?? undefined })
      return "too_large"
    }

    const parent = row.parentId
      ? (
          await db
            .select({ externalId: sourceItem.externalId, meta: sourceItem.metadataJson })
            .from(sourceItem)
            .where(and(eq(sourceItem.organizationId, orgId), eq(sourceItem.id, row.parentId)))
        )[0] ?? null
      : null

    let fetched: FetchedOriginal | "not_stored" | "too_large"
    try {
      fetched = await fetchOriginal(row, parent)
    } catch (err) {
      const gone =
        err instanceof OriginalGoneError ||
        (row.provider === "nylas" && isNylasItemMissing(err)) ||
        (row.provider === "imap" && isImapItemMissing(err)) ||
        (row.provider === "gchat" && isGoogleChatItemMissing(err)) ||
        (row.provider === "gdrive" && isGoogleDriveItemMissing(err))
      if (gone) {
        await setFileStatus(orgId, itemId, "not_stored")
        return "not_stored"
      }
      console.error(`[documents] fetching the original of ${itemId} failed:`, err)
      await setFileStatus(orgId, itemId, "failed")
      return "failed"
    }
    if (fetched === "not_stored" || fetched === "too_large") {
      await setFileStatus(orgId, itemId, fetched)
      return fetched
    }
    return await storeDocumentOriginal(orgId, itemId, fetched.bytes, {
      name: fetched.name ?? row.filename,
      // The fetched type wins: a Google Doc's item mime is the Google one,
      // its stored original is the Markdown export.
      mime: fetched.mime || row.mimeType,
    })
  } catch (err) {
    console.error(`[documents] storeOriginalForItem ${itemId} failed:`, err)
    await setFileStatus(orgId, itemId, "failed").catch(() => {})
    return "failed"
  }
}

/** Tail of `externalId` after `<prefix><parentExternalId>:`; null when it does not match. */
function tailAfter(externalId: string, prefix: string, parentExternalId: string | null | undefined): string | null {
  if (!parentExternalId) return null
  const head = `${prefix}${parentExternalId}:`
  return externalId.startsWith(head) ? externalId.slice(head.length) : null
}

async function fetchOriginal(
  row: {
    kind: string
    externalId: string
    filename: string | null
    sourceId: string
    provider: string
    credentialsRef: string | null
  },
  parent: { externalId: string; meta: unknown } | null,
): Promise<FetchedOriginal | "not_stored" | "too_large"> {
  switch (row.provider) {
    case "nylas": {
      // `nylas-att:<messageId>:<attachmentId>` (attachment ids may contain ':').
      const attachmentId = tailAfter(row.externalId, "nylas-att:", parent?.externalId)
      if (row.kind !== "attachment" || !attachmentId) return "not_stored"
      const creds = getNylasCredentials(row.sourceId, row.credentialsRef)
      const buffer = await getNylasClient(creds).attachments.downloadBytes({
        identifier: creds.grantId,
        attachmentId,
        queryParams: { messageId: parent!.externalId },
      })
      return { bytes: new Uint8Array(buffer), name: null, mime: null }
    }
    case "imap": {
      // `imap-att:<uidValidity>:<uid>:<index>`; index into `imapFileAttachments`.
      const tail = tailAfter(row.externalId, "imap-att:", parent?.externalId)
      const index = tail != null && /^\d+$/.test(tail) ? Number(tail) : -1
      if (row.kind !== "attachment" || index < 0) return "not_stored"
      const creds = getImapCredentials(row.sourceId, row.credentialsRef)
      const { mailbox } = imapProviderConfigSchema.parse(parent!.meta ?? {})
      const mail = await simpleParser(await fetchImapMessageSource(creds, mailbox, parent!.externalId))
      const att = imapFileAttachments(mail)[index]
      if (!att) throw new OriginalGoneError(`attachment ${index} not found`)
      if (row.filename && att.filename !== row.filename) {
        // The message changed shape since the parse — never store the wrong file.
        throw new OriginalGoneError(`attachment ${index} is now «${att.filename}», expected «${row.filename}»`)
      }
      return { bytes: att.bytes, name: att.filename, mime: att.contentType }
    }
    case "gchat": {
      // `gchat-att:<messageId>:<index>`; the parent's externalId is the full
      // `spaces/X/messages/Y`; index into `message.attachment[]`.
      const messageName = parent?.externalId ?? ""
      const messageId = messageName.split("/").pop() ?? ""
      const head = `gchat-att:${messageId}:`
      const tail = row.externalId.startsWith(head) ? row.externalId.slice(head.length) : ""
      if (row.kind !== "attachment" || !messageId || !/^\d+$/.test(tail)) return "not_stored"
      const creds = getGchatCredentials(row.sourceId, row.credentialsRef)
      const { data: msg } = await getChatClient(creds).spaces.messages.get({ name: messageName })
      const att = (msg.attachment ?? [])[Number(tail)]
      const resourceName = att?.attachmentDataRef?.resourceName
      if (!resourceName) throw new OriginalGoneError(`attachment ${tail} not found`)
      const bytes = await downloadChatAttachmentBytes(creds, resourceName)
      return { bytes, name: att?.contentName ?? null, mime: att?.contentType ?? null }
    }
    case "gdrive": {
      if (row.kind !== "drive_file") return "not_stored"
      const creds = getGdriveCredentials(row.sourceId, row.credentialsRef)
      const original = await fetchDriveOriginal(row.externalId, creds, DOCUMENT_MAX_BYTES)
      if (!original) return "not_stored"
      if ("tooLarge" in original) return "too_large"
      return { bytes: original.bytes, name: original.name, mime: original.mime }
    }
    case "telegram": {
      // `tg-att:<chatId>:<messageId>:<index>` → `telegram.attachments[index]`
      // of the parent message; `file_id` stays valid for this bot
      // (docs/specs/telegram §4.3). Above 20 MB the bot cannot fetch it.
      const tail = row.externalId.startsWith("tg-att:") ? row.externalId.split(":").pop() : ""
      const index = tail && /^\d+$/.test(tail) ? Number(tail) : -1
      if (row.kind !== "attachment" || !(index >= 0)) return "not_stored"
      const ref = readTelegramFileRefs((parent?.meta ?? {}) as Record<string, unknown>)[index]
      if (!ref) throw new OriginalGoneError(`attachment ${index} not found`)
      if (isTooLargeForBot(ref)) return "too_large"
      const { botToken } = getTelegramCredentials(row.sourceId, row.credentialsRef)
      const { bytes } = await downloadTelegramFile(botToken, ref.fileId)
      return { bytes: new Uint8Array(bytes), name: ref.fileName, mime: ref.mimeType }
    }
    default:
      return "not_stored"
  }
}

/**
 * Parse-time store of a ROOT document's original (Drive file, drop-off).
 * Replaces an earlier stored object under another name (a renamed Drive
 * file) so no orphan stays. Never throws.
 */
export async function storeRootOriginal(
  orgId: string,
  itemId: string,
  bytes: Uint8Array,
  meta: { name: string | null; mime: string | null },
): Promise<FileStatus> {
  try {
    const [before] = await db
      .select({ fileKey: sourceItem.fileKey })
      .from(sourceItem)
      .where(and(eq(sourceItem.organizationId, orgId), eq(sourceItem.id, itemId)))
    const status = await storeDocumentOriginal(orgId, itemId, bytes, meta)
    if (status === "stored" && before?.fileKey) {
      const [after] = await db
        .select({ fileKey: sourceItem.fileKey })
        .from(sourceItem)
        .where(and(eq(sourceItem.organizationId, orgId), eq(sourceItem.id, itemId)))
      if (after?.fileKey && after.fileKey !== before.fileKey) await deleteObjects([before.fileKey])
    }
    return status
  } catch (err) {
    console.error(`[documents] storing the original of ${itemId} failed:`, err)
    return "failed"
  }
}

// ── Automatic links (spec §4) ─────────────────────────────────────────────

/**
 * Documents among `itemIds` and their children / grandchildren (attachments
 * of a message, the audio track of a video), decorative images left out.
 * At most `AUTO_LINK_BATCH`.
 */
async function documentsOfItems(orgId: string, itemIds: string[]): Promise<string[]> {
  if (itemIds.length === 0) return []
  const ids = [...new Set(itemIds)]
  const rows = await db
    .select({ id: sourceItem.id })
    .from(sourceItem)
    .where(
      and(
        eq(sourceItem.organizationId, orgId),
        inArray(sourceItem.externalType, DOC_KINDS as never),
        notDecorativeSql,
        or(
          inArray(sourceItem.id, ids),
          inArray(sourceItem.parentSourceItemId, ids),
          inArray(
            sourceItem.parentSourceItemId,
            db
              .select({ id: sourceItem.id })
              .from(sourceItem)
              .where(and(eq(sourceItem.organizationId, orgId), inArray(sourceItem.parentSourceItemId, ids))),
          ),
        ),
      ),
    )
    .limit(AUTO_LINK_BATCH)
  return rows.map((r) => r.id)
}

/**
 * `computeAutoLinks` for the documents of these items (the items themselves
 * when they are documents + their document children). Best effort: never
 * throws; returns the number of links added.
 */
export async function autoLinkDocumentsOfItems(orgId: string, itemIds: string[]): Promise<number> {
  let added = 0
  try {
    for (const id of await documentsOfItems(orgId, itemIds)) {
      try {
        added += await computeAutoLinks(orgId, id)
      } catch (err) {
        console.error(`[documents] auto links of ${id} failed:`, err)
      }
    }
  } catch (err) {
    console.error("[documents] auto links failed:", err)
  }
  return added
}

/**
 * After a topic gets a deal (or new company / contact): recompute the links
 * of the documents of the topic's items. Best effort, ≤ 50 documents.
 */
export async function autoLinkDocumentsOfTopics(orgId: string, topicIds: string[]): Promise<number> {
  try {
    const ids = [...new Set(topicIds)]
    if (ids.length === 0) return 0
    const rows = await db
      .selectDistinct({ id: topicItem.sourceItemId })
      .from(topicItem)
      .where(and(eq(topicItem.organizationId, orgId), inArray(topicItem.topicId, ids)))
      .limit(500)
    return await autoLinkDocumentsOfItems(orgId, rows.map((r) => r.id))
  } catch (err) {
    console.error("[documents] auto links of topics failed:", err)
    return 0
  }
}

/**
 * After a successful parse of `itemId`: restore links carried over a
 * reparse, then the automatic links of the item (if a document) and of the
 * document children the parse just inserted. Never throws.
 */
export async function autoLinkAfterParse(orgId: string, itemId: string): Promise<number> {
  await restoreCarriedLinks(orgId, itemId)
  return autoLinkDocumentsOfItems(orgId, [itemId])
}

// ── Reparse: children are recreated with new ids ──────────────────────────

type CarriedLink = {
  externalId: string
  entityType: string
  entityId: string
  origin: string
  confidence: string
  reason: string | null
  createdByUserId: string | null
  removedAt: string | null
  removedByUserId: string | null
}

const CARRY_KEY = "documentLinkCarry"

/**
 * Before a reparse deletes the children of `rootId`: delete their stored
 * objects (original files + parsed markdown — the new children get new ids,
 * so these would be orphans) and keep the links a PERSON made or decided
 * (manual / upload links, confirmed automatic links, removed links — Q3:
 * a removal is final) in the root's `metadata_json.documentLinkCarry`,
 * keyed by the child's `external_id`. `restoreCarriedLinks` puts them back
 * on the new children after the next parse. Never throws.
 */
export async function carryDocumentLinksForReparse(orgId: string, rootId: string): Promise<void> {
  try {
    const children = await db
      .select({ id: sourceItem.id, externalId: sourceItem.externalId, fileKey: sourceItem.fileKey, mdKey: sourceItem.markdownR2Key })
      .from(sourceItem)
      .where(
        and(
          eq(sourceItem.organizationId, orgId),
          or(
            eq(sourceItem.parentSourceItemId, rootId),
            inArray(
              sourceItem.parentSourceItemId,
              db
                .select({ id: sourceItem.id })
                .from(sourceItem)
                .where(and(eq(sourceItem.organizationId, orgId), eq(sourceItem.parentSourceItemId, rootId))),
            ),
          ),
        ),
      )
    if (children.length === 0) return
    const extById = new Map(children.map((c) => [c.id, c.externalId]))
    const links = await db
      .select()
      .from(documentLink)
      .where(and(eq(documentLink.organizationId, orgId), inArray(documentLink.sourceItemId, [...extById.keys()])))
    const keep: CarriedLink[] = links
      .filter(
        (l) =>
          !l.origin.startsWith("auto_") ||
          !!l.removedAt ||
          // A5 / A3 links are written «medium»; «high» = a person confirmed it.
          ((l.origin === "auto_content" || l.origin === "auto_deal") && l.confidence === "high"),
      )
      .map((l) => ({
        externalId: extById.get(l.sourceItemId)!,
        entityType: l.entityType,
        entityId: l.entityId,
        origin: l.origin,
        confidence: l.confidence,
        reason: l.reason,
        createdByUserId: l.createdByUserId,
        removedAt: l.removedAt ? l.removedAt.toISOString() : null,
        removedByUserId: l.removedByUserId,
      }))
    if (keep.length > 0) {
      // Merge with a carry a previous (not yet parsed) reparse left behind.
      const [root] = await db
        .select({ meta: sourceItem.metadataJson })
        .from(sourceItem)
        .where(and(eq(sourceItem.organizationId, orgId), eq(sourceItem.id, rootId)))
      const prev = ((root?.meta as Record<string, unknown> | null)?.[CARRY_KEY] ?? []) as CarriedLink[]
      const seen = new Set<string>()
      const merged = [...keep, ...(Array.isArray(prev) ? prev : [])].filter((c) => {
        const k = `${c.externalId}|${c.entityType}|${c.entityId}`
        if (seen.has(k)) return false
        seen.add(k)
        return true
      })
      await db
        .update(sourceItem)
        .set({
          metadataJson: sql`COALESCE(${sourceItem.metadataJson}, '{}'::jsonb) || ${JSON.stringify({ [CARRY_KEY]: merged })}::jsonb`,
        })
        .where(and(eq(sourceItem.organizationId, orgId), eq(sourceItem.id, rootId)))
    }
    const keys = children.flatMap((c) => [c.fileKey, c.mdKey]).filter((k): k is string => !!k)
    if (keys.length > 0) {
      try {
        await deleteObjects(keys)
      } catch (err) {
        console.error(`[documents] deleting stored objects of the children of ${rootId} failed:`, err)
      }
    }
  } catch (err) {
    console.error(`[documents] carry of links for reparse of ${rootId} failed:`, err)
  }
}

/** Put the carried links back on the new children (same `external_id`). Never throws. */
export async function restoreCarriedLinks(orgId: string, rootId: string): Promise<void> {
  try {
    const [root] = await db
      .select({ meta: sourceItem.metadataJson, sourceId: sourceItem.sourceId })
      .from(sourceItem)
      .where(and(eq(sourceItem.organizationId, orgId), eq(sourceItem.id, rootId)))
    const carry = (root?.meta as Record<string, unknown> | null)?.[CARRY_KEY]
    if (!root || !Array.isArray(carry)) return
    const list = carry as CarriedLink[]
    const exts = [...new Set(list.map((c) => c.externalId))]
    const children = exts.length
      ? await db
          .select({ id: sourceItem.id, externalId: sourceItem.externalId })
          .from(sourceItem)
          .where(and(eq(sourceItem.organizationId, orgId), eq(sourceItem.sourceId, root.sourceId), inArray(sourceItem.externalId, exts)))
      : []
    const idByExt = new Map(children.map((c) => [c.externalId, c.id]))
    const values = list
      .filter((c) => idByExt.has(c.externalId))
      .map((c) => ({
        id: randomUUID(),
        organizationId: orgId,
        sourceItemId: idByExt.get(c.externalId)!,
        entityType: c.entityType,
        entityId: c.entityId,
        origin: c.origin,
        confidence: c.confidence,
        reason: c.reason,
        createdByUserId: c.createdByUserId,
        removedAt: c.removedAt ? new Date(c.removedAt) : null,
        removedByUserId: c.removedByUserId,
      }))
    const ops: unknown[] = []
    if (values.length > 0) ops.push(db.insert(documentLink).values(values).onConflictDoNothing())
    ops.push(
      db
        .update(sourceItem)
        .set({ metadataJson: sql`${sourceItem.metadataJson} - ${CARRY_KEY}::text` })
        .where(and(eq(sourceItem.organizationId, orgId), eq(sourceItem.id, rootId))),
    )
    await db.batch(asBatch(ops))
  } catch (err) {
    console.error(`[documents] restoring carried links of ${rootId} failed:`, err)
  }
}

// ── Backfill (Q12) ────────────────────────────────────────────────────────

export type BackfillResult = {
  scanned: number
  linksAdded: number
  stored: number
  notStored: number
  tooLarge: number
  failed: number
  /** Already had a file status (stored / not_stored / too_large) — not fetched again. */
  fileKept: number
  /** Last item id of this batch; pass as `afterId` to continue. Null = done. */
  nextAfterId: string | null
}

/**
 * One-time backfill of the org's existing documents (Q12): automatic links
 * for every document, and the original bytes where the provider still has
 * them (items with no file status yet, or a `failed` one). Idempotent and
 * resumable: ordered by id, `afterId` continues, `limit` per call (default
 * 200). Never throws for one item.
 */
export async function backfillDocuments(
  orgId: string,
  opts: { limit?: number; afterId?: string | null; storeFiles?: boolean } = {},
): Promise<BackfillResult> {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000)
  const rows = await db
    .select({ id: sourceItem.id, fileStatus: sourceItem.fileStatus })
    .from(sourceItem)
    .where(
      and(
        eq(sourceItem.organizationId, orgId),
        inArray(sourceItem.externalType, DOC_KINDS as never),
        notDecorativeSql,
        opts.afterId ? gt(sourceItem.id, opts.afterId) : undefined,
      ),
    )
    .orderBy(asc(sourceItem.id))
    .limit(limit)
  const r: BackfillResult = { scanned: 0, linksAdded: 0, stored: 0, notStored: 0, tooLarge: 0, failed: 0, fileKept: 0, nextAfterId: null }
  for (const row of rows) {
    r.scanned++
    try {
      r.linksAdded += await computeAutoLinks(orgId, row.id)
    } catch (err) {
      console.error(`[documents] backfill links of ${row.id} failed:`, err)
    }
    if (opts.storeFiles === false) continue
    if (row.fileStatus && row.fileStatus !== "failed") {
      r.fileKept++
      continue
    }
    const status = await storeOriginalForItem(orgId, row.id)
    if (status === "stored") r.stored++
    else if (status === "not_stored") r.notStored++
    else if (status === "too_large") r.tooLarge++
    else r.failed++
  }
  r.nextAfterId = rows.length === limit ? rows[rows.length - 1].id : null
  return r
}

/** Orgs that have at least one document item (backfill driver). */
export async function listOrgsWithDocuments(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ orgId: sourceItem.organizationId })
    .from(sourceItem)
    .where(and(inArray(sourceItem.externalType, DOC_KINDS as never), sql`${sourceItem.organizationId} is not null`))
  return rows.map((r) => r.orgId).filter((x): x is string => !!x)
}

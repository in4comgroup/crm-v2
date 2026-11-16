import "server-only"

import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { source, sourceItem } from "@/db/schema"
import { detectForward, extractEmailAddress } from "@/lib/ru-mail"
import { getTextObject } from "@/server/storage"
import type { ExtractionEnvelope } from "@/server/topics/prompt/extraction"
import { buildSignalItemText, type AttachmentText, type SignalItemText } from "./attachment-blocks"
import { messageContent } from "./evidence"

// Input of one signal extraction: the item row, its markdown and the
// envelope (spec topics/01 §5.1). Shared by the engine, the golden set and
// the eval runner, so all three show the model the same thing.
//
// Markdown: `parsed_markdown` until upload, then storage (`markdown_r2_key`),
// because the DB copy is cleared after upload (spec §5.1).

export async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i], i)
      }
    }),
  )
  return out
}

export async function itemMarkdown(row: {
  parsedMarkdown: string | null
  markdownR2Key: string | null
}): Promise<string | null> {
  if (row.parsedMarkdown) return row.parsedMarkdown
  if (!row.markdownR2Key) return null
  try {
    return await getTextObject(row.markdownR2Key)
  } catch (error) {
    console.warn("[topics/signals] markdown not readable", row.markdownR2Key, error)
    return null
  }
}

type Addr = { name?: string | null; email?: string | null }

export function formatAddrs(v: unknown): string | null {
  if (!Array.isArray(v)) return typeof v === "string" && v.trim() ? v : null
  const parts = (v as Addr[])
    .map((a) => (typeof a === "string" ? a : a?.name ? `${a.name} <${a.email ?? ""}>` : (a?.email ?? "")))
    .filter(Boolean)
  return parts.length ? parts.join(", ") : null
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null
}

/**
 * Original author of a forwarded Telegram message, from
 * `metadata_json.telegram.forwardOrigin` (compact copy of Telegram's
 * `forward_origin`; fields may sit at the top level or one level down).
 */
export function telegramForwardAuthor(origin: unknown): string | null {
  if (!origin || typeof origin !== "object") return null
  const o = origin as Record<string, unknown>
  const pick = (r: Record<string, unknown>): string | null => {
    const name = [str(r.firstName) ?? str(r.first_name), str(r.lastName) ?? str(r.last_name)]
      .filter(Boolean)
      .join(" ")
    const username = str(r.username)
    const label =
      name ||
      str(r.senderUserName) ||
      str(r.sender_user_name) ||
      str(r.title) ||
      str(r.authorSignature) ||
      null
    if (label && username) return `${label} (@${username})`
    return label ?? (username ? `@${username}` : null)
  }
  const top = pick(o)
  if (top) return top
  for (const v of Object.values(o)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const nested = pick(v as Record<string, unknown>)
      if (nested) return nested
    }
  }
  return null
}

export type SignalItemRow = {
  id: string
  organizationId: string | null
  provider: string | null
  externalType: string
  parentSourceItemId: string | null
  parseStatus: string
  sourceCreatedAt: Date | null
  createdAt: Date
  orgAttribution: string | null
  metadataJson: unknown
  parsedMarkdown: string | null
  markdownR2Key: string | null
  threadExternalId: string | null
  externalId: string
  signalAttempts: number
}

/** Item rows of one org (missing / foreign ids are left out). */
export async function loadSignalItemRows(orgId: string, ids: readonly string[]): Promise<SignalItemRow[]> {
  if (ids.length === 0) return []
  return db
    .select({
      id: sourceItem.id,
      organizationId: sourceItem.organizationId,
      provider: source.provider,
      externalType: sourceItem.externalType,
      parentSourceItemId: sourceItem.parentSourceItemId,
      parseStatus: sourceItem.parseStatus,
      sourceCreatedAt: sourceItem.sourceCreatedAt,
      createdAt: sourceItem.createdAt,
      orgAttribution: sourceItem.orgAttribution,
      metadataJson: sourceItem.metadataJson,
      parsedMarkdown: sourceItem.parsedMarkdown,
      markdownR2Key: sourceItem.markdownR2Key,
      threadExternalId: sourceItem.threadExternalId,
      externalId: sourceItem.externalId,
      signalAttempts: sourceItem.signalAttempts,
    })
    .from(sourceItem)
    .innerJoin(source, eq(source.id, sourceItem.sourceId))
    .where(and(eq(sourceItem.organizationId, orgId), inArray(sourceItem.id, [...ids])))
}

/** Sender address (email) or null — for the deterministic gates. */
export function senderEmail(metadataJson: unknown): string | null {
  const m = (metadataJson ?? {}) as Record<string, unknown>
  const from = m.from
  if (Array.isArray(from) && from.length > 0) {
    const a = from[0] as Addr | string
    return extractEmailAddress(typeof a === "string" ? a : (a?.email ?? null))
  }
  if (typeof from === "string") return extractEmailAddress(from)
  const senders = Array.isArray(m.senders) ? m.senders : []
  for (const s of senders) {
    const e = typeof s === "string" ? extractEmailAddress(s) : null
    if (e) return e
  }
  return null
}

export function senderName(metadataJson: unknown): string | null {
  const m = (metadataJson ?? {}) as Record<string, unknown>
  const from = m.from
  if (Array.isArray(from) && from.length > 0) {
    const a = from[0] as Addr | string
    return typeof a === "string" ? null : str(a?.name)
  }
  return null
}

/** Mail headers when the provider stored them (lower-cased keys), else null. */
export function itemHeaders(metadataJson: unknown): Record<string, string> | null {
  const m = (metadataJson ?? {}) as Record<string, unknown>
  const h = m.headers
  if (!h || typeof h !== "object") return null
  const out: Record<string, string> = {}
  if (Array.isArray(h)) {
    for (const e of h as { name?: unknown; value?: unknown }[]) {
      if (typeof e?.name === "string" && typeof e?.value === "string") out[e.name.toLowerCase()] = e.value
    }
  } else {
    for (const [k, v] of Object.entries(h as Record<string, unknown>)) {
      if (typeof v === "string") out[k.toLowerCase()] = v
    }
  }
  return Object.keys(out).length ? out : null
}

/**
 * Identity spec Q9: the parse-time fact «author and every recipient are ours»
 * (`metadata_json.orgAttribution.allInternal`). Null when the item was parsed
 * before the fact existed.
 */
export function storedAllInternal(metadataJson: unknown): boolean | null {
  const m = (metadataJson ?? {}) as Record<string, unknown>
  const a = m.orgAttribution
  if (!a || typeof a !== "object") return null
  const v = (a as Record<string, unknown>).allInternal
  return typeof v === "boolean" ? v : null
}

export function envelopeFromItem(item: {
  provider: string | null
  externalType: string | null
  sourceCreatedAt: Date | null
  orgAttribution: string | null
  metadataJson: unknown
}, text?: string | null): ExtractionEnvelope {
  const m = (item.metadataJson ?? {}) as Record<string, unknown>
  const tg = (m.telegram ?? {}) as Record<string, unknown>
  const tgFrom = (tg.from ?? null) as { firstName?: string; lastName?: string; username?: string } | null
  const senders = Array.isArray(m.senders) ? (m.senders as unknown[]).filter((s) => typeof s === "string") : []
  const from =
    formatAddrs(m.from) ??
    (tgFrom
      ? [tgFrom.firstName, tgFrom.lastName].filter(Boolean).join(" ") +
        (tgFrom.username ? ` (@${tgFrom.username})` : "")
      : null) ??
    (senders.length ? senders.join(", ") : null)
  const subject = typeof m.subject === "string" ? m.subject : null

  // Forwarded messages (spec §5.3, Q32): the author is the ORIGINAL sender.
  let forwardedBy: string | null = null
  let originalAuthor: string | null = null
  const tgOrigin = tg.forwardOrigin ?? tg.forward_origin ?? null
  // AI chat note (docs/specs/ai-chat §16.3, Q22): the employee relays what a
  // counterparty said → like a forward; the counterparty from the gate model.
  const chatNote = item.provider === "aichat" && m.chatNote && typeof m.chatNote === "object"
    ? (m.chatNote as { relayedFrom?: unknown })
    : null
  if (chatNote) {
    forwardedBy = from
    originalAuthor = str(chatNote.relayedFrom) ?? "не указан"
  } else if (tgOrigin) {
    forwardedBy = from
    originalAuthor = telegramForwardAuthor(tgOrigin) ?? "скрыт"
  } else if (text && (item.provider === "nylas" || item.provider === "imap")) {
    const fwd = detectForward(text, subject)
    if (fwd.isForward && fwd.originalFrom) {
      forwardedBy = from
      originalAuthor = fwd.originalFrom
    }
  }

  return {
    provider: item.provider,
    kind: item.externalType,
    date: item.sourceCreatedAt?.toISOString() ?? null,
    subject,
    from,
    to: formatAddrs(m.to),
    cc: formatAddrs(m.cc),
    orgAttribution: item.orgAttribution,
    // A forward is never «internal» (its author is the original sender).
    allInternal: storedAllInternal(item.metadataJson) === true && !forwardedBy && !originalAuthor,
    forwardedBy,
    originalAuthor,
    ...(chatNote ? { relayedNote: true } : {}),
  }
}

// ── Attachments (spec telegram/01 §4.6) ────────────────────────────────────

type ChildRow = {
  id: string
  parentSourceItemId: string | null
  externalId: string
  externalType: string
  name: string | null
  parsedMarkdown: string | null
  markdownR2Key: string | null
}

async function childText(row: ChildRow): Promise<string> {
  const md = await itemMarkdown(row)
  return md ? messageContent(md) : ""
}

/**
 * Parsed attachment texts of one ROOT item, in the order they were stored
 * (`created_at`, then external id). Rule:
 * - direct children of the root (`parent_source_item_id = root`) with
 *   `parse_status = complete` — skipped / failed children (decorative inline
 *   images, unsupported or oversized files) are left out by that status;
 * - never a `derived_audio` row as its own file: it is the audio track of a
 *   video. A video file's text = its transcript (the `derived_audio` row with
 *   external id `<video external id>:audio` — a grandchild for mail / Google
 *   Chat / Telegram, a sibling for WhatsApp archives) when that transcript
 *   is not empty, else the video's own text (the visual description);
 * - content = the child's `## Content` (`messageContent`); name = `filename`,
 *   else a file name in the child's metadata.
 * Org-explicit; a read error of one child's markdown leaves that child empty.
 */
export async function loadAttachmentTexts(orgId: string, rootId: string): Promise<AttachmentText[]> {
  const cols = {
    id: sourceItem.id,
    parentSourceItemId: sourceItem.parentSourceItemId,
    externalId: sourceItem.externalId,
    externalType: sourceItem.externalType,
    name: sql<string | null>`coalesce(${sourceItem.filename}, ${sourceItem.metadataJson}->>'fileName', ${sourceItem.metadataJson}->>'filename')`,
    parsedMarkdown: sourceItem.parsedMarkdown,
    markdownR2Key: sourceItem.markdownR2Key,
  }
  const children: ChildRow[] = await db
    .select(cols)
    .from(sourceItem)
    .where(
      and(
        eq(sourceItem.organizationId, orgId),
        eq(sourceItem.parentSourceItemId, rootId),
        eq(sourceItem.parseStatus, "complete"),
      ),
    )
    .orderBy(asc(sourceItem.createdAt), asc(sourceItem.externalId))
  if (children.length === 0) return []

  const files = children.filter((c) => c.externalType !== "derived_audio")
  if (files.length === 0) return []
  // Audio tracks: siblings already loaded + grandchildren under the files.
  const audio = new Map<string, ChildRow>()
  for (const c of children) if (c.externalType === "derived_audio") audio.set(c.externalId, c)
  const grand: ChildRow[] = await db
    .select(cols)
    .from(sourceItem)
    .where(
      and(
        eq(sourceItem.organizationId, orgId),
        inArray(sourceItem.parentSourceItemId, files.map((f) => f.id)),
        eq(sourceItem.externalType, "derived_audio"),
        eq(sourceItem.parseStatus, "complete"),
      ),
    )
  for (const g of grand) audio.set(g.externalId, g)

  return mapPool(files, 4, async (f): Promise<AttachmentText> => {
    const track = audio.get(`${f.externalId}:audio`)
    const transcript = track ? (await childText(track)).trim() : ""
    const content = transcript || (await childText(f))
    return { name: f.name ?? "", content }
  })
}

/**
 * The extraction input of one item from its root markdown + its parsed
 * attachments (spec §4.6): the engine, the golden set and the eval runners
 * all build it here, so evals measure the real behaviour.
 */
export async function loadSignalItemText(
  orgId: string,
  rootId: string | null,
  rootMarkdown: string | null,
): Promise<SignalItemText> {
  const message = rootMarkdown ? messageContent(rootMarkdown) : ""
  const files = rootId ? await loadAttachmentTexts(orgId, rootId) : []
  return buildSignalItemText(message, files)
}

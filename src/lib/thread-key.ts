// Normalised thread key per provider (spec docs/specs/topics/01 §6.1).
// Pure + client-safe: no DB, no Node APIs. Written to
// `source_item.thread_key` at sync / ingest (src/server/sync/*,
// src/server/ingest/telegram.ts, the WhatsApp archive upload) and by the
// resumable backfill `src/server/topics/thread-key-backfill.ts`.
//
// | nylas    | nylas:<threadId>                                          |
// | imap     | imap:<root Message-ID> (References[0] → In-Reply-To → own) |
// | gchat    | gchat:<space id>/<thread id>                              |
// | telegram | tg:<chat id>:<window id = message id of the window's first message> |
// | whatsapp | wa:<archive chat>:<groupKey>                              |
// | others   | null (documents are standalone)                           |
//
// `thread_external_id` stays as it is; the key is a separate column.

/** Gap that starts a new chat window (same rule as the WhatsApp grouping). */
export const CHAT_WINDOW_GAP_MS = 60 * 60 * 1000
/** Max messages in one chat window (same rule as the WhatsApp grouping). */
export const CHAT_WINDOW_MAX_MESSAGES = 100

function clean(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  if (typeof value !== "string") return null
  const v = value.trim()
  return v.length > 0 ? v : null
}

/** Message-ID normalisation: trim, strip `<>`, lower-case. Empty → null. */
export function normalizeMessageId(value: unknown): string | null {
  const v = clean(value)
  if (!v) return null
  const stripped = v.replace(/^<+/, "").replace(/>+$/, "").trim().toLowerCase()
  return stripped.length > 0 ? stripped : null
}

/**
 * Message-IDs of a References / In-Reply-To value, in order. Accepts the raw
 * header value (`<a@x> <b@y>`), an array of ids, or bare ids separated by
 * whitespace. Each id is normalised; empties are dropped.
 */
export function parseMessageIdList(value: unknown): string[] {
  const parts: string[] = []
  const add = (raw: string) => {
    const bracketed = raw.match(/<[^<>]+>/g)
    if (bracketed && bracketed.length > 0) parts.push(...bracketed)
    else parts.push(...raw.split(/[\s,]+/))
  }
  if (Array.isArray(value)) {
    for (const v of value) if (typeof v === "string") add(v)
  } else if (typeof value === "string") {
    add(value)
  }
  const out: string[] = []
  for (const p of parts) {
    const id = normalizeMessageId(p)
    if (id) out.push(id)
  }
  return out
}

/**
 * Value of one header field (case-insensitive, folded lines joined) from a
 * raw RFC 5322 header block, or null when absent. Used on the header bytes
 * imapflow returns for `fetch({ headers: [...] })`.
 */
export function readHeaderField(rawHeaders: string, name: string): string | null {
  const unfolded = rawHeaders.replace(/\r?\n[ \t]+/g, " ")
  const wanted = name.toLowerCase() + ":"
  for (const line of unfolded.split(/\r?\n/)) {
    if (line.toLowerCase().startsWith(wanted)) {
      const v = line.slice(wanted.length).trim()
      return v.length > 0 ? v : null
    }
  }
  return null
}

export function nylasThreadKey(threadId: unknown): string | null {
  const id = clean(threadId)
  return id ? `nylas:${id}` : null
}

/**
 * IMAP root Message-ID: References[0], else In-Reply-To, else the message's
 * own Message-ID. All normalised.
 */
export function imapThreadKey(input: {
  references?: unknown
  inReplyTo?: unknown
  messageId?: unknown
}): string | null {
  const root =
    parseMessageIdList(input.references)[0] ??
    parseMessageIdList(input.inReplyTo)[0] ??
    normalizeMessageId(input.messageId)
  return root ? `imap:${root}` : null
}

/**
 * Google Chat: `gchat:<space id>/<thread id>`. Accepts full resource names
 * (`spaces/X`, `spaces/X/threads/Y`) or bare ids.
 */
export function gchatThreadKey(space: unknown, thread: unknown): string | null {
  const s = clean(space)
  const t = clean(thread)
  if (!s || !t) return null
  const spaceId = s.replace(/^spaces\//, "").split("/")[0]
  const threadId = t.split("/").pop() ?? ""
  if (!spaceId || !threadId) return null
  return `gchat:${spaceId}/${threadId}`
}

/** Space id from a Chat message resource name `spaces/X/messages/Y`. */
export function gchatSpaceFromMessageName(name: unknown): string | null {
  const n = clean(name)
  const m = n?.match(/^spaces\/([^/]+)\//)
  return m ? m[1] : null
}

/**
 * WhatsApp archive chat name: the picked folder name («WhatsApp Chat -
 * Норлекс» → «норлекс»), lower-cased, bidi marks removed, spaces collapsed.
 */
export function normalizeWhatsAppChatName(value: unknown): string | null {
  const v = clean(value)
  if (!v) return null
  const n = v
    .replace(/[‎‏‪-‮⁦-⁩﻿]/g, "")
    .replace(/^whatsapp\s+chat\s*(?:-|–|—|with)\s*/i, "")
    .replace(/^чат\s+whatsapp\s*(?:-|–|—|с)\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
  return n.length > 0 ? n : null
}

/** Unknown archive chat → this placeholder (the groupKey alone is unique). */
export const WHATSAPP_UNKNOWN_CHAT = "_"

export function whatsappThreadKey(
  archiveChat: unknown,
  groupKey: unknown,
): string | null {
  const g = clean(groupKey)
  if (!g) return null
  return `wa:${normalizeWhatsAppChatName(archiveChat) ?? WHATSAPP_UNKNOWN_CHAT}:${g}`
}

export function telegramThreadKey(chatId: unknown, windowId: unknown): string | null {
  const c = clean(chatId)
  const w = clean(windowId)
  return c && w ? `tg:${c}:${w}` : null
}

/** `{ chatId, windowId }` of a telegram key, or null. */
export function parseTelegramThreadKey(
  key: unknown,
): { chatId: string; windowId: string } | null {
  const k = clean(key)
  const m = k?.match(/^tg:(-?\d+):(.+)$/)
  return m ? { chatId: m[1], windowId: m[2] } : null
}

/** The latest earlier message of the same chat, as the window rule needs it. */
export type TelegramPrevious = {
  at: Date
  // Window id of its key; null when it has no key yet.
  windowId: string | null
  // Number of messages already in that window (incl. the previous one).
  windowSize: number
}

/**
 * Window decision for a new telegram message: it joins the previous
 * message's window unless there is no previous keyed message, the gap is
 * > 1 h, or that window already has 100 messages. A new window takes the
 * message's own id as its id (stable: it never changes later).
 */
export function decideTelegramWindow(
  prev: TelegramPrevious | null,
  current: { at: Date; messageId: string | number },
): { windowId: string; windowSize: number; isNew: boolean } {
  if (
    prev &&
    prev.windowId &&
    current.at.getTime() - prev.at.getTime() <= CHAT_WINDOW_GAP_MS &&
    prev.windowSize < CHAT_WINDOW_MAX_MESSAGES
  ) {
    return { windowId: prev.windowId, windowSize: prev.windowSize + 1, isNew: false }
  }
  return { windowId: String(current.messageId), windowSize: 1, isNew: true }
}

/**
 * Windows over ONE chat's items in time order (backfill). Items that already
 * have a key keep it and set the current window; items without a key get a
 * key from `decideTelegramWindow`. Returns id → key for the items without a
 * key only.
 */
export function assignTelegramWindows(
  chatId: string,
  items: { id: string; at: Date; messageId: string | number; threadKey: string | null }[],
): Map<string, string> {
  const out = new Map<string, string>()
  let prev: TelegramPrevious | null = null
  for (const item of items) {
    const existing = parseTelegramThreadKey(item.threadKey)
    if (existing && existing.chatId === chatId) {
      const same: boolean = prev !== null && prev.windowId === existing.windowId
      prev = {
        at: item.at,
        windowId: existing.windowId,
        windowSize: same && prev ? prev.windowSize + 1 : 1,
      }
      continue
    }
    const d = decideTelegramWindow(prev, { at: item.at, messageId: item.messageId })
    out.set(item.id, `tg:${chatId}:${d.windowId}`)
    prev = { at: item.at, windowId: d.windowId, windowSize: d.windowSize }
  }
  return out
}

/** Telegram message id of an item: metadata first, else `<chat>:<msg>` external id. */
export function telegramMessageIdOf(
  metadata: Record<string, unknown> | null | undefined,
  externalId: string,
): string | null {
  const tg = metadata?.telegram as Record<string, unknown> | undefined
  const fromMeta = clean(tg?.messageId)
  if (fromMeta) return fromMeta
  const m = externalId.match(/^-?\d+:(\d+)$/)
  return m ? m[1] : null
}

/**
 * Key for a stored row of a provider WITHOUT a cross-item rule (all but
 * telegram). Used by the backfill; the sync paths call the per-provider
 * helpers directly.
 */
export function threadKeyForStoredItem(input: {
  provider: string
  externalId: string
  threadExternalId: string | null
  metadata: Record<string, unknown> | null | undefined
}): string | null {
  const meta = input.metadata ?? {}
  switch (input.provider) {
    case "nylas":
      return nylasThreadKey(input.threadExternalId)
    case "imap":
      // Old rows have no References / inReplyTo in metadata; their
      // thread_external_id holds the envelope In-Reply-To.
      return imapThreadKey({
        references: meta.references,
        inReplyTo: meta.inReplyTo ?? input.threadExternalId,
        messageId: meta.messageId,
      })
    case "gchat":
      return gchatThreadKey(
        clean(meta.spaceName) ?? gchatSpaceFromMessageName(input.externalId),
        input.threadExternalId,
      )
    case "whatsapp":
      if (meta.analysisExcluded === true) return null
      return whatsappThreadKey(meta.archiveChat, meta.groupKey)
    default:
      return null
  }
}

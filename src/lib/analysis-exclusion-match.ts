// «Исключения из анализа» (analysis exclusions) — the pure, client-safe half:
// value normalisation, the probe built from one source item, and the matcher.
// No DB, no server-only imports — the server loader lives in
// `src/server/analysis-exclusions.ts`; the UI uses `normalizeExclusionValue`
// for instant validation. Spec: docs/specs/topics/01-specification.md §5.2
// gate 3a (Q31, R18).
//
// Normalised forms (= `analysis_exclusion.normalized_value`):
//   • email  → lower-cased bare address ("Ivan <IVAN@Acme.ru>" → "ivan@acme.ru").
//   • domain → bare lower-cased host: strips "@", scheme, "www.", path
//              ("https://www.Acme.ru/x" → "acme.ru"). A domain entry matches
//              the domain itself AND every subdomain ("acme.ru" matches
//              "mail.acme.ru"), never the other way round.
//   • chat   → provider-prefixed key, so one value can't collide across
//              providers:
//                telegram:<chat id>       e.g. "telegram:123456789", "telegram:-1001234"
//                telegram:@<username>     e.g. "telegram:@ivan_petrov" (lower-cased)
//                whatsapp:<chat name>     lower-cased, trimmed, inner spaces collapsed
//                gchat:spaces/<space id>  case kept (space ids are case-sensitive)
//
// MATCHING RULE (mail and chats alike): an item is excluded when ANY address
// or chat key on it matches ANY entry — sender, recipients, cc, bcc,
// participants. A thread with an excluded person must not be analysed, even
// when other people are on it. Body mentions (`mentionedPeople`) do NOT count:
// a mention is not participation.

export type AnalysisExclusionKind = "email" | "domain" | "chat"

export const ANALYSIS_EXCLUSION_KINDS: readonly AnalysisExclusionKind[] = [
  "email",
  "domain",
  "chat",
]

export type AnalysisExclusionEntry = {
  id: string
  kind: AnalysisExclusionKind
  value: string
  normalizedValue: string
}

export type ExclusionChatProvider = "telegram" | "whatsapp" | "gchat"

export const EXCLUSION_CHAT_PROVIDERS: readonly ExclusionChatProvider[] = [
  "telegram",
  "whatsapp",
  "gchat",
]

// Bidi marks / BOM that WhatsApp exports sprinkle into names.
const INVISIBLE_RE = /[‎‏‪-‮⁦-⁩﻿]/g
const EMAIL_RE = /[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}/i

function normalizeEmail(raw: string): string | null {
  const m = raw.trim().toLowerCase().match(EMAIL_RE)
  return m ? m[0] : null
}

function normalizeDomain(raw: string): string | null {
  let s = raw.trim().toLowerCase()
  if (!s) return null
  const at = s.lastIndexOf("@")
  if (at >= 0) s = s.slice(at + 1)
  s = s.replace(/^[a-z][a-z0-9+\-.]*:\/\//, "")
  const cut = s.search(/[/?#:]/)
  if (cut >= 0) s = s.slice(0, cut)
  s = s.replace(/^www\./, "").replace(/\.$/, "")
  if (!/^[a-z0-9Ѐ-ӿ-]+(\.[a-z0-9Ѐ-ӿ-]+)+$/.test(s)) return null
  return s
}

function normalizeWhatsAppName(raw: string): string {
  return raw.replace(INVISIBLE_RE, "").trim().replace(/\s+/g, " ").toLowerCase()
}

/** Telegram chat value: numeric chat id (groups are negative) or @username. */
function normalizeTelegramChat(raw: string): string | null {
  let s = raw.trim()
  // Accept t.me links: "https://t.me/ivan_petrov" → "@ivan_petrov".
  const link = s.match(/^(?:https?:\/\/)?(?:t\.me|telegram\.me)\/([A-Za-z0-9_]+)\/?$/i)
  if (link) s = `@${link[1]}`
  if (/^-?\d+$/.test(s)) return `telegram:${s}`
  const user = s.match(/^@?([A-Za-z][A-Za-z0-9_]{3,31})$/)
  if (user) return `telegram:@${user[1].toLowerCase()}`
  return null
}

/** Google Chat space: "spaces/AAQA…", bare "AAQA…" or a chat.google.com URL. */
function normalizeGchatSpace(raw: string): string | null {
  const s = raw.trim()
  const url = s.match(/chat\.google\.com\/(?:u\/\d+\/)?(?:room|space)\/([A-Za-z0-9_-]+)/i)
  if (url) return `gchat:spaces/${url[1]}`
  const m = s.match(/^(?:spaces\/)?([A-Za-z0-9_-]+)$/)
  return m ? `gchat:spaces/${m[1]}` : null
}

/**
 * Normalise an operator-typed value to its dedupe / match key, or null when
 * the value is invalid for the kind. For `chat` the input must carry the
 * provider prefix (`telegram:…`, `whatsapp:…`, `gchat:…`); use
 * `chatExclusionValue(provider, raw)` to build it from a provider select.
 */
export function normalizeExclusionValue(
  kind: AnalysisExclusionKind,
  raw: string,
): string | null {
  const value = (raw ?? "").trim()
  if (!value) return null
  if (kind === "email") return normalizeEmail(value)
  if (kind === "domain") return normalizeDomain(value)
  // chat
  const sep = value.indexOf(":")
  if (sep <= 0) return null
  const provider = value.slice(0, sep).trim().toLowerCase()
  const rest = value.slice(sep + 1).trim()
  if (!rest) return null
  if (provider === "telegram") return normalizeTelegramChat(rest)
  if (provider === "whatsapp") {
    const name = normalizeWhatsAppName(rest)
    return name ? `whatsapp:${name}` : null
  }
  if (provider === "gchat") return normalizeGchatSpace(rest)
  return null
}

/** Build the prefixed chat value from the UI's provider select + raw text. */
export function chatExclusionValue(provider: ExclusionChatProvider, raw: string): string {
  return `${provider}:${(raw ?? "").trim()}`
}

/** Split a stored chat key into provider + display part (for the UI). */
export function splitChatExclusionValue(
  value: string,
): { provider: ExclusionChatProvider | null; rest: string } {
  const sep = value.indexOf(":")
  const p = sep > 0 ? value.slice(0, sep).toLowerCase() : ""
  const provider = (EXCLUSION_CHAT_PROVIDERS as readonly string[]).includes(p)
    ? (p as ExclusionChatProvider)
    : null
  return { provider, rest: provider ? value.slice(sep + 1) : value }
}

// ── Probe ─────────────────────────────────────────────────────────────

export type ExclusionProbe = { emails: string[]; chatKeys: string[] }

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

/**
 * Addresses + chat keys of one item's envelope. Reads every shape the syncs /
 * ingesters write into `metadata_json`:
 *   • nylas / imap: from / to / cc / bcc / reply_to / replyTo = [{ name, email }]
 *   • calendar invites + gchat: participants = [{ name, email }]
 *   • strings in senders / recipients (an email inside them is used)
 *   • telegram: telegram.chatId, telegram.from.{id,username},
 *     telegram.forwardOrigin (a forwarded message from an excluded person
 *     or chat is excluded too)
 *   • whatsapp: chatName (if present) + every author name
 *   • gchat: spaceName in metadata, or the space taken from `externalId`
 *     ("spaces/X/messages/Y") when the caller passes it
 * `externalId` is optional (added on top of the shared contract).
 */
export function exclusionProbeFromItem(item: {
  provider: string | null
  metadataJson: unknown
  threadExternalId: string | null
  externalId?: string | null
}): ExclusionProbe {
  const m = asRecord(item.metadataJson) ?? {}
  const provider = (item.provider ?? (typeof m.provider === "string" ? m.provider : "")) || ""
  const emails = new Set<string>()
  const chatKeys = new Set<string>()

  const addEmail = (raw: unknown) => {
    if (typeof raw !== "string") return
    const e = normalizeEmail(raw)
    if (e) emails.add(e)
  }
  const addList = (list: unknown) => {
    if (!Array.isArray(list)) return
    for (const p of list) {
      if (typeof p === "string") addEmail(p)
      else {
        const r = asRecord(p)
        if (r) addEmail(r.email ?? r.address)
      }
    }
  }

  for (const field of ["from", "to", "cc", "bcc", "reply_to", "replyTo", "participants", "senders", "recipients"]) {
    addList(m[field])
  }

  if (provider === "telegram") {
    const tg = asRecord(m.telegram) ?? {}
    const addTgId = (id: unknown) => {
      if (typeof id === "number" || (typeof id === "string" && /^-?\d+$/.test(id))) {
        chatKeys.add(`telegram:${id}`)
      }
    }
    const addTgUser = (u: unknown) => {
      if (typeof u === "string" && u.trim()) {
        chatKeys.add(`telegram:@${u.trim().replace(/^@/, "").toLowerCase()}`)
      }
    }
    addTgId(tg.chatId)
    if (item.threadExternalId) addTgId(item.threadExternalId)
    const from = asRecord(tg.from)
    if (from) {
      addTgId(from.id)
      addTgUser(from.username)
    }
    const fwd = asRecord(tg.forwardOrigin)
    if (fwd) {
      const u = asRecord(fwd.user)
      if (u) {
        addTgId(u.id)
        addTgUser(u.username)
      }
      const c = asRecord(fwd.chat)
      if (c) {
        addTgId(c.chatId)
        addTgUser(c.username)
      }
    }
  } else if (provider === "whatsapp") {
    const addName = (n: unknown) => {
      if (typeof n !== "string") return
      const k = normalizeWhatsAppName(n)
      if (k) chatKeys.add(`whatsapp:${k}`)
    }
    addName(m.chatName)
    if (Array.isArray(m.authors)) m.authors.forEach(addName)
  } else if (provider === "gchat") {
    const space =
      (typeof m.spaceName === "string" && m.spaceName) ||
      (item.externalId?.startsWith("spaces/")
        ? item.externalId.split("/").slice(0, 2).join("/")
        : "")
    if (space) {
      const k = normalizeGchatSpace(space)
      if (k) chatKeys.add(k)
    }
  }

  return { emails: [...emails], chatKeys: [...chatKeys] }
}

// ── Matcher ───────────────────────────────────────────────────────────

function emailDomain(email: string): string {
  const at = email.lastIndexOf("@")
  return at >= 0 ? email.slice(at + 1) : ""
}

/**
 * First entry that excludes the probe, or null. ANY address / chat key on the
 * item is enough (see the rule at the top of this file). A domain entry
 * matches the address's domain and its subdomains.
 */
export function matchAnalysisExclusion(
  entries: readonly AnalysisExclusionEntry[],
  probe: ExclusionProbe,
): AnalysisExclusionEntry | null {
  if (entries.length === 0) return null
  const emails = probe.emails.map((e) => e.trim().toLowerCase()).filter(Boolean)
  const domains = emails.map(emailDomain).filter(Boolean)
  const chatKeys = new Set(probe.chatKeys)
  // WhatsApp names are case-insensitive; compare lower-cased.
  for (const k of probe.chatKeys) if (k.startsWith("whatsapp:")) chatKeys.add(k.toLowerCase())

  for (const e of entries) {
    const v = e.normalizedValue
    if (e.kind === "email") {
      if (emails.includes(v)) return e
    } else if (e.kind === "domain") {
      if (domains.some((d) => d === v || d.endsWith(`.${v}`))) return e
    } else if (e.kind === "chat") {
      if (chatKeys.has(v)) return e
    }
  }
  return null
}

/** Short reason stored on `source_item.parse_error` for an excluded item. */
export function exclusionReason(entry: AnalysisExclusionEntry): string {
  return `excluded: ${entry.kind} ${entry.normalizedValue}`
}

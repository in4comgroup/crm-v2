// Client-safe contract of documents (files) linked to CRM entities
// (docs/specs/attachments/01-specification.md). Value lists, Russian labels,
// limits, the API shapes, the PURE automatic-attribution planner (§4) and
// small file helpers. No DB, no server imports.

import { extractEmailDomain, extractWebsiteDomain, isFreemailDomain } from "@/lib/email-domain"

// ── Value lists ───────────────────────────────────────────────────────────

export const DOCUMENT_ENTITY_TYPES = ["client", "contact", "deal", "task", "order"] as const
export type DocumentEntityType = (typeof DOCUMENT_ENTITY_TYPES)[number]

export const DOCUMENT_ENTITY_LABELS_RU: Record<DocumentEntityType, string> = {
  client: "Компания",
  contact: "Контакт",
  deal: "Сделка",
  task: "Задача",
  order: "Заказ",
}

export function isDocumentEntityType(v: unknown): v is DocumentEntityType {
  return typeof v === "string" && (DOCUMENT_ENTITY_TYPES as readonly string[]).includes(v)
}

/** `source_item.external_type` values that are documents (Q2). */
export const DOCUMENT_ITEM_KINDS = ["attachment", "drive_file", "dropoff_file", "derived_audio"] as const

export const LINK_ORIGINS = [
  "manual",
  "upload",
  "auto_participant",
  "auto_topic",
  "auto_content",
  "auto_deal",
] as const
export type LinkOrigin = (typeof LINK_ORIGINS)[number]

export const LINK_ORIGIN_LABELS_RU: Record<LinkOrigin, string> = {
  manual: "Вручную",
  upload: "Загружен сюда",
  auto_participant: "авто · участник переписки",
  auto_topic: "авто · тема",
  auto_content: "авто · упомянут в документе",
  auto_deal: "авто · единственная открытая сделка компании",
}

export const isAutoOrigin = (o: string) => o.startsWith("auto_")

export type LinkConfidence = "high" | "medium"

export const FILE_STATUSES = ["stored", "not_stored", "too_large", "failed"] as const
export type FileStatus = (typeof FILE_STATUSES)[number]

/** Max stored / uploaded file (Q9: 50 MB). Analysis keeps the parser caps. */
export const DOCUMENT_MAX_BYTES = 50 * 1024 * 1024
/** Files per upload request. */
export const DOCUMENT_UPLOAD_MAX_FILES = 10

// ── Type buckets (list filter + icon) ─────────────────────────────────────

export const DOCUMENT_TYPE_BUCKETS = ["pdf", "image", "audio", "video", "office", "other"] as const
export type DocumentTypeBucket = (typeof DOCUMENT_TYPE_BUCKETS)[number]

export const DOCUMENT_TYPE_LABELS_RU: Record<DocumentTypeBucket, string> = {
  pdf: "PDF",
  image: "Изображения",
  audio: "Аудио",
  video: "Видео",
  office: "Office",
  other: "Другое",
}

const OFFICE_EXT = /\.(docx?|xlsx?|pptx?|odt|ods|odp|rtf|csv)$/i

/** PURE. Bucket of a file by mime type, falling back to the extension. */
export function documentTypeBucket(mime: string | null | undefined, name: string | null | undefined): DocumentTypeBucket {
  const m = (mime ?? "").toLowerCase()
  const n = name ?? ""
  if (m === "application/pdf" || /\.pdf$/i.test(n)) return "pdf"
  if (m.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|heic|svg)$/i.test(n)) return "image"
  if (m.startsWith("audio/") || /\.(mp3|m4a|wav|ogg|oga|aac|flac|opus)$/i.test(n)) return "audio"
  if (m.startsWith("video/") || /\.(mp4|mov|webm|mkv|avi)$/i.test(n)) return "video"
  if (
    m.includes("officedocument") ||
    m.includes("msword") ||
    m.includes("ms-excel") ||
    m.includes("ms-powerpoint") ||
    m.includes("opendocument") ||
    m === "text/csv" ||
    OFFICE_EXT.test(n)
  ) {
    return "office"
  }
  return "other"
}

/**
 * Mime types that may be served `inline` from our origin (Q7: the browser
 * shows them itself). Everything else — notably HTML / SVG / XML, which can
 * carry script — is always served as a download.
 */
export function isInlineSafeMime(mime: string | null | undefined): boolean {
  const m = (mime ?? "").toLowerCase().split(";")[0].trim()
  return (
    m === "application/pdf" ||
    m === "text/plain" ||
    ["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp"].includes(m) ||
    m.startsWith("audio/") ||
    m.startsWith("video/")
  )
}

/** «Открыть» in a new tab makes sense when the browser shows the type itself (Q7). */
export function opensInBrowser(bucket: DocumentTypeBucket, mime: string | null | undefined): boolean {
  return (bucket === "pdf" || bucket === "image" || bucket === "audio" || bucket === "video" || bucket === "other") && isInlineSafeMime(mime)
}

// ── File helpers ──────────────────────────────────────────────────────────

/** PURE. Safe object-key segment of a file name (keeps the extension). */
export function safeFileSegment(name: string | null | undefined): string {
  const base = (name ?? "file").normalize("NFKD").replace(/[^\w.\-]+/g, "_").replace(/_+/g, "_").replace(/^[._]+/, "")
  const cut = base.slice(-120)
  return cut || "file"
}

/**
 * PURE. `Content-Disposition` with the original (possibly Cyrillic) name:
 * an ASCII fallback + RFC 5987 `filename*`.
 */
export function contentDisposition(name: string | null | undefined, disposition: "inline" | "attachment"): string {
  const n = (name ?? "file").replace(/[\r\n"]/g, " ").trim() || "file"
  const ascii = n.replace(/[^\x20-\x7e]/g, "_").replace(/[\\%]/g, "_")
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(n)}`
}

/** PURE. «1,2 МБ» / «340 КБ» / «12 Б». */
export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return ""
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} МБ`
  if (bytes >= 1024) return `${Math.round(bytes / 1024).toLocaleString("ru-RU")} КБ`
  return `${bytes} Б`
}

// ── API shapes ────────────────────────────────────────────────────────────

export type DocumentLinkView = {
  id: string
  entityType: DocumentEntityType
  entityId: string
  /** Name of the linked entity (company / contact name, deal name, task title, order number). */
  entityLabel: string
  origin: LinkOrigin
  confidence: LinkConfidence
  reason: string | null
}

export type DocumentView = {
  /** `source_item.id`. */
  id: string
  name: string
  mime: string | null
  bucket: DocumentTypeBucket
  sizeBytes: number | null
  fileStatus: FileStatus | null
  /** Bytes are available for «Открыть» / «Скачать». */
  downloadable: boolean
  /** When the file was sent / created at the source (or uploaded). */
  date: string
  provider: string | null
  /** «Письмо от …», «Загружен: <имя>», «Google Drive» … */
  sourceLabel: string
  parseStatus: string
  /** Parser summary (1–3 sentences), null when not analysed. */
  summary: string | null
  /** Parsed text exists («Текст»). */
  hasText: boolean
  /** Why the file was not analysed (`parse_status` skipped / failed); null otherwise. */
  skipReason: DocumentSkipReason | null
  /** Links of this document that are not removed (all entities). */
  links: DocumentLinkView[]
  /** The link this list was loaded through (the entity of the view); null for related entities (Q11). */
  viaLinkId: string | null
  /** «Удалить файл» allowed (an upload, by its uploader or the org owner). */
  canDelete: boolean
}

export type DocumentsListResponse = {
  documents: DocumentView[]
  total: number
  /** Providers present in the list before paging / the source filter (for the «Источник» select). */
  providers: string[]
}

export type DocumentSkipReason = "too_large" | "unsupported" | "error" | "other"

export const DOCUMENT_SKIP_LABELS_RU: Record<DocumentSkipReason, string> = {
  too_large: "не проанализирован — слишком большой",
  unsupported: "не проанализирован — формат не поддерживается",
  error: "ошибка анализа",
  other: "не проанализирован",
}

/** PURE. Reason from `parse_status` + `parse_error` (parser messages are English). */
export function documentSkipReason(parseStatus: string, parseError: string | null | undefined): DocumentSkipReason | null {
  if (parseStatus === "failed") return "error"
  if (parseStatus !== "skipped") return null
  const e = (parseError ?? "").toLowerCase()
  if (/too large|exceeds|max(imum)? size|> ?\d+ ?mb/.test(e)) return "too_large"
  if (/unsupported|not supported|no parser|unknown type/.test(e)) return "unsupported"
  return "other"
}

/** Russian labels of source providers (the «Источник» filter). */
export const DOCUMENT_PROVIDER_LABELS_RU: Record<string, string> = {
  nylas: "Почта",
  imap: "Почта (IMAP)",
  gchat: "Google Chat",
  gdrive: "Google Drive",
  dropoff: "Загруженные файлы",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  aichat: "ИИ чат",
}

const EXT_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "text/markdown": "md",
  "text/csv": "csv",
  "text/plain": "txt",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "image/png": "png",
  "image/jpeg": "jpg",
}

/** PURE. The download name: adds an extension by mime when the name has none (e.g. a Google Docs export). */
export function downloadFileName(name: string | null | undefined, mime: string | null | undefined): string {
  const n = (name ?? "").trim() || "file"
  if (/\.[a-z0-9]{1,5}$/i.test(n)) return n
  const ext = EXT_BY_MIME[(mime ?? "").toLowerCase().split(";")[0].trim()]
  return ext ? `${n}.${ext}` : n
}

// ── Automatic attribution (spec §4) ───────────────────────────────────────

export type PlannedLink = {
  entityType: DocumentEntityType
  entityId: string
  origin: LinkOrigin
  confidence: LinkConfidence
  reason: string
}

/**
 * A1 roles: `sender` = author of the message; `recipient` = a recipient of
 * OUR outgoing message (the counterparty); `cc_sender_company` = a recipient
 * of an INBOUND message who belongs to the sender's company (same company
 * record or the same company mail domain) — medium.
 */
export type ParticipantRole = "sender" | "recipient" | "cc_sender_company"

export type AutoLinkParticipant = { contactId: string; clientId: string | null; role: ParticipantRole }

/**
 * PURE (bug list 2026-11-21, item 16). Which message participants may link a
 * document. Senders always (high). Recipients of our OWN outgoing message
 * (`outbound`) are the counterparties (high). Recipients of an INBOUND
 * message are linked only when they are from the sender's company — same
 * company record as a sender contact, or the same non-free-mail domain as a
 * sender address (the sender need not be a contact) — at medium. Anyone else
 * in «Кому» / «Копия» of an inbound message (our staff on private mail,
 * another company in copy) is not linked: being in copy says nothing about
 * the document.
 */
export function messageParticipants(input: {
  outbound: boolean
  /** Sender addresses that are not ours (contacts or not). */
  senderEmails: readonly string[]
  senders: readonly { contactId: string; clientId: string | null }[]
  recipients: readonly { email: string; contactId: string; clientId: string | null }[]
}): AutoLinkParticipant[] {
  const out: AutoLinkParticipant[] = input.senders.map((s) => ({ ...s, role: "sender" as const }))
  const senderClients = new Set(input.senders.map((s) => s.clientId).filter((c): c is string => !!c))
  const senderDomains = new Set(
    input.senderEmails.map((e) => extractEmailDomain(e)).filter((d) => d && !isFreemailDomain(d)),
  )
  for (const r of input.recipients) {
    if (out.some((p) => p.contactId === r.contactId)) continue
    if (input.outbound) {
      out.push({ contactId: r.contactId, clientId: r.clientId, role: "recipient" })
      continue
    }
    const domain = extractEmailDomain(r.email)
    const sameCompany = (!!r.clientId && senderClients.has(r.clientId)) || (!!domain && senderDomains.has(domain))
    if (sameCompany) out.push({ contactId: r.contactId, clientId: r.clientId, role: "cc_sender_company" })
  }
  return out
}

/**
 * PURE (A1b, 2026-11-21). Companies of the sender by MAIL DOMAIN when the
 * sender is not a contact: each non-free-mail sender domain that equals the
 * website host or the e-mail domain of EXACTLY ONE company → that company.
 * Our own domains must already be left out by the caller (the sender list
 * has no own addresses).
 */
export function clientsBySenderDomain(
  senderEmails: readonly string[],
  clients: readonly { id: string; webUrl: string | null; email: string | null }[],
): string[] {
  const domains = new Set(senderEmails.map((e) => extractEmailDomain(e)).filter((d) => d && !isFreemailDomain(d)))
  if (domains.size === 0) return []
  const strip = (d: string) => d.replace(/^www\./, "")
  const byDomain = new Map<string, Set<string>>()
  for (const c of clients) {
    for (const d of [c.webUrl ? extractWebsiteDomain(c.webUrl) : "", c.email ? extractEmailDomain(c.email) : ""]) {
      const k = strip(d)
      if (k && domains.has(k)) byDomain.set(k, (byDomain.get(k) ?? new Set()).add(c.id))
    }
  }
  const out: string[] = []
  for (const ids of byDomain.values()) if (ids.size === 1) out.push([...ids][0])
  return [...new Set(out)]
}

const PARTICIPANT_LINK: Record<ParticipantRole, { confidence: LinkConfidence; contact: string; client: string }> = {
  sender: { confidence: "high", contact: "отправитель сообщения", client: "компания отправителя" },
  recipient: { confidence: "high", contact: "получатель сообщения", client: "компания получателя" },
  cc_sender_company: { confidence: "medium", contact: "в копии, из компании отправителя", client: "компания отправителя" },
}

export type AutoLinkInput = {
  /** A1: contacts of the parent message, chosen by `messageParticipants` (never our staff). */
  participants: AutoLinkParticipant[]
  /** A1b: the sender's company by mail domain (`clientsBySenderDomain`), medium. */
  senderDomainClients?: string[]
  /** A2: topics of the item (or its parent) with their company / contact / deal. */
  topics: { topicTitle: string; clientId: string | null; contactId: string | null; dealId: string | null }[]
  /**
   * A3: companies named in the file content (exact match keys, unique hits).
   * People named in a file are NOT linked (bug list 2026-11-22: a staff list /
   * an interview names many people; a contact gets a file only as a sender /
   * recipient (A1) or through a topic (A2)).
   */
  contentClients: string[]
  /** A5: open (non-won / lost) deals per company. */
  openDealsByClient: Record<string, string[]>
  /** Every existing link of the item, INCLUDING removed ones (`removed: true`) — never re-added. */
  existing: { entityType: DocumentEntityType; entityId: string; removed: boolean }[]
}

/**
 * PURE. The automatic links to ADD for one document (spec §4, A1–A3 + A5).
 * Exact rules first (high), then medium ones; one link per entity (the first
 * rule wins); existing links — also removed ones (Q3: a person's removal is
 * final) — are never planned again. Deterministic order.
 */
export function planAutoLinks(input: AutoLinkInput): PlannedLink[] {
  const out: PlannedLink[] = []
  const seen = new Set(input.existing.map((e) => `${e.entityType}:${e.entityId}`))
  const add = (p: PlannedLink) => {
    const k = `${p.entityType}:${p.entityId}`
    if (seen.has(k)) return
    seen.add(k)
    out.push(p)
  }
  // A1 — participants (high; a copy from the sender's company: medium).
  for (const p of input.participants) {
    const rule = PARTICIPANT_LINK[p.role]
    add({ entityType: "contact", entityId: p.contactId, origin: "auto_participant", confidence: rule.confidence, reason: rule.contact })
    if (p.clientId) {
      add({ entityType: "client", entityId: p.clientId, origin: "auto_participant", confidence: rule.confidence, reason: rule.client })
    }
  }
  // A1b — the sender's company by mail domain (medium).
  for (const id of input.senderDomainClients ?? []) {
    add({ entityType: "client", entityId: id, origin: "auto_participant", confidence: "medium", reason: "компания отправителя (по домену почты)" })
  }
  // A2 — topics (high).
  for (const t of input.topics) {
    const reason = `тема «${t.topicTitle}»`
    if (t.dealId) add({ entityType: "deal", entityId: t.dealId, origin: "auto_topic", confidence: "high", reason })
    if (t.clientId) add({ entityType: "client", entityId: t.clientId, origin: "auto_topic", confidence: "high", reason })
    if (t.contactId) add({ entityType: "contact", entityId: t.contactId, origin: "auto_topic", confidence: "high", reason })
  }
  // A3 — named in the file content (medium).
  for (const id of input.contentClients) {
    add({ entityType: "client", entityId: id, origin: "auto_content", confidence: "medium", reason: "компания упомянута в документе" })
  }
  // A5 — the company's ONLY open deal (medium), for every linked company
  // without a deal link from A2.
  const hasDeal = out.some((p) => p.entityType === "deal") || input.existing.some((e) => e.entityType === "deal" && !e.removed)
  if (!hasDeal) {
    const companies = [
      ...new Set([
        ...out.filter((p) => p.entityType === "client").map((p) => p.entityId),
        ...input.existing.filter((e) => e.entityType === "client" && !e.removed).map((e) => e.entityId),
      ]),
    ]
    for (const c of companies) {
      const deals = input.openDealsByClient[c] ?? []
      if (deals.length === 1) {
        add({ entityType: "deal", entityId: deals[0], origin: "auto_deal", confidence: "medium", reason: "единственная открытая сделка компании" })
      }
    }
  }
  return out
}

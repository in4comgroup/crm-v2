// AI chat actions — shared contract + PURE checks (docs/specs/ai-chat-tools
// §7–§8, phase T1). Client-safe: used by the draft tools (server), the
// confirm route and the draft card (browser).
//
// The model only PROPOSES values. Every value is checked here against the
// user's own input (their messages + the parsed text of their files) —
// a value that is not there is removed and shown struck through (§8.2).

import { z } from "zod"
import { searchNormalise } from "@/lib/entity-search"
import { extractEmailDomain, extractWebsiteDomain, isFreemailDomain } from "@/lib/email-domain"
import { normalisePhone, normaliseTelegramHandle } from "@/lib/identity/registry"
import { isLocalDateTime, localToUtc, resolveDueText, utcToLocal } from "@/lib/chat/due-date"
import { companyMatchKey } from "@/lib/translit-ru"
import { parseMoneyRu } from "@/lib/ru-mail/money"

// ── Kinds, statuses ─────────────────────────────────────────────────────

export const ACTION_KINDS = ["company", "contact", "company_contact", "task", "tasks", "deal", "update", "link", "order_request", "deal_move", "task_update", "group"] as const
export type ActionKind = (typeof ACTION_KINDS)[number]

// `confirming` = a confirm request is running (guards a double click).
export const ACTION_STATUSES = ["draft", "needs_input", "confirming", "created", "partly_created", "cancelled", "expired", "failed"] as const
export type ActionStatus = (typeof ACTION_STATUSES)[number]

/** Statuses in which the card can still be confirmed. */
export function isOpenActionStatus(s: string): boolean {
  return s === "draft" || s === "needs_input"
}

export const ACTION_KIND_TITLES: Record<ActionKind, string> = {
  company: "Новая компания",
  contact: "Новый контакт",
  company_contact: "Компания и контакт",
  task: "Новая задача",
  tasks: "Задачи",
  deal: "Новая сделка",
  update: "Дополнить запись",
  link: "Связать записи",
  order_request: "Заказ из запроса",
  deal_move: "Перевести сделку",
  task_update: "Изменить задачу",
  group: "Новые записи",
}

/** §8.5 limits. */
export const ACTION_LIMITS = {
  draftsPerTurn: 10,
  createsPerHour: 30,
  draftTtlDays: 7,
  itemsPerAction: 12,
} as const

// ── Values ──────────────────────────────────────────────────────────────

export type CompanyValues = {
  name: string
  aliases: string[]
  website: string
  email: string
  phone: string
  address: string
  comment: string
}

export type ContactValues = {
  name: string
  nameNative: string
  position: string
  /** First = `contact.email`, others → extra addresses. */
  emails: string[]
  /** First = `contact.phone`, others → extra addresses. */
  phones: string[]
  /** Handle without «@». */
  telegram: string
  /** An existing company of the org. */
  companyId: string | null
  /** A company item of the same card (draft). */
  companyKey: string | null
  /** Display name of the chosen company. */
  companyName: string
}

export const TASK_TYPES = ["meet", "call", "email", "offer", "docs", "support", "other"] as const
export type ChatTaskType = (typeof TASK_TYPES)[number]
export const TASK_PRIORITIES = ["low", "medium", "high"] as const
export type ChatTaskPriority = (typeof TASK_PRIORITIES)[number]

export type TaskValues = {
  /** Verb first, ≤ 8 words («Отправить КП Вектору»). */
  title: string
  description: string
  type: ChatTaskType
  priority: ChatTaskPriority
  /** Org-local «YYYY-MM-DDTHH:MM» (src/lib/chat/due-date.ts); "" = not known → ask. */
  dueDate: string
  /** The user's words for the deadline («до пятницы»). */
  dueText: string
  /** A human member of the org; null = ambiguous / unknown → ask. */
  assigneeId: string | null
  assigneeName: string
  companyId: string | null
  companyKey: string | null
  companyName: string
  contactId: string | null
  contactKey: string | null
  contactName: string
  dealId: string | null
  /** A deal of the same card (draft). */
  dealKey: string | null
  dealName: string
  /** «Записать встречу» (T4): a past meeting / call stored as done; `dueDate` = when it happened (may be in the past). */
  done: boolean
}

/** One change of «Дополнить» — only an EMPTY field, a new extra address or a new alias (Q3: never overwrite). */
export type FillChange = {
  field: "phone" | "email" | "website" | "address" | "alias" | "position" | "nameNative" | "extraPhone" | "extraEmail" | "telegram"
  /** Russian: «Телефон», «Доп. e-mail», «Другое название» … */
  label: string
  value: string
}

/** «Дополнить запись» (T4): what will be added to an existing company / contact. */
export type UpdateValues = {
  targetType: "client" | "contact"
  targetId: string
  targetName: string
  changes: FillChange[]
}

/** «Связать записи» (T4): an existing contact ↔ an existing company and / or deal. */
export type LinkValues = {
  contactId: string | null
  contactName: string
  clientId: string | null
  clientName: string
  /** The company becomes the contact's main company (else: one more current company). */
  primary: boolean
  dealId: string | null
  dealName: string
}

export type DealValues = {
  /** «<Компания> — <предмет>». */
  name: string
  /** What was agreed (short list) — the model's words. */
  description: string
  companyId: string | null
  companyKey: string | null
  companyName: string
  /** Existing contacts / contacts of the same card. */
  contactIds: string[]
  contactKeys: string[]
  contactNames: string[]
  /** Amount as digits («2000000»); "" = not stated. */
  value: string
  /** The user's words for the amount («бюджет ~2 млн»). */
  valueText: string
  /** RUB / USD / EUR / CNY from the words; "" = the company's currency. */
  currency: string
  dealTypeId: string | null
  dealTypeName: string
  stageId: string | null
  stageName: string
  /** «по правилу воронки: …» when the org's stage rules chose the stage / type (readSignals). */
  ruleNote: string
}

/** «Заказ из запроса» (T5): the client's request text → the existing order-from-request wizard. */
export type OrderRequestValues = {
  clientId: string | null
  /** A company of the same card (draft). */
  companyKey: string | null
  clientName: string
  /** The client's request copied exactly from the input (a message / a mail / a file). */
  requestText: string
  comment: string
}

/** «Перевести сделку» (T5): another stage, or won / lost with the funnel's reason. */
export type DealMoveValues = {
  dealId: string
  dealName: string
  fromStageName: string
  stageId: string | null
  stageName: string
  /** Role of the target stage: won / lost need the outcome rules. */
  outcome: "won" | "lost" | null
  /** Lost: a code of the org's lost-reason list (required). */
  reasonCode: string
  reasonText: string
}

/** «Изменить задачу» (T5): mark done, or a new due date. */
export type TaskUpdateValues = {
  taskId: string
  taskTitle: string
  action: "done" | "reschedule"
  /** Reschedule: org-local «YYYY-MM-DDTHH:MM». */
  dueDate: string
  dueText: string
  /** The current due date (org-local), for the card. */
  currentDue: string
}

export type ItemType = "company" | "contact" | "task" | "deal" | "update" | "link" | "order_request" | "deal_move" | "task_update"

/** Where a value came from — shown as a hint next to the field. */
export type FieldSource = "input" | "file" | "page" | "default" | "model" | "rule"
export type FieldMeta = { source: FieldSource; fileName?: string; fileId?: string }

export const FIELD_SOURCE_LABELS: Record<FieldSource, string> = {
  input: "из сообщения",
  file: "из файла",
  page: "со страницы",
  default: "по умолчанию",
  model: "текст ИИ",
  rule: "по правилу воронки",
}

export type MatchKind = "exact" | "similar" | "deleted"
export type DraftMatch = {
  kind: MatchKind
  type: "client" | "contact" | "deal"
  id: string
  title: string
  subtitle?: string
  /** Russian: «совпадает телефон», «похожее название» … */
  reason: string
  /** What «Дополнить существующий» would add to this record (T4, exact matches only; empty = nothing new). */
  fill?: FillChange[]
}

export type RemovedValue = { field: string; value: string; reason: string }

export type DraftItem = {
  /** Stable within the action: c1, c2 … (companies), p1, p2 … (contacts). */
  key: string
  type: ItemType
  values: CompanyValues | ContactValues | TaskValues | DealValues | UpdateValues | LinkValues | OrderRequestValues | DealMoveValues | TaskUpdateValues
  meta: Record<string, FieldMeta>
  removed: RemovedValue[]
  matches: DraftMatch[]
  /** Required fields that are empty (field keys; «companyOrChannel» for a contact). */
  missing: string[]
  /** «Это ваша организация …» / blocklist — the item cannot be created. */
  refused: string | null
}

export type ChatDraft = {
  items: DraftItem[]
  /** Chat files (source items) of the thread the values came from. */
  files: { itemId: string; name: string }[]
}

export type ActionResult = {
  type: "client" | "contact" | "task" | "deal" | "order_request"
  id: string
  title: string
  href: string
  /** An existing record was used / restored (not created). */
  existing?: boolean
  restored?: boolean
  /** «Дополнить» added data to the existing record (T4). */
  updated?: boolean
  /** «Связать» linked the existing records (T4). */
  linked?: boolean
  /** «Перевести сделку» moved the deal (T5). */
  moved?: boolean
}

/** `data-draft` part (id = action id). The card re-reads the row by id. */
export type ChatDraftPart = {
  actionId: string
  kind: ActionKind
  status: ActionStatus
  draft: ChatDraft
  results?: ActionResult[]
  error?: string | null
  /** For task items: the org's human members (assignee picker) and the org time zone of `dueDate`. */
  options?: ActionOptions
}

export type ActionOptions = {
  members: { id: string; name: string }[]
  timeZone: string
  /** Deal items: working stages of the org funnel (area0 / won / lost left out) and the deal types. */
  stages?: { id: string; name: string }[]
  dealTypes?: { id: string; name: string }[]
  /** Deal moves (T5): every visible stage of the funnel with its role, and the org's lost reasons. */
  allStages?: { id: string; name: string; role: string }[]
  lostReasons?: { code: string; label: string }[]
}

/** `data-action-result` part, added to the assistant message after confirm. */
export type ChatActionResultPart = {
  actionId: string
  status: ActionStatus
  results: ActionResult[]
}

export const COMPANY_FIELD_LABELS: Record<keyof CompanyValues, string> = {
  name: "Название",
  aliases: "Другие названия",
  website: "Сайт",
  email: "E-mail",
  phone: "Телефон",
  address: "Адрес",
  comment: "Комментарий",
}

export const CONTACT_FIELD_LABELS: Record<Exclude<keyof ContactValues, "companyId" | "companyKey">, string> = {
  name: "Имя",
  nameNative: "Имя (другое написание)",
  position: "Должность",
  emails: "E-mail",
  phones: "Телефоны",
  telegram: "Telegram",
  companyName: "Компания",
}

export const TASK_FIELD_LABELS: Record<"title" | "description" | "type" | "priority" | "dueDate" | "assigneeName" | "companyName" | "contactName" | "dealName", string> = {
  title: "Задача",
  description: "Описание",
  type: "Тип",
  priority: "Приоритет",
  dueDate: "Срок",
  assigneeName: "Исполнитель",
  companyName: "Компания",
  contactName: "Контакт",
  dealName: "Сделка",
}

export const DEAL_FIELD_LABELS: Record<"name" | "description" | "companyName" | "contactNames" | "value" | "dealTypeName" | "stageName", string> = {
  name: "Название сделки",
  description: "Что обсудили",
  companyName: "Компания",
  contactNames: "Контакты",
  value: "Сумма",
  dealTypeName: "Тип сделки",
  stageName: "Стадия",
}

export const MISSING_LABELS: Record<string, string> = {
  client: "Укажите компанию клиента",
  requestText: "Нет текста запроса клиента",
  reason: "Выберите причину проигрыша",
  changes: "Нечего добавлять — всё уже есть в записи",
  contact: "Укажите контакт",
  target: "Укажите компанию или сделку",
  company: "Укажите компанию сделки",
  stage: "Выберите стадию",
  name: "Укажите название / имя",
  title: "Укажите, что нужно сделать",
  dueDate: "Укажите срок",
  assignee: "Выберите исполнителя",
  companyOrChannel: "Укажите компанию или хотя бы один телефон, e-mail или Telegram",
}

export function emptyCompanyValues(): CompanyValues {
  return { name: "", aliases: [], website: "", email: "", phone: "", address: "", comment: "" }
}

export function emptyContactValues(): ContactValues {
  return {
    name: "",
    nameNative: "",
    position: "",
    emails: [],
    phones: [],
    telegram: "",
    companyId: null,
    companyKey: null,
    companyName: "",
  }
}

/** Name of a company / contact, title of a task. */
export function itemLabel(item: Pick<DraftItem, "type" | "values">): string {
  if (item.type === "task") return (item.values as TaskValues).title
  if (item.type === "update") return (item.values as UpdateValues).targetName
  if (item.type === "order_request") return `Запрос клиента «${(item.values as OrderRequestValues).clientName || "—"}»`
  if (item.type === "deal_move") return (item.values as DealMoveValues).dealName
  if (item.type === "task_update") return (item.values as TaskUpdateValues).taskTitle
  if (item.type === "link") {
    const l = item.values as LinkValues
    return [l.contactName, l.clientName || l.dealName].filter(Boolean).join(" ↔ ")
  }
  return (item.values as CompanyValues | ContactValues | DealValues).name
}

export const ITEM_TYPE_WORDS: Record<ItemType, string> = {
  company: "компания",
  contact: "контакт",
  task: "задача",
  deal: "сделка",
  update: "дополнение",
  link: "связь",
  order_request: "запрос клиента",
  deal_move: "перевод сделки",
  task_update: "изменение задачи",
}

/** Required fields of an item (§8.4, Q8). */
export function missingFields(item: Pick<DraftItem, "type" | "values">): string[] {
  const out: string[] = []
  if (item.type === "task") {
    const t = item.values as TaskValues
    if (!t.title.trim()) out.push("title")
    if (!t.dueDate) out.push("dueDate")
    if (!t.assigneeId) out.push("assignee")
    return out
  }
  if (item.type === "update") {
    if (!(item.values as UpdateValues).changes.length) out.push("changes")
    return out
  }
  if (item.type === "order_request") {
    const o = item.values as OrderRequestValues
    if (!o.clientId && !o.companyKey) out.push("client")
    if (!o.requestText.trim()) out.push("requestText")
    return out
  }
  if (item.type === "deal_move") {
    const m = item.values as DealMoveValues
    if (!m.stageId) out.push("stage")
    if (m.outcome === "lost" && !m.reasonCode) out.push("reason")
    return out
  }
  if (item.type === "task_update") {
    const u = item.values as TaskUpdateValues
    if (u.action === "reschedule" && !u.dueDate) out.push("dueDate")
    return out
  }
  if (item.type === "link") {
    const l = item.values as LinkValues
    if (!l.contactId) out.push("contact")
    if (!l.clientId && !l.dealId) out.push("target")
    return out
  }
  if (item.type === "deal") {
    const d = item.values as DealValues
    if (!d.name.trim()) out.push("name")
    if (!d.companyId && !d.companyKey) out.push("company")
    if (!d.stageId) out.push("stage")
    return out
  }
  if (!(item.values as CompanyValues | ContactValues).name.trim()) out.push("name")
  if (item.type === "contact") {
    const v = item.values as ContactValues
    const hasCompany = !!(v.companyId || v.companyKey)
    const hasChannel = v.emails.some((e) => e.trim()) || v.phones.some((p) => p.trim()) || !!v.telegram.trim()
    if (!hasCompany && !hasChannel) out.push("companyOrChannel")
  }
  return out
}

// ── Normalisation (§8.1) ────────────────────────────────────────────────

export function cleanEmail(raw: string): string {
  const v = (raw ?? "").trim().toLowerCase().replace(/^mailto:/, "")
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : ""
}

export function cleanWebsite(raw: string): string {
  const host = extractWebsiteDomain((raw ?? "").trim())
  return host && host.includes(".") ? host : ""
}

export function cleanTelegram(raw: string): string {
  const h = normaliseTelegramHandle(raw).toLowerCase()
  return /^[a-z][a-z0-9_]{3,31}$/.test(h) ? h : ""
}

export function phoneKey(raw: string): string {
  return normalisePhone(raw)
}

/** «+7 999 999 99 99», «000-00-00» — a filler an OCR / model writes for an unreadable number, not a real one. */
export function isPlaceholderPhone(raw: string): boolean {
  return /(\d)\1{6,}/.test(phoneKey(raw))
}

const PLACEHOLDER = "похоже на заполнитель, а не на настоящий номер"

export function cleanText(raw: unknown, max = 500): string {
  return typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, max) : ""
}

/** Unique non-empty strings (by a key). */
export function uniqueBy(values: string[], key: (v: string) => string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of values) {
    const k = key(v)
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(v)
  }
  return out
}

/** Company web domain from an e-mail (never a free-mail domain). */
export function companyDomainOfEmail(email: string): string {
  const d = extractEmailDomain(email)
  return d && !isFreemailDomain(d) ? d : ""
}

// ── Grounding (§8.2) ────────────────────────────────────────────────────

const LEGAL_FORMS = new Set([
  "ooo", "oao", "zao", "pao", "ao", "nao", "ip", "gup", "mup", "fgup", "nko", "ano",
  "llc", "ltd", "inc", "corp", "co", "gmbh", "ag", "sa", "srl", "bv", "plc", "kg", "oy", "ab",
])

export type InputIndex = {
  /** Lower-case raw text (e-mails, hosts, handles). */
  lower: string
  /** Search V2 tokens (translit + unaccent + lower). */
  tokens: string[]
  /** Phone keys found in the text. */
  phones: string[]
}

const PHONE_RUN = /\+?\d[\d\s()\-–—.]{5,}\d/g

export function buildInputIndex(text: string): InputIndex {
  const raw = text ?? ""
  const phones = new Set<string>()
  for (const m of raw.match(PHONE_RUN) ?? []) {
    const k = normalisePhone(m)
    if (k) phones.add(k)
  }
  return {
    lower: raw.toLowerCase(),
    tokens: [...new Set(searchNormalise(raw).split(" ").filter(Boolean))],
    phones: [...phones],
  }
}

/** Same word, allowing Russian endings («Петров» ≈ «Петровым»). Numbers must be equal. */
function stemMatch(a: string, b: string): boolean {
  if (a === b) return true
  if (/\d/.test(a) || /\d/.test(b)) return false
  let p = 0
  while (p < a.length && p < b.length && a[p] === b[p]) p++
  return p >= 4 && p >= Math.min(a.length, b.length) - 2
}

function tokensOf(value: string, dropLegal: boolean): string[] {
  return searchNormalise(value)
    .split(" ")
    .filter((t) => t && (t.length >= 2 || /\d/.test(t)))
    .filter((t) => !dropLegal || !LEGAL_FORMS.has(t))
}

export function groundEmail(email: string, idx: InputIndex): boolean {
  const e = cleanEmail(email)
  return !!e && idx.lower.includes(e)
}

/** The host written as a website — not only as the domain of an e-mail («p@romashka.ru» does not ground «romashka.ru»). */
export function groundWebsite(host: string, idx: InputIndex): boolean {
  const h = cleanWebsite(host)
  if (!h) return false
  const esc = h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`(^|[^a-z0-9@.\\-])(www\\.)?${esc}(?![a-z0-9-])`).test(idx.lower)
}

export function groundTelegram(handle: string, idx: InputIndex): boolean {
  const h = cleanTelegram(handle)
  return !!h && idx.lower.includes(h)
}

export function groundPhone(phone: string, idx: InputIndex): boolean {
  const k = phoneKey(phone)
  if (!k) return false
  return idx.phones.some((c) => c === k || (c.length >= 10 && k.endsWith(c)) || (k.length >= 10 && c.endsWith(k)))
}

/** A name: every word (legal forms left out) is in the input — any script. */
export function groundName(name: string, idx: InputIndex): boolean {
  const toks = tokensOf(name, true)
  if (!toks.length) return false
  return toks.every((t) => idx.tokens.some((i) => stemMatch(t, i)))
}

/** Free text (address, position): ≥ `ratio` of its words and every number are in the input. */
export function groundText(value: string, idx: InputIndex, ratio = 0.75): boolean {
  const toks = tokensOf(value, false)
  if (!toks.length) return false
  let hit = 0
  for (const t of toks) {
    const ok = idx.tokens.some((i) => stemMatch(t, i))
    if (!ok && /\d/.test(t)) return false
    if (ok) hit++
  }
  return hit / toks.length >= ratio
}

/** The user's input of a turn: their messages + the parsed text of each file. */
export type InputSources = {
  text: InputIndex
  /** `unclear` = the parser marked text as «[неразборчиво]» (a blurred photo). */
  files: { itemId: string; name: string; idx: InputIndex; unclear?: boolean }[]
}

/** The image parser writes «[неразборчиво]» for text it cannot read. */
export function isUnclearText(text: string): boolean {
  return /неразборчив|illegible|unreadable/i.test(text ?? "")
}

/** Where a value is found (user text first, then readable files, then unclear ones), or null = ungrounded. */
export function findSource(sources: InputSources, test: (idx: InputIndex) => boolean): (FieldMeta & { unclear?: boolean }) | null {
  if (test(sources.text)) return { source: "input" }
  for (const f of [...sources.files.filter((x) => !x.unclear), ...sources.files.filter((x) => x.unclear)]) {
    if (test(f.idx)) return { source: "file", fileName: f.name, fileId: f.itemId, ...(f.unclear ? { unclear: true } : {}) }
  }
  return null
}

const UNCLEAR = "фото нечёткое — проверьте значение и введите его вручную"

const NOT_IN_INPUT = "нет в тексте сообщения или файла"

type Grounded<T> = { values: T; meta: Record<string, FieldMeta>; removed: RemovedValue[] }

/** Raw company values from the model → checked values (§8.1–§8.2). */
export function groundCompany(raw: Partial<Record<keyof CompanyValues, unknown>>, sources: InputSources): Grounded<CompanyValues> {
  const values = emptyCompanyValues()
  const meta: Record<string, FieldMeta> = {}
  const removed: RemovedValue[] = []
  const CHANNELS = new Set(["website", "email", "phone"])
  const keep = <K extends keyof CompanyValues>(field: K, value: string, test: (idx: InputIndex) => boolean, reason = NOT_IN_INPUT) => {
    if (!value) return false
    const src = findSource(sources, test)
    if (!src || (src.unclear && CHANNELS.has(field))) {
      removed.push({ field, value, reason: src ? UNCLEAR : reason })
      return false
    }
    meta[field] = { source: src.source, fileName: src.fileName, fileId: src.fileId }
    return true
  }
  const name = cleanText(raw.name, 200)
  if (keep("name", name, (i) => groundName(name, i))) values.name = name
  const aliases = Array.isArray(raw.aliases) ? raw.aliases.map((a) => cleanText(a, 200)).filter(Boolean) : []
  values.aliases = uniqueBy(aliases, (a) => searchNormalise(a)).filter((a) => {
    if (findSource(sources, (i) => groundName(a, i))) return true
    removed.push({ field: "aliases", value: a, reason: NOT_IN_INPUT })
    return false
  }).filter((a) => searchNormalise(a) !== searchNormalise(values.name))
  if (values.aliases.length) meta.aliases = findSource(sources, (i) => groundName(values.aliases[0], i)) ?? { source: "input" }

  const site = cleanText(raw.website, 300)
  const host = cleanWebsite(site)
  if (site && !host) removed.push({ field: "website", value: site, reason: "неверный адрес сайта" })
  else if (host && isFreemailDomain(host)) removed.push({ field: "website", value: site, reason: "почтовый сервис — не сайт компании" })
  else if (keep("website", host, (i) => groundWebsite(host, i))) values.website = host

  const email = cleanEmail(cleanText(raw.email, 200))
  if (keep("email", email, (i) => groundEmail(email, i))) values.email = email
  const phone = cleanText(raw.phone, 60)
  if (phone && !phoneKey(phone)) removed.push({ field: "phone", value: phone, reason: "неверный номер" })
  else if (phone && isPlaceholderPhone(phone)) removed.push({ field: "phone", value: phone, reason: PLACEHOLDER })
  else if (keep("phone", phone, (i) => groundPhone(phone, i))) values.phone = phone
  const address = cleanText(raw.address, 300)
  if (keep("address", address, (i) => groundText(address, i))) values.address = address
  // Comment = the model's short summary of the context; marked as AI text.
  const comment = cleanText(raw.comment, 500)
  if (comment) {
    values.comment = comment
    meta.comment = { source: "model" }
  }
  return { values, meta, removed }
}

/** Raw contact values from the model → checked values (company is resolved by the server). */
export function groundContact(
  raw: Partial<Record<"name" | "nameNative" | "position" | "telegram", unknown>> & { emails?: unknown; phones?: unknown },
  sources: InputSources,
): Grounded<ContactValues> {
  const values = emptyContactValues()
  const meta: Record<string, FieldMeta> = {}
  const removed: RemovedValue[] = []
  const name = cleanText(raw.name, 200)
  if (name) {
    const src = findSource(sources, (i) => groundName(name, i))
    if (src) {
      values.name = name
      meta.name = src
    } else removed.push({ field: "name", value: name, reason: NOT_IN_INPUT })
  }
  const native = cleanText(raw.nameNative, 200)
  if (native && searchNormalise(native) !== searchNormalise(values.name)) {
    const src = findSource(sources, (i) => groundName(native, i))
    if (src) {
      values.nameNative = native
      meta.nameNative = src
    } else removed.push({ field: "nameNative", value: native, reason: NOT_IN_INPUT })
  }
  const position = cleanText(raw.position, 200)
  if (position) {
    const src = findSource(sources, (i) => groundText(position, i, 0.6))
    if (src) {
      values.position = position
      meta.position = src
    } else removed.push({ field: "position", value: position, reason: NOT_IN_INPUT })
  }
  const list = (v: unknown) => (Array.isArray(v) ? v : typeof v === "string" ? [v] : []).map((x) => cleanText(x, 200)).filter(Boolean)
  for (const e of uniqueBy(list(raw.emails), cleanEmail)) {
    const src = findSource(sources, (i) => groundEmail(e, i))
    if (src && !src.unclear) {
      values.emails.push(cleanEmail(e))
      meta.emails ??= src
    } else removed.push({ field: "emails", value: e, reason: src ? UNCLEAR : NOT_IN_INPUT })
  }
  for (const p of list(raw.phones)) {
    if (!phoneKey(p)) {
      removed.push({ field: "phones", value: p, reason: "неверный номер" })
      continue
    }
    if (isPlaceholderPhone(p)) {
      removed.push({ field: "phones", value: p, reason: PLACEHOLDER })
      continue
    }
    if (values.phones.some((x) => phoneKey(x) === phoneKey(p))) continue
    const src = findSource(sources, (i) => groundPhone(p, i))
    if (src && !src.unclear) {
      values.phones.push(p)
      meta.phones ??= src
    } else removed.push({ field: "phones", value: p, reason: src ? UNCLEAR : NOT_IN_INPUT })
  }
  const tg = cleanText(raw.telegram, 100)
  if (tg) {
    const h = cleanTelegram(tg)
    if (!h) removed.push({ field: "telegram", value: tg, reason: "неверный Telegram" })
    else {
      const src = findSource(sources, (i) => groundTelegram(h, i))
      if (src && !src.unclear) {
        values.telegram = h
        meta.telegram = src
      } else removed.push({ field: "telegram", value: tg, reason: src ? UNCLEAR : NOT_IN_INPUT })
    }
  }
  return { values, meta, removed }
}

// ── The user's own request (§14: prompt injection) ─────────────────────

/**
 * Does the user's latest message itself ask to add / create / remind? Quoted
 * text («…», "…", lines starting with «>») is left out — a request inside a
 * mail the user pastes for a summary is not the user's request. A message of
 * only files (a business card photo) counts as a request.
 */
export function userAsksForRecord(text: string, hasFiles: boolean): boolean {
  const own = (text ?? "")
    .replace(/«[\s\S]*»/g, " ")
    .replace(/"[\s\S]*"/g, " ")
    .replace(/“[\s\S]*”/g, " ")
    .split("\n")
    .filter((l) => !l.trim().startsWith(">"))
    .join("\n")
    .toLowerCase()
  if (!own.trim()) return hasFiles
  // Whole verb forms only: «поставщика» must not read as «поставь».
  const verb =
    /(?<![а-яё])(добав(ь|ьте|ить|и)|созда(й|йте|ть)|сохран(и|ите|ить)|внес(и|ите|ти)|запиш(и|ите)|записать|запомн(и|ите)|напомн(и|ите)|постав(ь|ьте|ить)|завед(и|ите)|завести|оформ(и|ите|ить)|сделай(те)?|свяж(и|ите)|связать|привяж(и|ите)|привязать|дополн(и|ите)|дополнить|обнов(и|ите)|обновить|перешел|перешёл|перешла|переведи|перевести|перенеси|перенести|отметь|закрой|выполнен[аоы]?|проиграли|выиграли|проиграна|выиграна)(?![а-яё])/
  return (
    verb.test(own) ||
    /теперь\s+работает|визитк|нов\S*\s+(клиент|контакт|компан|партн)|в\s*crm|\bcrm\b|\badd\b|\bcreate\b|\bsave\b|remind/.test(own)
  )
}

// ── Assignee (§10) ──────────────────────────────────────────────────────

const ME_WORDS = new Set(["я", "мне", "меня", "мной", "себе", "себя", "me", "myself", "i"])

/** «мне», «я», «me», empty → the signed-in user. */
export function isMeWord(raw: string): boolean {
  const t = (raw ?? "").trim().toLowerCase().replace(/[«»"'.!]/g, "")
  return !t || ME_WORDS.has(t)
}

/** Name word forms: «Анне» ≈ «Анна», «Петрову» ≈ «Петров» (any script). */
function nameTokenMatch(a: string, b: string): boolean {
  if (stemMatch(a, b)) return true
  let p = 0
  while (p < a.length && p < b.length && a[p] === b[p]) p++
  return p >= 3 && p >= Math.min(a.length, b.length) - 1
}

/** Every word of `query` is a word of `name` (forms allowed): «Анне» → «Анна Иванова», «Ivanova» → «Анна Иванова». */
export function nameMatches(query: string, name: string): boolean {
  const q = tokensOf(query, false)
  const n = tokensOf(name, false)
  return q.length > 0 && q.every((t) => n.some((x) => nameTokenMatch(t, x)))
}

/** The members a name in the input refers to (0, 1 or several). */
export function matchMembers<T extends { name: string; email?: string }>(query: string, members: T[]): T[] {
  const q = (query ?? "").trim()
  if (!q) return []
  const byMail = members.filter((m) => m.email && m.email.toLowerCase() === q.toLowerCase())
  if (byMail.length) return byMail
  return members.filter((m) => nameMatches(q, m.name))
}

// ── «Дополнить существующий» (T4, Q3: only empty fields, new addresses, new aliases) ──

export type ExistingClient = { name: string; aliases: string[]; phone: string | null; email: string | null; webUrl: string | null; address: string | null }
export type ExistingContact = {
  name: string
  nameNative: string | null
  aliases: string[]
  phone: string | null
  email: string | null
  position: string | null
  /** Extra addresses (normalised: e-mail lower-case, phone digits, telegram handle). */
  extra: { kind: string; value: string }[]
}

const FILL_LABELS: Record<FillChange["field"], string> = {
  phone: "Телефон",
  email: "E-mail",
  website: "Сайт",
  address: "Адрес",
  alias: "Другое название",
  position: "Должность",
  nameNative: "Имя (другое написание)",
  extraPhone: "Доп. телефон",
  extraEmail: "Доп. e-mail",
  telegram: "Telegram",
}

const change = (field: FillChange["field"], value: string): FillChange => ({ field, label: FILL_LABELS[field], value })

/** What a company draft would ADD to an existing company: only empty fields + new names. */
export function companyFill(existing: ExistingClient, v: Partial<CompanyValues>): FillChange[] {
  const out: FillChange[] = []
  const blank = (x: string | null) => !(x ?? "").trim()
  if (v.phone && blank(existing.phone)) out.push(change("phone", v.phone))
  const email = cleanEmail(v.email ?? "")
  if (email && blank(existing.email)) out.push(change("email", email))
  const site = cleanWebsite(v.website ?? "")
  if (site && blank(existing.webUrl)) out.push(change("website", site))
  if (v.address && blank(existing.address)) out.push(change("address", v.address))
  const known = new Set([existing.name, ...existing.aliases].map(companyMatchKey).filter(Boolean))
  for (const n of [v.name ?? "", ...(v.aliases ?? [])].map((x) => x.trim()).filter(Boolean)) {
    const k = companyMatchKey(n)
    if (k && !known.has(k) && searchNormalise(n) !== searchNormalise(existing.name)) {
      known.add(k)
      out.push(change("alias", n))
    }
  }
  return out
}

/** What a contact draft would ADD to an existing contact: empty fields, new phones / e-mails as extra addresses, a new Telegram. */
export function contactFill(existing: ExistingContact, v: Partial<ContactValues>): FillChange[] {
  const out: FillChange[] = []
  const blank = (x: string | null) => !(x ?? "").trim()
  const emails = new Set([existing.email ?? "", ...existing.extra.filter((a) => a.kind === "email").map((a) => a.value)].map(cleanEmail).filter(Boolean))
  const phones = new Set([existing.phone ?? "", ...existing.extra.filter((a) => a.kind === "phone").map((a) => a.value)].map(phoneKey).filter(Boolean))
  let emailFree = blank(existing.email)
  for (const e of (v.emails ?? []).map(cleanEmail).filter(Boolean)) {
    if (emails.has(e)) continue
    emails.add(e)
    out.push(change(emailFree ? "email" : "extraEmail", e))
    emailFree = false
  }
  let phoneFree = blank(existing.phone)
  for (const p of v.phones ?? []) {
    const k = phoneKey(p)
    if (!k || phones.has(k)) continue
    phones.add(k)
    out.push(change(phoneFree ? "phone" : "extraPhone", p))
    phoneFree = false
  }
  if (v.position && blank(existing.position)) out.push(change("position", v.position))
  if (v.nameNative && blank(existing.nameNative) && searchNormalise(v.nameNative) !== searchNormalise(existing.name)) {
    out.push(change("nameNative", v.nameNative))
  }
  const tg = cleanTelegram(v.telegram ?? "")
  const tgs = new Set([
    ...existing.aliases.filter((a) => a.trim().startsWith("@")).map(cleanTelegram),
    ...existing.extra.filter((a) => a.kind === "telegram").map((a) => a.value.replace(/^@/, "").toLowerCase()),
  ])
  if (tg && !tgs.has(tg)) out.push(change("telegram", tg))
  return out
}

/** Task type from the verb of the title (when the model gave none). */
export function taskTypeFromTitle(title: string): ChatTaskType {
  const t = (title ?? "").toLowerCase()
  if (/позвон|звонок|созвон|перезвон|набрать/.test(t)) return "call"
  if (/встреч|встрет|визит|переговор|демо|презентац/.test(t)) return "meet"
  if (/\bкп\b|кп |коммерческ|предложени|прайс|расч[её]т стоимост/.test(t)) return "offer"
  if (/договор|документ|сч[её]т|акт|спецификац|подпис/.test(t)) return "docs"
  if (/письм|написать|e-?mail|почт|ответить/.test(t)) return "email"
  return "other"
}

/**
 * Raw task values from the model → checked values (§8.4, §10). The title /
 * description are the model's words (marked «текст ИИ»); the deadline must
 * be the USER's words (`dueText`, grounded) — code turns them into a date in
 * the org time zone; without them the due date stays empty and the assistant
 * asks (Q8). Assignee and links are resolved by the server.
 */
export function groundTask(
  raw: { title?: unknown; description?: unknown; type?: unknown; priority?: unknown; dueText?: unknown; dueDate?: unknown; done?: unknown },
  sources: InputSources,
  now: Date,
  timeZone: string,
): Grounded<TaskValues> {
  const values = emptyTaskValues()
  const meta: Record<string, FieldMeta> = {}
  const removed: RemovedValue[] = []
  values.title = cleanText(raw.title, 200)
  if (values.title) meta.title = { source: "model" }
  values.description = cleanText(raw.description, 2000)
  if (values.description) meta.description = { source: "model" }
  const type = typeof raw.type === "string" && (TASK_TYPES as readonly string[]).includes(raw.type) ? (raw.type as ChatTaskType) : null
  values.type = type && type !== "other" ? type : taskTypeFromTitle(values.title)
  // «срочно» / «важно» in the user's own words → high; else medium.
  values.priority = findSource(sources, (i) => /srochn|vazhn|asap|urgent/.test(i.tokens.join(" "))) ? "high" : "medium"
  // «Записать встречу» (T4): a past meeting / call — the date is when it happened.
  values.done = raw.done === true

  const dueText = cleanText(raw.dueText, 200)
  const modelDate = typeof raw.dueDate === "string" && isLocalDateTime(raw.dueDate.trim()) ? raw.dueDate.trim() : ""
  if (dueText) {
    const src = findSource(sources, (i) => groundText(dueText, i, 0.6))
    if (!src) removed.push({ field: "dueDate", value: dueText, reason: "срок не назван в сообщении" })
    else {
      values.dueText = dueText
      const code = resolveDueText(dueText, now, timeZone, { past: values.done })
      if (code) {
        values.dueDate = code
        meta.dueDate = { source: src.source, fileName: src.fileName, fileId: src.fileId }
      } else if (modelDate) {
        values.dueDate = modelDate
        meta.dueDate = { source: "model" }
      }
    }
  } else if (modelDate) {
    removed.push({ field: "dueDate", value: modelDate.replace("T", " "), reason: "срок не назван в сообщении" })
  }
  // A logged meeting without a date happened now; a deadline in the past is a misread — ask instead.
  if (values.done && !values.dueDate) {
    values.dueDate = utcToLocal(now, timeZone)
    meta.dueDate = { source: "default" }
  }
  if (values.dueDate && !values.done) {
    const at = localToUtc(values.dueDate, timeZone)
    if (!at || at.getTime() < now.getTime() - 60_000) {
      removed.push({ field: "dueDate", value: values.dueDate.replace("T", " "), reason: "срок в прошлом" })
      values.dueDate = ""
      delete meta.dueDate
    }
  }
  return { values, meta, removed }
}

export function emptyTaskValues(): TaskValues {
  return {
    title: "",
    description: "",
    type: "other",
    priority: "medium",
    dueDate: "",
    dueText: "",
    assigneeId: null,
    assigneeName: "",
    companyId: null,
    companyKey: null,
    companyName: "",
    contactId: null,
    contactKey: null,
    contactName: "",
    dealId: null,
    dealKey: null,
    dealName: "",
    done: false,
  }
}

export function emptyDealValues(): DealValues {
  return {
    name: "",
    description: "",
    companyId: null,
    companyKey: null,
    companyName: "",
    contactIds: [],
    contactKeys: [],
    contactNames: [],
    value: "",
    valueText: "",
    currency: "",
    dealTypeId: null,
    dealTypeName: "",
    stageId: null,
    stageName: "",
    ruleNote: "",
  }
}

const WORD_NUMBERS: [RegExp, string][] = [
  [/полтор[аы]/g, "1,5"],
  [/(?<![а-я])одн?(ин|а|ого)(?![а-я])/g, "1"],
  [/(?<![а-я])дв(а|е|ух)(?![а-я])/g, "2"],
  [/(?<![а-я])тр(и|ех|ёх)(?![а-я])/g, "3"],
  [/(?<![а-я])четыр(е|ех|ёх)(?![а-я])/g, "4"],
  [/(?<![а-я])пят(ь|и)(?![а-я])/g, "5"],
  [/(?<![а-я])шест(ь|и)(?![а-я])/g, "6"],
  [/(?<![а-я])сем(ь|и)(?![а-я])/g, "7"],
  [/(?<![а-я])восем(ь|и)(?![а-я])/g, "8"],
  [/(?<![а-я])девят(ь|и)(?![а-я])/g, "9"],
  [/(?<![а-я])десят(ь|и)(?![а-я])/g, "10"],
  [/(?<![а-я])сто(?![а-я])/g, "100"],
  [/(?<![а-я])двести(?![а-я])/g, "200"],
  [/(?<![а-я])триста(?![а-я])/g, "300"],
  [/(?<![а-я])пятьсот(?![а-я])/g, "500"],
]

/**
 * The user's words for a deal amount → digits + currency. Reads «2 млн ₽»,
 * «~2 миллиона рублей», «два миллиона», «150 тыс.», «$40k». null = no amount
 * (a bare number without a multiplier or a currency is not money).
 */
function moneyText(text: string): string {
  let t = ` ${(text ?? "").toLowerCase()} `
  t = t.replace(/миллиард\S*/g, "млрд").replace(/миллион\S*/g, "млн").replace(/тысяч\S*/g, "тыс")
  for (const [re, n] of WORD_NUMBERS) t = t.replace(re, n)
  return t.replace(/(\d)\s*k(?![a-z])/g, "$1к")
}

export function parseDealValue(text: string): { value: string; currency: string } | null {
  const a = parseMoneyRu(moneyText(text)).find((m) => m.value > 0)
  if (!a) return null
  return { value: String(Math.round(a.value * 100) / 100), currency: a.currency }
}

/** Every amount the text names (any spelling: «2 млн», «два миллиона рублей», «2 000 000 ₽»), as digits. */
export function amountsIn(text: string): Set<string> {
  return new Set(parseMoneyRu(moneyText(text)).filter((m) => m.value > 0).map((m) => String(Math.round(m.value * 100) / 100)))
}

/**
 * Raw deal values from the model → checked values (§9). Name / description =
 * the model's words; the amount must be the USER's words (`valueText`,
 * grounded), read by code. Company, contacts, type and stage are resolved by
 * the server.
 */
export function groundDeal(raw: { name?: unknown; description?: unknown; valueText?: unknown }, sources: InputSources): Grounded<DealValues> {
  const values = emptyDealValues()
  const meta: Record<string, FieldMeta> = {}
  const removed: RemovedValue[] = []
  values.name = cleanText(raw.name, 200)
  if (values.name) meta.name = { source: "model" }
  values.description = cleanText(raw.description, 2000)
  if (values.description) meta.description = { source: "model" }
  const vt = cleanText(raw.valueText, 200)
  if (vt) {
    // The AMOUNT must be in the input, in any spelling («2 млн руб.» ≈ «два миллиона рублей»).
    const parsed = parseDealValue(vt)
    const src = parsed ? findSource(sources, (i) => amountsIn(i.lower).has(parsed.value)) : null
    if (!parsed) removed.push({ field: "value", value: vt, reason: "не удалось прочитать сумму" })
    else if (!src) removed.push({ field: "value", value: vt, reason: "суммы нет в сообщении" })
    else {
      values.value = parsed.value
      values.currency = parsed.currency
      values.valueText = vt
      meta.value = { source: src.source, fileName: src.fileName, fileId: src.fileId }
    }
  }
  return { values, meta, removed }
}

// ── Confirm payload (`POST /api/chat/actions`) ──────────────────────────

export const ITEM_DECISIONS = ["create", "create_anyway", "use_existing", "restore", "fill_existing"] as const
export type ItemDecision = (typeof ITEM_DECISIONS)[number]

const str = (max: number) => z.string().max(max).transform((s) => s.trim())

export const companyValuesSchema = z.object({
  name: str(200),
  aliases: z.array(str(200)).max(10).default([]),
  website: str(300).default(""),
  email: str(200).default(""),
  phone: str(60).default(""),
  address: str(300).default(""),
  comment: str(2000).default(""),
})

export const contactValuesSchema = z.object({
  name: str(200),
  nameNative: str(200).default(""),
  position: str(200).default(""),
  emails: z.array(str(200)).max(10).default([]),
  phones: z.array(str(60)).max(10).default([]),
  telegram: str(100).default(""),
  companyId: z.string().max(100).nullable().default(null),
  companyKey: z.string().max(10).nullable().default(null),
  companyName: str(200).default(""),
})

export const confirmItemSchema = z.object({
  key: z.string().max(10),
  include: z.boolean(),
  decision: z.enum(ITEM_DECISIONS).default("create"),
  existingId: z.string().max(100).optional(),
  values: z.unknown(),
})

export const confirmActionSchema = z.object({
  actionId: z.string().min(1).max(100),
  attachFile: z.boolean().default(true),
  items: z.array(confirmItemSchema).min(1).max(ACTION_LIMITS.itemsPerAction),
})
export type ConfirmActionInput = z.infer<typeof confirmActionSchema>
export type ConfirmItemInput = z.infer<typeof confirmItemSchema>

/** Values of an item for the confirm request (and the card's form state). */
export const taskValuesSchema = z.object({
  title: str(200),
  description: str(4000).default(""),
  type: z.enum(TASK_TYPES).default("other"),
  priority: z.enum(TASK_PRIORITIES).default("medium"),
  dueDate: z.string().max(16).default(""),
  dueText: str(200).default(""),
  assigneeId: z.string().max(100).nullable().default(null),
  assigneeName: str(200).default(""),
  companyId: z.string().max(100).nullable().default(null),
  companyKey: z.string().max(10).nullable().default(null),
  companyName: str(200).default(""),
  contactId: z.string().max(100).nullable().default(null),
  contactKey: z.string().max(10).nullable().default(null),
  contactName: str(200).default(""),
  dealId: z.string().max(100).nullable().default(null),
  dealKey: z.string().max(10).nullable().default(null),
  dealName: str(200).default(""),
  done: z.boolean().default(false),
})

const FILL_FIELDS = ["phone", "email", "website", "address", "alias", "position", "nameNative", "extraPhone", "extraEmail", "telegram"] as const
const fillChangeSchema = z.object({ field: z.enum(FILL_FIELDS), label: str(100), value: str(300) })

export const updateValuesSchema = z.object({
  targetType: z.enum(["client", "contact"]),
  targetId: z.string().min(1).max(100),
  targetName: str(200).default(""),
  changes: z.array(fillChangeSchema).max(20).default([]),
})

export const orderRequestValuesSchema = z.object({
  clientId: z.string().max(100).nullable().default(null),
  companyKey: z.string().max(10).nullable().default(null),
  clientName: str(200).default(""),
  requestText: str(12000),
  comment: str(1000).default(""),
})

export const dealMoveValuesSchema = z.object({
  dealId: z.string().min(1).max(100),
  dealName: str(200).default(""),
  fromStageName: str(200).default(""),
  stageId: z.string().max(100).nullable().default(null),
  stageName: str(200).default(""),
  outcome: z.enum(["won", "lost"]).nullable().default(null),
  reasonCode: str(100).default(""),
  reasonText: str(1000).default(""),
})

export const taskUpdateValuesSchema = z.object({
  taskId: z.string().min(1).max(100),
  taskTitle: str(300).default(""),
  action: z.enum(["done", "reschedule"]),
  dueDate: z.string().max(16).default(""),
  dueText: str(200).default(""),
  currentDue: z.string().max(16).default(""),
})

export const linkValuesSchema = z.object({
  contactId: z.string().max(100).nullable().default(null),
  contactName: str(200).default(""),
  clientId: z.string().max(100).nullable().default(null),
  clientName: str(200).default(""),
  primary: z.boolean().default(false),
  dealId: z.string().max(100).nullable().default(null),
  dealName: str(200).default(""),
})

export const dealValuesSchema = z.object({
  name: str(200),
  description: str(4000).default(""),
  companyId: z.string().max(100).nullable().default(null),
  companyKey: z.string().max(10).nullable().default(null),
  companyName: str(200).default(""),
  contactIds: z.array(z.string().max(100)).max(20).default([]),
  contactKeys: z.array(z.string().max(10)).max(20).default([]),
  contactNames: z.array(str(200)).max(20).default([]),
  value: z.string().max(20).regex(/^(\d+(\.\d{1,2})?)?$/).default(""),
  valueText: str(200).default(""),
  currency: z.enum(["", "RUB", "USD", "EUR", "CNY", "GBP"]).default(""),
  dealTypeId: z.string().max(100).nullable().default(null),
  dealTypeName: str(200).default(""),
  stageId: z.string().max(100).nullable().default(null),
  stageName: str(200).default(""),
  ruleNote: str(500).default(""),
})

type AnyValues = CompanyValues | ContactValues | TaskValues | DealValues | UpdateValues | LinkValues | OrderRequestValues | DealMoveValues | TaskUpdateValues

export function parseItemValues(type: ItemType, raw: unknown): AnyValues | null {
  const schema = {
    company: companyValuesSchema,
    contact: contactValuesSchema,
    deal: dealValuesSchema,
    task: taskValuesSchema,
    update: updateValuesSchema,
    link: linkValuesSchema,
    order_request: orderRequestValuesSchema,
    deal_move: dealMoveValuesSchema,
    task_update: taskUpdateValuesSchema,
  }[type]
  const r = schema.safeParse(raw)
  if (!r.success) return null
  if (type === "task" && (r.data as TaskValues).dueDate && !isLocalDateTime((r.data as TaskValues).dueDate)) return null
  if (type === "task_update" && (r.data as TaskUpdateValues).dueDate && !isLocalDateTime((r.data as TaskUpdateValues).dueDate)) return null
  return r.data as AnyValues
}

/** Href of a created / used record. */
export function actionResultHref(type: ActionResult["type"], id: string): string {
  const e = encodeURIComponent(id)
  if (type === "order_request") return `/products?assembleRequest=${e}`
  return type === "client" ? `/clients/${e}` : type === "contact" ? `/contacts?openContact=${e}` : type === "deal" ? `/deals?openDeal=${e}` : `/tasks?openTask=${e}`
}

/** Short Russian note of a draft for the model's next turn. */
export function draftNote(p: ChatDraftPart): string {
  const names = p.draft.items
    .map((i) => {
      const due = i.type === "task" && (i.values as TaskValues).dueDate ? `, срок ${(i.values as TaskValues).dueDate.replace("T", " ")}` : ""
      return `${ITEM_TYPE_WORDS[i.type]} «${itemLabel(i) || "без названия"}»${due}`
    })
    .join(", ")
  const state =
    p.status === "created" || p.status === "partly_created"
      ? "создано"
      : p.status === "cancelled"
        ? "отменено пользователем"
        : p.status === "expired"
          ? "устарело"
          : "ожидает подтверждения пользователем"
  // No id: a card of an earlier answer cannot be joined anyway, and an id the model copies would leak.
  return `[Черновик: ${names} — ${state}]`
}

export function actionResultNote(p: ChatActionResultPart): string {
  if (!p.results.length) return `[Черновик ${p.actionId}: ничего не создано]`
  const list = p.results
    .map((r) => `${{ client: "компания", contact: "контакт", task: "задача", deal: "сделка", order_request: "запрос клиента" }[r.type]} «${r.title}» (ref ${r.id}${r.existing ? ", существующая запись" : ""})`)
    .join("; ")
  return `[Пользователь подтвердил черновик ${p.actionId}: ${list}]`
}

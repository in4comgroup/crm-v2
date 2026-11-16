// Contract of the AI chat records engine (docs/specs/ai-chat/01-specification.md
// §6–§7). Client-safe: shared by the engine (src/server/chat/records/), the
// chat tools (CH4) and the results / detail UI (CH3). No DB, no server code.

export const RECORD_TYPES = [
  "client",
  "contact",
  "deal",
  "order",
  "product",
  "task",
  "topic",
  "card",
  "source_item",
] as const

export type RecordType = (typeof RECORD_TYPES)[number]

/** Display order of the sections in a results block (spec §7.1). */
export const RECORD_TYPE_ORDER: readonly RecordType[] = RECORD_TYPES

export const RECORD_TYPE_LABELS: Record<RecordType, { one: string; many: string }> = {
  client: { one: "Компания", many: "Компании" },
  contact: { one: "Контакт", many: "Контакты" },
  deal: { one: "Сделка", many: "Сделки" },
  order: { one: "Заказ", many: "Заказы" },
  product: { one: "Товар", many: "Товары" },
  task: { one: "Задача", many: "Задачи" },
  topic: { one: "Тема", many: "Темы" },
  card: { one: "Карточка", many: "Карточки" },
  source_item: { one: "Источник", many: "Источники" },
}

/** Types that exist for users only in topics mode `on` (spec §6.1). */
export const TOPICS_ONLY_TYPES: readonly RecordType[] = ["topic", "card"]

export function isRecordType(v: unknown): v is RecordType {
  return typeof v === "string" && (RECORD_TYPES as readonly string[]).includes(v)
}

/** Totals are exact up to this number, then shown as «500+». */
export const RECORD_COUNT_CAP = 500

export type RecordTone = "neutral" | "good" | "warn" | "bad"
export type RecordFact = { label: string; value: string }
export type RecordBadge = { label: string; tone: RecordTone }

/** One row of a results list (spec §7.1). */
export type RecordHit = {
  type: RecordType
  id: string
  title: string
  /** One line under the title, e.g. the company of a contact. */
  subtitle: string | null
  /** 0–3 short facts, already formatted in Russian. */
  facts: RecordFact[]
  badge: RecordBadge | null
  /** ISO time the row is "about" (order date, mail date, due date, …). */
  date: string | null
  /** Page of the record in the CRM. */
  href: string
}

export type RecordDetailSection =
  | { kind: "facts"; title: string; items: (RecordFact & { href?: string })[] }
  | { kind: "text"; title: string; markdown: string }
  | { kind: "records"; title: string; items: RecordHit[] }
  | { kind: "table"; title: string; columns: string[]; rows: string[][] }

/** Detail view of one record (spec §7.2). Empty sections are left out. */
export type RecordDetail = {
  type: RecordType
  id: string
  title: string
  subtitle: string | null
  badges: RecordBadge[]
  sections: RecordDetailSection[]
  href: string
}

export type RecordCount = { total: number; capped: boolean }

export type RecordSearchResult = {
  query: string
  /** Types that were searched (visible to the user and asked for). */
  types: RecordType[]
  counts: Partial<Record<RecordType, RecordCount>>
  hits: Partial<Record<RecordType, RecordHit[]>>
  /** Types whose search failed (logged on the server; the rest still answer). */
  failed: RecordType[]
}

/** A filter as the user should read it, e.g. { «Статус», «открыта» }. */
export type AppliedFilter = { label: string; value: string }

export type RecordListResult = {
  type: RecordType
  total: number
  capped: boolean
  rows: RecordHit[]
  applied: AppliedFilter[]
}

/** «12» / «500+». */
export function formatRecordCount(c: RecordCount): string {
  return c.capped ? `${RECORD_COUNT_CAP}+` : String(c.total)
}

/**
 * Page of a record in the CRM (spec §6.1). A product has no page of its own
 * (Q8) → the catalog filtered by its name.
 */
export function recordHref(type: RecordType, id: string, title?: string): string {
  const e = encodeURIComponent
  switch (type) {
    case "client":
      return `/clients/${e(id)}`
    case "contact":
      return `/contacts?openContact=${e(id)}`
    case "deal":
      return `/deals?openDeal=${e(id)}`
    case "order":
      return `/products?openOrder=${e(id)}`
    case "product":
      return `/products?q=${e(title ?? "")}`
    case "task":
      return `/tasks?openTask=${e(id)}`
    case "topic":
      return `/dashboard?topic=${e(id)}`
    case "card":
      return `/cards/${e(id)}`
    case "source_item":
      return `/sources?item=${e(id)}`
  }
}

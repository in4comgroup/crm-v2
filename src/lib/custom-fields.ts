// Client-safe contract of org custom fields of companies and contacts
// (docs/specs/clients-contacts/01-custom-fields.md). Types, limits, the
// definition schema, per-type value validation and display formatting —
// shared by the server (src/server/custom-fields.ts), the owner dialog, the
// «Поля» tab and the AI texts. No DB, no server imports.

import { z } from "zod"

export const CUSTOM_FIELD_ENTITIES = ["client", "contact"] as const
export type CustomFieldEntity = (typeof CUSTOM_FIELD_ENTITIES)[number]

export const CUSTOM_FIELD_ENTITY_LABELS_RU: Record<CustomFieldEntity, string> = {
  client: "Компании",
  contact: "Контакты",
}

export const CUSTOM_FIELD_TYPES = [
  "text",
  "number",
  "currency",
  "date",
  "select",
  "multiselect",
  "boolean",
  "url",
  "email",
  "phone",
] as const
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number]

export const CUSTOM_FIELD_TYPE_LABELS_RU: Record<CustomFieldType, string> = {
  text: "Текст",
  number: "Число",
  currency: "Сумма",
  date: "Дата",
  select: "Список (один вариант)",
  multiselect: "Список (несколько)",
  boolean: "Да / нет",
  url: "Ссылка",
  email: "Email",
  phone: "Телефон",
}

/** Currencies offered for `currency` fields (codes; labels via Intl). */
export const CUSTOM_FIELD_CURRENCIES = ["RUB", "USD", "EUR", "CNY", "KZT", "BYN", "GBP", "CHF", "AED", "TRY"] as const

export const CUSTOM_FIELD_LIMITS = {
  fieldsPerEntity: 50,
  label: 60,
  helpText: 200,
  section: 60,
  text: 1_000,
  multilineText: 10_000,
  options: 100,
  optionLabel: 60,
  numberAbs: 1e12,
  url: 2_000,
  email: 254,
  phone: 40,
} as const

const L = CUSTOM_FIELD_LIMITS

// ── Definitions ───────────────────────────────────────────────────────────

export type CustomFieldOption = { id: string; label: string; archived?: boolean }

export type CustomFieldConfig = {
  options?: CustomFieldOption[]
  /** `currency`: default currency of new values. */
  currency?: string
  /** `number` / `currency`: decimals 0–4. */
  decimals?: number
  /** `text`: multi-line input. */
  multiline?: boolean
  /**
   * System role of the field, set only by code (never by the owner dialog):
   * `client_type` = the company type read by the analytics «Тип клиента»
   * slice and the stage-rule guard `client_type = X` (converted from the old
   * `client.custom_fields.type`, spec Q12).
   */
  systemKey?: CustomFieldSystemKey
}

export const CUSTOM_FIELD_SYSTEM_KEYS = ["client_type"] as const
export type CustomFieldSystemKey = (typeof CUSTOM_FIELD_SYSTEM_KEYS)[number]

/** A field definition as the API returns it. */
export type CustomFieldDef = {
  id: string
  entity: CustomFieldEntity
  label: string
  type: CustomFieldType
  config: CustomFieldConfig
  helpText: string | null
  section: string | null
  isShown: boolean
  /** «Показывать в списке»: a column on /clients or /contacts. */
  showInList: boolean
  position: number
  archivedAt: string | null
}

const optionSchema = z.object({
  id: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1, "Вариант не может быть пустым").max(L.optionLabel),
  archived: z.boolean().optional(),
})

export const customFieldConfigSchema = z.object({
  options: z.array(optionSchema).max(L.options).optional(),
  currency: z.enum(CUSTOM_FIELD_CURRENCIES).optional(),
  decimals: z.number().int().min(0).max(4).optional(),
  multiline: z.boolean().optional(),
})

/** Input of create / change (owner). Position / archive have their own actions. */
export const customFieldInputSchema = z
  .object({
    entity: z.enum(CUSTOM_FIELD_ENTITIES),
    label: z.string().trim().min(1, "Укажите название поля").max(L.label),
    type: z.enum(CUSTOM_FIELD_TYPES),
    config: customFieldConfigSchema.default({}),
    helpText: z.string().trim().max(L.helpText).nullable().optional(),
    section: z.string().trim().max(L.section).nullable().optional(),
    isShown: z.boolean().default(true),
    showInList: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    const isSelect = v.type === "select" || v.type === "multiselect"
    const active = (v.config.options ?? []).filter((o) => !o.archived)
    if (isSelect && active.length === 0) {
      ctx.addIssue({ code: "custom", path: ["config", "options"], message: "Добавьте хотя бы один вариант" })
    }
    const ids = new Set<string>()
    const labels = new Set<string>()
    for (const o of v.config.options ?? []) {
      if (ids.has(o.id)) ctx.addIssue({ code: "custom", path: ["config", "options"], message: "Повтор варианта" })
      ids.add(o.id)
      const k = o.label.trim().toLowerCase()
      if (!o.archived && labels.has(k)) {
        ctx.addIssue({ code: "custom", path: ["config", "options"], message: `Вариант «${o.label}» повторяется` })
      }
      if (!o.archived) labels.add(k)
    }
  })
export type CustomFieldInput = z.infer<typeof customFieldInputSchema>

/**
 * PURE. Is a type change allowed for a field that may have values (§3.4)?
 * Same type, text ↔ text (multi-line is a config), select → multiselect.
 */
export function isAllowedTypeChange(from: CustomFieldType, to: CustomFieldType): boolean {
  return from === to || (from === "select" && to === "multiselect")
}

/** PURE. Convert a stored value after an allowed type change. */
export function convertValueForType(value: unknown, from: CustomFieldType, to: CustomFieldType): unknown {
  if (from === "select" && to === "multiselect") return typeof value === "string" ? [value] : value
  return value
}

// ── Values ────────────────────────────────────────────────────────────────

export type CurrencyValue = { amount: number; currency: string }
export type CustomFieldValue = string | number | boolean | string[] | CurrencyValue

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isValidDay(v: string): boolean {
  if (!DATE_RE.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

function roundTo(n: number, decimals: number): number {
  const f = 10 ** decimals
  return Math.round(n * f) / f
}

export type ValueCheck = { ok: true; value: CustomFieldValue | null } | { ok: false; message: string }

/**
 * PURE. Validate and normalise one value for a field. `null` / `undefined`
 * / "" / [] = empty (the key is removed). Selects accept only ACTIVE option
 * ids — except the value already stored (`previous`), so an archived option
 * on an old value can be kept while other fields are saved.
 */
export function validateCustomValue(
  def: Pick<CustomFieldDef, "type" | "config" | "label">,
  raw: unknown,
  previous?: unknown,
): ValueCheck {
  const bad = (message: string): ValueCheck => ({ ok: false, message: `«${def.label}»: ${message}` })
  if (raw === null || raw === undefined || raw === "" || (Array.isArray(raw) && raw.length === 0)) {
    return { ok: true, value: null }
  }
  const c = def.config ?? {}
  switch (def.type) {
    case "text": {
      if (typeof raw !== "string") return bad("ожидается текст")
      const v = c.multiline ? raw.replace(/\r\n/g, "\n").trim() : raw.replace(/\s+/g, " ").trim()
      if (!v) return { ok: true, value: null }
      const max = c.multiline ? L.multilineText : L.text
      return v.length > max ? bad(`не больше ${max} символов`) : { ok: true, value: v }
    }
    case "number": {
      const n = typeof raw === "string" ? Number(raw.replace(/\s/g, "").replace(",", ".")) : raw
      if (typeof n !== "number" || !Number.isFinite(n)) return bad("ожидается число")
      if (Math.abs(n) > L.numberAbs) return bad("слишком большое число")
      return { ok: true, value: roundTo(n, c.decimals ?? 2) }
    }
    case "currency": {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return bad("ожидается сумма")
      const r = raw as { amount?: unknown; currency?: unknown }
      const amount = typeof r.amount === "string" ? Number(r.amount.replace(/\s/g, "").replace(",", ".")) : r.amount
      if (r.amount === "" || r.amount === null || r.amount === undefined) return { ok: true, value: null }
      if (typeof amount !== "number" || !Number.isFinite(amount)) return bad("ожидается сумма")
      if (Math.abs(amount) > L.numberAbs) return bad("слишком большая сумма")
      const currency = typeof r.currency === "string" && r.currency ? r.currency : (c.currency ?? "RUB")
      if (!(CUSTOM_FIELD_CURRENCIES as readonly string[]).includes(currency)) return bad("неизвестная валюта")
      return { ok: true, value: { amount: roundTo(amount, c.decimals ?? 2), currency } }
    }
    case "date":
      return typeof raw === "string" && isValidDay(raw) ? { ok: true, value: raw } : bad("ожидается дата ГГГГ-ММ-ДД")
    case "select":
    case "multiselect": {
      const options = c.options ?? []
      const prev = new Set(Array.isArray(previous) ? previous : typeof previous === "string" ? [previous] : [])
      const allowed = (id: unknown) =>
        typeof id === "string" && options.some((o) => o.id === id && (!o.archived || prev.has(id)))
      if (def.type === "select") {
        return allowed(raw) ? { ok: true, value: raw as string } : bad("нет такого варианта")
      }
      if (!Array.isArray(raw)) return bad("ожидается список вариантов")
      const ids = [...new Set(raw)]
      if (!ids.every(allowed)) return bad("нет такого варианта")
      // Keep the option order of the definition.
      const order = new Map(options.map((o, i) => [o.id, i]))
      return { ok: true, value: (ids as string[]).sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)) }
    }
    case "boolean":
      return typeof raw === "boolean" ? { ok: true, value: raw } : bad("ожидается «да» или «нет»")
    case "url": {
      if (typeof raw !== "string") return bad("ожидается ссылка")
      let v = raw.trim()
      if (v && !/^https?:\/\//i.test(v)) v = `https://${v}`
      try {
        const u = new URL(v)
        if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) return bad("неверная ссылка")
      } catch {
        return bad("неверная ссылка")
      }
      return v.length > L.url ? bad("слишком длинная ссылка") : { ok: true, value: v }
    }
    case "email": {
      if (typeof raw !== "string") return bad("ожидается email")
      const v = raw.trim().toLowerCase()
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= L.email ? { ok: true, value: v } : bad("неверный email")
    }
    case "phone": {
      if (typeof raw !== "string") return bad("ожидается телефон")
      const v = raw.replace(/\s+/g, " ").trim()
      const digits = v.replace(/\D/g, "")
      return digits.length >= 5 && digits.length <= 15 && v.length <= L.phone && /^[+\d\s().-]+$/.test(v)
        ? { ok: true, value: v }
        : bad("неверный телефон")
    }
  }
}

// ── Display ───────────────────────────────────────────────────────────────

function fmtNumber(n: number, decimals: number): string {
  return n.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: decimals })
}

/** PURE. Russian display text of a stored value ("" when empty). */
export function formatCustomValue(def: Pick<CustomFieldDef, "type" | "config">, value: unknown): string {
  if (value === null || value === undefined || value === "") return ""
  const c = def.config ?? {}
  switch (def.type) {
    case "number":
      return typeof value === "number" ? fmtNumber(value, c.decimals ?? 2) : ""
    case "currency": {
      const v = value as Partial<CurrencyValue>
      if (typeof v?.amount !== "number") return ""
      try {
        return new Intl.NumberFormat("ru-RU", {
          style: "currency",
          currency: v.currency || c.currency || "RUB",
          maximumFractionDigits: c.decimals ?? 2,
        }).format(v.amount)
      } catch {
        return `${fmtNumber(v.amount, c.decimals ?? 2)} ${v.currency ?? ""}`.trim()
      }
    }
    case "date":
      return typeof value === "string" && isValidDay(value)
        ? new Date(`${value}T00:00:00Z`).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
        : ""
    case "select":
    case "multiselect": {
      const ids = Array.isArray(value) ? value : [value]
      return ids
        .map((id) => {
          const o = (c.options ?? []).find((x) => x.id === id)
          return o ? (o.archived ? `${o.label} (удалён)` : o.label) : null
        })
        .filter(Boolean)
        .join(", ")
    }
    case "boolean":
      return value === true ? "Да" : value === false ? "Нет" : ""
    default:
      return typeof value === "string" ? value : ""
  }
}

/**
 * PURE. «Название: значение» lines of the SHOWN, non-archived fields that
 * have a value, in position order — the AI text (spec §4, Q11). Capped at
 * `maxChars` (whole lines only). "" when there is nothing.
 */
export function customValuesText(
  defs: readonly Pick<CustomFieldDef, "label" | "type" | "config" | "isShown" | "archivedAt" | "position" | "id">[],
  values: Record<string, unknown> | null | undefined,
  maxChars = 400,
): string {
  const lines: string[] = []
  let used = 0
  for (const d of [...defs].sort((a, b) => a.position - b.position)) {
    if (!d.isShown || d.archivedAt) continue
    const v = formatCustomValue(d, values?.[d.id])
    if (!v) continue
    const line = `${d.label}: ${v.replace(/\s+/g, " ").trim()}`
    if (used + line.length + 1 > maxChars) break
    lines.push(line)
    used += line.length + 1
  }
  return lines.join("\n")
}

// ── List filters (spec §3.5) ──────────────────────────────────────────────

/**
 * One filter of the /clients or /contacts list. Ops by type:
 * `filled` / `empty` — every type; `contains` — text / url / email / phone
 * (case-insensitive substring); `in` — select (one of the option ids);
 * `any` — multiselect (has any of the option ids); `is` — boolean;
 * `range` — number / currency (amount) / date, `{ from?, to? }` inclusive.
 * Filters of one list are combined with AND.
 */
export type CustomFieldFilter =
  | { fieldId: string; op: "filled" | "empty" }
  | { fieldId: string; op: "contains"; value: string }
  | { fieldId: string; op: "in" | "any"; value: string[] }
  | { fieldId: string; op: "is"; value: boolean }
  | { fieldId: string; op: "range"; value: { from?: number | string | null; to?: number | string | null } }

export const CUSTOM_FILTERS_MAX = 10

const TEXT_TYPES: readonly CustomFieldType[] = ["text", "url", "email", "phone"]

/** Ops a field type supports (the UI offers these; the parser enforces them). */
export function filterOpsFor(type: CustomFieldType): CustomFieldFilter["op"][] {
  const base: CustomFieldFilter["op"][] = ["filled", "empty"]
  if (TEXT_TYPES.includes(type)) return ["contains", ...base]
  if (type === "select") return ["in", ...base]
  if (type === "multiselect") return ["any", ...base]
  if (type === "boolean") return ["is", ...base]
  return ["range", ...base] // number / currency / date
}

/** URL form of the filters (`?cf=`): JSON. "" when none. */
export function encodeCustomFilters(filters: readonly CustomFieldFilter[]): string {
  return filters.length ? JSON.stringify(filters) : ""
}

function asRangeBound(type: CustomFieldType, v: unknown): number | string | null {
  if (v === null || v === undefined || v === "") return null
  if (type === "date") return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null
  const n = typeof v === "string" ? Number(v.replace(/\s/g, "").replace(",", ".")) : v
  return typeof n === "number" && Number.isFinite(n) ? n : null
}

/**
 * PURE. Parse + validate `?cf=` against the org's field definitions: unknown,
 * hidden or archived fields, wrong ops, empty values are DROPPED (a stale
 * URL never breaks the list); ≤ CUSTOM_FILTERS_MAX filters.
 */
export function parseCustomFilters(
  raw: string | null | undefined,
  defs: readonly Pick<CustomFieldDef, "id" | "type" | "isShown" | "archivedAt" | "config">[],
): CustomFieldFilter[] {
  if (!raw) return []
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(data)) return []
  const byId = new Map(defs.filter((d) => d.isShown && !d.archivedAt).map((d) => [d.id, d]))
  const out: CustomFieldFilter[] = []
  for (const item of data) {
    if (out.length >= CUSTOM_FILTERS_MAX) break
    if (!item || typeof item !== "object") continue
    const f = item as { fieldId?: unknown; op?: unknown; value?: unknown }
    const def = typeof f.fieldId === "string" ? byId.get(f.fieldId) : undefined
    if (!def || typeof f.op !== "string" || !filterOpsFor(def.type).includes(f.op as CustomFieldFilter["op"])) continue
    const fieldId = def.id
    switch (f.op) {
      case "filled":
      case "empty":
        out.push({ fieldId, op: f.op })
        break
      case "contains": {
        const v = typeof f.value === "string" ? f.value.trim().slice(0, 200) : ""
        if (v) out.push({ fieldId, op: "contains", value: v })
        break
      }
      case "in":
      case "any": {
        const known = new Set((def.config?.options ?? []).map((o) => o.id))
        const v = Array.isArray(f.value) ? [...new Set(f.value.filter((x): x is string => typeof x === "string" && known.has(x)))] : []
        if (v.length) out.push({ fieldId, op: f.op, value: v })
        break
      }
      case "is":
        if (typeof f.value === "boolean") out.push({ fieldId, op: "is", value: f.value })
        break
      case "range": {
        const r = (f.value ?? {}) as { from?: unknown; to?: unknown }
        const from = asRangeBound(def.type, r.from)
        const to = asRangeBound(def.type, r.to)
        if (from !== null || to !== null) out.push({ fieldId, op: "range", value: { from, to } })
        break
      }
    }
  }
  return out
}

function isEmptyValue(v: unknown): boolean {
  return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)
}

/** PURE. Does a row's `custom_values` pass every filter (AND)? Same semantics as the SQL builder. */
export function matchesCustomFilters(
  values: Record<string, unknown> | null | undefined,
  filters: readonly CustomFieldFilter[],
  defs: readonly Pick<CustomFieldDef, "id" | "type">[],
): boolean {
  const typeOf = new Map(defs.map((d) => [d.id, d.type]))
  for (const f of filters) {
    const v = values?.[f.fieldId]
    switch (f.op) {
      case "filled":
        if (isEmptyValue(v)) return false
        break
      case "empty":
        if (!isEmptyValue(v)) return false
        break
      case "contains":
        if (typeof v !== "string" || !v.toLowerCase().includes(f.value.toLowerCase())) return false
        break
      case "in":
        if (typeof v !== "string" || !f.value.includes(v)) return false
        break
      case "any":
        if (!Array.isArray(v) || !v.some((x) => f.value.includes(x as string))) return false
        break
      case "is":
        if (v !== f.value) return false
        break
      case "range": {
        const type = typeOf.get(f.fieldId)
        const x =
          type === "currency" ? (v as { amount?: unknown } | null)?.amount : v
        if (type === "date") {
          if (typeof x !== "string") return false
          if (f.value.from && x < String(f.value.from)) return false
          if (f.value.to && x > String(f.value.to)) return false
        } else {
          if (typeof x !== "number") return false
          if (typeof f.value.from === "number" && x < f.value.from) return false
          if (typeof f.value.to === "number" && x > f.value.to) return false
        }
        break
      }
    }
  }
  return true
}


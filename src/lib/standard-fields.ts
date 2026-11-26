// Client-safe contract of the STANDARD fields of companies and contacts
// (docs/specs/clients-contacts/10-standard-fields.md, 2026-11-26): fields
// every org has, stored in real columns (not in `custom_values`) — company
// requisites («Реквизиты», «Банковские реквизиты») and the contact birthday.
// Shown at the top of the «Поля» tab and saved with its «Сохранить». Pure:
// definitions, per-kind validation + normalisation, display formatting.

import type { CustomFieldEntity } from "@/lib/custom-fields"

/**
 * `text` / `multiline` = free text; `digits` = only digits of the allowed
 * lengths (spaces and dashes are dropped on save); `kpp` = 9 characters,
 * digits with optional Latin capitals in positions 5–6; `date` = YYYY-MM-DD.
 */
export type StandardFieldKind = "text" | "multiline" | "digits" | "kpp" | "date"

export type StandardFieldDef = {
  /** The column key (camelCase) on `client` / `contact`. */
  key: string
  entity: CustomFieldEntity
  label: string
  section: string
  kind: StandardFieldKind
  /** `digits`: allowed lengths. */
  lengths?: readonly number[]
  /** `digits`: show in groups of 4 («4070 2810 …»). */
  group4?: boolean
  maxLength?: number
  placeholder?: string
  helpText?: string
}

export const CLIENT_STANDARD_FIELDS = [
  { key: "legalName", entity: "client", label: "Юридическое название", section: "Реквизиты", kind: "text", maxLength: 500, placeholder: "ООО «Ромашка»" },
  { key: "legalAddress", entity: "client", label: "Юридический адрес", section: "Реквизиты", kind: "multiline", maxLength: 1_000 },
  { key: "inn", entity: "client", label: "ИНН", section: "Реквизиты", kind: "digits", lengths: [10, 12], helpText: "10 цифр у организации, 12 цифр у ИП" },
  { key: "kpp", entity: "client", label: "КПП", section: "Реквизиты", kind: "kpp", helpText: "9 знаков: цифры, в 5-м и 6-м знаках могут быть латинские буквы A–Z" },
  { key: "ogrn", entity: "client", label: "ОГРН", section: "Реквизиты", kind: "digits", lengths: [13, 15], helpText: "13 цифр у организации (ОГРН), 15 цифр у ИП (ОГРНИП)" },
  { key: "bankAccount", entity: "client", label: "Расчётный счёт", section: "Банковские реквизиты", kind: "digits", lengths: [20], group4: true, helpText: "20 цифр, можно группами по 4 через пробел" },
  { key: "bankName", entity: "client", label: "Наименование банка", section: "Банковские реквизиты", kind: "text", maxLength: 300 },
  { key: "bankBik", entity: "client", label: "БИК", section: "Банковские реквизиты", kind: "digits", lengths: [9] },
  { key: "bankCorrAccount", entity: "client", label: "Корр. счёт банка", section: "Банковские реквизиты", kind: "digits", lengths: [20], group4: true, helpText: "20 цифр, можно группами по 4 через пробел" },
] as const satisfies readonly StandardFieldDef[]

export const CONTACT_STANDARD_FIELDS = [
  { key: "birthday", entity: "contact", label: "День рождения", section: "Основное", kind: "date" },
] as const satisfies readonly StandardFieldDef[]

export type ClientStandardKey = (typeof CLIENT_STANDARD_FIELDS)[number]["key"]
export type ContactStandardKey = (typeof CONTACT_STANDARD_FIELDS)[number]["key"]

export function standardFieldsOf(entity: CustomFieldEntity): readonly StandardFieldDef[] {
  return entity === "client" ? CLIENT_STANDARD_FIELDS : CONTACT_STANDARD_FIELDS
}

/** Stored values: key → string (dates as YYYY-MM-DD), empty = null. */
export type StandardValues = Record<string, string | null>

export type StandardCheck = { ok: true; value: string | null } | { ok: false; message: string }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const KPP_RE = /^\d{4}[0-9A-Z]{2}\d{3}$/

function lengthsText(lengths: readonly number[]): string {
  return lengths.length === 1 ? `${lengths[0]}` : `${lengths.slice(0, -1).join(", ")} или ${lengths[lengths.length - 1]}`
}

/**
 * PURE. Validate and normalise one value. `null` / `undefined` / blank =
 * empty. `today` (YYYY-MM-DD) limits dates; default = the current UTC day.
 */
export function validateStandardValue(def: StandardFieldDef, raw: unknown, today?: string): StandardCheck {
  const bad = (message: string): StandardCheck => ({ ok: false, message: `«${def.label}»: ${message}` })
  if (raw === null || raw === undefined) return { ok: true, value: null }
  if (typeof raw !== "string") return bad("неверное значение")
  const s = raw.trim()
  if (s === "") return { ok: true, value: null }
  switch (def.kind) {
    case "text": {
      const v = s.replace(/\s+/g, " ")
      if (def.maxLength && v.length > def.maxLength) return bad(`не длиннее ${def.maxLength} символов`)
      return { ok: true, value: v }
    }
    case "multiline": {
      if (def.maxLength && s.length > def.maxLength) return bad(`не длиннее ${def.maxLength} символов`)
      return { ok: true, value: s }
    }
    case "digits": {
      const v = s.replace(/[\s-]+/g, "")
      const lengths = def.lengths ?? []
      if (!/^\d+$/.test(v)) return bad("только цифры")
      if (lengths.length > 0 && !lengths.includes(v.length)) {
        return bad(`нужно ${lengthsText(lengths)} цифр, сейчас ${v.length}`)
      }
      return { ok: true, value: v }
    }
    case "kpp": {
      const v = s.replace(/\s+/g, "").toUpperCase()
      if (v.length !== 9) return bad(`нужно 9 знаков, сейчас ${v.length}`)
      if (!KPP_RE.test(v)) return bad("цифры; только в 5-м и 6-м знаках могут быть латинские буквы A–Z")
      return { ok: true, value: v }
    }
    case "date": {
      if (!DATE_RE.test(s)) return bad("неверная дата")
      const d = new Date(`${s}T00:00:00Z`)
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return bad("неверная дата")
      if (s < "1900-01-01") return bad("дата раньше 1900 года")
      const max = today ?? new Date().toISOString().slice(0, 10)
      if (s > max) return bad("дата в будущем")
      return { ok: true, value: s }
    }
  }
}

/** PURE. Display text of a stored value ("" when empty). */
export function formatStandardValue(def: StandardFieldDef, v: string | null | undefined): string {
  if (!v) return ""
  if (def.kind === "digits" && def.group4) return v.replace(/(\d{4})(?=\d)/g, "$1 ")
  if (def.kind === "date" && DATE_RE.test(v)) {
    const [y, m, d] = v.split("-")
    return `${d}.${m}.${y}`
  }
  return v
}

/**
 * PURE. Validate a patch { key: raw } against the entity's fields. Unknown
 * keys are an error. Returns the normalised values or the error per key.
 */
export function validateStandardPatch(
  entity: CustomFieldEntity,
  patch: Record<string, unknown>,
  today?: string,
): { ok: true; values: StandardValues } | { ok: false; errors: Record<string, string> } {
  const defs = new Map(standardFieldsOf(entity).map((d) => [d.key, d]))
  const values: StandardValues = {}
  const errors: Record<string, string> = {}
  for (const [key, raw] of Object.entries(patch)) {
    const def = defs.get(key)
    if (!def) {
      errors[key] = `Неизвестное поле «${key}»`
      continue
    }
    const check = validateStandardValue(def, raw, today)
    if (check.ok) values[key] = check.value
    else errors[key] = check.message
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, values }
}

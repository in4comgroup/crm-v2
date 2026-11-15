// Client system bag — `client.custom_fields` (jsonb). It holds only the
// keys the code itself reads: `discount` and `companyKind` (+ the
// server-controlled handover note). Org-defined fields live in
// `client.custom_values` (src/lib/custom-fields.ts); the old hard-coded
// `type` key of one org was converted into an org «Тип клиента» field
// (spec docs/specs/clients-contacts, decision Q12).
//
// This module is client-safe (no "server-only", no DB imports) so the edit
// form, the server functions, and the schema's `$type<>()` can all share it.

/**
 * Manual company-relationship tag — distinguishes a company with no deal
 * history (a supplier we buy from vs. a partner we collaborate with) since
 * deal state alone can't tell them apart. Available to ALL orgs. See the
 * "Компании" page's tabs (`src/server/clients.ts` → `listClientsFeed`).
 */
export const COMPANY_KIND_VALUES = ["supplier", "partner"] as const

export type CompanyKind = (typeof COMPANY_KIND_VALUES)[number]

export const COMPANY_KIND_LABELS: Record<CompanyKind, string> = {
  supplier: "Поставщик",
  partner: "Партнёр",
}

/** Narrowing guard for an arbitrary value against `CompanyKind`. */
export function isCompanyKind(value: unknown): value is CompanyKind {
  return (
    typeof value === "string" &&
    (COMPANY_KIND_VALUES as readonly string[]).includes(value)
  )
}

/** Extensible per-client custom-fields bag stored as jsonb. */
export type ClientCustomFields = {
  /**
   * Per-client discount, a whole percentage 0–100. Applied to the catalog
   * subtotal of every order placed for this client (snapshotted onto the order
   * at save time). Absent / 0 = no discount. Available to ALL orgs.
   */
  discount?: number
  /** See `CompanyKind` above. Unset = auto-classified from deal state instead. */
  companyKind?: CompanyKind
} & Record<string, unknown>

/** Upper bound for the client discount percentage. */
export const MAX_DISCOUNT_PERCENT = 100

/**
 * Normalise an arbitrary value into a whole discount percentage in [1, 100], or
 * `null` when unset / invalid / ≤ 0. Whole numbers only (rounded). `null` is the
 * "no discount" signal — the key is then omitted from the custom-fields bag.
 */
export function normalizeDiscountPercent(raw: unknown): number | null {
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number(raw)
        : NaN
  if (!Number.isFinite(n)) return null
  const v = Math.round(n)
  if (v <= 0) return null
  return Math.min(v, MAX_DISCOUNT_PERCENT)
}

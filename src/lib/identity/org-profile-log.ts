// Own organization profile — canonical form + change diff (identity spec I1,
// §3.1 D). PURE, client-safe: the server writes one `org_profile_log` row with
// the before / after of the CHANGED fields only; the «История изменений» list
// on /account renders the same shape with the labels below.

import {
  MARKET_ROLES,
  MARKET_ROLE_LABELS_RU,
  type MarketRole,
  type OrgProfileInput,
} from "@/lib/identity/org-profile"

export type OrgProfileField = keyof OrgProfileInput

export const ORG_PROFILE_FIELDS: OrgProfileField[] = [
  "description",
  "industryCode",
  "industryNote",
  "marketRoles",
  "products",
  "targetCustomers",
  "supplierTypes",
  "geography",
  "glossary",
  "noOwnDomain",
]

export const ORG_PROFILE_FIELD_LABELS_RU: Record<OrgProfileField, string> = {
  description: "Чем занимается компания",
  industryCode: "Отрасль",
  industryNote: "Комментарий к отрасли",
  marketRoles: "Роль на рынке",
  products: "Продукты и услуги",
  targetCustomers: "Наши клиенты",
  supplierTypes: "Кто продаёт нам",
  geography: "География",
  glossary: "Наши термины",
  noOwnDomain: "Нет своего домена",
}

const textOrNull = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim()
  return t ? t : null
}

type Line = { name: string; description?: string }

function cleanLine<T extends Line>(l: T): T {
  const out = { ...l, name: l.name.trim() }
  const d = (l.description ?? "").trim()
  if (d) out.description = d
  else delete out.description
  return out
}

/**
 * Canonical form of a profile: trimmed texts, empty text → null, empty line
 * descriptions / category lists dropped, roles deduped in the MARKET_ROLES
 * order. Two equal profiles always serialise the same, so the diff below never
 * logs a no-op save.
 */
export function canonicalOrgProfile(p: OrgProfileInput): OrgProfileInput {
  const roles = new Set<MarketRole>(p.marketRoles)
  return {
    description: textOrNull(p.description),
    industryCode: textOrNull(p.industryCode),
    industryNote: textOrNull(p.industryNote),
    marketRoles: MARKET_ROLES.filter((r) => roles.has(r)),
    products: p.products
      .filter((l) => l.name.trim())
      .map((l) => {
        const out = cleanLine(l)
        const cats = [...new Set((l.categories ?? []).map((c) => c.trim()).filter(Boolean))]
        if (cats.length > 0) out.categories = cats
        else delete out.categories
        return out
      }),
    targetCustomers: p.targetCustomers.filter((l) => l.name.trim()).map(cleanLine),
    supplierTypes: p.supplierTypes.filter((l) => l.name.trim()).map(cleanLine),
    geography: textOrNull(p.geography),
    glossary: p.glossary
      .map((g) => ({ term: g.term.trim(), meaning: g.meaning.trim() }))
      .filter((g) => g.term && g.meaning),
    noOwnDomain: !!p.noOwnDomain,
  }
}

export type OrgProfileDiff = {
  changed: OrgProfileField[]
  before: Partial<OrgProfileInput>
  after: Partial<OrgProfileInput>
}

/** PURE. Fields whose canonical value differs; before / after hold only those. */
export function diffOrgProfile(before: OrgProfileInput, after: OrgProfileInput): OrgProfileDiff {
  const a = canonicalOrgProfile(before)
  const b = canonicalOrgProfile(after)
  const out: OrgProfileDiff = { changed: [], before: {}, after: {} }
  for (const f of ORG_PROFILE_FIELDS) {
    if (JSON.stringify(a[f]) === JSON.stringify(b[f])) continue
    out.changed.push(f)
    ;(out.before as Record<string, unknown>)[f] = a[f]
    ;(out.after as Record<string, unknown>)[f] = b[f]
  }
  return out
}

/** Short Russian rendering of one logged value (history list). */
export function formatProfileValue(
  field: OrgProfileField,
  value: unknown,
  industryLabels?: Record<string, string>,
): string {
  if (value === null || value === undefined) return "—"
  if (field === "noOwnDomain") return value ? "да" : "нет"
  if (field === "industryCode") return industryLabels?.[String(value)] ?? String(value)
  if (field === "marketRoles" && Array.isArray(value)) {
    return value.length
      ? value.map((r) => MARKET_ROLE_LABELS_RU[r as MarketRole] ?? String(r)).join(", ")
      : "—"
  }
  if (field === "glossary" && Array.isArray(value)) {
    return value.length ? value.map((g) => `${g.term} — ${g.meaning}`).join("; ") : "—"
  }
  if (Array.isArray(value)) {
    return value.length ? value.map((l) => (l as Line).name).join(", ") : "—"
  }
  return String(value)
}

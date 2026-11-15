// Client-safe contract of the own organization profile (identity spec I1,
// docs/specs/identity/01-specification.md §3). Shared by the server
// (src/server/identity/*), the /account tab «Профиль организации», the
// gate before topics `shadow` / `on` (I3) and the prompt card (I4).
// No DB, no server imports.

import { z } from "zod"

// ── Value lists ───────────────────────────────────────────────────────────

/** «Роль на рынке» (org and, later, client profiles). */
export const MARKET_ROLES = [
  "manufacturer",
  "importer",
  "distributor",
  "retail",
  "ecommerce",
  "agency",
  "services",
  "it_saas",
  "other",
] as const
export type MarketRole = (typeof MARKET_ROLES)[number]

export const MARKET_ROLE_LABELS_RU: Record<MarketRole, string> = {
  manufacturer: "Производитель",
  importer: "Импортёр",
  distributor: "Дистрибьютор / оптовик",
  retail: "Розница",
  ecommerce: "Интернет-магазин",
  agency: "Агентство",
  services: "Услуги / консалтинг",
  it_saas: "ИТ / SaaS",
  other: "Другое",
}

/** Channels of a staff member's extra address (registry kind `person`). */
export const PERSON_CHANNELS = ["email", "telegram", "phone"] as const
export type PersonChannel = (typeof PERSON_CHANNELS)[number]

export const PERSON_CHANNEL_LABELS_RU: Record<PersonChannel, string> = {
  email: "Email",
  telegram: "Telegram",
  phone: "Телефон",
}

// ── Limits ────────────────────────────────────────────────────────────────

export const ORG_PROFILE_LIMITS = {
  description: 500,
  industryNote: 200,
  geography: 200,
  lineName: 120,
  lineDescription: 200,
  products: 30,
  targetCustomers: 10,
  supplierTypes: 10,
  glossary: 30,
  term: 60,
  meaning: 200,
} as const

const L = ORG_PROFILE_LIMITS
const trimmed = (max: number) => z.string().trim().max(max)
const line = z.object({
  name: trimmed(L.lineName).min(1, "Название не может быть пустым"),
  description: trimmed(L.lineDescription).optional(),
})

/** Input of a profile save (owner). Unknown keys are dropped. */
export const orgProfileInputSchema = z.object({
  description: trimmed(L.description).nullable(),
  industryCode: z.string().trim().max(64).nullable(),
  industryNote: trimmed(L.industryNote).nullable(),
  marketRoles: z.array(z.enum(MARKET_ROLES)).max(MARKET_ROLES.length),
  products: z
    .array(line.extend({ categories: z.array(z.string().trim().max(200)).max(20).optional() }))
    .max(L.products),
  targetCustomers: z.array(line).max(L.targetCustomers),
  supplierTypes: z.array(line).max(L.supplierTypes),
  geography: trimmed(L.geography).nullable(),
  glossary: z
    .array(z.object({ term: trimmed(L.term).min(1), meaning: trimmed(L.meaning).min(1) }))
    .max(L.glossary),
  noOwnDomain: z.boolean(),
})
export type OrgProfileInput = z.infer<typeof orgProfileInputSchema>

export const EMPTY_ORG_PROFILE: OrgProfileInput = {
  description: null,
  industryCode: null,
  industryNote: null,
  marketRoles: [],
  products: [],
  targetCustomers: [],
  supplierTypes: [],
  geography: null,
  glossary: [],
  noOwnDomain: false,
}

// ── Mandatory minimum (spec §3.3) ─────────────────────────────────────────

export const COMPLETENESS_ITEMS = [
  "name",
  "domain",
  "description",
  "industryRole",
  "products",
  "customers",
] as const
export type CompletenessItem = (typeof COMPLETENESS_ITEMS)[number]

export const COMPLETENESS_LABELS_RU: Record<CompletenessItem, string> = {
  name: "Название организации",
  domain: "Свой домен (сайт или почтовый) — или отметка «Нет своего домена»",
  description: "«Чем занимается компания»",
  industryRole: "«Отрасль» и «Роль на рынке»",
  products: "Хотя бы один пункт в «Продукты и услуги»",
  customers: "Хотя бы один пункт в «Наши клиенты»",
}

export type CompletenessInput = {
  orgName: string | null
  /** Own domains: website host, registry websites / email domains, non-freemail org email domain. */
  ownDomainCount: number
  profile: Pick<
    OrgProfileInput,
    "description" | "industryCode" | "marketRoles" | "products" | "targetCustomers" | "noOwnDomain"
  >
}

export type Completeness = {
  done: number
  total: number
  complete: boolean
  missing: CompletenessItem[]
}

/** PURE. The 6 items of the mandatory minimum (identity spec §3.3). */
export function profileCompleteness(i: CompletenessInput): Completeness {
  const ok: Record<CompletenessItem, boolean> = {
    name: !!i.orgName?.trim(),
    domain: i.ownDomainCount > 0 || i.profile.noOwnDomain,
    description: !!i.profile.description?.trim(),
    industryRole: !!i.profile.industryCode && i.profile.marketRoles.length > 0,
    products: i.profile.products.some((p) => p.name.trim().length > 0),
    customers: i.profile.targetCustomers.some((p) => p.name.trim().length > 0),
  }
  const missing = COMPLETENESS_ITEMS.filter((k) => !ok[k])
  return { done: COMPLETENESS_ITEMS.length - missing.length, total: COMPLETENESS_ITEMS.length, complete: missing.length === 0, missing }
}

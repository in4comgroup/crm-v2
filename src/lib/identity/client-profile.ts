// Client-safe contract of the client business profile «Профиль компании»
// (identity spec I5 / I6, docs/specs/identity/01-specification.md §4).
// Shared by the server (src/server/identity/client-profile*.ts), the company
// drawer block, the Companies page filters, web enrichment (I6) and the
// prompts (card writer, deal state, extraction counterparty line).
// No DB, no server imports.

import { z } from "zod"
import { MARKET_ROLE_LABELS_RU, MARKET_ROLES, type MarketRole } from "@/lib/identity/org-profile"

// ── Value lists ───────────────────────────────────────────────────────────

/** «Размер» bands. `chain` = сеть (N точек) with `pointsOfSale`. */
export const CLIENT_SIZE_BANDS = ["micro", "small", "medium", "large", "chain"] as const
export type ClientSizeBand = (typeof CLIENT_SIZE_BANDS)[number]

export const CLIENT_SIZE_LABELS_RU: Record<ClientSizeBand, string> = {
  micro: "Микро",
  small: "Малый",
  medium: "Средний",
  large: "Крупный",
  chain: "Сеть",
}

/** Where a stored value came from (spec §4.1 provenance). */
export const PROFILE_SOURCES = ["manual", "web", "communications", "import"] as const
export type ProfileSource = (typeof PROFILE_SOURCES)[number]

export const PROFILE_CONFIDENCES = ["high", "medium", "low"] as const
export type ProfileConfidence = (typeof PROFILE_CONFIDENCES)[number]

/** The profile fields that carry provenance (one `field_meta` key each). */
export const CLIENT_PROFILE_FIELDS = [
  "description",
  "industry", // industryCode + industryNote
  "marketRoles",
  "products",
  "needs",
  "size", // sizeBand + pointsOfSale
  "geography",
] as const
export type ClientProfileField = (typeof CLIENT_PROFILE_FIELDS)[number]

export const CLIENT_PROFILE_FIELD_LABELS_RU: Record<ClientProfileField, string> = {
  description: "Чем занимается",
  industry: "Отрасль",
  marketRoles: "Роль на рынке",
  products: "Продукты и услуги клиента",
  needs: "Что им интересно у нас",
  size: "Размер",
  geography: "География",
}

export type FieldMeta = {
  source: ProfileSource
  byUserId?: string | null
  /** ISO time of the write. */
  at: string
  confidence?: ProfileConfidence | null
  evidenceUrl?: string | null
  /** Manual values are verified; web values stay unverified until confirmed. */
  verified: boolean
  /** Who confirmed an automatic value («Подтвердить» / accepted proposal), and when. */
  verifiedByUserId?: string | null
  verifiedAt?: string | null
}

export const fieldMetaSchema = z.object({
  source: z.enum(PROFILE_SOURCES),
  byUserId: z.string().nullable().optional(),
  at: z.string(),
  confidence: z.enum(PROFILE_CONFIDENCES).nullable().optional(),
  evidenceUrl: z.string().nullable().optional(),
  verified: z.boolean(),
  verifiedByUserId: z.string().nullable().optional(),
  verifiedAt: z.string().nullable().optional(),
})

/** Read `field_meta` jsonb defensively (bad entries are dropped). */
export function readFieldMeta(raw: unknown): Partial<Record<ClientProfileField, FieldMeta>> {
  const out: Partial<Record<ClientProfileField, FieldMeta>> = {}
  if (!raw || typeof raw !== "object") return out
  for (const f of CLIENT_PROFILE_FIELDS) {
    const parsed = fieldMetaSchema.safeParse((raw as Record<string, unknown>)[f])
    if (parsed.success) out[f] = parsed.data
  }
  return out
}

// ── Limits + input ────────────────────────────────────────────────────────

export const CLIENT_PROFILE_LIMITS = {
  description: 500,
  industryNote: 200,
  geography: 200,
  products: 15,
  productName: 120,
  needsLines: 30,
  needsNote: 300,
  pointsOfSaleMax: 1_000_000,
} as const

const L = CLIENT_PROFILE_LIMITS
const trimmed = (max: number) => z.string().trim().max(max)

/** The profile values (no provenance). */
export const clientProfileValuesSchema = z.object({
  description: trimmed(L.description).nullable(),
  industryCode: z.string().trim().max(64).nullable(),
  industryNote: trimmed(L.industryNote).nullable(),
  marketRoles: z.array(z.enum(MARKET_ROLES)).max(MARKET_ROLES.length),
  products: z.array(z.object({ name: trimmed(L.productName).min(1) })).max(L.products),
  needs: z.object({
    lines: z.array(trimmed(120).min(1)).max(L.needsLines),
    note: trimmed(L.needsNote).optional(),
  }),
  sizeBand: z.enum(CLIENT_SIZE_BANDS).nullable(),
  pointsOfSale: z.number().int().min(1).max(L.pointsOfSaleMax).nullable(),
  geography: trimmed(L.geography).nullable(),
})
export type ClientProfileValues = z.infer<typeof clientProfileValuesSchema>

export const EMPTY_CLIENT_PROFILE: ClientProfileValues = {
  description: null,
  industryCode: null,
  industryNote: null,
  marketRoles: [],
  products: [],
  needs: { lines: [] },
  sizeBand: null,
  pointsOfSale: null,
  geography: null,
}

/** PURE. Is the field empty (so web data may fill it, spec §4.3 / Q5)? */
export function isFieldEmpty(v: ClientProfileValues, f: ClientProfileField): boolean {
  switch (f) {
    case "description":
      return !v.description?.trim()
    case "industry":
      return !v.industryCode && !v.industryNote?.trim()
    case "marketRoles":
      return v.marketRoles.length === 0
    case "products":
      return v.products.length === 0
    case "needs":
      return v.needs.lines.length === 0 && !v.needs.note?.trim()
    case "size":
      return !v.sizeBand && v.pointsOfSale == null
    case "geography":
      return !v.geography?.trim()
  }
}

// ── Prompt texts (spec §4.5) ──────────────────────────────────────────────

export const CLIENT_SUMMARY_MAX_CHARS = 400
const UNVERIFIED = " (не проверено)"

export type ClientSummaryInput = {
  name: string
  values: ClientProfileValues
  meta: Partial<Record<ClientProfileField, FieldMeta>>
  industryLabel: string | null
  /** Derived segment A / B / C (12-month revenue), null = none. */
  segment?: "A" | "B" | "C" | null
}

function clean(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim()
}

function firstSentence(s: string): string {
  const t = clean(s)
  const m = t.match(/^(.+?[.!?…])(\s|$)/)
  return m ? m[1] : t
}

function sizeText(v: ClientProfileValues): string {
  if (!v.sizeBand) return v.pointsOfSale ? `${v.pointsOfSale} точек` : ""
  const label = CLIENT_SIZE_LABELS_RU[v.sizeBand].toLowerCase()
  return v.sizeBand === "chain" && v.pointsOfSale ? `${label} (${v.pointsOfSale} точек)` : label
}

function rolesText(v: ClientProfileValues): string {
  return v.marketRoles.map((r) => MARKET_ROLE_LABELS_RU[r as MarketRole] ?? r).join(", ")
}

function industryText(v: ClientProfileValues, label: string | null): string {
  const l = clean(label)
  const n = clean(v.industryNote)
  return l && n ? `${l} (${n})` : l || n
}

/**
 * PURE, deterministic. «Профиль клиента» summary for the card writer and the
 * deal state (spec §4.5): name, отрасль, роль, 1-sentence description, size,
 * segment, needs. Verified values first; unverified ones marked
 * «(не проверено)». ≤ 400 characters. "" when the profile says nothing.
 */
export function clientProfileSummary(input: ClientSummaryInput): string {
  const v = input.values
  const unv = (f: ClientProfileField) => (input.meta[f] && !input.meta[f]!.verified ? UNVERIFIED : "")
  type Part = { text: string; verified: boolean }
  const parts: Part[] = []
  const push = (f: ClientProfileField, label: string, text: string) => {
    const t = clean(text)
    if (!t) return
    parts.push({ text: `${label}: ${t}${unv(f)}`, verified: !unv(f) })
  }
  push("industry", "отрасль", industryText(v, input.industryLabel))
  push("marketRoles", "роль", rolesText(v))
  push("description", "чем занимается", firstSentence(v.description ?? ""))
  push("size", "размер", sizeText(v))
  if (input.segment) parts.push({ text: `сегмент: ${input.segment}`, verified: true })
  const needs = [...v.needs.lines, clean(v.needs.note)].filter(Boolean).join("; ")
  push("needs", "интересно у нас", needs)
  if (parts.length === 0) return ""

  // Verified first, stable order otherwise.
  const ordered = [...parts.filter((p) => p.verified), ...parts.filter((p) => !p.verified)]
  const head = `Профиль клиента «${clean(input.name)}»: `
  let body = ordered.map((p) => p.text).join("; ")
  while (head.length + body.length + 1 > CLIENT_SUMMARY_MAX_CHARS && ordered.length > 1) {
    ordered.pop()
    body = ordered.map((p) => p.text).join("; ")
  }
  const text = `${head}${body}.`
  return text.length > CLIENT_SUMMARY_MAX_CHARS
    ? `${text.slice(0, CLIENT_SUMMARY_MAX_CHARS - 1).trimEnd()}…`
    : text
}

/**
 * PURE. The short counterparty line of the extraction envelope (spec §4.5):
 * «Контрагент: <name> — <отрасль>, <роль>». "" when neither is known.
 * Unverified values are left out (the line is per item and must stay short).
 */
export function counterpartyProfileLine(input: Omit<ClientSummaryInput, "segment">): string {
  const v = input.values
  const ok = (f: ClientProfileField) => !input.meta[f] || input.meta[f]!.verified
  const bits = [
    ok("industry") ? industryText(v, input.industryLabel) : "",
    ok("marketRoles") ? rolesText(v) : "",
  ].filter(Boolean)
  if (bits.length === 0) return ""
  return `Контрагент: ${clean(input.name)} — ${bits.join(", ")}`
}

// PURE rules of the client business profile writes (identity spec I5 / I6,
// docs/specs/identity/01-specification.md §4.1–§4.3, decisions Q3 / Q5).
// Client-safe, no DB:
//   - per-field value slices + canonical equality (`fieldSlice`,
//     `sameFieldValue`, `withFieldValue`, `canonicalClientProfile`,
//     `changedProfileFields`) — the manual save writes provenance only for the
//     CHANGED fields;
//   - `normalizeWebProfile`: the raw profile part of the web-enrichment extract
//     → validated per-field candidates (unknown industry codes / roles /
//     sizes dropped, limits applied, source URL kept only when http(s));
//   - `planWebProfileApply`: the apply rule of §4.3 / Q5 — an EMPTY field is
//     filled at once (`source: web`, `verified: false`), a field with a value
//     gets a PROPOSAL (an older pending proposal of the same field is
//     superseded; an identical value / identical pending proposal = nothing).
//     Automatic data NEVER overwrites a value. A `low` confidence value is a
//     proposal only, never an auto-fill.

import {
  CLIENT_PROFILE_FIELDS,
  CLIENT_PROFILE_LIMITS as L,
  CLIENT_SIZE_BANDS,
  isFieldEmpty,
  type ClientProfileField,
  type ClientProfileValues,
  type ClientSizeBand,
  type FieldMeta,
  type ProfileConfidence,
  type ProfileSource,
} from "@/lib/identity/client-profile"
import { MARKET_ROLES, type MarketRole } from "@/lib/identity/org-profile"

// ── Field slices ──────────────────────────────────────────────────────────

/** The value keys of `ClientProfileValues` that belong to each provenance field. */
export const FIELD_KEYS: Record<ClientProfileField, (keyof ClientProfileValues)[]> = {
  description: ["description"],
  industry: ["industryCode", "industryNote"],
  marketRoles: ["marketRoles"],
  products: ["products"],
  needs: ["needs"],
  size: ["sizeBand", "pointsOfSale"],
  geography: ["geography"],
}

/** The fields web enrichment may fill (needs = what they want FROM US — never from the web). */
export const WEB_PROFILE_FIELDS = [
  "description",
  "industry",
  "marketRoles",
  "products",
  "size",
  "geography",
] as const satisfies readonly ClientProfileField[]

export type FieldSlice = Partial<ClientProfileValues>

function cleanText(s: string | null | undefined, max: number): string | null {
  const t = (s ?? "").replace(/\s+/g, " ").trim()
  if (!t) return null
  return t.length > max ? t.slice(0, max).trimEnd() : t
}

function cleanMultiline(s: string | null | undefined, max: number): string | null {
  const t = (s ?? "")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  if (!t) return null
  return t.length > max ? t.slice(0, max).trimEnd() : t
}

function dedupeNames(names: readonly string[], max: number, maxLen: number): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const n of names) {
    const t = cleanText(n, maxLen)
    if (!t) continue
    const k = t.toLowerCase().replace(/ё/g, "е")
    if (seen.has(k)) continue
    seen.add(k)
    out.push(t)
    if (out.length >= max) break
  }
  return out
}

/** PURE. Canonical form: trimmed, empty → null, roles in list order, lines deduped. */
export function canonicalClientProfile(v: ClientProfileValues): ClientProfileValues {
  const roles = MARKET_ROLES.filter((r) => v.marketRoles.includes(r))
  const note = cleanText(v.needs.note, L.needsNote)
  const sizeBand = v.sizeBand && (CLIENT_SIZE_BANDS as readonly string[]).includes(v.sizeBand) ? v.sizeBand : null
  return {
    description: cleanMultiline(v.description, L.description),
    industryCode: cleanText(v.industryCode, 64),
    industryNote: cleanText(v.industryNote, L.industryNote),
    marketRoles: roles,
    products: dedupeNames(
      v.products.map((p) => p.name),
      L.products,
      L.productName,
    ).map((name) => ({ name })),
    needs: { lines: dedupeNames(v.needs.lines, L.needsLines, 120), ...(note ? { note } : {}) },
    sizeBand,
    pointsOfSale:
      v.pointsOfSale != null && Number.isInteger(v.pointsOfSale) && v.pointsOfSale >= 1 && v.pointsOfSale <= L.pointsOfSaleMax
        ? v.pointsOfSale
        : null,
    geography: cleanText(v.geography, L.geography),
  }
}

/** PURE. The value slice of one field (only its keys). */
export function fieldSlice(v: ClientProfileValues, f: ClientProfileField): FieldSlice {
  const out: Record<string, unknown> = {}
  for (const k of FIELD_KEYS[f]) out[k] = v[k]
  return out as FieldSlice
}

/** PURE. Comparison key of a field value (case / spacing / order-insensitive where it does not matter). */
export function fieldKey(v: ClientProfileValues, f: ClientProfileField): string {
  const c = canonicalClientProfile(v)
  const low = (s: string | null) => (s ?? "").toLowerCase().replace(/ё/g, "е")
  switch (f) {
    case "description":
      return low(c.description)
    case "industry":
      return `${c.industryCode ?? ""}|${low(c.industryNote)}`
    case "marketRoles":
      return c.marketRoles.join(",")
    case "products":
      return c.products
        .map((p) => low(p.name))
        .sort()
        .join("|")
    case "needs":
      return `${c.needs.lines.map(low).sort().join("|")}#${low(c.needs.note ?? null)}`
    case "size":
      return `${c.sizeBand ?? ""}|${c.pointsOfSale ?? ""}`
    case "geography":
      return low(c.geography)
  }
}

/** PURE. Apply one field slice onto the values (missing keys of the slice = empty). */
export function withFieldValue(v: ClientProfileValues, f: ClientProfileField, slice: FieldSlice): ClientProfileValues {
  const next = { ...v, needs: { ...v.needs } } as ClientProfileValues
  const s = slice as Record<string, unknown>
  switch (f) {
    case "description":
      next.description = typeof s.description === "string" ? s.description : null
      break
    case "industry":
      next.industryCode = typeof s.industryCode === "string" ? s.industryCode : null
      next.industryNote = typeof s.industryNote === "string" ? s.industryNote : null
      break
    case "marketRoles":
      next.marketRoles = Array.isArray(s.marketRoles)
        ? (s.marketRoles as unknown[]).filter((r): r is MarketRole => (MARKET_ROLES as readonly unknown[]).includes(r))
        : []
      break
    case "products":
      next.products = Array.isArray(s.products)
        ? (s.products as unknown[])
            .map((p) => (p && typeof p === "object" ? (p as { name?: unknown }).name : null))
            .filter((n): n is string => typeof n === "string" && !!n.trim())
            .map((name) => ({ name }))
        : []
      break
    case "needs": {
      const n = (s.needs ?? {}) as { lines?: unknown; note?: unknown }
      next.needs = {
        lines: Array.isArray(n.lines) ? n.lines.filter((x): x is string => typeof x === "string") : [],
        ...(typeof n.note === "string" && n.note.trim() ? { note: n.note } : {}),
      }
      break
    }
    case "size":
      next.sizeBand =
        typeof s.sizeBand === "string" && (CLIENT_SIZE_BANDS as readonly string[]).includes(s.sizeBand)
          ? (s.sizeBand as ClientSizeBand)
          : null
      next.pointsOfSale = typeof s.pointsOfSale === "number" ? s.pointsOfSale : null
      break
    case "geography":
      next.geography = typeof s.geography === "string" ? s.geography : null
      break
  }
  return canonicalClientProfile(next)
}

export function sameFieldValue(a: ClientProfileValues, b: ClientProfileValues, f: ClientProfileField): boolean {
  return fieldKey(a, f) === fieldKey(b, f)
}

/** PURE. Fields whose canonical value differs (the manual save stamps only these). */
export function changedProfileFields(before: ClientProfileValues, after: ClientProfileValues): ClientProfileField[] {
  return CLIENT_PROFILE_FIELDS.filter((f) => !sameFieldValue(before, after, f))
}

// ── Manual save → provenance ──────────────────────────────────────────────

/**
 * PURE. New `field_meta` after a manual save: each CHANGED field that now has
 * a value → `{ source: manual, byUserId, at, verified: true }`; a changed
 * field that became empty loses its meta; other fields keep theirs.
 */
export function manualSaveMeta(
  before: ClientProfileValues,
  after: ClientProfileValues,
  meta: Partial<Record<ClientProfileField, FieldMeta>>,
  userId: string,
  at: string,
): { meta: Partial<Record<ClientProfileField, FieldMeta>>; changed: ClientProfileField[] } {
  const changed = changedProfileFields(before, after)
  const next: Partial<Record<ClientProfileField, FieldMeta>> = { ...meta }
  for (const f of changed) {
    if (isFieldEmpty(after, f)) delete next[f]
    else next[f] = { source: "manual", byUserId: userId, at, verified: true }
  }
  return { meta: next, changed }
}

// ── Web enrichment: raw extract → candidates ──────────────────────────────

/** The profile part of one web-lookup candidate, as the extract model returns it. */
export type RawWebProfile = {
  description?: { value?: string; confidence?: string; sourceUrl?: string } | null
  industry?: { code?: string; note?: string; confidence?: string; sourceUrl?: string } | null
  marketRoles?: { values?: string[]; confidence?: string; sourceUrl?: string } | null
  products?: { names?: string[]; confidence?: string; sourceUrl?: string } | null
  size?: { band?: string; pointsOfSale?: number | null; confidence?: string; sourceUrl?: string } | null
  geography?: { value?: string; confidence?: string; sourceUrl?: string } | null
}

/** One web value for one field, ready for the apply rule. */
export type WebProfileCandidate = {
  field: ClientProfileField
  value: FieldSlice
  confidence: ProfileConfidence
  evidenceUrl: string | null
}

const CONF_RANK: Record<ProfileConfidence, number> = { low: 0, medium: 1, high: 2 }

function readConfidence(raw: unknown): ProfileConfidence {
  return raw === "high" || raw === "medium" || raw === "low" ? raw : "low"
}

/** PURE. The weaker of two confidences (field confidence capped by the candidate match). */
export function minConfidence(a: ProfileConfidence, b: ProfileConfidence): ProfileConfidence {
  return CONF_RANK[a] <= CONF_RANK[b] ? a : b
}

function readUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const t = raw.trim()
  if (!/^https?:\/\/[^\s]+$/i.test(t) || t.length > 1000) return null
  return t
}

/**
 * PURE. Validate the raw profile part: unknown industry codes, roles and
 * size bands are dropped, texts trimmed to the limits, empty values left out.
 * `capConfidence` = the match confidence of the candidate (a field is never
 * more certain than the company match).
 */
export function normalizeWebProfile(
  raw: RawWebProfile | null | undefined,
  opts: { industryCodes: ReadonlySet<string>; capConfidence?: ProfileConfidence },
): WebProfileCandidate[] {
  if (!raw) return []
  const out: WebProfileCandidate[] = []
  const cap = opts.capConfidence ?? "high"
  const push = (field: ClientProfileField, value: FieldSlice, part: { confidence?: string; sourceUrl?: string }) => {
    out.push({
      field,
      value,
      confidence: minConfidence(readConfidence(part.confidence), cap),
      evidenceUrl: readUrl(part.sourceUrl),
    })
  }

  const d = raw.description
  const desc = d ? cleanMultiline(d.value, L.description) : null
  if (d && desc) push("description", { description: desc }, d)

  const ind = raw.industry
  if (ind) {
    const code = typeof ind.code === "string" && opts.industryCodes.has(ind.code.trim()) ? ind.code.trim() : null
    const note = cleanText(ind.note, L.industryNote)
    if (code) push("industry", { industryCode: code, industryNote: note }, ind)
  }

  const roles = raw.marketRoles
  if (roles && Array.isArray(roles.values)) {
    const vals = MARKET_ROLES.filter((r) => roles.values!.includes(r))
    if (vals.length > 0) push("marketRoles", { marketRoles: vals }, roles)
  }

  const prod = raw.products
  if (prod && Array.isArray(prod.names)) {
    const names = dedupeNames(prod.names, L.products, L.productName)
    if (names.length > 0) push("products", { products: names.map((name) => ({ name })) }, prod)
  }

  const size = raw.size
  if (size) {
    const band =
      typeof size.band === "string" && (CLIENT_SIZE_BANDS as readonly string[]).includes(size.band.trim())
        ? (size.band.trim() as ClientSizeBand)
        : null
    const pos =
      typeof size.pointsOfSale === "number" &&
      Number.isInteger(size.pointsOfSale) &&
      size.pointsOfSale >= 1 &&
      size.pointsOfSale <= L.pointsOfSaleMax
        ? size.pointsOfSale
        : null
    if (band) push("size", { sizeBand: band, pointsOfSale: pos }, size)
  }

  const geo = raw.geography
  const geoText = geo ? cleanText(geo.value, L.geography) : null
  if (geo && geoText) push("geography", { geography: geoText }, geo)

  return out
}

// ── Web enrichment: the apply rule ────────────────────────────────────────

export type PendingProposalRef = { id: string; field: string; value: unknown }

export type WebApplyPlan = {
  /** New values (only empty fields filled). */
  values: ClientProfileValues
  meta: Partial<Record<ClientProfileField, FieldMeta>>
  /** Fields written now (unverified). */
  filled: ClientProfileField[]
  /** New pending proposals. */
  proposals: WebProfileCandidate[]
  /** Ids of older pending proposals replaced by a new one of the same field. */
  supersede: string[]
  /** Fields where the web value equals the stored value or a pending proposal. */
  unchanged: ClientProfileField[]
}

/**
 * PURE. The apply rule (spec §4.3, Q5):
 *  - web value = the stored value → nothing;
 *  - EMPTY field and confidence ≠ low → write it, meta `{ source, confidence,
 *    evidenceUrl, verified: false, at }`;
 *  - EMPTY field whose automatic value a person removed («Убрать», meta
 *    `removedKey`) and the web brings the SAME value again → nothing;
 *  - otherwise (field has a value — manual or earlier web — or confidence
 *    `low`) → a pending proposal; an identical pending proposal of that field
 *    → nothing; a different pending one → superseded by the new one.
 * Automatic data never overwrites a stored value.
 */
export function planWebProfileApply(args: {
  values: ClientProfileValues
  meta: Partial<Record<ClientProfileField, FieldMeta>>
  pending: readonly PendingProposalRef[]
  incoming: readonly WebProfileCandidate[]
  at: string
  source?: ProfileSource
}): WebApplyPlan {
  const source = args.source ?? "web"
  let values = canonicalClientProfile(args.values)
  const meta = { ...args.meta }
  const plan: WebApplyPlan = { values, meta, filled: [], proposals: [], supersede: [], unchanged: [] }
  const seen = new Set<ClientProfileField>()

  for (const c of args.incoming) {
    if (seen.has(c.field)) continue // one value per field per run
    seen.add(c.field)
    const proposed = withFieldValue(values, c.field, c.value)
    if (isFieldEmpty(proposed, c.field)) continue
    if (sameFieldValue(values, proposed, c.field)) {
      plan.unchanged.push(c.field)
      continue
    }
    // A person removed this very value with «Убрать»: do not write it again.
    if (isFieldEmpty(values, c.field) && meta[c.field]?.removedKey && meta[c.field]?.removedKey === fieldKey(proposed, c.field)) {
      plan.unchanged.push(c.field)
      continue
    }
    if (isFieldEmpty(values, c.field) && c.confidence !== "low") {
      values = proposed
      meta[c.field] = {
        source,
        at: args.at,
        confidence: c.confidence,
        evidenceUrl: c.evidenceUrl,
        verified: false,
      }
      plan.filled.push(c.field)
      continue
    }
    const pendingSame = args.pending.filter((p) => p.field === c.field)
    const identical = pendingSame.find((p) =>
      sameFieldValue(withFieldValue(values, c.field, (p.value ?? {}) as FieldSlice), proposed, c.field),
    )
    if (identical) {
      plan.unchanged.push(c.field)
      continue
    }
    for (const p of pendingSame) plan.supersede.push(p.id)
    plan.proposals.push({ ...c, value: fieldSlice(proposed, c.field) })
  }
  plan.values = values
  plan.meta = meta
  return plan
}

/** Profile older than this may be re-enriched (spec §4.3 refresh rule). */
export const WEB_REFRESH_DAYS = 180

/** PURE. A re-enrichment is due: never enriched, or the last one ≥ 180 days ago. */
export function webRefreshDue(webEnrichedAt: Date | string | null | undefined, now: Date): boolean {
  if (!webEnrichedAt) return true
  const t = new Date(webEnrichedAt).getTime()
  if (!Number.isFinite(t)) return true
  return now.getTime() - t >= WEB_REFRESH_DAYS * 24 * 60 * 60 * 1000
}

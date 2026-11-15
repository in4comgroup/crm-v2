// Reference numbers and topic titles (spec topics/01 §6.2 hard key, §6.3
// title). Pure, client-safe.

import { transliterateRu } from "@/lib/translit-ru"
import type { TopicReference } from "./types"

/**
 * Normalised value of a reference number. Cross-script and punctuation-proof:
 *   «№124», «124», «счёт 124», «Счет № 124» → "124"
 *   «INV-2024/0012» → "inv20240012"
 *   «УПД 4512» → "4512"
 * Rule: transliterate + lowercase; drop «№» / «#»; keep only the
 * whitespace-separated tokens that contain a digit (the words «счёт»,
 * «заказ», «invoice» … carry no identity); strip non-alphanumerics; strip
 * leading zeros of a pure number. A value without any digit keeps all its
 * letters («Договор поставки» → "dogovorpostavki"). "" for empty input.
 */
export function normaliseReferenceValue(raw: string): string {
  const s = transliterateRu(raw).replace(/[№#]/g, " ").trim()
  if (!s) return ""
  const tokens = s.split(/\s+/).filter(Boolean)
  const withDigits = tokens.filter((t) => /\d/.test(t))
  const kept = (withDigits.length ? withDigits : tokens).join("")
  let key = kept.replace(/[^\p{L}\p{N}]+/gu, "")
  if (/^\d+$/.test(key)) key = key.replace(/^0+(?=\d)/, "")
  return key
}

/** Normalised references (dedup by key). Empty values are dropped. */
export function normaliseReferences(
  refs: readonly { kind: string; value: string }[],
): TopicReference[] {
  const out: TopicReference[] = []
  const seen = new Set<string>()
  for (const r of refs) {
    const kind = (r.kind || "other").trim().toLowerCase()
    const v = normaliseReferenceValue(r.value)
    if (!v) continue
    const key = `${kind}:${v}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ kind, value: r.value.trim(), key })
  }
  return out
}

/** Union of two reference lists (dedup by key, order kept). */
export function mergeReferences(a: readonly TopicReference[], b: readonly TopicReference[]): TopicReference[] {
  const seen = new Set(a.map((r) => r.key))
  return [...a, ...b.filter((r) => !seen.has(r.key) && seen.add(r.key))]
}

/** True when the two lists share at least one reference (kind + value). */
export function sharesReference(a: readonly TopicReference[], b: readonly TopicReference[]): boolean {
  const keys = new Set(a.map((r) => r.key))
  return b.some((r) => keys.has(r.key))
}

/**
 * Conflicting references: both sides have references of one kind, and no
 * value of that kind is shared («счёт 124» vs «счёт 125»).
 */
export function referencesConflict(a: readonly TopicReference[], b: readonly TopicReference[]): boolean {
  const kinds = new Set(a.map((r) => r.kind))
  for (const kind of kinds) {
    const av = new Set(a.filter((r) => r.kind === kind).map((r) => r.key))
    const bv = b.filter((r) => r.kind === kind).map((r) => r.key)
    if (bv.length > 0 && !bv.some((k) => av.has(k))) return true
  }
  return false
}

// ── Titles (§6.3) ─────────────────────────────────────────────────────────

// Russian + common Western legal forms, as whole words.
const LEGAL_FORMS =
  /(^|[\s,])(ооо|оао|пао|зао|ао|ип|нко|гуп|муп|фгуп|ооо\s+тд|тд|ltd|llc|inc|gmbh|ag|s\.?a\.?|s\.?r\.?l\.?|s\.?p\.?a\.?|plc|corp|co)\.?(?=$|[\s,])/giu

/**
 * Short display name of a company: legal form and quotes removed, spacing
 * collapsed, original script and case kept.
 *   «ООО "Норлекс"» → «Норлекс»;  «АО «Квант-Сервис»» → «Квант-Сервис»;  «Globex GmbH» → «Globex»
 */
export function shortCompanyName(raw: string): string {
  let s = raw.replace(/["«»“”„']/g, " ")
  s = s.replace(LEGAL_FORMS, " ")
  s = s.replace(/\s+/g, " ").replace(/^[\s,–—-]+|[\s,–—-]+$/g, "").trim()
  return s || raw.trim()
}

/** Matter with the first letter in lower case unless it looks like a name / code. */
function matterText(matter: string): string {
  const m = matter.replace(/\s+/g, " ").trim()
  return m
}

/**
 * Display title «<Компания> — <matter>» (spec §6.3). Contact-only topics
 * use the person's name. Without a counterparty: just the matter. Never used
 * for matching.
 */
export function buildTopicTitle(args: {
  companyName?: string | null
  contactName?: string | null
  counterpartyRaw?: string | null
  matter: string
}): string {
  const who = args.companyName
    ? shortCompanyName(args.companyName)
    : args.contactName?.trim() || (args.counterpartyRaw ? shortCompanyName(args.counterpartyRaw) : "")
  const what = matterText(args.matter) || "без темы"
  const title = who ? `${who} — ${what}` : what
  return title.length > 200 ? `${title.slice(0, 199)}…` : title
}

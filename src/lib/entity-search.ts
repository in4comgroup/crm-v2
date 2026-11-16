// Cross-script FILTER matching for CRM entities in UI filter boxes (deals
// board client picker, document link picker). Pure string utilities — no DB,
// safe in client components.
//
// The normalisation is the SAME as the SQL search (Search V2,
// `src/server/search/normalise.ts`: `lower(immutable_unaccent(
// translit_cyr_lat(x)))`), so «Норлекс» finds «Norleks» and an em-dash finds
// an en-dash in a filter box too. There is deliberately NO fuzzy tail: a fuzzy
// row in a filter reads as a bug. Ranked / fuzzy search lives in SQL (header
// search, AI chat records engine); the in-memory ranked scorer of the v1 AI
// chat (`entitySearchScore`, `entityMatchesSearch`) was removed in ai-chat CH8.

import { transliterateRu } from "@/lib/translit-ru"

// Field weights, mirroring V2's tsvector `setweight` A > B > C > D. A name is
// what people search by; an alias is a real but secondary spelling; an
// email/website is a weaker signal that still has to be findable.
export const FIELD_WEIGHT = { name: 1, alias: 0.9, secondary: 0.7, weak: 0.5 }

/**
 * The single normalisation pipeline, matching the SQL
 * `lower(immutable_unaccent(translit_cyr_lat(x)))` plus V2's word splitting:
 * transliterate Cyrillic → strip combining accents → lowercase → collapse
 * every non-alphanumeric run to one space.
 *
 *   "Норлекс – Северная"     → "ast severnaya"
 *   "Norleks — Северная"     → "ast severnaya"   (dash variants collapse)
 *   "Müllerwerk"         → "mullerwerk"
 */
export function searchNormalise(raw: string | null | undefined): string {
  if (!raw) return ""
  return transliterateRu(raw)
    .normalize("NFKD")
    // Drop combining marks — the JS equivalent of Postgres `unaccent`.
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
}

// Minimum query-token length before PREFIX matching is allowed. An exact
// token match always counts.
const MIN_PREFIX_LEN = 2

/**
 * Does one query token hit any of a field's tokens?
 *
 * Prefix matching runs in ONE direction only — the query token must be a
 * prefix of a target token ("kva" finds "kvant"), never the reverse. The
 * reverse direction looks harmless and is not: Russian one-letter
 * prepositions normalise to single-character tokens, so «в» in a description
 * became a prefix of the query "kvant" and every deal whose text contained
 * «в» scored a full-coverage match. That put Acme Capital, Globex Line * and six others into the results for «Квант».
 */
function tokenHit(queryToken: string, targetTokens: string[]): boolean {
  return targetTokens.some(
    (vt) =>
      vt === queryToken ||
      (queryToken.length >= MIN_PREFIX_LEN && vt.startsWith(queryToken)),
  )
}

/**
 * Word-boundary-aware containment: does `needle` appear in `haystack` as a
 * whole run of tokens? Both sides are already normalised, so boundaries are
 * plain spaces.
 *
 * A raw `includes()` would be wrong in both directions. Forward: a 2-letter
 * query like "an" is a substring of half the names in a catalog. Reverse
 * (needed so pasting a full stored name back finds its row): a client named
 * "AB" would match the query "grab something" on the "ab" inside "grab".
 */
function containsAsWords(haystack: string, needle: string): boolean {
  if (!needle || !haystack) return false
  if (haystack === needle) return true
  return (
    haystack.startsWith(needle + " ") ||
    haystack.endsWith(" " + needle) ||
    haystack.includes(" " + needle + " ")
  )
}

export type SearchField = {
  value: string | null | undefined
  /** One of FIELD_WEIGHT, or any 0–1 multiplier. */
  weight: number
}

/**
 * Filter-box predicate: the normalisation, without the fuzzy tail. Every
 * query token must be present (as a token prefix) in some field, or the whole
 * query must be a substring of one.
 *
 * So «Норлекс» finds «Norleks», «kvant» finds «Квант», and an em-dash finds an
 * en-dash — but a typo shows nothing rather than a surprising row.
 */
export function entityMatchesFilter(
  query: string,
  fields: SearchField[],
): boolean {
  const qn = searchNormalise(query)
  if (!qn) return true
  const qTokens = qn.split(" ").filter(Boolean)

  const values = fields
    .map((f) => searchNormalise(f.value))
    .filter((v) => v.length > 0)
  if (values.length === 0) return false

  if (values.some((v) => containsAsWords(v, qn))) return true

  return qTokens.every((t) =>
    values.some((v) => tokenHit(t, v.split(" ").filter(Boolean))),
  )
}

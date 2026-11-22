/**
 * Pure choice rules of the unified discovery (src/server/discovery.ts).
 * Bug list 2026-11-22: the maslov.agency people were proposed for a junk
 * company «Google Calendar» and got the Latin spelling as «Имя на родном
 * языке». Client-safe, unit-tested.
 */

const NON_LATIN_LETTER = /[^\p{Script=Latin}\P{L}]/u

/** True when the text has a letter that is not Latin (Cyrillic, Greek, …). */
export function hasNonLatinLetter(s: string): boolean {
  return NON_LATIN_LETTER.test(s)
}

/**
 * «Имя на родном языке» of one email from the spellings seen in the rows
 * (spelling → number of rows). A spelling with a non-Latin letter wins over a
 * Latin-only one (the display name is usually the Latin one already), then
 * the most frequent, then the longer, then the first in sort order.
 */
export function pickNativeName(votes: ReadonlyMap<string, number>): string | null {
  let best: { name: string; native: boolean; count: number } | null = null
  for (const [name, count] of votes) {
    const native = hasNonLatinLetter(name)
    const better =
      !best ||
      (native !== best.native
        ? native
        : count !== best.count
          ? count > best.count
          : name.length !== best.name.length
            ? name.length > best.name.length
            : name.localeCompare(best.name) < 0)
    if (better) best = { name, native, count }
  }
  return best?.name ?? null
}

export type DomainMatchCandidate = {
  /** An existing CRM company (true) or a new discovery candidate (false). */
  existing: boolean
  /** The company's website domain. */
  domain: string
  name: string
}

/**
 * Companies that share the email domain of a contact: an EXISTING company
 * wins over a new candidate (a new candidate on the same domain is either a
 * duplicate of it or junk); then the exact domain over a parent domain; then
 * the name. Returns the matches to choose from, best first.
 */
export function rankDomainMatches<T extends DomainMatchCandidate>(emailDomain: string, matches: readonly T[]): T[] {
  const existing = matches.filter((m) => m.existing)
  const pool = existing.length ? existing : [...matches]
  const exact = (m: T) => (m.domain === emailDomain ? 0 : 1)
  return pool.sort((a, b) => exact(a) - exact(b) || a.name.localeCompare(b.name))
}

/**
 * «Системное имя» of one email from the display names seen in the rows
 * (name → number of rows): the most frequent real name (not the address, not
 * «(unknown)»), then the longer, then the first in sort order. Product owner
 * 2026-11-22: «Anna Chekhomova» seen 8 × beats «Аня» seen once.
 */
export function pickDisplayName(votes: ReadonlyMap<string, number>, email?: string): string | null {
  const addr = (email ?? "").trim().toLowerCase()
  let best: { name: string; count: number } | null = null
  for (const [raw, count] of votes) {
    const name = raw.trim()
    const lower = name.toLowerCase()
    if (!name || lower === "(unknown)" || lower === addr || /^[^\s@]+@[^\s@]+$/.test(lower)) continue
    const better =
      !best ||
      (count !== best.count
        ? count > best.count
        : name.length !== best.name.length
          ? name.length > best.name.length
          : name.localeCompare(best.name) < 0)
    if (better) best = { name, count }
  }
  return best?.name ?? null
}

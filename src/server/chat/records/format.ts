// Pure formatting helpers of the records engine: Russian dates, money,
// short text, facts. No DB, no `server-only` (unit-tested in format.test.ts).

import type { RecordFact } from "@/lib/chat/records"

type DateLike = Date | string | null | undefined

function toDate(v: DateLike): Date | null {
  if (v == null || v === "") return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/** «16.11.2026» in the org time zone; "" for no date. */
export function formatDate(v: DateLike, timeZone: string): string {
  const d = toDate(v)
  if (!d) return ""
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d)
}

/** «16.11.2026, 14:05» in the org time zone; "" for no date. */
export function formatDateTime(v: DateLike, timeZone: string): string {
  const d = toDate(v)
  if (!d) return ""
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d)
}

/** ISO string or null (RecordHit.date). */
export function isoOrNull(v: DateLike): string | null {
  return toDate(v)?.toISOString() ?? null
}

const CURRENCY_SIGN: Record<string, string> = { RUB: "₽", EUR: "€", USD: "$", GBP: "£", CHF: "CHF" }

/**
 * «1 200 ₽» / «15 000,50 €». Numeric strings (DB `numeric`) are accepted;
 * a missing / invalid amount gives "". Currency defaults to RUB.
 */
export function formatMoney(amount: number | string | null | undefined, currency?: string | null): string {
  if (amount == null || amount === "") return ""
  const n = typeof amount === "number" ? amount : Number(amount)
  if (!Number.isFinite(n)) return ""
  const num = new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n)
  const code = (currency ?? "RUB").toUpperCase()
  return `${num} ${CURRENCY_SIGN[code] ?? code}`
}

/** Collapses whitespace and cuts at `max` characters with «…». */
export function shortText(v: string | null | undefined, max: number): string {
  const s = (v ?? "").replace(/\s+/g, " ").trim()
  if (s.length <= max) return s
  return `${s.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

/** Facts without empty values, at most `max` (hits show 0–3). */
export function facts(items: (RecordFact | null | false | undefined)[], max = 3): RecordFact[] {
  const out: RecordFact[] = []
  for (const f of items) {
    if (!f || !f.value || !f.value.trim()) continue
    out.push({ label: f.label, value: f.value.trim() })
    if (out.length >= max) break
  }
  return out
}

/** Like `facts`, without a cap (detail sections). */
export function allFacts(items: (RecordFact | null | false | undefined)[]): RecordFact[] {
  return facts(items, Number.POSITIVE_INFINITY)
}

/** «Иван Петров, Анна Смирнова и ещё 3». */
export function nameList(names: (string | null | undefined)[], max = 3): string {
  const clean = names.map((n) => (n ?? "").trim()).filter(Boolean)
  if (clean.length <= max) return clean.join(", ")
  return `${clean.slice(0, max).join(", ")} и ещё ${clean.length - max}`
}

/** Minutes the zone is ahead of UTC at instant `t` (Vienna winter = 60). */
function zoneOffsetMinutes(t: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(t))
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  const asUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"))
  return Math.round((asUtc - Math.floor(t / 1000) * 1000) / 60_000)
}

/** UTC instant of local midnight of `y-m-d` in `timeZone` (DST-safe). */
function zonedMidnight(y: number, m: number, d: number, timeZone: string): number {
  const guess = Date.UTC(y, m - 1, d)
  const first = guess - zoneOffsetMinutes(guess, timeZone) * 60_000
  // Re-check at the candidate: the offset may differ across a DST change.
  return guess - zoneOffsetMinutes(first, timeZone) * 60_000
}

/**
 * «2026-11-16» → the first (or, with `endOfDay`, the last) millisecond of
 * that day in the org time zone. A full ISO time is taken as is. null for
 * empty / invalid input.
 */
export function parseDayInZone(v: string | undefined | null, timeZone: string, endOfDay = false): Date | null {
  if (!v) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim())
  if (!m) {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  if (!endOfDay) return new Date(zonedMidnight(y, mo, d, timeZone))
  const next = new Date(Date.UTC(y, mo - 1, d + 1))
  return new Date(zonedMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timeZone) - 1)
}

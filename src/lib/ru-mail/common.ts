// Shared types and small helpers for the ru-mail detectors. Pure, no I/O.

/** Input for detectors. `date` = item date (ISO); relative dates resolve against it, never "today". */
export type MailProbe = {
  subject?: string | null
  from?: string | null
  body: string
  headers?: Record<string, string> | null
  date?: string | null
}

/** Russian month names in the genitive case ("15 ноября") → month number 1..12. */
export const RU_MONTHS_GENITIVE: Record<string, number> = {
  января: 1,
  февраля: 2,
  марта: 3,
  апреля: 4,
  мая: 5,
  июня: 6,
  июля: 7,
  августа: 8,
  сентября: 9,
  октября: 10,
  ноября: 11,
  декабря: 12,
}

export const EN_MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
}

/** "Name <a@b.ru>" or a bare address → "a@b.ru" lowercased; null when none found. */
export function extractEmailAddress(from: string | null | undefined): string | null {
  if (!from) return null
  const angle = /<\s*([^<>\s]+@[^<>\s]+)\s*>/.exec(from)
  const raw = angle?.[1] ?? /([^\s<>"',;()]+@[^\s<>"',;()]+)/.exec(from)?.[1]
  if (!raw) return null
  return raw.replace(/[.,;:]+$/, "").toLowerCase()
}

/** Case-insensitive header lookup. */
export function getHeader(
  headers: Record<string, string> | null | undefined,
  name: string,
): string | null {
  if (!headers) return null
  const want = name.toLowerCase()
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === want) return String(v)
  }
  return null
}

/** Build YYYY-MM-DD for the next occurrence of day/month on or after `base` (UTC date part); explicit year wins. */
export function resolveDayMonth(
  day: number,
  month: number,
  year: number | null,
  baseIso: string | null | undefined,
): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const valid = (y: number) => {
    const d = new Date(Date.UTC(y, month - 1, day))
    return d.getUTCMonth() === month - 1 && d.getUTCDate() === day
  }
  const fmt = (y: number) =>
    `${String(y).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  if (year !== null) {
    const y = year < 100 ? 2000 + year : year
    return valid(y) ? fmt(y) : null
  }
  if (!baseIso) return null
  const base = new Date(baseIso)
  if (Number.isNaN(base.getTime())) return null
  const baseDay = Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate())
  for (const y of [base.getUTCFullYear(), base.getUTCFullYear() + 1]) {
    if (valid(y) && Date.UTC(y, month - 1, day) >= baseDay) return fmt(y)
  }
  return null
}

// Due dates of chat task drafts (docs/specs/ai-chat-tools §10, T2). PURE,
// client-safe. The model passes the user's own words for the deadline
// («до пятницы», «завтра в 11:00», «20.11») — code turns them into a date in
// the ORG time zone, so the weekday arithmetic never depends on the model.
// A date-only deadline = 18:00 org time (same rule as the attention engine).

export const DEFAULT_DUE_TIME = "18:00"

/** Org-local wall time «YYYY-MM-DDTHH:MM». */
export type LocalDateTime = string

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

export function isLocalDateTime(v: unknown): v is LocalDateTime {
  if (typeof v !== "string") return false
  const m = LOCAL_RE.exec(v)
  if (!m) return false
  const [mo, d, h, mi] = [Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])]
  return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && h <= 23 && mi <= 59
}

/** Wall-clock parts of an instant in a time zone. */
export function zonedParts(at: Date, timeZone: string): { y: number; m: number; d: number; h: number; mi: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  }).formatToParts(at)
  const v = (t: string) => parts.find((p) => p.type === t)?.value ?? ""
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(v("weekday"))
  return { y: Number(v("year")), m: Number(v("month")), d: Number(v("day")), h: Number(v("hour")), mi: Number(v("minute")), weekday: wd }
}

function offsetMinutes(at: number, timeZone: string): number {
  const p = zonedParts(new Date(at), timeZone)
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi)
  return Math.round((asUtc - Math.floor(at / 60_000) * 60_000) / 60_000)
}

/** «YYYY-MM-DDTHH:MM» in `timeZone` → the UTC instant (DST-safe). null = invalid. */
export function localToUtc(local: string, timeZone: string): Date | null {
  const m = LOCAL_RE.exec(local)
  if (!m || !isLocalDateTime(local)) return null
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]))
  const first = guess - offsetMinutes(guess, timeZone) * 60_000
  return new Date(guess - offsetMinutes(first, timeZone) * 60_000)
}

/** The UTC instant → «YYYY-MM-DDTHH:MM» in `timeZone`. */
export function utcToLocal(at: Date, timeZone: string): LocalDateTime {
  const p = zonedParts(at, timeZone)
  const two = (n: number) => String(n).padStart(2, "0")
  return `${p.y}-${two(p.m)}-${two(p.d)}T${two(p.h)}:${two(p.mi)}`
}

const two = (n: number) => String(n).padStart(2, "0")

/** Calendar day arithmetic (no time zone involved). */
function addDays(y: number, m: number, d: number, days: number): { y: number; m: number; d: number } {
  const t = new Date(Date.UTC(y, m - 1, d + days))
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }
}

const WEEKDAYS: [RegExp, number][] = [
  [/понедельник/, 1],
  [/вторник/, 2],
  [/сред[аыуе](?![а-я])/, 3],
  [/четверг/, 4],
  [/пятниц/, 5],
  [/суббот/, 6],
  [/воскресень/, 0],
  [/\bmonday\b/, 1],
  [/\btuesday\b/, 2],
  [/\bwednesday\b/, 3],
  [/\bthursday\b/, 4],
  [/\bfriday\b/, 5],
  [/\bsaturday\b/, 6],
  [/\bsunday\b/, 0],
]

const MONTHS: [RegExp, number][] = [
  [/январ/, 1],
  [/феврал/, 2],
  [/март/, 3],
  [/апрел/, 4],
  [/ма[йя](?![а-я])/, 5],
  [/июн/, 6],
  [/июл/, 7],
  [/август/, 8],
  [/сентябр/, 9],
  [/октябр/, 10],
  [/ноябр/, 11],
  [/декабр/, 12],
]

/** Does the text name a deadline at all (any of the forms `resolveDueText` reads, or a date-like word)? */
export function hasDateCue(text: string): boolean {
  const t = (text ?? "").toLowerCase()
  return (
    /сегодня|завтра|послезавтра|вчера|через\s+\S+|до\s+конца|к\s+концу|на\s+(этой|следующей)\s+неделе|today|tomorrow|yesterday/.test(t) ||
    WEEKDAYS.some(([re]) => re.test(t)) ||
    /\b\d{1,2}[./]\d{1,2}([./]\d{2,4})?\b/.test(t) ||
    MONTHS.some(([re]) => new RegExp(`\\b\\d{1,2}\\s+${re.source}`).test(t))
  )
}

/** «в 15:00», «к 10.30», «в 11 часов» → «HH:MM», else null. */
function timeOf(t: string): string | null {
  // No \b next to Cyrillic: in JS it is an ASCII word boundary.
  // «к 10.01» / «до 25.11» are dates; a dotted «NN.MM» is a time after «в»
  // («в 10.30»), or after «к» / «до» when MM cannot be a month («к 10.30»).
  const dotted = /(?:^|\s)(в|к|до|at)\s+(\d{1,2})\.(\d{2})(?![\d.])/.exec(t)
  const dottedTime = dotted && (dotted[1] === "в" || dotted[1] === "at" || Number(dotted[3]) > 12) ? [dotted[0], dotted[2], dotted[3]] : null
  const hm =
    /(?:^|\s)(?:в|к|до|at)\s+(\d{1,2}):(\d{2})(?!\d)/.exec(t) ??
    dottedTime ??
    /(?<!\d)(\d{1,2}):(\d{2})(?!\d)/.exec(t)
  if (hm) {
    const h = Number(hm[1])
    const mi = Number(hm[2])
    if (h <= 23 && mi <= 59) return `${two(h)}:${two(mi)}`
  }
  const h = /(?:^|\s)(?:в|к)\s+(\d{1,2})\s*(?:час|ч(?![а-я])|утра|вечера|дня)/.exec(t)
  if (h) {
    let n = Number(h[1])
    if (/вечера|дня/.test(t) && n < 12) n += 12
    if (n <= 23) return `${two(n)}:00`
  }
  return null
}

const WORD_NUM: Record<string, number> = { один: 1, одну: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, десять: 10 }

/**
 * The user's words for a deadline → org-local «YYYY-MM-DDTHH:MM», or null
 * when the words are not a deadline code can read (then the model's date is
 * used, marked as such). `now` = the turn's time.
 */
export function resolveDueText(text: string, now: Date, timeZone: string, opts: { past?: boolean } = {}): LocalDateTime | null {
  const t = ` ${(text ?? "").toLowerCase().replace(/ё/g, "е")} `
  const today = zonedParts(now, timeZone)
  const past = opts.past === true
  // A logged meeting / call (`past`) without a time = the current time of that day is unknown → 12:00.
  const at = (day: { y: number; m: number; d: number }) => `${day.y}-${two(day.m)}-${two(day.d)}T${timeOf(t) ?? (past ? "12:00" : DEFAULT_DUE_TIME)}`
  const plus = (n: number) => addDays(today.y, today.m, today.d, n)

  // `past` (T4 «Записать встречу»): when it HAPPENED.
  if (past) {
    if (/позавчера/.test(t)) return at(plus(-2))
    if (/вчера|yesterday/.test(t)) return at(plus(-1))
    if (/сегодня|today/.test(t)) return at(plus(0))
    for (const [re, wd] of WEEKDAYS) {
      if (!re.test(t)) continue
      return at(plus(-((today.weekday - wd + 7) % 7)))
    }
  }

  if (/послезавтра/.test(t)) return at(plus(2))
  if (/завтра|tomorrow/.test(t)) return at(plus(1))
  if (/сегодня|today/.test(t)) return at(plus(0))

  // «до конца недели» / «к концу недели» = Friday of this week (weekend → next Friday).
  if (/(до|к)\s+конц[ау]\s+недели|end of (the )?week/.test(t)) {
    const n = (5 - today.weekday + 7) % 7
    return at(plus(today.weekday === 6 || today.weekday === 0 ? n || 7 : n))
  }
  // «на следующей неделе» = Friday of next week.
  if (/на\s+следующей\s+неделе|next week/.test(t)) {
    const n = (5 - today.weekday + 7) % 7
    // On Sat / Sun the coming Friday is already in the next week.
    return at(plus(today.weekday === 6 || today.weekday === 0 ? n : n + 7))
  }
  if (/(до|к)\s+конц[ау]\s+месяца|end of (the )?month/.test(t)) {
    const last = new Date(Date.UTC(today.y, today.m, 0))
    return at({ y: today.y, m: today.m, d: last.getUTCDate() })
  }
  // «через 3 дня», «через неделю», «через две недели», «через месяц»
  const after = /через\s+(\d+|\S+)?\s*(дн|день|недел|месяц)/.exec(t)
  if (after) {
    const raw = after[1] ?? ""
    const n = /^\d+$/.test(raw) ? Number(raw) : (WORD_NUM[raw] ?? 1)
    const unit = after[2]
    if (unit.startsWith("недел")) return at(plus(7 * n))
    if (unit.startsWith("месяц")) {
      const d = new Date(Date.UTC(today.y, today.m - 1 + n, today.d))
      return at({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() })
    }
    return at(plus(n))
  }
  // A weekday: the next one (the same weekday = next week); «следующ…» = a week later.
  for (const [re, wd] of WEEKDAYS) {
    if (!re.test(t)) continue
    let n = (wd - today.weekday + 7) % 7
    if (n === 0) n = 7
    if (/следующ/.test(t) && n < 7) n += 7
    return at(plus(n))
  }
  // «20.11», «20.11.2026», «20/11»
  const dm = /(?<!(?:^|\s)в\s)(?<![\d:])(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?![\d:])/.exec(t)
  if (dm && !/\d[:]\d/.test(dm[0])) {
    const [d, m] = [Number(dm[1]), Number(dm[2])]
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
      let y = dm[3] ? Number(dm[3].length === 2 ? `20${dm[3]}` : dm[3]) : today.y
      const before = m < today.m || (m === today.m && d < today.d)
      const after = m > today.m || (m === today.m && d > today.d)
      if (!dm[3] && !past && before) y++
      if (!dm[3] && past && after) y--
      return at({ y, m, d })
    }
  }
  // «20 ноября»
  for (const [re, m] of MONTHS) {
    const r = new RegExp(`\\b(\\d{1,2})\\s+${re.source}`).exec(t)
    if (!r) continue
    const d = Number(r[1])
    if (d < 1 || d > 31) continue
    const before = m < today.m || (m === today.m && d < today.d)
    const after = m > today.m || (m === today.m && d > today.d)
    const y = !past && before ? today.y + 1 : past && after ? today.y - 1 : today.y
    return at({ y, m, d })
  }
  return null
}

/** «пт, 20.11, 18:00» — the due date as the card shows it. */
export function dueLabel(local: LocalDateTime): string {
  const m = LOCAL_RE.exec(local)
  if (!m) return local
  const wd = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"][new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()]
  return `${wd}, ${m[3]}.${m[2]}.${m[1]}, ${m[4]}:${m[5]}`
}

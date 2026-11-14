// Working days and working hours of one org (06-attention-engine.md §2, §13):
// Russian production calendar (`work_calendar_day`, seeded per year by a
// migration) in the org time zone. PURE and client-safe.
//
// The table holds only the EXCEPTIONS of a year (weekday holidays, working
// weekends, short pre-holiday days). A day with no row follows the plain
// Mon–Fri rule — so a year that is not seeded falls back to Mon–Fri.
// Working hours: workStart–workEnd on a working day; a short day ends one
// hour earlier.

export type CalendarDay = { day: string; isWorking: boolean; isShort: boolean }

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number)
  return h * 60 + m
}

/** Calendar arithmetic on "YYYY-MM-DD" strings (no time zone involved). */
export function addCalendarDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d) + n * DAY_MS).toISOString().slice(0, 10)
}

/** ISO weekday 1 = Mon … 7 = Sun. */
export function isoWeekday(day: string): number {
  const [y, m, d] = day.split("-").map(Number)
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return w === 0 ? 7 : w
}

/**
 * The weekly review day (06 §7.2 «Неделя» snapshot, weekly digest) of the
 * ISO week that holds `day`: the configured ISO `weekday` (Friday) when it is
 * a working day, else the LAST working day before it in the same week; null
 * when the week has no working day up to that weekday (e.g. the New Year
 * holiday week). One rule for the «Неделя» list, the attention engine (W1
 * expiry, H5 dormant window, next list point) and the weekly email.
 */
export function weeklyReviewDay(cal: Pick<WorkCalendar, "isWorkingDay">, day: string, weekday: number): string | null {
  const monday = addCalendarDays(day, 1 - isoWeekday(day))
  for (let d = addCalendarDays(monday, weekday - 1); d >= monday; d = addCalendarDays(d, -1)) {
    if (cal.isWorkingDay(d)) return d
  }
  return null
}

export class WorkCalendar {
  private readonly days: Map<string, CalendarDay>
  private readonly fmt: Intl.DateTimeFormat
  readonly timeZone: string
  readonly workStartMin: number
  readonly workEndMin: number

  constructor(
    days: readonly CalendarDay[],
    opts: { timeZone: string; workStart: string; workEnd: string },
  ) {
    this.days = new Map(days.map((d) => [d.day, d]))
    this.timeZone = opts.timeZone
    this.workStartMin = minutesOf(opts.workStart)
    this.workEndMin = minutesOf(opts.workEnd)
    this.fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: opts.timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
  }

  /** Years that have at least one row (for reports). */
  seededYears(): number[] {
    return [...new Set([...this.days.keys()].map((d) => Number(d.slice(0, 4))))].sort()
  }

  private parts(d: Date): { y: number; mo: number; da: number; h: number; mi: number; s: number } {
    const p: Record<string, number> = {}
    for (const x of this.fmt.formatToParts(d)) if (x.type !== "literal") p[x.type] = Number(x.value)
    return { y: p.year, mo: p.month, da: p.day, h: p.hour, mi: p.minute, s: p.second }
  }

  private offsetMs(d: Date): number {
    const p = this.parts(d)
    const asUtc = Date.UTC(p.y, p.mo - 1, p.da, p.h, p.mi, p.s)
    return asUtc - Math.floor(d.getTime() / 1000) * 1000
  }

  /** Local calendar day "YYYY-MM-DD" of a moment. */
  localDay(d: Date): string {
    const p = this.parts(d)
    return `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.da).padStart(2, "0")}`
  }

  /** Minutes since local midnight. */
  localMinutes(d: Date): number {
    const p = this.parts(d)
    return p.h * 60 + p.mi
  }

  /** The moment of local `day` at `minutes` after midnight (or "HH:MM"). */
  at(day: string, time: number | string): Date {
    const min = typeof time === "string" ? minutesOf(time) : time
    const [y, m, d] = day.split("-").map(Number)
    const naive = Date.UTC(y, m - 1, d) + min * 60_000
    let t = naive - this.offsetMs(new Date(naive))
    t = naive - this.offsetMs(new Date(t))
    return new Date(t)
  }

  isWorkingDay(day: string): boolean {
    const row = this.days.get(day)
    if (row) return row.isWorking
    return isoWeekday(day) <= 5
  }

  isShortDay(day: string): boolean {
    return this.days.get(day)?.isShort ?? false
  }

  /** Working window [start, end) of a local day in minutes; null on a day off. */
  private window(day: string): [number, number] | null {
    if (!this.isWorkingDay(day)) return null
    return [this.workStartMin, this.workEndMin - (this.isShortDay(day) ? 60 : 0)]
  }

  /** `n` working days after `day` (n ≥ 0; 0 = the day itself). */
  addWorkingDays(day: string, n: number): string {
    let d = day
    let left = n
    while (left > 0) {
      d = addCalendarDays(d, 1)
      if (this.isWorkingDay(d)) left--
    }
    return d
  }

  /** Working days in (fromDay, toDay]; 0 when toDay ≤ fromDay. */
  workingDaysBetween(fromDay: string, toDay: string): number {
    if (toDay <= fromDay) return 0
    let n = 0
    for (let d = addCalendarDays(fromDay, 1); d <= toDay; d = addCalendarDays(d, 1)) if (this.isWorkingDay(d)) n++
    return n
  }

  /** Working hours between two moments (0 when b ≤ a). */
  workingHoursBetween(a: Date, b: Date): number {
    if (b.getTime() <= a.getTime()) return 0
    let ms = 0
    const last = this.localDay(b)
    for (let d = this.localDay(a); d <= last; d = addCalendarDays(d, 1)) {
      const w = this.window(d)
      if (!w) continue
      const s = Math.max(this.at(d, w[0]).getTime(), a.getTime())
      const e = Math.min(this.at(d, w[1]).getTime(), b.getTime())
      if (e > s) ms += e - s
    }
    return ms / HOUR_MS
  }

  /** The moment when `hours` working hours have passed since `a`. */
  addWorkingHours(a: Date, hours: number): Date {
    let left = hours * HOUR_MS
    let d = this.localDay(a)
    for (let guard = 0; guard < 3700; guard++, d = addCalendarDays(d, 1)) {
      const w = this.window(d)
      if (!w) continue
      const s = Math.max(this.at(d, w[0]).getTime(), a.getTime())
      const e = this.at(d, w[1]).getTime()
      if (e <= s) continue
      if (e - s >= left) return new Date(s + left)
      left -= e - s
    }
    return new Date(a.getTime() + hours * HOUR_MS)
  }

  /** First moment strictly after `now` at local `time` on a working day. */
  nextWorkingDayAt(now: Date, time: string): Date {
    let d = this.localDay(now)
    for (let guard = 0; guard < 400; guard++, d = addCalendarDays(d, 1)) {
      if (!this.isWorkingDay(d)) continue
      const t = this.at(d, time)
      if (t.getTime() > now.getTime()) return t
    }
    return new Date(now.getTime() + DAY_MS)
  }

  /** Last moment ≤ `now` at local `time` on a working day (the last «Сводка» snapshot point). */
  lastWorkingDayAt(now: Date, time: string): Date {
    let d = this.localDay(now)
    for (let guard = 0; guard < 400; guard++, d = addCalendarDays(d, -1)) {
      if (!this.isWorkingDay(d)) continue
      const t = this.at(d, time)
      if (t.getTime() <= now.getTime()) return t
    }
    return new Date(now.getTime() - DAY_MS)
  }

  /**
   * First weekly review moment strictly after `now`: local `time` on the
   * weekly review day of a week (`weeklyReviewDay`: the ISO `weekday`, or the
   * last working day before it when that day is off; a week with none is
   * skipped).
   */
  nextWeeklyReviewAt(now: Date, weekday: number, time: string): Date {
    const monday = addCalendarDays(this.localDay(now), 1 - isoWeekday(this.localDay(now)))
    for (let k = 0; k < 10; k++) {
      const day = weeklyReviewDay(this, addCalendarDays(monday, 7 * k), weekday)
      if (!day) continue
      const t = this.at(day, time)
      if (t.getTime() > now.getTime()) return t
    }
    return new Date(now.getTime() + 7 * DAY_MS)
  }

  /** Last weekly review moment ≤ `now` (same rule as `nextWeeklyReviewAt`). */
  lastWeeklyReviewAt(now: Date, weekday: number, time: string): Date {
    const monday = addCalendarDays(this.localDay(now), 1 - isoWeekday(this.localDay(now)))
    for (let k = 0; k < 10; k++) {
      const day = weeklyReviewDay(this, addCalendarDays(monday, -7 * k), weekday)
      if (!day) continue
      const t = this.at(day, time)
      if (t.getTime() <= now.getTime()) return t
    }
    return new Date(now.getTime() - 7 * DAY_MS)
  }

  /** First moment strictly after `now` on ISO `weekday` at local `time` (plain weekday; the weekly review uses `nextWeeklyReviewAt`). */
  nextWeekdayAt(now: Date, weekday: number, time: string): Date {
    let d = this.localDay(now)
    for (let guard = 0; guard < 15; guard++, d = addCalendarDays(d, 1)) {
      if (isoWeekday(d) !== weekday) continue
      const t = this.at(d, time)
      if (t.getTime() > now.getTime()) return t
    }
    return new Date(now.getTime() + 7 * DAY_MS)
  }
}

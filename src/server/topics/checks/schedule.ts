// Schedule of topics plan phase 8 checks (PURE, unit-tested): which period
// a scheduled check belongs to and whether it is due now (org time).

import { isoWeekday, type WorkCalendar } from "@/lib/topics/attention-calendar"
import type { CheckSchedule, ChecksParams } from "@/lib/topics/checks"

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number)
  return h * 60 + m
}

/** ISO week key `YYYY-Www` of a local day `YYYY-MM-DD`. */
export function isoWeekKey(day: string): string {
  const d = new Date(`${day}T00:00:00Z`)
  const wd = isoWeekday(day)
  d.setUTCDate(d.getUTCDate() + 4 - wd) // Thursday of the week decides the year
  const year = d.getUTCFullYear()
  const jan1 = Date.UTC(year, 0, 1)
  const week = Math.floor((d.getTime() - jan1) / 86_400_000 / 7) + 1
  return `${year}-W${String(week).padStart(2, "0")}`
}

/**
 * Period key of a scheduled check when it is due at `now` (org time), else
 * null. Due = the first hourly run at / after `runTime` on the target day of
 * the period (later runs of the period catch up when a run was missed).
 * `hourly` checks are due on every run (key = `run:<runId>`).
 */
export function duePeriodKey(
  schedule: CheckSchedule,
  now: Date,
  cal: WorkCalendar,
  p: ChecksParams,
  runId: string,
): string | null {
  if (schedule === "hourly") return `run:${runId}`
  const day = cal.localDay(now)
  const afterTime = cal.localMinutes(now) >= minutesOf(p.runTime)
  if (schedule === "daily") return afterTime ? day : null
  if (schedule === "weekly") {
    const wd = isoWeekday(day)
    return wd > p.weeklyWeekday || (wd === p.weeklyWeekday && afterTime) ? isoWeekKey(day) : null
  }
  const dom = Number(day.slice(8, 10))
  return dom > p.monthlyDay || (dom === p.monthlyDay && afterTime) ? day.slice(0, 7) : null
}


// Cost chart on «Использование ИИ» (/settings): scale «По дням» / «По
// месяцам» / «По годам» and the chart range «с … по …». Pure, client-safe
// helpers shared by the admin route (validation) and the chart (bucket keys,
// zero fill, series folding, Russian axis labels). All dates are UTC days
// `YYYY-MM-DD`; the server buckets with `date_trunc` in UTC and returns the
// same key formats (`YYYY-MM-DD` / `YYYY-MM` / `YYYY`).
// Spec: docs/specs/models/04-usage-and-cost.md §5.

export type ChartScale = "day" | "month" | "year"

export const CHART_SCALES: readonly ChartScale[] = ["day", "month", "year"]

export const CHART_SCALE_LABELS: Record<ChartScale, string> = {
  day: "По дням",
  month: "По месяцам",
  year: "По годам",
}

/** Max buckets per scale (day ≤ 366 days, month ≤ 60 months, year ≤ 50 years). */
export const CHART_MAX_BUCKETS: Record<ChartScale, number> = { day: 366, month: 60, year: 50 }

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

export function isDay(v: string | null | undefined): v is string {
  if (!v || !DAY_RE.test(v)) return false
  const d = new Date(`${v}T00:00:00.000Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

const ymd = (v: string) => v.split("-").map(Number) as [number, number, number]

/** Bucket key of a UTC day for a scale. */
export function bucketKey(scale: ChartScale, day: string): string {
  return scale === "day" ? day : scale === "month" ? day.slice(0, 7) : day.slice(0, 4)
}

/** Number of buckets from `from` to `to` (both inclusive UTC days). */
export function bucketCount(scale: ChartScale, from: string, to: string): number {
  const [fy, fm] = ymd(from)
  const [ty, tm] = ymd(to)
  if (scale === "day") {
    return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
  }
  if (scale === "month") return (ty - fy) * 12 + (tm - fm) + 1
  return ty - fy + 1
}

export type ChartRangeCheck =
  | { ok: true; buckets: number }
  | { ok: false; reason: "invalid" | "order" | "too_long"; message: string }

/** Validate a chart range for a scale (bounds of CHART_MAX_BUCKETS). */
export function checkChartRange(scale: ChartScale, from: string, to: string): ChartRangeCheck {
  if (!isDay(from) || !isDay(to)) {
    return { ok: false, reason: "invalid", message: "Укажите даты «с» и «по»" }
  }
  if (to < from) {
    return { ok: false, reason: "order", message: "Дата «по» раньше даты «с»" }
  }
  const buckets = bucketCount(scale, from, to)
  if (buckets > CHART_MAX_BUCKETS[scale]) {
    const message =
      scale === "day"
        ? `По дням — не больше ${CHART_MAX_BUCKETS.day} дней. Сократите диапазон или выберите «По месяцам».`
        : scale === "month"
          ? `По месяцам — не больше ${CHART_MAX_BUCKETS.month} месяцев. Сократите диапазон или выберите «По годам».`
          : `По годам — не больше ${CHART_MAX_BUCKETS.year} лет. Сократите диапазон.`
    return { ok: false, reason: "too_long", message }
  }
  return { ok: true, buckets }
}

/** Every bucket key from `from` to `to` (inclusive), in order. Assumes a checked range. */
export function bucketKeys(scale: ChartScale, from: string, to: string): string[] {
  const out: string[] = []
  const n = bucketCount(scale, from, to)
  if (scale === "day") {
    const start = Date.parse(`${from}T00:00:00Z`)
    for (let i = 0; i < n; i++) out.push(new Date(start + i * 86_400_000).toISOString().slice(0, 10))
    return out
  }
  const [fy, fm] = ymd(from)
  for (let i = 0; i < n; i++) {
    if (scale === "year") out.push(String(fy + i))
    else {
      const m = fm - 1 + i
      out.push(`${fy + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}`)
    }
  }
  return out
}

/**
 * Russian label of a bucket key: day `дд.мм` (tooltip `дд.мм.гггг`), month
 * `мм.гггг`, year `гггг`.
 */
export function bucketLabel(key: string, long = false): string {
  const p = key.split("-")
  if (p.length === 3) return long ? `${p[2]}.${p[1]}.${p[0]}` : `${p[2]}.${p[1]}`
  if (p.length === 2) return `${p[1]}.${p[0]}`
  return key
}

/** Default chart range when the admin did not pick one. */
export function defaultChartRange(
  scale: ChartScale,
  page: { from: string; to: string },
  today: string,
): { from: string; to: string } {
  if (scale === "day") return page
  const [y, m] = ymd(today)
  if (scale === "month") {
    // The current month and the 11 before it.
    const start = new Date(Date.UTC(y, m - 1 - 11, 1)).toISOString().slice(0, 10)
    return { from: start, to: today }
  }
  return { from: `${y - 4}-01-01`, to: today }
}

export type ChartBucketRow = { bucket: string; key: string; cost: number }

/**
 * Stacked chart points: one point per bucket key (empty buckets = no series
 * values, i.e. 0), series ranked by total cost, the tail beyond `maxSeries`
 * folded into `otherLabel`. `name` maps a raw key (process key / model id)
 * to its display label; rows that map to the same label are summed.
 */
export function buildStackedBuckets(
  keys: string[],
  rows: ChartBucketRow[],
  opts: { name?: (key: string) => string; maxSeries: number; otherLabel: string },
): { labels: string[]; points: ({ period: string } & Record<string, number | string>)[] } {
  const name = opts.name ?? ((k: string) => k)
  const byBucket = new Map<string, Record<string, number>>(keys.map((k) => [k, {}]))
  // Rows outside the requested range are ignored (also for the ranking).
  const inRange = rows.filter((r) => byBucket.has(r.bucket))
  const totals = new Map<string, number>()
  for (const r of inRange) totals.set(name(r.key), (totals.get(name(r.key)) ?? 0) + r.cost)
  const ranked = [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k]) => k)
  const fold = ranked.length > opts.maxSeries
  const kept = fold ? ranked.slice(0, opts.maxSeries - 1) : ranked
  const labels = fold ? [...kept, opts.otherLabel] : kept
  const keptSet = new Set(kept)
  for (const r of inRange) {
    const row = byBucket.get(r.bucket)!
    const label = keptSet.has(name(r.key)) ? name(r.key) : opts.otherLabel
    row[label] = (row[label] ?? 0) + r.cost
  }
  const points = keys.map((period) => {
    const v = byBucket.get(period)!
    return { period, ...Object.fromEntries(labels.map((l) => [l, v[l] ?? 0])) }
  })
  return { labels, points }
}

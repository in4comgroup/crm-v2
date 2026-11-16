import "server-only"

import { sql, type SQL } from "drizzle-orm"
import { UNSPECIFIED, formatPeriod } from "@/lib/analytics-format"
import {
  STATS_DEFAULT_TOP_N,
  STATS_MAX_ROWS,
  STATS_VOCAB,
  type StatsChart,
  type StatsResult,
  type StatsRow,
  type StatsSubject,
} from "@/lib/chat/stats"
import type { AppliedFilter } from "@/lib/chat/records"
import { execRows } from "@/server/analytics-query"
import { formatDate } from "@/server/chat/records/format"
import type { RecordsContext } from "@/server/chat/records/types"

// Generic whitelist → SQL engine of the chat statistics (spec §8) for the
// subjects other than `orders` (which run on the /analytics engine). A
// subject = a FROM / WHERE for the org + named measure and dimension SQL.
// Nothing the model writes reaches SQL as text: keys index into the
// subject's maps, every filter value and date is a bound parameter.

/** Invalid statistics input; the message is Russian and lists the allowed keys. */
export class StatsInputError extends Error {}

export type StatsDim = {
  /** Grouping key (cast to text). */
  key: SQL
  /** Display label (cast to text); use `caseLabel` for value lists. */
  label: SQL
  /** Label fix-up in JS (e.g. system stage names). */
  labelOf?: (key: string, label: string) => string
  /** Categories in label order (A→Z) instead of by value. */
  sortByLabel?: boolean
  /** Custom filter (value → condition); default compares key / label case-insensitively. */
  filter?: (ctx: RecordsContext, value: string) => Promise<SQL>
}

export type SqlSubject = {
  /** FROM … JOIN … (no WHERE). */
  from: (ctx: RecordsContext) => SQL
  /** Org + visibility conditions. */
  where: (ctx: RecordsContext) => SQL
  /** The subject's date (period + time dimensions); null = no date. */
  dateCol: SQL | null
  measures: Record<string, SQL>
  dimensions: Record<string, StatsDim>
}

export type NormalisedQuery = {
  measure: string
  dimension?: string
  splitBy?: string
  filters: { dimension: string; value: string }[]
  from: Date | null
  to: Date | null
  topN?: number
  chart?: StatsChart
}

/** `case col when 'a' then 'A' … else col end` with bound values. */
export function caseLabel(col: SQL, labels: Record<string, string>): SQL {
  const whens = Object.entries(labels).map(([k, v]) => sql`when ${k} then ${v}`)
  return sql`(case ${col}::text ${sql.join(whens, sql` `)} else ${col}::text end)`
}

const TIME_UNITS: Record<string, { unit: string; fmt: string }> = {
  "time.week": { unit: "week", fmt: "YYYY-MM-DD" },
  "time.month": { unit: "month", fmt: "YYYY-MM" },
  "time.quarter": { unit: "quarter", fmt: "YYYY-MM" },
  "time.year": { unit: "year", fmt: "YYYY" },
}

/** Russian label of a period key of one time dimension. */
export function timeLabel(dim: string, key: string): string {
  if (!key) return UNSPECIFIED
  if (dim === "time.year") return key
  if (dim === "time.quarter") {
    const [y, m] = key.split("-")
    return `${Math.floor((Number(m) - 1) / 3) + 1} кв. ${y}`
  }
  if (dim === "time.week") return `нед. с ${formatPeriod(key, true)}`
  return formatPeriod(key, true)
}

function timeDim(ctx: RecordsContext, dateCol: SQL, dim: string): StatsDim {
  const t = TIME_UNITS[dim]
  // Stored timestamps are UTC; bucket in the org time zone.
  const local = sql`((${dateCol}) at time zone 'UTC') at time zone ${ctx.timeZone}`
  const e = sql`to_char(date_trunc(${t.unit}, ${local}), ${t.fmt})`
  return { key: e, label: e, labelOf: (k) => timeLabel(dim, k) }
}

/** «01.01.2026 — 16.11.2026» / «с 01.01.2026» / «по …» / «за всё время». */
export function periodLabel(from: Date | null, to: Date | null, tz: string): string {
  if (from && to) return `${formatDate(from, tz)} — ${formatDate(to, tz)}`
  if (from) return `с ${formatDate(from, tz)}`
  if (to) return `по ${formatDate(to, tz)}`
  return "за всё время"
}

/** Chart for the result shape; the requested one when it fits (rules of §8). */
export function resolveChart(
  requested: StatsChart | undefined,
  shape: { isTime: boolean; split: boolean; rows: number },
): StatsChart {
  const fits = (c: StatsChart) =>
    c === "table" ||
    (c === "donut" && !shape.split && !shape.isTime && shape.rows >= 2 && shape.rows <= 6) ||
    (c === "stackedBar" && shape.split) ||
    ((c === "line" || c === "area") && shape.isTime) ||
    (c === "bar" && !shape.split)
  if (requested && fits(requested)) return requested
  if (shape.split) return "stackedBar"
  return shape.isTime ? "line" : "bar"
}

/** Why a result is empty, in Russian (the model must say it; the block shows it). */
export function emptyWarnings(q: Pick<NormalisedQuery, "filters" | "from" | "to">, empty: boolean): string[] {
  if (!empty) return []
  if (q.filters.length) return ["По заданным фильтрам ничего не найдено."]
  if (q.from || q.to) return ["За выбранный период данных нет."]
  return ["Данных нет."]
}

function dimFor(ctx: RecordsContext, def: SqlSubject, subject: StatsSubject, dim: string): StatsDim {
  if (TIME_UNITS[dim] && def.dateCol) return timeDim(ctx, def.dateCol, dim)
  const d = def.dimensions[dim]
  if (!d) {
    const allowed = Object.keys(STATS_VOCAB[subject].dimensions).join(", ")
    throw new StatsInputError(`Неизвестное измерение «${dim}» для «${STATS_VOCAB[subject].label}»; допустимо: ${allowed}`)
  }
  return d
}

type Raw = { k: string | null; l: string | null; sk?: string | null; sl?: string | null; v: number | string | null }

/** null = no value (an average / share over no rows) — never shown as 0. */
const num = (v: unknown): number | null => {
  if (v == null) return null
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

export async function runSqlSubject(
  ctx: RecordsContext,
  subject: StatsSubject,
  def: SqlSubject,
  q: NormalisedQuery,
): Promise<StatsResult> {
  const vocab = STATS_VOCAB[subject]
  const measureSql = def.measures[q.measure]
  if (!measureSql || !vocab.measures[q.measure]) {
    throw new StatsInputError(
      `Неизвестный показатель «${q.measure}» для «${vocab.label}»; допустимо: ${Object.keys(vocab.measures).join(", ")}`,
    )
  }

  const conds: SQL[] = [def.where(ctx)]
  const applied: AppliedFilter[] = []
  if (def.dateCol && q.from) conds.push(sql`${def.dateCol} >= ${q.from.toISOString()}`)
  if (def.dateCol && q.to) conds.push(sql`${def.dateCol} <= ${q.to.toISOString()}`)

  for (const f of q.filters) {
    const d = dimFor(ctx, def, subject, f.dimension)
    const v = f.value.trim()
    conds.push(
      d.filter ? await d.filter(ctx, v) : sql`(lower(${d.key}::text) = lower(${v}) or lower(${d.label}::text) = lower(${v}))`,
    )
    applied.push({ label: vocab.dimensions[f.dimension]?.label ?? f.dimension, value: v })
  }

  const from = def.from(ctx)
  const where = sql.join(conds, sql` and `)
  const measure = vocab.measures[q.measure]
  const isTime = Boolean(q.dimension && TIME_UNITS[q.dimension])
  const base = {
    query: { subject } as StatsResult["query"],
    subject,
    subjectLabel: vocab.label,
  }
  const metaBase = {
    measureLabel: measure.label,
    measureKind: measure.kind,
    periodLabel: def.dateCol ? periodLabel(q.from, q.to, ctx.timeZone) : "текущий каталог",
    applied,
  }

  // ── Scalar ───────────────────────────────────────────────────────
  if (!q.dimension) {
    const [r] = await execRows<{ v: number | string | null }>(sql`select (${measureSql})::float8 as v from ${from} where ${where}`)
    const value = num(r?.v)
    return {
      ...base,
      rows: [],
      scalar: value,
      meta: {
        ...metaBase,
        dimensionLabel: null,
        splitLabel: null,
        total: value ?? 0,
        rowCount: 0,
        truncated: false,
        chart: "table",
        warnings: emptyWarnings(q, value == null || value === 0),
      },
    }
  }

  const dim = dimFor(ctx, def, subject, q.dimension)
  const split = q.splitBy ? dimFor(ctx, def, subject, q.splitBy) : null
  if (split && q.splitBy === q.dimension) throw new StatsInputError("splitBy должен отличаться от dimension")
  const topN = Math.min(Math.max(Math.trunc(q.topN ?? STATS_DEFAULT_TOP_N), 1), 50)

  // Non-time categories: keep the top N by value (or all by label), so a
  // split result stays chart-sized.
  let keyGate: SQL | null = null
  let topTruncated = false
  if (!isTime && !dim.sortByLabel) {
    const top = await execRows<{ k: string | null }>(sql`
      select (${dim.key})::text as k from ${from} where ${where}
      group by 1 order by (${measureSql}) desc nulls last limit ${topN + 1}`)
    const keys = top.slice(0, topN).map((r) => r.k)
    const nonNull = keys.filter((k): k is string => k != null)
    const parts: SQL[] = []
    if (nonNull.length) parts.push(sql`(${dim.key})::text in (${sql.join(nonNull.map((k) => sql`${k}`), sql`, `)})`)
    if (keys.includes(null)) parts.push(sql`(${dim.key}) is null`)
    keyGate = parts.length ? sql`(${sql.join(parts, sql` or `)})` : sql`false`
    if (top.length > topN) topTruncated = true
  }

  const select = split
    ? sql`(${dim.key})::text as k, (${dim.label})::text as l, (${split.key})::text as sk, (${split.label})::text as sl`
    : sql`(${dim.key})::text as k, (${dim.label})::text as l`
  const groupBy = split ? sql`1, 2, 3, 4` : sql`1, 2`
  const order = isTime || dim.sortByLabel ? sql`1 asc` : sql`v desc nulls last`
  const rows = await execRows<Raw>(sql`
    select ${select}, (${measureSql})::float8 as v
    from ${from}
    where ${where}${keyGate ? sql` and ${keyGate}` : sql``}
    group by ${groupBy}
    order by ${order}${split ? sql`, 3 asc` : sql``}
    limit ${STATS_MAX_ROWS + 1}`)

  const truncated = topTruncated || rows.length > STATS_MAX_ROWS
  // Groups without a value (an average / share over no rows) are left out.
  const out: StatsRow[] = rows.slice(0, STATS_MAX_ROWS).flatMap((r) => {
    const value = num(r.v)
    if (value == null) return []
    const k = r.k ?? ""
    const l = r.k == null ? UNSPECIFIED : dim.labelOf ? dim.labelOf(k, r.l ?? k) : (r.l ?? k)
    const row: StatsRow = { key: k, label: l, value }
    if (split) {
      const sk = r.sk ?? ""
      row.splitKey = sk
      row.splitLabel = r.sk == null ? UNSPECIFIED : split.labelOf ? split.labelOf(sk, r.sl ?? sk) : (r.sl ?? sk)
    }
    return [row]
  })
  const total = measure.kind === "percent" || measure.kind === "days" ? 0 : out.reduce((a, r) => a + r.value, 0)

  return {
    ...base,
    rows: out,
    scalar: null,
    meta: {
      ...metaBase,
      dimensionLabel: vocab.dimensions[q.dimension]?.label ?? q.dimension,
      splitLabel: q.splitBy ? (vocab.dimensions[q.splitBy]?.label ?? q.splitBy) : null,
      total,
      rowCount: out.length,
      truncated,
      chart: resolveChart(q.chart, { isTime, split: Boolean(split), rows: new Set(out.map((r) => r.key)).size }),
      warnings: emptyWarnings(q, out.length === 0),
    },
  }
}

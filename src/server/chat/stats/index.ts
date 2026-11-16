import "server-only"

import {
  DIMENSIONS as ORDER_DIMENSIONS,
  type AnalyticsQuerySpec,
  type DimensionKey,
  type MeasureKey,
} from "@/lib/analytics-semantic"
import {
  STATS_SUBJECTS,
  STATS_VOCAB,
  type StatsQuery,
  type StatsResult,
  type StatsSubject,
} from "@/lib/chat/stats"
import { computeAnalyticsBounds } from "@/server/analytics-query"
import { runAnalyticsQuery } from "@/server/analytics-semantic"
import { parseDay } from "@/server/chat/records/shared"
import type { RecordsContext } from "@/server/chat/records/types"
import { runClientsStats } from "./clients"
import { StatsInputError, periodLabel, runSqlSubject, type NormalisedQuery, type SqlSubject } from "./engine"
import { dealsSubject, productsSubject, sourcesSubject, tasksSubject, topicsSubject } from "./subjects"

// Statistics of the AI chat (docs/specs/ai-chat/01-specification.md §8):
// ONE entry point for the chat tool `queryStats` (CH4). The context (org,
// user, topics gate, time zone) comes from the SESSION via
// `loadRecordsContext` — never from the model.

export { StatsInputError } from "./engine"

const SQL_SUBJECTS: Partial<Record<StatsSubject, SqlSubject>> = {
  deals: dealsSubject,
  tasks: tasksSubject,
  sources: sourcesSubject,
  topics: topicsSubject,
  products: productsSubject,
}

/** Subjects the user can ask about (topics only in topics mode `on`). */
export function visibleStatsSubjects(ctx: RecordsContext): StatsSubject[] {
  return STATS_SUBJECTS.filter((s) => ctx.topicsVisible || !STATS_VOCAB[s].topicsOnly)
}

export async function runStatsQuery(ctx: RecordsContext, query: StatsQuery): Promise<StatsResult> {
  const subject = query.subject
  if (!visibleStatsSubjects(ctx).includes(subject)) {
    throw new StatsInputError(`Статистика «${STATS_VOCAB[subject]?.label ?? subject}» недоступна`)
  }
  const vocab = STATS_VOCAB[subject]
  const from = parseDay(query.from, false, ctx.timeZone)
  const to = parseDay(query.to, true, ctx.timeZone)
  if (query.from && !from) throw new StatsInputError(`Неверная дата начала «${query.from}» (нужно YYYY-MM-DD)`)
  if (query.to && !to) throw new StatsInputError(`Неверная дата конца «${query.to}» (нужно YYYY-MM-DD)`)
  if (from && to && to < from) throw new StatsInputError("Конец периода раньше начала")

  // A period is from / to — a filter on a time dimension («time.quarter =
  // 2026-Q1») used to match nothing and read as «no data» (CH7 eval h06).
  const timeFilter = (query.filters ?? []).find((f) => f.value?.trim() && vocab.dimensions[f.dimension]?.isTime)
  if (timeFilter) {
    throw new StatsInputError(
      `Период задаётся через from / to (YYYY-MM-DD, включительно), не фильтром по «${timeFilter.dimension}»: например первый квартал 2026 = from 2026-01-01, to 2026-03-31`,
    )
  }

  const q: NormalisedQuery = {
    measure: query.measure ?? vocab.defaultMeasure,
    dimension: query.dimension,
    splitBy: query.splitBy,
    filters: (query.filters ?? []).filter((f) => f.value?.trim()),
    from,
    to,
    topN: query.topN,
    chart: query.chart,
  }

  const result =
    subject === "orders"
      ? await runOrders(ctx, q)
      : subject === "clients"
        ? await runClientsStats(ctx, q)
        : await runSqlSubject(ctx, subject, SQL_SUBJECTS[subject]!, q)
  return { ...result, query }
}

// ── orders = the /analytics engine ───────────────────────────────────

async function runOrders(ctx: RecordsContext, q: NormalisedQuery): Promise<StatsResult> {
  const vocab = STATS_VOCAB.orders
  const bad = (what: string, key: string, allowed: string[]) =>
    new StatsInputError(`Неизвестное ${what} «${key}» для «${vocab.label}»; допустимо: ${allowed.join(", ")}`)
  if (!vocab.measures[q.measure]) throw bad("показатель", q.measure, Object.keys(vocab.measures))
  for (const d of [q.dimension, q.splitBy, ...q.filters.map((f) => f.dimension)]) {
    if (d && !ORDER_DIMENSIONS[d as DimensionKey]) throw bad("измерение", d, Object.keys(ORDER_DIMENSIONS))
  }

  // Default period = the org's real order span, like the /analytics page.
  const bounds = await computeAnalyticsBounds(ctx.orgId)
  const defFrom = bounds.first ? new Date(`${bounds.first}T00:00:00.000Z`) : new Date(Date.UTC(ctx.now.getUTCFullYear(), 0, 1))
  const defTo = bounds.last ? new Date(new Date(`${bounds.last}T00:00:00.000Z`).getTime() + 86_400_000) : ctx.now
  // The analytics engine takes an exclusive upper bound.
  const from = q.from ?? defFrom
  const toExclusive = q.to ? new Date(q.to.getTime() + 1) : defTo

  const spec: AnalyticsQuerySpec = {
    measure: q.measure as MeasureKey,
    dimension: q.dimension as DimensionKey | undefined,
    splitBy: q.splitBy as DimensionKey | undefined,
    filters: q.filters.map((f) => ({ dimension: f.dimension as DimensionKey, value: f.value })),
    from: from.toISOString(),
    to: toExclusive.toISOString(),
    topN: q.topN,
    chart: q.chart,
  }
  const r = await runAnalyticsQuery(ctx.orgId, spec, { from, to: toExclusive })
  return {
    query: { subject: "orders" },
    subject: "orders",
    subjectLabel: vocab.label,
    rows: r.rows,
    scalar: r.scalar,
    meta: {
      measureLabel: r.meta.measureLabel,
      measureKind: r.meta.measureKind,
      dimensionLabel: r.meta.dimensionLabel,
      splitLabel: r.meta.splitLabel,
      total: r.meta.total,
      rowCount: r.meta.rowCount,
      truncated: r.meta.truncated,
      periodLabel: periodLabel(from, new Date(toExclusive.getTime() - 1), ctx.timeZone),
      chart: r.meta.chart,
      warnings: r.meta.warnings,
      applied: q.filters.map((f) => ({
        label: ORDER_DIMENSIONS[f.dimension as DimensionKey]?.label ?? f.dimension,
        value: f.value.trim(),
      })),
    },
  }
}

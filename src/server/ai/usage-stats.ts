import "server-only"

import { and, eq, gte, lt, ne, sql, type SQL } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { aiGateway, aiUsageEvent, organization, user } from "@/db/schema"

// Usage statistics for the «Использование ИИ» admin tab and the per-process
// / per-model numbers on the other AI tabs
// (docs/specs/models/04-usage-and-cost.md §5). No session logic: callers
// (admin routes) check access. Cost = exact gateway cost when known, else
// the estimate.

export type UsageFilters = {
  from: Date
  to: Date // exclusive
  orgId?: string | null // "system" = calls without an organization
  processKey?: string | null
  model?: string | null // response model
  status?: "ok" | "error" | "aborted" | null
}

const COST = sql<string>`coalesce(${aiUsageEvent.costActualUsd}, ${aiUsageEvent.costEstimateUsd})`
// End-user price: cost × (1 + markup in force at call time / 100) (05 §3).
const COST_WITH_MARKUP = sql<string>`${COST} * (1 + coalesce(${aiUsageEvent.markupPercent}, 0) / 100)`

function where(f: UsageFilters): SQL {
  const conds: SQL[] = [gte(aiUsageEvent.createdAt, f.from), lt(aiUsageEvent.createdAt, f.to)]
  if (f.orgId === "system") conds.push(sql`${aiUsageEvent.organizationId} IS NULL`)
  else if (f.orgId) conds.push(eq(aiUsageEvent.organizationId, f.orgId))
  if (f.processKey) conds.push(eq(aiUsageEvent.processKey, f.processKey))
  if (f.model) conds.push(eq(aiUsageEvent.responseModel, f.model))
  if (f.status) conds.push(eq(aiUsageEvent.status, f.status))
  return and(...conds)!
}

// Aggregates shared by every view.
const METRICS = {
  calls: sql<number>`count(*)::int`,
  errors: sql<number>`count(*) filter (where ${aiUsageEvent.status} <> 'ok')::int`,
  inputTokens: sql<number>`coalesce(sum(${aiUsageEvent.inputTokens}), 0)::bigint`,
  outputTokens: sql<number>`coalesce(sum(${aiUsageEvent.outputTokens}), 0)::bigint`,
  cost: sql<string>`coalesce(sum(${COST}), 0)`,
  costWithMarkup: sql<string>`coalesce(sum(${COST_WITH_MARKUP}), 0)`,
  // Calls whose cost is still only the estimate.
  estimated: sql<number>`count(*) filter (where ${aiUsageEvent.costActualUsd} is null and ${aiUsageEvent.costEstimateUsd} is not null)::int`,
  // Successful calls with no cost at all (model without registry price).
  unpriced: sql<number>`count(*) filter (where ${aiUsageEvent.status} = 'ok' and ${aiUsageEvent.costActualUsd} is null and ${aiUsageEvent.costEstimateUsd} is null)::int`,
}

type RawMetrics = {
  calls: number
  errors: number
  inputTokens: number | string
  outputTokens: number | string
  cost: string
  costWithMarkup: string
  estimated: number
  unpriced: number
}

export type UsageMetrics = {
  calls: number
  errors: number
  inputTokens: number
  outputTokens: number
  cost: number
  costWithMarkup: number
  estimated: number
  unpriced: number
}

const toMetrics = (r: RawMetrics): UsageMetrics => ({
  calls: Number(r.calls),
  errors: Number(r.errors),
  inputTokens: Number(r.inputTokens),
  outputTokens: Number(r.outputTokens),
  cost: Number(r.cost),
  costWithMarkup: Number(r.costWithMarkup),
  estimated: Number(r.estimated),
  unpriced: Number(r.unpriced),
})

export async function usageSummary(f: UsageFilters): Promise<UsageMetrics> {
  const [row] = await db.select(METRICS).from(aiUsageEvent).where(where(f))
  return toMetrics(row as RawMetrics)
}

export type UsageDailyRow = { day: string; key: string; calls: number; cost: number }

/** Cost per UTC day, stacked by process or by model. */
export async function usageDaily(
  f: UsageFilters,
  stackBy: "process" | "model",
): Promise<UsageDailyRow[]> {
  const key =
    stackBy === "process"
      ? aiUsageEvent.processKey
      : sql<string>`coalesce(${aiUsageEvent.responseModel}, ${aiUsageEvent.requestModel})`
  const day = sql<string>`to_char(date_trunc('day', ${aiUsageEvent.createdAt}), 'YYYY-MM-DD')`
  const rows = await db
    .select({ day, key, calls: METRICS.calls, cost: METRICS.cost })
    .from(aiUsageEvent)
    .where(where(f))
    .groupBy(day, key)
    .orderBy(day)
  return rows.map((r) => ({ day: r.day, key: String(r.key), calls: Number(r.calls), cost: Number(r.cost) }))
}

export type UsageBreakdownRow = UsageMetrics & {
  key: string // org id ("system" for none) / process key / model id
  label: string | null // org name; null for process / model (UI labels them)
  share: number // of total cost, 0..1
  avgCost: number
  avgInputTokens: number
  avgOutputTokens: number
  fallbackRate: number | null // model view: share of calls served by a fallback
}

export async function usageBreakdown(
  f: UsageFilters,
  groupBy: "org" | "process" | "model",
): Promise<UsageBreakdownRow[]> {
  let rows: (RawMetrics & { key: string | null; label: string | null; fallbacks: number })[]
  const fallbacks = sql<number>`count(*) filter (where ${aiUsageEvent.responseModel} is not null and ${aiUsageEvent.responseModel} <> ${aiUsageEvent.requestModel})::int`
  if (groupBy === "org") {
    rows = (await db
      .select({ key: aiUsageEvent.organizationId, label: organization.name, fallbacks, ...METRICS })
      .from(aiUsageEvent)
      .leftJoin(organization, eq(organization.id, aiUsageEvent.organizationId))
      .where(where(f))
      .groupBy(aiUsageEvent.organizationId, organization.name)) as typeof rows
  } else {
    const key =
      groupBy === "process"
        ? aiUsageEvent.processKey
        : sql<string>`coalesce(${aiUsageEvent.responseModel}, ${aiUsageEvent.requestModel})`
    rows = (await db
      .select({ key, label: sql<null>`null`, fallbacks, ...METRICS })
      .from(aiUsageEvent)
      .where(where(f))
      .groupBy(key)) as typeof rows
  }
  const total = rows.reduce((s, r) => s + Number(r.cost), 0)
  return rows
    .map((r) => {
      const m = toMetrics(r)
      return {
        ...m,
        key: r.key ?? "system",
        label: r.label,
        share: total > 0 ? m.cost / total : 0,
        avgCost: m.calls ? m.cost / m.calls : 0,
        avgInputTokens: m.calls ? m.inputTokens / m.calls : 0,
        avgOutputTokens: m.calls ? m.outputTokens / m.calls : 0,
        fallbackRate: groupBy === "model" && m.calls ? Number(r.fallbacks) / m.calls : null,
      }
    })
    .sort((a, b) => b.cost - a.cost || b.calls - a.calls)
}

/** Organizations that have usage in the period (filter select). */
export async function usageOrgOptions(f: Pick<UsageFilters, "from" | "to">) {
  const rows = await db
    .selectDistinct({ id: aiUsageEvent.organizationId, name: organization.name })
    .from(aiUsageEvent)
    .leftJoin(organization, eq(organization.id, aiUsageEvent.organizationId))
    .where(and(gte(aiUsageEvent.createdAt, f.from), lt(aiUsageEvent.createdAt, f.to)))
  return rows.map((r) => ({ id: r.id ?? "system", name: r.name }))
}

/** Models that have usage in the period (filter select). */
export async function usageModelOptions(f: Pick<UsageFilters, "from" | "to">) {
  const rows = await db
    .selectDistinct({ model: aiUsageEvent.responseModel })
    .from(aiUsageEvent)
    .where(
      and(
        gte(aiUsageEvent.createdAt, f.from),
        lt(aiUsageEvent.createdAt, f.to),
        sql`${aiUsageEvent.responseModel} is not null`,
      ),
    )
  return rows.map((r) => r.model!).sort()
}

export type ProcessUsage30d = {
  calls: number
  cost: number
  avgInputTokens: number
  avgOutputTokens: number
}

/** Last 30 days per process, successful calls only (the «Процессы ИИ» tab). */
export async function processUsageLast30d(): Promise<Record<string, ProcessUsage30d>> {
  const from = new Date(Date.now() - 30 * 86_400_000)
  const rows = await db
    .select({
      key: aiUsageEvent.processKey,
      calls: METRICS.calls,
      cost: METRICS.cost,
      avgIn: sql<string>`coalesce(avg(${aiUsageEvent.inputTokens}), 0)`,
      avgOut: sql<string>`coalesce(avg(${aiUsageEvent.outputTokens}), 0)`,
    })
    .from(aiUsageEvent)
    .where(and(gte(aiUsageEvent.createdAt, from), eq(aiUsageEvent.status, "ok")))
    .groupBy(aiUsageEvent.processKey)
  return Object.fromEntries(
    rows.map((r) => [
      r.key,
      {
        calls: Number(r.calls),
        cost: Number(r.cost),
        avgInputTokens: Number(r.avgIn),
        avgOutputTokens: Number(r.avgOut),
      },
    ]),
  )
}

/** Last 30 days of one model (the «Модели» drawer). */
export async function modelUsageLast30d(modelId: string) {
  const from = new Date(Date.now() - 30 * 86_400_000)
  const [row] = await db
    .select({ calls: METRICS.calls, errors: METRICS.errors, cost: METRICS.cost })
    .from(aiUsageEvent)
    .where(and(gte(aiUsageEvent.createdAt, from), eq(aiUsageEvent.responseModel, modelId)))
  const [byProcess] = await db
    .select({ n: sql<number>`count(distinct ${aiUsageEvent.processKey})::int` })
    .from(aiUsageEvent)
    .where(
      and(
        gte(aiUsageEvent.createdAt, from),
        eq(aiUsageEvent.responseModel, modelId),
        ne(aiUsageEvent.status, "error"),
      ),
    )
  return {
    calls: Number(row.calls),
    errors: Number(row.errors),
    cost: Number(row.cost),
    processes: Number(byProcess.n),
  }
}

/** Rough cost of 1,000 calls of a process on a model, from its average tokens. */
export function costPer1000Calls(
  usage: Pick<ProcessUsage30d, "avgInputTokens" | "avgOutputTokens"> | undefined,
  price: { input: number | null; output: number | null } | null,
): number | null {
  if (!usage || !price || price.input == null || price.output == null) return null
  return ((usage.avgInputTokens * price.input + usage.avgOutputTokens * price.output) / 1e6) * 1000
}

/**
 * Sync health for the admin tabs: when prices were last synced (oldest of
 * the enabled gateways) and how many calls in the whole ledger still have
 * only an estimated cost. Used to warn when the daily run did not happen.
 */
export async function usageSyncStatus() {
  const [gw] = await db
    .select({
      oldest: sql<string | null>`min(${aiGateway.lastSyncedAt})`,
      never: sql<number>`count(*) filter (where ${aiGateway.lastSyncedAt} is null)::int`,
      errors: sql<string | null>`string_agg(${aiGateway.lastSyncError}, '; ')`,
    })
    .from(aiGateway)
    .where(eq(aiGateway.isEnabled, true))
  const [pending] = await db
    .select({
      n: sql<number>`count(*) filter (where ${aiUsageEvent.costActualUsd} is null and cardinality(${aiUsageEvent.responseIds}) > 0 and ${aiUsageEvent.costReconcileAttempts} < 3)::int`,
    })
    .from(aiUsageEvent)
  return {
    lastPriceSyncAt: Number(gw.never) > 0 ? null : gw.oldest ? new Date(gw.oldest).toISOString() : null,
    priceSyncError: gw.errors,
    pendingExactCost: Number(pending.n),
  }
}

// ── end-user view (05 §5) ──────────────────────────────────────────────

export type OrgUsageView = {
  calls: number
  cost: number // WITH markup — the only cost an end user ever sees
  byProcess: { processKey: string; calls: number; cost: number }[]
  byUser: { userId: string; name: string | null; calls: number; cost: number }[]
}

/**
 * AI usage of ONE organization for its owners. Never returns the gateway
 * cost, the markup % or model ids — only calls and the marked-up cost, per
 * process and (for interactive processes) per user.
 */
export async function orgUsageView(
  orgId: string,
  from: Date,
  to: Date,
  interactiveProcessKeys: string[],
): Promise<OrgUsageView> {
  const base = and(
    eq(aiUsageEvent.organizationId, orgId),
    gte(aiUsageEvent.createdAt, from),
    lt(aiUsageEvent.createdAt, to),
  )!
  const [[total], byProcess, byUser] = await Promise.all([
    db.select({ calls: METRICS.calls, cost: METRICS.costWithMarkup }).from(aiUsageEvent).where(base),
    db
      .select({ key: aiUsageEvent.processKey, calls: METRICS.calls, cost: METRICS.costWithMarkup })
      .from(aiUsageEvent)
      .where(base)
      .groupBy(aiUsageEvent.processKey),
    interactiveProcessKeys.length
      ? db
          .select({
            userId: aiUsageEvent.userId,
            name: user.name,
            calls: METRICS.calls,
            cost: METRICS.costWithMarkup,
          })
          .from(aiUsageEvent)
          .leftJoin(user, eq(user.id, aiUsageEvent.userId))
          .where(
            and(
              base,
              sql`${aiUsageEvent.userId} is not null`,
              sql`${aiUsageEvent.processKey} in (${sql.join(
                interactiveProcessKeys.map((k) => sql`${k}`),
                sql`, `,
              )})`,
            ),
          )
          .groupBy(aiUsageEvent.userId, user.name)
      : Promise.resolve([]),
  ])
  return {
    calls: Number(total.calls),
    cost: Number(total.cost),
    byProcess: byProcess
      .map((r) => ({ processKey: r.key, calls: Number(r.calls), cost: Number(r.cost) }))
      .sort((a, b) => b.cost - a.cost),
    byUser: byUser
      .map((r) => ({ userId: r.userId!, name: r.name, calls: Number(r.calls), cost: Number(r.cost) }))
      .sort((a, b) => b.cost - a.cost),
  }
}

import "server-only"

import { and, eq, gte, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { aiUsageEvent, organization } from "@/db/schema"
import { getOrgSetting, listOrgsWithSetting } from "@/server/org-settings"
import { getPlatformSetting } from "@/server/platform-settings"
import { aiMonthlyLimitState, startOfUtcMonth, type AiMonthlyLimitState } from "@/lib/ai-budget"

// Per-organization AI limits:
// - DAILY budget (docs/specs/models/07-daily-budget.md; topics plan decision
//   R4) = gateway cost in USD per UTC day. Owners never see its amounts.
// - MONTHLY limit (docs/specs/models/08-monthly-limit.md) = END-USER cost
//   (gateway cost × (1 + markup at call time / 100)) in USD per calendar
//   month, UTC. Owners see it on /account.
// Background AI processes stop when EITHER is used up; interactive ones
// still run (a user is waiting) and are only logged. Calls without an
// organization (`systemCall`) are not budgeted.

export class AiBudgetExceededError extends Error {
  constructor(
    public readonly organizationId: string,
    public readonly budgetUsd: number,
    public readonly spentUsd: number,
    /** Which limit stopped the call. */
    public readonly period: "day" | "month" = "day",
  ) {
    super(
      period === "month"
        ? `Monthly AI limit of organization ${organizationId} is used up ($${spentUsd.toFixed(2)} of $${budgetUsd.toFixed(2)}); background AI resumes next month (UTC)`
        : `Daily AI budget of organization ${organizationId} is used up ($${spentUsd.toFixed(2)} of $${budgetUsd.toFixed(2)}); background AI resumes tomorrow (UTC)`,
    )
    this.name = "AiBudgetExceededError"
  }
}

// End-user cost of one event: cost × (1 + markup in force at call time / 100).
const COST = sql`coalesce(${aiUsageEvent.costActualUsd}, ${aiUsageEvent.costEstimateUsd})`
const END_USER_COST = sql<string>`coalesce(sum(${COST} * (1 + coalesce(${aiUsageEvent.markupPercent}, 0) / 100)), 0)`

/** Effective monthly limit of an org (end-user USD): its override, else the platform default. */
export async function getOrgMonthlyLimitUsd(orgId: string): Promise<number> {
  const override = await getOrgSetting(orgId, "ai.budget.monthly_usd")
  return override ?? (await getPlatformSetting("ai.budget.monthly_usd"))
}

/** End-user cost of the org since the 1st of this month, 00:00 UTC. */
export async function queryOrgSpendMonthUsd(orgId: string, now = new Date()): Promise<number> {
  const [row] = await db
    .select({ spent: END_USER_COST })
    .from(aiUsageEvent)
    .where(and(eq(aiUsageEvent.organizationId, orgId), gte(aiUsageEvent.createdAt, startOfUtcMonth(now))))
  return Number(row?.spent ?? 0)
}

/** Effective daily budget of an org: its override, else the platform default. */
export async function getOrgDailyBudgetUsd(orgId: string): Promise<number> {
  const override = await getOrgSetting(orgId, "ai.budget.daily_usd")
  return override ?? (await getPlatformSetting("ai.budget.daily_usd"))
}

const startOfUtcDay = (d = new Date()) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))

/** Gateway cost of the org since 00:00 UTC (exact cost when known, else estimate). */
export async function queryOrgSpendTodayUsd(orgId: string): Promise<number> {
  const [row] = await db
    .select({
      spent: sql<string>`coalesce(sum(coalesce(${aiUsageEvent.costActualUsd}, ${aiUsageEvent.costEstimateUsd})), 0)`,
    })
    .from(aiUsageEvent)
    .where(and(eq(aiUsageEvent.organizationId, orgId), gte(aiUsageEvent.createdAt, startOfUtcDay())))
  return Number(row?.spent ?? 0)
}

// Spend cache: one DB sum per org per 30 s, plus the cost of calls recorded
// by this server instance in between (noteSpend). Other instances' calls
// appear after the next refresh — a small, bounded overshoot is accepted.
const SPEND_TTL_MS = 30_000
const spendCache = new Map<string, { day: number; at: number; spent: number }>()
const monthSpendCache = new Map<string, { month: number; at: number; spent: number }>()

export async function getOrgSpendMonthUsd(orgId: string): Promise<number> {
  const month = startOfUtcMonth(new Date()).getTime()
  const hit = monthSpendCache.get(orgId)
  if (hit && hit.month === month && Date.now() - hit.at < SPEND_TTL_MS) return hit.spent
  const spent = await queryOrgSpendMonthUsd(orgId)
  monthSpendCache.set(orgId, { month, at: Date.now(), spent })
  return spent
}

export async function getOrgSpendTodayUsd(orgId: string): Promise<number> {
  const day = startOfUtcDay().getTime()
  const hit = spendCache.get(orgId)
  if (hit && hit.day === day && Date.now() - hit.at < SPEND_TTL_MS) return hit.spent
  const spent = await queryOrgSpendTodayUsd(orgId)
  spendCache.set(orgId, { day, at: Date.now(), spent })
  return spent
}

/**
 * Called by the usage recorder after each call of this instance: `usd` =
 * gateway cost (daily budget), `markupPercent` = the markup stored with the
 * event (monthly limit = end-user cost).
 */
export function noteSpend(orgId: string, usd: number, markupPercent = 0) {
  if (!Number.isFinite(usd)) return
  const hit = spendCache.get(orgId)
  if (hit && hit.day === startOfUtcDay().getTime()) hit.spent += usd
  const m = monthSpendCache.get(orgId)
  if (m && m.month === startOfUtcMonth(new Date()).getTime()) m.spent += usd * (1 + (markupPercent || 0) / 100)
}

export type BudgetStatus = {
  /** Background AI is stopped: the daily budget OR the monthly limit is used up. */
  exceeded: boolean
  /** Daily budget (gateway cost). */
  budgetUsd: number
  spentUsd: number
  dailyExceeded: boolean
  /** Monthly limit (end-user cost). */
  monthly: AiMonthlyLimitState
}

export async function getOrgBudgetStatus(orgId: string): Promise<BudgetStatus> {
  const [budgetUsd, spentUsd, monthBudget, monthSpent] = await Promise.all([
    getOrgDailyBudgetUsd(orgId),
    getOrgSpendTodayUsd(orgId),
    getOrgMonthlyLimitUsd(orgId),
    getOrgSpendMonthUsd(orgId),
  ])
  const dailyExceeded = spentUsd >= budgetUsd
  const monthly = aiMonthlyLimitState(monthSpent, monthBudget, new Date())
  return { exceeded: dailyExceeded || monthly.level === "exceeded", budgetUsd, spentUsd, dailyExceeded, monthly }
}

/**
 * Admin view: every organization with its override, effective budget and
 * spend today. Fresh numbers (no cache).
 */
export async function listOrgBudgets(): Promise<
  {
    organizationId: string
    name: string
    overrideUsd: number | null
    budgetUsd: number
    spentTodayUsd: number
    /** Monthly limit (end-user cost). */
    monthlyOverrideUsd: number | null
    monthlyLimitUsd: number
    spentMonthUsd: number
  }[]
> {
  const [orgs, spendRows, overrides, defaultUsd, monthRows, monthOverrides, monthDefault] = await Promise.all([
    db.select({ id: organization.id, name: organization.name }).from(organization),
    db
      .select({
        orgId: aiUsageEvent.organizationId,
        spent: sql<string>`coalesce(sum(coalesce(${aiUsageEvent.costActualUsd}, ${aiUsageEvent.costEstimateUsd})), 0)`,
      })
      .from(aiUsageEvent)
      .where(gte(aiUsageEvent.createdAt, startOfUtcDay()))
      .groupBy(aiUsageEvent.organizationId),
    listOrgsWithSetting("ai.budget.daily_usd"),
    getPlatformSetting("ai.budget.daily_usd"),
    db
      .select({ orgId: aiUsageEvent.organizationId, spent: END_USER_COST })
      .from(aiUsageEvent)
      .where(gte(aiUsageEvent.createdAt, startOfUtcMonth(new Date())))
      .groupBy(aiUsageEvent.organizationId),
    listOrgsWithSetting("ai.budget.monthly_usd"),
    getPlatformSetting("ai.budget.monthly_usd"),
  ])
  const spent = new Map(spendRows.map((r) => [r.orgId, Number(r.spent)]))
  const override = new Map(overrides.map((o) => [o.organizationId, o.value]))
  const monthSpent = new Map(monthRows.map((r) => [r.orgId, Number(r.spent)]))
  const monthOverride = new Map(monthOverrides.map((o) => [o.organizationId, o.value]))
  return orgs
    .map((o) => {
      const ov = override.get(o.id) ?? null
      const mov = monthOverride.get(o.id) ?? null
      return {
        organizationId: o.id,
        name: o.name,
        overrideUsd: ov,
        budgetUsd: ov ?? defaultUsd,
        spentTodayUsd: spent.get(o.id) ?? 0,
        monthlyOverrideUsd: mov,
        monthlyLimitUsd: mov ?? monthDefault,
        spentMonthUsd: monthSpent.get(o.id) ?? 0,
      }
    })
    .sort((a, b) => b.spentMonthUsd - a.spentMonthUsd || b.spentTodayUsd - a.spentTodayUsd || a.name.localeCompare(b.name))
}

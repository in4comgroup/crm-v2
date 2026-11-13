import "server-only"

import { and, eq, gte, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { aiUsageEvent, organization } from "@/db/schema"
import { getOrgSetting, listOrgsWithSetting } from "@/server/org-settings"
import { getPlatformSetting } from "@/server/platform-settings"

// Per-organization daily AI budget (docs/specs/models/07-daily-budget.md;
// topics plan decision R4). Budget = gateway cost in USD per UTC day.
// Background AI processes stop when the budget is used up; interactive
// ones still run (a user is waiting) and are only logged. Calls without an
// organization (`systemCall`) are not budgeted.

export class AiBudgetExceededError extends Error {
  constructor(
    public readonly organizationId: string,
    public readonly budgetUsd: number,
    public readonly spentUsd: number,
  ) {
    super(
      `Daily AI budget of organization ${organizationId} is used up ($${spentUsd.toFixed(2)} of $${budgetUsd.toFixed(2)}); background AI resumes tomorrow (UTC)`,
    )
    this.name = "AiBudgetExceededError"
  }
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

export async function getOrgSpendTodayUsd(orgId: string): Promise<number> {
  const day = startOfUtcDay().getTime()
  const hit = spendCache.get(orgId)
  if (hit && hit.day === day && Date.now() - hit.at < SPEND_TTL_MS) return hit.spent
  const spent = await queryOrgSpendTodayUsd(orgId)
  spendCache.set(orgId, { day, at: Date.now(), spent })
  return spent
}

/** Called by the usage recorder after each call of this instance. */
export function noteSpend(orgId: string, usd: number) {
  const hit = spendCache.get(orgId)
  if (hit && hit.day === startOfUtcDay().getTime() && Number.isFinite(usd)) hit.spent += usd
}

export type BudgetStatus = { budgetUsd: number; spentUsd: number; exceeded: boolean }

export async function getOrgBudgetStatus(orgId: string): Promise<BudgetStatus> {
  const [budgetUsd, spentUsd] = await Promise.all([
    getOrgDailyBudgetUsd(orgId),
    getOrgSpendTodayUsd(orgId),
  ])
  return { budgetUsd, spentUsd, exceeded: spentUsd >= budgetUsd }
}

/**
 * Admin view: every organization with its override, effective budget and
 * spend today. Fresh numbers (no cache).
 */
export async function listOrgBudgets(): Promise<
  { organizationId: string; name: string; overrideUsd: number | null; budgetUsd: number; spentTodayUsd: number }[]
> {
  const [orgs, spendRows, overrides, defaultUsd] = await Promise.all([
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
  ])
  const spent = new Map(spendRows.map((r) => [r.orgId, Number(r.spent)]))
  const override = new Map(overrides.map((o) => [o.organizationId, o.value]))
  return orgs
    .map((o) => {
      const ov = override.get(o.id) ?? null
      return {
        organizationId: o.id,
        name: o.name,
        overrideUsd: ov,
        budgetUsd: ov ?? defaultUsd,
        spentTodayUsd: spent.get(o.id) ?? 0,
      }
    })
    .sort((a, b) => b.spentTodayUsd - a.spentTodayUsd || a.name.localeCompare(b.name))
}

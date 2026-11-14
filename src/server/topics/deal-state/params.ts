import "server-only"

import { and, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { deal } from "@/db/schema"
import { getOrgSetting } from "@/server/org-settings"
import { getPlatformSetting } from "@/server/platform-settings"

// Settings + the dirty flag of phase 5a (spec topics/01 §9.3 R16, §9.4).
// Ladder for every key: org_setting → platform_setting → code default.

export type DealStateParams = {
  /** One state run per deal per this many minutes (R16). */
  debounceMinutes: number
  /** I5: a risk with severity ≥ this raises its trigger topic to «Сейчас». */
  riskImmediateMinSeverity: number
  /** PAYMENT_TERMS_ABOVE_POLICY policy; null = unknown → condition false. */
  maxDeferralDays: number | null
  maxCreditLimitRub: number | null
}

export async function getDealStateParams(orgId: string): Promise<DealStateParams> {
  const [od, os, oy, oc, pd, ps, py, pc] = await Promise.all([
    getOrgSetting(orgId, "deals.stateDebounceMinutes"),
    getOrgSetting(orgId, "deals.riskImmediateMinSeverity"),
    getOrgSetting(orgId, "deals.maxDeferralDays"),
    getOrgSetting(orgId, "deals.maxCreditLimitRub"),
    getPlatformSetting("deals.stateDebounceMinutes"),
    getPlatformSetting("deals.riskImmediateMinSeverity"),
    getPlatformSetting("deals.maxDeferralDays"),
    getPlatformSetting("deals.maxCreditLimitRub"),
  ])
  return {
    debounceMinutes: od ?? pd,
    riskImmediateMinSeverity: os ?? ps,
    maxDeferralDays: oy ?? py,
    maxCreditLimitRub: oc ?? pc,
  }
}

/**
 * R16 trigger: new deal information arrived → `deal.state_dirty_at = now`.
 * The phase «dealState» runs the summary after the debounce. Never throws
 * (a missing flag only delays the text until the next trigger).
 */
export async function markDealsStateDirty(orgId: string, dealIds: readonly string[], now: Date = new Date()): Promise<void> {
  const ids = [...new Set(dealIds.filter(Boolean))]
  if (ids.length === 0) return
  try {
    await db
      .update(deal)
      .set({ stateDirtyAt: now, updatedAt: sql`${deal.updatedAt}` })
      .where(and(eq(deal.organizationId, orgId), inArray(deal.id, ids)))
  } catch (e) {
    console.error(`[topics:dealState] mark dirty failed for org ${orgId}:`, e)
  }
}

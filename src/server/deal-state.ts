import "server-only"

import { and, desc, eq } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { deal, dealStateVersion, user } from "@/db/schema"
import { DEAL_STATE_DECISIONS, type DealStateDecision, type DealStateView } from "@/lib/topics/deal-state"
import { markDealsStateDirty } from "@/server/topics/deal-state/params"
import { runDealStateForDeal, type DealStateRunResult } from "@/server/topics/deal-state/summary"

export type { DealStateView, DealStateVersionView } from "@/lib/topics/deal-state"
export type { DealStateRunResult } from "@/server/topics/deal-state/summary"

// «Текущее состояние» for the deal UI (spec topics/01 §9.3, plan phase 5a):
// the stored text + sources + version history, the «Обновить» action and the
// R16 dirty hook for manual deal edits. `server-only`, org-explicit (NOT
// "use server"): the caller checks the session and passes the active org.
// No LLM call on read — the board and the drawer read the stored text.

export class DealStateError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "invalid" = "invalid",
  ) {
    super(message)
    this.name = "DealStateError"
  }
}

const VERSIONS_LIMIT = 20
const iso = (d: Date | null) => (d ? d.toISOString() : null)

function asDecision(v: string): DealStateDecision {
  return (DEAL_STATE_DECISIONS as readonly string[]).includes(v) ? (v as DealStateDecision) : "UPDATE"
}

/** Stored state + the last 20 versions (newest first). Throws DealStateError('not_found'). */
export async function getDealState(orgId: string, dealId: string): Promise<DealStateView> {
  const [d] = await db
    .select({
      id: deal.id,
      stateText: deal.stateText,
      stateSourceItemIds: deal.stateSourceItemIds,
      stateUpdatedAt: deal.stateUpdatedAt,
      stateDirtyAt: deal.stateDirtyAt,
    })
    .from(deal)
    .where(and(eq(deal.organizationId, orgId), eq(deal.id, dealId)))
  if (!d) throw new DealStateError("Сделка не найдена", "not_found")
  const versions = await db
    .select({ v: dealStateVersion, actorName: user.name })
    .from(dealStateVersion)
    .leftJoin(user, eq(user.id, dealStateVersion.actorUserId))
    .where(and(eq(dealStateVersion.organizationId, orgId), eq(dealStateVersion.dealId, dealId)))
    .orderBy(desc(dealStateVersion.createdAt))
    .limit(VERSIONS_LIMIT)
  const pending = !!d.stateDirtyAt && (!d.stateUpdatedAt || d.stateDirtyAt > d.stateUpdatedAt)
  return {
    dealId: d.id,
    text: d.stateText,
    sourceItemIds: d.stateSourceItemIds ?? [],
    updatedAt: iso(d.stateUpdatedAt),
    dirtyAt: iso(d.stateDirtyAt),
    pending,
    versions: versions.map(({ v, actorName }) => ({
      id: v.id,
      decision: asDecision(v.decision),
      text: v.text,
      reason: v.reason,
      sourceItemIds: v.sourceItemIds,
      topicIds: v.topicIds,
      actor: v.actor === "user" ? "user" : "agent",
      actorUserId: v.actorUserId,
      actorName: actorName ?? null,
      model: v.model,
      createdAt: v.createdAt.toISOString(),
    })),
  }
}

/**
 * R16 hook for manual deal edits (amount, contacts, type, date …): marks the
 * deal dirty; the hourly phase «dealState» runs the summary after the
 * debounce (`deals.stateDebounceMinutes`). `reason` is only logged. Never throws.
 */
export async function markDealStateDirty(orgId: string, dealId: string, reason?: string | null): Promise<void> {
  if (reason && process.env.NODE_ENV !== "production") console.info(`[topics:dealState] dirty ${dealId}: ${reason}`)
  await markDealsStateDirty(orgId, [dealId])
}

/**
 * «Обновить» in the deal drawer: marks the deal dirty, re-evaluates its risks
 * and runs the state summary NOW (no debounce), whatever the org's topics
 * mode. One `deals.state_summary` call at most (none for a fixed text).
 * `userId` (who asked) is stored on the version. Throws DealStateError
 * ('not_found') and AiBudgetExceededError (409 in the route).
 */
export async function requestDealStateRefresh(
  orgId: string,
  dealId: string,
  userId: string,
): Promise<{ result: DealStateRunResult; state: DealStateView }> {
  const [d] = await db
    .select({ id: deal.id, status: deal.status })
    .from(deal)
    .where(and(eq(deal.organizationId, orgId), eq(deal.id, dealId)))
  if (!d || d.status === "deleted") throw new DealStateError("Сделка не найдена", "not_found")
  await markDealsStateDirty(orgId, [dealId])
  try {
    const { ensureSystemActor } = await import("@/server/topics/system-actor")
    const { evaluateRisksForDeal, loadDealRiskContext } = await import("@/server/topics/deal-state/risk-store")
    const agentId = await ensureSystemActor(orgId)
    const rctx = await loadDealRiskContext(orgId)
    await evaluateRisksForDeal(rctx, dealId, { kind: "agent", userId: agentId })
  } catch (e) {
    console.error(`[topics:dealState] risk evaluation before refresh, deal ${dealId}:`, e)
  }
  const result = await runDealStateForDeal(orgId, dealId, { actorUserId: userId })
  return { result, state: await getDealState(orgId, dealId) }
}

import "server-only"

import { AiBudgetExceededError, getOrgBudgetStatus } from "@/server/ai/budget"
import type { TopicsPhaseContext, TopicsPhaseResult } from "@/server/topics/phases"
import { getDealStateParams } from "./params"
import { evaluateRisksForDeal, loadDealRiskContext, selectRiskCandidateDeals } from "./risk-store"
import { runDealStateForDeal, selectDueStateDeals, type DealStateModel } from "./summary"

// Phase «dealState» of the hourly run (plan phase 5a; spec topics/01 §9.3,
// §9.4). Runs after «deals».
//   (a) Risks — deterministic, no AI: re-evaluate the open deals with a
//       linked topic or an active risk, plus deals of clients with a fresh
//       signal (≤ DEAL_STATE_MAX_RISK_DEALS). Idempotent: unchanged inputs →
//       no writes. New / cleared risks mark the deal dirty (R16), force the
//       trigger topic's card to UPDATE (R17) and recompute its attention (I5).
//   (b) State text — dirty deals whose `state_dirty_at` is older than the
//       debounce (`deals.stateDebounceMinutes`, 10) and newer than
//       `state_updated_at`, oldest change first, ≤ DEAL_STATE_MAX_LLM_PER_RUN
//       model calls per org per run (fixed texts do not count). AI budget
//       checked up front; a budget stop leaves the deal dirty → next run.
// Mode `shadow` runs normally: the text and the risks are visible only
// inside the deal UI (agent deals exist only in `on`, the deal bridge is a
// dry run in shadow; manual deals with linked topics may get a state).
// Never throws for one deal: a failing deal is counted in `errors`.

export const DEAL_STATE_MAX_LLM_PER_RUN = 20
export const DEAL_STATE_MAX_RISK_DEALS = 300

export async function runDealStateForOrg(
  orgId: string,
  actorUserId: string,
  opts: { now?: Date; model?: DealStateModel; maxLlm?: number } = {},
): Promise<Record<string, number>> {
  const now = opts.now ?? new Date()
  const counts = {
    riskDeals: 0,
    risksActivated: 0,
    risksUpdated: 0,
    risksCleared: 0,
    stateDue: 0,
    stateUpdated: 0,
    stateNoop: 0,
    stateFixed: 0,
    stateRejected: 0,
    llmCalls: 0,
    budgetStopped: 0,
    errors: 0,
  }
  const actor = { kind: "agent" as const, userId: actorUserId }

  // (a) Risks.
  const rctx = await loadDealRiskContext(orgId)
  const riskDeals = rctx.types.length ? await selectRiskCandidateDeals(orgId, now, DEAL_STATE_MAX_RISK_DEALS) : []
  counts.riskDeals = riskDeals.length
  for (const id of riskDeals) {
    try {
      const r = await evaluateRisksForDeal(rctx, id, actor, now)
      counts.risksActivated += r.activated
      counts.risksUpdated += r.updated
      counts.risksCleared += r.cleared
    } catch (e) {
      counts.errors++
      console.error(`[topics:dealState] risks org ${orgId} deal ${id}:`, e)
    }
  }

  // (b) State text.
  const params = await getDealStateParams(orgId)
  const maxLlm = opts.maxLlm ?? DEAL_STATE_MAX_LLM_PER_RUN
  const due = await selectDueStateDeals(orgId, new Date(), params.debounceMinutes, maxLlm * 3)
  counts.stateDue = due.length
  if (due.length === 0) return counts
  if (!opts.model && (await getOrgBudgetStatus(orgId)).exceeded) {
    counts.budgetStopped = 1
    return counts
  }
  for (const id of due) {
    if (counts.llmCalls >= maxLlm) break
    try {
      const r = await runDealStateForDeal(orgId, id, { model: opts.model, actorUserId })
      if (r.aiCalled) counts.llmCalls++
      if (r.decision === "UPDATE") counts.stateUpdated++
      else if (r.decision === "NOOP") counts.stateNoop++
      else if (r.decision === "FIXED") counts.stateFixed++
      else if (r.decision === "REJECTED") counts.stateRejected++
      counts.risksCleared += r.clearedRiskIds.length
    } catch (e) {
      if (e instanceof AiBudgetExceededError) {
        counts.budgetStopped = 1
        break
      }
      counts.errors++
      console.error(`[topics:dealState] state org ${orgId} deal ${id}:`, e)
    }
  }
  return counts
}

export async function runDealStatePhase(ctx: TopicsPhaseContext): Promise<TopicsPhaseResult> {
  return runDealStateForOrg(ctx.organizationId, ctx.actorUserId)
}

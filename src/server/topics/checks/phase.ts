import "server-only"

import type { TopicsPhaseContext, TopicsPhaseResult } from "@/server/topics/phases"
import { runDueChecks } from "./run"

// Phase «checks» of the hourly run (topics plan phase 8), between «topics»
// and «attention»: CRM checks over order data (scheduled daily / weekly /
// monthly at `checks.params.runTime` org time) and watchdogs over
// communication topics (every run). Runs in `shadow` and `on`; writes only
// for the groups switched on in org_setting `topics.checks` (default off).
// Schedule, log and idempotency: ./run.ts (`topic_check_run`).

export async function runChecksPhase(ctx: TopicsPhaseContext): Promise<TopicsPhaseResult> {
  return runDueChecks(ctx.organizationId, { runId: ctx.runId, actorUserId: ctx.actorUserId })
}

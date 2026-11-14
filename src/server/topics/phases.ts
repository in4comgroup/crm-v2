import "server-only"

import type { PipelineRunTrigger } from "@/db/schema"
import type { TopicsMode } from "./mode"

// Ordered phases of the hourly topics pipeline (spec 01 §13: intake (sync →
// parse → upload of the org's sources, runbook 07 O1) → signals →
// topic resolution → attention → cards → deal bridge → deal state).
// Every phase is org-explicit (gets `organizationId` in the context, never
// reads a session) and must be idempotent + resumable (spec §13: progress
// lives on the rows, e.g. `signal_scanned_at` / `topic_scanned_at`), because
// the next hourly run simply calls it again.
//
// Contract: return counts (`{ processed: 12, created: 3 }`) or
// `{ skipped: "<reason>" }`. Throwing is allowed — the pipeline catches it
// per phase, records the error and goes on with the next phase.
//
// All phases are built: intake, signals, topics, checks (8), attention,
// cards, deals (plan phases 2–5), dealState (5a) and delivery (7, email;
// Telegram open). Plan: docs/specs/topics/03-development-plan.md.

export type TopicsPhaseName =
  | "intake"
  | "signals"
  | "topics"
  | "checks"
  | "attention"
  | "cards"
  | "deals"
  | "dealState"
  | "delivery"

export type TopicsPhaseContext = {
  organizationId: string
  mode: Exclude<TopicsMode, "off">
  /** User id of the org's system actor «Агент» (author of automatic writes). */
  actorUserId: string
  runId: string
  trigger: PipelineRunTrigger
}

export type TopicsPhaseResult = { skipped: string } | Record<string, number>

export type TopicsPhase = {
  name: TopicsPhaseName
  run: (ctx: TopicsPhaseContext) => Promise<TopicsPhaseResult>
}

// Intake (built 2026-11-14): sync → parse → upload for the org — src/server/topics/intake.ts.
async function runIntake(ctx: TopicsPhaseContext): Promise<TopicsPhaseResult> {
  const { runIntakePhase } = await import("@/server/topics/intake")
  return runIntakePhase(ctx)
}

// Phase 2 (built): signal extraction — src/server/topics/signals/runner.ts.
// Imported lazily: the runner imports this module's types.
async function runSignals(ctx: TopicsPhaseContext): Promise<TopicsPhaseResult> {
  const { runSignalsPhase } = await import("@/server/topics/signals/runner")
  return runSignalsPhase(ctx)
}

// Phase 3 (built): topic resolution — src/server/topics/resolve-phase.ts
// (match new signals to topics or open new ones via `topics.topic_match`,
// lifecycle timers, re-link); stamps `topic_scanned_at`.
async function runTopics(ctx: TopicsPhaseContext): Promise<TopicsPhaseResult> {
  const { runTopicsPhase } = await import("@/server/topics/resolve-phase")
  return runTopicsPhase(ctx)
}

// Phase 8: CRM checks + watchdogs — src/server/topics/checks/phase.ts
// (deterministic process codes: order data, no-response watchdogs; org
// switch `topics.checks`, default off). Before «attention» so new / cleared
// process topics are placed in the same run.
async function runChecks(ctx: TopicsPhaseContext): Promise<TopicsPhaseResult> {
  const { runChecksPhase } = await import("@/server/topics/checks/phase")
  return runChecksPhase(ctx)
}

// Phase 4: attention lists — src/server/topics/attention/phase.ts
// (deterministic, 06-attention-engine.md; contract src/lib/topics/attention-types.ts).
async function runAttention(ctx: TopicsPhaseContext): Promise<TopicsPhaseResult> {
  const { runAttentionPhase } = await import("@/server/topics/attention/phase")
  return runAttentionPhase(ctx)
}

// Phase 4: topic cards — src/server/topics/cards/phase.ts (AI process
// `topics.card_writer`); stored in shadow too, hidden from users.
async function runCards(ctx: TopicsPhaseContext): Promise<TopicsPhaseResult> {
  const { runCardsPhase } = await import("@/server/topics/cards/phase")
  return runCardsPhase(ctx)
}

// Phase 5: deal bridge — src/server/topics/deals/phase.ts (stage rules →
// create / move / outcome / pause deals, deal_proposal and
// stage_confirmation cards); automatic writes are authored by `ctx.actorUserId`.
async function runDeals(ctx: TopicsPhaseContext): Promise<TopicsPhaseResult> {
  const { runDealsPhase } = await import("@/server/topics/deals/phase")
  return runDealsPhase(ctx)
}

// Phase 5a: deal risks + «Текущее состояние» — src/server/topics/deal-state/phase.ts
// (risk engine, AI process `deals.state_summary`, debounced per deal).
async function runDealState(ctx: TopicsPhaseContext): Promise<TopicsPhaseResult> {
  const { runDealStatePhase } = await import("@/server/topics/deal-state/phase")
  return runDealStatePhase(ctx)
}

// Phase 7: delivery — src/server/topics/delivery/phase.ts (email digests:
// morning / weekly / evening reminders; Telegram later). Last phase.
async function runDelivery(ctx: TopicsPhaseContext): Promise<TopicsPhaseResult> {
  const { runDeliveryPhase } = await import("@/server/topics/delivery/phase")
  return runDeliveryPhase(ctx)
}

/** Phases in execution order. */
export const TOPICS_PHASES: readonly TopicsPhase[] = [
  { name: "intake", run: runIntake },
  { name: "signals", run: runSignals },
  { name: "topics", run: runTopics },
  { name: "checks", run: runChecks },
  { name: "attention", run: runAttention },
  { name: "cards", run: runCards },
  { name: "deals", run: runDeals },
  { name: "dealState", run: runDealState },
  { name: "delivery", run: runDelivery },
]

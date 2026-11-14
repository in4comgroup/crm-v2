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
// Phases «signals» (plan phase 2) and «topics» (plan phase 3) are built; the others are stubs. A stub takes no
// arguments yet — give it `(ctx: TopicsPhaseContext)` when it is built. The TODO(phase N) tags
// point at docs/specs/topics/03-development-plan.md.

export type TopicsPhaseName =
  | "intake"
  | "signals"
  | "topics"
  | "attention"
  | "cards"
  | "deals"
  | "dealState"

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

const NOT_BUILT = { skipped: "not built yet" } as const

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

// TODO(phase 4): attention lists — recompute who must act on which topic
// (deterministic; deadline escalation is evaluated on read, spec §8.1).
async function runAttention(): Promise<TopicsPhaseResult> {
  return NOT_BUILT
}

// TODO(phase 4): topic cards — write / refresh cards for topics that need a
// decision (AI process `topics.card_writer`); hidden from users in shadow.
async function runCards(): Promise<TopicsPhaseResult> {
  return NOT_BUILT
}

// TODO(phase 5): deal bridge — link topics to deals, propose / apply stage
// moves; automatic writes are authored by `ctx.actorUserId`.
async function runDeals(): Promise<TopicsPhaseResult> {
  return NOT_BUILT
}

// TODO(phase 5a): deal state — debounced state text + risks per touched deal
// (AI process `deals.state_summary`).
async function runDealState(): Promise<TopicsPhaseResult> {
  return NOT_BUILT
}

/** Phases in execution order. */
export const TOPICS_PHASES: readonly TopicsPhase[] = [
  { name: "intake", run: runIntake },
  { name: "signals", run: runSignals },
  { name: "topics", run: runTopics },
  { name: "attention", run: runAttention },
  { name: "cards", run: runCards },
  { name: "deals", run: runDeals },
  { name: "dealState", run: runDealState },
]

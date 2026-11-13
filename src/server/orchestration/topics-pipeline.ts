import "server-only"

import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { topicsRun, type PipelineRunTrigger } from "@/db/schema"
import { listTopicsEnabledOrgs, type TopicsEnabledOrg } from "@/server/topics/mode"
import { TOPICS_PHASES } from "@/server/topics/phases"
import { ensureSystemActor } from "@/server/topics/system-actor"
import {
  failStaleTopicsRuns,
  findRunningTopicsRun,
  type TopicsRunError,
  type TopicsRunOrgOutcome,
} from "@/server/topics/runs"
import { ORCHESTRATION_CONFIG } from "./config"

// Engine-agnostic entry point of the HOURLY topics pipeline (spec topics/01
// §13, plan phase 0 task 6). Called by:
//   • the Vercel Workflow (src/workflows/topics-pipeline.workflow.ts),
//     started by the hourly cron /api/cron/topics;
//   • the admin «Запустить сейчас» button (/api/admin/topics/runs, manual);
//   • any future scheduler that replaces Vercel — same function.
//
// Per org with `topics.enabled` = shadow | on (off orgs: nothing at all):
//   ensureSystemActor → signals → topics → attention → cards → deals → dealState.
// Failure isolation: one try/catch per org AND per phase — a failing phase
// is recorded and the next phase still runs; a failing org never stops the
// other orgs. Orgs run one after another (cost stays predictable).
//
// One `topics_run` row per run; `orgs` holds the per-org phase outcomes and
// is written after every org, so the admin tab shows progress.

export type RunTopicsPipelineOptions = { trigger: PipelineRunTrigger }

export type RunTopicsPipelineResult =
  | {
      topicsRunId: string
      status: "success" | "failed"
      startedAt: Date
      finishedAt: Date
      orgsProcessed: number
      orgs: TopicsRunOrgOutcome[]
      errors: TopicsRunError[]
    }
  | {
      // Another run is still in progress (not stale) → this one did nothing.
      topicsRunId: null
      status: "skipped"
      reason: string
      runningRunId: string
    }

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// Bounded error buffer: past the cap, one "+N more truncated" marker counts
// the dropped entries (same idea as runDailyPipeline).
function pushError(buffer: TopicsRunError[], entry: TopicsRunError) {
  const cap = ORCHESTRATION_CONFIG.topics.maxErrorsPerRun
  if (buffer.length < cap) {
    buffer.push(entry)
    return
  }
  const last = buffer[buffer.length - 1]
  const m = last?.message.match(/^\+(\d+) more truncated$/)
  if (m) {
    buffer[buffer.length - 1] = { message: `+${parseInt(m[1], 10) + 1} more truncated` }
  } else {
    buffer.push({ message: "+1 more truncated" })
  }
}

async function runOrg(
  org: TopicsEnabledOrg,
  runId: string,
  trigger: PipelineRunTrigger,
  errors: TopicsRunError[],
): Promise<TopicsRunOrgOutcome> {
  const t0 = Date.now()
  const outcome: TopicsRunOrgOutcome = {
    orgId: org.organizationId,
    orgName: org.name,
    mode: org.mode,
    actorUserId: null,
    phases: {},
    durationMs: 0,
  }

  try {
    outcome.actorUserId = await ensureSystemActor(org.organizationId)
  } catch (e) {
    // Without the actor no phase may write → skip the org's phases.
    outcome.error = `system actor: ${message(e)}`
    pushError(errors, { orgId: org.organizationId, phase: "org", message: outcome.error })
    outcome.durationMs = Date.now() - t0
    return outcome
  }

  for (const phase of TOPICS_PHASES) {
    try {
      outcome.phases[phase.name] = await phase.run({
        organizationId: org.organizationId,
        mode: org.mode,
        actorUserId: outcome.actorUserId,
        runId,
        trigger,
      })
    } catch (e) {
      const msg = message(e)
      outcome.phases[phase.name] = { error: msg }
      pushError(errors, { orgId: org.organizationId, phase: phase.name, message: msg })
    }
  }

  outcome.durationMs = Date.now() - t0
  return outcome
}

export async function runTopicsPipeline(
  opts: RunTopicsPipelineOptions,
): Promise<RunTopicsPipelineResult> {
  // A crashed run must not block the schedule forever.
  await failStaleTopicsRuns()
  // Hourly cron + manual button can overlap; the phases are idempotent, but
  // two runs at once would double the AI cost. (Best-effort check, not a lock.)
  const running = await findRunningTopicsRun()
  if (running) {
    return {
      topicsRunId: null,
      status: "skipped",
      reason: "Another topics run is still in progress",
      runningRunId: running.id,
    }
  }

  const topicsRunId = randomUUID()
  const startedAt = new Date()
  await db.insert(topicsRun).values({
    id: topicsRunId,
    startedAt,
    trigger: opts.trigger,
    status: "running",
  })

  const errors: TopicsRunError[] = []
  const orgs: TopicsRunOrgOutcome[] = []

  try {
    for (const org of await listTopicsEnabledOrgs()) {
      try {
        orgs.push(await runOrg(org, topicsRunId, opts.trigger, errors))
      } catch (e) {
        // runOrg catches everything it can; this is a last-resort guard.
        const msg = message(e)
        orgs.push({
          orgId: org.organizationId,
          orgName: org.name,
          mode: org.mode,
          actorUserId: null,
          phases: {},
          error: msg,
          durationMs: 0,
        })
        pushError(errors, { orgId: org.organizationId, phase: "org", message: msg })
      }
      // Progress for the admin tab. A failed progress write is not fatal.
      await db
        .update(topicsRun)
        .set({ orgsProcessed: orgs.length, orgs, errorsJson: errors })
        .where(eq(topicsRun.id, topicsRunId))
        .catch((e) => console.error("[topics-pipeline] progress write failed:", e))
    }
  } catch (e) {
    // E.g. listing the orgs failed — the run is recorded as failed.
    pushError(errors, { phase: "run", message: message(e) })
  }

  const finishedAt = new Date()
  const status: "success" | "failed" = errors.length === 0 ? "success" : "failed"
  await db
    .update(topicsRun)
    .set({ finishedAt, status, orgsProcessed: orgs.length, orgs, errorsJson: errors })
    .where(eq(topicsRun.id, topicsRunId))

  return {
    topicsRunId,
    status,
    startedAt,
    finishedAt,
    orgsProcessed: orgs.length,
    orgs,
    errors,
  }
}

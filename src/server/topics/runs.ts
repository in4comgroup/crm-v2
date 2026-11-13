import "server-only"

import { and, desc, eq, lt, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { topicsRun } from "@/db/schema"
import { ORCHESTRATION_CONFIG } from "@/server/orchestration/config"
import type { TopicsPhaseName, TopicsPhaseResult } from "./phases"

// Run log of the hourly topics pipeline (table `topics_run`). Written by
// src/server/orchestration/topics-pipeline.ts, read by the admin «Темы» tab.

/** Outcome of one phase for one org: counts, `{ skipped }` or `{ error }`. */
export type TopicsPhaseOutcome = TopicsPhaseResult | { error: string }

/** One element of `topics_run.orgs`. */
export type TopicsRunOrgOutcome = {
  orgId: string
  orgName: string
  mode: "shadow" | "on"
  actorUserId: string | null
  phases: Partial<Record<TopicsPhaseName, TopicsPhaseOutcome>>
  /** Org-level failure (e.g. the system actor could not be ensured). */
  error?: string
  durationMs: number
}

/** One element of `topics_run.errors_json`. */
export type TopicsRunError = {
  orgId?: string
  phase?: TopicsPhaseName | "org" | "run"
  message: string
}

export type TopicsRunRow = {
  id: string
  startedAt: Date
  finishedAt: Date | null
  trigger: "cron" | "manual"
  status: "running" | "success" | "failed"
  orgsProcessed: number
  orgs: TopicsRunOrgOutcome[]
  errors: TopicsRunError[]
}

/** Most recent runs, newest first. */
export async function listTopicsRuns(limit = 20): Promise<TopicsRunRow[]> {
  const rows = await db
    .select()
    .from(topicsRun)
    .orderBy(desc(topicsRun.startedAt))
    .limit(Math.min(Math.max(limit, 1), 100))
  return rows.map((r) => ({
    id: r.id,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    trigger: r.trigger,
    status: r.status,
    orgsProcessed: r.orgsProcessed,
    orgs: r.orgs as unknown as TopicsRunOrgOutcome[],
    errors: r.errorsJson as unknown as TopicsRunError[],
  }))
}

/**
 * Marks runs that are still `running` after `staleRunAfterMinutes` as
 * `failed` (the process crashed or timed out). Returns how many.
 */
export async function failStaleTopicsRuns(): Promise<number> {
  const cutoff = new Date(
    Date.now() - ORCHESTRATION_CONFIG.topics.staleRunAfterMinutes * 60_000,
  )
  const rows = await db
    .update(topicsRun)
    .set({
      status: "failed",
      finishedAt: new Date(),
      // Keep the errors the run recorded before it died; append the marker.
      errorsJson: sql`${topicsRun.errorsJson} || ${JSON.stringify([
        { phase: "run", message: "Run did not finish (marked stale)" },
      ])}::jsonb`,
    })
    .where(and(eq(topicsRun.status, "running"), lt(topicsRun.startedAt, cutoff)))
    .returning({ id: topicsRun.id })
  return rows.length
}

/** The run that is still in progress (not stale), if any. */
export async function findRunningTopicsRun(): Promise<{ id: string; startedAt: Date } | null> {
  const [row] = await db
    .select({ id: topicsRun.id, startedAt: topicsRun.startedAt })
    .from(topicsRun)
    .where(eq(topicsRun.status, "running"))
    .orderBy(desc(topicsRun.startedAt))
    .limit(1)
  return row ?? null
}

import "server-only"
import { asc, eq, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { aiUsageEvent, topicsEvalResult, topicsEvalRun } from "@/db/schema"
import type { ExtractionCodeSet, ExtractionVariant } from "@/server/topics/prompt/extraction"
import type { SampleItemResult } from "./metrics"

// Storage of eval runs (plan phase 2 task 8): one `topics_eval_run` row per
// run (id = topics_eval_result.run_id).
//
//   kind   = "eval"  — every run started since phase 2 (golden or sample);
//            "spike" — a phase 0 run (results only, no row) that is resumed
//            or saved later: its row is created lazily from the first result.
//   config = EvalRunConfig (what was tested; fixed at start).
//   metrics = EvalRunMetrics:
//            { schema: 1,
//              report?:  the full report snapshot (summary, per-code table,
//                        gate verdict, models, taxonomy versions, cost from
//                        ai_usage_event) — written when the run has no
//                        remaining item, or by «Сохранить метрики»;
//              savedAt?: ISO time of that snapshot;
//              sample?:  { items: { [sourceItemId]: SampleItemResult } } —
//                        review-sample runs only (see sample-run.ts) }.
//   finishedAt = set with the snapshot when nothing remains; cleared when a
//            finished golden run is resumed because new items were added.
// Runs without a row (phase 0) still list and report from their results.

/** User-facing eval error (route → 400, message in Russian). */
export class EvalError extends Error {}

export type EvalInput = "golden" | "sample"
export type EvalRunKind = "eval" | "spike"

export type EvalRunConfig = {
  input: EvalInput
  process: string
  variant: ExtractionVariant
  codeSet: ExtractionCodeSet
  /** Taxonomy version at start (each result records its own). */
  taxonomyVersion: number | null
  /** Codes in the prompt set at start. */
  codes: string[]
  /** Review-only codes in the prompt set at start (R6). */
  reviewCodes: string[]
  /** Sample runs: the fixed list of sampled source items. */
  sampleItemIds?: string[]
  sampleSize?: number
}

export type EvalRunMetrics<R = unknown> = {
  schema: 1
  report?: R
  savedAt?: string
  sample?: { items: Record<string, SampleItemResult> }
}

export type EvalRunRow = {
  id: string
  organizationId: string
  kind: EvalRunKind
  config: EvalRunConfig
  createdAt: Date
  finishedAt: Date | null
}

function toRow(r: {
  id: string
  organizationId: string
  kind: string
  config: Record<string, unknown>
  createdAt: Date
  finishedAt: Date | null
}): EvalRunRow {
  const c = r.config as Partial<EvalRunConfig>
  return {
    ...r,
    kind: r.kind === "spike" ? "spike" : "eval",
    config: {
      input: c.input === "sample" ? "sample" : "golden",
      process: c.process ?? "topics.signal_extraction",
      variant: (c.variant ?? "single") as ExtractionVariant,
      codeSet: (c.codeSet ?? "live") as ExtractionCodeSet,
      taxonomyVersion: typeof c.taxonomyVersion === "number" ? c.taxonomyVersion : null,
      codes: Array.isArray(c.codes) ? c.codes : [],
      reviewCodes: Array.isArray(c.reviewCodes) ? c.reviewCodes : [],
      sampleItemIds: Array.isArray(c.sampleItemIds) ? c.sampleItemIds : undefined,
      sampleSize: typeof c.sampleSize === "number" ? c.sampleSize : undefined,
    },
  }
}

const runColumns = {
  id: topicsEvalRun.id,
  organizationId: topicsEvalRun.organizationId,
  kind: topicsEvalRun.kind,
  config: topicsEvalRun.config,
  createdAt: topicsEvalRun.createdAt,
  finishedAt: topicsEvalRun.finishedAt,
}

export async function getEvalRunRow(runId: string): Promise<EvalRunRow | null> {
  const [r] = await db.select(runColumns).from(topicsEvalRun).where(eq(topicsEvalRun.id, runId))
  return r ? toRow(r) : null
}

export async function createEvalRunRow(args: {
  id: string
  orgId: string
  kind: EvalRunKind
  config: EvalRunConfig
  userId: string | null
  metrics?: EvalRunMetrics | null
  createdAt?: Date
}): Promise<void> {
  await db
    .insert(topicsEvalRun)
    .values({
      id: args.id,
      organizationId: args.orgId,
      kind: args.kind,
      config: args.config as unknown as Record<string, unknown>,
      metrics: (args.metrics ?? null) as Record<string, unknown> | null,
      createdByUserId: args.userId,
      ...(args.createdAt ? { createdAt: args.createdAt } : {}),
    })
    .onConflictDoNothing()
}

/** Settings of a phase 0 run from its first result (no topics_eval_run row). */
export async function legacyRunSettings(runId: string): Promise<{
  orgId: string
  createdAt: Date
  config: EvalRunConfig
} | null> {
  const [first] = await db
    .select({
      organizationId: topicsEvalResult.organizationId,
      config: topicsEvalResult.config,
      createdAt: topicsEvalResult.createdAt,
    })
    .from(topicsEvalResult)
    .where(eq(topicsEvalResult.runId, runId))
    .orderBy(asc(topicsEvalResult.createdAt))
    .limit(1)
  if (!first) return null
  const c = first.config as { variant?: string; codeSet?: string; taxonomyVersion?: number; codes?: string[]; process?: string }
  return {
    orgId: first.organizationId,
    createdAt: first.createdAt,
    config: {
      input: "golden",
      process: c.process ?? "topics.signal_extraction",
      variant: (c.variant ?? "single") as ExtractionVariant,
      codeSet: (c.codeSet ?? "live") as ExtractionCodeSet,
      taxonomyVersion: typeof c.taxonomyVersion === "number" ? c.taxonomyVersion : null,
      codes: Array.isArray(c.codes) ? c.codes : [],
      reviewCodes: [],
    },
  }
}

/** The run row, creating a `spike` row for a phase 0 run. Null = unknown run. */
export async function ensureEvalRunRow(runId: string, userId: string | null): Promise<EvalRunRow | null> {
  const existing = await getEvalRunRow(runId)
  if (existing) return existing
  const legacy = await legacyRunSettings(runId)
  if (!legacy) return null
  await createEvalRunRow({
    id: runId,
    orgId: legacy.orgId,
    kind: "spike",
    config: legacy.config,
    userId,
    metrics: { schema: 1 },
    createdAt: legacy.createdAt,
  })
  return getEvalRunRow(runId)
}

/** Store the report snapshot; `finished` also stamps finishedAt (else clears it). */
export async function saveEvalRunReport(runId: string, report: unknown, finished: boolean): Promise<void> {
  const patch = { schema: 1, report, savedAt: new Date().toISOString() }
  await db
    .update(topicsEvalRun)
    .set({
      metrics: sql`coalesce(${topicsEvalRun.metrics}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
      finishedAt: finished ? new Date() : null,
    })
    .where(eq(topicsEvalRun.id, runId))
}

/** Mark a resumed run as running again. */
export async function clearEvalRunFinished(runId: string): Promise<void> {
  await db
    .update(topicsEvalRun)
    .set({ finishedAt: null })
    .where(sql`${topicsEvalRun.id} = ${runId} and ${topicsEvalRun.finishedAt} is not null`)
}

export async function getStoredEvalReport<R>(runId: string): Promise<{ report: R; savedAt: string | null } | null> {
  const [r] = await db
    .select({
      report: sql<R | null>`${topicsEvalRun.metrics}->'report'`,
      savedAt: sql<string | null>`${topicsEvalRun.metrics}->>'savedAt'`,
    })
    .from(topicsEvalRun)
    .where(eq(topicsEvalRun.id, runId))
  return r?.report ? { report: r.report, savedAt: r.savedAt } : null
}

// ── Sample items (incremental, keyed by source item id) ───────────────────

/**
 * Append sample results atomically (jsonb merge in one UPDATE): a re-run of
 * the same item replaces its entry, so a retried batch is idempotent.
 */
export async function appendSampleItems(runId: string, items: SampleItemResult[]): Promise<void> {
  if (items.length === 0) return
  const patch = JSON.stringify(Object.fromEntries(items.map((i) => [i.itemId, i])))
  const m = topicsEvalRun.metrics
  await db
    .update(topicsEvalRun)
    .set({
      metrics: sql`jsonb_set(
        coalesce(${m}, '{"schema":1}'::jsonb) || jsonb_build_object('sample', coalesce(${m}->'sample', '{}'::jsonb)),
        '{sample,items}',
        coalesce(${m}->'sample'->'items', '{}'::jsonb) || ${patch}::jsonb,
        true
      )`,
    })
    .where(eq(topicsEvalRun.id, runId))
}

export async function sampleDoneIds(runId: string): Promise<Set<string>> {
  const [r] = await db
    .select({
      ids: sql<string[] | null>`(select array_agg(k) from jsonb_object_keys(coalesce(${topicsEvalRun.metrics}->'sample'->'items', '{}'::jsonb)) k)`,
    })
    .from(topicsEvalRun)
    .where(eq(topicsEvalRun.id, runId))
  return new Set(r?.ids ?? [])
}

export async function sampleItems(runId: string): Promise<SampleItemResult[]> {
  const [r] = await db
    .select({ items: sql<Record<string, SampleItemResult> | null>`${topicsEvalRun.metrics}->'sample'->'items'` })
    .from(topicsEvalRun)
    .where(eq(topicsEvalRun.id, runId))
  return Object.values(r?.items ?? {})
}

// ── Usage ledger ──────────────────────────────────────────────────────────

export type SpikeUsageRow = {
  process: string
  model: string
  calls: number
  errors: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  costUsd: number
}

export type UsageTotals = Omit<SpikeUsageRow, "process" | "model">

/** Usage ledger totals of a run (ai_usage_event.ref->>'evalRunId'). */
export async function spikeUsage(runId: string): Promise<SpikeUsageRow[]> {
  const rows = await db
    .select({
      process: aiUsageEvent.processKey,
      model: sql<string>`coalesce(${aiUsageEvent.responseModel}, ${aiUsageEvent.requestModel})`,
      calls: sql<number>`count(*)::int`,
      errors: sql<number>`count(*) filter (where ${aiUsageEvent.status} <> 'ok')::int`,
      inputTokens: sql<number>`coalesce(sum(${aiUsageEvent.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${aiUsageEvent.outputTokens}), 0)::int`,
      reasoningTokens: sql<number>`coalesce(sum(${aiUsageEvent.reasoningTokens}), 0)::int`,
      cacheReadTokens: sql<number>`coalesce(sum(${aiUsageEvent.cacheReadTokens}), 0)::int`,
      costUsd: sql<string>`coalesce(sum(coalesce(${aiUsageEvent.costActualUsd}, ${aiUsageEvent.costEstimateUsd})), 0)`,
    })
    .from(aiUsageEvent)
    .where(sql`${aiUsageEvent.ref}->>'evalRunId' = ${runId}`)
    .groupBy(aiUsageEvent.processKey, sql`2`)
  return rows.map((r) => ({ ...r, costUsd: Number(r.costUsd) }))
}

export function usageTotals(rows: readonly SpikeUsageRow[]): UsageTotals {
  return rows.reduce(
    (acc, u) => ({
      calls: acc.calls + u.calls,
      errors: acc.errors + u.errors,
      inputTokens: acc.inputTokens + u.inputTokens,
      outputTokens: acc.outputTokens + u.outputTokens,
      reasoningTokens: acc.reasoningTokens + u.reasoningTokens,
      cacheReadTokens: acc.cacheReadTokens + u.cacheReadTokens,
      costUsd: acc.costUsd + u.costUsd,
    }),
    { calls: 0, errors: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, costUsd: 0 },
  )
}

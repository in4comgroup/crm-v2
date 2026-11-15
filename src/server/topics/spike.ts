import "server-only"
import { randomUUID } from "crypto"
import { and, asc, eq, ne, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { topicsEvalResult, topicsEvalRun, topicsGoldenItem } from "@/db/schema"
import {
  EXTRACTION_CODE_SETS,
  EXTRACTION_VARIANTS,
  type ExtractionCodeSet,
  type ExtractionVariant,
  loadPromptCodes,
  type NormalizedExtraction,
} from "@/server/topics/prompt/extraction"
import {
  classifyExtractionError,
  EXTRACTION_PROCESS,
  runExtraction,
} from "@/server/topics/prompt/run-extraction"
import { loadGoldenWorkItems } from "@/server/topics/golden-set"
import { loadExtractionCounterparties } from "@/server/topics/signals/counterparty-line"
import { loadCodeInfo, loadEvalContext, postprocessForEval } from "@/server/topics/eval/context"
import {
  computeEvalMetrics,
  evalGateVerdict,
  parseExpected,
  percentile,
  postPrediction,
  rawPrediction,
  type EvalBucket,
  type EvalCodeRow,
  type EvalGate,
  type EvalMismatch,
  type EvalPostStored,
  type MetricItem,
  type PrStats,
} from "@/server/topics/eval/metrics"
import {
  clearEvalRunFinished,
  createEvalRunRow,
  ensureEvalRunRow,
  EvalError,
  getEvalRunRow,
  getStoredEvalReport,
  legacyRunSettings,
  saveEvalRunReport,
  spikeUsage,
  usageTotals,
  type EvalInput,
  type EvalRunKind,
  type SpikeUsageRow,
} from "@/server/topics/eval/run-store"
import { getSampleReport, runSampleBatch, SAMPLE_MAX, startSampleRun, type SampleReport } from "@/server/topics/eval/sample-run"

// Eval runner (plan phase 0 task 8 = model spike; phase 2 task 8 = eval;
// spec 01 §12). Platform-admin tooling; org id explicit.
//
// Two inputs:
//   golden = the org's golden set (all items except `excluded`). Each item
//            gives one topics_eval_result row; `output` = the normalized
//            model output (as in phase 0) + `post` = the server
//            post-processing of spec §5.4 (EvalPostStored: instances with
//            counted / notCountedReason / scoreContrib, dropped, score, band,
//            direction). Rows from before phase 2 have no `post`; they still
//            report raw metrics. The report has precision / recall / F1 per
//            code on raw model codes and on post-processed kept codes, real
//            and synthetic items apart, and the quality-gate verdict
//            (eval/metrics.ts → EVAL_GATE).
//   sample = offline batch for «review» codes (R6) over recent items outside
//            the golden set — see eval/sample-run.ts.
//
// A run = one runId with a topics_eval_run row (eval/run-store.ts). Batches
// process the next items the run has not seen yet, so the UI loops in small
// batches under the route's maxDuration (resumable). When nothing remains,
// the report snapshot is stored in topics_eval_run.metrics + finishedAt.
// Tokens and cost come from ai_usage_event (ref = { evalRunId, … }).
//
// The model under test is whatever «Процессы ИИ» assigns to
// topics.signal_extraction at call time; it is recorded per result. To compare
// models the admin switches the assignment between runs (the phase 0 spike).
//
// The codes come from the org's effective signals registry (loaded once per
// batch, so all items of a batch share one taxonomy version, recorded in
// `config.taxonomyVersion` with the exact `config.codes` list); post-
// processing uses the same version (eval/context.ts). An org with no active
// code fails the batch with SignalsNotEnabledError (route → 400).

export const SPIKE_BATCH_MAX = 10
export { SAMPLE_MAX }
export { EvalError as SpikeError }
const CONCURRENCY = 3

type ResultConfig = {
  process: string
  model: string | null
  classifierModel: string | null
  variant: ExtractionVariant
  codeSet: ExtractionCodeSet
  codesInPrompt: number
  codeBlockChars: number
  systemChars: number
  taxonomyVersion: number
  /** Codes in the prompt (two_pass: the whole set offered to pass 1). */
  codes: string[]
  inputTokens: number | null
  outputTokens: number | null
  blocks: string[] | null
  synthetic: boolean
  /** Identity I4: the org profile was in the prompt. */
  promptContext: boolean
}

async function remainingItemIds(orgId: string, runId: string): Promise<string[]> {
  const rows = await db
    .select({ id: topicsGoldenItem.id })
    .from(topicsGoldenItem)
    .where(
      and(
        eq(topicsGoldenItem.organizationId, orgId),
        ne(topicsGoldenItem.status, "excluded"),
        sql`not exists (select 1 from ${topicsEvalResult} r where r.run_id = ${runId} and r.golden_item_id = ${topicsGoldenItem.id})`,
      ),
    )
    .orderBy(asc(topicsGoldenItem.createdAt), asc(topicsGoldenItem.id))
  return rows.map((r) => r.id)
}

export type SpikeBatchResult = {
  runId: string
  input: EvalInput
  variant: ExtractionVariant
  codeSet: ExtractionCodeSet
  processed: number
  ok: number
  failed: number
  remaining: number
  done: boolean
}

/**
 * Process the next `limit` (≤ 10) items of the run. A new run starts when
 * runId is omitted (input golden or sample). A resumed run keeps its stored
 * settings (input / variant / code set).
 */
export async function runSpikeBatch(args: {
  orgId: string
  userId: string | null
  runId?: string | null
  limit?: number
  variant?: ExtractionVariant
  codeSet?: ExtractionCodeSet
  input?: EvalInput
  sampleSize?: number
  /**
   * Identity I4 «С профилем организации»: force the org profile in / out of
   * the prompt for a NEW run (stored in its config; a resumed run keeps its
   * own value). Omitted = the org setting `identity.promptContext`.
   */
  promptContext?: boolean
}): Promise<SpikeBatchResult> {
  const limit = Math.max(1, Math.min(SPIKE_BATCH_MAX, Math.floor(args.limit ?? 5)))
  const variant: ExtractionVariant = args.variant ?? "single"
  const codeSet: ExtractionCodeSet = args.codeSet ?? "live"
  if (!EXTRACTION_VARIANTS.includes(variant)) throw new EvalError(`Неизвестный вариант: ${variant}`)
  if (!EXTRACTION_CODE_SETS.includes(codeSet)) throw new EvalError(`Неизвестный набор кодов: ${codeSet}`)

  let runId = args.runId || null
  if (runId) {
    // Org check before any write (also for phase 0 runs without a row).
    const row = await getEvalRunRow(runId)
    const owner = row?.organizationId ?? (await legacyRunSettings(runId))?.orgId
    if (!owner) throw new EvalError("Прогон не найден")
    if (owner !== args.orgId) throw new EvalError("Прогон относится к другой организации")
  } else if (args.input === "sample") {
    runId = await startSampleRun({
      orgId: args.orgId,
      userId: args.userId,
      size: args.sampleSize ?? 50,
      variant,
      promptContext: args.promptContext,
    })
  } else {
    // Fails before any write when the org has no active code.
    const promptSet = await loadPromptCodes(args.orgId, codeSet, { promptContext: args.promptContext })
    runId = `eval_${randomUUID()}`
    await createEvalRunRow({
      id: runId,
      orgId: args.orgId,
      kind: "eval",
      userId: args.userId,
      config: {
        input: "golden",
        process: EXTRACTION_PROCESS,
        variant,
        codeSet,
        taxonomyVersion: promptSet.taxonomyVersion,
        codes: promptSet.codes.map((c) => c.code),
        reviewCodes: promptSet.codes.filter((c) => c.reviewOnly).map((c) => c.code),
        promptContext: promptSet.promptContext,
      },
      metrics: { schema: 1 },
    })
  }

  const run = await ensureEvalRunRow(runId, args.userId)
  if (!run) throw new EvalError("Прогон не найден")
  if (run.config.input === "sample") {
    const r = await runSampleBatch(run, limit)
    return { runId, input: "sample", variant: run.config.variant, codeSet: run.config.codeSet, ...r }
  }
  return runGoldenBatch(
    run.id,
    args.orgId,
    run.config.variant,
    run.config.codeSet,
    limit,
    run.finishedAt !== null,
    run.config.promptContext === true,
  )
}

async function runGoldenBatch(
  runId: string,
  orgId: string,
  variant: ExtractionVariant,
  codeSet: ExtractionCodeSet,
  limit: number,
  wasFinished: boolean,
  promptContext: boolean,
): Promise<SpikeBatchResult> {
  // Before any write: an org without active codes fails the whole batch.
  // The org profile follows the RUN (fixed at start), not today's setting.
  const promptSet = await loadPromptCodes(orgId, codeSet, { promptContext })
  const setCodes = promptSet.codes.map((c) => c.code)

  const pending = await remainingItemIds(orgId, runId)
  const batchIds = pending.slice(0, limit)
  if (batchIds.length > 0 && wasFinished) await clearEvalRunFinished(runId)
  const counterparties =
    batchIds.length > 0 && promptSet.promptContext ? await loadExtractionCounterparties(orgId) : null
  const [items, ctx] = await Promise.all([
    loadGoldenWorkItems(orgId, batchIds, { counterparties }),
    batchIds.length > 0 ? loadEvalContext(orgId, promptSet) : null,
  ])
  const loaded = new Set(items.map((i) => i.id))

  // Items without text: record a failed result so the run moves on.
  const missing = batchIds.filter((id) => !loaded.has(id))
  if (missing.length > 0) {
    await db.insert(topicsEvalResult).values(
      missing.map((id) => ({
        id: randomUUID(),
        runId,
        organizationId: orgId,
        goldenItemId: id,
        config: {
          process: EXTRACTION_PROCESS,
          variant,
          codeSet,
          taxonomyVersion: promptSet.taxonomyVersion,
          codes: setCodes,
          promptContext: promptSet.promptContext,
        },
        ok: false,
        error: "Нет текста элемента",
        output: { errorKind: "other" },
        durationMs: 0,
      })),
    )
  }

  let ok = 0
  let failed = missing.length
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next++]
        const started = Date.now()
        try {
          const run = await runExtraction({
            orgId,
            text: item.text,
            envelope: item.envelope,
            variant,
            promptSet,
            successors: ctx!.scoring.successors,
            ref: { evalRunId: runId, goldenItemId: item.id },
          })
          const post: EvalPostStored = postprocessForEval(run.output, ctx!.scoring, {
            text: item.text,
            ownText: item.ownText,
            date: item.date,
            orgAttribution: item.orgAttribution,
          })
          const config: ResultConfig = {
            process: EXTRACTION_PROCESS,
            model: run.model,
            classifierModel: run.classifierModel,
            variant,
            codeSet,
            codesInPrompt: run.codesInPrompt,
            codeBlockChars: run.codeBlockChars,
            systemChars: run.systemChars,
            taxonomyVersion: run.taxonomyVersion,
            codes: setCodes,
            inputTokens: run.inputTokens,
            outputTokens: run.outputTokens,
            blocks: run.blocks,
            synthetic: item.synthetic,
            promptContext: promptSet.promptContext,
          }
          await db.insert(topicsEvalResult).values({
            id: randomUUID(),
            runId,
            organizationId: orgId,
            goldenItemId: item.id,
            config,
            ok: true,
            output: { ...(run.output ?? { skipped: "no_blocks" }), post } as Record<string, unknown>,
            durationMs: run.durationMs,
          })
          ok++
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          await db.insert(topicsEvalResult).values({
            id: randomUUID(),
            runId,
            organizationId: orgId,
            goldenItemId: item.id,
            config: {
              process: EXTRACTION_PROCESS,
              variant,
              codeSet,
              taxonomyVersion: promptSet.taxonomyVersion,
              codes: setCodes,
              synthetic: item.synthetic,
              promptContext: promptSet.promptContext,
            },
            ok: false,
            error: message.slice(0, 2000),
            output: { errorKind: classifyExtractionError(error) },
            durationMs: Date.now() - started,
          })
          failed++
        }
      }
    }),
  )

  const remaining = Math.max(0, pending.length - batchIds.length)
  if (remaining === 0 && (batchIds.length > 0 || !wasFinished)) {
    const report = await getSpikeReport(runId)
    await saveEvalRunReport(runId, { ...report, finishedAt: new Date().toISOString() }, true)
  }
  return {
    runId,
    input: "golden",
    variant,
    codeSet,
    processed: batchIds.length,
    ok,
    failed,
    remaining,
    done: remaining === 0,
  }
}

// ── Runs list ─────────────────────────────────────────────────────────────

export type SpikeRunRow = {
  runId: string
  kind: EvalRunKind
  input: EvalInput
  startedAt: string
  lastAt: string
  finishedAt: string | null
  items: number
  ok: number
  /** Sample runs: planned sample size. */
  planned: number | null
  variant: string | null
  codeSet: string | null
  models: string[]
  avgDurationMs: number | null
  /** A report snapshot is stored in topics_eval_run.metrics. */
  stored: boolean
  verdict: EvalGate["verdict"] | null
  /** Identity I4: org profile in the prompt (true / false); null = before I4 / unknown. */
  promptContext: boolean | null
}

function promptContextOf(v: string | null | undefined): boolean | null {
  return v === "true" ? true : v === "false" ? false : null
}

export async function listSpikeRuns(orgId: string): Promise<SpikeRunRow[]> {
  const sampleItems = sql`jsonb_each(coalesce(${topicsEvalRun.metrics}->'sample'->'items', '{}'::jsonb))`
  const [resultRuns, runRows] = await Promise.all([
    db
      .select({
        runId: topicsEvalResult.runId,
        startedAt: sql<string>`min(${topicsEvalResult.createdAt})`,
        lastAt: sql<string>`max(${topicsEvalResult.createdAt})`,
        items: sql<number>`count(*)::int`,
        ok: sql<number>`count(*) filter (where ${topicsEvalResult.ok})::int`,
        variant: sql<string | null>`min(${topicsEvalResult.config}->>'variant')`,
        codeSet: sql<string | null>`min(${topicsEvalResult.config}->>'codeSet')`,
        models: sql<string[] | null>`array_remove(array_agg(distinct ${topicsEvalResult.config}->>'model'), null)`,
        avgDurationMs: sql<number | null>`avg(${topicsEvalResult.durationMs}) filter (where ${topicsEvalResult.ok})::int`,
      })
      .from(topicsEvalResult)
      .where(eq(topicsEvalResult.organizationId, orgId))
      .groupBy(topicsEvalResult.runId),
    db
      .select({
        id: topicsEvalRun.id,
        kind: topicsEvalRun.kind,
        input: sql<string | null>`${topicsEvalRun.config}->>'input'`,
        variant: sql<string | null>`${topicsEvalRun.config}->>'variant'`,
        codeSet: sql<string | null>`${topicsEvalRun.config}->>'codeSet'`,
        promptContext: sql<string | null>`${topicsEvalRun.config}->>'promptContext'`,
        planned: sql<number | null>`jsonb_array_length(coalesce(${topicsEvalRun.config}->'sampleItemIds', '[]'::jsonb))`,
        createdAt: topicsEvalRun.createdAt,
        finishedAt: topicsEvalRun.finishedAt,
        stored: sql<boolean>`coalesce(${topicsEvalRun.metrics} ? 'report', false)`,
        verdict: sql<string | null>`${topicsEvalRun.metrics}->'report'->'gate'->>'verdict'`,
        sItems: sql<number>`(select count(*)::int from ${sampleItems})`,
        sOk: sql<number>`(select count(*)::int from ${sampleItems} e where (e.value->>'ok')::boolean)`,
        sModels: sql<string[] | null>`(select array_remove(array_agg(distinct e.value->>'model'), null) from ${sampleItems} e)`,
        sAvg: sql<number | null>`(select avg((e.value->>'durationMs')::int)::int from ${sampleItems} e where (e.value->>'durationMs')::int > 0)`,
        sLast: sql<string | null>`(select max(e.value->>'at') from ${sampleItems} e)`,
      })
      .from(topicsEvalRun)
      // Grouping eval runs (kind "grouping", eval/grouping.ts) are listed apart.
      .where(and(eq(topicsEvalRun.organizationId, orgId), ne(topicsEvalRun.kind, "grouping"))),
  ])
  const byRun = new Map(runRows.map((r) => [r.id, r]))
  const out: SpikeRunRow[] = resultRuns.map((r) => {
    const row = byRun.get(r.runId)
    byRun.delete(r.runId)
    return {
      runId: r.runId,
      kind: row?.kind === "eval" ? "eval" : "spike",
      input: "golden",
      startedAt: new Date(r.startedAt).toISOString(),
      lastAt: new Date(r.lastAt).toISOString(),
      finishedAt: row?.finishedAt?.toISOString() ?? null,
      items: r.items,
      ok: r.ok,
      planned: null,
      variant: r.variant,
      codeSet: r.codeSet,
      models: r.models ?? [],
      avgDurationMs: r.avgDurationMs,
      stored: row?.stored ?? false,
      verdict: (row?.verdict as EvalGate["verdict"] | null) ?? null,
      promptContext: promptContextOf(row?.promptContext),
    }
  })
  // Rows without results: sample runs, and golden runs that failed before the first item.
  for (const row of byRun.values()) {
    const sample = row.input === "sample"
    out.push({
      runId: row.id,
      kind: row.kind === "spike" ? "spike" : "eval",
      input: sample ? "sample" : "golden",
      startedAt: row.createdAt.toISOString(),
      lastAt: row.sLast ?? row.createdAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
      items: row.sItems,
      ok: row.sOk,
      planned: sample ? row.planned : null,
      variant: row.variant,
      codeSet: row.codeSet,
      models: row.sModels ?? [],
      avgDurationMs: row.sAvg,
      stored: row.stored,
      verdict: sample ? null : ((row.verdict as EvalGate["verdict"] | null) ?? null),
      promptContext: promptContextOf(row.promptContext),
    })
  }
  return out.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

// ── Report ────────────────────────────────────────────────────────────────

export type { PrStats, EvalBucket, EvalCodeRow, EvalGate, EvalMismatch, SpikeUsageRow, SampleReport }

export type SpikeReport = {
  input: "golden"
  kind: EvalRunKind
  runId: string
  orgId: string
  startedAt: string
  lastAt: string
  finishedAt: string | null
  variant: string
  codeSet: string
  /** Identity I4: org profile in the prompt (run config); false for runs before I4. */
  promptContext: boolean
  models: string[]
  codeBlockChars: number | null
  codesInPrompt: number | null
  /** Taxonomy versions the results were computed with (normally one). */
  taxonomyVersions: number[]
  items: {
    total: number
    ok: number
    failed: number
    structuredFailures: number
    structuredFailureRate: number
    otherFailures: number
    remaining: number
    /** Reviewed items with an expected answer (judged): real / synthetic. */
    judgedReal: number
    judgedSynthetic: number
  }
  latency: { p50: number | null; p95: number | null; max: number | null; mean: number | null }
  usage: {
    calls: number
    errors: number
    inputTokens: number
    outputTokens: number
    reasoningTokens: number
    cacheReadTokens: number
    costUsd: number
    costPerItemUsd: number | null
    byProcessModel: SpikeUsageRow[]
  }
  /** Raw model output. */
  signals: {
    total: number
    lowConfidence: number
    evidenceNotFound: number
    unknownCodes: number
    itemsWithSignals: number
  }
  /** Server post-processing (ok items with a `post` part). */
  post: {
    items: number
    instances: number
    counted: number
    notCounted: Record<string, number>
    dropped: Record<string, number>
    bands: Record<string, number>
  }
  /** Precision / recall / F1 over judged items: raw model codes and post-processed kept codes. */
  overall: Record<"raw" | "post", Record<EvalBucket, PrStats>>
  codes: EvalCodeRow[]
  gate: EvalGate
  slowest: { goldenItemId: string; durationMs: number; codes: string[]; ok: boolean }[]
  failed: { goldenItemId: string; error: string; errorKind: string }[]
  /** Items with a mismatch against `expected` (up to 50). */
  mismatches: EvalMismatch[]
}

export type EvalReport = SpikeReport | SampleReport

export async function getSpikeReport(runId: string): Promise<SpikeReport> {
  const rows = await db
    .select({
      goldenItemId: topicsEvalResult.goldenItemId,
      organizationId: topicsEvalResult.organizationId,
      config: topicsEvalResult.config,
      ok: topicsEvalResult.ok,
      error: topicsEvalResult.error,
      output: topicsEvalResult.output,
      durationMs: topicsEvalResult.durationMs,
      createdAt: topicsEvalResult.createdAt,
      synthetic: topicsGoldenItem.synthetic,
      expected: topicsGoldenItem.expected,
      status: topicsGoldenItem.status,
    })
    .from(topicsEvalResult)
    .innerJoin(topicsGoldenItem, eq(topicsGoldenItem.id, topicsEvalResult.goldenItemId))
    .where(eq(topicsEvalResult.runId, runId))
    .orderBy(asc(topicsEvalResult.createdAt))
  if (rows.length === 0) throw new EvalError("Прогон не найден")

  const orgId = rows[0].organizationId
  const firstCfg = rows[0].config as Partial<ResultConfig>
  const variant = firstCfg.variant ?? "single"
  const codeSet = (firstCfg.codeSet ?? "live") as ExtractionCodeSet
  // Codes the run asked for (stored per result); expected codes outside it
  // are ignored, so a live run is not charged for review-only codes.
  const inSet = new Set<string>()
  for (const r of rows) {
    const codes = (r.config as Partial<ResultConfig>).codes
    if (Array.isArray(codes)) for (const c of codes) inSet.add(c)
  }
  const [info, runRow, usageRows, remainingIds] = await Promise.all([
    loadCodeInfo(orgId),
    getEvalRunRow(runId),
    spikeUsage(runId),
    remainingItemIds(orgId, runId),
  ])
  const taxonomyVersions = [
    ...new Set(
      rows
        .map((r) => (r.config as Partial<ResultConfig>).taxonomyVersion)
        .filter((v): v is number => typeof v === "number"),
    ),
  ].sort((a, b) => a - b)

  const okRows = rows.filter((r) => r.ok)
  const failedRows = rows.filter((r) => !r.ok)
  const structuredFailures = failedRows.filter(
    (r) => (r.output as { errorKind?: string } | null)?.errorKind === "structured_output",
  ).length
  const durations = okRows
    .map((r) => r.durationMs ?? 0)
    .filter((d) => d > 0)
    .sort((a, b) => a - b)

  const models = new Set<string>()
  let codeBlockChars: number | null = null
  let codesInPrompt: number | null = null
  const signals = { total: 0, lowConfidence: 0, evidenceNotFound: 0, unknownCodes: 0, itemsWithSignals: 0 }
  const post: SpikeReport["post"] = { items: 0, instances: 0, counted: 0, notCounted: {}, dropped: {}, bands: {} }
  const inc = (m: Record<string, number>, k: string) => {
    m[k] = (m[k] ?? 0) + 1
  }
  const metricItems: MetricItem[] = []
  const predictedById = new Map<string, string[]>()
  let judgedReal = 0
  let judgedSynthetic = 0

  for (const r of rows) {
    const cfg = r.config as Partial<ResultConfig>
    const expected = parseExpected(r.expected, r.status, inSet)
    if (expected) {
      if (r.synthetic) judgedSynthetic++
      else judgedReal++
    }
    if (!r.ok) {
      metricItems.push({ id: r.goldenItemId, synthetic: r.synthetic, ok: false, expected, raw: null, post: null })
      continue
    }
    if (cfg.model) models.add(cfg.model)
    if (codeBlockChars === null && typeof cfg.codeBlockChars === "number" && variant === "single") {
      codeBlockChars = cfg.codeBlockChars
      codesInPrompt = cfg.codesInPrompt ?? null
    }
    const out = r.output as (Partial<NormalizedExtraction> & { post?: EvalPostStored }) | null
    const sigs = Array.isArray(out?.signals) ? out.signals : []
    signals.total += sigs.length
    signals.unknownCodes += Array.isArray(out?.unknownCodes) ? out.unknownCodes.length : 0
    if (sigs.length > 0) signals.itemsWithSignals++
    for (const s of sigs) {
      if (s.evidenceFound === false) signals.evidenceNotFound++
      if (s.confidence === "low") signals.lowConfidence++
    }
    if (out?.post && Array.isArray(out.post.instances)) {
      post.items++
      inc(post.bands, out.post.band)
      for (const i of out.post.instances) {
        post.instances++
        if (i.counted) post.counted++
        else inc(post.notCounted, i.notCountedReason ?? "other")
      }
      for (const d of out.post.dropped ?? []) inc(post.dropped, d.reason)
    }
    const raw = rawPrediction(out)
    predictedById.set(r.goldenItemId, [...raw.predicted])
    metricItems.push({
      id: r.goldenItemId,
      synthetic: r.synthetic,
      ok: true,
      expected,
      raw,
      post: postPrediction(out),
    })
  }

  const metrics = computeEvalMetrics(metricItems, info)
  const gate = evalGateVerdict(metrics, [...inSet], info)
  if (metrics.postItems === 0) gate.reasons.unshift("Нет результатов постобработки (прогон до фазы 2)")

  const usage = usageTotals(usageRows)
  const sum = durations.reduce((a, b) => a + b, 0)

  return {
    input: "golden",
    kind: runRow?.kind ?? "spike",
    runId,
    orgId,
    startedAt: rows[0].createdAt.toISOString(),
    lastAt: rows[rows.length - 1].createdAt.toISOString(),
    finishedAt: runRow?.finishedAt?.toISOString() ?? null,
    variant,
    codeSet,
    promptContext: runRow?.config.promptContext === true,
    models: [...models],
    codeBlockChars,
    codesInPrompt,
    taxonomyVersions,
    items: {
      total: rows.length,
      ok: okRows.length,
      failed: failedRows.length,
      structuredFailures,
      structuredFailureRate: rows.length ? structuredFailures / rows.length : 0,
      otherFailures: failedRows.length - structuredFailures,
      remaining: remainingIds.length,
      judgedReal,
      judgedSynthetic,
    },
    latency: {
      p50: percentile(durations, 50),
      p95: percentile(durations, 95),
      max: durations.length ? durations[durations.length - 1] : null,
      mean: durations.length ? Math.round(sum / durations.length) : null,
    },
    usage: {
      ...usage,
      costPerItemUsd: rows.length ? usage.costUsd / rows.length : null,
      byProcessModel: usageRows,
    },
    signals,
    post,
    overall: metrics.overall,
    codes: metrics.codes,
    gate,
    slowest: [...rows]
      .sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))
      .slice(0, 10)
      .map((r) => ({
        goldenItemId: r.goldenItemId,
        durationMs: r.durationMs ?? 0,
        codes: predictedById.get(r.goldenItemId) ?? [],
        ok: r.ok,
      })),
    failed: failedRows.map((r) => ({
      goldenItemId: r.goldenItemId,
      error: r.error ?? "",
      errorKind: (r.output as { errorKind?: string } | null)?.errorKind ?? "other",
    })),
    mismatches: metrics.mismatches,
  }
}

/** Live report of any run (golden or sample). */
export async function getEvalReport(runId: string): Promise<EvalReport> {
  const run = await getEvalRunRow(runId)
  if (run?.config.input === "sample") return getSampleReport(runId, run)
  return getSpikeReport(runId)
}

/** The report snapshot stored with the run (null = none yet). */
export async function getStoredReport(runId: string): Promise<{ report: EvalReport; savedAt: string | null } | null> {
  return getStoredEvalReport<EvalReport>(runId)
}

/**
 * Compute the live report and store it as the run's metrics («Сохранить
 * метрики»). finishedAt is set only when nothing remains. A phase 0 run gets
 * its `spike` row here.
 */
export async function saveEvalReport(runId: string, userId: string | null): Promise<EvalReport> {
  const run = await ensureEvalRunRow(runId, userId)
  if (!run) throw new EvalError("Прогон не найден")
  const report = await getEvalReport(runId)
  const remaining = report.input === "sample" ? report.remaining : report.items.remaining
  const stored = remaining === 0 ? { ...report, finishedAt: report.finishedAt ?? new Date().toISOString() } : report
  await saveEvalRunReport(runId, stored, remaining === 0)
  return stored
}

export type { EvalInput, EvalRunKind }

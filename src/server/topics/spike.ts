import "server-only"
import { randomUUID } from "crypto"
import { and, asc, eq, ne, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { aiUsageEvent, topicsEvalResult, topicsGoldenItem } from "@/db/schema"
import { getEffectiveSignals, getRegistry } from "@/server/signals/registry"
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

// Model spike / eval runner (plan phase 0 task 8; spec 01 §12).
//
// A run = one runId over the org's golden set (all items except `excluded`).
// runSpikeBatch processes the next items the run has not seen yet, so the UI
// loops in small batches under the route's maxDuration (resumable). Each item
// gives one topics_eval_result row; tokens and cost come from ai_usage_event
// (ref = { evalRunId, goldenItemId }).
//
// The model under test is whatever «Процессы ИИ» assigns to
// topics.signal_extraction at call time; it is recorded per result. To compare
// models the admin switches the assignment between runs.
//
// The codes come from the org's effective signals registry (loaded once per
// batch, so all items of a batch share one taxonomy version, recorded in
// `config.taxonomyVersion` with the exact `config.codes` list). An org with
// no active code fails the batch with SignalsNotEnabledError (route → 400).

export const SPIKE_BATCH_MAX = 10
const CONCURRENCY = 3

export class SpikeError extends Error {}

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
}

async function runSettings(runId: string) {
  const [first] = await db
    .select({ organizationId: topicsEvalResult.organizationId, config: topicsEvalResult.config })
    .from(topicsEvalResult)
    .where(eq(topicsEvalResult.runId, runId))
    .orderBy(asc(topicsEvalResult.createdAt))
    .limit(1)
  if (!first) return null
  const c = first.config as Partial<ResultConfig>
  return {
    orgId: first.organizationId,
    variant: (c.variant ?? "single") as ExtractionVariant,
    codeSet: (c.codeSet ?? "live") as ExtractionCodeSet,
  }
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
  variant: ExtractionVariant
  codeSet: ExtractionCodeSet
  processed: number
  ok: number
  failed: number
  remaining: number
  done: boolean
}

/**
 * Process the next `limit` (≤ 10) golden items of the run. A new run starts
 * when runId is omitted. A resumed run keeps the variant / code set of its
 * first result.
 */
export async function runSpikeBatch(args: {
  orgId: string
  runId?: string | null
  limit?: number
  variant?: ExtractionVariant
  codeSet?: ExtractionCodeSet
}): Promise<SpikeBatchResult> {
  const limit = Math.max(1, Math.min(SPIKE_BATCH_MAX, Math.floor(args.limit ?? 5)))
  let variant: ExtractionVariant = args.variant ?? "single"
  let codeSet: ExtractionCodeSet = args.codeSet ?? "live"
  if (!EXTRACTION_VARIANTS.includes(variant)) throw new SpikeError(`Неизвестный вариант: ${variant}`)
  if (!EXTRACTION_CODE_SETS.includes(codeSet)) throw new SpikeError(`Неизвестный набор кодов: ${codeSet}`)

  const runId = args.runId || `spike_${randomUUID()}`
  if (args.runId) {
    const existing = await runSettings(args.runId)
    if (existing) {
      if (existing.orgId !== args.orgId) throw new SpikeError("Прогон относится к другой организации")
      variant = existing.variant
      codeSet = existing.codeSet
    }
  }

  // Before any write: an org without active codes fails the whole batch.
  const promptSet = await loadPromptCodes(args.orgId, codeSet)
  const setCodes = promptSet.codes.map((c) => c.code)

  const pending = await remainingItemIds(args.orgId, runId)
  const batchIds = pending.slice(0, limit)
  const items = await loadGoldenWorkItems(args.orgId, batchIds)
  const loaded = new Set(items.map((i) => i.id))

  // Items without text: record a failed result so the run moves on.
  const missing = batchIds.filter((id) => !loaded.has(id))
  if (missing.length > 0) {
    await db.insert(topicsEvalResult).values(
      missing.map((id) => ({
        id: randomUUID(),
        runId,
        organizationId: args.orgId,
        goldenItemId: id,
        config: {
          process: EXTRACTION_PROCESS,
          variant,
          codeSet,
          taxonomyVersion: promptSet.taxonomyVersion,
          codes: setCodes,
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
            orgId: args.orgId,
            text: item.text,
            envelope: item.envelope,
            variant,
            promptSet,
            ref: { evalRunId: runId, goldenItemId: item.id },
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
          }
          await db.insert(topicsEvalResult).values({
            id: randomUUID(),
            runId,
            organizationId: args.orgId,
            goldenItemId: item.id,
            config,
            ok: true,
            output: (run.output ?? { skipped: "no_blocks" }) as Record<string, unknown>,
            durationMs: run.durationMs,
          })
          ok++
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          await db.insert(topicsEvalResult).values({
            id: randomUUID(),
            runId,
            organizationId: args.orgId,
            goldenItemId: item.id,
            config: {
              process: EXTRACTION_PROCESS,
              variant,
              codeSet,
              taxonomyVersion: promptSet.taxonomyVersion,
              codes: setCodes,
              synthetic: item.synthetic,
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
  return {
    runId,
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
  startedAt: string
  lastAt: string
  items: number
  ok: number
  variant: string | null
  codeSet: string | null
  models: string[]
  avgDurationMs: number | null
}

export async function listSpikeRuns(orgId: string): Promise<SpikeRunRow[]> {
  const rows = await db
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
    .groupBy(topicsEvalResult.runId)
    .orderBy(sql`min(${topicsEvalResult.createdAt}) desc`)
  return rows.map((r) => ({
    ...r,
    startedAt: new Date(r.startedAt).toISOString(),
    lastAt: new Date(r.lastAt).toISOString(),
    models: r.models ?? [],
  }))
}

// ── Report ────────────────────────────────────────────────────────────────

export type PrStats = {
  items: number
  tp: number
  fp: number
  fn: number
  precision: number | null
  recall: number | null
}

export type SpikeCodeRow = {
  code: string
  labelRu: string
  /** The code's state for the org now: on = live prompt, review = offline only, off. */
  status: "on" | "review" | "off" | null
  /** Effective weight for the org (registry). */
  weight: number | null
  profile: string | null
  /** Items where the code was predicted (high / medium confidence). */
  found: number
  /** Items where it was predicted with low confidence (count 0, spec §5.4). */
  foundLow: number
  expected: number
  tp: number
  fp: number
  fn: number
  precision: number | null
  recall: number | null
}

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

export type SpikeReport = {
  runId: string
  orgId: string
  startedAt: string
  lastAt: string
  variant: string
  codeSet: string
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
  signals: {
    total: number
    lowConfidence: number
    evidenceNotFound: number
    unknownCodes: number
    itemsWithSignals: number
  }
  /** Precision / recall over items with an `expected` answer. */
  overall: { all: PrStats; real: PrStats; synthetic: PrStats }
  codes: SpikeCodeRow[]
  slowest: { goldenItemId: string; durationMs: number; codes: string[]; ok: boolean }[]
  failed: { goldenItemId: string; error: string; errorKind: string }[]
  /** Items with a mismatch against `expected` (up to 50). */
  mismatches: { goldenItemId: string; synthetic: boolean; expected: string[]; predicted: string[] }[]
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[idx]
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null)

function pr(items: number, tp: number, fp: number, fn: number): PrStats {
  return { items, tp, fp, fn, precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn) }
}

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
    })
    .from(topicsEvalResult)
    .innerJoin(topicsGoldenItem, eq(topicsGoldenItem.id, topicsEvalResult.goldenItemId))
    .where(eq(topicsEvalResult.runId, runId))
    .orderBy(asc(topicsEvalResult.createdAt))
  if (rows.length === 0) throw new SpikeError("Прогон не найден")

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
  const [registry, effective] = await Promise.all([getRegistry(), getEffectiveSignals(orgId)])
  const category = new Map(registry.categories.map((c) => [c.code, c]))
  const eff = new Map(effective.map((e) => [e.code, e]))
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
  const perCode = new Map<string, SpikeCodeRow>()
  const codeRow = (code: string): SpikeCodeRow => {
    let row = perCode.get(code)
    if (!row) {
      const c = category.get(code)
      const e = eff.get(code)
      row = {
        code,
        labelRu: c?.labelRu ?? code,
        status: e ? (e.reviewOnly ? "review" : e.inPrompt ? "on" : "off") : null,
        weight: e?.weight ?? c?.weight ?? null,
        profile: e?.displayProfile ?? c?.displayProfile ?? null,
        found: 0,
        foundLow: 0,
        expected: 0,
        tp: 0,
        fp: 0,
        fn: 0,
        precision: null,
        recall: null,
      }
      perCode.set(code, row)
    }
    return row
  }
  const totals = {
    all: { items: 0, tp: 0, fp: 0, fn: 0 },
    real: { items: 0, tp: 0, fp: 0, fn: 0 },
    synthetic: { items: 0, tp: 0, fp: 0, fn: 0 },
  }
  const signals = { total: 0, lowConfidence: 0, evidenceNotFound: 0, unknownCodes: 0, itemsWithSignals: 0 }
  const mismatches: SpikeReport["mismatches"] = []
  const predictedById = new Map<string, string[]>()

  for (const r of okRows) {
    const cfg = r.config as Partial<ResultConfig>
    if (cfg.model) models.add(cfg.model)
    if (codeBlockChars === null && typeof cfg.codeBlockChars === "number" && variant === "single") {
      codeBlockChars = cfg.codeBlockChars
      codesInPrompt = cfg.codesInPrompt ?? null
    }
    const out = r.output as Partial<NormalizedExtraction> | null
    const sigs = Array.isArray(out?.signals) ? out.signals : []
    signals.total += sigs.length
    signals.unknownCodes += Array.isArray(out?.unknownCodes) ? out.unknownCodes.length : 0
    if (sigs.length > 0) signals.itemsWithSignals++
    const predicted = new Set<string>()
    for (const s of sigs) {
      if (s.evidenceFound === false) signals.evidenceNotFound++
      if (s.confidence === "low") {
        signals.lowConfidence++
        codeRow(s.code).foundLow++
      } else predicted.add(s.code)
    }
    predictedById.set(r.goldenItemId, [...predicted])
    for (const code of predicted) codeRow(code).found++

    const exp = r.expected as { codes?: { code?: string }[] } | null
    if (!exp || !Array.isArray(exp.codes)) continue
    const expected = new Set(
      exp.codes.map((c) => c?.code ?? "").filter((c) => c && inSet.has(c)),
    )
    const bucket = r.synthetic ? totals.synthetic : totals.real
    let tp = 0
    let fp = 0
    let fn = 0
    for (const code of expected) {
      codeRow(code).expected++
      if (predicted.has(code)) {
        tp++
        codeRow(code).tp++
      } else {
        fn++
        codeRow(code).fn++
      }
    }
    for (const code of predicted) {
      if (!expected.has(code)) {
        fp++
        codeRow(code).fp++
      }
    }
    for (const b of [totals.all, bucket]) {
      b.items++
      b.tp += tp
      b.fp += fp
      b.fn += fn
    }
    if ((fp > 0 || fn > 0) && mismatches.length < 50) {
      mismatches.push({
        goldenItemId: r.goldenItemId,
        synthetic: r.synthetic,
        expected: [...expected],
        predicted: [...predicted],
      })
    }
  }
  for (const row of perCode.values()) {
    row.precision = ratio(row.tp, row.tp + row.fp)
    row.recall = ratio(row.tp, row.tp + row.fn)
  }

  const usageRows = await spikeUsage(runId)
  const usage = usageRows.reduce(
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

  const remaining = (await remainingItemIds(orgId, runId)).length
  const sum = durations.reduce((a, b) => a + b, 0)

  return {
    runId,
    orgId,
    startedAt: rows[0].createdAt.toISOString(),
    lastAt: rows[rows.length - 1].createdAt.toISOString(),
    variant,
    codeSet,
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
      remaining,
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
    overall: {
      all: pr(totals.all.items, totals.all.tp, totals.all.fp, totals.all.fn),
      real: pr(totals.real.items, totals.real.tp, totals.real.fp, totals.real.fn),
      synthetic: pr(totals.synthetic.items, totals.synthetic.tp, totals.synthetic.fp, totals.synthetic.fn),
    },
    codes: [...perCode.values()].sort(
      (a, b) => b.found + b.expected - (a.found + a.expected) || a.code.localeCompare(b.code),
    ),
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
    mismatches,
  }
}

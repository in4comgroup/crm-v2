import "server-only"
import { randomUUID } from "crypto"
import { and, desc, eq, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { source, sourceItem, topicsGoldenItem } from "@/db/schema"
import { AiBudgetExceededError } from "@/server/ai/budget"
import { loadPromptCodes, type ExtractionVariant } from "@/server/topics/prompt/extraction"
import { counterpartyLineForItem } from "@/server/topics/signals/counterparty-line"
import { EXTRACTION_PROCESS, runExtraction } from "@/server/topics/prompt/run-extraction"
import { isEmptySignalItem } from "@/server/topics/signals/attachment-blocks"
import { loadSignalBatchContext } from "@/server/topics/signals/extract-item"
import { runGates } from "@/server/topics/signals/gates"
import {
  envelopeFromItem,
  itemHeaders,
  itemMarkdown,
  loadSignalItemRows,
  loadSignalItemText,
  mapPool,
  senderEmail,
  senderName,
} from "@/server/topics/signals/item-input"
import { loadCodeInfo, loadEvalContext, postprocessForEval } from "./context"
import { percentile, summarizeSample, type SampleItemResult, type SampleSummary } from "./metrics"
import {
  appendSampleItems,
  createEvalRunRow,
  EvalError,
  getEvalRunRow,
  sampleDoneIds,
  sampleItems,
  saveEvalRunReport,
  spikeUsage,
  usageTotals,
  type EvalRunRow,
  type SpikeUsageRow,
  type UsageTotals,
} from "./run-store"

// Offline batch for «review» codes (decision R6; plan phase 2 task 8; spec
// §12): N (≤ 100) recent parsed ROOT items of the org that are NOT in the
// golden set, extracted with the `review` code set (live + review-only
// codes). There is no expected answer, so no precision / recall: the report
// lists which review-only codes fired, how often, with evidence quotes and
// item ids, so a human can judge whether to switch a code on.
//
// Storage decision: `topics_eval_result.golden_item_id` is NOT NULL (FK to
// the golden set), and copying sampled items into `topics_golden_item`
// would pollute the set. So sample results live ONLY in the run row:
// `topics_eval_run.metrics.sample.items[sourceItemId]` (SampleItemResult),
// appended per batch with one atomic jsonb merge. The sample (item ids) is
// fixed at start in `config.sampleItemIds`; a batch takes the ids that have
// no entry yet, so runs are resumable in batches of ≤ 10 like golden runs.
// The engine's deterministic gates apply (exclusions R18, blocklist,
// automated senders, bounces …): a gated item never reaches the LLM and is
// recorded with its gate. Cost comes from ai_usage_event (ref = { evalRunId,
// sourceItemId }).

export const SAMPLE_MAX = 100
const CONCURRENCY = 3

/** Pick the sample and create the run row. Throws EvalError / SignalsNotEnabledError. */
export async function startSampleRun(args: {
  orgId: string
  userId: string | null
  size: number
  variant: ExtractionVariant
  /** Identity I4: force the org profile in / out of the prompt (omitted = org setting). */
  promptContext?: boolean
}): Promise<string> {
  const size = Math.max(1, Math.min(SAMPLE_MAX, Math.floor(args.size)))
  const promptSet = await loadPromptCodes(args.orgId, "review", { promptContext: args.promptContext })
  const reviewCodes = promptSet.codes.filter((c) => c.reviewOnly).map((c) => c.code)
  if (reviewCodes.length === 0) {
    throw new EvalError("У организации нет кодов «на проверке» — выборке нечего проверять.")
  }
  const itemDate = sql`coalesce(${sourceItem.sourceCreatedAt}, ${sourceItem.createdAt})`
  const rows = await db
    .select({ id: sourceItem.id })
    .from(sourceItem)
    .innerJoin(source, eq(source.id, sourceItem.sourceId))
    .where(
      and(
        eq(sourceItem.organizationId, args.orgId),
        sql`${sourceItem.parentSourceItemId} is null`,
        eq(sourceItem.parseStatus, "complete"),
        sql`(${sourceItem.parsedMarkdown} is not null or ${sourceItem.markdownR2Key} is not null)`,
        sql`coalesce((${sourceItem.metadataJson}->'relevance'->>'isJunk')::boolean, false) = false`,
        sql`${source.provider} <> 'aichat'`,
        sql`not exists (select 1 from ${topicsGoldenItem} g where g.organization_id = ${args.orgId} and g.source_item_id = ${sourceItem.id})`,
      ),
    )
    .orderBy(desc(itemDate), desc(sourceItem.id))
    .limit(size)
  if (rows.length === 0) throw new EvalError("Нет разобранных сообщений вне эталонного набора")

  const runId = `eval_${randomUUID()}`
  await createEvalRunRow({
    id: runId,
    orgId: args.orgId,
    kind: "eval",
    userId: args.userId,
    config: {
      input: "sample",
      process: EXTRACTION_PROCESS,
      variant: args.variant,
      codeSet: "review",
      taxonomyVersion: promptSet.taxonomyVersion,
      codes: promptSet.codes.map((c) => c.code),
      reviewCodes,
      sampleItemIds: rows.map((r) => r.id),
      sampleSize: size,
      promptContext: promptSet.promptContext,
    },
    metrics: { schema: 1, sample: { items: {} } },
  })
  return runId
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null)

/** Process the next ≤ limit sampled items; writes the report when none remain. */
export async function runSampleBatch(
  run: EvalRunRow,
  limit: number,
): Promise<{ processed: number; ok: number; failed: number; remaining: number; done: boolean }> {
  const orgId = run.organizationId
  const ids = run.config.sampleItemIds ?? []
  const done = await sampleDoneIds(run.id)
  const pending = ids.filter((id) => !done.has(id))
  const batchIds = pending.slice(0, limit)
  let ok = 0
  let failed = 0

  if (batchIds.length > 0) {
    // The org profile follows the RUN (fixed at start), not today's setting.
    const promptContext = run.config.promptContext === true
    const promptSet = await loadPromptCodes(orgId, "review", { promptContext })
    const [ctx, batch, rows] = await Promise.all([
      loadEvalContext(orgId, promptSet),
      loadSignalBatchContext(orgId, { promptContext }),
      loadSignalItemRows(orgId, batchIds),
    ])
    const byId = new Map(rows.map((r) => [r.id, r]))
    const results = await mapPool(batchIds, CONCURRENCY, async (id): Promise<SampleItemResult> => {
      const row = byId.get(id)
      const meta = (row?.metadataJson ?? {}) as Record<string, unknown>
      const itemDate = row ? (row.sourceCreatedAt ?? row.createdAt) : null
      const base: SampleItemResult = {
        itemId: id,
        ok: true,
        provider: row?.provider ?? null,
        subject: str(meta.subject),
        date: itemDate?.toISOString() ?? null,
        durationMs: 0,
        model: null,
        taxonomyVersion: ctx.scoring.taxonomyVersion,
        score: 0,
        band: "none",
        instances: [],
        dropped: [],
        at: new Date().toISOString(),
      }
      if (!row) return { ...base, ok: false, error: "Сообщение не найдено", score: null, band: null }
      const started = Date.now()
      try {
        // Same input as the engine: message + attachment blocks (§4.6).
        const input = await loadSignalItemText(orgId, row.id, await itemMarkdown(row))
        if (isEmptySignalItem(input)) return { ...base, gated: "no_text" }
        const text = input.messageText
        const envelope = envelopeFromItem(row, text)
        envelope.orgName = batch.orgName
        envelope.counterpartyLine = await counterpartyLineForItem(batch.counterparties, row, envelope)
        const gate = runGates(
          {
            provider: row.provider,
            metadataJson: row.metadataJson,
            threadExternalId: row.threadExternalId,
            externalId: row.externalId,
            orgAttribution: row.orgAttribution,
            subject: envelope.subject ?? null,
            from: envelope.from ?? null,
            fromEmail: senderEmail(row.metadataJson),
            fromName: senderName(row.metadataJson),
            headers: itemHeaders(row.metadataJson),
            text,
            date: itemDate,
          },
          { ctx: ctx.scoring, exclusions: batch.exclusions, blocklist: batch.blocklist },
        )
        if (gate.kind === "skip") return { ...base, gated: gate.reason }
        if (gate.kind === "deterministic") {
          return { ...base, gated: gate.gate, instances: gate.instances, score: gate.score, band: gate.band }
        }
        const extraction = await runExtraction({
          orgId,
          text: input.text,
          envelope,
          variant: run.config.variant,
          promptSet,
          successors: ctx.scoring.successors,
          ref: { evalRunId: run.id, sourceItemId: id },
        })
        const post = postprocessForEval(extraction.output, ctx.scoring, {
          text: input.text,
          ownText: input.ownText,
          date: itemDate,
          orgAttribution: row.orgAttribution,
        })
        return {
          ...base,
          durationMs: extraction.durationMs,
          model: extraction.model,
          taxonomyVersion: extraction.taxonomyVersion,
          score: post.score,
          band: post.band,
          instances: post.instances,
          dropped: post.dropped,
        }
      } catch (error) {
        const message =
          error instanceof AiBudgetExceededError
            ? error.period === "month"
              ? "Месячный лимит ИИ организации исчерпан"
              : "Дневной бюджет ИИ организации исчерпан"
            : error instanceof Error
              ? error.message
              : String(error)
        return {
          ...base,
          ok: false,
          error: message.slice(0, 1000),
          durationMs: Date.now() - started,
          score: null,
          band: null,
        }
      }
    })
    await appendSampleItems(run.id, results)
    ok = results.filter((r) => r.ok).length
    failed = results.length - ok
  }

  const remaining = Math.max(0, pending.length - batchIds.length)
  if (remaining === 0) {
    const report = await getSampleReport(run.id, run)
    await saveEvalRunReport(run.id, { ...report, finishedAt: new Date().toISOString() }, true)
  }
  return {
    processed: batchIds.length,
    ok,
    failed,
    remaining,
    done: remaining === 0,
  }
}

// ── Report ────────────────────────────────────────────────────────────────

export type SampleReport = {
  input: "sample"
  kind: "eval" | "spike"
  runId: string
  orgId: string
  startedAt: string
  lastAt: string
  finishedAt: string | null
  variant: string
  codeSet: string
  /** Identity I4: org profile in the prompt (run config). */
  promptContext: boolean
  models: string[]
  taxonomyVersions: number[]
  planned: number
  remaining: number
  latency: { p50: number | null; p95: number | null; max: number | null; mean: number | null }
  usage: UsageTotals & { costPerItemUsd: number | null; byProcessModel: SpikeUsageRow[] }
  summary: SampleSummary
}

export async function getSampleReport(runId: string, known?: EvalRunRow): Promise<SampleReport> {
  const run = known ?? (await getEvalRunRow(runId))
  if (!run || run.config.input !== "sample") throw new EvalError("Прогон не найден")
  const [items, info, usageRows] = await Promise.all([
    sampleItems(runId),
    loadCodeInfo(run.organizationId),
    spikeUsage(runId),
  ])
  const summary = summarizeSample(items, run.config.reviewCodes, info)
  const durations = items
    .filter((i) => i.ok && i.durationMs > 0)
    .map((i) => i.durationMs)
    .sort((a, b) => a - b)
  const sum = durations.reduce((a, b) => a + b, 0)
  const usage = usageTotals(usageRows)
  const llmItems = items.filter((i) => i.model !== null).length
  const ats = items.map((i) => i.at).sort()
  const planned = run.config.sampleItemIds?.length ?? 0
  return {
    input: "sample",
    kind: run.kind,
    runId,
    orgId: run.organizationId,
    startedAt: run.createdAt.toISOString(),
    lastAt: ats[ats.length - 1] ?? run.createdAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    variant: run.config.variant,
    codeSet: run.config.codeSet,
    promptContext: run.config.promptContext === true,
    models: [...new Set(items.map((i) => i.model).filter((m): m is string => !!m))],
    taxonomyVersions: [
      ...new Set(items.map((i) => i.taxonomyVersion).filter((v): v is number => typeof v === "number")),
    ].sort((a, b) => a - b),
    planned,
    remaining: Math.max(0, planned - items.length),
    latency: {
      p50: percentile(durations, 50),
      p95: percentile(durations, 95),
      max: durations.length ? durations[durations.length - 1] : null,
      mean: durations.length ? Math.round(sum / durations.length) : null,
    },
    usage: { ...usage, costPerItemUsd: llmItems ? usage.costUsd / llmItems : null, byProcessModel: usageRows },
    summary,
  }
}

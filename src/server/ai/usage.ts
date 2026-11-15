import "server-only"

import { randomUUID } from "node:crypto"
import { and, eq, isNull, lt, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { aiGateway, aiUsageEvent } from "@/db/schema"
import { getGatewayAdapter } from "@/server/ai/gateways"
import {
  getModelPrice,
  type ModelPrice,
  type ResolvedProcess,
} from "@/server/ai/registry/assignments"
import type { AiResultInfo } from "@/server/ai/types"
import { getPlatformSetting } from "@/server/platform-settings"
import { noteSpend } from "@/server/ai/budget"

// Usage ledger: recording, cost estimate, exact-cost reconcile
// (docs/specs/models/04-usage-and-cost.md §2–§4). Called only by the
// runtime (src/server/ai/runtime.ts). Recording NEVER throws: a ledger
// problem must not break the business call.

// AI SDK usage object (LanguageModelUsage), read defensively.
export type UsageLike = {
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  cachedInputTokens?: number
  inputTokenDetails?: {
    noCacheTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
  }
  outputTokenDetails?: { reasoningTokens?: number }
}

export type RecordUsageInput = {
  resolved: ResolvedProcess
  orgId: string | null
  userId: string | null
  ref?: Record<string, unknown>
  startedAt: Date
  // blocked = refused before the call (daily budget used up)
  status: "ok" | "error" | "aborted" | "blocked"
  /** status `blocked`: which limit stopped the call (error_type). */
  blockedBy?: "day" | "month"
  error?: unknown
  usage?: UsageLike
  steps?: number
  info?: AiResultInfo | null
  // Model id the call was sent to (may differ from resolved.modelId after
  // a runtime-side fallback).
  requestModel: string
}

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null)

/** Sum the usage of several steps (aborted streams report steps only). */
export function sumUsage(usages: (UsageLike | undefined)[]): UsageLike {
  const out: UsageLike = { inputTokenDetails: {}, outputTokenDetails: {} }
  const add = (a: number | undefined, b: number | undefined) =>
    b == null ? a : (a ?? 0) + b
  for (const u of usages) {
    if (!u) continue
    out.inputTokens = add(out.inputTokens, u.inputTokens)
    out.outputTokens = add(out.outputTokens, u.outputTokens)
    out.reasoningTokens = add(out.reasoningTokens, u.reasoningTokens ?? u.outputTokenDetails?.reasoningTokens)
    out.cachedInputTokens = add(out.cachedInputTokens, u.cachedInputTokens)
    out.inputTokenDetails!.noCacheTokens = add(out.inputTokenDetails!.noCacheTokens, u.inputTokenDetails?.noCacheTokens)
    out.inputTokenDetails!.cacheReadTokens = add(out.inputTokenDetails!.cacheReadTokens, u.inputTokenDetails?.cacheReadTokens)
    out.inputTokenDetails!.cacheWriteTokens = add(out.inputTokenDetails!.cacheWriteTokens, u.inputTokenDetails?.cacheWriteTokens)
  }
  return out
}

type Tokens = {
  input: number | null
  output: number | null
  reasoning: number | null
  cacheRead: number | null
  cacheWrite: number | null
}

function tokensOf(u: UsageLike | undefined): Tokens {
  return {
    input: n(u?.inputTokens),
    output: n(u?.outputTokens),
    reasoning: n(u?.reasoningTokens ?? u?.outputTokenDetails?.reasoningTokens),
    cacheRead: n(u?.inputTokenDetails?.cacheReadTokens ?? u?.cachedInputTokens),
    cacheWrite: n(u?.inputTokenDetails?.cacheWriteTokens),
  }
}

/**
 * Cost estimate from registry prices (04 §3). input_tokens includes cached
 * tokens, so the uncached part is priced at the input rate and the cached
 * parts at their own rates. Tiers / service tiers are ignored (reconcile
 * replaces the estimate with the gateway's exact cost).
 */
export function estimateCostUsd(
  t: Tokens,
  webSearchCount: number | null,
  price: ModelPrice | null,
): number | null {
  if (!price || t.input == null || t.output == null) return null
  if (price.input == null || price.output == null) return null
  const cacheRead = t.cacheRead ?? 0
  const cacheWrite = t.cacheWrite ?? 0
  const uncached = Math.max(0, t.input - cacheRead - cacheWrite)
  return (
    (uncached * price.input +
      t.output * price.output +
      cacheRead * (price.cacheRead ?? price.input) +
      cacheWrite * (price.cacheWrite ?? price.input)) /
      1e6 +
    ((webSearchCount ?? 0) * (price.webSearch ?? 0)) / 1000
  )
}

function errorTypeOf(error: unknown): string | null {
  if (!error) return null
  if (error instanceof Error) {
    const status = (error as { statusCode?: unknown }).statusCode
    return typeof status === "number" ? `${error.name}:${status}` : error.name
  }
  return typeof error
}

export async function recordUsageEvent(input: RecordUsageInput): Promise<void> {
  try {
    const { resolved, info } = input
    const t = tokensOf(input.usage)
    const responseModel = info?.responseModel ?? (input.status === "ok" ? input.requestModel : null)
    const price = responseModel
      ? await getModelPrice(resolved.gateway.id, responseModel)
      : null
    const estimate = estimateCostUsd(t, info?.webSearchCount ?? null, price)
    // Markup in force NOW is stored with the event: a later change of the
    // markup never changes past amounts (05 §3).
    const markup = await getPlatformSetting("ai.markup_percent")
    await db.insert(aiUsageEvent).values({
      id: randomUUID(),
      createdAt: input.startedAt,
      organizationId: input.orgId,
      userId: input.userId,
      processKey: resolved.process.key,
      operationName: "chat",
      gatewayId: resolved.gateway.id,
      providerName: info?.providerName ?? null,
      requestModel: input.requestModel,
      responseModel,
      responseId: info?.responseId ?? null,
      responseIds: info?.responseIds?.length ? info.responseIds : null,
      status: input.status,
      errorType:
        input.status === "error"
          ? errorTypeOf(input.error)
          : input.status === "blocked"
            ? (input.blockedBy === "month" ? "monthly_limit_exceeded" : "budget_exceeded")
            : null,
      inputTokens: t.input,
      outputTokens: t.output,
      reasoningTokens: t.reasoning,
      cacheReadTokens: t.cacheRead,
      cacheWriteTokens: t.cacheWrite,
      webSearchCount: info?.webSearchCount ?? null,
      steps: input.steps ?? null,
      durationMs: Date.now() - input.startedAt.getTime(),
      costEstimateUsd: estimate == null ? null : estimate.toFixed(8),
      costActualUsd: info?.costUsd == null ? null : info.costUsd.toFixed(8),
      markupPercent: markup.toFixed(2),
      ref: input.ref ?? null,
    })
    const cost = info?.costUsd ?? estimate
    if (input.orgId && cost) noteSpend(input.orgId, cost, markup)
  } catch (e) {
    console.error("[ai/usage] failed to record usage event:", e)
  }
}

// ── reconcile (04 §4) ──────────────────────────────────────────────────

const RECONCILE_BATCH = 200
const RECONCILE_MAX_ATTEMPTS = 3
const RECONCILE_MIN_AGE_MS = 2 * 60_000

export type ReconcileResult = { checked: number; updated: number; failed: number }

/**
 * Fill cost_actual_usd for events whose exact cost was not reported inline
 * (e.g. a step without cost metadata), by asking the gateway per generation
 * id. Gateways without lookupCost keep the estimate. Never throws.
 */
export async function reconcileUsageCosts(): Promise<ReconcileResult> {
  const out: ReconcileResult = { checked: 0, updated: 0, failed: 0 }
  try {
    const rows = await db
      .select({
        id: aiUsageEvent.id,
        gatewayId: aiUsageEvent.gatewayId,
        responseIds: aiUsageEvent.responseIds,
        attempts: aiUsageEvent.costReconcileAttempts,
      })
      .from(aiUsageEvent)
      .where(
        and(
          isNull(aiUsageEvent.costActualUsd),
          sql`cardinality(${aiUsageEvent.responseIds}) > 0`,
          lt(aiUsageEvent.costReconcileAttempts, RECONCILE_MAX_ATTEMPTS),
          lt(aiUsageEvent.createdAt, new Date(Date.now() - RECONCILE_MIN_AGE_MS)),
        ),
      )
      .limit(RECONCILE_BATCH)
    const gateways = new Map((await db.select().from(aiGateway)).map((g) => [g.id, g]))

    for (const row of rows) {
      out.checked++
      const gw = gateways.get(row.gatewayId)
      const adapter = gw ? getGatewayAdapter(gw.adapter) : null
      if (!gw || !adapter?.lookupCost) {
        // Nothing can give an exact cost: stop retrying this row.
        await db
          .update(aiUsageEvent)
          .set({ costReconcileAttempts: RECONCILE_MAX_ATTEMPTS })
          .where(eq(aiUsageEvent.id, row.id))
        continue
      }
      try {
        let total = 0
        for (const id of row.responseIds ?? []) {
          const cost = await adapter.lookupCost(id, gw)
          if (cost == null) throw new Error(`no cost for ${id}`)
          total += cost
          await new Promise((r) => setTimeout(r, 50))
        }
        await db
          .update(aiUsageEvent)
          .set({ costActualUsd: total.toFixed(8) })
          .where(eq(aiUsageEvent.id, row.id))
        out.updated++
      } catch (e) {
        out.failed++
        console.warn(`[ai/usage] reconcile ${row.id} failed:`, e instanceof Error ? e.message : e)
        await db
          .update(aiUsageEvent)
          .set({ costReconcileAttempts: row.attempts + 1 })
          .where(eq(aiUsageEvent.id, row.id))
      }
    }
  } catch (e) {
    console.error("[ai/usage] reconcile failed:", e)
  }
  return out
}

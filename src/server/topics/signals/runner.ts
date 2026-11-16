import "server-only"

import { and, asc, eq, gte, isNull, lt, ne, or, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { sourceItem } from "@/db/schema"
import { getOrgBudgetStatus } from "@/server/ai/budget"
import { getOrgSetting } from "@/server/org-settings"
import { ORCHESTRATION_CONFIG } from "@/server/orchestration/config"
import { getTopicsStartedAt } from "@/server/topics/mode"
import { SignalsNotEnabledError } from "@/server/topics/prompt/extraction"
import type { TopicsPhaseContext, TopicsPhaseResult } from "@/server/topics/phases"
import {
  extractSignalsForItem,
  loadSignalBatchContext,
  MAX_SIGNAL_ATTEMPTS,
} from "./extract-item"
import { loadSignalItemRows, mapPool } from "./item-input"

// Phase «signals» of the hourly topics run (spec topics/01 §5, §13; plan
// phase 2 task 7). Per org in `shadow` / `on`:
//   eligible = ROOT items, parse `complete`, created from 7 days before the
//   org's first switch-on (Q16), never scanned OR `deferred` (budget) OR
//   `failed` with attempts left — oldest first (so a thread is read in order
//   for topic resolution), capped per run, concurrency 3.
// Idempotent + resumable: progress is the item's `signal_status`. Junk
// (parse `skipped`) never enters (gate 2). The AI budget is checked once up
// front; when a call hits it mid-run the org stops and the rest waits.

const DAY_MS = 86_400_000

export async function countPendingSignalItems(orgId: string, since: Date): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(sourceItem)
    .where(eligibleWhere(orgId, since, true))
  return r?.n ?? 0
}

/**
 * AI chat notes (docs/specs/ai-chat Q22) get signals in mode `shadow`
 * (users see nothing — the admin reviews them) and in mode `on` only after
 * the platform admin switch «Чат в сигналах» (`topics.chatSignals`).
 */
export async function chatNotesGetSignals(orgId: string, mode: string): Promise<boolean> {
  if (mode === "shadow") return true
  return getOrgSetting(orgId, "topics.chatSignals").catch(() => false)
}

function eligibleWhere(orgId: string, since: Date, includeChat: boolean) {
  return and(
    includeChat ? undefined : ne(sourceItem.externalType, "aichat_session"),
    eq(sourceItem.organizationId, orgId),
    isNull(sourceItem.parentSourceItemId),
    eq(sourceItem.parseStatus, "complete"),
    gte(sql`coalesce(${sourceItem.sourceCreatedAt}, ${sourceItem.createdAt})`, since),
    or(
      isNull(sourceItem.signalStatus),
      eq(sourceItem.signalStatus, "deferred"),
      and(eq(sourceItem.signalStatus, "failed"), lt(sourceItem.signalAttempts, MAX_SIGNAL_ATTEMPTS)),
    ),
  )
}

/** Start of the history window for the org (null = never switched on). */
export async function signalHistoryStart(orgId: string): Promise<Date | null> {
  const startedAt = await getTopicsStartedAt(orgId)
  if (!startedAt) return null
  return new Date(startedAt.getTime() - ORCHESTRATION_CONFIG.topics.startHistoryDays * DAY_MS)
}

export async function runSignalsPhase(ctx: TopicsPhaseContext): Promise<TopicsPhaseResult> {
  const orgId = ctx.organizationId
  const since = await signalHistoryStart(orgId)
  if (!since) return { skipped: "topics never switched on" }

  const budget = await getOrgBudgetStatus(orgId)
  if (budget.exceeded) return { skipped: "AI budget reached for today" }

  let batch
  try {
    batch = await loadSignalBatchContext(orgId)
  } catch (e) {
    if (e instanceof SignalsNotEnabledError) return { skipped: "no active signal codes" }
    throw e
  }

  const ids = await db
    .select({ id: sourceItem.id })
    .from(sourceItem)
    .where(eligibleWhere(orgId, since, await chatNotesGetSignals(orgId, ctx.mode)))
    .orderBy(asc(sql`coalesce(${sourceItem.sourceCreatedAt}, ${sourceItem.createdAt})`), asc(sourceItem.id))
    .limit(ORCHESTRATION_CONFIG.topics.maxItemsPerOrgPerRun)
  if (ids.length === 0) return { eligible: 0 }

  const rows = await loadSignalItemRows(orgId, ids.map((r) => r.id))
  const order = new Map(ids.map((r, i) => [r.id, i]))
  rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))

  const counts = { eligible: rows.length, done: 0, skipped: 0, deferred: 0, failed: 0, notStarted: 0, instances: 0, counted: 0, withScore: 0 }
  let stop = false
  await mapPool(rows, ORCHESTRATION_CONFIG.topics.concurrency, async (row) => {
    if (stop) {
      counts.notStarted++
      return
    }
    try {
      const r = await extractSignalsForItem(batch, row)
      counts[r.status]++
      counts.instances += r.instances
      counts.counted += r.counted
      if ((r.score ?? 0) > 0) counts.withScore++
      if (r.budgetExceeded) stop = true
    } catch (e) {
      // DB failure while storing — the item stays eligible for the next run.
      counts.failed++
      console.error("[topics/signals] item failed", row.id, e)
    }
  })
  return counts
}

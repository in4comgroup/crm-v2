import "server-only"

import { and, asc, eq, gte, isNull, lt, or, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { sourceItem } from "@/db/schema"
import { AiBudgetExceededError, getOrgBudgetStatus } from "@/server/ai/budget"
import { ORCHESTRATION_CONFIG } from "@/server/orchestration/config"
import type { TopicsPhaseContext, TopicsPhaseResult } from "@/server/topics/phases"
import { signalHistoryStart } from "@/server/topics/signals/runner"
import type { CounterpartyIndex } from "./counterparty"
import { createLlmTopicMatcher } from "./matcher"
import type { CodeBook, RelationLookup } from "./model"
import { resolveItem, type ItemResolution, type TopicMatcher } from "./resolver"
import {
  detachSourceItemFromTopics,
  loadCodeBook,
  loadCounterpartyIndex,
  loadItemInput,
  loadRelationLookup,
  loadTopicPool,
  markItemTopicStatus,
  persistItemResolution,
  relinkUnresolvedTopics,
  sweepTopicTimers,
} from "./topic-store"

// Phase «topics» of the hourly run (spec topics/01 §6–§7, §13; plan phase 3).
// Per org in `shadow` / `on`:
//   1. re-link live topics that have no client / contact (discovery may
//      have created them since);
//   2. eligible = root items with `signal_status = done`, never resolved
//      (`topic_status` null) or `deferred` (budget) or `failed` with attempts
//      left, inside the signals history window; OLDEST FIRST and one by one
//      (a reminder must see the topic its request opened), ≤ 200 per run;
//   3. timers sweep (dormant / expired / archived).
// Idempotent + resumable: progress is the item's `topic_status`. A budget
// stop of the matcher leaves the item eligible and stops the org.

export const MAX_TOPIC_ATTEMPTS = 3

function eligibleWhere(orgId: string, since: Date) {
  return and(
    eq(sourceItem.organizationId, orgId),
    isNull(sourceItem.parentSourceItemId),
    eq(sourceItem.signalStatus, "done"),
    gte(sql`coalesce(${sourceItem.sourceCreatedAt}, ${sourceItem.createdAt})`, since),
    or(
      isNull(sourceItem.topicStatus),
      eq(sourceItem.topicStatus, "deferred"),
      and(eq(sourceItem.topicStatus, "failed"), lt(sourceItem.topicAttempts, MAX_TOPIC_ATTEMPTS)),
    ),
  )
}

export async function countPendingTopicItems(orgId: string): Promise<number> {
  const since = await signalHistoryStart(orgId)
  if (!since) return 0
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(sourceItem)
    .where(eligibleWhere(orgId, since))
  return r?.n ?? 0
}

export type TopicBatchContext = {
  orgId: string
  actorUserId: string | null
  book: CodeBook
  idx: CounterpartyIndex
  relationOf: RelationLookup
  matcher: TopicMatcher
  now: Date
}

export async function loadTopicBatchContext(
  orgId: string,
  opts: { actorUserId?: string | null; matcher?: TopicMatcher; now?: Date } = {},
): Promise<TopicBatchContext> {
  const now = opts.now ?? new Date()
  const [book, idx, relationOf] = await Promise.all([
    loadCodeBook(orgId),
    loadCounterpartyIndex(orgId),
    loadRelationLookup(orgId, now),
  ])
  return {
    orgId,
    actorUserId: opts.actorUserId ?? null,
    book,
    idx,
    relationOf,
    matcher: opts.matcher ?? createLlmTopicMatcher(orgId),
    now,
  }
}

export type ResolveItemOutcome = {
  itemId: string
  status: ItemResolution["status"] | "missing"
  created: number
  attached: number
  context: number
  logOnly: number
  matcherCalls: number
  budgetExceeded?: boolean
  error?: string
}

/** Resolve ONE item against the org's topics and store the result. */
export async function resolveAndStoreItem(batch: TopicBatchContext, itemId: string): Promise<ResolveItemOutcome> {
  const base = { itemId, created: 0, attached: 0, context: 0, logOnly: 0, matcherCalls: 0 }
  const loaded = await loadItemInput(batch.orgId, itemId, batch.idx)
  if (!loaded) return { ...base, status: "missing" }
  const pool = await loadTopicPool(batch.orgId, loaded.input, batch.now)
  let res: ItemResolution
  try {
    res = await resolveItem(pool, loaded.input, {
      book: batch.book,
      relationOf: batch.relationOf,
      matcher: batch.matcher,
      now: batch.now,
    })
  } catch (e) {
    if (e instanceof AiBudgetExceededError) {
      await markItemTopicStatus(batch.orgId, itemId, "deferred", "budget")
      return { ...base, status: "deferred", budgetExceeded: true }
    }
    const msg = e instanceof Error ? e.message : String(e)
    await markItemTopicStatus(batch.orgId, itemId, "failed", msg)
    return { ...base, status: "failed", error: msg }
  }
  await persistItemResolution({ orgId: batch.orgId, actorUserId: batch.actorUserId, item: loaded.input, pool, res })
  let created = 0
  let attached = 0
  let context = 0
  let logOnly = 0
  for (const o of res.outcomes) {
    if (o.kind === "log_only") logOnly++
    else if (o.kind === "attach") {
      if (o.created) created++
      else if (o.role === "context") context++
      else attached++
    }
  }
  return { ...base, status: res.status, created, attached, context, logOnly, matcherCalls: res.matcherCalls }
}

export async function runTopicsPhase(ctx: TopicsPhaseContext): Promise<TopicsPhaseResult> {
  const orgId = ctx.organizationId
  const since = await signalHistoryStart(orgId)
  if (!since) return { skipped: "topics never switched on" }

  const batch = await loadTopicBatchContext(orgId, { actorUserId: ctx.actorUserId })
  const counts = {
    relinked: 0,
    eligible: 0,
    done: 0,
    logOnly: 0,
    ignored: 0,
    deferred: 0,
    failed: 0,
    notStarted: 0,
    topicsCreated: 0,
    attached: 0,
    context: 0,
    matcherCalls: 0,
    timers: 0,
  }
  counts.relinked = await relinkUnresolvedTopics(orgId, batch.idx, ctx.actorUserId)

  const budget = await getOrgBudgetStatus(orgId)
  const ids = await db
    .select({ id: sourceItem.id })
    .from(sourceItem)
    .where(eligibleWhere(orgId, since))
    .orderBy(asc(sql`coalesce(${sourceItem.sourceCreatedAt}, ${sourceItem.createdAt})`), asc(sourceItem.id))
    .limit(ORCHESTRATION_CONFIG.topics.maxItemsPerOrgPerRun)
  counts.eligible = ids.length

  // Budget already used up: the deterministic steps still run (spec §13);
  // items wait — the matcher would be refused anyway.
  let stop = budget.exceeded
  for (const { id } of ids) {
    if (stop) {
      counts.notStarted++
      continue
    }
    try {
      const r = await resolveAndStoreItem(batch, id)
      if (r.status === "done") counts.done++
      else if (r.status === "log_only") counts.logOnly++
      else if (r.status === "ignored") counts.ignored++
      else if (r.status === "deferred") counts.deferred++
      else if (r.status === "failed") counts.failed++
      counts.topicsCreated += r.created
      counts.attached += r.attached
      counts.context += r.context
      counts.matcherCalls += r.matcherCalls
      if (r.budgetExceeded) stop = true
    } catch (e) {
      // DB failure while storing — the item stays eligible for the next run.
      counts.failed++
      console.error("[topics/resolve] item failed", id, e)
    }
  }

  counts.timers = await sweepTopicTimers(orgId, new Date(), ctx.actorUserId)
  return counts
}

/**
 * Manual action on one item ("Обработать": parse → upload → signals →
 * topics). Runs regardless of the org's mode; the item must have
 * `signal_status = done`. Detaches the item first, so a re-run replaces its
 * earlier result. The caller checks access.
 */
export async function runTopicResolutionForItem(
  orgId: string,
  itemId: string,
  opts: { actorUserId?: string | null; matcher?: TopicMatcher } = {},
): Promise<ResolveItemOutcome> {
  // Re-running replaces the item's earlier result (idempotent).
  await detachSourceItemFromTopics(orgId, itemId, { actorUserId: opts.actorUserId ?? null, reason: "rerun" })
  const batch = await loadTopicBatchContext(orgId, opts)
  return resolveAndStoreItem(batch, itemId)
}

import "server-only"

import { and, eq, inArray, ne, or } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { sourceItem, topic, topicEvent, topicItem } from "@/db/schema"
import type { TopicEventDraft } from "./model"
import type { TopicTeardownLink, TopicTeardownPlan } from "./teardown-plan"
import { recomputeTopic } from "./lifecycle"
import {
  eventRows,
  hydrateTopics,
  loadCodeBook,
  loadRelationLookup,
  topicUpsertOp,
} from "./topic-store"

// Integration of the topic engine with the rest of the CRM (plan phase 3
// task 7): source teardown and client / contact status changes. Reparse uses
// `detachSourceItemFromTopics` (topic-store.ts) directly.
// Org-explicit, session-free, `server-only` (root AGENTS.md rule 5): the
// caller checks access.

type BatchOps = Parameters<typeof db.batch>[0]
const asBatch = (ops: unknown[]) => ops as unknown as BatchOps

const CHUNK = 500

function chunks<T>(list: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

// ── Client / contact soft delete or block ─────────────────────────────────

/**
 * A client / contact became `deleted` or `blocked`: its topics lose the link
 * (client_id / contact_id → null, journal `relinked`). Hard deletes do the
 * same through the FK (`on delete set null`), without a journal entry.
 *
 * Why: the counterparty index skips deleted / blocked rows, so new items of
 * that counterparty resolve to «unresolved»; an unresolved topic is matched
 * by its raw counterparty key, so the new items still find the old topic
 * instead of opening a duplicate. When the row comes back (restore, or
 * discovery revives it), the re-link step of the hourly run links live
 * unresolved topics again. Topic status is not changed (no auto-dismiss).
 * Returns the number of changed topics. Never throws for an empty input.
 */
export async function unlinkTopicsFromEntities(
  orgId: string,
  ids: { clientIds?: string[]; contactIds?: string[] },
  opts: { reason: string; actorUserId?: string | null },
): Promise<number> {
  const clientIds = [...new Set(ids.clientIds ?? [])].filter(Boolean)
  const contactIds = [...new Set(ids.contactIds ?? [])].filter(Boolean)
  if (clientIds.length === 0 && contactIds.length === 0) return 0
  const rows = await db
    .select({ id: topic.id, clientId: topic.clientId, contactId: topic.contactId })
    .from(topic)
    .where(
      and(
        eq(topic.organizationId, orgId),
        or(
          ...(clientIds.length ? [inArray(topic.clientId, clientIds)] : []),
          ...(contactIds.length ? [inArray(topic.contactId, contactIds)] : []),
        ),
      ),
    )
  if (rows.length === 0) return 0
  const clientSet = new Set(clientIds)
  const contactSet = new Set(contactIds)
  const events: TopicEventDraft[] = rows.map((r) => {
    const dropClient = !!r.clientId && clientSet.has(r.clientId)
    const dropContact = !!r.contactId && contactSet.has(r.contactId)
    return {
      topicId: r.id,
      type: "relinked",
      sourceItemId: null,
      payload: {
        clientId: dropClient ? null : r.clientId,
        contactId: dropContact ? null : r.contactId,
        removedClientId: dropClient ? r.clientId : null,
        removedContactId: dropContact ? r.contactId : null,
        reason: opts.reason,
      },
    }
  })
  const now = new Date()
  const ops: unknown[] = []
  if (clientIds.length) {
    ops.push(
      db
        .update(topic)
        .set({ clientId: null, updatedAt: now })
        .where(and(eq(topic.organizationId, orgId), inArray(topic.clientId, clientIds))),
    )
  }
  if (contactIds.length) {
    ops.push(
      db
        .update(topic)
        .set({ contactId: null, updatedAt: now })
        .where(and(eq(topic.organizationId, orgId), inArray(topic.contactId, contactIds))),
    )
  }
  ops.push(db.insert(topicEvent).values(eventRows(orgId, events, { actor: "agent", userId: opts.actorUserId ?? null })))
  await db.batch(asBatch(ops))
  return rows.length
}

/**
 * Hook for the client / contact status writers: unlink only when the new
 * status hides the row from the engine. Never throws (the status change
 * itself must not fail because of topics); errors are logged.
 */
export async function onEntityStatusChanged(
  orgId: string,
  entity: { clientIds?: string[]; contactIds?: string[] },
  status: string | undefined,
  actorUserId?: string | null,
): Promise<void> {
  if (status !== "deleted" && status !== "blocked") return
  try {
    await unlinkTopicsFromEntities(orgId, entity, { reason: status, actorUserId })
  } catch (e) {
    console.error("[topics/integration] unlink after status change failed", e)
  }
}

// ── Source teardown ───────────────────────────────────────────────────────

export { planTopicTeardown, type TopicTeardownLink, type TopicTeardownPlan } from "./teardown-plan"

/**
 * Every link of every topic that has at least one item of `sourceId`
 * (links of other sources included — they decide delete vs change).
 * One query (subquery), no id lists.
 */
export async function loadTopicLinksForSource(orgId: string, sourceId: string): Promise<TopicTeardownLink[]> {
  const touched = db
    .selectDistinct({ id: topicItem.topicId })
    .from(topicItem)
    .innerJoin(sourceItem, eq(sourceItem.id, topicItem.sourceItemId))
    .where(and(eq(topicItem.organizationId, orgId), eq(sourceItem.sourceId, sourceId)))
  return db
    .select({
      topicId: topicItem.topicId,
      title: topic.title,
      status: topic.status,
      sourceItemId: topicItem.sourceItemId,
      sourceId: sourceItem.sourceId,
      role: topicItem.role,
    })
    .from(topicItem)
    .innerJoin(topic, eq(topic.id, topicItem.topicId))
    .innerJoin(sourceItem, eq(sourceItem.id, topicItem.sourceItemId))
    .where(and(eq(topicItem.organizationId, orgId), inArray(topicItem.topicId, touched)))
}

/**
 * Step 1 of a teardown (BEFORE the source items are deleted): delete the
 * planned topics (links + events cascade; signal_instance.topic_id and
 * related / merged_into refs → null), also `merged` topics that pointed into
 * them (empty tombstones), and reset the topic progress of their kept
 * context items. Returns the number of deleted topics.
 */
export async function deleteTopicsForTeardown(orgId: string, plan: TopicTeardownPlan): Promise<number> {
  let deleted = 0
  for (const ids of chunks(plan.deleteTopicIds)) {
    const gone = await db.batch(
      asBatch([
        db
          .delete(topic)
          .where(
            and(
              eq(topic.organizationId, orgId),
              eq(topic.status, "merged"),
              inArray(topic.mergedIntoTopicId, ids),
            ),
          )
          .returning({ id: topic.id }),
        db
          .delete(topic)
          .where(and(eq(topic.organizationId, orgId), inArray(topic.id, ids)))
          .returning({ id: topic.id }),
      ]),
    )
    for (const r of gone as unknown as { id: string }[][]) deleted += r.length
  }
  for (const ids of chunks(plan.resetItemIds)) {
    await db
      .update(sourceItem)
      .set({ topicStatus: null, topicReason: null, topicScannedAt: null, topicAttempts: 0 })
      .where(and(eq(sourceItem.organizationId, orgId), inArray(sourceItem.id, ids)))
  }
  return deleted
}

/**
 * Step 2 of a teardown (AFTER the source items are deleted — their links and
 * signal instances are gone by cascade): recompute the changed topics
 * (score, band, lead, dates, status) and journal `item_detached`. A topic
 * that is left with only context items (should not happen with the plan) is
 * deleted. Bulk: loads and writes in chunks. Returns { changed, deleted }.
 */
export async function recomputeTopicsAfterTeardown(
  orgId: string,
  plan: TopicTeardownPlan,
  removedByTopic: ReadonlyMap<string, string[]>,
  actorUserId: string | null,
): Promise<{ changed: number; deleted: number }> {
  if (plan.changeTopicIds.length === 0) return { changed: 0, deleted: 0 }
  const now = new Date()
  const [book, relationOf] = await Promise.all([loadCodeBook(orgId), loadRelationLookup(orgId, now)])
  let changed = 0
  let deleted = 0
  for (const ids of chunks(plan.changeTopicIds, 200)) {
    const rows = await db
      .select()
      .from(topic)
      .where(and(eq(topic.organizationId, orgId), inArray(topic.id, ids), ne(topic.status, "merged")))
    const snaps = await hydrateTopics(rows)
    const ops: unknown[] = []
    const events: TopicEventDraft[] = []
    const emptyIds: string[] = []
    for (const t of snaps) {
      if (t.items.every((l) => l.role === "context")) {
        emptyIds.push(t.id)
        continue
      }
      events.push(...recomputeTopic(t, book, now, relationOf))
      events.push({
        topicId: t.id,
        type: "item_detached",
        sourceItemId: null,
        payload: { sourceItemIds: removedByTopic.get(t.id) ?? [], reason: "teardown" },
      })
      ops.push(topicUpsertOp(orgId, t))
      changed++
    }
    if (events.length) {
      ops.push(db.insert(topicEvent).values(eventRows(orgId, events, { actor: "agent", userId: actorUserId })))
    }
    if (ops.length) await db.batch(asBatch(ops))
    if (emptyIds.length) {
      deleted += await deleteTopicsForTeardown(orgId, {
        deleteTopicIds: emptyIds,
        changeTopicIds: [],
        resetItemIds: snaps
          .filter((t) => emptyIds.includes(t.id))
          .flatMap((t) => t.items.map((l) => l.itemId)),
      })
    }
  }
  return { changed, deleted }
}

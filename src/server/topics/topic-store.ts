import "server-only"

import { randomUUID } from "node:crypto"
import { and, asc, desc, eq, gte, inArray, isNull, ne, notInArray, or, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import {
  client,
  contact,
  deal,
  dealFunnelStage,
  order,
  signalInstance,
  sourceItem,
  sourceItemSubject,
  topic,
  topicEvent,
  topicItem,
} from "@/db/schema"
import type { SignalDirection, SignalFacts, SignalItemFacts } from "@/lib/signals/extraction-types"
import { buildTopicTitle, normaliseReferences } from "@/lib/topics/references"
import {
  TOPIC_LIVE_STATUSES,
  isTopicStatus,
  type ClientRelation,
  type TopicActor,
  type TopicItemRole,
  type TopicItemStatus,
  type TopicReference,
  type TopicStatus,
  type TopicSubState,
} from "@/lib/topics/types"
import type { SignalClass } from "@/lib/signals/types"
import { getEffectiveSignals, getRegistry } from "@/server/signals/registry"
import {
  buildCounterpartyIndex,
  counterpartyKey,
  resolveCounterparty,
  type CounterpartyIndex,
  type ItemPeer,
} from "./counterparty"
import { deriveClientRelation, recomputeTopic, timerTransition } from "./lifecycle"
import {
  buildCodeBook,
  type CodeBook,
  type ItemInput,
  type ItemInstance,
  type RelationLookup,
  type ResolvedSubject,
  type TopicEventDraft,
  type TopicInstance,
  type TopicItemLink,
  type TopicSnapshot,
} from "./model"
import { daysAgo, POOL_LOOKBACK_DAYS, type ItemResolution } from "./resolver"

// DB side of the topic engine (spec topics/01 §6–§7; plan phase 3). Loads
// the in-memory shapes of model.ts, writes back what the pure resolver /
// lifecycle decided, and holds the user / admin actions (no UI yet).
// Org-explicit, session-free, `server-only` (root AGENTS.md rule 5): the
// caller (route, phase, integration) checks access.
//
// Writes are one `db.batch` per change set (neon-http has no interactive
// transactions; a batch is one transaction).

type BatchOps = Parameters<typeof db.batch>[0]
const LIVE: TopicStatus[] = [...TOPIC_LIVE_STATUSES]

function asBatch(ops: unknown[]): BatchOps {
  return ops as unknown as BatchOps
}

// ── Context loaders (once per run) ────────────────────────────────────────

export async function loadCodeBook(orgId: string): Promise<CodeBook> {
  const [registry, effective] = await Promise.all([getRegistry(), getEffectiveSignals(orgId)])
  return buildCodeBook(registry.categories, effective)
}

/** Clients (not deleted / blocked) and contacts of the org, indexed for matching. */
export async function loadCounterpartyIndex(orgId: string): Promise<CounterpartyIndex> {
  const [clients, contacts] = await Promise.all([
    db
      .select({ id: client.id, name: client.name, aliases: client.aliases, webUrl: client.webUrl, email: client.email })
      .from(client)
      .where(and(eq(client.organizationId, orgId), notInArray(client.status, ["deleted", "blocked"]))),
    db
      .select({
        id: contact.id,
        name: contact.name,
        nameNative: contact.nameNative,
        aliases: contact.aliases,
        email: contact.email,
        clientId: contact.clientId,
      })
      .from(contact)
      .where(and(eq(contact.organizationId, orgId), notInArray(contact.status, ["deleted", "blocked"]))),
  ])
  return buildCounterpartyIndex(clients, contacts)
}

/**
 * Client relation lookup for `class_by_relation` codes (06 §4.6), derived
 * from confirmed / finalized orders, the companies-tab tag
 * (`custom_fields.companyKind`) and won deals («Клиенты» tab = an active
 * deal on a stage with closure probability 1). Loaded once per run.
 */
export async function loadRelationLookup(orgId: string, now: Date): Promise<RelationLookup> {
  const [orders, clients, won] = await Promise.all([
    db
      .select({ clientId: order.clientId, at: order.orderDate })
      .from(order)
      .where(and(eq(order.organizationId, orgId), inArray(order.status, ["confirmed", "finalized"]))),
    db
      .select({ id: client.id, kind: sql<string | null>`${client.customFields} ->> 'companyKind'` })
      .from(client)
      .where(eq(client.organizationId, orgId)),
    db
      .selectDistinct({ clientId: deal.clientId })
      .from(deal)
      .innerJoin(dealFunnelStage, eq(dealFunnelStage.id, deal.funnelStageId))
      .where(
        and(eq(deal.organizationId, orgId), eq(deal.status, "active"), sql`${dealFunnelStage.closureProbability} >= 1`),
      ),
  ])
  const byClient = new Map<string, Date[]>()
  for (const o of orders) {
    const list = byClient.get(o.clientId) ?? []
    list.push(o.at)
    byClient.set(o.clientId, list)
  }
  const kinds = new Map(clients.map((c) => [c.id, c.kind]))
  const wonSet = new Set(won.map((w) => w.clientId))
  const cache = new Map<string, ClientRelation>()
  return (clientId) => {
    if (!clientId) return "unknown"
    const hit = cache.get(clientId)
    if (hit) return hit
    const rel = deriveClientRelation(
      { orderDates: byClient.get(clientId) ?? [], companyKind: kinds.get(clientId) ?? null, hasWonDeal: wonSet.has(clientId) },
      now,
    )
    cache.set(clientId, rel)
    return rel
  }
}

// ── Item input ────────────────────────────────────────────────────────────

type Addr = { name?: string | null; email?: string | null }

function firstAddr(v: unknown): Addr | null {
  if (Array.isArray(v) && v.length > 0) {
    const a = v[0] as Addr | string
    return typeof a === "string" ? { email: a } : a
  }
  return typeof v === "string" ? { email: v } : null
}

/** The other side of the item: sender of an inbound item, first recipient of ours. */
export function itemPeer(metadataJson: unknown, direction: SignalDirection): ItemPeer | null {
  const m = (metadataJson ?? {}) as Record<string, unknown>
  const tg = (m.telegram ?? null) as { from?: { firstName?: string; lastName?: string; username?: string } } | null
  if (tg?.from && direction !== "outbound") {
    const name = [tg.from.firstName, tg.from.lastName].filter(Boolean).join(" ") || null
    return { email: null, name, handle: tg.from.username ?? null }
  }
  const a = firstAddr(direction === "outbound" ? m.to : m.from)
  if (!a) return null
  const email = typeof a.email === "string" ? (a.email.match(/[^\s<>"]+@[^\s<>"]+/)?.[0] ?? null) : null
  return { email: email?.toLowerCase() ?? null, name: a.name ?? null, handle: null }
}

function factsOf(raw: unknown): { facts: SignalFacts | null; direction: SignalDirection } {
  const f = (raw ?? null) as Partial<SignalItemFacts> | null
  const direction = f?.direction === "outbound" || f?.direction === "internal" ? f.direction : "inbound"
  return { facts: (f?.facts as SignalFacts | undefined) ?? null, direction }
}

export type LoadedItem = { input: ItemInput; peer: ItemPeer | null; via: Record<number, string[]> }

/** Item input for the resolver, with counterparties resolved (null = not in the org). */
export async function loadItemInput(
  orgId: string,
  itemId: string,
  idx: CounterpartyIndex,
): Promise<LoadedItem | null> {
  const [row] = await db
    .select({
      id: sourceItem.id,
      sourceCreatedAt: sourceItem.sourceCreatedAt,
      createdAt: sourceItem.createdAt,
      threadKey: sourceItem.threadKey,
      metadataJson: sourceItem.metadataJson,
      signalFacts: sourceItem.signalFacts,
      taxonomyVersion: sourceItem.signalTaxonomyVersion,
    })
    .from(sourceItem)
    .where(and(eq(sourceItem.organizationId, orgId), eq(sourceItem.id, itemId)))
  if (!row) return null
  const [subjects, instances] = await Promise.all([
    db
      .select()
      .from(sourceItemSubject)
      .where(eq(sourceItemSubject.sourceItemId, itemId))
      .orderBy(asc(sourceItemSubject.subjectIndex)),
    db
      .select({
        id: signalInstance.id,
        code: signalInstance.code,
        confidence: signalInstance.confidence,
        counted: signalInstance.counted,
        scoreContrib: signalInstance.scoreContrib,
        subjectIndex: signalInstance.subjectIndex,
        evidence: signalInstance.evidence,
      })
      .from(signalInstance)
      .where(eq(signalInstance.sourceItemId, itemId)),
  ])
  const { facts, direction } = factsOf(row.signalFacts)
  const peer = itemPeer(row.metadataJson, direction)
  const via: Record<number, string[]> = {}
  const resolveSubject = (index: number, raw: string, matter: string, refs: { kind: string; value: string }[], products: string[]): ResolvedSubject => {
    const r = resolveCounterparty(raw, peer, idx)
    via[index] = r.via
    return {
      index,
      counterparty: raw,
      counterpartyKey: r.key,
      matter,
      references: normaliseReferences(refs),
      products,
      clientId: r.clientId,
      contactId: r.contactId,
      companyName: r.companyName,
      contactName: r.contactName,
    }
  }
  const resolved: ResolvedSubject[] = subjects.map((s) =>
    resolveSubject(s.subjectIndex, s.counterparty, s.matter, s.references, s.products),
  )
  // Gate items (bounce, out-of-office …) have instances but no subjects: one
  // synthetic subject for the whole item, counterparty = the peer.
  if (resolved.length === 0 && instances.length > 0) {
    resolved.push(resolveSubject(-1, peer?.name ?? peer?.email ?? "", "", [], []))
  }
  return {
    input: {
      itemId: row.id,
      date: row.sourceCreatedAt ?? row.createdAt,
      threadKey: row.threadKey,
      direction,
      subjects: resolved,
      instances: instances.map(
        (i): ItemInstance => ({
          ...i,
          confidence: (i.confidence === "high" || i.confidence === "low" ? i.confidence : "medium") as ItemInstance["confidence"],
        }),
      ),
      amounts: (facts?.amounts ?? []).map((a) => ({ value: a.value, subjectIndex: a.subjectIndex })),
      deadlines: (facts?.deadlines ?? []).map((d) => ({ date: d.date, subjectIndex: d.subjectIndex })),
      taxonomyVersion: row.taxonomyVersion,
    },
    peer,
    via,
  }
}

// ── Topic snapshots ───────────────────────────────────────────────────────

type TopicRow = typeof topic.$inferSelect

function rowToSnapshot(r: TopicRow): TopicSnapshot {
  return {
    id: r.id,
    status: isTopicStatus(r.status) ? r.status : "open",
    subState: (r.subState as TopicSubState) ?? "none",
    clientId: r.clientId,
    contactId: r.contactId,
    counterpartyRaw: r.counterpartyRaw,
    counterpartyKey: counterpartyKey(r.counterpartyRaw),
    dealId: r.dealId,
    title: r.title,
    matter: r.matter,
    family: r.family,
    leadCode: r.leadCode,
    class: (r.class as SignalClass | null) ?? null,
    score: r.score,
    band: r.band,
    references: r.references as TopicReference[],
    products: r.products,
    firstSeenAt: r.firstSeenAt,
    lastActivityAt: r.lastActivityAt,
    closedAt: r.closedAt,
    closedReason: r.closedReason,
    relatedTopicId: r.relatedTopicId,
    mergedIntoTopicId: r.mergedIntoTopicId,
    taxonomyVersion: r.taxonomyVersion,
    instances: [],
    items: [],
  }
}

/** Full snapshots (items + instances) of the given topic rows. */
export async function hydrateTopics(rows: TopicRow[]): Promise<TopicSnapshot[]> {
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)
  const [links, instances] = await Promise.all([
    db
      .select({
        topicId: topicItem.topicId,
        itemId: topicItem.sourceItemId,
        subjectIndex: topicItem.subjectIndex,
        role: topicItem.role,
        date: sql<Date>`coalesce(${sourceItem.sourceCreatedAt}, ${sourceItem.createdAt})`.mapWith(sourceItem.createdAt),
        threadKey: sourceItem.threadKey,
        signalFacts: sourceItem.signalFacts,
        references: sourceItemSubject.references,
        products: sourceItemSubject.products,
      })
      .from(topicItem)
      .innerJoin(sourceItem, eq(sourceItem.id, topicItem.sourceItemId))
      .leftJoin(
        sourceItemSubject,
        and(
          eq(sourceItemSubject.sourceItemId, topicItem.sourceItemId),
          eq(sourceItemSubject.subjectIndex, topicItem.subjectIndex),
        ),
      )
      .where(inArray(topicItem.topicId, ids)),
    db
      .select({
        id: signalInstance.id,
        topicId: signalInstance.topicId,
        code: signalInstance.code,
        itemId: signalInstance.sourceItemId,
        confidence: signalInstance.confidence,
        counted: signalInstance.counted,
        scoreContrib: signalInstance.scoreContrib,
        subjectIndex: signalInstance.subjectIndex,
        evidence: signalInstance.evidence,
        createdAt: signalInstance.createdAt,
        itemDate: sql<Date | null>`coalesce(${sourceItem.sourceCreatedAt}, ${sourceItem.createdAt})`.mapWith(sourceItem.createdAt),
        signalFacts: sourceItem.signalFacts,
      })
      .from(signalInstance)
      .leftJoin(sourceItem, eq(sourceItem.id, signalInstance.sourceItemId))
      .where(inArray(signalInstance.topicId, ids)),
  ])
  const byId = new Map(rows.map((r) => [r.id, rowToSnapshot(r)]))
  for (const l of links) {
    const t = byId.get(l.topicId)
    if (!t) continue
    const { facts, direction } = factsOf(l.signalFacts)
    const forSubject = (i: number) => i === l.subjectIndex || i === -1 || l.subjectIndex === -1
    t.items.push({
      itemId: l.itemId,
      subjectIndex: l.subjectIndex,
      role: l.role as TopicItemRole,
      date: l.date,
      direction,
      threadKey: l.threadKey,
      references: normaliseReferences(l.references ?? []),
      products: l.products ?? [],
      amounts: (facts?.amounts ?? []).filter((a) => forSubject(a.subjectIndex)).map((a) => a.value),
    })
  }
  for (const i of instances) {
    const t = i.topicId ? byId.get(i.topicId) : null
    if (!t) continue
    const { facts } = factsOf(i.signalFacts)
    t.instances.push({
      id: i.id,
      code: i.code,
      itemId: i.itemId,
      itemDate: i.itemDate ?? i.createdAt,
      confidence: (i.confidence === "high" || i.confidence === "low" ? i.confidence : "medium") as TopicInstance["confidence"],
      counted: i.counted,
      scoreContrib: i.scoreContrib,
      deadlines: (facts?.deadlines ?? [])
        .filter((d) => d.subjectIndex === i.subjectIndex || d.subjectIndex === -1 || i.subjectIndex === -1)
        .map((d) => d.date),
      evidence: i.evidence,
    })
  }
  return rows.map((r) => byId.get(r.id)!)
}

/**
 * Pool of topics the resolver may match one item against: topics of the
 * item's counterparties (live, or active in the last 180 days — for the
 * reopen window and `related_topic_id`), unresolved topics (no client, no
 * contact; matched by raw key in memory) and live topics on the item's thread.
 */
export async function loadTopicPool(orgId: string, item: ItemInput, now: Date): Promise<TopicSnapshot[]> {
  const clientIds = [...new Set(item.subjects.map((s) => s.clientId).filter((x): x is string => !!x))]
  const contactIds = [...new Set(item.subjects.map((s) => s.contactId).filter((x): x is string => !!x))]
  const since = daysAgo(now, POOL_LOOKBACK_DAYS)
  const who = [
    and(isNull(topic.clientId), isNull(topic.contactId)),
    ...(clientIds.length ? [inArray(topic.clientId, clientIds)] : []),
    ...(contactIds.length ? [inArray(topic.contactId, contactIds)] : []),
  ]
  if (item.threadKey) {
    who.push(
      inArray(
        topic.id,
        db
          .select({ id: topicItem.topicId })
          .from(topicItem)
          .innerJoin(sourceItem, eq(sourceItem.id, topicItem.sourceItemId))
          .where(and(eq(topicItem.organizationId, orgId), eq(sourceItem.threadKey, item.threadKey))),
      ),
    )
  }
  const rows = await db
    .select()
    .from(topic)
    .where(
      and(
        eq(topic.organizationId, orgId),
        ne(topic.status, "merged"),
        or(inArray(topic.status, LIVE), gte(topic.lastActivityAt, since)),
        or(...who),
      ),
    )
    .orderBy(desc(topic.lastActivityAt))
    .limit(300)
  return hydrateTopics(rows)
}

export async function loadTopicSnapshot(orgId: string, topicId: string): Promise<TopicSnapshot | null> {
  const rows = await db
    .select()
    .from(topic)
    .where(and(eq(topic.organizationId, orgId), eq(topic.id, topicId)))
  const [t] = await hydrateTopics(rows)
  return t ?? null
}

// ── Writes ────────────────────────────────────────────────────────────────

function topicValues(t: TopicSnapshot) {
  return {
    clientId: t.clientId,
    contactId: t.contactId,
    counterpartyRaw: t.counterpartyRaw,
    dealId: t.dealId,
    title: t.title,
    matter: t.matter,
    family: t.family,
    status: t.status,
    subState: t.subState,
    leadCode: t.leadCode,
    class: t.class,
    score: t.score,
    band: t.band,
    references: t.references,
    products: t.products,
    firstSeenAt: t.firstSeenAt,
    lastActivityAt: t.lastActivityAt,
    closedAt: t.closedAt,
    closedReason: t.closedReason,
    relatedTopicId: t.relatedTopicId,
    mergedIntoTopicId: t.mergedIntoTopicId,
    taxonomyVersion: t.taxonomyVersion,
  }
}

/**
 * Insert (new) or update one topic row from its snapshot (exported for integrations).
 * Every write marks the topic due for the attention engine (phase 4, 06 §10):
 * `next_attention_check_at` = now → the «attention» phase recomputes it.
 */
export function topicUpsertOp(orgId: string, t: TopicSnapshot) {
  const due = { nextAttentionCheckAt: new Date() }
  if (t.isNew) return db.insert(topic).values({ id: t.id, organizationId: orgId, ...topicValues(t), ...due })
  return db
    .update(topic)
    .set({ ...topicValues(t), ...due, updatedAt: new Date() })
    .where(and(eq(topic.organizationId, orgId), eq(topic.id, t.id)))
}

/** topic_event rows for drafts (exported for integrations). */
export function eventRows(
  orgId: string,
  events: readonly TopicEventDraft[],
  actor: { actor: TopicActor; userId: string | null },
) {
  return events.map((e) => ({
    id: randomUUID(),
    organizationId: orgId,
    topicId: e.topicId,
    type: e.type,
    actor: actor.actor,
    userId: actor.userId,
    sourceItemId: e.sourceItemId,
    payload: e.payload,
  }))
}

/**
 * Write the resolution of one item: new / changed topics, the item's links,
 * signal_instance.topic_id, the subjects' resolved client / contact, the
 * journal, and the item's topic_status. One batch (one transaction).
 */
export async function persistItemResolution(args: {
  orgId: string
  actorUserId: string | null
  item: ItemInput
  pool: TopicSnapshot[]
  res: ItemResolution
}): Promise<void> {
  const { orgId, item, pool, res } = args
  const touched = pool.filter((t) => res.touched.has(t.id))
  // New topics first (FK of links / instances / events), then updates.
  const ops: unknown[] = [
    ...touched.filter((t) => t.isNew).map((t) => topicUpsertOp(orgId, t)),
    ...touched.filter((t) => !t.isNew).map((t) => topicUpsertOp(orgId, t)),
  ]
  const links = touched.flatMap((t) =>
    t.items
      .filter((l) => l.itemId === item.itemId)
      .map((l) => ({
        id: randomUUID(),
        organizationId: orgId,
        topicId: t.id,
        sourceItemId: item.itemId,
        subjectIndex: l.subjectIndex,
        role: l.role,
      })),
  )
  if (links.length) ops.push(db.insert(topicItem).values(links).onConflictDoNothing())
  const byTopic = new Map<string, string[]>()
  for (const [instId, topicId] of res.instanceTopic) {
    const list = byTopic.get(topicId) ?? []
    list.push(instId)
    byTopic.set(topicId, list)
  }
  for (const [topicId, ids] of byTopic) {
    ops.push(
      db
        .update(signalInstance)
        .set({ topicId })
        .where(and(eq(signalInstance.organizationId, orgId), inArray(signalInstance.id, ids))),
    )
  }
  for (const s of item.subjects) {
    if (s.index < 0) continue
    ops.push(
      db
        .update(sourceItemSubject)
        .set({ clientId: s.clientId, contactId: s.contactId })
        .where(and(eq(sourceItemSubject.sourceItemId, item.itemId), eq(sourceItemSubject.subjectIndex, s.index))),
    )
  }
  const events = eventRows(orgId, res.events, { actor: "agent", userId: args.actorUserId })
  if (events.length) ops.push(db.insert(topicEvent).values(events))
  // Phase 5a (R16): a new item on a topic of a deal (any role, incl. context)
  // = new deal information → the deal state text is due after the debounce.
  const dealIds = [...new Set(touched.map((t) => t.dealId).filter((x): x is string => !!x))]
  if (dealIds.length) {
    ops.push(
      db
        .update(deal)
        .set({ stateDirtyAt: new Date(), updatedAt: sql`${deal.updatedAt}` })
        .where(and(eq(deal.organizationId, orgId), inArray(deal.id, dealIds))),
    )
  }
  ops.push(itemStatusOp(orgId, item.itemId, res.status, res.reason))
  await db.batch(asBatch(ops))
  for (const t of touched) {
    t.isNew = false
    t.dirty = false
  }
}

function itemStatusOp(orgId: string, itemId: string, status: TopicItemStatus, reason: string | null) {
  return db
    .update(sourceItem)
    .set({
      topicStatus: status,
      topicReason: reason?.slice(0, 1000) ?? null,
      topicScannedAt: new Date(),
      ...(status === "failed" ? { topicAttempts: sql`${sourceItem.topicAttempts} + 1` } : { topicAttempts: 0 }),
    })
    .where(and(eq(sourceItem.organizationId, orgId), eq(sourceItem.id, itemId)))
}

export async function markItemTopicStatus(
  orgId: string,
  itemId: string,
  status: TopicItemStatus,
  reason: string | null,
): Promise<void> {
  await itemStatusOp(orgId, itemId, status, reason)
}

/** Save one topic after a user action / recompute, with its journal. */
async function saveTopic(
  orgId: string,
  t: TopicSnapshot,
  events: TopicEventDraft[],
  actor: { actor: TopicActor; userId: string | null },
  extra: unknown[] = [],
) {
  const rows = eventRows(orgId, events, actor)
  // Phase 5a (R16): a user action / detach on a deal topic changes the deal's information.
  const dirty = t.dealId
    ? [
        db
          .update(deal)
          .set({ stateDirtyAt: new Date(), updatedAt: sql`${deal.updatedAt}` })
          .where(and(eq(deal.organizationId, orgId), eq(deal.id, t.dealId))),
      ]
    : []
  await db.batch(
    asBatch([topicUpsertOp(orgId, t), ...extra, ...(rows.length ? [db.insert(topicEvent).values(rows)] : []), ...dirty]),
  )
}

// ── Timers + re-link (deterministic steps of the phase) ───────────────────

/**
 * Status timers of spec §7.1 for the whole org: open → dormant (21 d) →
 * expired (60 d); resolved → archived after the reopen window (14 d).
 * Journaled as agent events. Returns the number of changed topics.
 */
export async function sweepTopicTimers(orgId: string, now: Date, actorUserId: string | null): Promise<number> {
  const rows = await db
    .select({ id: topic.id, status: topic.status, lastActivityAt: topic.lastActivityAt, closedAt: topic.closedAt })
    .from(topic)
    .where(and(eq(topic.organizationId, orgId), inArray(topic.status, ["open", "dormant", "resolved"])))
  const ops: unknown[] = []
  const events: TopicEventDraft[] = []
  for (const r of rows) {
    if (!isTopicStatus(r.status)) continue
    const next = timerTransition({ status: r.status, lastActivityAt: r.lastActivityAt, closedAt: r.closedAt }, now)
    if (!next) continue
    ops.push(
      db
        .update(topic)
        .set({ status: next, subState: "none", nextAttentionCheckAt: now, updatedAt: now })
        .where(and(eq(topic.organizationId, orgId), eq(topic.id, r.id))),
    )
    events.push({ topicId: r.id, type: next as TopicEventDraft["type"], sourceItemId: null, payload: { from: r.status } })
  }
  if (ops.length === 0) return 0
  const ev = eventRows(orgId, events, { actor: "agent", userId: actorUserId })
  await db.batch(asBatch([...ops, db.insert(topicEvent).values(ev)]))
  return ops.length
}

/**
 * Re-link (plan phase 3 task 3): live topics with neither client nor contact
 * get their counterparty resolved again from `counterparty_raw` and the peer
 * of their first item — so they link once discovery has created the client /
 * contact. Cheap and deterministic. Returns the number of re-linked topics.
 */
export async function relinkUnresolvedTopics(
  orgId: string,
  idx: CounterpartyIndex,
  actorUserId: string | null,
): Promise<number> {
  const rows = await db
    .select({
      id: topic.id,
      counterpartyRaw: topic.counterpartyRaw,
      matter: topic.matter,
      // Qualified on purpose: a bare column would bind to the subquery's table.
      firstItem: sql<string | null>`(
        select ti.source_item_id from topic_item ti
        where ti.topic_id = "topic"."id" order by ti.created_at asc limit 1)`,
    })
    .from(topic)
    .where(
      and(
        eq(topic.organizationId, orgId),
        inArray(topic.status, LIVE),
        isNull(topic.clientId),
        isNull(topic.contactId),
      ),
    )
  if (rows.length === 0) return 0
  const itemIds = rows.map((r) => r.firstItem).filter((x): x is string => !!x)
  const items = itemIds.length
    ? await db
        .select({ id: sourceItem.id, metadataJson: sourceItem.metadataJson, signalFacts: sourceItem.signalFacts })
        .from(sourceItem)
        .where(and(eq(sourceItem.organizationId, orgId), inArray(sourceItem.id, itemIds)))
    : []
  const meta = new Map(items.map((i) => [i.id, i]))
  const ops: unknown[] = []
  const events: TopicEventDraft[] = []
  for (const r of rows) {
    const it = r.firstItem ? meta.get(r.firstItem) : undefined
    const peer = it ? itemPeer(it.metadataJson, factsOf(it.signalFacts).direction) : null
    const res = resolveCounterparty(r.counterpartyRaw, peer, idx)
    if (!res.clientId && !res.contactId) continue
    const title = buildTopicTitle({
      companyName: res.companyName,
      contactName: res.contactName,
      counterpartyRaw: r.counterpartyRaw,
      matter: r.matter,
    })
    ops.push(
      db
        .update(topic)
        .set({ clientId: res.clientId, contactId: res.contactId, title, nextAttentionCheckAt: new Date(), updatedAt: new Date() })
        .where(and(eq(topic.organizationId, orgId), eq(topic.id, r.id))),
    )
    events.push({
      topicId: r.id,
      type: "relinked",
      sourceItemId: null,
      payload: { clientId: res.clientId, contactId: res.contactId, via: res.via },
    })
  }
  if (ops.length === 0) return 0
  await db.batch(asBatch([...ops, db.insert(topicEvent).values(eventRows(orgId, events, { actor: "agent", userId: actorUserId }))]))
  return ops.length
}

// ── User / admin actions (no UI yet; the caller checks the session) ───────

/**
 * Attention follows every user action at once (06 §10). Lazy import: the
 * attention store imports this module. Never fails the action — a failed
 * recompute leaves the topic due for the next hourly run.
 */
async function refreshAttention(orgId: string, topicIds: string[]): Promise<void> {
  try {
    const { recomputeTopicsAttention } = await import("./attention/store")
    await recomputeTopicsAttention(orgId, topicIds)
  } catch (e) {
    console.error("[topics/attention] recompute after action failed", topicIds, e)
  }
}

export class TopicNotFoundError extends Error {
  constructor(public topicId: string) {
    super(`Тема не найдена: ${topicId}`)
    this.name = "TopicNotFoundError"
  }
}

export class TopicActionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TopicActionError"
  }
}

type ActionContext = { book: CodeBook; relationOf: RelationLookup; now: Date }

async function actionContext(orgId: string): Promise<ActionContext> {
  const now = new Date()
  const [book, relationOf] = await Promise.all([loadCodeBook(orgId), loadRelationLookup(orgId, now)])
  return { book, relationOf, now }
}

async function requireTopic(orgId: string, topicId: string): Promise<TopicSnapshot> {
  const t = await loadTopicSnapshot(orgId, topicId)
  if (!t) throw new TopicNotFoundError(topicId)
  return t
}

const FINAL: TopicStatus[] = ["merged", "dismissed"]

/** «Готово» (spec §7.1): a human mark, not settlement. Reopens on a new item within 14 d. */
export async function markTopicDone(orgId: string, topicId: string, userId: string, note?: string): Promise<TopicSnapshot> {
  const t = await requireTopic(orgId, topicId)
  if (FINAL.includes(t.status)) throw new TopicActionError(`Тема в статусе ${t.status}`)
  const from = t.status
  t.status = "done"
  t.subState = "none"
  t.closedAt = new Date()
  t.closedReason = "user_done"
  await saveTopic(orgId, t, [{ topicId, type: "done", sourceItemId: null, payload: { from, note: note ?? null } }], {
    actor: "user",
    userId,
  })
  await refreshAttention(orgId, [topicId])
  return t
}

/** «Не относится» (spec §7.1): the topic is not a business question. */
export async function dismissTopic(orgId: string, topicId: string, userId: string, reason?: string): Promise<TopicSnapshot> {
  const t = await requireTopic(orgId, topicId)
  if (t.status === "merged") throw new TopicActionError("Тема объединена с другой")
  const from = t.status
  t.status = "dismissed"
  t.subState = "none"
  t.closedAt = new Date()
  t.closedReason = "user_dismissed"
  await saveTopic(orgId, t, [{ topicId, type: "dismissed", sourceItemId: null, payload: { from, reason: reason ?? null } }], {
    actor: "user",
    userId,
  })
  await refreshAttention(orgId, [topicId])
  return t
}

/**
 * Merge `sourceTopicId` into `targetTopicId` (user action, spec §7.1): the
 * source's items and signal instances move to the target, the source becomes
 * `merged` (→ merged_into_topic_id), the target is recomputed. Journaled on
 * both topics.
 */
export async function mergeTopics(
  orgId: string,
  sourceTopicId: string,
  targetTopicId: string,
  userId: string,
): Promise<TopicSnapshot> {
  if (sourceTopicId === targetTopicId) throw new TopicActionError("Нельзя объединить тему с самой собой")
  const [src, dst] = await Promise.all([requireTopic(orgId, sourceTopicId), requireTopic(orgId, targetTopicId)])
  if (src.status === "merged" || dst.status === "merged") throw new TopicActionError("Тема уже объединена")
  const ctx = await actionContext(orgId)
  for (const l of src.items) {
    if (!dst.items.some((x) => x.itemId === l.itemId && x.subjectIndex === l.subjectIndex)) dst.items.push(l)
  }
  for (const i of src.instances) if (!dst.instances.some((x) => x.id === i.id)) dst.instances.push(i)
  if (!dst.clientId && src.clientId) dst.clientId = src.clientId
  if (!dst.contactId && src.contactId) dst.contactId = src.contactId
  if (dst.status !== "open" && dst.status !== "dormant") {
    dst.status = "open"
    dst.closedAt = null
    dst.closedReason = null
  }
  const events = recomputeTopic(dst, ctx.book, ctx.now, ctx.relationOf)
  events.push({ topicId: dst.id, type: "merged_from", sourceItemId: null, payload: { topicId: src.id, title: src.title } })
  src.status = "merged"
  src.subState = "none"
  src.mergedIntoTopicId = dst.id
  src.closedAt = ctx.now
  src.closedReason = "merged"
  const srcEvents: TopicEventDraft[] = [
    { topicId: src.id, type: "merged_into", sourceItemId: null, payload: { topicId: dst.id, title: dst.title } },
  ]
  const actor = { actor: "user" as const, userId }
  const moveLinks = src.items.length
    ? [
        db.insert(topicItem).values(
          src.items.map((l) => ({
            id: randomUUID(),
            organizationId: orgId,
            topicId: dst.id,
            sourceItemId: l.itemId,
            subjectIndex: l.subjectIndex,
            role: l.role,
          })),
        ).onConflictDoNothing(),
        db.delete(topicItem).where(eq(topicItem.topicId, src.id)),
      ]
    : []
  await db.batch(
    asBatch([
      topicUpsertOp(orgId, dst),
      topicUpsertOp(orgId, src),
      ...moveLinks,
      db
        .update(signalInstance)
        .set({ topicId: dst.id })
        .where(and(eq(signalInstance.organizationId, orgId), eq(signalInstance.topicId, src.id))),
      db.insert(topicEvent).values(eventRows(orgId, [...events, ...srcEvents], actor)),
    ]),
  )
  await refreshAttention(orgId, [dst.id, src.id])
  return dst
}

/** Topic deleted or recomputed after its items were removed. */
type DetachOutcome = { topicId: string; deleted: boolean }

async function detachFromTopic(
  orgId: string,
  t: TopicSnapshot,
  sourceItemId: string,
  ctx: ActionContext,
  actor: { actor: TopicActor; userId: string | null },
  reason: string,
): Promise<DetachOutcome> {
  t.items = t.items.filter((l) => l.itemId !== sourceItemId)
  t.instances = t.instances.filter((i) => i.itemId !== sourceItemId)
  const unlink = [
    db.delete(topicItem).where(and(eq(topicItem.topicId, t.id), eq(topicItem.sourceItemId, sourceItemId))),
    db
      .update(signalInstance)
      .set({ topicId: null })
      .where(and(eq(signalInstance.topicId, t.id), eq(signalInstance.sourceItemId, sourceItemId))),
  ]
  if (t.items.every((l) => l.role === "context")) {
    // No evidence left (only context items or nothing): delete the topic
    // (links, events cascade; instances → null). Its context items are
    // reset so the next run looks at them again.
    const contextItems = [...new Set(t.items.map((l) => l.itemId))]
    await db.batch(
      asBatch([
        ...unlink,
        db.delete(topic).where(and(eq(topic.organizationId, orgId), eq(topic.id, t.id))),
        ...(contextItems.length
          ? [
              db
                .update(sourceItem)
                .set({ topicStatus: null, topicReason: null, topicScannedAt: null, topicAttempts: 0 })
                .where(and(eq(sourceItem.organizationId, orgId), inArray(sourceItem.id, contextItems))),
            ]
          : []),
      ]),
    )
    return { topicId: t.id, deleted: true }
  }
  const events = recomputeTopic(t, ctx.book, ctx.now, ctx.relationOf)
  events.push({ topicId: t.id, type: "item_detached", sourceItemId: null, payload: { sourceItemId, reason } })
  await saveTopic(orgId, t, events, actor, unlink)
  return { topicId: t.id, deleted: false }
}

/** User action: remove one item from a topic (it does not belong); the topic is recomputed. */
export async function detachItemFromTopic(
  orgId: string,
  topicId: string,
  sourceItemId: string,
  userId: string,
): Promise<DetachOutcome> {
  const t = await requireTopic(orgId, topicId)
  if (!t.items.some((l) => l.itemId === sourceItemId)) throw new TopicActionError("Сообщение не относится к теме")
  const r = await detachFromTopic(orgId, t, sourceItemId, await actionContext(orgId), { actor: "user", userId }, "user")
  if (!r.deleted) await refreshAttention(orgId, [r.topicId])
  return r
}

/**
 * Integration hook (plan phase 3 task 7): call BEFORE a source item is
 * re-parsed or torn down. Removes the item from every topic it is on;
 * topics left with no item (or only `context` items) are deleted — their
 * context items are reset for the next run — the others are recomputed
 * (journal: `item_detached`, actor agent). Resets the item's topic progress
 * (`topic_status` / `topic_scanned_at` / `topic_attempts`) so the next run
 * resolves it again. Org-explicit; the caller checks access. Safe to call
 * for an item that is on no topic.
 */
export async function detachSourceItemFromTopics(
  orgId: string,
  sourceItemId: string,
  opts: { actorUserId?: string | null; reason?: string } = {},
): Promise<{ detached: number; deleted: number }> {
  const links = await db
    .selectDistinct({ topicId: topicItem.topicId })
    .from(topicItem)
    .where(and(eq(topicItem.organizationId, orgId), eq(topicItem.sourceItemId, sourceItemId)))
  const extra = await db
    .selectDistinct({ topicId: signalInstance.topicId })
    .from(signalInstance)
    .where(and(eq(signalInstance.organizationId, orgId), eq(signalInstance.sourceItemId, sourceItemId)))
  const ids = [...new Set([...links.map((l) => l.topicId), ...extra.map((e) => e.topicId).filter((x): x is string => !!x)])]
  let deleted = 0
  const kept: string[] = []
  if (ids.length) {
    const ctx = await actionContext(orgId)
    const rows = await db.select().from(topic).where(and(eq(topic.organizationId, orgId), inArray(topic.id, ids)))
    for (const t of await hydrateTopics(rows)) {
      const r = await detachFromTopic(orgId, t, sourceItemId, ctx, { actor: "agent", userId: opts.actorUserId ?? null }, opts.reason ?? "reparse")
      if (r.deleted) deleted++
      else kept.push(r.topicId)
    }
  }
  if (kept.length) await refreshAttention(orgId, kept)
  await db
    .update(sourceItem)
    .set({ topicStatus: null, topicReason: null, topicScannedAt: null, topicAttempts: 0 })
    .where(and(eq(sourceItem.organizationId, orgId), eq(sourceItem.id, sourceItemId)))
  return { detached: ids.length, deleted }
}

// ── User actions of the topics UI (phase 6) ───────────────────────────────

function userEvent(orgId: string, topicId: string, userId: string, type: string, payload: Record<string, unknown>) {
  return db.insert(topicEvent).values({
    id: randomUUID(),
    organizationId: orgId,
    topicId,
    type,
    actor: "user",
    userId,
    sourceItemId: null,
    payload,
  })
}

/**
 * «Отложить до…» (06 §5.2 H2): hide a live topic until `until`; a new
 * material fact ends the snooze early (engine). `until` null = «Снять
 * откладывание» (the topic returns at once, new cycle `snooze_end`).
 * Journaled (`snoozed` / `unsnoozed`); attention is recomputed.
 */
export async function snoozeTopic(orgId: string, topicId: string, userId: string, until: Date | null): Promise<void> {
  const t = await requireTopic(orgId, topicId)
  if (!LIVE.includes(t.status)) throw new TopicActionError("Отложить можно только открытую тему")
  const now = new Date()
  if (until && until.getTime() <= now.getTime()) throw new TopicActionError("Дата должна быть в будущем")
  await db.batch(
    asBatch([
      db
        .update(topic)
        .set({ snoozedUntil: until, snoozedAt: until ? now : null, nextAttentionCheckAt: now })
        .where(and(eq(topic.organizationId, orgId), eq(topic.id, topicId))),
      userEvent(orgId, topicId, userId, until ? "snoozed" : "unsnoozed", until ? { until: until.toISOString() } : {}),
    ]),
  )
  await refreshAttention(orgId, [topicId])
}

/**
 * «Ответственный» (spec §8.1): set the topic's assignee (the «Мои» filter).
 * `ownerUserId` null = no assignee; the recompute then falls back to the
 * linked deal's owner. The caller checks that the user is an org member.
 */
export async function setTopicOwner(
  orgId: string,
  topicId: string,
  ownerUserId: string | null,
  actorUserId: string,
  names: { fromName?: string | null; toName?: string | null } = {},
): Promise<void> {
  const [row] = await db
    .select({ id: topic.id, ownerUserId: topic.ownerUserId })
    .from(topic)
    .where(and(eq(topic.organizationId, orgId), eq(topic.id, topicId)))
  if (!row) throw new TopicNotFoundError(topicId)
  if (row.ownerUserId === ownerUserId) return
  await db.batch(
    asBatch([
      db
        .update(topic)
        .set({ ownerUserId })
        .where(and(eq(topic.organizationId, orgId), eq(topic.id, topicId))),
      userEvent(orgId, topicId, actorUserId, "owner_changed", {
        from: row.ownerUserId,
        to: ownerUserId,
        fromName: names.fromName ?? null,
        toName: names.toName ?? null,
      }),
    ]),
  )
  await refreshAttention(orgId, [topicId])
}

/**
 * «Привязать к сделке» (spec §14): link the topic to a deal of the org
 * (`dealId` null = unlink). Linking goes through the deal engine
 * (`linkTopicToDeal`: deal activity + deal state dirty); both ways add a
 * topic journal line (`deal_linked` / `deal_unlinked`) and recompute
 * attention at once. The attention store persists the default assignee
 * (= the deal owner); when the topic's assignee is still the OLD deal's
 * owner it is cleared, so the recompute takes the new deal's owner (or
 * none). The caller checks the deal belongs to the topic's client.
 */
export async function setTopicDeal(
  orgId: string,
  topicId: string,
  dealId: string | null,
  userId: string,
): Promise<void> {
  const [row] = await db
    .select({ id: topic.id, dealId: topic.dealId, status: topic.status, ownerUserId: topic.ownerUserId })
    .from(topic)
    .where(and(eq(topic.organizationId, orgId), eq(topic.id, topicId)))
  if (!row) throw new TopicNotFoundError(topicId)
  if (row.status === "merged") throw new TopicActionError("Тема объединена с другой")
  if (row.dealId === dealId) return
  const dealIds = [row.dealId, dealId].filter((x): x is string => !!x)
  const deals = await db
    .select({ id: deal.id, name: deal.name, userId: deal.userId })
    .from(deal)
    .where(and(eq(deal.organizationId, orgId), inArray(deal.id, dealIds)))
  const names = new Map(deals.map((d) => [d.id, d.name]))
  const oldOwner = row.dealId ? (deals.find((d) => d.id === row.dealId)?.userId ?? null) : null
  const clearOwner = !!oldOwner && row.ownerUserId === oldOwner
  if (dealId) {
    if (!names.has(dealId)) throw new TopicActionError("Сделка не найдена")
    // Lazy import: the deal engine is a large module; keep this one light.
    const { linkTopicToDeal } = await import("@/server/deal-engine")
    if (clearOwner) {
      await db.update(topic).set({ ownerUserId: null }).where(and(eq(topic.organizationId, orgId), eq(topic.id, topicId)))
    }
    await linkTopicToDeal(orgId, topicId, dealId, { kind: "user", userId }, { topicId, note: "Тема привязана к сделке вручную" })
    await userEvent(orgId, topicId, userId, "deal_linked", {
      dealId,
      dealName: names.get(dealId) ?? null,
      fromDealId: row.dealId,
    })
  } else {
    const old = row.dealId!
    await db.batch(
      asBatch([
        db
          .update(topic)
          .set({ dealId: null, nextAttentionCheckAt: new Date(), ...(clearOwner ? { ownerUserId: null } : {}) })
          .where(and(eq(topic.organizationId, orgId), eq(topic.id, topicId))),
        db
          .update(deal)
          .set({ stateDirtyAt: new Date(), updatedAt: sql`${deal.updatedAt}` })
          .where(and(eq(deal.organizationId, orgId), eq(deal.id, old))),
        userEvent(orgId, topicId, userId, "deal_unlinked", { dealId: old, dealName: names.get(old) ?? null }),
      ]),
    )
  }
  await refreshAttention(orgId, [topicId])
}

/** Recompute attention of one topic now (UI refresh after a card decision). */
export async function refreshTopicAttention(orgId: string, topicId: string): Promise<void> {
  await refreshAttention(orgId, [topicId])
}

// ── Reads (for the later debug page / API) ────────────────────────────────

export type TopicListRow = TopicRow & { itemCount: number }

export async function listOrgTopics(
  orgId: string,
  opts: { statuses?: TopicStatus[]; limit?: number; offset?: number } = {},
): Promise<TopicListRow[]> {
  const rows = await db
    .select({
      t: topic,
      itemCount: sql<number>`(select count(*)::int from topic_item ti where ti.topic_id = "topic"."id")`,
    })
    .from(topic)
    .where(and(eq(topic.organizationId, orgId), ...(opts.statuses?.length ? [inArray(topic.status, opts.statuses)] : [])))
    .orderBy(desc(topic.lastActivityAt))
    .limit(Math.min(opts.limit ?? 100, 500))
    .offset(opts.offset ?? 0)
  return rows.map((r) => ({ ...r.t, itemCount: r.itemCount }))
}

export type TopicDetail = {
  topic: TopicRow
  items: { sourceItemId: string; subjectIndex: number; role: string; date: Date; threadKey: string | null }[]
  instances: TopicInstance[]
  events: (typeof topicEvent.$inferSelect)[]
}

export async function getTopicDetail(orgId: string, topicId: string): Promise<TopicDetail | null> {
  const [row] = await db.select().from(topic).where(and(eq(topic.organizationId, orgId), eq(topic.id, topicId)))
  if (!row) return null
  const [snap] = await hydrateTopics([row])
  const events = await db
    .select()
    .from(topicEvent)
    .where(eq(topicEvent.topicId, topicId))
    .orderBy(asc(topicEvent.createdAt))
  return {
    topic: row,
    items: snap.items
      .map((l: TopicItemLink) => ({ sourceItemId: l.itemId, subjectIndex: l.subjectIndex, role: l.role, date: l.date, threadKey: l.threadKey }))
      .sort((a, b) => a.date.getTime() - b.date.getTime()),
    instances: snap.instances,
    events,
  }
}

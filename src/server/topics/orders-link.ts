import "server-only"

import { and, desc, eq, inArray, isNotNull, isNull, like, ne, or, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { db } from "@/db/drizzle"
import { card, order, signalInstance, topic, topicEvent } from "@/db/schema"
import type { CheckDef, CheckFinding, CheckKey, OpenProcessInstance } from "@/lib/topics/checks"
import { computeOrderDiscount } from "@/lib/orders-format"
import type { TopicOrderOption, TopicOrderView } from "@/lib/topics/topic-ui"
import type { TopicStatus } from "@/lib/topics/types"
import { loadAttentionParams } from "./attention/store"
import { applyCheckResult, loadStoreContext } from "./checks/store"
import { getTopicsMode } from "./mode"
import type { TopicEventDraft } from "./model"
import {
  CONFIRMED_ORDER_STATUSES,
  ORDER_CONFIRMED_CODE,
  confirmationEvidenceRu,
  confirmedConditionPrefix,
  orderLabel,
  planOrderConfirmation,
  type OrderConfirmationInstance,
  type OrderLinkState,
} from "./orders-link-plan"
import { ensureSystemActor } from "./system-actor"
import { eventRows } from "./topic-store"

// Topics plan phase 10 — orders link (spec topics/03 «10 Orders link», 01
// §5.6 origin `system_of_record`, R7 / Q26). Org-explicit, `server-only`.
//
//  1. Topic ↔ order: `order.topic_id`. Set when an order is created from a
//     topic card («Создать заказ», resolved from the card id on the server),
//     or linked / unlinked by a user (drawer «Заказы»). Journal on the topic:
//     `order_linked` / `order_unlinked`.
//  2. ORDER_CONFIRMED from the order status: an order with a topic in
//     `confirmed` / `finalized` gets ONE process instance on that topic
//     (phase 8 store, origin `system_of_record`, key `order:<id>:confirmed`).
//     It is a `state` code (weight 0 → counted false) that `closes_codes`
//     ORDER_REQUESTED / ORDER_CHANGE_REQUESTED, so the topic resolves when
//     nothing else is active. Leaving confirmed (cancel, back to draft /
//     client, unlink) clears it (B5); the topic reopens only by new items.
//  3. Hooks never fail the order action (errors logged); they run only in
//     topics mode `shadow` / `on`. `reconcileOrderTopics` = the hourly
//     safety net (phase 8 runner).

/** Local check definition (NOT in CHECKS: no schedule of its own). */
export const ORDER_CONFIRMED_CHECK: CheckDef = {
  key: "order_confirmed" as CheckKey,
  group: "orders",
  codes: [ORDER_CONFIRMED_CODE],
  schedule: "hourly",
  labelRu: "Заказ подтверждён",
}

const USER_CLOSED: TopicStatus[] = ["done", "dismissed", "merged"]
const RECONCILE_LIMIT = 100

export class OrderTopicLinkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "OrderTopicLinkError"
  }
}

async function engineActive(orgId: string): Promise<boolean> {
  const mode = await getTopicsMode(orgId)
  return mode === "shadow" || mode === "on"
}

async function loadOrderState(orgId: string, orderId: string): Promise<(OrderLinkState & { clientId: string }) | null> {
  const [o] = await db
    .select({
      id: order.id,
      status: order.status,
      topicId: order.topicId,
      clientId: order.clientId,
      description: order.description,
      totalAmount: order.totalAmount,
      discountPercent: order.discountPercent,
      currency: order.currency,
      updatedAt: order.updatedAt,
    })
    .from(order)
    .where(and(eq(order.organizationId, orgId), eq(order.id, orderId)))
  if (!o) return null
  return {
    id: o.id,
    status: o.status,
    topicId: o.topicId,
    clientId: o.clientId,
    description: o.description,
    total: computeOrderDiscount(Number(o.totalAmount), Number(o.discountPercent)).discountedTotal,
    currency: o.currency,
    statusAt: o.updatedAt,
  }
}

async function loadOrderInstances(orgId: string, orderId: string) {
  return db
    .select({
      id: signalInstance.id,
      code: signalInstance.code,
      conditionKey: signalInstance.conditionKey,
      topicId: signalInstance.topicId,
      facts: signalInstance.facts,
      createdAt: signalInstance.createdAt,
      clearedAt: signalInstance.clearedAt,
    })
    .from(signalInstance)
    .where(
      and(
        eq(signalInstance.organizationId, orgId),
        eq(signalInstance.code, ORDER_CONFIRMED_CODE),
        like(signalInstance.conditionKey, `${confirmedConditionPrefix(orderId)}%`),
      ),
    )
}

export type OrderSyncResult = { written: number; cleared: number; skipped: number; failed: number; topicIds: string[]; errors: string[] }

/**
 * Bring the ORDER_CONFIRMED instance of ONE order in line with its status +
 * topic (write / clear). Does not check the topics mode (callers do).
 */
export async function syncOrderTopic(
  orgId: string,
  orderId: string,
  opts: { now?: Date; actorUserId?: string | null } = {},
): Promise<OrderSyncResult> {
  const now = opts.now ?? new Date()
  const [o, instances, ap] = await Promise.all([
    loadOrderState(orgId, orderId),
    loadOrderInstances(orgId, orderId),
    loadAttentionParams(orgId),
  ])
  let topicWritable = false
  if (o?.topicId) {
    const [t] = await db
      .select({ status: topic.status })
      .from(topic)
      .where(and(eq(topic.organizationId, orgId), eq(topic.id, o.topicId)))
    topicWritable = !!t && !USER_CLOSED.includes(t.status as TopicStatus)
  }
  const plan = planOrderConfirmation(
    orderId,
    o,
    instances.map((i): OrderConfirmationInstance => ({ id: i.id, conditionKey: i.conditionKey ?? "", topicId: i.topicId, clearedAt: i.clearedAt })),
    { topicWritable, timeZone: ap.timeZone, now },
  )
  const empty: OrderSyncResult = { written: 0, cleared: 0, skipped: 0, failed: 0, topicIds: [], errors: [] }
  if (!plan.write && plan.clears.length === 0) return empty

  const findings: CheckFinding[] =
    plan.write && o
      ? [
          {
            code: ORDER_CONFIRMED_CODE,
            conditionKey: plan.write.conditionKey,
            topicId: o.topicId,
            clientId: o.clientId,
            contactId: null,
            companyName: null,
            matterRu: "Заказ подтверждён",
            evidenceRu: confirmationEvidenceRu(o, ap.timeZone),
            score: null,
            facts: {
              orderId: o.id,
              orderLabel: orderLabel(o),
              status: o.status,
              total: o.total,
              currency: o.currency,
              statusAt: o.statusAt.toISOString(),
            },
          },
        ]
      : []
  const existing: OpenProcessInstance[] = instances.map((i) => ({
    id: i.id,
    code: i.code,
    conditionKey: i.conditionKey ?? "",
    topicId: i.topicId,
    clientId: o?.clientId ?? null,
    facts: (i.facts as Record<string, unknown> | null) ?? {},
    createdAt: i.createdAt,
    clearedAt: i.clearedAt,
  }))
  const actor = opts.actorUserId ?? (await ensureSystemActor(orgId))
  const sc = await loadStoreContext(orgId, now, actor)
  const out = await applyCheckResult(sc, ORDER_CONFIRMED_CHECK, { findings, clears: plan.clears, evaluated: 1, skipped: {} }, existing, 1)
  return {
    written: out.counts.created + out.counts.attached,
    cleared: out.counts.cleared,
    skipped: out.counts.skipped,
    failed: out.counts.failed,
    topicIds: out.topicIds,
    errors: out.errors,
  }
}

async function recomputeAttentionSafe(orgId: string, topicIds: readonly string[]) {
  if (topicIds.length === 0) return
  try {
    const { recomputeTopicsAttention } = await import("./attention/store")
    await recomputeTopicsAttention(orgId, topicIds)
  } catch (e) {
    console.error("[topics/orders-link] attention recompute failed", orgId, e)
  }
}

/**
 * Hook for every order status write (internal transitions, guest confirm).
 * Never throws; a no-op when the org's topics mode is `off`.
 */
export async function afterOrderStatusChange(orderId: string): Promise<void> {
  try {
    const [row] = await db.select({ orgId: order.organizationId }).from(order).where(eq(order.id, orderId))
    if (!row) return
    if (!(await engineActive(row.orgId))) return
    const r = await syncOrderTopic(row.orgId, orderId)
    if (r.errors.length) console.error("[topics/orders-link] sync errors", orderId, r.errors)
    await recomputeAttentionSafe(row.orgId, r.topicIds)
  } catch (e) {
    console.error("[topics/orders-link] afterOrderStatusChange failed", orderId, e)
  }
}

// ── Hourly reconcile (safety net) ─────────────────────────────────────────

/**
 * Orders whose ORDER_CONFIRMED instance is out of line: confirmed / finalized
 * with a writable topic but no open instance on it, or an open instance whose
 * order is gone, not confirmed, or on another topic. ≤ 100 orders per run.
 */
export async function reconcileOrderTopics(
  orgId: string,
  opts: { now?: Date; actorUserId?: string | null } = {},
): Promise<{ checked: number; written: number; cleared: number; failed: number }> {
  const openOnTopic = sql`exists (
    select 1 from ${signalInstance} si
    where si.organization_id = ${orgId}
      and si.code = ${ORDER_CONFIRMED_CODE}
      and si.cleared_at is null
      and si.topic_id = ${order.topicId}
      and (si.condition_key = 'order:' || ${order.id} || ':confirmed'
           or si.condition_key like 'order:' || ${order.id} || ':confirmed:%')
  )`
  const missing = await db
    .select({ id: order.id })
    .from(order)
    .innerJoin(topic, eq(topic.id, order.topicId))
    .where(
      and(
        eq(order.organizationId, orgId),
        isNotNull(order.topicId),
        inArray(order.status, CONFIRMED_ORDER_STATUSES as ("confirmed" | "finalized")[]),
        sql`${topic.status} not in ('done', 'dismissed', 'merged')`,
        sql`not ${openOnTopic}`,
      ),
    )
    .limit(RECONCILE_LIMIT)
  const stale = await db
    .select({ key: signalInstance.conditionKey })
    .from(signalInstance)
    .leftJoin(order, sql`${order.id} = split_part(${signalInstance.conditionKey}, ':', 2) and ${order.organizationId} = ${orgId}`)
    .where(
      and(
        eq(signalInstance.organizationId, orgId),
        eq(signalInstance.code, ORDER_CONFIRMED_CODE),
        isNull(signalInstance.clearedAt),
        like(signalInstance.conditionKey, "order:%:confirmed%"),
        or(
          isNull(order.id),
          sql`${order.status} not in ('confirmed', 'finalized')`,
          sql`${order.topicId} is distinct from ${signalInstance.topicId}`,
        ),
      ),
    )
    .limit(RECONCILE_LIMIT)
  const ids = new Set<string>(missing.map((m) => m.id))
  for (const s of stale) {
    const id = s.key?.split(":")[1]
    if (id) ids.add(id)
  }
  const res = { checked: 0, written: 0, cleared: 0, failed: 0 }
  if (ids.size === 0) return res
  const actor = opts.actorUserId ?? (await ensureSystemActor(orgId))
  const touched = new Set<string>()
  for (const id of [...ids].slice(0, RECONCILE_LIMIT)) {
    res.checked++
    try {
      const r = await syncOrderTopic(orgId, id, { now: opts.now, actorUserId: actor })
      res.written += r.written
      res.cleared += r.cleared
      res.failed += r.failed
      r.topicIds.forEach((t) => touched.add(t))
      if (r.errors.length) console.error("[topics/orders-link] reconcile errors", orgId, id, r.errors)
    } catch (e) {
      res.failed++
      console.error("[topics/orders-link] reconcile failed", orgId, id, e)
    }
  }
  // Touched topics are due for the attention phase (topicUpsertOp sets
  // next_attention_check_at = now), which runs after checks in the hourly run.
  return res
}

// ── Topic ↔ order link ────────────────────────────────────────────────────

type LinkVia = "card" | "user"

async function journal(orgId: string, userId: string | null, events: TopicEventDraft[]) {
  if (events.length === 0) return
  await db.insert(topicEvent).values(eventRows(orgId, events, { actor: userId ? "user" : "agent", userId }))
}

/**
 * Set / clear `order.topic_id` as `userId` (journaled on both topics), then
 * bring ORDER_CONFIRMED in line. Checks: order + topic in the org, topic not
 * merged, topic client = order client (`allowTopicWithoutClient` lets a
 * card topic without a company take the order). Keeps `order.updated_at`.
 */
export async function setOrderTopic(
  orgId: string,
  userId: string | null,
  orderId: string,
  topicId: string | null,
  opts: { via?: LinkVia; reason?: string; allowTopicWithoutClient?: boolean } = {},
): Promise<{ changed: boolean }> {
  const o = await loadOrderState(orgId, orderId)
  if (!o) throw new OrderTopicLinkError("Заказ не найден")
  if (topicId) {
    const [t] = await db
      .select({ id: topic.id, clientId: topic.clientId, status: topic.status })
      .from(topic)
      .where(and(eq(topic.organizationId, orgId), eq(topic.id, topicId)))
    if (!t) throw new OrderTopicLinkError("Тема не найдена")
    if (t.status === "merged") throw new OrderTopicLinkError("Тема объединена с другой — привяжите заказ к ней")
    const sameClient = t.clientId ? t.clientId === o.clientId : !!opts.allowTopicWithoutClient
    if (!sameClient) throw new OrderTopicLinkError("Привязать можно только заказ компании этой темы")
  }
  if (o.topicId === topicId) return { changed: false }
  await db
    .update(order)
    .set({ topicId, updatedAt: sql`${order.updatedAt}` })
    .where(and(eq(order.organizationId, orgId), eq(order.id, orderId)))
  const payload = { orderId, orderLabel: orderLabel(o), status: o.status, via: opts.via ?? "user" }
  const events: TopicEventDraft[] = []
  if (o.topicId) {
    events.push({
      topicId: o.topicId,
      type: "order_unlinked",
      sourceItemId: null,
      payload: { ...payload, ...(opts.reason ? { reason: opts.reason } : {}), ...(topicId ? { toTopicId: topicId } : {}) },
    })
  }
  if (topicId) events.push({ topicId, type: "order_linked", sourceItemId: null, payload })
  try {
    await journal(orgId, userId, events)
  } catch (e) {
    console.error("[topics/orders-link] journal failed", orgId, orderId, e)
  }
  if (await engineActive(orgId)) {
    try {
      const r = await syncOrderTopic(orgId, orderId)
      await recomputeAttentionSafe(orgId, [...new Set([...r.topicIds, ...(o.topicId ? [o.topicId] : []), ...(topicId ? [topicId] : [])])])
    } catch (e) {
      console.error("[topics/orders-link] sync after link failed", orgId, orderId, e)
    }
  }
  return { changed: true }
}

/**
 * «Создать заказ» on a topic card: link the NEW order to the card's topic.
 * The topic comes from the card row (org-checked), never from the client.
 * Only in topics mode `on` (users see topic cards only then). Never throws.
 */
export async function linkOrderFromCard(orgId: string, userId: string, orderId: string, cardId: string): Promise<string | null> {
  try {
    if ((await getTopicsMode(orgId)) !== "on") return null
    const [c] = await db
      .select({ topicId: card.topicId })
      .from(card)
      .where(and(eq(card.organizationId, orgId), eq(card.id, cardId)))
    if (!c?.topicId) return null
    await setOrderTopic(orgId, userId, orderId, c.topicId, { via: "card", allowTopicWithoutClient: true })
    return c.topicId
  } catch (e) {
    console.error("[topics/orders-link] linkOrderFromCard failed", orgId, orderId, cardId, e)
    return null
  }
}

/** The order's client changed: a topic of another company loses the order. Never throws. */
export async function afterOrderClientChange(orgId: string, userId: string, orderId: string): Promise<void> {
  try {
    const [row] = await db
      .select({ topicId: order.topicId, clientId: order.clientId, topicClientId: topic.clientId })
      .from(order)
      .leftJoin(topic, eq(topic.id, order.topicId))
      .where(and(eq(order.organizationId, orgId), eq(order.id, orderId)))
    if (!row?.topicId || !row.topicClientId || row.topicClientId === row.clientId) return
    await setOrderTopic(orgId, userId, orderId, null, { reason: "в заказе сменился клиент" })
  } catch (e) {
    console.error("[topics/orders-link] afterOrderClientChange failed", orgId, orderId, e)
  }
}

// ── Reads (drawer + order detail) ─────────────────────────────────────────

function orderView(o: {
  id: string
  description: string | null
  status: string
  totalAmount: string
  discountPercent: string
  currency: string
  orderDate: Date
}): TopicOrderView {
  return {
    id: o.id,
    label: orderLabel(o),
    status: o.status,
    total: computeOrderDiscount(Number(o.totalAmount), Number(o.discountPercent)).discountedTotal,
    currency: o.currency,
    orderDate: o.orderDate.toISOString(),
  }
}

const ORDER_VIEW_COLS = {
  id: order.id,
  description: order.description,
  status: order.status,
  totalAmount: order.totalAmount,
  discountPercent: order.discountPercent,
  currency: order.currency,
  orderDate: order.orderDate,
}

/** Orders linked to a topic, newest first. */
export async function listTopicOrders(orgId: string, topicId: string): Promise<TopicOrderView[]> {
  const rows = await db
    .select(ORDER_VIEW_COLS)
    .from(order)
    .where(and(eq(order.organizationId, orgId), eq(order.topicId, topicId)))
    .orderBy(desc(order.orderDate))
  return rows.map(orderView)
}

/** «Привязать заказ»: orders of the topic's company not yet on this topic (≤ 100, newest first). */
export async function listTopicOrderOptions(orgId: string, topicId: string): Promise<TopicOrderOption[]> {
  const [t] = await db
    .select({ clientId: topic.clientId })
    .from(topic)
    .where(and(eq(topic.organizationId, orgId), eq(topic.id, topicId)))
  if (!t?.clientId) return []
  const other = alias(topic, "other_topic")
  const rows = await db
    .select({ ...ORDER_VIEW_COLS, otherTopicTitle: other.title })
    .from(order)
    .leftJoin(other, and(eq(other.id, order.topicId), eq(other.organizationId, orgId)))
    .where(
      and(
        eq(order.organizationId, orgId),
        eq(order.clientId, t.clientId),
        or(isNull(order.topicId), ne(order.topicId, topicId)),
      ),
    )
    .orderBy(desc(order.orderDate))
    .limit(100)
  return rows.map((r) => ({ ...orderView(r), otherTopicTitle: r.otherTopicTitle ?? null }))
}

/** Topic of an order for the order detail — only when the org's topics mode is `on`. */
export async function getOrderTopicRef(
  orgId: string,
  topicId: string | null,
): Promise<{ id: string; title: string; status: string } | null> {
  if (!topicId) return null
  if ((await getTopicsMode(orgId)) !== "on") return null
  const [t] = await db
    .select({ id: topic.id, title: topic.title, status: topic.status })
    .from(topic)
    .where(and(eq(topic.organizationId, orgId), eq(topic.id, topicId)))
  return t ?? null
}

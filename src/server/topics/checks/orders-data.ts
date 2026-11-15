import "server-only"

// DB side of the phase 8 ORDER-DATA checks (spec topics/01 §5.6, 05 §3.6):
// org-explicit, READ-ONLY loaders + the evaluators (`ORDER_CHECKS`). The
// logic is PURE in `orders.ts`; the store (`store.ts`) writes the results.
//
// Contact linkage (ACCOUNT_NEW_FOLLOWUP outbound contact, ACCOUNT_REACTIVATION_DUE
// any contact) = a source item linked to the client or one of its contacts:
//  - `source_item_subject.client_id` / `contact_id` (topics phase 3);
//  - items of topics of the client (`topic_item` → `topic.client_id` / `contact_id`);
//  - the source item of a card linked via `card_client` / `card_contact`;
//  - mail participants (from / to / cc / participants) whose address is a
//    contact's email or on the client's own non-free-mail domain (as
//    `client-activity.ts` does for «Последняя активность»).
// Outbound = `org_attribution = 'own_org'` or extraction direction `outbound`.
// For reactivation also: orders (any status: `order_date`, `created_at`),
// tasks and deals (`updated_at`). Cards without a source item and process
// topics (no items) do not count, so a check's own topic / card never
// resets the silence it reported.

import { and, eq, gte, inArray, isNull, ne, notInArray, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { client, contact, deal, dealFunnelStage, order, orderItem, product, signalInstance, task, topic } from "@/db/schema"
import { OPEN_DEAL_STATUSES } from "@/lib/deal-funnel"
import { domainMatches, extractEmailDomain, extractWebsiteDomain, isFreemailDomain } from "@/lib/email-domain"
import {
  addMonths,
  checkAccountDormant,
  checkNewFollowup,
  checkProductNew,
  checkProductStopped,
  checkReactivationDue,
  checkRevenueStagnation,
  checkRevenueYoy,
  CODE,
  orderLabelOf,
  type OrderCheckEnv,
  type OrderClientInput,
  type OrderInput,
  type OrderLineInput,
  type ReactivationInfo,
} from "./orders"
import type { CheckContext, CheckEvaluators } from "./types"

const DAY_MS = 86_400_000
const COUNTED: ("confirmed" | "finalized")[] = ["confirmed", "finalized"]
const HIDDEN_CLIENT: ("deleted" | "blocked")[] = ["deleted", "blocked"]
const isCounted = (o: OrderInput) => o.status === "confirmed" || o.status === "finalized"

/**
 * A raw-SQL timestamp → Date. Columns are `timestamp without time zone`
 * holding UTC, and raw aggregates (`min` / `max` in `sql`) come back as
 * strings with no offset — `new Date()` would read them in the server's
 * local zone, so they are parsed as UTC here (as drizzle's column mapper does).
 */
export function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null
  let d: Date
  if (v instanceof Date) d = v
  else {
    const s = v.trim().replace(" ", "T")
    d = new Date(/(Z|[+-]\d\d(:?\d\d)?)$/.test(s) ? s : `${s}Z`)
  }
  return Number.isFinite(d.getTime()) ? d : null
}

function maxDate(a: Date | null, b: Date | null): Date | null {
  if (!a) return b
  if (!b) return a
  return b > a ? b : a
}

function envOf(ctx: CheckContext): OrderCheckEnv {
  return { now: ctx.now, params: ctx.params, calendar: ctx.calendar, existing: ctx.existing }
}

// ── Clients + orders ─────────────────────────────────────────────────────

/**
 * The org's visible clients (status not deleted / blocked) with all their
 * non-cancelled orders (net totals, labels). Two queries.
 */
export async function loadOrderClients(orgId: string): Promise<OrderClientInput[]> {
  const [clients, orders] = await Promise.all([
    db
      .select({
        id: client.id,
        name: client.name,
        createdAt: client.createdAt,
        kind: sql<string | null>`${client.customFields} ->> 'companyKind'`,
      })
      .from(client)
      .where(and(eq(client.organizationId, orgId), notInArray(client.status, HIDDEN_CLIENT))),
    db
      .select({
        id: order.id,
        clientId: order.clientId,
        date: order.orderDate,
        status: order.status,
        description: order.description,
        net: sql<string>`(${order.totalAmount} * (1 - ${order.discountPercent} / 100))`,
      })
      .from(order)
      .innerJoin(client, eq(client.id, order.clientId))
      .where(
        and(
          eq(order.organizationId, orgId),
          ne(order.status, "cancelled"),
          notInArray(client.status, HIDDEN_CLIENT),
        ),
      ),
  ])
  const byClient = new Map<string, OrderInput[]>()
  for (const o of orders) {
    const list = byClient.get(o.clientId) ?? []
    list.push({
      id: o.id,
      label: orderLabelOf(o.id, o.description),
      date: o.date,
      status: o.status,
      netTotal: Number(o.net) || 0,
    })
    byClient.set(o.clientId, list)
  }
  return clients.map((c) => ({
    clientId: c.id,
    name: c.name,
    createdAt: c.createdAt,
    companyKind: c.kind ?? null,
    orders: byClient.get(c.id) ?? [],
  }))
}

/**
 * Lines of counted orders dated ≥ `since` (one row per order + product,
 * quantities summed), attached to the clients' orders in place. Returns the
 * ids of the products that are active in the catalogue.
 */
async function attachOrderItems(
  orgId: string,
  clients: OrderClientInput[],
  since: Date,
  orderIds?: string[],
): Promise<Set<string>> {
  if (orderIds && orderIds.length === 0) return new Set()
  const rows = await db
    .select({
      orderId: orderItem.orderId,
      productId: orderItem.productId,
      name: product.name,
      status: product.status,
      qty: sql<string>`sum(${orderItem.quantity})`,
    })
    .from(orderItem)
    .innerJoin(order, eq(order.id, orderItem.orderId))
    .innerJoin(product, eq(product.id, orderItem.productId))
    .where(
      and(
        eq(order.organizationId, orgId),
        inArray(order.status, COUNTED),
        gte(order.orderDate, since),
        orderIds ? inArray(order.id, orderIds) : undefined,
      ),
    )
    .groupBy(orderItem.orderId, orderItem.productId, product.name, product.status)
  const byOrder = new Map<string, OrderLineInput[]>()
  const active = new Set<string>()
  for (const r of rows) {
    const list = byOrder.get(r.orderId) ?? []
    list.push({ productId: r.productId, productName: r.name, qty: Number(r.qty) || 0 })
    byOrder.set(r.orderId, list)
    if (r.status === "active") active.add(r.productId)
  }
  for (const c of clients) for (const o of c.orders) if (byOrder.has(o.id)) o.items = byOrder.get(o.id)
  return active
}

/** First counted order date per client + product (whole history), for the given clients. */
async function attachProductFirstAt(orgId: string, clients: OrderClientInput[]): Promise<void> {
  if (clients.length === 0) return
  const rows = await db
    .select({
      clientId: order.clientId,
      productId: orderItem.productId,
      firstAt: sql<string>`min(${order.orderDate})`,
    })
    .from(orderItem)
    .innerJoin(order, eq(order.id, orderItem.orderId))
    .where(
      and(
        eq(order.organizationId, orgId),
        inArray(order.status, COUNTED),
        inArray(
          order.clientId,
          clients.map((c) => c.clientId),
        ),
      ),
    )
    .groupBy(order.clientId, orderItem.productId)
  const byClient = new Map<string, Map<string, Date>>()
  for (const r of rows) {
    const d = toDate(r.firstAt)
    if (!d) continue
    const m = byClient.get(r.clientId) ?? new Map<string, Date>()
    m.set(r.productId, d)
    byClient.set(r.clientId, m)
  }
  for (const c of clients) c.productFirstAt = byClient.get(c.clientId) ?? new Map()
}

/** Clients with a not-cleared ACCOUNT_DORMANT process instance. */
export async function loadOpenDormantClientIds(orgId: string): Promise<Set<string>> {
  const rows = await db
    .select({
      factsClient: sql<string | null>`${signalInstance.facts} ->> 'clientId'`,
      topicClient: topic.clientId,
    })
    .from(signalInstance)
    .leftJoin(topic, eq(topic.id, signalInstance.topicId))
    .where(
      and(
        eq(signalInstance.organizationId, orgId),
        eq(signalInstance.code, CODE.dormant),
        isNull(signalInstance.clearedAt),
        sql`${signalInstance.conditionKey} is not null`,
      ),
    )
  const out = new Set<string>()
  for (const r of rows) {
    const id = r.topicClient ?? r.factsClient
    if (id) out.add(id)
  }
  return out
}

// ── Contact dates ─────────────────────────────────────────────────────────

type ContactDates = { lastAt: Date | null; lastOutboundAt: Date | null }

/**
 * Last linked source item per client (any direction + outbound only). See
 * the header for the linkage. Three queries + the participant scan.
 */
export async function loadClientContactDates(orgId: string, clientIds: string[]): Promise<Map<string, ContactDates>> {
  const out = new Map<string, ContactDates>()
  const ids = [...new Set(clientIds)]
  if (ids.length === 0) return out
  const idSet = new Set(ids)
  const bump = (clientId: string | null, at: Date | null, outbound: boolean) => {
    if (!clientId || !at || !idSet.has(clientId)) return
    const e = out.get(clientId) ?? { lastAt: null, lastOutboundAt: null }
    e.lastAt = maxDate(e.lastAt, at)
    if (outbound) e.lastOutboundAt = maxDate(e.lastOutboundAt, at)
    out.set(clientId, e)
  }

  const linked = await db.execute<{ client_id: string; last_at: string | null; last_out_at: string | null }>(sql`
    WITH links AS (
      SELECT sis.source_item_id AS sid, coalesce(sis.client_id, ct.client_id) AS cid
      FROM source_item_subject sis
      LEFT JOIN contact ct ON ct.id = sis.contact_id
      WHERE sis.organization_id = ${orgId}
      UNION
      SELECT ti.source_item_id, coalesce(t.client_id, ct.client_id)
      FROM topic_item ti
      JOIN topic t ON t.id = ti.topic_id
      LEFT JOIN contact ct ON ct.id = t.contact_id
      WHERE t.organization_id = ${orgId}
      UNION
      SELECT c.source_item_id, cc.client_id
      FROM card c JOIN card_client cc ON cc.card_id = c.id
      WHERE c.organization_id = ${orgId} AND c.source_item_id IS NOT NULL
      UNION
      SELECT c.source_item_id, ct.client_id
      FROM card c JOIN card_contact cco ON cco.card_id = c.id JOIN contact ct ON ct.id = cco.contact_id
      WHERE c.organization_id = ${orgId} AND c.source_item_id IS NOT NULL
    )
    SELECT l.cid AS client_id,
      max(coalesce(si.source_created_at, si.fetched_at)) AS last_at,
      max(coalesce(si.source_created_at, si.fetched_at)) FILTER (
        WHERE si.org_attribution = 'own_org' OR si.signal_facts ->> 'direction' = 'outbound'
      ) AS last_out_at
    FROM links l
    JOIN source_item si ON si.id = l.sid
    WHERE l.cid IS NOT NULL AND si.organization_id = ${orgId}
    GROUP BY l.cid
  `)
  for (const r of linked.rows) {
    bump(r.client_id, toDate(r.last_at), false)
    bump(r.client_id, toDate(r.last_out_at), true)
  }

  // Mail participants by contact email / the client's own domain.
  const [clientRows, contactRows] = await Promise.all([
    db
      .select({ id: client.id, email: client.email, webUrl: client.webUrl })
      .from(client)
      .where(and(eq(client.organizationId, orgId), inArray(client.id, ids))),
    db
      .select({ clientId: contact.clientId, email: contact.email })
      .from(contact)
      .where(and(eq(contact.organizationId, orgId), inArray(contact.clientId, ids), ne(contact.status, "deleted"))),
  ])
  const clientByEmail = new Map<string, string>()
  for (const c of contactRows) if (c.email && c.clientId) clientByEmail.set(c.email.trim().toLowerCase(), c.clientId)
  const domains: { clientId: string; domain: string }[] = []
  for (const c of clientRows) {
    for (const d of [c.webUrl ? extractWebsiteDomain(c.webUrl) : "", c.email ? extractEmailDomain(c.email) : ""]) {
      if (d && !isFreemailDomain(d)) domains.push({ clientId: c.id, domain: d })
    }
    if (c.email) clientByEmail.set(c.email.trim().toLowerCase(), c.id)
  }
  if (clientByEmail.size || domains.length) {
    const arr = (key: string) =>
      sql.raw(
        `CASE WHEN jsonb_typeof(si.metadata_json->'${key}') = 'array' THEN si.metadata_json->'${key}' ELSE '[]'::jsonb END`,
      )
    const rows = await db.execute<{ email: string | null; at: string | null; out_at: string | null }>(sql`
      SELECT lower(trim(p->>'email')) AS email,
        max(coalesce(si.source_created_at, si.fetched_at)) AS at,
        max(coalesce(si.source_created_at, si.fetched_at)) FILTER (
          WHERE si.org_attribution = 'own_org' OR si.signal_facts ->> 'direction' = 'outbound'
        ) AS out_at
      FROM source_item si,
        jsonb_array_elements(${arr("from")} || ${arr("to")} || ${arr("cc")} || ${arr("participants")}) AS p
      WHERE si.organization_id = ${orgId}
        AND p->>'email' IS NOT NULL
      GROUP BY 1
    `)
    for (const r of rows.rows) {
      if (!r.email) continue
      const at = toDate(r.at)
      const outAt = toDate(r.out_at)
      const direct = clientByEmail.get(r.email)
      const targets = direct ? [direct] : []
      if (!direct) {
        const domain = extractEmailDomain(r.email)
        if (domain && !isFreemailDomain(domain)) {
          for (const d of domains) if (domainMatches(domain, d.domain)) targets.push(d.clientId)
        }
      }
      for (const t of targets) {
        bump(t, at, false)
        bump(t, outAt, true)
      }
    }
  }
  return out
}

/**
 * Reactivation inputs per client: last contact of any kind (linked source
 * items + order created_at + task / deal updated_at; order dates are added by
 * the pure check), a lost deal, the «Потенциальные» tab (same rule as
 * `listClientsFeed`: an open deal on the pre-pipeline stage or 0 < p < 1, no
 * deal on a won stage).
 */
async function loadReactivationInfo(orgId: string, clientIds: string[]): Promise<Map<string, ReactivationInfo>> {
  const out = new Map<string, ReactivationInfo>()
  if (clientIds.length === 0) return out
  const [contacts, orders, tasks, deals] = await Promise.all([
    loadClientContactDates(orgId, clientIds),
    db
      .select({ clientId: order.clientId, at: sql<string | null>`max(${order.createdAt})` })
      .from(order)
      .where(and(eq(order.organizationId, orgId), inArray(order.clientId, clientIds)))
      .groupBy(order.clientId),
    db
      .select({ clientId: task.clientId, at: sql<string | null>`max(${task.updatedAt})` })
      .from(task)
      .where(and(eq(task.organizationId, orgId), inArray(task.clientId, clientIds)))
      .groupBy(task.clientId),
    db
      .select({
        clientId: deal.clientId,
        status: deal.status,
        updatedAt: deal.updatedAt,
        role: dealFunnelStage.role,
      })
      .from(deal)
      .innerJoin(dealFunnelStage, eq(dealFunnelStage.id, deal.funnelStageId))
      .where(and(eq(deal.organizationId, orgId), inArray(deal.clientId, clientIds))),
  ])
  const get = (id: string): ReactivationInfo => {
    let e = out.get(id)
    if (!e) {
      e = { lastContactAt: null, hasLostDeal: false, potentialTab: false }
      out.set(id, e)
    }
    return e
  }
  for (const [id, c] of contacts) get(id).lastContactAt = c.lastAt
  for (const r of [...orders, ...tasks]) {
    if (!r.clientId) continue
    const e = get(r.clientId)
    e.lastContactAt = maxDate(e.lastContactAt, toDate(r.at))
  }
  const won = new Set<string>()
  const open = new Set<string>()
  for (const d of deals) {
    const e = get(d.clientId)
    e.lastContactAt = maxDate(e.lastContactAt, d.updatedAt)
    if (!(OPEN_DEAL_STATUSES as readonly string[]).includes(d.status)) continue
    // By stage role (docs/specs/funnel §3.1): won / open (area0, active) / lost.
    if (d.role === "won") won.add(d.clientId)
    else if (d.role === "lost") e.hasLostDeal = true
    else open.add(d.clientId)
  }
  for (const id of open) if (!won.has(id)) get(id).potentialTab = true
  return out
}

// ── Evaluators ────────────────────────────────────────────────────────────

export const ORDER_CHECKS: CheckEvaluators = {
  account_dormant: async (ctx) => checkAccountDormant(await loadOrderClients(ctx.orgId), envOf(ctx)),

  product_stopped: async (ctx) => {
    const clients = await loadOrderClients(ctx.orgId)
    const activeProductIds = await attachOrderItems(ctx.orgId, clients, addMonths(ctx.now, -ctx.params.productLookbackMonths))
    return checkProductStopped(clients, envOf(ctx), { activeProductIds })
  },

  product_new: async (ctx) => {
    const clients = await loadOrderClients(ctx.orgId)
    const from = ctx.now.getTime() - ctx.params.productNewLookbackDays * DAY_MS
    const recent = clients.filter((c) =>
      c.orders.some((o) => isCounted(o) && o.date.getTime() > from),
    )
    const recentOrderIds = recent.flatMap((c) =>
      c.orders.filter((o) => isCounted(o) && o.date.getTime() > from).map((o) => o.id),
    )
    await Promise.all([
      attachOrderItems(ctx.orgId, recent, new Date(from), recentOrderIds),
      attachProductFirstAt(ctx.orgId, recent),
    ])
    const result = checkProductNew(recent, envOf(ctx))
    return { ...result, evaluated: clients.length }
  },

  new_followup: async (ctx) => {
    const clients = await loadOrderClients(ctx.orgId)
    // Only clients with exactly one counted order need the contact scan.
    const single = clients.filter((c) => c.orders.filter((o) => isCounted(o)).length === 1)
    const contacts = await loadClientContactDates(
      ctx.orgId,
      single.map((c) => c.clientId),
    )
    const lastOutboundAt = new Map<string, Date>()
    for (const [id, c] of contacts) if (c.lastOutboundAt) lastOutboundAt.set(id, c.lastOutboundAt)
    return checkNewFollowup(clients, envOf(ctx), { lastOutboundAt })
  },

  revenue_yoy: async (ctx) => {
    const [clients, openDormantClientIds] = await Promise.all([
      loadOrderClients(ctx.orgId),
      loadOpenDormantClientIds(ctx.orgId),
    ])
    return checkRevenueYoy(clients, envOf(ctx), { openDormantClientIds })
  },

  revenue_stagnation: async (ctx) => checkRevenueStagnation(await loadOrderClients(ctx.orgId), envOf(ctx)),

  reactivation_due: async (ctx) => {
    const [clients, openDormantClientIds] = await Promise.all([
      loadOrderClients(ctx.orgId),
      loadOpenDormantClientIds(ctx.orgId),
    ])
    const info = await loadReactivationInfo(
      ctx.orgId,
      clients.map((c) => c.clientId),
    )
    return checkReactivationDue(clients, envOf(ctx), { info, openDormantClientIds })
  },
}

import "server-only"

// DB side of the phase 8 CRM-DATA checks (ACCOUNT_MEETING_OVERDUE,
// INTERNAL_PRICE_CHANGE, INTERNAL_PRODUCT_STATUS_UPDATE): org-explicit,
// READ-ONLY loaders + the evaluators (`CRM_DATA_CHECKS`), and the ONE write
// of this module, `refreshProductWatchState` — called by the runner AFTER the
// store applied a catalogue check (never by an evaluator, so a preview stays
// a dry run). The logic is PURE in `crm-data.ts`.
//
// Meetings with a client (what really exists in the CRM today):
//  - calendar invites folded into mail items (`.ics`, src/server/parsers/ics.ts):
//    the item has `metadata_json.participants` (organizer + attendees) and a
//    `## Meeting` section with `**When:** <ISO start>` in its markdown
//    (`parsed_markdown`, or the stored object once uploaded);
//  - tasks of type `meet` with status `done` (date = due date, or the
//    update time when the due date is still ahead);
//  - an agreed meeting date in a message (`signal_facts.facts.proposedMeetingDate`).
// No source stores calendar events or Meet recordings, and deals have no
// meeting field. An item is linked to a client by `source_item_subject`,
// the item's topics (`topic_item` → `topic.client_id` / contact), and mail
// addresses (participants / from / to / cc) = a contact's or the client's
// email, or the client's own non-free-mail domain. A calendar-capable source
// = an active mail source (nylas / imap) of the org.

import { and, eq, gte, inArray, lte, ne, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { client, contact, order, orderItem, product, productWatchState, source, sourceItem, sourceItemSubject, task, topic, topicItem } from "@/db/schema"
import { domainMatches, extractEmailDomain, extractWebsiteDomain, isFreemailDomain } from "@/lib/email-domain"
import { getTextObject } from "@/server/storage"
import {
  checkMeetingOverdue,
  checkPriceChange,
  checkProductStatus,
  type CatalogueData,
  type CatalogueProduct,
  type CrmCheckEnv,
  planWatchStateWrites,
  type MeetingFact,
  type WatchState,
} from "./crm-data"
import { addMonths } from "./orders"
import { loadOrderClients } from "./orders-data"
import type { CheckContext, CheckEvaluators } from "./types"

const DAY_MS = 86_400_000
const COUNTED: ("confirmed" | "finalized")[] = ["confirmed", "finalized"]
const CALENDAR_PROVIDERS: ("nylas" | "imap")[] = ["nylas", "imap"]
/** Stored markdown objects read per run to find an invite's start (rare: invites without `parsed_markdown`). */
const MAX_STORED_MARKDOWN_READS = 200
const WRITE_CHUNK = 1000
const WHEN_RE = /\*\*When:\*\*\s*(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/

function envOf(ctx: CheckContext): CrmCheckEnv {
  return { now: ctx.now, params: ctx.params, calendar: ctx.calendar, existing: ctx.existing }
}

// ── Meetings ──────────────────────────────────────────────────────────────

/** The org has an active mail source (calendar invites arrive by mail). */
export async function hasCalendarSource(orgId: string): Promise<boolean> {
  const rows = await db
    .select({ id: source.id })
    .from(source)
    .where(and(eq(source.ownerOrganizationId, orgId), eq(source.status, "active"), inArray(source.provider, CALENDAR_PROVIDERS)))
    .limit(1)
  return rows.length > 0
}

function emailsOf(meta: Record<string, unknown> | null): string[] {
  if (!meta) return []
  const out: string[] = []
  for (const k of ["participants", "from", "to", "cc"]) {
    const list = meta[k]
    if (!Array.isArray(list)) continue
    for (const p of list) {
      const e = p && typeof p === "object" ? (p as { email?: unknown }).email : null
      if (typeof e === "string" && e.includes("@")) out.push(e.trim().toLowerCase())
    }
  }
  return [...new Set(out)]
}

/** Resolves a mail address to client ids (contact / client email, else the client's own domain). */
async function emailResolver(orgId: string, clientIds: ReadonlySet<string>): Promise<(email: string) => string[]> {
  const [clients, contacts] = await Promise.all([
    db
      .select({ id: client.id, email: client.email, webUrl: client.webUrl })
      .from(client)
      .where(eq(client.organizationId, orgId)),
    db
      .select({ clientId: contact.clientId, email: contact.email })
      .from(contact)
      .where(and(eq(contact.organizationId, orgId), ne(contact.status, "deleted"))),
  ])
  const byEmail = new Map<string, string>()
  for (const c of contacts) {
    if (c.email && c.clientId && clientIds.has(c.clientId)) byEmail.set(c.email.trim().toLowerCase(), c.clientId)
  }
  const domains: { clientId: string; domain: string }[] = []
  for (const c of clients) {
    if (!clientIds.has(c.id)) continue
    if (c.email) byEmail.set(c.email.trim().toLowerCase(), c.id)
    for (const d of [c.webUrl ? extractWebsiteDomain(c.webUrl) : "", c.email ? extractEmailDomain(c.email) : ""]) {
      if (d && !isFreemailDomain(d)) domains.push({ clientId: c.id, domain: d })
    }
  }
  return (email) => {
    const direct = byEmail.get(email)
    if (direct) return [direct]
    const domain = extractEmailDomain(email)
    if (!domain || isFreemailDomain(domain)) return []
    return [...new Set(domains.filter((d) => domainMatches(domain, d.domain)).map((d) => d.clientId))]
  }
}

/** Past and future meetings per client (the pure check keeps the past ones). */
export async function loadClientMeetings(
  orgId: string,
  clientIds: readonly string[],
  now: Date,
): Promise<Map<string, MeetingFact[]>> {
  const out = new Map<string, MeetingFact[]>()
  const ids = new Set(clientIds)
  if (ids.size === 0) return out
  const add = (clientId: string | null | undefined, at: Date | null, kind: MeetingFact["kind"]) => {
    if (!clientId || !at || !ids.has(clientId) || !Number.isFinite(at.getTime())) return
    const list = out.get(clientId) ?? []
    list.push({ clientId, at, kind })
    out.set(clientId, list)
  }

  // 1. Meeting tasks.
  const tasks = await db
    .select({ clientId: task.clientId, contactClientId: contact.clientId, due: task.dueDate, updatedAt: task.updatedAt })
    .from(task)
    .leftJoin(contact, eq(contact.id, task.contactId))
    .where(and(eq(task.organizationId, orgId), eq(task.type, "meet"), eq(task.status, "done")))
  for (const t of tasks) add(t.clientId ?? t.contactClientId, t.due <= now ? t.due : t.updatedAt, "task")

  // 2. Source items: calendar invites + agreed meeting dates.
  const items = await db
    .select({
      id: sourceItem.id,
      meta: sourceItem.metadataJson,
      isCalendar: sql<boolean>`${sourceItem.metadataJson} ? 'participants'`,
      whenAt: sql<string | null>`substring(${sourceItem.parsedMarkdown} from '\\*\\*When:\\*\\*\\s*([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z)')`,
      hasMarkdown: sql<boolean>`${sourceItem.parsedMarkdown} is not null`,
      r2Key: sourceItem.markdownR2Key,
      proposed: sql<string | null>`${sourceItem.signalFacts} -> 'facts' ->> 'proposedMeetingDate'`,
    })
    .from(sourceItem)
    .where(
      and(
        eq(sourceItem.organizationId, orgId),
        sql`(${sourceItem.metadataJson} ? 'participants' OR ${sourceItem.signalFacts} -> 'facts' ->> 'proposedMeetingDate' IS NOT NULL)`,
      ),
    )
  if (items.length === 0) return out

  const itemIds = items.map((i) => i.id)
  const [subjects, topicLinks, resolve] = await Promise.all([
    db
      .select({ sid: sourceItemSubject.sourceItemId, clientId: sourceItemSubject.clientId, contactClientId: contact.clientId })
      .from(sourceItemSubject)
      .leftJoin(contact, eq(contact.id, sourceItemSubject.contactId))
      .where(and(eq(sourceItemSubject.organizationId, orgId), inArray(sourceItemSubject.sourceItemId, itemIds))),
    db
      .select({ sid: topicItem.sourceItemId, clientId: topic.clientId, contactClientId: contact.clientId })
      .from(topicItem)
      .innerJoin(topic, eq(topic.id, topicItem.topicId))
      .leftJoin(contact, eq(contact.id, topic.contactId))
      .where(and(eq(topic.organizationId, orgId), inArray(topicItem.sourceItemId, itemIds))),
    emailResolver(orgId, ids),
  ])
  const linked = new Map<string, Set<string>>()
  for (const r of [...subjects, ...topicLinks]) {
    const cid = r.clientId ?? r.contactClientId
    if (!cid) continue
    linked.set(r.sid, (linked.get(r.sid) ?? new Set()).add(cid))
  }

  let reads = 0
  for (const it of items) {
    const clients = new Set(linked.get(it.id) ?? [])
    for (const e of emailsOf(it.meta as Record<string, unknown> | null)) for (const c of resolve(e)) clients.add(c)
    if (clients.size === 0) continue

    if (it.isCalendar) {
      let when = it.whenAt
      if (!when && !it.hasMarkdown && it.r2Key && reads < MAX_STORED_MARKDOWN_READS) {
        reads++
        try {
          when = WHEN_RE.exec(await getTextObject(it.r2Key))?.[1] ?? null
        } catch (e) {
          console.warn("[topics/checks] meeting markdown read failed", it.id, e instanceof Error ? e.message : e)
        }
      }
      if (when) for (const c of clients) add(c, new Date(when), "calendar")
    }
    if (it.proposed && /^\d{4}-\d{2}-\d{2}/.test(it.proposed)) {
      const at = new Date(`${it.proposed.slice(0, 10)}T12:00:00Z`)
      for (const c of clients) add(c, at, "proposed")
    }
  }
  return out
}

// ── Catalogue ─────────────────────────────────────────────────────────────

export async function loadCatalogueProducts(orgId: string): Promise<CatalogueProduct[]> {
  const rows = await db
    .select({
      id: product.id,
      name: product.name,
      price: product.price,
      status: product.status,
      totalStock: product.totalStock,
      vintage: sql<string | null>`nullif(trim(${product.additionalMetadata} ->> 'year'), '')`,
    })
    .from(product)
    .where(eq(product.organizationId, orgId))
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    price: r.price == null ? null : Number(r.price),
    status: r.status,
    totalStock: r.totalStock,
    vintage: r.vintage,
  }))
}

export async function loadWatchStates(orgId: string): Promise<Map<string, WatchState>> {
  const rows = await db
    .select({
      productId: productWatchState.productId,
      price: productWatchState.price,
      status: productWatchState.status,
      totalStock: productWatchState.totalStock,
      vintage: productWatchState.vintage,
    })
    .from(productWatchState)
    .where(eq(productWatchState.organizationId, orgId))
  return new Map(
    rows.map((r) => [
      r.productId,
      { productId: r.productId, price: r.price == null ? null : Number(r.price), status: r.status, totalStock: r.totalStock, vintage: r.vintage },
    ]),
  )
}

/** Buyers per product (distinct clients, `buyerLookbackMonths`) + products ordered in `stockOutRecentOrderDays`. */
async function loadProductOrderStats(
  orgId: string,
  now: Date,
  params: CheckContext["params"],
): Promise<{ buyers: Map<string, number>; recentOrdered: Set<string> }> {
  const buyerSince = addMonths(now, -params.buyerLookbackMonths)
  const recentSince = new Date(now.getTime() - params.stockOutRecentOrderDays * DAY_MS)
  const from = buyerSince < recentSince ? buyerSince : recentSince
  const rows = await db
    .select({
      productId: orderItem.productId,
      buyers: sql<string>`count(distinct ${order.clientId}) filter (where ${order.orderDate} >= ${buyerSince.toISOString()}::timestamp)`,
      recent: sql<boolean>`bool_or(${order.orderDate} >= ${recentSince.toISOString()}::timestamp)`,
    })
    .from(orderItem)
    .innerJoin(order, eq(order.id, orderItem.orderId))
    .where(
      and(
        eq(order.organizationId, orgId),
        inArray(order.status, COUNTED),
        gte(order.orderDate, from),
        lte(order.orderDate, now),
      ),
    )
    .groupBy(orderItem.productId)
  const buyers = new Map<string, number>()
  const recentOrdered = new Set<string>()
  for (const r of rows) {
    const n = Number(r.buyers) || 0
    if (n > 0) buyers.set(r.productId, n)
    if (r.recent) recentOrdered.add(r.productId)
  }
  return { buyers, recentOrdered }
}

export async function loadCatalogueData(ctx: Pick<CheckContext, "orgId" | "now" | "params">): Promise<CatalogueData> {
  const [products, states, stats] = await Promise.all([
    loadCatalogueProducts(ctx.orgId),
    loadWatchStates(ctx.orgId),
    loadProductOrderStats(ctx.orgId, ctx.now, ctx.params),
  ])
  return { products, states, ...stats }
}

/**
 * Writes the catalogue as the new last seen state (`product_watch_state`).
 * The runner calls it AFTER the store applied a catalogue check, with the
 * part of that check: `price` (INTERNAL_PRICE_CHANGE: prices of known
 * products) or `status` (INTERNAL_PRODUCT_STATUS_UPDATE: status / stock /
 * vintage + rows for new products), so one check never consumes the other's
 * changes. `hold` = SKUs whose event the store did NOT write (deferred /
 * failed): their status part is kept, so the next run finds them again. No
 * state for the org yet = SEED (every product; the checks emit nothing on
 * that run). Only new / changed rows, in chunks of ≤ 1 000 (`checked_at` =
 * time of the last write). Plan = `planWatchStateWrites` (pure).
 */
export async function refreshProductWatchState(
  orgId: string,
  now: Date,
  parts: { price?: boolean; status?: boolean; hold?: ReadonlySet<string> } = { price: true, status: true },
): Promise<{ seeded: number; inserted: number; updated: number; held: number }> {
  const [products, states] = await Promise.all([loadCatalogueProducts(orgId), loadWatchStates(orgId)])
  const plan = planWatchStateWrites(orgId, products, states, now, parts)
  for (let i = 0; i < plan.rows.length; i += WRITE_CHUNK) {
    await db
      .insert(productWatchState)
      .values(plan.rows.slice(i, i + WRITE_CHUNK))
      .onConflictDoUpdate({
        target: productWatchState.productId,
        set: {
          price: sql`excluded.price`,
          status: sql`excluded.status`,
          totalStock: sql`excluded.total_stock`,
          vintage: sql`excluded.vintage`,
          checkedAt: sql`excluded.checked_at`,
        },
      })
  }
  return {
    seeded: plan.seed ? plan.rows.length : 0,
    inserted: plan.inserted,
    updated: plan.updated,
    held: parts.hold?.size ?? 0,
  }
}

// ── Evaluators ────────────────────────────────────────────────────────────

export const CRM_DATA_CHECKS: CheckEvaluators = {
  meeting_overdue: async (ctx) => {
    const [clients, hasCalendar] = await Promise.all([loadOrderClients(ctx.orgId), hasCalendarSource(ctx.orgId)])
    const meetings = hasCalendar
      ? await loadClientMeetings(
          ctx.orgId,
          clients.map((c) => c.clientId),
          ctx.now,
        )
      : new Map<string, MeetingFact[]>()
    return checkMeetingOverdue(clients, envOf(ctx), { hasCalendarSource: hasCalendar, meetings })
  },

  price_change: async (ctx) => checkPriceChange(await loadCatalogueData(ctx), envOf(ctx)),

  product_status: async (ctx) => checkProductStatus(await loadCatalogueData(ctx), envOf(ctx)),
}

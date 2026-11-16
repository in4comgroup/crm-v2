import "server-only"

import { and, asc, desc, eq, gte, inArray, lte, or, sql, type SQL } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db/drizzle"
import { client, order, orderItem, product, topic, user, type OrderStatus } from "@/db/schema"
import { recordHref, type RecordDetail, type RecordDetailSection, type RecordHit, type RecordTone } from "@/lib/chat/records"
import { ORDER_STATUSES, ORDER_STATUS_LABEL, computeOrderDiscount } from "@/lib/orders-format"
import { getOrderLinkMeta, type OrderLinkMeta } from "@/server/order-links"
import { matchesQuery, norm, relevanceOf, type TextQuery } from "@/server/search/normalise"
import { allFacts, facts, formatDate, formatMoney, isoOrNull, nameList } from "./format"
import {
  basicHit,
  capTotal,
  dateRange,
  loadOrgMembers,
  parseDay,
  personLabel,
  resolvePersonFilter,
  totalOver,
  type OrgMember,
} from "./shared"
import { resolveCompanyFilter } from "./resolve"
import { keepOwnOrg, type RecordModule, type RecordsContext, type SearchOptions } from "./types"

// «Заказ» (order) of the records engine (spec §6.1, §7.2). Visible: every
// order of the org. An order has no number or name → title «Заказ от <дата>».
// Amounts shown are ALWAYS the discounted total (src/app/AGENTS.md § "Order
// discount": `total_amount` is the pre-discount subtotal, the discount is
// derived on read by `computeOrderDiscount`).

const STATUS_TONE: Record<OrderStatus, RecordTone> = {
  draft: "neutral",
  awaiting_client: "warn",
  confirmed: "good",
  finalized: "good",
  cancelled: "bad",
}

const LINK_STATUS_LABELS: Record<OrderLinkMeta["status"], string> = {
  active: "активна",
  used: "клиент подтвердил",
  revoked: "отозвана",
  expired: "истекла",
}

export const orderFilterSchema = z
  .object({
    status: z
      .enum(ORDER_STATUSES as [OrderStatus, ...OrderStatus[]])
      .optional()
      .describe("draft (Черновик), awaiting_client (Ожидает клиента), confirmed (Подтверждён), finalized (Оформлен), cancelled (Отменён)"),
    company: z.string().min(1).optional().describe("Company: id or (part of) the company name"),
    dateFrom: z.string().optional().describe("Order date on / after this day, YYYY-MM-DD"),
    dateTo: z.string().optional().describe("Order date on / before this day, YYYY-MM-DD"),
    amountMin: z.number().nonnegative().optional().describe("Discounted total ≥ this amount"),
    amountMax: z.number().nonnegative().optional().describe("Discounted total ≤ this amount"),
    creator: z.string().min(1).optional().describe('Who created the order: "me" = the signed-in user, or a member name'),
  })
  .strict()
export type OrderFilters = z.infer<typeof orderFilterSchema>

const SORT_KEYS = ["date", "date_asc", "amount", "updated"] as const

/**
 * The discounted total in SQL — the same arithmetic as `computeOrderDiscount`
 * (percent clamped 0–100, discount rounded to kopecks, total ≥ 0), so
 * amount filters / sorting agree with the numbers shown.
 */
const discountedTotalSql = sql<string>`greatest(0, ${order.totalAmount} - round(${order.totalAmount} * least(greatest(${order.discountPercent}, 0), 100)) / 100)`

const cols = {
  id: order.id,
  organizationId: order.organizationId,
  orderDate: order.orderDate,
  description: order.description,
  status: order.status,
  totalAmount: order.totalAmount,
  discountPercent: order.discountPercent,
  currency: order.currency,
  clientId: order.clientId,
  clientName: client.name,
  userId: order.userId,
  updatedAt: order.updatedAt,
}
type OrderRowLite = {
  id: string
  organizationId: string
  orderDate: Date
  description: string | null
  status: OrderStatus
  totalAmount: string
  discountPercent: string
  currency: string
  clientId: string
  clientName: string | null
  userId: string
  updatedAt: Date
}

function amountsOf(r: { totalAmount: string; discountPercent: string }) {
  const total = Number(r.totalAmount)
  return { total, ...computeOrderDiscount(total, Number(r.discountPercent)) }
}

function orderTitle(ctx: RecordsContext, orderDate: Date): string {
  return `Заказ от ${formatDate(orderDate, ctx.timeZone)}`
}

function toHit(ctx: RecordsContext, r: OrderRowLite, members: Map<string, OrgMember>): RecordHit {
  const a = amountsOf(r)
  return {
    type: "order",
    id: r.id,
    title: orderTitle(ctx, r.orderDate),
    subtitle: r.clientName,
    facts: facts([
      { label: "Сумма", value: formatMoney(a.discountedTotal, r.currency) },
      { label: "Скидка", value: a.percent > 0 ? `${a.percent} %` : "" },
      { label: "Автор", value: personLabel(ctx, members, r.userId) },
    ]),
    badge: { label: ORDER_STATUS_LABEL[r.status], tone: STATUS_TONE[r.status] },
    date: isoOrNull(r.orderDate),
    href: recordHref("order", r.id),
  }
}

function baseQuery() {
  return db
    .select({ ...cols, total: totalOver })
    .from(order)
    .innerJoin(client, and(eq(order.clientId, client.id), eq(client.organizationId, order.organizationId)))
}

async function mapRows(ctx: RecordsContext, rows: (OrderRowLite & { total: number })[]) {
  const own = keepOwnOrg(ctx, "order", rows)
  const members = await loadOrgMembers(ctx.orgId)
  return own.map((r) => toHit(ctx, r, members))
}

async function search(ctx: RecordsContext, tq: TextQuery, opts: SearchOptions) {
  const fields = [norm(order.description), norm(client.name)]
  const rows = await baseQuery()
    .where(
      and(
        eq(order.organizationId, ctx.orgId),
        or(...fields.map((f) => matchesQuery(tq, f))),
        dateRange(order.orderDate, opts),
      ),
    )
    .orderBy(desc(relevanceOf(tq, fields)), desc(order.orderDate))
    .limit(opts.limit)
  return { hits: await mapRows(ctx, rows), ...capTotal(rows[0]?.total) }
}

/** Company filter → the org's companies (shared safe resolver, ./resolve.ts). */
function resolveCompanies(ctx: RecordsContext, value: string): Promise<{ id: string; name: string }[]> {
  return resolveCompanyFilter(ctx, value)
}

async function list(ctx: RecordsContext, filters: OrderFilters, sort: string, limit: number) {
  const members = await loadOrgMembers(ctx.orgId)
  const applied: { label: string; value: string }[] = []
  const where: (SQL | undefined)[] = [eq(order.organizationId, ctx.orgId)]

  if (filters.status) {
    where.push(eq(order.status, filters.status))
    applied.push({ label: "Статус", value: ORDER_STATUS_LABEL[filters.status] })
  }
  if (filters.company) {
    const companies = await resolveCompanies(ctx, filters.company)
    where.push(companies.length ? inArray(order.clientId, companies.map((c) => c.id)) : sql`false`)
    applied.push({
      label: "Компания",
      value: companies.length ? nameList([...new Set(companies.map((c) => c.name))]) : `${filters.company} (не найдена)`,
    })
  }
  const from = parseDay(filters.dateFrom, false, ctx.timeZone)
  const to = parseDay(filters.dateTo, true, ctx.timeZone)
  if (from) where.push(gte(order.orderDate, from))
  if (to) where.push(lte(order.orderDate, to))
  if (from || to) {
    applied.push({
      label: "Дата",
      value: [from && `с ${formatDate(from, ctx.timeZone)}`, to && `по ${formatDate(to, ctx.timeZone)}`].filter(Boolean).join(" "),
    })
  }
  if (filters.amountMin != null) where.push(sql`${discountedTotalSql} >= ${filters.amountMin}`)
  if (filters.amountMax != null) where.push(sql`${discountedTotalSql} <= ${filters.amountMax}`)
  if (filters.amountMin != null || filters.amountMax != null) {
    applied.push({
      label: "Сумма",
      value: [
        filters.amountMin != null && `от ${formatMoney(filters.amountMin)}`,
        filters.amountMax != null && `до ${formatMoney(filters.amountMax)}`,
      ]
        .filter(Boolean)
        .join(" "),
    })
  }
  if (filters.creator) {
    const ids = resolvePersonFilter(ctx, members, filters.creator)
    where.push(ids.length ? inArray(order.userId, ids) : sql`false`)
    applied.push({
      label: "Автор",
      value: ids.length ? ids.map((id) => personLabel(ctx, members, id)).join(", ") : `${filters.creator} (не найден)`,
    })
  }

  const orderBy =
    sort === "date_asc"
      ? [asc(order.orderDate)]
      : sort === "amount"
        ? [desc(discountedTotalSql), desc(order.orderDate)]
        : sort === "updated"
          ? [desc(order.updatedAt)]
          : [desc(order.orderDate)]

  const rows = await baseQuery().where(and(...where)).orderBy(...orderBy).limit(limit)
  const own = keepOwnOrg(ctx, "order", rows)
  return { rows: own.map((r) => toHit(ctx, r, members)), ...capTotal(rows[0]?.total), applied }
}

async function get(ctx: RecordsContext, id: string): Promise<RecordDetail | null> {
  const [row] = await db
    .select({ ...cols, topicId: order.topicId, createdAt: order.createdAt, authorName: user.name })
    .from(order)
    .innerJoin(client, and(eq(order.clientId, client.id), eq(client.organizationId, order.organizationId)))
    .leftJoin(user, eq(order.userId, user.id))
    .where(and(eq(order.id, id), eq(order.organizationId, ctx.orgId)))
    .limit(1)
  if (!row || keepOwnOrg(ctx, "order", [row]).length === 0) return null

  const [members, items, link, topicRows] = await Promise.all([
    loadOrgMembers(ctx.orgId),
    db
      .select({
        productId: orderItem.productId,
        productName: product.name,
        quantity: orderItem.quantity,
        unitPrice: orderItem.unitPrice,
        positionPrice: orderItem.positionPrice,
      })
      .from(orderItem)
      .leftJoin(product, and(eq(orderItem.productId, product.id), eq(product.organizationId, ctx.orgId)))
      .where(eq(orderItem.orderId, id))
      .orderBy(asc(orderItem.createdAt)),
    // The order is org-checked above, so the unscoped link lookup is safe.
    getOrderLinkMeta(id),
    ctx.topicsVisible && row.topicId
      ? db
          .select({ id: topic.id, title: topic.title, status: topic.status, lastActivityAt: topic.lastActivityAt })
          .from(topic)
          .where(and(eq(topic.id, row.topicId), eq(topic.organizationId, ctx.orgId)))
          .limit(1)
      : Promise.resolve([]),
  ])

  const tz = ctx.timeZone
  const a = amountsOf(row)
  const topicRow = topicRows[0] ?? null
  const author = personLabel(ctx, members, row.userId) || row.authorName || ""
  const sections: RecordDetailSection[] = []

  const info = allFacts([
    { label: "Компания", value: row.clientName ?? "" },
    { label: "Дата", value: formatDate(row.orderDate, tz) },
    { label: "Статус", value: ORDER_STATUS_LABEL[row.status] },
    // «Сумма» is the discounted total everywhere (hits, list, amount filters);
    // the subtotal and the discount are shown only when there is a discount.
    { label: "Сумма", value: formatMoney(a.discountedTotal, row.currency) },
    { label: "Сумма без скидки", value: a.percent > 0 ? formatMoney(a.total, row.currency) : "" },
    { label: "Скидка", value: a.percent > 0 ? `${a.percent} % (${formatMoney(a.discountAmount, row.currency)})` : "" },
    { label: "Автор", value: author },
    { label: "Тема", value: topicRow?.title ?? "" },
  ])
  // Facts with links: company + topic.
  const linked = info.map((f) =>
    f.label === "Компания"
      ? { ...f, href: recordHref("client", row.clientId) }
      : f.label === "Тема" && topicRow
        ? { ...f, href: recordHref("topic", topicRow.id) }
        : f,
  )
  if (linked.length) sections.push({ kind: "facts", title: "Сведения", items: linked })

  if (items.length) {
    sections.push({
      kind: "table",
      title: "Позиции",
      columns: ["Товар", "Кол-во", "Цена", "Сумма"],
      rows: items.map((it) => [
        it.productName ?? "—",
        String(it.quantity),
        formatMoney(it.unitPrice, row.currency),
        formatMoney(it.positionPrice, row.currency),
      ]),
    })
  }
  if (row.description?.trim()) sections.push({ kind: "text", title: "Описание", markdown: row.description.trim() })

  if (link) {
    // An `active` grant past its window reads as expired (nothing flips the row).
    const live = link.status === "active" && new Date(link.expiresAt).getTime() > ctx.now.getTime()
    const linkStatus = link.status === "active" && !live ? "expired" : link.status
    const linkFacts = allFacts([
      { label: "Состояние", value: LINK_STATUS_LABELS[linkStatus] ?? linkStatus },
      { label: "Отправлено", value: link.recipientEmail ?? "" },
      { label: live ? "Действует до" : "Срок истёк", value: link.status === "active" ? formatDate(link.expiresAt, tz) : "" },
      {
        label: "Клиент открывал",
        value: link.lastAccessedAt ? formatDate(link.lastAccessedAt, tz) : live ? "ещё не открывал" : "",
      },
      { label: "Подтверждено", value: link.confirmedAt ? formatDate(link.confirmedAt, tz) : "" },
    ])
    if (linkFacts.length) sections.push({ kind: "facts", title: "Ссылка для клиента", items: linkFacts })
  }

  const links: RecordHit[] = [basicHit("client", row.clientId, row.clientName ?? "Компания")]
  if (topicRow) links.push(basicHit("topic", topicRow.id, topicRow.title, null, [], isoOrNull(topicRow.lastActivityAt)))
  sections.push({ kind: "records", title: "Связано", items: links })

  return {
    type: "order",
    id,
    title: orderTitle(ctx, row.orderDate),
    subtitle: row.clientName,
    badges: [{ label: ORDER_STATUS_LABEL[row.status], tone: STATUS_TONE[row.status] }],
    sections,
    href: recordHref("order", id),
  }
}

export const ordersModule: RecordModule<OrderFilters> = {
  type: "order",
  filterSchema: orderFilterSchema,
  sortKeys: SORT_KEYS,
  search,
  list,
  get,
}

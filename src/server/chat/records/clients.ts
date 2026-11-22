import "server-only"

import { and, asc, desc, eq, inArray, notInArray, or, sql, type SQL } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db/drizzle"
import { client, clientCoResponsible, clientProfile, contact, deal, dealFunnelStage, industry, order, topic } from "@/db/schema"
import { recordHref, type RecordDetail, type RecordDetailSection, type RecordHit } from "@/lib/chat/records"
import {
  CLIENT_RELATIONS,
  CLIENT_RELATION_LABELS,
  clientRelation,
  type ClientRelation,
} from "@/lib/client-relation"
import { OPEN_DEAL_STATUSES } from "@/lib/deal-funnel"
import { computeOrderDiscount } from "@/lib/orders-format"
import { loadCustomValuesText } from "@/server/custom-fields"
import { loadEntityDocumentsForChat } from "@/server/documents-chat"
import { loadClientProfileTexts } from "@/server/identity/client-profile-context"
import {
  containsQuery,
  matchesQuery,
  norm,
  normArray,
  relevanceOf,
  type TextQuery,
} from "@/server/search/normalise"
import { allFacts, facts, formatDate, formatMoney, isoOrNull, shortText } from "./format"
import {
  basicHit,
  capTotal,
  loadClientDealFlags,
  loadOrgMembers,
  parseDay,
  personLabel,
  resolvePersonFilter,
  totalOver,
  type OrgMember,
} from "./shared"
import { keepOwnOrg, type RecordModule, type RecordsContext } from "./types"
import { contactDisplaySql } from "@/server/contact-display"

// «Компания» (client) — reference module of the records engine (spec §6.1).
// Visible: every company of the org except `deleted` / `blocked`.

const HIDDEN_STATUSES = ["deleted", "blocked"] as const
const STATUS_LABELS: Record<string, string> = {
  active: "Активна",
  suspended: "Приостановлена",
  initial: "Новая",
}

export const clientFilterSchema = z
  .object({
    relation: z
      .enum(CLIENT_RELATIONS)
      .optional()
      .describe("Relationship tab: customers (won deal), potential (open deal), supplier, partner, unclassified"),
    responsible: z
      .string()
      .min(1)
      .optional()
      .describe('«Ответственный»: "me" = the signed-in user, "none" = not set, or a member name'),
    industry: z.string().min(1).optional().describe("Industry (Отрасль) name or code from the company profile"),
    status: z.enum(["active", "suspended", "initial"]).optional(),
    createdFrom: z.string().optional().describe("Added to the CRM on / after this day, YYYY-MM-DD"),
    createdTo: z.string().optional().describe("Added to the CRM on / before this day, YYYY-MM-DD"),
  })
  .strict()
export type ClientFilters = z.infer<typeof clientFilterSchema>

const SORT_KEYS = ["updated", "name", "created"] as const

const cols = {
  id: client.id,
  organizationId: client.organizationId,
  name: client.name,
  namePhys: client.namePhys,
  email: client.email,
  phone: client.phone,
  webUrl: client.webUrl,
  status: client.status,
  customFields: client.customFields,
  responsibleUserId: client.responsibleUserId,
  createdAt: client.createdAt,
  updatedAt: client.updatedAt,
  industryLabel: industry.labelRu,
}
type ClientRowLite = {
  id: string
  organizationId: string | null
  name: string
  namePhys: string | null
  email: string | null
  phone: string | null
  webUrl: string | null
  status: string
  customFields: unknown
  responsibleUserId: string | null
  createdAt: Date
  updatedAt: Date | null
  industryLabel: string | null
}

function kindOf(customFields: unknown): unknown {
  return customFields && typeof customFields === "object"
    ? (customFields as Record<string, unknown>).companyKind
    : undefined
}

function relationOf(r: ClientRowLite, flags: { won: Set<string>; open: Set<string> }): ClientRelation {
  return clientRelation({
    companyKind: kindOf(r.customFields),
    hasWonDeal: flags.won.has(r.id),
    hasOpenDeal: flags.open.has(r.id),
  })
}

function toHit(
  ctx: RecordsContext,
  r: ClientRowLite,
  relation: ClientRelation,
  members: Map<string, OrgMember>,
): RecordHit {
  const subtitle = [CLIENT_RELATION_LABELS[relation], r.industryLabel].filter(Boolean).join(" · ")
  return {
    type: "client",
    id: r.id,
    title: r.name,
    subtitle: subtitle || null,
    facts: facts([
      { label: "Ответственный", value: personLabel(ctx, members, r.responsibleUserId) },
      { label: "Email", value: r.email ?? "" },
      { label: "Телефон", value: r.phone ?? "" },
      { label: "Сайт", value: r.webUrl ?? "" },
    ]),
    badge: r.status !== "active" ? { label: STATUS_LABELS[r.status] ?? r.status, tone: "warn" } : null,
    date: isoOrNull(r.updatedAt ?? r.createdAt),
    href: recordHref("client", r.id),
  }
}

function baseQuery() {
  return db
    .select({ ...cols, total: totalOver })
    .from(client)
    .leftJoin(clientProfile, eq(clientProfile.clientId, client.id))
    .leftJoin(industry, eq(clientProfile.industryCode, industry.code))
}

async function mapRows(ctx: RecordsContext, rows: (ClientRowLite & { total: number })[]) {
  const own = keepOwnOrg(ctx, "client", rows)
  const [flags, members] = await Promise.all([
    loadClientDealFlags(
      ctx.orgId,
      own.map((r) => r.id),
    ),
    loadOrgMembers(ctx.orgId),
  ])
  return own.map((r) => toHit(ctx, r, relationOf(r, flags), members))
}

async function search(ctx: RecordsContext, tq: TextQuery, opts: { limit: number }) {
  const fields = [norm(client.name), norm(client.namePhys), normArray(client.aliases)]
  const rows = await baseQuery()
    .where(
      and(
        eq(client.organizationId, ctx.orgId),
        notInArray(client.status, [...HIDDEN_STATUSES]),
        or(
          ...fields.map((f) => matchesQuery(tq, f)),
          matchesQuery(tq, norm(client.webUrl)),
          containsQuery(tq, norm(client.email)),
          containsQuery(tq, norm(client.phone)),
        ),
      ),
    )
    .orderBy(desc(relevanceOf(tq, fields)), desc(client.updatedAt))
    .limit(opts.limit)
  return { hits: await mapRows(ctx, rows), ...capTotal(rows[0]?.total) }
}

async function list(ctx: RecordsContext, filters: ClientFilters, sort: string, limit: number) {
  const members = await loadOrgMembers(ctx.orgId)
  const applied: { label: string; value: string }[] = []
  const where: (SQL | undefined)[] = [
    eq(client.organizationId, ctx.orgId),
    notInArray(client.status, [...HIDDEN_STATUSES]),
  ]

  if (filters.status) {
    where.push(eq(client.status, filters.status))
    applied.push({ label: "Статус", value: STATUS_LABELS[filters.status] })
  }
  if (filters.responsible) {
    const v = filters.responsible.trim().toLowerCase()
    if (v === "none" || v === "нет") {
      where.push(sql`${client.responsibleUserId} is null`)
      applied.push({ label: "Ответственный", value: "не назначен" })
    } else {
      const ids = resolvePersonFilter(ctx, members, filters.responsible)
      // The main OR an additional responsible member («Также отвечают», 2026-11-19).
      where.push(
        ids.length
          ? or(
              inArray(client.responsibleUserId, ids),
              sql`exists (select 1 from ${clientCoResponsible} where ${clientCoResponsible.clientId} = ${client.id} and ${inArray(clientCoResponsible.userId, ids)})`,
            )!
          : sql`false`,
      )
      applied.push({
        label: "Ответственный",
        value: ids.length ? ids.map((id) => personLabel(ctx, members, id)).join(", ") : `${filters.responsible} (не найден)`,
      })
    }
  }
  if (filters.industry) {
    const v = filters.industry.trim()
    where.push(or(eq(clientProfile.industryCode, v), sql`lower(${industry.labelRu}) like ${`%${v.toLowerCase()}%`}`))
    applied.push({ label: "Отрасль", value: v })
  }
  const from = parseDay(filters.createdFrom, false, ctx.timeZone)
  const to = parseDay(filters.createdTo, true, ctx.timeZone)
  if (from) where.push(sql`${client.createdAt} >= ${from.toISOString()}`)
  if (to) where.push(sql`${client.createdAt} <= ${to.toISOString()}`)
  if (from || to) {
    applied.push({
      label: "Добавлена",
      value: [from && `с ${formatDate(from, ctx.timeZone)}`, to && `по ${formatDate(to, ctx.timeZone)}`].filter(Boolean).join(" "),
    })
  }

  const order =
    sort === "name" ? [asc(client.name)] : sort === "created" ? [desc(client.createdAt)] : [desc(client.updatedAt)]

  // The relationship is derived from deals (not a column), so that filter
  // runs in JS over the org's companies — tens to hundreds of rows.
  if (filters.relation) {
    const rows = await baseQuery().where(and(...where)).orderBy(...order)
    const own = keepOwnOrg(ctx, "client", rows)
    const flags = await loadClientDealFlags(ctx.orgId)
    const matching = own.filter((r) => relationOf(r, flags) === filters.relation)
    applied.unshift({ label: "Отношения", value: CLIENT_RELATION_LABELS[filters.relation] })
    return {
      rows: matching.slice(0, limit).map((r) => toHit(ctx, r, filters.relation!, members)),
      ...capTotal(matching.length),
      applied,
    }
  }

  const rows = await baseQuery().where(and(...where)).orderBy(...order).limit(limit)
  return { rows: await mapRows(ctx, rows), ...capTotal(rows[0]?.total), applied }
}

async function get(ctx: RecordsContext, id: string): Promise<RecordDetail | null> {
  const [row] = await db
    .select({ ...cols, comment: client.comment, address: client.address })
    .from(client)
    .leftJoin(clientProfile, eq(clientProfile.clientId, client.id))
    .leftJoin(industry, eq(clientProfile.industryCode, industry.code))
    .where(and(eq(client.id, id), eq(client.organizationId, ctx.orgId), notInArray(client.status, [...HIDDEN_STATUSES])))
    .limit(1)
  if (!row || keepOwnOrg(ctx, "client", [row]).length === 0) return null

  const [coIds, flags, members, profiles, customText, docs, contacts, deals, orders, topics] = await Promise.all([
    db
      .select({ userId: clientCoResponsible.userId })
      .from(clientCoResponsible)
      .where(and(eq(clientCoResponsible.clientId, id), eq(clientCoResponsible.organizationId, ctx.orgId)))
      .orderBy(clientCoResponsible.createdAt)
      .then((rows) => rows.map((r) => r.userId)),
    loadClientDealFlags(ctx.orgId, [id]),
    loadOrgMembers(ctx.orgId),
    loadClientProfileTexts(ctx.orgId, [id]),
    loadCustomValuesText(ctx.orgId, "client", [id], 1200),
    loadEntityDocumentsForChat(ctx.orgId, [{ entityType: "client", entityId: id }], 8),
    db
      .select({ id: contact.id, name: contactDisplaySql(), position: contact.position, email: contact.email })
      .from(contact)
      .where(and(eq(contact.organizationId, ctx.orgId), eq(contact.clientId, id), notInArray(contact.status, [...HIDDEN_STATUSES])))
      .orderBy(asc(contactDisplaySql()))
      .limit(10),
    db
      .select({
        id: deal.id,
        name: deal.name,
        value: deal.value,
        currency: deal.currency,
        stageName: dealFunnelStage.name,
        stageDisplay: dealFunnelStage.displayName,
        updatedAt: deal.updatedAt,
      })
      .from(deal)
      .innerJoin(dealFunnelStage, eq(deal.funnelStageId, dealFunnelStage.id))
      .where(and(eq(deal.organizationId, ctx.orgId), eq(deal.clientId, id), inArray(deal.status, [...OPEN_DEAL_STATUSES])))
      .orderBy(desc(deal.updatedAt))
      .limit(10),
    db
      .select({
        id: order.id,
        orderDate: order.orderDate,
        status: order.status,
        total: order.totalAmount,
        discountPercent: order.discountPercent,
        currency: order.currency,
      })
      .from(order)
      .where(and(eq(order.organizationId, ctx.orgId), eq(order.clientId, id)))
      .orderBy(desc(order.orderDate))
      .limit(5),
    ctx.topicsVisible
      ? db
          .select({ id: topic.id, title: topic.title, lastActivityAt: topic.lastActivityAt })
          .from(topic)
          .where(and(eq(topic.organizationId, ctx.orgId), eq(topic.clientId, id), inArray(topic.status, ["open", "dormant"])))
          .orderBy(desc(topic.lastActivityAt))
          .limit(5)
      : Promise.resolve([]),
  ])

  const relation = relationOf(row, flags)
  const discount = Number((row.customFields as Record<string, unknown> | null)?.discount)
  const tz = ctx.timeZone
  const sections: RecordDetailSection[] = []

  const info = allFacts([
    { label: "Отношения", value: CLIENT_RELATION_LABELS[relation] },
    { label: "Отрасль", value: row.industryLabel ?? "" },
    { label: "Ответственный", value: personLabel(ctx, members, row.responsibleUserId) },
    { label: "Также отвечают", value: coIds.map((u) => personLabel(ctx, members, u)).join(", ") },
    { label: "Юр. название", value: row.namePhys ?? "" },
    { label: "Email", value: row.email ?? "" },
    { label: "Телефон", value: row.phone ?? "" },
    { label: "Сайт", value: row.webUrl ?? "" },
    { label: "Адрес", value: row.address ?? "" },
    { label: "Скидка", value: Number.isFinite(discount) && discount > 0 ? `${discount} %` : "" },
    { label: "Добавлена", value: formatDate(row.createdAt, tz) },
  ])
  if (info.length) sections.push({ kind: "facts", title: "Сведения", items: info })

  const profile = profiles.get(id)?.summary
  if (profile) sections.push({ kind: "text", title: "Профиль компании", markdown: profile })
  const custom = customText.get(id)
  if (custom) sections.push({ kind: "text", title: "Поля компании", markdown: custom })
  if (row.comment?.trim()) sections.push({ kind: "text", title: "Комментарий", markdown: row.comment.trim() })

  if (contacts.length) {
    sections.push({
      kind: "records",
      title: "Контакты",
      items: contacts.map((c) => basicHit("contact", c.id, c.name, c.position ?? c.email ?? null)),
    })
  }
  if (deals.length) {
    sections.push({
      kind: "records",
      title: "Открытые сделки",
      items: deals.map((d) =>
        basicHit("deal", d.id, d.name, d.stageDisplay ?? d.stageName, facts([{ label: "Сумма", value: formatMoney(d.value, d.currency) }]), isoOrNull(d.updatedAt)),
      ),
    })
  }
  if (orders.length) {
    sections.push({
      kind: "records",
      title: "Последние заказы",
      items: orders.map((o) =>
        basicHit(
          "order",
          o.id,
          `Заказ от ${formatDate(o.orderDate, tz)}`,
          null,
          // The amount the client pays: net of the per-client discount, as everywhere in the app.
          facts([
            {
              label: "Сумма",
              value: formatMoney(
                computeOrderDiscount(Number(o.total), Number(o.discountPercent)).discountedTotal,
                o.currency,
              ),
            },
          ]),
          isoOrNull(o.orderDate),
        ),
      ),
    })
  }
  if (topics.length) {
    sections.push({
      kind: "records",
      title: "Открытые темы",
      items: topics.map((t) => basicHit("topic", t.id, t.title, null, [], isoOrNull(t.lastActivityAt))),
    })
  }
  const docList = docs.get(`client:${id}`) ?? []
  if (docList.length) {
    sections.push({
      kind: "text",
      title: "Документы",
      markdown: docList.map((d) => `- ${d.name}${d.summary ? ` — ${shortText(d.summary, 160)}` : ""}`).join("\n"),
    })
  }

  return {
    type: "client",
    id,
    title: row.name,
    subtitle: [CLIENT_RELATION_LABELS[relation], row.industryLabel].filter(Boolean).join(" · ") || null,
    badges: row.status !== "active" ? [{ label: STATUS_LABELS[row.status] ?? row.status, tone: "warn" }] : [],
    sections,
    href: recordHref("client", id),
  }
}

export const clientsModule: RecordModule<ClientFilters> = {
  type: "client",
  filterSchema: clientFilterSchema,
  sortKeys: SORT_KEYS,
  search: (ctx, tq, opts) => search(ctx, tq, opts),
  list,
  get,
}

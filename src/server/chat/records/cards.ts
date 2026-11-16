import "server-only"

import { and, asc, desc, eq, exists, gte, inArray, isNotNull, isNull, lte, ne, or, sql, type SQL } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { z } from "zod"
import { db } from "@/db/drizzle"
import {
  card,
  cardClient,
  client,
  deal,
  order,
  sourceItem,
  task,
  topic,
  user,
  type CardCategory,
  type CardPriority,
} from "@/db/schema"
import { recordHref, type RecordDetail, type RecordDetailSection, type RecordHit, type RecordTone } from "@/lib/chat/records"
import {
  CARD_KINDS,
  CARD_KIND_LABELS_RU,
  CARD_REJECT_REASON_LABELS_RU,
  CARD_STATUS_LABELS_RU,
  isCardKind,
  isCardRejectReason,
  isCardStatus,
  type DealCardProposal,
} from "@/lib/topics/cards"
import { matchesQuery, norm, normJsonText, relevanceOf, type TextQuery } from "@/server/search/normalise"
import { effectiveCardStatus } from "@/server/topics/cards/logic"
import { userCardFilter } from "@/server/topics/cards/visibility"
import { allFacts, facts, formatDate, formatDateTime, isoOrNull, nameList, shortText } from "./format"
import { basicHit, capTotal, dateRange, parseDay, totalOver } from "./shared"
import { resolveCompanyFilter } from "./resolve"
import { keepOwnOrg, type RecordModule, type RecordsContext, type SearchOptions } from "./types"

// «Карточка» (card) of the records engine (spec §6.1, §7.2). Exists for
// users ONLY in topics mode `on` (ctx.topicsVisible) and then only the rows
// of `userCardFilter` — the same rule as the dashboard, the card page and
// the header search: old Custom-rule cards (`kind` null, read-only history
// «История карточек») + topic / deal cards that are open and not expired,
// accepted or rejected. Superseded / expired / closed cards are admin-only.

// Labels copied from the card UI (card-detail-shell.tsx / cards-feed-section.tsx
// are client modules and cannot be imported here).
const PRIORITY_LABEL: Record<CardPriority, string> = { normal: "Обычный", high: "Высокий" }
const CATEGORY_LABEL: Record<CardCategory, string> = {
  client_activity: "Активность клиента",
  colleagues_activity: "Активность коллег",
  business_info: "Бизнес-информация",
  action_required: "Нужен ответ",
  ambiguity: "Неоднозначность",
  data_intelligence: "Аналитика данных",
  momentum: "Динамика",
  log_only: "Только запись",
  new_order: "Новый заказ",
  support: "Поддержка",
}
/** An old card that nobody decided (dashboard-card.tsx badge). */
const OLD_PENDING_LABEL = "Требуется решение"

const USER_STATUSES = ["open", "accepted", "rejected"] as const
type UserStatus = (typeof USER_STATUSES)[number]
const STATUS_TONE: Record<string, RecordTone> = {
  open: "warn",
  accepted: "good",
  rejected: "neutral",
}

const KIND_FILTERS = [...CARD_KINDS, "history"] as const

export const cardFilterSchema = z
  .object({
    status: z
      .enum(USER_STATUSES)
      .optional()
      .describe("open = waiting for a decision (not expired), accepted, rejected"),
    kind: z
      .enum(KIND_FILTERS)
      .optional()
      .describe(
        "topic (topic card), deal_proposal (new deal?), stage_confirmation (confirm a deal stage), deal_link (which deal?), history (old cards «История карточек»)",
      ),
    company: z.string().min(1).optional().describe("Company: id or (part of) the company name"),
    dateFrom: z.string().optional().describe("Card created on / after this day, YYYY-MM-DD"),
    dateTo: z.string().optional().describe("Card created on / before this day, YYYY-MM-DD"),
  })
  .strict()
export type CardFilters = z.infer<typeof cardFilterSchema>

const SORT_KEYS = ["created", "created_asc", "priority"] as const

const topicClient = alias(client, "card_topic_client")

/** Name of the first linked company of the card (card_client), same org. */
function linkedClientName(orgId: string): SQL<string | null> {
  return sql<string | null>`(
    select ${client.name} from ${cardClient}
    join ${client} on ${client.id} = ${cardClient.clientId}
    where ${cardClient.cardId} = ${card.id} and ${client.organizationId} = ${orgId}
    order by ${client.name} limit 1)`
}

function cols(orgId: string) {
  return {
    id: card.id,
    organizationId: card.organizationId,
    kind: card.kind,
    status: card.status,
    accepted: card.accepted,
    rejectionReason: card.rejectionReason,
    expiresAt: card.expiresAt,
    priority: card.priority,
    category: card.category,
    message: card.message,
    createdAt: card.createdAt,
    topicId: card.topicId,
    topicClientId: topicClient.id,
    topicClientName: topicClient.name,
    linkedClientName: linkedClientName(orgId),
  }
}
type CardRowLite = {
  id: string
  organizationId: string
  kind: string | null
  status: string | null
  accepted: boolean
  rejectionReason: string | null
  expiresAt: Date | null
  priority: CardPriority
  category: CardCategory
  message: unknown
  createdAt: Date
  topicId: string | null
  topicClientId: string | null
  topicClientName: string | null
  linkedClientName: string | null
}

type Msg = {
  analysis: string
  recommendation: string
  headline: string
  whyNow: string
  whatChanged: string
  steps: string[]
}

function messageOf(raw: unknown): Msg {
  const m = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "")
  const tc = m.topicCard && typeof m.topicCard === "object" ? (m.topicCard as Record<string, unknown>) : {}
  const dc = m.dealCard && typeof m.dealCard === "object" ? (m.dealCard as Record<string, unknown>) : {}
  return {
    analysis: s(m.analysis),
    recommendation: s(m.recommendation),
    headline: s(tc.headline) || s(dc.headline),
    whyNow: s(tc.whyNow),
    whatChanged: s(tc.whatChanged),
    steps: Array.isArray(tc.steps) ? tc.steps.map(s).filter(Boolean) : [],
  }
}

function titleOf(r: { kind: string | null; category: CardCategory; message: unknown }): string {
  const m = messageOf(r.message)
  if (m.headline) return m.headline
  const firstLine = m.analysis.split("\n").find((l) => l.trim()) ?? ""
  return shortText(firstLine, 120) || (isCardKind(r.kind) ? CARD_KIND_LABELS_RU[r.kind] : CATEGORY_LABEL[r.category])
}

/** Status as the user sees it: topic cards by effective status, old cards by accepted / rejection. */
function statusOf(
  r: { kind: string | null; status: string | null; accepted: boolean; rejectionReason: string | null; expiresAt: Date | null },
  now: Date,
): { key: string; label: string } {
  if (r.kind == null) {
    if (r.accepted) return { key: "accepted", label: CARD_STATUS_LABELS_RU.accepted }
    if (r.rejectionReason) return { key: "rejected", label: CARD_STATUS_LABELS_RU.rejected }
    return { key: "open", label: OLD_PENDING_LABEL }
  }
  const st = effectiveCardStatus(r.status, r.expiresAt, now) ?? ""
  return { key: st, label: isCardStatus(st) ? CARD_STATUS_LABELS_RU[st] : st }
}

function kindLabel(r: { kind: string | null; category: CardCategory }): string {
  return isCardKind(r.kind) ? CARD_KIND_LABELS_RU[r.kind] : CATEGORY_LABEL[r.category]
}

function companyName(r: CardRowLite): string | null {
  return r.topicClientName ?? r.linkedClientName ?? null
}

function toHit(ctx: RecordsContext, r: CardRowLite): RecordHit {
  const st = statusOf(r, ctx.now)
  const company = companyName(r)
  return {
    type: "card",
    id: r.id,
    title: titleOf(r),
    subtitle: [company, kindLabel(r)].filter(Boolean).join(" · ") || null,
    facts: facts([
      { label: "Статус", value: st.label },
      { label: "Приоритет", value: PRIORITY_LABEL[r.priority] },
    ]),
    // Badge only while a decision is pending; decided cards carry the status as a fact.
    badge: st.key === "open" ? { label: st.label, tone: STATUS_TONE.open } : null,
    date: isoOrNull(r.createdAt),
    href: recordHref("card", r.id),
  }
}

/** Effective user status in SQL (same rule as `statusOf`). */
function statusWhere(s: UserStatus, now: Date): SQL {
  const old = isNull(card.kind)
  const eng = isNotNull(card.kind)
  switch (s) {
    case "open":
      return or(
        and(old, eq(card.accepted, false), isNull(card.rejectionReason)),
        and(eng, eq(card.status, "open"), or(isNull(card.expiresAt), sql`${card.expiresAt} > ${now.toISOString()}`)),
      )!
    case "accepted":
      return or(and(old, eq(card.accepted, true)), and(eng, eq(card.status, "accepted")))!
    case "rejected":
      return or(
        and(old, eq(card.accepted, false), isNotNull(card.rejectionReason)),
        and(eng, eq(card.status, "rejected")),
      )!
  }
}

function baseQuery(orgId: string) {
  return db
    .select({ ...cols(orgId), total: totalOver })
    .from(card)
    .leftJoin(topic, and(eq(card.topicId, topic.id), eq(topic.organizationId, orgId)))
    .leftJoin(topicClient, and(eq(topic.clientId, topicClient.id), eq(topicClient.organizationId, orgId)))
}

const EMPTY = { hits: [], total: 0, capped: false }

async function search(ctx: RecordsContext, tq: TextQuery, opts: SearchOptions) {
  if (!ctx.topicsVisible) return EMPTY
  const fields = [normJsonText(card.message), norm(card.sinceLast)]
  const rows = await baseQuery(ctx.orgId)
    .where(
      and(
        eq(card.organizationId, ctx.orgId),
        await userCardFilter(ctx.orgId, ctx.now),
        or(...fields.map((f) => matchesQuery(tq, f))),
        dateRange(card.createdAt, opts),
      ),
    )
    .orderBy(desc(relevanceOf(tq, fields)), desc(card.createdAt))
    .limit(opts.limit)
  const own = keepOwnOrg(ctx, "card", rows)
  return { hits: own.map((r) => toHit(ctx, r)), ...capTotal(rows[0]?.total) }
}

/** Company filter → the org's companies (shared safe resolver, ./resolve.ts). */
function resolveCompanies(ctx: RecordsContext, value: string): Promise<{ id: string; name: string }[]> {
  return resolveCompanyFilter(ctx, value)
}

async function list(ctx: RecordsContext, filters: CardFilters, sort: string, limit: number) {
  if (!ctx.topicsVisible) return { rows: [], total: 0, capped: false, applied: [] }
  const applied: { label: string; value: string }[] = []
  const where: (SQL | undefined)[] = [eq(card.organizationId, ctx.orgId), await userCardFilter(ctx.orgId, ctx.now)]

  if (filters.status) {
    where.push(statusWhere(filters.status, ctx.now))
    applied.push({
      label: "Статус",
      value: filters.status === "open" ? "ждёт решения" : CARD_STATUS_LABELS_RU[filters.status],
    })
  }
  if (filters.kind) {
    where.push(filters.kind === "history" ? isNull(card.kind) : eq(card.kind, filters.kind))
    applied.push({
      label: "Вид",
      value: filters.kind === "history" ? "История карточек" : CARD_KIND_LABELS_RU[filters.kind],
    })
  }
  if (filters.company) {
    const companies = await resolveCompanies(ctx, filters.company)
    const ids = companies.map((c) => c.id)
    where.push(
      ids.length
        ? or(
            inArray(topic.clientId, ids),
            exists(
              db
                .select({ one: sql`1` })
                .from(cardClient)
                .where(and(eq(cardClient.cardId, card.id), inArray(cardClient.clientId, ids))),
            ),
          )
        : sql`false`,
    )
    applied.push({
      label: "Компания",
      value: companies.length ? nameList([...new Set(companies.map((c) => c.name))]) : `${filters.company} (не найдена)`,
    })
  }
  const from = parseDay(filters.dateFrom, false, ctx.timeZone)
  const to = parseDay(filters.dateTo, true, ctx.timeZone)
  if (from) where.push(gte(card.createdAt, from))
  if (to) where.push(lte(card.createdAt, to))
  if (from || to) {
    applied.push({
      label: "Создана",
      value: [from && `с ${formatDate(from, ctx.timeZone)}`, to && `по ${formatDate(to, ctx.timeZone)}`].filter(Boolean).join(" "),
    })
  }

  const orderBy =
    sort === "created_asc"
      ? [asc(card.createdAt)]
      : sort === "priority"
        ? [sql`case when ${card.priority} = 'high' then 0 else 1 end`, desc(card.createdAt)]
        : [desc(card.createdAt)]

  const rows = await baseQuery(ctx.orgId).where(and(...where)).orderBy(...orderBy).limit(limit)
  const own = keepOwnOrg(ctx, "card", rows)
  return { rows: own.map((r) => toHit(ctx, r)), ...capTotal(rows[0]?.total), applied }
}

function proposalOf(raw: unknown): DealCardProposal | null {
  const p = raw as DealCardProposal | null
  return p && typeof p === "object" && p.v === 1 && typeof p.action === "string" ? p : null
}

async function get(ctx: RecordsContext, id: string): Promise<RecordDetail | null> {
  if (!ctx.topicsVisible) return null
  const [row] = await db
    .select({
      ...cols(ctx.orgId),
      sinceLast: card.sinceLast,
      rejectReasonCode: card.rejectReasonCode,
      decidedAt: card.decidedAt,
      decidedByName: user.name,
      dealId: card.dealId,
      proposal: card.proposal,
      resultTaskId: card.resultTaskId,
      resultOrderId: card.resultOrderId,
      sourceItemId: card.sourceItemId,
      topicTitle: topic.title,
      topicDealId: topic.dealId,
      topicLastActivityAt: topic.lastActivityAt,
    })
    .from(card)
    .leftJoin(topic, and(eq(card.topicId, topic.id), eq(topic.organizationId, ctx.orgId)))
    .leftJoin(topicClient, and(eq(topic.clientId, topicClient.id), eq(topicClient.organizationId, ctx.orgId)))
    .leftJoin(user, eq(card.decidedByUserId, user.id))
    .where(and(eq(card.id, id), eq(card.organizationId, ctx.orgId), await userCardFilter(ctx.orgId, ctx.now)))
    .limit(1)
  if (!row || keepOwnOrg(ctx, "card", [row]).length === 0) return null

  const dealId = row.dealId ?? row.topicDealId
  const [linkedClients, deals, tasks, orders, sources] = await Promise.all([
    db
      .select({ id: client.id, name: client.name })
      .from(cardClient)
      .innerJoin(client, eq(cardClient.clientId, client.id))
      .where(and(eq(cardClient.cardId, id), eq(client.organizationId, ctx.orgId), ne(client.status, "deleted")))
      .orderBy(asc(client.name)),
    dealId
      ? db
          .select({ id: deal.id, name: deal.name })
          .from(deal)
          .where(and(eq(deal.id, dealId), eq(deal.organizationId, ctx.orgId), ne(deal.status, "deleted")))
          .limit(1)
      : Promise.resolve([]),
    row.resultTaskId
      ? db
          .select({ id: task.id, name: task.name })
          .from(task)
          .where(and(eq(task.id, row.resultTaskId), eq(task.organizationId, ctx.orgId)))
          .limit(1)
      : Promise.resolve([]),
    row.resultOrderId
      ? db
          .select({ id: order.id, orderDate: order.orderDate })
          .from(order)
          .where(and(eq(order.id, row.resultOrderId), eq(order.organizationId, ctx.orgId)))
          .limit(1)
      : Promise.resolve([]),
    row.sourceItemId
      ? db
          .select({ id: sourceItem.id, filename: sourceItem.filename, meta: sourceItem.metadataJson, at: sourceItem.sourceCreatedAt })
          .from(sourceItem)
          .where(and(eq(sourceItem.id, row.sourceItemId), eq(sourceItem.organizationId, ctx.orgId), ne(sourceItem.parseStatus, "skipped")))
          .limit(1)
      : Promise.resolve([]),
  ])

  const tz = ctx.timeZone
  const m = messageOf(row.message)
  const st = statusOf(row, ctx.now)
  const isTopicCard = row.kind != null
  const proposal = isTopicCard ? proposalOf(row.proposal) : null
  const company = row.topicClientId
    ? { id: row.topicClientId, name: row.topicClientName ?? "" }
    : (linkedClients[0] ?? null)
  const sections: RecordDetailSection[] = []

  const codeLabel = isCardRejectReason(row.rejectReasonCode) ? CARD_REJECT_REASON_LABELS_RU[row.rejectReasonCode] : ""
  const freeText = row.rejectionReason?.trim() ?? ""
  const reason = [codeLabel, freeText !== codeLabel ? freeText : ""].filter(Boolean).join(" — ")
  const info = allFacts([
    { label: "Вид", value: kindLabel(row) },
    { label: "Статус", value: st.label },
    { label: "Приоритет", value: PRIORITY_LABEL[row.priority] },
    { label: "Компания", value: company?.name ?? "" },
    { label: "Создана", value: formatDate(row.createdAt, tz) },
    { label: "Действует до", value: st.key === "open" && row.expiresAt ? formatDate(row.expiresAt, tz) : "" },
    { label: "Решение", value: row.decidedAt ? [formatDateTime(row.decidedAt, tz), row.decidedByName].filter(Boolean).join(", ") : "" },
    { label: "Причина отклонения", value: st.key === "rejected" ? reason : "" },
  ]).map((f) => (f.label === "Компания" && company ? { ...f, href: recordHref("client", company.id) } : f))
  if (info.length) sections.push({ kind: "facts", title: "Сведения", items: info })

  if (isTopicCard) {
    if (m.whyNow) sections.push({ kind: "text", title: "Почему сейчас", markdown: m.whyNow })
    const changed = row.sinceLast?.trim() || m.whatChanged
    if (changed) sections.push({ kind: "text", title: "Что изменилось", markdown: changed })
    if (m.steps.length) {
      sections.push({
        kind: "text",
        title: "Шаги",
        markdown: m.steps.map((s, i) => `${i + 1}. ${s.replace(/^\d+[.)]\s*/, "")}`).join("\n"),
      })
    }
    if (proposal) {
      const p = allFacts([
        { label: "Сделка", value: proposal.dealName },
        { label: "Тип", value: proposal.dealTypeLabelRu ?? "" },
        { label: "Стадия", value: [proposal.fromStageLabelRu, proposal.stageLabelRu].filter(Boolean).join(" → ") },
        { label: "Сигнал", value: proposal.codeLabelRu },
        { label: "Почему решает человек", value: proposal.reasonRu },
        {
          label: "Варианты",
          value: nameList((proposal.dealOptions ?? []).map((o) => o.name), 5),
        },
      ])
      if (p.length) sections.push({ kind: "facts", title: "Предложение", items: p })
      if (proposal.evidence?.trim()) sections.push({ kind: "text", title: "Цитата", markdown: `> ${proposal.evidence.trim()}` })
    }
    // Deal cards carry their text only in analysis / recommendation.
    if (!m.whyNow && !m.steps.length && !proposal && m.analysis) {
      sections.push({ kind: "text", title: "Анализ", markdown: m.analysis })
    }
  } else {
    if (m.analysis) sections.push({ kind: "text", title: "Анализ", markdown: m.analysis })
    if (m.recommendation) sections.push({ kind: "text", title: "Рекомендация", markdown: m.recommendation })
  }

  const links: RecordHit[] = []
  if (row.topicId && row.topicTitle) {
    links.push(basicHit("topic", row.topicId, row.topicTitle, company?.name ?? null, [], isoOrNull(row.topicLastActivityAt)))
  }
  for (const d of deals) links.push(basicHit("deal", d.id, d.name, company?.name ?? null))
  const companies = new Map<string, string>()
  if (company) companies.set(company.id, company.name)
  for (const c of linkedClients) if (!companies.has(c.id)) companies.set(c.id, c.name)
  for (const [cid, name] of companies) links.push(basicHit("client", cid, name))
  for (const t of tasks) links.push(basicHit("task", t.id, t.name, "Создана из карточки"))
  for (const o of orders) links.push(basicHit("order", o.id, `Заказ от ${formatDate(o.orderDate, tz)}`, "Создан из карточки", [], isoOrNull(o.orderDate)))
  for (const s of sources) {
    const meta = s.meta && typeof s.meta === "object" ? (s.meta as Record<string, unknown>) : {}
    // Same title rule as the card page (src/server/cards.ts sourceSummary): subject, first line, file name.
    const line = (v: unknown) => (typeof v === "string" ? (v.split("\n").find((l) => l.trim()) ?? "").trim() : "")
    const title = line(meta.subject) || line(meta.text) || line(meta.rawText) || s.filename || line(meta.summary)
    links.push(basicHit("source_item", s.id, shortText(title, 120) || "Источник", null, [], isoOrNull(s.at)))
  }
  if (links.length) sections.push({ kind: "records", title: "Связано", items: links })

  return {
    type: "card",
    id,
    title: titleOf(row),
    subtitle: [company?.name, kindLabel(row)].filter(Boolean).join(" · ") || null,
    badges: [{ label: st.label, tone: STATUS_TONE[st.key] ?? "neutral" }],
    sections,
    href: recordHref("card", id),
  }
}

export const cardsModule: RecordModule<CardFilters> = {
  type: "card",
  filterSchema: cardFilterSchema,
  sortKeys: SORT_KEYS,
  search,
  list,
  get,
}

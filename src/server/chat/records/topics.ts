import "server-only"

import { and, asc, desc, eq, inArray, ne, or, sql, type SQL } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db/drizzle"
import { client, contact, deal, topic } from "@/db/schema"
import {
  recordHref,
  type RecordBadge,
  type RecordDetail,
  type RecordDetailSection,
  type RecordFact,
  type RecordHit,
} from "@/lib/chat/records"
import { ORDER_STATUS_LABEL } from "@/lib/orders-format"
import { SIGNAL_BAND_LABELS_RU, SIGNAL_BANDS, type SignalBand } from "@/lib/signals/extraction-types"
import { CLASS_LABELS_RU, FAMILY_LABELS_RU, SIGNAL_FAMILIES, type SignalClass, type SignalFamily } from "@/lib/signals/types"
import { TOPIC_LIST_LABELS_RU, type TopicList } from "@/lib/topics/attention-types"
import {
  TOPIC_LIVE_STATUSES,
  TOPIC_STATUS_LABELS_RU,
  TOPIC_STATUSES,
  TOPIC_SUB_STATE_LABELS_RU,
  type TopicStatus,
  type TopicSubState,
} from "@/lib/topics/types"
import type { OrderStatus } from "@/db/schema"
import { matchesQuery, norm, normJsonText, relevanceOf, type TextQuery } from "@/server/search/normalise"
import { readListState } from "@/server/topics/attention/store"
import { getTopicView, readTopicTab } from "@/server/topics-user"
import { allFacts, facts, formatDate, formatDateTime, formatMoney, isoOrNull } from "./format"
import { basicHit, capTotal, dateRange, parseDay, totalOver } from "./shared"
import { loadSourceItemHits } from "./source-items"
import { inIds, matchedLabel, resolveCompanyFilter, resolveDealFilter } from "./resolve"
import { keepOwnOrg, type RecordModule, type RecordsContext, type SearchOptions } from "./types"

// «Тема» (topic) of the records engine (spec §6.1 / §7.2). Exists for users
// only in topics mode `on` (ctx.topicsVisible); `merged` topics are never
// shown. The lists «Сейчас» / «Сводка» / «Неделя» and «Мои» come from the
// dashboard read model (`readTopicTab`), so the chat names the SAME topics
// the dashboard tabs show (P6 daily limit + frozen snapshots included).

// ── Value lists ───────────────────────────────────────────────────────────

const LIST_FILTERS = ["now", "digest", "week"] as const
type ListFilter = (typeof LIST_FILTERS)[number]

const STATUS_FILTERS = ["live", "all", ...TOPIC_STATUSES.filter((s) => s !== "merged")] as [string, ...string[]]
const LIVE: TopicStatus[] = [...TOPIC_LIVE_STATUSES]

const BANDS = SIGNAL_BANDS.filter((b) => b !== "none") as [SignalBand, ...SignalBand[]]


export const topicFilterSchema = z
  .object({
    list: z
      .enum(LIST_FILTERS)
      .optional()
      .describe("Dashboard list: now = «Сейчас», digest = «Сводка», week = «Неделя» — the same topics the dashboard tab shows"),
    mine: z
      .boolean()
      .optional()
      .describe("true = only topics assigned to the signed-in user (assignee or owner of the linked deal), like «Мои»"),
    status: z
      .enum(STATUS_FILTERS)
      .optional()
      .describe("live = open + dormant (default), all = every status, or one status: open, dormant, resolved, done, dismissed, expired, archived"),
    company: z.string().min(1).optional().describe("Company: its id or (part of) its name"),
    deal: z.string().min(1).optional().describe("Linked deal: its id or (part of) its name"),
    band: z
      .enum(BANDS)
      .optional()
      .describe("Minimum attention band: low, normal, high, very_high, critical (high = high and above)"),
    family: z
      .enum(SIGNAL_FAMILIES)
      .optional()
      .describe("Topic family: offer, order, invoice, contract, complaint, meeting, contact, pitch, delivery, account, market, supplier, team, internal, competitor"),
    activeFrom: z.string().optional().describe("Last activity on or after this day, YYYY-MM-DD"),
    activeTo: z.string().optional().describe("Last activity on or before this day, YYYY-MM-DD"),
  })
  .strict()
export type TopicFilters = z.infer<typeof topicFilterSchema>

/** rank = dashboard order with a list filter, else attention score; activity / created = newest first. */
const SORT_KEYS = ["rank", "activity", "created"] as const

// ── Columns ───────────────────────────────────────────────────────────────

/** Attention band after boosts (stored), else the base band. */
const bandExpr = sql<string>`coalesce(${topic.attention}->>'band', ${topic.band})`
const scoreExpr = sql<number>`coalesce((${topic.attention}->>'score')::numeric, ${topic.score})`

const cols = {
  id: topic.id,
  organizationId: topic.organizationId,
  title: topic.title,
  status: topic.status,
  subState: topic.subState,
  band: bandExpr,
  storedList: topic.list,
  clientName: client.name,
  contactName: contact.name,
  counterpartyRaw: topic.counterpartyRaw,
  lastActivityAt: topic.lastActivityAt,
}
type TopicRowLite = {
  id: string
  organizationId: string
  title: string
  status: string
  subState: string
  band: string
  storedList: string
  clientName: string | null
  contactName: string | null
  counterpartyRaw: string
  lastActivityAt: Date
}

function baseQuery() {
  return db
    .select({ ...cols, total: totalOver })
    .from(topic)
    .leftJoin(client, eq(client.id, topic.clientId))
    .leftJoin(contact, eq(contact.id, topic.contactId))
    .leftJoin(deal, eq(deal.id, topic.dealId))
}

// ── Labels ────────────────────────────────────────────────────────────────

function statusLabel(status: string): string {
  return TOPIC_STATUS_LABELS_RU[status as TopicStatus] ?? status
}

function listLabel(list: string | null | undefined): string {
  return list && list !== "none" ? (TOPIC_LIST_LABELS_RU[list as TopicList] ?? "") : ""
}

function bandBadge(band: string | null | undefined): RecordBadge | null {
  const label = SIGNAL_BAND_LABELS_RU[band as SignalBand]
  if (!label) return null
  const text = `Важность: ${label}`
  if (band === "critical" || band === "very_high") return { label: text, tone: "bad" }
  if (band === "high") return { label: text, tone: "warn" }
  if (band === "normal") return { label: text, tone: "neutral" }
  return null
}

function companyOf(r: Pick<TopicRowLite, "clientName" | "contactName" | "counterpartyRaw">): string | null {
  return r.clientName ?? r.contactName ?? (r.counterpartyRaw.trim() || null)
}

/**
 * Read-time list of every live topic («Сейчас» / «Сводка» / «Неделя»), no
 * daily limit — for the «Список» fact of hits outside a list filter.
 */
async function loadPlacedLists(ctx: RecordsContext): Promise<Map<string, { list: string; band: string | null }>> {
  const state = await readListState(ctx.orgId, ctx.now)
  return new Map(state.rows.map((r) => [r.topicId, { list: r.placed?.list ?? r.storedList, band: r.placed?.band ?? null }]))
}

function toHit(ctx: RecordsContext, r: TopicRowLite, list: string | null, band: string | null): RecordHit {
  const live = LIVE.includes(r.status as TopicStatus)
  return {
    type: "topic",
    id: r.id,
    title: r.title,
    subtitle: companyOf(r),
    facts: facts([
      { label: "Статус", value: statusLabel(r.status) },
      { label: "Список", value: live ? listLabel(list) : "" },
      { label: "Последняя активность", value: formatDate(r.lastActivityAt, ctx.timeZone) },
    ]),
    badge: live ? bandBadge(band ?? r.band) : null,
    date: isoOrNull(r.lastActivityAt),
    href: recordHref("topic", r.id),
  }
}

async function mapRows(ctx: RecordsContext, rows: TopicRowLite[], listOverride?: string): Promise<RecordHit[]> {
  const own = keepOwnOrg(ctx, "topic", rows)
  if (own.length === 0) return []
  const placed = listOverride ? null : await loadPlacedLists(ctx)
  return own.map((r) => {
    const p = placed?.get(r.id)
    return toHit(ctx, r, listOverride ?? p?.list ?? r.storedList, p?.band ?? null)
  })
}

// ── Filters ───────────────────────────────────────────────────────────────


function statusCondition(status: string | undefined): SQL {
  if (!status || status === "live") return inArray(topic.status, LIVE)
  if (status === "all") return ne(topic.status, "merged")
  return eq(topic.status, status)
}

const STATUS_CHIP: Record<string, string> = { live: "в работе (открыта, затихла)", all: "все" }

function bandsFrom(min: SignalBand): string[] {
  return SIGNAL_BANDS.slice(SIGNAL_BANDS.indexOf(min))
}

/** Conditions of every filter except `list` / `mine`, plus their chips. */
async function filterConditions(ctx: RecordsContext, filters: TopicFilters, statusDefault: boolean) {
  const where: (SQL | undefined)[] = [eq(topic.organizationId, ctx.orgId), ne(topic.status, "merged")]
  const applied: { label: string; value: string }[] = []
  if (filters.status || statusDefault) where.push(statusCondition(filters.status))
  if (filters.status) {
    applied.push({ label: "Статус", value: STATUS_CHIP[filters.status] ?? statusLabel(filters.status).toLowerCase() })
  }
  if (filters.company) {
    const m = await resolveCompanyFilter(ctx, filters.company)
    where.push(inIds(topic.clientId, m))
    applied.push({ label: "Компания", value: matchedLabel(filters.company, m) })
  }
  if (filters.deal) {
    const m = await resolveDealFilter(ctx, filters.deal)
    where.push(inIds(topic.dealId, m))
    applied.push({ label: "Сделка", value: matchedLabel(filters.deal, m) })
  }
  if (filters.band) {
    where.push(sql`${bandExpr} in ${bandsFrom(filters.band)}`)
    const label = SIGNAL_BAND_LABELS_RU[filters.band]
    applied.push({ label: "Важность", value: filters.band === "critical" ? label : `${label} и выше` })
  }
  if (filters.family) {
    where.push(eq(topic.family, filters.family))
    applied.push({ label: "Вид темы", value: FAMILY_LABELS_RU[filters.family] })
  }
  const from = parseDay(filters.activeFrom, false, ctx.timeZone)
  const to = parseDay(filters.activeTo, true, ctx.timeZone)
  if (from || to) {
    where.push(dateRange(topic.lastActivityAt, { dateFrom: from, dateTo: to }))
    applied.push({
      label: "Активность",
      value: [from && `с ${formatDate(from, ctx.timeZone)}`, to && `по ${formatDate(to, ctx.timeZone)}`].filter(Boolean).join(" "),
    })
  }
  return { where, applied }
}

function orderBy(sort: string) {
  if (sort === "created") return [desc(topic.firstSeenAt), asc(topic.id)]
  if (sort === "activity") return [desc(topic.lastActivityAt), asc(topic.id)]
  return [desc(scoreExpr), desc(topic.lastActivityAt), asc(topic.id)]
}

// ── search / list / get ───────────────────────────────────────────────────

async function search(ctx: RecordsContext, tq: TextQuery, opts: SearchOptions) {
  if (!ctx.topicsVisible) return { hits: [], total: 0, capped: false }
  const fields = [norm(topic.title), norm(topic.matter), norm(topic.counterpartyRaw), norm(client.name)]
  const refs = normJsonText(sql`jsonb_path_query_array(${topic.references}, '$[*].value')`)
  const rows = await baseQuery()
    .where(
      and(
        eq(topic.organizationId, ctx.orgId),
        ne(topic.status, "merged"),
        dateRange(topic.lastActivityAt, opts),
        or(...fields.map((f) => matchesQuery(tq, f)), matchesQuery(tq, refs)),
      ),
    )
    .orderBy(desc(relevanceOf(tq, [...fields, refs])), desc(topic.lastActivityAt))
    .limit(opts.limit)
  return { hits: await mapRows(ctx, rows), ...capTotal(rows[0]?.total) }
}

async function list(ctx: RecordsContext, filters: TopicFilters, sort: string, limit: number) {
  if (!ctx.topicsVisible) return { rows: [], total: 0, capped: false, applied: [] }

  if (filters.list) {
    // The dashboard tab itself (rank order, «Мои» rule), then the other filters.
    const tab = await readTopicTab(ctx.orgId, ctx.userId, filters.list as ListFilter, { mine: !!filters.mine, now: ctx.now })
    const order = tab.entries.map((e) => e.topicId)
    const { where, applied } = await filterConditions(ctx, filters, false)
    applied.unshift({ label: "Список", value: TOPIC_LIST_LABELS_RU[filters.list] })
    if (filters.mine) applied.splice(1, 0, { label: "Ответственный", value: "я" })
    if (order.length === 0) return { rows: [], total: 0, capped: false, applied }
    const rows = await baseQuery()
      .where(and(...where, inArray(topic.id, order)))
      .orderBy(...orderBy(sort))
    const own = keepOwnOrg(ctx, "topic", rows)
    const rank = new Map(order.map((id, i) => [id, i]))
    if (sort === "rank") own.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
    const bandOf = new Map(tab.entries.map((e) => [e.topicId, e.attention?.band ?? null]))
    return {
      rows: own.slice(0, limit).map((r) => toHit(ctx, r, filters.list!, bandOf.get(r.id) ?? null)),
      ...capTotal(own.length),
      applied,
    }
  }

  const { where, applied } = await filterConditions(ctx, filters, true)
  if (filters.mine) {
    where.push(or(eq(topic.ownerUserId, ctx.userId), eq(deal.userId, ctx.userId)))
    applied.unshift({ label: "Ответственный", value: "я" })
  }
  const rows = await baseQuery()
    .where(and(...where))
    .orderBy(...orderBy(sort))
    .limit(limit)
  return { rows: await mapRows(ctx, rows), ...capTotal(rows[0]?.total), applied }
}

function cardMarkdown(card: { headline: string; whyNow: string; whatChanged: string; steps: string[] } | null): string {
  if (!card) return ""
  const parts: string[] = []
  if (card.headline.trim()) parts.push(`**${card.headline.trim()}**`)
  if (card.whyNow.trim()) parts.push(card.whyNow.trim())
  if (card.whatChanged.trim()) parts.push(`Что изменилось: ${card.whatChanged.trim()}`)
  const steps = card.steps.map((s) => s.trim()).filter(Boolean)
  if (steps.length) parts.push(`Шаги:\n${steps.map((s) => `- ${s}`).join("\n")}`)
  return parts.join("\n\n")
}

async function get(ctx: RecordsContext, id: string): Promise<RecordDetail | null> {
  if (!ctx.topicsVisible || !id) return null
  const [head] = await db
    .select({ id: topic.id, organizationId: topic.organizationId, counterpartyRaw: topic.counterpartyRaw, family: topic.family, class: topic.class, band: bandExpr })
    .from(topic)
    .where(and(eq(topic.id, id), eq(topic.organizationId, ctx.orgId), ne(topic.status, "merged")))
    .limit(1)
  if (!head || keepOwnOrg(ctx, "topic", [head]).length === 0) return null
  const view = await getTopicView(ctx.orgId, id, ctx.now)
  if (!view || view.status === "merged") return null

  const tz = ctx.timeZone
  const live = LIVE.includes(view.status as TopicStatus)
  const att = view.attention
  const itemIds = [...new Set(view.items.map((i) => i.sourceItemId))].slice(0, 10)
  const messages = await loadSourceItemHits(ctx, itemIds)

  const sections: RecordDetailSection[] = []
  const subState = view.status === "open" && view.subState !== "none" ? TOPIC_SUB_STATE_LABELS_RU[view.subState as TopicSubState] : ""
  const info: (RecordFact & { href?: string })[] = [
    ...(view.clientId && view.clientName ? [{ label: "Компания", value: view.clientName, href: recordHref("client", view.clientId) }] : []),
    ...(view.contactId && view.contactName ? [{ label: "Контакт", value: view.contactName, href: recordHref("contact", view.contactId) }] : []),
    ...(view.deal ? [{ label: "Сделка", value: view.deal.name, href: recordHref("deal", view.deal.id) }] : []),
    ...allFacts([
      !view.clientName && !view.contactName && { label: "Контрагент", value: head.counterpartyRaw.trim() },
      { label: "Статус", value: [statusLabel(view.status), subState].filter(Boolean).join(" · ") },
      { label: "Список", value: live ? listLabel(att?.list) : "" },
      { label: "Важность", value: live && att ? (SIGNAL_BAND_LABELS_RU[att.band as SignalBand] ?? "") : "" },
      { label: "Вид темы", value: head.family ? (FAMILY_LABELS_RU[head.family as SignalFamily] ?? "") : "" },
      { label: "Класс", value: head.class ? (CLASS_LABELS_RU[head.class as SignalClass] ?? "") : "" },
      { label: "Ведущий сигнал", value: view.leadLabelRu ?? "" },
      { label: "Ответственный", value: view.ownerName ?? "" },
      { label: "Срок", value: att?.deadline ? formatDateTime(att.deadline, tz) + (att.overdue ? " (просрочен)" : "") : "" },
      { label: "Отложена до", value: view.snoozedUntil ? formatDate(view.snoozedUntil, tz) : "" },
      { label: "Номера и ссылки", value: view.references.map((r) => r.value).filter(Boolean).join(", ") },
      { label: "Товары", value: view.products.join(", ") },
      { label: "Первое появление", value: formatDate(view.firstSeenAt, tz) },
      { label: "Последняя активность", value: formatDate(view.lastActivityAt, tz) },
      { label: "Закрыта", value: view.closedAt ? formatDate(view.closedAt, tz) : "" },
    ]),
  ]
  if (info.length) sections.push({ kind: "facts", title: "Сведения", items: info })

  const why = cardMarkdown(view.card)
  if (why) sections.push({ kind: "text", title: "Почему сейчас", markdown: why })
  const explanation = (att?.explanation ?? []).map((l) => l.trim()).filter(Boolean)
  if (live && explanation.length) {
    sections.push({ kind: "text", title: "Почему в этом списке", markdown: explanation.map((l) => `- ${l}`).join("\n") })
  }
  if (messages.length) sections.push({ kind: "records", title: "Сообщения", items: messages })
  if (view.orders.length) {
    sections.push({
      kind: "records",
      title: "Заказы",
      items: view.orders.map((o) =>
        basicHit(
          "order",
          o.id,
          o.label,
          ORDER_STATUS_LABEL[o.status as OrderStatus] ?? null,
          facts([{ label: "Сумма", value: formatMoney(o.total, o.currency) }]),
          isoOrNull(o.orderDate),
        ),
      ),
    })
  }
  if (view.deal) {
    sections.push({
      kind: "records",
      title: "Сделка",
      items: [basicHit("deal", view.deal.id, view.deal.name, view.deal.stageLabel)],
    })
  }

  const badges: RecordBadge[] = []
  if (view.status !== "open") badges.push({ label: statusLabel(view.status), tone: view.status === "resolved" || view.status === "done" ? "good" : "neutral" })
  const band = live ? bandBadge(att?.band ?? head.band) : null
  if (band) badges.push(band)

  return {
    type: "topic",
    id,
    title: view.title,
    subtitle: view.clientName ?? view.contactName ?? (head.counterpartyRaw.trim() || null),
    badges,
    sections,
    href: recordHref("topic", id),
  }
}

export const topicsModule: RecordModule<TopicFilters> = {
  type: "topic",
  filterSchema: topicFilterSchema,
  sortKeys: SORT_KEYS,
  search,
  list,
  get,
}

import "server-only"

import { and, asc, desc, eq, gte, inArray, lte, ne, notInArray, or, sql, type SQL } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db/drizzle"
import { client, contact, deal, dealActivity, dealContact, dealFunnelStage, dealType, topic } from "@/db/schema"
import {
  recordHref,
  type RecordBadge,
  type RecordDetail,
  type RecordDetailSection,
  type RecordHit,
} from "@/lib/chat/records"
import { dealContactRoleLabel } from "@/lib/deal-roles"
import { OPEN_DEAL_STATUSES, stageDisplayLabel, stageRoleOf } from "@/lib/deal-funnel"
import { TOPIC_STATUS_LABELS_RU, type TopicStatus } from "@/lib/topics/types"
import { listDealRisks } from "@/server/deal-risks"
import { getOrgFunnel } from "@/server/deal-engine"
import { loadEntityDocumentsForChat } from "@/server/documents-chat"
import { matchesQuery, norm, relevanceOf, type TextQuery } from "@/server/search/normalise"
import { allFacts, facts, formatDate, formatMoney, isoOrNull, shortText } from "./format"
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
import { inIds, matchedLabel, resolveCompanyFilter } from "./resolve"
import { keepOwnOrg, type RecordModule, type RecordsContext, type SearchOptions } from "./types"
import { contactDisplaySql } from "@/server/contact-display"

// «Сделка» (deal) — records engine module (spec §6.1).
// Visible: every deal of the org except `deleted`. Stage meaning comes from
// `deal_funnel_stage.role` (won / lost = outcome), never from its name.
// Owner = `deal.user_id` (the «Все / Мои» filter of the board).

const STATUS_FILTERS = ["open", "active", "paused", "cancelled", "won", "lost"] as const
const STATUS_FILTER_LABELS: Record<(typeof STATUS_FILTERS)[number], string> = {
  open: "открыта",
  active: "активна",
  paused: "на паузе",
  cancelled: "отменена",
  won: "выиграна",
  lost: "проиграна",
}
const STATUS_LABELS: Record<string, string> = {
  active: "Активна",
  paused: "На паузе",
  cancelled: "Отменена",
}

export const dealFilterSchema = z
  .object({
    stage: z.string().min(1).optional().describe("Funnel stage: its name as shown in the CRM, or its code (s1, won, lost, …)"),
    status: z
      .enum(STATUS_FILTERS)
      .optional()
      .describe(
        "open = active or paused and not on a won / lost stage; won / lost = on the won / lost stage; active / paused / cancelled = the deal status",
      ),
    owner: z.string().min(1).optional().describe('Owner («Ответственный»): "me" = the signed-in user, or a member name'),
    company: z.string().min(1).optional().describe("Company: its id or (part of) its name"),
    type: z.string().min(1).optional().describe("Deal type (Тип сделки): its code or (part of) its Russian label"),
    amountMin: z.number().optional().describe("Amount ≥ this value (deal currency)"),
    amountMax: z.number().optional().describe("Amount ≤ this value (deal currency)"),
    createdFrom: z.string().optional().describe("Created on / after this day, YYYY-MM-DD"),
    createdTo: z.string().optional().describe("Created on / before this day, YYYY-MM-DD"),
    closedFrom: z.string().optional().describe("Moved to a won / lost stage on / after this day, YYYY-MM-DD"),
    closedTo: z.string().optional().describe("Moved to a won / lost stage on / before this day, YYYY-MM-DD"),
  })
  .strict()
export type DealFilters = z.infer<typeof dealFilterSchema>

const SORT_KEYS = ["updated", "created", "amount", "name"] as const

const cols = {
  id: deal.id,
  organizationId: deal.organizationId,
  name: deal.name,
  description: deal.description,
  value: deal.value,
  currency: deal.currency,
  status: deal.status,
  userId: deal.userId,
  clientId: deal.clientId,
  createdAt: deal.createdAt,
  updatedAt: deal.updatedAt,
  companyName: client.name,
  stageName: dealFunnelStage.name,
  stageDisplay: dealFunnelStage.displayName,
  stageRole: dealFunnelStage.role,
}
type DealRowLite = {
  id: string
  organizationId: string | null
  name: string
  description: string | null
  value: string | null
  currency: string
  status: string
  userId: string
  clientId: string
  createdAt: Date
  updatedAt: Date | null
  companyName: string | null
  stageName: string | null
  stageDisplay: string | null
  stageRole: string | null
}

/** When the deal last moved to a won / lost stage (deal_activity), as a SQL expression. */
const closedAtExpr = sql`(select max(${dealActivity.createdAt}) from ${dealActivity} inner join ${dealFunnelStage} as closed_stage on closed_stage.id = ${dealActivity.toStageId} where ${dealActivity.dealId} = ${deal.id} and closed_stage.role in ('won', 'lost'))`

function stageLabel(r: Pick<DealRowLite, "stageName" | "stageDisplay">): string {
  return r.stageName ? stageDisplayLabel(r.stageName, r.stageDisplay) : ""
}

/** Badge: outcome first (won / lost), then a non-active status. */
function badgeOf(r: Pick<DealRowLite, "status" | "stageRole">): RecordBadge | null {
  const role = stageRoleOf(r.stageRole)
  if (r.status === "cancelled") return { label: "Отменена", tone: "neutral" }
  if (role === "won") return { label: "Выиграна", tone: "good" }
  if (role === "lost") return { label: "Проиграна", tone: "bad" }
  if (r.status === "paused") return { label: "На паузе", tone: "warn" }
  return null
}

function subtitleOf(r: DealRowLite): string | null {
  return [r.companyName, stageLabel(r)].filter(Boolean).join(" · ") || null
}

function toHit(ctx: RecordsContext, r: DealRowLite, members: Map<string, OrgMember>): RecordHit {
  return {
    type: "deal",
    id: r.id,
    title: r.name,
    subtitle: subtitleOf(r),
    facts: facts([
      { label: "Сумма", value: formatMoney(r.value, r.currency) },
      { label: "Ответственный", value: personLabel(ctx, members, r.userId) },
    ]),
    badge: badgeOf(r),
    date: isoOrNull(r.updatedAt ?? r.createdAt),
    href: recordHref("deal", r.id),
  }
}

function baseQuery(ctx: RecordsContext) {
  return db
    .select({ ...cols, total: totalOver })
    .from(deal)
    .leftJoin(client, and(eq(deal.clientId, client.id), eq(client.organizationId, ctx.orgId)))
    .leftJoin(dealFunnelStage, eq(deal.funnelStageId, dealFunnelStage.id))
}

function visible(ctx: RecordsContext): SQL {
  return and(eq(deal.organizationId, ctx.orgId), ne(deal.status, "deleted"))!
}

async function mapRows(ctx: RecordsContext, rows: (DealRowLite & { total: number })[]) {
  const own = keepOwnOrg(ctx, "deal", rows)
  const members = await loadOrgMembers(ctx.orgId)
  return own.map((r) => toHit(ctx, r, members))
}

async function search(ctx: RecordsContext, tq: TextQuery, opts: SearchOptions) {
  const fields = [norm(deal.name), norm(client.name)]
  const rows = await baseQuery(ctx)
    .where(
      and(
        visible(ctx),
        dateRange(deal.createdAt, opts),
        or(...fields.map((f) => matchesQuery(tq, f)), matchesQuery(tq, norm(deal.description))),
      ),
    )
    .orderBy(desc(relevanceOf(tq, fields)), desc(deal.updatedAt))
    .limit(opts.limit)
  return { hits: await mapRows(ctx, rows), ...capTotal(rows[0]?.total) }
}

/** Stage filter value → stage ids of the org funnel (exact label / name / code first, then substring). */
async function resolveStages(orgId: string, value: string): Promise<{ ids: string[]; labels: string[] }> {
  const v = value.trim().toLowerCase()
  const stages = await getOrgFunnel(orgId)
  const keys = (s: (typeof stages)[number]) =>
    [stageDisplayLabel(s.name, s.displayName), s.name, s.displayName ?? "", s.code ?? ""].map((k) => k.toLowerCase())
  let hit = stages.filter((s) => keys(s).includes(v))
  if (hit.length === 0) hit = stages.filter((s) => keys(s).some((k) => k && k.includes(v)))
  return { ids: hit.map((s) => s.id), labels: hit.map((s) => stageDisplayLabel(s.name, s.displayName)) }
}

/** Chip text of a filter day as the user typed it («2026-12-31» → «31.12.2026»), never shifted by time zones. */
function dayChip(raw: string | undefined, tz: string): string {
  if (!raw) return ""
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim())
  return m ? `${m[3]}.${m[2]}.${m[1]}` : formatDate(raw, tz)
}

function rangeLabel(ctx: RecordsContext, from: string | undefined, to: string | undefined): string {
  return [from && `с ${dayChip(from, ctx.timeZone)}`, to && `по ${dayChip(to, ctx.timeZone)}`].filter(Boolean).join(" ")
}

async function list(ctx: RecordsContext, filters: DealFilters, sort: string, limit: number) {
  const members = await loadOrgMembers(ctx.orgId)
  const applied: { label: string; value: string }[] = []
  const where: (SQL | undefined)[] = [visible(ctx)]

  if (filters.stage) {
    const { ids, labels } = await resolveStages(ctx.orgId, filters.stage)
    where.push(ids.length ? inArray(deal.funnelStageId, ids) : sql`false`)
    applied.push({ label: "Стадия", value: labels.length ? labels.join(", ") : `${filters.stage} (не найдена)` })
  }
  if (filters.status) {
    const role = sql`coalesce(${dealFunnelStage.role}, 'active')`
    const s = filters.status
    if (s === "open") {
      where.push(inArray(deal.status, [...OPEN_DEAL_STATUSES]), sql`${role} not in ('won', 'lost')`)
    } else if (s === "won" || s === "lost") {
      where.push(inArray(deal.status, [...OPEN_DEAL_STATUSES]), sql`${role} = ${s}`)
    } else {
      where.push(eq(deal.status, s))
    }
    applied.push({ label: "Статус", value: STATUS_FILTER_LABELS[s] })
  }
  if (filters.owner) {
    const ids = resolvePersonFilter(ctx, members, filters.owner)
    where.push(ids.length ? inArray(deal.userId, ids) : sql`false`)
    applied.push({
      label: "Ответственный",
      value: ids.length ? ids.map((id) => personLabel(ctx, members, id)).join(", ") : `${filters.owner} (не найден)`,
    })
  }
  if (filters.company) {
    const m = await resolveCompanyFilter(ctx, filters.company)
    where.push(inIds(deal.clientId, m))
    applied.push({ label: "Компания", value: matchedLabel(filters.company, m) })
  }
  if (filters.type) {
    const v = filters.type.trim().toLowerCase()
    where.push(
      sql`exists (select 1 from ${dealType} where ${dealType.id} = ${deal.dealTypeId} and ${dealType.organizationId} = ${ctx.orgId} and (lower(${dealType.code}) = ${v} or lower(${dealType.labelRu}) like ${`%${v}%`}))`,
    )
    applied.push({ label: "Тип сделки", value: filters.type.trim() })
  }
  if (filters.amountMin != null) {
    where.push(gte(deal.value, String(filters.amountMin)))
    applied.push({ label: "Сумма", value: `от ${formatMoney(filters.amountMin)}` })
  }
  if (filters.amountMax != null) {
    where.push(lte(deal.value, String(filters.amountMax)))
    applied.push({ label: "Сумма", value: `до ${formatMoney(filters.amountMax)}` })
  }
  const cFrom = parseDay(filters.createdFrom, false, ctx.timeZone)
  const cTo = parseDay(filters.createdTo, true, ctx.timeZone)
  if (cFrom) where.push(sql`${deal.createdAt} >= ${cFrom.toISOString()}`)
  if (cTo) where.push(sql`${deal.createdAt} <= ${cTo.toISOString()}`)
  if (cFrom || cTo) applied.push({ label: "Создана", value: rangeLabel(ctx, filters.createdFrom, filters.createdTo) })
  const zFrom = parseDay(filters.closedFrom, false, ctx.timeZone)
  const zTo = parseDay(filters.closedTo, true, ctx.timeZone)
  if (zFrom || zTo) {
    where.push(sql`coalesce(${dealFunnelStage.role}, 'active') in ('won', 'lost')`)
    if (zFrom) where.push(sql`${closedAtExpr} >= ${zFrom.toISOString()}`)
    if (zTo) where.push(sql`${closedAtExpr} <= ${zTo.toISOString()}`)
    applied.push({ label: "Закрыта", value: rangeLabel(ctx, filters.closedFrom, filters.closedTo) })
  }

  const order =
    sort === "created"
      ? [desc(deal.createdAt)]
      : sort === "amount"
        ? [sql`${deal.value} desc nulls last`, desc(deal.updatedAt)]
        : sort === "name"
          ? [asc(deal.name)]
          : [desc(deal.updatedAt)]
  const rows = await baseQuery(ctx).where(and(...where)).orderBy(...order).limit(limit)
  return { rows: await mapRows(ctx, rows), ...capTotal(rows[0]?.total), applied }
}

async function get(ctx: RecordsContext, id: string): Promise<RecordDetail | null> {
  const [row] = await db
    .select({
      ...cols,
      outcomeReason: deal.outcomeReason,
      outcomeReasonCode: deal.outcomeReasonCode,
      expertProbability: deal.expertProbability,
      briefBudget: deal.briefBudget,
      pausedUntil: deal.pausedUntil,
      pauseReason: deal.pauseReason,
      stateText: deal.stateText,
      createdByAgent: deal.createdByAgent,
      typeLabel: dealType.labelRu,
      closedAt: sql<string | null>`${closedAtExpr}`,
    })
    .from(deal)
    .leftJoin(client, and(eq(deal.clientId, client.id), eq(client.organizationId, ctx.orgId)))
    .leftJoin(dealFunnelStage, eq(deal.funnelStageId, dealFunnelStage.id))
    .leftJoin(dealType, and(eq(deal.dealTypeId, dealType.id), eq(dealType.organizationId, ctx.orgId)))
    .where(and(eq(deal.id, id), visible(ctx)))
    .limit(1)
  if (!row || keepOwnOrg(ctx, "deal", [row]).length === 0) return null

  const [members, risks, contacts, topics, docs] = await Promise.all([
    loadOrgMembers(ctx.orgId),
    listDealRisks(ctx.orgId, id),
    db
      .select({
        id: contact.id,
        name: contactDisplaySql(),
        position: contact.position,
        email: contact.email,
        role: dealContact.role,
      })
      .from(dealContact)
      .innerJoin(contact, eq(dealContact.contactId, contact.id))
      .where(
        and(
          eq(dealContact.dealId, id),
          eq(contact.organizationId, ctx.orgId),
          notInArray(contact.status, ["deleted", "blocked"]),
        ),
      )
      .orderBy(asc(contactDisplaySql()))
      .limit(10),
    ctx.topicsVisible
      ? db
          .select({ id: topic.id, title: topic.title, status: topic.status, lastActivityAt: topic.lastActivityAt })
          .from(topic)
          .where(and(eq(topic.organizationId, ctx.orgId), eq(topic.dealId, id), ne(topic.status, "merged")))
          .orderBy(desc(topic.lastActivityAt))
          .limit(10)
      : Promise.resolve([]),
    loadEntityDocumentsForChat(ctx.orgId, [{ entityType: "deal", entityId: id }], 8),
  ])

  const tz = ctx.timeZone
  const sections: RecordDetailSection[] = []
  const role = stageRoleOf(row.stageRole)
  const outcome = row.status === "cancelled" || role === "won" || role === "lost"
  const statusText =
    row.status === "paused" && row.pausedUntil
      ? `На паузе до ${formatDate(row.pausedUntil, tz)}`
      : (STATUS_LABELS[row.status] ?? row.status)

  const info = allFacts([
    { label: "Компания", value: row.companyName ?? "" },
    { label: "Стадия", value: stageLabel(row) },
    { label: "Статус", value: statusText },
    { label: "Причина паузы", value: row.status === "paused" ? (row.pauseReason ?? "") : "" },
    { label: "Сумма", value: formatMoney(row.value, row.currency) },
    { label: "Бюджет из брифа", value: formatMoney(row.briefBudget, row.currency) },
    { label: "Тип сделки", value: row.typeLabel ?? "" },
    { label: "Ответственный", value: personLabel(ctx, members, row.userId) },
    { label: "Вероятность", value: row.expertProbability != null ? `${row.expertProbability} %` : "" },
    { label: "Создана", value: formatDate(row.createdAt, tz) },
    { label: "Закрыта", value: outcome ? formatDate(row.closedAt, tz) : "" },
    { label: "Причина исхода", value: outcome ? (row.outcomeReason ?? row.outcomeReasonCode ?? "") : "" },
  ])
  if (info.length) sections.push({ kind: "facts", title: "Сведения", items: info })

  if (row.stateText?.trim()) sections.push({ kind: "text", title: "Состояние", markdown: row.stateText.trim() })
  if (row.description?.trim()) {
    sections.push({ kind: "text", title: "Описание", markdown: row.description.trim().slice(0, 1500) })
  }

  const activeRisks = risks.filter((r) => r.status === "active")
  if (activeRisks.length) {
    sections.push({
      kind: "text",
      title: "Риски",
      markdown: activeRisks
        .map((r) => `- **${r.labelRu}**${r.explanationRu ? ` — ${shortText(r.explanationRu, 300)}` : ""}`)
        .join("\n"),
    })
  }

  if (contacts.length) {
    sections.push({
      kind: "records",
      title: "Контакты",
      items: contacts.map((c) =>
        basicHit(
          "contact",
          c.id,
          c.name,
          c.position ?? c.email ?? null,
          facts([{ label: "Роль", value: c.role ? dealContactRoleLabel(c.role) : "" }]),
        ),
      ),
    })
  }
  if (topics.length) {
    sections.push({
      kind: "records",
      title: "Темы",
      items: topics.map((t) =>
        basicHit(
          "topic",
          t.id,
          t.title,
          TOPIC_STATUS_LABELS_RU[t.status as TopicStatus] ?? null,
          [],
          isoOrNull(t.lastActivityAt),
        ),
      ),
    })
  }
  const docList = docs.get(`deal:${id}`) ?? []
  if (docList.length) {
    sections.push({
      kind: "text",
      title: "Документы",
      markdown: docList.map((d) => `- ${d.name}${d.summary ? ` — ${shortText(d.summary, 160)}` : ""}`).join("\n"),
    })
  }

  const badges: RecordBadge[] = []
  const b = badgeOf(row)
  if (b) badges.push(b)
  if (activeRisks.length) badges.push({ label: `Риски: ${activeRisks.length}`, tone: "warn" })
  if (row.createdByAgent) badges.push({ label: "Создал агент", tone: "neutral" })

  return {
    type: "deal",
    id,
    title: row.name,
    subtitle: subtitleOf(row),
    badges,
    sections,
    href: recordHref("deal", id),
  }
}

export const dealsModule: RecordModule<DealFilters> = {
  type: "deal",
  filterSchema: dealFilterSchema,
  sortKeys: SORT_KEYS,
  search: (ctx, tq, opts) => search(ctx, tq, opts),
  list,
  get,
}

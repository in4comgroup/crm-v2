import "server-only"

import { and, asc, desc, eq, inArray, ne, or, sql, type SQL } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { db } from "@/db/drizzle"
import {
  card,
  client,
  contact,
  deal,
  dealFunnelStage,
  member,
  signalInstance,
  source,
  sourceItem,
  sourceItemSubject,
  topic,
  topicEvent,
  topicItem,
  user,
} from "@/db/schema"
import { OPEN_DEAL_STATUSES, stageDisplayLabel } from "@/lib/deal-funnel"
import { WorkCalendar } from "@/lib/topics/attention-calendar"
import type { AttentionParams } from "@/lib/topics/attention-params"
import { TOPIC_LISTS, type TopicAttention } from "@/lib/topics/attention-types"
import { isCardKind, type TopicCardEvent } from "@/lib/topics/cards"
import {
  countEntries,
  cycleMarker,
  describeTopicEvent,
  filterMine,
  type TopicActionInput,
  type TopicAllFilters,
  type TopicCardView,
  type TopicCounts,
  type TopicDealOption,
  type TopicDetailView,
  type TopicEntry,
  type TopicEntryAttention,
  type TopicListResponse,
  type TopicSourceRef,
  type TopicMergeOption,
  type TopicOrderOption,
  type TopicOwnerOption,
  type TopicTab,
  TOPIC_CARD_SOURCES,
  topicStatusFilterOf,
  type TopicStatusFilter,
} from "@/lib/topics/topic-ui"
import { TOPIC_LIVE_STATUSES, type TopicStatus } from "@/lib/topics/types"
import { reminderMarker } from "@/lib/topics/delivery-routing"
import { viewerLists, type SnapshotContext } from "@/lib/topics/list-snapshot"
import { loadDeliveryParams, orgHumanMemberIds } from "@/server/topics/delivery/store"
import { getRegistry } from "@/server/signals/registry"
import { compareRank, placeStoredAttention } from "@/server/topics/attention/engine"
import { loadAttentionParams, loadCalendarDays, readListState, type ListState } from "@/server/topics/attention/store"
import { proposalOf } from "@/server/topics/cards/deal-cards"
import { effectiveCardStatus } from "@/server/topics/cards/logic"
import { attentionOf, metaOf } from "@/server/topics/cards/store"
import { topicCardsVisible } from "@/server/topics/cards/visibility"
import { envelopeFromItem } from "@/server/topics/signals/item-input"
import { humanUsersOnly } from "@/server/topics/system-actor"
import { listTopicOrderOptions, listTopicOrders, OrderTopicLinkError, setOrderTopic } from "@/server/topics/orders-link"
import {
  detachItemFromTopic,
  dismissTopic,
  markTopicDone,
  mergeTopics,
  refreshTopicAttention,
  setTopicDeal,
  setTopicOwner,
  snoozeTopic,
} from "@/server/topics/topic-store"
import { contactDisplaySql } from "@/server/contact-display"

// User-facing read models + actions of the topics UI (topics plan phase 6,
// spec topics/01 §8.1, §9.1, §14; 06 §7.2, §11): the dashboard lists
// («Сейчас» / «Сводка» / «Неделя» / «Все темы», «Мои», counts), one topic for
// the drawer, the pickers of the drawer and the drawer actions.
// Org-explicit and session-free (`server-only`, root AGENTS.md rule 5): the
// route `src/app/api/topics` checks the session, takes the org from
// `session.session.activeOrganizationId` and requires topics mode `on`.
// Dates are ISO strings (JSON).

export class TopicsUserError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 = 400,
  ) {
    super(message)
    this.name = "TopicsUserError"
  }
}

const LIVE = [...TOPIC_LIVE_STATUSES] as TopicStatus[]
const DEAL_KINDS = ["deal_proposal", "stage_confirmation"] as const
const ALL_TOPICS_LIMIT = 300

/** True when the org's users see the topics UI (`topics.enabled` = `on`). */
export async function topicsUiVisible(orgId: string): Promise<boolean> {
  return topicCardsVisible(orgId)
}

/** Throws 409 unless the org is in mode `on` (shadow / off: nothing to show). */
export async function requireTopicsOn(orgId: string): Promise<void> {
  if (!(await topicCardsVisible(orgId))) {
    throw new TopicsUserError("Темы не включены для этой организации", 409)
  }
}

// ── Placement + snapshots ─────────────────────────────────────────────────

type Placer = {
  params: AttentionParams
  cal: WorkCalendar
  place: (raw: unknown, now: Date) => TopicAttention | null
}

async function loadPlacer(orgId: string): Promise<Placer> {
  const [params, days] = await Promise.all([loadAttentionParams(orgId), loadCalendarDays()])
  const cal = new WorkCalendar(days, { timeZone: params.timeZone, workStart: params.workStart, workEnd: params.workEnd })
  return {
    params,
    cal,
    place: (raw, now) => {
      const a = attentionOf(raw)
      return a ? placeStoredAttention(a, now, cal, params) : null
    },
  }
}

/** Last «Сводка» snapshot moment ≤ now: the morning time of the last working day (06 §7.2). */
export function lastDigestSnapshot(cal: WorkCalendar, p: AttentionParams, now: Date): Date {
  return cal.lastWorkingDayAt(now, p.morningDigestTime)
}

/** Last «Неделя» snapshot moment ≤ now: the weekly review day (holiday Friday → the last working day before it) + time. */
export function lastWeeklySnapshot(cal: WorkCalendar, p: AttentionParams, now: Date): Date {
  return cal.lastWeeklyReviewAt(now, p.weeklyReviewWeekday, p.weeklyReviewTime)
}

function entryAttention(a: TopicAttention | null): TopicEntryAttention | null {
  if (!a) return null
  return {
    list: a.list,
    profile: a.profile,
    band: a.band,
    class: a.class,
    score: a.score,
    deadline: a.deadline,
    overdue: a.overdue,
    escalations: a.escalations,
    section: a.section ?? null,
    hiddenReason: a.hiddenReason,
    explanation: a.explanation ?? [],
    cycleStartedAt: a.cycleStartedAt,
    cycleReason: a.cycleReason,
    cardExpiresAt: a.cardExpiresAt,
    ...((a as { limited?: boolean }).limited ? { limited: true } : {}),
  }
}

// ── P6 daily limit (phase 7, 06 §7.2; rules in src/lib/topics/delivery-routing.ts) ──

type LimitContext = {
  memberIds: Set<string>
  limit: number
  /** `cards.digestVisibleItems` (delivery params ladder). */
  digestVisibleItems: number
  dayOf: (iso: string | null) => string
}

async function loadLimitContext(orgId: string, cal: WorkCalendar): Promise<LimitContext> {
  const [memberIds, dp] = await Promise.all([orgHumanMemberIds(orgId), loadDeliveryParams(orgId)])
  return {
    memberIds,
    limit: dp.dailyPushLimit,
    digestVisibleItems: dp.digestVisibleItems,
    dayOf: (iso) => (iso ? cal.localDay(new Date(iso)) : "0000-00-00"),
  }
}

// ── Lists: «Сейчас» continuous, «Сводка» / «Неделя» frozen (06 §7.2) ──────

/** One live topic, placed at read time — enough for routing, the limit, the freeze and the counts. */
type LightRow = {
  topicId: string
  ownerUserId: string | null
  dealOwnerUserId: string | null
  lastActivityAt: Date
  attention: TopicAttention | null
}

type OrgLightLists = { now: LightRow[]; digest: LightRow[]; week: LightRow[]; others: LightRow[] }

/**
 * The org's lists at `now` in rank order (06 §7.4), no daily limit; `others`
 * = live topics placed in no list that were in the last «Сводка» or «Неделя»
 * snapshot (they may still be held there).
 */
function orgLightLists(state: ListState): OrgLightLists {
  const out: OrgLightLists = { now: [], digest: [], week: [], others: [] }
  for (const r of state.rows) {
    const a = r.placed
    if (!a) continue
    const row: LightRow = {
      topicId: r.topicId,
      ownerUserId: r.ownerUserId,
      dealOwnerUserId: r.dealOwnerUserId,
      lastActivityAt: r.lastActivityAt,
      attention: a,
    }
    if (a.list === "now" || a.list === "digest" || a.list === "week") out[a.list].push(row)
    else {
      const f = state.snapshot.facts[r.topicId]
      if (f && (f.digestList === "digest" || f.weekList === "week")) out.others.push(row)
    }
  }
  const rank = (x: LightRow, y: LightRow) => compareRank(x.attention!, y.attention!)
  out.now.sort(rank)
  out.digest.sort(rank)
  out.week.sort(rank)
  return out
}

function viewerLightLists(state: ListState, lim: LimitContext, userId: string) {
  return viewerLists(orgLightLists(state), state.snapshot, userId, lim.memberIds, lim.limit, lim.dayOf)
}

// ── Cards ─────────────────────────────────────────────────────────────────

type CardRow = typeof card.$inferSelect
const iso = (d: Date | null) => (d ? d.toISOString() : null)

function cardView(c: CardRow, now: Date): TopicCardView {
  const msg = (c.message ?? {}) as {
    analysis?: unknown
    recommendation?: unknown
    orderRequest?: unknown
    taskTitle?: unknown
    dealCard?: { headline?: unknown }
  }
  const kind = isCardKind(c.kind) ? c.kind : "topic"
  const meta = metaOf(c)
  const proposal = kind === "topic" ? null : proposalOf(c)
  const recommendation = typeof msg.recommendation === "string" ? msg.recommendation : ""
  const headline =
    meta?.headline ??
    (typeof msg.dealCard?.headline === "string" ? msg.dealCard.headline : null) ??
    (typeof msg.analysis === "string" ? msg.analysis.split("\n")[0] : "")
  return {
    id: c.id,
    kind,
    status: effectiveCardStatus(c.status, c.expiresAt, now),
    headline,
    whyNow: meta?.whyNow ?? proposal?.reasonRu ?? "",
    whatChanged: c.sinceLast ?? meta?.whatChanged ?? "",
    steps: meta?.steps ?? recommendation.split("\n").map((s) => s.trim()).filter(Boolean),
    taskTitle: typeof msg.taskTitle === "string" ? msg.taskTitle : (meta?.taskTitle ?? null),
    category: c.category,
    priority: c.priority,
    orderRequest: typeof msg.orderRequest === "string" ? msg.orderRequest : null,
    leadCode: c.leadCode,
    events: Array.isArray(c.events) ? (c.events as TopicCardEvent[]) : [],
    proposal,
    dealId: c.dealId,
    rejectReasonCode: c.rejectReasonCode,
    rejectionReason: c.rejectionReason,
    decidedAt: iso(c.decidedAt),
    resultTaskId: c.resultTaskId,
    resultOrderId: c.resultOrderId,
    expiresAt: iso(c.expiresAt),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  }
}

async function loadCards(orgId: string, topicIds: readonly string[]): Promise<Map<string, CardRow[]>> {
  const out = new Map<string, CardRow[]>()
  for (let i = 0; i < topicIds.length; i += 500) {
    const chunk = topicIds.slice(i, i + 500)
    const rows = await db
      .select()
      .from(card)
      .where(
        and(
          eq(card.organizationId, orgId),
          inArray(card.topicId, chunk),
          inArray(card.kind, ["topic", ...DEAL_KINDS]),
        ),
      )
      .orderBy(desc(card.createdAt))
    for (const r of rows) {
      const list = out.get(r.topicId!) ?? []
      list.push(r)
      out.set(r.topicId!, list)
    }
  }
  return out
}

// ── Entries ───────────────────────────────────────────────────────────────

const ownerUser = alias(user, "topic_owner_user")

type HeadRow = {
  t: typeof topic.$inferSelect
  clientName: string | null
  contactName: string | null
  dealName: string | null
  dealOwnerUserId: string | null
  ownerName: string | null
}

const headSelect = {
  t: topic,
  clientName: client.name,
  contactName: contactDisplaySql(),
  dealName: deal.name,
  dealOwnerUserId: deal.userId,
  ownerName: ownerUser.name,
}

function headQuery() {
  return db
    .select(headSelect)
    .from(topic)
    .leftJoin(client, eq(client.id, topic.clientId))
    .leftJoin(contact, eq(contact.id, topic.contactId))
    .leftJoin(deal, eq(deal.id, topic.dealId))
    .leftJoin(ownerUser, eq(ownerUser.id, topic.ownerUserId))
}

async function loadHeads(orgId: string, ids: readonly string[]): Promise<Map<string, HeadRow>> {
  const out = new Map<string, HeadRow>()
  for (let i = 0; i < ids.length; i += 500) {
    const rows = await headQuery().where(and(eq(topic.organizationId, orgId), inArray(topic.id, ids.slice(i, i + 500))))
    for (const r of rows) out.set(r.t.id, r)
  }
  return out
}

async function codeLabels(): Promise<Map<string, string>> {
  const registry = await getRegistry()
  return new Map(registry.categories.map((c) => [c.code, c.labelRu]))
}

/**
 * Newest contact named on each topic's items (not `context` items) — the
 * fallback contact of a task made from the card when the topic itself has
 * none. Only contacts still active / initial.
 */
async function loadItemContacts(orgId: string, ids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (let i = 0; i < ids.length; i += 500) {
    const rows = await db
      .selectDistinctOn([topicItem.topicId], { topicId: topicItem.topicId, contactId: sourceItemSubject.contactId })
      .from(topicItem)
      .innerJoin(
        sourceItemSubject,
        and(eq(sourceItemSubject.sourceItemId, topicItem.sourceItemId), eq(sourceItemSubject.subjectIndex, topicItem.subjectIndex)),
      )
      .innerJoin(sourceItem, eq(sourceItem.id, topicItem.sourceItemId))
      .innerJoin(contact, eq(contact.id, sourceItemSubject.contactId))
      .where(
        and(
          eq(topicItem.organizationId, orgId),
          inArray(topicItem.topicId, ids.slice(i, i + 500)),
          ne(topicItem.role, "context"),
          eq(contact.organizationId, orgId),
          inArray(contact.status, ["active", "initial"]),
        ),
      )
      .orderBy(topicItem.topicId, desc(sourceItem.createdAt))
    for (const r of rows) if (r.contactId) out.set(r.topicId, r.contactId)
  }
  return out
}

/**
 * «Источники» of topic cards: per topic the newest non-context messages
 * (one row per source item), ≤ TOPIC_CARD_SOURCES + the total count.
 */
async function loadEntrySources(
  orgId: string,
  ids: readonly string[],
): Promise<Map<string, { sources: TopicSourceRef[]; count: number }>> {
  const out = new Map<string, { sources: TopicSourceRef[]; count: number }>()
  for (let i = 0; i < ids.length; i += 500) {
    const rows = await db
      .select({
        topicId: topicItem.topicId,
        sourceItemId: topicItem.sourceItemId,
        provider: source.provider,
        externalType: sourceItem.externalType,
        sourceCreatedAt: sourceItem.sourceCreatedAt,
        createdAt: sourceItem.createdAt,
        orgAttribution: sourceItem.orgAttribution,
        metadataJson: sourceItem.metadataJson,
      })
      .from(topicItem)
      .innerJoin(sourceItem, eq(sourceItem.id, topicItem.sourceItemId))
      .leftJoin(source, eq(source.id, sourceItem.sourceId))
      .where(
        and(
          eq(topicItem.organizationId, orgId),
          inArray(topicItem.topicId, ids.slice(i, i + 500)),
          ne(topicItem.role, "context"),
        ),
      )
    const byTopic = new Map<string, Map<string, TopicSourceRef>>()
    for (const r of rows) {
      const m = byTopic.get(r.topicId) ?? new Map<string, TopicSourceRef>()
      if (!m.has(r.sourceItemId)) {
        const env = envelopeFromItem(r)
        m.set(r.sourceItemId, {
          sourceItemId: r.sourceItemId,
          date: (r.sourceCreatedAt ?? r.createdAt).toISOString(),
          provider: r.provider,
          subject: env.subject ?? null,
          from: env.from ?? null,
        })
      }
      byTopic.set(r.topicId, m)
    }
    for (const [topicId, m] of byTopic) {
      const all = [...m.values()].sort((a, b) => b.date.localeCompare(a.date))
      out.set(topicId, { sources: all.slice(0, TOPIC_CARD_SOURCES), count: all.length })
    }
  }
  return out
}

function toEntry(
  h: HeadRow,
  attention: TopicAttention | null,
  cards: CardRow[],
  labels: Map<string, string>,
  now: Date,
  itemContactId: string | null = null,
  sources: { sources: TopicSourceRef[]; count: number } = { sources: [], count: 0 },
): TopicEntry {
  const t = h.t
  const att = entryAttention(attention)
  const topicCard = cards.find((c) => c.kind === "topic") ?? null
  const dealCards = cards
    .filter((c) => c.kind !== "topic" && effectiveCardStatus(c.status, c.expiresAt, now) === "open")
    .map((c) => cardView(c, now))
  const leadCode = attention?.leadCode ?? t.leadCode
  return {
    topicId: t.id,
    title: t.title,
    matter: t.matter,
    status: t.status,
    subState: t.subState,
    clientId: t.clientId,
    clientName: h.clientName,
    contactId: t.contactId,
    contactName: h.contactName,
    taskContactId: t.contactId ?? itemContactId,
    family: t.family,
    sources: sources.sources,
    sourceCount: sources.count,
    dealId: t.dealId,
    dealName: h.dealName,
    dealOwnerUserId: h.dealOwnerUserId,
    ownerUserId: t.ownerUserId,
    ownerName: h.ownerName,
    leadCode,
    leadLabelRu: leadCode ? (labels.get(leadCode) ?? null) : null,
    lastActivityAt: t.lastActivityAt.toISOString(),
    snoozedUntil: t.snoozedUntil && t.snoozedUntil.getTime() > now.getTime() ? t.snoozedUntil.toISOString() : null,
    attention: att,
    card: topicCard ? cardView(topicCard, now) : null,
    dealCards,
    marker: att && att.list !== "none" ? cycleMarker(att, now) : null,
    reminder:
      t.status === "open"
        ? reminderMarker({ lastReminderAt: t.lastReminderAt, cycleStartedAt: t.cycleStartedAt, cycleReminders: t.cycleReminders }, now)
        : null,
  }
}

async function buildEntries(
  orgId: string,
  placed: { topicId: string; attention: TopicAttention | null }[],
  now: Date,
): Promise<TopicEntry[]> {
  if (placed.length === 0) return []
  const ids = placed.map((p) => p.topicId)
  const [heads, cards, labels, itemContacts, sources] = await Promise.all([
    loadHeads(orgId, ids),
    loadCards(orgId, ids),
    codeLabels(),
    loadItemContacts(orgId, ids),
    loadEntrySources(orgId, ids),
  ])
  const out: TopicEntry[] = []
  for (const p of placed) {
    const h = heads.get(p.topicId)
    if (h) {
      out.push(toEntry(h, p.attention, cards.get(p.topicId) ?? [], labels, now, itemContacts.get(p.topicId) ?? null, sources.get(p.topicId)))
    }
  }
  return out
}

/**
 * SQL condition of one «Все темы» status filter (`TOPIC_STATUS_FILTERS`).
 * «Ошибочные» = dismissed, or the topic's LATEST topic card is rejected
 * (any reason) — a newer card of a later cycle takes the topic out again.
 */
function allStatusCondition(f: TopicStatusFilter): SQL {
  switch (f) {
    case "all":
      return ne(topic.status, "merged")
    case "tasked":
      return and(ne(topic.status, "merged"), sql`exists (
        select 1 from ${card} c
        where c.topic_id = ${topic.id} and c.result_task_id is not null
      )`)!
    case "closed":
      return inArray(topic.status, ["resolved", "done"])
    case "erroneous":
      return or(
        eq(topic.status, "dismissed"),
        sql`(
          select c.status from ${card} c
          where c.topic_id = ${topic.id} and c.kind = 'topic'
          order by c.created_at desc, c.id desc
          limit 1
        ) = 'rejected'`,
      )!
    default:
      return eq(topic.status, f)
  }
}

/** «Все темы» (06 §7.2): every topic incl. snoozed / waiting / closed, with filters. */
async function allEntries(orgId: string, filters: TopicAllFilters, now: Date): Promise<TopicEntry[]> {
  const statusCond = allStatusCondition(topicStatusFilterOf(filters.status))
  const rows = await db
    .select({ id: topic.id, attention: topic.attention })
    .from(topic)
    .where(
      and(
        eq(topic.organizationId, orgId),
        statusCond,
        ...(filters.clientId ? [eq(topic.clientId, filters.clientId)] : []),
      ),
    )
    .orderBy(desc(topic.lastActivityAt), asc(topic.id))
    .limit(ALL_TOPICS_LIMIT)
  const placer = await loadPlacer(orgId)
  const listFilter = filters.list && (TOPIC_LISTS as readonly string[]).includes(filters.list) ? filters.list : null
  const placed = rows
    .map((r) => ({ topicId: r.id, attention: placer.place(r.attention, now) }))
    .filter((p) => !listFilter || (p.attention?.list ?? "none") === listFilter)
  return buildEntries(orgId, placed, now)
}

/** Open deal cards of the org (any topic), newest first — «Решения по сделкам» on «Сейчас». */
async function openDealCards(orgId: string, now: Date): Promise<TopicListResponse["dealCards"]> {
  const rows = await db
    .select({ c: card, topicTitle: topic.title, clientName: client.name })
    .from(card)
    .innerJoin(topic, eq(topic.id, card.topicId))
    .leftJoin(client, eq(client.id, topic.clientId))
    .where(and(eq(card.organizationId, orgId), inArray(card.kind, [...DEAL_KINDS]), eq(card.status, "open")))
    .orderBy(desc(card.createdAt))
    .limit(200)
  return rows
    .map((r) => ({ ...cardView(r.c, now), topicId: r.c.topicId!, topicTitle: r.topicTitle, clientName: r.clientName }))
    .filter((c) => c.status === "open")
}

/** Owners of the topics of some deal cards (for «Мои» on deal cards). */
async function topicOwners(orgId: string, topicIds: string[]): Promise<Map<string, { ownerUserId: string | null; dealOwnerUserId: string | null }>> {
  const out = new Map<string, { ownerUserId: string | null; dealOwnerUserId: string | null }>()
  if (topicIds.length === 0) return out
  const rows = await db
    .select({ id: topic.id, ownerUserId: topic.ownerUserId, dealOwnerUserId: deal.userId })
    .from(topic)
    .leftJoin(deal, eq(deal.id, topic.dealId))
    .where(and(eq(topic.organizationId, orgId), inArray(topic.id, topicIds)))
  for (const r of rows) out.set(r.id, { ownerUserId: r.ownerUserId, dealOwnerUserId: r.dealOwnerUserId })
  return out
}

/** One dashboard tab: entries in rank order (+ «Решения по сделкам» on «Сейчас»), «Мои» applied. */
export async function readTopicTab(
  orgId: string,
  userId: string,
  tab: TopicTab,
  opts: { mine?: boolean; filters?: TopicAllFilters; now?: Date } = {},
): Promise<TopicListResponse> {
  const now = opts.now ?? new Date()
  const placer = await loadPlacer(orgId)
  const lim = await loadLimitContext(orgId, placer.cal)
  let entries: TopicEntry[]
  if (tab === "all") {
    entries = await allEntries(orgId, opts.filters ?? {}, now)
  } else {
    // «Сейчас» with the P6 daily limit as THIS user sees it; «Сводка» /
    // «Неделя» frozen at their last snapshot (src/lib/topics/list-snapshot.ts).
    const state = await readListState(orgId, now)
    const v = viewerLightLists(state, lim, userId)
    const chosen: (LightRow & { snapshot?: "snapshot" | "held" | "since" })[] = v[tab]
    const built = await buildEntries(
      orgId,
      chosen.map((r) => ({ topicId: r.topicId, attention: r.attention })),
      now,
    )
    const membership = new Map(chosen.map((r) => [r.topicId, r.snapshot ?? null]))
    entries = tab === "now" ? built : built.map((e) => ({ ...e, snapshot: membership.get(e.topicId) ?? null }))
  }
  let dealCards: TopicListResponse["dealCards"] = []
  if (tab === "now") {
    dealCards = await openDealCards(orgId, now)
    if (opts.mine) {
      const owners = await topicOwners(orgId, [...new Set(dealCards.map((c) => c.topicId))])
      dealCards = dealCards.filter((c) => {
        const o = owners.get(c.topicId)
        return !!o && (o.ownerUserId === userId || o.dealOwnerUserId === userId)
      })
    }
  }
  return {
    tab,
    entries: filterMine(entries, userId, !!opts.mine),
    dealCards,
    digestSnapshotAt: lastDigestSnapshot(placer.cal, placer.params, now).toISOString(),
    weeklySnapshotAt: lastWeeklySnapshot(placer.cal, placer.params, now).toISOString(),
    digestVisibleItems: lim.digestVisibleItems,
    now: now.toISOString(),
  }
}

/**
 * The org's list entries at `now` for the delivery phase (plan phase 7):
 * «Сейчас» / «Сводка» / «Неделя» in rank order with NO daily limit and NO
 * freeze, plus the held candidates (`others`) and the snapshot context —
 * `userLists` (src/lib/topics/delivery-content.ts) applies the limit and the
 * freeze per recipient, so the emails show exactly what the dashboard shows.
 */
export async function readOrgListEntries(
  orgId: string,
  now: Date = new Date(),
): Promise<{ now: TopicEntry[]; digest: TopicEntry[]; week: TopicEntry[]; others: TopicEntry[]; snapshot: SnapshotContext }> {
  const state = await readListState(orgId, now)
  const org = orgLightLists(state)
  const all = [...org.now, ...org.digest, ...org.week, ...org.others]
  const built = await buildEntries(
    orgId,
    all.map((r) => ({ topicId: r.topicId, attention: r.attention })),
    now,
  )
  const byId = new Map(built.map((e) => [e.topicId, e]))
  const pick = (rows: LightRow[]) => rows.map((r) => byId.get(r.topicId)).filter((e): e is TopicEntry => !!e)
  return { now: pick(org.now), digest: pick(org.digest), week: pick(org.week), others: pick(org.others), snapshot: state.snapshot }
}

/** Counts per tab (all + «Мои»), same lists as `readTopicTab`. «Сейчас» counts open deal cards too; «Все темы» = live topics. */
export async function readTopicCounts(orgId: string, userId: string, now: Date = new Date()): Promise<TopicCounts> {
  const placer = await loadPlacer(orgId)
  const [lim, state, dealCards] = await Promise.all([
    loadLimitContext(orgId, placer.cal),
    readListState(orgId, now),
    openDealCards(orgId, now),
  ])
  const v = viewerLightLists(state, lim, userId)
  const owners = await topicOwners(orgId, [...new Set(dealCards.map((c) => c.topicId))])
  const dealCardOwners = dealCards.map((c) => owners.get(c.topicId) ?? { ownerUserId: null, dealOwnerUserId: null })
  const nowCount = countEntries(v.now, userId)
  const dealCount = countEntries(dealCardOwners, userId)
  return {
    now: { all: nowCount.all + dealCount.all, mine: nowCount.mine + dealCount.mine },
    digest: countEntries(v.digest, userId),
    week: countEntries(v.week, userId),
    all: countEntries(state.rows, userId),
  }
}

/** Companies that have topics (filter «Компания» of «Все темы»). */
export async function listTopicClients(orgId: string): Promise<{ id: string; name: string }[]> {
  return db
    .selectDistinct({ id: client.id, name: client.name })
    .from(topic)
    .innerJoin(client, eq(client.id, topic.clientId))
    .where(eq(topic.organizationId, orgId))
    .orderBy(client.name)
    .limit(1000)
}

// ── One topic (drawer) ────────────────────────────────────────────────────

const ROLE_ORDER = ["origin", "closing", "update", "context"]

/** One timeline row per source item (an item with two subjects on the topic has two links). */
function dedupeItems<T extends { sourceItemId: string; role: string }>(rows: T[]): T[] {
  const best = new Map<string, T>()
  for (const r of rows) {
    const cur = best.get(r.sourceItemId)
    const rank = (x: T) => (ROLE_ORDER.indexOf(x.role) + 5) % 5
    if (!cur || rank(r) < rank(cur)) best.set(r.sourceItemId, r)
  }
  return [...best.values()]
}

export async function getTopicView(orgId: string, topicId: string, now: Date = new Date()): Promise<TopicDetailView | null> {
  const [head] = await headQuery().where(and(eq(topic.organizationId, orgId), eq(topic.id, topicId)))
  if (!head) return null
  const t = head.t
  const [placer, labels, cardsMap, items, instances, events, dealRow, orders, itemContacts] = await Promise.all([
    loadPlacer(orgId),
    codeLabels(),
    loadCards(orgId, [topicId]),
    db
      .select({
        sourceItemId: topicItem.sourceItemId,
        subjectIndex: topicItem.subjectIndex,
        role: topicItem.role,
        provider: source.provider,
        externalType: sourceItem.externalType,
        sourceCreatedAt: sourceItem.sourceCreatedAt,
        createdAt: sourceItem.createdAt,
        orgAttribution: sourceItem.orgAttribution,
        metadataJson: sourceItem.metadataJson,
        signalFacts: sourceItem.signalFacts,
      })
      .from(topicItem)
      .innerJoin(sourceItem, eq(sourceItem.id, topicItem.sourceItemId))
      .leftJoin(source, eq(source.id, sourceItem.sourceId))
      .where(and(eq(topicItem.organizationId, orgId), eq(topicItem.topicId, topicId))),
    db
      .select()
      .from(signalInstance)
      .where(and(eq(signalInstance.organizationId, orgId), eq(signalInstance.topicId, topicId)))
      .orderBy(asc(signalInstance.createdAt)),
    db
      .select({ e: topicEvent, userName: user.name })
      .from(topicEvent)
      .leftJoin(user, eq(user.id, topicEvent.userId))
      .where(and(eq(topicEvent.organizationId, orgId), eq(topicEvent.topicId, topicId)))
      .orderBy(desc(topicEvent.createdAt))
      .limit(300),
    t.dealId
      ? db
          .select({
            id: deal.id,
            name: deal.name,
            status: deal.status,
            stageName: dealFunnelStage.name,
            stageDisplayName: dealFunnelStage.displayName,
          })
          .from(deal)
          .leftJoin(dealFunnelStage, eq(dealFunnelStage.id, deal.funnelStageId))
          .where(and(eq(deal.organizationId, orgId), eq(deal.id, t.dealId)))
      : Promise.resolve([]),
    listTopicOrders(orgId, topicId),
    t.contactId ? Promise.resolve(new Map<string, string>()) : loadItemContacts(orgId, [topicId]),
  ])
  const cards = cardsMap.get(topicId) ?? []
  const attention = placer.place(t.attention, now)
  const entry = toEntry(head, attention, cards, labels, now, itemContacts.get(topicId) ?? null, (
    await loadEntrySources(orgId, [topicId])
  ).get(topicId))
  const d = dealRow[0]
  const labelOf = (code: string) => labels.get(code) ?? null
  return {
    ...entry,
    references: t.references,
    products: t.products,
    firstSeenAt: t.firstSeenAt.toISOString(),
    closedAt: iso(t.closedAt),
    closedReason: t.closedReason,
    mergedIntoTopicId: t.mergedIntoTopicId,
    deal: d
      ? { id: d.id, name: d.name, status: d.status, stageLabel: d.stageName ? stageDisplayLabel(d.stageName, d.stageDisplayName) : null }
      : null,
    items: dedupeItems(items)
      .map((i) => {
        const env = envelopeFromItem(i)
        const dir = (i.signalFacts as { direction?: unknown } | null)?.direction
        return {
          sourceItemId: i.sourceItemId,
          subjectIndex: i.subjectIndex,
          role: i.role,
          date: (i.sourceCreatedAt ?? i.createdAt).toISOString(),
          provider: i.provider,
          externalType: i.externalType,
          subject: env.subject ?? null,
          from: env.from ?? null,
          direction: typeof dir === "string" ? dir : null,
        }
      })
      .sort((a, b) => b.date.localeCompare(a.date)),
    signals: instances.map((i) => ({
      id: i.id,
      code: i.code,
      labelRu: labelOf(i.code),
      sourceItemId: i.sourceItemId,
      confidence: i.confidence,
      counted: i.counted,
      notCountedReason: i.notCountedReason,
      evidence: i.evidence,
      createdAt: i.createdAt.toISOString(),
      origin: i.origin,
      processKey: i.processKey,
      clearedAt: iso(i.clearedAt),
      clearedReason: i.clearedReason,
    })),
    events: events.map(({ e, userName }) => ({
      id: e.id,
      type: e.type,
      actor: e.actor,
      userName,
      sourceItemId: e.sourceItemId,
      text: describeTopicEvent({ type: e.type, actor: e.actor, payload: e.payload }, labelOf),
      createdAt: e.createdAt.toISOString(),
    })),
    cards: cards.filter((c) => c.kind === "topic").map((c) => cardView(c, now)),
    allDealCards: cards.filter((c) => c.kind !== "topic").map((c) => cardView(c, now)),
    orders,
  }
}

/** «Привязать заказ» (phase 10): orders of the topic's company not yet on this topic. */
export async function listOrderOptions(orgId: string, topicId: string): Promise<TopicOrderOption[]> {
  await topicHead(orgId, topicId)
  return listTopicOrderOptions(orgId, topicId)
}

// ── Drawer pickers ────────────────────────────────────────────────────────

async function topicHead(orgId: string, topicId: string) {
  const [row] = await db
    .select({ id: topic.id, clientId: topic.clientId, contactId: topic.contactId, status: topic.status, dealId: topic.dealId })
    .from(topic)
    .where(and(eq(topic.organizationId, orgId), eq(topic.id, topicId)))
  if (!row) throw new TopicsUserError("Тема не найдена", 404)
  return row
}

/** «Объединить с…»: other live topics of the same company (or the same contact when there is no company). */
export async function listMergeOptions(orgId: string, topicId: string): Promise<TopicMergeOption[]> {
  const h = await topicHead(orgId, topicId)
  if (!h.clientId && !h.contactId) return []
  const rows = await db
    .select({ id: topic.id, title: topic.title, status: topic.status, lastActivityAt: topic.lastActivityAt })
    .from(topic)
    .where(
      and(
        eq(topic.organizationId, orgId),
        ne(topic.id, topicId),
        inArray(topic.status, LIVE),
        h.clientId ? eq(topic.clientId, h.clientId) : eq(topic.contactId, h.contactId!),
      ),
    )
    .orderBy(desc(topic.lastActivityAt))
    .limit(100)
  return rows.map((r) => ({ ...r, lastActivityAt: r.lastActivityAt.toISOString() }))
}

/** «Привязать к сделке»: open deals of the topic's company. */
export async function listDealOptions(orgId: string, topicId: string): Promise<TopicDealOption[]> {
  const h = await topicHead(orgId, topicId)
  if (!h.clientId) return []
  const rows = await db
    .select({
      id: deal.id,
      name: deal.name,
      status: deal.status,
      stageName: dealFunnelStage.name,
      stageDisplayName: dealFunnelStage.displayName,
    })
    .from(deal)
    .leftJoin(dealFunnelStage, eq(dealFunnelStage.id, deal.funnelStageId))
    .where(and(eq(deal.organizationId, orgId), eq(deal.clientId, h.clientId), inArray(deal.status, [...OPEN_DEAL_STATUSES])))
    .orderBy(desc(deal.updatedAt))
    .limit(100)
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    stageLabel: r.stageName ? stageDisplayLabel(r.stageName, r.stageDisplayName) : null,
  }))
}

/** «Ответственный»: human members of the org. */
export async function listOwnerOptions(orgId: string): Promise<TopicOwnerOption[]> {
  return db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, orgId), humanUsersOnly()))
    .orderBy(user.name)
}

// ── Actions ───────────────────────────────────────────────────────────────

const MAX_SNOOZE_DAYS = 365

/** `YYYY-MM-DD` = start of that working day (org time); otherwise an ISO datetime. */
async function parseSnoozeUntil(orgId: string, raw: string, now: Date): Promise<Date> {
  let until: Date
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const { params, cal } = await loadPlacer(orgId)
    until = cal.at(raw, params.workStart)
  } else {
    until = new Date(raw)
  }
  if (!Number.isFinite(until.getTime())) throw new TopicsUserError("Неверная дата")
  if (until.getTime() <= now.getTime()) throw new TopicsUserError("Дата должна быть в будущем")
  if (until.getTime() - now.getTime() > MAX_SNOOZE_DAYS * 24 * 3600_000) {
    throw new TopicsUserError("Отложить можно не больше чем на год")
  }
  return until
}

/**
 * Run one drawer / dashboard action as `userId`. Every action recomputes the
 * topic's attention at once (in topic-store), so the next list read shows
 * the new placement.
 */
export async function runTopicAction(
  orgId: string,
  userId: string,
  input: TopicActionInput,
): Promise<{ topicId: string; deleted?: boolean }> {
  const now = new Date()
  switch (input.action) {
    case "done":
      await markTopicDone(orgId, input.topicId, userId, input.note?.trim() || undefined)
      return { topicId: input.topicId }
    case "dismiss":
      await dismissTopic(orgId, input.topicId, userId, input.reason?.trim() || undefined)
      return { topicId: input.topicId }
    case "snooze":
      await snoozeTopic(orgId, input.topicId, userId, await parseSnoozeUntil(orgId, input.until, now))
      return { topicId: input.topicId }
    case "unsnooze":
      await snoozeTopic(orgId, input.topicId, userId, null)
      return { topicId: input.topicId }
    case "merge": {
      const options = await listMergeOptions(orgId, input.topicId)
      if (!options.some((o) => o.id === input.otherTopicId)) {
        throw new TopicsUserError("Объединить можно только с открытой темой той же компании")
      }
      await mergeTopics(orgId, input.otherTopicId, input.topicId, userId)
      return { topicId: input.topicId }
    }
    case "detach": {
      const r = await detachItemFromTopic(orgId, input.topicId, input.sourceItemId, userId)
      return { topicId: input.topicId, deleted: r.deleted }
    }
    case "link_deal": {
      if (input.dealId) {
        const options = await listDealOptions(orgId, input.topicId)
        if (!options.some((o) => o.id === input.dealId)) {
          throw new TopicsUserError("Привязать можно только открытую сделку компании этой темы")
        }
      }
      await setTopicDeal(orgId, input.topicId, input.dealId, userId)
      return { topicId: input.topicId }
    }
    case "set_owner": {
      const members = await listOwnerOptions(orgId)
      const to = input.userId ? members.find((m) => m.id === input.userId) : null
      if (input.userId && !to) throw new TopicsUserError("Пользователь не состоит в организации")
      const [row] = await db
        .select({ ownerUserId: topic.ownerUserId })
        .from(topic)
        .where(and(eq(topic.organizationId, orgId), eq(topic.id, input.topicId)))
      if (!row) throw new TopicsUserError("Тема не найдена", 404)
      const from = row.ownerUserId ? members.find((m) => m.id === row.ownerUserId) : null
      await setTopicOwner(orgId, input.topicId, input.userId, userId, { fromName: from?.name ?? null, toName: to?.name ?? null })
      return { topicId: input.topicId }
    }
    case "recompute":
      await topicHead(orgId, input.topicId)
      await refreshTopicAttention(orgId, input.topicId)
      return { topicId: input.topicId }
    case "link_order":
    case "unlink_order": {
      const h = await topicHead(orgId, input.topicId)
      try {
        if (input.action === "link_order") {
          if (h.status === "merged") throw new TopicsUserError("Тема объединена с другой")
          const options = await listTopicOrderOptions(orgId, input.topicId)
          if (!options.some((o) => o.id === input.orderId)) {
            throw new TopicsUserError("Привязать можно только заказ компании этой темы")
          }
          await setOrderTopic(orgId, userId, input.orderId, input.topicId, { via: "user" })
        } else {
          const linked = await listTopicOrders(orgId, input.topicId)
          if (!linked.some((o) => o.id === input.orderId)) throw new TopicsUserError("Заказ не привязан к этой теме")
          await setOrderTopic(orgId, userId, input.orderId, null, { via: "user" })
        }
      } catch (e) {
        if (e instanceof OrderTopicLinkError) throw new TopicsUserError(e.message)
        throw e
      }
      return { topicId: input.topicId }
    }
  }
}

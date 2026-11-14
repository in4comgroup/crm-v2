import "server-only"

import { and, asc, desc, eq, inArray, ne } from "drizzle-orm"
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
  topic,
  topicEvent,
  topicItem,
  user,
} from "@/db/schema"
import { OPEN_DEAL_STATUSES, stageDisplayLabel } from "@/lib/deal-funnel"
import { WorkCalendar } from "@/lib/topics/attention-calendar"
import type { AttentionParams } from "@/lib/topics/attention-params"
import { TOPIC_LISTS, type TopicAttention, type TopicList } from "@/lib/topics/attention-types"
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
  type TopicMergeOption,
  type TopicOwnerOption,
  type TopicTab,
} from "@/lib/topics/topic-ui"
import { isTopicStatus, TOPIC_LIVE_STATUSES, type TopicStatus } from "@/lib/topics/types"
import { reminderMarker, splitWithDailyLimit, type RoutableEntry } from "@/lib/topics/delivery-routing"
import { loadDeliveryParams, orgHumanMemberIds } from "@/server/topics/delivery/store"
import { getRegistry } from "@/server/signals/registry"
import { placeStoredAttention } from "@/server/topics/attention/engine"
import { loadAttentionParams, loadCalendarDays, readTopicList } from "@/server/topics/attention/store"
import { proposalOf } from "@/server/topics/cards/deal-cards"
import { effectiveCardStatus } from "@/server/topics/cards/logic"
import { attentionOf, metaOf } from "@/server/topics/cards/store"
import { topicCardsVisible } from "@/server/topics/cards/visibility"
import { envelopeFromItem } from "@/server/topics/signals/item-input"
import { humanUsersOnly } from "@/server/topics/system-actor"
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
  let probe = now
  for (let i = 0; i < 20; i++) {
    const day = cal.localDay(probe)
    const at = cal.at(day, p.morningDigestTime)
    if (cal.isWorkingDay(day) && at.getTime() <= now.getTime()) return at
    probe = new Date(at.getTime() - 12 * 3600_000)
  }
  return new Date(now.getTime() - 24 * 3600_000)
}

/** Last «Неделя» snapshot moment ≤ now (weekly review weekday + time). */
export function lastWeeklySnapshot(cal: WorkCalendar, p: AttentionParams, now: Date): Date {
  const at = cal.nextWeekdayAt(new Date(now.getTime() - 7 * 24 * 3600_000), p.weeklyReviewWeekday, p.weeklyReviewTime)
  return at.getTime() <= now.getTime() ? at : new Date(at.getTime() - 7 * 24 * 3600_000)
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
  }
}

// ── P6 daily limit (phase 7, 06 §7.2; rules in src/lib/topics/delivery-routing.ts) ──

type LimitContext = { memberIds: Set<string>; limit: number; dayOf: (iso: string | null) => string }

async function loadLimitContext(orgId: string, placer: Placer): Promise<LimitContext> {
  const [memberIds, dp] = await Promise.all([orgHumanMemberIds(orgId), loadDeliveryParams(orgId)])
  return {
    memberIds,
    limit: dp.dailyPushLimit,
    dayOf: (iso) => (iso ? placer.cal.localDay(new Date(iso)) : "0000-00-00"),
  }
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
  contactName: contact.name,
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

function toEntry(
  h: HeadRow,
  attention: TopicAttention | null,
  cards: CardRow[],
  labels: Map<string, string>,
  now: Date,
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
  const [heads, cards, labels] = await Promise.all([loadHeads(orgId, ids), loadCards(orgId, ids), codeLabels()])
  const out: TopicEntry[] = []
  for (const p of placed) {
    const h = heads.get(p.topicId)
    if (h) out.push(toEntry(h, p.attention, cards.get(p.topicId) ?? [], labels, now))
  }
  return out
}

/** Entries of one attention list (rank order, read-time placement via `readTopicList`). */
async function listEntries(orgId: string, list: Exclude<TopicList, "none">, now: Date): Promise<TopicEntry[]> {
  const rows = await readTopicList(orgId, list, now)
  return buildEntries(
    orgId,
    rows.map((r) => ({ topicId: r.topicId, attention: r.attention })),
    now,
  )
}

/** «Все темы» (06 §7.2): every topic incl. snoozed / waiting / closed, with filters. */
async function allEntries(orgId: string, filters: TopicAllFilters, now: Date): Promise<TopicEntry[]> {
  const status = filters.status ?? "live"
  const statusCond =
    status === "all"
      ? ne(topic.status, "merged")
      : isTopicStatus(status)
        ? eq(topic.status, status)
        : inArray(topic.status, LIVE)
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
  let entries: TopicEntry[]
  if (tab === "now" || tab === "digest") {
    // P6 daily limit as THIS user sees it: overflow «Сейчас» → «Сводка».
    const [lim, nowE, digestE] = await Promise.all([
      loadLimitContext(orgId, placer),
      listEntries(orgId, "now", now),
      listEntries(orgId, "digest", now),
    ])
    const split = splitWithDailyLimit(nowE, digestE, userId, lim.memberIds, lim.limit, lim.dayOf)
    entries = tab === "now" ? split.now : split.digest
  } else {
    entries = tab === "all" ? await allEntries(orgId, opts.filters ?? {}, now) : await listEntries(orgId, tab, now)
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
    now: now.toISOString(),
  }
}

/**
 * Entries of the three attention lists for the whole org at `now` (rank
 * order, read-time placement, NO daily limit — the caller applies it per
 * recipient). Used by the delivery phase (plan phase 7) to build the
 * digests from exactly what the dashboard shows.
 */
export async function readOrgListEntries(
  orgId: string,
  now: Date = new Date(),
): Promise<{ now: TopicEntry[]; digest: TopicEntry[]; week: TopicEntry[] }> {
  const [nowE, digest, week] = await Promise.all([
    listEntries(orgId, "now", now),
    listEntries(orgId, "digest", now),
    listEntries(orgId, "week", now),
  ])
  return { now: nowE, digest, week }
}

/** Counts per tab (all + «Мои»). «Сейчас» counts open deal cards too; «Все темы» = live topics. */
export async function readTopicCounts(orgId: string, userId: string, now: Date = new Date()): Promise<TopicCounts> {
  const owned = async (list: Exclude<TopicList, "none">) => {
    const rows = await readTopicList(orgId, list, now)
    return rows.map((r) => ({ topicId: r.topicId, ownerUserId: r.ownerUserId, dealId: r.dealId, attention: r.attention }))
  }
  const placer = await loadPlacer(orgId)
  const [lim, nowRaw, digestRaw, weekRows, liveRows, dealCards] = await Promise.all([
    loadLimitContext(orgId, placer),
    owned("now"),
    owned("digest"),
    owned("week"),
    db
      .select({ ownerUserId: topic.ownerUserId, dealId: topic.dealId })
      .from(topic)
      .where(and(eq(topic.organizationId, orgId), inArray(topic.status, LIVE))),
    openDealCards(orgId, now),
  ])
  const dealIds = [...new Set([...nowRaw, ...digestRaw, ...weekRows, ...liveRows].map((r) => r.dealId).filter((x): x is string => !!x))]
  const dealOwner = new Map<string, string>()
  for (let i = 0; i < dealIds.length; i += 500) {
    const rows = await db
      .select({ id: deal.id, userId: deal.userId })
      .from(deal)
      .where(and(eq(deal.organizationId, orgId), inArray(deal.id, dealIds.slice(i, i + 500))))
    for (const r of rows) dealOwner.set(r.id, r.userId)
  }
  const withOwner = (rows: { ownerUserId: string | null; dealId: string | null }[]) =>
    rows.map((r) => ({ ownerUserId: r.ownerUserId, dealOwnerUserId: r.dealId ? (dealOwner.get(r.dealId) ?? null) : null }))
  const routable = (rows: typeof nowRaw): RoutableEntry[] =>
    rows.map((r) => ({
      topicId: r.topicId,
      ownerUserId: r.ownerUserId,
      dealOwnerUserId: r.dealId ? (dealOwner.get(r.dealId) ?? null) : null,
      attention: r.attention,
    }))
  // P6 daily limit as this user sees it (same rule as `readTopicTab`).
  const split = splitWithDailyLimit(routable(nowRaw), routable(digestRaw), userId, lim.memberIds, lim.limit, lim.dayOf)
  const nowRows = split.now
  const digestRows = split.digest
  const owners = await topicOwners(orgId, [...new Set(dealCards.map((c) => c.topicId))])
  const dealCardOwners = dealCards.map((c) => owners.get(c.topicId) ?? { ownerUserId: null, dealOwnerUserId: null })
  const nowCount = countEntries(nowRows, userId)
  const dealCount = countEntries(dealCardOwners, userId)
  return {
    now: { all: nowCount.all + dealCount.all, mine: nowCount.mine + dealCount.mine },
    digest: countEntries(digestRows, userId),
    week: countEntries(withOwner(weekRows), userId),
    all: countEntries(withOwner(liveRows), userId),
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
  const [placer, labels, cardsMap, items, instances, events, dealRow] = await Promise.all([
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
  ])
  const cards = cardsMap.get(topicId) ?? []
  const attention = placer.place(t.attention, now)
  const entry = toEntry(head, attention, cards, labels, now)
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
  }
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
  }
}

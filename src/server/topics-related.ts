import "server-only"

import { and, desc, eq, gt, gte, inArray, isNull, notInArray, or, sql, type SQL } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { card, client, contact, deal, signalCategory, topic } from "@/db/schema"
import { topicCardsVisible } from "@/server/topics/cards/visibility"
import {
  TOPIC_LIVE_STATUSES,
  TOPIC_STATUS_LABELS_RU,
  TOPIC_SUB_STATE_LABELS_RU,
  type TopicStatus,
  type TopicSubState,
} from "@/lib/topics/types"
import { TOPIC_LIST_LABELS_RU, type TopicList } from "@/lib/topics/attention-types"
import { SIGNAL_BAND_LABELS_RU, type SignalBand } from "@/lib/signals/extraction-types"

// «Темы» tab on the company page / drawer, the contact drawer and the deal
// drawer (spec topics/01 §14, plan phase 6 task 3). Org-explicit: the caller
// (route) takes the org id from the session. Users see topics only while the
// org's topics mode is `on` (same rule as engine cards, `topicCardsVisible`).
// Two groups: live topics (open / dormant) first, then topics closed in the
// last RECENT_DAYS days. Merged topics never show (their items live on in
// the target topic).

export const RELATED_TOPICS_RECENT_DAYS = 60
const OPEN_LIMIT = 50
const RECENT_LIMIT = 30

export type RelatedTopicsTarget =
  | { kind: "client"; id: string }
  | { kind: "contact"; id: string }
  | { kind: "deal"; id: string }

export type RelatedTopicRow = {
  id: string
  title: string
  matter: string
  status: string
  statusLabel: string
  subState: string
  subStateLabel: string | null
  list: string
  listLabel: string
  leadCode: string | null
  leadLabel: string | null
  score: number
  band: string
  bandLabel: string
  class: string | null
  lastActivityAt: string
  closedAt: string | null
  clientId: string | null
  clientName: string | null
  contactId: string | null
  contactName: string | null
  dealId: string | null
  dealName: string | null
  /** Headline of the topic's open `topic` card (null = no open card). */
  openCardHeadline: string | null
}

export type RelatedTopicsResult = {
  visible: boolean
  open: RelatedTopicRow[]
  recent: RelatedTopicRow[]
  recentDays: number
}

export type RelatedTopicsOptions = {
  /** Window for closed topics (default 60 days). */
  recentDays?: number
  now?: Date
}

export class RelatedTopicsScopeError extends Error {
  constructor(message = "Not found") {
    super(message)
    this.name = "RelatedTopicsScopeError"
  }
}

const EMPTY = (recentDays: number): RelatedTopicsResult => ({ visible: false, open: [], recent: [], recentDays })

/** Throws RelatedTopicsScopeError when the entity is not in the org. */
async function assertTargetInOrg(orgId: string, target: RelatedTopicsTarget): Promise<void> {
  const table = target.kind === "client" ? client : target.kind === "contact" ? contact : deal
  const rows = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, target.id), eq(table.organizationId, orgId)))
    .limit(1)
  if (rows.length === 0) throw new RelatedTopicsScopeError()
}

function targetFilter(target: RelatedTopicsTarget): SQL {
  if (target.kind === "client") return eq(topic.clientId, target.id)
  if (target.kind === "contact") return eq(topic.contactId, target.id)
  return eq(topic.dealId, target.id)
}

async function loadTopics(
  orgId: string,
  target: RelatedTopicsTarget,
  opts: RelatedTopicsOptions,
): Promise<{ open: RelatedTopicRow[]; recent: RelatedTopicRow[] }> {
  const now = opts.now ?? new Date()
  const recentDays = opts.recentDays ?? RELATED_TOPICS_RECENT_DAYS
  const since = new Date(now.getTime() - recentDays * 24 * 60 * 60 * 1000)
  const live = [...TOPIC_LIVE_STATUSES] as string[]

  const select = {
    t: topic,
    clientName: client.name,
    contactName: contact.name,
    dealName: deal.name,
  }
  const base = () =>
    db
      .select(select)
      .from(topic)
      .leftJoin(client, eq(client.id, topic.clientId))
      .leftJoin(contact, eq(contact.id, topic.contactId))
      .leftJoin(deal, eq(deal.id, topic.dealId))

  const [openRows, recentRows] = await Promise.all([
    base()
      .where(and(eq(topic.organizationId, orgId), targetFilter(target), inArray(topic.status, live)))
      .orderBy(desc(topic.score), desc(topic.lastActivityAt))
      .limit(OPEN_LIMIT),
    base()
      .where(
        and(
          eq(topic.organizationId, orgId),
          targetFilter(target),
          notInArray(topic.status, [...live, "merged"]),
          gte(sql`coalesce(${topic.closedAt}, ${topic.lastActivityAt})`, since),
        ),
      )
      .orderBy(desc(sql`coalesce(${topic.closedAt}, ${topic.lastActivityAt})`))
      .limit(RECENT_LIMIT),
  ])

  const all = [...openRows, ...recentRows]
  const topicIds = all.map((r) => r.t.id)
  const leadCodes = [...new Set(all.map((r) => r.t.leadCode).filter((c): c is string => !!c))]

  const [labels, cards] = await Promise.all([
    leadCodes.length
      ? db
          .select({ code: signalCategory.code, labelRu: signalCategory.labelRu })
          .from(signalCategory)
          .where(inArray(signalCategory.code, leadCodes))
      : Promise.resolve([] as { code: string; labelRu: string }[]),
    topicIds.length
      ? db
          .select({ topicId: card.topicId, message: card.message, updatedAt: card.updatedAt })
          .from(card)
          .where(
            and(
              eq(card.organizationId, orgId),
              inArray(card.topicId, topicIds),
              eq(card.kind, "topic"),
              eq(card.status, "open"),
              or(isNull(card.expiresAt), gt(card.expiresAt, now)),
            ),
          )
          .orderBy(desc(card.updatedAt))
      : Promise.resolve([] as { topicId: string | null; message: unknown; updatedAt: Date }[]),
  ])
  const labelByCode = new Map(labels.map((l) => [l.code, l.labelRu]))
  const headlineByTopic = new Map<string, string>()
  for (const c of cards) {
    if (!c.topicId || headlineByTopic.has(c.topicId)) continue
    // Engine card text lives in `message.topicCard` (TopicCardMeta); the
    // legacy `analysis` text is the fallback (first line = headline).
    const m = c.message as { topicCard?: { headline?: unknown }; analysis?: unknown } | null
    const meta = m?.topicCard?.headline
    const headline =
      typeof meta === "string" && meta.trim()
        ? meta.trim()
        : typeof m?.analysis === "string"
          ? (m.analysis.trim().split("\n")[0] ?? "").trim()
          : ""
    if (headline) headlineByTopic.set(c.topicId, headline)
  }

  const toRow = (r: (typeof all)[number]): RelatedTopicRow => {
    const t = r.t
    const live = (TOPIC_LIVE_STATUSES as readonly string[]).includes(t.status)
    return {
      id: t.id,
      title: t.title,
      matter: t.matter,
      status: t.status,
      statusLabel: TOPIC_STATUS_LABELS_RU[t.status as TopicStatus] ?? t.status,
      subState: t.subState,
      subStateLabel:
        live && t.subState !== "none"
          ? (TOPIC_SUB_STATE_LABELS_RU[t.subState as TopicSubState] ?? t.subState)
          : null,
      list: t.list,
      listLabel: TOPIC_LIST_LABELS_RU[t.list as TopicList] ?? t.list,
      leadCode: t.leadCode,
      leadLabel: t.leadCode ? (labelByCode.get(t.leadCode) ?? null) : null,
      score: t.score,
      band: t.band,
      bandLabel: SIGNAL_BAND_LABELS_RU[t.band as SignalBand] ?? t.band,
      class: t.class,
      lastActivityAt: t.lastActivityAt.toISOString(),
      closedAt: t.closedAt ? t.closedAt.toISOString() : null,
      clientId: t.clientId,
      clientName: r.clientName ?? null,
      contactId: t.contactId,
      contactName: r.contactName ?? null,
      dealId: t.dealId,
      dealName: r.dealName ?? null,
      openCardHeadline: live ? (headlineByTopic.get(t.id) ?? null) : null,
    }
  }

  return { open: openRows.map(toRow), recent: recentRows.map(toRow) }
}

/**
 * Topics of one company / contact / deal for the «Темы» tab. Returns
 * `visible: false` with empty lists when the org's topics mode is not `on`.
 * Throws RelatedTopicsScopeError when the entity is not in the org.
 */
export async function listRelatedTopics(
  orgId: string,
  target: RelatedTopicsTarget,
  opts: RelatedTopicsOptions = {},
): Promise<RelatedTopicsResult> {
  const recentDays = opts.recentDays ?? RELATED_TOPICS_RECENT_DAYS
  if (!(await topicCardsVisible(orgId))) return EMPTY(recentDays)
  await assertTargetInOrg(orgId, target)
  const { open, recent } = await loadTopics(orgId, target, opts)
  return { visible: true, open, recent, recentDays }
}

/** Topics of a company (open first, then closed in the last 60 days). */
export function listTopicsForClient(orgId: string, clientId: string, opts: RelatedTopicsOptions = {}) {
  return listRelatedTopics(orgId, { kind: "client", id: clientId }, opts)
}

/**
 * Topics of a contact — every topic with `topic.contact_id` = the contact,
 * including topics with no company (spec §14).
 */
export function listTopicsForContact(orgId: string, contactId: string, opts: RelatedTopicsOptions = {}) {
  return listRelatedTopics(orgId, { kind: "contact", id: contactId }, opts)
}

/** Topics linked to a deal (`topic.deal_id`). */
export function listTopicsForDeal(orgId: string, dealId: string, opts: RelatedTopicsOptions = {}) {
  return listRelatedTopics(orgId, { kind: "deal", id: dealId }, opts)
}

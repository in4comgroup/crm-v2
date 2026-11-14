import "server-only"

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { client, contact, signalInstance, source, sourceItem, topic, topicEvent, topicItem, user } from "@/db/schema"
import { isTopicStatus, TOPIC_STATUSES, type TopicStatus } from "@/lib/topics/types"
import { getRegistry } from "@/server/signals/registry"
import { envelopeFromItem } from "./signals/item-input"

// Read models of the admin debug block «Темы (отладка)» (plan phase 3 task
// 8): topic list with counts per status, one topic with items, signal
// instances and the event journal, and the topics of one item (for the
// manual «Извлечь сигналы и темы» toast). Org-explicit, `server-only`; the
// route checks the platform-admin session. Dates are ISO strings (JSON).

export type TopicDebugRow = {
  id: string
  title: string
  matter: string
  counterpartyRaw: string
  clientId: string | null
  clientName: string | null
  clientStatus: string | null
  contactId: string | null
  contactName: string | null
  contactStatus: string | null
  family: string | null
  leadCode: string | null
  leadLabelRu: string | null
  class: string | null
  score: number
  band: string
  status: string
  subState: string
  itemCount: number
  firstSeenAt: string
  lastActivityAt: string
  closedAt: string | null
  closedReason: string | null
  mergedIntoTopicId: string | null
  relatedTopicId: string | null
}

export type TopicDebugList = {
  rows: TopicDebugRow[]
  total: number
  byStatus: Partial<Record<TopicStatus, number>>
}

export type TopicDebugItem = {
  sourceItemId: string
  subjectIndex: number
  role: string
  date: string
  provider: string | null
  externalType: string
  subject: string | null
  from: string | null
  threadKey: string | null
  signalScore: number | null
  signalBand: string | null
  topicStatus: string | null
}

export type TopicDebugInstance = {
  id: string
  code: string
  labelRu: string | null
  sourceItemId: string | null
  subjectIndex: number
  confidence: string
  counted: boolean
  notCountedReason: string | null
  scoreContrib: number
  evidence: string
  createdAt: string
}

export type TopicDebugEvent = {
  id: string
  type: string
  actor: string
  userName: string | null
  sourceItemId: string | null
  payload: Record<string, unknown>
  createdAt: string
}

export type TopicDebugDetail = {
  topic: TopicDebugRow & {
    references: { kind: string; value: string; key: string }[]
    products: string[]
    dealId: string | null
    taxonomyVersion: number | null
  }
  items: TopicDebugItem[]
  instances: TopicDebugInstance[]
  events: TopicDebugEvent[]
}

export type ItemTopicLink = { topicId: string; title: string; status: string; role: string; band: string; score: number }

const iso = (d: Date | null) => (d ? d.toISOString() : null)

async function codeLabels(): Promise<Map<string, string>> {
  const registry = await getRegistry()
  return new Map(registry.categories.map((c) => [c.code, c.labelRu]))
}

const rowSelect = {
  t: topic,
  clientName: client.name,
  clientStatus: client.status,
  contactName: contact.name,
  contactStatus: contact.status,
  itemCount: sql<number>`(select count(*)::int from topic_item ti where ti.topic_id = "topic"."id")`,
}

type RowResult = {
  t: typeof topic.$inferSelect
  clientName: string | null
  clientStatus: string | null
  contactName: string | null
  contactStatus: string | null
  itemCount: number
}

function toRow(r: RowResult, labels: Map<string, string>): TopicDebugRow {
  const t = r.t
  return {
    id: t.id,
    title: t.title,
    matter: t.matter,
    counterpartyRaw: t.counterpartyRaw,
    clientId: t.clientId,
    clientName: r.clientName,
    clientStatus: r.clientStatus,
    contactId: t.contactId,
    contactName: r.contactName,
    contactStatus: r.contactStatus,
    family: t.family,
    leadCode: t.leadCode,
    leadLabelRu: t.leadCode ? (labels.get(t.leadCode) ?? null) : null,
    class: t.class,
    score: t.score,
    band: t.band,
    status: t.status,
    subState: t.subState,
    itemCount: r.itemCount,
    firstSeenAt: t.firstSeenAt.toISOString(),
    lastActivityAt: t.lastActivityAt.toISOString(),
    closedAt: iso(t.closedAt),
    closedReason: t.closedReason,
    mergedIntoTopicId: t.mergedIntoTopicId,
    relatedTopicId: t.relatedTopicId,
  }
}

/** Topics of the org, newest activity first, + total and counts per status. */
export async function listTopicsForDebug(
  orgId: string,
  opts: { status?: string | null; limit?: number; offset?: number } = {},
): Promise<TopicDebugList> {
  const statuses = (opts.status ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(isTopicStatus)
  const where = and(eq(topic.organizationId, orgId), ...(statuses.length ? [inArray(topic.status, statuses)] : []))
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500)
  const [rows, counts, labels] = await Promise.all([
    db
      .select(rowSelect)
      .from(topic)
      .leftJoin(client, eq(client.id, topic.clientId))
      .leftJoin(contact, eq(contact.id, topic.contactId))
      .where(where)
      .orderBy(desc(topic.lastActivityAt), asc(topic.id))
      .limit(limit)
      .offset(Math.max(opts.offset ?? 0, 0)),
    db
      .select({ status: topic.status, n: sql<number>`count(*)::int` })
      .from(topic)
      .where(eq(topic.organizationId, orgId))
      .groupBy(topic.status),
    codeLabels(),
  ])
  const byStatus: Partial<Record<TopicStatus, number>> = {}
  for (const c of counts) if (isTopicStatus(c.status)) byStatus[c.status] = c.n
  const total = statuses.length
    ? statuses.reduce((sum, s) => sum + (byStatus[s] ?? 0), 0)
    : TOPIC_STATUSES.reduce((sum, s) => sum + (byStatus[s] ?? 0), 0)
  return { rows: rows.map((r) => toRow(r, labels)), total, byStatus }
}

/** One topic with items, signal instances and the event journal (null = not in the org). */
export async function getTopicDebugDetail(orgId: string, topicId: string): Promise<TopicDebugDetail | null> {
  const [head] = await db
    .select(rowSelect)
    .from(topic)
    .leftJoin(client, eq(client.id, topic.clientId))
    .leftJoin(contact, eq(contact.id, topic.contactId))
    .where(and(eq(topic.organizationId, orgId), eq(topic.id, topicId)))
  if (!head) return null
  const [items, instances, events, labels] = await Promise.all([
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
        threadKey: sourceItem.threadKey,
        signalScore: sourceItem.signalScore,
        signalBand: sourceItem.signalBand,
        topicStatus: sourceItem.topicStatus,
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
      .orderBy(asc(topicEvent.createdAt)),
    codeLabels(),
  ])
  const t = head.t
  return {
    topic: {
      ...toRow(head, labels),
      references: t.references,
      products: t.products,
      dealId: t.dealId,
      taxonomyVersion: t.taxonomyVersion,
    },
    items: items
      .map((i) => {
        const env = envelopeFromItem(i)
        return {
          sourceItemId: i.sourceItemId,
          subjectIndex: i.subjectIndex,
          role: i.role,
          date: (i.sourceCreatedAt ?? i.createdAt).toISOString(),
          provider: i.provider,
          externalType: i.externalType,
          subject: env.subject ?? null,
          from: env.from ?? null,
          threadKey: i.threadKey,
          signalScore: i.signalScore,
          signalBand: i.signalBand,
          topicStatus: i.topicStatus,
        }
      })
      .sort((a, b) => a.date.localeCompare(b.date)),
    instances: instances.map((i) => ({
      id: i.id,
      code: i.code,
      labelRu: labels.get(i.code) ?? null,
      sourceItemId: i.sourceItemId,
      subjectIndex: i.subjectIndex,
      confidence: i.confidence,
      counted: i.counted,
      notCountedReason: i.notCountedReason,
      scoreContrib: i.scoreContrib,
      evidence: i.evidence,
      createdAt: i.createdAt.toISOString(),
    })),
    events: events.map(({ e, userName }) => ({
      id: e.id,
      type: e.type,
      actor: e.actor,
      userName,
      sourceItemId: e.sourceItemId,
      payload: e.payload,
      createdAt: e.createdAt.toISOString(),
    })),
  }
}

/** Topics the item is on (for the manual action's result). */
export async function listItemTopics(orgId: string, sourceItemId: string): Promise<ItemTopicLink[]> {
  return db
    .select({
      topicId: topic.id,
      title: topic.title,
      status: topic.status,
      role: topicItem.role,
      band: topic.band,
      score: topic.score,
    })
    .from(topicItem)
    .innerJoin(topic, eq(topic.id, topicItem.topicId))
    .where(and(eq(topicItem.organizationId, orgId), eq(topicItem.sourceItemId, sourceItemId)))
}

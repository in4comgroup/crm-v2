import "server-only"

import { randomUUID } from "node:crypto"
import { and, desc, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { card, cardClient, cardContact, client, contact, sourceItem, task, topic } from "@/db/schema"
import type { TopicAttention } from "@/lib/topics/attention-types"
import {
  CARD_DECIDED_STATUSES,
  type CardStatus,
  type TopicCardEvent,
  type TopicCardMeta,
  type TopicCardText,
} from "@/lib/topics/cards"
import { loadCustomValuesText } from "@/server/custom-fields"
import { loadClientProfileTexts } from "@/server/identity/client-profile-context"
import { getTopicsOrgPrompt } from "@/server/identity/prompt-context"
import { getRegistry } from "@/server/signals/registry"
import { messageContent } from "@/server/topics/signals/evidence"
import { itemMarkdown } from "@/server/topics/signals/item-input"
import { isClosingCode, type CodeBook, type TopicSnapshot } from "@/server/topics/model"
import { loadCodeBook, loadTopicSnapshot } from "@/server/topics/topic-store"
import {
  cardCategoryFor,
  cardPriorityFor,
  compactEvents,
  legacyMessageText,
  ORDER_REQUESTED_CODE,
  type EventCandidate,
} from "./logic"
import type { CardWriterInput } from "./writer"

// DB side of the card engine (spec topics/01 §9.1). Org-explicit,
// session-free, `server-only`: the caller (phase, admin route, deal-state
// hook) checks access. Writes are one `db.batch` per card change.

type BatchOps = Parameters<typeof db.batch>[0]
const asBatch = (ops: unknown[]) => ops as unknown as BatchOps

export type CardTopicRow = typeof topic.$inferSelect & {
  clientName: string | null
  contactName: string | null
}

export type TopicCardRow = typeof card.$inferSelect

/** `topic.attention` as the contract type (null when absent / unknown shape). */
export function attentionOf(raw: unknown): TopicAttention | null {
  if (!raw || typeof raw !== "object") return null
  const a = raw as Partial<TopicAttention>
  return a.v === 1 && typeof a.band === "string" ? (a as TopicAttention) : null
}

/** Engine metadata stored in `card.message.topicCard` (null on other cards). */
export function metaOf(c: Pick<TopicCardRow, "message"> | null | undefined): TopicCardMeta | null {
  const m = c?.message as { topicCard?: TopicCardMeta } | null | undefined
  return m?.topicCard && typeof m.topicCard === "object" ? m.topicCard : null
}

const topicSelect = { t: topic, clientName: client.name, contactName: contact.name }

function toRow(r: { t: typeof topic.$inferSelect; clientName: string | null; contactName: string | null }): CardTopicRow {
  return { ...r.t, clientName: r.clientName, contactName: r.contactName }
}

/**
 * Topics the phase looks at: open topics with an attention result, plus every
 * topic that still has an open `topic` card (to close it).
 */
export async function loadCardCandidates(orgId: string): Promise<CardTopicRow[]> {
  const withOpenCard = db
    .select({ id: card.topicId })
    .from(card)
    .where(and(eq(card.organizationId, orgId), eq(card.kind, "topic"), eq(card.status, "open"), isNotNull(card.topicId)))
  const rows = await db
    .select(topicSelect)
    .from(topic)
    .leftJoin(client, eq(client.id, topic.clientId))
    .leftJoin(contact, eq(contact.id, topic.contactId))
    .where(
      and(
        eq(topic.organizationId, orgId),
        or(and(eq(topic.status, "open"), isNotNull(topic.attention)), inArray(topic.id, withOpenCard)),
      ),
    )
  return rows.map(toRow)
}

export async function loadCardTopic(orgId: string, topicId: string): Promise<CardTopicRow | null> {
  const [r] = await db
    .select(topicSelect)
    .from(topic)
    .leftJoin(client, eq(client.id, topic.clientId))
    .leftJoin(contact, eq(contact.id, topic.contactId))
    .where(and(eq(topic.organizationId, orgId), eq(topic.id, topicId)))
  return r ? toRow(r) : null
}

/** `topic` cards of the topics, newest first, grouped by topic. */
export async function loadTopicCards(orgId: string, topicIds: readonly string[]): Promise<Map<string, TopicCardRow[]>> {
  const out = new Map<string, TopicCardRow[]>()
  if (topicIds.length === 0) return out
  const rows = await db
    .select()
    .from(card)
    .where(and(eq(card.organizationId, orgId), eq(card.kind, "topic"), inArray(card.topicId, [...topicIds])))
    .orderBy(desc(card.createdAt))
  for (const r of rows) {
    if (!r.topicId) continue
    const list = out.get(r.topicId) ?? []
    list.push(r)
    out.set(r.topicId, list)
  }
  return out
}

// ── Lifecycle sweeps ──────────────────────────────────────────────────────

/** Open topic cards past `expires_at` → `expired`. Returns the count. */
export async function expireTopicCards(orgId: string, now: Date): Promise<number> {
  const rows = await db
    .update(card)
    .set({ status: "expired" })
    .where(
      and(
        eq(card.organizationId, orgId),
        isNotNull(card.kind),
        eq(card.status, "open"),
        isNotNull(card.expiresAt),
        lte(card.expiresAt, now),
      ),
    )
    .returning({ id: card.id })
  return rows.length
}

/** Open engine cards whose topic was deleted (topic_id set null) → `closed`. */
export async function closeOrphanTopicCards(orgId: string): Promise<number> {
  const rows = await db
    .update(card)
    .set({ status: "closed" })
    .where(and(eq(card.organizationId, orgId), eq(card.kind, "topic"), eq(card.status, "open"), isNull(card.topicId)))
    .returning({ id: card.id })
  return rows.length
}

export async function closeTopicCard(orgId: string, cardId: string): Promise<void> {
  await db
    .update(card)
    .set({ status: "closed" })
    .where(and(eq(card.organizationId, orgId), eq(card.id, cardId), eq(card.status, "open")))
}

export function isDecided(status: string | null): boolean {
  return (CARD_DECIDED_STATUSES as readonly string[]).includes(status ?? "")
}

// ── Writer input ──────────────────────────────────────────────────────────

const MAX_ITEMS = 5
const MAX_SIGNALS = 8

export type CardBuild = {
  input: CardWriterInput
  snapshot: TopicSnapshot
  book: CodeBook
  events: TopicCardEvent[]
  orderRequest: string | null
  lastItemId: string | null
}

function itemText(meta: unknown, markdown: string | null): string {
  const m = (meta ?? {}) as Record<string, unknown>
  for (const k of ["rawText", "text"]) {
    const v = m[k]
    if (typeof v === "string" && v.trim()) return v.trim()
  }
  return markdown ? messageContent(markdown) : ""
}

function fromOf(meta: unknown): string | null {
  const m = (meta ?? {}) as Record<string, unknown>
  const f = Array.isArray(m.from) ? (m.from[0] as { name?: string; email?: string } | undefined) : undefined
  if (f) return f.name || f.email || null
  const tg = (m.telegram as { from?: { firstName?: string; lastName?: string } } | undefined)?.from
  if (tg) return [tg.firstName, tg.lastName].filter(Boolean).join(" ") || null
  return null
}

/** Everything the writer and the card row need for one topic. */
export async function buildCardInput(args: {
  orgId: string
  row: CardTopicRow
  attention: TopicAttention
  current: TopicCardRow | null
  force: string | null
  now: Date
  book?: CodeBook
}): Promise<CardBuild | null> {
  const { orgId, row, attention, current, now } = args
  const [snapshot, book, registry, orgPrompt] = await Promise.all([
    loadTopicSnapshot(orgId, row.id),
    args.book ? Promise.resolve(args.book) : loadCodeBook(orgId),
    getRegistry(),
    // Identity I4: null unless `identity.promptContext` is on for the org.
    getTopicsOrgPrompt(orgId),
  ])
  if (!snapshot) return null
  const clientProfile =
    orgPrompt && row.clientId
      ? ((await loadClientProfileTexts(orgId, [row.clientId], { withSegment: true })).get(row.clientId)?.summary ?? "")
      : ""
  // Custom fields (spec clients-contacts Q11): same gate as the profile.
  const clientFields =
    orgPrompt && row.clientId
      ? ((await loadCustomValuesText(orgId, "client", [row.clientId])).get(row.clientId) ?? "")
      : ""
  const notes = new Map(registry.categories.map((c) => [c.code, c.cardNoteRu]))
  const meta = metaOf(current)
  const since = meta?.writtenAt ? new Date(meta.writtenAt) : null
  const isNew = (d: Date) => !!since && d.getTime() > since.getTime()

  // Items: newest MAX_ITEMS (context items too — they tell the story).
  const links = [...snapshot.items].sort((a, b) => b.date.getTime() - a.date.getTime())
  const recentIds = [...new Set(links.map((l) => l.itemId))].slice(0, MAX_ITEMS)
  const itemRows = recentIds.length
    ? await db
        .select({
          id: sourceItem.id,
          metadataJson: sourceItem.metadataJson,
          parsedMarkdown: sourceItem.parsedMarkdown,
          markdownR2Key: sourceItem.markdownR2Key,
        })
        .from(sourceItem)
        .where(and(eq(sourceItem.organizationId, orgId), inArray(sourceItem.id, recentIds)))
    : []
  const byId = new Map(itemRows.map((r) => [r.id, r]))
  const texts = new Map<string, { text: string; from: string | null; subject: string | null }>()
  await Promise.all(
    recentIds.map(async (id) => {
      const r = byId.get(id)
      if (!r) return
      const md = await itemMarkdown(r)
      const m = (r.metadataJson ?? {}) as Record<string, unknown>
      texts.set(id, {
        text: itemText(r.metadataJson, md),
        from: fromOf(r.metadataJson),
        subject: typeof m.subject === "string" ? m.subject : null,
      })
    }),
  )
  const items = recentIds
    .map((id) => {
      const l = links.find((x) => x.itemId === id)!
      const t = texts.get(id)
      return {
        date: l.date.toISOString().slice(0, 10),
        direction: l.direction,
        from: t?.from ?? null,
        subject: t?.subject ?? null,
        text: t?.text ?? "",
        isNew: isNew(l.date),
        at: l.date,
      }
    })
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map((i) => ({ date: i.date, direction: i.direction, from: i.from, subject: i.subject, text: i.text, isNew: i.isNew }))

  const instances = [...snapshot.instances]
    .filter((i) => i.confidence !== "low")
    .sort((a, b) => a.itemDate.getTime() - b.itemDate.getTime())
  const signals = instances.slice(-MAX_SIGNALS).map((i) => ({
    code: i.code,
    labelRu: book.get(i.code)?.labelRu ?? i.code,
    date: i.itemDate.toISOString().slice(0, 10),
    evidence: i.evidence ?? "",
    isNew: isNew(i.itemDate),
  }))

  const deadlines = [
    ...new Set([...(attention.deadline ? [attention.deadline.slice(0, 10)] : []), ...instances.flatMap((i) => i.deadlines)]),
  ]
    .sort()
    .slice(0, 5)

  const candidates: EventCandidate[] = snapshot.instances
    .filter((i) => i.counted || isClosingCode(book.get(i.code)))
    .map((i) => {
      const info = book.get(i.code)
      return {
        code: i.code,
        labelRu: info?.labelRu ?? i.code,
        class: info?.class ?? null,
        family: info?.family ?? null,
        kind: info?.kind ?? "event",
        weight: info?.weight ?? 0,
        asksUs: info?.asksUs ?? false,
        closing: isClosingCode(info),
        hasDeadline: i.deadlines.length > 0,
        at: i.itemDate,
        sourceItemId: i.itemId,
        evidence: i.evidence ?? "",
      }
    })

  const leadCode = attention.leadCode ?? row.leadCode
  const leadInfo = leadCode ? book.get(leadCode) : undefined

  // «Создать заказ» handoff: the verbatim text of the newest order request.
  let orderRequest: string | null = null
  if (leadCode === ORDER_REQUESTED_CODE) {
    const inst = [...snapshot.instances]
      .filter((i) => i.code === ORDER_REQUESTED_CODE && i.itemId)
      .sort((a, b) => b.itemDate.getTime() - a.itemDate.getTime())[0]
    if (inst?.itemId) {
      const t = texts.get(inst.itemId)
      if (t?.text) orderRequest = t.text
      else {
        const [r] = await db
          .select({ metadataJson: sourceItem.metadataJson, parsedMarkdown: sourceItem.parsedMarkdown, markdownR2Key: sourceItem.markdownR2Key })
          .from(sourceItem)
          .where(and(eq(sourceItem.organizationId, orgId), eq(sourceItem.id, inst.itemId)))
        orderRequest = r ? itemText(r.metadataJson, await itemMarkdown(r)) || null : null
      }
      orderRequest ??= inst.evidence || null
    }
  }

  const ct = current
    ? (() => {
        const m = metaOf(current)
        return {
          id: current.id,
          status: current.status ?? "open",
          headline: m?.headline ?? "",
          whyNow: m?.whyNow ?? "",
          whatChanged: m?.whatChanged ?? "",
          steps: m?.steps ?? [],
        }
      })()
    : null

  // ai-chat-tools Q18: tasks the user already made from the AI chat for this company / contact.
  const existingTasks = await chatCreatedOpenTasks(orgId, row.clientId, row.contactId)

  const input: CardWriterInput = {
    topicId: row.id,
    sourceItemId: links[0]?.itemId ?? null,
    today: now.toISOString().slice(0, 10),
    topic: {
      title: row.title,
      matter: row.matter,
      counterparty: row.clientName ?? row.contactName ?? row.counterpartyRaw ?? "",
      contact: row.clientName && row.contactName ? row.contactName : null,
      status: row.status,
      waiting: (row.subState as CardWriterInput["topic"]["waiting"]) ?? "none",
      family: row.family,
      leadCode,
      leadLabelRu: leadInfo?.labelRu ?? null,
      leadNoteRu: (leadCode && notes.get(leadCode)) || null,
      class: attention.class ?? (row.class as CardWriterInput["topic"]["class"]),
      references: snapshot.references.map((r) => `${r.kind} ${r.value}`),
      products: snapshot.products,
    },
    signals,
    items,
    deadlines,
    overdue: attention.overdue,
    current: ct,
    force: args.force,
    ...(existingTasks.length ? { existingTasks } : {}),
    ...(orgPrompt
      ? {
          org: { roleLine: orgPrompt.roleLine, productsLine: orgPrompt.productsLine },
          clientProfile: clientProfile || null,
          clientFields: clientFields || null,
        }
      : {}),
  }
  return {
    input,
    snapshot,
    book,
    events: compactEvents(candidates),
    orderRequest,
    lastItemId: links[0]?.itemId ?? null,
  }
}

/**
 * Open tasks (≤ 30 days old) of the company / contact that a confirmed AI-chat
 * card created — «Отправить КП (до 20.11.2026)». The card writer must not
 * suggest them again (ai-chat-tools Q18).
 */
export async function chatCreatedOpenTasks(orgId: string, clientId: string | null, contactId: string | null): Promise<string[]> {
  if (!clientId && !contactId) return []
  const who = [clientId ? eq(task.clientId, clientId) : undefined, contactId ? eq(task.contactId, contactId) : undefined].filter(
    (x): x is NonNullable<typeof x> => !!x,
  )
  const rows = await db
    .select({ name: task.name, dueDate: task.dueDate })
    .from(task)
    .where(
      and(
        eq(task.organizationId, orgId),
        or(...who),
        inArray(task.status, ["todo", "in_progress"]),
        sql`${task.createdAt} > now() - interval '30 days'`,
        sql`exists (select 1 from ai_chat_action a where a.organization_id = ${orgId}
          and a.results @> jsonb_build_array(jsonb_build_object('type', 'task', 'id', "task"."id")))`,
      ),
    )
    .orderBy(task.dueDate)
    .limit(8)
  return rows.map((r) => `${r.name} (до ${r.dueDate.toISOString().slice(0, 10).split("-").reverse().join(".")})`)
}

// ── Card writes ───────────────────────────────────────────────────────────

export type CardWrite = {
  orgId: string
  row: CardTopicRow
  attention: TopicAttention
  build: CardBuild
  text: TopicCardText
  sinceLast: string | null
  meta: TopicCardMeta
}

/** Engine + legacy columns of a topic card (code-written; never the LLM's). */
function cardValues(w: CardWrite) {
  const a = w.attention
  const leadCode = a.leadCode ?? w.row.leadCode
  return {
    priority: cardPriorityFor(a.band),
    category: cardCategoryFor({ leadCode, class: a.class ?? (w.row.class as "risk" | "chance" | "fyi" | null), family: w.row.family }),
    message: {
      ...legacyMessageText(w.text, w.sinceLast),
      ...(w.text.taskTitle ? { taskTitle: w.text.taskTitle } : {}),
      ...(w.build.orderRequest ? { orderRequest: w.build.orderRequest } : {}),
      topicCard: w.meta,
    },
    sourceItemId: w.build.lastItemId,
    score: a.score,
    band: a.band,
    displayProfile: a.profile,
    signalClass: a.class,
    leadCode,
    sinceLast: w.sinceLast,
    taxonomyVersion: w.row.taxonomyVersion,
    expiresAt: a.cardExpiresAt ? new Date(a.cardExpiresAt) : null,
    events: w.build.events,
  }
}

function linkOps(cardId: string, row: CardTopicRow, replace: boolean): unknown[] {
  const ops: unknown[] = []
  if (replace) {
    ops.push(db.delete(cardClient).where(eq(cardClient.cardId, cardId)))
    ops.push(db.delete(cardContact).where(eq(cardContact.cardId, cardId)))
  }
  if (row.clientId) ops.push(db.insert(cardClient).values({ cardId, clientId: row.clientId }).onConflictDoNothing())
  if (row.contactId) ops.push(db.insert(cardContact).values({ cardId, contactId: row.contactId }).onConflictDoNothing())
  return ops
}

/** New open card; `supersedeId` (the old open card) becomes `superseded` first. */
export async function insertTopicCard(w: CardWrite, supersedeId: string | null): Promise<string> {
  const id = randomUUID()
  const ops: unknown[] = []
  if (supersedeId) {
    ops.push(
      db
        .update(card)
        .set({ status: "superseded" })
        .where(and(eq(card.organizationId, w.orgId), eq(card.id, supersedeId), eq(card.status, "open"))),
    )
  }
  ops.push(
    db.insert(card).values({
      id,
      organizationId: w.orgId,
      topicId: w.row.id,
      kind: "topic",
      status: "open",
      accepted: false,
      ...cardValues(w),
    }),
  )
  ops.push(...linkOps(id, w.row, false))
  await db.batch(asBatch(ops))
  return id
}

/** Replace the text + engine snapshot of the OPEN card (UPDATE). */
export async function updateTopicCard(w: CardWrite, cardId: string): Promise<void> {
  await db.batch(
    asBatch([
      db
        .update(card)
        .set(cardValues(w))
        .where(and(eq(card.organizationId, w.orgId), eq(card.id, cardId), eq(card.status, "open"))),
      ...linkOps(cardId, w.row, true),
    ]),
  )
}

/**
 * NOOP: keep the text, stamp the cycle (and clear a force). An open card
 * also takes the new cycle's expiry (06 §7.3); the score snapshot stays (A8).
 */
export async function stampTopicCard(
  orgId: string,
  current: TopicCardRow,
  patch: Partial<TopicCardMeta>,
  expiresAt?: string | null,
): Promise<void> {
  const msg = (current.message ?? {}) as Record<string, unknown>
  const meta = metaOf(current)
  const nextMeta = { ...(meta ?? {}), ...patch }
  await db
    .update(card)
    .set({
      message: { ...msg, topicCard: nextMeta },
      ...(current.status === "open" && expiresAt !== undefined ? { expiresAt: expiresAt ? new Date(expiresAt) : null } : {}),
    })
    .where(and(eq(card.organizationId, orgId), eq(card.id, current.id)))
}

export type CardStatusCount = Partial<Record<CardStatus, number>>

/** Count of `topic` cards per status (debug header). */
export async function countTopicCards(orgId: string): Promise<CardStatusCount> {
  const rows = await db
    .select({ status: card.status, n: sql<number>`count(*)::int` })
    .from(card)
    .where(and(eq(card.organizationId, orgId), eq(card.kind, "topic")))
    .groupBy(card.status)
  const out: CardStatusCount = {}
  for (const r of rows) if (r.status) out[r.status as CardStatus] = r.n
  return out
}

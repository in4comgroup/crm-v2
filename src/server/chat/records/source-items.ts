import "server-only"

import { and, asc, desc, eq, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db/drizzle"
import {
  client,
  contact,
  deal,
  documentLink,
  order,
  source,
  sourceItem,
  sourceItemSubject,
  task,
  topic,
  topicItem,
} from "@/db/schema"
import { recordHref, type RecordDetail, type RecordDetailSection, type RecordHit } from "@/lib/chat/records"
import {
  DOCUMENT_PROVIDER_LABELS_RU,
  DOCUMENT_TYPE_LABELS_RU,
  documentTypeBucket,
  formatFileSize,
} from "@/lib/documents"
import { listClientContent, listContactContent } from "@/server/client-content"
import {
  containsQuery,
  matchesQuery,
  norm,
  normJsonText,
  relevanceOf,
  type TextQuery,
} from "@/server/search/normalise"
import { getSourceItemMarkdown } from "@/server/source-items"
import { messageContent } from "@/server/topics/signals/evidence"
import { allFacts, facts, formatDate, formatDateTime, isoOrNull, nameList, shortText } from "./format"
import { basicHit, capTotal, parseDay, totalOver } from "./shared"
import { resolveCompanyFilter, resolveContactFilter } from "./resolve"
import { keepOwnOrg, type RecordModule, type RecordsContext, type SearchOptions } from "./types"

// «Источник» (source item) of the records engine (spec §6.1 / §7.2): mail,
// chat messages, files and their attachments of the org's sources. Roots and
// attachment children are both records (a child = a document).
// Search reads DB columns only (subject / title / filename, parser summary,
// snippet, sender / recipients); the full body lives in object storage and is
// NOT searched (spec §6.2) — the detail reads it via getSourceItemMarkdown.
// Visible: the org's items except `skipped` (exclusions, decorative images,
// unsupported files) and rows with nothing to show.

// ── Value lists ───────────────────────────────────────────────────────────

const PROVIDER_GROUPS = {
  mail: ["nylas", "imap"],
  telegram: ["telegram"],
  whatsapp: ["whatsapp"],
  gchat: ["gchat"],
  drive: ["gdrive"],
  files: ["dropoff"],
  aichat: ["aichat"],
} as const
type ProviderGroup = keyof typeof PROVIDER_GROUPS
const PROVIDER_GROUP_KEYS = Object.keys(PROVIDER_GROUPS) as [ProviderGroup, ...ProviderGroup[]]
const PROVIDER_GROUP_LABELS: Record<ProviderGroup, string> = {
  mail: "Почта",
  telegram: DOCUMENT_PROVIDER_LABELS_RU.telegram,
  whatsapp: DOCUMENT_PROVIDER_LABELS_RU.whatsapp,
  gchat: DOCUMENT_PROVIDER_LABELS_RU.gchat,
  drive: DOCUMENT_PROVIDER_LABELS_RU.gdrive,
  files: DOCUMENT_PROVIDER_LABELS_RU.dropoff,
  aichat: DOCUMENT_PROVIDER_LABELS_RU.aichat,
}

const KIND_LABELS: Record<string, string> = {
  email: "Письмо",
  chat_message: "Сообщение",
  drive_file: "Файл",
  dropoff_file: "Файл",
  attachment: "Вложение",
  inline_image: "Изображение",
  derived_audio: "Аудио",
  aichat_session: "Сессия ИИ чата",
}

const DIRECTION_LABELS = { in: "Входящие", out: "Исходящие", internal: "Внутренние" } as const
const ATTRIBUTION_LABELS = { own_org: "Наша организация", external: "Внешние", unknown: "Не определено" } as const
/** Detail fact «Направление» from the item's own attribution. */
const DIRECTION_OF_ITEM: Record<string, string> = { own_org: "Исходящее", external: "Входящее" }

const PARSE_BADGES: Record<string, { label: string; tone: "neutral" | "warn" }> = {
  pending: { label: "Ожидает разбора", tone: "neutral" },
  processing: { label: "Разбирается", tone: "neutral" },
  failed: { label: "Ошибка разбора", tone: "warn" },
}

const CONTENT_MAX_CHARS = 20_000
/** Item ids per company / contact taken from the app's content matcher. */
const CONTENT_MATCH_LIMIT = 100

export const sourceItemFilterSchema = z
  .object({
    provider: z
      .enum(PROVIDER_GROUP_KEYS)
      .optional()
      .describe("Channel: mail, telegram, whatsapp, gchat (Google Chat), drive (Google Drive), files (uploaded files), aichat (saved AI chats)"),
    dateFrom: z.string().optional().describe("Message / file date on or after this day, YYYY-MM-DD"),
    dateTo: z.string().optional().describe("Message / file date on or before this day, YYYY-MM-DD"),
    company: z
      .string()
      .min(1)
      .optional()
      .describe("Company: its id or (part of) its name; items the app links to that company (its content, documents, topics subjects)"),
    contact: z
      .string()
      .min(1)
      .optional()
      .describe("Contact person: id or (part of) the name; items the app links to that contact"),
    direction: z
      .enum(["in", "out", "internal"])
      .optional()
      .describe("in = written by an outside party, out = written by our organization, internal = only our own people take part"),
    attribution: z
      .enum(["own_org", "external", "unknown"])
      .optional()
      .describe("Author: own_org = our organization, external = outside party, unknown = not determined"),
    kind: z
      .enum(["message", "document"])
      .optional()
      .describe("message = a mail / chat message itself, document = a file or an attachment"),
    hasAttachment: z.boolean().optional().describe("true = only messages with attachments, false = only without"),
  })
  .strict()
export type SourceItemFilters = z.infer<typeof sourceItemFilterSchema>

const SORT_KEYS = ["date", "oldest"] as const

// ── Columns ───────────────────────────────────────────────────────────────

const m = sourceItem.metadataJson
const itemDate = sql<Date>`coalesce(${sourceItem.sourceCreatedAt}, ${sourceItem.createdAt})`

/** The small part of `metadata_json` a hit needs (never the stored transcript / mentions). */
const metaLite = sql<MetaLite>`jsonb_build_object(
  'subject', ${m}->'subject', 'title', ${m}->'title', 'summary', ${m}->'summary', 'snippet', ${m}->'snippet',
  'text', left(coalesce(${m}->>'text', ${m}->>'rawText'), 400),
  'from', ${m}->'from', 'to', ${m}->'to', 'cc', ${m}->'cc', 'participants', ${m}->'participants',
  'senders', ${m}->'senders', 'author', ${m}->'author', 'authors', ${m}->'authors', 'owners', ${m}->'owners',
  'userName', ${m}->'userName', 'tgFrom', ${m}->'telegram'->'from',
  'attachmentCount', ${m}->'attachmentCount', 'allInternal', ${m}->'orgAttribution'->'allInternal'
)`

type Addr = { name?: string | null; email?: string | null } | string
type MetaLite = {
  subject?: unknown
  title?: unknown
  summary?: unknown
  snippet?: unknown
  text?: unknown
  from?: unknown
  to?: unknown
  cc?: unknown
  participants?: unknown
  senders?: unknown
  author?: unknown
  authors?: unknown
  owners?: unknown
  userName?: unknown
  tgFrom?: { firstName?: string | null; lastName?: string | null; username?: string | null } | null
  attachmentCount?: unknown
  allInternal?: unknown
}

const cols = {
  id: sourceItem.id,
  organizationId: sourceItem.organizationId,
  provider: source.provider,
  sourceName: source.name,
  externalType: sourceItem.externalType,
  parentSourceItemId: sourceItem.parentSourceItemId,
  filename: sourceItem.filename,
  mimeType: sourceItem.mimeType,
  fileMime: sourceItem.fileMime,
  sizeBytes: sourceItem.sizeBytes,
  fileSizeBytes: sourceItem.fileSizeBytes,
  parseStatus: sourceItem.parseStatus,
  orgAttribution: sourceItem.orgAttribution,
  date: itemDate,
  meta: metaLite,
}
type ItemRow = {
  id: string
  organizationId: string | null
  provider: string
  sourceName: string
  externalType: string
  parentSourceItemId: string | null
  filename: string | null
  mimeType: string | null
  fileMime: string | null
  sizeBytes: number | null
  fileSizeBytes: number | null
  parseStatus: string
  orgAttribution: string
  date: Date | string
  meta: MetaLite | null
}

// ── Pure view helpers ─────────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : ""
}

function addrName(a: Addr | null | undefined): string {
  if (!a) return ""
  if (typeof a === "string") return a.trim()
  return str(a.name) || str(a.email)
}

function addrList(v: unknown): string[] {
  return Array.isArray(v) ? (v as Addr[]).map(addrName).filter(Boolean) : []
}

/** Russian label of a provider («Почта», «Telegram», …). */
export function providerLabel(provider: string | null | undefined): string {
  return (provider && DOCUMENT_PROVIDER_LABELS_RU[provider]) || "Источник"
}

/** Short author: the sender's name (else address) of any provider's metadata. */
export function senderOf(meta: MetaLite | null | undefined): string {
  if (!meta) return ""
  const from = addrList(meta.from)
  if (from.length) return from[0]
  const tg = meta.tgFrom
  if (tg) {
    const name = [str(tg.firstName), str(tg.lastName)].filter(Boolean).join(" ")
    if (name) return name
    if (str(tg.username)) return `@${str(tg.username)}`
  }
  for (const v of [meta.senders, meta.authors, meta.owners]) {
    const list = addrList(v)
    if (list.length) return list[0]
  }
  if (str(meta.author)) return str(meta.author)
  const participants = addrList(meta.participants)
  if (participants.length) return participants[0]
  return str(meta.userName)
}

/** Recipients (to + cc), names first; empty for providers without recipients. */
export function recipientsOf(meta: MetaLite | null | undefined): string[] {
  if (!meta) return []
  return [...addrList(meta.to), ...addrList(meta.cc)]
}

/** Hit / detail title: subject, title or file name, else the start of the message text. */
export function itemTitle(r: Pick<ItemRow, "externalType" | "filename" | "meta">): string {
  const meta = r.meta ?? {}
  const direct = str(meta.subject) || str(meta.title) || str(r.filename)
  if (direct) return shortText(direct, 140)
  const text = str(meta.text) || str(meta.snippet)
  if (text) return shortText(text, 80)
  return KIND_LABELS[r.externalType] ?? "Сообщение"
}

function fileSize(r: Pick<ItemRow, "fileSizeBytes" | "sizeBytes">): string {
  const n = r.fileSizeBytes ?? r.sizeBytes
  return n && n > 0 ? formatFileSize(n) : ""
}

function isDocument(r: Pick<ItemRow, "externalType" | "parentSourceItemId">): boolean {
  return !!r.parentSourceItemId || r.externalType === "drive_file" || r.externalType === "dropoff_file"
}

function toHit(ctx: RecordsContext, r: ItemRow, parentTitles: Map<string, string>): RecordHit {
  const tz = ctx.timeZone
  const sender = senderOf(r.meta)
  const parentTitle = r.parentSourceItemId ? parentTitles.get(r.parentSourceItemId) : undefined
  const subtitle = r.parentSourceItemId
    ? `Вложение к: ${parentTitle ? `«${parentTitle}»` : "сообщению"}`
    : [providerLabel(r.provider), sender].filter(Boolean).join(" · ")
  const hitFacts = isDocument(r)
    ? facts([
        { label: "Дата", value: formatDate(r.date, tz) },
        { label: "Тип", value: DOCUMENT_TYPE_LABELS_RU[documentTypeBucket(r.fileMime ?? r.mimeType, r.filename)] ?? "" },
        { label: "Размер", value: fileSize(r) },
      ])
    : facts([
        { label: "Дата", value: formatDate(r.date, tz) },
        { label: "От", value: sender },
        { label: "Кому", value: nameList(recipientsOf(r.meta), 1) },
      ])
  return {
    type: "source_item",
    id: r.id,
    title: itemTitle(r),
    subtitle: subtitle || null,
    facts: hitFacts,
    badge: PARSE_BADGES[r.parseStatus] ?? null,
    date: isoOrNull(r.date),
    href: recordHref("source_item", r.id),
  }
}

// ── SQL pieces ────────────────────────────────────────────────────────────

/** Rows a user may see: the org's, not skipped, with something to show. */
function visible(ctx: RecordsContext): SQL {
  return and(
    eq(sourceItem.organizationId, ctx.orgId),
    ne(sourceItem.parseStatus, "skipped"),
    sql`(coalesce(${sourceItem.filename}, '') <> ''
      or coalesce(${m}->>'subject', ${m}->>'title', ${m}->>'summary', ${m}->>'snippet', ${m}->>'text', ${m}->>'rawText', '') <> ''
      or ${sourceItem.parsedMarkdown} is not null or ${sourceItem.markdownR2Key} is not null)`,
  )!
}

/** Sender / recipient names and addresses of every provider, as one JSON array (values only, no keys). */
const peopleJson = sql`(
  jsonb_path_query_array(${m}, 'lax $.from.*') || jsonb_path_query_array(${m}, 'lax $.to.*')
  || jsonb_path_query_array(${m}, 'lax $.cc.*') || jsonb_path_query_array(${m}, 'lax $.participants.*')
  || jsonb_path_query_array(${m}, 'lax $.senders[*]') || jsonb_path_query_array(${m}, 'lax $.authors[*]')
  || jsonb_path_query_array(${m}, 'lax $.owners[*]') || jsonb_path_query_array(${m}, 'lax $.author')
  || jsonb_path_query_array(${m}, 'lax $.telegram.from.firstName') || jsonb_path_query_array(${m}, 'lax $.telegram.from.lastName')
  || jsonb_path_query_array(${m}, 'lax $.telegram.from.username')
)`

function hasAttachmentSql(): SQL {
  return sql`(case when jsonb_typeof(${m}->'attachmentCount') = 'number' then (${m}->>'attachmentCount')::numeric else 0 end > 0
    or exists (select 1 from ${sourceItem} as ch where ch.parent_source_item_id = ${sourceItem.id} and ch.parse_status <> 'skipped'))`
}

function dateBounds(from: Date | null, to: Date | null): SQL | undefined {
  return and(
    from ? sql`${itemDate} >= ${from.toISOString()}` : undefined,
    to ? sql`${itemDate} <= ${to.toISOString()}` : undefined,
  )
}

function baseQuery() {
  return db
    .select({ ...cols, total: totalOver })
    .from(sourceItem)
    .innerJoin(source, eq(source.id, sourceItem.sourceId))
}

/** Titles of parent items (the «Вложение к» subtitle), one query. */
async function loadParentTitles(ctx: RecordsContext, rows: ItemRow[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map((r) => r.parentSourceItemId).filter((v): v is string => !!v))]
  if (ids.length === 0) return new Map()
  const parents = await db
    .select({ id: sourceItem.id, externalType: sourceItem.externalType, filename: sourceItem.filename, meta: metaLite })
    .from(sourceItem)
    .where(and(eq(sourceItem.organizationId, ctx.orgId), inArray(sourceItem.id, ids)))
  return new Map(parents.map((p) => [p.id, shortText(itemTitle(p), 80)]))
}

async function mapRows(ctx: RecordsContext, rows: ItemRow[]): Promise<RecordHit[]> {
  const own = keepOwnOrg(ctx, "source_item", rows)
  const parents = await loadParentTitles(ctx, own)
  return own.map((r) => toHit(ctx, r, parents))
}

/**
 * Hits for known item ids (in the given order), for linked records in other
 * details (e.g. the messages of a topic). Hidden / other-org ids are dropped.
 */
export async function loadSourceItemHits(ctx: RecordsContext, ids: readonly string[]): Promise<RecordHit[]> {
  if (ids.length === 0) return []
  const rows = await db
    .select(cols)
    .from(sourceItem)
    .innerJoin(source, eq(source.id, sourceItem.sourceId))
    .where(and(visible(ctx), inArray(sourceItem.id, [...ids])))
  const hits = await mapRows(ctx, rows)
  const byId = new Map(hits.map((h) => [h.id, h]))
  return ids.map((id) => byId.get(id)).filter((h): h is RecordHit => !!h)
}

// ── Company / contact → items (the app's existing links) ─────────────────

type EntityMatch = { id: string; name: string }


function resolveClients(ctx: RecordsContext, value: string): Promise<EntityMatch[]> {
  return resolveCompanyFilter(ctx, value, 3)
}

function resolveContacts(ctx: RecordsContext, value: string): Promise<EntityMatch[]> {
  return resolveContactFilter(ctx, value, 3)
}

/**
 * Item ids the app already ties to these companies: the company page's
 * content matcher (`listClientContent`), document links of the company and
 * of its contacts / deals (the «Документы» view), and the topics engine's
 * item subjects. Children of a matched item match through their parent.
 */
async function itemIdsForClients(ctx: RecordsContext, clientIds: string[]): Promise<string[]> {
  if (clientIds.length === 0) return []
  const [content, links, subjects] = await Promise.all([
    Promise.all(
      clientIds.map((clientId) =>
        listClientContent({ organizationId: ctx.orgId, clientId, limit: CONTENT_MATCH_LIMIT }).catch(() => ({ rows: [] })),
      ),
    ),
    db
      .select({ id: documentLink.sourceItemId })
      .from(documentLink)
      .where(
        and(
          eq(documentLink.organizationId, ctx.orgId),
          isNull(documentLink.removedAt),
          or(
            and(eq(documentLink.entityType, "client"), inArray(documentLink.entityId, clientIds)),
            and(
              eq(documentLink.entityType, "contact"),
              sql`${documentLink.entityId} in (select ${contact.id} from ${contact} where ${contact.organizationId} = ${ctx.orgId} and ${inArray(contact.clientId, clientIds)})`,
            ),
            and(
              eq(documentLink.entityType, "deal"),
              sql`${documentLink.entityId} in (select ${deal.id} from ${deal} where ${deal.organizationId} = ${ctx.orgId} and ${inArray(deal.clientId, clientIds)})`,
            ),
          ),
        ),
      ),
    db
      .select({ id: sourceItemSubject.sourceItemId })
      .from(sourceItemSubject)
      .where(and(eq(sourceItemSubject.organizationId, ctx.orgId), inArray(sourceItemSubject.clientId, clientIds))),
  ])
  return [...new Set([...content.flatMap((c) => c.rows.map((r) => r.id)), ...links.map((r) => r.id), ...subjects.map((r) => r.id)])]
}

async function itemIdsForContacts(ctx: RecordsContext, contactIds: string[]): Promise<string[]> {
  if (contactIds.length === 0) return []
  const [content, links, subjects] = await Promise.all([
    Promise.all(
      contactIds.map((contactId) =>
        listContactContent({ organizationId: ctx.orgId, contactId, limit: CONTENT_MATCH_LIMIT }).catch(() => ({ rows: [] })),
      ),
    ),
    db
      .select({ id: documentLink.sourceItemId })
      .from(documentLink)
      .where(
        and(
          eq(documentLink.organizationId, ctx.orgId),
          isNull(documentLink.removedAt),
          eq(documentLink.entityType, "contact"),
          inArray(documentLink.entityId, contactIds),
        ),
      ),
    db
      .select({ id: sourceItemSubject.sourceItemId })
      .from(sourceItemSubject)
      .where(and(eq(sourceItemSubject.organizationId, ctx.orgId), inArray(sourceItemSubject.contactId, contactIds))),
  ])
  return [...new Set([...content.flatMap((c) => c.rows.map((r) => r.id)), ...links.map((r) => r.id), ...subjects.map((r) => r.id)])]
}

function inItemSet(ids: string[]): SQL {
  if (ids.length === 0) return sql`false`
  return or(inArray(sourceItem.id, ids), inArray(sourceItem.parentSourceItemId, ids))!
}

// ── search / list / get ───────────────────────────────────────────────────

async function search(ctx: RecordsContext, tq: TextQuery, opts: SearchOptions) {
  const titleFields = [norm(sql`${m}->>'subject'`), norm(sql`${m}->>'title'`), norm(sourceItem.filename)]
  const people = normJsonText(peopleJson)
  const rows = await baseQuery()
    .where(
      and(
        visible(ctx),
        dateBounds(opts.dateFrom, opts.dateTo),
        or(
          ...titleFields.map((f) => matchesQuery(tq, f)),
          matchesQuery(tq, people),
          // Long texts: literal substring only — a fuzzy arm over a paragraph matches too much.
          containsQuery(tq, norm(sql`${m}->>'summary'`)),
          containsQuery(tq, norm(sql`${m}->>'snippet'`)),
          containsQuery(tq, norm(sql`left(${m}->>'text', 500)`)),
        ),
      ),
    )
    .orderBy(desc(relevanceOf(tq, [...titleFields, people])), desc(itemDate))
    .limit(opts.limit)
  return { hits: await mapRows(ctx, rows), ...capTotal(rows[0]?.total) }
}

async function list(ctx: RecordsContext, filters: SourceItemFilters, sort: string, limit: number) {
  const applied: { label: string; value: string }[] = []
  const where: (SQL | undefined)[] = [visible(ctx)]

  if (filters.provider) {
    where.push(inArray(source.provider, [...PROVIDER_GROUPS[filters.provider]]))
    applied.push({ label: "Источник", value: PROVIDER_GROUP_LABELS[filters.provider] })
  }
  const from = parseDay(filters.dateFrom, false, ctx.timeZone)
  const to = parseDay(filters.dateTo, true, ctx.timeZone)
  if (from || to) {
    where.push(dateBounds(from, to))
    applied.push({
      label: "Дата",
      value: [from && `с ${formatDate(from, ctx.timeZone)}`, to && `по ${formatDate(to, ctx.timeZone)}`].filter(Boolean).join(" "),
    })
  }
  if (filters.company) {
    const clients = await resolveClients(ctx, filters.company)
    where.push(inItemSet(await itemIdsForClients(ctx, clients.map((c) => c.id))))
    applied.push({ label: "Компания", value: clients.length ? clients.map((c) => c.name).join(", ") : `${filters.company} (не найдена)` })
  }
  if (filters.contact) {
    const contacts = await resolveContacts(ctx, filters.contact)
    where.push(inItemSet(await itemIdsForContacts(ctx, contacts.map((c) => c.id))))
    applied.push({ label: "Контакт", value: contacts.length ? contacts.map((c) => c.name).join(", ") : `${filters.contact} (не найден)` })
  }
  if (filters.direction) {
    const allInternal = sql`coalesce((${m}->'orgAttribution'->>'allInternal') = 'true', false)`
    where.push(
      filters.direction === "in"
        ? eq(sourceItem.orgAttribution, "external")
        : filters.direction === "internal"
          ? and(eq(sourceItem.orgAttribution, "own_org"), allInternal)
          : and(eq(sourceItem.orgAttribution, "own_org"), sql`not ${allInternal}`),
    )
    applied.push({ label: "Направление", value: DIRECTION_LABELS[filters.direction] })
  }
  if (filters.attribution) {
    where.push(eq(sourceItem.orgAttribution, filters.attribution))
    applied.push({ label: "Автор", value: ATTRIBUTION_LABELS[filters.attribution] })
  }
  if (filters.kind) {
    where.push(
      filters.kind === "document"
        ? or(sql`${sourceItem.parentSourceItemId} is not null`, inArray(sourceItem.externalType, ["drive_file", "dropoff_file"]))
        : and(isNull(sourceItem.parentSourceItemId), sql`${sourceItem.externalType} not in ('drive_file', 'dropoff_file')`),
    )
    applied.push({ label: "Вид", value: filters.kind === "document" ? "Файлы и вложения" : "Сообщения" })
  }
  if (filters.hasAttachment !== undefined) {
    where.push(filters.hasAttachment ? hasAttachmentSql() : sql`not ${hasAttachmentSql()}`)
    applied.push({ label: "Вложения", value: filters.hasAttachment ? "есть" : "нет" })
  }

  const rows = await baseQuery()
    .where(and(...where))
    .orderBy(sort === "oldest" ? asc(itemDate) : desc(itemDate), asc(sourceItem.id))
    .limit(limit)
  return { rows: await mapRows(ctx, rows), ...capTotal(rows[0]?.total), applied }
}

/** Linked CRM records of an item: document links, topics-engine subjects, topics (mode `on`). */
async function loadLinkedRecords(ctx: RecordsContext, itemId: string): Promise<RecordHit[]> {
  const [links, subjects, topics] = await Promise.all([
    db
      .select({ entityType: documentLink.entityType, entityId: documentLink.entityId })
      .from(documentLink)
      .where(and(eq(documentLink.organizationId, ctx.orgId), eq(documentLink.sourceItemId, itemId), isNull(documentLink.removedAt))),
    db
      .select({ clientId: sourceItemSubject.clientId, contactId: sourceItemSubject.contactId })
      .from(sourceItemSubject)
      .where(and(eq(sourceItemSubject.organizationId, ctx.orgId), eq(sourceItemSubject.sourceItemId, itemId))),
    ctx.topicsVisible
      ? db
          .selectDistinct({ id: topic.id, title: topic.title, lastActivityAt: topic.lastActivityAt })
          .from(topicItem)
          .innerJoin(topic, eq(topic.id, topicItem.topicId))
          .where(and(eq(topicItem.organizationId, ctx.orgId), eq(topic.organizationId, ctx.orgId), eq(topicItem.sourceItemId, itemId), ne(topic.status, "merged")))
          .limit(5)
      : Promise.resolve([]),
  ])
  const ids = (type: string, extra: (string | null)[] = []) => [
    ...new Set([...links.filter((l) => l.entityType === type).map((l) => l.entityId), ...extra.filter((v): v is string => !!v)]),
  ]
  const clientIds = ids("client", subjects.map((s) => s.clientId))
  const contactIds = ids("contact", subjects.map((s) => s.contactId))
  const dealIds = ids("deal")
  const taskIds = ids("task")
  const orderIds = ids("order")
  const none = Promise.resolve([] as { id: string; title: string; sub: string | null }[])
  const [clients, contacts, deals, tasks, orders] = await Promise.all([
    clientIds.length
      ? db
          .select({ id: client.id, title: client.name, sub: sql<string | null>`null` })
          .from(client)
          .where(and(eq(client.organizationId, ctx.orgId), inArray(client.id, clientIds), sql`${client.status} not in ('deleted', 'blocked')`))
      : none,
    contactIds.length
      ? db
          .select({ id: contact.id, title: contact.name, sub: contact.position })
          .from(contact)
          .where(and(eq(contact.organizationId, ctx.orgId), inArray(contact.id, contactIds), sql`${contact.status} not in ('deleted', 'blocked')`))
      : none,
    dealIds.length
      ? db
          .select({ id: deal.id, title: deal.name, sub: sql<string | null>`null` })
          .from(deal)
          .where(and(eq(deal.organizationId, ctx.orgId), inArray(deal.id, dealIds), ne(deal.status, "deleted")))
      : none,
    taskIds.length
      ? db
          .select({ id: task.id, title: task.name, sub: sql<string | null>`null` })
          .from(task)
          .where(and(eq(task.organizationId, ctx.orgId), inArray(task.id, taskIds)))
      : none,
    orderIds.length
      ? db
          .select({ id: order.id, title: sql<string>`'Заказ от ' || to_char(${order.orderDate}, 'DD.MM.YYYY')`, sub: sql<string | null>`null` })
          .from(order)
          .where(and(eq(order.organizationId, ctx.orgId), inArray(order.id, orderIds)))
      : none,
  ])
  return [
    ...clients.map((r) => basicHit("client", r.id, r.title, "Компания")),
    ...contacts.map((r) => basicHit("contact", r.id, r.title, r.sub ? `Контакт · ${r.sub}` : "Контакт")),
    ...deals.map((r) => basicHit("deal", r.id, r.title, "Сделка")),
    ...tasks.map((r) => basicHit("task", r.id, r.title, "Задача")),
    ...orders.map((r) => basicHit("order", r.id, r.title, null)),
    ...topics.map((t) => basicHit("topic", t.id, t.title, "Тема", [], isoOrNull(t.lastActivityAt))),
  ]
}

async function readContent(ctx: RecordsContext, id: string): Promise<string> {
  try {
    const md = await getSourceItemMarkdown(id, { requireOrganizationId: ctx.orgId })
    const body = md ? messageContent(md) : ""
    if (body.length <= CONTENT_MAX_CHARS) return body
    return `${body.slice(0, CONTENT_MAX_CHARS).trimEnd()}\n\n…(текст обрезан)`
  } catch (error) {
    console.warn(`[chat-records] source_item ${id}: markdown not readable`, error)
    return ""
  }
}

async function get(ctx: RecordsContext, id: string): Promise<RecordDetail | null> {
  const [row] = await db
    .select(cols)
    .from(sourceItem)
    .innerJoin(source, eq(source.id, sourceItem.sourceId))
    .where(and(visible(ctx), eq(sourceItem.id, id)))
    .limit(1)
  if (!row || keepOwnOrg(ctx, "source_item", [row]).length === 0) return null

  const [body, children, linked, parentRows] = await Promise.all([
    readContent(ctx, id),
    db
      .select({ id: sourceItem.id })
      .from(sourceItem)
      .where(and(visible(ctx), eq(sourceItem.parentSourceItemId, id)))
      .orderBy(asc(sourceItem.createdAt), asc(sourceItem.externalId))
      .limit(20)
      .then((rows) => loadSourceItemHits(ctx, rows.map((r) => r.id))),
    loadLinkedRecords(ctx, id),
    row.parentSourceItemId ? loadSourceItemHits(ctx, [row.parentSourceItemId]) : Promise.resolve([]),
  ])

  const tz = ctx.timeZone
  const meta = row.meta ?? {}
  const parent = parentRows[0]
  const doc = isDocument(row)
  const sections: RecordDetailSection[] = []

  const info = allFacts([
    { label: "Источник", value: [providerLabel(row.provider), row.sourceName].filter(Boolean).join(" · ") },
    { label: "От", value: senderOf(meta) },
    { label: "Кому", value: nameList(addrList(meta.to), 5) },
    { label: "Копия", value: nameList(addrList(meta.cc), 5) },
    { label: "Дата", value: formatDateTime(row.date, tz) },
    {
      label: "Тип",
      value: doc
        ? (DOCUMENT_TYPE_LABELS_RU[documentTypeBucket(row.fileMime ?? row.mimeType, row.filename)] ?? "")
        : (KIND_LABELS[row.externalType] ?? ""),
    },
    { label: "Файл", value: row.filename ?? "" },
    { label: "Размер", value: fileSize(row) },
    {
      label: "Направление",
      value: meta.allInternal === true ? "Внутреннее" : (DIRECTION_OF_ITEM[row.orgAttribution] ?? ""),
    },
    { label: "Разбор", value: PARSE_BADGES[row.parseStatus]?.label ?? "" },
  ])
  const infoItems: (typeof info[number] & { href?: string })[] = [...info]
  if (parent) infoItems.splice(1, 0, { label: "Вложение к", value: parent.title, href: parent.href })
  if (infoItems.length) sections.push({ kind: "facts", title: "Сведения", items: infoItems })

  const summary = str(meta.summary)
  if (summary) sections.push({ kind: "text", title: "Кратко", markdown: summary })
  const content = body || str(meta.text) || str(meta.snippet)
  if (content) sections.push({ kind: "text", title: "Содержание", markdown: content })
  if (children.length) sections.push({ kind: "records", title: "Вложения", items: children })
  if (linked.length) sections.push({ kind: "records", title: "Связано с", items: linked })

  const subtitle = row.parentSourceItemId
    ? `Вложение к: ${parent ? `«${shortText(parent.title, 80)}»` : "сообщению"}`
    : [providerLabel(row.provider), senderOf(meta)].filter(Boolean).join(" · ")
  const badge = PARSE_BADGES[row.parseStatus]
  return {
    type: "source_item",
    id,
    title: itemTitle(row),
    subtitle: subtitle || null,
    badges: badge ? [badge] : [],
    sections,
    href: recordHref("source_item", id),
  }
}

export const sourceItemsModule: RecordModule<SourceItemFilters> = {
  type: "source_item",
  filterSchema: sourceItemFilterSchema,
  sortKeys: SORT_KEYS,
  search,
  list,
  get,
}

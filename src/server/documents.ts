import "server-only"

import { readTelegramResolved } from "@/lib/telegram/resolve"

// Documents of CRM entities (docs/specs/attachments/01-specification.md).
// Org-explicit core functions + the session gate `documentsSession()`.
//   - storeDocumentFile: original bytes → storage (`source_item.file_*`, Q1, 50 MB)
//   - computeAutoLinks: automatic links A1–A3 + A5 (pure planner in
//     src/lib/documents.ts), never re-adding a link a person removed (Q3)
//   - listDocuments / addLink / removeLink / confirmLink (any member, Q8)
//   - uploadDocuments (any member; the org's «Files Drop Off» source, Q6)
//   - deleteDocument (uploads only; uploader or org owner, Q8)
//   - readDocumentFile (the file route; bytes from storage, else a lazy
//     re-fetch from the provider through ./documents-ingest)

import { createHash, randomUUID } from "node:crypto"
import { after } from "next/server"
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import {
  client,
  contact,
  contactAddress,
  deal,
  dealContact,
  documentLink,
  order,
  source,
  sourceItem,
  task,
  topic,
  topicItem,
  user,
} from "@/db/schema"
import {
  contentDisposition,
  DOCUMENT_ITEM_KINDS,
  DOCUMENT_MAX_BYTES,
  DOCUMENT_UPLOAD_MAX_FILES,
  documentSkipReason,
  documentTypeBucket,
  downloadFileName,
  clientsBySenderDomain,
  isInlineSafeMime,
  messageParticipants,
  planAutoLinks,
  safeFileSegment,
  type AutoLinkParticipant,
  type DocumentEntityType,
  type DocumentLinkView,
  type DocumentTypeBucket,
  type DocumentView,
  type FileStatus,
  type LinkConfidence,
  type LinkOrigin,
} from "@/lib/documents"
import { getServerSession } from "@/lib/get-session"
import { companyMatchKey } from "@/lib/translit-ru"
import { getOrgFunnel, isTerminalStage, OPEN_DEAL_STATUSES } from "@/server/deal-engine"
import { getOwnOrgContext } from "@/server/identity/own-org"
import { getActiveOrgRole } from "@/server/sources"
import { findActiveOrgSourceByProvider } from "@/server/source-uploads"
import { deleteObjects, getObject, putObject } from "@/server/storage"
import { contactDisplaySql } from "@/server/contact-display"

export class DocumentError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 403 | 404 | 409 | 413 = 400,
  ) {
    super(message)
    this.name = "DocumentError"
  }
}

type BatchOps = Parameters<typeof db.batch>[0]
const asBatch = (ops: unknown[]) => ops as unknown as BatchOps

const DOC_KINDS = [...DOCUMENT_ITEM_KINDS] as string[]

// Decorative inline images (signature logos, banners, tracking pixels) are
// kept as `skipped` audit rows of kind `attachment` (Nylas cid: images) —
// they are NOT documents (Q2): never stored, never linked, never listed.
// The reasons come from `triageInlineImage` (src/lib/image-triage.ts) and
// the image parser's `isBoilerplate` verdict (parse-source-item.ts).
const DECORATIVE_REASON = /^(tracking pixel|decorative )/i

/** PURE. A skipped decorative inline image (not a document). */
export function isDecorativeSkip(parseStatus: string | null | undefined, parseError: string | null | undefined): boolean {
  return parseStatus === "skipped" && !!parseError && DECORATIVE_REASON.test(parseError)
}

/** SQL twin of `isDecorativeSkip`: true for rows that ARE documents. */
export const notDecorativeSql = sql`not (${sourceItem.parseStatus} = 'skipped' and coalesce(${sourceItem.parseError}, '') ~* '^(tracking pixel|decorative )')`

// ── Session gate ──────────────────────────────────────────────────────────

export async function documentsSession(): Promise<{ orgId: string; userId: string; isOwner: boolean }> {
  const session = await getServerSession()
  if (!session?.user) throw new DocumentError("Unauthorized", 401)
  const role = await getActiveOrgRole()
  if (!role) throw new DocumentError("Нет активной организации", 401)
  return { orgId: role.organizationId, userId: session.user.id, isOwner: role.role === "owner" }
}

// ── Original file storage (§3.2) ──────────────────────────────────────────

export function documentFileKey(orgId: string, itemId: string, name: string | null | undefined): string {
  return `org_${orgId}/files/${itemId}/${safeFileSegment(name)}`
}

/**
 * Store the original bytes of a document item. Never throws: returns the
 * status written to `source_item.file_status` (`too_large` above 50 MB,
 * `failed` on a storage error).
 */
export async function storeDocumentFile(
  orgId: string,
  itemId: string,
  bytes: Uint8Array,
  meta: { name: string | null; mime: string | null },
): Promise<FileStatus> {
  // Header-safe mime: the S3 client refuses non-ASCII parameters
  // (e.g. `application/pdf; name="Счёт.pdf"`) — keep the base type.
  const rawMime = (meta.mime ?? "").trim()
  const base = rawMime.split(";")[0].trim().toLowerCase()
  const mime = !rawMime
    ? "application/octet-stream"
    : /^[\x20-\x7e]+$/.test(rawMime)
      ? rawMime
      : /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(base)
        ? base
        : "application/octet-stream"
  try {
    if (bytes.byteLength > DOCUMENT_MAX_BYTES) {
      await db
        .update(sourceItem)
        .set({ fileStatus: "too_large", fileSizeBytes: bytes.byteLength, fileMime: mime })
        .where(and(eq(sourceItem.organizationId, orgId), eq(sourceItem.id, itemId)))
      return "too_large"
    }
    const key = documentFileKey(orgId, itemId, meta.name)
    await putObject(key, bytes, mime)
    const sha = createHash("sha256").update(bytes).digest("hex")
    await db
      .update(sourceItem)
      .set({
        fileKey: key,
        fileSizeBytes: bytes.byteLength,
        fileMime: mime,
        fileSha256: sha,
        fileStoredAt: new Date(),
        fileStatus: "stored",
      })
      .where(and(eq(sourceItem.organizationId, orgId), eq(sourceItem.id, itemId)))
    return "stored"
  } catch (e) {
    console.error(`[documents] store failed for item ${itemId}:`, e)
    await db
      .update(sourceItem)
      .set({ fileStatus: "failed" })
      .where(and(eq(sourceItem.organizationId, orgId), eq(sourceItem.id, itemId)))
      .catch(() => {})
    return "failed"
  }
}

// ── Entity checks + labels ────────────────────────────────────────────────

async function entityLabels(
  orgId: string,
  refs: readonly { entityType: DocumentEntityType; entityId: string }[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const ids = (t: DocumentEntityType) => [...new Set(refs.filter((r) => r.entityType === t).map((r) => r.entityId))]
  const [cl, co, de, ta, or_] = await Promise.all([
    ids("client").length
      ? db.select({ id: client.id, label: client.name }).from(client).where(and(eq(client.organizationId, orgId), inArray(client.id, ids("client"))))
      : [],
    ids("contact").length
      ? db.select({ id: contact.id, label: contactDisplaySql() }).from(contact).where(and(eq(contact.organizationId, orgId), inArray(contact.id, ids("contact"))))
      : [],
    ids("deal").length
      ? db.select({ id: deal.id, label: deal.name }).from(deal).where(and(eq(deal.organizationId, orgId), inArray(deal.id, ids("deal"))))
      : [],
    ids("task").length
      ? db.select({ id: task.id, label: task.name }).from(task).where(and(eq(task.organizationId, orgId), inArray(task.id, ids("task"))))
      : [],
    ids("order").length
      ? db
          .select({ id: order.id, date: order.orderDate, clientName: client.name })
          .from(order)
          .leftJoin(client, eq(client.id, order.clientId))
          .where(and(eq(order.organizationId, orgId), inArray(order.id, ids("order"))))
      : [],
  ])
  for (const r of cl) out.set(`client:${r.id}`, r.label)
  for (const r of co) out.set(`contact:${r.id}`, r.label)
  for (const r of de) out.set(`deal:${r.id}`, r.label)
  for (const r of ta) out.set(`task:${r.id}`, r.label)
  for (const r of or_ as { id: string; date: Date; clientName: string | null }[]) {
    out.set(`order:${r.id}`, `Заказ от ${r.date.toLocaleDateString("ru-RU", { timeZone: "UTC" })}${r.clientName ? ` · ${r.clientName}` : ""}`)
  }
  return out
}

/** Throws 404 unless the entity exists in the org. */
export async function assertEntityInOrg(orgId: string, entityType: DocumentEntityType, entityId: string): Promise<void> {
  const labels = await entityLabels(orgId, [{ entityType, entityId }])
  if (!labels.has(`${entityType}:${entityId}`)) throw new DocumentError("Объект не найден", 404)
}

async function loadDocItem(orgId: string, itemId: string) {
  const [r] = await db
    .select()
    .from(sourceItem)
    .where(and(eq(sourceItem.organizationId, orgId), eq(sourceItem.id, itemId)))
  if (!r || !DOC_KINDS.includes(r.externalType)) throw new DocumentError("Документ не найден", 404)
  return r
}

// ── Automatic attribution (§4) ────────────────────────────────────────────

type AddrLike = { email?: unknown; name?: unknown } | string
function emailsOf(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const p of v as AddrLike[]) {
    const raw = typeof p === "string" ? p : typeof p?.email === "string" ? p.email : null
    if (!raw) continue
    const m = raw.match(/<([^>]+)>/)
    const e = (m ? m[1] : raw).trim().toLowerCase()
    if (e.includes("@")) out.push(e)
  }
  return out
}

/** Telegram author handle of a message (forward → original author), lower-case, no «@». */
function telegramAuthorHandle(meta: Record<string, unknown>): string | null {
  const tg = (meta.telegram ?? null) as Record<string, unknown> | null
  if (!tg) return null
  const origin = (tg.forwardOrigin ?? null) as { type?: string; user?: { username?: string | null } } | null
  const raw = origin ? (origin.type === "user" ? origin.user?.username : null) : (tg.from as { username?: string | null } | null)?.username
  const h = (raw ?? "").trim().replace(/^@/, "").toLowerCase()
  return h || null
}

/** The ONE live contact with this Telegram name (alias «@name» or «Адреса» → Telegram). */
async function contactByTelegramHandle(orgId: string, handle: string): Promise<{ id: string; clientId: string | null } | null> {
  const rows = await db
    .select({ id: contact.id, clientId: contact.clientId })
    .from(contact)
    .where(
      and(
        eq(contact.organizationId, orgId),
        sql`${contact.status} not in ('deleted', 'blocked')`,
        sql`(EXISTS (SELECT 1 FROM unnest(${contact.aliases}) a WHERE lower(a) = ${"@" + handle})
          OR EXISTS (SELECT 1 FROM contact_address ca WHERE ca.contact_id = ${contact.id} AND ca.kind = 'telegram' AND ca.value = ${handle}))`,
      ),
    )
    .limit(2)
  return rows.length === 1 ? rows[0] : null
}

function stringsOf(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : []
}

/**
 * Automatic links of ONE document item (A1–A3, A5). Idempotent; never
 * re-adds a removed link. Returns the number of links added. Never throws
 * for data reasons (a non-document item → 0).
 */
export async function computeAutoLinks(orgId: string, itemId: string): Promise<number> {
  const [item] = await db
    .select({
      id: sourceItem.id,
      kind: sourceItem.externalType,
      parentId: sourceItem.parentSourceItemId,
      meta: sourceItem.metadataJson,
      parseStatus: sourceItem.parseStatus,
      parseError: sourceItem.parseError,
    })
    .from(sourceItem)
    .where(and(eq(sourceItem.organizationId, orgId), eq(sourceItem.id, itemId)))
  if (!item || !DOC_KINDS.includes(item.kind)) return 0
  if (isDecorativeSkip(item.parseStatus, item.parseError)) return 0
  // A derived audio track's parent is its video; walk up to the message.
  let parent: { id: string; meta: unknown; parentId: string | null } | null = null
  let cursor = item.parentId
  for (let depth = 0; cursor && depth < 3; depth++) {
    const [p] = await db
      .select({ id: sourceItem.id, meta: sourceItem.metadataJson, parentId: sourceItem.parentSourceItemId, kind: sourceItem.externalType })
      .from(sourceItem)
      .where(and(eq(sourceItem.organizationId, orgId), eq(sourceItem.id, cursor)))
    if (!p) break
    parent = p
    if (!DOC_KINDS.includes(p.kind)) break
    cursor = p.parentId
  }

  const own = await getOwnOrgContext(orgId)
  const isOwn = (e: string) => own.matchEmail(e) !== null

  // A1 — parent message participants → contacts (exact email).
  const pm = (parent?.meta ?? {}) as Record<string, unknown>
  const fromAll = emailsOf(pm.from)
  // Our own outgoing message: every «from» address is ours.
  const outbound = fromAll.length > 0 && fromAll.every(isOwn)
  const senders = fromAll.filter((e) => !isOwn(e))
  const recipients = [...emailsOf(pm.to), ...emailsOf(pm.cc)].filter((e) => !isOwn(e))
  const allEmails = [...new Set([...senders, ...recipients])]
  const contactRows = allEmails.length
    ? await db
        .select({ id: contact.id, email: contact.email, clientId: contact.clientId })
        .from(contact)
        .where(
          and(
            eq(contact.organizationId, orgId),
            inArray(sql`lower(${contact.email})`, allEmails),
            sql`${contact.status} not in ('deleted', 'blocked')`,
          ),
        )
    : []
  // Extra addresses of one person (`contact_address`, docs/specs/clients-contacts/04
  // §3.2): an old X address or a second company's address maps to the same
  // contact; the company is the address's company, else the contact's primary.
  const addressRows = allEmails.length
    ? await db
        .select({ id: contact.id, email: contactAddress.value, clientId: sql<string | null>`coalesce(${contactAddress.clientId}, ${contact.clientId})` })
        .from(contactAddress)
        .innerJoin(contact, eq(contact.id, contactAddress.contactId))
        .where(
          and(
            eq(contactAddress.organizationId, orgId),
            eq(contactAddress.kind, "email"),
            inArray(contactAddress.value, allEmails),
            sql`${contact.status} not in ('deleted', 'blocked')`,
          ),
        )
    : []
  const byEmail = new Map<string, { id: string; clientId: string | null }[]>()
  for (const c of [...contactRows, ...addressRows]) {
    const k = (c.email ?? "").toLowerCase()
    const list = byEmail.get(k) ?? []
    if (!list.some((x) => x.id === c.id)) list.push({ id: c.id, clientId: c.clientId })
    byEmail.set(k, list)
  }
  // Unique hits only; who of them may link: `messageParticipants` (pure).
  const uniqueHit = (e: string) => {
    const hits = byEmail.get(e) ?? []
    return hits.length === 1 ? { email: e, contactId: hits[0].id, clientId: hits[0].clientId } : null
  }
  const participants: AutoLinkParticipant[] = messageParticipants({
    outbound,
    senderEmails: senders,
    senders: senders.map(uniqueHit).filter((x) => x !== null),
    recipients: recipients.map(uniqueHit).filter((x) => x !== null),
  })
  // Telegram (docs/specs/telegram §4.3, Q11 / Q14): the author by Telegram
  // name — for a forward the ORIGINAL author; our member (the «us» registry)
  // never; a contact by alias «@name» or «Адреса» → Telegram (unique hit).
  // The ONE rule (docs/specs/telegram/04 §8.3) first: a resolved author contact
  // (by id or name) + its company; a member never. Older items: by name.
  const tgResolved = readTelegramResolved(pm)
  const tgHandle = tgResolved ? null : telegramAuthorHandle(pm)
  if (tgResolved?.author.kind === "contact" && tgResolved.author.contactId) {
    const cid = tgResolved.author.contactId
    if (!participants.some((p) => p.contactId === cid)) participants.push({ contactId: cid, clientId: tgResolved.counterpartyClientIds[0] ?? null, role: "sender" })
  }
  if (tgHandle && !own.identity.staffTelegram.includes(tgHandle)) {
    const hit = await contactByTelegramHandle(orgId, tgHandle)
    if (hit && !participants.some((p) => p.contactId === hit.id)) {
      participants.push({ contactId: hit.id, clientId: hit.clientId, role: "sender" })
    }
  }

  // A2 — topics of the item or its parent.
  const topicItemIds = [item.id, ...(parent ? [parent.id] : [])]
  const topics = await db
    .select({ title: topic.title, clientId: topic.clientId, contactId: topic.contactId, dealId: topic.dealId, status: topic.status })
    .from(topicItem)
    .innerJoin(topic, eq(topic.id, topicItem.topicId))
    .where(and(eq(topic.organizationId, orgId), inArray(topicItem.sourceItemId, topicItemIds)))

  // A3 — companies named in the file content (exact keys, unique hits, never us).
  // People named in a file are not linked (bug list 2026-11-22).
  const im = (item.meta ?? {}) as Record<string, unknown>
  const companyKeys = new Set(
    [...stringsOf(im.companies), ...stringsOf(im.organizations)].map((n) => companyMatchKey(n)).filter((k) => k && !own.identity.companyKeys.includes(k)),
  )
  const contentClients: string[] = []
  if (companyKeys.size) {
    const rows = await db
      .select({ id: client.id, name: client.name, aliases: client.aliases })
      .from(client)
      .where(and(eq(client.organizationId, orgId), sql`${client.status} not in ('deleted', 'blocked')`))
    const byKey = new Map<string, Set<string>>()
    for (const r of rows) {
      for (const n of [r.name, ...(r.aliases ?? [])]) {
        const k = companyMatchKey(n)
        if (k) byKey.set(k, (byKey.get(k) ?? new Set()).add(r.id))
      }
    }
    for (const k of companyKeys) {
      const hit = byKey.get(k)
      if (hit && hit.size === 1) contentClients.push([...hit][0])
    }
  }
  // A1b — the sender's company by mail domain (the sender need not be a contact).
  const senderDomainClients = senders.length
    ? clientsBySenderDomain(
        senders,
        await db
          .select({ id: client.id, webUrl: client.webUrl, email: client.email })
          .from(client)
          .where(
            and(
              eq(client.organizationId, orgId),
              sql`${client.status} not in ('deleted', 'blocked')`,
              sql`(${client.webUrl} is not null or ${client.email} is not null)`,
            ),
          ),
      )
    : []

  const existing = await db
    .select({ entityType: documentLink.entityType, entityId: documentLink.entityId, removedAt: documentLink.removedAt })
    .from(documentLink)
    .where(and(eq(documentLink.organizationId, orgId), eq(documentLink.sourceItemId, item.id)))

  // A5 — open (non-won / lost) deals of every company that may get a link.
  const clientIds = [
    ...new Set([
      ...participants.map((p) => p.clientId).filter((x): x is string => !!x),
      ...topics.map((t) => t.clientId).filter((x): x is string => !!x),
      ...senderDomainClients,
      ...contentClients,
      ...existing.filter((e) => e.entityType === "client" && !e.removedAt).map((e) => e.entityId),
    ]),
  ]
  const openDealsByClient: Record<string, string[]> = {}
  if (clientIds.length) {
    const [stages, deals] = await Promise.all([
      getOrgFunnel(orgId),
      db
        .select({ id: deal.id, clientId: deal.clientId, stageId: deal.funnelStageId })
        .from(deal)
        .where(and(eq(deal.organizationId, orgId), inArray(deal.clientId, clientIds), inArray(deal.status, [...OPEN_DEAL_STATUSES]))),
    ])
    for (const d of deals) {
      if (isTerminalStage(stages, d.stageId)) continue
      openDealsByClient[d.clientId] = [...(openDealsByClient[d.clientId] ?? []), d.id]
    }
  }

  const planned = planAutoLinks({
    participants,
    senderDomainClients,
    topics: topics
      .filter((t) => t.status !== "merged" && t.status !== "dismissed")
      .map((t) => ({ topicTitle: t.title ?? "Тема", clientId: t.clientId, contactId: t.contactId, dealId: t.dealId })),
    contentClients,
    openDealsByClient,
    existing: existing.map((e) => ({ entityType: e.entityType as DocumentEntityType, entityId: e.entityId, removed: !!e.removedAt })),
  })
  if (planned.length === 0) return 0
  await db
    .insert(documentLink)
    .values(
      planned.map((p) => ({
        id: randomUUID(),
        organizationId: orgId,
        sourceItemId: item.id,
        entityType: p.entityType,
        entityId: p.entityId,
        origin: p.origin,
        confidence: p.confidence,
        reason: p.reason,
      })),
    )
    .onConflictDoNothing()
  return planned.length
}

// ── Lists (§6) ────────────────────────────────────────────────────────────

/**
 * The entity refs a view lists. With `includeRelated` (the switch, default
 * on; Q11 for a company, every entity since 2026-11-21 — bug list item 19):
 * - company → + its contacts + its deals (Q11);
 * - contact → + its deals (`deal_contact`) + its tasks;
 * - deal → + its contacts (`deal_contact`) + its tasks;
 * - task → + its deal;
 * - order → + its company (only the company's OWN links: an order has no
 *   deal in the data model).
 * Related rows are the org's own (tenant filter on every query).
 */
async function viewRefs(
  orgId: string,
  entityType: DocumentEntityType,
  entityId: string,
  includeRelated: boolean,
): Promise<{ entityType: DocumentEntityType; entityId: string }[]> {
  const refs: { entityType: DocumentEntityType; entityId: string }[] = [{ entityType, entityId }]
  if (!includeRelated) return refs
  const push = (t: DocumentEntityType, ids: (string | null)[]) => {
    for (const id of ids) if (id && !refs.some((r) => r.entityType === t && r.entityId === id)) refs.push({ entityType: t, entityId: id })
  }
  if (entityType === "client") {
    const [cs, ds] = await Promise.all([
      db.select({ id: contact.id }).from(contact).where(and(eq(contact.organizationId, orgId), eq(contact.clientId, entityId))),
      db.select({ id: deal.id }).from(deal).where(and(eq(deal.organizationId, orgId), eq(deal.clientId, entityId))),
    ])
    push("contact", cs.map((c) => c.id))
    push("deal", ds.map((d) => d.id))
  } else if (entityType === "contact") {
    const [ds, ts] = await Promise.all([
      db
        .select({ id: deal.id })
        .from(dealContact)
        .innerJoin(deal, eq(deal.id, dealContact.dealId))
        .where(and(eq(deal.organizationId, orgId), eq(dealContact.contactId, entityId))),
      db.select({ id: task.id }).from(task).where(and(eq(task.organizationId, orgId), eq(task.contactId, entityId))),
    ])
    push("deal", ds.map((d) => d.id))
    push("task", ts.map((t) => t.id))
  } else if (entityType === "deal") {
    const [cs, ts] = await Promise.all([
      db
        .select({ id: contact.id })
        .from(dealContact)
        .innerJoin(contact, eq(contact.id, dealContact.contactId))
        .where(and(eq(contact.organizationId, orgId), eq(dealContact.dealId, entityId))),
      db.select({ id: task.id }).from(task).where(and(eq(task.organizationId, orgId), eq(task.dealId, entityId))),
    ])
    push("contact", cs.map((c) => c.id))
    push("task", ts.map((t) => t.id))
  } else if (entityType === "task") {
    const [t] = await db.select({ dealId: task.dealId }).from(task).where(and(eq(task.organizationId, orgId), eq(task.id, entityId)))
    push("deal", [t?.dealId ?? null])
  } else if (entityType === "order") {
    const [o] = await db.select({ clientId: order.clientId }).from(order).where(and(eq(order.organizationId, orgId), eq(order.id, entityId)))
    push("client", [o?.clientId ?? null])
  }
  return refs
}

export type ListDocumentsOptions = {
  includeRelated?: boolean
  type?: DocumentTypeBucket | null
  /** Source provider («Источник» filter). */
  provider?: string | null
  q?: string | null
  limit?: number
  offset?: number
}

export async function listDocuments(
  orgId: string,
  viewer: { userId: string; isOwner: boolean },
  entityType: DocumentEntityType,
  entityId: string,
  opts: ListDocumentsOptions = {},
): Promise<{ documents: DocumentView[]; total: number; providers: string[] }> {
  await assertEntityInOrg(orgId, entityType, entityId)
  const refs = await viewRefs(orgId, entityType, entityId, opts.includeRelated ?? true)
  const refCond = or(
    ...refs.map((r) => and(eq(documentLink.entityType, r.entityType), eq(documentLink.entityId, r.entityId))!),
  )!
  const viaRows = await db
    .select({ linkId: documentLink.id, itemId: documentLink.sourceItemId, entityType: documentLink.entityType, entityId: documentLink.entityId })
    .from(documentLink)
    .where(and(eq(documentLink.organizationId, orgId), isNull(documentLink.removedAt), refCond))
  const itemIds = [...new Set(viaRows.map((r) => r.itemId))]
  if (itemIds.length === 0) return { documents: [], total: 0, providers: [] }
  const directLink = new Map<string, string>()
  for (const r of viaRows) if (r.entityType === entityType && r.entityId === entityId) directLink.set(r.itemId, r.linkId)

  const items = await db
    .select({
      i: sourceItem,
      provider: source.provider,
      sourceName: source.name,
    })
    .from(sourceItem)
    .innerJoin(source, eq(source.id, sourceItem.sourceId))
    .where(
      and(
        eq(sourceItem.organizationId, orgId),
        inArray(sourceItem.id, itemIds),
        inArray(sourceItem.externalType, DOC_KINDS as never),
        notDecorativeSql,
      ),
    )
    .orderBy(desc(sql`coalesce(${sourceItem.sourceCreatedAt}, ${sourceItem.createdAt})`))
  const q = (opts.q ?? "").trim().toLowerCase()
  const providers = [...new Set(items.map((r) => r.provider))].sort()
  const filtered = items.filter(({ i, provider }) => {
    if (opts.provider && provider !== opts.provider) return false
    const bucket = documentTypeBucket(i.fileMime ?? i.mimeType, i.filename)
    if (opts.type && bucket !== opts.type) return false
    if (q) {
      const summary = typeof (i.metadataJson as Record<string, unknown> | null)?.summary === "string" ? ((i.metadataJson as Record<string, unknown>).summary as string) : ""
      if (!`${i.filename ?? ""} ${summary}`.toLowerCase().includes(q)) return false
    }
    return true
  })
  const total = filtered.length
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 100)
  const offset = Math.max(opts.offset ?? 0, 0)
  const page = filtered.slice(offset, offset + limit)
  const pageIds = page.map(({ i }) => i.id)
  if (pageIds.length === 0) return { documents: [], total, providers }

  const [links, parents, uploaders] = await Promise.all([
    db
      .select()
      .from(documentLink)
      .where(and(eq(documentLink.organizationId, orgId), inArray(documentLink.sourceItemId, pageIds), isNull(documentLink.removedAt))),
    (() => {
      const pids = [...new Set(page.map(({ i }) => i.parentSourceItemId).filter((x): x is string => !!x))]
      return pids.length
        ? db.select({ id: sourceItem.id, meta: sourceItem.metadataJson, kind: sourceItem.externalType }).from(sourceItem).where(inArray(sourceItem.id, pids))
        : Promise.resolve([] as { id: string; meta: unknown; kind: string }[])
    })(),
    (() => {
      const uids = [
        ...new Set(
          page
            .map(({ i }) => (i.metadataJson as { uploadedBy?: unknown } | null)?.uploadedBy)
            .filter((x): x is string => typeof x === "string"),
        ),
      ]
      return uids.length ? db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, uids)) : Promise.resolve([] as { id: string; name: string }[])
    })(),
  ])
  const labels = await entityLabels(
    orgId,
    links.map((l) => ({ entityType: l.entityType as DocumentEntityType, entityId: l.entityId })),
  )
  const parentById = new Map(parents.map((p) => [p.id, p]))
  const uploaderName = new Map(uploaders.map((u) => [u.id, u.name]))

  const documents: DocumentView[] = page.map(({ i, provider, sourceName }) => {
    const meta = (i.metadataJson ?? {}) as Record<string, unknown>
    const bucket = documentTypeBucket(i.fileMime ?? i.mimeType, i.filename)
    const parent = i.parentSourceItemId ? parentById.get(i.parentSourceItemId) : undefined
    const pm = (parent?.meta ?? {}) as Record<string, unknown>
    const uploadedBy = typeof meta.uploadedBy === "string" ? meta.uploadedBy : null
    let sourceLabel = sourceName
    if (uploadedBy) sourceLabel = `Загружен: ${uploaderName.get(uploadedBy) ?? "пользователь"}`
    else if (parent && typeof pm.subject === "string") {
      const from = emailsOf(pm.from)[0]
      sourceLabel = `Письмо «${pm.subject}»${from ? ` от ${from}` : ""}`
    } else if (provider === "gdrive") sourceLabel = "Google Drive"
    const itemLinks: DocumentLinkView[] = links
      .filter((l) => l.sourceItemId === i.id)
      .map((l) => ({
        id: l.id,
        entityType: l.entityType as DocumentEntityType,
        entityId: l.entityId,
        entityLabel: labels.get(`${l.entityType}:${l.entityId}`) ?? "—",
        origin: l.origin as LinkOrigin,
        confidence: l.confidence as LinkConfidence,
        reason: l.reason,
      }))
      .filter((l) => l.entityLabel !== "—")
    const fileStatus = (i.fileStatus as FileStatus | null) ?? null
    const providerRefetch =
      provider === "nylas" || provider === "gchat" || provider === "gdrive" || provider === "imap" || provider === "telegram"
    return {
      id: i.id,
      name: i.filename ?? "Без названия",
      mime: i.fileMime ?? i.mimeType,
      bucket,
      sizeBytes: i.fileSizeBytes ?? i.sizeBytes ?? null,
      fileStatus,
      downloadable: fileStatus === "stored" || (fileStatus !== "too_large" && providerRefetch && i.externalType !== "derived_audio"),
      date: (i.sourceCreatedAt ?? i.createdAt).toISOString(),
      provider,
      sourceLabel,
      parseStatus: i.parseStatus,
      summary: typeof meta.summary === "string" && meta.summary.trim() ? meta.summary : null,
      hasText: i.parseStatus === "complete" && (!!i.markdownR2Key || !!i.parsedMarkdown),
      skipReason: documentSkipReason(i.parseStatus, i.parseError),
      links: itemLinks,
      viaLinkId: directLink.get(i.id) ?? null,
      canDelete: !!uploadedBy && i.externalType === "dropoff_file" && (uploadedBy === viewer.userId || viewer.isOwner),
    }
  })
  return { documents, total, providers }
}

// ── Links (manual) ────────────────────────────────────────────────────────

export async function addDocumentLink(
  orgId: string,
  userId: string,
  itemId: string,
  entityType: DocumentEntityType,
  entityId: string,
): Promise<void> {
  await loadDocItem(orgId, itemId)
  await assertEntityInOrg(orgId, entityType, entityId)
  // A removed link comes back as a manual one.
  await db
    .insert(documentLink)
    .values({
      id: randomUUID(),
      organizationId: orgId,
      sourceItemId: itemId,
      entityType,
      entityId,
      origin: "manual",
      confidence: "high",
      reason: null,
      createdByUserId: userId,
    })
    .onConflictDoUpdate({
      target: [documentLink.sourceItemId, documentLink.entityType, documentLink.entityId],
      set: { removedAt: null, removedByUserId: null, origin: "manual", confidence: "high", reason: null, createdByUserId: userId },
    })
}

async function loadLink(orgId: string, linkId: string) {
  const [l] = await db
    .select()
    .from(documentLink)
    .where(and(eq(documentLink.organizationId, orgId), eq(documentLink.id, linkId)))
  if (!l) throw new DocumentError("Связь не найдена", 404)
  return l
}

/** «Отвязать»: keeps the row (`removed_at`) so the automatic step never re-adds it (Q3). */
export async function removeDocumentLink(orgId: string, userId: string, linkId: string): Promise<void> {
  await loadLink(orgId, linkId)
  await db
    .update(documentLink)
    .set({ removedAt: new Date(), removedByUserId: userId })
    .where(and(eq(documentLink.organizationId, orgId), eq(documentLink.id, linkId)))
}

/** «Подтвердить» an automatic link: confidence → high (origin unchanged). */
export async function confirmDocumentLink(orgId: string, linkId: string): Promise<void> {
  await loadLink(orgId, linkId)
  await db
    .update(documentLink)
    .set({ confidence: "high" })
    .where(and(eq(documentLink.organizationId, orgId), eq(documentLink.id, linkId)))
}

// ── Upload (§5) ───────────────────────────────────────────────────────────

export type UploadFile = { name: string; mime: string; bytes: Uint8Array }
export type UploadResult = { name: string; ok: boolean; itemId?: string; duplicate?: boolean; error?: string }

/**
 * Upload files into an entity view (any member). Each file: ≤ 50 MB; an
 * identical file already in the org (sha256) is LINKED instead of stored
 * again; else a `dropoff_file` item of the org's «Files Drop Off» source
 * (`metadata_json.uploadedFor` / `uploadedBy`), the bytes, an `upload` link,
 * then — after the response — parse + upload of the markdown + automatic
 * links.
 */
export async function uploadDocuments(
  orgId: string,
  userId: string,
  entityType: DocumentEntityType,
  entityId: string,
  files: UploadFile[],
): Promise<UploadResult[]> {
  if (files.length === 0) throw new DocumentError("Нет файлов")
  if (files.length > DOCUMENT_UPLOAD_MAX_FILES) throw new DocumentError(`Не больше ${DOCUMENT_UPLOAD_MAX_FILES} файлов за раз`)
  await assertEntityInOrg(orgId, entityType, entityId)
  const dropoff = await findActiveOrgSourceByProvider("dropoff", orgId)
  if (!dropoff) throw new DocumentError("У организации нет источника «Files Drop Off» — обратитесь к администратору", 409)
  const results: UploadResult[] = []
  const toProcess: string[] = []
  for (const f of files) {
    if (f.bytes.byteLength > DOCUMENT_MAX_BYTES) {
      results.push({ name: f.name, ok: false, error: "Файл больше 50 МБ" })
      continue
    }
    if (f.bytes.byteLength === 0) {
      results.push({ name: f.name, ok: false, error: "Пустой файл" })
      continue
    }
    const sha = createHash("sha256").update(f.bytes).digest("hex")
    const [dup] = await db
      .select({ id: sourceItem.id })
      .from(sourceItem)
      .where(and(eq(sourceItem.organizationId, orgId), eq(sourceItem.fileSha256, sha), eq(sourceItem.fileStatus, "stored")))
      .limit(1)
    if (dup) {
      await addDocumentLink(orgId, userId, dup.id, entityType, entityId)
      results.push({ name: f.name, ok: true, itemId: dup.id, duplicate: true })
      continue
    }
    const id = randomUUID()
    const now = new Date()
    await db.batch(
      asBatch([
        db.insert(sourceItem).values({
          id,
          sourceId: dropoff.id,
          organizationId: orgId,
          externalId: `dropoff:${id}`,
          externalType: "dropoff_file",
          filename: f.name,
          mimeType: f.mime || "application/octet-stream",
          sizeBytes: f.bytes.byteLength,
          sourceCreatedAt: now,
          parseStatus: "pending",
          metadataJson: { provider: "dropoff", uploadedFor: { entityType, entityId }, uploadedBy: userId },
        }),
        db.insert(documentLink).values({
          id: randomUUID(),
          organizationId: orgId,
          sourceItemId: id,
          entityType,
          entityId,
          origin: "upload",
          confidence: "high",
          createdByUserId: userId,
        }),
      ]),
    )
    const status = await storeDocumentFile(orgId, id, f.bytes, { name: f.name, mime: f.mime })
    if (status !== "stored") {
      results.push({ name: f.name, ok: false, itemId: id, error: "Не удалось сохранить файл" })
      continue
    }
    results.push({ name: f.name, ok: true, itemId: id })
    toProcess.push(id)
  }
  if (toProcess.length) {
    after(async () => {
      const { processSourceItem } = await import("@/server/process-source-item")
      for (const id of toProcess) {
        try {
          await processSourceItem(id, { userId })
          await computeAutoLinks(orgId, id)
        } catch (e) {
          console.error(`[documents] post-upload processing failed for ${id}:`, e)
        }
      }
    })
  }
  return results
}

// ── Delete (uploads only, Q8) ─────────────────────────────────────────────

export async function deleteDocument(orgId: string, userId: string, isOwner: boolean, itemId: string): Promise<void> {
  const i = await loadDocItem(orgId, itemId)
  const uploadedBy = (i.metadataJson as { uploadedBy?: unknown } | null)?.uploadedBy
  if (i.externalType !== "dropoff_file" || typeof uploadedBy !== "string") {
    throw new DocumentError("Файл из источника удалить здесь нельзя — его можно только отвязать", 409)
  }
  if (uploadedBy !== userId && !isOwner) throw new DocumentError("Удалить файл может тот, кто его загрузил, или владелец организации", 403)
  const keys = [i.fileKey, i.markdownR2Key].filter((k): k is string => !!k)
  if (keys.length) await deleteObjects(keys)
  await db.delete(sourceItem).where(and(eq(sourceItem.organizationId, orgId), eq(sourceItem.id, itemId)))
}

// ── File route (§6) ───────────────────────────────────────────────────────

export type DocumentFile = { bytes: Uint8Array; contentType: string; contentDisposition: string }

/**
 * Bytes of a document for «Открыть» / «Скачать». From storage; when not
 * stored yet, a lazy re-fetch from the provider (./documents-ingest) stores
 * them first. Throws 404 / 409 with a Russian message.
 */
export async function readDocumentFile(orgId: string, itemId: string, disposition: "inline" | "attachment"): Promise<DocumentFile> {
  let i = await loadDocItem(orgId, itemId)
  if (i.fileStatus === "too_large") throw new DocumentError("Файл больше 50 МБ — он не сохранён", 409)
  if (i.fileStatus !== "stored" || !i.fileKey) {
    const { storeOriginalForItem } = await import("@/server/documents-ingest")
    const status = await storeOriginalForItem(orgId, itemId)
    if (status !== "stored") throw new DocumentError("Файл недоступен — оригинал не сохранён", 409)
    i = await loadDocItem(orgId, itemId)
  }
  const obj = i.fileKey ? await getObject(i.fileKey) : null
  if (!obj) throw new DocumentError("Файл недоступен — оригинал не найден в хранилище", 409)
  const contentType = i.fileMime ?? obj.contentType ?? "application/octet-stream"
  // Only safe types inline (no HTML / SVG script from our origin).
  const effective = disposition === "inline" && isInlineSafeMime(contentType) ? "inline" : "attachment"
  return {
    bytes: obj.bytes,
    contentType,
    contentDisposition: contentDisposition(downloadFileName(i.filename, contentType), effective),
  }
}

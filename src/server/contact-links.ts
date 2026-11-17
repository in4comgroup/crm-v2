import "server-only"

import { randomUUID } from "node:crypto"
import { and, desc, eq, gt, inArray, isNull, lte, ne, notInArray, or, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import {
  cardContact,
  client,
  contact,
  contactAddress,
  contactCompanyLink,
  contactLinkEvent,
  contactLinkProposal,
  deal,
  dealActivity,
  member,
  dealContact,
  documentLink,
  sourceItem,
  sourceItemSubject,
  task,
  topic,
  user,
} from "@/db/schema"
import {
  DECISION_LABELS,
  LINK_RELATION_LABELS as LINK_RELATION_LABELS_RU,
  MOVED_BADGE_DAYS,
  PARALLEL_ACTIVITY_DAYS,
  PROPOSAL_RULE_LABELS,
  PROPOSAL_SNOOZE_DAYS,
  currentClientIds,
  effectiveLinks,
  evaluateItemRules,
  isAddressKind,
  isLinkRelation,
  linkEventText,
  normalizeAddress,
  planDecision,
  type AddressKind,
  type ClientContactLinkEntry,
  type ClientContactLinksResponse,
  type ContactAddressView,
  type ContactLinkAction,
  type ContactLinksResponse,
  type EffectiveLink,
  type LinkOp,
  type LinkRelation,
  type LinkRow,
  type ProposalDecisionBody,
  type ProposalDraft,
  type ProposalKind,
  type ProposalRule,
  type ProposalView,
  type RuleContact,
  type RuleIndex,
  type RuleItem,
} from "@/lib/contact-links"
import { extractEmailDomain, extractWebsiteDomain } from "@/lib/email-domain"
import { isFreemailDomain } from "@/lib/ru-mail"
import { companyMatchKey, personMatchKey } from "@/lib/translit-ru"

// Contact ↔ company links over time (docs/specs/clients-contacts/04). The ONE
// write path of `contact_company_link` + `contact.client_id` (= the primary
// current link), addresses, proposals, decisions and merge. Org-explicit,
// `server-only`; routes check the session and pass the org from it.
//
// No backfill (Q12): `effectiveLinks` adds an implicit current primary link
// for a `client_id` without a row; a change that touches it materialises it
// first (source `implicit`).

type BatchOps = Parameters<typeof db.batch>[0]
const asBatch = (ops: unknown[]) => ops as unknown as BatchOps

const LIVE_CONTACT = ["active", "initial", "suspended"] as const

export class ContactLinkError extends Error {
  constructor(
    public code: "not_found" | "invalid",
    message: string,
  ) {
    super(message)
    this.name = "ContactLinkError"
  }
}

// ── Loaders ────────────────────────────────────────────────────────────────

type ContactRec = typeof contact.$inferSelect

async function loadContact(orgId: string, contactId: string): Promise<ContactRec> {
  const [c] = await db
    .select()
    .from(contact)
    .where(and(eq(contact.id, contactId), eq(contact.organizationId, orgId)))
  if (!c) throw new ContactLinkError("not_found", "Контакт не найден")
  return c
}

async function assertClient(orgId: string, clientId: string): Promise<{ id: string; name: string }> {
  const [c] = await db
    .select({ id: client.id, name: client.name })
    .from(client)
    .where(and(eq(client.id, clientId), eq(client.organizationId, orgId)))
  if (!c) throw new ContactLinkError("not_found", "Компания не найдена")
  return c
}

async function loadLinkRows(contactIds: readonly string[]): Promise<(LinkRow & { contactId: string })[]> {
  if (contactIds.length === 0) return []
  return db
    .select({
      id: contactCompanyLink.id,
      contactId: contactCompanyLink.contactId,
      clientId: contactCompanyLink.clientId,
      relation: contactCompanyLink.relation,
      status: contactCompanyLink.status,
      isPrimary: contactCompanyLink.isPrimary,
      position: contactCompanyLink.position,
      startedAt: contactCompanyLink.startedAt,
      endedAt: contactCompanyLink.endedAt,
      source: contactCompanyLink.source,
      endReason: contactCompanyLink.endReason,
      evidenceSourceItemId: contactCompanyLink.evidenceSourceItemId,
      createdAt: contactCompanyLink.createdAt,
    })
    .from(contactCompanyLink)
    .where(inArray(contactCompanyLink.contactId, [...contactIds]))
}

async function clientNames(ids: Iterable<string>): Promise<Map<string, { name: string; status: string }>> {
  const list = [...new Set([...ids].filter(Boolean))]
  if (list.length === 0) return new Map()
  const rows = await db.select({ id: client.id, name: client.name, status: client.status }).from(client).where(inArray(client.id, list))
  return new Map(rows.map((r) => [r.id, { name: r.name, status: r.status }]))
}

function eventRow(orgId: string, contactId: string, kind: string, payload: Record<string, unknown>, userId: string | null) {
  return db.insert(contactLinkEvent).values({ id: randomUUID(), organizationId: orgId, contactId, kind, payload, userId })
}

// ── Read: contact view ─────────────────────────────────────────────────────

export async function getContactLinksView(orgId: string, contactId: string): Promise<ContactLinksResponse> {
  const c = await loadContact(orgId, contactId)
  const [rows, addrs, events] = await Promise.all([
    loadLinkRows([c.id]),
    db.select().from(contactAddress).where(eq(contactAddress.contactId, c.id)).orderBy(contactAddress.createdAt),
    db
      .select({ id: contactLinkEvent.id, kind: contactLinkEvent.kind, payload: contactLinkEvent.payload, userName: user.name, createdAt: contactLinkEvent.createdAt })
      .from(contactLinkEvent)
      .leftJoin(user, eq(user.id, contactLinkEvent.userId))
      .where(eq(contactLinkEvent.contactId, c.id))
      .orderBy(desc(contactLinkEvent.createdAt))
      .limit(30),
  ])
  const links = effectiveLinks(c, rows)
  const names = await clientNames([...links.map((l) => l.clientId), ...addrs.map((a) => a.clientId ?? "")])
  const proposals = await listProposals(orgId, { contactId: c.id })
  const formerIds = links.filter((l) => l.status === "former").map((l) => l.clientId)
  const openDeals = await openDealsWithContact(orgId, c.id, formerIds)

  let movedFrom: ContactLinksResponse["movedFrom"] = null
  const cutoff = Date.now() - MOVED_BADGE_DAYS * 86_400_000
  for (const l of links) {
    if (l.status !== "former" || !l.endedAt || !l.endReason?.startsWith("Перешёл")) continue
    if (new Date(l.endedAt).getTime() < cutoff) continue
    if (!movedFrom || l.endedAt > movedFrom.at) movedFrom = { clientId: l.clientId, clientName: names.get(l.clientId)?.name ?? "—", at: l.endedAt }
  }

  return {
    contactId: c.id,
    contactName: c.name,
    links: links.map((l) => ({
      ...l,
      clientName: names.get(l.clientId)?.name ?? "—",
      clientStatus: names.get(l.clientId)?.status ?? null,
      ...(l.status === "former" ? { openDeals: openDeals.get(l.clientId) ?? [] } : {}),
    })),
    addresses: addrs.map(
      (a): ContactAddressView => ({
        id: a.id,
        kind: (isAddressKind(a.kind) ? a.kind : "email") as AddressKind,
        value: a.value,
        status: a.status === "old" ? "old" : "active",
        clientId: a.clientId,
        clientName: a.clientId ? (names.get(a.clientId)?.name ?? null) : null,
        source: a.source,
        ...(a.kind === "telegram" ? { telegramId: a.externalId ?? null, verified: !!a.verifiedAt } : {}),
      }),
    ),
    proposals,
    events: events.map((e) => ({
      id: e.id,
      kind: e.kind,
      text: linkEventText(e.kind, (e.payload ?? {}) as Record<string, unknown>),
      userName: e.userName,
      createdAt: e.createdAt.toISOString(),
    })),
    movedFrom,
  }
}

// ── Read: company view ─────────────────────────────────────────────────────

export async function getClientContactLinks(orgId: string, clientId: string): Promise<ClientContactLinksResponse> {
  await assertClient(orgId, clientId)
  const [primaryContacts, linkRows] = await Promise.all([
    db
      .select({ id: contact.id })
      .from(contact)
      .where(and(eq(contact.organizationId, orgId), eq(contact.clientId, clientId), inArray(contact.status, [...LIVE_CONTACT]))),
    db
      .select({ contactId: contactCompanyLink.contactId })
      .from(contactCompanyLink)
      .where(and(eq(contactCompanyLink.organizationId, orgId), eq(contactCompanyLink.clientId, clientId))),
  ])
  const ids = [...new Set([...primaryContacts.map((r) => r.id), ...linkRows.map((r) => r.contactId)])]
  const contacts = ids.length
    ? await db
        .select()
        .from(contact)
        .where(and(inArray(contact.id, ids), inArray(contact.status, [...LIVE_CONTACT])))
    : []
  const rows = await loadLinkRows(contacts.map((c) => c.id))
  const rowsBy = new Map<string, LinkRow[]>()
  for (const r of rows) rowsBy.set(r.contactId, [...(rowsBy.get(r.contactId) ?? []), r])
  const perContact = contacts.map((c) => ({ c, links: effectiveLinks(c, rowsBy.get(c.id) ?? []) }))
  const names = await clientNames(perContact.flatMap((p) => p.links.map((l) => l.clientId)))

  const current: ClientContactLinkEntry[] = []
  const former: ClientContactLinkEntry[] = []
  for (const { c, links } of perContact) {
    const here = links.filter((l) => l.clientId === clientId)
    const cur = here.find((l) => l.status === "current")
    const elsewhere = links
      .filter((l) => l.status === "current" && l.clientId !== clientId)
      .map((l) => ({ clientId: l.clientId, clientName: names.get(l.clientId)?.name ?? "—", relation: l.relation }))
    const base = { contactId: c.id, name: c.name, email: c.email, elsewhere }
    if (cur) {
      current.push({
        ...base,
        position: cur.position ?? c.position,
        relation: cur.relation,
        isPrimary: cur.isPrimary,
        startedAt: cur.startedAt,
        endedAt: null,
        endReason: null,
      })
    } else {
      const last = here.filter((l) => l.status === "former").sort((a, b) => (b.endedAt ?? "").localeCompare(a.endedAt ?? ""))[0]
      if (last)
        former.push({
          ...base,
          position: last.position,
          relation: last.relation,
          isPrimary: false,
          startedAt: last.startedAt,
          endedAt: last.endedAt,
          endReason: last.endReason,
        })
    }
  }
  current.sort((a, b) => a.name.localeCompare(b.name, "ru"))
  former.sort((a, b) => (b.endedAt ?? "").localeCompare(a.endedAt ?? ""))
  const proposals = await listProposals(orgId, { clientId })
  return { current, former, proposals }
}

// ── Read: proposals ────────────────────────────────────────────────────────

async function listProposals(orgId: string, by: { contactId?: string; clientId?: string; ids?: string[] }): Promise<ProposalView[]> {
  const now = new Date()
  const conds = [
    eq(contactLinkProposal.organizationId, orgId),
    eq(contactLinkProposal.status, "pending"),
    or(isNull(contactLinkProposal.snoozedUntil), lte(contactLinkProposal.snoozedUntil, now))!,
  ]
  if (by.contactId)
    conds.push(or(eq(contactLinkProposal.contactId, by.contactId), eq(contactLinkProposal.candidateContactId, by.contactId))!)
  if (by.clientId)
    conds.push(or(eq(contactLinkProposal.fromClientId, by.clientId), eq(contactLinkProposal.toClientId, by.clientId))!)
  if (by.ids) conds.push(inArray(contactLinkProposal.id, by.ids.length ? by.ids : ["-"]))
  const rows = await db
    .select()
    .from(contactLinkProposal)
    .where(and(...conds))
    .orderBy(desc(contactLinkProposal.createdAt))
    .limit(20)
  if (rows.length === 0) return []
  const contactIds = new Set<string>()
  const itemIds = new Set<string>()
  for (const r of rows) {
    contactIds.add(r.contactId)
    if (r.candidateContactId) contactIds.add(r.candidateContactId)
    for (const id of ((r.evidence as { sourceItemIds?: string[] })?.sourceItemIds ?? []).slice(0, 3)) itemIds.add(id)
  }
  const [contacts, items, names] = await Promise.all([
    db.select({ id: contact.id, name: contact.name, status: contact.status }).from(contact).where(inArray(contact.id, [...contactIds])),
    itemIds.size
      ? db
          .select({ id: sourceItem.id, meta: sourceItem.metadataJson, filename: sourceItem.filename, at: sourceItem.sourceCreatedAt })
          .from(sourceItem)
          .where(and(eq(sourceItem.organizationId, orgId), inArray(sourceItem.id, [...itemIds])))
      : Promise.resolve([]),
    clientNames(rows.flatMap((r) => [r.fromClientId ?? "", r.toClientId ?? ""])),
  ])
  const cName = new Map(contacts.map((c) => [c.id, c]))
  const itemBy = new Map(items.map((i) => [i.id, i]))
  return rows
    .filter((r) => cName.get(r.contactId)?.status !== "deleted")
    .map((r) => {
      const ev = (r.evidence ?? {}) as { sourceItemIds?: string[]; quote?: string | null }
      return {
        id: r.id,
        contactId: r.contactId,
        contactName: cName.get(r.contactId)?.name ?? "—",
        candidateContactId: r.candidateContactId,
        candidateContactName: r.candidateContactId ? (cName.get(r.candidateContactId)?.name ?? null) : null,
        fromClientId: r.fromClientId,
        fromClientName: r.fromClientId ? (names.get(r.fromClientId)?.name ?? null) : null,
        toClientId: r.toClientId,
        toClientName: r.toClientId ? (names.get(r.toClientId)?.name ?? null) : null,
        toCompanyName: r.toCompanyName,
        newAddressKind: isAddressKind(r.newAddressKind) ? r.newAddressKind : null,
        newAddress: r.newAddress,
        kind: r.kind as ProposalKind,
        confidence: r.confidence,
        rule: r.rule as ProposalRule,
        ruleLabel: PROPOSAL_RULE_LABELS[r.rule as ProposalRule] ?? r.rule,
        quote: ev.quote ?? null,
        evidenceAt: r.evidenceAt?.toISOString() ?? null,
        evidenceItems: (ev.sourceItemIds ?? [])
          .map((id) => itemBy.get(id))
          .filter((i): i is NonNullable<typeof i> => !!i)
          .map((i) => {
            const m = (i.meta ?? {}) as { subject?: unknown }
            return {
              id: i.id,
              title: typeof m.subject === "string" && m.subject ? m.subject : i.filename,
              date: i.at?.toISOString() ?? null,
            }
          }),
        createdAt: r.createdAt.toISOString(),
      }
    })
}

// ── Write: link operations ─────────────────────────────────────────────────

type OpCtx = {
  orgId: string
  contact: ContactRec
  links: EffectiveLink[]
  userId: string | null
  source: string
  evidenceItemId?: string | null
}

/** Batch statements of a list of link ops + the new `contact.client_id`. */
function opsToStatements(ctx: OpCtx, ops: readonly LinkOp[], names: Map<string, { name: string }>): unknown[] {
  const stmts: unknown[] = []
  const now = new Date()
  const ev = (kind: string, payload: Record<string, unknown>) => stmts.push(eventRow(ctx.orgId, ctx.contact.id, kind, payload, ctx.userId))
  const materialized = new Map<string, string>() // clientId → new row id
  const nm = (id: string | null) => (id ? (names.get(id)?.name ?? "—") : "")
  for (const op of ops) {
    if (op.op === "materialize") {
      const id = randomUUID()
      materialized.set(op.clientId, id)
      stmts.push(
        db.insert(contactCompanyLink).values({
          id,
          organizationId: ctx.orgId,
          contactId: ctx.contact.id,
          clientId: op.clientId,
          relation: "employee",
          status: "current",
          isPrimary: true,
          position: op.position,
          startedAt: op.startedAt ? new Date(op.startedAt) : null,
          source: "implicit",
        }),
      )
    } else if (op.op === "end") {
      const id = op.linkId ?? materialized.get(op.clientId)
      if (!id) continue
      stmts.push(
        db
          .update(contactCompanyLink)
          .set({ status: "former", isPrimary: false, endedAt: new Date(op.endedAt), endReason: op.endReason, endedByUserId: ctx.userId, updatedAt: now })
          .where(eq(contactCompanyLink.id, id)),
      )
      ev("link_ended", { clientId: op.clientId, clientName: nm(op.clientId), endReason: op.endReason })
    } else if (op.op === "add") {
      stmts.push(
        db.insert(contactCompanyLink).values({
          id: randomUUID(),
          organizationId: ctx.orgId,
          contactId: ctx.contact.id,
          clientId: op.clientId,
          relation: op.relation,
          status: "current",
          isPrimary: false,
          startedAt: op.startedAt ? new Date(op.startedAt) : null,
          source: ctx.source,
          evidenceSourceItemId: ctx.evidenceItemId ?? null,
          createdByUserId: ctx.userId,
        }),
      )
      ev("link_added", { clientId: op.clientId, clientName: nm(op.clientId), relation: op.relation })
    } else if (op.op === "reopen") {
      stmts.push(
        db
          .update(contactCompanyLink)
          .set({ status: "current", relation: op.relation, endedAt: null, endReason: null, updatedAt: now })
          .where(eq(contactCompanyLink.id, op.linkId)),
      )
      const l = ctx.links.find((x) => x.id === op.linkId)
      ev("link_reopened", { clientId: l?.clientId ?? null, clientName: nm(l?.clientId ?? null) })
    } else if (op.op === "primary") {
      stmts.push(
        db
          .update(contactCompanyLink)
          .set({ isPrimary: sql`(${contactCompanyLink.clientId} = ${op.clientId ?? ""} AND ${contactCompanyLink.status} = 'current')` })
          .where(eq(contactCompanyLink.contactId, ctx.contact.id)),
      )
      stmts.push(db.update(contact).set({ clientId: op.clientId }).where(eq(contact.id, ctx.contact.id)))
      ev("primary_changed", { clientId: op.clientId, clientName: nm(op.clientId) })
    }
  }
  // An implicit primary that got a row keeps the row's `is_primary` in sync
  // even without a `primary` op (the batch order makes the update see it).
  if (materialized.size > 0 && !ops.some((o) => o.op === "primary")) {
    stmts.push(
      db
        .update(contactCompanyLink)
        .set({ isPrimary: sql`(${contactCompanyLink.clientId} = ${ctx.contact.clientId ?? ""} AND ${contactCompanyLink.status} = 'current')` })
        .where(eq(contactCompanyLink.contactId, ctx.contact.id)),
    )
  }
  return stmts
}

function parseDay(v: string | null | undefined, fallback: Date): string {
  if (!v) return fallback.toISOString()
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) throw new ContactLinkError("invalid", "Неверная дата")
  return d.toISOString()
}

/** Manual actions of the «Компании» block (POST /api/contacts/[id]/links). */
export async function applyLinkAction(orgId: string, contactId: string, action: ContactLinkAction, userId: string): Promise<void> {
  const c = await loadContact(orgId, contactId)
  if (c.status === "deleted") throw new ContactLinkError("invalid", "Контакт удалён")
  const rows = await loadLinkRows([c.id])
  const links = effectiveLinks(c, rows)
  const ctx: OpCtx = { orgId, contact: c, links, userId, source: "manual" }
  const now = new Date()

  if (action.action === "add") {
    const cl = await assertClient(orgId, action.clientId)
    if (links.some((l) => l.status === "current" && l.clientId === cl.id)) throw new ContactLinkError("invalid", "Контакт уже связан с этой компанией")
    const relation: LinkRelation = isLinkRelation(action.relation) ? action.relation : "employee"
    const ops: LinkOp[] = []
    const implicit = links.find((l) => l.implicit)
    if (implicit) ops.push({ op: "materialize", clientId: implicit.clientId, position: implicit.position, startedAt: implicit.startedAt })
    const former = links.find((l) => l.status === "former" && l.clientId === cl.id && l.id)
    if (former?.id) ops.push({ op: "reopen", linkId: former.id, relation })
    else ops.push({ op: "add", clientId: cl.id, relation, startedAt: action.startedAt ? parseDay(action.startedAt, now) : null })
    const hasPrimary = links.some((l) => l.isPrimary)
    if (action.primary || !hasPrimary) ops.push({ op: "primary", clientId: cl.id })
    const stmts = opsToStatements(ctx, ops, new Map([[cl.id, cl]]))
    if (action.position?.trim()) {
      // The new / reopened row gets the position (set after insert in the same batch).
      stmts.push(
        db
          .update(contactCompanyLink)
          .set({ position: action.position.trim() })
          .where(and(eq(contactCompanyLink.contactId, c.id), eq(contactCompanyLink.clientId, cl.id), eq(contactCompanyLink.status, "current"))),
      )
    }
    await db.batch(asBatch(stmts))
    return
  }

  if (action.action === "end") {
    const cl = await assertClient(orgId, action.clientId)
    const cur = links.find((l) => l.status === "current" && l.clientId === cl.id)
    if (!cur) throw new ContactLinkError("invalid", "Контакт не связан с этой компанией")
    const ops: LinkOp[] = []
    if (cur.implicit) ops.push({ op: "materialize", clientId: cur.clientId, position: cur.position, startedAt: cur.startedAt })
    ops.push({ op: "end", linkId: cur.id, clientId: cl.id, endedAt: parseDay(action.endedAt, now), endReason: action.endReason?.trim() || "Больше не работает" })
    if (cur.isPrimary) {
      const next = links.find((l) => l.status === "current" && l.clientId !== cl.id)
      ops.push({ op: "primary", clientId: next?.clientId ?? null })
    }
    const names = await clientNames(links.map((l) => l.clientId))
    await db.batch(asBatch(opsToStatements(ctx, ops, names)))
    return
  }

  if (action.action === "primary") {
    const cur = links.find((l) => l.status === "current" && l.clientId === action.clientId)
    if (!cur) throw new ContactLinkError("invalid", "Сначала добавьте эту компанию")
    if (cur.isPrimary) return
    const ops: LinkOp[] = []
    const implicit = links.find((l) => l.implicit)
    if (implicit) ops.push({ op: "materialize", clientId: implicit.clientId, position: implicit.position, startedAt: implicit.startedAt })
    ops.push({ op: "primary", clientId: cur.clientId })
    const names = await clientNames(links.map((l) => l.clientId))
    await db.batch(asBatch(opsToStatements(ctx, ops, names)))
    return
  }

  if (action.action === "edit") {
    let row = rows.find((r) => r.id === action.linkId)
    const stmts: unknown[] = []
    if (!row && action.linkId === "implicit") {
      const implicit = links.find((l) => l.implicit)
      if (!implicit) throw new ContactLinkError("not_found", "Связь не найдена")
      const id = randomUUID()
      stmts.push(
        db.insert(contactCompanyLink).values({
          id,
          organizationId: orgId,
          contactId: c.id,
          clientId: implicit.clientId,
          relation: "employee",
          status: "current",
          isPrimary: true,
          position: implicit.position,
          startedAt: implicit.startedAt ? new Date(implicit.startedAt) : null,
          source: "implicit",
        }),
      )
      row = { id, clientId: implicit.clientId } as LinkRow & { contactId: string }
    }
    if (!row) throw new ContactLinkError("not_found", "Связь не найдена")
    const set: Partial<typeof contactCompanyLink.$inferInsert> = { updatedAt: now }
    if (action.relation !== undefined) {
      if (!isLinkRelation(action.relation)) throw new ContactLinkError("invalid", "Неизвестный тип связи")
      set.relation = action.relation
    }
    if (action.position !== undefined) set.position = action.position?.trim() || null
    if (action.startedAt !== undefined) set.startedAt = action.startedAt ? new Date(parseDay(action.startedAt, now)) : null
    if (action.endedAt !== undefined) set.endedAt = action.endedAt ? new Date(parseDay(action.endedAt, now)) : null
    stmts.push(db.update(contactCompanyLink).set(set).where(eq(contactCompanyLink.id, row.id)))
    const names = await clientNames([row.clientId])
    stmts.push(eventRow(orgId, c.id, "link_edited", { clientId: row.clientId, clientName: names.get(row.clientId)?.name ?? "" }, userId))
    await db.batch(asBatch(stmts))
    return
  }

  if (action.action === "addAddress") {
    if (!isAddressKind(action.kind)) throw new ContactLinkError("invalid", "Неизвестный тип адреса")
    const value = normalizeAddress(action.kind, action.value)
    if (!value) throw new ContactLinkError("invalid", "Неверный адрес")
    if (action.clientId) await assertClient(orgId, action.clientId)
    const [taken] = await db
      .select({ id: contactAddress.contactId })
      .from(contactAddress)
      .innerJoin(contact, eq(contact.id, contactAddress.contactId))
      .where(and(eq(contactAddress.organizationId, orgId), eq(contactAddress.kind, action.kind), eq(contactAddress.value, value), ne(contact.status, "deleted"), ne(contactAddress.contactId, c.id)))
      .limit(1)
    if (taken) throw new ContactLinkError("invalid", "Этот адрес уже есть у другого контакта — объедините записи")
    await db.batch(
      asBatch([
        db
          .insert(contactAddress)
          .values({ id: randomUUID(), organizationId: orgId, contactId: c.id, kind: action.kind, value, clientId: action.clientId ?? null, source: "manual", firstSeenAt: now })
          .onConflictDoNothing(),
        eventRow(orgId, c.id, "address_added", { value }, userId),
      ]),
    )
    return
  }

  if (action.action === "replaceInDeals") {
    const cl = await assertClient(orgId, action.clientId)
    let replacement: ContactRec | null = null
    if (action.replacementContactId) {
      replacement = await loadContact(orgId, action.replacementContactId)
      if (replacement.id === c.id || replacement.status === "deleted") throw new ContactLinkError("invalid", "Неверная замена")
    }
    const deals = (await openDealsWithContact(orgId, c.id, [cl.id])).get(cl.id) ?? []
    if (deals.length === 0) return
    const ids = deals.map((d) => d.id)
    const [roles, stages] = await Promise.all([
      db.select({ dealId: dealContact.dealId, role: dealContact.role }).from(dealContact).where(and(eq(dealContact.contactId, c.id), inArray(dealContact.dealId, ids))),
      db.select({ id: deal.id, stageId: deal.funnelStageId }).from(deal).where(inArray(deal.id, ids)),
    ])
    const stageOf = new Map(stages.map((s) => [s.id, s.stageId]))
    const note = replacement ? `Контакт ${c.name} заменён на ${replacement.name}` : `Контакт ${c.name} убран из сделки`
    const stmts: unknown[] = []
    for (const r of roles) {
      stmts.push(db.delete(dealContact).where(and(eq(dealContact.dealId, r.dealId), eq(dealContact.contactId, c.id))))
      if (replacement) stmts.push(db.insert(dealContact).values({ dealId: r.dealId, contactId: replacement.id, role: r.role }).onConflictDoNothing())
      const st = stageOf.get(r.dealId) ?? null
      stmts.push(db.insert(dealActivity).values({ id: randomUUID(), dealId: r.dealId, actor: "user", actorUserId: userId, fromStageId: st, toStageId: st, note }))
    }
    stmts.push(
      eventRow(orgId, c.id, "deals_replaced", { clientId: cl.id, clientName: cl.name, replacementName: replacement?.name ?? "", dealIds: roles.map((r) => r.dealId) }, userId),
    )
    await db.batch(asBatch(stmts))
    const { markDealStateDirty } = await import("@/server/deal-state")
    for (const r of roles) await markDealStateDirty(orgId, r.dealId, "deal contact replaced")
    return
  }

  if (action.action === "removeAddress" || action.action === "addressStatus") {
    const [a] = await db
      .select()
      .from(contactAddress)
      .where(and(eq(contactAddress.id, action.addressId), eq(contactAddress.contactId, c.id)))
    if (!a) throw new ContactLinkError("not_found", "Адрес не найден")
    if (action.action === "removeAddress") {
      await db.batch(asBatch([db.delete(contactAddress).where(eq(contactAddress.id, a.id)), eventRow(orgId, c.id, "address_removed", { value: a.value }, userId)]))
    } else {
      const status = action.status === "old" ? "old" : "active"
      await db.batch(
        asBatch([
          db.update(contactAddress).set({ status }).where(eq(contactAddress.id, a.id)),
          eventRow(orgId, c.id, "address_status", { value: a.value, status }, userId),
        ]),
      )
    }
    return
  }
  throw new ContactLinkError("invalid", "Неизвестное действие")
}

/**
 * The contact edit form changed `client_id` while the contact has link rows:
 * treated as a CORRECTION of the primary link (its company is replaced), not
 * as a move — moves go through the «Компании» block. Called by
 * `updateContact` BEFORE it writes the column. No rows → nothing (implicit).
 */
export async function onContactClientEdited(orgId: string, contactId: string, newClientId: string | null): Promise<void> {
  const [c] = await db.select().from(contact).where(and(eq(contact.id, contactId), eq(contact.organizationId, orgId)))
  if (!c || c.clientId === newClientId) return
  const rows = await loadLinkRows([c.id])
  if (rows.length === 0) return
  const primary = rows.find((r) => r.status === "current" && r.clientId === c.clientId)
  const stmts: unknown[] = []
  if (primary && newClientId) {
    const clash = rows.find((r) => r.clientId === newClientId && r.status === "current")
    if (clash) stmts.push(db.delete(contactCompanyLink).where(eq(contactCompanyLink.id, primary.id)))
    else stmts.push(db.update(contactCompanyLink).set({ clientId: newClientId, updatedAt: new Date() }).where(eq(contactCompanyLink.id, primary.id)))
  } else if (primary && !newClientId) {
    stmts.push(db.delete(contactCompanyLink).where(eq(contactCompanyLink.id, primary.id)))
  }
  stmts.push(
    db
      .update(contactCompanyLink)
      .set({ isPrimary: sql`(${contactCompanyLink.clientId} = ${newClientId ?? ""} AND ${contactCompanyLink.status} = 'current')` })
      .where(eq(contactCompanyLink.contactId, c.id)),
  )
  const names = await clientNames(newClientId ? [newClientId] : [])
  stmts.push(eventRow(orgId, c.id, "primary_changed", { clientId: newClientId, clientName: newClientId ? (names.get(newClientId)?.name ?? "") : "" }, null))
  await db.batch(asBatch(stmts))
}

/** Open (active / paused) deals of each company where the contact is a deal contact. */
async function openDealsWithContact(
  orgId: string,
  contactId: string,
  clientIds: readonly string[],
): Promise<Map<string, { id: string; name: string }[]>> {
  const out = new Map<string, { id: string; name: string }[]>()
  if (clientIds.length === 0) return out
  const rows = await db
    .select({ id: deal.id, name: deal.name, clientId: deal.clientId })
    .from(deal)
    .innerJoin(dealContact, eq(dealContact.dealId, deal.id))
    .where(
      and(
        eq(deal.organizationId, orgId),
        eq(dealContact.contactId, contactId),
        inArray(deal.clientId, [...clientIds]),
        inArray(deal.status, ["active", "paused"]),
      ),
    )
  for (const r of rows) if (r.clientId) out.set(r.clientId, [...(out.get(r.clientId) ?? []), { id: r.id, name: r.name }])
  return out
}

// ── Decisions ──────────────────────────────────────────────────────────────

export async function decideProposal(
  orgId: string,
  proposalId: string,
  body: ProposalDecisionBody,
  userId: string,
): Promise<{ contactId: string }> {
  const [p] = await db
    .select()
    .from(contactLinkProposal)
    .where(and(eq(contactLinkProposal.id, proposalId), eq(contactLinkProposal.organizationId, orgId)))
  if (!p) throw new ContactLinkError("not_found", "Предложение не найдено")
  if (p.status !== "pending") throw new ContactLinkError("invalid", "Предложение уже решено")
  const now = new Date()

  if (body.decision === "snooze") {
    await db
      .update(contactLinkProposal)
      .set({ snoozedUntil: new Date(now.getTime() + PROPOSAL_SNOOZE_DAYS * 86_400_000) })
      .where(eq(contactLinkProposal.id, p.id))
    return { contactId: p.contactId }
  }
  const decided = { status: "accepted", decision: body.decision, decidedByUserId: userId, decidedAt: now, snoozedUntil: null }
  const { resolveNotifications } = await import("@/server/notifications/engine")
  await resolveNotifications(orgId, `contact.link_proposal:${p.id}`)
  if (body.decision === "other_person") {
    await db.batch(
      asBatch([
        db.update(contactLinkProposal).set({ ...decided, status: "rejected" }).where(eq(contactLinkProposal.id, p.id)),
        eventRow(orgId, p.contactId, "proposal_decided", { proposalId: p.id, decision: "other_person", decisionLabel: DECISION_LABELS.other_person }, userId),
      ]),
    )
    return { contactId: p.contactId }
  }
  if (body.decision !== "moved" && body.decision !== "both") throw new ContactLinkError("invalid", "Неизвестное решение")

  // «Создать компанию Y»: Y unknown → a new client (status initial).
  let toClientId = p.toClientId
  if (!toClientId && body.createCompanyName?.trim()) {
    toClientId = randomUUID()
    const domain = p.newAddress && p.newAddressKind === "email" ? extractEmailDomain(p.newAddress) : ""
    await db.insert(client).values({
      id: toClientId,
      name: body.createCompanyName.trim(),
      webUrl: domain && !isFreemailDomain(domain) ? `https://${domain}` : null,
      status: "initial",
      userId,
      responsibleUserId: userId,
      organizationId: orgId,
    })
  }
  if (body.decision === "both" && !toClientId) throw new ContactLinkError("invalid", "Не указана вторая компания")

  const c = await loadContact(orgId, p.contactId)
  const links = effectiveLinks(c, await loadLinkRows([c.id]))
  const names = await clientNames([...links.map((l) => l.clientId), toClientId ?? "", p.fromClientId ?? ""])
  const at = (p.evidenceAt ?? now).toISOString()
  const ops = planDecision({
    links,
    decision: body.decision,
    fromClientId: p.fromClientId,
    toClientId,
    relation: isLinkRelation(body.relation) ? body.relation : null,
    primaryClientId: body.primaryClientId ?? null,
    at,
    toName: toClientId ? (names.get(toClientId)?.name ?? null) : null,
  })
  const evidenceItemId = ((p.evidence as { sourceItemIds?: string[] })?.sourceItemIds ?? [])[0] ?? null
  const ctx: OpCtx = { orgId, contact: c, links, userId, source: "proposal", evidenceItemId }
  const stmts = opsToStatements(ctx, ops, names)

  // Addresses: the new address → active at Y; on «moved» the X addresses → old,
  // and a new email becomes the contact's primary email.
  const newKind = isAddressKind(p.newAddressKind) ? p.newAddressKind : null
  if (body.decision === "moved" && p.fromClientId) {
    stmts.push(
      db
        .update(contactAddress)
        .set({ status: "old" })
        .where(and(eq(contactAddress.contactId, c.id), eq(contactAddress.clientId, p.fromClientId))),
    )
  }
  if (newKind === "email" && p.newAddress && body.decision === "moved" && c.email && c.email.toLowerCase() !== p.newAddress) {
    stmts.push(
      db
        .insert(contactAddress)
        .values({ id: randomUUID(), organizationId: orgId, contactId: c.id, kind: "email", value: c.email.toLowerCase(), status: "old", clientId: p.fromClientId, source: "proposal", lastSeenAt: now })
        .onConflictDoUpdate({ target: [contactAddress.contactId, contactAddress.kind, contactAddress.value], set: { status: "old" } }),
    )
    stmts.push(db.update(contact).set({ email: p.newAddress }).where(eq(contact.id, c.id)))
  } else if (newKind && p.newAddress && !p.candidateContactId) {
    stmts.push(
      db
        .insert(contactAddress)
        .values({ id: randomUUID(), organizationId: orgId, contactId: c.id, kind: newKind, value: p.newAddress, clientId: toClientId, source: "proposal", firstSeenAt: p.evidenceAt ?? now })
        .onConflictDoUpdate({ target: [contactAddress.contactId, contactAddress.kind, contactAddress.value], set: { status: "active", clientId: toClientId } }),
    )
  }
  stmts.push(db.update(contactLinkProposal).set({ ...decided, toClientId }).where(eq(contactLinkProposal.id, p.id)))
  stmts.push(
    eventRow(orgId, c.id, "proposal_decided", { proposalId: p.id, decision: body.decision, decisionLabel: DECISION_LABELS[body.decision], toClientId }, userId),
  )
  // Other pending proposals of this contact about the same move are superseded.
  stmts.push(
    db
      .update(contactLinkProposal)
      .set({ status: "superseded" })
      .where(
        and(
          eq(contactLinkProposal.contactId, c.id),
          eq(contactLinkProposal.status, "pending"),
          ne(contactLinkProposal.id, p.id),
          toClientId ? eq(contactLinkProposal.toClientId, toClientId) : isNull(contactLinkProposal.toClientId),
        ),
      ),
  )
  await db.batch(asBatch(stmts))

  // A second record of the same person → merged into the known contact.
  if (p.candidateContactId && p.candidateContactId !== c.id) {
    await mergeContacts(orgId, c.id, p.candidateContactId, userId)
  }
  if (body.decision === "moved") {
    await afterMoveEffects(orgId, c, p.fromClientId, toClientId, names, userId).catch((e) =>
      console.error("[contact-links] move effects failed", proposalId, e),
    )
  }
  return { contactId: c.id }
}

/** Deals of X: journal line + state dirty (risk check). Topic for Y (Q9, Q10). */
async function afterMoveEffects(
  orgId: string,
  c: ContactRec,
  fromClientId: string | null,
  toClientId: string | null,
  names: Map<string, { name: string }>,
  userId: string,
) {
  const yName = toClientId ? (names.get(toClientId)?.name ?? null) : null
  const xName = fromClientId ? (names.get(fromClientId)?.name ?? null) : null
  if (fromClientId) {
    const deals = await db
      .select({ id: deal.id, stageId: deal.funnelStageId })
      .from(deal)
      .innerJoin(dealContact, eq(dealContact.dealId, deal.id))
      .where(
        and(
          eq(deal.organizationId, orgId),
          eq(deal.clientId, fromClientId),
          eq(dealContact.contactId, c.id),
          inArray(deal.status, ["active", "paused"]),
        ),
      )
    if (deals.length > 0) {
      const note = yName ? `Контакт ${c.name} перешёл в ${yName}` : `Контакт ${c.name} больше не работает в компании`
      await db.batch(
        asBatch(
          deals.map((d) =>
            db.insert(dealActivity).values({ id: randomUUID(), dealId: d.id, actor: "user", actorUserId: userId, fromStageId: d.stageId, toStageId: d.stageId, note }),
          ),
        ),
      )
      const { markDealStateDirty } = await import("@/server/deal-state")
      for (const d of deals) await markDealStateDirty(orgId, d.id, "contact moved")
    }
  }
  if (toClientId) {
    const { openContactMovedTopic } = await import("@/server/topics/contact-moved")
    await openContactMovedTopic(orgId, { contactId: c.id, contactName: c.name, toClientId, toClientName: yName, fromClientName: xName })
  }
}

// ── Merge ──────────────────────────────────────────────────────────────────

/**
 * Merge `mergeId` into `keepId` (§3.3): addresses, company links, aliases,
 * deal contacts, tasks, topics, card / document links, proposals and custom
 * values (empty ones filled) move to the kept contact; the merged row →
 * `deleted` + `merged_into_contact_id`. One batch.
 */
export async function mergeContacts(orgId: string, keepId: string, mergeId: string, userId: string | null): Promise<void> {
  if (keepId === mergeId) throw new ContactLinkError("invalid", "Нельзя объединить контакт с самим собой")
  const [keep, merge] = await Promise.all([loadContact(orgId, keepId), loadContact(orgId, mergeId)])
  if (keep.status === "deleted" || merge.status === "deleted") throw new ContactLinkError("invalid", "Контакт удалён")
  const [keepRows, mergeRows, mergeAddrs, keepAddrs] = await Promise.all([
    loadLinkRows([keep.id]),
    loadLinkRows([merge.id]),
    db.select().from(contactAddress).where(eq(contactAddress.contactId, merge.id)),
    db.select().from(contactAddress).where(eq(contactAddress.contactId, keep.id)),
  ])
  const keepLinks = effectiveLinks(keep, keepRows)
  const mergeLinks = effectiveLinks(merge, mergeRows)
  const stmts: unknown[] = []
  const now = new Date()

  // Links.
  const keepCurrent = new Set(keepLinks.filter((l) => l.status === "current").map((l) => l.clientId))
  const implicitKeep = keepLinks.find((l) => l.implicit)
  if (implicitKeep && mergeLinks.length > 0) {
    stmts.push(
      db.insert(contactCompanyLink).values({
        id: randomUUID(),
        organizationId: orgId,
        contactId: keep.id,
        clientId: implicitKeep.clientId,
        relation: "employee",
        status: "current",
        isPrimary: true,
        position: implicitKeep.position,
        startedAt: implicitKeep.startedAt ? new Date(implicitKeep.startedAt) : null,
        source: "implicit",
      }),
    )
  }
  for (const l of mergeLinks) {
    if (l.status === "current" && keepCurrent.has(l.clientId)) {
      if (l.id) stmts.push(db.delete(contactCompanyLink).where(eq(contactCompanyLink.id, l.id)))
      continue
    }
    if (l.id) stmts.push(db.update(contactCompanyLink).set({ contactId: keep.id, isPrimary: false, updatedAt: now }).where(eq(contactCompanyLink.id, l.id)))
    else
      stmts.push(
        db.insert(contactCompanyLink).values({
          id: randomUUID(),
          organizationId: orgId,
          contactId: keep.id,
          clientId: l.clientId,
          relation: l.relation,
          status: l.status,
          isPrimary: false,
          position: l.position,
          startedAt: l.startedAt ? new Date(l.startedAt) : null,
          source: "merge",
        }),
      )
    if (l.status === "current") keepCurrent.add(l.clientId)
  }
  const newPrimary = keep.clientId ?? (mergeLinks.find((l) => l.status === "current")?.clientId ?? null)

  // Addresses: merge's primary email / phone + its address rows.
  const have = new Set(keepAddrs.map((a) => `${a.kind}:${a.value}`))
  if (keep.email) have.add(`email:${keep.email.toLowerCase()}`)
  if (keep.phone) have.add(`phone:${normalizeAddress("phone", keep.phone)}`)
  const addAddr = (kind: AddressKind, raw: string | null, status: string, clientId: string | null) => {
    const v = raw ? normalizeAddress(kind, raw) : ""
    if (!v || have.has(`${kind}:${v}`)) return
    have.add(`${kind}:${v}`)
    stmts.push(
      db.insert(contactAddress).values({ id: randomUUID(), organizationId: orgId, contactId: keep.id, kind, value: v, status, clientId, source: "merge", firstSeenAt: merge.createdAt }),
    )
  }
  let keepEmail = keep.email
  let keepPhone = keep.phone
  if (!keepEmail && merge.email) keepEmail = merge.email
  else addAddr("email", merge.email, "active", merge.clientId)
  if (!keepPhone && merge.phone) keepPhone = merge.phone
  else addAddr("phone", merge.phone, "active", merge.clientId)
  for (const a of mergeAddrs) if (isAddressKind(a.kind)) addAddr(a.kind, a.value, a.status, a.clientId)
  stmts.push(db.delete(contactAddress).where(eq(contactAddress.contactId, merge.id)))

  // Aliases + names.
  const aliases = new Map<string, string>()
  for (const a of [...(keep.aliases ?? []), merge.name, merge.nameNative ?? "", ...(merge.aliases ?? [])]) {
    const t = a?.trim()
    if (!t || t.toLowerCase() === keep.name.toLowerCase()) continue
    if (!aliases.has(t.toLowerCase())) aliases.set(t.toLowerCase(), t)
  }
  // Custom values: keep the kept contact's, fill empty ones.
  const values = { ...((merge.customValues ?? {}) as Record<string, unknown>), ...((keep.customValues ?? {}) as Record<string, unknown>) }
  for (const [k, v] of Object.entries((keep.customValues ?? {}) as Record<string, unknown>)) {
    if ((v === null || v === "" || (Array.isArray(v) && v.length === 0)) && (merge.customValues as Record<string, unknown>)?.[k] != null) {
      values[k] = (merge.customValues as Record<string, unknown>)[k]
    }
  }
  stmts.push(
    db
      .update(contact)
      .set({
        aliases: aliases.size ? [...aliases.values()] : null,
        email: keepEmail,
        phone: keepPhone,
        nameNative: keep.nameNative ?? merge.nameNative,
        position: keep.position ?? merge.position,
        clientId: newPrimary,
        customValues: values,
      })
      .where(eq(contact.id, keep.id)),
  )

  // References.
  stmts.push(
    db.execute(sql`INSERT INTO deal_contact (deal_id, contact_id, role)
      SELECT deal_id, ${keep.id}, role FROM deal_contact WHERE contact_id = ${merge.id}
      ON CONFLICT DO NOTHING`),
  )
  stmts.push(db.delete(dealContact).where(eq(dealContact.contactId, merge.id)))
  stmts.push(
    db.execute(sql`INSERT INTO card_contact (card_id, contact_id)
      SELECT card_id, ${keep.id} FROM card_contact WHERE contact_id = ${merge.id}
      ON CONFLICT DO NOTHING`),
  )
  stmts.push(db.delete(cardContact).where(eq(cardContact.contactId, merge.id)))
  stmts.push(db.update(task).set({ contactId: keep.id }).where(eq(task.contactId, merge.id)))
  stmts.push(db.update(topic).set({ contactId: keep.id }).where(and(eq(topic.organizationId, orgId), eq(topic.contactId, merge.id))))
  stmts.push(db.update(sourceItemSubject).set({ contactId: keep.id }).where(eq(sourceItemSubject.contactId, merge.id)))
  stmts.push(
    db.execute(sql`UPDATE document_link SET entity_id = ${keep.id}
      WHERE organization_id = ${orgId} AND entity_type = 'contact' AND entity_id = ${merge.id}
      AND NOT EXISTS (SELECT 1 FROM document_link d2 WHERE d2.source_item_id = document_link.source_item_id
        AND d2.entity_type = 'contact' AND d2.entity_id = ${keep.id})`),
  )
  stmts.push(db.delete(documentLink).where(and(eq(documentLink.organizationId, orgId), eq(documentLink.entityType, "contact"), eq(documentLink.entityId, merge.id))))
  // Proposals: about the pair → superseded; the rest move to the kept contact.
  stmts.push(
    db
      .update(contactLinkProposal)
      .set({ status: "superseded" })
      .where(
        and(
          eq(contactLinkProposal.status, "pending"),
          or(
            and(eq(contactLinkProposal.contactId, keep.id), eq(contactLinkProposal.candidateContactId, merge.id)),
            and(eq(contactLinkProposal.contactId, merge.id), eq(contactLinkProposal.candidateContactId, keep.id)),
          ),
        ),
      ),
  )
  stmts.push(db.update(contactLinkProposal).set({ contactId: keep.id }).where(eq(contactLinkProposal.contactId, merge.id)))
  stmts.push(db.update(contactLinkProposal).set({ candidateContactId: null }).where(eq(contactLinkProposal.candidateContactId, merge.id)))
  stmts.push(db.update(contactLinkEvent).set({ contactId: keep.id }).where(eq(contactLinkEvent.contactId, merge.id)))
  // The merged row.
  stmts.push(
    db
      .update(contact)
      .set({ status: "deleted", mergedIntoContactId: keep.id, clientId: null, email: null, phone: null })
      .where(eq(contact.id, merge.id)),
  )
  stmts.push(
    db
      .update(contactCompanyLink)
      .set({ isPrimary: sql`(${contactCompanyLink.clientId} = ${newPrimary ?? ""} AND ${contactCompanyLink.status} = 'current')` })
      .where(eq(contactCompanyLink.contactId, keep.id)),
  )
  stmts.push(eventRow(orgId, keep.id, "merged", { mergedId: merge.id, mergedName: merge.name }, userId))
  await db.batch(asBatch(stmts))
}

/** Follow `merged_into_contact_id` (≤ 5 hops) — old references → the kept contact. */
export async function resolveMergedContactId(orgId: string, contactId: string): Promise<string> {
  let id = contactId
  for (let i = 0; i < 5; i++) {
    const [r] = await db
      .select({ next: contact.mergedIntoContactId })
      .from(contact)
      .where(and(eq(contact.id, id), eq(contact.organizationId, orgId)))
    if (!r?.next) return id
    id = r.next
  }
  return id
}

// ── Indexes for matching (discovery, topics, rules) ────────────────────────

export type ContactAddressIndex = {
  /** contact id → extra addresses (lower-case emails / handles / phone digits). */
  addressesByContact: Map<string, { kind: AddressKind; value: string; clientId: string | null; status: string }[]>
  /** contact id → current client ids from link rows (WITHOUT the primary column). */
  currentLinkClients: Map<string, string[]>
}

/** Extra addresses + current link rows of the org's live contacts (one query each). */
export async function loadContactAddressIndex(orgId: string): Promise<ContactAddressIndex> {
  const [addrs, links] = await Promise.all([
    db
      .select({ contactId: contactAddress.contactId, kind: contactAddress.kind, value: contactAddress.value, clientId: contactAddress.clientId, status: contactAddress.status })
      .from(contactAddress)
      .where(eq(contactAddress.organizationId, orgId)),
    db
      .select({ contactId: contactCompanyLink.contactId, clientId: contactCompanyLink.clientId })
      .from(contactCompanyLink)
      .where(and(eq(contactCompanyLink.organizationId, orgId), eq(contactCompanyLink.status, "current"))),
  ])
  const idx: ContactAddressIndex = { addressesByContact: new Map(), currentLinkClients: new Map() }
  for (const a of addrs) {
    if (!isAddressKind(a.kind)) continue
    const list = idx.addressesByContact.get(a.contactId) ?? []
    list.push({ kind: a.kind, value: a.value, clientId: a.clientId, status: a.status })
    idx.addressesByContact.set(a.contactId, list)
  }
  for (const l of links) idx.currentLinkClients.set(l.contactId, [...(idx.currentLinkClients.get(l.contactId) ?? []), l.clientId])
  return idx
}

async function loadRuleIndex(orgId: string): Promise<RuleIndex> {
  const [clients, contacts, extra] = await Promise.all([
    db
      .select({ id: client.id, name: client.name, aliases: client.aliases, webUrl: client.webUrl, email: client.email })
      .from(client)
      .where(and(eq(client.organizationId, orgId), notInArray(client.status, ["deleted", "blocked"]))),
    db
      .select({ id: contact.id, name: contact.name, nameNative: contact.nameNative, aliases: contact.aliases, email: contact.email, phone: contact.phone, clientId: contact.clientId })
      .from(contact)
      .where(and(eq(contact.organizationId, orgId), notInArray(contact.status, ["deleted", "blocked"]))),
    loadContactAddressIndex(orgId),
  ])
  const add = (m: Map<string, Set<string>>, k: string, id: string) => {
    if (!k) return
    const s = m.get(k) ?? new Set<string>()
    s.add(id)
    m.set(k, s)
  }
  const idx: RuleIndex = {
    contacts: new Map(),
    contactsByEmail: new Map(),
    addressClient: new Map(),
    contactsByPersonKey: new Map(),
    clientsByDomain: new Map(),
    clientsByKey: new Map(),
    clientNames: new Map(clients.map((c) => [c.id, c.name])),
  }
  for (const c of clients) {
    for (const n of [c.name, ...(c.aliases ?? [])]) add(idx.clientsByKey, companyMatchKey(n), c.id)
    for (const d of [c.webUrl ? extractWebsiteDomain(c.webUrl) : "", c.email ? extractEmailDomain(c.email) : ""])
      if (d && !isFreemailDomain(d)) add(idx.clientsByDomain, d, c.id)
  }
  for (const p of contacts) {
    const clientIds = currentClientIds(p, (extra.currentLinkClients.get(p.id) ?? []).map((clientId) => ({ clientId, status: "current" })))
    const rc: RuleContact = { id: p.id, name: p.name, nameNative: p.nameNative, aliases: p.aliases, email: p.email, phone: p.phone, clientIds }
    idx.contacts.set(p.id, rc)
    if (p.email) {
      const e = p.email.trim().toLowerCase()
      add(idx.contactsByEmail, e, p.id)
      const d = extractEmailDomain(e)
      if (d && !isFreemailDomain(d) && p.clientId) add(idx.clientsByDomain, d, p.clientId)
    }
    for (const a of extra.addressesByContact.get(p.id) ?? []) {
      if (a.kind !== "email") continue
      add(idx.contactsByEmail, a.value, p.id)
      if (a.clientId) idx.addressClient.set(a.value, a.clientId)
    }
    for (const n of [p.name, p.nameNative ?? "", ...(p.aliases ?? [])]) {
      if (!n || n.trim().startsWith("@")) continue
      const k = personMatchKey(n)
      if (k.length >= 2) add(idx.contactsByPersonKey, k, p.id)
    }
  }
  return idx
}

// ── Recognition (P1–P4) after parse / extraction ───────────────────────────

type Addr = { email?: unknown; name?: unknown }

function participantsOf(meta: Record<string, unknown>): RuleItem["participants"] {
  const out: RuleItem["participants"] = []
  const seen = new Set<string>()
  const push = (raw: unknown, role: RuleItem["participants"][number]["role"]) => {
    const list = Array.isArray(raw) ? raw : raw ? [raw] : []
    for (const a of list as (Addr | string)[]) {
      const email = (typeof a === "string" ? a : typeof a?.email === "string" ? a.email : "").trim().toLowerCase()
      if (!email || !email.includes("@") || seen.has(email)) continue
      seen.add(email)
      out.push({ email, name: typeof a === "object" && typeof a?.name === "string" ? a.name : "", role })
    }
  }
  push(meta.from, "from")
  push(meta.to, "to")
  push(meta.cc, "cc")
  push(meta.participants, "other")
  return out
}

/**
 * Scan ONE parsed root item for link changes and write pending proposals
 * (idempotent: one row per pair key, ever). Called after parse (all orgs)
 * and after signal extraction (with the item's codes, for CONTACT_LEAVING).
 * Never throws.
 */
export async function scanItemForContactLinks(orgId: string, itemId: string, opts: { signalCodes?: string[] } = {}): Promise<number> {
  try {
    const [row] = await db
      .select({
        id: sourceItem.id,
        meta: sourceItem.metadataJson,
        parent: sourceItem.parentSourceItemId,
        attribution: sourceItem.orgAttribution,
        at: sourceItem.sourceCreatedAt,
        createdAt: sourceItem.createdAt,
      })
      .from(sourceItem)
      .where(and(eq(sourceItem.id, itemId), eq(sourceItem.organizationId, orgId)))
    if (!row || row.parent) return 0
    const meta = (row.meta ?? {}) as Record<string, unknown>
    const participants = participantsOf(meta)
    if (participants.length === 0) return 0
    const { getOwnOrgContext } = await import("@/server/identity/own-org")
    const own = await getOwnOrgContext(orgId)
    const isOwnEmail = (e: string) => own.matchEmail(e) !== null
    const from = participants.find((p) => p.role === "from") ?? null
    // Our own addresses are filtered out below; for our outbound mail the
    // recipients may still show a known person at a new address (P2).

    const { getSourceItemMarkdown } = await import("@/server/source-items")
    const { messageContent } = await import("@/server/topics/signals/evidence")
    const { splitQuotedHistory, detectBounce, detectOutOfOffice } = await import("@/lib/ru-mail")
    const markdown = await getSourceItemMarkdown(itemId, { requireOrganizationId: orgId }).catch(() => null)
    const content = markdown ? messageContent(markdown) : ""
    const own_text = content ? splitQuotedHistory(content).own || content : ""
    const subject = typeof meta.subject === "string" ? meta.subject : null
    const probe = { subject, from: from?.email ?? null, body: content, date: (row.at ?? row.createdAt).toISOString() }

    const details = new Map<string, { phone: string | null; nativeName: string | null }>()
    for (const d of Array.isArray(meta.participantDetails) ? (meta.participantDetails as Record<string, unknown>[]) : []) {
      const e = typeof d?.email === "string" ? d.email.toLowerCase() : ""
      if (e) details.set(e, { phone: typeof d.phone === "string" ? d.phone : null, nativeName: typeof d.nativeName === "string" ? d.nativeName : null })
    }
    const organizations: RuleItem["organizations"] = []
    for (const o of Array.isArray(meta.organizations) ? (meta.organizations as Record<string, unknown>[]) : []) {
      const name = typeof o?.name === "string" ? o.name : ""
      const web = typeof o?.webUrl === "string" ? o.webUrl : ""
      if (name) organizations.push({ key: companyMatchKey(name), domain: web ? extractWebsiteDomain(web) || null : null })
    }

    const item: RuleItem = {
      id: row.id,
      date: probe.date,
      fromEmail: from?.email ?? null,
      fromName: from?.name ?? null,
      participants: participants.filter((p) => !isOwnEmail(p.email)),
      text: own_text,
      signalCodes: opts.signalCodes ?? [],
      isBounce: detectBounce(probe).isBounce,
      isAutoReply: detectOutOfOffice(probe).isOoo,
      details,
      organizations,
    }
    const idx = await loadRuleIndex(orgId)
    const recentCache = new Map<string, boolean>()
    const pending: { contactId: string; clientId: string }[] = []
    // recentFromClient is sync for the pure rules → precompute lazily below.
    const drafts0 = evaluateItemRules(item, idx, {
      isOwnEmail,
      recentFromClient: (contactId, clientId) => {
        const k = `${contactId}:${clientId}`
        if (!recentCache.has(k)) pending.push({ contactId, clientId })
        return recentCache.get(k) ?? false
      },
    })
    let drafts = drafts0
    if (pending.length > 0) {
      for (const q of pending) recentCache.set(`${q.contactId}:${q.clientId}`, await wroteFromClientRecently(orgId, idx, q.contactId, q.clientId, row.id))
      drafts = evaluateItemRules(item, idx, { isOwnEmail, recentFromClient: (c, cl) => recentCache.get(`${c}:${cl}`) ?? false })
    }
    return await storeProposals(orgId, drafts, row.id, row.at ?? row.createdAt)
  } catch (e) {
    console.error("[contact-links] scan failed", orgId, itemId, e)
    return 0
  }
}

/** Did contact C write from an address of client X within 60 days (another item)? */
async function wroteFromClientRecently(orgId: string, idx: RuleIndex, contactId: string, clientId: string, exceptItemId: string): Promise<boolean> {
  const c = idx.contacts.get(contactId)
  if (!c) return false
  const emails = new Set<string>()
  if (c.email) emails.add(c.email.toLowerCase())
  for (const [e, ids] of idx.contactsByEmail) if (ids.has(contactId)) emails.add(e)
  const atX = [...emails].filter((e) => {
    const own = idx.addressClient.get(e)
    if (own) return own === clientId
    const d = extractEmailDomain(e)
    return !!d && (idx.clientsByDomain.get(d)?.has(clientId) ?? false)
  })
  if (atX.length === 0) return false
  const since = new Date(Date.now() - PARALLEL_ACTIVITY_DAYS * 86_400_000)
  const likes = atX.map((e) => sql`${sourceItem.metadataJson}::text ILIKE ${"%" + e + "%"}`)
  const [hit] = await db
    .select({ id: sourceItem.id })
    .from(sourceItem)
    .where(
      and(
        eq(sourceItem.organizationId, orgId),
        isNull(sourceItem.parentSourceItemId),
        ne(sourceItem.id, exceptItemId),
        gt(sql`coalesce(${sourceItem.sourceCreatedAt}, ${sourceItem.createdAt})`, since),
        or(...likes),
      ),
    )
    .limit(1)
  return !!hit
}

async function storeProposals(orgId: string, drafts: readonly ProposalDraft[], itemId: string | null, at: Date | null): Promise<number> {
  if (drafts.length === 0) return 0
  const rows = drafts.map((d) => ({
    id: randomUUID(),
    organizationId: orgId,
    contactId: d.contactId,
    candidateContactId: d.candidateContactId,
    fromClientId: d.fromClientId,
    toClientId: d.toClientId,
    newAddressKind: d.newAddressKind,
    newAddress: d.newAddress,
    toCompanyName: d.toCompanyName,
    kind: d.kind,
    confidence: d.confidence,
    rule: d.rule,
    evidence: { sourceItemIds: itemId ? [itemId] : [], quote: d.quote },
    evidenceAt: at,
    pairKey: d.pairKey,
  }))
  const inserted = await db.insert(contactLinkProposal).values(rows).onConflictDoNothing().returning({ id: contactLinkProposal.id })
  if (inserted.length > 0) await notifyProposals(orgId, inserted.map((r) => r.id))
  return inserted.length
}

/**
 * Notifications (docs/specs/notifications §4, Q5 / Q6 of spec 04): each new
 * «Контакт сменил компанию?» → the «Ответственный» of X and of Y; when
 * neither company has one, the org owners. Never throws.
 */
async function notifyProposals(orgId: string, ids: readonly string[]): Promise<void> {
  try {
    const { notify } = await import("@/server/notifications/engine")
    const views = await listProposals(orgId, { ids: [...ids] })
    const clientIds = [...new Set(views.flatMap((v) => [v.fromClientId ?? "", v.toClientId ?? ""]).filter(Boolean))]
    const resp = clientIds.length
      ? await db.select({ id: client.id, r: client.responsibleUserId }).from(client).where(inArray(client.id, clientIds))
      : []
    const respOf = new Map(resp.map((r) => [r.id, r.r]))
    let owners: string[] | null = null
    for (const v of views) {
      let userIds = [v.fromClientId, v.toClientId].map((id) => (id ? respOf.get(id) : null)).filter((x): x is string => !!x)
      if (userIds.length === 0) {
        owners ??= (
          await db.select({ id: member.userId }).from(member).where(and(eq(member.organizationId, orgId), eq(member.role, "owner")))
        ).map((m) => m.id)
        userIds = owners
      }
      const y = v.toClientName ?? v.toCompanyName
      await notify(orgId, {
        kind: "contact.link_proposal",
        userIds,
        title: `Контакт сменил компанию?: ${v.contactName}`,
        body: v.kind === "left" ? `Больше не работает в ${v.fromClientName ?? "—"}?` : `${v.fromClientName ?? "—"} → ${y ?? "—"}`,
        href: `/contacts?openContact=${v.contactId}`,
        entity: { type: "contact", id: v.contactId },
        dedupeKey: `contact.link_proposal:${v.id}`,
      })
    }
  } catch (err) {
    console.error("[contact-links] notifications failed", orgId, err)
  }
}

/**
 * P5 — discovery apply: an unchecked candidate flagged `possibleMove` becomes
 * a pending proposal on the existing contact («Возможно, это C из X»).
 */
export async function proposeFromDiscovery(
  orgId: string,
  entries: { contactId: string; fromClientId: string | null; email: string; toClientId: string | null; sampleItemId: string | null }[],
): Promise<number> {
  const drafts: ProposalDraft[] = entries.map((e) => {
    const d = {
      contactId: e.contactId,
      candidateContactId: null,
      fromClientId: e.fromClientId,
      toClientId: e.toClientId,
      newAddressKind: "email" as const,
      newAddress: e.email.toLowerCase(),
      toCompanyName: e.toClientId ? null : (extractEmailDomain(e.email) || null),
      kind: (e.toClientId ? "moved" : "left") as ProposalKind,
      confidence: "medium" as const,
      rule: "P5" as const,
      quote: null,
    }
    return { ...d, pairKey: `addr:${e.contactId}:email:${d.newAddress}` }
  })
  let n = 0
  for (const d of drafts) n += await storeProposals(orgId, [d], entries.find((e) => e.contactId === d.contactId)?.sampleItemId ?? null, new Date())
  return n
}

/** Contacts list: other CURRENT companies per contact (link rows only). */
export async function otherCurrentCompanies(
  orgId: string,
  rows: readonly { id: string; clientId: string | null }[],
): Promise<Map<string, { clientId: string; clientName: string; relation: string }[]>> {
  const out = new Map<string, { clientId: string; clientName: string; relation: string }[]>()
  if (rows.length === 0) return out
  const links = await db
    .select({ contactId: contactCompanyLink.contactId, clientId: contactCompanyLink.clientId, relation: contactCompanyLink.relation, name: client.name })
    .from(contactCompanyLink)
    .innerJoin(client, eq(client.id, contactCompanyLink.clientId))
    .where(
      and(
        eq(contactCompanyLink.organizationId, orgId),
        eq(contactCompanyLink.status, "current"),
        inArray(contactCompanyLink.contactId, rows.map((r) => r.id)),
      ),
    )
  const primary = new Map(rows.map((r) => [r.id, r.clientId]))
  for (const l of links) {
    if (primary.get(l.contactId) === l.clientId) continue
    out.set(l.contactId, [...(out.get(l.contactId) ?? []), { clientId: l.clientId, clientName: l.name, relation: l.relation }])
  }
  return out
}

/** SQL condition: the contact is linked to `clientId` (primary column, current link, or — includeFormer — any link). */
export function contactLinkedToClientCondition(clientId: string, includeFormer: boolean) {
  const linkStatus = includeFormer ? sql`` : sql` AND l.status = 'current'`
  return or(
    eq(contact.clientId, clientId),
    sql`EXISTS (SELECT 1 FROM contact_company_link l WHERE l.contact_id = ${contact.id} AND l.client_id = ${clientId}${linkStatus})`,
  )!
}

/**
 * AI chat (§6): «Компании: …; ранее: …» per contact that HAS link rows (a
 * contact with only the implicit link adds nothing — `clientName` says it).
 */
export async function loadContactCompanyHistoryText(orgId: string, contactIds: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (contactIds.length === 0) return out
  const contacts = await db
    .select()
    .from(contact)
    .where(and(eq(contact.organizationId, orgId), inArray(contact.id, [...contactIds])))
  const rows = await loadLinkRows(contacts.map((c) => c.id))
  if (rows.length === 0) return out
  const names = await clientNames([...rows.map((r) => r.clientId), ...contacts.map((c) => c.clientId ?? "")])
  const day = (v: string | null) => (v ? v.slice(0, 10) : "?")
  for (const c of contacts) {
    const mine = rows.filter((r) => r.contactId === c.id)
    if (mine.length === 0) continue
    const links = effectiveLinks(c, mine)
    const label = (l: EffectiveLink) => names.get(l.clientId)?.name ?? "—"
    const cur = links
      .filter((l) => l.status === "current")
      .map((l) => `${label(l)} (${LINK_RELATION_LABELS_RU[l.relation]}${l.isPrimary ? ", основная" : ""}${l.startedAt ? `, с ${day(l.startedAt)}` : ""})`)
    const old = links
      .filter((l) => l.status === "former")
      .map((l) => `${label(l)} (${day(l.startedAt)} – ${day(l.endedAt)}${l.endReason ? `, ${l.endReason}` : ""})`)
    out.set(c.id, [cur.length ? `Компании: ${cur.join("; ")}` : "", old.length ? `ранее: ${old.join("; ")}` : ""].filter(Boolean).join(". "))
  }
  return out
}

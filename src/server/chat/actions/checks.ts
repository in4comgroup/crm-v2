import "server-only"

import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { client, contact, contactAddress, deal, member, user } from "@/db/schema"
import {
  cleanEmail,
  cleanTelegram,
  cleanWebsite,
  companyDomainOfEmail,
  phoneKey,
  type CompanyValues,
  type ContactValues,
  type DraftMatch,
  type ExistingClient,
  type ExistingContact,
  companyFill,
  contactFill,
} from "@/lib/chat/actions"
import { extractEmailDomain, extractWebsiteDomain, isFreemailDomain } from "@/lib/email-domain"
import { companyMatchKey, personMatchKey } from "@/lib/translit-ru"
import { loadOrgBlocklist, type OrgBlocklist } from "@/server/blocklist"
import { searchRecords, type RecordsContext } from "@/server/chat/records"
import { getOwnOrgContext, type OwnOrgContext } from "@/server/identity/own-org"
import { ownOrgIdentityFromContext } from "@/server/org-identity"
import { humanUsersOnly } from "@/server/topics/system-actor"
import { getOrgFunnel } from "@/server/deal-engine"
import { listDealTypes } from "@/server/deal-types"
import { stageDisplayLabel } from "@/lib/deal-funnel"

// Checks of a chat draft (docs/specs/ai-chat-tools §8.3): duplicates of
// existing companies / contacts (exact = e-mail / phone / domain / Telegram;
// similar = name), «us» (own company, own domain, staff address) and the
// discovery blocklist. Deterministic; the only model-free gate before a
// record is created. Org-explicit, read-only.

type ClientRow = {
  id: string
  name: string
  aliases: string[] | null
  webUrl: string | null
  email: string | null
  phone: string | null
  address: string | null
  status: string
}
type ContactRow = {
  id: string
  name: string
  nameNative: string | null
  aliases: string[] | null
  email: string | null
  phone: string | null
  position: string | null
  clientId: string | null
  status: string
}

export type OrgIndex = {
  clients: ClientRow[]
  contacts: ContactRow[]
  clientNames: Map<string, string>
  /** contact id → extra addresses (normalised). */
  addresses: Map<string, { kind: string; value: string }[]>
  own: OwnOrgContext | null
  blocklist: OrgBlocklist
}

/** Everything the checks need, loaded once per turn / confirm. */
export async function loadOrgIndex(orgId: string): Promise<OrgIndex> {
  const [clients, contacts, addrs, own, blocklist] = await Promise.all([
    db
      .select({
        id: client.id,
        name: client.name,
        aliases: client.aliases,
        webUrl: client.webUrl,
        email: client.email,
        phone: client.phone,
        address: client.address,
        status: client.status,
      })
      .from(client)
      .where(eq(client.organizationId, orgId)),
    db
      .select({
        id: contact.id,
        name: contact.name,
        nameNative: contact.nameNative,
        aliases: contact.aliases,
        email: contact.email,
        phone: contact.phone,
        position: contact.position,
        clientId: contact.clientId,
        status: contact.status,
      })
      .from(contact)
      // A merged contact points to the kept one — never offered.
      .where(and(eq(contact.organizationId, orgId), isNull(contact.mergedIntoContactId))),
    db
      .select({ contactId: contactAddress.contactId, kind: contactAddress.kind, value: contactAddress.value })
      .from(contactAddress)
      .where(eq(contactAddress.organizationId, orgId)),
    getOwnOrgContext(orgId).catch((e) => {
      console.error("[chat/actions] own-org context failed", e)
      return null
    }),
    loadOrgBlocklist(orgId),
  ])
  const addresses = new Map<string, { kind: string; value: string }[]>()
  for (const a of addrs) addresses.set(a.contactId, [...(addresses.get(a.contactId) ?? []), { kind: a.kind, value: a.value }])
  return {
    clients,
    contacts,
    clientNames: new Map(clients.map((c) => [c.id, c.name])),
    addresses,
    own,
    blocklist,
  }
}

const clientDomains = (c: ClientRow): string[] =>
  [c.webUrl ? extractWebsiteDomain(c.webUrl) : "", c.email ? extractEmailDomain(c.email) : ""].filter((d) => d && !isFreemailDomain(d))

const sameDomain = (a: string, b: string) => !!a && !!b && (a === b || a.endsWith("." + b) || b.endsWith("." + a))

function pushMatch(out: DraftMatch[], m: DraftMatch) {
  const i = out.findIndex((x) => x.id === m.id && x.type === m.type)
  if (i < 0) out.push(m)
  else if (rank(m.kind) < rank(out[i].kind)) out[i] = m
}
const rank = (k: DraftMatch["kind"]) => (k === "exact" ? 0 : k === "deleted" ? 1 : 2)

export type CheckResult = { matches: DraftMatch[]; refused: string | null }

const US_COMPANY = "Это ваша организация — в компании не добавляется"
const US_CONTACT = "Это ваш сотрудник — в контакты не добавляется"

/** Company: «us», blocklist, duplicates. */
export async function checkCompany(idx: OrgIndex, v: CompanyValues, rctx: RecordsContext | null): Promise<CheckResult> {
  const nameKeys = [v.name, ...v.aliases].map(companyMatchKey).filter(Boolean)
  const domains = [cleanWebsite(v.website), v.email ? companyDomainOfEmail(cleanEmail(v.email)) : ""].filter(Boolean)
  const own = ownOrgIdentityFromContext(idx.own)
  if (nameKeys.some((k) => own.isOwnCompanyKey(k)) || domains.some((d) => own.isOwnDomain(d)) || (v.email && own.isOwnEmail(cleanEmail(v.email)))) {
    return { matches: [], refused: US_COMPANY }
  }
  const bl = idx.blocklist
  if (nameKeys.some((k) => bl.isBlockedCompanyKey(k)) || domains.some((d) => bl.isBlockedDomain(d)) || (v.email && bl.isBlockedEmail(cleanEmail(v.email)))) {
    return { matches: [], refused: "Компания в списке блокировки" }
  }

  const matches: DraftMatch[] = []
  const email = cleanEmail(v.email)
  const phone = phoneKey(v.phone)
  for (const c of idx.clients) {
    const reasons: string[] = []
    if (domains.length && clientDomains(c).some((d) => domains.some((x) => sameDomain(d, x)))) reasons.push("совпадает домен")
    if (email && (c.email ?? "").trim().toLowerCase() === email) reasons.push("совпадает e-mail")
    if (phone && phoneKey(c.phone ?? "") === phone) reasons.push("совпадает телефон")
    const sameName = [c.name, ...(c.aliases ?? [])].some((n) => nameKeys.includes(companyMatchKey(n)))
    if (c.status === "blocked" && (reasons.length || sameName)) return { matches: [], refused: `Компания «${c.name}» заблокирована (список блокировки)` }
    if (reasons.length) {
      const exact = c.status !== "deleted"
      pushMatch(matches, {
        kind: exact ? "exact" : "deleted",
        type: "client",
        id: c.id,
        title: c.name,
        reason: reasons.join(", "),
        ...(exact ? { fill: companyFill(existingClient(c), v) } : {}),
      })
    } else if (sameName) {
      pushMatch(matches, { kind: c.status === "deleted" ? "deleted" : "similar", type: "client", id: c.id, title: c.name, reason: "такое же название" })
    }
  }
  // Fuzzy name (Search V2: translit + trigram), live companies only.
  if (rctx && v.name.trim().length >= 3) {
    const r = await searchRecords(rctx, { query: v.name, types: ["client"], limitPerType: 3 }).catch(() => null)
    for (const h of r?.hits.client ?? []) pushMatch(matches, { kind: "similar", type: "client", id: h.id, title: h.title, subtitle: h.subtitle ?? undefined, reason: "похожее название" })
  }
  return { matches: sortMatches(matches).slice(0, 5), refused: null }
}

/** Contact: «us», blocklist, duplicates. */
export async function checkContact(idx: OrgIndex, v: ContactValues, rctx: RecordsContext | null): Promise<CheckResult> {
  const emails = v.emails.map(cleanEmail).filter(Boolean)
  const phones = v.phones.map(phoneKey).filter(Boolean)
  const tg = cleanTelegram(v.telegram)
  const own = idx.own
  if (own) {
    const ownIds = ownOrgIdentityFromContext(own)
    const staffPhones = new Set(own.identity.staffPhones)
    const staffTg = new Set(own.identity.staffTelegram.map((h) => h.toLowerCase()))
    if (
      emails.some((e) => ownIds.isOwnEmail(e) || ownIds.isOwnDomain(extractEmailDomain(e))) ||
      phones.some((p) => staffPhones.has(p)) ||
      (tg && staffTg.has(tg))
    ) {
      return { matches: [], refused: US_CONTACT }
    }
  }
  const bl = idx.blocklist
  const nameKeys = [v.name, v.nameNative].filter(Boolean).map(personMatchKey).filter((k) => k.length >= 2)
  if (emails.some((e) => bl.isBlockedEmail(e)) || nameKeys.some((k) => bl.isBlockedPersonKey(k))) {
    return { matches: [], refused: "Контакт в списке блокировки" }
  }

  const matches: DraftMatch[] = []
  for (const c of idx.contacts) {
    const extra = idx.addresses.get(c.id) ?? []
    const cEmails = [c.email ?? "", ...extra.filter((a) => a.kind === "email").map((a) => a.value)].map((e) => e.trim().toLowerCase()).filter(Boolean)
    const cPhones = [c.phone ?? "", ...extra.filter((a) => a.kind === "phone").map((a) => a.value)].map(phoneKey).filter(Boolean)
    const cTg = [
      ...(c.aliases ?? []).filter((a) => a.trim().startsWith("@")).map((a) => cleanTelegram(a)),
      ...extra.filter((a) => a.kind === "telegram").map((a) => a.value.replace(/^@/, "").toLowerCase()),
    ].filter(Boolean)
    const reasons: string[] = []
    if (emails.some((e) => cEmails.includes(e))) reasons.push("совпадает e-mail")
    if (phones.some((p) => cPhones.includes(p))) reasons.push("совпадает телефон")
    if (tg && cTg.includes(tg)) reasons.push("совпадает Telegram")
    const sameName = [c.name, c.nameNative ?? "", ...(c.aliases ?? [])]
      .filter((n) => n && !n.trim().startsWith("@"))
      .some((n) => nameKeys.includes(personMatchKey(n)))
    const subtitle = c.clientId ? idx.clientNames.get(c.clientId) : undefined
    if (c.status === "blocked" && reasons.length) return { matches: [], refused: `Контакт «${c.name}» заблокирован (список блокировки)` }
    if (reasons.length) {
      const exact = c.status !== "deleted"
      pushMatch(matches, {
        kind: exact ? "exact" : "deleted",
        type: "contact",
        id: c.id,
        title: c.name,
        subtitle,
        reason: reasons.join(", "),
        ...(exact ? { fill: contactFill(existingContact(idx, c), v) } : {}),
      })
    } else if (sameName && c.status !== "blocked") {
      pushMatch(matches, {
        kind: c.status === "deleted" ? "deleted" : "similar",
        type: "contact",
        id: c.id,
        title: c.name,
        subtitle,
        reason: c.clientId && (c.clientId === v.companyId) ? "то же имя в той же компании" : "такое же имя",
      })
    }
  }
  if (rctx && v.name.trim().length >= 3) {
    const r = await searchRecords(rctx, { query: v.name, types: ["contact"], limitPerType: 3 }).catch(() => null)
    for (const h of r?.hits.contact ?? []) pushMatch(matches, { kind: "similar", type: "contact", id: h.id, title: h.title, subtitle: h.subtitle ?? undefined, reason: "похожее имя" })
  }
  return { matches: sortMatches(matches).slice(0, 5), refused: null }
}

function sortMatches(m: DraftMatch[]): DraftMatch[] {
  return [...m].sort((a, b) => rank(a.kind) - rank(b.kind))
}

/** Existing live client of the org by exact name key (unique), for «companyRef» given as a name. */
export function findClientByName(idx: OrgIndex, name: string): ClientRow | "many" | null {
  const k = companyMatchKey(name)
  if (!k) return null
  const hits = idx.clients.filter(
    (c) => c.status !== "deleted" && c.status !== "blocked" && [c.name, ...(c.aliases ?? [])].some((n) => companyMatchKey(n) === k),
  )
  return hits.length === 1 ? hits[0] : hits.length > 1 ? "many" : null
}

/** A live client of the org by id. */
export async function clientInOrg(orgId: string, id: string): Promise<{ id: string; name: string; status: string } | null> {
  const [r] = await db
    .select({ id: client.id, name: client.name, status: client.status })
    .from(client)
    .where(and(eq(client.organizationId, orgId), eq(client.id, id)))
  return r ?? null
}

/** Contacts of the org by id (status included). */
export async function contactsInOrg(orgId: string, ids: string[]): Promise<{ id: string; name: string; status: string }[]> {
  if (!ids.length) return []
  return db
    .select({ id: contact.id, name: contact.name, status: contact.status })
    .from(contact)
    .where(and(eq(contact.organizationId, orgId), inArray(contact.id, ids)))
}

// ── «Дополнить» (T4) ──────────────────────────────────────────────────

export function existingClient(c: ClientRow): ExistingClient {
  return { name: c.name, aliases: c.aliases ?? [], phone: c.phone, email: c.email, webUrl: c.webUrl, address: c.address }
}

export function existingContact(idx: OrgIndex, c: ContactRow): ExistingContact {
  return {
    name: c.name,
    nameNative: c.nameNative,
    aliases: c.aliases ?? [],
    phone: c.phone,
    email: c.email,
    position: c.position,
    extra: idx.addresses.get(c.id) ?? [],
  }
}

export function clientRow(idx: OrgIndex, id: string): ClientRow | null {
  return idx.clients.find((c) => c.id === id) ?? null
}

// ── Tasks (T2) ────────────────────────────────────────────────────────

/** Human, not banned members of the org (assignee picker; never «Агент»). */
export async function loadOrgMembers(orgId: string): Promise<{ id: string; name: string; email: string }[]> {
  const rows = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, orgId), humanUsersOnly(), or(isNull(user.banned), eq(user.banned, false))))
    .orderBy(asc(user.name))
  return rows.map((r) => ({ id: r.id, name: (r.name ?? "").trim() || r.email, email: r.email }))
}

/** A deal of the org by id (any status). */
export async function dealInOrg(orgId: string, id: string): Promise<{ id: string; name: string; status: string; clientId: string | null } | null> {
  const [r] = await db
    .select({ id: deal.id, name: deal.name, status: deal.status, clientId: deal.clientId })
    .from(deal)
    .where(and(eq(deal.organizationId, orgId), eq(deal.id, id)))
  return r ?? null
}

/** The only live contact of the org with this name (any script), or "many" / null. */
export function findContactByName(idx: OrgIndex, name: string): ContactRow | "many" | null {
  const k = personMatchKey(name)
  if (k.length < 2) return null
  const hits = idx.contacts.filter(
    (c) => c.status !== "deleted" && c.status !== "blocked" && [c.name, c.nameNative ?? ""].some((n) => n && personMatchKey(n) === k),
  )
  return hits.length === 1 ? hits[0] : hits.length > 1 ? "many" : null
}

/** A contact of the org by id (live). */
export function contactById(idx: OrgIndex, id: string): ContactRow | null {
  const c = idx.contacts.find((x) => x.id === id)
  return c && c.status !== "deleted" && c.status !== "blocked" ? c : null
}

/** The only open deal of the org with this name (case-insensitive), or "many" / null. */
export async function findDealByName(orgId: string, name: string): Promise<{ id: string; name: string } | "many" | null> {
  const n = name.trim().toLowerCase()
  if (n.length < 2) return null
  const rows = await db
    .select({ id: deal.id, name: deal.name })
    .from(deal)
    .where(and(eq(deal.organizationId, orgId), eq(deal.status, "active"), sql`lower(${deal.name}) = ${n}`))
    .limit(3)
  return rows.length === 1 ? rows[0] : rows.length > 1 ? "many" : null
}

// ── Deals (T3) ────────────────────────────────────────────────────────

export type DealOptions = {
  /** Working stages (role active, not hidden), in funnel order. */
  stages: { id: string; name: string }[]
  dealTypes: { id: string; name: string; code: string }[]
}

export async function loadDealOptions(orgId: string): Promise<DealOptions> {
  const [stages, types] = await Promise.all([getOrgFunnel(orgId), listDealTypes(orgId)])
  return {
    stages: stages
      .filter((s) => s.role === "active" && !s.isHidden)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((s) => ({ id: s.id, name: stageDisplayLabel(s.name, s.displayName) })),
    dealTypes: types.map((t) => ({ id: t.id, name: t.labelRu, code: t.code })),
  }
}

/** Open deals (active / paused, not won / lost) of a company — the «same company and type» check (§9). */
export async function openDealsOfClient(
  orgId: string,
  clientId: string,
): Promise<{ id: string; name: string; dealTypeId: string | null; stageName: string }[]> {
  const stages = await getOrgFunnel(orgId)
  const rows = await db
    .select({ id: deal.id, name: deal.name, dealTypeId: deal.dealTypeId, stageId: deal.funnelStageId })
    .from(deal)
    .where(and(eq(deal.organizationId, orgId), eq(deal.clientId, clientId), inArray(deal.status, ["active", "paused"])))
  return rows
    .map((r) => ({ r, s: stages.find((x) => x.id === r.stageId) }))
    .filter(({ s }) => !s || (s.role !== "won" && s.role !== "lost"))
    .map(({ r, s }) => ({ id: r.id, name: r.name, dealTypeId: r.dealTypeId, stageName: s ? stageDisplayLabel(s.name, s.displayName) : "" }))
}

// Counterparty resolution of one subject (spec topics/01 §6.2 step 1; plan
// phase 3 task 3). PURE: works on an index the store builds once per run
// from the org's clients and contacts.
//
// Order:
//   1. the subject's counterparty string → client by name / aliases
//      (`companyMatchKey`), contact by name / aliases (`personMatchKey`);
//   2. the item's peer (inbound: the sender; outbound: the first recipient) →
//      contact by email, Telegram username (contact alias «@name») or name;
//      client by a non-free-mail domain (client website / email, contacts'
//      emails);
//   3. a contact found without a client → its own client; a contact with
//      several CURRENT companies (docs/specs/clients-contacts/04 §7) → the
//      company of the peer's address (address row, else its domain), else
//      the primary.
// Contacts also match by their extra addresses (`contact_address`).
// A unique hit is required at every step (ambiguous → not resolved). A
// person without a company → contact only (R14). Nothing → nulls + the raw
// string; the phase re-links later when discovery creates the client.

import { extractEmailDomain, extractWebsiteDomain } from "@/lib/email-domain"
import { isFreemailDomain } from "@/lib/ru-mail"
import { companyMatchKey, personMatchKey } from "@/lib/translit-ru"

export type CounterpartyClient = {
  id: string
  name: string
  aliases: string[] | null
  webUrl: string | null
  email: string | null
}

export type CounterpartyContact = {
  id: string
  name: string
  nameNative: string | null
  aliases: string[] | null
  email: string | null
  /** Primary company (`contact.client_id`). */
  clientId: string | null
  /** Every CURRENT company (primary first); absent = [clientId]. */
  clientIds?: string[]
  /** Extra email addresses (`contact_address`, lower-case) → the address's company. */
  extraEmails?: { email: string; clientId: string | null }[]
}

function clientsOf(p: CounterpartyContact): string[] {
  return p.clientIds ?? (p.clientId ? [p.clientId] : [])
}

export type CounterpartyIndex = {
  clients: Map<string, CounterpartyClient>
  contacts: Map<string, CounterpartyContact>
  clientsByKey: Map<string, Set<string>>
  clientsByDomain: Map<string, Set<string>>
  contactsByEmail: Map<string, Set<string>>
  contactsByPersonKey: Map<string, Set<string>>
  contactsByHandle: Map<string, Set<string>>
}

function add(map: Map<string, Set<string>>, key: string, id: string) {
  if (!key) return
  const set = map.get(key) ?? new Set<string>()
  set.add(id)
  map.set(key, set)
}

function handleKey(raw: string): string {
  const m = raw.trim().match(/^@([a-z0-9_]{3,})$/i)
  return m ? m[1].toLowerCase() : ""
}

export function buildCounterpartyIndex(
  clients: readonly CounterpartyClient[],
  contacts: readonly CounterpartyContact[],
): CounterpartyIndex {
  const idx: CounterpartyIndex = {
    clients: new Map(clients.map((c) => [c.id, c])),
    contacts: new Map(contacts.map((c) => [c.id, c])),
    clientsByKey: new Map(),
    clientsByDomain: new Map(),
    contactsByEmail: new Map(),
    contactsByPersonKey: new Map(),
    contactsByHandle: new Map(),
  }
  for (const c of clients) {
    for (const n of [c.name, ...(c.aliases ?? [])]) add(idx.clientsByKey, companyMatchKey(n), c.id)
    const domains = [c.webUrl ? extractWebsiteDomain(c.webUrl) : "", c.email ? extractEmailDomain(c.email) : ""]
    for (const d of domains) if (d && !isFreemailDomain(d)) add(idx.clientsByDomain, d, c.id)
  }
  for (const p of contacts) {
    if (p.email) add(idx.contactsByEmail, p.email.trim().toLowerCase(), p.id)
    for (const e of p.extraEmails ?? []) add(idx.contactsByEmail, e.email, p.id)
    for (const n of [p.name, p.nameNative ?? "", ...(p.aliases ?? [])]) {
      if (!n) continue
      const h = handleKey(n)
      if (h) add(idx.contactsByHandle, h, p.id)
      else add(idx.contactsByPersonKey, personMatchKey(n), p.id)
    }
    for (const e of p.extraEmails ?? []) {
      const d = e.clientId ? extractEmailDomain(e.email) : ""
      if (d && !isFreemailDomain(d)) add(idx.clientsByDomain, d, e.clientId!)
    }
    if (p.email && p.clientId) {
      const d = extractEmailDomain(p.email)
      if (d && !isFreemailDomain(d)) add(idx.clientsByDomain, d, p.clientId)
    }
  }
  return idx
}

function unique(set: Set<string> | undefined): string | null {
  return set && set.size === 1 ? [...set][0] : null
}

export type ItemPeer = {
  email: string | null
  name: string | null
  /** Telegram username without «@». */
  handle: string | null
  /** Telegram: the contact found by the ONE rule (`metadata_json.telegram.resolved`, docs/specs/telegram/04 §8) — wins over handle / name. */
  contactId?: string | null
}

export type ResolvedCounterparty = {
  clientId: string | null
  contactId: string | null
  /** Match key of the raw counterparty (topics with no client / contact). */
  key: string
  companyName: string | null
  contactName: string | null
  /** How it was resolved (debug). */
  via: string[]
}

/** Company of a (multi-company) contact for this item: the peer's address. */
export function pickContactClient(p: CounterpartyContact, peer: ItemPeer | null, idx: CounterpartyIndex): string | null {
  const all = clientsOf(p)
  if (all.length <= 1) return all[0] ?? p.clientId ?? null
  const email = peer?.email?.trim().toLowerCase() ?? ""
  if (email) {
    const own = p.extraEmails?.find((e) => e.email === email)?.clientId
    if (own && all.includes(own)) return own
    const d = extractEmailDomain(email)
    if (d && !isFreemailDomain(d)) {
      const hits = [...(idx.clientsByDomain.get(d) ?? [])].filter((id) => all.includes(id))
      if (hits.length === 1) return hits[0]
    }
  }
  return p.clientId ?? all[0]
}

/** Match key of a raw counterparty string (company key, else person key). */
export function counterpartyKey(raw: string): string {
  return companyMatchKey(raw) || personMatchKey(raw)
}

export function resolveCounterparty(
  raw: string,
  peer: ItemPeer | null,
  idx: CounterpartyIndex,
): ResolvedCounterparty {
  const via: string[] = []
  let clientId: string | null = null
  let contactId: string | null = null
  const text = raw.trim()

  // 1. The subject's own counterparty string.
  if (text) {
    clientId = unique(idx.clientsByKey.get(companyMatchKey(text)))
    if (clientId) via.push("client_name")
    const pc = unique(idx.contactsByPersonKey.get(personMatchKey(text)))
    if (pc) {
      const p = idx.contacts.get(pc)!
      if (!clientId || clientsOf(p).length === 0 || clientsOf(p).includes(clientId)) {
        contactId = pc
        via.push("contact_name")
      }
    }
  }

  // 2. The peer of the item. When the subject string resolved nothing, the
  // peer stands for the counterparty (the usual case: the sender writes
  // about their own company). When it resolved a client, the peer adds the
  // contact only if the peer belongs to that client.
  if (peer && !(clientId && contactId)) {
    let pc: string | null = null
    if (peer.contactId && idx.contacts.has(peer.contactId)) pc = peer.contactId
    if (!pc && peer.email) pc = unique(idx.contactsByEmail.get(peer.email.trim().toLowerCase()))
    if (!pc && peer.handle) pc = unique(idx.contactsByHandle.get(peer.handle.toLowerCase()))
    if (!pc && peer.name) pc = unique(idx.contactsByPersonKey.get(personMatchKey(peer.name)))
    const p = pc ? idx.contacts.get(pc)! : null
    const nothingYet = !clientId && !contactId
    if (p && nothingYet) {
      contactId = p.id
      via.push("peer_contact")
    } else if (p && clientId && !contactId && clientsOf(p).includes(clientId)) {
      contactId = p.id
      via.push("peer_contact")
    }
    if (nothingYet && !clientId && peer.email) {
      const d = extractEmailDomain(peer.email)
      const c = d && !isFreemailDomain(d) ? unique(idx.clientsByDomain.get(d)) : null
      const cc = contactId ? clientsOf(idx.contacts.get(contactId)!) : []
      if (c && (cc.length === 0 || cc.includes(c))) {
        clientId = c
        via.push("peer_domain")
      }
    }
  }

  // 3. Contact without client → its client.
  if (!clientId && contactId) {
    const p = idx.contacts.get(contactId)!
    const cc = pickContactClient(p, peer, idx)
    if (cc) {
      clientId = cc
      via.push("contact_client")
    }
  }

  return {
    clientId,
    contactId,
    key: counterpartyKey(text || peer?.name || peer?.email || ""),
    companyName: clientId ? (idx.clients.get(clientId)?.name ?? null) : null,
    contactName: contactId ? (idx.contacts.get(contactId)?.name ?? null) : null,
    via,
  }
}

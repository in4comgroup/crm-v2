// Contact ↔ company links over time (docs/specs/clients-contacts/04). PURE,
// client-safe: value lists, Russian labels, the effective-links view, the
// decision plan and the recognition rules P1–P4. No DB.
//
// Model in short:
//   - `contact_company_link` rows = periods (current / former) with a relation;
//   - `contact.client_id` = the client of the PRIMARY current link;
//   - NO backfill (Q12): a contact whose `client_id` has no current row gets
//     one IMPLICIT current primary link (`implicit: true`, id null). The
//     server materialises it (source `implicit`) before the first change.

import { extractEmailDomain } from "@/lib/email-domain"
import { isFreemailDomain } from "@/lib/ru-mail"
import { personMatchKey } from "@/lib/translit-ru"

// ── Value lists ────────────────────────────────────────────────────────────

export const LINK_RELATIONS = ["employee", "consultant", "representative", "other"] as const
export type LinkRelation = (typeof LINK_RELATIONS)[number]

export const LINK_RELATION_LABELS: Record<LinkRelation, string> = {
  employee: "Сотрудник",
  consultant: "Консультант / подрядчик",
  representative: "Партнёр / представитель",
  other: "Другое",
}

export const LINK_STATUSES = ["current", "former"] as const
export type LinkStatus = (typeof LINK_STATUSES)[number]

export const ADDRESS_KINDS = ["email", "phone", "telegram"] as const
export type AddressKind = (typeof ADDRESS_KINDS)[number]

export const ADDRESS_KIND_LABELS: Record<AddressKind, string> = {
  email: "Email",
  phone: "Телефон",
  telegram: "Telegram",
}

export const PROPOSAL_KINDS = ["moved", "second_company", "same_person", "left"] as const
export type ProposalKind = (typeof PROPOSAL_KINDS)[number]

export const PROPOSAL_RULES = ["P1", "P2", "P3", "P4", "P5"] as const
export type ProposalRule = (typeof PROPOSAL_RULES)[number]

export const PROPOSAL_DECISIONS = ["moved", "both", "other_person", "snooze"] as const
export type ProposalDecision = (typeof PROPOSAL_DECISIONS)[number]

export const PROPOSAL_RULE_LABELS: Record<ProposalRule, string> = {
  P1: "Прощальное письмо / новый адрес",
  P2: "То же имя с адреса другой компании",
  P3: "Личный адрес, в письме другая компания",
  P4: "Пишет с адресов двух компаний",
  P5: "Найдено при поиске в источниках",
}

/** «Не сейчас» hides a proposal for this many days. */
export const PROPOSAL_SNOOZE_DAYS = 7
/** P4 / P2: activity from X within this many days = «Работает с обеими». */
export const PARALLEL_ACTIVITY_DAYS = 60
/** Badge «Перешёл из X» on the contact for this many days. */
export const MOVED_BADGE_DAYS = 90

export function isLinkRelation(v: unknown): v is LinkRelation {
  return typeof v === "string" && (LINK_RELATIONS as readonly string[]).includes(v)
}
export function isAddressKind(v: unknown): v is AddressKind {
  return typeof v === "string" && (ADDRESS_KINDS as readonly string[]).includes(v)
}

// ── Addresses ──────────────────────────────────────────────────────────────

/** Normalised address value; "" = not valid. */
export function normalizeAddress(kind: AddressKind, raw: string): string {
  const s = (raw ?? "").trim()
  if (!s) return ""
  if (kind === "email") {
    const v = s.toLowerCase()
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : ""
  }
  if (kind === "phone") {
    const digits = s.replace(/\D/g, "")
    return digits.length >= 7 ? digits : ""
  }
  const h = s.replace(/^@/, "").toLowerCase()
  return /^[a-z0-9_]{3,}$/.test(h) ? h : ""
}

// ── Effective links (read side) ────────────────────────────────────────────

export type LinkRow = {
  id: string
  clientId: string
  relation: string
  status: string
  isPrimary: boolean
  position: string | null
  startedAt: Date | string | null
  endedAt: Date | string | null
  source: string
  endReason: string | null
  evidenceSourceItemId: string | null
  createdAt: Date | string
}

export type EffectiveLink = {
  /** null = implicit (the contact's `client_id` without a row). */
  id: string | null
  implicit: boolean
  clientId: string
  relation: LinkRelation
  status: LinkStatus
  isPrimary: boolean
  position: string | null
  startedAt: string | null
  endedAt: string | null
  source: string
  endReason: string | null
  evidenceSourceItemId: string | null
}

function iso(v: Date | string | null | undefined): string | null {
  if (!v) return null
  return typeof v === "string" ? v : v.toISOString()
}

/**
 * PURE. Rows + the contact's `client_id` → the effective links. Primary =
 * the current link of `client_id` (the contact column is the truth). A
 * `client_id` without a current row → one implicit current primary link
 * (relation employee, position = the contact's, since = the contact's
 * creation). Current first (primary first), then former by end date desc.
 */
export function effectiveLinks(
  contact: { clientId: string | null; position: string | null; createdAt: Date | string },
  rows: readonly LinkRow[],
): EffectiveLink[] {
  const out: EffectiveLink[] = rows.map((r) => ({
    id: r.id,
    implicit: false,
    clientId: r.clientId,
    relation: isLinkRelation(r.relation) ? r.relation : "other",
    status: r.status === "former" ? "former" : "current",
    isPrimary: false,
    position: r.position,
    startedAt: iso(r.startedAt),
    endedAt: iso(r.endedAt),
    source: r.source,
    endReason: r.endReason,
    evidenceSourceItemId: r.evidenceSourceItemId,
  }))
  if (contact.clientId) {
    const cur = out.find((l) => l.status === "current" && l.clientId === contact.clientId)
    if (cur) cur.isPrimary = true
    else
      out.push({
        id: null,
        implicit: true,
        clientId: contact.clientId,
        relation: "employee",
        status: "current",
        isPrimary: true,
        position: contact.position,
        startedAt: iso(contact.createdAt),
        endedAt: null,
        source: "implicit",
        endReason: null,
        evidenceSourceItemId: null,
      })
  }
  const rank = (l: EffectiveLink) => (l.status === "current" ? (l.isPrimary ? 0 : 1) : 2)
  return out.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (b.endedAt ?? b.startedAt ?? "").localeCompare(a.endedAt ?? a.startedAt ?? ""),
  )
}

/** Current client ids of a contact (primary first). */
export function currentClientIds(
  contact: { clientId: string | null },
  rows: readonly { clientId: string; status: string }[],
): string[] {
  const out: string[] = []
  if (contact.clientId) out.push(contact.clientId)
  for (const r of rows) if (r.status === "current" && !out.includes(r.clientId)) out.push(r.clientId)
  return out
}

// ── Decision plan ──────────────────────────────────────────────────────────

export type LinkOp =
  | { op: "materialize"; clientId: string; position: string | null; startedAt: string | null }
  | { op: "end"; linkId: string | null; clientId: string; endedAt: string; endReason: string }
  | { op: "add"; clientId: string; relation: LinkRelation; startedAt: string | null }
  | { op: "reopen"; linkId: string; relation: LinkRelation }
  | { op: "primary"; clientId: string | null }

export type DecisionInput = {
  links: readonly EffectiveLink[]
  decision: "moved" | "both"
  fromClientId: string | null
  toClientId: string | null
  /** Relation of the new (Y) link; default employee for moved, consultant for both. */
  relation?: LinkRelation | null
  /** «Работает с обеими»: which current company is the primary. */
  primaryClientId?: string | null
  /** Day of the evidence (ISO) or now. */
  at: string
  toName: string | null
}

/**
 * PURE. Link operations of an accepted proposal (§5):
 *  - moved: every current link to X → former («Перешёл в Y» / «Больше не
 *    работает»); Y → current (added, or a former Y link reopened); primary = Y,
 *    else the first other current link, else none;
 *  - both: Y → current (consultant by default), X stays; primary = the
 *    chosen one (must be current), else the existing primary.
 * An implicit link that is touched is materialised first.
 */
export function planDecision(input: DecisionInput): LinkOp[] {
  const ops: LinkOp[] = []
  const { links, decision, fromClientId, toClientId, at } = input
  const implicit = links.find((l) => l.implicit)
  const touchesImplicit =
    !!implicit && ((decision === "moved" && implicit.clientId === fromClientId) || implicit.clientId === toClientId)
  if (implicit && touchesImplicit) {
    ops.push({ op: "materialize", clientId: implicit.clientId, position: implicit.position, startedAt: implicit.startedAt })
  }
  const remaining = new Set(links.filter((l) => l.status === "current").map((l) => l.clientId))
  if (decision === "moved" && fromClientId) {
    for (const l of links) {
      if (l.status !== "current" || l.clientId !== fromClientId) continue
      ops.push({
        op: "end",
        linkId: l.id,
        clientId: l.clientId,
        endedAt: at,
        endReason: toClientId && input.toName ? `Перешёл в ${input.toName}` : "Больше не работает",
      })
      remaining.delete(l.clientId)
    }
  }
  if (toClientId && !remaining.has(toClientId)) {
    const relation = input.relation ?? (decision === "both" ? "consultant" : "employee")
    const former = links.find((l) => l.status === "former" && l.clientId === toClientId && l.id)
    if (former?.id) ops.push({ op: "reopen", linkId: former.id, relation })
    else ops.push({ op: "add", clientId: toClientId, relation, startedAt: at })
    remaining.add(toClientId)
  }
  const currentPrimary = links.find((l) => l.isPrimary && l.status === "current")?.clientId ?? null
  let primary: string | null
  if (decision === "moved") {
    primary = toClientId ?? (currentPrimary && remaining.has(currentPrimary) ? currentPrimary : ([...remaining][0] ?? null))
  } else {
    const want = input.primaryClientId ?? currentPrimary
    primary = want && remaining.has(want) ? want : ([...remaining][0] ?? null)
  }
  if (primary !== currentPrimary) ops.push({ op: "primary", clientId: primary })
  return ops
}

// ── Recognition (P1–P4) ────────────────────────────────────────────────────

const FAREWELL_RE: RegExp[] = [
  /последн(?:ий|им)\s+(?:рабоч(?:ий|им)\s+)?д(?:ень|нём)/i,
  /больше\s+не\s+работа(?:ю|ет)/i,
  /(?:покидаю|покинул[аи]?|ухожу\s+из|ушл[аи]?\s+из|ушёл\s+из|уволил(?:ся|ась))/i,
  /(?:я\s+)?перешл?(?:ёл|ел|а)\s+(?:работать\s+)?в\s/i,
  /(?:нов(?:ое|ом)\s+мест(?:о|е)\s+работы|моё\s+новое\s+место)/i,
  /\bno\s+longer\s+(?:with|work(?:s|ing)?\s+(?:at|for))\b/i,
  /\blast\s+(?:working\s+)?day\b/i,
  /\b(?:has|have)\s+left\s+(?:the\s+)?company\b/i,
  /\bleft\s+(?:the\s+)?company\b/i,
]

/** PURE. A farewell / «больше не работаю» line in the text. */
export function detectFarewell(text: string): { found: boolean; quote: string | null } {
  if (!text) return { found: false, quote: null }
  for (const re of FAREWELL_RE) {
    const m = re.exec(text)
    if (m) {
      const start = Math.max(0, text.lastIndexOf("\n", m.index) + 1)
      const endNl = text.indexOf("\n", m.index)
      const line = text.slice(start, endNl === -1 ? undefined : endNl).trim()
      return { found: true, quote: line.slice(0, 300) }
    }
  }
  return { found: false, quote: null }
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi

/** PURE. Distinct lower-case email addresses in a text. */
export function emailsInText(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(EMAIL_RE)) out.add(m[0].toLowerCase().replace(/\.$/, ""))
  return [...out]
}

export type RuleContact = {
  id: string
  name: string
  nameNative: string | null
  aliases: string[] | null
  email: string | null
  phone: string | null
  /** Current client ids (primary first). */
  clientIds: string[]
}

export type RuleIndex = {
  contacts: Map<string, RuleContact>
  /** Lower-case email (contact.email + contact_address) → contact ids. */
  contactsByEmail: Map<string, Set<string>>
  /** Email → the client the address belongs to (contact_address.client_id). */
  addressClient: Map<string, string>
  /** personMatchKey → contact ids. */
  contactsByPersonKey: Map<string, Set<string>>
  /** Non-free-mail domain → client ids (website, email, contacts' addresses). */
  clientsByDomain: Map<string, Set<string>>
  /** companyMatchKey → client ids. */
  clientsByKey: Map<string, Set<string>>
  clientNames: Map<string, string>
}

export type ItemParticipant = { email: string; name: string; role: "from" | "to" | "cc" | "other" }

export type RuleItem = {
  id: string
  date: string
  /** The author (sender) address, lower-case; null = unknown. */
  fromEmail: string | null
  fromName: string | null
  participants: ItemParticipant[]
  /** `## Content` of the parsed markdown (the author's text + quotes). */
  text: string
  /** Signal codes found on the item (P1: CONTACT_LEAVING). */
  signalCodes: string[]
  isBounce: boolean
  isAutoReply: boolean
  /** participantDetails: email → { phone, nativeName }. */
  details: Map<string, { phone: string | null; nativeName: string | null }>
  /** Company names the parser saw (organizations[].name) — P3. */
  organizations: { key: string; domain: string | null }[]
}

export type ProposalDraft = {
  contactId: string
  candidateContactId: string | null
  fromClientId: string | null
  toClientId: string | null
  newAddressKind: AddressKind | null
  newAddress: string | null
  toCompanyName: string | null
  kind: ProposalKind
  confidence: "high" | "medium"
  rule: ProposalRule
  quote: string | null
  pairKey: string
}

function unique(set: Set<string> | undefined): string | null {
  return set && set.size === 1 ? [...set][0] : null
}

function domainOf(email: string | null): string {
  return email ? extractEmailDomain(email) : ""
}

/** Client of an address: the address row's client, else its non-free-mail domain (unique). */
export function clientOfAddress(idx: RuleIndex, email: string): string | null {
  const own = idx.addressClient.get(email)
  if (own) return own
  const d = domainOf(email)
  if (!d || isFreemailDomain(d)) return null
  return unique(idx.clientsByDomain.get(d))
}

/** Pair keys (dedupe + «Это другой человек» memory). */
export function pairKeyFor(
  p: Pick<ProposalDraft, "contactId" | "candidateContactId" | "newAddress" | "newAddressKind" | "toClientId" | "fromClientId" | "kind">,
): string {
  if (p.candidateContactId) {
    const [a, b] = [p.contactId, p.candidateContactId].sort()
    return `same:${a}:${b}`
  }
  if (p.newAddress) return `addr:${p.contactId}:${p.newAddressKind ?? "email"}:${p.newAddress}`
  if (p.toClientId) return `co:${p.contactId}:${p.toClientId}`
  return `left:${p.contactId}:${p.fromClientId ?? "-"}`
}

export type RuleEnv = {
  /** Our own addresses («us») — never a contact's new address. */
  isOwnEmail: (email: string) => boolean
  /** P2 / P4: did contact C write from an address of client X in the last 60 days? */
  recentFromClient: (contactId: string, clientId: string) => boolean
}

/**
 * PURE. Proposals of one item (§4, rules P1–P4). Name alone never proposes:
 * P2 needs the other client's domain; P1 needs the farewell + a known author.
 */
export function evaluateItemRules(item: RuleItem, idx: RuleIndex, env: RuleEnv): ProposalDraft[] {
  const out: ProposalDraft[] = []
  const push = (d: Omit<ProposalDraft, "pairKey">) => {
    const pairKey = pairKeyFor(d)
    if (!out.some((x) => x.pairKey === pairKey)) out.push({ ...d, pairKey })
  }
  const author = item.fromEmail && !env.isOwnEmail(item.fromEmail) ? item.fromEmail : null
  const authorId = author ? unique(idx.contactsByEmail.get(author)) : null
  const authorContact = authorId ? (idx.contacts.get(authorId) ?? null) : null

  // P1 — farewell / auto-reply «больше не работаю» / bounce.
  const farewell = detectFarewell(item.text)
  const leaving = item.signalCodes.includes("CONTACT_LEAVING") || farewell.found
  if (authorContact && leaving && authorContact.clientIds.length > 0) {
    const x = (author && clientOfAddress(idx, author)) || authorContact.clientIds[0]
    const known = new Set([author, ...(authorContact.email ? [authorContact.email.toLowerCase()] : [])])
    const fresh = emailsInText(item.text).filter(
      (e) => !known.has(e) && !env.isOwnEmail(e) && !idx.contactsByEmail.has(e),
    )
    let proposed = false
    for (const e of fresh) {
      const y = clientOfAddress(idx, e)
      if (y && y !== x) {
        push({
          contactId: authorContact.id,
          candidateContactId: null,
          fromClientId: x,
          toClientId: y,
          newAddressKind: "email",
          newAddress: e,
          toCompanyName: null,
          kind: "moved",
          confidence: "high",
          rule: "P1",
          quote: farewell.quote,
        })
        proposed = true
        break
      }
    }
    if (!proposed) {
      const e = fresh[0] ?? null
      const d = e ? domainOf(e) : ""
      push({
        contactId: authorContact.id,
        candidateContactId: null,
        fromClientId: x,
        toClientId: null,
        newAddressKind: e ? "email" : null,
        newAddress: e,
        toCompanyName: d && !isFreemailDomain(d) ? d : null,
        kind: "left",
        confidence: farewell.found || item.signalCodes.includes("CONTACT_LEAVING") ? "high" : "medium",
        rule: "P1",
        quote: farewell.quote,
      })
    }
  }

  // P1 — a bounce of a contact's PRIMARY address = «уходит из X» (medium).
  if (item.isBounce) {
    for (const e of emailsInText(item.text)) {
      const cid = unique(idx.contactsByEmail.get(e))
      const c = cid ? idx.contacts.get(cid) : null
      if (!c || (c.email ?? "").toLowerCase() !== e || c.clientIds.length === 0) continue
      const x = clientOfAddress(idx, e) ?? c.clientIds[0]
      push({
        contactId: c.id,
        candidateContactId: null,
        fromClientId: x,
        toClientId: null,
        newAddressKind: null,
        newAddress: null,
        toCompanyName: null,
        kind: "left",
        confidence: "medium",
        rule: "P1",
        quote: `Письмо на ${e} не доставлено`,
      })
    }
  }
  if (item.isBounce || item.isAutoReply) return out

  // P2 / P4 — a participant with a known person's name writes from an address
  // of ANOTHER client Y (or that address already is a second record).
  for (const p of item.participants) {
    const email = p.email.toLowerCase()
    if (!email || env.isOwnEmail(email)) continue
    const y = clientOfAddress(idx, email)
    if (!y) continue
    const existingId = unique(idx.contactsByEmail.get(email))
    const names = [p.name, item.details.get(email)?.nativeName ?? ""].filter(Boolean)
    let cId: string | null = null
    for (const n of names) {
      const key = personMatchKey(n)
      if (key.length < 2) continue
      const hits = [...(idx.contactsByPersonKey.get(key) ?? [])].filter((id) => id !== existingId)
      if (hits.length === 1) {
        cId = hits[0]
        break
      }
    }
    if (!cId) continue
    const c = idx.contacts.get(cId)!
    if (c.clientIds.length === 0 || c.clientIds.includes(y)) continue
    // The candidate record (when the address is already a contact) must not
    // belong to the same X, and must be at Y or nowhere.
    const cand = existingId ? idx.contacts.get(existingId) : null
    if (cand && cand.clientIds.length > 0 && !cand.clientIds.includes(y)) continue
    const x = c.clientIds[0]
    const phone = item.details.get(email)?.phone ?? null
    const samePhone = !!phone && !!c.phone && normalizeAddress("phone", phone) === normalizeAddress("phone", c.phone)
    const parallel = env.recentFromClient(c.id, x)
    push({
      contactId: c.id,
      candidateContactId: cand?.id ?? null,
      fromClientId: x,
      toClientId: y,
      newAddressKind: "email",
      newAddress: email,
      toCompanyName: null,
      kind: cand ? "same_person" : parallel ? "second_company" : "moved",
      confidence: samePhone ? "high" : "medium",
      rule: parallel ? "P4" : "P2",
      quote: null,
    })
  }

  // P3 — a known person on a FREE-MAIL address; the item names exactly one
  // other known client Y (signature / organizations) and not X.
  if (authorContact && author && isFreemailDomain(domainOf(author)) && authorContact.clientIds.length > 0) {
    const ys = new Set<string>()
    for (const o of item.organizations) {
      const byKey = unique(idx.clientsByKey.get(o.key))
      const byDomain = o.domain && !isFreemailDomain(o.domain) ? unique(idx.clientsByDomain.get(o.domain)) : null
      const hit = byKey ?? byDomain
      if (hit) ys.add(hit)
    }
    const others = [...ys].filter((id) => !authorContact.clientIds.includes(id))
    if (others.length === 1 && ys.size === 1) {
      push({
        contactId: authorContact.id,
        candidateContactId: null,
        fromClientId: authorContact.clientIds[0],
        toClientId: others[0],
        newAddressKind: null,
        newAddress: null,
        toCompanyName: null,
        kind: "second_company",
        confidence: "medium",
        rule: "P3",
        quote: null,
      })
    }
  }
  return out
}

// ── API / view contract (shared by the server and the UI) ──────────────────

export type ContactLinkView = EffectiveLink & {
  clientName: string
  clientStatus: string | null
  /** FORMER links only: open deals of that company where this person is still a deal contact (Q9). */
  openDeals?: { id: string; name: string }[]
}

export type ContactAddressView = {
  id: string
  kind: AddressKind
  value: string
  status: "active" | "old"
  clientId: string | null
  clientName: string | null
  source: string
}

export type ProposalView = {
  id: string
  contactId: string
  contactName: string
  candidateContactId: string | null
  candidateContactName: string | null
  fromClientId: string | null
  fromClientName: string | null
  toClientId: string | null
  toClientName: string | null
  toCompanyName: string | null
  newAddressKind: AddressKind | null
  newAddress: string | null
  kind: ProposalKind
  confidence: string
  rule: ProposalRule
  ruleLabel: string
  quote: string | null
  evidenceAt: string | null
  evidenceItems: { id: string; title: string | null; date: string | null }[]
  createdAt: string
}

export type ContactLinkEventView = {
  id: string
  kind: string
  text: string
  userName: string | null
  createdAt: string
}

export type ContactLinksResponse = {
  contactId: string
  contactName: string
  links: ContactLinkView[]
  addresses: ContactAddressView[]
  proposals: ProposalView[]
  events: ContactLinkEventView[]
  /** «Перешёл из X» badge (≤ 90 days after the move). */
  movedFrom: { clientId: string; clientName: string; at: string } | null
}

export type ClientContactLinkEntry = {
  contactId: string
  name: string
  email: string | null
  position: string | null
  relation: LinkRelation
  isPrimary: boolean
  startedAt: string | null
  endedAt: string | null
  endReason: string | null
  /** Other CURRENT companies of the contact («также: Y (консультант)» / «теперь в Y»). */
  elsewhere: { clientId: string; clientName: string; relation: LinkRelation }[]
}

export type ClientContactLinksResponse = {
  current: ClientContactLinkEntry[]
  former: ClientContactLinkEntry[]
  proposals: ProposalView[]
}

/** POST /api/contacts/[id]/links body. */
export type ContactLinkAction =
  | { action: "add"; clientId: string; relation?: LinkRelation; position?: string | null; startedAt?: string | null; primary?: boolean }
  | { action: "end"; clientId: string; endedAt?: string | null; endReason?: string | null }
  | { action: "primary"; clientId: string }
  /** `linkId: "implicit"` = the implicit link (materialised by the edit). */
  | { action: "edit"; linkId: string; relation?: LinkRelation; position?: string | null; startedAt?: string | null; endedAt?: string | null }
  | { action: "addAddress"; kind: AddressKind; value: string; clientId?: string | null }
  /** «Заменить контакт в сделках X» (Q9): open deals of `clientId` with this
   *  contact → the replacement (same role) or none (`null` = remove). */
  | { action: "replaceInDeals"; clientId: string; replacementContactId: string | null }
  | { action: "removeAddress"; addressId: string }
  | { action: "addressStatus"; addressId: string; status: "active" | "old" }

/** POST /api/contact-link-proposals/[id] body. */
export type ProposalDecisionBody = {
  decision: ProposalDecision
  relation?: LinkRelation | null
  primaryClientId?: string | null
  /** «Создать компанию Y» (left / unknown Y): name of the new client. */
  createCompanyName?: string | null
}

/** Russian text of a journal event. */
export function linkEventText(kind: string, p: Record<string, unknown>): string {
  const s = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "")
  switch (kind) {
    case "link_added":
      return `Добавлена компания ${s("clientName")}${s("relation") ? ` (${LINK_RELATION_LABELS[s("relation") as LinkRelation] ?? s("relation")})` : ""}`
    case "link_ended":
      return `Больше не в ${s("clientName")}${s("endReason") ? ` — ${s("endReason")}` : ""}`
    case "link_reopened":
      return `Снова в ${s("clientName")}`
    case "primary_changed":
      return s("clientName") ? `Основная компания: ${s("clientName")}` : "Нет основной компании"
    case "link_edited":
      return `Изменены данные связи с ${s("clientName")}`
    case "address_added":
      return `Добавлен адрес ${s("value")}`
    case "address_removed":
      return `Удалён адрес ${s("value")}`
    case "address_status":
      return `Адрес ${s("value")}: ${s("status") === "old" ? "старый" : "действующий"}`
    case "proposal_decided":
      return `Решение: ${s("decisionLabel")}`
    case "deals_replaced":
      return `Заменён в сделках ${s("clientName")}${s("replacementName") ? ` на ${s("replacementName")}` : ""}`
    case "merged":
      return `Объединён с записью «${s("mergedName")}»`
    default:
      return kind
  }
}

export const DECISION_LABELS: Record<ProposalDecision, string> = {
  moved: "Перешёл в другую компанию",
  both: "Работает с обеими",
  other_person: "Это другой человек",
  snooze: "Не сейчас",
}

/** Contact name keys (for the discovery P5 hint). */
export function contactNameKeys(c: { name: string; nameNative: string | null; aliases: string[] | null }): string[] {
  const out = new Set<string>()
  for (const n of [c.name, c.nameNative ?? "", ...(c.aliases ?? [])]) {
    if (!n || n.trim().startsWith("@")) continue
    const k = personMatchKey(n)
    if (k.length >= 2) out.add(k)
  }
  return [...out]
}

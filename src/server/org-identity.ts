import "server-only"

// Sync views of the one «us» resolver `getOwnOrgContext`
// (src/server/identity/own-org.ts) in the two older shapes the consumers
// use: `ownOrgIdentityFromContext` (discovery + parse-time company
// stripping) and `orgIdentityFromContext` (authorship attribution). The
// callers load the context ONCE and map it here (identity I4; the async
// loaders `loadOwnOrgIdentity` / `getOrgIdentity` were deleted 2026-11-15).
// Plus `loadOrgStaffNames` (input of the attribution judge).

import { and, asc, eq, or, isNull } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { member, user } from "@/db/schema"
import type { OwnOrgContext } from "@/server/identity/own-org"
import { humanUsersOnly } from "@/server/topics/system-actor"

/**
 * The CRM owner's OWN identity for discovery + parse-time company stripping:
 * own domains, company match keys (names + domain-derived keys) and — since
 * I2 — own email addresses (members, staff extra addresses, shared
 * mailboxes), so a staff address on a free-mail domain never becomes a
 * contact.
 */
export type OwnOrgIdentity = {
  /** True when `domain` is (or is a sub/parent of) one of the owner's domains. */
  isOwnDomain: (domain: string) => boolean
  /** True when `key` is one of the owner's company match-keys. */
  isOwnCompanyKey: (key: string) => boolean
  /**
   * True when the address is «us»: a member sign-in email, a staff extra
   * email, a shared mailbox, or an address on an own domain.
   */
  isOwnEmail: (email: string) => boolean
  /** Whether the org carried any usable identity at all. */
  hasIdentity: boolean
}

const EMPTY_OWN_ORG: OwnOrgIdentity = {
  hasIdentity: false,
  isOwnDomain: () => false,
  isOwnCompanyKey: () => false,
  isOwnEmail: () => false,
}

/** `OwnOrgIdentity` view of an already loaded context (no I/O). */
export function ownOrgIdentityFromContext(ctx: OwnOrgContext | null): OwnOrgIdentity {
  if (!ctx) return EMPTY_OWN_ORG
  const keys = new Set(ctx.identity.companyKeys)
  const id = ctx.identity
  return {
    hasIdentity:
      id.ownDomains.length > 0 ||
      keys.size > 0 ||
      id.memberEmails.length + id.staffEmails.length + id.mailboxes.length > 0,
    isOwnDomain: (domain: string) => ctx.isOwnDomain(domain),
    isOwnCompanyKey: (key: string) => !!key && keys.has(key),
    isOwnEmail: (email: string) => ctx.matchEmail(email) !== null,
  }
}

// ── Org identity for authorship attribution (refs/org-attribution.md) ──
//
// Who counts as «us» for the parse-time author classifier
// (src/server/parsers/org-attribution.ts).
export type OrgIdentity = {
  organizationId: string
  name: string | null
  url: string | null
  address: string | null
  // Owned mail domains: own domains (website, registry websites / email
  // domains, org email domain) + the members' non-free-mail domains.
  emailDomains: string[]
  // Lowercased human-member emails (agent service accounts excluded).
  memberEmails: Set<string>
  // Staff extra emails (registry `person`, channel email) — any domain.
  staffEmails: Set<string>
  // Shared mailboxes (registry `mailbox`) — exact addresses.
  mailboxes: Set<string>
  // Staff Telegram handles (no «@», lower-case).
  staffTelegram: Set<string>
  // Extra trading names / synonyms, as entered (judge prompt).
  nameAliases: string[]
  // Every own website host: `web_url` + registry `website` (rule 4).
  webDomains: string[]
  // Address match keys (`organization.address` + registry `address`).
  addressKeys: string[]
  // The same addresses as entered, for the judge prompt.
  addressLabels: string[]
}

/** `OrgIdentity` view of an already loaded context (no I/O); null = no org. */
export function orgIdentityFromContext(ctx: OwnOrgContext | null): OrgIdentity | null {
  if (!ctx || !ctx.exists) return null
  const id = ctx.identity
  return {
    organizationId: ctx.organizationId,
    name: ctx.name || null,
    url: ctx.org.webUrl,
    address: ctx.org.address,
    emailDomains: [...id.ownDomains],
    memberEmails: new Set(id.memberEmails),
    staffEmails: new Set(id.staffEmails),
    mailboxes: new Set(id.mailboxes),
    staffTelegram: new Set(id.staffTelegram),
    nameAliases: id.nameLabels.slice(ctx.name ? 1 : 0),
    webDomains: id.webDomains,
    addressKeys: id.addressKeys,
    addressLabels: id.addressLabels,
  }
}

const STAFF_NAMES_MAX = 40

/**
 * Display names of the org's human members (identity spec I4: input of the
 * `parsing.org_attribution` judge). Never the system actor «Агент»
 * (`humanUsersOnly()`), never banned users. Org-explicit, no session; read
 * only when the judge actually runs.
 */
export async function loadOrgStaffNames(orgId: string): Promise<string[]> {
  const rows = await db
    .select({ name: user.name })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(
      and(
        eq(member.organizationId, orgId),
        humanUsersOnly(),
        or(isNull(user.banned), eq(user.banned, false)),
      ),
    )
    .orderBy(asc(member.createdAt))
  const seen = new Set<string>()
  const out: string[] = []
  for (const r of rows) {
    const name = (r.name ?? "").trim()
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    out.push(name)
    if (out.length >= STAFF_NAMES_MAX) break
  }
  return out
}

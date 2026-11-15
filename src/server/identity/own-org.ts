import "server-only"

// One «us» resolver (identity spec I2, docs/specs/identity/01-specification.md
// §3.5). Org-explicit, cron-safe (no session). Every deterministic consumer of
// «who is us» reads it: org attribution and parse-time company stripping
// (src/server/parse-source-item.ts via src/server/org-identity.ts), discovery,
// signal extraction (`allInternal`), the topics gate (I3) and — from I4 — the
// prompts (`promptCard`).
//
// Cache: 5 min per org per server instance. `invalidateOwnOrgContext(orgId)`
// drops it — call after every profile / registry / member / org-record change.

import { asc, eq } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { industry, member, organization, orgIdentityEntry, orgProfile, user } from "@/db/schema"
import {
  EMPTY_ORG_PROFILE,
  MARKET_ROLES,
  profileCompleteness,
  type Completeness,
  type MarketRole,
  type OrgProfileInput,
} from "@/lib/identity/org-profile"
import {
  buildOwnOrgIdentitySets,
  domainInSet,
  matchOwnEmail,
  type OwnAddressMatch,
  type OwnOrgIdentitySets,
} from "@/lib/identity/own-org-sets"
import { buildPromptCard } from "@/lib/identity/prompt-card"

export type OwnOrgContext = {
  organizationId: string
  /** False when the organization row does not exist (empty context). */
  exists: boolean
  name: string
  /** The organization record fields «us» is built from. */
  org: { webUrl: string | null; email: string | null; address: string | null }
  /** Normalised identity sets (see §3.5 and src/lib/identity/own-org-sets.ts). */
  identity: OwnOrgIdentitySets
  profile: OrgProfileInput
  industryLabel: string | null
  completeness: Completeness
  /** Russian block «О нашей компании» for prompts (deterministic, ≤ 1,500 chars). */
  promptCard: string
  /** Address check (exact sets, then own domains). Attribution adds member domains. */
  matchEmail: (email: string) => OwnAddressMatch
  /** Domain (or a subdomain of it) is one of the own domains. */
  isOwnDomain: (domain: string) => boolean
  loadedAt: number
}

const TTL_MS = 5 * 60 * 1000
const cache = new Map<string, { value: OwnOrgContext; expires: number }>()
const inflight = new Map<string, Promise<OwnOrgContext>>()

function asStrings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []
}

function asLines<T extends { name: string }>(v: unknown): T[] {
  if (!Array.isArray(v)) return []
  return v.filter(
    (x): x is T => !!x && typeof x === "object" && typeof (x as { name?: unknown }).name === "string",
  )
}

async function loadContext(organizationId: string): Promise<OwnOrgContext> {
  const [orgRows, memberRows, registryRows, profileRows] = await Promise.all([
    db
      .select({
        name: organization.name,
        webUrl: organization.webUrl,
        email: organization.email,
        address: organization.address,
      })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1),
    db
      .select({ email: user.email, role: user.role })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(member.organizationId, organizationId)),
    db
      .select({
        kind: orgIdentityEntry.kind,
        matchKey: orgIdentityEntry.matchKey,
        label: orgIdentityEntry.label,
        channel: orgIdentityEntry.channel,
      })
      .from(orgIdentityEntry)
      .where(eq(orgIdentityEntry.organizationId, organizationId))
      .orderBy(asc(orgIdentityEntry.createdAt)),
    db
      .select({ p: orgProfile, industryLabel: industry.labelRu })
      .from(orgProfile)
      .leftJoin(industry, eq(industry.code, orgProfile.industryCode))
      .where(eq(orgProfile.organizationId, organizationId))
      .limit(1),
  ])
  const org = orgRows[0] ?? null
  const identity = buildOwnOrgIdentitySets({
    org,
    members: memberRows,
    registry: registryRows,
    noOwnDomain: !!profileRows[0]?.p.noOwnDomain,
  })

  const row = profileRows[0]
  const profile: OrgProfileInput = row
    ? {
        description: row.p.description ?? null,
        industryCode: row.p.industryCode ?? null,
        industryNote: row.p.industryNote ?? null,
        marketRoles: asStrings(row.p.marketRoles).filter((r): r is MarketRole =>
          (MARKET_ROLES as readonly string[]).includes(r),
        ),
        products: asLines(row.p.products),
        targetCustomers: asLines(row.p.targetCustomers),
        supplierTypes: asLines(row.p.supplierTypes),
        geography: row.p.geography ?? null,
        glossary: Array.isArray(row.p.glossary)
          ? row.p.glossary.filter(
              (g) => !!g && typeof g.term === "string" && typeof g.meaning === "string",
            )
          : [],
        noOwnDomain: !!row.p.noOwnDomain,
      }
    : { ...EMPTY_ORG_PROFILE }
  const industryLabel = row?.industryLabel ?? null
  const name = (org?.name ?? "").trim()

  const completeness = profileCompleteness({
    orgName: org ? name : null,
    ownDomainCount: identity.ownDomains.length,
    profile,
  })
  const promptCard = org
    ? buildPromptCard({
        name,
        otherNames: identity.nameLabels.slice(name ? 1 : 0),
        industryLabel,
        profile,
      })
    : ""

  return {
    organizationId,
    exists: !!org,
    name,
    org: { webUrl: org?.webUrl ?? null, email: org?.email ?? null, address: org?.address ?? null },
    identity,
    profile,
    industryLabel,
    completeness,
    promptCard,
    matchEmail: (email) => matchOwnEmail(identity, email),
    isOwnDomain: (domain) => domainInSet((domain ?? "").trim().toLowerCase(), identity.ownDomains),
    loadedAt: Date.now(),
  }
}

/** The org's «us» context (5-min cache per org; invalidate on changes). */
export async function getOwnOrgContext(organizationId: string): Promise<OwnOrgContext> {
  const now = Date.now()
  const hit = cache.get(organizationId)
  if (hit && hit.expires > now) return hit.value
  const pending = inflight.get(organizationId)
  if (pending) return pending
  const p = loadContext(organizationId)
    .then((value) => {
      // A newer invalidation during the load wins: only cache when still current.
      if (inflight.get(organizationId) === p) {
        cache.set(organizationId, { value, expires: Date.now() + TTL_MS })
      }
      return value
    })
    .finally(() => {
      if (inflight.get(organizationId) === p) inflight.delete(organizationId)
    })
  inflight.set(organizationId, p)
  return p
}

/** Drop the cached context (call after every profile / registry / member change). */
export function invalidateOwnOrgContext(organizationId: string): void {
  cache.delete(organizationId)
  inflight.delete(organizationId)
}

/** Completeness of the mandatory minimum (spec §3.3) — used by the UI and the gate. */
export async function getOrgCompleteness(organizationId: string): Promise<Completeness> {
  return (await getOwnOrgContext(organizationId)).completeness
}

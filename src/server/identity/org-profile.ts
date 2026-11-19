// Own organization profile («Профиль организации», identity spec I1, §3).
// Org-explicit core (`getOrgProfileView`, `saveOrgProfile`, `getOrgProfileBanner`)
// + session-bound wrappers (`*ForSession`) that take the org and the user from
// the session, never from input. Rules (§3.4): any member reads; only the org
// OWNER saves (typed 403). Every save writes ONE `org_profile_log` row with the
// before / after of the changed fields and drops the «us» cache
// (`invalidateOwnOrgContext`). Completeness comes from the one «us» resolver
// (`getOrgCompleteness`, src/server/identity/own-org.ts).
//
// `import "server-only"`, NOT `"use server"` (rule 5: org / user ids as params).
import "server-only"

import { randomUUID } from "crypto"
import { and, asc, desc, eq, isNotNull, ne } from "drizzle-orm"
import { db } from "@/db/drizzle"
import {
  industry,
  member,
  organization,
  orgIdentityEntry,
  orgProfile,
  orgProfileLog,
  product,
  user,
} from "@/db/schema"
import { getServerSession } from "@/lib/get-session"
import {
  EMPTY_ORG_PROFILE,
  orgProfileInputSchema,
  type Completeness,
  type OrgProfileInput,
} from "@/lib/identity/org-profile"
import {
  ORG_PROFILE_FIELDS,
  canonicalOrgProfile,
  diffOrgProfile,
  type OrgProfileField,
} from "@/lib/identity/org-profile-log"
import { getOrgCompleteness, getOwnOrgContext, invalidateOwnOrgContext } from "@/server/identity/own-org"
import type { OrgIdentityEntryView } from "@/server/org-identity-registry"
import { humanUsersOnly } from "@/server/topics/system-actor"
import { getTopicsMode, type TopicsMode } from "@/server/topics/mode"
import { loadAttentionParams } from "@/server/topics/attention/store"
import { getOrgSetting, setOrgSetting } from "@/server/org-settings"
import { withWorkingContext, workingContextInputSchema, type WorkingContextInput } from "@/lib/identity/working-context"
import type { PersonChannel } from "@/lib/identity/org-profile"

export class OrgProfileError extends Error {
  constructor(
    public readonly status: 400 | 401 | 403 | 404,
    message: string,
  ) {
    super(message)
    this.name = "OrgProfileError"
  }
}

// ── Reads ─────────────────────────────────────────────────────────────

export type IndustryOption = { code: string; label: string }

/** Active «Отрасль» values, by sort order. */
export async function listIndustries(): Promise<IndustryOption[]> {
  const rows = await db
    .select({ code: industry.code, label: industry.labelRu })
    .from(industry)
    .where(eq(industry.isActive, true))
    .orderBy(asc(industry.sort), asc(industry.labelRu))
  return rows
}

type ProfileRow = typeof orgProfile.$inferSelect

function rowToInput(r: ProfileRow): OrgProfileInput {
  return canonicalOrgProfile({
    description: r.description,
    industryCode: r.industryCode,
    industryNote: r.industryNote,
    marketRoles: (r.marketRoles ?? []) as OrgProfileInput["marketRoles"],
    products: r.products ?? [],
    targetCustomers: r.targetCustomers ?? [],
    supplierTypes: r.supplierTypes ?? [],
    geography: r.geography,
    glossary: r.glossary ?? [],
    noOwnDomain: r.noOwnDomain,
  })
}

/** The stored profile (or EMPTY_ORG_PROFILE) + meta. */
export async function readOrgProfile(orgId: string): Promise<{
  profile: OrgProfileInput
  updatedAt: Date | null
  updatedByUserId: string | null
}> {
  const rows = await db.select().from(orgProfile).where(eq(orgProfile.organizationId, orgId)).limit(1)
  const r = rows[0]
  if (!r) return { profile: EMPTY_ORG_PROFILE, updatedAt: null, updatedByUserId: null }
  return { profile: rowToInput(r), updatedAt: r.updatedAt, updatedByUserId: r.updatedByUserId }
}

/** Distinct non-empty `product.category` of the org (catalogue link of a product line). */
export async function listOrgProductCategories(orgId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ category: product.category })
    .from(product)
    .where(and(eq(product.organizationId, orgId), isNotNull(product.category), ne(product.category, "")))
    .orderBy(asc(product.category))
  return rows.map((r) => r.category!).filter(Boolean)
}

export type OrgProfileMember = {
  userId: string
  name: string
  email: string
  role: string
  /**
   * The sign-in email counts as «us»: it is on an own domain, or the org has
   * no own domain. Otherwise (a test user, a private gmail) it does not — the
   * member adds a work address if needed.
   */
  signInCounts: boolean
  entries: OrgIdentityEntryView[]
}

export type OrgProfileHistoryRow = {
  id: string
  at: string
  byName: string | null
  changed: OrgProfileField[]
  before: Partial<OrgProfileInput>
  after: Partial<OrgProfileInput>
}

export type OrgProfileView = {
  organizationId: string
  viewerUserId: string
  /** Org OWNER — edits the profile and the org-level registry kinds. */
  canManage: boolean
  profile: OrgProfileInput
  updatedAt: string | null
  updatedByName: string | null
  industries: IndustryOption[]
  productCategories: string[]
  completeness: Completeness
  topicsMode: TopicsMode
  identity: {
    orgName: string
    webUrl: string | null
    email: string | null
    address: string | null
    /** Org-level registry entries by kind (oldest first). */
    entries: {
      name: OrgIdentityEntryView[]
      website: OrgIdentityEntryView[]
      email_domain: OrgIdentityEntryView[]
      mailbox: OrgIdentityEntryView[]
      address: OrgIdentityEntryView[]
    }
    /** Human, not banned members with their extra addresses (kind `person`). */
    members: OrgProfileMember[]
  }
  /** Group C: org time zone + working hours (`attention.params`); the org owner edits it (2026-11-19). */
  workingContext: { timeZone: string; workStart: string; workEnd: string }
  history: OrgProfileHistoryRow[]
}

function entryView(r: typeof orgIdentityEntry.$inferSelect): OrgIdentityEntryView {
  return {
    id: r.id,
    kind: r.kind,
    matchKey: r.matchKey,
    label: r.label,
    note: r.note,
    userId: r.userId ?? null,
    channel: (r.channel as PersonChannel | null) ?? null,
    createdAt: r.createdAt.toISOString(),
  }
}

/** Everything the «Профиль организации» tab shows, for `viewerUserId`. */
export async function getOrgProfileView(orgId: string, viewerUserId: string): Promise<OrgProfileView> {
  const [orgRows, viewer, stored, industries, categories, entries, members, params, logRows, topicsMode, ownCtx] =
    await Promise.all([
      db
        .select({ name: organization.name, webUrl: organization.webUrl, email: organization.email, address: organization.address })
        .from(organization)
        .where(eq(organization.id, orgId))
        .limit(1),
      db
        .select({ role: member.role })
        .from(member)
        .where(and(eq(member.organizationId, orgId), eq(member.userId, viewerUserId)))
        .limit(1),
      readOrgProfile(orgId),
      listIndustries(),
      listOrgProductCategories(orgId),
      db
        .select()
        .from(orgIdentityEntry)
        .where(eq(orgIdentityEntry.organizationId, orgId))
        .orderBy(asc(orgIdentityEntry.createdAt)),
      db
        .select({ userId: member.userId, role: member.role, name: user.name, email: user.email, banned: user.banned })
        .from(member)
        .innerJoin(user, eq(user.id, member.userId))
        .where(and(eq(member.organizationId, orgId), humanUsersOnly()))
        .orderBy(asc(user.name)),
      loadAttentionParams(orgId),
      db
        .select({
          id: orgProfileLog.id,
          at: orgProfileLog.createdAt,
          byName: user.name,
          before: orgProfileLog.before,
          after: orgProfileLog.after,
        })
        .from(orgProfileLog)
        .leftJoin(user, eq(user.id, orgProfileLog.changedByUserId))
        .where(eq(orgProfileLog.organizationId, orgId))
        .orderBy(desc(orgProfileLog.createdAt))
        .limit(20),
      getTopicsMode(orgId),
      getOwnOrgContext(orgId),
    ])
  const completeness = ownCtx.completeness
  const countedEmails = new Set(ownCtx.identity.memberEmails)

  const org = orgRows[0]
  if (!org) throw new OrgProfileError(404, "Организация не найдена")
  if (!viewer[0]) throw new OrgProfileError(403, "Вы не участник этой организации")

  const byKind = {
    name: [] as OrgIdentityEntryView[],
    website: [] as OrgIdentityEntryView[],
    email_domain: [] as OrgIdentityEntryView[],
    mailbox: [] as OrgIdentityEntryView[],
    address: [] as OrgIdentityEntryView[],
  }
  const personByUser = new Map<string, OrgIdentityEntryView[]>()
  for (const r of entries) {
    const v = entryView(r)
    if (r.kind === "person") {
      if (!r.userId) continue
      const list = personByUser.get(r.userId) ?? []
      list.push(v)
      personByUser.set(r.userId, list)
    } else {
      byKind[r.kind].push(v)
    }
  }

  let updatedByName: string | null = null
  if (stored.updatedByUserId) {
    const u = await db.select({ name: user.name }).from(user).where(eq(user.id, stored.updatedByUserId)).limit(1)
    updatedByName = u[0]?.name ?? null
  }

  return {
    organizationId: orgId,
    viewerUserId,
    canManage: viewer[0].role === "owner",
    profile: stored.profile,
    updatedAt: stored.updatedAt?.toISOString() ?? null,
    updatedByName,
    industries,
    productCategories: categories,
    completeness,
    topicsMode,
    identity: {
      orgName: org.name,
      webUrl: org.webUrl,
      email: org.email,
      address: org.address,
      entries: byKind,
      members: members
        .filter((m) => !m.banned)
        .map((m) => ({
          userId: m.userId,
          name: m.name,
          email: m.email,
          role: m.role,
          signInCounts: countedEmails.has((m.email ?? "").trim().toLowerCase()),
          entries: personByUser.get(m.userId) ?? [],
        })),
    },
    workingContext: { timeZone: params.timeZone, workStart: params.workStart, workEnd: params.workEnd },
    history: logRows.map((r) => {
      const before = (r.before ?? {}) as Partial<OrgProfileInput>
      const after = (r.after ?? {}) as Partial<OrgProfileInput>
      // jsonb does not keep key order — list the fields in the form order.
      const keys = new Set([...Object.keys(before), ...Object.keys(after)])
      const changed = ORG_PROFILE_FIELDS.filter((f) => keys.has(f))
      return { id: r.id, at: r.at.toISOString(), byName: r.byName ?? null, changed, before, after }
    }),
  }
}

// ── Save ──────────────────────────────────────────────────────────────

export type SaveOrgProfileResult = {
  changed: OrgProfileField[]
  profile: OrgProfileInput
}

/**
 * Save the profile as `userId` (must be the org OWNER → else 403). Validates
 * with `orgProfileInputSchema` (400 with the first message), checks the
 * industry code, upserts `org_profile` and writes one `org_profile_log` row
 * (before / after of the changed fields) in one batch. A save with no change
 * writes nothing.
 */
export async function saveOrgProfile(orgId: string, input: unknown, userId: string): Promise<SaveOrgProfileResult> {
  const role = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)))
    .limit(1)
  if (role[0]?.role !== "owner") {
    throw new OrgProfileError(403, "Профиль организации может менять только владелец")
  }

  const parsed = orgProfileInputSchema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new OrgProfileError(400, issue?.message ? `Некорректные данные: ${issue.message}` : "Некорректные данные")
  }
  const next = canonicalOrgProfile(parsed.data)

  if (next.industryCode) {
    const ok = await db
      .select({ code: industry.code })
      .from(industry)
      .where(and(eq(industry.code, next.industryCode), eq(industry.isActive, true)))
      .limit(1)
    if (!ok[0]) throw new OrgProfileError(400, "Неизвестная отрасль")
  }

  const { profile: before } = await readOrgProfile(orgId)
  const diff = diffOrgProfile(before, next)
  if (diff.changed.length === 0) return { changed: [], profile: before }

  const now = new Date()
  const values = {
    description: next.description,
    industryCode: next.industryCode,
    industryNote: next.industryNote,
    marketRoles: next.marketRoles,
    products: next.products,
    targetCustomers: next.targetCustomers,
    supplierTypes: next.supplierTypes,
    geography: next.geography,
    glossary: next.glossary,
    noOwnDomain: next.noOwnDomain,
    updatedByUserId: userId,
    updatedAt: now,
  }
  await db.batch([
    db
      .insert(orgProfile)
      .values({ organizationId: orgId, ...values })
      .onConflictDoUpdate({ target: orgProfile.organizationId, set: values }),
    db.insert(orgProfileLog).values({
      id: randomUUID(),
      organizationId: orgId,
      changedByUserId: userId,
      before: diff.before,
      after: diff.after,
      createdAt: now,
    }),
  ])
  invalidateOwnOrgContext(orgId)
  return { changed: diff.changed, profile: next }
}

// ── Banner ────────────────────────────────────────────────────────────

export type OrgProfileBanner = {
  /** Show the banner: the viewer is the org owner and the minimum is incomplete. */
  show: boolean
  /** Red: the org already runs topics `shadow` / `on`. */
  severe: boolean
  done: number
  total: number
}

export async function getOrgProfileBanner(orgId: string, userId: string): Promise<OrgProfileBanner> {
  const role = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)))
    .limit(1)
  if (role[0]?.role !== "owner") return { show: false, severe: false, done: 0, total: 0 }
  const [c, mode] = await Promise.all([getOrgCompleteness(orgId), getTopicsMode(orgId)])
  return { show: !c.complete, severe: mode !== "off", done: c.done, total: c.total }
}

// ── Session wrappers ──────────────────────────────────────────────────

async function requireSession(): Promise<{ orgId: string; userId: string }> {
  const session = await getServerSession()
  const orgId = session?.session.activeOrganizationId
  if (!session || !orgId) throw new OrgProfileError(401, "Unauthorized")
  return { orgId, userId: session.user.id }
}

export async function getOrgProfileViewForSession(): Promise<OrgProfileView> {
  const { orgId, userId } = await requireSession()
  return getOrgProfileView(orgId, userId)
}

export async function saveOrgProfileForSession(input: unknown): Promise<SaveOrgProfileResult> {
  const { orgId, userId } = await requireSession()
  return saveOrgProfile(orgId, input, userId)
}

/**
 * «Рабочий контекст» (2026-11-19): the org OWNER sets the time zone and the
 * working hours. Stored as the org override of `attention.params` (only these
 * keys change; org_setting_log keeps the history); every reader goes through
 * `loadAttentionParams` (60 s cache), the topics run re-computes attention on
 * the next run (the parameter hash changes).
 */
export async function saveWorkingContext(orgId: string, input: unknown, userId: string): Promise<WorkingContextInput> {
  const role = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)))
    .limit(1)
  if (role[0]?.role !== "owner") {
    throw new OrgProfileError(403, "Рабочий контекст может менять только владелец организации")
  }
  const parsed = workingContextInputSchema.safeParse(input)
  if (!parsed.success) throw new OrgProfileError(400, parsed.error.issues[0]?.message ?? "Некорректные данные")
  const current = (await getOrgSetting(orgId, "attention.params")) as Record<string, unknown> | null
  await setOrgSetting(orgId, "attention.params", withWorkingContext(current, parsed.data), userId)
  return parsed.data
}

export async function saveWorkingContextForSession(input: unknown): Promise<WorkingContextInput> {
  const { orgId, userId } = await requireSession()
  return saveWorkingContext(orgId, input, userId)
}

export async function getOrgProfileBannerForSession(): Promise<OrgProfileBanner> {
  const { orgId, userId } = await requireSession()
  return getOrgProfileBanner(orgId, userId)
}

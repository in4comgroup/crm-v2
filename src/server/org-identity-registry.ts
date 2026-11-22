// Own-organisation identity registry — the dictionary of extra names /
// synonyms, websites, mail domains, shared mailboxes, postal addresses and
// staff addresses that mean "this is US" (identity spec I1, §3.1 A).
//
// The `organization` row (name / web_url / address / email) stays the
// PRIMARY identity; this registry is additive, and exists because those
// columns are single-valued.
//
// Kinds and who may write them:
//   name | website | email_domain | mailbox | address → org OWNER only;
//   person (user_id + channel email | telegram | phone) → the member for
//     THEMSELVES, or the owner for any member; never the system actor «Агент».
// Normalisation per kind: src/lib/identity/registry.ts (pure, unit-tested).
//
// Read path: the one «us» resolver `getOwnOrgContext`
// (src/server/identity/own-org.ts).
// Every write drops its cache (`invalidateOwnOrgContext`).
//
// Org-explicit core (`*ForOrg`) + session-bound wrappers that take the org from
// the session. IMPORTANT: `import "server-only"`, NOT `"use server"` (rule 5).
import "server-only"

import { randomUUID } from "crypto"
import { and, desc, eq, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import {
  client,
  contact,
  member,
  orgIdentityEntry,
  user,
  type OrgIdentityKind,
  contactAddress,
} from "@/db/schema"
import { getServerSession } from "@/lib/get-session"
import { companyMatchKey } from "@/lib/translit-ru"
import { addressMatchesText } from "@/lib/address-match"
import {
  domainMatches,
  extractEmailDomain,
  extractWebsiteDomain,
} from "@/lib/email-domain"
import {
  ORG_LEVEL_IDENTITY_KINDS,
  normaliseIdentityInput,
  normalisePhone,
  type IdentityKind,
} from "@/lib/identity/registry"
import type { PersonChannel } from "@/lib/identity/org-profile"
import { getOwnOrgContext, invalidateOwnOrgContext } from "@/server/identity/own-org"
import { isAgentRole } from "@/server/topics/system-actor"
import { contactDisplaySql } from "@/server/contact-display"

export class OrgIdentityError extends Error {
  constructor(
    public readonly reason:
      | "unauthorized"
      | "forbidden"
      | "not_found"
      | "bad_request"
      | "conflict",
    message: string,
  ) {
    super(message)
    this.name = "OrgIdentityError"
  }
}

export function orgIdentityErrorStatus(e: OrgIdentityError): number {
  switch (e.reason) {
    case "unauthorized":
      return 401
    case "forbidden":
      return 403
    case "not_found":
      return 404
    case "conflict":
      return 409
    default:
      return 400
  }
}

// ── Normalisation (kept for older callers; the pure helper is the source) ──

/**
 * Canonical form per kind, or null when the value can't produce a usable key.
 * `person` needs a channel — use `normaliseIdentityInput` for it.
 */
export function normaliseIdentityValue(
  kind: OrgIdentityKind,
  raw: string,
  channel?: PersonChannel | null,
): { matchKey: string; label: string } | null {
  const r = normaliseIdentityInput(kind as IdentityKind, raw, channel)
  return r.ok ? { matchKey: r.matchKey, label: r.label } : null
}

// ── Auth ──────────────────────────────────────────────────────────────

/** The user's role in the org (null = not a member). */
export async function orgMemberRole(orgId: string, userId: string): Promise<string | null> {
  const rows = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)))
    .limit(1)
  return rows[0]?.role ?? null
}

async function requireSessionMember(): Promise<{ orgId: string; userId: string; role: string }> {
  const session = await getServerSession()
  const orgId = session?.session.activeOrganizationId
  if (!session || !orgId) throw new OrgIdentityError("unauthorized", "Unauthorized")
  const role = await orgMemberRole(orgId, session.user.id)
  if (!role) throw new OrgIdentityError("forbidden", "Вы не участник этой организации")
  return { orgId, userId: session.user.id, role }
}

function isOrgLevelKind(kind: OrgIdentityKind): boolean {
  return (ORG_LEVEL_IDENTITY_KINDS as readonly string[]).includes(kind)
}

const OWNER_ONLY_MESSAGE = "Только владелец организации может менять реестр"

// ── Read ──────────────────────────────────────────────────────────────

export type OrgIdentityEntryView = {
  id: string
  kind: OrgIdentityKind
  matchKey: string
  label: string
  note: string | null
  /** Kind `person`: the staff member and the channel of the address. */
  userId: string | null
  channel: PersonChannel | null
  createdAt: string
}

function toView(r: typeof orgIdentityEntry.$inferSelect): OrgIdentityEntryView {
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

/** Every registry entry of the org, newest first. */
export async function listOrgIdentityEntriesForOrg(orgId: string): Promise<OrgIdentityEntryView[]> {
  const rows = await db
    .select()
    .from(orgIdentityEntry)
    .where(eq(orgIdentityEntry.organizationId, orgId))
    .orderBy(desc(orgIdentityEntry.createdAt))
  return rows.map(toView)
}

/** One member's extra addresses (kind `person`), oldest first. */
export async function listPersonEntriesForOrg(orgId: string, userId: string): Promise<OrgIdentityEntryView[]> {
  const rows = await db
    .select()
    .from(orgIdentityEntry)
    .where(
      and(
        eq(orgIdentityEntry.organizationId, orgId),
        eq(orgIdentityEntry.kind, "person"),
        eq(orgIdentityEntry.userId, userId),
      ),
    )
    .orderBy(orgIdentityEntry.createdAt)
  return rows.map(toView)
}

/** Session: any member reads the registry. */
export async function listOrgIdentityEntries(): Promise<OrgIdentityEntryView[]> {
  const { orgId } = await requireSessionMember()
  return listOrgIdentityEntriesForOrg(orgId)
}

/** Session: the caller's own extra addresses + sign-in email (/profile). */
export async function listMyWorkAddresses(): Promise<{
  entries: OrgIdentityEntryView[]
  signInEmail: string
  organizationId: string
}> {
  const { orgId, userId } = await requireSessionMember()
  const [entries, me] = await Promise.all([
    listPersonEntriesForOrg(orgId, userId),
    db.select({ email: user.email }).from(user).where(eq(user.id, userId)).limit(1),
  ])
  return { entries, signInEmail: me[0]?.email ?? "", organizationId: orgId }
}

// True when the caller may manage the org-level kinds (UI gating; the
// mutations are the real gate). Never throws.
export async function canManageOrgIdentity(): Promise<boolean> {
  try {
    const { role } = await requireSessionMember()
    return role === "owner"
  } catch {
    return false
  }
}

// ── Retroactive matches (report-only, never mutates) ──────────────────

export type IdentityMatch = {
  id: string
  name: string
  detail: string | null
  status: string
}

export type IdentityMatches = {
  clients: IdentityMatch[]
  contacts: IdentityMatch[]
}

const hidden = (status: string) => status === "deleted"

/**
 * Existing clients / contacts that this entry says are actually US — i.e. rows
 * discovery should never have created. Deliberately REPORT-ONLY: unlike the
 * blocklist's sweep, nothing is mutated here, because a wrongly-created client
 * may already carry deals or orders. The UI shows the list and the owner
 * decides row by row (soft-delete via the existing PUT /api/clients).
 *
 * Already soft-deleted rows are omitted — they are out of the way already.
 */
export async function findIdentityMatches(
  orgId: string,
  kind: OrgIdentityKind,
  matchKey: string,
  channel?: PersonChannel | null,
): Promise<IdentityMatches> {
  const out: IdentityMatches = { clients: [], contacts: [] }
  if (!matchKey) return out

  if (kind === "name") {
    const rows = await db
      .select({ id: client.id, name: client.name, aliases: client.aliases, webUrl: client.webUrl, status: client.status })
      .from(client)
      .where(eq(client.organizationId, orgId))
    out.clients = rows
      .filter((c) => !hidden(c.status))
      .filter(
        (c) =>
          companyMatchKey(c.name) === matchKey ||
          (c.aliases ?? []).some((a) => companyMatchKey(a) === matchKey),
      )
      .map((c) => ({ id: c.id, name: c.name, detail: c.webUrl, status: c.status }))
    return out
  }

  if (kind === "website" || kind === "email_domain") {
    const clientRows = await db
      .select({ id: client.id, name: client.name, webUrl: client.webUrl, email: client.email, status: client.status })
      .from(client)
      .where(eq(client.organizationId, orgId))
    const hostMatches = (d: string) =>
      !!d && (d === matchKey || domainMatches(d, matchKey) || domainMatches(matchKey, d))
    out.clients = clientRows
      .filter((c) => !hidden(c.status))
      .filter(
        (c) =>
          hostMatches(extractWebsiteDomain(c.webUrl ?? "")) ||
          hostMatches(extractEmailDomain(c.email ?? "")),
      )
      .map((c) => ({ id: c.id, name: c.name, detail: c.webUrl ?? c.email, status: c.status }))

    const contactRows = await db
      .select({ id: contact.id, name: contactDisplaySql(), email: contact.email, status: contact.status })
      .from(contact)
      .where(eq(contact.organizationId, orgId))
    out.contacts = contactRows
      .filter((c) => !hidden(c.status))
      .filter((c) => hostMatches(extractEmailDomain(c.email ?? "")))
      .map((c) => ({ id: c.id, name: c.name, detail: c.email, status: c.status }))
    return out
  }

  // An exact address: a shared mailbox, or a staff member's extra email.
  if (kind === "mailbox" || (kind === "person" && channel === "email")) {
    const [clientRows, contactRows] = await Promise.all([
      db
        .select({ id: client.id, name: client.name, email: client.email, status: client.status })
        .from(client)
        .where(and(eq(client.organizationId, orgId), sql`lower(${client.email}) = ${matchKey}`)),
      db
        .select({ id: contact.id, name: contactDisplaySql(), email: contact.email, status: contact.status })
        .from(contact)
        .where(and(eq(contact.organizationId, orgId), sql`lower(${contact.email}) = ${matchKey}`)),
    ])
    out.clients = clientRows
      .filter((c) => !hidden(c.status))
      .map((c) => ({ id: c.id, name: c.name, detail: c.email, status: c.status }))
    out.contacts = contactRows
      .filter((c) => !hidden(c.status))
      .map((c) => ({ id: c.id, name: c.name, detail: c.email, status: c.status }))
    return out
  }

  if (kind === "person") {
    // Telegram «@handle» lives in contact aliases; phones in contact.phone.
    const rows = await db
      .select({ id: contact.id, name: contactDisplaySql(), aliases: contact.aliases, phone: contact.phone, status: contact.status })
      .from(contact)
      .where(eq(contact.organizationId, orgId))
    // Telegram also in contact «Адреса» (docs/specs/telegram/04 §6.3).
    const tgContacts =
      channel === "telegram"
        ? new Set(
            (
              await db
                .select({ id: contactAddress.contactId })
                .from(contactAddress)
                .where(and(eq(contactAddress.organizationId, orgId), eq(contactAddress.kind, "telegram"), eq(contactAddress.value, matchKey)))
            ).map((r) => r.id),
          )
        : new Set<string>()
    out.contacts = rows
      .filter((c) => !hidden(c.status))
      .filter((c) =>
        channel === "telegram"
          ? tgContacts.has(c.id) || (c.aliases ?? []).some((a) => a.trim().toLowerCase() === "@" + matchKey)
          : channel === "phone"
            ? !!c.phone && normalisePhone(c.phone) === matchKey
            : false,
      )
      .map((c) => ({
        id: c.id,
        name: c.name,
        detail: channel === "phone" ? c.phone : "@" + matchKey,
        status: c.status,
      }))
    return out
  }

  // address — compare the stored client address through the same token matcher.
  const rows = await db
    .select({ id: client.id, name: client.name, address: client.address, status: client.status })
    .from(client)
    .where(eq(client.organizationId, orgId))
  out.clients = rows
    .filter((c) => !hidden(c.status))
    .filter((c) => !!c.address && addressMatchesText(matchKey, c.address))
    .map((c) => ({ id: c.id, name: c.name, detail: c.address, status: c.status }))
  return out
}

// ── Mutations ─────────────────────────────────────────────────────────

export type AddOrgIdentityResult = {
  added: number
  entry: OrgIdentityEntryView | null
  matches: IdentityMatches
}

export type AddOrgIdentityInput = {
  kind: OrgIdentityKind
  value: string
  note?: string | null
  /** Kind `person`: whose address (default = the actor). */
  userId?: string | null
  /** Kind `person`: email | telegram | phone. */
  channel?: string | null
}

function invalidate(orgId: string): void {
  // The one «us» resolver.
  invalidateOwnOrgContext(orgId)
}

/**
 * Add an entry as `actorUserId` in `orgId`. Rules: org-level kinds → owner
 * only; `person` → the actor for themselves, or the owner for any human
 * member. Idempotent per (org, kind, match_key); a staff address already
 * claimed by ANOTHER member is a conflict (409).
 */
export async function addOrgIdentityEntryForOrg(
  orgId: string,
  actorUserId: string,
  input: AddOrgIdentityInput,
): Promise<AddOrgIdentityResult> {
  const actorRole = await orgMemberRole(orgId, actorUserId)
  if (!actorRole) throw new OrgIdentityError("forbidden", "Вы не участник этой организации")
  const isOwner = actorRole === "owner"

  let targetUserId: string | null = null
  if (isOrgLevelKind(input.kind)) {
    if (!isOwner) throw new OrgIdentityError("forbidden", OWNER_ONLY_MESSAGE)
  } else if (input.kind === "person") {
    targetUserId = input.userId?.trim() || actorUserId
    if (targetUserId !== actorUserId && !isOwner) {
      throw new OrgIdentityError("forbidden", "Добавлять адреса другим сотрудникам может только владелец")
    }
    const target = await db
      .select({ role: member.role, userRole: user.role, email: user.email })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(and(eq(member.organizationId, orgId), eq(member.userId, targetUserId)))
      .limit(1)
    if (!target[0] || isAgentRole(target[0].userRole)) {
      throw new OrgIdentityError("bad_request", "Сотрудник не найден в организации")
    }
  } else {
    throw new OrgIdentityError("bad_request", "Некорректный тип")
  }

  const norm = normaliseIdentityInput(input.kind as IdentityKind, input.value, input.channel)
  if (!norm.ok) throw new OrgIdentityError("bad_request", norm.error)

  if (input.kind === "person" && norm.channel === "email") {
    // A member's sign-in email that ALREADY counts as «us» (on an own domain,
    // or the org has no own domain) — a second copy only confuses. A sign-in
    // email that does not count (e.g. a private gmail in an org with its own
    // domain) may be added explicitly as a work address.
    const counted = (await getOwnOrgContext(orgId)).identity.memberEmails.includes(norm.matchKey)
    const signIn = !counted ? [] : await db
      .select({ name: user.name })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(and(eq(member.organizationId, orgId), sql`lower(${user.email}) = ${norm.matchKey}`))
      .limit(1)
    if (signIn[0]) {
      throw new OrgIdentityError(
        "conflict",
        `Это адрес входа сотрудника «${signIn[0].name}» — он уже учитывается`,
      )
    }
  }

  const inserted = await db
    .insert(orgIdentityEntry)
    .values({
      id: randomUUID(),
      organizationId: orgId,
      kind: input.kind,
      matchKey: norm.matchKey,
      label: norm.label,
      note: (input.note ?? "").trim() || null,
      userId: targetUserId,
      channel: norm.channel,
      createdByUserId: actorUserId,
    })
    .onConflictDoNothing()
    .returning()

  const row = inserted[0]
  if (!row && input.kind === "person") {
    const existing = await db
      .select({ userId: orgIdentityEntry.userId, name: user.name })
      .from(orgIdentityEntry)
      .leftJoin(user, eq(user.id, orgIdentityEntry.userId))
      .where(
        and(
          eq(orgIdentityEntry.organizationId, orgId),
          eq(orgIdentityEntry.kind, "person"),
          eq(orgIdentityEntry.matchKey, norm.matchKey),
        ),
      )
      .limit(1)
    if (existing[0] && existing[0].userId !== targetUserId) {
      throw new OrgIdentityError(
        "conflict",
        `Этот адрес уже указан у сотрудника «${existing[0].name ?? "—"}»`,
      )
    }
  }

  if (row) invalidate(orgId)

  // Report-only, and computed even when the row already existed — re-adding is
  // a legitimate way to re-check the blast radius.
  const matches = await findIdentityMatches(orgId, input.kind, norm.matchKey, norm.channel)
  return { added: row ? 1 : 0, entry: row ? toView(row) : null, matches }
}

/** Delete an entry: org-level kinds → owner; `person` → its member or the owner. */
export async function removeOrgIdentityEntryForOrg(
  orgId: string,
  actorUserId: string,
  id: string,
): Promise<void> {
  const actorRole = await orgMemberRole(orgId, actorUserId)
  if (!actorRole) throw new OrgIdentityError("forbidden", "Вы не участник этой организации")
  const rows = await db
    .select({ kind: orgIdentityEntry.kind, userId: orgIdentityEntry.userId })
    .from(orgIdentityEntry)
    .where(and(eq(orgIdentityEntry.id, id), eq(orgIdentityEntry.organizationId, orgId)))
    .limit(1)
  const row = rows[0]
  if (!row) throw new OrgIdentityError("not_found", "Запись не найдена")
  const allowed =
    actorRole === "owner" || (row.kind === "person" && row.userId === actorUserId)
  if (!allowed) {
    throw new OrgIdentityError(
      "forbidden",
      row.kind === "person" ? "Удалять адреса других сотрудников может только владелец" : OWNER_ONLY_MESSAGE,
    )
  }
  await db
    .delete(orgIdentityEntry)
    .where(and(eq(orgIdentityEntry.id, id), eq(orgIdentityEntry.organizationId, orgId)))
  invalidate(orgId)
}

/** Session: add an entry in the caller's active org. */
export async function addOrgIdentityEntry(input: AddOrgIdentityInput): Promise<AddOrgIdentityResult> {
  const { orgId, userId } = await requireSessionMember()
  return addOrgIdentityEntryForOrg(orgId, userId, input)
}

/** Session: delete an entry in the caller's active org. */
export async function removeOrgIdentityEntry(id: string): Promise<void> {
  const { orgId, userId } = await requireSessionMember()
  await removeOrgIdentityEntryForOrg(orgId, userId, id)
}

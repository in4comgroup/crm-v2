import "server-only"

import { and, eq, inArray, ne, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { client, member, user } from "@/db/schema"
import { getServerSession } from "@/lib/get-session"
import {
  HANDOVER_NOTE_KEY,
  checkResponsibleChange,
  normalizeHandoverReason,
  readHandoverNote,
  type ResponsibleChange,
  type ResponsibleMember,
} from "@/lib/client-responsible"
import { humanUsersOnly } from "@/server/topics/system-actor"

// «Ответственный» (Responsible) on a company — server side. Rules are the
// pure `checkResponsibleChange` (src/lib/client-responsible.ts):
//   • the org OWNER sets any human, not banned member (clears a pending
//     handover);
//   • the current responsible member who is not an owner can only hand the
//     company over to an owner (`responsible_handover_from_user_id = self`,
//     optional reason kept in `custom_fields.responsibleHandover` while the
//     handover is pending — there is no client journal table);
//   • everybody else: read only.
// Org-explicit core (`*Core`, `listResponsibleMembers`, …) + session-bound
// wrappers (`setClientResponsible`, `handoverClientToOwner`,
// `getResponsibleOptions`) that take the org from the session, never input.
// This module is NOT "use server" (rule 5): the routes call it.

export class ClientResponsibleError extends Error {
  constructor(
    public readonly status: 400 | 401 | 403 | 404,
    message: string,
  ) {
    super(message)
    this.name = "ClientResponsibleError"
  }
}

/** Human members of the org (never the system actor «Агент»), with their org role. */
export async function listResponsibleMembers(orgId: string): Promise<ResponsibleMember[]> {
  const rows = await db
    .select({
      userId: member.userId,
      role: member.role,
      name: user.name,
      email: user.email,
      banned: user.banned,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, orgId), humanUsersOnly()))
    .orderBy(user.name)
  return rows.map((r) => ({
    userId: r.userId,
    role: r.role,
    name: r.name,
    email: r.email,
    banned: !!r.banned,
  }))
}

/** user id → name for the given ids (any user, incl. former members). */
export async function loadUserNames(userIds: (string | null | undefined)[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))]
  const out = new Map<string, string>()
  if (ids.length === 0) return out
  const rows = await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, ids))
  for (const r of rows) out.set(r.id, r.name)
  return out
}

/** Responsible fields every company row carries to the UI (`ClientRow`, `ClientDetail`). */
export type ClientResponsibleInfo = {
  responsibleUserId: string | null
  responsibleName: string | null
  responsibleChangedAt: string | null
  responsibleHandoverFromUserId: string | null
  responsibleHandoverFromName: string | null
  /** Reason of the pending handover (null when none / not given). */
  responsibleHandoverReason: string | null
}

type ResponsibleColumns = {
  responsibleUserId: string | null
  responsibleChangedAt: Date | null
  responsibleHandoverFromUserId: string | null
  customFields: unknown
}

export function responsibleInfoOf(
  row: ResponsibleColumns,
  names: Map<string, string>,
): ClientResponsibleInfo {
  const handoverFrom = row.responsibleHandoverFromUserId
  return {
    responsibleUserId: row.responsibleUserId,
    responsibleName: row.responsibleUserId ? (names.get(row.responsibleUserId) ?? null) : null,
    responsibleChangedAt: row.responsibleChangedAt ? row.responsibleChangedAt.toISOString() : null,
    responsibleHandoverFromUserId: handoverFrom,
    responsibleHandoverFromName: handoverFrom ? (names.get(handoverFrom) ?? null) : null,
    responsibleHandoverReason: handoverFrom ? (readHandoverNote(row.customFields)?.reason ?? null) : null,
  }
}

/** Names for a batch of company rows (responsible + handover sender). */
export function loadResponsibleNames(rows: ResponsibleColumns[]): Promise<Map<string, string>> {
  return loadUserNames(rows.flatMap((r) => [r.responsibleUserId, r.responsibleHandoverFromUserId]))
}

async function loadClientForChange(orgId: string, clientId: string) {
  const [row] = await db
    .select({
      id: client.id,
      name: client.name,
      organizationId: client.organizationId,
      status: client.status,
      responsibleUserId: client.responsibleUserId,
      responsibleHandoverFromUserId: client.responsibleHandoverFromUserId,
      customFields: client.customFields,
    })
    .from(client)
    .where(eq(client.id, clientId))
    .limit(1)
  if (!row) throw new ClientResponsibleError(404, "Компания не найдена")
  if (row.organizationId !== orgId) throw new ClientResponsibleError(404, "Компания не найдена")
  return row
}

export type ResponsibleChangeResult = {
  clientId: string
  responsibleUserId: string
  responsibleHandoverFromUserId: string | null
  changed: boolean
}

async function applyChange(
  orgId: string,
  actorUserId: string,
  clientId: string,
  change: ResponsibleChange,
  reasonRaw?: unknown,
): Promise<ResponsibleChangeResult> {
  const [row, members] = await Promise.all([
    loadClientForChange(orgId, clientId),
    listResponsibleMembers(orgId),
  ])
  const actorRole = members.find((m) => m.userId === actorUserId)?.role ?? null
  const check = checkResponsibleChange(
    { userId: actorUserId, role: actorRole },
    { responsibleUserId: row.responsibleUserId },
    change,
    members,
  )
  if (!check.ok) throw new ClientResponsibleError(check.status, check.error)

  const now = new Date()
  const fields = { ...((row.customFields ?? {}) as Record<string, unknown>) }
  let handoverFrom: string | null
  if (change.kind === "assign") {
    handoverFrom = null
    delete fields[HANDOVER_NOTE_KEY]
    // Same responsible and no pending handover → nothing to write.
    if (row.responsibleUserId === check.targetUserId && !row.responsibleHandoverFromUserId) {
      return { clientId, responsibleUserId: check.targetUserId, responsibleHandoverFromUserId: null, changed: false }
    }
  } else {
    handoverFrom = actorUserId
    fields[HANDOVER_NOTE_KEY] = { reason: normalizeHandoverReason(reasonRaw), at: now.toISOString() }
  }

  await db
    .update(client)
    .set({
      responsibleUserId: check.targetUserId,
      responsibleChangedAt: now,
      responsibleChangedByUserId: actorUserId,
      responsibleHandoverFromUserId: handoverFrom,
      customFields: fields,
    })
    .where(and(eq(client.id, clientId), eq(client.organizationId, orgId)))

  // Notifications (docs/specs/notifications §4): a handover → the receiving
  // owner (important); a decision (assign) closes the pending handover.
  const { notify, resolveNotifications } = await import("@/server/notifications/engine")
  if (change.kind === "handover") {
    const fromName = (await loadUserNames([actorUserId])).get(actorUserId) ?? null
    const reason = readHandoverNote(fields)?.reason ?? null
    await notify(orgId, {
      kind: "client.handover",
      userIds: [check.targetUserId],
      title: `Компания передана вам: ${row.name}`,
      body: [fromName ? `от ${fromName}` : null, reason].filter(Boolean).join(" · ") || null,
      href: `/clients?openClient=${clientId}`,
      entity: { type: "client", id: clientId },
      dedupeKey: `client.handover:${clientId}:${now.getTime()}`,
    })
  } else {
    await resolveNotifications(orgId, `client.handover:${clientId}:`, { prefix: true })
  }

  return { clientId, responsibleUserId: check.targetUserId, responsibleHandoverFromUserId: handoverFrom, changed: true }
}

/** Owner sets the responsible member (org-explicit core). */
export function setClientResponsibleCore(
  orgId: string,
  actorUserId: string,
  clientId: string,
  targetUserId: string,
): Promise<ResponsibleChangeResult> {
  if (!targetUserId) throw new ClientResponsibleError(400, "Не выбран ответственный")
  return applyChange(orgId, actorUserId, clientId, { kind: "assign", targetUserId })
}

/** Responsible non-owner hands the company over to an owner (org-explicit core). */
export function handoverClientToOwnerCore(
  orgId: string,
  actorUserId: string,
  clientId: string,
  opts: { ownerUserId?: string | null; reason?: string | null } = {},
): Promise<ResponsibleChangeResult> {
  return applyChange(orgId, actorUserId, clientId, { kind: "handover", ownerUserId: opts.ownerUserId ?? null }, opts.reason)
}

export type HandoverForOwner = {
  clientId: string
  clientName: string
  fromUserId: string
  fromName: string | null
  reason: string | null
  at: Date
}

/**
 * Companies handed over to `ownerUserId` that still wait for their decision
 * (bell notifications). Newest first; `since` limits to newer handovers.
 */
export async function listPendingHandoversForOwner(
  orgId: string,
  ownerUserId: string,
  opts: { since?: Date; limit?: number } = {},
): Promise<HandoverForOwner[]> {
  const fromUser = sql`(select ${user.name} from ${user} where ${user.id} = ${client.responsibleHandoverFromUserId})`
  const rows = await db
    .select({
      clientId: client.id,
      clientName: client.name,
      fromUserId: client.responsibleHandoverFromUserId,
      fromName: sql<string | null>`${fromUser}`,
      customFields: client.customFields,
      at: client.responsibleChangedAt,
    })
    .from(client)
    .where(
      and(
        eq(client.organizationId, orgId),
        eq(client.responsibleUserId, ownerUserId),
        sql`${client.responsibleHandoverFromUserId} is not null`,
        ne(client.status, "deleted"),
        ne(client.status, "blocked"),
        opts.since ? sql`${client.responsibleChangedAt} > ${opts.since}` : undefined,
      ),
    )
    .orderBy(sql`${client.responsibleChangedAt} desc nulls last`)
    .limit(opts.limit ?? 50)
  return rows.map((r) => ({
    clientId: r.clientId,
    clientName: r.clientName,
    fromUserId: r.fromUserId!,
    fromName: r.fromName,
    reason: readHandoverNote(r.customFields)?.reason ?? null,
    at: r.at ?? new Date(0),
  }))
}

// ── Session-bound wrappers (org from the session, never from input) ─────

async function requireSessionOrg(): Promise<{ orgId: string; userId: string }> {
  const session = await getServerSession()
  if (!session) throw new ClientResponsibleError(401, "Нужно войти в систему")
  const orgId = session.session.activeOrganizationId
  if (!orgId) throw new ClientResponsibleError(401, "Нет активной организации")
  return { orgId, userId: session.user.id }
}

export async function setClientResponsible(clientId: string, targetUserId: string) {
  const { orgId, userId } = await requireSessionOrg()
  return setClientResponsibleCore(orgId, userId, clientId, targetUserId)
}

export async function handoverClientToOwner(
  clientId: string,
  opts: { ownerUserId?: string | null; reason?: string | null },
) {
  const { orgId, userId } = await requireSessionOrg()
  return handoverClientToOwnerCore(orgId, userId, clientId, opts)
}

export type ResponsibleOptions = {
  viewerUserId: string
  /** Viewer's org role (owner | admin | member), null when not a member. */
  viewerRole: string | null
  /** Human members of the active org (banned ones flagged, not offered). */
  members: ResponsibleMember[]
}

/** Data the «Ответственный» controls + the feed filter need (any member). */
export async function getResponsibleOptions(): Promise<ResponsibleOptions> {
  const { orgId, userId } = await requireSessionOrg()
  const members = await listResponsibleMembers(orgId)
  return {
    viewerUserId: userId,
    viewerRole: members.find((m) => m.userId === userId)?.role ?? null,
    members,
  }
}

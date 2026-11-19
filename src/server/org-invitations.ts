"use server"

// Owner-side list of the active org's pending invitations. Kept out of
// src/server/invitations.ts on purpose: that module is imported by
// src/lib/auth.ts, and this one needs the session (src/lib/get-session →
// src/lib/auth) — one module for both would be an import cycle.

import { db } from "@/db/drizzle"
import { invitation, member, user } from "@/db/schema"
import { and, desc, eq } from "drizzle-orm"
import { getServerSession } from "@/lib/get-session"
import {
  isInvitationExpired,
  selectPendingInvitations,
  type OrgPendingInvitation,
} from "@/lib/invitations"

export type PendingInvitationsResult =
  | {
      ok: true
      organizationId: string
      invitations: (OrgPendingInvitation & { expired: boolean })[]
    }
  | { ok: false; reason: "unauthorized" | "forbidden" }

/**
 * Pending invitations of the caller's ACTIVE organization (block
 * «Приглашения» on /account → «Участники»). Org OWNER only; the org comes
 * from the session, never from input. Accepted / rejected / canceled
 * invitations are left out; expired ones stay (flag `expired`) so the owner
 * can send them again. Adds the inviter's name — better-auth's own
 * `listInvitations` has no inviter name and lets every member read the list.
 */
export async function listPendingInvitations(): Promise<PendingInvitationsResult> {
  const session = await getServerSession()
  if (!session?.user) return { ok: false, reason: "unauthorized" }
  const organizationId = session.session.activeOrganizationId
  if (!organizationId) return { ok: false, reason: "forbidden" }

  const own = await db
    .select({ role: member.role })
    .from(member)
    .where(
      and(
        eq(member.userId, session.user.id),
        eq(member.organizationId, organizationId),
      ),
    )
    .limit(1)
  if (own[0]?.role !== "owner") return { ok: false, reason: "forbidden" }

  const rows = await db
    .select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
      inviterName: user.name,
      inviterEmail: user.email,
    })
    .from(invitation)
    .leftJoin(user, eq(user.id, invitation.inviterId))
    .where(
      and(
        eq(invitation.organizationId, organizationId),
        eq(invitation.status, "pending"),
      ),
    )
    .orderBy(desc(invitation.createdAt))
    .limit(500)

  const now = new Date()
  const invitations = selectPendingInvitations(rows, now).map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role,
    status: r.status,
    expiresAt: r.expiresAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    inviterName: r.inviterName || r.inviterEmail || null,
    expired: isInvitationExpired(r.expiresAt, now),
  }))
  return { ok: true, organizationId, invitations }
}

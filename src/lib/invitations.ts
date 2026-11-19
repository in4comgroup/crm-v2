// Pending organization invitations — pure helpers shared by the server list
// (src/server/invitations.ts) and the «Приглашения» block on /account.

/** One pending invitation of the active org, as the owner's list shows it. */
export type OrgPendingInvitation = {
  id: string
  email: string
  role: string | null
  status: string
  expiresAt: string
  createdAt: string
  inviterName: string | null
}

/** True when the invitation's link no longer works because time ran out. */
export function isInvitationExpired(
  expiresAt: string | Date,
  now: Date = new Date(),
): boolean {
  const t = new Date(expiresAt).getTime()
  if (Number.isNaN(t)) return false
  return t <= now.getTime()
}

/**
 * Only invitations that are still `pending` (not accepted / rejected /
 * canceled), newest first. Expired ones stay in the list — the owner sees
 * them with an «Истекло» badge and can send them again — unless the same
 * e-mail already has a NEWER pending invitation: better-auth's
 * `inviteMember({ resend: true })` refreshes only a non-expired invitation;
 * for an expired one it creates a new row and leaves the old one `pending`.
 */
export function selectPendingInvitations<
  T extends {
    email: string
    status: string
    createdAt: string | Date
    expiresAt: string | Date
  },
>(rows: readonly T[], now: Date = new Date()): T[] {
  const pending = rows
    .filter((r) => r.status === "pending")
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
  const seen = new Set<string>()
  const out: T[] = []
  for (const r of pending) {
    const key = r.email.trim().toLowerCase()
    if (seen.has(key) && isInvitationExpired(r.expiresAt, now)) continue
    seen.add(key)
    out.push(r)
  }
  return out
}

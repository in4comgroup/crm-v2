import "server-only"

import { isNull, ne, or, type SQL } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { user } from "@/db/schema"

// Per-org system actor «Агент» (spec 01 §13, open question Q14 → a).
// Automatic writes of the topics engine (deals, tasks, activities …) need a
// user id because those columns are NOT NULL and cron has no session. Every
// org gets ONE synthetic `user` row:
//   • id     `agent-<orgId>` (deterministic → no lookup table needed),
//   • name   «Агент», email `agent+<orgId>@agents.invalid` (RFC 2606
//            reserved TLD — never deliverable),
//   • role   `agent` (not `user` / `admin`, so no platform rights),
//   • banned with a reason — better-auth refuses to create a session for a
//            banned user, so the account can never sign in (email OTP incl.).
// It is NOT a `member` of the org (no better-auth org rights), and it is
// inserted with Drizzle directly, NOT via better-auth — that bypasses the
// `databaseHooks.user.create.*` hooks, so no default org is created for it.
//
// Hidden from human-facing user lists: every list that starts from
// `member` skips it by construction (not a member); the remaining lists
// filter with `humanUsersOnly()` below or `role <> 'agent'`.

export const AGENT_USER_ROLE = "agent"

/** Deterministic user id of the org's system actor. */
export function systemActorId(organizationId: string): string {
  return `agent-${organizationId}`
}

/** True for a synthetic agent account (`user.role = 'agent'`). */
export function isAgentRole(role: string | null | undefined): boolean {
  return role === AGENT_USER_ROLE
}

/**
 * Drizzle predicate that keeps human users only (`role` is null-safe:
 * a plain `role <> 'agent'` would also drop rows with a NULL role).
 */
export function humanUsersOnly(): SQL {
  return or(isNull(user.role), ne(user.role, AGENT_USER_ROLE)) as SQL
}

// Orgs whose actor row is known to exist in this server instance. The insert
// is idempotent anyway; the cache only saves a round-trip per hourly run.
const ensured = new Set<string>()

/**
 * Creates the org's system actor on first use (insert … on conflict do
 * nothing) and returns its user id. Safe to call on every run.
 */
export async function ensureSystemActor(organizationId: string): Promise<string> {
  const id = systemActorId(organizationId)
  if (ensured.has(organizationId)) return id
  await db
    .insert(user)
    .values({
      id,
      name: "Агент",
      email: `agent+${organizationId}@agents.invalid`,
      emailVerified: false,
      role: AGENT_USER_ROLE,
      banned: true,
      banReason:
        "System account of the topics engine (automatic writes). It cannot sign in.",
    })
    .onConflictDoNothing()
  ensured.add(organizationId)
  return id
}

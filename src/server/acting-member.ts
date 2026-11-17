import "server-only"

import { AsyncLocalStorage } from "node:async_hooks"
import { eq } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { organization, user } from "@/db/schema"

// «Act as this member» for server code that has NO browser session but a
// verified identity of a member — today the Telegram bot (a press on «Создать»
// of a draft card, docs/specs/ai-chat-telegram §8): the session-bound record
// functions (`createClient`, `createTask`, …) read `getServerSession()`,
// which returns this scoped session first. The scope is one async call chain
// (AsyncLocalStorage); it never leaks to other requests. ONLY call it after
// the caller verified the member (active binding + org membership).

type ActingSession = { session: Record<string, unknown>; user: Record<string, unknown> }

const store = new AsyncLocalStorage<ActingSession>()

/** The scoped session of `runAsMember`, else null (read by `getServerSession`). */
export function actingMemberSession(): ActingSession | null {
  return store.getStore() ?? null
}

/** Run `fn` as the member in the org (a synthetic session: same user, active org = orgId). */
export async function runAsMember<T>(orgId: string, userId: string, via: string, fn: () => Promise<T>): Promise<T> {
  const [u] = await db.select().from(user).where(eq(user.id, userId)).limit(1)
  if (!u || u.banned) throw new Error("Unauthorized")
  const [o] = await db.select({ id: organization.id, name: organization.name, slug: organization.slug }).from(organization).where(eq(organization.id, orgId)).limit(1)
  if (!o) throw new Error("No active organization")
  const now = new Date()
  const acting: ActingSession = {
    user: { ...u },
    session: {
      id: `acting:${via}`,
      userId: u.id,
      token: "",
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + 10 * 60_000),
      ipAddress: null,
      userAgent: via,
      activeOrganizationId: o.id,
      activeOrganizationName: o.name,
      activeOrganizationSlug: o.slug,
    },
  }
  return store.run(acting, fn)
}

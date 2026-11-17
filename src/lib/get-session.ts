import { auth } from "@/lib/auth"
import { backfillSessionActiveOrganization } from "@/server/session-org-backfill"
import { actingMemberSession } from "@/server/acting-member"
import { headers } from "next/headers"
import { cache } from "react"

// chache() deduplicates repeated calls for the session, for example, from the header and the page

const sessionFromRequest = cache(async () => {
  const session = await auth.api.getSession({
    headers: await headers(),
  })
  if (!session) return session

  // Backfill activeOrganization* on the session if missing.
  //
  // The `session.create.before` hook in src/lib/auth.ts only fires at
  // sign-in time, so a user who joined an org AFTER their session was
  // created (e.g. a platform admin who was added as a member by another
  // admin without going through the invitation flow) keeps a session
  // row with activeOrganizationId = null forever. That leaks into the
  // sidebar ("No organization") and breaks every server-side check
  // that reads `session.session.activeOrganizationId`.
  //
  // Fix: lazily look up the user's first membership and persist it
  // back to the session row (src/server/session-org-backfill.ts).
  if (!session.session.activeOrganizationId) {
    const org = await backfillSessionActiveOrganization(session.session.id, session.user.id)
    if (org) {
      // Decorate the in-flight return so the current request sees the org
      // without waiting for the next read. Better-auth's `additionalFields`
      // types these as `string`, but the DB columns are nullable; we mirror
      // the nullable shape at runtime via `Object.assign` (avoids per-key
      // TS narrowing).
      Object.assign(session.session, {
        activeOrganizationId: org.id,
        activeOrganizationName: org.name,
        activeOrganizationSlug: org.slug,
      })
    }
  }

  return session
})

type ServerSession = Awaited<ReturnType<typeof sessionFromRequest>>

/**
 * The signed-in session — or, inside `runAsMember` (src/server/acting-member.ts),
 * the scoped session of a member verified by other means (the Telegram bot,
 * docs/specs/ai-chat-telegram §8). The scoped one wins and never reads headers.
 */
export async function getServerSession(): Promise<ServerSession> {
  const acting = actingMemberSession()
  if (acting) return acting as unknown as ServerSession
  return sessionFromRequest()
}

import { headers } from "next/headers"
import { APIError } from "better-auth/api"
import { auth } from "@/lib/auth"
import { getServerSession } from "@/lib/get-session"
import { findUserOrganization } from "@/server/organizations"

// Organization switcher (sidebar footer) — platform admins only. The list of
// memberships is loaded server-side by (protected)/layout.tsx.
// POST { organizationId } → { organization } makes it the active
// org of the CURRENT session through better-auth's setActiveOrganization, which
// rewrites the session row (the session-update hook in src/lib/auth.ts adds
// name + slug) and the signed cookie cache, so the next request sees the new org.

async function adminSession() {
  const session = await getServerSession()
  if (!session?.user) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) }
  if (session.user.role !== "admin") {
    return { error: Response.json({ error: "Доступно только администраторам платформы" }, { status: 403 }) }
  }
  return { session }
}

export async function POST(req: Request) {
  const r = await adminSession()
  if (r.error) return r.error

  let organizationId: unknown
  try {
    organizationId = ((await req.json()) as { organizationId?: unknown }).organizationId
  } catch {
    return Response.json({ error: "Неверный запрос" }, { status: 400 })
  }
  if (typeof organizationId !== "string" || !organizationId.trim()) {
    return Response.json({ error: "Не указана организация" }, { status: 400 })
  }

  // Membership first: better-auth's setActive CLEARS the session's active org
  // when the target is not a membership, before it refuses.
  const org = await findUserOrganization(r.session.user.id, organizationId)
  if (!org) {
    return Response.json({ error: "Вы не участник этой организации" }, { status: 403 })
  }

  try {
    // nextCookies() copies the new session cookies onto this response.
    await auth.api.setActiveOrganization({
      body: { organizationId: org.id },
      headers: await headers(),
    })
  } catch (e) {
    if (e instanceof APIError) {
      console.error("[active-organization] setActive refused:", e.status, e.message)
      return Response.json({ error: "Не удалось сменить организацию" }, { status: 400 })
    }
    console.error("[active-organization] setActive failed:", e)
    return Response.json({ error: "Не удалось сменить организацию" }, { status: 500 })
  }

  return Response.json({ organization: org })
}

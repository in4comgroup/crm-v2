import { getServerSession } from "@/lib/get-session"
import { getChatLimitState } from "@/server/chat/limit"

// GET /api/chat/status → { limit: { blocked, message, resetsAt } } — what the
// AI chat panel checks when it opens (docs/specs/ai-chat Q15): at 100 % of
// the org's monthly AI limit the chat shows the message and no input. Any
// member of the active org; the org comes from the session.
export async function GET() {
  const session = await getServerSession()
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const orgId = session.session.activeOrganizationId
  if (!orgId) return Response.json({ error: "No active organization" }, { status: 403 })
  try {
    return Response.json({ limit: await getChatLimitState(orgId) })
  } catch (error) {
    console.error("[chat/status] failed", error)
    // A status hiccup must not lock the chat: report "not blocked".
    return Response.json({ limit: { blocked: false, message: null, resetsAt: null } })
  }
}

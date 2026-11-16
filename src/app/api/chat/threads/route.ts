import { getServerSession } from "@/lib/get-session"
import { listChatThreads } from "@/server/chat/threads"

// GET /api/chat/threads → { threads: [{ id, title, createdAt, lastMessageAt }] }
// The signed-in user's own chats in the active org, newest first
// (docs/specs/ai-chat §16.1). Org + user from the session.
export async function GET() {
  const session = await getServerSession()
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const orgId = session.session.activeOrganizationId
  if (!orgId) return Response.json({ error: "No active organization" }, { status: 403 })
  try {
    return Response.json({ threads: await listChatThreads(orgId, session.user.id) })
  } catch (error) {
    console.error("[chat/threads] list failed", error)
    return Response.json({ error: "Не удалось загрузить список чатов" }, { status: 500 })
  }
}

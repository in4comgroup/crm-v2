import { getServerSession } from "@/lib/get-session"
import { ChatFileError } from "@/server/chat/files"

// Session gate + error mapping of the AI chat file upload routes
// (docs/specs/ai-chat-tools §5.1). Org + user from the session.

export async function chatFileSession(): Promise<{ orgId: string; userId: string } | Response> {
  const session = await getServerSession()
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const orgId = session.session.activeOrganizationId
  if (!orgId) return Response.json({ error: "No active organization" }, { status: 403 })
  return { orgId, userId: session.user.id }
}

export function chatFileErrorResponse(e: unknown, where: string): Response {
  if (e instanceof ChatFileError) return Response.json({ error: e.message }, { status: e.status })
  console.error(`[chat/files] ${where} failed`, e)
  return Response.json({ error: "Не удалось загрузить файл" }, { status: 500 })
}

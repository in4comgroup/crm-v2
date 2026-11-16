import { getServerSession } from "@/lib/get-session"
import { isChatFeedback } from "@/lib/chat/thread"
import { setChatMessageFeedback } from "@/server/chat/threads"

// PUT /api/chat/feedback { messageId, feedback: "up" | "down" | null, comment? }
// Thumbs up / down on an answer of the user's own chat (docs/specs/ai-chat
// Q14). Down-voted answers feed the eval set (CH7).
export async function PUT(req: Request) {
  const session = await getServerSession()
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const orgId = session.session.activeOrganizationId
  if (!orgId) return Response.json({ error: "No active organization" }, { status: 403 })
  const body = (await req.json().catch(() => null)) as { messageId?: unknown; feedback?: unknown; comment?: unknown } | null
  const messageId = typeof body?.messageId === "string" && body.messageId.length <= 64 ? body.messageId : null
  const feedback = body?.feedback === null ? null : isChatFeedback(body?.feedback) ? body.feedback : undefined
  if (!messageId || feedback === undefined) return Response.json({ error: "Bad request" }, { status: 400 })
  const comment = typeof body?.comment === "string" ? body.comment : null
  try {
    const ok = await setChatMessageFeedback(orgId, session.user.id, messageId, feedback, comment)
    if (!ok) return Response.json({ error: "Ответ не найден" }, { status: 404 })
    return Response.json({ ok: true })
  } catch (error) {
    console.error("[chat/feedback] failed", error)
    return Response.json({ error: "Не удалось сохранить оценку" }, { status: 500 })
  }
}

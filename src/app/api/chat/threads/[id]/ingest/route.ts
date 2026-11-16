import { getServerSession } from "@/lib/get-session"
import { isThreadId } from "@/lib/chat/thread"
import { ingestChatThread } from "@/server/chat/ingest"
import { getChatThread } from "@/server/chat/threads"

// POST /api/chat/threads/[id]/ingest — «Передать в источники сейчас»
// (docs/specs/ai-chat Q24): the new messages of the user's own chat become a
// source item of the org's «AI Chat» source at once (no 30-minute wait).
// → { status: "ingested" | "nothing", message } · 409 when the chat has
// «Не передавать в источники» on · 404 for another user's chat.
export const maxDuration = 120

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession()
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const orgId = session.session.activeOrganizationId
  if (!orgId) return Response.json({ error: "No active organization" }, { status: 403 })
  const { id } = await params
  if (!isThreadId(id)) return Response.json({ error: "Чат не найден" }, { status: 404 })
  try {
    const thread = await getChatThread(orgId, session.user.id, id)
    if (!thread) return Response.json({ error: "Чат не найден" }, { status: 404 })
    if (thread.ingestMode === "off") {
      return Response.json({ error: "Для этого чата передача в источники выключена" }, { status: 409 })
    }
    const r = await ingestChatThread(id)
    if (r.status === "ingested") {
      return Response.json({
        status: "ingested",
        message: r.newInfo
          ? "Передано в источники. Новые сведения пойдут в темы и сделки."
          : "Передано в источники. Новых деловых сведений в беседе нет.",
      })
    }
    if (r.status === "budget") {
      return Response.json({ error: "Лимит ИИ организации исчерпан — передача выполнится позже" }, { status: 409 })
    }
    return Response.json({ status: "nothing", message: "Новых сообщений для передачи нет." })
  } catch (error) {
    console.error("[chat/ingest] failed", id, error)
    return Response.json({ error: "Не удалось передать чат в источники" }, { status: 500 })
  }
}

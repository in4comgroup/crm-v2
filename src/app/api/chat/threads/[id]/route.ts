import { getServerSession } from "@/lib/get-session"
import { cleanThreadTitle, isThreadId } from "@/lib/chat/thread"
import {
  deleteChatThread,
  getChatThread,
  loadChatMessages,
  renameChatThread,
  setChatThreadIngestMode,
} from "@/server/chat/threads"

// One chat of the signed-in user (docs/specs/ai-chat §16.1):
//   GET    → { thread, messages } (UI messages, last 60; feedback in metadata)
//   PATCH  { title } → rename | { ingestMode: on|off } → «Не передавать в источники» (CH6)
//   DELETE → «Удалить чат» (hidden at once; source items made from it stay, Q23)
// Another user's chat — also of the same org — is 404, like a missing one.

const NOT_FOUND = { error: "Чат не найден" }

async function context(params: Promise<{ id: string }>) {
  const session = await getServerSession()
  if (!session?.user) return { res: Response.json({ error: "Unauthorized" }, { status: 401 }) }
  const orgId = session.session.activeOrganizationId
  if (!orgId) return { res: Response.json({ error: "No active organization" }, { status: 403 }) }
  const { id } = await params
  if (!isThreadId(id)) return { res: Response.json(NOT_FOUND, { status: 404 }) }
  return { orgId, userId: session.user.id, id }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await context(params)
  if ("res" in c) return c.res
  try {
    const thread = await getChatThread(c.orgId, c.userId, c.id)
    if (!thread) return Response.json(NOT_FOUND, { status: 404 })
    return Response.json({ thread, messages: await loadChatMessages(c.id) })
  } catch (error) {
    console.error("[chat/threads] get failed", error)
    return Response.json({ error: "Не удалось загрузить чат" }, { status: 500 })
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await context(params)
  if ("res" in c) return c.res
  const body = (await req.json().catch(() => null)) as { title?: unknown; ingestMode?: unknown } | null
  try {
    // «Не передавать в источники» (CH6, §16.3).
    if (body?.ingestMode === "on" || body?.ingestMode === "off") {
      if (!(await setChatThreadIngestMode(c.orgId, c.userId, c.id, body.ingestMode))) {
        return Response.json(NOT_FOUND, { status: 404 })
      }
      return Response.json({ ok: true, ingestMode: body.ingestMode })
    }
    const title = cleanThreadTitle(body?.title)
    if (!title) return Response.json({ error: "Введите название чата" }, { status: 400 })
    if (!(await renameChatThread(c.orgId, c.userId, c.id, title))) return Response.json(NOT_FOUND, { status: 404 })
    return Response.json({ ok: true, title })
  } catch (error) {
    console.error("[chat/threads] update failed", error)
    return Response.json({ error: "Не удалось изменить чат" }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await context(params)
  if ("res" in c) return c.res
  try {
    if (!(await deleteChatThread(c.orgId, c.userId, c.id))) return Response.json(NOT_FOUND, { status: 404 })
    return Response.json({ ok: true })
  } catch (error) {
    console.error("[chat/threads] delete failed", error)
    return Response.json({ error: "Не удалось удалить чат" }, { status: 500 })
  }
}

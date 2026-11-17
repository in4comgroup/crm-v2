import { getServerSession } from "@/lib/get-session"
import { TelegramBindingError } from "@/server/telegram/bindings"
import { getMyTelegramView, linkMyTelegram, unlinkMyTelegram } from "@/server/telegram/account"

// The member's own Telegram binding (docs/specs/telegram/04 §5.2,
// docs/specs/ai-chat-telegram §13): GET the view; POST { action: "link" } →
// a one-time deep link (15 min); POST { action: "unlink" }. Org + user from
// the session.

async function ctx() {
  const session = await getServerSession()
  if (!session?.user) return null
  const orgId = session.session.activeOrganizationId
  if (!orgId) return null
  return { orgId, userId: session.user.id }
}

export async function GET() {
  const c = await ctx()
  if (!c) return Response.json({ error: "Unauthorized" }, { status: 401 })
  return Response.json({ view: await getMyTelegramView(c.orgId, c.userId) })
}

export async function POST(req: Request) {
  const c = await ctx()
  if (!c) return Response.json({ error: "Unauthorized" }, { status: 401 })
  let body: { action?: string }
  try {
    body = (await req.json()) as { action?: string }
  } catch {
    return Response.json({ error: "Неверный запрос" }, { status: 400 })
  }
  try {
    if (body.action === "link") return Response.json(await linkMyTelegram(c.orgId, c.userId))
    if (body.action === "unlink") {
      await unlinkMyTelegram(c.orgId, c.userId)
      return Response.json({ ok: true })
    }
    return Response.json({ error: "Неверный запрос" }, { status: 400 })
  } catch (e) {
    if (e instanceof TelegramBindingError) return Response.json({ error: e.message, code: e.code }, { status: e.code === "not_member" ? 403 : 409 })
    console.error("[api/account/telegram] failed", e)
    return Response.json({ error: "Не удалось выполнить действие" }, { status: 500 })
  }
}

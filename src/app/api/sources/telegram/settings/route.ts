import { getServerSession } from "@/lib/get-session"
import { TelegramAccountError, getTelegramSourceSettings, ownerUnbindTelegram, setTelegramAiChat } from "@/server/telegram/account"

// Settings of the org bot (docs/specs/ai-chat-telegram §13, Q1, §11):
// GET ?sourceId= → { settings } (any member; bound members for owners);
// PUT { sourceId, aiChatEnabled } (owner) — «ИИ-чат в Telegram»;
// POST { sourceId, action: "unbind", userId } (owner) — unbind a member.

async function ctx() {
  const session = await getServerSession()
  if (!session?.user) return null
  const orgId = session.session.activeOrganizationId
  if (!orgId) return null
  return { orgId, userId: session.user.id }
}

function fail(e: unknown) {
  if (e instanceof TelegramAccountError) return Response.json({ error: e.message }, { status: e.status })
  console.error("[api/sources/telegram/settings] failed", e)
  return Response.json({ error: "Не удалось выполнить действие" }, { status: 500 })
}

export async function GET(req: Request) {
  const c = await ctx()
  if (!c) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const sourceId = new URL(req.url).searchParams.get("sourceId") ?? ""
  if (!sourceId) return Response.json({ error: "Неверный запрос" }, { status: 400 })
  try {
    return Response.json({ settings: await getTelegramSourceSettings(c.orgId, c.userId, sourceId) })
  } catch (e) {
    return fail(e)
  }
}

export async function PUT(req: Request) {
  const c = await ctx()
  if (!c) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const body = (await req.json().catch(() => null)) as { sourceId?: unknown; aiChatEnabled?: unknown } | null
  if (!body || typeof body.sourceId !== "string" || typeof body.aiChatEnabled !== "boolean") {
    return Response.json({ error: "Неверный запрос" }, { status: 400 })
  }
  try {
    await setTelegramAiChat(c.orgId, c.userId, body.sourceId, body.aiChatEnabled)
    return Response.json({ settings: await getTelegramSourceSettings(c.orgId, c.userId, body.sourceId) })
  } catch (e) {
    return fail(e)
  }
}

export async function POST(req: Request) {
  const c = await ctx()
  if (!c) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const body = (await req.json().catch(() => null)) as { sourceId?: unknown; action?: unknown; userId?: unknown } | null
  if (!body || typeof body.sourceId !== "string" || body.action !== "unbind" || typeof body.userId !== "string") {
    return Response.json({ error: "Неверный запрос" }, { status: 400 })
  }
  try {
    await ownerUnbindTelegram(c.orgId, c.userId, body.sourceId, body.userId)
    return Response.json({ settings: await getTelegramSourceSettings(c.orgId, c.userId, body.sourceId) })
  } catch (e) {
    return fail(e)
  }
}

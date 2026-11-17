import { NextResponse } from "next/server"
import { addTelegramChatForClient, getClientTelegramView, removeTelegramChatClient } from "@/server/telegram/chats"
import { telegramFail, telegramSession } from "../../../telegram/_session"

// Company card block «Telegram» (docs/specs/telegram/04 §7.2, Q18, Q25):
// GET → { view } (bound chats / accounts, other chats of the bot, open
// «Новый контакт?» proposals, canEdit); POST { action: "add", username? |
// rowId? } (by @name / t.me link, or a chat of the bot) | { action: "remove",
// rowId } → { view }. Changes: owner or the company's «Ответственный».
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await telegramSession()
  if (s instanceof NextResponse) return s
  const { id } = await params
  try {
    return NextResponse.json({ view: await getClientTelegramView(s.orgId, s.userId, id) })
  } catch (e) {
    return telegramFail(e, "api/clients/[id]/telegram")
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await telegramSession()
  if (s instanceof NextResponse) return s
  const { id } = await params
  const body = (await req.json().catch(() => null)) as { action?: unknown; username?: unknown; rowId?: unknown } | null
  try {
    const view = await getClientTelegramView(s.orgId, s.userId, id)
    if (body?.action === "add") {
      if (!view.sourceId) return NextResponse.json({ error: "В организации не подключён Telegram-бот" }, { status: 409 })
      await addTelegramChatForClient(s.orgId, s.userId, view.sourceId, id, {
        username: typeof body.username === "string" ? body.username : undefined,
        rowId: typeof body.rowId === "string" ? body.rowId : undefined,
      })
    } else if (body?.action === "remove" && typeof body.rowId === "string") {
      await removeTelegramChatClient(s.orgId, s.userId, body.rowId, id)
    } else {
      return NextResponse.json({ error: "Неверный запрос" }, { status: 400 })
    }
    return NextResponse.json({ view: await getClientTelegramView(s.orgId, s.userId, id) })
  } catch (e) {
    return telegramFail(e, "api/clients/[id]/telegram")
  }
}

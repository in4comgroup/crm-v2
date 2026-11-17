import { NextResponse } from "next/server"
import { decideTelegramChatSuggestion } from "@/server/telegram/chats"
import { telegramFail, telegramSession } from "../../_session"

// A binding suggestion (docs/specs/telegram/04 §7.3): POST { accept: boolean }
// → { chat }. Accept = the company is added to the chat; reject = never again.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await telegramSession()
  if (s instanceof NextResponse) return s
  const { id } = await params
  const body = (await req.json().catch(() => null)) as { accept?: unknown } | null
  if (typeof body?.accept !== "boolean") return NextResponse.json({ error: "Неверный запрос" }, { status: 400 })
  try {
    return NextResponse.json({ chat: await decideTelegramChatSuggestion(s.orgId, s.userId, id, body.accept) })
  } catch (e) {
    return telegramFail(e, "api/telegram/chat-suggestions/[id]")
  }
}

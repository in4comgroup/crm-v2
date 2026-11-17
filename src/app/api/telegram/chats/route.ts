import { NextResponse } from "next/server"
import { listTelegramChats } from "@/server/telegram/chats"
import { telegramFail, telegramSession } from "../_session"

// «Группы» of the org bot (docs/specs/telegram/04 §7.2, TI4): GET ?sourceId= →
// { chats } — every chat the bot sees + companies' accounts typed by @name,
// with mode, companies, open suggestions, «Не анализировать». Any member.
export async function GET(req: Request) {
  const s = await telegramSession()
  if (s instanceof NextResponse) return s
  const sourceId = new URL(req.url).searchParams.get("sourceId") ?? ""
  if (!sourceId) return NextResponse.json({ error: "Неверный запрос" }, { status: 400 })
  try {
    return NextResponse.json({ chats: await listTelegramChats(s.orgId, sourceId) })
  } catch (e) {
    return telegramFail(e, "api/telegram/chats")
  }
}

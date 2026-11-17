import { NextResponse } from "next/server"
import { getServerSession } from "@/lib/get-session"
import { TelegramChatError } from "@/server/telegram/chats"

// Shared session + error mapping of the Telegram chat routes (docs/specs/telegram/04 TI4).
export async function telegramSession(): Promise<{ orgId: string; userId: string } | NextResponse> {
  const session = await getServerSession()
  const orgId = session?.session.activeOrganizationId
  if (!session || !orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return { orgId, userId: session.user.id }
}

export function telegramFail(e: unknown, where: string): NextResponse {
  if (e instanceof TelegramChatError) return NextResponse.json({ error: e.message }, { status: e.status })
  console.error(`[${where}] failed`, e)
  return NextResponse.json({ error: "Не удалось выполнить действие" }, { status: 500 })
}

import { NextResponse } from "next/server"
import { setTelegramChatBinding } from "@/server/telegram/chats"
import { telegramFail, telegramSession } from "../../_session"

// One chat's binding (docs/specs/telegram/04 §7.2, Q24): PUT { mode: auto |
// clients | internal, clients?: [{ clientId, isPrimary? }] } → { chat }. Owner,
// or the «Ответственный» of every company the change touches; internal = owner.
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await telegramSession()
  if (s instanceof NextResponse) return s
  const { id } = await params
  const body = (await req.json().catch(() => null)) as { mode?: unknown; clients?: unknown } | null
  const mode = body?.mode
  if (mode !== "auto" && mode !== "clients" && mode !== "internal") return NextResponse.json({ error: "Неверный запрос" }, { status: 400 })
  const clients = Array.isArray(body?.clients)
    ? (body.clients as { clientId?: unknown; isPrimary?: unknown }[])
        .filter((c) => typeof c?.clientId === "string")
        .map((c) => ({ clientId: c.clientId as string, isPrimary: c.isPrimary === true }))
    : []
  try {
    return NextResponse.json({ chat: await setTelegramChatBinding(s.orgId, s.userId, id, { mode, clients }) })
  } catch (e) {
    return telegramFail(e, "api/telegram/chats/[id]")
  }
}

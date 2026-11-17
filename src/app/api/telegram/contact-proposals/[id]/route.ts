import { NextResponse } from "next/server"
import { decideTelegramContactProposal } from "@/server/telegram/chats"
import { telegramFail, telegramSession } from "../../_session"

// «Новый контакт в <Компания>?» (docs/specs/telegram/04 Q25): POST { action:
// create | link | reject, contactId? (link), name? (create) } → { contactId }.
// Owner or the company's «Ответственный».
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await telegramSession()
  if (s instanceof NextResponse) return s
  const { id } = await params
  const body = (await req.json().catch(() => null)) as { action?: unknown; contactId?: unknown; name?: unknown } | null
  const action = body?.action
  if (action !== "create" && action !== "link" && action !== "reject") return NextResponse.json({ error: "Неверный запрос" }, { status: 400 })
  try {
    return NextResponse.json(
      await decideTelegramContactProposal(s.orgId, s.userId, id, {
        action,
        contactId: typeof body?.contactId === "string" ? body.contactId : undefined,
        name: typeof body?.name === "string" ? body.name : undefined,
      }),
    )
  } catch (e) {
    return telegramFail(e, "api/telegram/contact-proposals/[id]")
  }
}

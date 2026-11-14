import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "@/lib/get-session"
import {
  ClientResponsibleError,
  handoverClientToOwner,
  setClientResponsible,
} from "@/server/client-responsible"

// «Ответственный» (Responsible) of one company — the ONLY way to change it.
//   PUT { action: "setResponsible", userId }                     → org owner only
//   PUT { action: "handoverToOwner", ownerUserId?, reason? }     → current responsible (not owner)
// The org comes from the session; rules in src/lib/client-responsible.ts.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession()
  if (!session?.session.activeOrganizationId) {
    return NextResponse.json({ error: "Нужно войти в систему" }, { status: 401 })
  }
  const { id } = await params
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 })
  }
  try {
    if (body.action === "setResponsible") {
      const userId = typeof body.userId === "string" ? body.userId : ""
      const result = await setClientResponsible(id, userId)
      return NextResponse.json({ success: true, ...result })
    }
    if (body.action === "handoverToOwner") {
      const result = await handoverClientToOwner(id, {
        ownerUserId: typeof body.ownerUserId === "string" ? body.ownerUserId : null,
        reason: typeof body.reason === "string" ? body.reason : null,
      })
      return NextResponse.json({ success: true, ...result })
    }
    return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 })
  } catch (e) {
    if (e instanceof ClientResponsibleError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    console.error("[clients/responsible]", e)
    return NextResponse.json({ error: "Не удалось изменить ответственного" }, { status: 500 })
  }
}

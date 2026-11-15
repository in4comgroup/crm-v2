import { NextResponse } from "next/server"
import { getServerSession } from "@/lib/get-session"
import { getNotificationPrefs, setNotificationPrefs } from "@/server/notifications/engine"

// /account → «Уведомления»: which notification categories the caller sees in
// the app (docs/specs/notifications §6, Q8). Own settings in the active org.
//   GET → NotificationPrefsView
//   PUT { categories: { [category]: boolean } } → NotificationPrefsView

async function session() {
  const s = await getServerSession()
  const orgId = s?.session.activeOrganizationId
  return s && orgId ? { orgId, userId: s.user.id } : null
}

export async function GET() {
  const s = await session()
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return NextResponse.json(await getNotificationPrefs(s.orgId, s.userId))
}

export async function PUT(req: Request) {
  const s = await session()
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = (await req.json().catch(() => null)) as { categories?: unknown } | null
  if (!body || typeof body.categories !== "object" || body.categories === null) {
    return NextResponse.json({ error: "Неверный запрос" }, { status: 400 })
  }
  return NextResponse.json(await setNotificationPrefs(s.orgId, s.userId, body.categories as Record<string, unknown>))
}

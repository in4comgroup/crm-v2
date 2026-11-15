import { NextResponse } from "next/server"
import { getServerSession } from "@/lib/get-session"
import type { NotificationAction } from "@/lib/notifications/kinds"
import {
  dismissNotifications,
  listUserNotifications,
  markNotificationsRead,
} from "@/server/notifications/engine"

// The bell «Уведомления» (docs/specs/notifications §8). The caller's own
// notifications in the ACTIVE org (+ platform notifications for platform
// admins); never another user's.
//   GET  ?filter=all|important&category=&limit=  → NotificationsResponse
//   POST { action: "read", ids } | { action: "readAll" } | { action: "dismiss", ids }

async function session() {
  const s = await getServerSession()
  if (!s) return null
  const orgId = s.session.activeOrganizationId
  if (!orgId) return null
  return { orgId, userId: s.user.id }
}

export async function GET(req: Request) {
  const s = await session()
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  try {
    const sp = new URL(req.url).searchParams
    const filter = sp.get("filter") === "important" ? "important" : "all"
    const limit = Number(sp.get("limit") ?? "50")
    return NextResponse.json(
      await listUserNotifications(s.orgId, s.userId, {
        filter,
        category: sp.get("category"),
        limit: Number.isFinite(limit) ? limit : 50,
      }),
    )
  } catch (err) {
    console.error("[api/notifications GET]", err)
    return NextResponse.json({ error: "Не удалось загрузить уведомления" }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const s = await session()
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  try {
    const body = (await req.json().catch(() => null)) as NotificationAction | null
    const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 500) : [])
    if (body?.action === "readAll") await markNotificationsRead(s.orgId, s.userId, "all")
    else if (body?.action === "read") await markNotificationsRead(s.orgId, s.userId, ids(body.ids))
    else if (body?.action === "dismiss") await dismissNotifications(s.orgId, s.userId, ids(body.ids))
    else return NextResponse.json({ error: "Неверный запрос" }, { status: 400 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[api/notifications POST]", err)
    return NextResponse.json({ error: "Не удалось обновить уведомления" }, { status: 500 })
  }
}

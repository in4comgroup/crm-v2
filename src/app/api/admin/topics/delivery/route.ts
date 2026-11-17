import { NextResponse, type NextRequest } from "next/server"
import { getServerSession } from "@/lib/get-session"
import { DELIVERY_KINDS, type DeliveryKind } from "@/lib/topics/delivery-routing"
import { OrgSettingValidationError, setOrgSetting } from "@/server/org-settings"
import {
  DeliveryAdminError,
  getDeliveryAdminView,
  listDeliveryOrgs,
  previewDelivery,
  sendTestDelivery,
  sendTestTelegramPush,
  type DeliveryAdminView,
  type DeliveryOrgRow,
} from "@/server/topics/delivery/admin"
import { organizationExists } from "@/server/topics/mode"

// Block «Рассылка» on /settings → «Темы» (topics plan phase 7). Platform
// admins only (401 / 403).
//   GET                                   → { orgs: DeliveryOrgRow[] }
//   GET ?organizationId=                  → { view: DeliveryAdminView }
//   GET ?organizationId=&userId=&kind=…&preview=1
//                                         → { preview: { subject, html, text, topicCount, empty } }  (no sending)
//   PUT { organizationId, emailEnabled?, telegramEnabled? }  → { view }   org switches
//       `topics.delivery.email` / `topics.delivery.telegram` (topic pushes, topics/08 T6)
//   POST { action: "test", organizationId, userId, kind }
//        → { status, reason, subject }  sends the preview to the CURRENT admin's own email only

export type { DeliveryAdminView, DeliveryOrgRow }
export type DeliveryPreviewResponse = {
  preview: { subject: string; html: string; text: string; topicCount: number; empty: boolean }
}

export const maxDuration = 60

async function requireAdmin() {
  const session = await getServerSession()
  if (!session?.user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  if (session.user.role !== "admin") return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  return { user: { userId: session.user.id, email: session.user.email, name: session.user.name } }
}

function isKind(v: unknown): v is DeliveryKind {
  return typeof v === "string" && (DELIVERY_KINDS as readonly string[]).includes(v)
}

function fail(error: unknown, where: string) {
  if (error instanceof DeliveryAdminError) return NextResponse.json({ error: error.message }, { status: error.status })
  if (error instanceof OrgSettingValidationError) return NextResponse.json({ error: error.message }, { status: 400 })
  console.error(`[admin/topics/delivery] ${where} error:`, error)
  return NextResponse.json({ error: "Не удалось выполнить запрос" }, { status: 500 })
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if ("error" in auth) return auth.error
  const q = request.nextUrl.searchParams
  const organizationId = q.get("organizationId") ?? ""
  try {
    if (!organizationId) return NextResponse.json({ orgs: await listDeliveryOrgs() })
    if (!(await organizationExists(organizationId))) {
      return NextResponse.json({ error: "Организация не найдена" }, { status: 404 })
    }
    if (q.get("preview") === "1") {
      const userId = q.get("userId") ?? ""
      const kind = q.get("kind")
      if (!userId || !isKind(kind)) {
        return NextResponse.json({ error: "userId and kind are required" }, { status: 400 })
      }
      const p = await previewDelivery(organizationId, userId, kind)
      const body: DeliveryPreviewResponse = {
        preview: { subject: p.subject, html: p.html, text: p.text, topicCount: p.topicCount, empty: p.empty },
      }
      return NextResponse.json(body)
    }
    return NextResponse.json({ view: await getDeliveryAdminView(organizationId) })
  } catch (error) {
    return fail(error, "GET")
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin()
  if ("error" in auth) return auth.error
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const organizationId = typeof body?.organizationId === "string" ? body.organizationId : ""
  const email = body?.emailEnabled
  const telegram = body?.telegramEnabled
  if (!organizationId || (typeof email !== "boolean" && typeof telegram !== "boolean")) {
    return NextResponse.json({ error: "organizationId and emailEnabled or telegramEnabled (boolean) are required" }, { status: 400 })
  }
  try {
    if (!(await organizationExists(organizationId))) {
      return NextResponse.json({ error: "Организация не найдена" }, { status: 404 })
    }
    if (typeof email === "boolean") await setOrgSetting(organizationId, "topics.delivery.email", email, auth.user.userId)
    if (typeof telegram === "boolean") await setOrgSetting(organizationId, "topics.delivery.telegram", telegram, auth.user.userId)
    return NextResponse.json({ view: await getDeliveryAdminView(organizationId) })
  } catch (error) {
    return fail(error, "PUT")
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if ("error" in auth) return auth.error
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const organizationId = typeof body?.organizationId === "string" ? body.organizationId : ""
  const userId = typeof body?.userId === "string" ? body.userId : ""
  if (body?.action === "test_telegram" && organizationId && userId) {
    try {
      if (!(await organizationExists(organizationId))) {
        return NextResponse.json({ error: "Организация не найдена" }, { status: 404 })
      }
      return NextResponse.json(await sendTestTelegramPush(organizationId, userId, auth.user.userId))
    } catch (error) {
      return fail(error, "POST")
    }
  }
  if (body?.action !== "test" || !organizationId || !userId || !isKind(body?.kind)) {
    return NextResponse.json({ error: "action=test, organizationId, userId and kind are required" }, { status: 400 })
  }
  if (!auth.user.email) return NextResponse.json({ error: "У администратора нет адреса почты" }, { status: 400 })
  try {
    if (!(await organizationExists(organizationId))) {
      return NextResponse.json({ error: "Организация не найдена" }, { status: 404 })
    }
    return NextResponse.json(await sendTestDelivery(organizationId, userId, body.kind, auth.user))
  } catch (error) {
    return fail(error, "POST")
  }
}

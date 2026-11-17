import { NextResponse, type NextRequest } from "next/server"
import { getServerSession } from "@/lib/get-session"
import { getActiveOrgRole } from "@/server/sources"
import { getAccountDeliveryView, saveAccountDeliveryPrefs, type AccountDeliveryView } from "@/server/topics/delivery/account"

// «Уведомления по темам» on /account (topics plan phase 7): the CURRENT
// user's delivery choices in the ACTIVE org. Any member; session + active
// org membership required.
//   GET → AccountDeliveryView
//   PUT { emailMorning?, emailWeekly?, emailEvening?, telegramEnabled? } (booleans) → AccountDeliveryView
//       409 when the org's topics mode is not `on`.

export type { AccountDeliveryView }

const KEYS = ["emailMorning", "emailWeekly", "emailEvening", "telegramEnabled"] as const

async function context() {
  const session = await getServerSession()
  if (!session?.user) return { error: NextResponse.json({ error: "Требуется вход" }, { status: 401 }) }
  const role = await getActiveOrgRole()
  if (!role) return { error: NextResponse.json({ error: "Нет активной организации" }, { status: 403 }) }
  return { userId: session.user.id, orgId: role.organizationId }
}

export async function GET() {
  const ctx = await context()
  if ("error" in ctx) return ctx.error
  try {
    return NextResponse.json(await getAccountDeliveryView(ctx.orgId, ctx.userId))
  } catch (error) {
    console.error("[account/topic-delivery] GET error:", error)
    return NextResponse.json({ error: "Не удалось загрузить настройки" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const ctx = await context()
  if ("error" in ctx) return ctx.error
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const patch: Partial<Record<(typeof KEYS)[number], boolean>> = {}
  for (const k of KEYS) {
    if (body?.[k] === undefined) continue
    if (typeof body[k] !== "boolean") {
      return NextResponse.json({ error: `${k} must be a boolean` }, { status: 400 })
    }
    patch[k] = body[k] as boolean
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to save" }, { status: 400 })
  }
  try {
    const view = await getAccountDeliveryView(ctx.orgId, ctx.userId)
    if (!view.visible) {
      return NextResponse.json({ error: "Темы не включены для этой организации" }, { status: 409 })
    }
    return NextResponse.json(await saveAccountDeliveryPrefs(ctx.orgId, ctx.userId, patch))
  } catch (error) {
    console.error("[account/topic-delivery] PUT error:", error)
    return NextResponse.json({ error: "Не удалось сохранить настройки" }, { status: 500 })
  }
}

import { NextResponse } from "next/server"
import { getServerSession } from "@/lib/get-session"
import {
  AutoDiscoveryError,
  getAutoDiscoverySetting,
  setAutoDiscoverySetting,
} from "@/server/discovery-auto"

export type { AutoDiscoverySetting } from "@/server/discovery-auto"

// Org setting `discovery.autoApply` «Создавать компании и контакты
// автоматически» of the ACTIVE org (2026-11-24, src/server/discovery-auto.ts).
// GET → { value, canManage } (any member); PUT { value: boolean } → org owner
// or platform admin, else 403.

async function requireSession() {
  const session = await getServerSession()
  const orgId = session?.session.activeOrganizationId
  if (!session || !orgId) throw new AutoDiscoveryError(401, "Нужно войти в систему")
  return { orgId, userId: session.user.id, isPlatformAdmin: session.user.role === "admin" }
}

function errorResponse(e: unknown) {
  if (e instanceof AutoDiscoveryError) return NextResponse.json({ error: e.message }, { status: e.status })
  console.error("[api/sources/auto-discovery]", e)
  return NextResponse.json({ error: "Не удалось выполнить запрос" }, { status: 500 })
}

export async function GET() {
  try {
    const { orgId, userId, isPlatformAdmin } = await requireSession()
    return NextResponse.json(await getAutoDiscoverySetting(orgId, userId, isPlatformAdmin))
  } catch (e) {
    return errorResponse(e)
  }
}

export async function PUT(request: Request) {
  try {
    const { orgId, userId, isPlatformAdmin } = await requireSession()
    const body = (await request.json().catch(() => null)) as { value?: unknown } | null
    return NextResponse.json(await setAutoDiscoverySetting(orgId, userId, isPlatformAdmin, body?.value))
  } catch (e) {
    return errorResponse(e)
  }
}

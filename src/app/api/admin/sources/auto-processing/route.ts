import { NextResponse } from "next/server"
import { getServerSession } from "@/lib/get-session"
import {
  AutoDiscoveryError,
  listAutoProcessingOrgs,
  organizationExists,
  runAutoDiscoveryForOrg,
  setAutoDiscoverySetting,
} from "@/server/discovery-auto"

export type { AutoProcessingOrgRow, AutoDiscoveryOrgResult } from "@/server/discovery-auto"

// Platform admin block «Автоматическая обработка» on /settings → «Источники»
// (2026-11-24): per org the automated sources and the switch
// `discovery.autoApply`.
// GET → { rows: AutoProcessingOrgRow[] }
// PUT { organizationId, value: boolean } → { ok }
// POST { organizationId, action: "run" } → { result } (runs now, also when off)

export const maxDuration = 300

async function requireAdmin() {
  const session = await getServerSession()
  if (!session) throw new AutoDiscoveryError(401, "Нужно войти в систему")
  if (session.user.role !== "admin") throw new AutoDiscoveryError(403, "Только для администратора платформы")
  return session.user.id
}

function errorResponse(e: unknown) {
  if (e instanceof AutoDiscoveryError) return NextResponse.json({ error: e.message }, { status: e.status })
  console.error("[api/admin/sources/auto-processing]", e)
  return NextResponse.json({ error: e instanceof Error ? e.message : "Не удалось выполнить запрос" }, { status: 500 })
}

async function readOrgId(body: { organizationId?: unknown } | null): Promise<string> {
  const id = typeof body?.organizationId === "string" ? body.organizationId : ""
  if (!id || !(await organizationExists(id))) throw new AutoDiscoveryError(404, "Организация не найдена")
  return id
}

export async function GET() {
  try {
    await requireAdmin()
    return NextResponse.json({ rows: await listAutoProcessingOrgs() })
  } catch (e) {
    return errorResponse(e)
  }
}

export async function PUT(request: Request) {
  try {
    const userId = await requireAdmin()
    const body = (await request.json().catch(() => null)) as { organizationId?: unknown; value?: unknown } | null
    const orgId = await readOrgId(body)
    await setAutoDiscoverySetting(orgId, userId, true, body?.value)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return errorResponse(e)
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin()
    const body = (await request.json().catch(() => null)) as { organizationId?: unknown; action?: unknown } | null
    if (body?.action !== "run") throw new AutoDiscoveryError(400, "Неизвестное действие")
    const orgId = await readOrgId(body)
    return NextResponse.json({ result: await runAutoDiscoveryForOrg(orgId, { force: true }) })
  } catch (e) {
    return errorResponse(e)
  }
}

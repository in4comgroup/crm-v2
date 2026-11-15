import { NextResponse, type NextRequest } from "next/server"
import { getServerSession } from "@/lib/get-session"
import { applyFunnelConfig, FunnelConfigError, getFunnelConfig } from "@/server/funnel-config"
import { organizationExists } from "@/server/topics/mode"

// Funnel export / import of ANY org (docs/specs/funnel §8, Q12). Platform
// admins only (401 / 403).
//   GET ?organizationId=                → { config } (FunnelConfig with this org's ids)
//   PUT { organizationId, config }      → { config, changed, counts } (400 { error, issues })
// The import is «portable»: ids of another org are ignored and the entries
// are matched by code (stages, deal types) or created (rules).

export const maxDuration = 60

async function requireAdmin() {
  const session = await getServerSession()
  if (!session?.user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  if (session.user.role !== "admin") return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  return { userId: session.user.id }
}

function fail(error: unknown) {
  if (error instanceof FunnelConfigError) {
    return NextResponse.json({ error: error.message, issues: error.issues }, { status: error.code === "not_found" ? 404 : 400 })
  }
  console.error("[api/admin/funnel] error:", error)
  return NextResponse.json({ error: "Не удалось выполнить запрос" }, { status: 500 })
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if ("error" in auth) return auth.error
  const organizationId = new URL(request.url).searchParams.get("organizationId")
  if (!organizationId) return NextResponse.json({ error: "Не указана организация" }, { status: 400 })
  try {
    if (!(await organizationExists(organizationId))) {
      return NextResponse.json({ error: "Организация не найдена" }, { status: 404 })
    }
    return NextResponse.json({ config: await getFunnelConfig(organizationId) })
  } catch (error) {
    return fail(error)
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin()
  if ("error" in auth) return auth.error
  try {
    const body = (await request.json().catch(() => null)) as { organizationId?: unknown; config?: unknown } | null
    if (!body || typeof body.organizationId !== "string" || !body.organizationId) {
      return NextResponse.json({ error: "Не указана организация", issues: [] }, { status: 400 })
    }
    if (body.config === undefined) return NextResponse.json({ error: "Нет настроек воронки", issues: [] }, { status: 400 })
    if (!(await organizationExists(body.organizationId))) {
      return NextResponse.json({ error: "Организация не найдена" }, { status: 404 })
    }
    return NextResponse.json(await applyFunnelConfig(body.organizationId, body.config, auth.userId, { portable: true }))
  } catch (error) {
    return fail(error)
  }
}

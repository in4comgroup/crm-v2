import { NextResponse, type NextRequest } from "next/server"
import {
  applyFunnelConfigForSession,
  FunnelConfigError,
  getFunnelTemplateForSession,
  getFunnelViewForSession,
  previewFunnelRulesForSession,
} from "@/server/funnel-config"

export type {
  ApplyFunnelResult,
  FunnelCatalogEntry,
  FunnelPreviewResult,
  FunnelTemplateSummary,
  FunnelView,
} from "@/server/funnel-config"

// «Настройки воронки» (docs/specs/funnel §3.7, §8). Org-scoped by the
// session; the server module checks the session and the org role itself.
//   GET  → FunnelView { config, stagesUsage, catalog, templates, canManage } (any member)
//   PUT  { config } → { config, changed, counts } (org owner; 400 { error, issues })
//   POST { action: "preview", config } → { preview } (owner; dry run, nothing written)
//   POST { action: "template", code }  → { config } (owner; draft only, nothing written)

export const maxDuration = 60

function fail(error: unknown) {
  if (error instanceof FunnelConfigError) {
    const status =
      error.code === "unauthorized" ? 401 : error.code === "forbidden" ? 403 : error.code === "not_found" ? 404 : 400
    return NextResponse.json({ error: error.message, issues: error.issues }, { status })
  }
  console.error("[api/deals/funnel] error:", error)
  return NextResponse.json({ error: "Не удалось выполнить запрос" }, { status: 500 })
}

export async function GET() {
  try {
    return NextResponse.json(await getFunnelViewForSession())
  } catch (error) {
    return fail(error)
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as { config?: unknown } | null
    if (!body || body.config === undefined) {
      return NextResponse.json({ error: "Нет настроек воронки", issues: [] }, { status: 400 })
    }
    return NextResponse.json(await applyFunnelConfigForSession(body.config))
  } catch (error) {
    return fail(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as { action?: unknown; config?: unknown; code?: unknown } | null
    if (body?.action === "preview") {
      return NextResponse.json({ preview: await previewFunnelRulesForSession(body.config) })
    }
    if (body?.action === "template") {
      if (typeof body.code !== "string" || !body.code) {
        return NextResponse.json({ error: "Не указан шаблон", issues: [] }, { status: 400 })
      }
      return NextResponse.json({ config: await getFunnelTemplateForSession(body.code) })
    }
    return NextResponse.json({ error: "Неизвестное действие", issues: [] }, { status: 400 })
  } catch (error) {
    return fail(error)
  }
}

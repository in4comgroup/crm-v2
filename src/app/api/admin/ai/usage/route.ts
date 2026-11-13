import { NextResponse, type NextRequest } from "next/server"
import { getServerSession } from "@/lib/get-session"
import { AI_PROCESSES } from "@/server/ai/processes"
import { reconcileUsageCosts } from "@/server/ai/usage"
import { syncAllModelCatalogs } from "@/server/ai/catalog/sync"
import {
  usageBreakdown,
  usageDaily,
  usageModelOptions,
  usageOrgOptions,
  usageSummary,
  usageSyncStatus,
  type UsageFilters,
} from "@/server/ai/usage-stats"

// «Использование ИИ» (AI usage) tab on /settings. Platform admins only.
//   GET ?from=YYYY-MM-DD&to=YYYY-MM-DD[&org=&process=&model=&status=&stack=process|model]
//     → everything the page shows (KPIs, daily chart, 3 breakdowns, filter options)
//     `to` is inclusive (whole day). org=system → calls without an organization.
//   POST { action: "reconcile" } → fetch exact gateway cost for estimated events now
//   POST { action: "sync_all" }  → what the daily cron does: price sync from every
//                                  enabled gateway + exact-cost reconcile (for when
//                                  the cron did not run, e.g. local dev)
// Spec: docs/specs/models/04-usage-and-cost.md §5, §6.

export type AdminAiUsageResponse = {
  summary: Awaited<ReturnType<typeof usageSummary>>
  daily: Awaited<ReturnType<typeof usageDaily>>
  byOrg: Awaited<ReturnType<typeof usageBreakdown>>
  byProcess: Awaited<ReturnType<typeof usageBreakdown>>
  byModel: Awaited<ReturnType<typeof usageBreakdown>>
  options: {
    orgs: Awaited<ReturnType<typeof usageOrgOptions>>
    models: string[]
    processes: { key: string; label: string }[]
  }
  sync: Awaited<ReturnType<typeof usageSyncStatus>>
}

async function requireAdmin() {
  const session = await getServerSession()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  return null
}

function parseDay(v: string | null): Date | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const d = new Date(`${v}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

export async function GET(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  const sp = request.nextUrl.searchParams
  const from = parseDay(sp.get("from"))
  const toDay = parseDay(sp.get("to"))
  if (!from || !toDay || toDay < from) {
    return NextResponse.json({ error: "from / to (YYYY-MM-DD) are required" }, { status: 400 })
  }
  const status = sp.get("status")
  const f: UsageFilters = {
    from,
    to: new Date(toDay.getTime() + 86_400_000),
    orgId: sp.get("org") || null,
    processKey: sp.get("process") || null,
    model: sp.get("model") || null,
    status: status === "ok" || status === "error" || status === "aborted" || status === "blocked" ? status : null,
  }
  try {
    const [summary, daily, byOrg, byProcess, byModel, orgs, models, sync] = await Promise.all([
      usageSummary(f),
      usageDaily(f, sp.get("stack") === "model" ? "model" : "process"),
      usageBreakdown(f, "org"),
      usageBreakdown(f, "process"),
      usageBreakdown(f, "model"),
      usageOrgOptions(f),
      usageModelOptions(f),
      usageSyncStatus(),
    ])
    const body: AdminAiUsageResponse = {
      summary,
      daily,
      byOrg,
      byProcess,
      byModel,
      options: {
        orgs,
        models,
        processes: AI_PROCESSES.map((p) => ({ key: p.key, label: p.label })),
      },
      sync,
    }
    return NextResponse.json(body)
  } catch (error) {
    console.error("[admin/ai/usage] GET error:", error)
    return NextResponse.json({ error: "Failed to load usage" }, { status: 500 })
  }
}

export const maxDuration = 120

export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  const body = (await request.json().catch(() => null)) as { action?: unknown } | null
  if (body?.action === "reconcile") {
    return NextResponse.json(await reconcileUsageCosts())
  }
  if (body?.action === "sync_all") {
    const catalogs = await syncAllModelCatalogs()
    const reconcile = await reconcileUsageCosts()
    return NextResponse.json({ catalogs, reconcile })
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 })
}

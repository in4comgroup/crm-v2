import { NextResponse, type NextRequest } from "next/server"
import { getServerSession } from "@/lib/get-session"
import { getActiveOrgRole } from "@/server/sources"
import { AI_PROCESSES } from "@/server/ai/processes"
import {
  orgUsageBreakdown,
  orgUsageCostBuckets,
  orgUsageOptions,
  orgUsageSummary,
  type OrgUsageFilters,
} from "@/server/ai/usage-stats"
import { getOrgBudgetStatus } from "@/server/ai/budget"
import { CHART_SCALES, checkChartRange, type ChartScale } from "@/lib/ai-usage-chart"
import type { AiMonthlyLimitState } from "@/lib/ai-budget"

// «Использование ИИ» tab on /account — the ACTIVE organization's AI usage,
// for org OWNERS only (org role checked here; the org id comes from the
// session, never from input). Same views as the admin tab, scoped to the
// org. Every cost is the END-USER cost (with the platform markup); the
// gateway cost, the markup % and the gateway are never sent (spec 05 §5).
//   GET ?from=YYYY-MM-DD&to=YYYY-MM-DD[&process=&model=&user=&status=]
//     → the page (KPIs, breakdowns by process / model / user, options)
//     `to` is inclusive. user=background → calls without a user.
//   GET ?chart=1&scale=day|month|year&from=&to=[&stack=process|model|user + filters]
//     → { chart } end-user cost buckets. `from` / `to` = the CHART range.
//   GET ?banner=1 → AccountAiLimitBanner (the /account warning; owners only,
//     others get { show: false }). Monthly limit = end-user cost (spec 08).

type Row = Awaited<ReturnType<typeof orgUsageBreakdown>>[number]

export type AccountAiUsageResponse = {
  summary: Awaited<ReturnType<typeof orgUsageSummary>>
  byProcess: Row[]
  byModel: Row[]
  byUser: Row[]
  options: {
    processes: { key: string; label: string; group: string }[]
    models: string[]
    users: { id: string; name: string | null }[]
  }
  limits: AccountAiLimits
}

export type AccountAiLimits = {
  /** Monthly limit in end-user cost (with markup) — amounts are shown. */
  monthly: AiMonthlyLimitState
  // Today's DAILY budget is used up: background AI waits until tomorrow
  // (UTC). No amounts — that budget is gateway cost, which owners never see.
  dailyExceeded: boolean
}

export type AccountAiLimitBanner =
  | { show: false }
  | ({ show: true } & AccountAiLimits)

export type AccountAiUsageChartResponse = {
  chart: {
    scale: ChartScale
    from: string
    to: string
    stack: "process" | "model" | "user"
    rows: Awaited<ReturnType<typeof orgUsageCostBuckets>>
  }
}

function parseDay(v: string | null): Date | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const d = new Date(`${v}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

export async function GET(request: NextRequest) {
  const session = await getServerSession()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const role = await getActiveOrgRole()
  const sp = request.nextUrl.searchParams
  if (sp.get("banner") === "1") {
    if (role?.role !== "owner") return NextResponse.json({ show: false } satisfies AccountAiLimitBanner)
    try {
      const b = await getOrgBudgetStatus(role.organizationId)
      const show = b.dailyExceeded || b.monthly.level !== "ok"
      const body: AccountAiLimitBanner = show
        ? { show: true, monthly: b.monthly, dailyExceeded: b.dailyExceeded }
        : { show: false }
      return NextResponse.json(body)
    } catch (error) {
      console.error("[account/ai-usage] banner error:", error)
      return NextResponse.json({ show: false } satisfies AccountAiLimitBanner)
    }
  }
  if (!role) return NextResponse.json({ error: "No active organization" }, { status: 403 })
  if (role.role !== "owner") return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const orgId = role.organizationId

  const from = parseDay(sp.get("from"))
  const toDay = parseDay(sp.get("to"))
  if (!from || !toDay || toDay < from) {
    return NextResponse.json({ error: "from / to (YYYY-MM-DD) are required" }, { status: 400 })
  }
  const status = sp.get("status")
  const f: OrgUsageFilters = {
    from,
    to: new Date(toDay.getTime() + 86_400_000),
    processKey: sp.get("process") || null,
    model: sp.get("model") || null,
    userId: sp.get("user") || null,
    status: status === "ok" || status === "error" || status === "aborted" || status === "blocked" ? status : null,
  }

  if (sp.get("chart") === "1") {
    const scale = sp.get("scale") as ChartScale | null
    if (!scale || !CHART_SCALES.includes(scale)) {
      return NextResponse.json({ error: "scale (day|month|year) is required" }, { status: 400 })
    }
    const check = checkChartRange(scale, sp.get("from")!, sp.get("to")!)
    if (!check.ok) return NextResponse.json({ error: check.message }, { status: 400 })
    const st = sp.get("stack")
    const stack = st === "model" || st === "user" ? st : "process"
    try {
      const body: AccountAiUsageChartResponse = {
        chart: { scale, from: sp.get("from")!, to: sp.get("to")!, stack, rows: await orgUsageCostBuckets(orgId, f, stack, scale) },
      }
      return NextResponse.json(body)
    } catch (error) {
      console.error("[account/ai-usage] chart error:", error)
      return NextResponse.json({ error: "Failed to load usage chart" }, { status: 500 })
    }
  }

  try {
    const [summary, byProcess, byModel, byUser, options, budget] = await Promise.all([
      orgUsageSummary(orgId, f),
      orgUsageBreakdown(orgId, f, "process"),
      orgUsageBreakdown(orgId, f, "model"),
      orgUsageBreakdown(orgId, f, "user"),
      orgUsageOptions(orgId, f),
      getOrgBudgetStatus(orgId),
    ])
    const body: AccountAiUsageResponse = {
      summary,
      byProcess,
      byModel,
      byUser,
      options: {
        processes: AI_PROCESSES.map((p) => ({ key: p.key, label: p.label, group: p.group })),
        models: options.models,
        users: options.users,
      },
      limits: { monthly: budget.monthly, dailyExceeded: budget.dailyExceeded },
    }
    return NextResponse.json(body)
  } catch (error) {
    console.error("[account/ai-usage] Error:", error)
    return NextResponse.json({ error: "Failed to load usage" }, { status: 500 })
  }
}


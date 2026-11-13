import { NextResponse, type NextRequest } from "next/server"
import { getServerSession } from "@/lib/get-session"
import { getActiveOrgRole } from "@/server/sources"
import { AI_PROCESSES } from "@/server/ai/processes"
import { orgUsageView } from "@/server/ai/usage-stats"
import { getOrgBudgetStatus } from "@/server/ai/budget"

// «Использование ИИ» tab on /account — the active organization's AI usage,
// for org OWNERS only. Cost includes the platform markup; the gateway cost,
// the markup % and model ids are never sent (spec 05 §5).
//   GET ?from=YYYY-MM-DD&to=YYYY-MM-DD (to inclusive)

export type AccountAiUsageResponse = {
  calls: number
  cost: number
  byProcess: { label: string; group: string; calls: number; cost: number }[]
  byUser: { name: string; calls: number; cost: number }[]
  // Today's AI budget is used up: background AI waits until tomorrow (UTC).
  // No amounts — the budget is in gateway cost, which owners never see.
  budgetExhausted: boolean
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
  if (!role) return NextResponse.json({ error: "No active organization" }, { status: 403 })
  if (role.role !== "owner") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const sp = request.nextUrl.searchParams
  const from = parseDay(sp.get("from"))
  const toDay = parseDay(sp.get("to"))
  if (!from || !toDay || toDay < from) {
    return NextResponse.json({ error: "from / to (YYYY-MM-DD) are required" }, { status: 400 })
  }
  try {
    const budget = await getOrgBudgetStatus(role.organizationId)
    const view = await orgUsageView(
      role.organizationId,
      from,
      new Date(toDay.getTime() + 86_400_000),
      AI_PROCESSES.filter((p) => p.kind === "interactive").map((p) => p.key),
    )
    const byKey = new Map(AI_PROCESSES.map((p) => [p.key, p]))
    const body: AccountAiUsageResponse = {
      calls: view.calls,
      cost: view.cost,
      byProcess: view.byProcess.map((r) => ({
        label: byKey.get(r.processKey)?.label ?? "Другое",
        group: byKey.get(r.processKey)?.group ?? "",
        calls: r.calls,
        cost: r.cost,
      })),
      byUser: view.byUser.map((r) => ({ name: r.name ?? "Удалённый пользователь", calls: r.calls, cost: r.cost })),
      budgetExhausted: budget.exceeded,
    }
    return NextResponse.json(body)
  } catch (error) {
    console.error("[account/ai-usage] Error:", error)
    return NextResponse.json({ error: "Failed to load usage" }, { status: 500 })
  }
}

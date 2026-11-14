import { NextResponse, type NextRequest } from "next/server"
import { getServerSession } from "@/lib/get-session"
import { getGroupingRun, listGroupingRuns, runGroupingEval } from "@/server/topics/eval/grouping"

export { type GroupingRunReport, type GroupingRunRow } from "@/server/topics/eval/grouping"

// Grouping eval («Оценка группировки по темам», plan phase 3 exit gate).
// Platform admins only. Deterministic (no AI call): reviewed REAL golden
// items with `expected.topicGroups` vs the engine's topics (`topic_item`).
//   GET ?orgId=          → { runs }
//   GET ?runId=          → { report } (stored snapshot)
//   POST { orgId }       → { runId, report } (compute + store, kind "grouping")

export const maxDuration = 60

async function requireAdmin() {
  const session = await getServerSession()
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }
  if (session.user.role !== "admin") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }
  return { userId: session.user.id }
}

function errorResponse(error: unknown) {
  console.error("[admin/topics/grouping] Error:", error)
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Request failed" },
    { status: 500 },
  )
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  const sp = request.nextUrl.searchParams
  try {
    const runId = sp.get("runId")
    if (runId) {
      const run = await getGroupingRun(runId)
      if (!run) return NextResponse.json({ error: "Прогон не найден" }, { status: 404 })
      return NextResponse.json({ report: run.report })
    }
    const orgId = sp.get("orgId")
    if (!orgId) return NextResponse.json({ error: "orgId or runId is required" }, { status: 400 })
    return NextResponse.json({ runs: await listGroupingRuns(orgId) })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const orgId = typeof body?.orgId === "string" ? body.orgId : null
  if (!orgId) return NextResponse.json({ error: "orgId is required" }, { status: 400 })
  try {
    return NextResponse.json(await runGroupingEval(orgId, auth.userId))
  } catch (error) {
    return errorResponse(error)
  }
}

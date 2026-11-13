import { NextResponse, type NextRequest } from "next/server"
import { getServerSession } from "@/lib/get-session"
import {
  runTopicsPipeline,
  type RunTopicsPipelineResult,
} from "@/server/orchestration/topics-pipeline"
import { listTopicsRuns, type TopicsRunRow } from "@/server/topics/runs"

// Run log + manual trigger of the hourly topics pipeline (spec topics/01
// §13, plan phase 0 task 6). Platform admins only.
//   GET ?limit=20 → { runs: TopicsRunRow[] }   newest first (max 100)
//   POST          → RunTopicsPipelineResult    runs synchronously
//                   (`status: "skipped"` when another run is in progress)
//
// maxDuration: the skeleton finishes in seconds; real phases (plan phase
// 2+) may take longer — the cron/workflow path is preferred for those.
export const maxDuration = 300

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

export type AdminTopicsRunsResponse = { runs: TopicsRunRow[] }
export type AdminTopicsRunNowResponse = RunTopicsPipelineResult

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? 20)
  try {
    const body: AdminTopicsRunsResponse = {
      runs: await listTopicsRuns(Number.isFinite(limit) ? limit : 20),
    }
    return NextResponse.json(body)
  } catch (error) {
    console.error("[admin/topics/runs] GET error:", error)
    return NextResponse.json({ error: "Failed to load runs" }, { status: 500 })
  }
}

export async function POST() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  try {
    const result: AdminTopicsRunNowResponse = await runTopicsPipeline({ trigger: "manual" })
    return NextResponse.json(result)
  } catch (error) {
    console.error("[admin/topics/runs] POST error:", error)
    const message = error instanceof Error ? error.message : "Topics run failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

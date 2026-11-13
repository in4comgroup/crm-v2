import { NextResponse, type NextRequest } from "next/server"
import { getServerSession } from "@/lib/get-session"
import { getSpikeReport, listSpikeRuns, runSpikeBatch, SpikeError } from "@/server/topics/spike"
import type { ExtractionCodeSet, ExtractionVariant } from "@/server/topics/prompt/extraction"

export {
  type SpikeBatchResult,
  type PrStats,
  type SpikeReport,
  type SpikeRunRow,
} from "@/server/topics/spike"

// Model spike / eval runner over the golden set (plan phase 0 task 8).
// Platform admins only.
//   GET ?orgId=                     → { runs }
//   GET ?runId=                     → { report }
//   POST { orgId, runId?, limit≤10, variant: single|two_pass, codeSet: live|review }
//                                   → SpikeBatchResult (loop until done)

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

function errorResponse(error: unknown) {
  if (error instanceof SpikeError) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  console.error("[admin/topics/spike] Error:", error)
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
    if (runId) return NextResponse.json({ report: await getSpikeReport(runId) })
    const orgId = sp.get("orgId")
    if (!orgId) return NextResponse.json({ error: "orgId or runId is required" }, { status: 400 })
    return NextResponse.json({ runs: await listSpikeRuns(orgId) })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const orgId = typeof body?.orgId === "string" ? body.orgId : null
  if (!body || !orgId) return NextResponse.json({ error: "orgId is required" }, { status: 400 })
  try {
    const result = await runSpikeBatch({
      orgId,
      runId: typeof body.runId === "string" && body.runId ? body.runId : null,
      limit: typeof body.limit === "number" ? body.limit : undefined,
      variant: typeof body.variant === "string" ? (body.variant as ExtractionVariant) : undefined,
      codeSet: typeof body.codeSet === "string" ? (body.codeSet as ExtractionCodeSet) : undefined,
    })
    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error)
  }
}

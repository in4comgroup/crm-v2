import { NextResponse, type NextRequest } from "next/server"
import { getServerSession } from "@/lib/get-session"
import {
  getEvalReport,
  getStoredReport,
  listSpikeRuns,
  runSpikeBatch,
  saveEvalReport,
  SpikeError,
  type EvalInput,
} from "@/server/topics/spike"
import {
  SignalsNotEnabledError,
  type ExtractionCodeSet,
  type ExtractionVariant,
} from "@/server/topics/prompt/extraction"

export {
  type SpikeBatchResult,
  type PrStats,
  type SpikeReport,
  type SampleReport,
  type EvalReport,
  type EvalBucket,
  type EvalCodeRow,
  type EvalGate,
  type SpikeRunRow,
} from "@/server/topics/spike"

// Extraction eval runner (plan phase 0 task 8 = model spike; phase 2 task 8 =
// eval with post-processing, quality gate, stored metrics, review sample).
// Platform admins only.
//   GET ?orgId=                     → { runs }
//   GET ?runId=                     → { report } (live, from the results)
//   GET ?runId=&stored=1            → { report, savedAt } (snapshot in topics_eval_run.metrics)
//   POST { orgId, runId?, limit≤10, variant: single|two_pass, codeSet: live|review,
//          input: golden|sample, sampleSize≤100, promptContext?: boolean }
//                                   promptContext (identity I4, «С профилем
//                                   организации») forces the org profile in /
//                                   out of the prompt for a NEW run; omitted =
//                                   the org setting `identity.promptContext`.
//                                   → SpikeBatchResult (loop until done)
//   POST { action: "save", runId }  → { report } (compute + store the snapshot)

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
  // The org has no active signal code: a setup problem the admin fixes in «Сигналы».
  if (error instanceof SignalsNotEnabledError) {
    return NextResponse.json({ error: error.message, code: "signals_not_enabled" }, { status: 400 })
  }
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
    if (runId && sp.get("stored") === "1") {
      const stored = await getStoredReport(runId)
      if (!stored) return NextResponse.json({ error: "Сохранённых метрик нет" }, { status: 404 })
      return NextResponse.json(stored)
    }
    if (runId) return NextResponse.json({ report: await getEvalReport(runId) })
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
  if (body?.action === "save") {
    if (typeof body.runId !== "string" || !body.runId) {
      return NextResponse.json({ error: "runId is required" }, { status: 400 })
    }
    try {
      return NextResponse.json({ report: await saveEvalReport(body.runId, auth.userId) })
    } catch (error) {
      return errorResponse(error)
    }
  }
  const orgId = typeof body?.orgId === "string" ? body.orgId : null
  if (!body || !orgId) return NextResponse.json({ error: "orgId is required" }, { status: 400 })
  const input: EvalInput | undefined =
    body.input === "sample" ? "sample" : body.input === "golden" ? "golden" : undefined
  try {
    const result = await runSpikeBatch({
      orgId,
      userId: auth.userId,
      input,
      sampleSize: typeof body.sampleSize === "number" ? body.sampleSize : undefined,
      runId: typeof body.runId === "string" && body.runId ? body.runId : null,
      limit: typeof body.limit === "number" ? body.limit : undefined,
      variant: typeof body.variant === "string" ? (body.variant as ExtractionVariant) : undefined,
      codeSet: typeof body.codeSet === "string" ? (body.codeSet as ExtractionCodeSet) : undefined,
      promptContext: typeof body.promptContext === "boolean" ? body.promptContext : undefined,
    })
    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error)
  }
}

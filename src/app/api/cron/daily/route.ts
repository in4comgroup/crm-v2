import { NextRequest, NextResponse } from "next/server"
import { start } from "workflow/api"
import { dailyPipelineWorkflow } from "@/workflows/daily-pipeline.workflow"

// Cron-triggered entrypoint. Vercel Cron Jobs hit this route on the
// schedule declared in `vercel.ts` (ORCHESTRATION_CONFIG.cron). When
// `CRON_SECRET` is set as a project env var, Vercel attaches
// `Authorization: Bearer $CRON_SECRET` to every scheduled invocation —
// rejecting anything else keeps the route off the open internet.
//
// The secret is required in EVERY environment, and a missing CRON_SECRET
// rejects all calls (otherwise "Bearer undefined" would pass). The admin
// "Run pipeline now" button uses /api/admin/pipeline/run, not this route.
//
// The route is intentionally tiny: validate, kick off the workflow,
// return. The workflow itself takes over from there (Fluid Compute,
// durable steps, observability dashboard). Doing more here would push
// orchestration logic into the route, defeating the whole point of the
// detachable orchestration layer.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get("authorization")
  if (!secret || auth !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 })
  }

  try {
    await start(dailyPipelineWorkflow, [])
    return NextResponse.json({ ok: true, started: true })
  } catch (error) {
    console.error("[cron/daily] Failed to start workflow:", error)
    const message =
      error instanceof Error ? error.message : "Failed to start workflow"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

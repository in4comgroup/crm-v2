import { NextRequest, NextResponse } from "next/server"
import { start } from "workflow/api"
import { topicsPipelineWorkflow } from "@/workflows/topics-pipeline.workflow"

// Hourly cron entrypoint of the topics pipeline (spec topics/01 §13).
// Vercel Cron Jobs hit this route on the schedule declared in `vercel.ts`
// (ORCHESTRATION_CONFIG.topics.cron, `0 * * * *` — a sub-daily cron needs
// the Vercel Pro plan). When `CRON_SECRET` is set as a project env var,
// Vercel attaches `Authorization: Bearer $CRON_SECRET` to every scheduled
// invocation — rejecting anything else keeps the route off the open
// internet (`/api/cron/` is public in src/proxy.ts; this check is the gate).
//
// The secret is required in EVERY environment, and a missing CRON_SECRET
// rejects all calls (otherwise "Bearer undefined" would pass). The admin
// «Запустить сейчас» button uses /api/admin/topics/runs, not this route.
//
// The route is intentionally tiny: validate, kick off the workflow,
// return. Orgs with topics.enabled = off are skipped inside the pipeline.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get("authorization")
  if (!secret || auth !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 })
  }

  try {
    await start(topicsPipelineWorkflow, [])
    return NextResponse.json({ ok: true, started: true })
  } catch (error) {
    console.error("[cron/topics] Failed to start workflow:", error)
    const message =
      error instanceof Error ? error.message : "Failed to start workflow"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// Same handler for POST, so a manual `curl -X POST` with the secret works
// too (Vercel Cron itself uses GET).
export const POST = GET

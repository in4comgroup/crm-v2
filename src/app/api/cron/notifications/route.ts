import { NextRequest, NextResponse } from "next/server"
import { runAllNotificationChecks } from "@/server/notifications/checks"

// Hourly cron of the notification condition checks (docs/specs/notifications
// §3.2, plan NF3): task reminders, AI limit, org profile, client-profile
// proposals, source health, failed runs — for EVERY organization (topics mode
// does not matter), then the retention purge. Schedule in `vercel.ts`
// (ORCHESTRATION_CONFIG.notifications.cron, `15 * * * *`; a sub-daily cron
// needs the Vercel Pro plan).
//
// Same gate as /api/cron/topics: `Authorization: Bearer $CRON_SECRET` in
// every environment, a missing secret rejects every call (`/api/cron/` is
// public in src/proxy.ts; this check is the gate). Runs directly — no
// Vercel Workflow: the checks are cheap, deterministic and idempotent
// (dedupe keys), so a retry or an overlap only re-reads.
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get("authorization")
  if (!secret || auth !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 })
  }

  try {
    const result = await runAllNotificationChecks(new Date())
    console.log("[cron/notifications]", JSON.stringify(result))
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error("[cron/notifications] failed:", error)
    const message = error instanceof Error ? error.message : "Notification checks failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// Same handler for POST, so a manual `curl -X POST` with the secret works too.
export const POST = GET

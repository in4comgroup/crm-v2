import "server-only"

import type { TopicsPhaseContext, TopicsPhaseResult } from "@/server/topics/phases"
import { runOrgDelivery } from "./run"

// Phase «delivery» of the hourly run (plan phase 7, the LAST phase): email
// digests (morning «Сводка», weekly «Неделя»), evening reminders «Не закрыто
// сегодня» (+ the in-app «Напоминание» marks). Only orgs in mode `on`; email
// only when the org switch `topics.delivery.email` is on. Timing, routing,
// limits and idempotency: ./run.ts. Telegram: stub channel (./channels.ts).

export async function runDeliveryPhase(ctx: TopicsPhaseContext): Promise<TopicsPhaseResult> {
  if (ctx.mode !== "on") return { skipped: "topics mode is not on" }
  const { result } = await runOrgDelivery(ctx.organizationId, { now: new Date() })
  return result
}

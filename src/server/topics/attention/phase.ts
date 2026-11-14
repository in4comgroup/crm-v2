import "server-only"

import type { TopicsPhaseContext, TopicsPhaseResult } from "@/server/topics/phases"
import { loadAttentionContext, recomputeAttentionForRows, selectDueTopics } from "./store"

// Phase «attention» of the hourly run (plan phase 4, 06-attention-engine.md
// §10). Deterministic, no AI cost. Picks the org's topics that are due:
//   - touched in this run (phase 3 writes set `next_attention_check_at` = now),
//   - `next_attention_check_at` ≤ now (time thresholds: deadlines, boost O,
//     snooze / dampener end, expiry, snapshots),
//   - live topics never computed or computed with other parameters /
//     taxonomy version (06 §10 «Parameter change»).
// Recomputes them in batches (≤ MAX_PER_RUN per org per run); idempotent —
// a result equal to the stored one is not written again.

export const ATTENTION_MAX_PER_RUN = 500
const BATCH = 100

export async function runAttentionPhase(ctx: TopicsPhaseContext): Promise<TopicsPhaseResult> {
  const now = new Date()
  const actx = await loadAttentionContext(ctx.organizationId, now)
  const due = await selectDueTopics(ctx.organizationId, now, actx.paramsHash, ATTENTION_MAX_PER_RUN)
  const counts = { due: due.length, written: 0, listChanged: 0, now: 0, digest: 0, week: 0, none: 0 }
  for (let i = 0; i < due.length; i += BATCH) {
    const res = await recomputeAttentionForRows(actx, due.slice(i, i + BATCH), now, { actorUserId: ctx.actorUserId })
    for (const r of res) {
      if (r.changed) counts.written++
      if (r.listChanged) counts.listChanged++
      counts[r.list]++
    }
  }
  return counts
}

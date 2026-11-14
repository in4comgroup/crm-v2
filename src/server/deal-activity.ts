import "server-only"

import { db } from "@/db/drizzle"
import { dealActivity, sourceItem, task, topic, topicItem } from "@/db/schema"
import { and, desc, eq, inArray, max, ne, sql } from "drizzle-orm"
import {
  pickDealLastActivity,
  type DealLastActivity,
} from "@/lib/deal-activity"

// «N дн без активности» — the DB side (rule in src/lib/deal-activity.ts).
// Org-explicit, `server-only`: the session-bound `listDeals` / `getDeal`
// (src/server/deals.ts) call it with the active org. Computed at READ time,
// so a message attached by the hourly topics run shows at once. Three
// aggregated queries per call, whatever the number of deals (no N+1).
export async function loadDealLastActivity(
  organizationId: string,
  deals: { id: string; createdAt: Date }[],
  // Topic messages count only when the org's topics mode is `on` (engine
  // data is visible to users only then).
  options: { topicsVisible: boolean },
): Promise<Map<string, DealLastActivity>> {
  const out = new Map<string, DealLastActivity>()
  if (deals.length === 0) return out
  const dealIds = deals.map((d) => d.id)

  // mapWith(column) = the column's own decoder (timestamp without tz → UTC
  // Date); a bare `new Date(string)` would read it as local time.
  const messageAt = sql<Date>`coalesce(${sourceItem.sourceCreatedAt}, ${sourceItem.createdAt})`.mapWith(
    sourceItem.createdAt,
  )

  const [topicRows, activityRows, taskRows] = await Promise.all([
    options.topicsVisible
      ? // Latest message per deal over ALL its topics (a merged topic's items
        // moved to its target, so `merged` is skipped). DISTINCT ON keeps the
        // topic that holds that message (for the tooltip).
        db
          .selectDistinctOn([topic.dealId], {
            dealId: topic.dealId,
            topicId: topic.id,
            topicTitle: topic.title,
            at: messageAt,
          })
          .from(topic)
          .innerJoin(topicItem, eq(topicItem.topicId, topic.id))
          .innerJoin(sourceItem, eq(sourceItem.id, topicItem.sourceItemId))
          .where(
            and(
              eq(topic.organizationId, organizationId),
              inArray(topic.dealId, dealIds),
              ne(topic.status, "merged"),
            ),
          )
          .orderBy(topic.dealId, desc(messageAt))
      : Promise.resolve([]),
    db
      .select({ dealId: dealActivity.dealId, at: max(dealActivity.createdAt) })
      .from(dealActivity)
      .where(inArray(dealActivity.dealId, dealIds))
      .groupBy(dealActivity.dealId),
    db
      .select({ dealId: task.dealId, at: max(task.updatedAt) })
      .from(task)
      .where(
        and(eq(task.organizationId, organizationId), inArray(task.dealId, dealIds)),
      )
      .groupBy(task.dealId),
  ])

  const byTopic = new Map<string, { at: Date; topicId: string; topicTitle: string }>()
  for (const r of topicRows) {
    if (r.dealId && r.at) {
      byTopic.set(r.dealId, { at: r.at, topicId: r.topicId, topicTitle: r.topicTitle })
    }
  }
  const byActivity = new Map<string, Date>()
  for (const r of activityRows) if (r.at) byActivity.set(r.dealId, new Date(r.at))
  const byTask = new Map<string, Date>()
  for (const r of taskRows) if (r.dealId && r.at) byTask.set(r.dealId, new Date(r.at))

  for (const d of deals) {
    out.set(
      d.id,
      pickDealLastActivity({
        topic: byTopic.get(d.id) ?? null,
        dealActivityAt: byActivity.get(d.id) ?? null,
        taskAt: byTask.get(d.id) ?? null,
        dealCreatedAt: d.createdAt,
      }),
    )
  }
  return out
}

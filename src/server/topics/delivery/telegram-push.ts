import "server-only"

import { and, eq, gt, inArray } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { topicDelivery } from "@/db/schema"
import { renderTopicPush } from "@/lib/telegram/push"
import { getOrgSetting } from "@/server/org-settings"
import { activeBindingsByUser, appUrl, orgWorkingNow, targetFor } from "@/server/telegram/delivery"
import { sendTelegramHtml } from "@/server/telegram/sender"
import { loadOrgTelegramBot } from "@/server/telegram/source"
import { DEFAULT_PREFS, recordDelivery } from "./store"
import type { DeliveryContext } from "./run"
import { listsForUser } from "./run"

// Topic pushes in Telegram (docs/specs/topics/08 T2 + T3, telegram/04 TI3):
// every hourly run of an org in topics mode `on`. A topic that ENTERED a
// member's «Сейчас» (after the P6 daily limit, routed like the email —
// `listsForUser`) in the last 24 h gets ONE push per display cycle with
// «Открыть» / «✅ Готово» / «⏰ Отложить до завтра»; at most
// `telegramMaxPerCard7d` pushes per topic in 7 days; only inside the org's
// working hours; only for members with an active Telegram binding whose
// «Темы в Telegram» is on, and only while the org switch
// `topics.delivery.telegram` is on. Log = `topic_delivery` (channel
// telegram, kind push, one topic per row).

const CYCLE_WINDOW_MS = 24 * 3_600_000
const HISTORY_MS = 7 * 86_400_000
/** A burst guard: the rest goes in the next hourly run. */
const MAX_PER_USER_PER_RUN = 5
const MAX_FAILED = 3

export type TelegramPushResult = { skipped: string } | { sent: number; failed: number; limited: number; recipients: number }

type HistoryRow = { userId: string; topicId: string; status: string; createdAt: Date }

async function pushHistory(orgId: string, userIds: string[], since: Date): Promise<HistoryRow[]> {
  if (!userIds.length) return []
  const rows = await db
    .select({ userId: topicDelivery.userId, topicIds: topicDelivery.topicIds, status: topicDelivery.status, createdAt: topicDelivery.createdAt })
    .from(topicDelivery)
    .where(
      and(
        eq(topicDelivery.organizationId, orgId),
        eq(topicDelivery.channel, "telegram"),
        eq(topicDelivery.kind, "push"),
        inArray(topicDelivery.userId, userIds),
        gt(topicDelivery.createdAt, since),
      ),
    )
  return rows.flatMap((r) => r.topicIds.map((topicId) => ({ userId: r.userId, topicId, status: r.status, createdAt: r.createdAt })))
}

export async function runTelegramTopicPushes(ctx: DeliveryContext): Promise<TelegramPushResult> {
  if (!(await getOrgSetting(ctx.orgId, "topics.delivery.telegram"))) return { skipped: "org switch off" }
  const bot = await loadOrgTelegramBot(ctx.orgId)
  if (!bot) return { skipped: "no bot" }
  const work = await orgWorkingNow(ctx.orgId, ctx.now)
  if (!work.working) return { skipped: "outside working hours" }

  const members = ctx.members.filter((m) => !m.banned && (ctx.prefs.get(m.userId) ?? DEFAULT_PREFS).telegramEnabled)
  const bindings = await activeBindingsByUser(ctx.orgId, bot, members.map((m) => m.userId))
  const recipients = members.filter((m) => bindings.has(m.userId))
  if (!recipients.length) return { sent: 0, failed: 0, limited: 0, recipients: 0 }

  const history = await pushHistory(ctx.orgId, recipients.map((m) => m.userId), new Date(ctx.now.getTime() - HISTORY_MS))
  const out = { sent: 0, failed: 0, limited: 0, recipients: recipients.length }
  const base = appUrl()

  for (const m of recipients) {
    const b = bindings.get(m.userId)!
    let pushed = 0
    for (const e of listsForUser(ctx, m.userId).now) {
      if (pushed >= MAX_PER_USER_PER_RUN) break
      const cycle = e.attention?.cycleStartedAt ? new Date(e.attention.cycleStartedAt) : null
      if (!cycle || ctx.now.getTime() - cycle.getTime() > CYCLE_WINDOW_MS) continue
      const mine = history.filter((h) => h.userId === m.userId && h.topicId === e.topicId)
      const thisCycle = mine.filter((h) => h.createdAt >= cycle)
      if (thisCycle.some((h) => h.status !== "failed") || thisCycle.length >= MAX_FAILED) continue
      const row = { organizationId: ctx.orgId, userId: m.userId, channel: "telegram" as const, kind: "push" as const, localDate: ctx.localDay, topicIds: [e.topicId], cardIds: e.card ? [e.card.id] : [], subject: e.card?.headline || e.title }
      if (mine.filter((h) => h.status === "sent").length >= ctx.dp.telegramMaxPerCard7d) {
        await recordDelivery({ ...row, status: "skipped", error: "limit_7d" })
        history.push({ userId: m.userId, topicId: e.topicId, status: "skipped", createdAt: ctx.now })
        out.limited++
        continue
      }
      const msg = renderTopicPush(e, { appUrl: base, timeZone: work.timeZone })
      const res = await sendTelegramHtml(targetFor(bot, b), msg.html, { kind: "topic_push", entity: { type: "topic", id: e.topicId } }, { buttons: msg.buttons })
      await recordDelivery({ ...row, status: res.ok ? "sent" : res.blocked ? "skipped" : "failed", error: res.ok ? null : res.blocked ? "blocked" : res.error })
      history.push({ userId: m.userId, topicId: e.topicId, status: res.ok ? "sent" : "failed", createdAt: ctx.now })
      if (res.ok) {
        out.sent++
        pushed++
      } else {
        out.failed++
        if (res.blocked) break
      }
    }
  }
  return out
}

import "server-only"

import { and, eq, gt, inArray, isNull } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { notification, notificationPref, telegramBinding } from "@/db/schema"
import { WorkCalendar } from "@/lib/topics/attention-calendar"
import { renderNotificationMessage } from "@/lib/telegram/push"
import { loadAttentionParams, loadCalendarDays } from "@/server/topics/attention/store"
import { loadOrgTelegramBot, type OrgTelegramBot } from "@/server/telegram/source"
import { sendTelegramHtml, type SendTarget } from "@/server/telegram/sender"
import type { TelegramBindingRow } from "@/server/telegram/bindings"

// Outbound Telegram to members (docs/specs/telegram/04 TI3, Q21): helpers for
// the topic pushes (src/server/topics/delivery/telegram-push.ts) and the
// Telegram copies of IMPORTANT notifications. Sent only inside the org's
// working hours (attention params + work calendar); outside them the hourly
// sweep sends later. Org-explicit, never throws.

/** Copies older than this are not sent any more (`stale`). */
const NOTIFICATION_MAX_AGE_MS = 24 * 3_600_000
/** Not copied: topics reach Telegram as pushes (no double message). */
const NOT_COPIED_KINDS = new Set(["topic.now"])

export function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL ?? "").replace(/\/+$/, "")
}

/** Active Telegram bindings of these members on the org's bot. */
export async function activeBindingsByUser(orgId: string, bot: OrgTelegramBot, userIds: readonly string[]): Promise<Map<string, TelegramBindingRow>> {
  if (!userIds.length) return new Map()
  const rows = await db
    .select()
    .from(telegramBinding)
    .where(and(eq(telegramBinding.organizationId, orgId), eq(telegramBinding.sourceId, bot.sourceId), eq(telegramBinding.status, "active"), inArray(telegramBinding.userId, [...new Set(userIds)])))
  return new Map(rows.map((b) => [b.userId, b]))
}

export function targetFor(bot: OrgTelegramBot, b: TelegramBindingRow): SendTarget {
  return { orgId: b.organizationId, sourceId: bot.sourceId, botToken: bot.botToken, chatId: b.chatId, binding: { id: b.id, userId: b.userId } }
}

/** Inside the org's working hours now (work calendar + attention params)? */
export async function orgWorkingNow(orgId: string, now: Date): Promise<{ working: boolean; cal: WorkCalendar; workStart: string; timeZone: string }> {
  const [ap, days] = await Promise.all([loadAttentionParams(orgId), loadCalendarDays()])
  const cal = new WorkCalendar(days, { timeZone: ap.timeZone, workStart: ap.workStart, workEnd: ap.workEnd })
  const day = cal.localDay(now)
  const working = cal.isWorkingDay(day) && now >= cal.at(day, ap.workStart) && now < cal.at(day, ap.workEnd)
  return { working, cal, workStart: ap.workStart, timeZone: ap.timeZone }
}

/** Members who switched a category off for Telegram (`notification_pref.telegram_categories`). */
async function telegramOff(orgId: string, userIds: readonly string[]): Promise<Map<string, Record<string, boolean>>> {
  if (!userIds.length) return new Map()
  const rows = await db
    .select({ userId: notificationPref.userId, tg: notificationPref.telegramCategories })
    .from(notificationPref)
    .where(and(eq(notificationPref.organizationId, orgId), inArray(notificationPref.userId, [...userIds])))
  return new Map(rows.map((r) => [r.userId, (r.tg ?? {}) as Record<string, boolean>]))
}

async function mark(ids: string[], status: string): Promise<void> {
  if (!ids.length) return
  await db.update(notification).set({ telegramStatus: status, telegramAt: new Date() }).where(inArray(notification.id, ids))
}

/**
 * Telegram copies of important notifications (Q21). `ids` = just inserted
 * rows (called by `notify`); without ids = the hourly sweep of rows not
 * decided yet. Outside working hours nothing is decided (the sweep sends
 * later). Returns the number of messages sent.
 */
export async function deliverNotificationsToTelegram(orgId: string, opts: { ids?: string[]; now?: Date } = {}): Promise<number> {
  try {
    const now = opts.now ?? new Date()
    if (opts.ids && !opts.ids.length) return 0
    const rows = await db
      .select()
      .from(notification)
      .where(
        and(
          eq(notification.organizationId, orgId),
          eq(notification.priority, "important"),
          isNull(notification.telegramStatus),
          ...(opts.ids ? [inArray(notification.id, opts.ids)] : []),
        ),
      )
      .limit(500)
    if (!rows.length) return 0

    // Rows that will never be copied are decided at once.
    const closed = rows.filter((r) => NOT_COPIED_KINDS.has(r.kind) || r.readAt || r.dismissedAt || r.resolvedAt || r.expiresAt <= now)
    const stale = rows.filter((r) => !closed.includes(r) && now.getTime() - r.createdAt.getTime() > NOTIFICATION_MAX_AGE_MS)
    await mark(closed.map((r) => r.id), "not_sent")
    await mark(stale.map((r) => r.id), "stale")
    const open = rows.filter((r) => !closed.includes(r) && !stale.includes(r))
    if (!open.length) return 0

    const bot = await loadOrgTelegramBot(orgId)
    const bindings = bot ? await activeBindingsByUser(orgId, bot, open.map((r) => r.userId)) : new Map<string, TelegramBindingRow>()
    const noBinding = open.filter((r) => !bindings.has(r.userId))
    await mark(noBinding.map((r) => r.id), "no_binding")
    const withBinding = open.filter((r) => bindings.has(r.userId))
    if (!withBinding.length || !bot) return 0

    const off = await telegramOff(orgId, withBinding.map((r) => r.userId))
    const optedOut = withBinding.filter((r) => off.get(r.userId)?.[r.category] === false)
    await mark(optedOut.map((r) => r.id), "opted_out")
    const toSend = withBinding.filter((r) => !optedOut.includes(r))
    if (!toSend.length) return 0
    if (!(await orgWorkingNow(orgId, now)).working) return 0

    let sent = 0
    for (const r of toSend) {
      const b = bindings.get(r.userId)!
      // Claim the row first: two runs (notify + sweep) never send it twice.
      const claimed = await db
        .update(notification)
        .set({ telegramStatus: "sending", telegramAt: now })
        .where(and(eq(notification.id, r.id), isNull(notification.telegramStatus)))
        .returning({ id: notification.id })
      if (!claimed.length) continue
      const msg = renderNotificationMessage({ title: r.title, body: r.body, href: r.href }, appUrl())
      const res = await sendTelegramHtml(targetFor(bot, b), msg.html, { kind: "notification", entity: r.entityType && r.entityId ? { type: r.entityType, id: r.entityId } : null }, { buttons: msg.buttons })
      await mark([r.id], res.ok ? "sent" : res.blocked ? "blocked" : "failed")
      if (res.ok) sent++
    }
    return sent
  } catch (e) {
    console.error("[telegram/delivery] notification copies failed", orgId, e)
    return 0
  }
}

/** Orgs with important notifications not decided yet (the hourly sweep). */
export async function orgsWithPendingTelegramCopies(now: Date = new Date()): Promise<string[]> {
  const rows = await db
    .selectDistinct({ org: notification.organizationId })
    .from(notification)
    .where(and(eq(notification.priority, "important"), isNull(notification.telegramStatus), gt(notification.createdAt, new Date(now.getTime() - 7 * 86_400_000))))
  return rows.map((r) => r.org).filter((x): x is string => !!x)
}

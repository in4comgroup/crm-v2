import "server-only"

import { randomUUID } from "node:crypto"
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { member, organization, topic, topicDelivery, topicDeliveryPref, user } from "@/db/schema"
import { mergeDeliveryParams, type DeliveryParams } from "@/lib/topics/delivery-params"
import type { DeliveryRowKind } from "@/lib/topics/delivery-routing"
import { getOrgSetting } from "@/server/org-settings"
import { getPlatformSetting } from "@/server/platform-settings"
import { humanUsersOnly } from "@/server/topics/system-actor"

// DB side of topics delivery (plan phase 7): parameters, recipients,
// per-user preferences, the delivery log (`topic_delivery`) and the evening
// reminder marks on `topic`. Org-explicit and session-free; callers check
// access (the hourly phase, `/api/account/topic-delivery`,
// `/api/admin/topics/delivery`).

// ── Parameters + switch ───────────────────────────────────────────────────

/** Delivery parameters: org `delivery.params` → platform `delivery.params` → defaults (06 §13). */
export async function loadDeliveryParams(orgId: string): Promise<DeliveryParams> {
  const [platform, org] = await Promise.all([
    getPlatformSetting("delivery.params"),
    getOrgSetting(orgId, "delivery.params"),
  ])
  return mergeDeliveryParams(platform, org)
}

/** Org switch `topics.delivery.email` (default false = no topics email for the org). */
export async function orgEmailDeliveryOn(orgId: string): Promise<boolean> {
  return getOrgSetting(orgId, "topics.delivery.email")
}

export async function getOrgName(orgId: string): Promise<string> {
  const [o] = await db.select({ name: organization.name }).from(organization).where(eq(organization.id, orgId))
  return o?.name ?? ""
}

// ── Recipients ────────────────────────────────────────────────────────────

export type DeliveryRecipient = { userId: string; name: string; email: string; banned: boolean }

/** Human members of the org (never the system actor «Агент»), by name. */
export async function listOrgHumanMembers(orgId: string): Promise<DeliveryRecipient[]> {
  const rows = await db
    .select({ userId: user.id, name: user.name, email: user.email, banned: user.banned })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, orgId), humanUsersOnly()))
    .orderBy(asc(user.name))
  return rows.map((r) => ({ userId: r.userId, name: r.name, email: r.email ?? "", banned: !!r.banned }))
}

/** Ids of the org's human members (routing of topics, spec 01 §8.1). */
export async function orgHumanMemberIds(orgId: string): Promise<Set<string>> {
  return new Set((await listOrgHumanMembers(orgId)).map((m) => m.userId))
}

// ── Preferences ───────────────────────────────────────────────────────────

export type DeliveryPrefs = {
  emailMorning: boolean
  emailWeekly: boolean
  emailEvening: boolean
  telegramEnabled: boolean
  telegramChatId: string | null
}

export const DEFAULT_PREFS: DeliveryPrefs = {
  emailMorning: true,
  emailWeekly: true,
  emailEvening: true,
  // Topic pushes need an active Telegram binding (opt-in) — on by default.
  telegramEnabled: true,
  telegramChatId: null,
}

/** Prefs of every user of the org that has a row (no row = defaults: all email on). */
export async function loadDeliveryPrefs(orgId: string): Promise<Map<string, DeliveryPrefs>> {
  const rows = await db.select().from(topicDeliveryPref).where(eq(topicDeliveryPref.organizationId, orgId))
  return new Map(
    rows.map((r) => [
      r.userId,
      {
        emailMorning: r.emailMorning,
        emailWeekly: r.emailWeekly,
        emailEvening: r.emailEvening,
        telegramEnabled: r.telegramEnabled,
        telegramChatId: r.telegramChatId,
      },
    ]),
  )
}

export async function getUserDeliveryPrefs(orgId: string, userId: string): Promise<DeliveryPrefs> {
  const [r] = await db
    .select()
    .from(topicDeliveryPref)
    .where(and(eq(topicDeliveryPref.organizationId, orgId), eq(topicDeliveryPref.userId, userId)))
  if (!r) return { ...DEFAULT_PREFS }
  return {
    emailMorning: r.emailMorning,
    emailWeekly: r.emailWeekly,
    emailEvening: r.emailEvening,
    telegramEnabled: r.telegramEnabled,
    telegramChatId: r.telegramChatId,
  }
}

export type DeliveryPrefsPatch = Partial<Pick<DeliveryPrefs, "emailMorning" | "emailWeekly" | "emailEvening" | "telegramEnabled">>

/** Save the email switches + «Темы в Telegram» of one user in one org. */
export async function setUserDeliveryPrefs(orgId: string, userId: string, patch: DeliveryPrefsPatch): Promise<DeliveryPrefs> {
  const cur = await getUserDeliveryPrefs(orgId, userId)
  const next = { ...cur, ...patch }
  await db
    .insert(topicDeliveryPref)
    .values({
      userId,
      organizationId: orgId,
      emailMorning: next.emailMorning,
      emailWeekly: next.emailWeekly,
      emailEvening: next.emailEvening,
      telegramEnabled: next.telegramEnabled,
    })
    .onConflictDoUpdate({
      target: [topicDeliveryPref.userId, topicDeliveryPref.organizationId],
      set: {
        emailMorning: next.emailMorning,
        emailWeekly: next.emailWeekly,
        emailEvening: next.emailEvening,
        telegramEnabled: next.telegramEnabled,
        updatedAt: new Date(),
      },
    })
  return next
}

// ── Delivery log ──────────────────────────────────────────────────────────

export type DeliveryStatus = "sent" | "failed" | "skipped"
export type DeliveryChannelKey = "email" | "telegram"

export type DeliveryRowInput = {
  organizationId: string
  userId: string
  channel: DeliveryChannelKey
  kind: DeliveryRowKind
  localDate: string
  topicIds?: string[]
  cardIds?: string[]
  status: DeliveryStatus
  error?: string | null
  subject?: string | null
}

/** One log row. A second `sent` digest of the same user / kind / day is a no-op (unique index). */
export async function recordDelivery(r: DeliveryRowInput): Promise<string | null> {
  const id = randomUUID()
  const rows = await db
    .insert(topicDelivery)
    .values({
      id,
      organizationId: r.organizationId,
      userId: r.userId,
      channel: r.channel,
      kind: r.kind,
      localDate: r.localDate,
      topicIds: r.topicIds ?? [],
      cardIds: r.cardIds ?? [],
      status: r.status,
      error: r.error ? r.error.slice(0, 2000) : null,
      subject: r.subject ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: topicDelivery.id })
  return rows[0]?.id ?? null
}

export type DayDeliveryRow = { userId: string; kind: string; status: string; error: string | null }

/** Rows of one org, channel and local day (idempotency of the hourly run). */
export async function listDayDeliveries(orgId: string, channel: DeliveryChannelKey, localDate: string): Promise<DayDeliveryRow[]> {
  return db
    .select({ userId: topicDelivery.userId, kind: topicDelivery.kind, status: topicDelivery.status, error: topicDelivery.error })
    .from(topicDelivery)
    .where(
      and(eq(topicDelivery.organizationId, orgId), eq(topicDelivery.channel, channel), eq(topicDelivery.localDate, localDate)),
    )
}

export type DeliveryLogRow = {
  id: string
  userId: string
  userName: string | null
  userEmail: string | null
  channel: string
  kind: string
  localDate: string
  topicCount: number
  status: string
  error: string | null
  subject: string | null
  createdAt: string
}

/** Last `limit` rows of the org's delivery log (admin «Рассылка»). */
export async function listDeliveryLog(orgId: string, limit = 100): Promise<DeliveryLogRow[]> {
  const rows = await db
    .select({ d: topicDelivery, name: user.name, email: user.email })
    .from(topicDelivery)
    .leftJoin(user, eq(user.id, topicDelivery.userId))
    .where(eq(topicDelivery.organizationId, orgId))
    .orderBy(desc(topicDelivery.createdAt))
    .limit(limit)
  return rows.map((r) => ({
    id: r.d.id,
    userId: r.d.userId,
    userName: r.name,
    userEmail: r.email,
    channel: r.d.channel,
    kind: r.d.kind,
    localDate: r.d.localDate,
    topicCount: r.d.topicIds.length,
    status: r.d.status,
    error: r.d.error,
    subject: r.d.subject,
    createdAt: r.d.createdAt.toISOString(),
  }))
}

/** Delete log rows by id (test cleanup only). */
export async function deleteDeliveryRows(orgId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await db.delete(topicDelivery).where(and(eq(topicDelivery.organizationId, orgId), inArray(topicDelivery.id, ids)))
}

// ── Evening reminder marks ────────────────────────────────────────────────

export type ReminderRow = { id: string; cycleReminders: number; lastReminderAt: Date | null; subState: string; status: string }

export async function loadReminderRows(orgId: string, topicIds: string[]): Promise<Map<string, ReminderRow>> {
  const out = new Map<string, ReminderRow>()
  for (let i = 0; i < topicIds.length; i += 500) {
    const rows = await db
      .select({
        id: topic.id,
        cycleReminders: topic.cycleReminders,
        lastReminderAt: topic.lastReminderAt,
        subState: topic.subState,
        status: topic.status,
      })
      .from(topic)
      .where(and(eq(topic.organizationId, orgId), inArray(topic.id, topicIds.slice(i, i + 500))))
    for (const r of rows) out.set(r.id, r)
  }
  return out
}

/**
 * Mark the evening reminder on topics: `cycle_reminders + 1`,
 * `last_reminder_at = now`. Guarded so one evening counts once even when two
 * runs race (`last_reminder_at` before the start of the local day).
 * Attention is derived data: the topic's own `updated_at` is kept.
 */
export async function markEveningReminders(orgId: string, topicIds: string[], now: Date, dayStart: Date): Promise<string[]> {
  if (topicIds.length === 0) return []
  const rows = await db
    .update(topic)
    .set({
      cycleReminders: sql`${topic.cycleReminders} + 1`,
      lastReminderAt: now,
      updatedAt: sql`${topic.updatedAt}`,
    })
    .where(
      and(
        eq(topic.organizationId, orgId),
        inArray(topic.id, topicIds),
        or(isNull(topic.lastReminderAt), lt(topic.lastReminderAt, dayStart)),
      ),
    )
    .returning({ id: topic.id })
  return rows.map((r) => r.id)
}

/** Restore reminder fields (test cleanup only). */
export async function restoreReminderRows(orgId: string, rows: ReminderRow[]): Promise<void> {
  for (const r of rows) {
    await db
      .update(topic)
      .set({ cycleReminders: r.cycleReminders, lastReminderAt: r.lastReminderAt, updatedAt: sql`${topic.updatedAt}` })
      .where(and(eq(topic.organizationId, orgId), eq(topic.id, r.id)))
  }
}

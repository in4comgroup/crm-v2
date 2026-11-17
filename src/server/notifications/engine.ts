import "server-only"

import { randomUUID } from "node:crypto"
import { and, count, desc, eq, gt, inArray, isNull, like, lt, ne, or, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { member, notification, notificationPref, user } from "@/db/schema"
import {
  MUTABLE_CATEGORIES,
  NOTIFICATION_CATEGORY_LABELS,
  NOTIFICATION_KINDS,
  NOTIFICATION_PURGE_AFTER_DAYS,
  ALWAYS_ON_IMPORTANT,
  isDelivered,
  isNotificationCategory,
  notificationExpiry,
  type NotificationCategory,
  type NotificationKind,
  type NotificationPrefsView,
  type NotificationPriority,
  type NotificationView,
  type NotificationsResponse,
} from "@/lib/notifications/kinds"

// Notifications engine (docs/specs/notifications §3). The ONE write path of
// `notification`: `notify` resolves recipients, applies the user's category
// settings, dedupes per user (`dedupe_key`, namespaced with the org id) and
// never throws — a notification never breaks the action that produced it.
// Org-explicit, `server-only`; routes pass the org + user from the session.

export type NotifyInput = {
  kind: NotificationKind
  /** For kinds with recipients `user`: the user ids (null / dup / agents dropped). */
  userIds?: readonly (string | null | undefined)[]
  /** Raise / lower the kind's default priority (e.g. a severe deal risk). */
  priority?: NotificationPriority
  title: string
  body?: string | null
  href?: string | null
  entity?: { type: string; id: string } | null
  /** Unique per recipient and org: the same condition notifies once. */
  dedupeKey: string
  payload?: Record<string, unknown>
  at?: Date
}

/** The stored key: org-namespaced so one user in two orgs gets both. */
export function storedDedupeKey(orgId: string | null, key: string): string {
  return `${orgId ?? "platform"}:${key}`
}

async function humanUserIds(ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return []
  const rows = await db
    .select({ id: user.id })
    .from(user)
    .where(and(inArray(user.id, [...ids]), ne(user.role, "agent"), or(isNull(user.banned), eq(user.banned, false))))
  return rows.map((r) => r.id)
}

async function orgOwnerIds(orgId: string): Promise<string[]> {
  const rows = await db
    .select({ id: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.role, "owner")))
  return humanUserIds(rows.map((r) => r.id))
}

async function orgMemberIds(orgId: string, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return []
  const rows = await db
    .select({ id: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, orgId), inArray(member.userId, [...ids])))
  return humanUserIds(rows.map((r) => r.id))
}

async function platformAdminIds(): Promise<string[]> {
  const rows = await db
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.role, "admin"), or(isNull(user.banned), eq(user.banned, false))))
  return rows.map((r) => r.id)
}

/**
 * Write one notification to every recipient of its kind. `orgId` null only
 * for `platform_admins` kinds. Returns the number of rows inserted (0 when
 * deduped / muted / no recipient). Never throws.
 */
export async function notify(orgId: string | null, input: NotifyInput): Promise<number> {
  try {
    const def = NOTIFICATION_KINDS[input.kind]
    if (!def) return 0
    let recipients: string[]
    if (def.recipients === "owners") {
      if (!orgId) return 0
      recipients = await orgOwnerIds(orgId)
    } else if (def.recipients === "platform_admins") {
      recipients = await platformAdminIds()
    } else {
      const ids = [...new Set((input.userIds ?? []).filter((x): x is string => !!x))]
      recipients = orgId ? await orgMemberIds(orgId, ids) : await humanUserIds(ids)
    }
    if (recipients.length === 0) return 0
    const priority = input.priority ?? def.priority
    const prefs = orgId ? await loadPrefs(orgId, recipients) : new Map<string, Record<string, boolean>>()
    const at = input.at ?? new Date()
    const rows = recipients
      .filter((uid) => isDelivered(def.category, priority, prefs.get(uid)))
      .map((uid) => ({
        id: randomUUID(),
        organizationId: def.recipients === "platform_admins" ? null : orgId,
        userId: uid,
        kind: input.kind,
        category: def.category,
        priority,
        title: input.title.slice(0, 300),
        body: input.body ? input.body.slice(0, 1000) : null,
        href: input.href ?? null,
        entityType: input.entity?.type ?? null,
        entityId: input.entity?.id ?? null,
        dedupeKey: storedDedupeKey(def.recipients === "platform_admins" ? null : orgId, input.dedupeKey),
        payload: input.payload ?? {},
        createdAt: at,
        expiresAt: notificationExpiry(priority, at),
      }))
    if (rows.length === 0) return 0
    const inserted = await db.insert(notification).values(rows).onConflictDoNothing().returning({ id: notification.id })
    // Telegram copy of an IMPORTANT notification (docs/specs/telegram/04 Q21):
    // at once inside working hours, else the hourly sweep. Never throws.
    if (priority === "important" && orgId && def.recipients !== "platform_admins" && inserted.length) {
      const { deliverNotificationsToTelegram } = await import("@/server/telegram/delivery")
      await deliverNotificationsToTelegram(orgId, { ids: inserted.map((r) => r.id), now: at })
    }
    return inserted.length
  } catch (err) {
    console.error(`[notifications] notify ${input.kind} failed`, orgId, err)
    return 0
  }
}

/**
 * The condition is gone: every notification whose key equals `key` (or
 * starts with it when `prefix`) gets `resolved_at` («уже не актуально»).
 * Never throws.
 */
export async function resolveNotifications(orgId: string | null, key: string, opts: { prefix?: boolean } = {}): Promise<number> {
  try {
    const stored = storedDedupeKey(orgId, key)
    const rows = await db
      .update(notification)
      .set({ resolvedAt: new Date() })
      .where(
        and(
          isNull(notification.resolvedAt),
          opts.prefix ? like(notification.dedupeKey, `${stored.replace(/[%_\\]/g, "\\$&")}%`) : eq(notification.dedupeKey, stored),
        ),
      )
      .returning({ id: notification.id })
    return rows.length
  } catch (err) {
    console.error("[notifications] resolve failed", orgId, key, err)
    return 0
  }
}

/** Has this condition already notified anybody (any state)? For «once» checks. */
export async function wasNotified(orgId: string | null, key: string): Promise<boolean> {
  const [r] = await db
    .select({ id: notification.id })
    .from(notification)
    .where(eq(notification.dedupeKey, storedDedupeKey(orgId, key)))
    .limit(1)
  return !!r
}

// ── Read side (the bell) ───────────────────────────────────────────────────

function visibleTo(orgId: string, userId: string, now: Date) {
  return and(
    eq(notification.userId, userId),
    or(eq(notification.organizationId, orgId), isNull(notification.organizationId)),
    isNull(notification.dismissedAt),
    gt(notification.expiresAt, now),
  )
}

export async function listUserNotifications(
  orgId: string,
  userId: string,
  opts: { filter?: "all" | "important"; category?: string | null; limit?: number } = {},
): Promise<NotificationsResponse> {
  const now = new Date()
  const base = visibleTo(orgId, userId, now)
  const conds = [base]
  if (opts.filter === "important") conds.push(eq(notification.priority, "important"))
  if (opts.category && isNotificationCategory(opts.category)) conds.push(eq(notification.category, opts.category))
  const unread = and(base, isNull(notification.readAt), isNull(notification.resolvedAt))
  const [items, [all], [imp]] = await Promise.all([
    db
      .select()
      .from(notification)
      .where(and(...conds))
      .orderBy(desc(notification.createdAt))
      .limit(Math.min(Math.max(opts.limit ?? 50, 1), 200)),
    db.select({ n: count() }).from(notification).where(unread),
    db.select({ n: count() }).from(notification).where(and(unread, eq(notification.priority, "important"))),
  ])
  return {
    items: items.map(
      (r): NotificationView => ({
        id: r.id,
        kind: r.kind,
        category: (isNotificationCategory(r.category) ? r.category : "organization") as NotificationCategory,
        priority: r.priority === "important" ? "important" : "info",
        title: r.title,
        body: r.body,
        href: r.href,
        createdAt: r.createdAt.toISOString(),
        read: !!r.readAt,
        resolved: !!r.resolvedAt,
      }),
    ),
    unreadCount: Number(all?.n ?? 0),
    unreadImportant: Number(imp?.n ?? 0),
  }
}

export async function markNotificationsRead(orgId: string, userId: string, ids: readonly string[] | "all"): Promise<void> {
  const now = new Date()
  const where = and(visibleTo(orgId, userId, now), isNull(notification.readAt))
  await db
    .update(notification)
    .set({ readAt: now })
    .where(ids === "all" ? where : and(where, inArray(notification.id, ids.length ? [...ids] : ["-"])))
}

export async function dismissNotifications(orgId: string, userId: string, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return
  const now = new Date()
  await db
    .update(notification)
    .set({ dismissedAt: now, readAt: sql`coalesce(${notification.readAt}, ${now})` })
    .where(and(visibleTo(orgId, userId, now), inArray(notification.id, [...ids])))
}

// ── Settings (Q8) ──────────────────────────────────────────────────────────

async function loadPrefs(orgId: string, userIds: readonly string[]): Promise<Map<string, Record<string, boolean>>> {
  if (userIds.length === 0) return new Map()
  const rows = await db
    .select({ userId: notificationPref.userId, categories: notificationPref.categories })
    .from(notificationPref)
    .where(and(eq(notificationPref.organizationId, orgId), inArray(notificationPref.userId, [...userIds])))
  return new Map(rows.map((r) => [r.userId, (r.categories ?? {}) as Record<string, boolean>]))
}

export async function getNotificationPrefs(orgId: string, userId: string): Promise<NotificationPrefsView> {
  const [r] = await db
    .select({ categories: notificationPref.categories, telegram: notificationPref.telegramCategories })
    .from(notificationPref)
    .where(and(eq(notificationPref.organizationId, orgId), eq(notificationPref.userId, userId)))
  const prefs = (r?.categories ?? {}) as Record<string, boolean>
  const tg = (r?.telegram ?? {}) as Record<string, boolean>
  const { getMemberTelegramBinding } = await import("@/server/telegram/bindings")
  const binding = await getMemberTelegramBinding(orgId, userId)
  return {
    categories: MUTABLE_CATEGORIES.map((c) => ({
      category: c,
      label: NOTIFICATION_CATEGORY_LABELS[c],
      enabled: prefs[c] !== false,
      importantAlwaysOn: ALWAYS_ON_IMPORTANT.includes(c),
      telegram: tg[c] !== false,
    })),
    telegramBound: binding?.status === "active",
  }
}

/** Save the in-app categories and / or the Telegram copies (`{ [category]: false }` = off). */
export async function setNotificationPrefs(
  orgId: string,
  userId: string,
  categories: Record<string, unknown> | null,
  telegram?: Record<string, unknown> | null,
): Promise<NotificationPrefsView> {
  const clean = (v: Record<string, unknown>) => {
    const out: Record<string, boolean> = {}
    for (const c of MUTABLE_CATEGORIES) if (v[c] === false) out[c] = false
    return out
  }
  const set: { categories?: Record<string, boolean>; telegramCategories?: Record<string, boolean> } = {}
  if (categories) set.categories = clean(categories)
  if (telegram) set.telegramCategories = clean(telegram)
  if (!set.categories && !set.telegramCategories) return getNotificationPrefs(orgId, userId)
  await db
    .insert(notificationPref)
    .values({ organizationId: orgId, userId, categories: set.categories ?? {}, telegramCategories: set.telegramCategories ?? {}, updatedAt: new Date() })
    .onConflictDoUpdate({ target: [notificationPref.organizationId, notificationPref.userId], set: { ...set, updatedAt: new Date() } })
  return getNotificationPrefs(orgId, userId)
}

// ── Retention (Q11) ────────────────────────────────────────────────────────

/** Delete rows 30 days after they expired (daily job). */
export async function purgeExpiredNotifications(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - NOTIFICATION_PURGE_AFTER_DAYS * 86_400_000)
  const rows = await db.delete(notification).where(lt(notification.expiresAt, cutoff)).returning({ id: notification.id })
  return rows.length
}

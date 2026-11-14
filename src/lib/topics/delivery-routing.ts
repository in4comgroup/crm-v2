// Routing, P6 daily limit, evening reminders and the delivery schedule of
// topics delivery (topics plan phase 7; spec topics/01 §8.1; 06 §7.2–7.3,
// §16 test 12). PURE and client-safe (no DB, no server imports) — the
// dashboard read (src/server/topics-user.ts) and the delivery phase
// (src/server/topics/delivery/) share these rules. Unit-tested in
// delivery-routing.test.ts and src/server/topics/attention/engine.test.ts.
//
// ROUTING (who is the recipient of a topic):
//   the topic's assignee `owner_user_id` when that user is a human member of
//   the org; else the linked deal's owner (`deal.user_id`) when a member;
//   else nobody in particular → EVERY human member is a recipient.
//
// P6 DAILY LIMIT (`dailyPushLimit`, default 3; 06 §7.2): per recipient, at
// most N distinct P6 topics ENTER «Сейчас» per org-local day. A topic
// "enters" on the local day its display cycle started (`cycleStartedAt`).
// Inside one day the first N topics by cycle start (first come, first
// served; ties by list rank) stay in «Сейчас»; the rest go to «Сводка»
// (`limited`) for that cycle. Topics of earlier days keep their own day's
// decision, so the limit never counts the reminder or the re-display of an
// already shown topic, and a later topic never pushes out an earlier one.
// I1 (deadline < 24 h) and I5 (serious deal risk) make a topic P8 → never
// limited. Read-time only: nothing is written.

import { weeklyReviewDay, type WorkCalendar } from "./attention-calendar"
import type { AttentionParams } from "./attention-params"
import type { TopicList } from "./attention-types"
import type { DeliveryParams } from "./delivery-params"

// The weekly review day rule lives in the calendar module (one rule for the
// «Неделя» list, the attention engine and the weekly email).
export { weeklyReviewDay }

// ── Shapes ────────────────────────────────────────────────────────────────

/** The attention fields the delivery rules read (subset of TopicEntryAttention). */
export type RoutableAttention = {
  list: TopicList
  profile: string | null
  escalations: string[]
  cycleStartedAt: string | null
  hiddenReason?: string | null
  explanation?: string[]
  /** Set by `applyDailyLimit`: a P6 topic moved from «Сейчас» to «Сводка». */
  limited?: boolean
}

export type RoutableEntry = {
  topicId: string
  ownerUserId: string | null
  dealOwnerUserId: string | null
  attention: RoutableAttention | null
}

// ── Routing ───────────────────────────────────────────────────────────────

/** The recipient user id of a topic, or null = every human member. */
export function topicRecipient(
  e: Pick<RoutableEntry, "ownerUserId" | "dealOwnerUserId">,
  memberIds: ReadonlySet<string>,
): string | null {
  if (e.ownerUserId && memberIds.has(e.ownerUserId)) return e.ownerUserId
  if (e.dealOwnerUserId && memberIds.has(e.dealOwnerUserId)) return e.dealOwnerUserId
  return null
}

/** True when `userId` receives this topic (its recipient, or a member when there is none). */
export function isRecipient(
  e: Pick<RoutableEntry, "ownerUserId" | "dealOwnerUserId">,
  userId: string,
  memberIds: ReadonlySet<string>,
): boolean {
  const r = topicRecipient(e, memberIds)
  return r === null ? memberIds.has(userId) : r === userId
}

// ── P6 daily limit ────────────────────────────────────────────────────────

/** A topic the daily limit applies to: «Сейчас» with profile P6 and no I1 / I5. */
export function isLimitCandidate(a: RoutableAttention | null | undefined): boolean {
  return !!a && a.list === "now" && a.profile === "P6" && !a.escalations.includes("I1") && !a.escalations.includes("I5")
}

/** Ids of the P6 topics admitted to «Сейчас» for one recipient (06 §7.2). */
export function admittedForUser(
  entries: readonly RoutableEntry[],
  userId: string,
  memberIds: ReadonlySet<string>,
  limit: number,
  dayOf: (iso: string | null) => string,
): Set<string> {
  const byDay = new Map<string, { id: string; at: number; idx: number }[]>()
  entries.forEach((e, idx) => {
    if (!isLimitCandidate(e.attention) || !isRecipient(e, userId, memberIds)) return
    const startedAt = e.attention!.cycleStartedAt
    const day = dayOf(startedAt)
    const at = startedAt ? new Date(startedAt).getTime() : 0
    const list = byDay.get(day) ?? []
    list.push({ id: e.topicId, at: Number.isFinite(at) ? at : 0, idx })
    byDay.set(day, list)
  })
  const out = new Set<string>()
  for (const list of byDay.values()) {
    list.sort((a, b) => a.at - b.at || a.idx - b.idx)
    for (const x of list.slice(0, Math.max(0, limit))) out.add(x.id)
  }
  return out
}

export const DAILY_LIMIT_EXPLANATION = (limit: number) =>
  `дневной лимит «Сейчас» (${limit} новых тем в день) исчерпан: в «Сводке»`

/**
 * Apply the P6 daily limit to «Сейчас» entries (rank order). A topic routed
 * to one person is decided by THAT person's limit; a topic for every member
 * is decided by the viewer's limit. Limited entries get list `digest`,
 * `limited: true` and one explanation line.
 */
export function applyDailyLimit<T extends RoutableEntry>(
  entries: readonly T[],
  viewerId: string,
  memberIds: ReadonlySet<string>,
  limit: number,
  dayOf: (iso: string | null) => string,
): T[] {
  if (limit <= 0) return [...entries]
  const cache = new Map<string, Set<string>>()
  const admitted = (userId: string) => {
    let s = cache.get(userId)
    if (!s) {
      s = admittedForUser(entries, userId, memberIds, limit, dayOf)
      cache.set(userId, s)
    }
    return s
  }
  return entries.map((e) => {
    if (!isLimitCandidate(e.attention)) return e
    const decider = topicRecipient(e, memberIds) ?? viewerId
    if (admitted(decider).has(e.topicId)) return e
    const a = e.attention!
    return {
      ...e,
      attention: {
        ...a,
        list: "digest" as const,
        limited: true,
        explanation: [...(a.explanation ?? []).filter((l) => !l.startsWith("итог:")), DAILY_LIMIT_EXPLANATION(limit), "итог: «Сводка»"],
      },
    }
  })
}

/**
 * «Сейчас» and «Сводка» as one viewer sees them: the daily limit moves
 * overflow P6 topics from «Сейчас» to the TOP of «Сводка» (they outrank D4).
 */
export function splitWithDailyLimit<T extends RoutableEntry>(
  nowEntries: readonly T[],
  digestEntries: readonly T[],
  viewerId: string,
  memberIds: ReadonlySet<string>,
  limit: number,
  dayOf: (iso: string | null) => string,
): { now: T[]; digest: T[] } {
  const limited = applyDailyLimit(nowEntries, viewerId, memberIds, limit, dayOf)
  return {
    now: limited.filter((e) => e.attention?.list === "now"),
    digest: [...limited.filter((e) => e.attention?.list === "digest"), ...digestEntries],
  }
}

// ── Evening reminders (06 §7.3, §15 A7) ───────────────────────────────────

export type ReminderState = {
  status: string
  subState: string
  /** Placed (read-time) attention, after the daily limit. */
  attention: Pick<RoutableAttention, "list" | "profile" | "hiddenReason"> | null
  cycleReminders: number
  lastReminderAt: Date | null
}

/**
 * Does the topic get an evening reminder «Не закрыто сегодня» tonight?
 * Open, waiting on us, in «Сейчас» as P6 / P8 (lead active), fewer than
 * `p6RepeatMax` reminders in this cycle, not reminded yet this local day.
 */
export function eveningReminderDue(
  t: ReminderState,
  now: Date,
  localDay: (d: Date) => string,
  maxPerCycle: number,
): boolean {
  const a = t.attention
  if (t.status !== "open" || t.subState !== "waiting_on_us") return false
  if (!a || a.list !== "now" || a.hiddenReason || (a.profile !== "P6" && a.profile !== "P8")) return false
  if (t.cycleReminders >= maxPerCycle) return false
  if (t.lastReminderAt && localDay(t.lastReminderAt) === localDay(now)) return false
  return true
}

/**
 * `topic.cycle_reminders` after an attention recompute: a new cycle (a
 * material change, 06 §7.1) resets it to 0; a NOOP item or a background
 * recompute keeps it.
 */
export function cycleRemindersAfter(prev: number, a: { cycleStarted: boolean }): number {
  return a.cycleStarted ? 0 : prev
}

/** Hours an in-app «Напоминание» marker stays on a topic after the evening reminder. */
export const REMINDER_MARKER_HOURS = 24

/** In-app «Напоминание» marker: the last reminder of THIS cycle, in the last 24 h. */
export function reminderMarker(
  t: { lastReminderAt: Date | null; cycleStartedAt: Date | null; cycleReminders: number },
  now: Date,
): { count: number; at: string } | null {
  if (!t.lastReminderAt || t.cycleReminders <= 0) return null
  const at = t.lastReminderAt.getTime()
  if (t.cycleStartedAt && at < t.cycleStartedAt.getTime()) return null
  if (at > now.getTime() || now.getTime() - at > REMINDER_MARKER_HOURS * 3600_000) return null
  return { count: t.cycleReminders, at: t.lastReminderAt.toISOString() }
}

// ── Schedule ──────────────────────────────────────────────────────────────

export const DELIVERY_KINDS = ["morning_digest", "weekly_digest", "evening_reminder"] as const
export type DeliveryKind = (typeof DELIVERY_KINDS)[number]
/** Every `topic_delivery.kind` value (text column validated in code). */
export const DELIVERY_ROW_KINDS = [...DELIVERY_KINDS, "push", "test"] as const
export type DeliveryRowKind = (typeof DELIVERY_ROW_KINDS)[number]

export const DELIVERY_KIND_LABELS_RU: Record<DeliveryRowKind, string> = {
  morning_digest: "Утренняя сводка",
  weekly_digest: "Итоги недели",
  evening_reminder: "Вечернее напоминание",
  push: "Сообщение",
  test: "Тестовое письмо",
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number)
  return h * 60 + m
}

/**
 * Which deliveries are due at `now` (org time): the first hourly run at or
 * after the scheduled time, within `sendWindowHours`.
 *   morning_digest   — every working day at `morningDigestTime` (07:30);
 *   weekly_digest    — the weekly review day (Fri, or the last working day of
 *                      the week before it) at `weeklyReviewTime` (12:00);
 *   evening_reminder — every working day at `eveningDigestTime` (17:00).
 */
export function dueDeliveryKinds(now: Date, cal: WorkCalendar, ap: AttentionParams, dp: DeliveryParams): DeliveryKind[] {
  const day = cal.localDay(now)
  const min = cal.localMinutes(now)
  const win = dp.sendWindowHours * 60
  const inWindow = (hhmm: string) => min >= minutesOf(hhmm) && min < minutesOf(hhmm) + win
  const out: DeliveryKind[] = []
  const working = cal.isWorkingDay(day)
  if (working && inWindow(ap.morningDigestTime)) out.push("morning_digest")
  if (weeklyReviewDay(cal, day, ap.weeklyReviewWeekday) === day && inWindow(ap.weeklyReviewTime)) out.push("weekly_digest")
  if (working && inWindow(dp.eveningDigestTime)) out.push("evening_reminder")
  return out
}

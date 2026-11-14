import "server-only"

import { WorkCalendar } from "@/lib/topics/attention-calendar"
import type { AttentionParams } from "@/lib/topics/attention-params"
import {
  deliveryLinks,
  eveningModel,
  morningModel,
  userLists,
  weeklyModel,
  type DeliveryLinks,
  type ModelContext,
  type OrgLists,
} from "@/lib/topics/delivery-content"
import type { DeliveryParams } from "@/lib/topics/delivery-params"
import { renderDigest, type RenderedEmail } from "@/lib/topics/delivery-render"
import { dueDeliveryKinds, eveningReminderDue, type DeliveryKind } from "@/lib/topics/delivery-routing"
import type { TopicEntry } from "@/lib/topics/topic-ui"
import { readOrgListEntries } from "@/server/topics-user"
import { loadAttentionParams, loadCalendarDays } from "@/server/topics/attention/store"
import { getTopicsMode } from "@/server/topics/mode"
import { emailChannel, telegramChannel, type ChannelRecipient, type DeliveryChannel, type EmailSender } from "./channels"
import {
  DEFAULT_PREFS,
  getOrgName,
  listDayDeliveries,
  listOrgHumanMembers,
  loadDeliveryParams,
  loadDeliveryPrefs,
  loadReminderRows,
  markEveningReminders,
  orgEmailDeliveryOn,
  recordDelivery,
  type DayDeliveryRow,
  type DeliveryPrefs,
  type DeliveryRecipient,
  type ReminderRow,
} from "./store"
import type { EmailProviderStatus } from "@/lib/email"

// Topics delivery run for ONE org (plan phase 7; spec 01 §8.1, 06 §7.2–7.3).
// Called by the hourly phase (`phase.ts`, `now` = the clock) and by tests /
// the live check (fixed `now`, injected sender). Org-explicit, session-free.
//
// Per run:
//   1. mode must be `on` (shadow / off: nothing is delivered);
//   2. due kinds from the schedule (`dueDeliveryKinds`, org time);
//   3. the org's lists (same read as the dashboard) → per-user lists with the
//      P6 daily limit and the routing;
//   4. evening: mark the in-app reminders on topics (cycle_reminders + 1,
//      last_reminder_at; ≤ p6RepeatMax per cycle, once per evening) — also
//      when the org email switch is off (the dashboard marker is in-app);
//   5. email (only when org switch `topics.delivery.email` is on): one email
//      per user and kind and local day, logged in `topic_delivery`.
// Idempotency: a user / kind / day with a `sent` row, or a `skipped` row
// with a final reason (empty, opted_out, no_email), is done; `failed` is
// retried by later runs of the send window (max 3 attempts); a provider
// that is not configured records ONE `skipped` row and is retried.

const FINAL_SKIP = new Set(["empty", "opted_out", "no_email"])
const MAX_FAILED = 3

/** Base URL of the app for links in emails. */
export function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/+$/, "")
}

// ── Context ───────────────────────────────────────────────────────────────

export type DeliveryContext = {
  orgId: string
  orgName: string
  now: Date
  localDay: string
  ap: AttentionParams
  dp: DeliveryParams
  cal: WorkCalendar
  lists: OrgLists
  members: DeliveryRecipient[]
  memberIds: Set<string>
  prefs: Map<string, DeliveryPrefs>
  links: DeliveryLinks
  dayOf: (iso: string | null) => string
}

export async function loadDeliveryContext(orgId: string, now: Date): Promise<DeliveryContext> {
  const [orgName, ap, dp, days, lists, members, prefs] = await Promise.all([
    getOrgName(orgId),
    loadAttentionParams(orgId),
    loadDeliveryParams(orgId),
    loadCalendarDays(),
    readOrgListEntries(orgId, now),
    listOrgHumanMembers(orgId),
    loadDeliveryPrefs(orgId),
  ])
  const cal = new WorkCalendar(days, { timeZone: ap.timeZone, workStart: ap.workStart, workEnd: ap.workEnd })
  return {
    orgId,
    orgName,
    now,
    localDay: cal.localDay(now),
    ap,
    dp,
    cal,
    lists,
    members,
    memberIds: new Set(members.map((m) => m.userId)),
    prefs,
    links: deliveryLinks(appBaseUrl()),
    dayOf: (iso) => (iso ? cal.localDay(new Date(iso)) : "0000-00-00"),
  }
}

export function listsForUser(ctx: DeliveryContext, userId: string): OrgLists {
  return userLists(ctx.lists, userId, ctx.memberIds, ctx.dp.dailyPushLimit, ctx.dayOf)
}

function modelContext(ctx: DeliveryContext, m: DeliveryRecipient, test = false): ModelContext {
  return {
    orgName: ctx.orgName,
    userName: m.name || null,
    localDay: ctx.localDay,
    timeZone: ctx.ap.timeZone,
    links: ctx.links,
    digestVisibleItems: ctx.dp.digestVisibleItems,
    test,
  }
}

// ── Evening reminders (in-app marks) ──────────────────────────────────────

export type EveningState = {
  /** Topics with a reminder THIS evening (marked now or earlier this evening). */
  tonight: Set<string>
  /** Reminder count of each topic after tonight's mark. */
  count: Map<string, number>
  /** Topic ids newly marked by this run. */
  marked: string[]
  /** Rows before the mark (test cleanup / restore). */
  before: ReminderRow[]
}

/**
 * Evening reminders of the org: every topic in some recipient's «Сейчас»
 * (after the daily limit) that passes `eveningReminderDue` gets one mark.
 * `persist: false` = compute only (admin preview).
 */
export async function eveningReminders(ctx: DeliveryContext, persist: boolean): Promise<EveningState> {
  const byId = new Map<string, TopicEntry>()
  for (const m of ctx.members) for (const e of listsForUser(ctx, m.userId).now) byId.set(e.topicId, e)
  const rows = await loadReminderRows(ctx.orgId, [...byId.keys()])
  const eveningAt = ctx.cal.at(ctx.localDay, ctx.dp.eveningDigestTime)
  const dayStart = ctx.cal.at(ctx.localDay, 0)
  const tonight = new Set<string>()
  const count = new Map<string, number>()
  const due: string[] = []
  for (const [id, e] of byId) {
    const r = rows.get(id)
    if (!r) continue
    const doneTonight =
      !!r.lastReminderAt &&
      ctx.cal.localDay(r.lastReminderAt) === ctx.localDay &&
      r.lastReminderAt.getTime() >= eveningAt.getTime()
    if (doneTonight) {
      tonight.add(id)
      count.set(id, r.cycleReminders)
      continue
    }
    const ok = eveningReminderDue(
      { status: r.status, subState: r.subState, attention: e.attention, cycleReminders: r.cycleReminders, lastReminderAt: r.lastReminderAt },
      ctx.now,
      (d) => ctx.cal.localDay(d),
      ctx.dp.p6RepeatMax,
    )
    if (ok) due.push(id)
  }
  const marked = persist ? await markEveningReminders(ctx.orgId, due, ctx.now, dayStart) : due
  for (const id of marked) {
    tonight.add(id)
    count.set(id, (rows.get(id)?.cycleReminders ?? 0) + 1)
  }
  return { tonight, count, marked: persist ? marked : [], before: marked.map((id) => rows.get(id)!).filter(Boolean) }
}

// ── Content per user ──────────────────────────────────────────────────────

export type UserContent = { rendered: RenderedEmail; topicIds: string[]; cardIds: string[] }

export function buildUserEmail(
  ctx: DeliveryContext,
  m: DeliveryRecipient,
  kind: DeliveryKind,
  evening: EveningState | null,
  test = false,
): UserContent {
  const lists = listsForUser(ctx, m.userId)
  const mc = modelContext(ctx, m, test)
  let entries: TopicEntry[]
  let rendered: RenderedEmail
  if (kind === "morning_digest") {
    entries = [...lists.now, ...lists.digest]
    rendered = renderDigest(morningModel(lists, mc))
  } else if (kind === "weekly_digest") {
    entries = lists.week
    rendered = renderDigest(weeklyModel(lists, mc))
  } else {
    entries = lists.now.filter((e) => evening?.tonight.has(e.topicId))
    rendered = renderDigest(
      eveningModel(entries, (id) => evening?.count.get(id) ?? 1, ctx.dp.p6RepeatMax, mc),
    )
  }
  return {
    rendered,
    topicIds: entries.map((e) => e.topicId),
    cardIds: entries.map((e) => e.card?.id).filter((x): x is string => !!x),
  }
}

// ── Run ───────────────────────────────────────────────────────────────────

export type DeliveryRunOptions = {
  now?: Date
  /** Force these kinds (default: what the schedule says is due at `now`). */
  kinds?: DeliveryKind[]
  /** Email send function (default `sendEmails`). Tests inject a fake. */
  emailSender?: EmailSender
  /** Provider check (default `emailProviderStatus`). */
  providerStatus?: () => EmailProviderStatus
  /** Tests only: use this instead of the org switch `topics.delivery.email`. */
  emailSwitchOverride?: boolean
  /** Evening: write the in-app reminder marks (default true). */
  markReminders?: boolean
}

export type DeliveryDetail = {
  userId: string
  name: string
  email: string
  kind: DeliveryKind
  channel: "email" | "telegram"
  status: "sent" | "failed" | "skipped" | "done"
  reason: string | null
  subject: string | null
  topicCount: number
  rowId: string | null
}

export type DeliveryRunResult = {
  result: { skipped: string } | Record<string, number>
  details: DeliveryDetail[]
  evening: EveningState | null
  kinds: DeliveryKind[]
}

function alreadyDone(rows: DayDeliveryRow[], userId: string, kind: string): { done: boolean; skipReason: string | null } {
  const mine = rows.filter((r) => r.userId === userId && r.kind === kind)
  if (mine.some((r) => r.status === "sent")) return { done: true, skipReason: null }
  if (mine.some((r) => r.status === "skipped" && FINAL_SKIP.has(r.error ?? ""))) return { done: true, skipReason: null }
  if (mine.filter((r) => r.status === "failed").length >= MAX_FAILED) return { done: true, skipReason: null }
  const pending = mine.find((r) => r.status === "skipped")
  return { done: false, skipReason: pending?.error ?? null }
}

const PREF_OF: Record<DeliveryKind, keyof DeliveryPrefs> = {
  morning_digest: "emailMorning",
  weekly_digest: "emailWeekly",
  evening_reminder: "emailEvening",
}

export async function runOrgDelivery(orgId: string, opts: DeliveryRunOptions = {}): Promise<DeliveryRunResult> {
  const now = opts.now ?? new Date()
  if ((await getTopicsMode(orgId)) !== "on") {
    return { result: { skipped: "topics mode is not on" }, details: [], evening: null, kinds: [] }
  }
  const ctx = await loadDeliveryContext(orgId, now)
  const kinds = opts.kinds ?? dueDeliveryKinds(now, ctx.cal, ctx.ap, ctx.dp)
  if (kinds.length === 0) return { result: { skipped: "no delivery due" }, details: [], evening: null, kinds }

  const counts: Record<string, number> = {
    morning: kinds.includes("morning_digest") ? 1 : 0,
    weekly: kinds.includes("weekly_digest") ? 1 : 0,
    evening: kinds.includes("evening_reminder") ? 1 : 0,
    recipients: ctx.members.filter((m) => !m.banned).length,
    remindersMarked: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    emailOff: 0,
    telegramSkipped: 0,
  }
  const evening = kinds.includes("evening_reminder") ? await eveningReminders(ctx, opts.markReminders !== false) : null
  if (evening) counts.remindersMarked = evening.marked.length

  const details: DeliveryDetail[] = []
  const emailOn = opts.emailSwitchOverride ?? (await orgEmailDeliveryOn(orgId))
  if (!emailOn) {
    counts.emailOff = 1
    return { result: counts, details, evening, kinds }
  }

  const email = emailChannel({ sender: opts.emailSender, providerStatus: opts.providerStatus })
  const telegram: DeliveryChannel = telegramChannel()
  const dayRows = await listDayDeliveries(orgId, "email", ctx.localDay)

  for (const kind of kinds) {
    for (const m of ctx.members) {
      if (m.banned) continue
      const prefs = ctx.prefs.get(m.userId) ?? DEFAULT_PREFS
      const base = { userId: m.userId, name: m.name, email: m.email, kind, channel: "email" as const }
      const state = alreadyDone(dayRows, m.userId, kind)
      if (state.done) {
        details.push({ ...base, status: "done", reason: null, subject: null, topicCount: 0, rowId: null })
        continue
      }
      const recipient: ChannelRecipient = { userId: m.userId, name: m.name, email: m.email, telegramChatId: prefs.telegramChatId }
      const record = async (status: "sent" | "failed" | "skipped", reason: string | null, c: UserContent | null) => {
        // A non-final skip (provider not configured) is logged once per day.
        const rowId =
          status === "skipped" && reason && reason === state.skipReason
            ? null
            : await recordDelivery({
                organizationId: orgId,
                userId: m.userId,
                channel: "email",
                kind,
                localDate: ctx.localDay,
                topicIds: c?.topicIds ?? [],
                cardIds: c?.cardIds ?? [],
                status,
                error: reason,
                subject: c?.rendered.subject ?? null,
              })
        counts[status]++
        details.push({ ...base, status, reason, subject: c?.rendered.subject ?? null, topicCount: c?.topicIds.length ?? 0, rowId })
      }
      if (!prefs[PREF_OF[kind]]) {
        await record("skipped", "opted_out", null)
        continue
      }
      if (!email.address(recipient)) {
        await record("skipped", "no_email", null)
        continue
      }
      const c = buildUserEmail(ctx, m, kind, evening)
      if (c.rendered.empty) {
        await record("skipped", "empty", c)
        continue
      }
      const res = await email.send(recipient, { subject: c.rendered.subject, html: c.rendered.html, text: c.rendered.text })
      if (res.status === "sent") await record("sent", null, c)
      else if (res.status === "failed") await record("failed", res.error, c)
      else await record("skipped", res.reason, c)

      // Telegram (open part of phase 7): only for users who switched it on.
      if (prefs.telegramEnabled) {
        const t = await telegram.send(recipient, { subject: c.rendered.subject, html: c.rendered.html, text: c.rendered.text })
        if (t.status === "skipped") counts.telegramSkipped++
      }
    }
  }
  return { result: counts, details, evening, kinds }
}

// Content of topics delivery (topics plan phase 7): the per-user lists and
// the email models (morning / weekly / evening). PURE and client-safe — the
// delivery phase and the admin preview build the SAME models from the same
// dashboard entries. Rendering: delivery-render.ts.

import type { DigestEntry, DigestModel, DigestSection } from "./delivery-render"
import { isRecipient, splitWithDailyLimit, type DeliveryKind } from "./delivery-routing"
import { viewerLists, type SnapshotContext } from "./list-snapshot"
import { splitDigest, splitWeek, type TopicEntry } from "./topic-ui"

/**
 * The org's lists (rank order, no daily limit). With `snapshot` (+ `others`
 * = topics that may still be held in a snapshot) «Сводка» / «Неделя» are
 * frozen per recipient exactly like the dashboard (list-snapshot.ts).
 */
export type OrgLists = {
  now: TopicEntry[]
  digest: TopicEntry[]
  week: TopicEntry[]
  others?: TopicEntry[]
  snapshot?: SnapshotContext
}

/**
 * The lists ONE recipient gets: the P6 daily limit as this user sees it,
 * «Сводка» / «Неделя» frozen at their last snapshot (when the context is
 * given), then only topics routed to the user (assignee / deal owner = the
 * user, or no recipient → every member). Spec 01 §8.1, 06 §7.2.
 */
export function userLists(
  org: OrgLists,
  userId: string,
  memberIds: ReadonlySet<string>,
  limit: number,
  dayOf: (iso: string | null) => string,
): OrgLists {
  const mine = (e: TopicEntry) => isRecipient(e, userId, memberIds)
  if (org.snapshot) {
    const v = viewerLists(
      { now: org.now, digest: org.digest, week: org.week, others: org.others ?? [] },
      org.snapshot,
      userId,
      memberIds,
      limit,
      dayOf,
    )
    return { now: v.now.filter(mine), digest: v.digest.filter(mine), week: v.week.filter(mine) }
  }
  const split = splitWithDailyLimit(org.now, org.digest, userId, memberIds, limit, dayOf)
  return { now: split.now.filter(mine), digest: split.digest.filter(mine), week: org.week.filter(mine) }
}

// ── Links ─────────────────────────────────────────────────────────────────

export type DeliveryLinks = {
  dashboard: string
  topic: (topicId: string) => string
  tab: (tab: "now" | "digest" | "week") => string
  settings: string
}

/** Links into the app (`NEXT_PUBLIC_APP_URL`); the dashboard opens the topic drawer on `?topic=`. */
export function deliveryLinks(appUrl: string): DeliveryLinks {
  const base = appUrl.replace(/\/+$/, "")
  return {
    dashboard: `${base}/dashboard`,
    topic: (id) => `${base}/dashboard?topic=${encodeURIComponent(id)}`,
    tab: (tab) => `${base}/dashboard?tab=${tab}`,
    settings: `${base}/account?tab=notifications`,
  }
}

// ── Entries ───────────────────────────────────────────────────────────────

function firstExplanation(e: TopicEntry): string | null {
  const line = (e.attention?.explanation ?? []).find((l) => !l.startsWith("итог:"))
  return line ?? null
}

export function digestEntry(e: TopicEntry, links: DeliveryLinks, note?: string | null): DigestEntry {
  const marker = e.marker === "new" ? "Новое" : e.marker === "updated" ? "Обновлено" : null
  return {
    topicId: e.topicId,
    headline: e.card?.headline?.trim() || e.title,
    whyNow: e.card?.whyNow?.trim() || firstExplanation(e),
    company: e.clientName ?? e.contactName ?? null,
    deadline: e.attention?.deadline ?? null,
    overdue: !!e.attention?.overdue,
    link: links.topic(e.topicId),
    note: note ?? (e.attention?.limited ? "Лимит дня" : marker),
  }
}

/** «понедельник, 16 ноября» for a local day "YYYY-MM-DD". */
export function dateLabelRu(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  })
}

export type ModelContext = {
  orgName: string
  userName: string | null
  localDay: string
  timeZone: string
  links: DeliveryLinks
  digestVisibleItems: number
  test?: boolean
}

function model(kind: DeliveryKind, sections: DigestSection[], c: ModelContext): DigestModel {
  return {
    kind,
    test: c.test,
    orgName: c.orgName,
    userName: c.userName,
    dateLabel: dateLabelRu(c.localDay),
    sections,
    dashboardUrl: c.links.dashboard,
    settingsUrl: c.links.settings,
    timeZone: c.timeZone,
  }
}

/** Morning digest: «Сейчас» (all) + «Сводка» = the morning snapshot (N visible + «Ещё N») + «Новое с утра». */
export function morningModel(lists: OrgLists, c: ModelContext): DigestModel {
  const d = splitDigest(lists.digest, c.digestVisibleItems)
  return model(
    "morning_digest",
    [
      { title: "Сейчас", hint: "требуют внимания сегодня", entries: lists.now.map((e) => digestEntry(e, c.links)) },
      {
        title: "Сводка",
        hint: "можно разобрать в течение дня",
        entries: [...d.shown, ...d.more].map((e) => digestEntry(e, c.links)),
        visible: c.digestVisibleItems,
        moreLink: c.links.tab("digest"),
      },
      {
        title: "Новое с утра",
        hint: "появилось после утреннего снимка",
        entries: d.sinceMorning.map((e) => digestEntry(e, c.links)),
      },
    ],
    c,
  )
}

/** Weekly digest: «Неделя» + «Истекло» + «Тема затихла». */
export function weeklyModel(lists: OrgLists, c: ModelContext): DigestModel {
  const w = splitWeek(lists.week)
  return model(
    "weekly_digest",
    [
      { title: "Неделя", hint: "темы для обзора недели", entries: w.main.map((e) => digestEntry(e, c.links)) },
      {
        title: "Истекло",
        hint: "карточка истекла, вопрос ещё открыт",
        entries: w.expired.map((e) => digestEntry(e, c.links, "Истекло")),
      },
      {
        title: "Тема затихла",
        hint: "давно нет активности",
        entries: w.dormant.map((e) => digestEntry(e, c.links, "Тема затихла")),
      },
      {
        title: "Новое после обзора",
        hint: "появилось после еженедельного снимка",
        entries: w.since.map((e) => digestEntry(e, c.links)),
      },
    ],
    c,
  )
}

/** Evening reminder: the user's «Сейчас» topics reminded tonight, «Напоминание N из max». */
export function eveningModel(
  entries: TopicEntry[],
  reminderCount: (topicId: string) => number,
  maxPerCycle: number,
  c: ModelContext,
): DigestModel {
  return model(
    "evening_reminder",
    [
      {
        title: "Не закрыто сегодня",
        hint: "ждут нашего ответа",
        entries: entries.map((e) => digestEntry(e, c.links, `Напоминание ${reminderCount(e.topicId)} из ${maxPerCycle}`)),
      },
    ],
    c,
  )
}

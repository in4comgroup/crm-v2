// Frozen «Сводка» / «Неделя» lists (06-attention-engine.md §7.2; topics plan
// phase 6 «Open»). PURE and client-safe — the dashboard read
// (src/server/topics-user.ts) and the morning / weekly emails
// (delivery-content.ts) share these rules, so both show the same content.
//
// «Сейчас» is continuous. «Сводка» and «Неделя» are SNAPSHOTS:
//   «Сводка» = the D4 topics (and the P6 overflow of the daily limit) as of
//              the last morning point (`morningDigestTime`, last working day ≤
//              now), plus a marked part «Новое с утра» for topics that
//              joined the list later;
//   «Неделя» = the W1 topics, «Истекло» and «Тема затихла» as of the last
//              weekly review point (`weeklyReviewDay` + `weeklyReviewTime`),
//              plus a marked part «Новое после обзора» for W1 / «Истекло»
//              topics that joined later (a dormant topic waits for its own
//              snapshot, H5 «shown once in the next «Неделя» snapshot»).
// Between two snapshot points the snapshot part does not change, with three
// exceptions (interpretation, see the plan): a topic that is no longer live
// (resolved / done / dismissed / merged / expired / archived — it is not
// loaded at all) or that a user snoozed leaves at once (the person acted on
// it); a topic that rose to a HIGHER list is shown there only (one place per
// topic: «Сейчас» > «Сводка» > «Неделя»). A topic that dropped to a lower
// list or out of every list (H3 waiting on them, card expiry, …) stays in
// the snapshot until the next snapshot point, with one explanation line.
//
// The list of a topic at a snapshot moment S is rebuilt at read time from
// stored data — no snapshot table:
//   1. the stored attention was computed at or before S → nothing changed
//      since, so the read-time placement of it at S is exact;
//   2. else the `topic_event` `attention_changed` journal: every change of
//      `topic.list` writes one event { from, to } (attention store), so the
//      list at S = `from` of the first event after S;
//   3. no event after S → the stored `topic.list`.

import type { TopicList } from "./attention-types"
import { splitWithDailyLimit, type RoutableEntry } from "./delivery-routing"

export type SnapshotTab = "digest" | "week"
/** "snapshot" = in the snapshot and still in the list; "held" = in the snapshot, left the list after it; "since" = joined after it. */
export type SnapshotMembership = "snapshot" | "held" | "since"

/** One `attention_changed` journal row of a topic (payload { from, to }). */
export type ListChangeEvent = { at: Date; from: string; to: string }

const LISTS: readonly string[] = ["now", "digest", "week", "none"]
const asList = (v: string): TopicList => (LISTS.includes(v) ? (v as TopicList) : "none")

/**
 * The list a topic was in at snapshot moment `at` (rules 1–3 above).
 * `placedAt` = the read-time placement of the CURRENT stored attention at
 * `at`, used only when that attention was computed at or before `at`.
 */
export function listAtMoment(
  input: { storedList: string; computedAt: Date | null; placedAt: TopicList | null; events: readonly ListChangeEvent[] },
  at: Date,
): TopicList {
  const t = at.getTime()
  if (input.computedAt && input.computedAt.getTime() <= t && input.placedAt) return input.placedAt
  let first: ListChangeEvent | null = null
  for (const e of input.events) {
    if (e.at.getTime() > t && (!first || e.at.getTime() < first.at.getTime())) first = e
  }
  return asList(first ? first.from : input.storedList)
}

/** Per-topic facts of the last snapshots (viewer-independent). */
export type SnapshotFacts = {
  /** User snooze (H2) is active now → the topic leaves the snapshot. */
  snoozed: boolean
  /** List at the last «Сводка» snapshot. */
  digestList: TopicList
  /** List at the last «Неделя» snapshot. */
  weekList: TopicList
  /** Section at the last «Неделя» snapshot. */
  weekSection: "expired" | "dormant" | null
  /** H5: end of the dormant topic's «Неделя» window (ISO), else null. */
  dormantWindowEnd: string | null
}

export type SnapshotContext = {
  /** Last «Сводка» snapshot moment (ISO). */
  digestAt: string
  /** Last «Неделя» snapshot moment (ISO). */
  weekAt: string
  facts: Record<string, SnapshotFacts>
}

/** The entry fields the freeze reads (TopicEntry and the light rows of the counts both fit). */
export type FreezableEntry = {
  topicId: string
  lastActivityAt?: string | Date | null
  attention: {
    list: TopicList
    limited?: boolean
    cycleStartedAt: string | null
    section?: "expired" | "dormant" | null
    score: number
    explanation?: string[]
  } | null
}

export type Frozen<T> = T & { snapshot: SnapshotMembership }

const LIST_LABEL_RU: Record<TopicList, string> = {
  now: "в «Сейчас»",
  digest: "в «Сводке»",
  week: "в «Неделе»",
  none: "вне списков",
}

function heldLine(tab: SnapshotTab, current: TopicList): string {
  return tab === "digest"
    ? `в утреннем снимке «Сводки»; сейчас тема ${LIST_LABEL_RU[current]} — до следующего снимка`
    : `в снимке «Недели»; сейчас тема ${LIST_LABEL_RU[current]} — до следующего обзора`
}

function held<T extends FreezableEntry>(e: T, tab: SnapshotTab, section: "expired" | "dormant" | null): T {
  const a = e.attention
  if (!a) return e
  const lines = (a.explanation ?? []).filter((l) => !l.startsWith("итог:"))
  return {
    ...e,
    attention: {
      ...a,
      ...(tab === "week" ? { section } : {}),
      explanation: [...lines, heldLine(tab, a.list), `итог: ${tab === "digest" ? "«Сводка»" : "«Неделя»"} (снимок)`],
    },
  }
}

const ms = (v: string | Date | null | undefined) => (v ? new Date(v).getTime() : 0)

/** Held entries (current list ≠ the tab): highest score, then newest activity. */
function sortHeld<T extends FreezableEntry>(rows: T[]): T[] {
  return rows.sort((a, b) => (b.attention?.score ?? 0) - (a.attention?.score ?? 0) || ms(b.lastActivityAt) - ms(a.lastActivityAt))
}

/**
 * «Сводка» and «Неделя» as one viewer sees them (06 §7.2). Input: the
 * viewer's current lists AFTER the P6 daily limit (`digest` holds the
 * overflow first), plus `others` = every other live topic placed now (in
 * «Неделя» or in no list) so a topic that left «Сводка» can be held.
 * Output order: the snapshot part (still in the list, in rank order; then
 * the held ones), then «since». Every entry carries `snapshot`.
 */
export function freezeLists<T extends FreezableEntry>(
  lists: { now: readonly T[]; digest: readonly T[]; week: readonly T[]; others: readonly T[] },
  ctx: SnapshotContext,
): { digest: Frozen<T>[]; week: Frozen<T>[] } {
  const digestAt = new Date(ctx.digestAt).getTime()
  const weekAt = new Date(ctx.weekAt).getTime()
  const inNow = new Set(lists.now.map((e) => e.topicId))
  const fact = (id: string) => ctx.facts[id]

  // «Сводка».
  const dSnap: Frozen<T>[] = []
  const dHeld: T[] = []
  const dSince: Frozen<T>[] = []
  const inDigest = new Set<string>()
  for (const e of lists.digest) {
    const f = fact(e.topicId)
    if (f?.snoozed) continue
    inDigest.add(e.topicId)
    const started = ms(e.attention?.cycleStartedAt ?? null)
    const wasThere =
      !!f &&
      (f.digestList === "digest" ||
        // P6 overflow of the daily limit: it was in «Сейчас» (stored) and limited on its cycle day.
        (!!e.attention?.limited && f.digestList === "now" && started > 0 && started <= digestAt))
    if (wasThere) dSnap.push({ ...e, snapshot: "snapshot" })
    else dSince.push({ ...e, snapshot: "since" })
  }
  for (const e of [...lists.week, ...lists.others]) {
    const f = fact(e.topicId)
    if (!f || f.snoozed || inNow.has(e.topicId) || inDigest.has(e.topicId)) continue
    if (f.digestList !== "digest") continue
    dHeld.push(e)
    inDigest.add(e.topicId)
  }
  const digest: Frozen<T>[] = [
    ...dSnap,
    ...sortHeld(dHeld).map((e) => ({ ...held(e, "digest", null), snapshot: "held" as const })),
    ...dSince,
  ]

  // «Неделя» (a topic shown in «Сейчас» or «Сводка» is not repeated here).
  const dormantShown = (f: SnapshotFacts) => !f.dormantWindowEnd || new Date(f.dormantWindowEnd).getTime() > weekAt
  const wSnap: Frozen<T>[] = []
  const wHeld: { e: T; section: "expired" | "dormant" | null }[] = []
  const wSince: Frozen<T>[] = []
  const inWeek = new Set<string>()
  for (const e of lists.week) {
    const f = fact(e.topicId)
    if (!f || f.snoozed || inNow.has(e.topicId) || inDigest.has(e.topicId)) continue
    if (f.weekList === "week" && dormantShown(f)) {
      wSnap.push({ ...e, snapshot: "snapshot" })
      inWeek.add(e.topicId)
    } else if (!f.dormantWindowEnd && e.attention?.section !== "dormant") {
      // Joined «Неделя» after the review; a dormant topic waits for its snapshot (H5).
      wSince.push({ ...e, snapshot: "since" })
      inWeek.add(e.topicId)
    }
  }
  for (const e of lists.others) {
    const f = fact(e.topicId)
    if (!f || f.snoozed || inNow.has(e.topicId) || inDigest.has(e.topicId) || inWeek.has(e.topicId)) continue
    if (f.weekList !== "week" || !dormantShown(f)) continue
    wHeld.push({ e, section: f.dormantWindowEnd ? "dormant" : f.weekSection })
  }
  const heldSorted = sortHeld(wHeld.map((h) => h.e))
  const sectionOf = new Map(wHeld.map((h) => [h.e.topicId, h.section]))
  const week: Frozen<T>[] = [
    ...wSnap,
    ...heldSorted.map((e) => ({ ...held(e, "week", sectionOf.get(e.topicId) ?? null), snapshot: "held" as const })),
    ...wSince,
  ]
  return { digest, week }
}

/**
 * The three lists as ONE viewer sees them: «Сейчас» after the P6 daily limit
 * (06 §7.2, phase 7), «Сводка» / «Неделя» frozen (`freezeLists`). Input =
 * the org's lists in rank order without the limit. Used by the dashboard
 * (tabs + counts) and by the emails (`userLists`).
 */
export function viewerLists<T extends RoutableEntry & FreezableEntry>(
  org: { now: readonly T[]; digest: readonly T[]; week: readonly T[]; others: readonly T[] },
  ctx: SnapshotContext,
  viewerId: string,
  memberIds: ReadonlySet<string>,
  limit: number,
  dayOf: (iso: string | null) => string,
): { now: T[]; digest: Frozen<T>[]; week: Frozen<T>[] } {
  const split = splitWithDailyLimit(org.now, org.digest, viewerId, memberIds, limit, dayOf)
  const frozen = freezeLists({ now: split.now, digest: split.digest, week: org.week, others: org.others }, ctx)
  return { now: split.now, ...frozen }
}

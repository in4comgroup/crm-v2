// Topic score, lead code, class, band, sub-state, closing and timers
// (spec topics/01 §7; attention spec 06 §4.1–4.3, §4.6). PURE.
//
// Not here (phase 4): boosts (06 §4.4), caps beyond the stored trend ceiling
// (§4.5), display profiles, lists, card expiry.

import { scoreToBand, type SignalBand } from "@/lib/signals/extraction-types"
import type { SignalClass } from "@/lib/signals/types"
import {
  TOPIC_TIMERS,
  type ClientRelation,
  type TopicStatus,
  type TopicSubState,
  type TopicTimers,
} from "@/lib/topics/types"
import { mergeReferences } from "@/lib/topics/references"
import type {
  CodeBook,
  CodeInfo,
  RelationLookup,
  TopicEventDraft,
  TopicInstance,
  TopicSnapshot,
} from "./model"

const DAY_MS = 86_400_000

// ── 06 §4.2 Step B — instance activity ────────────────────────────────────

/** Relevance window in days (06 §4.2); null = no window (watchdog / derived). */
export function relevanceWindowDays(info: CodeInfo | undefined): number | null {
  if (!info) return 30
  if (info.relevanceDays !== null && info.relevanceDays > 0) return info.relevanceDays
  switch (info.kind) {
    case "watchdog":
    case "derived":
      return null
    case "trend":
      return 90
    case "state":
      return 0
    default:
      return info.effort === "quick" ? 14 : info.effort === "complex" ? 45 : 30
  }
}

export type InstanceInactiveReason = "not_counted" | "closed" | "stale" | "dismissed_by_user"

export type InstanceActivity = {
  id: string
  active: boolean
  reason: InstanceInactiveReason | null
  /** Closing instance (B2). */
  closedBy: string | null
  /** Instance score used for the topic (inherited codes resolved). */
  score: number
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Activity of every instance of one topic (06 §4.2 B1–B4; B5 = phase 8).
 * B2: a closing instance on the SAME topic, at the same time or later, whose
 * code lists this code in `closes_codes` (spec §7.3).
 */
export function instanceActivity(
  instances: readonly TopicInstance[],
  book: CodeBook,
  now: Date,
  dismissed: ReadonlySet<string> = new Set(),
): InstanceActivity[] {
  const today = isoDay(now)
  const closers = instances.filter((i) => i.confidence !== "low" && (book.get(i.code)?.closesCodes.length ?? 0) > 0)
  const first = instances.map((i): InstanceActivity => {
    const info = book.get(i.code)
    const base = { id: i.id, closedBy: null as string | null, score: i.scoreContrib }
    if (!i.counted || i.scoreContrib <= 0) return { ...base, active: false, reason: "not_counted" }
    const closer = closers.find(
      (c) =>
        c.id !== i.id &&
        c.itemDate.getTime() >= i.itemDate.getTime() &&
        (book.get(c.code)?.closesCodes ?? []).includes(i.code),
    )
    if (closer) return { ...base, active: false, reason: "closed", closedBy: closer.id }
    const window = relevanceWindowDays(info)
    const ageDays = (now.getTime() - i.itemDate.getTime()) / DAY_MS
    const openDeadline = i.deadlines.some((d) => d >= today)
    if (window !== null && ageDays > window && !openDeadline) return { ...base, active: false, reason: "stale" }
    if (dismissed.has(i.id)) return { ...base, active: false, reason: "dismissed_by_user" }
    return { ...base, active: true, reason: null }
  })
  // 06 §4.1: an `inherited` code scores as the topic it attaches to.
  const ownMax = Math.max(
    0,
    ...first
      .filter((a, idx) => a.active && book.get(instances[idx].code)?.scoreRule !== "inherited")
      .map((a) => a.score),
  )
  return first.map((a, idx) =>
    a.active && book.get(instances[idx].code)?.scoreRule === "inherited" && ownMax > 0 ? { ...a, score: ownMax } : a,
  )
}

// ── 06 §4.3 Step C + §4.6 Step F ──────────────────────────────────────────

const CLASS_RANK: Record<string, number> = { risk: 3, chance: 2, fyi: 1 }

export type TopicScore = {
  score: number
  band: SignalBand
  leadCode: string | null
  leadInstanceId: string | null
  class: SignalClass | null
  activeCount: number
  /** Some instance was closed by a closing code on the topic (B2). */
  anyClosed: boolean
  lastClosingCode: string | null
  lastClosingAt: Date | null
}

/** Class of the lead code, by relation for `class_by_relation` codes (06 §4.6). */
export function classOf(info: CodeInfo | undefined, relation: ClientRelation): SignalClass | null {
  if (!info) return null
  if (info.classByRelation) {
    if (relation === "active") return "risk"
    if (relation === "prospect" || relation === "dormant") return "chance"
  }
  return info.class
}

export function computeTopicScore(
  instances: readonly TopicInstance[],
  book: CodeBook,
  now: Date,
  relation: ClientRelation,
  dismissed?: ReadonlySet<string>,
): TopicScore {
  const act = instanceActivity(instances, book, now, dismissed)
  let lead: { inst: TopicInstance; score: number } | null = null
  for (let k = 0; k < instances.length; k++) {
    if (!act[k].active) continue
    const cand = { inst: instances[k], score: act[k].score }
    if (!lead) {
      lead = cand
      continue
    }
    const ci = book.get(cand.inst.code)
    const li = book.get(lead.inst.code)
    const better =
      cand.score - lead.score ||
      (CLASS_RANK[ci?.class ?? ""] ?? 0) - (CLASS_RANK[li?.class ?? ""] ?? 0) ||
      cand.inst.itemDate.getTime() - lead.inst.itemDate.getTime() ||
      (li?.order ?? 0) - (ci?.order ?? 0)
    if (better > 0) lead = cand
  }
  const closedActs = act.filter((a) => a.reason === "closed")
  let lastClosing: TopicInstance | null = null
  for (const a of closedActs) {
    const c = instances.find((i) => i.id === a.closedBy)
    if (c && (!lastClosing || c.itemDate > lastClosing.itemDate)) lastClosing = c
  }
  const score = lead ? Math.max(0, lead.score) : 0
  return {
    score,
    band: scoreToBand(score),
    leadCode: lead?.inst.code ?? null,
    leadInstanceId: lead?.inst.id ?? null,
    class: lead ? classOf(book.get(lead.inst.code), relation) : null,
    activeCount: act.filter((a) => a.active).length,
    anyClosed: closedActs.length > 0,
    lastClosingCode: lastClosing?.code ?? null,
    lastClosingAt: lastClosing?.itemDate ?? null,
  }
}

// ── Sub-state (spec §7.1) ─────────────────────────────────────────────────

/**
 * waiting_on_them = the last (non-internal) item is ours; waiting_on_us = the
 * last counted inbound code asks us and no outbound item came after it;
 * none otherwise. Only meaningful for an open topic.
 */
export function computeSubState(topic: Pick<TopicSnapshot, "items" | "instances">, book: CodeBook): TopicSubState {
  const external = topic.items.filter((l) => l.direction !== "internal")
  if (external.length === 0) return "none"
  const last = external.reduce((a, b) => (b.date >= a.date ? b : a))
  if (last.direction === "outbound") return "waiting_on_them"
  const inboundItems = new Set(external.filter((l) => l.direction === "inbound").map((l) => l.itemId))
  const counted = topic.instances.filter(
    (i) => i.counted && i.scoreContrib > 0 && i.itemId !== null && inboundItems.has(i.itemId),
  )
  if (counted.length === 0) return "none"
  const lastCounted = counted.reduce((a, b) => (b.itemDate >= a.itemDate ? b : a))
  if (!book.get(lastCounted.code)?.asksUs) return "none"
  const outboundAfter = external.some((l) => l.direction === "outbound" && l.date > lastCounted.itemDate)
  return outboundAfter ? "none" : "waiting_on_us"
}

// ── Client relation (06 §4.6) ─────────────────────────────────────────────

/** Order rhythm floor (`cards.dormantRhythmFloorDays`, v204: 90 days). */
export const RHYTHM_FLOOR_DAYS = 90

/**
 * Relation of a client, derived (no stored field, 06 §4.6):
 *  - companies-tab tag `supplier` → supplier (not a client relation);
 *  - confirmed / finalized orders → rhythm (≥3 orders: average gap; 2: that
 *    gap; 1: 365 days; never under 90 days, ACCOUNT_DORMANT rule) — pause
 *    from the last order ≤ rhythm → active, else dormant;
 *  - no orders → companies tab: «Клиенты» (a won deal) → active; potential /
 *    partner / unclassified → prospect.
 */
export function deriveClientRelation(
  args: { orderDates: readonly Date[]; companyKind: string | null; hasWonDeal: boolean },
  now: Date,
): ClientRelation {
  if (args.companyKind === "supplier") return "supplier"
  const dates = [...args.orderDates].sort((a, b) => a.getTime() - b.getTime())
  if (dates.length > 0) {
    let rhythm: number
    if (dates.length >= 3) {
      rhythm = (dates[dates.length - 1].getTime() - dates[0].getTime()) / (dates.length - 1) / DAY_MS
    } else if (dates.length === 2) {
      rhythm = (dates[1].getTime() - dates[0].getTime()) / DAY_MS
    } else rhythm = 365
    rhythm = Math.max(rhythm, RHYTHM_FLOOR_DAYS)
    const pause = (now.getTime() - dates[dates.length - 1].getTime()) / DAY_MS
    return pause <= rhythm ? "active" : "dormant"
  }
  return args.hasWonDeal ? "active" : "prospect"
}

// ── Recompute one topic (after attach / detach / merge) ───────────────────

/**
 * Recompute derived fields of a topic in place: references / products from
 * its items, dates, score, lead, class, band, family, sub-state, and the
 * open → resolved transition of §7.3 (some instance closed by a closing code
 * on the topic AND no active instance left). Marks the topic dirty. Returns
 * the journal events of a status change.
 */
export function recomputeTopic(
  topic: TopicSnapshot,
  book: CodeBook,
  now: Date,
  relationOf: RelationLookup,
  opts: { sourceItemId?: string | null } = {},
): TopicEventDraft[] {
  const events: TopicEventDraft[] = []
  let refs = topic.items.length ? [] : topic.references
  const products = new Set<string>(topic.items.length ? [] : topic.products)
  for (const l of topic.items) {
    refs = mergeReferences(refs, l.references)
    for (const p of l.products) products.add(p)
  }
  topic.references = refs
  topic.products = [...products]
  if (topic.items.length) {
    topic.firstSeenAt = new Date(Math.min(...topic.items.map((l) => l.date.getTime())))
    topic.lastActivityAt = new Date(Math.max(...topic.items.map((l) => l.date.getTime())))
  }

  const s = computeTopicScore(topic.instances, book, now, relationOf(topic.clientId))
  topic.score = s.score
  topic.band = s.band
  topic.leadCode = s.leadCode
  topic.class = s.class
  if (s.leadCode) topic.family = book.get(s.leadCode)?.family ?? topic.family

  if ((topic.status === "open" || topic.status === "dormant") && s.anyClosed && s.activeCount === 0) {
    topic.status = "resolved"
    topic.closedAt = s.lastClosingAt ?? now
    topic.closedReason = `closed_by:${s.lastClosingCode ?? "unknown"}`
    events.push({
      topicId: topic.id,
      type: "resolved",
      sourceItemId: opts.sourceItemId ?? null,
      payload: { code: s.lastClosingCode },
    })
  }
  topic.subState = topic.status === "open" ? computeSubState(topic, book) : "none"
  topic.dirty = true
  return events
}

// ── Timers (spec §7.1) ────────────────────────────────────────────────────

/**
 * Deterministic status timers: open → dormant (21 d without activity) →
 * expired (60 d); resolved → archived when the reopen window (14 d from
 * closed_at) ends. Returns the new status or null (no change).
 */
export function timerTransition(
  topic: Pick<TopicSnapshot, "status" | "lastActivityAt" | "closedAt">,
  now: Date,
  timers: TopicTimers = TOPIC_TIMERS,
): TopicStatus | null {
  const idle = (now.getTime() - topic.lastActivityAt.getTime()) / DAY_MS
  if (topic.status === "open" || topic.status === "dormant") {
    if (idle > timers.expireDays) return "expired"
    if (topic.status === "open" && idle > timers.dormantDays) return "dormant"
    return null
  }
  if (topic.status === "resolved" && topic.closedAt) {
    const since = (now.getTime() - topic.closedAt.getTime()) / DAY_MS
    if (since > timers.reopenDays) return "archived"
  }
  return null
}

/** True when an item at `at` is inside the reopen window of a closed topic. */
export function inReopenWindow(
  topic: Pick<TopicSnapshot, "status" | "closedAt">,
  at: Date,
  timers: TopicTimers = TOPIC_TIMERS,
): boolean {
  if (topic.status !== "resolved" && topic.status !== "done") return false
  if (!topic.closedAt) return false
  return (at.getTime() - topic.closedAt.getTime()) / DAY_MS <= timers.reopenDays
}

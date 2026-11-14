// Attention engine (docs/specs/topics/06-attention-engine.md, plan phase 4).
// PURE and deterministic: no DB, no clock (the caller passes `now`), no LLM.
// Same inputs + same parameters → the same `TopicAttention`.
//
// Steps (06 §3, §12):
//   A–C  instance score / activity / topic base score + lead — reuse
//        lifecycle.ts (`instanceActivity`, `computeTopicScore`); the stored
//        instance score already holds the attribute modifier of the dominant
//        instance (phase 2); here only R19 removes the impatience attribute
//        from a repeated asks-us code;
//   D    boosts R / O / C (cap `boostMax`);
//   E–F  trend ceiling, band, class;
//   G    base profile (explicit display profile shifted by the band change);
//   H    snooze (H2), waiting on them (H3) / dampener (H4) — max one level,
//        dormant (H5) — shown once in «Неделя»;
//   I    escalations I1–I5 (up only), trend ceiling after;
//   J–L  list, card expiry (working days, production calendar), rank,
//        display cycle, next check, Russian explanation.
//
// I–L run again at list read (`placeStoredAttention`, 06 §6 read-time check)
// from the serialisable core stored in `attention.engine`.
// Not here (phase 7): evening reminders, P6 daily limit, delivery.

import { scoreToBand, type SignalBand } from "@/lib/signals/extraction-types"
import type { DisplayProfile as RegistryProfile, SignalClass } from "@/lib/signals/types"
import type {
  AttentionEscalation,
  DisplayProfile,
  TopicAttention,
  TopicList,
} from "@/lib/topics/attention-types"
import { TOPIC_LIST_LABELS_RU } from "@/lib/topics/attention-types"
import type { AttentionParams, EffortKey } from "@/lib/topics/attention-params"
import { addCalendarDays, type WorkCalendar } from "@/lib/topics/attention-calendar"
import { TOPIC_STATUS_LABELS_RU, type ClientRelation, type TopicStatus, type TopicSubState } from "@/lib/topics/types"
import { classOf, computeTopicScore, instanceActivity, relevanceWindowDays } from "../lifecycle"
import type { CodeBook, TopicInstance } from "../model"

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000
export const TREND_CEILING = 5
export const IMPATIENT_ATTRIBUTE = "ATTR_EMOTION_IMPATIENT"

// ── Inputs ────────────────────────────────────────────────────────────────

export type Level = "W1" | "D4" | "P6" | "P8"
const LEVELS: readonly Level[] = ["W1", "D4", "P6", "P8"]

export type DeadlineOwner = "us" | "them" | "unknown"

export type AttentionInstance = TopicInstance & {
  /** The instance is the dominant one of its item (phase 2 applied the attributes to it). */
  dominant?: boolean
  /** Message attributes of the instance's item and their clamped sum (06 §4.1). */
  itemAttrs?: { code: string; weight: number }[]
  itemAttrAdj?: number
}

export type AttentionItem = {
  itemId: string
  date: Date
  direction: "inbound" | "outbound" | "internal"
  /** `facts.deadlines[]` of the item for the topic's subject. "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM" (org time). */
  deadlines: { date: string; owner: DeadlineOwner }[]
  /** `facts.proposedMeetingDate` — a deadline only when the lead family is `meeting`. */
  meetingDate?: string | null
}

/** Active deal risk (phase 5a). Default: none. */
export type AttentionDealRisk = { triggerInstanceId: string; severity: number; active: boolean }

export type AttentionTopicInput = {
  id: string
  status: TopicStatus
  subState: TopicSubState
  lastActivityAt: Date
  snoozedUntil: Date | null
  snoozedAt: Date | null
  relation: ClientRelation
  cycleStartedAt: Date | null
  cycleReason: string | null
  instances: AttentionInstance[]
  items: AttentionItem[]
  /** Stored result of the previous computation (cycle triggers). */
  prev: TopicAttention | null
  dealRisks?: AttentionDealRisk[]
  /** Instance ids a user marked «Не относится» (B4). */
  dismissed?: ReadonlySet<string>
}

export type AttentionRelation = { kind: string; codeA: string; codeB: string }

export type AttentionEnv = {
  book: CodeBook
  /** Effective display profile per code (org override → pack → base). */
  profiles: ReadonlyMap<string, RegistryProfile | null>
  relations: readonly AttentionRelation[]
  params: AttentionParams
  calendar: WorkCalendar
  now: Date
  paramsHash?: string
}

// ── Serialisable core (stored in attention.engine.core) ───────────────────

export type AttentionDeadline = { at: string; owner: DeadlineOwner; addedAt: string; key: string }

export type AttentionCore = {
  /** Hidden before escalation (H2 snooze, H5 dormant after its week, no active signal). */
  hidden: "snoozed" | "dormant" | "no_active_signal" | null
  /** Profile after G + H (for a snoozed topic: the profile it would have). */
  profile: Level | null
  section: "dormant" | null
  score: number
  baseScore: number
  band: SignalBand
  cls: SignalClass | null
  leadCode: string | null
  leadInstanceId: string | null
  leadLabel: string | null
  leadWeight: number
  baseProfile: Level | null
  boosts: { code: "R" | "O" | "C"; points: number }[]
  boostCapped: boolean
  reminders: number
  leadEffort: EffortKey
  trend: boolean
  deadlines: AttentionDeadline[]
  riskImmediate: boolean
  riskTriggers: string[]
  snoozedUntil: string | null
  snoozedAt: string | null
  snoozeEndedEarly: boolean
  dormantWindowEnd: string | null
  adjustments: { rule: "H3" | "H4"; levels: number; until: string | null }[]
  dampenerUntil: string | null
  waitingSince: string | null
  lastActivityAt: string
  /** Moments when B3 makes an active instance stale (next check). */
  staleAt: string[]
  /** Boost O threshold moment when O does not apply yet. */
  overdueReactionAt: string | null
}

export type AttentionEngineState = {
  core: AttentionCore | null
  /** Counted instance ids seen (material change = a new one). */
  instanceIds: string[]
  deadlineKeys: string[]
  reminders: number
  dampenerUntil: string | null
  riskTriggers: string[]
  i3Deadline: string | null
  cycleBand: SignalBand | null
}

// ── Small helpers ─────────────────────────────────────────────────────────

const CLASS_RANK: Record<string, number> = { risk: 3, chance: 2, fyi: 1 }
const BAND_ORDER: readonly SignalBand[] = ["none", "low", "normal", "high", "very_high", "critical"]

export function bandProfile(band: SignalBand): Level | null {
  switch (band) {
    case "low":
      return "W1"
    case "normal":
      return "D4"
    case "high":
      return "P6"
    case "very_high":
    case "critical":
      return "P8"
    default:
      return null
  }
}

function levelIdx(l: Level): number {
  return LEVELS.indexOf(l)
}
function shiftLevel(l: Level, by: number): Level {
  return LEVELS[Math.max(0, Math.min(LEVELS.length - 1, levelIdx(l) + by))]
}
function atLeast(l: Level | null, min: Level): Level {
  return l === null || levelIdx(l) < levelIdx(min) ? min : l
}
function atMost(l: Level | null, max: Level): Level | null {
  return l !== null && levelIdx(l) > levelIdx(max) ? max : l
}
function isLevel(v: unknown): v is Level {
  return typeof v === "string" && (LEVELS as readonly string[]).includes(v)
}
function listOf(profile: Level | null): TopicList {
  if (profile === "P8" || profile === "P6") return "now"
  if (profile === "D4") return "digest"
  if (profile === "W1") return "week"
  return "none"
}
function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null
}
function familyOf(book: CodeBook, code: string): string | null {
  return book.get(code)?.family ?? null
}
function sameRequest(book: CodeBook, a: string, b: string): boolean {
  if (a === b) return true
  const fa = familyOf(book, a)
  return !!fa && fa === familyOf(book, b)
}

/** "YYYY-MM-DD" (end of working hours) or "YYYY-MM-DDTHH:MM" → moment in org time. */
export function deadlineMoment(s: string, cal: WorkCalendar, p: AttentionParams): Date {
  const day = s.slice(0, 10)
  const time = /T\d{2}:\d{2}/.test(s) ? s.slice(11, 16) : p.workEnd
  return cal.at(day, time)
}

function fmt(d: Date | string | null, cal: WorkCalendar, withTime = true): string {
  if (!d) return ""
  const x = typeof d === "string" ? new Date(d) : d
  const [, m, day] = cal.localDay(x).split("-")
  if (!withTime) return `${day}.${m}`
  const min = cal.localMinutes(x)
  return `${day}.${m} ${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`
}

// ── A–H: core ─────────────────────────────────────────────────────────────

/** R19: a repeat of an active asks-us request does not carry the impatience attribute. */
function applyR19(
  x: AttentionInstance,
  all: readonly AttentionInstance[],
  activeIds: ReadonlySet<string>,
  book: CodeBook,
): AttentionInstance {
  if (!x.dominant || !x.itemAttrs?.some((a) => a.code === IMPATIENT_ATTRIBUTE)) return x
  const repeats = all.some(
    (e) =>
      e.id !== x.id &&
      e.itemId !== x.itemId &&
      activeIds.has(e.id) &&
      e.itemDate.getTime() < x.itemDate.getTime() &&
      !!book.get(e.code)?.asksUs &&
      sameRequest(book, e.code, x.code),
  )
  if (!repeats) return x
  const rest = x.itemAttrs.filter((a) => a.code !== IMPATIENT_ATTRIBUTE).reduce((s, a) => s + a.weight, 0)
  const newAdj = Math.max(-2, Math.min(2, rest))
  const score = Math.max(0, x.scoreContrib - (x.itemAttrAdj ?? 0) + newAdj)
  return { ...x, scoreContrib: score }
}

/** Steps A–H (06 §4–§5). Null for a topic whose status takes it out of every list (H1). */
export function computeAttentionCore(input: AttentionTopicInput, env: AttentionEnv): AttentionCore | null {
  const { book, now, params: p, calendar: cal } = env
  if (input.status !== "open" && input.status !== "dormant") return null
  const dismissed = input.dismissed ?? new Set<string>()

  // A + B (R19 needs the activity before the adjustment).
  const raw = instanceActivity(input.instances, book, now, dismissed)
  const rawActive = new Set(input.instances.filter((_, k) => raw[k].active).map((i) => i.id))
  const adjusted = input.instances.map((i) => applyR19(i, input.instances, rawActive, book))
  const act = instanceActivity(adjusted, book, now, dismissed)
  const scoreOf = new Map(adjusted.map((i, k) => [i.id, act[k].score]))
  const active = adjusted.filter((_, k) => act[k].active)
  const activeIds = new Set(active.map((i) => i.id))

  // C + F (lead, base score, class) — lifecycle.ts.
  const ts = computeTopicScore(adjusted, book, now, input.relation, dismissed)
  const lead = ts.leadInstanceId ? adjusted.find((i) => i.id === ts.leadInstanceId) ?? null : null
  const leadInfo = lead ? book.get(lead.code) : undefined
  const effort: EffortKey = leadInfo?.effort ?? "medium"
  const trend = leadInfo?.kind === "trend"

  // Waiting on us: the period after our last outbound item.
  const itemDir = new Map(input.items.map((i) => [i.itemId, i.direction]))
  const lastOut = Math.max(
    -Infinity,
    ...input.items.filter((i) => i.direction === "outbound").map((i) => i.date.getTime()),
  )
  const periodAsks = active
    .filter(
      (i) =>
        !!book.get(i.code)?.asksUs &&
        i.itemId !== null &&
        itemDir.get(i.itemId) === "inbound" &&
        i.itemDate.getTime() > lastOut,
    )
    .sort((a, b) => a.itemDate.getTime() - b.itemDate.getTime())
  const waitingOnUs = input.subState === "waiting_on_us"
  const waitingSince = waitingOnUs && periodAsks.length ? periodAsks[0].itemDate : null

  // Reminders (boost R): later inbound items repeating an asks-us request, no outbound between.
  let reminders = 0
  if (waitingOnUs && periodAsks.length) {
    const items = new Set<string>()
    for (const i of adjusted) {
      if (!i.counted || i.confidence === "low" || !i.itemId) continue
      if (itemDir.get(i.itemId) !== "inbound" || i.itemDate.getTime() <= lastOut) continue
      const repeats = periodAsks.some(
        (a) => a.itemId !== i.itemId && a.itemDate.getTime() < i.itemDate.getTime() && sameRequest(book, a.code, i.code),
      )
      if (repeats) items.add(i.itemId)
    }
    reminders = items.size
  }

  // Deadlines (owner us / unknown) of the items that hold an active instance,
  // plus items without counted codes (e.g. our holding reply) since the first active instance.
  const deadlines: AttentionDeadline[] = []
  if (active.length) {
    const activeItems = new Set(active.map((i) => i.itemId).filter((x): x is string => !!x))
    const countedItems = new Set(adjusted.filter((i) => i.counted).map((i) => i.itemId))
    const firstActive = Math.min(...active.map((i) => i.itemDate.getTime()))
    const leadFamily = lead ? familyOf(book, lead.code) : null
    const seen = new Set<string>()
    for (const it of input.items) {
      const use = activeItems.has(it.itemId) || (!countedItems.has(it.itemId) && it.date.getTime() >= firstActive)
      if (!use) continue
      const list = [...it.deadlines]
      if (leadFamily === "meeting" && it.meetingDate) list.push({ date: it.meetingDate, owner: "unknown" })
      for (const d of list) {
        if (d.owner === "them" || !/^\d{4}-\d{2}-\d{2}/.test(d.date)) continue
        const key = `${d.date}|${d.owner}`
        if (seen.has(key)) continue
        seen.add(key)
        deadlines.push({ at: deadlineMoment(d.date, cal, p).toISOString(), owner: d.owner, addedAt: it.date.toISOString(), key })
      }
    }
    deadlines.sort((a, b) => a.at.localeCompare(b.at) || a.key.localeCompare(b.key))
  }

  // Deal risks (I5, phase 5a input).
  const instIds = new Set(adjusted.map((i) => i.id))
  const risks = (input.dealRisks ?? []).filter((r) => r.active && instIds.has(r.triggerInstanceId))
  const riskTriggers = [...new Set(risks.map((r) => r.triggerInstanceId))].sort()
  const riskImmediate = risks.some((r) => r.severity >= p.riskImmediateMinSeverity)

  // Stale moments of active instances (B3) for the next check.
  const staleAt: string[] = []
  for (const i of active) {
    const w = relevanceWindowDays(book.get(i.code))
    if (w === null) continue
    let t = i.itemDate.getTime() + w * DAY_MS
    const lastDl = [...i.deadlines].sort().pop()
    if (lastDl) {
      const [y, m, d] = lastDl.slice(0, 10).split("-").map(Number)
      t = Math.max(t, Date.UTC(y, m - 1, d) + DAY_MS)
    }
    staleAt.push(new Date(t + 1000).toISOString())
  }

  const snoozeActive = !!input.snoozedUntil && input.snoozedUntil.getTime() > now.getTime()
  const materialAfterSnooze =
    snoozeActive &&
    !!input.snoozedAt &&
    adjusted.some(
      (i) => activeIds.has(i.id) && i.counted && i.confidence !== "low" && i.itemDate.getTime() > input.snoozedAt!.getTime(),
    )

  const base: AttentionCore = {
    hidden: null,
    profile: null,
    section: null,
    score: 0,
    baseScore: ts.score,
    band: "none",
    cls: ts.class,
    leadCode: ts.leadCode,
    leadInstanceId: ts.leadInstanceId,
    leadLabel: leadInfo?.labelRu ?? null,
    leadWeight: leadInfo?.weight ?? 0,
    baseProfile: null,
    boosts: [],
    boostCapped: false,
    reminders,
    leadEffort: effort,
    trend,
    deadlines,
    riskImmediate,
    riskTriggers,
    snoozedUntil: snoozeActive && !materialAfterSnooze ? iso(input.snoozedUntil) : null,
    snoozedAt: iso(input.snoozedAt),
    snoozeEndedEarly: materialAfterSnooze,
    dormantWindowEnd: null,
    adjustments: [],
    dampenerUntil: null,
    waitingSince: iso(waitingSince),
    lastActivityAt: input.lastActivityAt.toISOString(),
    staleAt,
    overdueReactionAt: null,
  }

  // H5 dormant: once in the next «Неделя» snapshot, then hidden; I-rules still apply.
  // Snapshot points follow the weekly review day (holiday Friday → the last
  // working day before it); the window ends at the snapshot after the first.
  if (input.status === "dormant") {
    const dormantAt = new Date(input.lastActivityAt.getTime() + p.dormantDays * DAY_MS)
    const firstSnapshot = cal.nextWeeklyReviewAt(new Date(dormantAt.getTime() - 1), p.weeklyReviewWeekday, p.weeklyReviewTime)
    const windowEnd = cal.nextWeeklyReviewAt(firstSnapshot, p.weeklyReviewWeekday, p.weeklyReviewTime)
    const score = lead ? ts.score : 0
    const inWindow = now.getTime() < windowEnd.getTime()
    return {
      ...base,
      score,
      band: scoreToBand(score),
      hidden: inWindow ? null : "dormant",
      profile: inWindow ? "W1" : null,
      section: inWindow ? "dormant" : null,
      dormantWindowEnd: windowEnd.toISOString(),
    }
  }

  if (!lead || !leadInfo) return { ...base, hidden: "no_active_signal" }

  // D — boosts.
  const workdayHours = (cal.workEndMin - cal.workStartMin) / 60
  const reactionHours = p.reactionWorkingDays[effort] * workdayHours
  const R = p.boostReminder && waitingOnUs ? Math.min(2, reminders) : 0
  let O = 0
  let overdueReactionAt: string | null = null
  if (p.boostOverdueReaction && waitingSince) {
    if (cal.workingHoursBetween(waitingSince, now) > reactionHours) O = 1
    else overdueReactionAt = new Date(cal.addWorkingHours(waitingSince, reactionHours).getTime() + 60_000).toISOString()
  }
  let C = 0
  if (p.boostCorroboration) {
    const canon = (code: string) => env.relations.find((r) => r.kind === "merges_into" && r.codeA === code)?.codeB ?? code
    const risky = active.filter(
      (i) => i.itemId && (scoreOf.get(i.id) ?? 0) >= 6 && classOf(book.get(i.code), input.relation) === "risk",
    )
    outer: for (let a = 0; a < risky.length; a++) {
      for (let b = a + 1; b < risky.length; b++) {
        if (risky[a].itemId !== risky[b].itemId && canon(risky[a].code) !== canon(risky[b].code)) {
          C = 1
          break outer
        }
      }
    }
  }
  const boosts: AttentionCore["boosts"] = []
  if (R) boosts.push({ code: "R", points: R })
  if (O) boosts.push({ code: "O", points: O })
  if (C) boosts.push({ code: "C", points: C })
  const sum = R + O + C

  // E — caps.
  let score = ts.score + (trend ? 0 : Math.min(p.boostMax, sum))
  if (trend) score = Math.min(score, TREND_CEILING)
  score = Math.max(0, score)
  const band = scoreToBand(score)

  // G — base profile. The shift is counted in profile levels (band → profile),
  // so very_high and critical (both P8) do not move an explicit profile.
  const explicit = env.profiles.get(lead.code)
  const bandLevel = bandProfile(band) ?? "W1"
  let baseProfile: Level
  if (isLevel(explicit)) {
    const weightLevel = bandProfile(scoreToBand(leadInfo.weight)) ?? "W1"
    baseProfile = shiftLevel(explicit, levelIdx(bandLevel) - levelIdx(weightLevel))
  } else baseProfile = bandLevel

  // H3 / H4 — at most one level in total.
  let profile: Level = baseProfile
  const adjustments: AttentionCore["adjustments"] = []
  const waitingThem = p.waitingOnThemLowersLevel && input.subState === "waiting_on_them"
  let dampenerUntil: Date | null = null
  const dampCodes = new Set(env.relations.filter((r) => r.kind === "dampens" && r.codeB === lead.code).map((r) => r.codeA))
  if (dampCodes.size) {
    for (const i of adjusted) {
      if (!dampCodes.has(i.code) || i.confidence === "low" || i.itemDate.getTime() < lead.itemDate.getTime()) continue
      const promise = [...i.deadlines].sort().pop()
      if (!promise) continue
      const until = cal.at(cal.addWorkingDays(promise.slice(0, 10), 1), p.workStart)
      if (!dampenerUntil || until.getTime() > dampenerUntil.getTime()) dampenerUntil = until
    }
  }
  const dampActive = !!dampenerUntil && now.getTime() < dampenerUntil.getTime()
  if (waitingThem || dampActive) profile = shiftLevel(profile, -1)
  if (waitingThem) adjustments.push({ rule: "H3", levels: 1, until: null })
  if (dampActive) adjustments.push({ rule: "H4", levels: waitingThem ? 0 : 1, until: iso(dampenerUntil) })

  return {
    ...base,
    hidden: snoozeActive && !materialAfterSnooze ? "snoozed" : null,
    profile,
    score,
    band,
    baseProfile,
    boosts,
    boostCapped: !trend && sum > p.boostMax,
    adjustments,
    dampenerUntil: dampActive ? iso(dampenerUntil) : null,
    overdueReactionAt,
  }
}

// ── I: escalation (also at read time) ─────────────────────────────────────

export type Escalated = {
  profile: Level | null
  hidden: string | null
  escalations: AttentionEscalation[]
  /** Next deadline (owner us / unknown) after now. */
  next: AttentionDeadline | null
  /** Latest passed owner-us deadline (I4). */
  overdueDl: AttentionDeadline | null
  snoozeOver: boolean
}

function nextListPoint(profile: Level, now: Date, cal: WorkCalendar, p: AttentionParams): Date | null {
  if (profile === "D4") return cal.nextWorkingDayAt(now, p.morningDigestTime)
  if (profile === "W1") return cal.nextWeeklyReviewAt(now, p.weeklyReviewWeekday, p.weeklyReviewTime)
  return null
}

export function escalate(core: AttentionCore, now: Date, cal: WorkCalendar, p: AttentionParams): Escalated {
  const t = now.getTime()
  const next = core.deadlines.find((d) => new Date(d.at).getTime() > t) ?? null
  const passedUs = core.deadlines.filter((d) => d.owner === "us" && new Date(d.at).getTime() <= t)
  const overdueDl = core.leadCode ? (passedUs[passedUs.length - 1] ?? null) : null
  const esc: AttentionEscalation[] = []
  let profile = core.profile
  let hidden: string | null = core.hidden
  let snoozeOver = false
  const hoursTo = next ? (new Date(next.at).getTime() - t) / HOUR_MS : Infinity
  const immediate = !!next && hoursTo <= p.deadlineImmediateHours

  if (hidden === "no_active_signal") return { profile: null, hidden, escalations: [], next: null, overdueDl: null, snoozeOver }
  if (hidden === "snoozed") {
    if (core.snoozedUntil && new Date(core.snoozedUntil).getTime() <= t) {
      hidden = null
      snoozeOver = true
    } else if (immediate && core.snoozedAt && new Date(next!.addedAt).getTime() > new Date(core.snoozedAt).getTime()) {
      // I1 ends the snooze only for a deadline added after the snooze.
      hidden = null
    } else return { profile: null, hidden, escalations: [], next, overdueDl, snoozeOver }
  }

  if (immediate) {
    profile = "P8"
    esc.push("I1")
  } else if (next && profile && (profile === "W1" || profile === "D4")) {
    const point = nextListPoint(profile, now, cal, p)
    if (point && new Date(next.at).getTime() < point.getTime() + p.digestActionBufferHours * HOUR_MS) {
      profile = shiftLevel(profile, 1)
      esc.push("I2")
    }
  }
  if (!esc.length && next) {
    const wd = cal.workingDaysBetween(cal.localDay(now), cal.localDay(new Date(next.at)))
    if (wd <= p.deadlineLeadDays[core.leadEffort]) {
      profile = atLeast(profile, "D4")
      esc.push("I3")
    }
  }
  if (overdueDl) {
    profile = atLeast(profile, "D4")
    esc.push("I4")
  }
  if (core.riskImmediate && core.leadCode) {
    profile = "P8"
    esc.push("I5")
  }
  if (core.trend) profile = atMost(profile, "D4")
  if (hidden === "dormant" && profile !== null) hidden = null
  return { profile, hidden, escalations: esc, next, overdueDl, snoozeOver }
}

// ── J–L: placement, expiry, rank ──────────────────────────────────────────

export type Placement = {
  list: TopicList
  section: "expired" | "dormant" | null
  hiddenReason: string | null
  cardExpiresAt: Date | null
  rank: number
  rankKey: string
}

export function cardExpiryMoment(
  core: AttentionCore,
  esc: Escalated,
  cycle: { startedAt: Date | null; band: SignalBand | null },
  cal: WorkCalendar,
  p: AttentionParams,
): Date | null {
  if (!cycle.startedAt) return null
  const dl = esc.next ?? esc.overdueDl
  const base = dl ? new Date(dl.at) : cycle.startedAt
  const prof = bandProfile(cycle.band ?? core.band) ?? "W1"
  const day = cal.addWorkingDays(cal.localDay(base), p.expiryDays[prof])
  let exp = cal.at(day, cal.localMinutes(base))
  if (prof === "W1") {
    const firstWeekly = cal.nextWeeklyReviewAt(cycle.startedAt, p.weeklyReviewWeekday, p.weeklyReviewTime)
    if (firstWeekly.getTime() > exp.getTime()) exp = firstWeekly
  }
  return exp
}

const MAX_MIN = 99_999_999

function minutes(d: Date | string | null): number {
  if (!d) return MAX_MIN
  return Math.min(MAX_MIN, Math.floor(new Date(d).getTime() / 60_000))
}
function pad(n: number): string {
  return String(Math.max(0, Math.round(n))).padStart(10, "0")
}

export function place(
  core: AttentionCore,
  esc: Escalated,
  cycle: { startedAt: Date | null; band: SignalBand | null },
  now: Date,
  cal: WorkCalendar,
  p: AttentionParams,
): Placement {
  let list = esc.hidden ? "none" : listOf(esc.profile)
  let hiddenReason = esc.hidden
  let section: Placement["section"] = list === "week" && core.section === "dormant" && !esc.escalations.length ? "dormant" : null
  let cardExpiresAt: Date | null = null
  if (list !== "none" && section !== "dormant") {
    cardExpiresAt = cardExpiryMoment(core, esc, cycle, cal, p)
    if (cardExpiresAt && now.getTime() >= cardExpiresAt.getTime() && !esc.escalations.includes("I5")) {
      if (now.getTime() < cardExpiresAt.getTime() + p.weeklyGraceDays * DAY_MS) {
        list = "week"
        section = "expired"
      } else {
        list = "none"
        hiddenReason = "card_expired"
        section = null
      }
    }
  }

  const score = 100 - core.score
  const cls = 3 - (CLASS_RANK[core.cls ?? ""] ?? 0)
  const lastAct = MAX_MIN - minutes(core.lastActivityAt)
  let rank = 0
  let parts: number[] = []
  if (list === "now") {
    const tier = esc.escalations.includes("I1") || esc.overdueDl ? 0 : 1
    const wait = minutes(core.waitingSince)
    parts = [tier, score, cls, wait, lastAct]
    rank = tier * 1e12 + score * 1e10 + cls * 1e9 + wait
  } else if (list === "digest") {
    const lead = esc.escalations.some((e) => e === "I1" || e === "I2" || e === "I3")
    const dl = lead && esc.next ? minutes(esc.next.at) : MAX_MIN
    const morning = cal.lastWorkingDayAt(now, p.morningDigestTime)
    const fresh = cycle.startedAt && cycle.startedAt.getTime() > morning.getTime() ? 0 : 1
    parts = [dl, score, cls, fresh, lastAct]
    rank = dl * 1e6 + score * 1e3 + cls * 1e2 + fresh * 10
  } else if (list === "week") {
    const sec = section === "expired" ? 1 : section === "dormant" ? 2 : 0
    parts = [sec, score, cls, lastAct]
    rank = sec * 1e6 + score * 1e3 + cls * 10
  }
  return { list, section, hiddenReason, cardExpiresAt, rank, rankKey: parts.map(pad).join("|") }
}

// ── Explanation (06 §11) ──────────────────────────────────────────────────

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

function explain(
  core: AttentionCore,
  esc: Escalated,
  pl: Placement,
  cal: WorkCalendar,
  p: AttentionParams,
  now: Date,
): string[] {
  const out: string[] = []
  if (core.leadCode) {
    const delta = core.baseScore - core.leadWeight
    out.push(
      `${core.leadLabel ?? core.leadCode} (вес ${core.leadWeight}${delta ? `, тон сообщения ${delta > 0 ? "+" : ""}${delta}` : ""})`,
    )
  }
  for (const b of core.boosts) {
    if (b.code === "R") out.push(`клиент напомнил${b.points > 1 ? ` ${b.points} раза` : ""} (+${b.points})`)
    if (b.code === "O" && core.waitingSince) {
      const d = p.reactionWorkingDays[core.leadEffort]
      out.push(`ждёт нашего ответа больше ${d} ${plural(d, "рабочего дня", "рабочих дней", "рабочих дней")} (+1)`)
    }
    if (b.code === "C") out.push("несколько сигналов риска из разных сообщений (+1)")
  }
  if (core.boostCapped) out.push(`надбавки не больше +${p.boostMax}`)
  if (core.trend) out.push(`тренд: оценка не выше ${TREND_CEILING}, не выше «Сводки»`)
  for (const a of core.adjustments) {
    if (a.rule === "H3") out.push("ждём ответа клиента: на уровень ниже")
    if (a.rule === "H4" && a.levels > 0) out.push(`клиент обещал до ${fmt(a.until, cal, false)}: на уровень ниже`)
  }
  if (core.hidden === "no_active_signal") out.push("нет активных сигналов")
  if (core.section === "dormant" || core.hidden === "dormant") out.push(`тема затихла: нет активности ${p.dormantDays} дн.`)
  if (esc.hidden === "snoozed" && core.snoozedUntil) out.push(`отложено до ${fmt(core.snoozedUntil, cal)}`)
  if (esc.snoozeOver) out.push("срок «Отложить» прошёл")
  for (const e of esc.escalations) {
    if (e === "I1" && esc.next) out.push(`срок < ${p.deadlineImmediateHours} ч (${fmt(esc.next.at, cal)})`)
    if (e === "I2" && esc.next) out.push(`срок ${fmt(esc.next.at, cal)} раньше следующего показа списка: на уровень выше`)
    if (e === "I3" && esc.next) {
      const n = cal.workingDaysBetween(cal.localDay(now), cal.localDay(new Date(esc.next.at)))
      out.push(`до срока ${n} ${plural(n, "рабочий день", "рабочих дня", "рабочих дней")} (${fmt(esc.next.at, cal)})`)
    }
    if (e === "I4" && esc.overdueDl) out.push(`просрочено (срок ${fmt(esc.overdueDl.at, cal)})`)
    if (e === "I5") out.push("серьёзный риск по сделке")
  }
  if (pl.section === "expired" && pl.cardExpiresAt) out.push(`карточка истекла ${fmt(pl.cardExpiresAt, cal)}`)
  if (pl.hiddenReason === "card_expired") out.push("карточка истекла: тема только во «Все темы»")
  out.push(`итог: «${TOPIC_LIST_LABELS_RU[pl.list]}»${esc.profile && pl.list !== "none" ? ` (${esc.profile})` : ""}`)
  return out
}

// ── Next check (06 §10) ───────────────────────────────────────────────────

function nextCheck(
  core: AttentionCore,
  pl: Placement,
  now: Date,
  cal: WorkCalendar,
  p: AttentionParams,
): Date | null {
  const t = now.getTime()
  const c: number[] = []
  const add = (d: Date | string | null | undefined) => {
    if (!d) return
    const x = new Date(d).getTime()
    if (Number.isFinite(x) && x > t) c.push(x)
  }
  const today = cal.localDay(now)
  for (const d of core.deadlines) {
    const at = new Date(d.at)
    add(new Date(at.getTime() - p.deadlineImmediateHours * HOUR_MS))
    add(new Date(at.getTime() - p.digestActionBufferHours * HOUR_MS))
    add(at)
    // I3 threshold: the first local day from which the deadline is ≤ lead days away.
    const dlDay = cal.localDay(at)
    for (let day = today, g = 0; day <= dlDay && g < 400; day = addCalendarDays(day, 1), g++) {
      if (cal.workingDaysBetween(day, dlDay) <= p.deadlineLeadDays[core.leadEffort]) {
        add(cal.at(day, 0))
        break
      }
    }
  }
  add(cal.nextWorkingDayAt(now, p.morningDigestTime))
  add(cal.nextWeeklyReviewAt(now, p.weeklyReviewWeekday, p.weeklyReviewTime))
  add(core.overdueReactionAt)
  add(core.snoozedUntil)
  add(core.dampenerUntil)
  for (const s of core.staleAt) add(s)
  const last = new Date(core.lastActivityAt).getTime()
  add(new Date(last + p.dormantDays * DAY_MS + 60_000))
  add(new Date(last + p.expireDays * DAY_MS + 60_000))
  add(core.dormantWindowEnd)
  if (pl.cardExpiresAt) {
    add(pl.cardExpiresAt)
    add(new Date(pl.cardExpiresAt.getTime() + p.weeklyGraceDays * DAY_MS))
  }
  return c.length ? new Date(Math.min(...c)) : null
}

// ── Engine state ──────────────────────────────────────────────────────────

export function readEngineState(a: TopicAttention | null | undefined): AttentionEngineState | null {
  const e = a?.engine as Partial<AttentionEngineState> | undefined
  if (!e || typeof e !== "object") return null
  return {
    core: (e.core as AttentionCore | null) ?? null,
    instanceIds: Array.isArray(e.instanceIds) ? e.instanceIds : [],
    deadlineKeys: Array.isArray(e.deadlineKeys) ? e.deadlineKeys : [],
    reminders: typeof e.reminders === "number" ? e.reminders : 0,
    dampenerUntil: e.dampenerUntil ?? null,
    riskTriggers: Array.isArray(e.riskTriggers) ? e.riskTriggers : [],
    i3Deadline: e.i3Deadline ?? null,
    cycleBand: (e.cycleBand as SignalBand | null) ?? null,
  }
}

const HIDDEN_RETURN_REASON: Record<string, string> = {
  status: "reopen",
  snoozed: "snooze_end",
  no_active_signal: "new_signal",
  dormant: "reopen",
}

// ── Full computation ──────────────────────────────────────────────────────

/** 06 §12 `computeAttention`: the full result for one topic at `env.now`. */
export function computeAttention(input: AttentionTopicInput, env: AttentionEnv): TopicAttention {
  const { now, params: p, calendar: cal } = env
  const prev = input.prev
  const prevState = readEngineState(prev)
  const core = computeAttentionCore(input, env)
  const countedIds = input.instances
    .filter((i) => i.counted && i.confidence !== "low")
    .map((i) => i.id)
    .sort()
    .slice(-200)
  const prevCycleStart = input.cycleStartedAt ?? (prev?.cycleStartedAt ? new Date(prev.cycleStartedAt) : null)
  const prevCycleReason = input.cycleReason ?? prev?.cycleReason ?? null

  // H1 — status out of every list.
  if (!core) {
    const state: AttentionEngineState = {
      core: null,
      instanceIds: countedIds,
      deadlineKeys: prevState?.deadlineKeys ?? [],
      reminders: 0,
      dampenerUntil: null,
      riskTriggers: prevState?.riskTriggers ?? [],
      i3Deadline: prevState?.i3Deadline ?? null,
      cycleBand: prevState?.cycleBand ?? null,
    }
    return {
      v: 1,
      computedAt: now.toISOString(),
      hiddenReason: "status",
      score: 0,
      band: "none",
      class: null,
      leadCode: null,
      boosts: [],
      baseProfile: null,
      profile: null,
      list: "none",
      escalations: [],
      deadline: null,
      overdue: false,
      rank: 0,
      cycleStartedAt: iso(prevCycleStart),
      cycleReason: prevCycleReason,
      cycleStarted: false,
      cardExpiresAt: null,
      nextCheckAt: null,
      explanation: [`тема «${TOPIC_STATUS_LABELS_RU[input.status]}»: вне списков`, `итог: «${TOPIC_LIST_LABELS_RU.none}»`],
      section: null,
      rankKey: "",
      baseScore: 0,
      leadInstanceId: null,
      adjustments: [],
      waitingSince: null,
      snoozedUntil: null,
      paramsHash: env.paramsHash,
      engine: state as unknown as Record<string, unknown>,
    }
  }

  const esc = escalate(core, now, cal, p)
  const placedNow = esc.profile !== null && !esc.hidden

  // L — display cycle (06 §7.1): a new cycle on a material change.
  const reasons: string[] = []
  if (placedNow) {
    if (!prev || !prevState) reasons.push("created")
    else {
      if (prev.list === "none" && prev.hiddenReason && HIDDEN_RETURN_REASON[prev.hiddenReason]) {
        reasons.push(HIDDEN_RETURN_REASON[prev.hiddenReason])
      }
      const known = new Set(prevState.instanceIds)
      const fresh = countedIds.filter((id) => !known.has(id))
      if (core.reminders > prevState.reminders) reasons.push("reminder")
      // A new instance that is the new lead (another code) or raises the band.
      if (core.leadInstanceId && fresh.includes(core.leadInstanceId) && core.leadCode !== prev.leadCode) reasons.push("new_lead")
      else if (fresh.length && BAND_ORDER.indexOf(core.band) > BAND_ORDER.indexOf(prev.band)) reasons.push("band_up")
      if (core.deadlines.some((d) => !prevState.deadlineKeys.includes(d.key))) reasons.push("deadline")
      if (prevState.dampenerUntil && !core.dampenerUntil && now.getTime() >= new Date(prevState.dampenerUntil).getTime()) {
        reasons.push("dampener_end")
      }
      if (core.snoozeEndedEarly || esc.snoozeOver) reasons.push("snooze_end")
      if (core.riskTriggers.some((r) => !prevState.riskTriggers.includes(r))) reasons.push("deal_risk")
      if (esc.escalations.includes("I3") && esc.next && prevState.i3Deadline !== esc.next.key) reasons.push("deadline_lead")
    }
    if (!reasons.length && !prevCycleStart) reasons.push("created")
  }
  const unique = [...new Set(reasons)]
  const cycleStarted = unique.length > 0
  const cycle = cycleStarted
    ? { startedAt: now, band: core.band, reason: unique[0] }
    : { startedAt: prevCycleStart, band: prevState?.cycleBand ?? core.band, reason: prevCycleReason }

  const pl = place(core, esc, cycle, now, cal, p)
  const deadlineIso = esc.next?.at ?? esc.overdueDl?.at ?? null

  const state: AttentionEngineState = {
    core,
    instanceIds: countedIds,
    deadlineKeys: core.deadlines.map((d) => d.key),
    reminders: core.reminders,
    dampenerUntil: core.dampenerUntil,
    riskTriggers: core.riskTriggers,
    i3Deadline: esc.escalations.includes("I3") && esc.next ? esc.next.key : (prevState?.i3Deadline ?? null),
    cycleBand: cycle.band,
  }

  return {
    v: 1,
    computedAt: now.toISOString(),
    hiddenReason: pl.hiddenReason,
    score: core.score,
    band: core.band,
    class: core.cls,
    leadCode: core.leadCode,
    boosts: core.boosts,
    baseProfile: core.baseProfile,
    profile: pl.list === "none" ? null : (esc.profile as DisplayProfile | null),
    list: pl.list,
    escalations: esc.escalations,
    deadline: deadlineIso,
    overdue: !!esc.overdueDl,
    rank: pl.rank,
    cycleStartedAt: iso(cycle.startedAt),
    cycleReason: cycle.reason,
    cycleStarted,
    cardExpiresAt: iso(pl.cardExpiresAt),
    nextCheckAt: iso(nextCheck(core, pl, now, cal, p)),
    explanation: explain(core, esc, pl, cal, p, now),
    section: pl.section,
    rankKey: pl.rankKey,
    baseScore: core.baseScore,
    leadInstanceId: core.leadInstanceId,
    adjustments: core.adjustments,
    waitingSince: core.waitingSince,
    snoozedUntil: esc.hidden === "snoozed" ? core.snoozedUntil : null,
    paramsHash: env.paramsHash,
    engine: state as unknown as Record<string, unknown>,
  }
}

/**
 * Read-time check (06 §6, §10): steps I–L again from the stored core, at
 * `now`, without writing. A stored attention without a core (status hidden,
 * old rows) comes back unchanged. The cycle is not restarted here — the next
 * hourly run does that.
 */
export function placeStoredAttention(
  stored: TopicAttention,
  now: Date,
  cal: WorkCalendar,
  p: AttentionParams,
): TopicAttention {
  const st = readEngineState(stored)
  if (!st?.core) return stored
  const core = st.core
  const esc = escalate(core, now, cal, p)
  const cycle = {
    startedAt: stored.cycleStartedAt ? new Date(stored.cycleStartedAt) : null,
    band: st.cycleBand ?? core.band,
  }
  const pl = place(core, esc, cycle, now, cal, p)
  return {
    ...stored,
    hiddenReason: pl.hiddenReason,
    profile: pl.list === "none" ? null : (esc.profile as DisplayProfile | null),
    list: pl.list,
    escalations: esc.escalations,
    deadline: esc.next?.at ?? esc.overdueDl?.at ?? null,
    overdue: !!esc.overdueDl,
    rank: pl.rank,
    rankKey: pl.rankKey,
    section: pl.section,
    cardExpiresAt: iso(pl.cardExpiresAt),
    snoozedUntil: esc.hidden === "snoozed" ? core.snoozedUntil : null,
    explanation: explain(core, esc, pl, cal, p, now),
  }
}

/** Sort comparator for one list (06 §7.4). */
export function compareRank(a: Pick<TopicAttention, "rank" | "rankKey">, b: Pick<TopicAttention, "rank" | "rankKey">): number {
  return (a.rankKey ?? "").localeCompare(b.rankKey ?? "") || a.rank - b.rank
}

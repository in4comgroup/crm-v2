// Watchdogs of topics plan phase 8 (spec topics/01 §5.6 «Rules for absence»,
// Q24-11; 06 §4.2 B5): deterministic process codes over communication
// topics. PURE — no DB, no server imports. The loaders live in
// `watchdogs-data.ts`; the store (`store.ts`) writes the result.
//
// Every check looks at ONE current base event per topic (the latest
// sending / request) and returns:
//  - a finding when its condition is true now (also when the key exists —
//    the store refreshes `checked_at`);
//  - a clear for an open existing instance whose condition is no longer true
//    (client reply, our reply, new sending / request, moved deadline, …);
//  - nothing when the data is insufficient (counted in `skipped`).
//
// No-response codes (Q24-11) need: an originating sending, an elapsed reply
// deadline (agreed date = latest owner `them` deadline on the sending or a
// later item of the topic; else sending + `noResponseDefaultDays` calendar
// days), every connected pull channel synced after the deadline, and no
// qualifying response. Open point: `facts.offerValidUntil` (offer validity
// countdown, OFFER_COUNTDOWN_STEPS) is not extracted yet → no countdown.

import { addCalendarDays, type WorkCalendar } from "@/lib/topics/attention-calendar"
import type { CheckClear, CheckFinding, CheckResult, OpenProcessInstance } from "@/lib/topics/checks"
import type { CheckContext } from "./types"

// ── Inputs ────────────────────────────────────────────────────────────────

/** Item direction: signal facts first, else parse-time attribution; unknown = not decided yet. */
export type WdDirection = "inbound" | "outbound" | "internal" | "unknown"

export type WdDeadline = {
  /** "YYYY-MM-DD" (end of that day, org time) or "YYYY-MM-DDTHH:MM". */
  date: string
  owner: "us" | "them" | "unknown"
  subjectIndex: number
}

/** One `topic_item` link (an item linked with several subjects appears once per subject). */
export type WdTopicItem = {
  itemId: string
  date: Date
  direction: WdDirection
  threadKey: string | null
  /** Bounce / out-of-office / automated sender / excluded — never a response. */
  automated: boolean
  subjectIndex: number
  deadlines: WdDeadline[]
}

/** A parser instance on the topic (process instances are not inputs). */
export type WdInstance = {
  id: string
  code: string
  itemId: string
  itemDate: Date
  subjectIndex: number
  confidence: string
}

export type WdTopic = {
  id: string
  status: string
  clientId: string | null
  contactId: string | null
  companyName: string | null
  matter: string
  items: WdTopicItem[]
  instances: WdInstance[]
}

/** An org item that may answer a sending / be our reply (any topic or none). */
export type WdActivityItem = {
  itemId: string
  date: Date
  direction: WdDirection
  automated: boolean
  threadKey: string | null
  /** Clients / contacts the item is linked to (subjects + topics). */
  clientIds: string[]
  contactIds: string[]
}

/** A connected channel. `pull` = synced by the cron (must be fresh); push channels are live. */
export type WdSource = { id: string; name: string; pull: boolean; lastSyncedAt: Date | null }

export type WatchdogData = {
  topics: WdTopic[]
  activity: WdActivityItem[]
  sources: WdSource[]
}

/** One item carrying `facts.contractEndDate`, per topic link. */
export type ContractLink = {
  itemId: string
  itemDate: Date
  /** "YYYY-MM-DD". */
  endDate: string
  topicId: string
  topicStatus: string
  clientId: string
  contactId: string | null
  companyName: string | null
  matter: string
}

/** A CONTRACT_RENEWAL_INTENT instance (confidence not low) of a client. */
export type RenewalIntent = { instanceId: string; clientId: string; itemDate: Date }

export type ContractData = { links: ContractLink[]; renewals: RenewalIntent[] }

export type WatchdogCtx = Pick<CheckContext, "now" | "params" | "calendar" | "existing">

// ── Codes ─────────────────────────────────────────────────────────────────

export const WD_CODES = {
  offerSent: "SALES_OFFER_SENT",
  offerNoResponse: "SALES_OFFER_NO_RESPONSE",
  priceRequest: "SALES_PRICE_REQUEST",
  priceNoResponse: "SALES_PRICE_NO_RESPONSE",
  materialRequested: "SALES_MATERIAL_REQUESTED",
  materialNoResponse: "SALES_MATERIAL_NO_RESPONSE",
  confirmationRequested: "SALES_ORDER_CONFIRMATION_REQUESTED",
  confirmationSent: "SALES_ORDER_CONFIRMATION_SENT",
  confirmationOpen: "SALES_ORDER_CONFIRMATION_OPEN",
  reportRequested: "DELIVERY_REPORT_REQUESTED",
  reportOpen: "DELIVERY_REPORT_OPEN",
  renewalIntent: "CONTRACT_RENEWAL_INTENT",
  contractNotRenewed: "CONTRACT_NOT_RENEWED",
} as const

/** Base / evidence codes the loaders must read. */
export const WD_INPUT_CODES: readonly string[] = [
  WD_CODES.offerSent,
  WD_CODES.priceRequest,
  WD_CODES.materialRequested,
  WD_CODES.confirmationRequested,
  WD_CODES.confirmationSent,
  WD_CODES.reportRequested,
]

/** Process codes of the topic watchdogs (not the contract one). */
export const WD_TOPIC_PROCESS_CODES: readonly string[] = [
  WD_CODES.offerNoResponse,
  WD_CODES.priceNoResponse,
  WD_CODES.materialNoResponse,
  WD_CODES.confirmationOpen,
  WD_CODES.reportOpen,
]

/** Renewal intent after `end − RENEWAL_WINDOW_DAYS` counts (8 weeks, as the risk engine). */
export const RENEWAL_WINDOW_DAYS = 56

const USER_CLOSED = new Set(["done", "dismissed", "merged"])
const DAY_MS = 86_400_000

// ── Small helpers ─────────────────────────────────────────────────────────

function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a > 10 && a < 20) return many
  if (b === 1) return one
  if (b >= 2 && b <= 4) return few
  return many
}

/** "YYYY-MM-DD" → "DD.MM.YYYY". */
export function fmtDay(day: string): string {
  return `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`
}

function fmtAt(cal: WorkCalendar, d: Date): string {
  return fmtDay(cal.localDay(d))
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}/

/** End of the agreed date: date only = end of that day (org time); with a time = that moment. */
export function agreedMoment(cal: WorkCalendar, s: string): Date | null {
  if (!ISO_DAY.test(s)) return null
  const day = s.slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return cal.at(day, s.slice(11, 16))
  return cal.at(addCalendarDays(day, 1), 0)
}

/** End of the working day `day` (short days end one hour earlier). */
function workDayEnd(cal: WorkCalendar, day: string): Date {
  return cal.at(day, cal.workEndMin - (cal.isShortDay(day) ? 60 : 0))
}

function subjectMatch(a: number, b: number): boolean {
  return a === b || a === -1 || b === -1
}

/** Unique items of a topic (first link wins for the item fields). */
function uniqueItems(t: WdTopic): WdTopicItem[] {
  const seen = new Map<string, WdTopicItem>()
  for (const l of t.items) if (!seen.has(l.itemId)) seen.set(l.itemId, l)
  return [...seen.values()]
}

function linkOf(t: WdTopic, itemId: string, subjectIndex: number): WdTopicItem | undefined {
  return t.items.find((l) => l.itemId === itemId && subjectMatch(l.subjectIndex, subjectIndex)) ?? t.items.find((l) => l.itemId === itemId)
}

function latest<T>(xs: T[], at: (x: T) => Date): T | null {
  let best: T | null = null
  for (const x of xs) if (!best || at(x).getTime() > at(best).getTime()) best = x
  return best
}

function bump(skipped: Record<string, number>, reason: string, n = 1) {
  skipped[reason] = (skipped[reason] ?? 0) + n
}

type Deadline = { at: Date; day: string; source: "agreed" | "default" }

/** Q24-11: every connected channel checked after the deadline. null = ok, else the skip reason. */
export function channelsChecked(sources: WdSource[], deadline: Date): string | null {
  if (sources.length === 0) return "no_connected_channels"
  for (const s of sources) {
    if (!s.pull) continue
    if (!s.lastSyncedAt || s.lastSyncedAt.getTime() <= deadline.getTime()) return "sources_not_synced"
  }
  return null
}

// ── Assembling a result ───────────────────────────────────────────────────

type Outcome =
  | { kind: "true"; finding: CheckFinding }
  | { kind: "false"; reasonRu: string; skip: string }
  | { kind: "unknown"; skip: string }

type Candidate = {
  topicId: string | null
  key: string
  /** Date of the base event (lookback gate for NEW findings). */
  baseAt: Date
  outcome: Outcome
}

/**
 * Turns per-condition outcomes into a `CheckResult`. `stale` decides the
 * clear reason of an open instance whose key is no longer a candidate
 * (null = keep it, e.g. the topic was closed by the user).
 */
function assemble(
  code: string,
  candidates: Candidate[],
  ctx: WatchdogCtx,
  lookbackStart: Date | null,
  evaluated: number,
  skipped: Record<string, number>,
  stale: (e: OpenProcessInstance) => string | null,
): CheckResult {
  const open = ctx.existing.filter((e) => e.code === code && !e.clearedAt)
  const openKeys = new Set(open.map((e) => e.conditionKey))
  const byKey = new Map(candidates.map((c) => [c.key, c]))
  const findings: CheckFinding[] = []
  for (const c of candidates) {
    if (c.outcome.kind === "true") {
      if (lookbackStart && c.baseAt.getTime() < lookbackStart.getTime() && !openKeys.has(c.key)) {
        bump(skipped, "outside_lookback")
        continue
      }
      findings.push(c.outcome.finding)
    } else bump(skipped, c.outcome.skip)
  }
  const clears: CheckClear[] = []
  for (const e of open) {
    const c = byKey.get(e.conditionKey)
    if (c) {
      if (c.outcome.kind === "false") clears.push({ instanceId: e.id, reasonRu: c.outcome.reasonRu })
      continue
    }
    const reason = stale(e)
    if (reason) clears.push({ instanceId: e.id, reasonRu: reason })
  }
  return { findings, clears, evaluated, skipped }
}

// ── No-response watchdogs (offer / price / material) ──────────────────────

type Sending = {
  topic: WdTopic
  baseInstanceId: string
  sent: WdTopicItem
  request: { itemId: string; at: Date } | null
}

/** Latest owner-`them` deadline on the sending or a later item of the topic; else the default window. */
export function replyDeadline(t: WdTopic, sent: WdTopicItem, cal: WorkCalendar, defaultDays: number): Deadline {
  const sentDay = cal.localDay(sent.date)
  let best: Deadline | null = null
  for (const l of t.items) {
    if (l.date.getTime() < sent.date.getTime()) continue
    for (const d of l.deadlines) {
      if (d.owner !== "them" || !subjectMatch(d.subjectIndex, l.subjectIndex)) continue
      const day = d.date.slice(0, 10)
      if (day < sentDay) continue
      const at = agreedMoment(cal, d.date)
      if (at && (!best || at.getTime() > best.at.getTime())) best = { at, day, source: "agreed" }
    }
  }
  if (best) return best
  const at = new Date(sent.date.getTime() + defaultDays * DAY_MS)
  return { at, day: cal.localDay(at), source: "default" }
}

type Response = { kind: "replied"; at: Date } | { kind: "possible" } | null

/**
 * Qualifying response after `after`: an inbound item on the topic, or any
 * inbound item of the same client / contact (any topic), or on the same
 * thread. An item of unknown direction on the thread / of the client = a
 * possible response (no finding, no clear).
 */
export function firstResponse(
  t: WdTopic,
  after: Date,
  threadKey: string | null,
  activity: WdActivityItem[],
): Response {
  const first: { at: Date | null } = { at: null }
  let possible = false
  const take = (d: Date) => {
    if (!first.at || d.getTime() < first.at.getTime()) first.at = d
  }
  for (const l of uniqueItems(t)) {
    if (l.automated || l.date.getTime() <= after.getTime()) continue
    if (l.direction === "inbound") take(l.date)
    else if (l.direction === "unknown") possible = true
  }
  for (const a of activity) {
    if (a.automated || a.date.getTime() <= after.getTime()) continue
    const related =
      (threadKey !== null && a.threadKey === threadKey) ||
      (t.clientId !== null && a.clientIds.includes(t.clientId)) ||
      (t.contactId !== null && a.contactIds.includes(t.contactId))
    if (!related) continue
    if (a.direction === "inbound") take(a.date)
    else if (a.direction === "unknown") possible = true
  }
  if (first.at) return { kind: "replied", at: first.at }
  return possible ? { kind: "possible" } : null
}

type NoResponseSpec = {
  code: string
  /** Evidence prefix: what was sent when (and the request). */
  sentRu: (s: Sending, cal: WorkCalendar) => string
  /** Clear reason when a newer sending replaced the old one. */
  supersededRu: string
  /** Finds the current sending of a topic (null + skip reason when none). */
  sending: (t: WdTopic) => { sending: Sending | null; skip: string | null }
}

function noResponseCheck(spec: NoResponseSpec, data: WatchdogData, ctx: WatchdogCtx): CheckResult {
  const { now, calendar: cal, params } = ctx
  const skipped: Record<string, number> = {}
  const candidates: Candidate[] = []
  const currentByTopic = new Map<string, Sending>()
  let evaluated = 0
  for (const t of data.topics) {
    const { sending, skip } = spec.sending(t)
    if (!sending && !skip) continue
    evaluated++
    if (USER_CLOSED.has(t.status)) {
      bump(skipped, "topic_closed_by_user")
      continue
    }
    if (!sending) {
      bump(skipped, skip as string)
      continue
    }
    currentByTopic.set(t.id, sending)
    const key = `topic:${t.id}:sent:${sending.sent.itemId}`
    candidates.push({ topicId: t.id, key, baseAt: sending.sent.date, outcome: noResponseOutcome(spec, sending, data, ctx) })
  }
  const lookbackStart = new Date(now.getTime() - params.watchdogLookbackDays * DAY_MS)
  const topicsById = new Map(data.topics.map((t) => [t.id, t]))
  return assemble(spec.code, candidates, ctx, lookbackStart, evaluated, skipped, (e) => {
    if (!e.topicId) return "Тема удалена"
    const t = topicsById.get(e.topicId)
    if (!t || USER_CLOSED.has(t.status)) return null
    const sentAt = typeof e.facts.sentAt === "string" ? new Date(e.facts.sentAt) : null
    const sentItemId = typeof e.facts.sentItemId === "string" ? e.facts.sentItemId : null
    const sent = sentItemId ? t.items.find((l) => l.itemId === sentItemId) : undefined
    if (sentAt && !Number.isNaN(sentAt.getTime())) {
      const r = firstResponse(t, sentAt, sent?.threadKey ?? null, data.activity)
      if (r?.kind === "replied") return `Клиент ответил ${fmtAt(cal, r.at)}`
    }
    const cur = currentByTopic.get(t.id)
    if (cur) return `${spec.supersededRu} ${fmtAt(cal, cur.sent.date)}`
    if (!sent) return "Отправка больше не найдена в теме"
    return "Исходное событие больше не найдено в теме"
  })
}

function noResponseOutcome(spec: NoResponseSpec, s: Sending, data: WatchdogData, ctx: WatchdogCtx): Outcome {
  const { now, calendar: cal, params } = ctx
  const t = s.topic
  const resp = firstResponse(t, s.sent.date, s.sent.threadKey, data.activity)
  if (resp?.kind === "replied") return { kind: "false", reasonRu: `Клиент ответил ${fmtAt(cal, resp.at)}`, skip: "responded" }
  const dl = replyDeadline(t, s.sent, cal, params.noResponseDefaultDays)
  if (now.getTime() <= dl.at.getTime())
    return { kind: "false", reasonRu: `Срок ответа ещё не истёк (до ${fmtDay(dl.day)})`, skip: "not_due" }
  if (resp?.kind === "possible") return { kind: "unknown", skip: "possible_reply" }
  const ch = channelsChecked(data.sources, dl.at)
  if (ch) return { kind: "unknown", skip: ch }
  const n = params.noResponseDefaultDays
  const dlRu = dl.source === "agreed" ? `${fmtDay(dl.day)} (согласован)` : `${fmtDay(dl.day)} (${n} ${plural(n, "день", "дня", "дней")})`
  const facts: Record<string, unknown> = {
    baseInstanceId: s.baseInstanceId,
    sentItemId: s.sent.itemId,
    sentAt: s.sent.date.toISOString(),
    deadline: dl.at.toISOString(),
    deadlineSource: dl.source,
  }
  if (s.request) {
    facts.requestItemId = s.request.itemId
    facts.requestedAt = s.request.at.toISOString()
  }
  return {
    kind: "true",
    finding: {
      code: spec.code,
      conditionKey: `topic:${t.id}:sent:${s.sent.itemId}`,
      topicId: t.id,
      clientId: t.clientId,
      contactId: t.contactId,
      companyName: t.companyName,
      matterRu: t.matter,
      evidenceRu: `${spec.sentRu(s, cal)}; срок ответа ${dlRu}; ответа нет`,
      score: null,
      facts,
    },
  }
}

/** Our latest SALES_OFFER_SENT on an outbound item of the topic. */
function offerSending(t: WdTopic): { sending: Sending | null; skip: string | null } {
  const offers = t.instances.filter((i) => i.code === WD_CODES.offerSent && i.confidence !== "low")
  if (offers.length === 0) return { sending: null, skip: null }
  const sends = offers
    .map((i) => ({ i, l: linkOf(t, i.itemId, i.subjectIndex) }))
    .filter((x): x is { i: WdInstance; l: WdTopicItem } => !!x.l && x.l.direction === "outbound")
  const best = latest(sends, (x) => x.l.date)
  if (!best) return { sending: null, skip: "not_outbound" }
  return { sending: { topic: t, baseInstanceId: best.i.id, sent: best.l, request: null }, skip: null }
}

/** The latest inbound request of `code` + our first outbound item after it (= the sending). */
function sendingAfterRequest(code: string) {
  return (t: WdTopic): { sending: Sending | null; skip: string | null } => {
    const reqs = t.instances
      .filter((i) => i.code === code && i.confidence !== "low")
      .map((i) => ({ i, l: linkOf(t, i.itemId, i.subjectIndex) }))
      .filter((x): x is { i: WdInstance; l: WdTopicItem } => !!x.l)
    if (reqs.length === 0) return { sending: null, skip: null }
    const req = latest(
      reqs.filter((x) => x.l.direction === "inbound"),
      (x) => x.l.date,
    )
    if (!req) return { sending: null, skip: "not_inbound" }
    const sent = uniqueItems(t)
      .filter((l) => l.direction === "outbound" && l.date.getTime() > req.l.date.getTime())
      .sort((a, b) => a.date.getTime() - b.date.getTime())[0]
    if (!sent) return { sending: null, skip: "not_sent_yet" }
    return {
      sending: { topic: t, baseInstanceId: req.i.id, sent, request: { itemId: req.l.itemId, at: req.l.date } },
      skip: null,
    }
  }
}

export function checkOfferNoResponse(data: WatchdogData, ctx: WatchdogCtx): CheckResult {
  return noResponseCheck(
    {
      code: WD_CODES.offerNoResponse,
      sentRu: (s, cal) => `КП отправлено ${fmtAt(cal, s.sent.date)}`,
      supersededRu: "Отправлено новое КП",
      sending: offerSending,
    },
    data,
    ctx,
  )
}

export function checkPriceNoResponse(data: WatchdogData, ctx: WatchdogCtx): CheckResult {
  return noResponseCheck(
    {
      code: WD_CODES.priceNoResponse,
      sentRu: (s, cal) => `Запрос цен ${fmtAt(cal, s.request!.at)}; цены отправлены ${fmtAt(cal, s.sent.date)}`,
      supersededRu: "Новая отправка цен",
      sending: sendingAfterRequest(WD_CODES.priceRequest),
    },
    data,
    ctx,
  )
}

export function checkMaterialNoResponse(data: WatchdogData, ctx: WatchdogCtx): CheckResult {
  return noResponseCheck(
    {
      code: WD_CODES.materialNoResponse,
      sentRu: (s, cal) => `Запрос материалов ${fmtAt(cal, s.request!.at)}; материалы отправлены ${fmtAt(cal, s.sent.date)}`,
      supersededRu: "Новая отправка материалов",
      sending: sendingAfterRequest(WD_CODES.materialRequested),
    },
    data,
    ctx,
  )
}

// ── Our open obligations (order confirmation / report) ───────────────────

type Request = { topic: WdTopic; baseInstanceId: string; item: WdTopicItem }

/** Latest owner-`us` deadline on the request item; else request + N working days (end of that working day). */
export function ourDeadline(req: WdTopicItem, links: WdTopicItem[], cal: WorkCalendar, workingDays: number): Deadline {
  const reqDay = cal.localDay(req.date)
  let best: Deadline | null = null
  for (const l of links) {
    if (l.itemId !== req.itemId) continue
    for (const d of l.deadlines) {
      if (d.owner !== "us" || !subjectMatch(d.subjectIndex, l.subjectIndex)) continue
      const day = d.date.slice(0, 10)
      if (day < reqDay) continue
      const at = agreedMoment(cal, d.date)
      if (at && (!best || at.getTime() > best.at.getTime())) best = { at, day, source: "agreed" }
    }
  }
  if (best) return best
  const day = cal.addWorkingDays(reqDay, workingDays)
  return { at: workDayEnd(cal, day), day, source: "default" }
}

type Done = { kind: "done"; at: Date } | { kind: "possible" } | null

/**
 * Our answer after the request: an outbound item on the topic or on the
 * request's thread, or (confirmation only) a SALES_ORDER_CONFIRMATION_SENT
 * instance on the topic. A low-confidence SENT or an item of unknown
 * direction on the thread = possible (no finding, no clear).
 */
export function ourAnswerAfter(
  t: WdTopic,
  req: WdTopicItem,
  activity: WdActivityItem[],
  sentCode: string | null,
): Done {
  const first: { at: Date | null } = { at: null }
  let possible = false
  const after = req.date.getTime()
  const take = (d: Date) => {
    if (!first.at || d.getTime() < first.at.getTime()) first.at = d
  }
  if (sentCode) {
    for (const i of t.instances) {
      if (i.code !== sentCode || i.itemDate.getTime() <= after) continue
      if (i.confidence === "low") possible = true
      else take(i.itemDate)
    }
  }
  for (const l of uniqueItems(t)) {
    if (l.date.getTime() <= after) continue
    if (l.direction === "outbound") take(l.date)
  }
  if (req.threadKey) {
    for (const a of activity) {
      if (a.threadKey !== req.threadKey || a.date.getTime() <= after) continue
      if (a.direction === "outbound") take(a.date)
      else if (a.direction === "unknown" && !a.automated) possible = true
    }
  }
  if (first.at) return { kind: "done", at: first.at }
  return possible ? { kind: "possible" } : null
}

type ObligationSpec = {
  code: string
  requestCode: string
  sentCode: string | null
  requestRu: string
  notDoneRu: string
  doneRu: string
}

function obligationCheck(spec: ObligationSpec, data: WatchdogData, ctx: WatchdogCtx): CheckResult {
  const { now, calendar: cal, params } = ctx
  const skipped: Record<string, number> = {}
  const candidates: Candidate[] = []
  const currentByTopic = new Map<string, Request>()
  let evaluated = 0
  for (const t of data.topics) {
    const reqs = t.instances
      .filter((i) => i.code === spec.requestCode && i.confidence !== "low")
      .map((i) => ({ i, l: linkOf(t, i.itemId, i.subjectIndex) }))
      .filter((x): x is { i: WdInstance; l: WdTopicItem } => !!x.l)
    if (reqs.length === 0) continue
    evaluated++
    if (USER_CLOSED.has(t.status)) {
      bump(skipped, "topic_closed_by_user")
      continue
    }
    const best = latest(
      reqs.filter((x) => x.l.direction === "inbound"),
      (x) => x.l.date,
    )
    if (!best) {
      bump(skipped, "not_inbound")
      continue
    }
    const req: Request = { topic: t, baseInstanceId: best.i.id, item: best.l }
    currentByTopic.set(t.id, req)
    const key = `topic:${t.id}:request:${best.l.itemId}`
    candidates.push({ topicId: t.id, key, baseAt: best.l.date, outcome: obligationOutcome(spec, req, key, data, ctx) })
  }
  const lookbackStart = new Date(now.getTime() - params.watchdogLookbackDays * DAY_MS)
  const topicsById = new Map(data.topics.map((t) => [t.id, t]))
  return assemble(spec.code, candidates, ctx, lookbackStart, evaluated, skipped, (e) => {
    if (!e.topicId) return "Тема удалена"
    const t = topicsById.get(e.topicId)
    if (!t || USER_CLOSED.has(t.status)) return null
    const reqItemId = typeof e.facts.requestItemId === "string" ? e.facts.requestItemId : null
    const reqItem = reqItemId ? t.items.find((l) => l.itemId === reqItemId) : undefined
    if (reqItem) {
      const d = ourAnswerAfter(t, reqItem, data.activity, spec.sentCode)
      if (d?.kind === "done") return `${spec.doneRu} ${fmtAt(cal, d.at)}`
    }
    const cur = currentByTopic.get(t.id)
    if (cur) return `Новый запрос ${fmtAt(cal, cur.item.date)}`
    return "Запрос больше не найден в теме"
  })
}

function obligationOutcome(spec: ObligationSpec, r: Request, key: string, data: WatchdogData, ctx: WatchdogCtx): Outcome {
  const { now, calendar: cal, params } = ctx
  const t = r.topic
  const done = ourAnswerAfter(t, r.item, data.activity, spec.sentCode)
  if (done?.kind === "done") return { kind: "false", reasonRu: `${spec.doneRu} ${fmtAt(cal, done.at)}`, skip: "done" }
  const dl = ourDeadline(r.item, t.items, cal, params.orgReplyWorkingDays)
  if (now.getTime() <= dl.at.getTime()) return { kind: "false", reasonRu: `Срок ещё не истёк (до ${fmtDay(dl.day)})`, skip: "not_due" }
  if (done?.kind === "possible") return { kind: "unknown", skip: "possible_done" }
  const ch = channelsChecked(data.sources, dl.at)
  if (ch) return { kind: "unknown", skip: ch }
  const n = params.orgReplyWorkingDays
  const dlRu =
    dl.source === "agreed" ? `${fmtDay(dl.day)} (обещано)` : `${fmtDay(dl.day)} (${n} раб. ${plural(n, "день", "дня", "дней")})`
  return {
    kind: "true",
    finding: {
      code: spec.code,
      conditionKey: key,
      topicId: t.id,
      clientId: t.clientId,
      contactId: t.contactId,
      companyName: t.companyName,
      matterRu: t.matter,
      evidenceRu: `${spec.requestRu} ${fmtAt(cal, r.item.date)}; срок ${dlRu}; ${spec.notDoneRu}`,
      score: null,
      facts: {
        baseInstanceId: r.baseInstanceId,
        requestItemId: r.item.itemId,
        requestedAt: r.item.date.toISOString(),
        deadline: dl.at.toISOString(),
        deadlineSource: dl.source,
      },
    },
  }
}

export function checkOrderConfirmationOpen(data: WatchdogData, ctx: WatchdogCtx): CheckResult {
  return obligationCheck(
    {
      code: WD_CODES.confirmationOpen,
      requestCode: WD_CODES.confirmationRequested,
      sentCode: WD_CODES.confirmationSent,
      requestRu: "Запрос подтверждения заказа",
      notDoneRu: "подтверждение не отправлено",
      doneRu: "Подтверждение отправлено",
    },
    data,
    ctx,
  )
}

export function checkReportOpen(data: WatchdogData, ctx: WatchdogCtx): CheckResult {
  return obligationCheck(
    {
      code: WD_CODES.reportOpen,
      requestCode: WD_CODES.reportRequested,
      sentCode: null,
      requestRu: "Запрос отчёта",
      notDoneRu: "отчёт не отправлен",
      doneRu: "Ответ отправлен",
    },
    data,
    ctx,
  )
}

// ── Contract not renewed ──────────────────────────────────────────────────

/**
 * One condition per client + distinct contract end date. True when the end
 * date is before today (org time), the client has no later end date (= a
 * new contract) and no CONTRACT_RENEWAL_INTENT from `end − 56 days`. The
 * finding attaches to the topic holding the latest item with that end date
 * (topics closed by the user are not used). No lookback: the end dates come
 * from topic items, which start at the org's topics switch-on anyway.
 */
export function checkContractNotRenewed(data: ContractData, ctx: WatchdogCtx): CheckResult {
  const { now, calendar: cal } = ctx
  const today = cal.localDay(now)
  const skipped: Record<string, number> = {}
  const candidates: Candidate[] = []
  const byClient = new Map<string, ContractLink[]>()
  for (const l of data.links) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(l.endDate)) continue
    const arr = byClient.get(l.clientId) ?? []
    arr.push(l)
    byClient.set(l.clientId, arr)
  }
  const renewalsByClient = new Map<string, RenewalIntent[]>()
  for (const r of data.renewals) {
    const arr = renewalsByClient.get(r.clientId) ?? []
    arr.push(r)
    renewalsByClient.set(r.clientId, arr)
  }
  for (const [clientId, links] of byClient) {
    const dates = [...new Set(links.map((l) => l.endDate))].sort()
    const intents = (renewalsByClient.get(clientId) ?? []).slice().sort((a, b) => a.itemDate.getTime() - b.itemDate.getTime())
    for (const end of dates) {
      const key = `client:${clientId}:contract_end:${end}`
      const baseAt = cal.at(end, 0)
      const later = dates.find((d) => d > end)
      const push = (outcome: Outcome) => candidates.push({ topicId: null, key, baseAt, outcome })
      if (later) {
        push({ kind: "false", reasonRu: `Новый договор до ${fmtDay(later)}`, skip: "renewed" })
        continue
      }
      const from = addCalendarDays(end, -RENEWAL_WINDOW_DAYS)
      const intent = intents.find((r) => cal.localDay(r.itemDate) >= from)
      if (intent) {
        push({ kind: "false", reasonRu: `Намерение продлить ${fmtAt(cal, intent.itemDate)}`, skip: "renewal_intent" })
        continue
      }
      if (end >= today) {
        push({ kind: "false", reasonRu: `Договор ещё действует (до ${fmtDay(end)})`, skip: "not_expired" })
        continue
      }
      const holder = latest(
        links.filter((l) => l.endDate === end && !USER_CLOSED.has(l.topicStatus)),
        (l) => l.itemDate,
      )
      if (!holder) {
        push({ kind: "unknown", skip: "topic_closed_by_user" })
        continue
      }
      push({
        kind: "true",
        finding: {
          code: WD_CODES.contractNotRenewed,
          conditionKey: key,
          topicId: holder.topicId,
          clientId,
          contactId: holder.contactId,
          companyName: holder.companyName,
          matterRu: holder.matter,
          evidenceRu: `Договор истёк ${fmtDay(end)}; продления и нового договора нет`,
          score: null,
          facts: {
            contractEndDate: end,
            itemId: holder.itemId,
            itemDate: holder.itemDate.toISOString(),
            renewalWindowFrom: from,
          },
        },
      })
    }
  }
  return assemble(WD_CODES.contractNotRenewed, candidates, ctx, null, byClient.size, skipped, () => "Дата окончания договора больше не найдена")
}

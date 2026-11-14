// Topic resolution of ONE item (spec topics/01 §6.2, §6.4, §7; plan phase 3
// task 4). PURE apart from the injected matcher: works on an in-memory pool
// of topics (the store loads it, unit tests build it), mutates the pool and
// returns what the store must write.
//
// Per subject that has ≥1 counted signal or a closing (state / S1 /
// closes_codes) code:
//   1. counterparty — already resolved by the caller (counterparty.ts);
//   2. hard key: same counterparty + a shared reference on a live topic or a
//      closed one inside the reopen window → attach;
//   3. candidates: live + recently closed (≤ 14 d) topics of the same
//      counterparty, plus live topics on the same thread_key; by recency, ≤ 10;
//   4. no candidate → new topic (closing-only subject → log only);
//   5. matcher (`topics.topic_match`): an id copied from the list or NEW;
//      when not `high`, attach only if same counterparty AND same family AND
//      no conflicting reference / product / amount (R15), else new;
//   6. closing-only subject with no topic → log only (no topic, no card).
// Items with no counted signal and no closing code attach as `context` to a
// live topic that shares their thread_key or a reference (§6.4), else ignored.

import { randomUUID } from "node:crypto"
import type { SignalBand } from "@/lib/signals/extraction-types"
import { buildTopicTitle, referencesConflict, sharesReference } from "@/lib/topics/references"
import {
  TOPIC_LIVE_STATUSES,
  TOPIC_TIMERS,
  type TopicItemRole,
  type TopicItemStatus,
  type TopicTimers,
} from "@/lib/topics/types"
import { inReopenWindow, recomputeTopic } from "./lifecycle"
import {
  isClosingCode,
  type CodeBook,
  type ItemInput,
  type ItemInstance,
  type RelationLookup,
  type ResolvedSubject,
  type TopicEventDraft,
  type TopicSnapshot,
} from "./model"

const DAY_MS = 86_400_000
/** Max candidates shown to the matcher (§6.2 step 3). */
export const MAX_CANDIDATES = 10
/** Relative tolerance under which two amounts are "the same". */
const AMOUNT_TOLERANCE = 0.02

// ── Matcher contract ──────────────────────────────────────────────────────

export type MatcherCandidate = {
  id: string
  title: string
  matter: string
  family: string | null
  leadCode: string | null
  status: string
  references: { kind: string; value: string }[]
  products: string[]
  lastEvents: string[]
}

export type MatcherInput = {
  itemId: string
  itemDate: Date
  direction: string
  subject: {
    counterparty: string
    matter: string
    references: { kind: string; value: string }[]
    products: string[]
    amounts: number[]
    codes: { code: string; labelRu: string; evidence: string }[]
  }
  candidates: MatcherCandidate[]
}

export type MatcherDecision = {
  /** A candidate id copied from the list, or "NEW". */
  topicId: string
  confidence: "high" | "medium" | "low"
  reason: string
}

export type TopicMatcher = (input: MatcherInput) => Promise<MatcherDecision>

// ── Result ────────────────────────────────────────────────────────────────

export type SubjectOutcome =
  | {
      kind: "attach"
      subjectIndex: number
      topicId: string
      role: TopicItemRole
      via: "hard_key" | "matcher" | "matcher_bias" | "new" | "context_thread" | "context_reference"
      created: boolean
      reopened: boolean
      matcher?: MatcherDecision & { candidates: number }
    }
  | { kind: "log_only"; subjectIndex: number; codes: string[]; reason: string }
  | { kind: "skip"; subjectIndex: number; reason: string }

export type ItemResolution = {
  status: TopicItemStatus
  reason: string | null
  outcomes: SubjectOutcome[]
  /** instance id → topic id (store sets signal_instance.topic_id). */
  instanceTopic: Map<string, string>
  events: TopicEventDraft[]
  /** Topics created or changed (store writes them). */
  touched: Set<string>
  matcherCalls: number
}

export type ResolveContext = {
  book: CodeBook
  relationOf: RelationLookup
  matcher: TopicMatcher
  now: Date
  timers?: TopicTimers
  newId?: () => string
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** «Same counterparty» (§6.2 step 1): same client, else same contact, else same raw key. */
export function sameCounterparty(
  t: Pick<TopicSnapshot, "clientId" | "contactId" | "counterpartyKey">,
  s: Pick<ResolvedSubject, "clientId" | "contactId" | "counterpartyKey">,
): boolean {
  if (s.clientId || t.clientId) return !!s.clientId && s.clientId === t.clientId
  if (s.contactId || t.contactId) return !!s.contactId && s.contactId === t.contactId
  return !!s.counterpartyKey && s.counterpartyKey === t.counterpartyKey
}

function isLive(t: TopicSnapshot): boolean {
  return TOPIC_LIVE_STATUSES.includes(t.status)
}

function topicAmounts(t: TopicSnapshot): number[] {
  return t.items.flatMap((l) => l.amounts)
}

function amountsConflict(a: readonly number[], b: readonly number[]): boolean {
  if (a.length === 0 || b.length === 0) return false
  return !a.some((x) => b.some((y) => Math.abs(x - y) <= AMOUNT_TOLERANCE * Math.max(x, y)))
}

function normProduct(p: string): string {
  return p.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")
}

function productsConflict(a: readonly string[], b: readonly string[]): boolean {
  if (a.length === 0 || b.length === 0) return false
  const set = new Set(a.map(normProduct))
  return !b.some((p) => set.has(normProduct(p)))
}

/** Subject instances: its own + item-wide (-1). */
function subjectInstances(item: ItemInput, s: ResolvedSubject): ItemInstance[] {
  return item.instances.filter((i) => i.subjectIndex === s.index || i.subjectIndex === -1 || s.index === -1)
}

function isCountedInstance(i: ItemInstance): boolean {
  return i.counted && i.scoreContrib > 0
}

function subjectFamily(insts: readonly ItemInstance[], book: CodeBook): string | null {
  const ranked = [...insts].sort((a, b) => b.scoreContrib - a.scoreContrib)
  for (const i of ranked) {
    const f = book.get(i.code)?.family
    if (f) return f
  }
  return null
}

function lastEvents(t: TopicSnapshot, book: CodeBook): string[] {
  const byItem = new Map<string, string[]>()
  for (const i of t.instances) {
    if (!i.itemId) continue
    const list = byItem.get(i.itemId) ?? []
    list.push(book.get(i.code)?.labelRu ?? i.code)
    byItem.set(i.itemId, list)
  }
  return [...t.items]
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, 3)
    .map((l) => {
      const dir = l.direction === "outbound" ? "наше" : l.direction === "internal" ? "внутреннее" : "входящее"
      const codes = byItem.get(l.itemId)?.join(", ") || "без сигналов"
      return `${l.date.toISOString().slice(0, 10)} ${dir} (${l.role}): ${codes}`
    })
}

function sortByRecency(list: TopicSnapshot[]): TopicSnapshot[] {
  return [...list].sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime())
}

// ── Attach / create ───────────────────────────────────────────────────────

function attachToTopic(
  t: TopicSnapshot,
  item: ItemInput,
  s: ResolvedSubject,
  insts: readonly ItemInstance[],
  role: TopicItemRole,
  ctx: ResolveContext,
  res: ItemResolution,
): { reopened: boolean } {
  const hasCounted = insts.some(isCountedInstance)
  let reopened = false
  // Reopen: a dormant topic on any new matching item; a resolved / done
  // topic inside its window on a new counted signal (§7.1).
  if (role !== "context" && (t.status === "dormant" || (hasCounted && inReopenWindow(t, item.date, ctx.timers)))) {
    res.events.push({
      topicId: t.id,
      type: "reopened",
      sourceItemId: item.itemId,
      payload: { from: t.status },
    })
    t.status = "open"
    t.closedAt = null
    t.closedReason = null
    reopened = true
  }
  const subjectAmounts = item.amounts.filter((a) => a.subjectIndex === s.index || a.subjectIndex === -1).map((a) => a.value)
  if (!t.items.some((l) => l.itemId === item.itemId && l.subjectIndex === s.index)) {
    t.items.push({
      itemId: item.itemId,
      subjectIndex: s.index,
      role,
      date: item.date,
      direction: item.direction,
      threadKey: item.threadKey,
      references: s.references,
      products: s.products,
      amounts: subjectAmounts,
    })
  }
  const deadlines = item.deadlines
    .filter((d) => d.subjectIndex === s.index || d.subjectIndex === -1)
    .map((d) => d.date)
  for (const i of insts) {
    // An item-wide instance keeps its first topic (signal_instance has one topic_id).
    if (res.instanceTopic.has(i.id)) continue
    res.instanceTopic.set(i.id, t.id)
    if (!t.instances.some((x) => x.id === i.id)) {
      t.instances.push({
        id: i.id,
        code: i.code,
        itemId: item.itemId,
        itemDate: item.date,
        confidence: i.confidence,
        counted: i.counted,
        scoreContrib: i.scoreContrib,
        deadlines,
        evidence: i.evidence,
      })
    }
  }
  if (t.taxonomyVersion === null || (item.taxonomyVersion ?? 0) > t.taxonomyVersion) t.taxonomyVersion = item.taxonomyVersion
  // Fill a missing counterparty link (e.g. the first item had no client).
  if (!t.clientId && s.clientId && (!t.contactId || t.contactId === s.contactId)) t.clientId = s.clientId
  if (!t.contactId && s.contactId && (!t.clientId || t.clientId === s.clientId)) t.contactId = s.contactId
  res.events.push({
    topicId: t.id,
    type: "item_attached",
    sourceItemId: item.itemId,
    payload: { role, subjectIndex: s.index, codes: insts.map((i) => i.code) },
  })
  res.events.push(...recomputeTopic(t, ctx.book, ctx.now, ctx.relationOf, { sourceItemId: item.itemId }))
  res.touched.add(t.id)
  return { reopened }
}

function createTopic(
  pool: TopicSnapshot[],
  item: ItemInput,
  s: ResolvedSubject,
  insts: readonly ItemInstance[],
  ctx: ResolveContext,
  res: ItemResolution,
): TopicSnapshot {
  const family = subjectFamily(insts, ctx.book)
  // A closed topic out of its window with a shared reference → related (§7.1).
  const related = sortByRecency(
    pool.filter((t) => !isLive(t) && t.status !== "merged" && sameCounterparty(t, s) && sharesReference(t.references, s.references)),
  )[0]
  const t: TopicSnapshot = {
    id: (ctx.newId ?? randomUUID)(),
    status: "open",
    subState: "none",
    clientId: s.clientId,
    contactId: s.contactId,
    counterpartyRaw: s.counterparty,
    counterpartyKey: s.counterpartyKey,
    dealId: null,
    title: buildTopicTitle({
      companyName: s.companyName,
      contactName: s.contactName,
      counterpartyRaw: s.counterparty,
      matter: s.matter,
    }),
    matter: s.matter,
    family,
    leadCode: null,
    class: null,
    score: 0,
    band: "none" satisfies SignalBand,
    references: s.references,
    products: s.products,
    firstSeenAt: item.date,
    lastActivityAt: item.date,
    closedAt: null,
    closedReason: null,
    relatedTopicId: related?.id ?? null,
    mergedIntoTopicId: null,
    taxonomyVersion: item.taxonomyVersion,
    instances: [],
    items: [],
    isNew: true,
  }
  pool.push(t)
  res.events.push({
    topicId: t.id,
    type: "created",
    sourceItemId: item.itemId,
    payload: { subjectIndex: s.index, relatedTopicId: t.relatedTopicId, counterparty: s.counterparty },
  })
  attachToTopic(t, item, s, insts, "origin", ctx, res)
  return t
}

// ── Main ──────────────────────────────────────────────────────────────────

export async function resolveItem(
  pool: TopicSnapshot[],
  item: ItemInput,
  ctx: ResolveContext,
): Promise<ItemResolution> {
  const res = await resolveItemInner(pool, item, ctx)
  // The journal keeps how each attach was decided (debug / shadow review).
  for (const o of res.outcomes) {
    if (o.kind !== "attach") continue
    const ev = res.events.find(
      (e) => e.type === "item_attached" && e.topicId === o.topicId && e.payload.subjectIndex === o.subjectIndex,
    )
    if (ev) ev.payload = { ...ev.payload, via: o.via, ...(o.matcher ? { matcher: o.matcher } : {}) }
  }
  return res
}

async function resolveItemInner(
  pool: TopicSnapshot[],
  item: ItemInput,
  ctx: ResolveContext,
): Promise<ItemResolution> {
  const timers = ctx.timers ?? TOPIC_TIMERS
  const res: ItemResolution = {
    status: "done",
    reason: null,
    outcomes: [],
    instanceTopic: new Map(),
    events: [],
    touched: new Set(),
    matcherCalls: 0,
  }

  let anyTopical = false
  for (const s of item.subjects) {
    const insts = subjectInstances(item, s)
    const counted = insts.filter(isCountedInstance)
    const closers = insts.filter((i) => i.confidence !== "low" && isClosingCode(ctx.book.get(i.code)))
    if (counted.length === 0 && closers.length === 0) {
      res.outcomes.push({ kind: "skip", subjectIndex: s.index, reason: "no counted or closing code" })
      continue
    }
    anyTopical = true
    const closingOnly = counted.length === 0
    const role: TopicItemRole = closingOnly ? "closing" : "update"
    const withinWindow = (t: TopicSnapshot) =>
      isLive(t) || (t.status !== "merged" && inReopenWindow(t, item.date, timers))

    // Step 2 — hard key.
    const hard = sortByRecency(
      pool.filter(
        (t) => withinWindow(t) && sameCounterparty(t, s) && s.references.length > 0 && sharesReference(t.references, s.references),
      ),
    )[0]
    if (hard) {
      const { reopened } = attachToTopic(hard, item, s, insts, role, ctx, res)
      res.outcomes.push({ kind: "attach", subjectIndex: s.index, topicId: hard.id, role, via: "hard_key", created: false, reopened })
      continue
    }

    // Step 3 — candidates.
    const cands = sortByRecency(
      pool.filter(
        (t) =>
          (withinWindow(t) && sameCounterparty(t, s)) ||
          (isLive(t) && !!item.threadKey && t.items.some((l) => l.threadKey === item.threadKey)),
      ),
    ).slice(0, MAX_CANDIDATES)

    // Step 4 — no candidate.
    if (cands.length === 0) {
      if (closingOnly) {
        res.outcomes.push({ kind: "log_only", subjectIndex: s.index, codes: closers.map((c) => c.code), reason: "no topic to close" })
        continue
      }
      const t = createTopic(pool, item, s, insts, ctx, res)
      res.outcomes.push({ kind: "attach", subjectIndex: s.index, topicId: t.id, role: "origin", via: "new", created: true, reopened: false })
      continue
    }

    // Step 5 — matcher.
    const subjectAmounts = item.amounts.filter((a) => a.subjectIndex === s.index || a.subjectIndex === -1).map((a) => a.value)
    const decision = await ctx.matcher({
      itemId: item.itemId,
      itemDate: item.date,
      direction: item.direction,
      subject: {
        counterparty: s.counterparty || s.companyName || s.contactName || "",
        matter: s.matter,
        references: s.references.map((r) => ({ kind: r.kind, value: r.value })),
        products: s.products,
        amounts: subjectAmounts,
        codes: insts.map((i) => ({ code: i.code, labelRu: ctx.book.get(i.code)?.labelRu ?? i.code, evidence: i.evidence })),
      },
      candidates: cands.map((t) => ({
        id: t.id,
        title: t.title,
        matter: t.matter,
        family: t.family,
        leadCode: t.leadCode,
        status: t.status,
        references: t.references.map((r) => ({ kind: r.kind, value: r.value })),
        products: t.products,
        lastEvents: lastEvents(t, ctx.book),
      })),
    })
    res.matcherCalls++
    const picked = cands.find((t) => t.id === decision.topicId.trim()) ?? null
    const matcherInfo = { ...decision, candidates: cands.length }
    let target: TopicSnapshot | null = null
    let via: "matcher" | "matcher_bias" = "matcher"
    if (picked && decision.confidence === "high") target = picked
    else if (picked) {
      // R15: unsure → attach only when nothing speaks against it.
      const family = subjectFamily(insts, ctx.book)
      const ok =
        sameCounterparty(picked, s) &&
        !!family &&
        family === picked.family &&
        !referencesConflict(picked.references, s.references) &&
        !productsConflict(picked.products, s.products) &&
        !amountsConflict(topicAmounts(picked), subjectAmounts)
      if (ok) {
        target = picked
        via = "matcher_bias"
      }
    }
    if (target) {
      const { reopened } = attachToTopic(target, item, s, insts, role, ctx, res)
      res.outcomes.push({ kind: "attach", subjectIndex: s.index, topicId: target.id, role, via, created: false, reopened, matcher: matcherInfo })
      continue
    }
    if (closingOnly) {
      res.outcomes.push({ kind: "log_only", subjectIndex: s.index, codes: closers.map((c) => c.code), reason: "matcher found no topic to close" })
      continue
    }
    const t = createTopic(pool, item, s, insts, ctx, res)
    res.outcomes.push({ kind: "attach", subjectIndex: s.index, topicId: t.id, role: "origin", via: "new", created: true, reopened: false, matcher: matcherInfo })
  }

  // §6.4 — item without counted signals: context on a live topic.
  if (!anyTopical) {
    const byRef = item.subjects.flatMap((s) =>
      pool.filter((t) => t.status === "open" && s.references.length > 0 && sharesReference(t.references, s.references)).map((t) => ({ t, s })),
    )
    const seen = new Set<string>()
    for (const { t, s } of byRef) {
      if (seen.has(t.id)) continue
      seen.add(t.id)
      attachToTopic(t, item, { ...s }, item.instances, "context", ctx, res)
      res.outcomes.push({ kind: "attach", subjectIndex: s.index, topicId: t.id, role: "context", via: "context_reference", created: false, reopened: false })
    }
    if (seen.size === 0 && item.threadKey) {
      const onThread = sortByRecency(pool.filter((t) => t.status === "open" && t.items.some((l) => l.threadKey === item.threadKey)))[0]
      if (onThread) {
        const whole: ResolvedSubject = {
          index: -1,
          counterparty: "",
          counterpartyKey: "",
          matter: "",
          references: [],
          products: [],
          clientId: null,
          contactId: null,
          companyName: null,
          contactName: null,
        }
        attachToTopic(onThread, item, whole, item.instances, "context", ctx, res)
        res.outcomes.push({ kind: "attach", subjectIndex: -1, topicId: onThread.id, role: "context", via: "context_thread", created: false, reopened: false })
      }
    }
    if (res.outcomes.every((o) => o.kind !== "attach")) {
      res.status = "ignored"
      res.reason = "no counted signal, nothing to attach to"
    }
    return res
  }

  if (res.outcomes.every((o) => o.kind !== "attach") && res.outcomes.some((o) => o.kind === "log_only")) {
    res.status = "log_only"
    res.reason = res.outcomes
      .filter((o): o is Extract<SubjectOutcome, { kind: "log_only" }> => o.kind === "log_only")
      .map((o) => o.codes.join(","))
      .join("; ")
  }
  return res
}

/** Topics to load for an item: live + closed within this many days. */
export const POOL_LOOKBACK_DAYS = 180

export function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS)
}

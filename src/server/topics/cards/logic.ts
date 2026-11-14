// PURE logic of the topic card engine (spec topics/01 §9.1; 06 §7, §9).
// No DB, no I/O — unit-tested in logic.test.ts. The phase (phase.ts) loads
// rows, asks these functions what to do and writes the result.

import type { CardCategory, CardPriority } from "@/db/schema"
import type { TopicAttention } from "@/lib/topics/attention-types"
import {
  CARD_EVENT_GROUPS,
  CARD_TEXT_LIMITS,
  type CardEventGroup,
  type CardStatus,
  type CardWriterDecision,
  type TopicCardEvent,
  type TopicCardText,
} from "@/lib/topics/cards"

// ── Word limits ───────────────────────────────────────────────────────────

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean)

/** Collapse whitespace and drop wrapping quotes / list markers. */
export function cleanLine(s: unknown): string {
  if (typeof s !== "string") return ""
  return s
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:\d+[.)]\s*|[-–—•*]\s+)/, "")
    .replace(/^[«"“]+|[»"”]+$/g, "")
    .trim()
}

/**
 * Trim a line to at most `max` words. A cut line loses its trailing
 * punctuation (comma, dash, colon) so it does not end mid-clause with a mark.
 */
export function trimWords(s: unknown, max: number): string {
  const line = cleanLine(s)
  const w = words(line)
  if (w.length <= max) return line
  return w
    .slice(0, max)
    .join(" ")
    .replace(/[\s,;:—–-]+$/, "")
}

export function wordCount(s: string): number {
  return words(s).length
}

/** Card text after the §9.1 limits (headline / why now / what changed / ≤ 3 steps). */
export function sanitizeCardText(raw: Partial<Record<keyof TopicCardText, unknown>>): TopicCardText {
  const L = CARD_TEXT_LIMITS
  const steps = (Array.isArray(raw.steps) ? raw.steps : [])
    .map((s) => trimWords(s, L.stepWords))
    .filter((s) => s.length > 0)
    .slice(0, L.maxSteps)
  const whatChanged = trimWords(raw.whatChanged, L.whatChangedWords)
  return {
    headline: trimWords(raw.headline, L.headlineWords),
    whyNow: trimWords(raw.whyNow, L.whyNowWords),
    // The model writes «—» / «нет» when nothing changed: store empty.
    whatChanged: /^(?:—|-|нет|ничего|не изменилось\.?)$/i.test(whatChanged) ? "" : whatChanged,
    steps,
    taskTitle: trimWords(raw.taskTitle, L.taskTitleWords),
  }
}

/** A text the engine may store: headline, why now and ≥ 1 step present. */
export function isUsableCardText(t: TopicCardText): boolean {
  return t.headline.length > 0 && t.whyNow.length > 0 && t.steps.length > 0
}

// ── Placement → card lifecycle ────────────────────────────────────────────

/** Topic statuses that close the open card (spec §9.1, card lifecycle). */
export const CARD_CLOSING_TOPIC_STATUSES = [
  "resolved",
  "done",
  "dismissed",
  "merged",
  "expired",
  "archived",
] as const

/** hiddenReason values that only hide a topic for a while (the card stays). */
const TEMPORARY_HIDE = /^(snooz|dampen)/

export type TopicCardPlacement =
  /** The topic should have an open card. */
  | "card"
  /** No card now, but keep an existing open card (snooze / dampener). */
  | "keep"
  /** The open card must close (topic closed, band none, S0). */
  | "close"

/**
 * What the topic's placement means for its `topic` card. Card only when the
 * topic is open (dormant keeps), band ≥ low and the profile is not S0 / null
 * (spec §9.1). No attention yet → keep (the attention phase did not run).
 */
export function cardPlacement(topicStatus: string, attention: TopicAttention | null): TopicCardPlacement {
  if ((CARD_CLOSING_TOPIC_STATUSES as readonly string[]).includes(topicStatus)) return "close"
  if (!attention) return "keep"
  if (topicStatus !== "open") return "keep"
  if (attention.hiddenReason && TEMPORARY_HIDE.test(attention.hiddenReason)) return "keep"
  if (attention.hiddenReason) return "close"
  if (attention.band === "none" || !attention.profile || attention.profile === "S0") return "close"
  return "card"
}

/** Effective status of a card at read time: an open card past `expires_at` is expired. */
export function effectiveCardStatus(
  status: string | null,
  expiresAt: Date | string | null,
  now: Date,
): string | null {
  if (status !== "open" || !expiresAt) return status
  const at = expiresAt instanceof Date ? expiresAt : new Date(expiresAt)
  return Number.isFinite(at.getTime()) && at.getTime() <= now.getTime() ? "expired" : status
}

/** Display cycle key of a topic (06 §7.1): compared with the card's `cycle`. */
export function cycleKey(args: {
  attention: TopicAttention | null
  cycleStartedAt: Date | null
  firstSeenAt: Date
}): string {
  const a = args.attention?.cycleStartedAt ?? args.cycleStartedAt?.toISOString() ?? null
  return a ?? `first:${args.firstSeenAt.toISOString()}`
}

// ── Writer decision handling ──────────────────────────────────────────────

export type CardRef = { id: string; status: CardStatus | string }

/** What the store must do after the writer answered. */
export type CardAction =
  /** Insert a new open card; `supersedeId` = the open card that becomes `superseded`. */
  | { kind: "insert"; sinceLast: string | null; supersedeId: string | null; decision: CardWriterDecision | "FIRST" }
  /** Replace the text of the open card. */
  | { kind: "update"; cardId: string; sinceLast: string | null }
  /** Nothing to write except the cycle stamp. */
  | { kind: "noop" }
  /** Unusable writer output: write nothing, retry on the next run. */
  | { kind: "invalid"; reason: string }

/**
 * Turn the writer's answer into an action (spec §9.1 continuity):
 * - no card yet → always a new card (first placement);
 * - open card: UPDATE with the COPIED id → update; NEW or a wrong id →
 *   supersede + new card; NOOP → nothing (forced → UPDATE, R17);
 * - only a decided / closed card: UPDATE or NEW → a new open card (UPDATE is
 *   never applied to an accepted / rejected card); NOOP → nothing.
 */
export function resolveCardAction(args: {
  open: CardRef | null
  latest: CardRef | null
  decision: CardWriterDecision
  copiedCardId: string
  text: TopicCardText
  forced: boolean
  forceReason?: string | null
}): CardAction {
  const { open, latest, text, forced } = args
  let decision = args.decision
  if (forced && decision === "NOOP") decision = "UPDATE"
  const usable = isUsableCardText(text)
  const sinceLast = text.whatChanged || (forced && args.forceReason ? trimWords(args.forceReason, CARD_TEXT_LIMITS.whatChangedWords) : "") || null

  if (!open && !latest) {
    return usable ? { kind: "insert", sinceLast: null, supersedeId: null, decision: "FIRST" } : { kind: "invalid", reason: "empty text" }
  }
  if (decision === "NOOP") return { kind: "noop" }
  if (!usable) return { kind: "invalid", reason: "empty text" }
  if (open) {
    if (decision === "UPDATE" && args.copiedCardId.trim() === open.id) {
      return { kind: "update", cardId: open.id, sinceLast }
    }
    return { kind: "insert", sinceLast: decision === "UPDATE" ? sinceLast : null, supersedeId: open.id, decision: "NEW" }
  }
  return { kind: "insert", sinceLast: decision === "UPDATE" ? sinceLast : null, supersedeId: null, decision }
}

// ── Compact events (spec §9.1 Q24-12) ─────────────────────────────────────

export type EventCandidate = {
  code: string
  labelRu: string
  class: "risk" | "chance" | "fyi" | null
  family: string | null
  kind: string
  weight: number
  asksUs: boolean
  closing: boolean
  hasDeadline: boolean
  at: Date
  sourceItemId: string | null
  evidence: string
}

const DECISION_FAMILIES = new Set(["order", "contract", "meeting", "pitch"])
const TERMS_FAMILIES = new Set(["offer", "invoice", "delivery", "supplier"])

/** Group of one event: critical risks / urgent actions → decisions → terms → context. */
export function eventGroup(e: EventCandidate): CardEventGroup {
  if ((e.class === "risk" && e.weight >= 7) || (e.asksUs && (e.hasDeadline || e.weight >= 7))) return "urgent"
  if (e.closing || (e.family && DECISION_FAMILIES.has(e.family))) return "decision"
  if (e.family && TERMS_FAMILIES.has(e.family)) return "terms"
  return "context"
}

/** ≤ 3 events in the §9.1 order (newest first inside a group, one per code). */
export function compactEvents(candidates: readonly EventCandidate[], max = 3): TopicCardEvent[] {
  const newestByCode = new Map<string, EventCandidate>()
  for (const c of candidates) {
    const prev = newestByCode.get(c.code)
    if (!prev || c.at.getTime() > prev.at.getTime()) newestByCode.set(c.code, c)
  }
  const rank = (g: CardEventGroup) => CARD_EVENT_GROUPS.indexOf(g)
  return [...newestByCode.values()]
    .map((c) => ({ c, group: eventGroup(c) }))
    .sort(
      (a, b) =>
        rank(a.group) - rank(b.group) ||
        b.c.at.getTime() - a.c.at.getTime() ||
        b.c.weight - a.c.weight ||
        a.c.code.localeCompare(b.c.code),
    )
    .slice(0, max)
    .map(({ c, group }) => ({
      group,
      code: c.code,
      labelRu: c.labelRu,
      at: c.at.toISOString(),
      sourceItemId: c.sourceItemId,
      evidence: c.evidence.replace(/\s+/g, " ").trim().slice(0, 120),
    }))
}

// ── Old columns (expand phase) ────────────────────────────────────────────

export const ORDER_REQUESTED_CODE = "ORDER_REQUESTED"

/** Old `card.category` for a topic card (the existing UI reads it). */
export function cardCategoryFor(args: {
  leadCode: string | null
  class: "risk" | "chance" | "fyi" | null
  family: string | null
}): CardCategory {
  if (args.leadCode === ORDER_REQUESTED_CODE) return "new_order"
  switch (args.family) {
    case "complaint":
      return "support"
    case "market":
      return "business_info"
    case "competitor":
      return "data_intelligence"
    case "team":
    case "internal":
      return "colleagues_activity"
  }
  if (args.class === "risk") return "action_required"
  if (args.class === "chance") return "client_activity"
  return "business_info"
}

/** Old `card.priority` from the band (engine field, never the LLM). */
export function cardPriorityFor(band: string): CardPriority {
  return band === "high" || band === "very_high" || band === "critical" ? "high" : "normal"
}

/** `message.analysis` / `message.recommendation` in the shape the old UI shows. */
export function legacyMessageText(text: TopicCardText, sinceLast: string | null): {
  analysis: string
  recommendation: string
} {
  const parts = [text.headline, `Почему сейчас: ${text.whyNow}`]
  const changed = sinceLast ?? text.whatChanged
  if (changed) parts.push(`Что изменилось: ${changed}`)
  return {
    analysis: parts.join("\n\n"),
    recommendation: text.steps.map((s, i) => `${i + 1}. ${s}`).join("\n"),
  }
}

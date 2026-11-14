// In-memory model of the topic engine (spec topics/01 §6–§7; plan phase 3).
// PURE: no DB, no I/O. The store (topic-store.ts) loads these shapes from
// the DB, the pure resolver / lifecycle code works on them, the store
// writes the result back. Unit tests build them by hand.

import type { SignalClass, SignalKind, SignalScoreRule, SignalEffort } from "@/lib/signals/types"
import type { SignalCategoryRecord, EffectiveSignal } from "@/lib/signals/types"
import type { SignalDirection } from "@/lib/signals/extraction-types"
import type {
  ClientRelation,
  TopicEventType,
  TopicItemRole,
  TopicReference,
  TopicStatus,
  TopicSubState,
} from "@/lib/topics/types"

// ── Registry view ─────────────────────────────────────────────────────────

/** Code parameters the topic engine needs (effective for the org). */
export type CodeInfo = {
  code: string
  labelRu: string
  family: string | null
  kind: SignalKind
  scoreRule: SignalScoreRule
  class: SignalClass | null
  classByRelation: boolean
  asksUs: boolean
  effort: SignalEffort | null
  relevanceDays: number | null
  /** Effective closes_codes (pack override ?? base, R12). */
  closesCodes: string[]
  weight: number
  /** Registry order (dictionary-order tie-break). */
  order: number
}

export type CodeBook = Map<string, CodeInfo>

export function buildCodeBook(
  categories: readonly SignalCategoryRecord[],
  effective: readonly EffectiveSignal[],
): CodeBook {
  const eff = new Map(effective.map((e) => [e.code, e]))
  return new Map(
    categories.map((c, i) => {
      const e = eff.get(c.code)
      return [
        c.code,
        {
          code: c.code,
          labelRu: c.labelRu,
          family: c.family || null,
          kind: c.kind,
          scoreRule: c.scoreRule,
          class: c.class,
          classByRelation: c.classByRelation,
          asksUs: c.asksUs,
          effort: c.effort,
          relevanceDays: c.relevanceDays,
          closesCodes: e?.closesCodes ?? c.closesCodes,
          weight: e?.weight ?? c.weight,
          order: i,
        },
      ]
    }),
  )
}

/** A code that closes others (state / S1 or an event with closes_codes, §7.3). */
export function isClosingCode(info: CodeInfo | undefined): boolean {
  if (!info) return false
  return info.kind === "state" || info.scoreRule === "state" || info.closesCodes.length > 0
}

// ── Topic snapshot ────────────────────────────────────────────────────────

export type TopicInstance = {
  id: string
  code: string
  itemId: string | null
  /** Date of the item (the instance's time). */
  itemDate: Date
  confidence: "high" | "medium" | "low"
  counted: boolean
  scoreContrib: number
  /** ISO dates (YYYY-MM-DD) of deadlines of the instance's subject. */
  deadlines: string[]
  evidence?: string
}

export type TopicItemLink = {
  itemId: string
  subjectIndex: number
  role: TopicItemRole
  date: Date
  direction: SignalDirection
  threadKey: string | null
  references: TopicReference[]
  products: string[]
  amounts: number[]
}

export type TopicSnapshot = {
  id: string
  status: TopicStatus
  subState: TopicSubState
  clientId: string | null
  contactId: string | null
  counterpartyRaw: string
  /** Match key of counterpartyRaw (for topics with no client / contact). */
  counterpartyKey: string
  dealId: string | null
  title: string
  matter: string
  family: string | null
  leadCode: string | null
  class: SignalClass | null
  score: number
  band: string
  references: TopicReference[]
  products: string[]
  firstSeenAt: Date
  lastActivityAt: Date
  closedAt: Date | null
  closedReason: string | null
  relatedTopicId: string | null
  mergedIntoTopicId: string | null
  taxonomyVersion: number | null
  instances: TopicInstance[]
  items: TopicItemLink[]
  /** Set by the pure code when the snapshot changed (store writes it). */
  dirty?: boolean
  /** True for a topic created in this pass (store inserts it). */
  isNew?: boolean
}

// ── Item input ────────────────────────────────────────────────────────────

export type ResolvedSubject = {
  /** Subject index; -1 = synthetic subject of an item without subjects. */
  index: number
  counterparty: string
  counterpartyKey: string
  matter: string
  references: TopicReference[]
  products: string[]
  clientId: string | null
  contactId: string | null
  /** Display names for the title (resolved client / contact). */
  companyName: string | null
  contactName: string | null
}

export type ItemInstance = {
  id: string
  code: string
  confidence: "high" | "medium" | "low"
  counted: boolean
  scoreContrib: number
  /** -1 = all subjects of the item. */
  subjectIndex: number
  evidence: string
}

export type ItemInput = {
  itemId: string
  date: Date
  threadKey: string | null
  direction: SignalDirection
  subjects: ResolvedSubject[]
  instances: ItemInstance[]
  amounts: { value: number; subjectIndex: number }[]
  deadlines: { date: string; subjectIndex: number }[]
  taxonomyVersion: number | null
}

// ── Output ────────────────────────────────────────────────────────────────

export type TopicEventDraft = {
  topicId: string
  type: TopicEventType
  sourceItemId: string | null
  payload: Record<string, unknown>
}

export type RelationLookup = (clientId: string | null) => ClientRelation

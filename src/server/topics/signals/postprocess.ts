// Server post-processing of one extraction (spec topics/01 §5.4; attention
// spec 06 §4.1 step A). PURE: no DB, no I/O — the registry snapshot comes in
// as a ScoringContext, so the eval runner and unit tests use the same code
// as the hourly engine.
//
// Order (spec §5.4):
//   1. drop unknown / retired (mapped earlier) / non-active / process-only
//      codes, empty evidence, evidence not in the item's OWN text;
//   2. drop inbound_only codes on our own items, internal-only blocks on
//      external items;
//   3. date gates;
//   4. outranks (+ merges_into: the merged code is context only);
//   5. low confidence → stored, counts 0;  state codes → stored, count 0;
//   5a. same code + same subject → one instance (done in normalizeExtraction);
//   6. item score = max weight of counted codes (tie: risk > chance > fyi, then
//      registry order) + attributes clamped to [−2, +2] on that dominant
//      instance only (06 A2), floor 0; trend codes have the D4 ceiling (5);
//   7. band from the score (§5.5). Storing is the caller's job.

import type {
  EffectiveSignal,
  SignalAttributeRecord,
  SignalBlockRecord,
  SignalCategoryRecord,
  SignalRelationRecord,
} from "@/lib/signals/types"
import {
  scoreToBand,
  type SignalBand,
  type SignalDirection,
  type SignalDropReason,
  type SignalFacts,
  type SignalNotCountedReason,
  type SignalSubject,
} from "@/lib/signals/extraction-types"
import type { NormalizedExtraction } from "@/server/topics/prompt/extraction"
import { evidenceInText } from "./evidence"

/** D4 ceiling of trend codes (Q24-6): the top score of band «normal». */
export const TREND_SCORE_CEILING = 5
/** Weight of an `inherited` code before it has a topic (06 §4.1). */
export const INHERITED_FALLBACK_WEIGHT = 5
const ATTR_CLAMP = 2

/** Registry snapshot one batch scores with. Build once per batch. */
export type ScoringContext = {
  taxonomyVersion: number
  categories: Map<string, SignalCategoryRecord>
  /** Registry order (dictionary order tie-break). */
  order: Map<string, number>
  effective: Map<string, EffectiveSignal>
  blocks: Map<string, SignalBlockRecord>
  /** codeA outranks codeB → set of B per A. */
  outranks: Map<string, Set<string>>
  /** codeA merges into codeB → B per A. */
  mergesInto: Map<string, string>
  attributes: Map<string, SignalAttributeRecord>
  /** Retired code → successor. */
  successors: Map<string, string>
}

export function buildScoringContext(args: {
  taxonomyVersion: number
  categories: readonly SignalCategoryRecord[]
  effective: readonly EffectiveSignal[]
  blocks: readonly SignalBlockRecord[]
  relations: readonly SignalRelationRecord[]
  attributes: readonly SignalAttributeRecord[]
}): ScoringContext {
  const outranks = new Map<string, Set<string>>()
  const mergesInto = new Map<string, string>()
  for (const r of args.relations) {
    if (r.kind === "outranks") {
      const set = outranks.get(r.codeA) ?? new Set<string>()
      set.add(r.codeB)
      outranks.set(r.codeA, set)
    } else if (r.kind === "merges_into") {
      mergesInto.set(r.codeA, r.codeB)
    }
  }
  const successors = new Map<string, string>()
  for (const c of args.categories) {
    if (c.retiredAt && c.successorCode) successors.set(c.code, c.successorCode)
  }
  return {
    taxonomyVersion: args.taxonomyVersion,
    categories: new Map(args.categories.map((c) => [c.code, c])),
    order: new Map(args.categories.map((c, i) => [c.code, i])),
    effective: new Map(args.effective.map((e) => [e.code, e])),
    blocks: new Map(args.blocks.map((b) => [b.code, b])),
    outranks,
    mergesInto,
    attributes: new Map(args.attributes.map((a) => [a.code, a])),
    successors,
  }
}

// ── Direction (spec §5.3: cross-checked with org attribution) ─────────────

/**
 * Final direction. The parse-time attribution is deterministic evidence of
 * who wrote the item; the model only decides `internal` vs `outbound` for
 * our own items and judges items with unknown attribution. `allInternal`
 * (identity spec Q9: author AND every recipient are ours) makes `internal`
 * deterministic — it overrides the model.
 */
export function resolveDirection(
  modelDirection: SignalDirection | null,
  orgAttribution: string | null,
  allInternal = false,
): SignalDirection {
  if (allInternal && orgAttribution !== "external") return "internal"
  if (orgAttribution === "own_org") return modelDirection === "internal" ? "internal" : "outbound"
  if (orgAttribution === "external") return "inbound"
  return modelDirection ?? "inbound"
}

// ── Facts (sentinels → null, dates validated) ─────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function validIsoDate(v: string | null | undefined): string | null {
  if (!v) return null
  const s = v.trim()
  if (!ISO_DATE.test(s)) return null
  const d = new Date(`${s}T00:00:00Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s
}

const CURRENCIES = new Set(["RUB", "USD", "EUR", "CNY"])

export function normalizeFacts(f: NormalizedExtraction["facts"], subjectCount: number): SignalFacts {
  const subj = (i: number) => (Number.isInteger(i) && i >= 0 && i < subjectCount ? i : -1)
  return {
    amounts: f.amounts
      .filter((a) => Number.isFinite(a.value) && a.value > 0)
      .map((a) => {
        const cur = a.currency.trim().toUpperCase()
        return {
          value: a.value,
          currency: (CURRENCIES.has(cur) ? cur : "") as SignalFacts["amounts"][number]["currency"],
          scope: a.scope,
          vat: a.vat,
          evidence: a.evidence,
          subjectIndex: subj(a.subjectIndex),
        }
      }),
    deadlines: f.deadlines.flatMap((d) => {
      const date = validIsoDate(d.date)
      return date ? [{ ...d, date, subjectIndex: subj(d.subjectIndex) }] : []
    }),
    contractEndDate: validIsoDate(f.contractEndDate),
    proposedMeetingDate: validIsoDate(f.proposedMeetingDate),
    paymentTermsDays: Number.isInteger(f.paymentTermsDays) && f.paymentTermsDays >= 0 ? f.paymentTermsDays : null,
    creditLimitRequested:
      Number.isFinite(f.creditLimitRequested) && f.creditLimitRequested > 0 ? f.creditLimitRequested : null,
  }
}

export function normalizeSubjects(subjects: NormalizedExtraction["subjects"]): SignalSubject[] {
  return subjects.map((s, index) => ({
    index,
    counterparty: s.counterparty.trim(),
    onBehalfOf: s.onBehalfOf.trim(),
    matter: s.matter.trim(),
    references: s.references
      .map((r) => ({ kind: r.kind, value: r.value.trim() }))
      .filter((r) => r.value.length > 0),
    products: s.products.map((p) => p.trim()).filter(Boolean),
  }))
}

// ── Date gate (05 §3.4: { fact, test: within | beyond, settingKey, days }) ─

const DAY_MS = 86_400_000

export function passesDateGate(
  gate: Record<string, unknown> | null,
  facts: SignalFacts,
  itemDate: Date | null,
): boolean {
  if (!gate) return true
  const fact = typeof gate.fact === "string" ? gate.fact : null
  const test = gate.test === "beyond" ? "beyond" : "within"
  const days = typeof gate.days === "number" && gate.days >= 0 ? gate.days : null
  if (!fact || days === null || !itemDate) return false
  const raw = (facts as Record<string, unknown>)[fact]
  const date = typeof raw === "string" ? validIsoDate(raw) : null
  if (!date) return false
  const factMs = Date.parse(`${date}T00:00:00Z`)
  const itemDay = Date.parse(`${itemDate.toISOString().slice(0, 10)}T00:00:00Z`)
  const delta = (factMs - itemDay) / DAY_MS
  return test === "within" ? delta >= 0 && delta <= days : delta > days
}

// ── Scoring ───────────────────────────────────────────────────────────────

export type InstanceDraft = {
  code: string
  evidence: string
  confidence: "high" | "medium" | "low"
  subjectIndex: number
  counted: boolean
  notCountedReason: SignalNotCountedReason | null
  /** Instance score (06 §4.1): weight; dominant instance incl. attributes. */
  scoreContrib: number
}

export type PostprocessResult = {
  direction: SignalDirection
  instances: InstanceDraft[]
  dropped: { code: string; reason: SignalDropReason; evidence: string }[]
  subjects: SignalSubject[]
  facts: SignalFacts
  attributes: { code: string; evidence: string; weight: number }[]
  attrAdj: number
  dominantCode: string | null
  score: number
  band: SignalBand
}

const CLASS_RANK: Record<string, number> = { risk: 3, chance: 2, fyi: 1 }

function excerpt(s: string, n = 200): string {
  const t = s.replace(/\s+/g, " ").trim()
  return t.length > n ? `${t.slice(0, n)}…` : t
}

export function postprocessExtraction(
  out: NormalizedExtraction,
  ctx: ScoringContext,
  item: {
    /** Full item text the model saw (evidence must be in it). */
    text: string
    /** The author's own text, without quoted history (null = same as text). */
    ownText: string | null
    date: Date | null
    orgAttribution: string | null
    /** Identity spec Q9: every participant is ours → direction `internal`. */
    allInternal?: boolean
  },
): PostprocessResult {
  const direction = resolveDirection(out.direction ?? null, item.orgAttribution, item.allInternal === true)
  const subjects = normalizeSubjects(out.subjects)
  const facts = normalizeFacts(out.facts, subjects.length)
  const dropped: PostprocessResult["dropped"] = out.unknownCodes.map((code) => ({
    code,
    reason: "unknown_code" as const,
    evidence: "",
  }))

  // Rules 1–3: keep or drop each returned code.
  const kept: InstanceDraft[] = []
  for (const s of out.signals) {
    const drop = (reason: SignalDropReason) =>
      dropped.push({ code: s.code, reason, evidence: excerpt(s.evidence) })
    const cat = ctx.categories.get(s.code)
    const eff = ctx.effective.get(s.code)
    if (!cat || cat.retiredAt) {
      drop("unknown_code")
      continue
    }
    if (cat.emittedBy === "process") {
      drop("process_code")
      continue
    }
    if (!eff?.active) {
      drop("not_active")
      continue
    }
    if (!s.evidence.trim()) {
      drop("empty_evidence")
      continue
    }
    if (!s.evidenceFound) {
      drop("evidence_not_found")
      continue
    }
    if (item.ownText !== null && item.ownText !== item.text && !evidenceInText(s.evidence, item.ownText)) {
      drop("evidence_in_quote")
      continue
    }
    if (cat.inboundOnly && direction === "outbound") {
      drop("inbound_only")
      continue
    }
    if (ctx.blocks.get(cat.blockCode)?.internalOnly && direction !== "internal") {
      drop("internal_only_block")
      continue
    }
    if (!passesDateGate(cat.dateGate, facts, item.date)) {
      drop("date_gate")
      continue
    }
    const subjectIndex =
      Number.isInteger(s.subjectIndex) && s.subjectIndex >= 0 && s.subjectIndex < subjects.length
        ? s.subjectIndex
        : -1
    kept.push({
      code: s.code,
      evidence: s.evidence.trim(),
      confidence: s.confidence,
      subjectIndex,
      counted: true,
      notCountedReason: null,
      scoreContrib: 0,
    })
  }

  // Rule 4: outranks / merges_into on the same item.
  const present = new Set(kept.map((k) => k.code))
  for (const k of kept) {
    for (const a of present) {
      if (a !== k.code && ctx.outranks.get(a)?.has(k.code)) {
        k.counted = false
        k.notCountedReason = "outranked"
        break
      }
    }
    const into = ctx.mergesInto.get(k.code)
    if (k.counted && into && present.has(into)) {
      k.counted = false
      k.notCountedReason = "merged"
    }
  }

  // Rule 5: low confidence and state codes are stored but count 0.
  for (const k of kept) {
    const cat = ctx.categories.get(k.code)!
    if (cat.scoreRule === "state" || cat.kind === "state") {
      k.counted = false
      k.notCountedReason = "state"
    } else if (k.counted && k.confidence === "low") {
      k.counted = false
      k.notCountedReason = "low_confidence"
    }
    if (k.counted) {
      const w = ctx.effective.get(k.code)?.weight ?? cat.weight
      k.scoreContrib = cat.scoreRule === "inherited" && w <= 0 ? INHERITED_FALLBACK_WEIGHT : w
    }
  }

  // Attributes: one per group (normalizeExtraction), weights summed, clamped.
  const attributes = out.attributes.flatMap((a) => {
    const rec = ctx.attributes.get(a.code.trim().toUpperCase())
    return rec ? [{ code: rec.code, evidence: a.evidence, weight: rec.weight }] : []
  })
  const attrAdj = Math.max(
    -ATTR_CLAMP,
    Math.min(ATTR_CLAMP, attributes.reduce((sum, a) => sum + a.weight, 0)),
  )

  // Rule 6: dominant instance + item score.
  const counted = kept.filter((k) => k.counted)
  let dominant: InstanceDraft | null = null
  for (const k of counted) {
    if (!dominant) {
      dominant = k
      continue
    }
    const ck = ctx.categories.get(k.code)!
    const cd = ctx.categories.get(dominant.code)!
    const better =
      k.scoreContrib - dominant.scoreContrib ||
      (CLASS_RANK[ck.class ?? ""] ?? 0) - (CLASS_RANK[cd.class ?? ""] ?? 0) ||
      (ctx.order.get(dominant.code) ?? 0) - (ctx.order.get(k.code) ?? 0)
    if (better > 0) dominant = k
  }
  let score = 0
  if (dominant) {
    score = Math.max(0, dominant.scoreContrib + attrAdj)
    if (ctx.categories.get(dominant.code)?.kind === "trend") score = Math.min(score, TREND_SCORE_CEILING)
    dominant.scoreContrib = score
  }

  return {
    direction,
    instances: kept,
    dropped,
    subjects,
    facts,
    attributes,
    attrAdj,
    dominantCode: dominant?.code ?? null,
    score,
    band: scoreToBand(score),
  }
}

// Eval metrics (plan topics/03 phase 2 task 8; spec topics/01 §12). PURE:
// no DB, no I/O — the runner loads rows and registry info and passes them in,
// so unit tests cover exactly what the admin report shows.
//
// Two prediction views per item:
//   raw  = codes the model returned with high / medium confidence (the
//          phase 0 spike metric; low confidence = not predicted);
//   post = codes the engine KEEPS after server post-processing (spec §5.4):
//          instances that are counted, or state codes (notCountedReason
//          "state"). Low confidence, outranked, merged and dropped codes are
//          not predicted.
// Expected codes come from the golden item's reviewed `expected` answer
// (status `reviewed`; `noSignal: true` = no code expected). Expected codes
// outside the run's prompt set are ignored, so a live run is not charged for
// review-only codes.
//
// Quality gate (plan phase 2 exit, spec §12): on REAL reviewed items, with
// post-processed predictions —
//   * precision ≥ EVAL_GATE.precisionMin for every gate code (effective
//     display profile P6 / P8, or no explicit profile and weight ≥
//     EVAL_GATE.minWeightNoProfile — band high or above, whose default
//     profile is P6 / P8, spec §5.5) with at least
//     EVAL_GATE.minExpectedPerCode expected occurrences; fewer → «мало
//     данных», the code is not judged. A judged code that was never
//     predicted (precision undefined) fails: it misses every occurrence;
//   * overall recall ≥ EVAL_GATE.recallMin (all codes of the set; fewer than
//     minExpectedPerCode expected occurrences in total → «мало данных»).
// Verdict: fail if any judged part fails; else insufficient_data if the
// recall is not judged or no gate code is judged; else pass.

import type { SignalBand, SignalDirection, SignalDropReason, SignalNotCountedReason } from "@/lib/signals/extraction-types"

/** Go-live thresholds of the signal extraction (one place; stored with each verdict). */
export const EVAL_GATE = {
  precisionMin: 0.85,
  recallMin: 0.7,
  /** Effective display profiles whose codes are judged on precision. */
  gateProfiles: ["P6", "P8"] as readonly string[],
  /** Codes with no explicit profile are judged from this weight (band high, §5.5). */
  minWeightNoProfile: 6,
  /** Fewer expected occurrences (real items) → the code / recall is not judged. */
  minExpectedPerCode: 5,
} as const

export type EvalGateThresholds = typeof EVAL_GATE

export const EVAL_BUCKETS = ["all", "real", "synthetic"] as const
export type EvalBucket = (typeof EVAL_BUCKETS)[number]

export type PrStats = {
  items: number
  tp: number
  fp: number
  fn: number
  precision: number | null
  recall: number | null
  f1: number | null
}

export const ratio = (a: number, b: number) => (b > 0 ? a / b : null)

export function prStats(items: number, tp: number, fp: number, fn: number): PrStats {
  const precision = ratio(tp, tp + fp)
  const recall = ratio(tp, tp + fn)
  const f1 =
    precision !== null && recall !== null && precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : tp + fp + fn > 0
        ? 0
        : null
  return { items, tp, fp, fn, precision, recall, f1 }
}

export function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[idx]
}

// ── Display profile ───────────────────────────────────────────────────────

/** Band default profile from a weight (spec §5.5). */
export function profileForWeight(weight: number | null): string | null {
  if (weight === null || weight <= 0) return null
  if (weight <= 3) return "W1"
  if (weight <= 5) return "D4"
  if (weight <= 7) return "P6"
  return "P8"
}

/** Explicit profile, else the band default of the weight. */
export function effectiveDisplayProfile(profile: string | null, weight: number | null): string | null {
  return profile ?? profileForWeight(weight)
}

export function isGateCode(profile: string | null, weight: number | null): boolean {
  if (profile) return EVAL_GATE.gateProfiles.includes(profile)
  return weight !== null && weight >= EVAL_GATE.minWeightNoProfile
}

// ── Stored result shapes (topics_eval_result.output) ──────────────────────

/** Post-processed part of one result (`output.post`; absent on pre-phase-2 rows). */
export type EvalPostStored = {
  taxonomyVersion: number
  direction: SignalDirection
  score: number
  band: SignalBand
  dominantCode: string | null
  attrAdj: number
  instances: {
    code: string
    evidence: string
    confidence: "high" | "medium" | "low"
    subjectIndex: number
    counted: boolean
    notCountedReason: SignalNotCountedReason | null
    scoreContrib: number
  }[]
  dropped: { code: string; reason: SignalDropReason; evidence: string }[]
}

type RawSignal = { code?: unknown; confidence?: unknown; evidenceFound?: unknown }

/** Raw model codes of a stored output: predicted (high / medium) and low. */
export function rawPrediction(output: unknown): { predicted: Set<string>; low: Set<string> } {
  const o = (output ?? {}) as { signals?: unknown }
  const sigs = Array.isArray(o.signals) ? (o.signals as RawSignal[]) : []
  const predicted = new Set<string>()
  const low = new Set<string>()
  for (const s of sigs) {
    if (typeof s?.code !== "string") continue
    if (s.confidence === "low") low.add(s.code)
    else predicted.add(s.code)
  }
  // A code with one high and one low instance (two subjects) is predicted.
  for (const c of predicted) low.delete(c)
  return { predicted, low }
}

/** Codes the engine keeps (counted or state); null when the row has no post part. */
export function postPrediction(output: unknown): Set<string> | null {
  const post = (output as { post?: unknown } | null)?.post as Partial<EvalPostStored> | undefined
  if (!post || !Array.isArray(post.instances)) return null
  const kept = new Set<string>()
  for (const i of post.instances) {
    if (i.counted || i.notCountedReason === "state") kept.add(i.code)
  }
  return kept
}

/**
 * Expected codes of a golden item, or null when it is not judged (not
 * reviewed, or no usable answer). `noSignal: true` → empty set.
 */
export function parseExpected(
  expected: unknown,
  status: string,
  inSet: ReadonlySet<string> | null,
): Set<string> | null {
  if (status !== "reviewed") return null
  if (!expected || typeof expected !== "object") return null
  const e = expected as { codes?: unknown; noSignal?: unknown }
  if (e.noSignal === true) return new Set()
  if (!Array.isArray(e.codes)) return null
  const out = new Set<string>()
  for (const c of e.codes as { code?: unknown }[]) {
    const code = typeof c?.code === "string" ? c.code.trim() : ""
    if (code && (!inSet || inSet.has(code))) out.add(code)
  }
  return out
}

// ── Golden-set metrics ────────────────────────────────────────────────────

export type MetricItem = {
  id: string
  synthetic: boolean
  ok: boolean
  /** null = not judged. */
  expected: Set<string> | null
  raw: { predicted: Set<string>; low: Set<string> } | null
  /** null = no post-processed part (legacy row) or failed item. */
  post: Set<string> | null
}

export type CodeInfo = {
  labelRu: string
  /** on = live prompt, review = offline only, off; null = not in the org's registry. */
  status: "on" | "review" | "off" | null
  weight: number | null
  /** Explicit effective display profile of the org. */
  profile: string | null
}

export type EvalCodeStats = { raw: PrStats; post: PrStats }

export type EvalCodeRow = CodeInfo & {
  code: string
  /** Band default when there is no explicit profile. */
  effectiveProfile: string | null
  gateCode: boolean
  /** Items (ok) where the code was predicted raw (high / medium). */
  found: number
  /** Items where it came only with low confidence. */
  foundLow: number
  /** Items where the engine kept it (post). */
  kept: number
  stats: Record<EvalBucket, EvalCodeStats>
}

export type EvalMismatch = {
  goldenItemId: string
  synthetic: boolean
  expected: string[]
  predicted: string[]
  kept: string[] | null
}

export type EvalMetrics = {
  overall: Record<"raw" | "post", Record<EvalBucket, PrStats>>
  /** Ok items with a post-processed part (older rows have none). */
  postItems: number
  codes: EvalCodeRow[]
  mismatches: EvalMismatch[]
}

type Counter = { items: number; tp: number; fp: number; fn: number }
const zero = (): Counter => ({ items: 0, tp: 0, fp: 0, fn: 0 })
const toPr = (c: Counter) => prStats(c.items, c.tp, c.fp, c.fn)

function score(expected: Set<string>, predicted: Set<string>) {
  let tp = 0
  let fn = 0
  let fp = 0
  for (const c of expected) {
    if (predicted.has(c)) tp++
    else fn++
  }
  for (const c of predicted) if (!expected.has(c)) fp++
  return { tp, fp, fn }
}

export function computeEvalMetrics(
  items: readonly MetricItem[],
  info: (code: string) => CodeInfo,
  opts: { mismatchLimit?: number } = {},
): EvalMetrics {
  const mismatchLimit = opts.mismatchLimit ?? 50
  const overall = {
    raw: { all: zero(), real: zero(), synthetic: zero() },
    post: { all: zero(), real: zero(), synthetic: zero() },
  }
  type CodeAcc = {
    found: number
    foundLow: number
    kept: number
    stats: Record<EvalBucket, { raw: Counter; post: Counter }>
  }
  const perCode = new Map<string, CodeAcc>()
  const acc = (code: string): CodeAcc => {
    let a = perCode.get(code)
    if (!a) {
      a = {
        found: 0,
        foundLow: 0,
        kept: 0,
        stats: {
          all: { raw: zero(), post: zero() },
          real: { raw: zero(), post: zero() },
          synthetic: { raw: zero(), post: zero() },
        },
      }
      perCode.set(code, a)
    }
    return a
  }
  let postItems = 0
  const mismatches: EvalMismatch[] = []

  for (const it of items) {
    if (!it.ok || !it.raw) continue
    for (const c of it.raw.predicted) acc(c).found++
    for (const c of it.raw.low) acc(c).foundLow++
    if (it.post) {
      postItems++
      for (const c of it.post) acc(c).kept++
    }
    if (!it.expected) continue
    const buckets: EvalBucket[] = ["all", it.synthetic ? "synthetic" : "real"]
    const views: ["raw" | "post", Set<string> | null][] = [
      ["raw", it.raw.predicted],
      ["post", it.post],
    ]
    for (const [view, predicted] of views) {
      if (!predicted) continue
      const s = score(it.expected, predicted)
      for (const b of buckets) {
        const o = overall[view][b]
        o.items++
        o.tp += s.tp
        o.fp += s.fp
        o.fn += s.fn
      }
      for (const code of new Set([...it.expected, ...predicted])) {
        const inExp = it.expected.has(code)
        const inPred = predicted.has(code)
        for (const b of buckets) {
          const c = acc(code).stats[b][view]
          c.items++
          if (inExp && inPred) c.tp++
          else if (inExp) c.fn++
          else c.fp++
        }
      }
    }
    const rawS = score(it.expected, it.raw.predicted)
    const postS = it.post ? score(it.expected, it.post) : null
    const bad = rawS.fp + rawS.fn > 0 || (postS !== null && postS.fp + postS.fn > 0)
    if (bad && mismatches.length < mismatchLimit) {
      mismatches.push({
        goldenItemId: it.id,
        synthetic: it.synthetic,
        expected: [...it.expected].sort(),
        predicted: [...it.raw.predicted].sort(),
        kept: it.post ? [...it.post].sort() : null,
      })
    }
  }

  const codes: EvalCodeRow[] = [...perCode.entries()].map(([code, a]) => {
    const i = info(code)
    return {
      code,
      ...i,
      effectiveProfile: effectiveDisplayProfile(i.profile, i.weight),
      gateCode: isGateCode(i.profile, i.weight),
      found: a.found,
      foundLow: a.foundLow,
      kept: a.kept,
      stats: {
        all: { raw: toPr(a.stats.all.raw), post: toPr(a.stats.all.post) },
        real: { raw: toPr(a.stats.real.raw), post: toPr(a.stats.real.post) },
        synthetic: { raw: toPr(a.stats.synthetic.raw), post: toPr(a.stats.synthetic.post) },
      },
    }
  })
  const weightOf = (r: EvalCodeRow) =>
    r.found + r.kept + r.stats.all.raw.tp + r.stats.all.raw.fn
  codes.sort((a, b) => weightOf(b) - weightOf(a) || a.code.localeCompare(b.code))

  return {
    overall: {
      raw: { all: toPr(overall.raw.all), real: toPr(overall.raw.real), synthetic: toPr(overall.raw.synthetic) },
      post: { all: toPr(overall.post.all), real: toPr(overall.post.real), synthetic: toPr(overall.post.synthetic) },
    },
    postItems,
    codes,
    mismatches,
  }
}

// ── Quality gate ──────────────────────────────────────────────────────────

export type GateStatus = "pass" | "fail" | "insufficient"
export type GateVerdict = "pass" | "fail" | "insufficient_data"

export type EvalGateCode = {
  code: string
  labelRu: string
  profile: string | null
  effectiveProfile: string | null
  weight: number | null
  expected: number
  tp: number
  fp: number
  precision: number | null
  status: GateStatus
}

export type EvalGate = {
  verdict: GateVerdict
  thresholds: EvalGateThresholds
  /** Real reviewed items with post-processed results. */
  realItems: number
  recall: { value: number | null; expected: number; status: GateStatus }
  codes: EvalGateCode[]
  counts: { pass: number; fail: number; insufficient: number }
  /** Short Russian explanation for the UI. */
  reasons: string[]
}

/**
 * Gate verdict from post-processed REAL metrics. `setCodes` = codes of the
 * run's prompt set (gate codes that never occurred still show «мало данных»).
 */
export function evalGateVerdict(
  metrics: Pick<EvalMetrics, "overall" | "codes">,
  setCodes: readonly string[],
  info: (code: string) => CodeInfo,
  thresholds: EvalGateThresholds = EVAL_GATE,
): EvalGate {
  const rows = new Map(metrics.codes.map((c) => [c.code, c]))
  const codes: EvalGateCode[] = []
  for (const code of new Set([...setCodes, ...metrics.codes.map((c) => c.code)])) {
    const row = rows.get(code)
    const i = row ?? { ...info(code) }
    const gate = row ? row.gateCode : isGateCode(i.profile, i.weight)
    if (!gate) continue
    const s = row?.stats.real.post
    const tp = s?.tp ?? 0
    const fp = s?.fp ?? 0
    const fn = s?.fn ?? 0
    const expected = tp + fn
    const precision = ratio(tp, tp + fp)
    const status: GateStatus =
      expected < thresholds.minExpectedPerCode
        ? "insufficient"
        : precision !== null && precision >= thresholds.precisionMin
          ? "pass"
          : "fail"
    codes.push({
      code,
      labelRu: i.labelRu,
      profile: i.profile,
      effectiveProfile: effectiveDisplayProfile(i.profile, i.weight),
      weight: i.weight,
      expected,
      tp,
      fp,
      precision,
      status,
    })
  }
  const order: Record<GateStatus, number> = { fail: 0, pass: 1, insufficient: 2 }
  codes.sort((a, b) => order[a.status] - order[b.status] || b.expected - a.expected || a.code.localeCompare(b.code))

  const real = metrics.overall.post.real
  const expectedTotal = real.tp + real.fn
  const recallStatus: GateStatus =
    expectedTotal < thresholds.minExpectedPerCode
      ? "insufficient"
      : real.recall !== null && real.recall >= thresholds.recallMin
        ? "pass"
        : "fail"
  const counts = {
    pass: codes.filter((c) => c.status === "pass").length,
    fail: codes.filter((c) => c.status === "fail").length,
    insufficient: codes.filter((c) => c.status === "insufficient").length,
  }

  const reasons: string[] = []
  const pct = (v: number) => `${Math.round(v * 100)} %`
  if (recallStatus === "fail") reasons.push(`Полнота ${pct(real.recall ?? 0)} < ${pct(thresholds.recallMin)}`)
  if (recallStatus === "insufficient")
    reasons.push(`Мало данных для полноты: ожидаемых кодов ${expectedTotal} < ${thresholds.minExpectedPerCode}`)
  if (counts.fail > 0)
    reasons.push(
      `Точность ниже ${pct(thresholds.precisionMin)}: ${codes
        .filter((c) => c.status === "fail")
        .map((c) => c.code)
        .join(", ")}`,
    )
  if (counts.pass + counts.fail === 0) reasons.push("Ни у одного кода P6 / P8 нет достаточно ожидаемых случаев")
  if (counts.insufficient > 0 && counts.pass + counts.fail > 0)
    reasons.push(`Не оценено (мало данных): ${counts.insufficient} кодов P6 / P8`)

  const verdict: GateVerdict =
    recallStatus === "fail" || counts.fail > 0
      ? "fail"
      : recallStatus === "insufficient" || counts.pass === 0
        ? "insufficient_data"
        : "pass"

  return {
    verdict,
    thresholds,
    realItems: real.items,
    recall: { value: real.recall, expected: expectedTotal, status: recallStatus },
    codes,
    counts,
    reasons,
  }
}

// ── Offline review sample (R6) ────────────────────────────────────────────

/** One sampled item (kept in topics_eval_run.metrics.sample.items[itemId]). */
export type SampleItemResult = {
  itemId: string
  ok: boolean
  error?: string | null
  /** Gate that stopped the item before the LLM (skip reason or deterministic gate). */
  gated?: string | null
  provider: string | null
  subject: string | null
  date: string | null
  durationMs: number
  model: string | null
  taxonomyVersion: number | null
  score: number | null
  band: SignalBand | null
  instances: EvalPostStored["instances"]
  dropped: EvalPostStored["dropped"]
  at: string
}

export type SampleExample = {
  itemId: string
  subject: string | null
  date: string | null
  evidence: string
  confidence: string
  counted: boolean
  notCountedReason: string | null
}

export type SampleCodeRow = {
  code: string
  labelRu: string
  weight: number | null
  profile: string | null
  effectiveProfile: string | null
  /** Items where the model returned the code (kept as an instance). */
  items: number
  /** Items where it counted for the score. */
  counted: number
  /** Items where it came only with low confidence. */
  low: number
  /** Items where post-processing dropped it (evidence, direction, date …). */
  dropped: number
  examples: SampleExample[]
}

export type SampleSummary = {
  items: { total: number; ok: number; failed: number; gated: number; withSignals: number }
  /** Review-only codes of the run (all, also those that never fired). */
  reviewCodes: SampleCodeRow[]
  /** Live codes that fired, for context (no examples). */
  liveCodes: { code: string; labelRu: string; items: number; counted: number }[]
  gatedBy: Record<string, number>
  failed: { itemId: string; error: string }[]
}

export function summarizeSample(
  items: readonly SampleItemResult[],
  reviewCodes: readonly string[],
  info: (code: string) => CodeInfo,
  opts: { examplesPerCode?: number } = {},
): SampleSummary {
  const maxEx = opts.examplesPerCode ?? 10
  const review = new Set(reviewCodes)
  const rows = new Map<string, SampleCodeRow>()
  const row = (code: string): SampleCodeRow => {
    let r = rows.get(code)
    if (!r) {
      const i = info(code)
      r = {
        code,
        labelRu: i.labelRu,
        weight: i.weight,
        profile: i.profile,
        effectiveProfile: effectiveDisplayProfile(i.profile, i.weight),
        items: 0,
        counted: 0,
        low: 0,
        dropped: 0,
        examples: [],
      }
      rows.set(code, r)
    }
    return r
  }
  for (const c of reviewCodes) row(c)

  const gatedBy: Record<string, number> = {}
  const failed: SampleSummary["failed"] = []
  let ok = 0
  let gated = 0
  let withSignals = 0
  const sorted = [...items].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.itemId.localeCompare(b.itemId))
  for (const it of sorted) {
    if (!it.ok) {
      failed.push({ itemId: it.itemId, error: it.error ?? "" })
      continue
    }
    ok++
    if (it.gated) {
      gated++
      const key = it.gated.split(":")[0]
      gatedBy[key] = (gatedBy[key] ?? 0) + 1
    }
    if (it.instances.length > 0) withSignals++
    const seen = new Set<string>()
    for (const inst of it.instances) {
      const r = row(inst.code)
      if (!seen.has(inst.code)) {
        seen.add(inst.code)
        r.items++
        if (it.instances.some((x) => x.code === inst.code && x.counted)) r.counted++
        else if (it.instances.every((x) => x.code !== inst.code || x.confidence === "low")) r.low++
      }
      if (review.has(inst.code) && r.examples.length < maxEx) {
        r.examples.push({
          itemId: it.itemId,
          subject: it.subject,
          date: it.date,
          evidence: inst.evidence,
          confidence: inst.confidence,
          counted: inst.counted,
          notCountedReason: inst.notCountedReason,
        })
      }
    }
    const droppedSeen = new Set<string>()
    for (const d of it.dropped) {
      if (droppedSeen.has(d.code) || seen.has(d.code)) continue
      droppedSeen.add(d.code)
      if (review.has(d.code)) row(d.code).dropped++
    }
  }

  const reviewRows = [...rows.values()]
    .filter((r) => review.has(r.code))
    .sort((a, b) => b.items - a.items || b.dropped - a.dropped || a.code.localeCompare(b.code))
  const liveCodes = [...rows.values()]
    .filter((r) => !review.has(r.code) && r.items > 0)
    .map((r) => ({ code: r.code, labelRu: r.labelRu, items: r.items, counted: r.counted }))
    .sort((a, b) => b.items - a.items || a.code.localeCompare(b.code))

  return {
    items: { total: items.length, ok, failed: failed.length, gated, withSignals },
    reviewCodes: reviewRows,
    liveCodes,
    gatedBy,
    failed,
  }
}

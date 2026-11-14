import { describe, expect, it } from "vitest"
import {
  computeEvalMetrics,
  EVAL_GATE,
  evalGateVerdict,
  effectiveDisplayProfile,
  isGateCode,
  parseExpected,
  postPrediction,
  prStats,
  rawPrediction,
  summarizeSample,
  type CodeInfo,
  type MetricItem,
  type SampleItemResult,
} from "./metrics"

const INFO: Record<string, CodeInfo> = {
  HOT: { labelRu: "Горячий", status: "on", weight: 8, profile: null }, // band → P8
  P6C: { labelRu: "P6 явный", status: "on", weight: 3, profile: "P6" },
  MID: { labelRu: "Средний", status: "on", weight: 5, profile: null }, // D4
  QUIET: { labelRu: "Тихий", status: "on", weight: 9, profile: "W1" }, // explicit wins
  REV: { labelRu: "На проверке", status: "review", weight: 6, profile: null },
}
const info = (code: string): CodeInfo => INFO[code] ?? { labelRu: code, status: null, weight: null, profile: null }

const set = (...c: string[]) => new Set(c)

function item(
  id: string,
  expected: string[] | null,
  raw: string[],
  post: string[] | null,
  opts: { synthetic?: boolean; low?: string[]; ok?: boolean } = {},
): MetricItem {
  return {
    id,
    synthetic: opts.synthetic ?? false,
    ok: opts.ok ?? true,
    expected: expected ? new Set(expected) : null,
    raw: { predicted: new Set(raw), low: new Set(opts.low ?? []) },
    post: post ? new Set(post) : null,
  }
}

describe("prStats", () => {
  it("computes precision, recall and F1", () => {
    const s = prStats(4, 3, 1, 2)
    expect(s.precision).toBeCloseTo(0.75)
    expect(s.recall).toBeCloseTo(0.6)
    expect(s.f1).toBeCloseTo((2 * 0.75 * 0.6) / 1.35)
  })
  it("null when nothing to measure, 0 F1 when all wrong", () => {
    expect(prStats(0, 0, 0, 0)).toMatchObject({ precision: null, recall: null, f1: null })
    expect(prStats(1, 0, 2, 0)).toMatchObject({ precision: 0, recall: null, f1: 0 })
  })
})

describe("display profile and gate codes", () => {
  it("uses the band default without an explicit profile", () => {
    expect(effectiveDisplayProfile(null, 2)).toBe("W1")
    expect(effectiveDisplayProfile(null, 5)).toBe("D4")
    expect(effectiveDisplayProfile(null, 6)).toBe("P6")
    expect(effectiveDisplayProfile(null, 10)).toBe("P8")
    expect(effectiveDisplayProfile("S1", 10)).toBe("S1")
  })
  it("judges P6 / P8 profiles, or weight ≥ 6 without a profile", () => {
    expect(isGateCode("P6", 1)).toBe(true)
    expect(isGateCode("P8", null)).toBe(true)
    expect(isGateCode("W1", 9)).toBe(false)
    expect(isGateCode(null, EVAL_GATE.minWeightNoProfile)).toBe(true)
    expect(isGateCode(null, 5)).toBe(false)
  })
})

describe("stored output parsing", () => {
  it("raw: low confidence is not predicted, unless the code also came high", () => {
    const r = rawPrediction({
      signals: [
        { code: "A", confidence: "high" },
        { code: "B", confidence: "low" },
        { code: "C", confidence: "low" },
        { code: "C", confidence: "medium" },
      ],
    })
    expect([...r.predicted].sort()).toEqual(["A", "C"])
    expect([...r.low]).toEqual(["B"])
  })
  it("post: counted or state are kept; low / outranked are not; legacy row → null", () => {
    const kept = postPrediction({
      post: {
        instances: [
          { code: "A", counted: true, notCountedReason: null },
          { code: "S", counted: false, notCountedReason: "state" },
          { code: "L", counted: false, notCountedReason: "low_confidence" },
          { code: "O", counted: false, notCountedReason: "outranked" },
        ],
      },
    })
    expect([...kept!].sort()).toEqual(["A", "S"])
    expect(postPrediction({ signals: [] })).toBeNull()
    expect(postPrediction(null)).toBeNull()
  })
  it("expected: reviewed only, noSignal = empty, codes outside the set ignored", () => {
    const inSet = set("A", "B")
    expect(parseExpected({ codes: [{ code: "A" }] }, "pre_annotated", inSet)).toBeNull()
    expect(parseExpected(null, "reviewed", inSet)).toBeNull()
    expect([...parseExpected({ noSignal: true, codes: [{ code: "A" }] }, "reviewed", inSet)!]).toEqual([])
    expect([...parseExpected({ codes: [{ code: "A" }, { code: "Z" }] }, "reviewed", inSet)!]).toEqual(["A"])
    expect([...parseExpected({ codes: [{ code: "Z" }] }, "reviewed", null)!]).toEqual(["Z"])
  })
})

describe("computeEvalMetrics", () => {
  it("scores raw and post views per bucket and per code", () => {
    const m = computeEvalMetrics(
      [
        // raw finds HOT + MID, post keeps HOT only (MID dropped) → post better.
        item("1", ["HOT"], ["HOT", "MID"], ["HOT"]),
        // misses HOT in both views
        item("2", ["HOT"], [], []),
        // synthetic: correct
        item("3", ["P6C"], ["P6C"], ["P6C"], { synthetic: true }),
        // not judged: counts for found, not for P/R
        item("4", null, ["MID"], ["MID"]),
        // legacy row: raw only
        item("5", [], ["MID"], null),
        // failed item: ignored
        item("6", ["HOT"], [], null, { ok: false }),
      ],
      info,
    )
    expect(m.postItems).toBe(4)
    expect(m.overall.raw.all).toMatchObject({ items: 4, tp: 2, fp: 2, fn: 1 })
    expect(m.overall.post.all).toMatchObject({ items: 3, tp: 2, fp: 0, fn: 1 })
    expect(m.overall.post.real).toMatchObject({ items: 2, tp: 1, fp: 0, fn: 1 })
    expect(m.overall.post.synthetic).toMatchObject({ items: 1, tp: 1 })

    const hot = m.codes.find((c) => c.code === "HOT")!
    expect(hot.gateCode).toBe(true)
    expect(hot.effectiveProfile).toBe("P8")
    expect(hot.stats.real.post).toMatchObject({ tp: 1, fp: 0, fn: 1, precision: 1, recall: 0.5 })
    const mid = m.codes.find((c) => c.code === "MID")!
    expect(mid.found).toBe(3)
    expect(mid.kept).toBe(1)
    expect(mid.stats.all.raw).toMatchObject({ tp: 0, fp: 2 })
    expect(mid.stats.all.post).toMatchObject({ tp: 0, fp: 0 })
    expect(m.mismatches.map((x) => x.goldenItemId)).toEqual(["1", "2", "5"])
    expect(m.mismatches[0]).toMatchObject({ predicted: ["HOT", "MID"], kept: ["HOT"] })
  })
})

describe("evalGateVerdict", () => {
  const many = (n: number, f: (i: number) => MetricItem) => Array.from({ length: n }, (_, i) => f(i))

  it("passes when every judged gate code is precise and recall is high", () => {
    const items = [
      ...many(6, (i) => item(`h${i}`, ["HOT"], ["HOT"], ["HOT"])),
      ...many(5, (i) => item(`p${i}`, ["P6C"], ["P6C"], ["P6C"])),
      // one FP of HOT on a real item: precision 6/7 ≈ 0.857 ≥ 0.85
      item("fp", [], ["HOT"], ["HOT"]),
      // synthetic noise never counts for the gate
      ...many(5, (i) => item(`s${i}`, [], ["P6C"], ["P6C"], { synthetic: true })),
    ]
    const g = evalGateVerdict(computeEvalMetrics(items, info), ["HOT", "P6C", "MID", "QUIET", "REV"], info)
    expect(g.verdict).toBe("pass")
    expect(g.recall).toMatchObject({ value: 1, status: "pass" })
    expect(g.codes.find((c) => c.code === "HOT")).toMatchObject({ status: "pass", expected: 6, fp: 1 })
    // REV: weight 6, no profile → gate code, never expected → insufficient
    expect(g.codes.find((c) => c.code === "REV")?.status).toBe("insufficient")
    // MID (D4) and QUIET (explicit W1) are not gate codes
    expect(g.codes.map((c) => c.code)).not.toContain("MID")
    expect(g.codes.map((c) => c.code)).not.toContain("QUIET")
    expect(g.counts).toEqual({ pass: 2, fail: 0, insufficient: 1 })
  })

  it("fails on low precision of a judged code", () => {
    const items = [
      ...many(5, (i) => item(`h${i}`, ["HOT"], ["HOT"], ["HOT"])),
      ...many(2, (i) => item(`f${i}`, [], ["HOT"], ["HOT"])), // 5 / 7 ≈ 0.71
    ]
    const g = evalGateVerdict(computeEvalMetrics(items, info), ["HOT"], info)
    expect(g.verdict).toBe("fail")
    expect(g.codes[0]).toMatchObject({ code: "HOT", status: "fail" })
    expect(g.reasons.join(" ")).toContain("HOT")
  })

  it("fails on low overall recall", () => {
    const items = [
      ...many(5, (i) => item(`h${i}`, ["HOT"], ["HOT"], ["HOT"])),
      ...many(5, (i) => item(`m${i}`, ["MID"], [], [])),
    ]
    const g = evalGateVerdict(computeEvalMetrics(items, info), ["HOT", "MID"], info)
    expect(g.recall).toMatchObject({ value: 0.5, status: "fail", expected: 10 })
    expect(g.verdict).toBe("fail")
  })

  it("a judged code that is never predicted fails", () => {
    const items = [
      ...many(5, (i) => item(`h${i}`, ["HOT"], [], [])),
      ...many(20, (i) => item(`m${i}`, ["MID"], ["MID"], ["MID"])),
    ]
    const g = evalGateVerdict(computeEvalMetrics(items, info), ["HOT", "MID"], info)
    expect(g.codes[0]).toMatchObject({ code: "HOT", precision: null, status: "fail" })
    expect(g.verdict).toBe("fail")
  })

  it("insufficient data with few expected occurrences or post-less rows", () => {
    const few = [item("1", ["HOT"], ["HOT"], ["HOT"]), item("2", ["HOT"], ["HOT"], ["HOT"])]
    expect(evalGateVerdict(computeEvalMetrics(few, info), ["HOT"], info).verdict).toBe("insufficient_data")
    const legacy = Array.from({ length: 10 }, (_, i) => item(`l${i}`, ["HOT"], ["HOT"], null))
    const g = evalGateVerdict(computeEvalMetrics(legacy, info), ["HOT"], info)
    expect(g.verdict).toBe("insufficient_data")
    expect(g.realItems).toBe(0)
  })

  it("stores the thresholds with the verdict", () => {
    const g = evalGateVerdict(computeEvalMetrics([], info), [], info)
    expect(g.thresholds).toEqual(EVAL_GATE)
    expect(g.verdict).toBe("insufficient_data")
  })
})

describe("summarizeSample", () => {
  const base = (id: string, p: Partial<SampleItemResult>): SampleItemResult => ({
    itemId: id,
    ok: true,
    provider: "imap",
    subject: `S${id}`,
    date: `2026-11-0${id}T10:00:00.000Z`,
    durationMs: 1000,
    model: "m",
    taxonomyVersion: 3,
    score: 0,
    band: "none",
    instances: [],
    dropped: [],
    at: "2026-11-14T00:00:00.000Z",
    ...p,
  })
  const inst = (code: string, counted: boolean, confidence: "high" | "low" = "high") => ({
    code,
    evidence: `quote ${code}`,
    confidence,
    subjectIndex: 0,
    counted,
    notCountedReason: counted ? null : confidence === "low" ? ("low_confidence" as const) : ("outranked" as const),
    scoreContrib: counted ? 6 : 0,
  })

  it("counts review-only codes with examples, live codes apart, gates and failures", () => {
    const s = summarizeSample(
      [
        base("1", { instances: [inst("REV", true), inst("HOT", true)] }),
        base("2", { instances: [inst("REV", false, "low")] }),
        base("3", { dropped: [{ code: "REV", reason: "evidence_in_quote", evidence: "x" }] }),
        base("4", { gated: "automated" }),
        base("5", { ok: false, error: "boom" }),
      ],
      ["REV", "NEVER"],
      info,
    )
    expect(s.items).toEqual({ total: 5, ok: 4, failed: 1, gated: 1, withSignals: 2 })
    const rev = s.reviewCodes.find((c) => c.code === "REV")!
    expect(rev).toMatchObject({ items: 2, counted: 1, low: 1, dropped: 1, effectiveProfile: "P6" })
    expect(rev.examples.map((e) => e.itemId)).toEqual(["2", "1"]) // newest first
    expect(s.reviewCodes.find((c) => c.code === "NEVER")).toMatchObject({ items: 0, examples: [] })
    expect(s.liveCodes).toEqual([{ code: "HOT", labelRu: "Горячий", items: 1, counted: 1 }])
    expect(s.gatedBy).toEqual({ automated: 1 })
    expect(s.failed).toEqual([{ itemId: "5", error: "boom" }])
  })
})

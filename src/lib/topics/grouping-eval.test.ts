import { describe, expect, it } from "vitest"
import { computeGroupingEval, type GroupingEvalItem } from "./grouping-eval"

const item = (id: string, groups: string[], topics: string[], extra: Partial<GroupingEvalItem> = {}): GroupingEvalItem => ({
  goldenItemId: id,
  sourceItemId: `s-${id}`,
  groups,
  topics: topics.map((t) => ({ id: t, title: `Тема ${t}` })),
  ...extra,
})

describe("computeGroupingEval", () => {
  it("perfect grouping: precision = recall = 1", () => {
    const r = computeGroupingEval([
      item("1", ["Счёт 124"], ["T1"]),
      item("2", ["счет 124"], ["T1"]),
      item("3", ["Прайс"], ["T2"]),
      item("4", [], []),
    ])
    expect(r.pairs).toEqual({ total: 6, expectedSame: 1, predictedSame: 1, both: 1 })
    expect(r.precision).toBe(1)
    expect(r.recall).toBe(1)
    expect(r.verdict).toBe("insufficient") // < 20 expected-same pairs
    expect(r.split).toEqual([])
    expect(r.merged).toEqual([])
    expect(r.missing).toEqual([])
  })

  it("over-split: one group over two topics lowers recall", () => {
    const r = computeGroupingEval([
      item("1", ["A"], ["T1"]),
      item("2", ["A"], ["T1"]),
      item("3", ["A"], ["T2"]),
    ])
    // expected-same: 3 pairs; predicted-same: (1,2); both: 1
    expect(r.pairs).toMatchObject({ expectedSame: 3, predictedSame: 1, both: 1 })
    expect(r.precision).toBe(1)
    expect(r.recall).toBeCloseTo(1 / 3)
    expect(r.split).toHaveLength(1)
    expect(r.split[0]).toMatchObject({ group: "A", items: 3, itemsWithoutTopic: 0 })
    expect(r.split[0].topics).toEqual([
      { id: "T1", title: "Тема T1", items: 2 },
      { id: "T2", title: "Тема T2", items: 1 },
    ])
    expect(r.overSplitRate).toBe(1)
    expect(r.overMergeRate).toBe(0)
  })

  it("over-merge: one topic holding two groups lowers precision", () => {
    const r = computeGroupingEval([
      item("1", ["Счёт 124"], ["T1"]),
      item("2", ["Прайс на осень"], ["T1"]),
    ])
    expect(r.pairs).toMatchObject({ expectedSame: 0, predictedSame: 1, both: 0 })
    expect(r.precision).toBe(0)
    expect(r.recall).toBeNull()
    expect(r.merged).toHaveLength(1)
    expect(r.merged[0].groups.map((g) => g.group).sort()).toEqual(["Прайс на осень", "Счёт 124"])
  })

  it("an item in two groups / two topics (spec §2.1: one email, two questions)", () => {
    const r = computeGroupingEval([
      item("1", ["Счёт 124", "Прайс"], ["T1", "T2"]),
      item("2", ["Счёт 124"], ["T1"]),
      item("3", ["Прайс"], ["T2"]),
    ])
    expect(r.pairs).toMatchObject({ expectedSame: 2, predictedSame: 2, both: 2 })
    expect(r.precision).toBe(1)
    expect(r.recall).toBe(1)
    // An item in two groups and two topics is neither split nor merged.
    expect(r.split).toEqual([])
    expect(r.merged).toEqual([])
  })

  it("a group item without an engine topic is «missing», not a split", () => {
    const r = computeGroupingEval([item("1", ["A"], ["T1"]), item("2", ["A"], [])])
    expect(r.split).toEqual([])
    expect(r.missing.map((m) => m.goldenItemId)).toEqual(["2"])
  })

  it("items with a group but no topic are listed as missing", () => {
    const r = computeGroupingEval([
      item("1", ["A"], [], { topicStatus: "log_only", topicReason: "state code only", preview: "Оплатили" }),
      item("2", ["A"], ["T1"]),
      item("3", [], ["T1"]),
    ])
    expect(r.missing).toEqual([
      {
        goldenItemId: "1",
        sourceItemId: "s-1",
        groups: ["A"],
        topicStatus: "log_only",
        topicReason: "state code only",
        preview: "Оплатили",
      },
    ])
    expect(r.itemsNoGroupWithTopic).toBe(1)
    // (2,3) predicted-same but not expected → precision 0; (1,2) expected → recall 0
    expect(r.pairs).toMatchObject({ expectedSame: 1, predictedSame: 1, both: 0 })
  })

  it("gate: pass / fail once there are ≥ 20 expected-same pairs", () => {
    // 7 items in one group, one topic → 21 expected-same pairs, all predicted.
    const good = Array.from({ length: 7 }, (_, i) => item(String(i), ["G"], ["T"]))
    expect(computeGroupingEval(good).verdict).toBe("pass")
    // Same items, each in its own topic → recall 0.
    const bad = Array.from({ length: 7 }, (_, i) => item(String(i), ["G"], [`T${i}`]))
    const r = computeGroupingEval(bad)
    expect(r.recall).toBe(0)
    expect(r.precision).toBeNull()
    expect(r.verdict).toBe("fail")
  })

  it("empty input", () => {
    const r = computeGroupingEval([])
    expect(r.pairs.total).toBe(0)
    expect(r.verdict).toBe("insufficient")
    expect(r.precision).toBeNull()
  })
})

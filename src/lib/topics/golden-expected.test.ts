import { describe, expect, it } from "vitest"
import {
  dedupeTopicGroups,
  normalizeGoldenExpected,
  quoteFoundInText,
  readGoldenExpected,
  readTopicGroups,
  reviewReadinessError,
  topicGroupKey,
} from "./golden-expected"

describe("readTopicGroups", () => {
  it("null when neither key is set", () => {
    expect(readTopicGroups({ codes: [] })).toBeNull()
    expect(readTopicGroups(null)).toBeNull()
    expect(readTopicGroups("x")).toBeNull()
  })
  it("old topicGroup string → one-element list", () => {
    expect(readTopicGroups({ codes: [], topicGroup: "Альфа — счёт № 124" })).toEqual(["Альфа — счёт № 124"])
  })
  it("old empty topicGroup → empty list (field set)", () => {
    expect(readTopicGroups({ codes: [], topicGroup: "  " })).toEqual([])
  })
  it("topicGroups list, deduplicated by key, merged with the old field", () => {
    expect(
      readTopicGroups({
        topicGroups: ["Альфа — счёт № 124", " альфа —  счёт № 124 ", "Прайс на осень", 5],
        topicGroup: "Прайс на осень",
      }),
    ).toEqual(["Альфа — счёт № 124", "Прайс на осень"])
  })
  it("empty list is kept as «no topic»", () => {
    expect(readTopicGroups({ topicGroups: [] })).toEqual([])
  })
})

describe("topicGroupKey / dedupe", () => {
  it("case, ё and spacing insensitive", () => {
    expect(topicGroupKey("  Счёт   №124 ")).toBe(topicGroupKey("счет №124"))
    expect(dedupeTopicGroups(["A", "a", "", " b "])).toEqual(["A", "b"])
  })
})

describe("readGoldenExpected", () => {
  it("reads codes, trims, drops empty optional fields", () => {
    const v = readGoldenExpected({
      codes: [{ code: " ORDER_REQUESTED ", evidence: " отгрузить ", subject: "" }, { code: "" }, { foo: 1 }],
      noSignal: false,
      reviewNote: "ok",
    })
    expect(v).toEqual({
      codes: [{ code: "ORDER_REQUESTED", evidence: "отгрузить" }],
      noSignal: false,
      topicGroups: null,
      reviewNote: "ok",
    })
  })
  it("null for non-objects", () => {
    expect(readGoldenExpected(null)).toBeNull()
    expect(readGoldenExpected([])).toBeNull()
  })
})

describe("normalizeGoldenExpected", () => {
  it("folds the old topicGroup into topicGroups, keeps unknown keys", () => {
    const out = normalizeGoldenExpected({
      codes: [{ code: "A", evidence: "x", confidence: "high" }],
      topicGroup: "Тема 1",
      custom: 1,
    })
    expect(out).toEqual({
      codes: [{ code: "A", evidence: "x", confidence: "high" }],
      noSignal: false,
      topicGroups: ["Тема 1"],
      custom: 1,
    })
    expect("topicGroup" in out).toBe(false)
  })
  it("always writes topicGroups (empty = no topic) and the review note", () => {
    expect(normalizeGoldenExpected({ codes: [], noSignal: true, reviewNote: " рассылка " })).toEqual({
      codes: [],
      noSignal: true,
      topicGroups: [],
      reviewNote: "рассылка",
    })
  })
  it("rejects noSignal with codes", () => {
    expect(() => normalizeGoldenExpected({ codes: [{ code: "A" }], noSignal: true })).toThrow(/Сигналов нет/)
  })
  it("rejects too many groups", () => {
    const many = Array.from({ length: 21 }, (_, i) => `g${i}`)
    expect(() => normalizeGoldenExpected({ codes: [], topicGroups: many })).toThrow()
  })
})

describe("reviewReadinessError", () => {
  it("needs a code or noSignal", () => {
    expect(reviewReadinessError(null)).not.toBeNull()
    expect(reviewReadinessError({ codes: [], noSignal: false, topicGroups: [], reviewNote: "" })).not.toBeNull()
    expect(reviewReadinessError({ codes: [], noSignal: true, topicGroups: [], reviewNote: "" })).toBeNull()
    expect(reviewReadinessError({ codes: [{ code: "A" }], noSignal: false, topicGroups: null, reviewNote: "" })).toBeNull()
  })
})

describe("quoteFoundInText", () => {
  it("quote and spacing insensitive", () => {
    expect(quoteFoundInText("«Счёт 124»  не оплачен", "Добрый день! Счет 124 не оплачен.")).toBe(true)
    expect(quoteFoundInText("прайс на зиму", "пришлите прайс на осень")).toBe(false)
    expect(quoteFoundInText("", "что угодно")).toBe(true)
  })
})

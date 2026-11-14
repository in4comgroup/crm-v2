import { describe, expect, it } from "vitest"
import {
  bucketCount,
  bucketKey,
  bucketKeys,
  bucketLabel,
  buildStackedBuckets,
  checkChartRange,
  defaultChartRange,
  isDay,
} from "./ai-usage-chart"

describe("isDay", () => {
  it("accepts real UTC days only", () => {
    expect(isDay("2026-11-14")).toBe(true)
    expect(isDay("2024-02-29")).toBe(true)
    expect(isDay("2026-02-30")).toBe(false)
    expect(isDay("2026-1-01")).toBe(false)
    expect(isDay("")).toBe(false)
    expect(isDay(null)).toBe(false)
  })
})

describe("bucketKeys", () => {
  it("days, inclusive, across a month and a leap day", () => {
    expect(bucketKeys("day", "2024-02-28", "2024-03-01")).toEqual(["2024-02-28", "2024-02-29", "2024-03-01"])
    expect(bucketKeys("day", "2026-11-14", "2026-11-14")).toEqual(["2026-11-14"])
  })
  it("months across a year boundary, partial edge months included", () => {
    expect(bucketKeys("month", "2025-11-20", "2026-02-03")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"])
  })
  it("years", () => {
    expect(bucketKeys("year", "2024-06-01", "2026-01-01")).toEqual(["2024", "2025", "2026"])
  })
  it("count matches the keys and bucketKey maps a day into them", () => {
    expect(bucketCount("day", "2026-01-01", "2026-12-31")).toBe(365)
    expect(bucketCount("month", "2022-01-01", "2026-12-31")).toBe(60)
    expect(bucketKey("month", "2026-11-14")).toBe("2026-11")
    expect(bucketKey("year", "2026-11-14")).toBe("2026")
    expect(bucketKey("day", "2026-11-14")).toBe("2026-11-14")
  })
})

describe("checkChartRange", () => {
  it("bounds: day ≤ 366 days, month ≤ 60 months", () => {
    expect(checkChartRange("day", "2024-01-01", "2024-12-31")).toEqual({ ok: true, buckets: 366 })
    const day = checkChartRange("day", "2025-01-01", "2026-01-02")
    expect(day.ok).toBe(false)
    if (!day.ok) {
      expect(day.reason).toBe("too_long")
      expect(day.message).toContain("По месяцам")
    }
    expect(checkChartRange("month", "2022-01-01", "2026-12-31").ok).toBe(true)
    const month = checkChartRange("month", "2021-12-31", "2026-12-31")
    expect(month.ok).toBe(false)
    if (!month.ok) expect(month.message).toContain("По годам")
    expect(checkChartRange("year", "2020-01-01", "2026-12-31").ok).toBe(true)
  })
  it("invalid dates and reversed order", () => {
    expect(checkChartRange("day", "2026-11-14", "x")).toMatchObject({ ok: false, reason: "invalid" })
    expect(checkChartRange("day", "2026-11-14", "2026-11-13")).toMatchObject({ ok: false, reason: "order" })
  })
})

describe("bucketLabel", () => {
  it("Russian formats дд.мм / мм.гггг / гггг", () => {
    expect(bucketLabel("2026-11-04")).toBe("04.11")
    expect(bucketLabel("2026-11-04", true)).toBe("04.11.2026")
    expect(bucketLabel("2026-03")).toBe("03.2026")
    expect(bucketLabel("2026")).toBe("2026")
  })
})

describe("defaultChartRange", () => {
  const page = { from: "2026-10-16", to: "2026-11-14" }
  it("day scale follows the page period", () => {
    expect(defaultChartRange("day", page, "2026-11-14")).toEqual(page)
  })
  it("month = this month and the 11 before, year = this year and the 4 before", () => {
    expect(defaultChartRange("month", page, "2026-11-14")).toEqual({ from: "2025-12-01", to: "2026-11-14" })
    expect(defaultChartRange("year", page, "2026-11-14")).toEqual({ from: "2022-01-01", to: "2026-11-14" })
    expect(bucketCount("month", "2025-12-01", "2026-11-14")).toBe(12)
  })
})

describe("buildStackedBuckets", () => {
  const keys = ["2026-11-01", "2026-11-02", "2026-11-03"]
  it("fills empty buckets with 0 for every series and keeps bucket order", () => {
    const { labels, points } = buildStackedBuckets(
      keys,
      [
        { bucket: "2026-11-03", key: "a", cost: 1 },
        { bucket: "2026-11-01", key: "b", cost: 5 },
      ],
      { maxSeries: 8, otherLabel: "Прочее" },
    )
    expect(labels).toEqual(["b", "a"])
    expect(points).toEqual([
      { period: "2026-11-01", a: 0, b: 5 },
      { period: "2026-11-02", a: 0, b: 0 },
      { period: "2026-11-03", a: 1, b: 0 },
    ])
  })
  it("folds the tail into «Прочее», maps names and drops rows outside the range", () => {
    const { labels, points } = buildStackedBuckets(
      ["2026-11"],
      [
        { bucket: "2026-11", key: "p1", cost: 10 },
        { bucket: "2026-11", key: "p2", cost: 3 },
        { bucket: "2026-11", key: "p3", cost: 2 },
        { bucket: "2026-11", key: "p4", cost: 1 },
        { bucket: "2026-10", key: "p1", cost: 100 },
      ],
      { name: (k) => k.toUpperCase(), maxSeries: 3, otherLabel: "Прочее" },
    )
    expect(labels).toEqual(["P1", "P2", "Прочее"])
    expect(points).toEqual([{ period: "2026-11", P1: 10, P2: 3, Прочее: 3 }])
  })
  it("no rows → no series, still one point per bucket", () => {
    const r = buildStackedBuckets(keys, [], { maxSeries: 8, otherLabel: "Прочее" })
    expect(r.labels).toEqual([])
    expect(r.points).toHaveLength(3)
  })
})

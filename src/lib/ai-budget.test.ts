import { describe, expect, it } from "vitest"
import { aiLimitStep, aiMonthlyLimitState, nextUtcMonth, startOfUtcMonth } from "./ai-budget"

const now = new Date("2026-11-15T10:00:00Z")

describe("aiMonthlyLimitState", () => {
  it("ok below 70 %", () => {
    const s = aiMonthlyLimitState(10, 20, now)
    expect(s.level).toBe("ok")
    expect(s.share).toBe(0.5)
    expect(s.remainingUsd).toBe(10)
  })
  it("steps 69 / 70 / 89 / 90 / 100 % (Q3)", () => {
    expect(aiMonthlyLimitState(69, 100, now).level).toBe("ok")
    expect(aiMonthlyLimitState(70, 100, now).level).toBe("info")
    expect(aiMonthlyLimitState(89, 100, now).level).toBe("info")
    expect(aiMonthlyLimitState(90, 100, now).level).toBe("warning")
    expect(aiMonthlyLimitState(99.99, 100, now).level).toBe("warning")
    expect(aiMonthlyLimitState(100, 100, now).level).toBe("exceeded")
  })
  it("80 % is info now, not a warning", () => {
    expect(aiMonthlyLimitState(16, 20, now).level).toBe("info")
    expect(aiMonthlyLimitState(13.99, 20, now).level).toBe("ok")
    expect(aiMonthlyLimitState(18, 20, now).level).toBe("warning")
  })
  it("exceeded at 100 % and above", () => {
    expect(aiMonthlyLimitState(20, 20, now).level).toBe("exceeded")
    const s = aiMonthlyLimitState(25, 20, now)
    expect(s.level).toBe("exceeded")
    expect(s.remainingUsd).toBe(0)
  })
  it("budget 0 = no background AI", () => {
    expect(aiMonthlyLimitState(0, 0, now).level).toBe("exceeded")
  })
  it("resets on the 1st of the next month (UTC), also in December", () => {
    expect(aiMonthlyLimitState(1, 20, now).resetsAt).toBe("2026-12-01T00:00:00.000Z")
    expect(nextUtcMonth(new Date("2026-12-31T23:59:59Z")).toISOString()).toBe("2027-01-01T00:00:00.000Z")
    expect(startOfUtcMonth(now).toISOString()).toBe("2026-11-01T00:00:00.000Z")
  })
})

describe("aiLimitStep", () => {
  it("69 / 70 / 89 / 90 / 100 %", () => {
    expect(aiLimitStep(0)).toBe(0)
    expect(aiLimitStep(0.69)).toBe(0)
    expect(aiLimitStep(0.7)).toBe(70)
    expect(aiLimitStep(0.89)).toBe(70)
    expect(aiLimitStep(0.9)).toBe(90)
    expect(aiLimitStep(0.9999)).toBe(90)
    expect(aiLimitStep(1)).toBe(100)
    expect(aiLimitStep(2.5)).toBe(100)
  })
  it("matches the share of aiMonthlyLimitState, also with a 0 budget", () => {
    expect(aiLimitStep(aiMonthlyLimitState(70, 100, now).share)).toBe(70)
    expect(aiLimitStep(aiMonthlyLimitState(90, 100, now).share)).toBe(90)
    expect(aiLimitStep(aiMonthlyLimitState(0, 0, now).share)).toBe(100)
  })
  it("non-finite input", () => {
    expect(aiLimitStep(Number.POSITIVE_INFINITY)).toBe(100)
    expect(aiLimitStep(Number.NaN)).toBe(0)
  })
})

import { describe, expect, it } from "vitest"
import { aiMonthlyLimitState, nextUtcMonth, startOfUtcMonth } from "./ai-budget"

const now = new Date("2026-11-15T10:00:00Z")

describe("aiMonthlyLimitState", () => {
  it("ok below 80 %", () => {
    const s = aiMonthlyLimitState(10, 20, now)
    expect(s.level).toBe("ok")
    expect(s.share).toBe(0.5)
    expect(s.remainingUsd).toBe(10)
  })
  it("warning from 80 %", () => {
    expect(aiMonthlyLimitState(16, 20, now).level).toBe("warning")
    expect(aiMonthlyLimitState(15.99, 20, now).level).toBe("ok")
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

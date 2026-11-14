import { describe, expect, it } from "vitest"
import { WorkCalendar, addCalendarDays, isoWeekday } from "./attention-calendar"
import { ATTENTION_DEFAULTS, attentionParamsHash, mergeAttentionParams } from "./attention-params"

// Exceptions of the official 2026 calendar (decree No. 1466 of 24.09.2025), excerpt.
const RU_2026 = [
  { day: "2026-01-09", isWorking: false, isShort: false },
  { day: "2026-11-03", isWorking: true, isShort: true },
  { day: "2026-11-04", isWorking: false, isShort: false },
  { day: "2026-12-31", isWorking: false, isShort: false },
]
const cal = new WorkCalendar(RU_2026, { timeZone: "Europe/Moscow", workStart: "08:00", workEnd: "18:00" })
const msk = (s: string) => new Date(`${s.replace(" ", "T")}:00+03:00`)

describe("production calendar", () => {
  it("day arithmetic", () => {
    expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01")
    expect(isoWeekday("2026-11-14")).toBe(6)
  })
  it("org time zone: local day and moment", () => {
    expect(cal.localDay(new Date("2026-11-16T22:30:00Z"))).toBe("2026-11-17")
    expect(cal.at("2026-11-16", "10:00").toISOString()).toBe("2026-11-16T07:00:00.000Z")
  })
  it("holidays and transfers", () => {
    expect(cal.isWorkingDay("2026-11-04")).toBe(false)
    expect(cal.isWorkingDay("2026-01-09")).toBe(false)
    expect(cal.isWorkingDay("2026-11-14")).toBe(false)
    expect(cal.workingDaysBetween("2026-11-02", "2026-11-06")).toBe(3)
    expect(cal.addWorkingDays("2026-11-03", 1)).toBe("2026-11-05")
  })
  it("unseeded year falls back to Mon–Fri", () => {
    expect(cal.isWorkingDay("2030-01-01")).toBe(true) // Tuesday, no row
    expect(cal.seededYears()).toEqual([2026])
  })
  it("working hours (short day ends one hour earlier)", () => {
    expect(cal.workingHoursBetween(msk("2026-11-16 10:00"), msk("2026-11-18 10:00"))).toBe(20)
    expect(cal.workingHoursBetween(msk("2026-11-03 08:00"), msk("2026-11-05 08:00"))).toBe(9)
    expect(cal.addWorkingHours(msk("2026-11-13 17:00"), 2).toISOString()).toBe(msk("2026-11-16 09:00").toISOString())
  })
  it("next snapshot points", () => {
    expect(cal.nextWorkingDayAt(msk("2026-11-13 08:00"), "07:30").toISOString()).toBe(msk("2026-11-16 07:30").toISOString())
    expect(cal.nextWeekdayAt(msk("2026-11-16 08:00"), 5, "12:00").toISOString()).toBe(msk("2026-11-20 12:00").toISOString())
  })
})

describe("attention params ladder", () => {
  it("platform then org override, nested maps merged", () => {
    const p = mergeAttentionParams({ boostMax: 1, deadlineLeadDays: { complex: 7 } }, { deadlineLeadDays: { quick: 1 } })
    expect(p.boostMax).toBe(1)
    expect(p.deadlineLeadDays).toEqual({ quick: 1, medium: 3, complex: 7 })
    expect(mergeAttentionParams()).toEqual(ATTENTION_DEFAULTS)
    expect(attentionParamsHash(p, 3)).not.toBe(attentionParamsHash(ATTENTION_DEFAULTS, 3))
  })
})

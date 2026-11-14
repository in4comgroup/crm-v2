import { describe, expect, it } from "vitest"
import { WorkCalendar, addCalendarDays, isoWeekday, weeklyReviewDay } from "./attention-calendar"
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

// Holiday Fridays of the seeded calendar (migrations/0020_work_calendar_ru_2026_2027.sql):
// 31.12.2026 (Thu) and 01.01.2027 (Fri) off; 04–08.01.2027 the whole week off;
// 04.11.2027 (Thu) and 05.11.2027 (Fri) off, 03.11.2027 a short day.
const RU_NEW_YEAR = [
  { day: "2026-12-31", isWorking: false, isShort: false },
  { day: "2027-01-01", isWorking: false, isShort: false },
  { day: "2027-01-04", isWorking: false, isShort: false },
  { day: "2027-01-05", isWorking: false, isShort: false },
  { day: "2027-01-06", isWorking: false, isShort: false },
  { day: "2027-01-07", isWorking: false, isShort: false },
  { day: "2027-01-08", isWorking: false, isShort: false },
  { day: "2027-11-03", isWorking: true, isShort: true },
  { day: "2027-11-04", isWorking: false, isShort: false },
  { day: "2027-11-05", isWorking: false, isShort: false },
]
const ny = new WorkCalendar(RU_NEW_YEAR, { timeZone: "Europe/Moscow", workStart: "08:00", workEnd: "18:00" })

describe("weekly review day on a holiday Friday (06 §7.2, one rule)", () => {
  it("Friday, or the last working day before it in the same week; none when the week has no working day", () => {
    expect(weeklyReviewDay(ny, "2026-12-14", 5)).toBe("2026-12-18")
    expect(weeklyReviewDay(ny, "2027-01-01", 5)).toBe("2026-12-30") // Thu 31.12 and Fri 01.01 off
    expect(weeklyReviewDay(ny, "2027-01-06", 5)).toBeNull() // 04–08.01 all off
    expect(weeklyReviewDay(ny, "2027-11-01", 5)).toBe("2027-11-03") // Thu + Fri off → the short Wednesday
  })
  it("next / last weekly review moment follow the same rule", () => {
    expect(ny.nextWeeklyReviewAt(msk("2026-12-28 09:00"), 5, "12:00").toISOString()).toBe(msk("2026-12-30 12:00").toISOString())
    // After the Wednesday review the next one skips the holiday week.
    expect(ny.nextWeeklyReviewAt(msk("2026-12-30 12:00"), 5, "12:00").toISOString()).toBe(msk("2027-01-15 12:00").toISOString())
    expect(ny.lastWeeklyReviewAt(msk("2027-01-09 10:00"), 5, "12:00").toISOString()).toBe(msk("2026-12-30 12:00").toISOString())
    expect(ny.lastWeeklyReviewAt(msk("2027-01-15 12:00"), 5, "12:00").toISOString()).toBe(msk("2027-01-15 12:00").toISOString())
    expect(ny.lastWeeklyReviewAt(msk("2027-11-06 10:00"), 5, "12:00").toISOString()).toBe(msk("2027-11-03 12:00").toISOString())
    // Plain week: same as the plain weekday.
    expect(ny.nextWeeklyReviewAt(msk("2026-11-16 08:00"), 5, "12:00").toISOString()).toBe(
      ny.nextWeekdayAt(msk("2026-11-16 08:00"), 5, "12:00").toISOString(),
    )
  })
  it("last «Сводка» point = the morning of the last working day ≤ now", () => {
    expect(ny.lastWorkingDayAt(msk("2026-12-30 07:29"), "07:30").toISOString()).toBe(msk("2026-12-29 07:30").toISOString())
    expect(ny.lastWorkingDayAt(msk("2026-12-30 07:30"), "07:30").toISOString()).toBe(msk("2026-12-30 07:30").toISOString())
    expect(ny.lastWorkingDayAt(msk("2027-01-09 10:00"), "07:30").toISOString()).toBe(msk("2026-12-30 07:30").toISOString())
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

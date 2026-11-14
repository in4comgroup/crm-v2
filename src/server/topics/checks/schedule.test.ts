import { describe, expect, it } from "vitest"
import { WorkCalendar } from "@/lib/topics/attention-calendar"
import { CHECKS_DEFAULTS } from "@/lib/topics/checks"
import { duePeriodKey, isoWeekKey } from "./schedule"

const cal = new WorkCalendar([], { timeZone: "Europe/Moscow", workStart: "08:00", workEnd: "18:00" })
// 2026-11-14 is a Saturday. Moscow = UTC+3.
const at = (iso: string) => new Date(iso)

describe("isoWeekKey", () => {
  it("uses the ISO week (Thursday decides the year)", () => {
    expect(isoWeekKey("2026-11-14")).toBe("2026-W46")
    expect(isoWeekKey("2026-01-01")).toBe("2026-W01")
    expect(isoWeekKey("2027-01-01")).toBe("2026-W53")
  })
})

describe("duePeriodKey", () => {
  const p = CHECKS_DEFAULTS
  it("hourly checks are due on every run", () => {
    expect(duePeriodKey("hourly", at("2026-11-14T00:30:00Z"), cal, p, "r1")).toBe("run:r1")
  })
  it("daily checks are due from runTime (org time)", () => {
    expect(duePeriodKey("daily", at("2026-11-14T03:59:00Z"), cal, p, "r")).toBeNull() // 06:59 MSK
    expect(duePeriodKey("daily", at("2026-11-14T04:00:00Z"), cal, p, "r")).toBe("2026-11-14")
    expect(duePeriodKey("daily", at("2026-11-14T20:00:00Z"), cal, p, "r")).toBe("2026-11-14")
  })
  it("weekly checks are due from Monday runTime for the rest of the ISO week", () => {
    expect(duePeriodKey("weekly", at("2026-11-16T03:00:00Z"), cal, p, "r")).toBeNull() // Mon 06:00
    expect(duePeriodKey("weekly", at("2026-11-16T05:00:00Z"), cal, p, "r")).toBe("2026-W47")
    expect(duePeriodKey("weekly", at("2026-11-14T10:00:00Z"), cal, p, "r")).toBe("2026-W46") // Saturday catches up
  })
  it("monthly checks are due from day 3 runTime", () => {
    expect(duePeriodKey("monthly", at("2026-12-02T10:00:00Z"), cal, p, "r")).toBeNull()
    expect(duePeriodKey("monthly", at("2026-12-03T03:00:00Z"), cal, p, "r")).toBeNull() // 06:00 MSK
    expect(duePeriodKey("monthly", at("2026-12-03T04:00:00Z"), cal, p, "r")).toBe("2026-12")
    expect(duePeriodKey("monthly", at("2026-11-14T10:00:00Z"), cal, p, "r")).toBe("2026-11")
  })
})

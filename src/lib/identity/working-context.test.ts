import { describe, expect, it } from "vitest"
import { isValidTimeZone, timeZoneOptions, utcOffsetLabel, withWorkingContext, workingContextInputSchema } from "./working-context"

describe("working context (time zone + working hours)", () => {
  it("validates the zone and the hours", () => {
    expect(isValidTimeZone("Europe/Vienna")).toBe(true)
    expect(isValidTimeZone("Mars/Base")).toBe(false)
    expect(isValidTimeZone("")).toBe(false)
    expect(workingContextInputSchema.safeParse({ timeZone: "Europe/Moscow", workStart: "09:00", workEnd: "18:00" }).success).toBe(true)
    expect(workingContextInputSchema.safeParse({ timeZone: "Mars/Base", workStart: "09:00", workEnd: "18:00" }).success).toBe(false)
    expect(workingContextInputSchema.safeParse({ timeZone: "UTC", workStart: "9:00", workEnd: "18:00" }).success).toBe(false)
    const r = workingContextInputSchema.safeParse({ timeZone: "UTC", workStart: "18:00", workEnd: "09:00" })
    expect(r.success).toBe(false)
    expect(r.error?.issues[0].message).toBe("Начало рабочего дня должно быть раньше конца")
  })

  it("sets only the three keys of the org override; other keys stay", () => {
    expect(withWorkingContext({ boostMax: 1, timeZone: "UTC" }, { timeZone: "Europe/Vienna", workStart: "08:30", workEnd: "17:00" })).toEqual({
      boostMax: 1,
      timeZone: "Europe/Vienna",
      workStart: "08:30",
      workEnd: "17:00",
    })
    expect(withWorkingContext(null, { timeZone: "UTC", workStart: "09:00", workEnd: "18:00" })).toEqual({
      timeZone: "UTC",
      workStart: "09:00",
      workEnd: "18:00",
    })
  })

  it("picker options keep the current zone; offset labels", () => {
    expect(timeZoneOptions("Europe/Vienna")).toContain("Europe/Vienna")
    expect(timeZoneOptions("Old/Alias")[0]).toBe("Old/Alias")
    expect(utcOffsetLabel("UTC")).toBe("UTC+00:00")
    expect(utcOffsetLabel("Europe/Moscow", new Date("2026-11-19T12:00:00Z"))).toBe("UTC+03:00")
  })
})

import { describe, expect, it } from "vitest"
import { defaultDueLocal, dueParts, formatOrgDue, formatOrgDueShort, formatOrgDay, parseTaskDue } from "./org-time"

const msk = { timeZone: "Europe/Moscow", defaultDueTime: "23:59" }
const vie = { timeZone: "Europe/Vienna", defaultDueTime: "18:00" }

describe("parseTaskDue", () => {
  it("a date only = that day at the org default time, in the org zone", () => {
    expect(parseTaskDue("2026-11-26", msk)?.toISOString()).toBe("2026-11-26T20:59:00.000Z")
    expect(parseTaskDue("2026-11-26", vie)?.toISOString()).toBe("2026-11-26T17:00:00.000Z")
  })
  it("a wall time is read in the org zone (DST-safe)", () => {
    expect(parseTaskDue("2026-11-26T10:30", msk)?.toISOString()).toBe("2026-11-26T07:30:00.000Z")
    expect(parseTaskDue("2026-07-01T10:30", vie)?.toISOString()).toBe("2026-07-01T08:30:00.000Z")
  })
  it("a full ISO instant is kept", () => {
    expect(parseTaskDue("2026-11-26T20:59:00.000Z", vie)?.toISOString()).toBe("2026-11-26T20:59:00.000Z")
    expect(parseTaskDue("2026-11-26T10:00+03:00", vie)?.toISOString()).toBe("2026-11-26T07:00:00.000Z")
  })
  it("rejects junk", () => {
    expect(parseTaskDue("", msk)).toBeNull()
    expect(parseTaskDue("завтра", msk)).toBeNull()
    expect(parseTaskDue("2026-13-01", msk)).toBeNull()
    expect(parseTaskDue(null, msk)).toBeNull()
  })
})

describe("display in the org zone", () => {
  const at = "2026-11-26T20:59:00.000Z"
  it("parts, day, due", () => {
    expect(dueParts(at, "Europe/Moscow")).toEqual({ date: "2026-11-26", time: "23:59" })
    expect(dueParts(at, "Europe/Vienna")).toEqual({ date: "2026-11-26", time: "21:59" })
    expect(formatOrgDay(at, "Asia/Novosibirsk")).toBe("27 нояб. 2026")
    expect(formatOrgDue(at, "Europe/Moscow")).toBe("26 нояб. 2026, 23:59")
    expect(formatOrgDueShort(at, "Europe/Moscow")).toBe("26.11.2026 23:59")
  })
  it("today at the default time", () => {
    expect(defaultDueLocal(new Date("2026-11-26T22:30:00Z"), msk)).toBe("2026-11-27T23:59")
  })
})

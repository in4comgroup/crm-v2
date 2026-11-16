import { describe, expect, it } from "vitest"
import { dueLabel, hasDateCue, localToUtc, resolveDueText, utcToLocal } from "./due-date"

const TZ = "Europe/Vienna"
// Monday 16.11.2026, 10:00 in Vienna (09:00 UTC).
const MON = new Date("2026-11-16T09:00:00Z")
const r = (t: string, now = MON) => resolveDueText(t, now, TZ)

describe("resolveDueText (org time zone)", () => {
  it("relative days and weekdays", () => {
    expect(r("сегодня")).toBe("2026-11-16T18:00")
    expect(r("завтра в 11:00")).toBe("2026-11-17T11:00")
    expect(r("послезавтра")).toBe("2026-11-18T18:00")
    expect(r("до пятницы")).toBe("2026-11-20T18:00")
    expect(r("в четверг")).toBe("2026-11-19T18:00")
    expect(r("в среду к 10.30")).toBe("2026-11-18T10:30")
    expect(r("в понедельник")).toBe("2026-11-23T18:00") // same weekday = next week
    expect(r("в следующий вторник")).toBe("2026-11-24T18:00")
    expect(r("до конца недели")).toBe("2026-11-20T18:00")
    expect(r("на следующей неделе")).toBe("2026-11-27T18:00")
    expect(r("до конца месяца")).toBe("2026-11-30T18:00")
  })
  it("«через …» and dates", () => {
    expect(r("через 3 дня")).toBe("2026-11-19T18:00")
    expect(r("через неделю")).toBe("2026-11-23T18:00")
    expect(r("через две недели")).toBe("2026-11-30T18:00")
    expect(r("через месяц")).toBe("2026-12-16T18:00")
    expect(r("до 25.11")).toBe("2026-11-25T18:00")
    expect(r("до 20 ноября в 15 часов")).toBe("2026-11-20T15:00")
    expect(r("к 10.01")).toBe("2027-01-10T18:00") // past day → next year
    expect(r("3 декабря")).toBe("2026-12-03T18:00")
  })
  it("weekend: «до конца недели» = next Friday, «на следующей неделе» = that Friday", () => {
    const SAT = new Date("2026-11-21T09:00:00Z")
    expect(r("до конца недели", SAT)).toBe("2026-11-27T18:00")
    expect(r("на следующей неделе", SAT)).toBe("2026-11-27T18:00")
  })
  it("not a deadline → null", () => {
    expect(r("как можно скорее")).toBeNull()
    expect(hasDateCue("позвонить клиенту")).toBe(false)
    expect(hasDateCue("до пятницы")).toBe(true)
    expect(hasDateCue("к 20.11")).toBe(true)
  })
})

describe("time zone conversion", () => {
  it("org-local wall time ↔ UTC, DST-safe", () => {
    expect(localToUtc("2026-11-20T18:00", TZ)!.toISOString()).toBe("2026-11-20T17:00:00.000Z")
    expect(localToUtc("2026-07-01T18:00", TZ)!.toISOString()).toBe("2026-07-01T16:00:00.000Z")
    expect(utcToLocal(new Date("2026-11-20T17:00:00Z"), TZ)).toBe("2026-11-20T18:00")
    expect(localToUtc("2026-13-01T18:00", TZ)).toBeNull()
    expect(dueLabel("2026-11-20T18:00")).toBe("пт, 20.11.2026, 18:00")
  })
})

describe("resolveDueText — past (a logged meeting / call)", () => {
  it("when it happened", () => {
    const p = (t: string) => resolveDueText(t, MON, TZ, { past: true })
    expect(p("вчера")).toBe("2026-11-15T12:00")
    expect(p("сегодня в 9:30")).toBe("2026-11-16T09:30")
    expect(p("в пятницу")).toBe("2026-11-13T12:00")
    expect(p("в понедельник")).toBe("2026-11-16T12:00")
    expect(p("12.11")).toBe("2026-11-12T12:00")
    expect(p("20 декабря")).toBe("2025-12-20T12:00")
  })
})

import { describe, expect, it } from "vitest"
import { facts, formatDate, parseDayInZone, formatDateTime, formatMoney, isoOrNull, nameList, shortText } from "./format"

const TZ = "Europe/Vienna"

describe("records format", () => {
  it("formats dates in the org time zone", () => {
    // 23:30 UTC on 15.11 is already 16.11 in Vienna (UTC+1).
    expect(formatDate("2026-11-15T23:30:00Z", TZ)).toBe("16.11.2026")
    expect(formatDateTime("2026-11-15T23:30:00Z", TZ)).toBe("16.11.2026, 00:30")
    expect(formatDate(null, TZ)).toBe("")
    expect(formatDate("not a date", TZ)).toBe("")
    expect(isoOrNull(new Date("2026-01-02T03:04:05Z"))).toBe("2026-01-02T03:04:05.000Z")
    expect(isoOrNull(undefined)).toBeNull()
  })

  it("formats money with the currency sign", () => {
    expect(formatMoney(1200, "RUB").replace(/\s/g, " ")).toBe("1 200 ₽")
    expect(formatMoney("15000.5", "eur").replace(/\s/g, " ")).toBe("15 000,5 €")
    expect(formatMoney(10, null).replace(/\s/g, " ")).toBe("10 ₽")
    expect(formatMoney(10, "PLN").replace(/\s/g, " ")).toBe("10 PLN")
    expect(formatMoney(null, "RUB")).toBe("")
    expect(formatMoney("abc", "RUB")).toBe("")
  })

  it("shortens text", () => {
    expect(shortText("  a \n b  ", 10)).toBe("a b")
    expect(shortText("abcdefghij", 5)).toBe("abcd…")
    expect(shortText(null, 5)).toBe("")
  })

  it("drops empty facts and caps them", () => {
    expect(
      facts([
        { label: "A", value: "1" },
        null,
        { label: "B", value: "  " },
        false,
        { label: "C", value: "3" },
        { label: "D", value: "4" },
        { label: "E", value: "5" },
      ]),
    ).toEqual([
      { label: "A", value: "1" },
      { label: "C", value: "3" },
      { label: "D", value: "4" },
    ])
  })

  it("lists names", () => {
    expect(nameList(["A", "", "B"])).toBe("A, B")
    expect(nameList(["A", "B", "C", "D", "E"])).toBe("A, B, C и ещё 2")
  })

  it("parses a day in the org time zone (DST-safe)", () => {
    // Vienna is UTC+1 in winter, UTC+2 in summer.
    expect(parseDayInZone("2026-11-16", TZ)?.toISOString()).toBe("2026-11-15T23:00:00.000Z")
    expect(parseDayInZone("2026-11-16", TZ, true)?.toISOString()).toBe("2026-11-16T22:59:59.999Z")
    expect(parseDayInZone("2026-07-01", TZ)?.toISOString()).toBe("2026-06-30T22:00:00.000Z")
    // 29.03.2026 = DST start: the day has 23 hours.
    expect(parseDayInZone("2026-03-29", TZ, true)?.toISOString()).toBe("2026-03-29T21:59:59.999Z")
    expect(parseDayInZone("2026-12-31", TZ, true)?.toISOString()).toBe("2026-12-31T22:59:59.999Z")
    expect(formatDate(parseDayInZone("2026-12-31", TZ, true), TZ)).toBe("31.12.2026")
    expect(parseDayInZone("2026-11-16T10:00:00Z", TZ)?.toISOString()).toBe("2026-11-16T10:00:00.000Z")
    expect(parseDayInZone("garbage", TZ)).toBeNull()
    expect(parseDayInZone("2026-13-01", TZ)).toBeNull()
    expect(parseDayInZone(undefined, TZ)).toBeNull()
  })
})

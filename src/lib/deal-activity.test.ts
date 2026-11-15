import { describe, expect, it } from "vitest"
import {
  DEFAULT_STALE_NORM_DAYS,
  daysSinceActivity,
  dealStaleInfo,
  effectiveStaleNorm,
  lastActivityHint,
  parseStaleNormInput,
  pickDealLastActivity,
} from "./deal-activity"

const NOW = new Date("2026-11-14T12:00:00Z")
const d = (iso: string) => new Date(iso)

describe("pickDealLastActivity", () => {
  it("a topic message wins, even when the deal's own activity is newer", () => {
    const r = pickDealLastActivity({
      topic: { at: d("2026-11-01T10:00:00Z"), topicId: "t1", topicTitle: "Acme — КП" },
      dealActivityAt: d("2026-11-10T10:00:00Z"),
      taskAt: null,
      dealCreatedAt: d("2026-10-01T00:00:00Z"),
    })
    expect(r).toEqual({
      at: d("2026-11-01T10:00:00Z"),
      source: "topic",
      topicId: "t1",
      topicTitle: "Acme — КП",
    })
  })

  it("no topic message → max of journal, tasks and creation", () => {
    const r = pickDealLastActivity({
      topic: null,
      dealActivityAt: d("2026-11-05T10:00:00Z"),
      taskAt: d("2026-11-07T10:00:00Z"),
      dealCreatedAt: d("2026-10-01T00:00:00Z"),
    })
    expect(r.source).toBe("deal")
    expect(r.at).toEqual(d("2026-11-07T10:00:00Z"))
    expect(r.topicTitle).toBeNull()
  })

  it("nothing but creation → created_at", () => {
    const r = pickDealLastActivity({
      topic: null,
      dealActivityAt: null,
      taskAt: null,
      dealCreatedAt: d("2026-10-01T00:00:00Z"),
    })
    expect(r).toMatchObject({ source: "deal", at: d("2026-10-01T00:00:00Z") })
  })

  it("never earlier than creation", () => {
    const r = pickDealLastActivity({
      topic: null,
      dealActivityAt: d("2026-09-01T00:00:00Z"),
      taskAt: null,
      dealCreatedAt: d("2026-10-01T00:00:00Z"),
    })
    expect(r.at).toEqual(d("2026-10-01T00:00:00Z"))
  })
})

describe("daysSinceActivity", () => {
  it("floors whole days", () => {
    expect(daysSinceActivity("2026-11-13T12:00:01Z", NOW)).toBe(0)
    expect(daysSinceActivity("2026-11-13T12:00:00Z", NOW)).toBe(1)
    expect(daysSinceActivity("2026-10-31T11:00:00Z", NOW)).toBe(14)
  })
  it("never negative, null for unknown", () => {
    expect(daysSinceActivity("2026-11-20T00:00:00Z", NOW)).toBe(0)
    expect(daysSinceActivity(null, NOW)).toBeNull()
    expect(daysSinceActivity("not a date", NOW)).toBeNull()
  })
})

describe("dealStaleInfo", () => {
  const base = {
    funnelStageRole: "active",
    status: "active",
    staleNormDays: null as number | null,
  }
  it("default norm 14, stale only when days > norm", () => {
    expect(effectiveStaleNorm(null)).toBe(DEFAULT_STALE_NORM_DAYS)
    expect(dealStaleInfo({ ...base, lastActivityAt: "2026-10-31T12:00:00Z" }, NOW)).toEqual({
      days: 14,
      norm: 14,
      isStale: false,
    })
    expect(dealStaleInfo({ ...base, lastActivityAt: "2026-10-30T12:00:00Z" }, NOW)?.isStale).toBe(true)
  })
  it("uses the stage norm", () => {
    const r = dealStaleInfo({ ...base, staleNormDays: 3, lastActivityAt: "2026-11-10T12:00:00Z" }, NOW)
    expect(r).toEqual({ days: 4, norm: 3, isStale: true })
  })
  it("hidden on terminal stages, paused / closed deals and unknown dates", () => {
    const at = "2026-09-01T00:00:00Z"
    expect(dealStaleInfo({ ...base, funnelStageRole: "won", lastActivityAt: at }, NOW)).toBeNull()
    expect(dealStaleInfo({ ...base, funnelStageRole: "lost", lastActivityAt: at }, NOW)).toBeNull()
    expect(dealStaleInfo({ ...base, status: "paused", lastActivityAt: at }, NOW)).toBeNull()
    expect(dealStaleInfo({ ...base, status: "cancelled", lastActivityAt: at }, NOW)).toBeNull()
    expect(dealStaleInfo({ ...base, lastActivityAt: null }, NOW)).toBeNull()
  })
})

describe("lastActivityHint", () => {
  it("topic source names the topic, norm optional", () => {
    const h = lastActivityHint(
      {
        lastActivityAt: "2026-11-03T10:00:00Z",
        lastActivitySource: "topic",
        lastActivityTopicTitle: "Acme — КП",
      },
      7,
    )
    expect(h).toBe("Последняя активность: 03.11.2026 · по теме «Acme — КП» · Норма стадии: 7 дн")
  })
  it("deal source", () => {
    expect(
      lastActivityHint({ lastActivityAt: "2026-11-03T10:00:00Z", lastActivitySource: "deal" }),
    ).toBe("Последняя активность: 03.11.2026 · по сделке")
    expect(lastActivityHint({ lastActivityAt: null })).toBeNull()
  })
})

describe("parseStaleNormInput", () => {
  it("empty = null (default), 1–365 whole numbers", () => {
    expect(parseStaleNormInput("")).toBeNull()
    expect(parseStaleNormInput(null)).toBeNull()
    expect(parseStaleNormInput(" 21 ")).toBe(21)
    expect(parseStaleNormInput(1)).toBe(1)
    expect(parseStaleNormInput(365)).toBe(365)
  })
  it("rejects the rest", () => {
    for (const v of ["0", "366", "1.5", "-3", "abc", 0, 366, 2.5, true]) {
      expect(parseStaleNormInput(v)).toBeUndefined()
    }
  })
})

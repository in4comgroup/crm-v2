import { describe, expect, it } from "vitest"
import { WorkCalendar } from "./attention-calendar"
import { ATTENTION_DEFAULTS } from "./attention-params"
import { DELIVERY_DEFAULTS } from "./delivery-params"
import {
  applyDailyLimit,
  dueDeliveryKinds,
  isRecipient,
  reminderMarker,
  splitWithDailyLimit,
  topicRecipient,
  weeklyReviewDay,
  type RoutableEntry,
} from "./delivery-routing"

const CAL = new WorkCalendar(
  [
    { day: "2026-11-03", isWorking: true, isShort: true },
    { day: "2026-11-04", isWorking: false, isShort: false },
    { day: "2026-11-20", isWorking: false, isShort: false }, // a test holiday Friday
  ],
  { timeZone: "Etc/GMT-3", workStart: "08:00", workEnd: "18:00" },
)
const msk = (s: string) => new Date(`${s.replace(" ", "T")}:00+03:00`)
const dayOf = (iso: string | null) => (iso ? CAL.localDay(new Date(iso)) : "0000-00-00")
const MEMBERS = new Set(["anna", "boris", "vera"])

function e(id: string, p: Partial<RoutableEntry> & { started?: string; profile?: string; esc?: string[]; list?: "now" | "digest" } = {}): RoutableEntry {
  return {
    topicId: id,
    ownerUserId: p.ownerUserId ?? null,
    dealOwnerUserId: p.dealOwnerUserId ?? null,
    attention: {
      list: p.list ?? "now",
      profile: p.profile ?? "P6",
      escalations: p.esc ?? [],
      cycleStartedAt: p.started ? msk(p.started).toISOString() : null,
      explanation: ["x", "итог: «Сейчас» (P6)"],
    },
  }
}

describe("routing", () => {
  it("assignee → deal owner → every member; non-members ignored", () => {
    expect(topicRecipient({ ownerUserId: "anna", dealOwnerUserId: "boris" }, MEMBERS)).toBe("anna")
    expect(topicRecipient({ ownerUserId: "gone", dealOwnerUserId: "boris" }, MEMBERS)).toBe("boris")
    expect(topicRecipient({ ownerUserId: null, dealOwnerUserId: "agent-x" }, MEMBERS)).toBeNull()
    expect(isRecipient({ ownerUserId: null, dealOwnerUserId: null }, "vera", MEMBERS)).toBe(true)
    expect(isRecipient({ ownerUserId: "anna", dealOwnerUserId: null }, "vera", MEMBERS)).toBe(false)
  })
})

describe("P6 daily limit (06 §7.2)", () => {
  it("≤ 3 distinct P6 topics per recipient per local day; overflow → «Сводка» top", () => {
    const now = [1, 2, 3, 4, 5].map((n) => e(`t${n}`, { ownerUserId: "anna", started: `2026-11-16 0${n + 3}:00` }))
    const digest = [e("d1", { ownerUserId: "anna", list: "digest", profile: "D4", started: "2026-11-16 09:00" })]
    const r = splitWithDailyLimit(now, digest, "anna", MEMBERS, 3, dayOf)
    expect(r.now.map((x) => x.topicId)).toEqual(["t1", "t2", "t3"])
    expect(r.digest.map((x) => x.topicId)).toEqual(["t4", "t5", "d1"])
    expect(r.digest[0].attention?.limited).toBe(true)
    expect(r.digest[0].attention?.explanation?.at(-1)).toBe("итог: «Сводка»")
  })

  it("first come first served: a later topic never pushes out an earlier one; earlier days keep their decision", () => {
    const rank = [
      e("late-high", { ownerUserId: "anna", started: "2026-11-16 15:00" }),
      e("a", { ownerUserId: "anna", started: "2026-11-16 09:00" }),
      e("b", { ownerUserId: "anna", started: "2026-11-16 10:00" }),
      e("c", { ownerUserId: "anna", started: "2026-11-16 11:00" }),
      e("old", { ownerUserId: "anna", started: "2026-11-13 11:00" }),
    ]
    const out = applyDailyLimit(rank, "anna", MEMBERS, 3, dayOf)
    expect(out.filter((x) => x.attention?.list === "now").map((x) => x.topicId)).toEqual(["a", "b", "c", "old"])
  })

  it("I1 / I5 / P8 are never limited; limit counts per recipient; unowned topics use the viewer", () => {
    const list = [
      ...[1, 2, 3].map((n) => e(`anna${n}`, { ownerUserId: "anna", started: `2026-11-16 0${n + 5}:00` })),
      e("urgent", { ownerUserId: "anna", started: "2026-11-16 12:00", esc: ["I1"] }),
      e("p8", { ownerUserId: "anna", started: "2026-11-16 12:30", profile: "P8" }),
      e("boris1", { ownerUserId: "boris", started: "2026-11-16 13:00" }),
      e("shared", { started: "2026-11-16 14:00" }),
    ]
    const forBoris = applyDailyLimit(list, "boris", MEMBERS, 3, dayOf)
    expect(forBoris.every((x) => x.attention?.list === "now")).toBe(true)
    const forAnna = applyDailyLimit(list, "anna", MEMBERS, 3, dayOf)
    expect(forAnna.find((x) => x.topicId === "shared")?.attention?.list).toBe("digest")
    expect(applyDailyLimit(list, "anna", MEMBERS, 0, dayOf)).toEqual(list)
  })
})

describe("schedule", () => {
  const ap = ATTENTION_DEFAULTS
  const dp = DELIVERY_DEFAULTS
  it("morning 07:30, evening 17:00 on working days, inside the send window", () => {
    expect(dueDeliveryKinds(msk("2026-11-16 07:00"), CAL, ap, dp)).toEqual([])
    expect(dueDeliveryKinds(msk("2026-11-16 08:00"), CAL, ap, dp)).toEqual(["morning_digest"])
    expect(dueDeliveryKinds(msk("2026-11-16 12:00"), CAL, ap, dp)).toEqual([])
    expect(dueDeliveryKinds(msk("2026-11-16 17:05"), CAL, ap, dp)).toEqual(["evening_reminder"])
    expect(dueDeliveryKinds(msk("2026-11-04 08:00"), CAL, ap, dp)).toEqual([]) // holiday
    expect(dueDeliveryKinds(msk("2026-11-14 08:00"), CAL, ap, dp)).toEqual([]) // Saturday
  })
  it("weekly: Friday 12:00, or the last working day before a holiday Friday", () => {
    expect(weeklyReviewDay(CAL, "2026-11-11", 5)).toBe("2026-11-13")
    expect(dueDeliveryKinds(msk("2026-11-13 12:10"), CAL, ap, dp)).toEqual(["weekly_digest"]) // morning window (4 h) is over
    expect(weeklyReviewDay(CAL, "2026-11-18", 5)).toBe("2026-11-19")
    expect(dueDeliveryKinds(msk("2026-11-19 12:00"), CAL, ap, dp)).toContain("weekly_digest")
    expect(dueDeliveryKinds(msk("2026-11-20 12:00"), CAL, ap, dp)).toEqual([])
  })
})

describe("reminder marker", () => {
  it("shows the last reminder of this cycle for 24 h", () => {
    const base = { cycleStartedAt: msk("2026-11-16 10:00"), cycleReminders: 2 }
    expect(reminderMarker({ ...base, lastReminderAt: msk("2026-11-17 17:00") }, msk("2026-11-18 09:00"))).toEqual({
      count: 2,
      at: msk("2026-11-17 17:00").toISOString(),
    })
    expect(reminderMarker({ ...base, lastReminderAt: msk("2026-11-17 17:00") }, msk("2026-11-18 18:00"))).toBeNull()
    expect(reminderMarker({ ...base, cycleStartedAt: msk("2026-11-18 08:00"), lastReminderAt: msk("2026-11-17 17:00") }, msk("2026-11-18 09:00"))).toBeNull()
  })
})

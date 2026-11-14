// Attention engine: acceptance tests of 06 §16 and worked examples of §14.
import { describe, expect, it } from "vitest"
import type { SignalClass, SignalKind } from "@/lib/signals/types"
import type { TopicAttention } from "@/lib/topics/attention-types"
import { WorkCalendar } from "@/lib/topics/attention-calendar"
import { ATTENTION_DEFAULTS, mergeAttentionParams, type AttentionParams } from "@/lib/topics/attention-params"
import { DELIVERY_DEFAULTS } from "@/lib/topics/delivery-params"
import { cycleRemindersAfter, eveningReminderDue } from "@/lib/topics/delivery-routing"
import type { CodeBook, CodeInfo } from "../model"
import { makeBook } from "../test-fixtures"
import {
  IMPATIENT_ATTRIBUTE,
  computeAttention,
  placeStoredAttention,
  type AttentionEnv,
  type AttentionInstance,
  type AttentionItem,
  type AttentionTopicInput,
  type DeadlineOwner,
} from "./engine"

// ── Fixtures ──────────────────────────────────────────────────────────────

type Extra = Partial<CodeInfo> & { family: string; weight: number }
const EXTRA: Record<string, Extra> = {
  COMPLAINT_QUALITY: { family: "complaint", weight: 7, class: "risk", asksUs: true, effort: "medium" },
  COMPLAINT_ESCALATED: { family: "complaint", weight: 8, class: "risk", effort: "medium" },
  FEEDBACK_QUALITY_PRAISE: { family: "feedback", weight: 3, class: "chance", effort: "quick" },
  SALES_CATALOG_REQUESTED: { family: "offer", weight: 5, class: "chance", asksUs: true, effort: "quick" },
  ACCOUNT_REVENUE_DECLINE_YOY: { family: "account", weight: 5, class: "risk", kind: "trend" },
  ORDER_CHANGE_REQUESTED: { family: "order", weight: 6, class: "chance", asksUs: true, effort: "quick" },
  DELIVERY_SCHEDULE_REQUEST: { family: "delivery", weight: 4, class: "chance", asksUs: true, effort: "quick" },
  ORDER_CONFIRMED: {
    family: "order",
    weight: 0,
    kind: "state",
    scoreRule: "state",
    closesCodes: ["ORDER_REQUESTED", "ORDER_CHANGE_REQUESTED"],
  },
  ORDER_CONFIRMED_PARTIAL: { family: "order", weight: 0, kind: "state", scoreRule: "state", closesCodes: ["ORDER_REQUESTED"] },
  DOCS_REQUEST: { family: "contract", weight: 2, class: "fyi", effort: "medium" },
}

function bookWith(overrides: Record<string, Partial<CodeInfo>> = {}): CodeBook {
  const b = makeBook()
  let order = b.size
  for (const [code, s] of Object.entries(EXTRA)) {
    b.set(code, {
      code,
      labelRu: code,
      kind: (s.kind ?? "event") as SignalKind,
      scoreRule: s.scoreRule ?? "fixed",
      class: (s.class ?? null) as SignalClass | null,
      classByRelation: false,
      asksUs: s.asksUs ?? false,
      effort: s.effort ?? null,
      relevanceDays: s.relevanceDays ?? null,
      closesCodes: s.closesCodes ?? [],
      family: s.family,
      weight: s.weight,
      order: order++,
    })
  }
  for (const [code, o] of Object.entries(overrides)) b.set(code, { ...b.get(code)!, ...o })
  return b
}

const BOOK = bookWith()
// Exceptions of the 2026 Russian production calendar used by the tests.
const CAL_DAYS = [
  { day: "2026-11-03", isWorking: true, isShort: true },
  { day: "2026-11-04", isWorking: false, isShort: false },
]
const CAL = new WorkCalendar(CAL_DAYS, { timeZone: "Europe/Moscow", workStart: "08:00", workEnd: "18:00" })
const PLAIN_CAL = new WorkCalendar([], { timeZone: "Europe/Moscow", workStart: "08:00", workEnd: "18:00" })
const RELATIONS = [{ kind: "dampens", codeA: "PAYMENT_PROMISE", codeB: "INVOICE_OVERDUE" }]

const msk = (s: string) => new Date(`${s.replace(" ", "T")}:00+03:00`)

function env(now: string, p: Partial<AttentionEnv> & { params?: AttentionParams } = {}): AttentionEnv {
  return {
    book: BOOK,
    profiles: new Map(),
    relations: RELATIONS,
    params: ATTENTION_DEFAULTS,
    calendar: CAL,
    ...p,
    now: msk(now),
  }
}

let seq = 0
function ai(code: string, at: string, p: Partial<AttentionInstance> = {}): AttentionInstance {
  const info = BOOK.get(code)!
  const state = info.kind === "state"
  return {
    id: `i${++seq}-${code}`,
    code,
    itemId: `item-${at}`,
    itemDate: msk(at),
    confidence: "high",
    counted: !state,
    scoreContrib: state ? 0 : info.weight,
    deadlines: [],
    dominant: true,
    ...p,
  }
}

function itm(at: string, direction: AttentionItem["direction"] = "inbound", deadlines: [string, DeadlineOwner][] = []): AttentionItem {
  return { itemId: `item-${at}`, date: msk(at), direction, deadlines: deadlines.map(([date, owner]) => ({ date, owner })) }
}

function topic(p: Partial<AttentionTopicInput> & Pick<AttentionTopicInput, "instances">): AttentionTopicInput {
  const items = p.items ?? [...new Set(p.instances.map((i) => i.itemId!))].map((id) => itm(id.replace("item-", "")))
  const last = Math.max(...items.map((i) => i.date.getTime()))
  return {
    id: "t1",
    status: "open",
    subState: "none",
    lastActivityAt: new Date(last),
    snoozedUntil: null,
    snoozedAt: null,
    relation: "active",
    cycleStartedAt: null,
    cycleReason: null,
    prev: null,
    ...p,
    items,
  }
}

/** Run a step with the previous result fed back (like the store does). */
function step(t: AttentionTopicInput, now: string, prev: TopicAttention | null, e: Partial<AttentionEnv> = {}) {
  return computeAttention(
    { ...t, prev, cycleStartedAt: prev?.cycleStartedAt ? new Date(prev.cycleStartedAt) : null, cycleReason: prev?.cycleReason ?? null },
    env(now, e),
  )
}

const noBoosts = mergeAttentionParams({ boostReminder: false, boostOverdueReaction: false, boostCorroboration: false })

// ── 06 §16 acceptance tests ───────────────────────────────────────────────

describe("06 §16 acceptance", () => {
  it("1 MAX: 7 + 6 + 5, boosts off → 7", () => {
    const t = topic({
      instances: [
        ai("SALES_OFFER_REQUESTED", "2026-11-16 10:00"),
        ai("SALES_PRICE_REQUEST", "2026-11-16 11:00"),
        ai("ORDER_REQUESTED", "2026-11-16 12:00"),
      ],
    })
    const a = computeAttention(t, env("2026-11-16 13:00", { params: noBoosts }))
    expect(a.score).toBe(7)
    expect(a.leadCode).toBe("SALES_OFFER_REQUESTED")
    expect(a.list).toBe("now")
    expect(a.boosts).toEqual([])
  })

  it("2 attribute +2 only on the dominant instance", () => {
    const attrs = { itemAttrs: [{ code: "ATTR_EMOTION_ANGRY", weight: 2 }], itemAttrAdj: 2 }
    const dom = ai("INVOICE_OVERDUE", "2026-11-16 10:00", { scoreContrib: 9, ...attrs })
    const other = ai("DELIVERY_DISCREPANCY", "2026-11-16 10:00", { dominant: false, ...attrs })
    expect(computeAttention(topic({ instances: [dom] }), env("2026-11-16 11:00")).score).toBe(9)
    expect(computeAttention(topic({ id: "t2", instances: [other] }), env("2026-11-16 11:00")).score).toBe(7)
  })

  it("3 low confidence only → band none, list none", () => {
    const t = topic({ instances: [ai("INVOICE_OVERDUE", "2026-11-16 10:00", { confidence: "low", counted: false, scoreContrib: 0 })] })
    const a = computeAttention(t, env("2026-11-16 11:00"))
    expect(a.band).toBe("none")
    expect(a.list).toBe("none")
    expect(a.hiddenReason).toBe("no_active_signal")
  })

  it("4 state code closes only its codes on the same topic", () => {
    const closed = topic({
      instances: [ai("SALES_OFFER_REQUESTED", "2026-11-16 10:00"), ai("SALES_OFFER_SENT", "2026-11-17 10:00")],
      items: [itm("2026-11-16 10:00"), itm("2026-11-17 10:00", "outbound")],
    })
    const other = topic({ id: "t2", instances: [ai("SALES_OFFER_REQUESTED", "2026-11-16 10:00")] })
    expect(computeAttention(closed, env("2026-11-17 11:00")).list).toBe("none")
    const b = computeAttention(other, env("2026-11-17 11:00"))
    expect(b.list).toBe("now")
    expect(b.score).toBe(7)
  })

  it("5 reminder: inbound repeat → +1; with an outbound between → +0", () => {
    const req = ai("ORDER_REQUESTED", "2026-11-16 10:00")
    const rep = ai("ORDER_REQUESTED", "2026-11-16 15:00")
    const a = computeAttention(topic({ subState: "waiting_on_us", instances: [req, rep] }), env("2026-11-16 16:00"))
    expect(a.boosts).toEqual([{ code: "R", points: 1 }])
    expect(a.score).toBe(6)
    const b = computeAttention(
      topic({
        subState: "waiting_on_us",
        instances: [req, rep],
        items: [itm("2026-11-16 10:00"), itm("2026-11-16 12:00", "outbound"), itm("2026-11-16 15:00")],
      }),
      env("2026-11-16 16:00"),
    )
    expect(b.boosts.find((x) => x.code === "R")).toBeUndefined()
    expect(b.score).toBe(5)
  })

  it("6 boost cap: R2 + O1 + C1 → +2", () => {
    const t = topic({
      subState: "waiting_on_us",
      instances: [
        ai("DELIVERY_DISCREPANCY", "2026-11-16 10:00"),
        ai("DELIVERY_DISCREPANCY", "2026-11-17 10:00", { dominant: false }),
        ai("COMPLAINT_QUALITY", "2026-11-17 10:00"),
        ai("DELIVERY_DISCREPANCY", "2026-11-18 09:00"),
      ],
    })
    const a = computeAttention(t, env("2026-11-18 12:00"))
    expect(a.boosts).toEqual([
      { code: "R", points: 2 },
      { code: "O", points: 1 },
      { code: "C", points: 1 },
    ])
    expect(a.score).toBe(9)
    expect(a.explanation.join(" ")).toContain("надбавки не больше +2")
  })

  it("7 trend lead + attribute +2 + immediate deadline → score 5, «Сводка»", () => {
    const t = topic({
      instances: [ai("ACCOUNT_REVENUE_DECLINE_YOY", "2026-11-16 10:00", { scoreContrib: 7 })],
      items: [itm("2026-11-16 10:00", "inbound", [["2026-11-16", "us"]])],
    })
    const a = computeAttention(t, env("2026-11-16 12:00"))
    expect(a.score).toBe(5)
    expect(a.escalations).toContain("I1")
    expect(a.list).toBe("digest")
  })

  it("8 explicit profile D4 on a weight-7 code + attribute +2 → P6", () => {
    const t = topic({ instances: [ai("SALES_OFFER_REQUESTED", "2026-11-16 10:00", { scoreContrib: 9 })] })
    const a = computeAttention(t, env("2026-11-16 11:00", { profiles: new Map([["SALES_OFFER_REQUESTED", "D4"]]) }))
    expect(a.baseProfile).toBe("P6")
    expect(a.list).toBe("now")
  })

  it("9 waiting_on_them P8 → P6; plus a dampener → still P6", () => {
    const lead = ai("INVOICE_OVERDUE", "2026-11-16 10:00", { scoreContrib: 9 })
    const items = [itm("2026-11-16 10:00"), itm("2026-11-16 12:00", "outbound")]
    const a = computeAttention(topic({ subState: "waiting_on_them", instances: [lead], items }), env("2026-11-16 13:00"))
    expect(a.baseProfile).toBe("P8")
    expect(a.profile).toBe("P6")
    const promise = ai("PAYMENT_PROMISE", "2026-11-16 11:00", { deadlines: ["2026-11-19"] })
    const b = computeAttention(
      topic({ subState: "waiting_on_them", instances: [lead, promise], items: [...items, itm("2026-11-16 11:00")] }),
      env("2026-11-16 13:00"),
    )
    expect(b.profile).toBe("P6")
    expect(b.adjustments?.map((x) => x.rule)).toEqual(["H3", "H4"])
  })

  it("10 deadline < 24 h on a D4 topic → «Сейчас»; owner them → no escalation", () => {
    const mk = (owner: DeadlineOwner) =>
      topic({
        instances: [ai("ORDER_REQUESTED", "2026-11-16 10:00")],
        items: [itm("2026-11-16 10:00", "inbound", [["2026-11-17", owner]])],
      })
    const a = computeAttention(mk("us"), env("2026-11-16 19:00"))
    expect(a.escalations).toEqual(["I1"])
    expect(a.list).toBe("now")
    expect(a.score).toBe(5)
    const b = computeAttention(mk("them"), env("2026-11-16 19:00"))
    expect(b.escalations).toEqual([])
    expect(b.list).toBe("digest")
  })

  it("11 I3: medium effort, 3 working days (holiday 04.11 moved) → at least D4, one new cycle", () => {
    const t = topic({
      instances: [ai("DOCS_REQUEST", "2026-10-27 10:00")],
      items: [itm("2026-10-27 10:00", "inbound", [["2026-11-06", "us"]])],
    })
    const a1 = step(t, "2026-10-28 10:00", null)
    expect(a1.list).toBe("week")
    const a2 = step(t, "2026-11-02 10:00", a1)
    expect(a2.escalations).toContain("I3")
    expect(a2.list).toBe("digest")
    expect(a2.cycleStarted).toBe(true)
    expect(a2.cycleReason).toBe("deadline_lead")
    const a3 = step(t, "2026-11-02 14:00", a2)
    expect(a3.list).toBe("digest")
    expect(a3.cycleStarted).toBe(false)
    // Without the holiday the deadline is 4 working days away → no I3.
    const plain = step(t, "2026-11-02 10:00", a1, { calendar: PLAIN_CAL })
    expect(plain.escalations).toEqual([])
    expect(plain.list).toBe("week")
  })

  it("12 evening reminders stop after 3 per cycle; a material change resets the counter; a NOOP item does not", () => {
    const req = ai("SALES_OFFER_REQUESTED", "2026-11-16 10:00")
    let t = topic({ subState: "waiting_on_us", instances: [req] })
    let a = step(t, "2026-11-16 10:05", null)
    expect([a.profile, a.list]).toEqual(["P6", "now"])
    // Store + delivery phase in miniature: recompute (counter reset on a new
    // cycle), then the evening check marks the topic once per evening.
    let reminders = cycleRemindersAfter(0, a)
    let last: Date | null = null
    const evening = (at: string) => {
      a = step(t, at, a)
      reminders = cycleRemindersAfter(reminders, a)
      const now = msk(at)
      const due = eveningReminderDue(
        { status: "open", subState: t.subState, attention: a, cycleReminders: reminders, lastReminderAt: last },
        now,
        (d) => CAL.localDay(d),
        DELIVERY_DEFAULTS.p6RepeatMax,
      )
      if (due) {
        reminders++
        last = now
      }
      return due
    }
    expect(evening("2026-11-16 17:00")).toBe(true)
    expect(evening("2026-11-16 18:00")).toBe(false) // once per evening
    expect(evening("2026-11-17 17:00")).toBe(true)
    expect(evening("2026-11-18 17:00")).toBe(true)
    expect(reminders).toBe(3)
    // A NOOP item («Спасибо, получили»: no counted code) is not material.
    t = { ...t, items: [...t.items, itm("2026-11-19 12:00")], lastActivityAt: msk("2026-11-19 12:00") }
    expect(evening("2026-11-19 17:00")).toBe(false)
    expect(a.cycleStarted).toBe(false)
    expect(reminders).toBe(3)
    // The client chases (boost R, material) → new cycle → reminders again.
    const chase = ai("SALES_OFFER_REQUESTED", "2026-11-20 10:00")
    t = topic({ subState: "waiting_on_us", instances: [req, chase] })
    a = step(t, "2026-11-20 10:05", a)
    expect(a.cycleStarted).toBe(true)
    reminders = cycleRemindersAfter(reminders, a)
    expect(reminders).toBe(0)
    expect(evening("2026-11-20 17:00")).toBe(true)
    expect(reminders).toBe(1)
    // D4 topics never get evening reminders; waiting on them neither.
    const d4 = step(topic({ subState: "waiting_on_us", instances: [ai("ORDER_REQUESTED", "2026-11-16 10:00")] }), "2026-11-16 17:00", null)
    expect(d4.list).toBe("digest")
    const off = { status: "open", cycleReminders: 0, lastReminderAt: null }
    expect(eveningReminderDue({ ...off, subState: "waiting_on_us", attention: d4 }, msk("2026-11-16 17:00"), (d) => CAL.localDay(d), 3)).toBe(false)
    expect(eveningReminderDue({ ...off, subState: "waiting_on_them", attention: a }, msk("2026-11-23 17:00"), (d) => CAL.localDay(d), 3)).toBe(false)
  })

  it("13 expiry: P6 cycle, 7 working days → «Неделя / Истекло» for 7 days, then only «Все темы»", () => {
    const t = topic({ instances: [ai("DELIVERY_DISCREPANCY", "2026-11-16 10:00")] })
    const a1 = step(t, "2026-11-16 10:00", null)
    expect(a1.list).toBe("now")
    expect(a1.cardExpiresAt).toBe(msk("2026-11-25 10:00").toISOString())
    const a2 = step(t, "2026-11-25 11:00", a1)
    expect(a2.list).toBe("week")
    expect(a2.section).toBe("expired")
    const a3 = step(t, "2026-12-02 11:00", a2)
    expect(a3.list).toBe("none")
    expect(a3.hiddenReason).toBe("card_expired")
  })

  it("14 snooze hides the topic; a new counted code ends it", () => {
    const base = ai("SALES_PRICE_REQUEST", "2026-11-16 10:00")
    const snooze = { snoozedUntil: msk("2026-12-01 08:00"), snoozedAt: msk("2026-11-17 10:00") }
    const a1 = step(topic({ instances: [base], ...snooze }), "2026-11-17 11:00", null)
    expect(a1.list).toBe("none")
    expect(a1.hiddenReason).toBe("snoozed")
    const a2 = step(topic({ instances: [base, ai("ORDER_REQUESTED", "2026-11-25 10:00")], ...snooze }), "2026-11-25 11:00", a1)
    expect(a2.list).toBe("now")
    expect(a2.cycleStarted).toBe(true)
    expect(a2.cycleReason).toBe("snooze_end")
  })

  it("15 weight change does not change stored instance scores; profiles recompute", () => {
    const t = topic({ instances: [ai("SALES_OFFER_REQUESTED", "2026-11-16 10:00")] })
    const profiles = new Map([["SALES_OFFER_REQUESTED", "P6" as const]])
    const a = computeAttention(t, env("2026-11-16 11:00", { profiles }))
    const b = computeAttention(t, env("2026-11-16 11:00", { profiles, book: bookWith({ SALES_OFFER_REQUESTED: { weight: 3 } }) }))
    expect(b.score).toBe(a.score)
    expect(a.profile).toBe("P6")
    expect(b.profile).toBe("P8")
  })

  it("16 same inputs twice → identical attention", () => {
    const t = topic({
      subState: "waiting_on_us",
      instances: [ai("DELIVERY_DISCREPANCY", "2026-11-16 10:00"), ai("DELIVERY_DISCREPANCY", "2026-11-17 10:00")],
      items: [itm("2026-11-16 10:00", "inbound", [["2026-11-20", "us"]]), itm("2026-11-17 10:00")],
    })
    expect(computeAttention(t, env("2026-11-18 12:00"))).toEqual(computeAttention(t, env("2026-11-18 12:00")))
  })

  it("17 impatient tone on a repeated asks-us code → only boost R +1 (R19)", () => {
    const t = topic({
      subState: "waiting_on_us",
      instances: [
        ai("SALES_OFFER_REQUESTED", "2026-11-16 10:00"),
        ai("SALES_OFFER_REQUESTED", "2026-11-17 15:00", {
          scoreContrib: 8,
          itemAttrs: [{ code: IMPATIENT_ATTRIBUTE, weight: 1 }],
          itemAttrAdj: 1,
        }),
      ],
    })
    const a = computeAttention(t, env("2026-11-17 16:00"))
    expect(a.baseScore).toBe(7)
    expect(a.score).toBe(8)
    expect(a.boosts).toEqual([{ code: "R", points: 1 }])
  })

  it("18 deal risk severity 7 → «Сейчас», new cycle, score unchanged; cleared → own list (R17)", () => {
    const inst = ai("ORDER_REQUESTED", "2026-11-16 10:00")
    const a1 = step(topic({ instances: [inst] }), "2026-11-16 11:00", null)
    expect(a1.list).toBe("digest")
    const risky = topic({ instances: [inst], dealRisks: [{ triggerInstanceId: inst.id, severity: 7, active: true }] })
    const a2 = step(risky, "2026-11-16 12:00", a1)
    expect(a2.list).toBe("now")
    expect(a2.escalations).toContain("I5")
    expect(a2.score).toBe(5)
    expect(a2.cycleReason).toBe("deal_risk")
    const cleared = topic({ instances: [inst], dealRisks: [{ triggerInstanceId: inst.id, severity: 7, active: false }] })
    expect(step(cleared, "2026-11-16 13:00", a2).list).toBe("digest")
  })

  it("19 closing code only (no counted code) → no list entry", () => {
    const t = topic({ instances: [ai("DELIVERY_DISCREPANCY_RESOLVED", "2026-11-16 10:00")] })
    const a = computeAttention(t, env("2026-11-16 11:00"))
    expect(a.list).toBe("none")
    expect(a.leadCode).toBeNull()
  })

  it("20 read-time check: a D4 topic whose deadline comes within 24 h shows in «Сейчас»", () => {
    const t = topic({
      instances: [ai("ORDER_REQUESTED", "2026-11-16 10:00")],
      items: [itm("2026-11-16 10:00", "inbound", [["2026-11-17T16:00", "us"]])],
    })
    const a = computeAttention(t, env("2026-11-16 10:00"))
    expect(a.list).toBe("digest")
    const read = placeStoredAttention(a, msk("2026-11-16 18:00"), CAL, ATTENTION_DEFAULTS)
    expect(read.list).toBe("now")
    expect(read.escalations).toEqual(["I1"])
    expect(read.score).toBe(a.score)
  })
})

// ── 06 §14 worked examples ────────────────────────────────────────────────

describe("06 §14 worked examples", () => {
  it("E1 offer request with a reminder", () => {
    const req = ai("SALES_OFFER_REQUESTED", "2026-11-16 10:00")
    const a1 = step(topic({ subState: "waiting_on_us", instances: [req] }), "2026-11-16 10:05", null)
    expect([a1.score, a1.profile, a1.list]).toEqual([7, "P6", "now"])
    const rem = ai("SALES_OFFER_REQUESTED", "2026-11-17 15:00", {
      scoreContrib: 8,
      itemAttrs: [{ code: IMPATIENT_ATTRIBUTE, weight: 1 }],
      itemAttrAdj: 1,
    })
    const a2 = step(topic({ subState: "waiting_on_us", instances: [req, rem] }), "2026-11-17 15:05", a1)
    expect([a2.score, a2.profile, a2.list]).toEqual([8, "P8", "now"])
    expect(a2.cycleStarted).toBe(true)
    expect(a2.cycleReason).toBe("reminder")
    expect(a2.explanation.join("; ")).toContain("клиент напомнил (+1)")
    const sent = ai("SALES_OFFER_SENT", "2026-11-18 09:00")
    const t3 = topic({
      instances: [req, rem, sent],
      items: [itm("2026-11-16 10:00"), itm("2026-11-17 15:00"), itm("2026-11-18 09:00", "outbound")],
    })
    expect(step(t3, "2026-11-18 09:05", a2).list).toBe("none")
    expect(step({ ...t3, status: "resolved" }, "2026-11-18 09:05", a2).hiddenReason).toBe("status")
  })

  it("E2 overdue invoice, promise, payment", () => {
    const inv = ai("INVOICE_OVERDUE", "2026-11-16 10:00", { scoreContrib: 9 })
    const a1 = step(topic({ instances: [inv] }), "2026-11-16 10:05", null)
    expect([a1.score, a1.profile]).toEqual([9, "P8"])
    const promise = ai("PAYMENT_PROMISE", "2026-11-17 10:00", { deadlines: ["2026-11-19"] })
    const items = [itm("2026-11-16 10:00"), itm("2026-11-17 10:00", "inbound", [["2026-11-19", "them"]])]
    const t2 = topic({ instances: [inv, promise], items })
    const a2 = step(t2, "2026-11-17 10:05", a1)
    expect([a2.score, a2.profile, a2.list]).toEqual([9, "P6", "now"])
    // Promise date + 1 working day = Fri 20.11 08:00: the dampener ends, new cycle.
    const a3 = step(t2, "2026-11-20 09:00", a2)
    expect([a3.score, a3.profile]).toEqual([9, "P8"])
    expect(a3.cycleReason).toBe("dampener_end")
    const paid = ai("INVOICE_PAID", "2026-11-23 10:00")
    expect(step(topic({ instances: [inv, promise, paid] }), "2026-11-23 10:05", a3).list).toBe("none")
  })

  it("E3 delivery discrepancy", () => {
    const d1 = ai("DELIVERY_DISCREPANCY", "2026-11-16 10:00")
    const a1 = step(topic({ subState: "waiting_on_us", instances: [d1] }), "2026-11-16 11:00", null)
    expect([a1.score, a1.profile]).toEqual([7, "P6"])
    const a2 = step(topic({ subState: "waiting_on_us", instances: [d1] }), "2026-11-18 11:00", a1)
    expect([a2.score, a2.profile]).toEqual([8, "P8"])
    expect(a2.boosts).toEqual([{ code: "O", points: 1 }])
    const d2 = ai("DELIVERY_DISCREPANCY", "2026-11-18 12:00", { dominant: false })
    const a3 = step(topic({ subState: "waiting_on_us", instances: [d1, d2] }), "2026-11-18 12:05", a2)
    expect([a3.score, a3.profile]).toEqual([9, "P8"])
    expect(a3.cycleReason).toBe("reminder")
    const items = [itm("2026-11-16 10:00"), itm("2026-11-18 12:00"), itm("2026-11-23 10:00", "outbound", [["2026-11-26", "us"]])]
    const t4 = topic({ subState: "waiting_on_them", instances: [d1, d2], items })
    const a4 = step(t4, "2026-11-23 10:30", a3)
    expect([a4.score, a4.profile, a4.list]).toEqual([7, "D4", "digest"])
    expect(a4.escalations).toEqual(["I3"])
    const a5 = step(t4, "2026-11-25 18:00", a4)
    expect(a5.list).toBe("now")
    expect(a5.escalations).toContain("I1")
    const closed = topic({ instances: [d1, d2, ai("DELIVERY_DISCREPANCY_RESOLVED", "2026-11-26 12:00")] })
    expect(step(closed, "2026-11-26 12:05", a5).list).toBe("none")
  })

  it("E4 complaint plus praise, then escalation", () => {
    const c1 = ai("COMPLAINT_QUALITY", "2026-11-16 10:00", { scoreContrib: 8 })
    const a1 = step(topic({ subState: "waiting_on_us", instances: [c1] }), "2026-11-16 10:05", null)
    expect([a1.score, a1.profile]).toEqual([8, "P8"])
    const praise = computeAttention(topic({ id: "t2", instances: [ai("FEEDBACK_QUALITY_PRAISE", "2026-11-16 11:00")] }), env("2026-11-16 11:05"))
    expect(praise.list).toBe("week")
    const c2 = ai("COMPLAINT_ESCALATED", "2026-11-16 12:00")
    const a2 = step(topic({ subState: "waiting_on_us", instances: [c1, c2] }), "2026-11-16 12:05", a1)
    expect(a2.score).toBe(10)
    expect(a2.band).toBe("critical")
    expect(a2.boosts.map((b) => b.code)).toEqual(["R", "C"])
    expect(a2.cycleStarted).toBe(true)
  })

  it("E5 low-weight request with an urgent deadline", () => {
    const t = topic({
      instances: [ai("SALES_CATALOG_REQUESTED", "2026-11-16 14:00")],
      items: [itm("2026-11-16 14:00", "inbound", [["2026-11-17T10:00", "us"]])],
    })
    const a = computeAttention(t, env("2026-11-16 14:05"))
    expect([a.score, a.list]).toEqual([5, "now"])
    expect(a.explanation.join("; ")).toContain("срок < 24 ч")
  })

  it("E6 trend ceiling: no escalation lifts a trend into «Сейчас»", () => {
    const inst = ai("ACCOUNT_REVENUE_DECLINE_YOY", "2026-11-16 10:00")
    const t = topic({ instances: [inst], dealRisks: [{ triggerInstanceId: inst.id, severity: 9, active: true }] })
    const a = computeAttention(t, env("2026-11-16 10:05"))
    expect([a.score, a.list]).toEqual([5, "digest"])
  })

  it("E7 partial closing and reopen", () => {
    const o1 = ai("ORDER_REQUESTED", "2026-11-16 10:00")
    const o2 = ai("ORDER_CHANGE_REQUESTED", "2026-11-16 11:00")
    const a1 = step(topic({ instances: [o1, o2] }), "2026-11-16 11:05", null)
    expect([a1.score, a1.list]).toEqual([6, "now"])
    const conf = ai("ORDER_CONFIRMED", "2026-11-16 15:00")
    expect(step(topic({ instances: [o1, o2, conf] }), "2026-11-16 15:05", a1).list).toBe("none")
    // §8 partial closing: the delivery-window question stays → base 4, «Сводка».
    const ds = ai("DELIVERY_SCHEDULE_REQUEST", "2026-11-16 10:30")
    const part = ai("ORDER_CONFIRMED_PARTIAL", "2026-11-16 15:00")
    const b = computeAttention(topic({ instances: [o1, ds, part] }), env("2026-11-16 15:05"))
    expect([b.score, b.list]).toEqual([4, "digest"])
    // «отгрузите сегодня»: same-day deadline → I1.
    const today = topic({
      instances: [ai("ORDER_REQUESTED", "2026-11-17 09:00")],
      items: [itm("2026-11-17 09:00", "inbound", [["2026-11-17", "us"]])],
    })
    expect(computeAttention(today, env("2026-11-17 09:05")).list).toBe("now")
  })

  it("E8 stale signal, then dormant once in «Неделя»", () => {
    const pr = ai("SALES_PRICE_REQUEST", "2026-11-02 10:00")
    const a1 = step(topic({ subState: "waiting_on_us", instances: [pr] }), "2026-11-05 10:00", null)
    expect(a1.score).toBe(7) // boost O after 1 working day (quick)
    const a2 = step(topic({ subState: "waiting_on_us", instances: [pr] }), "2026-11-17 10:00", a1)
    expect(a2.list).toBe("none")
    expect(a2.hiddenReason).toBe("no_active_signal")
    const dormant = topic({ status: "dormant", instances: [pr] })
    const a3 = step(dormant, "2026-11-24 10:00", a2)
    expect(a3.list).toBe("week")
    expect(a3.section).toBe("dormant")
    const a4 = step(dormant, "2026-12-05 10:00", a3)
    expect(a4.list).toBe("none")
    expect(a4.hiddenReason).toBe("dormant")
  })

  it("E9 snooze ends early on a new counted code", () => {
    const base = ai("SALES_PRICE_REQUEST", "2026-11-16 10:00")
    const a0 = step(topic({ instances: [base] }), "2026-11-16 10:05", null)
    expect(a0.profile).toBe("P6")
    const snooze = { snoozedUntil: msk("2026-12-01 08:00"), snoozedAt: msk("2026-11-17 10:00") }
    const a1 = step(topic({ instances: [base], ...snooze }), "2026-11-17 10:05", a0)
    expect(a1.list).toBe("none")
    const a2 = step(topic({ instances: [base, ai("SALES_OFFER_REQUESTED", "2026-11-25 10:00")], ...snooze }), "2026-11-25 10:05", a1)
    expect(a2.list).toBe("now")
    expect(a2.cycleReason).toBe("snooze_end")
  })
})

describe("next check and rank", () => {
  it("nextCheckAt is the earliest future threshold", () => {
    const t = topic({
      instances: [ai("ORDER_REQUESTED", "2026-11-16 10:00")],
      items: [itm("2026-11-16 10:00", "inbound", [["2026-11-17T16:00", "us"]])],
    })
    const a = computeAttention(t, env("2026-11-16 10:00"))
    // I1 threshold (16:00 − 24 h) comes before the next morning digest.
    expect(a.nextCheckAt).toBe(msk("2026-11-16 16:00").toISOString())
  })
  it("«Сейчас»: overdue / I1 first, then score", () => {
    const urgent = computeAttention(
      topic({ instances: [ai("ORDER_REQUESTED", "2026-11-16 10:00")], items: [itm("2026-11-16 10:00", "inbound", [["2026-11-16", "us"]])] }),
      env("2026-11-16 11:00"),
    )
    const strong = computeAttention(topic({ id: "t2", instances: [ai("INVOICE_OVERDUE", "2026-11-16 10:00", { scoreContrib: 9 })] }), env("2026-11-16 11:00"))
    expect(urgent.list).toBe("now")
    expect(urgent.rank).toBeLessThan(strong.rank)
    expect((urgent.rankKey ?? "") < (strong.rankKey ?? "")).toBe(true)
  })
})

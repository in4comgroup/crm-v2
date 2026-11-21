import { describe, expect, it } from "vitest"
import {
  classOf,
  computeSubState,
  computeTopicScore,
  deriveClientRelation,
  inReopenWindow,
  instanceActivity,
  recomputeTopic,
  relevanceWindowDays,
  timerTransition,
} from "./lifecycle"
import type { TopicInstance, TopicItemLink, TopicSnapshot } from "./model"
import { makeBook } from "./test-fixtures"

const book = makeBook()
const NOW = new Date("2026-11-14T12:00:00Z")

function ti(code: string, date: string, p: Partial<TopicInstance> = {}): TopicInstance {
  const info = book.get(code)!
  const state = info.kind === "state"
  return {
    id: `${code}-${date}`,
    code,
    itemId: `item-${date}`,
    itemDate: new Date(date),
    confidence: "high",
    counted: !state,
    scoreContrib: state ? 0 : info.weight,
    deadlines: [],
    ...p,
  }
}

function link(itemId: string, date: string, direction: TopicItemLink["direction"]): TopicItemLink {
  return { itemId, subjectIndex: 0, role: "update", date: new Date(date), direction, threadKey: null, references: [], products: [], amounts: [] }
}

describe("06 §4.2 instance activity", () => {
  it("default relevance windows by kind and effort", () => {
    expect(relevanceWindowDays(book.get("SALES_PRICE_REQUEST"))).toBe(14)
    expect(relevanceWindowDays(book.get("INVOICE_OVERDUE"))).toBe(30)
    expect(relevanceWindowDays(book.get("SALES_OFFER_REQUESTED"))).toBe(45)
    expect(relevanceWindowDays(book.get("ORDER_REQUESTED"))).toBe(14) // explicit relevance_days
    expect(relevanceWindowDays(book.get("WATCH_CODE"))).toBeNull()
  })

  it("stale after the window, kept active by a future deadline", () => {
    const old = ti("SALES_PRICE_REQUEST", "2026-10-20T09:00:00Z")
    const withDeadline = ti("SALES_PRICE_REQUEST", "2026-10-20T10:00:00Z", { deadlines: ["2026-11-20"] })
    const act = instanceActivity([old, withDeadline], book, NOW)
    expect(act[0]).toMatchObject({ active: false, reason: "stale" })
    expect(act[1]).toMatchObject({ active: true })
  })

  it("closed by a later closing code on the same topic", () => {
    const overdue = ti("INVOICE_OVERDUE", "2026-11-01T09:00:00Z")
    const paid = ti("INVOICE_PAID", "2026-11-05T09:00:00Z")
    const act = instanceActivity([overdue, paid], book, NOW)
    expect(act[0]).toMatchObject({ active: false, reason: "closed", closedBy: paid.id })
  })

  it("an EARLIER closing code does not close a later instance", () => {
    const paid = ti("INVOICE_PAID", "2026-11-01T09:00:00Z")
    const overdue = ti("INVOICE_OVERDUE", "2026-11-05T09:00:00Z")
    expect(instanceActivity([paid, overdue], book, NOW)[1].active).toBe(true)
  })

  it("low-confidence closer does not close", () => {
    const overdue = ti("INVOICE_OVERDUE", "2026-11-01T09:00:00Z")
    const paid = ti("INVOICE_PAID", "2026-11-05T09:00:00Z", { confidence: "low" })
    expect(instanceActivity([overdue, paid], book, NOW)[0].active).toBe(true)
  })

  it("user-dismissed instance is inactive", () => {
    const a = ti("INVOICE_OVERDUE", "2026-11-10T09:00:00Z")
    expect(instanceActivity([a], book, NOW, new Set([a.id]))[0].reason).toBe("dismissed_by_user")
  })

  it("inherited code scores as the topic", () => {
    const offer = ti("SALES_OFFER_REQUESTED", "2026-11-10T09:00:00Z")
    const bounce = ti("MAILERDEMON_RECEIVED", "2026-11-11T09:00:00Z")
    const act = instanceActivity([offer, bounce], book, NOW)
    expect(act[1].score).toBe(7)
  })
})

describe("06 §4.3 / §4.6 topic score, lead, class", () => {
  it("max of active instances, signals do not add up", () => {
    const s = computeTopicScore(
      [ti("SALES_OFFER_REQUESTED", "2026-11-10T09:00:00Z"), ti("PAYMENT_PROMISE", "2026-11-11T09:00:00Z"), ti("SALES_PRICE_REQUEST", "2026-11-12T09:00:00Z")],
      book,
      NOW,
      "active",
    )
    expect(s).toMatchObject({ score: 7, band: "high", leadCode: "SALES_OFFER_REQUESTED", class: "chance" })
  })

  it("lead tie-break: risk before chance", () => {
    const s = computeTopicScore(
      [ti("SALES_OFFER_REQUESTED", "2026-11-12T09:00:00Z"), ti("INVOICE_OVERDUE", "2026-11-10T09:00:00Z")],
      book,
      NOW,
      "active",
    )
    expect(s.leadCode).toBe("INVOICE_OVERDUE")
  })

  it("lead tie-break: newer instance on the same class and score", () => {
    const a = ti("SALES_OFFER_REQUESTED", "2026-11-10T09:00:00Z")
    const b = ti("SALES_OFFER_REQUESTED", "2026-11-12T09:00:00Z")
    const s = computeTopicScore([a, b], book, NOW, "active")
    expect(s.leadInstanceId).toBe(b.id)
  })

  it("class by relation: active → risk, prospect / dormant → chance, supplier → own class", () => {
    const info = book.get("ACCOUNT_CHURN_RISK")
    expect(classOf(info, "active")).toBe("risk")
    expect(classOf(info, "prospect")).toBe("chance")
    expect(classOf(info, "dormant")).toBe("chance")
    expect(classOf(info, "supplier")).toBe("risk")
  })

  it("no active instance → score 0, band none", () => {
    const s = computeTopicScore([ti("INVOICE_PAID", "2026-11-10T09:00:00Z")], book, NOW, "active")
    expect(s).toMatchObject({ score: 0, band: "none", leadCode: null })
  })
})

describe("client relation (06 §4.6)", () => {
  const d = (s: string) => new Date(s)
  it("orders within the rhythm → active; beyond → dormant", () => {
    const dates = [d("2026-06-01"), d("2026-08-01"), d("2026-10-01")] // avg gap 61.5 → floor 90
    expect(deriveClientRelation({ orderDates: dates, companyKind: null, hasWonDeal: false }, NOW)).toBe("active")
    expect(deriveClientRelation({ orderDates: dates, companyKind: null, hasWonDeal: false }, d("2027-03-01"))).toBe("dormant")
  })
  it("one order → rhythm 365 days", () => {
    expect(deriveClientRelation({ orderDates: [d("2026-01-10")], companyKind: null, hasWonDeal: false }, NOW)).toBe("active")
  })
  it("no orders → companies tab", () => {
    expect(deriveClientRelation({ orderDates: [], companyKind: null, hasWonDeal: true }, NOW)).toBe("active")
    expect(deriveClientRelation({ orderDates: [], companyKind: "partner", hasWonDeal: false }, NOW)).toBe("prospect")
    expect(deriveClientRelation({ orderDates: [d("2026-10-01")], companyKind: "supplier", hasWonDeal: false }, NOW)).toBe("supplier")
  })
})

describe("sub-state and timers (spec §7.1)", () => {
  it("waiting on us after an asks-us code, waiting on them after our reply", () => {
    const req = ti("SALES_PRICE_REQUEST", "2026-11-10T09:00:00Z", { itemId: "a" })
    const t1 = { items: [link("a", "2026-11-10T09:00:00Z", "inbound")], instances: [req] }
    expect(computeSubState(t1, book)).toBe("waiting_on_us")
    const t2 = { items: [...t1.items, link("b", "2026-11-11T09:00:00Z", "outbound")], instances: [req] }
    expect(computeSubState(t2, book)).toBe("waiting_on_them")
    const info = ti("PAYMENT_PROMISE", "2026-11-12T09:00:00Z", { itemId: "c" })
    const t3 = { items: [...t2.items, link("c", "2026-11-12T09:00:00Z", "inbound")], instances: [req, info] }
    expect(computeSubState(t3, book)).toBe("none")
  })

  it("open → dormant after 21 days, → expired after 60; resolved / done → archived after 14", () => {
    const at = (days: number) => new Date(NOW.getTime() - days * 86_400_000)
    expect(timerTransition({ status: "open", lastActivityAt: at(10), closedAt: null }, NOW)).toBeNull()
    expect(timerTransition({ status: "open", lastActivityAt: at(22), closedAt: null }, NOW)).toBe("dormant")
    expect(timerTransition({ status: "dormant", lastActivityAt: at(61), closedAt: null }, NOW)).toBe("expired")
    expect(timerTransition({ status: "open", lastActivityAt: at(70), closedAt: null }, NOW)).toBe("expired")
    expect(timerTransition({ status: "resolved", lastActivityAt: at(20), closedAt: at(15) }, NOW)).toBe("archived")
    expect(timerTransition({ status: "resolved", lastActivityAt: at(20), closedAt: at(5) }, NOW)).toBeNull()
    // «Готово» archives by the same rule (bug list 2026-11-21, item 23).
    expect(timerTransition({ status: "done", lastActivityAt: at(20), closedAt: at(15) }, NOW)).toBe("archived")
    expect(timerTransition({ status: "done", lastActivityAt: at(20), closedAt: at(5) }, NOW)).toBeNull()
    expect(timerTransition({ status: "dismissed", lastActivityAt: at(90), closedAt: at(80) }, NOW)).toBeNull()
    expect(timerTransition({ status: "done", lastActivityAt: at(200), closedAt: at(100) }, NOW)).toBe("archived")
  })

  it("reopen window: 14 days from closed_at, resolved and done only", () => {
    const closedAt = new Date("2026-11-01T00:00:00Z")
    expect(inReopenWindow({ status: "resolved", closedAt }, new Date("2026-11-10T00:00:00Z"))).toBe(true)
    expect(inReopenWindow({ status: "done", closedAt }, new Date("2026-11-20T00:00:00Z"))).toBe(false)
    expect(inReopenWindow({ status: "expired", closedAt }, new Date("2026-11-02T00:00:00Z"))).toBe(false)
  })
})

describe("06 §4.2 B5 — process instances (phase 8)", () => {
  function procTopic(instances: TopicInstance[]): TopicSnapshot {
    return {
      id: "t-proc",
      status: "open",
      subState: "none",
      clientId: "c1",
      contactId: null,
      counterpartyRaw: "Альфа",
      counterpartyKey: "",
      dealId: null,
      title: "Альфа — Клиент перестал покупать",
      matter: "Клиент перестал покупать",
      family: "account",
      leadCode: null,
      class: null,
      score: 0,
      band: "none",
      references: [],
      products: [],
      firstSeenAt: new Date("2026-11-01T04:00:00Z"),
      lastActivityAt: new Date("2026-11-01T04:00:00Z"),
      closedAt: null,
      closedReason: null,
      relatedTopicId: null,
      mergedIntoTopicId: null,
      taxonomyVersion: 1,
      instances,
      items: [],
    }
  }
  const proc = (p: Partial<TopicInstance> = {}) =>
    ti("WATCH_CODE", "2026-11-10T04:00:00Z", { itemId: null, conditionKey: "client:c1:last_order:o1", ...p })

  it("a watchdog instance stays active while not cleared (no relevance window)", () => {
    const old = ti("WATCH_CODE", "2026-06-01T04:00:00Z", { itemId: null })
    expect(instanceActivity([old], book, NOW)[0]).toMatchObject({ active: true })
  })

  it("a cleared instance stops scoring (condition_cleared)", () => {
    const act = instanceActivity([proc({ clearedAt: new Date("2026-11-12T04:00:00Z") })], book, NOW)
    expect(act[0]).toMatchObject({ active: false, reason: "condition_cleared" })
  })

  it("process instances move last activity; the topic scores the weight", () => {
    const t = procTopic([proc()])
    recomputeTopic(t, book, NOW, () => "active")
    expect(t.lastActivityAt.toISOString()).toBe("2026-11-10T04:00:00.000Z")
    expect(t.score).toBe(5)
    expect(t.leadCode).toBe("WATCH_CODE")
    expect(t.status).toBe("open")
  })

  it("the topic resolves when its last process instance is cleared", () => {
    const t = procTopic([proc({ clearedAt: new Date("2026-11-13T04:00:00Z") })])
    const ev = recomputeTopic(t, book, NOW, () => "active")
    expect(t.status).toBe("resolved")
    expect(t.closedReason).toBe("condition_cleared:WATCH_CODE")
    expect(t.score).toBe(0)
    expect(ev).toEqual([expect.objectContaining({ type: "resolved", payload: { code: "WATCH_CODE", conditionCleared: true } })])
  })

  it("another active instance keeps the topic open", () => {
    const t = procTopic([proc({ clearedAt: new Date("2026-11-13T04:00:00Z") }), ti("INVOICE_OVERDUE", "2026-11-12T09:00:00Z")])
    recomputeTopic(t, book, NOW, () => "active")
    expect(t.status).toBe("open")
    expect(t.leadCode).toBe("INVOICE_OVERDUE")
  })
})

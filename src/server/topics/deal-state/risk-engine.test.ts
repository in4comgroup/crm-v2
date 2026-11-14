import { describe, expect, it } from "vitest"
import {
  compareRiskCriticality,
  distinctPostponements,
  EMPTY_RISK_FACTS,
  evaluateDealRisks,
  guardAllows,
  productsMatch,
  type ExistingRisk,
  type RiskDealInput,
  type RiskInstance,
  type RiskItem,
  type RiskTopic,
  type RiskTypeDef,
} from "./risk-engine"

// Pure tests of the deal risk engine (spec topics/01 §9.4, §2.1 examples).

const NOW = new Date("2026-11-14T12:00:00Z")
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000)

const TYPES: Record<string, RiskTypeDef> = {
  DECISION_DELAYED: {
    code: "DECISION_DELAYED",
    labelRu: "Решение откладывается",
    descriptionRu: "Клиент второй раз откладывает решение…",
    triggerCodes: ["DECISION_POSTPONED", "MEETING_CANCEL", "MEETING_DELAYED"],
    clearCodes: ["LISTING_CONFIRMED"],
    severity: 6,
    minOccurrences: 2,
    condition: "distinct_postponements_without_new_date",
    scope: "deal",
    enabled: true,
  },
  COMPETITOR_PRICE: {
    code: "COMPETITOR_PRICE",
    labelRu: "Конкурент предлагает дешевле",
    descriptionRu: "Клиент давит на цену…",
    triggerCodes: ["COMPLAINT_PRICE", "SALES_RENEGOTIATION"],
    clearCodes: ["LISTING_CONFIRMED"],
    severity: 7,
    minOccurrences: 1,
    condition: null,
    scope: "deal",
    enabled: true,
  },
  CLIENT_DEBT: {
    code: "CLIENT_DEBT",
    labelRu: "Долг клиента",
    descriptionRu: "Просроченная оплата…",
    triggerCodes: ["INVOICE_OVERDUE"],
    clearCodes: ["INVOICE_PAID"],
    severity: 7,
    minOccurrences: 1,
    condition: "no_other_overdue_open",
    scope: "client",
    enabled: true,
  },
  DECISION_MAKER_CHANGE: {
    code: "DECISION_MAKER_CHANGE",
    labelRu: "Смена закупщика / ЛПР",
    descriptionRu: "Человек уходит…",
    triggerCodes: ["CONTACT_LEAVING", "CONTACT_NEW_DECISION_MAKER"],
    clearCodes: ["LISTING_CONFIRMED", "CONTRACT_RENEWAL_INTENT"],
    severity: 6,
    minOccurrences: 1,
    condition: "deal_contact_lost_without_handover",
    scope: "client",
    enabled: true,
  },
  DELISTING: {
    code: "DELISTING",
    labelRu: "Клиент выводит позиции",
    descriptionRu: "…",
    triggerCodes: ["DELISTING_RISK"],
    clearCodes: ["LISTING_CONFIRMED"],
    severity: 8,
    minOccurrences: 1,
    condition: "deal_type_listing_or_supply",
    scope: "client",
    enabled: true,
  },
  CONTRACT_EXPIRING_NO_RENEWAL: {
    code: "CONTRACT_EXPIRING_NO_RENEWAL",
    labelRu: "Договор заканчивается без продления",
    descriptionRu: "…",
    triggerCodes: ["CONTRACT_FRAME_EXPIRY"],
    clearCodes: ["CONTRACT_RENEWAL_INTENT", "LISTING_CONFIRMED"],
    severity: 8,
    minOccurrences: 1,
    condition: "no_renewal_intent_in_window",
    scope: "client",
    enabled: true,
  },
  NO_STOCK_FOR_DEAL: {
    code: "NO_STOCK_FOR_DEAL",
    labelRu: "Нет товара для поставки",
    descriptionRu: "…",
    triggerCodes: ["SUPPLIER_DELIVERY_DELAY", "STOCK_AVAILABILITY_REQUEST", "SUBSTITUTION_REQUESTED"],
    clearCodes: [],
    severity: 5,
    minOccurrences: 1,
    condition: "deal_sku_out_of_stock",
    scope: "deal",
    enabled: true,
  },
  PAYMENT_TERMS_ABOVE_POLICY: {
    code: "PAYMENT_TERMS_ABOVE_POLICY",
    labelRu: "Жёсткие условия оплаты",
    descriptionRu: "…",
    triggerCodes: ["PAYMENT_TERMS_REQUEST"],
    clearCodes: ["LISTING_CONFIRMED"],
    severity: 5,
    minOccurrences: 1,
    condition: "terms_above_policy",
    scope: "client",
    enabled: true,
  },
  REPEATED_COMPLAINTS: {
    code: "REPEATED_COMPLAINTS",
    labelRu: "Повторные жалобы",
    descriptionRu: "…",
    triggerCodes: ["COMPLAINT_QUALITY", "COMPLAINT_TIMING", "COMPLAINT_ESCALATED", "DELIVERY_DISCREPANCY"],
    clearCodes: ["DELIVERY_DISCREPANCY_RESOLVED"],
    severity: 7,
    minOccurrences: 2,
    condition: "complaints_2_in_30d_or_escalated",
    scope: "client",
    enabled: true,
  },
}
const ALL_CODES = new Set(Object.values(TYPES).flatMap((t) => [...t.triggerCodes, ...t.clearCodes]).concat(["CONTRACT_RENEWAL_INTENT"]))

let seq = 0
function inst(code: string, daysAgo: number, over: Partial<RiskInstance> = {}): RiskInstance {
  seq++
  return {
    id: `i${seq}`,
    code,
    topicId: "t1",
    itemId: `item${seq}`,
    itemDate: day(daysAgo),
    confidence: "high",
    counted: true,
    scoreContrib: 6,
    evidence: `${code} evidence`,
    direction: "inbound",
    subjectIndex: 0,
    products: [],
    authorContactId: null,
    facts: EMPTY_RISK_FACTS,
    outOfStockCue: false,
    ...over,
  }
}

function item(topicId: string, daysAgo: number, over: Partial<RiskItem> = {}): RiskItem {
  seq++
  return {
    itemId: `it${seq}`,
    topicId,
    date: day(daysAgo),
    direction: "inbound",
    authorContactId: null,
    facts: EMPTY_RISK_FACTS,
    outOfStockCue: false,
    ...over,
  }
}

const topicsOf = (...ts: Partial<RiskTopic>[]) =>
  new Map(
    ts.map((t, i) => {
      const full: RiskTopic = { id: `t${i + 1}`, status: "open", dealId: "d1", clientId: "c1", products: [], ...t }
      return [full.id, full]
    }),
  )

function input(over: Partial<RiskDealInput> & { types?: RiskTypeDef[] } = {}): RiskDealInput {
  return {
    deal: {
      id: "d1",
      clientId: "c1",
      stageId: "s2",
      status: "active",
      dealTypeCode: null,
      contactIds: [],
      closed: false,
      closedReason: null,
    },
    types: Object.values(TYPES),
    guards: new Map(),
    activeCodes: ALL_CODES,
    topics: topicsOf({}),
    instances: [],
    items: [],
    existing: [],
    settings: { maxDeferralDays: null, maxCreditLimitRub: null },
    now: NOW,
    ...over,
  }
}

const activeRisk = (over: Partial<ExistingRisk>): ExistingRisk => ({
  id: "r1",
  riskType: "DECISION_DELAYED",
  status: "active",
  triggerInstanceIds: [],
  occurrences: 2,
  topicId: "t1",
  detectedAt: day(3),
  clearedAt: null,
  ...over,
})

describe("helpers", () => {
  it("guard: no row = all stages; disabled = off; stage list", () => {
    expect(guardAllows(undefined, "s1")).toBe(true)
    expect(guardAllows({ enabled: false, stageIds: null }, "s1")).toBe(false)
    expect(guardAllows({ enabled: true, stageIds: null }, "s1")).toBe(true)
    expect(guardAllows({ enabled: true, stageIds: ["s2", "s3"] }, "s1")).toBe(false)
    expect(guardAllows({ enabled: true, stageIds: ["s2", "s3"] }, "s3")).toBe(true)
  })
  it("product match: equal or contained word prefix (≥ 4 chars)", () => {
    expect(productsMatch(["Артикул 4410"], ["артикул 4410"])).toBe(true)
    expect(productsMatch(["Вино Шардоне 0,75"], ["шардоне"])).toBe(true)
    expect(productsMatch(["Вино"], ["Пиво"])).toBe(false)
    expect(productsMatch(["ab"], ["ab cd"])).toBe(false)
  })
  it("one postponement mentioned twice within 24 h counts once; a new date + step does not count", () => {
    const a = inst("DECISION_POSTPONED", 10)
    const b = inst("DECISION_POSTPONED", 9.8)
    const c = inst("DECISION_POSTPONED", 2)
    const d = inst("DECISION_POSTPONED", 1, { facts: { ...EMPTY_RISK_FACTS, proposedMeetingDate: "2026-11-20" } })
    expect(distinctPostponements([a, b, c, d]).map((i) => i.id)).toEqual([a.id, c.id])
  })
  it("criticality: severity × trigger score, then newest", () => {
    const xs = [
      { id: "a", severity: 6, triggerScore: 6, detectedAt: day(1) },
      { id: "b", severity: 8, triggerScore: 6, detectedAt: day(5) },
      { id: "c", severity: 8, triggerScore: 6, detectedAt: day(2) },
    ].sort(compareRiskCriticality)
    expect(xs.map((x) => x.id)).toEqual(["c", "b", "a"])
  })
})

describe("DECISION_DELAYED (§2.1 example)", () => {
  it("one postponement → no risk; two distinct → active (stage unchanged, no other action)", () => {
    const p1 = inst("DECISION_POSTPONED", 15, { evidence: "Решение по поставщику перенесём на после праздников" })
    expect(evaluateDealRisks(input({ instances: [p1] }))).toEqual([])
    const p2 = inst("DECISION_POSTPONED", 1, { evidence: "Пока не готовы, вернёмся позже" })
    const acts = evaluateDealRisks(input({ instances: [p1, p2] }))
    expect(acts).toHaveLength(1)
    expect(acts[0]).toMatchObject({
      kind: "activate",
      riskType: "DECISION_DELAYED",
      occurrences: 2,
      topicId: "t1",
      triggerInstanceIds: [p1.id, p2.id],
    })
  })
  it("date + next step agreed later → risk cleared (condition), history kept", () => {
    const p1 = inst("DECISION_POSTPONED", 15)
    const p2 = inst("DECISION_POSTPONED", 3)
    const agreed = item("t1", 1, {
      facts: { ...EMPTY_RISK_FACTS, proposedMeetingDate: "2026-11-20", deadlines: [{ date: "2026-11-20", what: "встреча с финдиректором", subjectIndex: 0 }] },
    })
    const acts = evaluateDealRisks(
      input({
        instances: [p1, p2],
        items: [agreed],
        existing: [activeRisk({ triggerInstanceIds: [p1.id, p2.id], detectedAt: day(3) })],
      }),
    )
    expect(acts).toEqual([
      expect.objectContaining({ kind: "clear", riskId: "r1", by: "condition", clearItemId: agreed.itemId }),
    ])
  })
  it("after an agreed date the cycle restarts: older postponements do not count", () => {
    const p1 = inst("DECISION_POSTPONED", 20)
    const agreed = item("t1", 10, { facts: { ...EMPTY_RISK_FACTS, proposedMeetingDate: "2026-11-05" } })
    const p2 = inst("DECISION_POSTPONED", 2)
    expect(evaluateDealRisks(input({ instances: [p1, p2], items: [agreed] }))).toEqual([])
  })
  it("our own outbound item, low confidence, not counted, inactive code never trigger", () => {
    const xs = [
      inst("DECISION_POSTPONED", 10, { direction: "outbound" }),
      inst("DECISION_POSTPONED", 8, { confidence: "low", counted: false }),
      inst("DECISION_POSTPONED", 5, { counted: false }),
      inst("MEETING_CANCEL", 2),
    ]
    const parked = new Set([...ALL_CODES].filter((c) => c !== "MEETING_CANCEL"))
    expect(evaluateDealRisks(input({ instances: xs, activeCodes: parked }))).toEqual([])
  })
  it("postponements on a topic of another deal do not count", () => {
    const p1 = inst("DECISION_POSTPONED", 10, { topicId: "t2" })
    const p2 = inst("DECISION_POSTPONED", 2)
    const topics = topicsOf({}, { dealId: "d2" })
    expect(evaluateDealRisks(input({ instances: [p1, p2], topics }))).toEqual([])
  })
  it("stage guard excludes the deal stage → no activation", () => {
    const xs = [inst("DECISION_POSTPONED", 10), inst("DECISION_POSTPONED", 2)]
    const guards = new Map([["DECISION_DELAYED", { enabled: true, stageIds: ["s4", "s5"] }]])
    expect(evaluateDealRisks(input({ instances: xs, guards }))).toEqual([])
  })
  it("idempotent: an active risk with the same triggers → no action", () => {
    const p1 = inst("DECISION_POSTPONED", 15)
    const p2 = inst("DECISION_POSTPONED", 3)
    const acts = evaluateDealRisks(
      input({ instances: [p1, p2], existing: [activeRisk({ triggerInstanceIds: [p1.id, p2.id], occurrences: 2 })] }),
    )
    expect(acts).toEqual([])
  })
  it("a third postponement updates the active risk", () => {
    const p1 = inst("DECISION_POSTPONED", 15)
    const p2 = inst("DECISION_POSTPONED", 8)
    const p3 = inst("DECISION_POSTPONED", 1)
    const acts = evaluateDealRisks(
      input({ instances: [p1, p2, p3], existing: [activeRisk({ triggerInstanceIds: [p1.id, p2.id], occurrences: 2 })] }),
    )
    expect(acts).toEqual([expect.objectContaining({ kind: "update", riskId: "r1", occurrences: 3 })])
  })
  it("after a user clear only newer evidence counts", () => {
    const p1 = inst("DECISION_POSTPONED", 15)
    const p2 = inst("DECISION_POSTPONED", 8)
    const cleared = activeRisk({ status: "cleared", clearedAt: day(5), triggerInstanceIds: [p1.id, p2.id] })
    expect(evaluateDealRisks(input({ instances: [p1, p2], existing: [cleared] }))).toEqual([])
  })
})

describe("clearing", () => {
  it("a clear code on a deal topic newer than the triggers clears the risk", () => {
    const t = inst("COMPLAINT_PRICE", 5)
    const c = inst("LISTING_CONFIRMED", 1, { counted: false })
    const acts = evaluateDealRisks(
      input({ instances: [t, c], existing: [activeRisk({ riskType: "COMPETITOR_PRICE", triggerInstanceIds: [t.id], detectedAt: day(5) })] }),
    )
    expect(acts).toEqual([expect.objectContaining({ kind: "clear", by: "signal", clearInstanceId: c.id })])
  })
  it("an older clear code does not clear", () => {
    const c = inst("LISTING_CONFIRMED", 9)
    const t = inst("COMPLAINT_PRICE", 5)
    const acts = evaluateDealRisks(
      input({
        instances: [c, t],
        existing: [activeRisk({ riskType: "COMPETITOR_PRICE", triggerInstanceIds: [t.id], occurrences: 1, detectedAt: day(5) })],
      }),
    )
    expect(acts).toEqual([])
  })
  it("deal closed (won / lost / cancelled) → every active risk cleared by outcome", () => {
    const base = input()
    const acts = evaluateDealRisks({
      ...base,
      deal: { ...base.deal, closed: true, closedReason: "Сделка выиграна" },
      existing: [activeRisk({}), activeRisk({ id: "r2", riskType: "COMPETITOR_PRICE" })],
    })
    expect(acts.map((a) => a.kind === "clear" && a.by)).toEqual(["outcome", "outcome"])
  })
})

describe("conditions", () => {
  it("COMPETITOR_PRICE: no condition, one trigger", () => {
    const acts = evaluateDealRisks(input({ instances: [inst("SALES_RENEGOTIATION", 2)] }))
    expect(acts).toEqual([expect.objectContaining({ kind: "activate", riskType: "COMPETITOR_PRICE" })])
  })
  it("CLIENT_DEBT: overdue on a live client topic (not the deal's) activates; clears only when no live overdue topic stays", () => {
    const topics = topicsOf({ id: "t1" }, { dealId: null }, { dealId: null })
    const o1 = inst("INVOICE_OVERDUE", 4, { topicId: "t2" })
    const acts = evaluateDealRisks(input({ topics, instances: [o1] }))
    expect(acts).toEqual([expect.objectContaining({ kind: "activate", riskType: "CLIENT_DEBT", topicId: "t2" })])
    // Paid on t2 but t3 overdue still open → not cleared.
    const o2 = inst("INVOICE_OVERDUE", 3, { topicId: "t3" })
    const paid = inst("INVOICE_PAID", 1, { topicId: "t2", counted: false })
    const existing = [activeRisk({ riskType: "CLIENT_DEBT", triggerInstanceIds: [o1.id, o2.id], topicId: "t2" })]
    expect(
      evaluateDealRisks(input({ topics, instances: [o1, o2, paid], existing })).filter((a) => a.kind === "clear"),
    ).toEqual([])
    // Both resolved → cleared.
    const resolved = topicsOf({ id: "t1" }, { dealId: null, status: "resolved" }, { dealId: null, status: "resolved" })
    const acts2 = evaluateDealRisks(input({ topics: resolved, instances: [o1, o2, paid], existing }))
    expect(acts2).toEqual([expect.objectContaining({ kind: "clear", riskId: "r1" })])
  })
  it("CLIENT_DEBT: an overdue topic that is already resolved does not activate", () => {
    const topics = topicsOf({ status: "resolved" })
    expect(evaluateDealRisks(input({ topics, instances: [inst("INVOICE_OVERDUE", 4)] }))).toEqual([])
  })
  it("DECISION_MAKER_CHANGE: leaving person must be a deal contact with no handover", () => {
    const leave = inst("CONTACT_LEAVING", 5, { authorContactId: "p1" })
    expect(evaluateDealRisks(input({ instances: [leave] }))).toEqual([]) // not a deal contact
    const base = input({ instances: [leave] })
    const withContact = { ...base, deal: { ...base.deal, contactIds: ["p1"] } }
    expect(evaluateDealRisks(withContact)).toEqual([expect.objectContaining({ kind: "activate", riskType: "DECISION_MAKER_CHANGE" })])
    // Another client contact wrote on the deal topic later → handover → no risk.
    const handover = item("t1", 2, { authorContactId: "p2" })
    expect(evaluateDealRisks({ ...withContact, items: [handover] })).toEqual([])
  })
  it("DECISION_MAKER_CHANGE: new decision maker counts only with a replacement cue", () => {
    expect(evaluateDealRisks(input({ instances: [inst("CONTACT_NEW_DECISION_MAKER", 3, { evidence: "Рады знакомству" })] }))).toEqual([])
    expect(
      evaluateDealRisks(input({ instances: [inst("CONTACT_NEW_DECISION_MAKER", 3, { evidence: "Теперь вместо Ивана закупками занимаюсь я" })] })),
    ).toEqual([expect.objectContaining({ kind: "activate", riskType: "DECISION_MAKER_CHANGE" })])
  })
  it("DELISTING: only for listing / supply / renewal deals; untyped = insufficient data", () => {
    const xs = [inst("DELISTING_RISK", 2)]
    expect(evaluateDealRisks(input({ instances: xs }))).toEqual([])
    const base = input({ instances: xs })
    expect(evaluateDealRisks({ ...base, deal: { ...base.deal, dealTypeCode: "listing" } })).toEqual([
      expect.objectContaining({ kind: "activate", riskType: "DELISTING" }),
    ])
    expect(evaluateDealRisks({ ...base, deal: { ...base.deal, dealTypeCode: "tender" } })).toEqual([])
  })
  it("CONTRACT_EXPIRING_NO_RENEWAL: needs contractEndDate, supply / renewal type, no renewal intent in the window", () => {
    const facts = { ...EMPTY_RISK_FACTS, contractEndDate: "2026-12-31" }
    const base = input({ instances: [inst("CONTRACT_FRAME_EXPIRY", 3, { facts })] })
    const typed = { ...base, deal: { ...base.deal, dealTypeCode: "supply_agreement" } }
    expect(evaluateDealRisks(typed)).toEqual([expect.objectContaining({ kind: "activate", riskType: "CONTRACT_EXPIRING_NO_RENEWAL" })])
    expect(evaluateDealRisks(base)).toEqual([]) // untyped
    const noDate = { ...typed, instances: [inst("CONTRACT_FRAME_EXPIRY", 3)] }
    expect(evaluateDealRisks(noDate)).toEqual([])
    const renewal = { ...typed, instances: [...typed.instances, inst("CONTRACT_RENEWAL_INTENT", 2, { counted: false })] }
    expect(evaluateDealRisks(renewal)).toEqual([])
  })
  it("NO_STOCK_FOR_DEAL: org + SKU scope, product must match the deal's topics, stock evidence needed", () => {
    const topics = topicsOf({ products: ["Шардоне 0,75"] }, { dealId: null, clientId: "c9", products: [] })
    const delay = inst("SUPPLIER_DELIVERY_DELAY", 2, { topicId: "t2", products: ["Шардоне 0,75"] })
    expect(evaluateDealRisks(input({ topics, instances: [delay] }))).toEqual([
      expect.objectContaining({ kind: "activate", riskType: "NO_STOCK_FOR_DEAL", topicId: "t2" }),
    ])
    const other = inst("SUPPLIER_DELIVERY_DELAY", 2, { topicId: "t2", products: ["Пиво"] })
    expect(evaluateDealRisks(input({ topics, instances: [other] }))).toEqual([])
    const ask = inst("STOCK_AVAILABILITY_REQUEST", 2, { topicId: "t2", products: ["Шардоне 0,75"] })
    expect(evaluateDealRisks(input({ topics, instances: [ask] }))).toEqual([])
    const reply = item("t2", 1, { direction: "outbound", outOfStockCue: true })
    expect(evaluateDealRisks(input({ topics, instances: [ask], items: [reply] }))).toEqual([
      expect.objectContaining({ kind: "activate", riskType: "NO_STOCK_FOR_DEAL" }),
    ])
  })
  it("PAYMENT_TERMS_ABOVE_POLICY: missing policy or fact → false", () => {
    const xs = [inst("PAYMENT_TERMS_REQUEST", 2, { facts: { ...EMPTY_RISK_FACTS, paymentTermsDays: 60 } })]
    expect(evaluateDealRisks(input({ instances: xs }))).toEqual([])
    expect(evaluateDealRisks(input({ instances: xs, settings: { maxDeferralDays: 30, maxCreditLimitRub: null } }))).toEqual([
      expect.objectContaining({ kind: "activate", riskType: "PAYMENT_TERMS_ABOVE_POLICY" }),
    ])
    expect(evaluateDealRisks(input({ instances: xs, settings: { maxDeferralDays: 90, maxCreditLimitRub: null } }))).toEqual([])
  })
  it("REPEATED_COMPLAINTS: 2 distinct topics in 30 days, or 1 escalated; one topic twice is not enough", () => {
    const topics = topicsOf({}, { dealId: null }, { dealId: null })
    const same = [inst("COMPLAINT_QUALITY", 10, { topicId: "t2" }), inst("COMPLAINT_TIMING", 5, { topicId: "t2" })]
    expect(evaluateDealRisks(input({ topics, instances: same }))).toEqual([])
    const two = [inst("COMPLAINT_QUALITY", 10, { topicId: "t2" }), inst("DELIVERY_DISCREPANCY", 5, { topicId: "t3" })]
    expect(evaluateDealRisks(input({ topics, instances: two }))).toEqual([
      expect.objectContaining({ kind: "activate", riskType: "REPEATED_COMPLAINTS" }),
    ])
    const old = [inst("COMPLAINT_QUALITY", 45, { topicId: "t2" }), inst("DELIVERY_DISCREPANCY", 5, { topicId: "t3" })]
    expect(evaluateDealRisks(input({ topics, instances: old }))).toEqual([])
    const esc = [inst("COMPLAINT_ESCALATED", 3, { topicId: "t2" })]
    expect(evaluateDealRisks(input({ topics, instances: esc }))).toEqual([
      expect.objectContaining({ kind: "activate", riskType: "REPEATED_COMPLAINTS" }),
    ])
  })
  it("unknown named condition → never triggers", () => {
    const t: RiskTypeDef = { ...TYPES.COMPETITOR_PRICE!, code: "X", condition: "something_new" }
    expect(evaluateDealRisks(input({ types: [t], instances: [inst("COMPLAINT_PRICE", 1)] }))).toEqual([])
  })
})

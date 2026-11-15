import { describe, expect, it } from "vitest"
import { WorkCalendar } from "@/lib/topics/attention-calendar"
import { CHECKS_DEFAULTS, type OpenProcessInstance } from "@/lib/topics/checks"
import {
  agreedMoment,
  checkContractNotRenewed,
  checkMaterialNoResponse,
  checkOfferNoResponse,
  checkOrderConfirmationOpen,
  checkPriceNoResponse,
  checkReportOpen,
  type ContractData,
  type ContractLink,
  type WatchdogCtx,
  type WatchdogData,
  type WdActivityItem,
  type WdInstance,
  type WdSource,
  type WdTopic,
  type WdTopicItem,
} from "./watchdogs"

// Etc/GMT-3 = UTC+3, no DST. Plain Mon–Fri calendar (no exception rows).
const cal = new WorkCalendar([], { timeZone: "Etc/GMT-3", workStart: "08:00", workEnd: "18:00" })
const NOW = new Date("2026-11-14T10:00:00Z") // Saturday

function ctx(p: Partial<WatchdogCtx> = {}): WatchdogCtx {
  return { now: NOW, params: CHECKS_DEFAULTS, calendar: cal, existing: [], ...p }
}

function item(id: string, date: string, p: Partial<WdTopicItem> = {}): WdTopicItem {
  return {
    itemId: id,
    date: new Date(date),
    direction: "inbound",
    threadKey: "th1",
    automated: false,
    subjectIndex: 0,
    deadlines: [],
    ...p,
  }
}

function inst(id: string, code: string, it: WdTopicItem, p: Partial<WdInstance> = {}): WdInstance {
  return { id, code, itemId: it.itemId, itemDate: it.date, subjectIndex: it.subjectIndex, confidence: "high", ...p }
}

function topic(items: WdTopicItem[], instances: WdInstance[], p: Partial<WdTopic> = {}): WdTopic {
  return {
    id: "t1",
    status: "open",
    clientId: "c1",
    contactId: null,
    companyName: "Норлекс",
    matter: "КП на поставку",
    items,
    instances,
    ...p,
  }
}

const SYNCED: WdSource = { id: "s1", name: "Почта", pull: true, lastSyncedAt: new Date("2026-11-14T09:00:00Z") }

function data(topics: WdTopic[], p: Partial<WatchdogData> = {}): WatchdogData {
  return { topics, activity: [], sources: [SYNCED], ...p }
}

function existing(code: string, key: string, p: Partial<OpenProcessInstance> = {}): OpenProcessInstance {
  return {
    id: "pi1",
    code,
    conditionKey: key,
    topicId: "t1",
    clientId: "c1",
    facts: {},
    createdAt: new Date("2026-11-11T00:00:00Z"),
    clearedAt: null,
    ...p,
  }
}

function activity(id: string, date: string, p: Partial<WdActivityItem> = {}): WdActivityItem {
  return { itemId: id, date: new Date(date), direction: "inbound", automated: false, threadKey: null, clientIds: [], contactIds: [], ...p }
}

// ── Offer ─────────────────────────────────────────────────────────────────

describe("offer_no_response", () => {
  const sent = item("s", "2026-11-03T09:00:00Z", { direction: "outbound" })
  const offer = inst("i-offer", "SALES_OFFER_SENT", sent)
  const KEY = "topic:t1:sent:s"

  it("fires after the default 7 calendar days with no reply", () => {
    const r = checkOfferNoResponse(data([topic([sent], [offer])]), ctx())
    expect(r.evaluated).toBe(1)
    expect(r.findings).toHaveLength(1)
    const f = r.findings[0]
    expect(f).toMatchObject({
      code: "SALES_OFFER_NO_RESPONSE",
      conditionKey: KEY,
      topicId: "t1",
      clientId: "c1",
      companyName: "Норлекс",
      matterRu: "КП на поставку",
      score: null,
      evidenceRu: "КП отправлено 03.11.2026; срок ответа 10.11.2026 (7 дней); ответа нет",
    })
    expect(f.facts).toMatchObject({
      baseInstanceId: "i-offer",
      sentItemId: "s",
      sentAt: "2026-11-03T09:00:00.000Z",
      deadline: "2026-11-10T09:00:00.000Z",
      deadlineSource: "default",
    })
    expect(r.clears).toEqual([])
  })

  it("does not fire before the deadline", () => {
    const r = checkOfferNoResponse(data([topic([sent], [offer])]), ctx({ now: new Date("2026-11-08T10:00:00Z") }))
    expect(r.findings).toEqual([])
    expect(r.skipped.not_due).toBe(1)
  })

  it("uses the latest agreed deadline of the client (owner them)", () => {
    const s2 = { ...sent, deadlines: [{ date: "2026-11-20", owner: "them" as const, subjectIndex: 0 }] }
    expect(checkOfferNoResponse(data([topic([s2], [offer])]), ctx()).findings).toEqual([])
    const s3 = { ...sent, deadlines: [{ date: "2026-11-05", owner: "them" as const, subjectIndex: 0 }] }
    const r = checkOfferNoResponse(data([topic([s3], [offer])]), ctx())
    expect(r.findings[0].evidenceRu).toBe("КП отправлено 03.11.2026; срок ответа 05.11.2026 (согласован); ответа нет")
    expect(r.findings[0].facts.deadlineSource).toBe("agreed")
    // Date only = end of that day in org time.
    expect(r.findings[0].facts.deadline).toBe("2026-11-05T21:00:00.000Z")
  })

  it("ignores agreed dates before the sending, other subjects and owner us", () => {
    const s2 = {
      ...sent,
      deadlines: [
        { date: "2026-11-01", owner: "them" as const, subjectIndex: 0 },
        { date: "2026-11-30", owner: "them" as const, subjectIndex: 1 },
        { date: "2026-11-30", owner: "us" as const, subjectIndex: 0 },
      ],
    }
    const r = checkOfferNoResponse(data([topic([s2], [offer])]), ctx())
    expect(r.findings[0].facts.deadlineSource).toBe("default")
  })

  it("takes an agreed date from a later item of the topic", () => {
    const later = item("l", "2026-11-04T09:00:00Z", {
      direction: "outbound",
      deadlines: [{ date: "2026-11-16T12:00", owner: "them", subjectIndex: -1 }],
    })
    const r = checkOfferNoResponse(data([topic([sent, later], [offer])]), ctx())
    expect(r.findings).toEqual([])
    expect(r.skipped.not_due).toBe(1)
  })

  it("an inbound reply on the topic → no finding and clears the open instance", () => {
    const reply = item("r", "2026-11-12T08:00:00Z")
    const r = checkOfferNoResponse(
      data([topic([sent, reply], [offer])]),
      ctx({ existing: [existing("SALES_OFFER_NO_RESPONSE", KEY)] }),
    )
    expect(r.findings).toEqual([])
    expect(r.clears).toEqual([{ instanceId: "pi1", reasonRu: "Клиент ответил 12.11.2026" }])
    expect(r.skipped.responded).toBe(1)
  })

  it("an inbound item of the same client on another topic, or on the thread, is a reply", () => {
    const byClient = activity("x", "2026-11-05T08:00:00Z", { clientIds: ["c1"] })
    expect(checkOfferNoResponse(data([topic([sent], [offer])], { activity: [byClient] }), ctx()).findings).toEqual([])
    const byThread = activity("y", "2026-11-05T08:00:00Z", { threadKey: "th1" })
    expect(checkOfferNoResponse(data([topic([sent], [offer])], { activity: [byThread] }), ctx()).findings).toEqual([])
    const byContact = activity("z", "2026-11-05T08:00:00Z", { contactIds: ["p1"] })
    const t = topic([sent], [offer], { clientId: null, contactId: "p1" })
    expect(checkOfferNoResponse(data([t], { activity: [byContact] }), ctx()).findings).toEqual([])
  })

  it("other clients, earlier items, our own items and auto-replies are not replies", () => {
    const acts = [
      activity("a", "2026-11-05T08:00:00Z", { clientIds: ["c2"] }),
      activity("b", "2026-11-02T08:00:00Z", { clientIds: ["c1"] }),
      activity("c", "2026-11-05T08:00:00Z", { clientIds: ["c1"], direction: "outbound" }),
      activity("d", "2026-11-05T08:00:00Z", { threadKey: "th1", automated: true }),
    ]
    const ooo = item("o", "2026-11-04T08:00:00Z", { automated: true })
    const r = checkOfferNoResponse(data([topic([sent, ooo], [offer])], { activity: acts }), ctx())
    expect(r.findings).toHaveLength(1)
  })

  it("an item of unknown direction on the thread → possible reply: no finding, no clear", () => {
    const unk = activity("u", "2026-11-05T08:00:00Z", { threadKey: "th1", direction: "unknown" })
    const r = checkOfferNoResponse(
      data([topic([sent], [offer])], { activity: [unk] }),
      ctx({ existing: [existing("SALES_OFFER_NO_RESPONSE", KEY)] }),
    )
    expect(r.findings).toEqual([])
    expect(r.clears).toEqual([])
    expect(r.skipped.possible_reply).toBe(1)
  })

  it("needs every pull channel synced after the deadline", () => {
    const stale: WdSource = { ...SYNCED, id: "s2", lastSyncedAt: new Date("2026-11-09T00:00:00Z") }
    const never: WdSource = { ...SYNCED, id: "s3", lastSyncedAt: null }
    const t = topic([sent], [offer])
    expect(checkOfferNoResponse(data([t], { sources: [SYNCED, stale] }), ctx()).skipped.sources_not_synced).toBe(1)
    expect(checkOfferNoResponse(data([t], { sources: [never] }), ctx()).skipped.sources_not_synced).toBe(1)
    expect(checkOfferNoResponse(data([t], { sources: [] }), ctx()).skipped.no_connected_channels).toBe(1)
    // Push channels (Telegram webhook) are live: no sync time needed.
    const push: WdSource = { id: "tg", name: "Telegram", pull: false, lastSyncedAt: null }
    expect(checkOfferNoResponse(data([t], { sources: [SYNCED, push] }), ctx()).findings).toHaveLength(1)
  })

  it("ignores low-confidence offers and offers on inbound items", () => {
    const low = checkOfferNoResponse(data([topic([sent], [{ ...offer, confidence: "low" }])]), ctx())
    expect(low.evaluated).toBe(0)
    const inbound = item("s", "2026-11-03T09:00:00Z")
    const r = checkOfferNoResponse(data([topic([inbound], [inst("i", "SALES_OFFER_SENT", inbound)])]), ctx())
    expect(r.findings).toEqual([])
    expect(r.skipped.not_outbound).toBe(1)
  })

  it("skips topics closed by the user and keeps their instances", () => {
    const r = checkOfferNoResponse(
      data([topic([sent], [offer], { status: "done" })]),
      ctx({ existing: [existing("SALES_OFFER_NO_RESPONSE", KEY)] }),
    )
    expect(r.findings).toEqual([])
    expect(r.clears).toEqual([])
    expect(r.skipped.topic_closed_by_user).toBe(1)
  })

  it("fires on resolved / archived / expired / dormant topics (the store reopens)", () => {
    for (const status of ["resolved", "archived", "expired", "dormant"]) {
      expect(checkOfferNoResponse(data([topic([sent], [offer], { status })]), ctx()).findings).toHaveLength(1)
    }
  })

  it("lookback gates NEW findings only", () => {
    const old = item("s", "2026-08-01T09:00:00Z", { direction: "outbound" })
    const t = topic([old], [inst("i", "SALES_OFFER_SENT", old)])
    const r = checkOfferNoResponse(data([t]), ctx())
    expect(r.findings).toEqual([])
    expect(r.skipped.outside_lookback).toBe(1)
    const r2 = checkOfferNoResponse(data([t]), ctx({ existing: [existing("SALES_OFFER_NO_RESPONSE", KEY)] }))
    expect(r2.findings).toHaveLength(1)
  })

  it("returns a finding also when its key exists (refresh)", () => {
    const r = checkOfferNoResponse(data([topic([sent], [offer])]), ctx({ existing: [existing("SALES_OFFER_NO_RESPONSE", KEY)] }))
    expect(r.findings.map((f) => f.conditionKey)).toEqual([KEY])
    expect(r.clears).toEqual([])
  })

  it("a newer offer replaces the old condition", () => {
    const s2 = item("s2", "2026-11-12T09:00:00Z", { direction: "outbound" })
    const t = topic([sent, s2], [offer, inst("i2", "SALES_OFFER_SENT", s2)])
    const r = checkOfferNoResponse(
      data([t]),
      ctx({ existing: [existing("SALES_OFFER_NO_RESPONSE", KEY, { facts: { sentItemId: "s", sentAt: sent.date.toISOString() } })] }),
    )
    expect(r.findings).toEqual([])
    expect(r.skipped.not_due).toBe(1)
    expect(r.clears).toEqual([{ instanceId: "pi1", reasonRu: "Отправлено новое КП 12.11.2026" }])
  })

  it("clears instances whose base is gone; ignores cleared and other codes", () => {
    const r = checkOfferNoResponse(
      data([topic([sent], [])]),
      ctx({
        existing: [
          existing("SALES_OFFER_NO_RESPONSE", KEY, { facts: { sentItemId: "s", sentAt: sent.date.toISOString() } }),
          existing("SALES_OFFER_NO_RESPONSE", "topic:t1:sent:zz", { id: "pi2", clearedAt: new Date() }),
          existing("SALES_PRICE_NO_RESPONSE", "topic:t1:sent:s", { id: "pi3" }),
          existing("SALES_OFFER_NO_RESPONSE", "topic:gone:sent:s", { id: "pi4", topicId: null }),
        ],
      }),
    )
    expect(r.clears).toEqual([
      { instanceId: "pi1", reasonRu: "Исходное событие больше не найдено в теме" },
      { instanceId: "pi4", reasonRu: "Тема удалена" },
    ])
  })

  it("plural of the default window", () => {
    const r = checkOfferNoResponse(data([topic([sent], [offer])]), ctx({ params: { ...CHECKS_DEFAULTS, noResponseDefaultDays: 2 } }))
    expect(r.findings[0].evidenceRu).toContain("срок ответа 05.11.2026 (2 дня)")
  })
})

// ── Price / material ──────────────────────────────────────────────────────

describe("price_no_response / material_no_response", () => {
  const req = item("q", "2026-11-01T09:00:00Z")
  const sent = item("s", "2026-11-03T09:00:00Z", { direction: "outbound" })

  it("price: request + our later outbound item, no reply → finding", () => {
    const r = checkPriceNoResponse(data([topic([req, sent], [inst("i-req", "SALES_PRICE_REQUEST", req)])]), ctx())
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0]).toMatchObject({
      code: "SALES_PRICE_NO_RESPONSE",
      conditionKey: "topic:t1:sent:s",
      evidenceRu: "Запрос цен 01.11.2026; цены отправлены 03.11.2026; срок ответа 10.11.2026 (7 дней); ответа нет",
    })
    expect(r.findings[0].facts).toMatchObject({ baseInstanceId: "i-req", sentItemId: "s", requestItemId: "q" })
  })

  it("price: no outbound item after the request → nothing (not sent yet)", () => {
    const before = item("b", "2026-10-30T09:00:00Z", { direction: "outbound" })
    const r = checkPriceNoResponse(data([topic([before, req], [inst("i", "SALES_PRICE_REQUEST", req)])]), ctx())
    expect(r.findings).toEqual([])
    expect(r.skipped.not_sent_yet).toBe(1)
  })

  it("price: the first outbound item after the latest request is the sending", () => {
    const sent2 = item("s2", "2026-11-04T09:00:00Z", { direction: "outbound" })
    const r = checkPriceNoResponse(data([topic([req, sent2, sent], [inst("i", "SALES_PRICE_REQUEST", req)])]), ctx())
    expect(r.findings[0].conditionKey).toBe("topic:t1:sent:s")
  })

  it("price: a new client request after the sending clears the old instance as a reply", () => {
    const req2 = item("q2", "2026-11-06T09:00:00Z")
    const t = topic([req, sent, req2], [inst("i", "SALES_PRICE_REQUEST", req), inst("i2", "SALES_PRICE_REQUEST", req2)])
    const r = checkPriceNoResponse(
      data([t]),
      ctx({ existing: [existing("SALES_PRICE_NO_RESPONSE", "topic:t1:sent:s", { facts: { sentItemId: "s", sentAt: sent.date.toISOString() } })] }),
    )
    expect(r.findings).toEqual([])
    expect(r.clears).toEqual([{ instanceId: "pi1", reasonRu: "Клиент ответил 06.11.2026" }])
  })

  it("price: an outbound request is not a client request", () => {
    const ours = item("q", "2026-11-01T09:00:00Z", { direction: "outbound" })
    const r = checkPriceNoResponse(data([topic([ours, sent], [inst("i", "SALES_PRICE_REQUEST", ours)])]), ctx())
    expect(r.skipped.not_inbound).toBe(1)
  })

  it("material: same logic with its own evidence", () => {
    const r = checkMaterialNoResponse(data([topic([req, sent], [inst("i", "SALES_MATERIAL_REQUESTED", req)])]), ctx())
    expect(r.findings[0]).toMatchObject({
      code: "SALES_MATERIAL_NO_RESPONSE",
      evidenceRu: "Запрос материалов 01.11.2026; материалы отправлены 03.11.2026; срок ответа 10.11.2026 (7 дней); ответа нет",
    })
    const reply = item("r", "2026-11-05T09:00:00Z")
    expect(checkMaterialNoResponse(data([topic([req, sent, reply], [inst("i", "SALES_MATERIAL_REQUESTED", req)])]), ctx()).findings).toEqual([])
  })
})

// ── Order confirmation / report ──────────────────────────────────────────

describe("order_confirmation_open", () => {
  const req = item("q", "2026-11-10T07:00:00Z") // Tue 10:00 MSK
  const base = inst("i-req", "SALES_ORDER_CONFIRMATION_REQUESTED", req)
  const KEY = "topic:t1:request:q"

  it("fires after 2 working days with no confirmation", () => {
    const r = checkOrderConfirmationOpen(data([topic([req], [base])]), ctx())
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0]).toMatchObject({
      code: "SALES_ORDER_CONFIRMATION_OPEN",
      conditionKey: KEY,
      topicId: "t1",
      evidenceRu: "Запрос подтверждения заказа 10.11.2026; срок 12.11.2026 (2 раб. дня); подтверждение не отправлено",
    })
    // End of the working day 12.11 = 18:00 MSK.
    expect(r.findings[0].facts).toMatchObject({ deadline: "2026-11-12T15:00:00.000Z", deadlineSource: "default", requestItemId: "q" })
  })

  it("the window skips the weekend", () => {
    const fri = item("q", "2026-11-13T07:00:00Z")
    const r = checkOrderConfirmationOpen(
      data([topic([fri], [inst("i", "SALES_ORDER_CONFIRMATION_REQUESTED", fri)])]),
      ctx({ now: new Date("2026-11-17T14:00:00Z") }),
    )
    expect(r.findings).toEqual([])
    expect(r.skipped.not_due).toBe(1)
    const r2 = checkOrderConfirmationOpen(
      data([topic([fri], [inst("i", "SALES_ORDER_CONFIRMATION_REQUESTED", fri)])], {
        sources: [{ ...SYNCED, lastSyncedAt: new Date("2026-11-17T16:00:00Z") }],
      }),
      ctx({ now: new Date("2026-11-17T15:30:00Z") }),
    )
    expect(r2.findings[0].evidenceRu).toContain("срок 17.11.2026 (2 раб. дня)")
  })

  it("an owner-us date on the request is the deadline", () => {
    const withDate = { ...req, deadlines: [{ date: "2026-11-11", owner: "us" as const, subjectIndex: 0 }] }
    const r = checkOrderConfirmationOpen(data([topic([withDate], [base])]), ctx())
    expect(r.findings[0].evidenceRu).toContain("срок 11.11.2026 (обещано)")
    expect(r.findings[0].facts.deadlineSource).toBe("agreed")
  })

  it("a later SALES_ORDER_CONFIRMATION_SENT clears", () => {
    const conf = item("c", "2026-11-13T07:00:00Z", { direction: "outbound" })
    const r = checkOrderConfirmationOpen(
      data([topic([req, conf], [base, inst("i-sent", "SALES_ORDER_CONFIRMATION_SENT", conf)])]),
      ctx({ existing: [existing("SALES_ORDER_CONFIRMATION_OPEN", KEY)] }),
    )
    expect(r.findings).toEqual([])
    expect(r.clears).toEqual([{ instanceId: "pi1", reasonRu: "Подтверждение отправлено 13.11.2026" }])
  })

  it("our outbound item on the request's thread (any topic) counts as sent", () => {
    const out = activity("o", "2026-11-11T07:00:00Z", { threadKey: "th1", direction: "outbound" })
    expect(checkOrderConfirmationOpen(data([topic([req], [base])], { activity: [out] }), ctx()).findings).toEqual([])
  })

  it("a low-confidence SENT or an unknown-direction item on the thread → no finding, no clear", () => {
    const conf = item("c", "2026-11-13T07:00:00Z")
    const r = checkOrderConfirmationOpen(
      data([topic([req, conf], [base, inst("i-sent", "SALES_ORDER_CONFIRMATION_SENT", conf, { confidence: "low" })])]),
      ctx({ existing: [existing("SALES_ORDER_CONFIRMATION_OPEN", KEY)] }),
    )
    expect(r.findings).toEqual([])
    expect(r.clears).toEqual([])
    expect(r.skipped.possible_done).toBe(1)
    const unk = activity("u", "2026-11-11T07:00:00Z", { threadKey: "th1", direction: "unknown" })
    expect(checkOrderConfirmationOpen(data([topic([req], [base])], { activity: [unk] }), ctx()).skipped.possible_done).toBe(1)
  })

  it("a newer request replaces the old condition", () => {
    const req2 = item("q2", "2026-11-13T07:00:00Z")
    const t = topic([req, req2], [base, inst("i2", "SALES_ORDER_CONFIRMATION_REQUESTED", req2)])
    const r = checkOrderConfirmationOpen(
      data([t]),
      ctx({ existing: [existing("SALES_ORDER_CONFIRMATION_OPEN", KEY, { facts: { requestItemId: "q" } })] }),
    )
    expect(r.clears).toEqual([{ instanceId: "pi1", reasonRu: "Новый запрос 13.11.2026" }])
  })

  it("needs synced channels", () => {
    const r = checkOrderConfirmationOpen(data([topic([req], [base])], { sources: [{ ...SYNCED, lastSyncedAt: null }] }), ctx())
    expect(r.skipped.sources_not_synced).toBe(1)
  })
})

describe("report_open", () => {
  const req = item("q", "2026-11-10T07:00:00Z")
  const base = inst("i-req", "DELIVERY_REPORT_REQUESTED", req)
  const KEY = "topic:t1:request:q"

  it("fires with no outbound item after the request", () => {
    const r = checkReportOpen(data([topic([req], [base])]), ctx())
    expect(r.findings[0]).toMatchObject({
      code: "DELIVERY_REPORT_OPEN",
      conditionKey: KEY,
      evidenceRu: "Запрос отчёта 10.11.2026; срок 12.11.2026 (2 раб. дня); отчёт не отправлен",
    })
  })

  it("an outbound item on the topic clears", () => {
    const out = item("o", "2026-11-13T07:00:00Z", { direction: "outbound" })
    const r = checkReportOpen(data([topic([req, out], [base])]), ctx({ existing: [existing("DELIVERY_REPORT_OPEN", KEY)] }))
    expect(r.findings).toEqual([])
    expect(r.clears).toEqual([{ instanceId: "pi1", reasonRu: "Ответ отправлен 13.11.2026" }])
  })

  it("an internal item is not our answer", () => {
    const internal = item("o", "2026-11-11T07:00:00Z", { direction: "internal" })
    expect(checkReportOpen(data([topic([req, internal], [base])]), ctx()).findings).toHaveLength(1)
  })
})

// ── Contract ──────────────────────────────────────────────────────────────

describe("contract_not_renewed", () => {
  function link(p: Partial<ContractLink> = {}): ContractLink {
    return {
      itemId: "it1",
      itemDate: new Date("2026-06-01T09:00:00Z"),
      endDate: "2026-10-31",
      topicId: "t1",
      topicStatus: "resolved",
      clientId: "c1",
      contactId: null,
      companyName: "Норлекс",
      matter: "договор поставки",
      ...p,
    }
  }
  const KEY = "client:c1:contract_end:2026-10-31"
  const run = (d: ContractData, p: Partial<WatchdogCtx> = {}) => checkContractNotRenewed(d, ctx(p))

  it("fires when the end date passed with no renewal and no new contract", () => {
    const r = run({ links: [link()], renewals: [] })
    expect(r.evaluated).toBe(1)
    expect(r.findings).toEqual([
      expect.objectContaining({
        code: "CONTRACT_NOT_RENEWED",
        conditionKey: KEY,
        topicId: "t1",
        clientId: "c1",
        companyName: "Норлекс",
        matterRu: "договор поставки",
        evidenceRu: "Договор истёк 31.10.2026; продления и нового договора нет",
        score: null,
      }),
    ])
    expect(r.findings[0].facts).toMatchObject({ contractEndDate: "2026-10-31", itemId: "it1", renewalWindowFrom: "2026-09-05" })
  })

  it("not before the end date (today or later)", () => {
    expect(run({ links: [link({ endDate: "2026-11-14" })], renewals: [] }).skipped.not_expired).toBe(1)
    expect(run({ links: [link({ endDate: "2026-11-13" })], renewals: [] }).findings).toHaveLength(1)
  })

  it("a later end date (new contract) wins; it clears the old instance", () => {
    const r = run(
      { links: [link(), link({ itemId: "it2", endDate: "2027-10-31" })], renewals: [] },
      { existing: [existing("CONTRACT_NOT_RENEWED", KEY)] },
    )
    expect(r.findings).toEqual([])
    expect(r.clears).toEqual([{ instanceId: "pi1", reasonRu: "Новый договор до 31.10.2027" }])
  })

  it("a renewal intent inside the 56-day window stops it; an older one does not", () => {
    const inWindow = { instanceId: "ri", clientId: "c1", itemDate: new Date("2026-09-10T09:00:00Z") }
    const r = run({ links: [link()], renewals: [inWindow] }, { existing: [existing("CONTRACT_NOT_RENEWED", KEY)] })
    expect(r.findings).toEqual([])
    expect(r.clears).toEqual([{ instanceId: "pi1", reasonRu: "Намерение продлить 10.09.2026" }])
    const old = { ...inWindow, itemDate: new Date("2026-08-01T09:00:00Z") }
    expect(run({ links: [link()], renewals: [old] }).findings).toHaveLength(1)
    const otherClient = { ...inWindow, clientId: "c2" }
    expect(run({ links: [link()], renewals: [otherClient] }).findings).toHaveLength(1)
  })

  it("attaches to the latest holding topic not closed by the user", () => {
    const r = run({
      links: [
        link({ topicId: "tA", itemDate: new Date("2026-05-01T00:00:00Z") }),
        link({ topicId: "tB", itemDate: new Date("2026-07-01T00:00:00Z"), topicStatus: "dismissed" }),
        link({ topicId: "tC", itemDate: new Date("2026-06-01T00:00:00Z") }),
      ],
      renewals: [],
    })
    expect(r.findings[0].topicId).toBe("tC")
    const r2 = run({ links: [link({ topicStatus: "done" })], renewals: [] }, { existing: [existing("CONTRACT_NOT_RENEWED", KEY)] })
    expect(r2.findings).toEqual([])
    expect(r2.clears).toEqual([])
    expect(r2.skipped.topic_closed_by_user).toBe(1)
  })

  it("one finding per client + end date; clients are separate", () => {
    const r = run({
      links: [link(), link({ itemId: "it2" }), link({ clientId: "c2", topicId: "t2", endDate: "2026-09-30" })],
      renewals: [],
    })
    expect(r.findings.map((f) => f.conditionKey).sort()).toEqual([KEY, "client:c2:contract_end:2026-09-30"])
    expect(r.evaluated).toBe(2)
  })

  it("clears an instance whose end date is no longer found; ignores bad dates", () => {
    const r = run(
      { links: [link({ endDate: "31.10.2026" })], renewals: [] },
      { existing: [existing("CONTRACT_NOT_RENEWED", KEY)] },
    )
    expect(r.findings).toEqual([])
    expect(r.clears).toEqual([{ instanceId: "pi1", reasonRu: "Дата окончания договора больше не найдена" }])
  })
})

describe("agreedMoment", () => {
  it("date only = end of the day, with time = that moment, else null", () => {
    expect(agreedMoment(cal, "2026-11-05")?.toISOString()).toBe("2026-11-05T21:00:00.000Z")
    expect(agreedMoment(cal, "2026-11-05T12:30")?.toISOString()).toBe("2026-11-05T09:30:00.000Z")
    expect(agreedMoment(cal, "05.11.2026")).toBeNull()
  })
})

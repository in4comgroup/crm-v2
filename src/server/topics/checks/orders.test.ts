import { describe, expect, it } from "vitest"
import { WorkCalendar } from "@/lib/topics/attention-calendar"
import { CHECKS_DEFAULTS, type ChecksParams, type OpenProcessInstance } from "@/lib/topics/checks"
import { orderRhythmDays } from "../lifecycle"
import {
  checkAccountDormant,
  checkNewFollowup,
  checkProductNew,
  checkProductStopped,
  checkReactivationDue,
  checkRevenueStagnation,
  checkRevenueYoy,
  formatRub,
  orderLabelOf,
  type OrderCheckEnv,
  type OrderClientInput,
  type OrderInput,
  type OrderLineInput,
  type ReactivationInfo,
} from "./orders"

const DAY = 86_400_000
const NOW = new Date("2026-11-14T07:00:00Z") // 10:00 Moscow
const cal = new WorkCalendar([], { timeZone: "Europe/Moscow", workStart: "08:00", workEnd: "18:00" })

const d = (s: string) => new Date(s.length === 10 ? `${s}T12:00:00Z` : s)
const ago = (days: number) => new Date(NOW.getTime() - days * DAY)

function ord(
  id: string,
  date: Date | string,
  p: { status?: string; net?: number; items?: (string | OrderLineInput)[] } = {},
): OrderInput {
  return {
    id,
    label: `№ ${id}`,
    date: typeof date === "string" ? d(date) : date,
    status: p.status ?? "finalized",
    netTotal: p.net ?? 100_000,
    items: p.items?.map((it) => (typeof it === "string" ? { productId: it, productName: `Товар ${it}`, qty: 1 } : it)),
  }
}

function cli(id: string, orders: OrderInput[], p: Partial<OrderClientInput> = {}): OrderClientInput {
  return { clientId: id, name: `Клиент ${id}`, createdAt: d("2020-01-01"), companyKind: null, orders, ...p }
}

function env(existing: OpenProcessInstance[] = [], params: Partial<ChecksParams> = {}): OrderCheckEnv {
  return { now: NOW, params: { ...CHECKS_DEFAULTS, ...params }, calendar: cal, existing }
}

function inst(p: Partial<OpenProcessInstance> & { code: string; conditionKey: string }): OpenProcessInstance {
  return { id: `i-${p.conditionKey}`, topicId: "t1", clientId: "c1", facts: {}, createdAt: ago(10), clearedAt: null, ...p }
}

/** `n` orders every `gap` days ending at `last`. */
function series(prefix: string, n: number, gap: number, last: Date, p: Parameters<typeof ord>[2] = {}): OrderInput[] {
  return Array.from({ length: n }, (_, i) => ord(`${prefix}${i}`, new Date(last.getTime() - (n - 1 - i) * gap * DAY), p))
}

/** One order per month (15th) from `from` to `to` ("YYYY-MM"), net from `amount(ym)`. */
function monthly(prefix: string, from: string, to: string, amount: (ym: string) => number): OrderInput[] {
  const out: OrderInput[] = []
  let [y, m] = from.split("-").map(Number)
  for (;;) {
    const ym = `${y}-${String(m).padStart(2, "0")}`
    if (ym > to) break
    out.push(ord(`${prefix}${ym}`, `${ym}-15`, { net: amount(ym) }))
    m++
    if (m > 12) {
      m = 1
      y++
    }
  }
  return out
}

describe("helpers", () => {
  it("order label from description, else short id", () => {
    expect(orderLabelOf("demo-ord-00633", "[demo-seed] демо-заказ №633")).toBe("№ 633")
    expect(orderLabelOf("b3046bf6-1611-4090", null)).toBe("№ b3046bf6")
  })
  it("rubles with plain spaces", () => {
    expect(formatRub(1_250_000)).toBe("1 250 000 ₽")
    expect(formatRub(999.6)).toBe("1 000 ₽")
    expect(formatRub(-400_000)).toBe("−400 000 ₽")
  })
  it("order rhythm (shared with deriveClientRelation)", () => {
    expect(orderRhythmDays([d("2026-01-01"), d("2026-01-31"), d("2026-03-02")], 90)).toBe(90)
    expect(orderRhythmDays([d("2026-01-01"), d("2026-08-08")], 90)).toBeCloseTo(219, 0)
    expect(orderRhythmDays([d("2026-01-01")], 90)).toBe(365)
    expect(orderRhythmDays([d("2026-01-01"), d("2026-02-01"), d("2026-03-01")], 20)).toBeCloseTo(29.5, 1)
  })
})

describe("ACCOUNT_DORMANT", () => {
  const big = { net: 200_000 }

  it("pause > rhythm (floor 90) → finding with evidence and facts", () => {
    const c = cli("c1", series("o", 5, 7, d("2026-07-31"), big))
    const r = checkAccountDormant([c], env())
    expect(r.evaluated).toBe(1)
    expect(r.findings).toHaveLength(1)
    const f = r.findings[0]
    expect(f.code).toBe("ACCOUNT_DORMANT")
    expect(f.conditionKey).toBe("client:c1:last_order:o4")
    expect(f.score).toBeNull()
    expect(f.topicId).toBeNull()
    expect(f.clientId).toBe("c1")
    expect(f.companyName).toBe("Клиент c1")
    expect(f.matterRu).toBe("Клиент перестал покупать")
    expect(f.evidenceRu).toContain("последний заказ № o4 от 31.07.2026")
    expect(f.evidenceRu).toContain("обычный ритм 90 дн.")
    expect(f.evidenceRu).toContain("пауза 105 дн.")
    expect(f.evidenceRu).toContain("лучший год 2026: 1 000 000 ₽")
    expect(f.facts).toMatchObject({ clientId: "c1", lastOrderId: "o4", rhythmDays: 90, pauseDays: 105, level: "risk" })
  })

  it("threshold is strict: pause = rhythm → active, rhythm + 1 day → dormant", () => {
    const at = cli("c1", series("o", 3, 10, ago(90), big))
    expect(checkAccountDormant([at], env()).findings).toHaveLength(0)
    expect(checkAccountDormant([at], env()).skipped.active).toBe(1)
    const past = cli("c1", series("o", 3, 10, ago(91), big))
    expect(checkAccountDormant([past], env()).findings).toHaveLength(1)
  })

  it("rhythm: 2 orders → that gap; 1 order → 365 days", () => {
    const two = cli("c1", [ord("a", ago(350), big), ord("b", ago(150), { net: 400_000 })])
    expect(checkAccountDormant([two], env()).findings).toHaveLength(0) // rhythm 200
    const one = cli("c1", [ord("a", ago(300), { net: 400_000 })])
    expect(checkAccountDormant([one], env()).findings).toHaveLength(0) // rhythm 365
    const oneOld = cli("c1", [ord("a", ago(366), { net: 400_000 })])
    expect(checkAccountDormant([oneOld], env()).findings).toHaveLength(1)
  })

  it("pause > 2 × rhythm → score 3 (fyi)", () => {
    const c = cli("c1", series("o", 3, 10, ago(181), big))
    const f = checkAccountDormant([c], env()).findings[0]
    expect(f.score).toBe(3)
    expect(f.facts.level).toBe("fyi")
    const c2 = cli("c1", series("o", 3, 10, ago(180), big))
    expect(checkAccountDormant([c2], env()).findings[0].score).toBeNull()
  })

  it("best calendar year below the minimum → few data, no finding", () => {
    const c = cli("c1", series("o", 2, 10, ago(200), { net: 149_999 }))
    const r = checkAccountDormant([c], env())
    expect(r.findings).toHaveLength(0)
    expect(r.skipped.few_data).toBe(1)
  })

  it("an order booked after the last one (awaiting_client / draft) → not dormant; cancelled ignored", () => {
    const base = series("o", 3, 10, d("2026-07-31"), big)
    const awaiting = cli("c1", [...base, ord("x", "2026-10-08", { status: "awaiting_client" })])
    const r = checkAccountDormant([awaiting], env())
    expect(r.findings).toHaveLength(0)
    expect(r.skipped.booked_ahead).toBe(1)
    const draftBefore = cli("c1", [...base, ord("x", "2026-07-01", { status: "draft" })])
    expect(checkAccountDormant([draftBefore], env()).findings).toHaveLength(1)
    const cancelled = cli("c1", [...base, ord("x", "2026-10-08", { status: "cancelled" })])
    expect(checkAccountDormant([cancelled], env()).findings).toHaveLength(1)
    const futureConfirmed = cli("c1", [...base, ord("x", "2026-12-01", { status: "confirmed" })])
    expect(checkAccountDormant([futureConfirmed], env()).skipped.booked_ahead).toBe(1)
  })

  it("an existing open instance with the same key is still returned (store refreshes)", () => {
    const c = cli("c1", series("o", 3, 10, d("2026-07-31"), big))
    const e = inst({ code: "ACCOUNT_DORMANT", conditionKey: "client:c1:last_order:o2", facts: { lastOrderId: "o2", lastOrderDate: d("2026-07-31").toISOString() } })
    const r = checkAccountDormant([c], env([e]))
    expect(r.findings.map((f) => f.conditionKey)).toEqual(["client:c1:last_order:o2"])
    expect(r.clears).toHaveLength(0)
  })

  it("clears: a newer counted order, or an order booked after the instance's last order", () => {
    const e = inst({
      code: "ACCOUNT_DORMANT",
      conditionKey: "client:c1:last_order:o2",
      facts: { clientId: "c1", lastOrderId: "o2", lastOrderDate: d("2026-07-31").toISOString() },
    })
    const withNew = cli("c1", [...series("o", 3, 10, d("2026-07-31"), big), ord("n1", "2026-11-10", big)])
    const r = checkAccountDormant([withNew], env([e]))
    expect(r.clears).toEqual([{ instanceId: e.id, reasonRu: "Новый заказ № n1 от 10.11.2026" }])
    const withBooked = cli("c1", [...series("o", 3, 10, d("2026-07-31"), big), ord("b1", "2026-11-20", { status: "awaiting_client" })])
    const r2 = checkAccountDormant([withBooked], env([e]))
    expect(r2.clears[0].reasonRu).toBe("Есть заказ в работе № b1 от 20.11.2026")
    // still dormant, same last order → no clear
    expect(checkAccountDormant([cli("c1", series("o", 3, 10, d("2026-07-31"), big))], env([e])).clears).toHaveLength(0)
  })

  it("instance client falls back to facts.clientId when the topic lost its client", () => {
    const e = inst({
      code: "ACCOUNT_DORMANT",
      conditionKey: "client:c1:last_order:o2",
      clientId: null,
      facts: { clientId: "c1", lastOrderId: "o2", lastOrderDate: d("2026-07-31").toISOString() },
    })
    const c = cli("c1", [...series("o", 3, 10, d("2026-07-31"), big), ord("n1", "2026-11-10", big)])
    expect(checkAccountDormant([c], env([e])).clears).toHaveLength(1)
  })
})

describe("ACCOUNT_PRODUCT_STOPPED", () => {
  const active = new Set(["A", "B"])
  /** Client buys B every 10 days up to 4 days ago; A in `n` orders every `gap` days ending at `lastA`. */
  function client(n: number, gap: number, lastA: Date): OrderClientInput {
    const bs = series("b", 20, 10, ago(4), { items: ["B"] })
    const as = series("a", n, gap, lastA, { items: ["A", "B"] })
    return cli("c1", [...bs, ...as])
  }

  it("product in ≥ 4 orders, last order older than max(2 × median, 90) → finding", () => {
    const r = checkProductStopped([client(4, 30, ago(120))], env(), { activeProductIds: active })
    expect(r.findings).toHaveLength(1)
    const f = r.findings[0]
    expect(f.code).toBe("ACCOUNT_PRODUCT_STOPPED")
    expect(f.conditionKey).toBe("client:c1:product:A:last:a3")
    expect(f.matterRu).toBe("Перестал покупать: Товар A")
    expect(f.evidenceRu).toContain("Товар A: брали каждые ~30 дн. (4 заказов за 24 мес.)")
    expect(f.evidenceRu).toContain("другие позиции клиент заказывал 10.11.2026")
    expect(f.facts).toMatchObject({ productId: "A", productOrders: 4, rhythmDays: 30, thresholdDays: 90 })
  })

  it("threshold edges: 2 × median above the 90-day floor", () => {
    // median 60 → threshold 120
    expect(checkProductStopped([client(4, 60, ago(120))], env(), { activeProductIds: active }).findings).toHaveLength(0)
    expect(checkProductStopped([client(4, 60, ago(121))], env(), { activeProductIds: active }).findings).toHaveLength(1)
    // median 30 → floor 90
    expect(checkProductStopped([client(4, 30, ago(90))], env(), { activeProductIds: active }).findings).toHaveLength(0)
    expect(checkProductStopped([client(4, 30, ago(91))], env(), { activeProductIds: active }).findings).toHaveLength(1)
  })

  it("fewer than productMinOrders orders or outside the lookback → no finding", () => {
    expect(checkProductStopped([client(3, 30, ago(120))], env(), { activeProductIds: active }).findings).toHaveLength(0)
    // 4 orders but the first falls outside 24 months
    expect(checkProductStopped([client(4, 300, ago(120))], env(), { activeProductIds: active }).findings).toHaveLength(0)
  })

  it("inactive product / dormant client → skipped", () => {
    const r = checkProductStopped([client(4, 30, ago(120))], env(), { activeProductIds: new Set(["B"]) })
    expect(r.findings).toHaveLength(0)
    expect(r.skipped.product_inactive).toBe(1)
    const dormant = cli("c1", series("a", 5, 20, ago(200), { items: ["A"] }))
    const r2 = checkProductStopped([dormant], env(), { activeProductIds: active })
    expect(r2.skipped.client_dormant).toBe(1)
  })

  it("cooldown per client + product (other key, < 90 days)", () => {
    const prev = inst({
      code: "ACCOUNT_PRODUCT_STOPPED",
      conditionKey: "client:c1:product:A:last:old",
      facts: { productId: "A" },
      createdAt: ago(30),
      clearedAt: ago(20),
    })
    const r = checkProductStopped([client(4, 30, ago(120))], env([prev]), { activeProductIds: active })
    expect(r.findings).toHaveLength(0)
    expect(r.skipped.cooldown).toBe(1)
    const older = { ...prev, createdAt: ago(91) }
    expect(checkProductStopped([client(4, 30, ago(120))], env([older]), { activeProductIds: active }).findings).toHaveLength(1)
    const otherProduct = { ...prev, facts: { productId: "Z" } }
    expect(checkProductStopped([client(4, 30, ago(120))], env([otherProduct]), { activeProductIds: active }).findings).toHaveLength(1)
  })

  it("clear when the client orders the product again", () => {
    const e = inst({
      code: "ACCOUNT_PRODUCT_STOPPED",
      conditionKey: "client:c1:product:A:last:a3",
      facts: { productId: "A", productName: "Товар A", lastProductOrderDate: ago(120).toISOString() },
    })
    const c = client(4, 30, ago(120))
    c.orders.push(ord("again", "2026-11-12", { items: ["A"] }))
    const r = checkProductStopped([c], env([e]), { activeProductIds: active })
    expect(r.clears).toEqual([{ instanceId: e.id, reasonRu: "Снова заказали: Товар A — заказ № again от 12.11.2026" }])
  })
})

describe("ACCOUNT_PRODUCT_NEW", () => {
  it("new product in an order of the last 2 days, history ≥ 183 days → one finding per order", () => {
    const c = cli("c1", [
      ord("o1", ago(200), { items: ["A"] }),
      ord("o2", ago(1), { items: ["A", { productId: "B", productName: "Шабли", qty: 12 }] }),
    ])
    const r = checkProductNew([c], env())
    expect(r.findings).toHaveLength(1)
    const f = r.findings[0]
    expect(f.conditionKey).toBe("order:o2")
    expect(f.matterRu).toBe("Новая позиция в заказе № o2")
    expect(f.evidenceRu).toBe("заказ № o2 от 13.11.2026: впервые взяли Шабли (12 шт.)")
    expect(f.facts.products).toEqual([{ productId: "B", productName: "Шабли", qty: 12 }])
    expect(r.clears).toHaveLength(0)
  })

  it("several new products → one finding, plural matter", () => {
    const c = cli("c1", [ord("o1", ago(200), { items: ["A"] }), ord("o2", ago(1), { items: ["B", "C"] })])
    const f = checkProductNew([c], env()).findings[0]
    expect(f.matterRu).toBe("Новые позиции в заказе № o2")
    expect(f.evidenceRu).toContain("Товар B (1 шт.), Товар C (1 шт.)")
  })

  it("edges: history < 183 days, first order, outside the 2-day window, nothing new", () => {
    const short = cli("c1", [ord("o1", ago(182), { items: ["A"] }), ord("o2", ago(1), { items: ["B"] })])
    expect(checkProductNew([short], env()).skipped.few_data).toBe(1)
    const first = cli("c1", [ord("o2", ago(1), { items: ["B"] })])
    expect(checkProductNew([first], env()).skipped.first_order).toBe(1)
    const old = cli("c1", [ord("o1", ago(200), { items: ["A"] }), ord("o2", ago(2.1), { items: ["B"] })])
    expect(checkProductNew([old], env()).findings).toHaveLength(0)
    const same = cli("c1", [ord("o1", ago(200), { items: ["A"] }), ord("o2", ago(1), { items: ["A"] })])
    expect(checkProductNew([same], env()).skipped.no_new_product).toBe(1)
    const draft = cli("c1", [ord("o1", ago(200), { items: ["A"] }), ord("o2", ago(1), { status: "draft", items: ["B"] })])
    expect(checkProductNew([draft], env()).findings).toHaveLength(0)
  })

  it("uses productFirstAt (whole history) when given", () => {
    const c = cli("c1", [ord("o1", ago(400)), ord("o2", ago(1), { items: ["A", "B"] })], {
      productFirstAt: new Map([
        ["A", ago(300)],
        ["B", ago(1)],
      ]),
    })
    const f = checkProductNew([c], env()).findings[0]
    expect((f.facts.products as { productId: string }[]).map((p) => p.productId)).toEqual(["B"])
  })
})

describe("ACCOUNT_NEW_FOLLOWUP", () => {
  const out = (m: [string, Date][] = []) => ({ lastOutboundAt: new Map(m) })

  it("first finalized order 14 … 28 days old, no second order, no outbound → finding", () => {
    for (const age of [14, 20, 28]) {
      const r = checkNewFollowup([cli("c1", [ord("o1", ago(age), { net: 50_000 })])], env(), out())
      expect(r.findings).toHaveLength(1)
    }
    const f = checkNewFollowup([cli("c1", [ord("o1", ago(15))])], env(), out()).findings[0]
    expect(f.conditionKey).toBe("client:c1:first_order:o1")
    expect(f.matterRu).toBe("Пора обсудить первый заказ")
    expect(f.evidenceRu).toContain("первый заказ № o1 отгружен 30.10.2026")
    expect(f.evidenceRu).toContain("(15 дн.)")
  })

  it("edges and skips", () => {
    expect(checkNewFollowup([cli("c1", [ord("o1", ago(13.9))])], env(), out()).skipped.too_early).toBe(1)
    expect(checkNewFollowup([cli("c1", [ord("o1", ago(28.1))])], env(), out()).skipped.too_late).toBe(1)
    expect(checkNewFollowup([cli("c1", [ord("o1", ago(15), { status: "confirmed" })])], env(), out()).skipped.not_finalized).toBe(1)
    expect(checkNewFollowup([cli("c1", [ord("o1", ago(20)), ord("o2", ago(5))])], env(), out()).skipped.second_order).toBe(1)
    expect(checkNewFollowup([cli("c1", [ord("o1", ago(15))])], env(), out([["c1", ago(3)]])).skipped.contacted).toBe(1)
    // outbound BEFORE the first order does not count
    expect(checkNewFollowup([cli("c1", [ord("o1", ago(15))])], env(), out([["c1", ago(30)]])).findings).toHaveLength(1)
    // a draft second order is not a counted order
    expect(checkNewFollowup([cli("c1", [ord("o1", ago(15)), ord("o2", ago(2), { status: "draft" })])], env(), out()).findings).toHaveLength(1)
  })

  it("clears on a second order or an outbound contact", () => {
    const e = inst({
      code: "ACCOUNT_NEW_FOLLOWUP",
      conditionKey: "client:c1:first_order:o1",
      facts: { firstOrderId: "o1", firstOrderDate: ago(20).toISOString() },
    })
    const r = checkNewFollowup([cli("c1", [ord("o1", ago(20)), ord("o2", "2026-11-12")])], env([e]), out())
    expect(r.clears).toEqual([{ instanceId: e.id, reasonRu: "Второй заказ № o2 от 12.11.2026" }])
    const r2 = checkNewFollowup([cli("c1", [ord("o1", ago(20))])], env([e]), out([["c1", d("2026-11-11")]]))
    expect(r2.clears[0].reasonRu).toBe("Исходящий контакт 11.11.2026")
    expect(checkNewFollowup([cli("c1", [ord("o1", ago(20))])], env([e]), out()).clears).toHaveLength(0)
  })
})

describe("ACCOUNT_REVENUE_DECLINE_YOY / GROWTH_YOY", () => {
  const none = { openDormantClientIds: new Set<string>() }
  // Baseline 2024-11 … 2025-10, window 2025-11 … 2026-10 (run in 11.2026).
  const client = (base: number, win: number, from = "2024-01") =>
    cli("c1", monthly("m", from, "2026-10", (ym) => (ym >= "2025-11" ? win : base)))

  it("decline ≥ 15 % and ≥ 100 000 ₽ → finding with the window in the key", () => {
    const r = checkRevenueYoy([client(100_000, 80_000)], env(), none)
    expect(r.findings).toHaveLength(1)
    const f = r.findings[0]
    expect(f.code).toBe("ACCOUNT_REVENUE_DECLINE_YOY")
    expect(f.conditionKey).toBe("client:c1:window:2026-10")
    expect(f.matterRu).toBe("Выручка снизилась год к году")
    expect(f.evidenceRu).toBe(
      "выручка за 12 мес. (11.2025–10.2026): 960 000 ₽; год назад (11.2024–10.2025): 1 200 000 ₽ (−20 %, −240 000 ₽); заказов 12 против 12",
    )
    expect(f.facts).toMatchObject({ windowRevenue: 960_000, baselineRevenue: 1_200_000, changeRub: -240_000, changePct: -20 })
  })

  it("growth ≥ 10 % and ≥ 100 000 ₽ → growth finding", () => {
    const r = checkRevenueYoy([client(100_000, 120_000)], env(), none)
    expect(r.findings.map((f) => f.code)).toEqual(["ACCOUNT_REVENUE_GROWTH_YOY"])
    expect(r.findings[0].matterRu).toBe("Выручка выросла год к году")
  })

  it("threshold edges: −14 % no; −15 % yes; amount below the minimum no", () => {
    expect(checkRevenueYoy([client(100_000, 86_000)], env(), none).findings).toHaveLength(0)
    expect(checkRevenueYoy([client(100_000, 85_000)], env(), none).findings).toHaveLength(1)
    // −50 % but only −60 000 ₽ (baseline 120 000 ₽)
    expect(checkRevenueYoy([client(10_000, 5_000)], env(), none).findings).toHaveLength(0)
  })

  it("minimum data: history < 24 months, < 3 baseline orders, baseline < min → few data", () => {
    const young = client(100_000, 50_000, "2024-12")
    expect(checkRevenueYoy([young], env(), none).skipped.few_data).toBe(1)
    const sparse = cli("c1", [
      ord("x1", "2024-01-15", { net: 500_000 }),
      ord("x2", "2025-01-15", { net: 500_000 }),
      ord("x3", "2025-02-15", { net: 500_000 }),
      ...monthly("w", "2025-11", "2026-10", () => 10_000),
    ])
    expect(checkRevenueYoy([sparse], env(), none).findings).toHaveLength(0)
    expect(checkRevenueYoy([client(8_000, 1_000)], env(), none).skipped.few_data).toBe(1)
  })

  it("decline is suppressed when the client is dormant or the window has no order", () => {
    const r = checkRevenueYoy([client(100_000, 80_000)], env(), { openDormantClientIds: new Set(["c1"]) })
    expect(r.findings).toHaveLength(0)
    expect(r.skipped.dormant).toBe(1)
    const empty = cli("c1", monthly("m", "2024-01", "2025-10", () => 100_000))
    expect(checkRevenueYoy([empty], env(), none).skipped.no_window_order).toBe(1)
  })

  it("open instance → refreshed under its own key; cooldown for a new key; clear when false", () => {
    const open = inst({ code: "ACCOUNT_REVENUE_DECLINE_YOY", conditionKey: "client:c1:window:2026-09", createdAt: ago(40) })
    const r = checkRevenueYoy([client(100_000, 80_000)], env([open]), none)
    expect(r.findings[0].conditionKey).toBe("client:c1:window:2026-09")
    const cleared = { ...open, clearedAt: ago(5) }
    expect(checkRevenueYoy([client(100_000, 80_000)], env([cleared]), none).skipped.cooldown).toBe(1)
    const oldCleared = { ...cleared, createdAt: ago(91) }
    expect(checkRevenueYoy([client(100_000, 80_000)], env([oldCleared]), none).findings).toHaveLength(1)
    const flat = checkRevenueYoy([client(100_000, 100_000)], env([open]), none)
    expect(flat.findings).toHaveLength(0)
    expect(flat.clears).toHaveLength(1)
    expect(flat.clears[0].reasonRu).toContain("Условие больше не выполняется")
    // change of direction: an open decline does not block growth
    const grow = checkRevenueYoy([client(100_000, 130_000)], env([open]), none)
    expect(grow.findings.map((f) => f.code)).toEqual(["ACCOUNT_REVENUE_GROWTH_YOY"])
    expect(grow.clears).toHaveLength(1)
  })
})

describe("ACCOUNT_REVENUE_STAGNATION", () => {
  const byYear: Record<string, number> = { "2022": 100_000, "2023": 90_000, "2024": 95_000, "2025": 100_000, "2026": 100_000 }
  const client = (years = byYear, from = "2022-01") => cli("c1", monthly("m", from, "2026-10", (ym) => years[ym.slice(0, 4)] ?? 0))

  it("orders in 4 years, a drop ≥ 5 %, last 12 months ≤ best × 1.1 → finding", () => {
    const r = checkRevenueStagnation([client()], env())
    expect(r.findings).toHaveLength(1)
    const f = r.findings[0]
    expect(f.conditionKey).toBe("client:c1:year:2025")
    expect(f.evidenceRu).toContain("2023: 1 080 000 ₽ (−10 %)")
    expect(f.evidenceRu).toContain("последние 12 мес. (11.2025–10.2026): 1 200 000 ₽")
    expect(f.facts.dropYears).toEqual(["2023"])
  })

  it("no drop ≥ 5 %, a missing year, or strong growth → no finding", () => {
    expect(checkRevenueStagnation([client({ ...byYear, "2023": 96_000 })], env()).findings).toHaveLength(0)
    expect(checkRevenueStagnation([client(byYear, "2023-01")], env()).skipped.few_data).toBe(1)
    const r = checkRevenueStagnation([client({ ...byYear, "2026": 115_000 })], env())
    // last 12 = 2 × 100k (11–12.2025) + 10 × 115k = 1 350 000 > 1 200 000 × 1.1
    expect(r.findings).toHaveLength(0)
    expect(r.skipped.growing).toBe(1)
  })

  it("clear when no longer true; cooldown for a new key", () => {
    const open = inst({ code: "ACCOUNT_REVENUE_STAGNATION", conditionKey: "client:c1:year:2024" })
    const r = checkRevenueStagnation([client({ ...byYear, "2023": 96_000 })], env([open]))
    expect(r.clears).toHaveLength(1)
    expect(checkRevenueStagnation([client()], env([open])).findings[0].conditionKey).toBe("client:c1:year:2024")
    const cleared = { ...open, clearedAt: ago(1), createdAt: ago(60) }
    expect(checkRevenueStagnation([client()], env([cleared])).skipped.cooldown).toBe(1)
  })
})

describe("ACCOUNT_REACTIVATION_DUE", () => {
  const info = (m: Record<string, Partial<ReactivationInfo>> = {}) => ({
    info: new Map(
      Object.entries(m).map(([k, v]) => [k, { lastContactAt: null, hasLostDeal: false, potentialTab: false, ...v }]),
    ),
    openDormantClientIds: new Set<string>(),
  })

  it("former client (last order > 12 months), silent ≥ 180 days → finding keyed by the silence start", () => {
    const c = cli("c1", [ord("o1", "2025-06-01")], { createdAt: d("2025-01-01") })
    const r = checkReactivationDue([c], env(), info())
    expect(r.findings).toHaveLength(1)
    const f = r.findings[0]
    expect(f.conditionKey).toBe("client:c1:silence_since:2025-06-01")
    expect(f.matterRu).toBe("Пора возобновить контакт")
    expect(f.evidenceRu).toBe("последний контакт 01.06.2025; 530 дн. без контакта; статус — бывший клиент; последний заказ № o1 от 01.06.2025")
    expect(f.facts).toMatchObject({ kind: "former", silentDays: 530 })
  })

  it("lead (tab «Потенциальные», no orders) with old contact → finding; no contact → silence from creation", () => {
    const lead = cli("c1", [], { createdAt: d("2026-01-01") })
    const r = checkReactivationDue([lead], env(), info({ c1: { potentialTab: true, lastContactAt: d("2026-03-01") } }))
    expect(r.findings[0].facts).toMatchObject({ kind: "lead", silentDays: 257 })
    expect(r.findings[0].conditionKey).toBe("client:c1:silence_since:2026-03-01")
    const silent = checkReactivationDue([lead], env(), info({ c1: { potentialTab: true } }))
    expect(silent.findings[0].evidenceRu).toContain("контактов не было, компания добавлена 01.01.2026")
    // not on the potential tab, no orders → not a target
    expect(checkReactivationDue([lead], env(), info()).skipped.not_target).toBe(1)
  })

  it("a lost deal makes a client without recent orders a former client", () => {
    const c = cli("c1", [], { createdAt: d("2025-01-01") })
    const r = checkReactivationDue([c], env(), info({ c1: { hasLostDeal: true, lastContactAt: d("2026-02-01") } }))
    expect(r.findings[0].facts.kind).toBe("former")
  })

  it("threshold edges and skips", () => {
    const c = (contact: Date, p: Partial<OrderClientInput> = {}) =>
      checkReactivationDue([cli("c1", [ord("o1", "2025-01-01")], p)], env(), info({ c1: { lastContactAt: contact } }))
    expect(c(ago(179.9)).skipped.recent_contact).toBe(1)
    expect(c(ago(180)).findings).toHaveLength(1)
    // created < 180 days ago → silence counted from creation
    expect(c(ago(300), { createdAt: ago(100) }).skipped.recent_contact).toBe(1)
    expect(c(ago(300), { companyKind: "supplier" }).skipped.not_client).toBe(1)
    const active = cli("c1", [ord("o1", ago(30))])
    expect(checkReactivationDue([active], env(), info()).skipped.active_client).toBe(1)
    const open = cli("c1", [ord("o1", "2025-01-01"), ord("o2", "2025-02-01", { status: "awaiting_client" })])
    expect(checkReactivationDue([open], env(), info()).skipped.open_order).toBe(1)
    const dormant = cli("c1", [ord("o1", "2025-01-01")])
    const dr = checkReactivationDue([dormant], env(), { ...info(), openDormantClientIds: new Set(["c1"]) })
    expect(dr.skipped.dormant).toBe(1)
  })

  it("clear on any contact after the silence start", () => {
    const e = inst({
      code: "ACCOUNT_REACTIVATION_DUE",
      conditionKey: "client:c1:silence_since:2025-06-01",
      facts: { silenceSince: d("2025-06-01").toISOString() },
    })
    const c = cli("c1", [ord("o1", "2025-06-01")], { createdAt: d("2025-01-01") })
    const r = checkReactivationDue([c], env([e]), info({ c1: { lastContactAt: d("2026-11-02") } }))
    expect(r.clears).toEqual([{ instanceId: e.id, reasonRu: "Был контакт 02.11.2026" }])
    expect(checkReactivationDue([c], env([e]), info()).clears).toHaveLength(0)
  })
})

import { describe, expect, it } from "vitest"
import { WorkCalendar } from "@/lib/topics/attention-calendar"
import { CHECKS_DEFAULTS, type ChecksParams, type OpenProcessInstance } from "@/lib/topics/checks"
import {
  checkMeetingOverdue,
  checkPriceChange,
  checkProductStatus,
  deriveSegments,
  formatPct,
  heldProductIds,
  planWatchStateWrites,
  priceChangeHeld,
  formatPrice,
  plural,
  type CatalogueData,
  type CatalogueProduct,
  type CrmCheckEnv,
  type MeetingFact,
  type WatchState,
} from "./crm-data"
import type { OrderClientInput, OrderInput } from "./orders"

const DAY = 86_400_000
const NOW = new Date("2026-11-14T07:00:00Z") // 10:00 Moscow
const cal = new WorkCalendar([], { timeZone: "Europe/Moscow", workStart: "08:00", workEnd: "18:00" })
const ago = (days: number) => new Date(NOW.getTime() - days * DAY)

function env(existing: OpenProcessInstance[] = [], params: Partial<ChecksParams> = {}): CrmCheckEnv {
  return { now: NOW, params: { ...CHECKS_DEFAULTS, ...params }, calendar: cal, existing }
}

function inst(p: Partial<OpenProcessInstance> & { code: string; conditionKey: string }): OpenProcessInstance {
  return { id: `i-${p.conditionKey}`, topicId: "t1", clientId: null, facts: {}, createdAt: ago(10), clearedAt: null, ...p }
}

/** A client with one counted order in the 12-month window worth `revenue`. */
function cli(id: string, revenue: number): OrderClientInput {
  const orders: OrderInput[] = revenue
    ? [{ id: `o-${id}`, label: `№ ${id}`, date: new Date("2026-06-15T12:00:00Z"), status: "finalized", netTotal: revenue }]
    : []
  return { clientId: id, name: `Клиент ${id}`, createdAt: new Date("2020-01-01"), companyKind: null, orders }
}

function meetings(list: [string, number, MeetingFact["kind"]?][]): Map<string, MeetingFact[]> {
  const m = new Map<string, MeetingFact[]>()
  for (const [clientId, daysAgo, kind] of list) {
    m.set(clientId, [...(m.get(clientId) ?? []), { clientId, at: ago(daysAgo), kind: kind ?? "calendar" }])
  }
  return m
}

describe("formatting", () => {
  it("plural / price / pct", () => {
    expect([1, 2, 5, 11, 21, 94].map((n) => plural(n, "день", "дня", "дней"))).toEqual(["день", "дня", "дней", "дней", "день", "дня"])
    expect(formatPrice(1290)).toBe("1 290")
    expect(formatPrice(1290.5)).toBe("1 290,50")
    expect(formatPct(7.5)).toBe("+7,5 %")
    expect(formatPct(-10)).toBe("−10 %")
  })
})

describe("deriveSegments", () => {
  it("A = top 20 % of revenue, B = next 30 %, C = rest; no revenue = no segment", () => {
    // total 1000: a 400 (A, before 0 %), b 300 (B, before 40 %), c 200 (C, before 70 %), d 100 (C), e 0 (none)
    const s = deriveSegments([cli("a", 400), cli("b", 300), cli("c", 200), cli("d", 100), cli("e", 0)], env())
    expect(s.get("a")?.segment).toBe("A")
    expect(s.get("b")?.segment).toBe("B")
    expect(s.get("c")?.segment).toBe("C")
    expect(s.get("d")?.segment).toBe("C")
    expect(s.has("e")).toBe(false)
  })

  it("orders outside the last 12 full months do not count", () => {
    const c = cli("x", 0)
    c.orders = [{ id: "o", label: "№ 1", date: new Date("2025-06-15T12:00:00Z"), status: "finalized", netTotal: 500 }]
    expect(deriveSegments([c], env()).has("x")).toBe(false)
  })
})

describe("checkMeetingOverdue", () => {
  const clients = [cli("a", 400), cli("b", 300), cli("c", 200), cli("e", 0)]

  it("no calendar source → nothing at all", () => {
    const r = checkMeetingOverdue(clients, env(), { hasCalendarSource: false, meetings: meetings([["a", 100]]) })
    expect(r.findings).toEqual([])
    expect(r.skipped.no_calendar_source).toBe(4)
  })

  it("overdue by segment norm, with evidence and key", () => {
    const r = checkMeetingOverdue(clients, env(), {
      hasCalendarSource: true,
      meetings: meetings([
        ["a", 94],
        ["a", 200, "task"],
        ["b", 60], // B norm 90 → fine
        ["c", 200], // C norm 180 → overdue
        ["e", 400], // no segment
      ]),
    })
    expect(r.findings.map((f) => f.clientId)).toEqual(["a", "c"])
    const a = r.findings[0]
    expect(a.code).toBe("ACCOUNT_MEETING_OVERDUE")
    expect(a.conditionKey).toBe(`client:a:last_meeting:${cal.localDay(ago(94))}`)
    expect(a.evidenceRu).toMatch(/^сегмент A \(выручка за 12 мес\.: 400 ₽\); последняя встреча \d\d\.\d\d\.2026, 94 дня назад; норма — раз в 30 дней$/)
    expect(a.facts).toMatchObject({ segment: "A", frequencyDays: 30, daysSince: 94, meetings: 2 })
    expect(r.skipped).toMatchObject({ recent_meeting: 1, no_segment: 1 })
  })

  it("no past meeting → no finding (insufficient data); future meetings ignored", () => {
    const m = new Map<string, MeetingFact[]>([["a", [{ clientId: "a", at: new Date(NOW.getTime() + 5 * DAY), kind: "task" }]]])
    const r = checkMeetingOverdue([cli("a", 100)], env(), { hasCalendarSource: true, meetings: m })
    expect(r.findings).toEqual([])
    expect(r.skipped.no_meeting_history).toBe(1)
  })

  it("cooldown blocks a new key; the same key is a refresh", () => {
    const key = `client:a:last_meeting:${cal.localDay(ago(94))}`
    const ex = [inst({ code: "ACCOUNT_MEETING_OVERDUE", conditionKey: "client:a:last_meeting:2026-01-01", clientId: "a", createdAt: ago(20), clearedAt: ago(5) })]
    const r = checkMeetingOverdue([cli("a", 100)], env(ex), { hasCalendarSource: true, meetings: meetings([["a", 94]]) })
    expect(r.findings).toEqual([])
    expect(r.skipped.cooldown).toBe(1)
    const same = [inst({ code: "ACCOUNT_MEETING_OVERDUE", conditionKey: key, clientId: "a" })]
    expect(checkMeetingOverdue([cli("a", 100)], env(same), { hasCalendarSource: true, meetings: meetings([["a", 94]]) }).findings).toHaveLength(1)
  })

  it("clears on a newer meeting, and when the client lost its segment", () => {
    const ex = [
      inst({ id: "i1", code: "ACCOUNT_MEETING_OVERDUE", conditionKey: "k1", clientId: "a", facts: { lastMeetingDate: ago(94).toISOString() } }),
      inst({ id: "i2", code: "ACCOUNT_MEETING_OVERDUE", conditionKey: "k2", clientId: "e", facts: { lastMeetingDate: ago(400).toISOString() } }),
    ]
    const r = checkMeetingOverdue(clients, env(ex), {
      hasCalendarSource: true,
      meetings: meetings([
        ["a", 94],
        ["a", 3],
        ["e", 400],
      ]),
    })
    expect(r.clears.map((c) => c.instanceId).sort()).toEqual(["i1", "i2"])
    expect(r.clears.find((c) => c.instanceId === "i1")?.reasonRu).toMatch(/^Встреча /)
    expect(r.findings.some((f) => f.clientId === "a")).toBe(false)
  })
})

// ── Catalogue ─────────────────────────────────────────────────────────────

function prod(id: string, p: Partial<CatalogueProduct> = {}): CatalogueProduct {
  return { id, name: `Вино ${id}`, price: 1000, status: "active", totalStock: 10, vintage: "2020", ...p }
}

function state(pr: CatalogueProduct, p: Partial<WatchState> = {}): WatchState {
  return { productId: pr.id, price: pr.price, status: pr.status, totalStock: pr.totalStock, vintage: pr.vintage, ...p }
}

function data(products: CatalogueProduct[], states: WatchState[], p: Partial<CatalogueData> = {}): CatalogueData {
  return {
    products,
    states: new Map(states.map((s) => [s.productId, s])),
    buyers: new Map(),
    recentOrdered: new Set(),
    ...p,
  }
}

describe("checkPriceChange", () => {
  it("no previous state → no signal", () => {
    const r = checkPriceChange(data([prod("a", { price: 2000 })], []), env())
    expect(r.findings).toEqual([])
    expect(r.skipped.no_snapshot).toBe(1)
  })

  it("one finding per day: ≥ threshold, or any change of a bought SKU; small unbought change skipped", () => {
    const a = prod("a", { price: 1290, name: "Шабли" })
    const b = prod("b", { price: 1020 }) // +2 %, bought → in
    const c = prod("c", { price: 1010 }) // +1 %, not bought → out
    const d = prod("d", { price: 900, status: "deleted" }) // inactive → out
    const r = checkPriceChange(
      data([a, b, c, d], [state(a, { price: 1200 }), state(b, { price: 1000 }), state(c, { price: 1000 }), state(d, { price: 1000 })], {
        buyers: new Map([["b", 3]]),
      }),
      env(),
    )
    expect(r.findings).toHaveLength(1)
    const f = r.findings[0]
    expect(f).toMatchObject({ code: "INTERNAL_PRICE_CHANGE", conditionKey: "catalog:prices:2026-11-14", topicId: null, clientId: null, companyName: null, matterRu: "Изменились цены каталога" })
    expect(f.evidenceRu).toBe("изменились цены 2 позиций: Вино b 1 000 → 1 020 ₽ (+2 %, брали 3 клиента); Шабли 1 200 → 1 290 ₽ (+7,5 %)")
    expect((f.facts.changes as unknown[]).length).toBe(2)
    expect(r.skipped.small_change).toBe(1)
  })

  it("per-SKU cooldown, except a change of direction", () => {
    const a = prod("a", { price: 1100 })
    const b = prod("b", { price: 900 })
    const ex = [
      inst({
        code: "INTERNAL_PRICE_CHANGE",
        conditionKey: "catalog:prices:2026-11-01",
        createdAt: ago(13),
        facts: { changes: [{ productId: "a", direction: "up" }, { productId: "b", direction: "up" }] },
      }),
    ]
    const r = checkPriceChange(data([a, b], [state(a, { price: 1000 }), state(b, { price: 1000 })]), env(ex))
    expect((r.findings[0].facts.changes as { productId: string }[]).map((c) => c.productId)).toEqual(["b"])
    expect(r.findings[0].evidenceRu.startsWith("изменилась цена 1 позиции: ")).toBe(true)
    expect(r.skipped.cooldown).toBe(1)
    // Older than the cooldown → allowed again.
    const old = [{ ...ex[0], createdAt: ago(40) }]
    expect((checkPriceChange(data([a], [state(a, { price: 1000 })]), env(old)).findings[0].facts.changes as unknown[]).length).toBe(1)
  })
})

describe("checkProductStatus", () => {
  it("no previous state → no signal (seed run)", () => {
    expect(checkProductStatus(data([prod("a")], []), env()).findings).toEqual([])
  })

  it("added, withdrawn, stock out (recently ordered only), stock back, vintage", () => {
    const known = prod("k")
    const added = prod("n", { name: "Новинка" })
    const gone = prod("w", { status: "deleted", name: "Риоха" })
    const out = prod("o", { totalStock: 0 })
    const outNotOrdered = prod("x", { totalStock: 0 })
    const back = prod("b", { totalStock: 24 })
    const vint = prod("v", { vintage: "2021" })
    const r = checkProductStatus(
      data(
        [known, added, gone, out, outNotOrdered, back, vint],
        [
          state(known),
          state(gone, { status: "active" }),
          state(out, { totalStock: 12 }),
          state(outNotOrdered, { totalStock: 5 }),
          state(back, { totalStock: 0 }),
          state(vint, { vintage: "2020" }),
        ],
        { recentOrdered: new Set(["o"]), buyers: new Map([["w", 4]]) },
      ),
      env(),
    )
    expect(r.findings.map((f) => f.facts.event)).toEqual(["withdrawn", "stock_out", "vintage", "stock_back", "added"])
    expect(r.findings.map((f) => f.conditionKey)).toEqual([
      "product:w:withdrawn:2026-11-14",
      "product:o:stock_out:2026-11-14",
      "product:v:vintage:2026-11-14",
      "product:b:stock_back:2026-11-14",
      "product:n:added:2026-11-14",
    ])
    expect(r.findings[0].matterRu).toBe("Позиция выведена: Риоха")
    expect(r.findings[0].evidenceRu).toBe("позиция «Риоха» выведена из ассортимента 14.11.2026; за 12 мес. позицию заказывали 4 клиента")
    expect(r.findings.every((f) => f.topicId === null && f.clientId === null)).toBe(true)
    expect(r.skipped.stock_out_not_ordered).toBe(1)
  })

  it("cooldown per SKU + event", () => {
    const a = prod("a", { status: "deleted" })
    const ex = [inst({ code: "INTERNAL_PRODUCT_STATUS_UPDATE", conditionKey: "product:a:withdrawn:2026-11-01", createdAt: ago(13), facts: { productId: "a", event: "withdrawn" } })]
    const r = checkProductStatus(data([a], [state(a, { status: "active" })]), env(ex))
    expect(r.findings).toEqual([])
    expect(r.skipped.cooldown).toBe(1)

  })
})

describe("watch-state refresh plan", () => {
  it("seed = every product; unchanged = no rows", () => {
    const ps = [prod("a"), prod("b", { status: "deleted" })]
    const seed = planWatchStateWrites("org", ps, new Map(), NOW, { status: true })
    expect(seed.seed).toBe(true)
    expect(seed.rows.map((r) => r.productId)).toEqual(["a", "b"])
    expect(seed.rows[0]).toMatchObject({ price: "1000.00", status: "active", totalStock: 10, vintage: "2020", firstSeenAt: NOW })
    const same = planWatchStateWrites("org", ps, new Map(ps.map((p) => [p.id, state(p)])), NOW, { price: true, status: true })
    expect(same.rows).toEqual([])
  })

  it("each part writes only its own columns", () => {
    const a = prod("a", { price: 1100, totalStock: 0 })
    const states = new Map([["a", state(a, { price: 1000, totalStock: 5 })]])
    expect(planWatchStateWrites("org", [a], states, NOW, { price: true }).rows[0]).toMatchObject({ price: "1100.00", totalStock: 5 })
    expect(planWatchStateWrites("org", [a], states, NOW, { status: true }).rows[0]).toMatchObject({ price: "1000.00", totalStock: 0 })
    // A new product gets a row only with the status part.
    expect(planWatchStateWrites("org", [a, prod("n")], states, NOW, { price: true }).rows.map((r) => r.productId)).toEqual(["a"])
  })

  it("capped case: findings the store deferred keep their old state and are found again next run", () => {
    const known = prod("k")
    const news = Array.from({ length: 5 }, (_, i) => prod(`p${i}`))
    const gone = prod("w", { status: "deleted" })
    const states = new Map([state(known), state(gone, { status: "active" })].map((s) => [s.productId, s]))
    const d = data([known, gone, ...news], [...states.values()])
    const r = checkProductStatus(d, env([], { maxNewPerCheckPerRun: 3 }))
    // The evaluator returns everything, most important first; the store caps.
    expect(r.findings.map((f) => f.facts.productId)).toEqual(["w", "p0", "p1", "p2", "p3", "p4"])
    const maxNew = 3
    const pending = r.findings.slice(maxNew) // what `applyCheckResult` defers
    const hold = heldProductIds(pending)
    expect([...hold]).toEqual(["p2", "p3", "p4"])

    const plan = planWatchStateWrites("org", d.products, d.states, NOW, { status: true, hold })
    expect(plan.rows.map((r) => r.productId).sort()).toEqual(["p0", "p1", "w"])
    // Next run: the state of the written ones moved on, the held ones are found again.
    const next = new Map(d.states)
    for (const row of plan.rows) next.set(row.productId, { productId: row.productId, price: Number(row.price), status: row.status, totalStock: row.totalStock, vintage: row.vintage })
    const r2 = checkProductStatus({ ...d, states: next }, env())
    expect(r2.findings.map((f) => f.facts.productId)).toEqual(["p2", "p3", "p4"])

    // A held known product keeps its status columns.
    const plan2 = planWatchStateWrites("org", d.products, d.states, NOW, { status: true, hold: new Set(["w"]) })
    expect(plan2.rows.some((r) => r.productId === "w")).toBe(false)
  })

  it("price finding not written → price part held", () => {
    const f = checkPriceChange(data([prod("a", { price: 2000 })], [state(prod("a"))]), env()).findings
    expect(priceChangeHeld(f)).toBe(true)
    expect(priceChangeHeld([])).toBe(false)
  })
})

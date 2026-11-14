// Order-data checks of topics plan phase 8 (spec topics/01 §5.6, 05 §3.6,
// 06 §4.2 B5 / §4.6). PURE: no DB, no server imports — the loaders live in
// `orders-data.ts`, the writes in `store.ts`. Every function takes plain
// inputs (clients with their orders), `now`, the parameters and the existing
// process instances of its code(s), and returns a `CheckResult`:
//  - findings = every condition that is TRUE now (an existing key = the store
//    refreshes it; a cleared one with the same key is skipped by the store);
//  - clears   = open (not cleared) instances whose condition is no longer true;
//  - insufficient data never produces a finding (counted in `skipped`).
//
// Orders that count = status `confirmed` + `finalized`; revenue = net of the
// order's discount (`netTotal`, computed by the loader). Dates / months /
// years are local to the org (`calendar.localDay`).

import type { WorkCalendar } from "@/lib/topics/attention-calendar"
import type { CheckClear, CheckFinding, CheckResult, ChecksParams, OpenProcessInstance } from "@/lib/topics/checks"
import { orderRhythmDays } from "../lifecycle"

const DAY_MS = 86_400_000

// ── Inputs ────────────────────────────────────────────────────────────────

export type OrderLineInput = { productId: string; productName: string; qty: number }

export type OrderInput = {
  id: string
  /** Human label, «№ 633» (see `orderLabelOf`). */
  label: string
  date: Date
  /** draft | awaiting_client | confirmed | finalized | cancelled */
  status: string
  /** total_amount × (1 − discount_percent / 100). */
  netTotal: number
  /** Lines of the order (product checks only; aggregated per product). */
  items?: OrderLineInput[]
}

export type OrderClientInput = {
  clientId: string
  name: string
  createdAt: Date
  /** Companies-tab tag `custom_fields.companyKind` (supplier / partner / null). */
  companyKind: string | null
  orders: OrderInput[]
  /**
   * First counted order date per product over the client's whole history
   * (ACCOUNT_PRODUCT_NEW). Missing → derived from the `items` of `orders`.
   */
  productFirstAt?: ReadonlyMap<string, Date>
}

export type OrderCheckEnv = {
  now: Date
  params: ChecksParams
  calendar: Pick<WorkCalendar, "localDay">
  /** Process instances of the check's code(s), newest first (CheckContext.existing). */
  existing: readonly OpenProcessInstance[]
}

/** Per client contact data of ACCOUNT_REACTIVATION_DUE. */
export type ReactivationInfo = {
  /** Last contact of any kind (linked source item, order, task, deal, topic / card item). */
  lastContactAt: Date | null
  /** A deal on a lost stage (closure probability 0, not the pre-pipeline stage). */
  hasLostDeal: boolean
  /** Companies tab «Потенциальные»: an open deal, no won deal. */
  potentialTab: boolean
}

export const CODE = {
  dormant: "ACCOUNT_DORMANT",
  productStopped: "ACCOUNT_PRODUCT_STOPPED",
  productNew: "ACCOUNT_PRODUCT_NEW",
  newFollowup: "ACCOUNT_NEW_FOLLOWUP",
  declineYoy: "ACCOUNT_REVENUE_DECLINE_YOY",
  growthYoy: "ACCOUNT_REVENUE_GROWTH_YOY",
  stagnation: "ACCOUNT_REVENUE_STAGNATION",
  reactivation: "ACCOUNT_REACTIVATION_DUE",
} as const

const COUNTED = new Set(["confirmed", "finalized"])
/** Booked ahead = any of these dated after the last counted order. */
const BOOKED = new Set(["draft", "awaiting_client", "confirmed", "finalized"])
/** Open order (reactivation) = draft / awaiting_client, or confirmed in the future. */
const OPEN_ANY_DATE = new Set(["draft", "awaiting_client"])

// ── Formatting helpers (Russian) ─────────────────────────────────────────

/** «№ 633» from a description like «… №633», else «№ <first 8 chars of id>». */
export function orderLabelOf(id: string, description: string | null): string {
  const m = description?.match(/№\s*(\d+)/)
  return m ? `№ ${m[1]}` : `№ ${id.slice(0, 8)}`
}

/** 1250000 → «1 250 000 ₽» (plain spaces). */
export function formatRub(n: number): string {
  const r = Math.round(n)
  const s = String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, " ")
  return `${r < 0 ? "−" : ""}${s} ₽`
}

function signedRub(n: number): string {
  const s = formatRub(Math.abs(n))
  return `${n < 0 ? "−" : "+"}${s}`
}

function signedPct(p: number): string {
  const r = Math.round(p)
  return `${r < 0 ? "−" : "+"}${Math.abs(r)} %`
}

function ruDate(cal: Pick<WorkCalendar, "localDay">, d: Date): string {
  const [y, m, day] = cal.localDay(d).split("-")
  return `${day}.${m}.${y}`
}

function ruMonth(ym: string): string {
  const [y, m] = ym.split("-")
  return `${m}.${y}`
}

function shorten(s: string, max = 60): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`
}

// ── Date helpers ──────────────────────────────────────────────────────────

function days(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / DAY_MS
}

/** Calendar months back/forward (UTC fields; day clamped to the month end). */
export function addMonths(d: Date, n: number): Date {
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + n
  const target = new Date(Date.UTC(y, m, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()))
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(d.getUTCDate(), last))
  return target
}

/** "YYYY-MM" shifted by `n` months. */
function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number)
  const t = y * 12 + (m - 1) + n
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

function iso(d: Date): string {
  return d.toISOString()
}

function factDate(facts: Record<string, unknown>, key: string): Date | null {
  const v = facts[key]
  if (typeof v !== "string" && !(v instanceof Date)) return null
  const d = new Date(v)
  return Number.isFinite(d.getTime()) ? d : null
}

function factStr(facts: Record<string, unknown>, key: string): string | null {
  const v = facts[key]
  return typeof v === "string" ? v : null
}

// ── Existing instances ────────────────────────────────────────────────────

function instClient(i: OpenProcessInstance): string | null {
  return i.clientId ?? factStr(i.facts, "clientId")
}

/** Open (not cleared) instances of `code` for a client, newest first. */
function openInstances(
  existing: readonly OpenProcessInstance[],
  code: string,
  clientId: string,
  match: (i: OpenProcessInstance) => boolean = () => true,
): OpenProcessInstance[] {
  return existing.filter((i) => i.code === code && !i.clearedAt && instClient(i) === clientId && match(i))
}

/**
 * Cooldown: another instance of `code` for the client (and `match`) with a
 * DIFFERENT key created less than `cooldownDays` ago. The same key is never
 * blocked (that is a refresh).
 */
function inCooldown(
  env: OrderCheckEnv,
  code: string,
  clientId: string,
  key: string,
  match: (i: OpenProcessInstance) => boolean = () => true,
): boolean {
  const since = env.now.getTime() - env.params.trendCooldownDays * DAY_MS
  return env.existing.some(
    (i) =>
      i.code === code &&
      i.conditionKey !== key &&
      instClient(i) === clientId &&
      i.createdAt.getTime() >= since &&
      match(i),
  )
}

// ── Result builder ────────────────────────────────────────────────────────

class Acc {
  findings: CheckFinding[] = []
  clears: CheckClear[] = []
  evaluated = 0
  skipped: Record<string, number> = {}
  private cleared = new Set<string>()

  skip(reason: string): void {
    this.skipped[reason] = (this.skipped[reason] ?? 0) + 1
  }

  clear(instanceId: string, reasonRu: string): void {
    if (this.cleared.has(instanceId)) return
    this.cleared.add(instanceId)
    this.clears.push({ instanceId, reasonRu })
  }

  result(sortKey?: (f: CheckFinding) => number): CheckResult {
    const findings = sortKey ? [...this.findings].sort((a, b) => sortKey(b) - sortKey(a)) : this.findings
    return { findings, clears: this.clears, evaluated: this.evaluated, skipped: this.skipped }
  }
}

function finding(
  c: OrderClientInput,
  code: string,
  conditionKey: string,
  matterRu: string,
  evidenceRu: string,
  facts: Record<string, unknown>,
  score: number | null = null,
): CheckFinding {
  return {
    code,
    conditionKey,
    topicId: null,
    clientId: c.clientId,
    contactId: null,
    companyName: c.name,
    matterRu,
    evidenceRu,
    score,
    facts: { clientId: c.clientId, ...facts },
  }
}

// ── Client order statistics (shared) ────────────────────────────────────

export type ClientOrderStats = {
  /** Counted orders dated ≤ now, oldest first. */
  counted: OrderInput[]
  last: OrderInput | null
  rhythmDays: number
  pauseDays: number
  /** Best local calendar year by net revenue (counted orders ≤ now). */
  bestYear: { year: string; revenue: number } | null
  /** First non-cancelled order dated after the last counted order (booked ahead). */
  bookedAhead: OrderInput | null
}

export function clientOrderStats(c: OrderClientInput, env: OrderCheckEnv): ClientOrderStats {
  const now = env.now.getTime()
  const counted = c.orders
    .filter((o) => COUNTED.has(o.status) && o.date.getTime() <= now)
    .sort((a, b) => a.date.getTime() - b.date.getTime())
  const last = counted.at(-1) ?? null
  const rhythmDays = orderRhythmDays(
    counted.map((o) => o.date),
    env.params.dormantRhythmFloorDays,
  )
  const pauseDays = last ? days(last.date, env.now) : 0
  const byYear = new Map<string, number>()
  for (const o of counted) {
    const y = env.calendar.localDay(o.date).slice(0, 4)
    byYear.set(y, (byYear.get(y) ?? 0) + o.netTotal)
  }
  let bestYear: ClientOrderStats["bestYear"] = null
  for (const [year, revenue] of byYear) if (!bestYear || revenue > bestYear.revenue) bestYear = { year, revenue }
  const bookedAhead = last
    ? (c.orders
        .filter((o) => BOOKED.has(o.status) && o.id !== last.id && o.date.getTime() > last.date.getTime())
        .sort((a, b) => a.date.getTime() - b.date.getTime())[0] ?? null)
    : null
  return { counted, last, rhythmDays, pauseDays, bestYear, bookedAhead }
}

type DormantState = "dormant" | "no_orders" | "few_data" | "booked_ahead" | "active"

/** The ACCOUNT_DORMANT condition (incl. minimum data) of a client now. */
export function dormantState(s: ClientOrderStats, params: ChecksParams): DormantState {
  if (!s.last) return "no_orders"
  if (!s.bestYear || s.bestYear.revenue < params.dormantMinBestYearRub) return "few_data"
  if (s.bookedAhead) return "booked_ahead"
  return s.pauseDays > s.rhythmDays ? "dormant" : "active"
}

// ── ACCOUNT_DORMANT ──────────────────────────────────────────────────────

/**
 * Client stopped buying: pause since the last counted order > the client's
 * rhythm (`orderRhythmDays`, floor `dormantRhythmFloorDays`); best calendar
 * year ≥ `dormantMinBestYearRub`; nothing booked ahead. Pause > 2 × rhythm →
 * score 3 (weekly list, fyi). One instance per client and last order.
 * Clears: a newer counted order, or an order booked after the instance's last order.
 */
export function checkAccountDormant(clients: readonly OrderClientInput[], env: OrderCheckEnv): CheckResult {
  const acc = new Acc()
  const cal = env.calendar
  for (const c of clients) {
    acc.evaluated++
    const s = clientOrderStats(c, env)

    for (const inst of openInstances(env.existing, CODE.dormant, c.clientId)) {
      const since = factDate(inst.facts, "lastOrderDate")
      const lastId = factStr(inst.facts, "lastOrderId")
      if (!since) continue
      if (s.last && s.last.id !== lastId && s.last.date > since) {
        acc.clear(inst.id, `Новый заказ ${s.last.label} от ${ruDate(cal, s.last.date)}`)
        continue
      }
      const booked = c.orders
        .filter((o) => BOOKED.has(o.status) && o.id !== lastId && o.date > since)
        .sort((a, b) => a.date.getTime() - b.date.getTime())[0]
      if (booked) acc.clear(inst.id, `Есть заказ в работе ${booked.label} от ${ruDate(cal, booked.date)}`)
    }

    const state = dormantState(s, env.params)
    if (state !== "dormant") {
      acc.skip(state)
      continue
    }
    const last = s.last!
    const best = s.bestYear!
    const rhythm = Math.round(s.rhythmDays)
    const pause = Math.floor(s.pauseDays)
    const fyi = s.pauseDays > 2 * s.rhythmDays
    acc.findings.push(
      finding(
        c,
        CODE.dormant,
        `client:${c.clientId}:last_order:${last.id}`,
        "Клиент перестал покупать",
        `последний заказ ${last.label} от ${ruDate(cal, last.date)}; обычный ритм ${rhythm} дн.; ` +
          `пауза ${pause} дн.; лучший год ${best.year}: ${formatRub(best.revenue)}`,
        {
          lastOrderId: last.id,
          lastOrderLabel: last.label,
          lastOrderDate: iso(last.date),
          rhythmDays: rhythm,
          pauseDays: pause,
          orderCount: s.counted.length,
          bestYear: best.year,
          bestYearRevenue: Math.round(best.revenue),
          level: fyi ? "fyi" : "risk",
        },
        fyi ? 3 : null,
      ),
    )
  }
  return acc.result((f) => Number(f.facts.bestYearRevenue) || 0)
}

// ── ACCOUNT_PRODUCT_STOPPED ──────────────────────────────────────────────

/**
 * Client stopped buying one product: the product in ≥ `productMinOrders`
 * separate counted orders within `productLookbackMonths`; product rhythm =
 * median gap; last product order older than max(2 × rhythm,
 * `productStoppedMinDays`); the client is NOT dormant (pause ≤ client rhythm)
 * and ordered other things after; the product is active in the catalogue.
 * The «open supplier delay» condition of the rule is NOT checked (no
 * structured supplier-delay data per product yet). Cooldown
 * `trendCooldownDays` per client + product. Clear = the product ordered again.
 */
export function checkProductStopped(
  clients: readonly OrderClientInput[],
  env: OrderCheckEnv,
  extra: { activeProductIds: ReadonlySet<string> },
): CheckResult {
  const acc = new Acc()
  const cal = env.calendar
  const p = env.params
  const since = addMonths(env.now, -p.productLookbackMonths)
  for (const c of clients) {
    acc.evaluated++
    const s = clientOrderStats(c, env)

    for (const inst of openInstances(env.existing, CODE.productStopped, c.clientId)) {
      const pid = factStr(inst.facts, "productId")
      const lastP = factDate(inst.facts, "lastProductOrderDate")
      if (!pid || !lastP) continue
      const again = s.counted.find((o) => o.date > lastP && o.items?.some((it) => it.productId === pid))
      if (again) {
        const name = factStr(inst.facts, "productName") ?? "позиция"
        acc.clear(inst.id, `Снова заказали: ${shorten(name)} — заказ ${again.label} от ${ruDate(cal, again.date)}`)
      }
    }

    if (!s.last) {
      acc.skip("no_orders")
      continue
    }
    if (s.pauseDays > s.rhythmDays) {
      acc.skip("client_dormant")
      continue
    }

    // Distinct orders per product in the lookback window.
    const perProduct = new Map<string, { name: string; orders: OrderInput[] }>()
    for (const o of s.counted) {
      if (o.date < since) continue
      const seen = new Set<string>()
      for (const it of o.items ?? []) {
        if (seen.has(it.productId)) continue
        seen.add(it.productId)
        const e = perProduct.get(it.productId) ?? { name: it.productName, orders: [] }
        e.orders.push(o)
        perProduct.set(it.productId, e)
      }
    }

    for (const [productId, e] of perProduct) {
      if (e.orders.length < p.productMinOrders) continue
      const dates = e.orders.map((o) => o.date.getTime()).sort((a, b) => a - b)
      const gaps = dates.slice(1).map((t, i) => (t - dates[i]) / DAY_MS)
      const rhythm = median(gaps)
      const lastP = e.orders.reduce((a, b) => (b.date > a.date ? b : a))
      const threshold = Math.max(2 * rhythm, p.productStoppedMinDays)
      const age = days(lastP.date, env.now)
      if (age <= threshold) continue
      if (!extra.activeProductIds.has(productId)) {
        acc.skip("product_inactive")
        continue
      }
      if (s.last.date <= lastP.date) {
        acc.skip("no_other_orders")
        continue
      }
      const key = `client:${c.clientId}:product:${productId}:last:${lastP.id}`
      const sameProduct = (i: OpenProcessInstance) => factStr(i.facts, "productId") === productId
      if (inCooldown(env, CODE.productStopped, c.clientId, key, sameProduct)) {
        acc.skip("cooldown")
        continue
      }
      const months = p.productLookbackMonths
      acc.findings.push(
        finding(
          c,
          CODE.productStopped,
          key,
          `Перестал покупать: ${shorten(e.name)}`,
          `${e.name}: брали каждые ~${Math.round(rhythm)} дн. (${e.orders.length} заказов за ${months} мес.), ` +
            `последний раз ${ruDate(cal, lastP.date)} (${Math.floor(age)} дн. назад); ` +
            `другие позиции клиент заказывал ${ruDate(cal, s.last.date)}`,
          {
            productId,
            productName: e.name,
            productOrders: e.orders.length,
            rhythmDays: Math.round(rhythm),
            thresholdDays: Math.round(threshold),
            daysSince: Math.floor(age),
            lastProductOrderId: lastP.id,
            lastProductOrderLabel: lastP.label,
            lastProductOrderDate: iso(lastP.date),
            clientLastOrderId: s.last.id,
            clientLastOrderDate: iso(s.last.date),
          },
        ),
      )
    }
  }
  return acc.result((f) => Number(f.facts.productOrders) || 0)
}

// ── ACCOUNT_PRODUCT_NEW ──────────────────────────────────────────────────

/**
 * First purchase of a product: counted orders dated in the last
 * `productNewLookbackDays`; products in no earlier counted order of the
 * client; the client has an earlier order and ≥ `productNewMinHistoryDays`
 * of history. One finding per order (all new products). No clears.
 */
export function checkProductNew(clients: readonly OrderClientInput[], env: OrderCheckEnv): CheckResult {
  const acc = new Acc()
  const cal = env.calendar
  const p = env.params
  const from = env.now.getTime() - p.productNewLookbackDays * DAY_MS
  for (const c of clients) {
    acc.evaluated++
    const s = clientOrderStats(c, env)
    if (!s.last) {
      acc.skip("no_orders")
      continue
    }
    const first = s.counted[0]
    for (const o of s.counted) {
      if (o.date.getTime() <= from) continue
      const earlier = s.counted.filter((x) => x.date < o.date)
      if (earlier.length === 0) {
        acc.skip("first_order")
        continue
      }
      const historyDays = days(first.date, o.date)
      if (historyDays < p.productNewMinHistoryDays) {
        acc.skip("few_data")
        continue
      }
      const seenBefore = (pid: string): boolean => {
        const firstAt = c.productFirstAt?.get(pid)
        if (firstAt) return firstAt < o.date
        return earlier.some((x) => x.items?.some((it) => it.productId === pid))
      }
      const fresh = new Map<string, OrderLineInput>()
      for (const it of o.items ?? []) {
        if (seenBefore(it.productId)) continue
        const prev = fresh.get(it.productId)
        fresh.set(it.productId, prev ? { ...prev, qty: prev.qty + it.qty } : { ...it })
      }
      if (fresh.size === 0) {
        acc.skip("no_new_product")
        continue
      }
      const list = [...fresh.values()]
      const shown = list.slice(0, 5).map((it) => `${it.productName} (${it.qty} шт.)`)
      const more = list.length > 5 ? ` и ещё ${list.length - 5}` : ""
      acc.findings.push(
        finding(
          c,
          CODE.productNew,
          `order:${o.id}`,
          list.length > 1 ? `Новые позиции в заказе ${o.label}` : `Новая позиция в заказе ${o.label}`,
          `заказ ${o.label} от ${ruDate(cal, o.date)}: впервые взяли ${shown.join(", ")}${more}`,
          {
            orderId: o.id,
            orderLabel: o.label,
            orderDate: iso(o.date),
            historyDays: Math.floor(historyDays),
            products: list.map((it) => ({ productId: it.productId, productName: it.productName, qty: it.qty })),
          },
        ),
      )
    }
  }
  return acc.result()
}

// ── ACCOUNT_NEW_FOLLOWUP ─────────────────────────────────────────────────

/**
 * Follow-up after the first order: the client's first counted order is
 * `finalized`, `newClientFollowupDays` … + 14 days old, no second counted
 * order, no outbound contact (linked outbound source item) after it.
 * Clears: a second counted order, or an outbound contact after the first order.
 */
export function checkNewFollowup(
  clients: readonly OrderClientInput[],
  env: OrderCheckEnv,
  extra: { lastOutboundAt: ReadonlyMap<string, Date> },
): CheckResult {
  const acc = new Acc()
  const cal = env.calendar
  const p = env.params
  for (const c of clients) {
    acc.evaluated++
    // All counted orders, future-dated ones too (a booked second order counts).
    const counted = c.orders.filter((o) => COUNTED.has(o.status)).sort((a, b) => a.date.getTime() - b.date.getTime())
    const outbound = extra.lastOutboundAt.get(c.clientId) ?? null

    for (const inst of openInstances(env.existing, CODE.newFollowup, c.clientId)) {
      const firstId = factStr(inst.facts, "firstOrderId")
      const firstAt = factDate(inst.facts, "firstOrderDate")
      const second = counted.find((o) => o.id !== firstId)
      if (second) acc.clear(inst.id, `Второй заказ ${second.label} от ${ruDate(cal, second.date)}`)
      else if (outbound && firstAt && outbound > firstAt) acc.clear(inst.id, `Исходящий контакт ${ruDate(cal, outbound)}`)
    }

    if (counted.length === 0) {
      acc.skip("no_orders")
      continue
    }
    if (counted.length > 1) {
      acc.skip("second_order")
      continue
    }
    const first = counted[0]
    if (first.status !== "finalized") {
      acc.skip("not_finalized")
      continue
    }
    const age = days(first.date, env.now)
    if (age < p.newClientFollowupDays) {
      acc.skip("too_early")
      continue
    }
    if (age > p.newClientFollowupDays + 14) {
      acc.skip("too_late")
      continue
    }
    if (outbound && outbound > first.date) {
      acc.skip("contacted")
      continue
    }
    acc.findings.push(
      finding(
        c,
        CODE.newFollowup,
        `client:${c.clientId}:first_order:${first.id}`,
        "Пора обсудить первый заказ",
        `первый заказ ${first.label} отгружен ${ruDate(cal, first.date)} (${formatRub(first.netTotal)}); ` +
          `с тех пор исходящего контакта не было (${Math.floor(age)} дн.)`,
        {
          firstOrderId: first.id,
          firstOrderLabel: first.label,
          firstOrderDate: iso(first.date),
          firstOrderNet: Math.round(first.netTotal),
          daysSince: Math.floor(age),
        },
      ),
    )
  }
  return acc.result()
}

// ── Revenue windows (YoY + stagnation) ──────────────────────────────────

type MonthAgg = { revenue: number; orders: number }

function monthTotals(counted: readonly OrderInput[], cal: Pick<WorkCalendar, "localDay">): Map<string, MonthAgg> {
  const out = new Map<string, MonthAgg>()
  for (const o of counted) {
    const ym = cal.localDay(o.date).slice(0, 7)
    const e = out.get(ym) ?? { revenue: 0, orders: 0 }
    e.revenue += o.netTotal
    e.orders++
    out.set(ym, e)
  }
  return out
}

function sumMonths(totals: Map<string, MonthAgg>, fromYm: string, toYm: string): MonthAgg {
  const acc: MonthAgg = { revenue: 0, orders: 0 }
  for (const [ym, e] of totals) {
    if (ym >= fromYm && ym <= toYm) {
      acc.revenue += e.revenue
      acc.orders += e.orders
    }
  }
  return acc
}

/** The last 12 FULL local months before `now`: [start, end] as "YYYY-MM". */
export function rollingWindow(now: Date, cal: Pick<WorkCalendar, "localDay">): { start: string; end: string } {
  const cur = cal.localDay(now).slice(0, 7)
  return { start: shiftMonth(cur, -12), end: shiftMonth(cur, -1) }
}

// ── ACCOUNT_REVENUE_DECLINE_YOY / ACCOUNT_REVENUE_GROWTH_YOY ─────────────

/**
 * 12 full months vs the 12 months before. Minimum data: first counted order
 * ≥ 24 months before the run, ≥ 3 orders and ≥ `revenueTrendMinRub` in the
 * baseline. Decline ≥ `revenueDeclineThresholdPct` % AND ≥
 * `revenueDeclineMinRub`; growth ≥ `revenueGrowthThresholdPct` % AND ≥
 * `revenueGrowthMinRub`. Decline is suppressed when the window has no order,
 * or the client is dormant (an open ACCOUNT_DORMANT instance, or the dormant
 * condition is true now). While an instance of the code is open and the
 * condition holds, it is refreshed (its own key); otherwise a new key after
 * the cooldown. Clear = the condition is false (incl. too little data).
 */
export function checkRevenueYoy(
  clients: readonly OrderClientInput[],
  env: OrderCheckEnv,
  extra: { openDormantClientIds: ReadonlySet<string> },
): CheckResult {
  const acc = new Acc()
  const cal = env.calendar
  const p = env.params
  const win = rollingWindow(env.now, cal)
  const base = { start: shiftMonth(win.start, -12), end: shiftMonth(win.end, -12) }
  const period = (w: { start: string; end: string }) => `${ruMonth(w.start)}–${ruMonth(w.end)}`
  const minFirst = addMonths(env.now, -24)

  for (const c of clients) {
    acc.evaluated++
    const s = clientOrderStats(c, env)
    const totals = monthTotals(s.counted, cal)
    const w = sumMonths(totals, win.start, win.end)
    const b = sumMonths(totals, base.start, base.end)
    const first = s.counted[0] ?? null
    const minData = !!first && first.date <= minFirst && b.orders >= 3 && b.revenue >= p.revenueTrendMinRub
    const diff = w.revenue - b.revenue
    const pct = b.revenue > 0 ? (diff / b.revenue) * 100 : 0
    const dormant = extra.openDormantClientIds.has(c.clientId) || dormantState(s, p) === "dormant"

    const states: { code: string; state: "true" | "false" | "no_window_order" | "dormant" }[] = [
      {
        code: CODE.declineYoy,
        state:
          minData && -pct >= p.revenueDeclineThresholdPct && -diff >= p.revenueDeclineMinRub
            ? w.orders === 0
              ? "no_window_order"
              : dormant
                ? "dormant"
                : "true"
            : "false",
      },
      {
        code: CODE.growthYoy,
        state: minData && pct >= p.revenueGrowthThresholdPct && diff >= p.revenueGrowthMinRub ? "true" : "false",
      },
    ]
    if (!minData) acc.skip("few_data")

    const evidence =
      `выручка за 12 мес. (${period(win)}): ${formatRub(w.revenue)}; год назад (${period(base)}): ${formatRub(b.revenue)} ` +
      `(${signedPct(pct)}, ${signedRub(diff)}); заказов ${w.orders} против ${b.orders}`
    const facts = {
      windowStart: win.start,
      windowEnd: win.end,
      windowRevenue: Math.round(w.revenue),
      windowOrders: w.orders,
      baselineStart: base.start,
      baselineEnd: base.end,
      baselineRevenue: Math.round(b.revenue),
      baselineOrders: b.orders,
      changeRub: Math.round(diff),
      changePct: Math.round(pct * 10) / 10,
      firstOrderDate: first ? iso(first.date) : null,
    }

    for (const { code, state } of states) {
      const open = openInstances(env.existing, code, c.clientId)
      if (state === "no_window_order" || state === "dormant") {
        acc.skip(state)
        continue
      }
      if (state === "false") {
        const reason = minData
          ? `Условие больше не выполняется: ${evidence}`
          : "Недостаточно данных для сравнения год к году"
        for (const inst of open) acc.clear(inst.id, reason)
        continue
      }
      const key = open[0]?.conditionKey ?? `client:${c.clientId}:window:${win.end}`
      if (!open[0] && inCooldown(env, code, c.clientId, key)) {
        acc.skip("cooldown")
        continue
      }
      acc.findings.push(
        finding(
          c,
          code,
          key,
          code === CODE.declineYoy ? "Выручка снизилась год к году" : "Выручка выросла год к году",
          evidence,
          facts,
        ),
      )
    }
  }
  return acc.result((f) => Math.abs(Number(f.facts.changeRub) || 0))
}

// ── ACCOUNT_REVENUE_STAGNATION ───────────────────────────────────────────

/**
 * Orders in each of the last 4 full calendar years; best of them ≥
 * `revenueTrendMinRub`; a YoY drop ≥ `revenueStagnationThresholdPct` % in at
 * least one of the last 3 full years; the last 12 full months ≤ best year ×
 * (1 + `revenueGrowthThresholdPct` %). Key = the last full year. Refresh
 * while open, cooldown, clear when false — as the YoY check.
 */
export function checkRevenueStagnation(clients: readonly OrderClientInput[], env: OrderCheckEnv): CheckResult {
  const acc = new Acc()
  const cal = env.calendar
  const p = env.params
  const curYear = Number(cal.localDay(env.now).slice(0, 4))
  const years = [curYear - 4, curYear - 3, curYear - 2, curYear - 1].map(String)
  const win = rollingWindow(env.now, cal)

  for (const c of clients) {
    acc.evaluated++
    const s = clientOrderStats(c, env)
    const totals = monthTotals(s.counted, cal)
    const perYear = years.map((y) => sumMonths(totals, `${y}-01`, `${y}-12`))
    const best = Math.max(...perYear.map((y) => y.revenue))
    const last12 = sumMonths(totals, win.start, win.end).revenue
    const minData = perYear.every((y) => y.orders > 0) && best >= p.revenueTrendMinRub
    const changes = [1, 2, 3].map((i) => {
      const prev = perYear[i - 1].revenue
      return prev > 0 ? ((perYear[i].revenue - prev) / prev) * 100 : 0
    })
    const dropYears = [1, 2, 3].filter((i) => -changes[i - 1] >= p.revenueStagnationThresholdPct).map((i) => years[i])
    const capped = last12 <= best * (1 + p.revenueGrowthThresholdPct / 100)
    const holds = minData && dropYears.length > 0 && capped
    if (!minData) acc.skip("few_data")

    const parts = years.map((y, i) => `${y}: ${formatRub(perYear[i].revenue)}${i > 0 ? ` (${signedPct(changes[i - 1])})` : ""}`)
    const evidence = `выручка ${parts.join("; ")}; последние 12 мес. (${ruMonth(win.start)}–${ruMonth(win.end)}): ${formatRub(last12)}`
    const open = openInstances(env.existing, CODE.stagnation, c.clientId)
    if (!holds) {
      if (minData && dropYears.length > 0 && !capped) acc.skip("growing")
      const reason = minData ? `Условие больше не выполняется: ${evidence}` : "Недостаточно данных по годам"
      for (const inst of open) acc.clear(inst.id, reason)
      continue
    }
    const key = open[0]?.conditionKey ?? `client:${c.clientId}:year:${years[3]}`
    if (!open[0] && inCooldown(env, CODE.stagnation, c.clientId, key)) {
      acc.skip("cooldown")
      continue
    }
    acc.findings.push(
      finding(c, CODE.stagnation, key, "Выручка не растёт", evidence, {
        years: Object.fromEntries(years.map((y, i) => [y, Math.round(perYear[i].revenue)])),
        dropYears,
        bestYearRevenue: Math.round(best),
        last12Revenue: Math.round(last12),
        windowStart: win.start,
        windowEnd: win.end,
      }),
    )
  }
  return acc.result((f) => Number(f.facts.bestYearRevenue) || 0)
}

// ── ACCOUNT_REACTIVATION_DUE ─────────────────────────────────────────────

/**
 * Time to restart contact: former clients (last counted order older than
 * `formerClientMonths`, or a lost deal and no counted order in that time) and
 * leads (tab «Потенциальные», no counted order); no open order (draft /
 * awaiting_client, or confirmed in the future); no not-cleared ACCOUNT_DORMANT
 * instance; no contact for `reactivationIntervalDays` (silence counted from
 * the last contact, or from the client's creation when later). Contact =
 * `ReactivationInfo.lastContactAt` and any order date ≤ now. «Declined our
 * last offer» is not detected (no structured data). Clear = any contact after
 * the instance's silence start.
 */
export function checkReactivationDue(
  clients: readonly OrderClientInput[],
  env: OrderCheckEnv,
  extra: { info: ReadonlyMap<string, ReactivationInfo>; openDormantClientIds: ReadonlySet<string> },
): CheckResult {
  const acc = new Acc()
  const cal = env.calendar
  const p = env.params
  const now = env.now.getTime()
  const formerBefore = addMonths(env.now, -p.formerClientMonths)
  for (const c of clients) {
    acc.evaluated++
    const info = extra.info.get(c.clientId) ?? { lastContactAt: null, hasLostDeal: false, potentialTab: false }
    const s = clientOrderStats(c, env)

    let lastContact: Date | null = info.lastContactAt && info.lastContactAt.getTime() <= now ? info.lastContactAt : null
    for (const o of c.orders) {
      if (o.date.getTime() <= now && (!lastContact || o.date > lastContact)) lastContact = o.date
    }

    for (const inst of openInstances(env.existing, CODE.reactivation, c.clientId)) {
      const since = factDate(inst.facts, "silenceSince")
      if (since && lastContact && lastContact > since) acc.clear(inst.id, `Был контакт ${ruDate(cal, lastContact)}`)
    }

    if (c.companyKind === "supplier" || c.companyKind === "partner") {
      acc.skip("not_client")
      continue
    }
    const recentOrder = !!s.last && s.last.date >= formerBefore
    const former = (!!s.last && !recentOrder) || (!recentOrder && info.hasLostDeal)
    const lead = !s.last && info.potentialTab
    if (!former && !lead) {
      acc.skip(s.last ? "active_client" : "not_target")
      continue
    }
    const openOrder = c.orders.some(
      (o) => OPEN_ANY_DATE.has(o.status) || (o.status === "confirmed" && o.date.getTime() > now),
    )
    if (openOrder) {
      acc.skip("open_order")
      continue
    }
    if (extra.openDormantClientIds.has(c.clientId)) {
      acc.skip("dormant")
      continue
    }
    const silenceSince = lastContact && lastContact > c.createdAt ? lastContact : c.createdAt
    const silent = days(silenceSince, env.now)
    if (silent < p.reactivationIntervalDays) {
      acc.skip("recent_contact")
      continue
    }
    const kindRu = former ? "бывший клиент" : "лид"
    const contactRu = lastContact
      ? `последний контакт ${ruDate(cal, lastContact)}`
      : `контактов не было, компания добавлена ${ruDate(cal, c.createdAt)}`
    const lastOrderRu = s.last ? `; последний заказ ${s.last.label} от ${ruDate(cal, s.last.date)}` : ""
    acc.findings.push(
      finding(
        c,
        CODE.reactivation,
        `client:${c.clientId}:silence_since:${cal.localDay(silenceSince)}`,
        "Пора возобновить контакт",
        `${contactRu}; ${Math.floor(silent)} дн. без контакта; статус — ${kindRu}${lastOrderRu}`,
        {
          kind: former ? "former" : "lead",
          lastContactAt: lastContact ? iso(lastContact) : null,
          silenceSince: iso(silenceSince),
          silentDays: Math.floor(silent),
          lastOrderId: s.last?.id ?? null,
          lastOrderDate: s.last ? iso(s.last.date) : null,
          hasLostDeal: info.hasLostDeal,
        },
      ),
    )
  }
  return acc.result((f) => Number(f.facts.silentDays) || 0)
}

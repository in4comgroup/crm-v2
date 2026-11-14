// CRM-data checks of topics plan phase 8 (follow-up; spec topics/01 §5.6,
// 05 §3.6): ACCOUNT_MEETING_OVERDUE, INTERNAL_PRICE_CHANGE,
// INTERNAL_PRODUCT_STATUS_UPDATE. PURE: no DB, no server imports — the
// loaders live in `crm-data-loaders.ts`, the writes in `store.ts`. Same
// result contract as `orders.ts`: findings = conditions TRUE now, clears =
// open instances whose condition is no longer true, insufficient data never
// produces a finding (counted in `skipped`).
//
// The catalogue checks compare the catalogue (`product`) with the last seen
// state (`product_watch_state`). The evaluator only COMPARES; the runner
// writes the new state after the store applied the result
// (`refreshProductWatchState`). No state at all for the org = first run
// (seed): nothing is emitted.

import type { WorkCalendar } from "@/lib/topics/attention-calendar"
import type { CheckFinding, CheckResult, ChecksParams, OpenProcessInstance } from "@/lib/topics/checks"
import {
  Acc,
  clientOrderStats,
  factDate,
  factStr,
  formatRub,
  monthTotals,
  rollingWindow,
  ruDate,
  sumMonths,
  type OrderClientInput,
} from "./orders"

const DAY_MS = 86_400_000

export const CRM_CODE = {
  meetingOverdue: "ACCOUNT_MEETING_OVERDUE",
  priceChange: "INTERNAL_PRICE_CHANGE",
  productStatus: "INTERNAL_PRODUCT_STATUS_UPDATE",
} as const

export type CrmCheckEnv = {
  now: Date
  params: ChecksParams
  calendar: Pick<WorkCalendar, "localDay">
  /** Process instances of the check's code(s), newest first (CheckContext.existing). */
  existing: readonly OpenProcessInstance[]
}

// ── Russian formatting ───────────────────────────────────────────────────

/** Russian plural: plural(4, "день", "дня", "дней") → «дня». */
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(Math.trunc(n))
  const m10 = a % 10
  const m100 = a % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

function clientsRu(n: number): string {
  return `${n} ${plural(n, "клиент", "клиента", "клиентов")}`
}

/** 1290 → «1 290», 1290.5 → «1 290,50». */
export function formatPrice(n: number): string {
  const cents = Math.round(n * 100)
  const whole = Math.trunc(Math.abs(cents) / 100)
  const frac = Math.abs(cents) % 100
  const s = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, " ")
  return `${cents < 0 ? "−" : ""}${s}${frac ? `,${String(frac).padStart(2, "0")}` : ""}`
}

/** 7.5 → «+7,5 %», −10 → «−10 %». */
export function formatPct(p: number): string {
  const r = Math.round(Math.abs(p) * 10) / 10
  const s = (Number.isInteger(r) ? String(r) : r.toFixed(1)).replace(".", ",")
  return `${p < 0 ? "−" : "+"}${s} %`
}

function shorten(s: string, max = 60): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`
}

function days(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / DAY_MS
}

// ── Client segment (derived, no stored field) ────────────────────────────

export type Segment = "A" | "B" | "C"
export type ClientSegment = { segment: Segment; revenue: number }

/** Net revenue of counted orders in the last 12 FULL local months. */
export function clientRevenue12m(c: OrderClientInput, env: CrmCheckEnv): number {
  const s = clientOrderStats(c, { now: env.now, params: env.params, calendar: env.calendar, existing: env.existing })
  const win = rollingWindow(env.now, env.calendar)
  return sumMonths(monthTotals(s.counted, env.calendar), win.start, win.end).revenue
}

/**
 * Segments by 12-month revenue: clients ranked by revenue (desc); a client is
 * A while the revenue share of the clients ranked above it is < `segmentAPct`
 * % (so the top client is always A), B while < `segmentAPct` + `segmentBPct`
 * %, else C. Clients with no revenue get no segment.
 */
export function deriveSegments(clients: readonly OrderClientInput[], env: CrmCheckEnv): Map<string, ClientSegment> {
  const ranked = clients
    .map((c) => ({ id: c.clientId, revenue: clientRevenue12m(c, env) }))
    .filter((r) => r.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue || a.id.localeCompare(b.id))
  const total = ranked.reduce((s, r) => s + r.revenue, 0)
  const out = new Map<string, ClientSegment>()
  const a = env.params.segmentAPct
  const ab = a + env.params.segmentBPct
  let cum = 0
  for (const r of ranked) {
    const before = (cum / total) * 100
    out.set(r.id, { segment: before < a ? "A" : before < ab ? "B" : "C", revenue: r.revenue })
    cum += r.revenue
  }
  return out
}

function frequencyDays(seg: Segment, p: ChecksParams): number {
  return seg === "A" ? p.meetingFrequencyADays : seg === "B" ? p.meetingFrequencyBDays : p.meetingFrequencyCDays
}

// ── ACCOUNT_MEETING_OVERDUE ──────────────────────────────────────────────

/** A meeting with a client: calendar invite, meeting task, or an agreed meeting date in a message. */
export type MeetingFact = { clientId: string; at: Date; kind: "calendar" | "task" | "proposed" }

const MEETING_KIND_RU: Record<MeetingFact["kind"], string> = {
  calendar: "приглашение в календаре",
  task: "задача-встреча",
  proposed: "дата встречи из переписки",
}

/**
 * The last meeting with a segmented client is older than the segment's
 * norm (`meetingFrequencyA/B/CDays`). Minimum data: a calendar-capable source
 * for the org (else nothing at all: `no_calendar_source`), a segment
 * (12-month revenue > 0) and at least one past meeting with the client
 * (`no_meeting_history`). Cooldown `trendCooldownDays` per client. Key =
 * the local day of the last meeting. Clears: a newer meeting, or the
 * condition is false (norm met / no segment any more).
 */
export function checkMeetingOverdue(
  clients: readonly OrderClientInput[],
  env: CrmCheckEnv,
  extra: { hasCalendarSource: boolean; meetings: ReadonlyMap<string, readonly MeetingFact[]> },
): CheckResult {
  const acc = new Acc()
  if (!extra.hasCalendarSource) {
    acc.evaluated = clients.length
    if (clients.length) acc.skipped.no_calendar_source = clients.length
    return acc.result()
  }
  const cal = env.calendar
  const p = env.params
  const now = env.now.getTime()
  const segments = deriveSegments(clients, env)
  const win = rollingWindow(env.now, cal)

  for (const c of clients) {
    acc.evaluated++
    const seg = segments.get(c.clientId) ?? null
    const past = (extra.meetings.get(c.clientId) ?? []).filter((m) => m.at.getTime() <= now)
    const last = past.reduce<MeetingFact | null>((a, m) => (!a || m.at > a.at ? m : a), null)
    const freq = seg ? frequencyDays(seg.segment, p) : 0
    const age = last ? days(last.at, env.now) : 0
    const overdue = !!seg && !!last && age > freq

    for (const inst of env.existing) {
      if (inst.code !== CRM_CODE.meetingOverdue || inst.clearedAt) continue
      if ((inst.clientId ?? factStr(inst.facts, "clientId")) !== c.clientId) continue
      const since = factDate(inst.facts, "lastMeetingDate")
      if (last && since && cal.localDay(last.at) > cal.localDay(since)) {
        acc.clear(inst.id, `Встреча ${ruDate(cal, last.at)} (${MEETING_KIND_RU[last.kind]})`)
      } else if (!seg) {
        acc.clear(inst.id, "Нет выручки за 12 мес. — сегмент не определён")
      } else if (!overdue) {
        acc.clear(inst.id, `Норма сегмента ${seg.segment} (раз в ${freq} дн.) выполняется`)
      }
    }

    if (!seg) {
      acc.skip("no_segment")
      continue
    }
    if (!last) {
      acc.skip("no_meeting_history")
      continue
    }
    if (!overdue) {
      acc.skip("recent_meeting")
      continue
    }
    const day = cal.localDay(last.at)
    const key = `client:${c.clientId}:last_meeting:${day}`
    const since = env.now.getTime() - p.trendCooldownDays * DAY_MS
    const cooldown = env.existing.some(
      (i) =>
        i.code === CRM_CODE.meetingOverdue &&
        i.conditionKey !== key &&
        (i.clientId ?? factStr(i.facts, "clientId")) === c.clientId &&
        i.createdAt.getTime() >= since,
    )
    if (cooldown) {
      acc.skip("cooldown")
      continue
    }
    const ago = Math.floor(age)
    acc.findings.push({
      code: CRM_CODE.meetingOverdue,
      conditionKey: key,
      topicId: null,
      clientId: c.clientId,
      contactId: null,
      companyName: c.name,
      matterRu: "Давно не было встречи",
      evidenceRu:
        `сегмент ${seg.segment} (выручка за 12 мес.: ${formatRub(seg.revenue)}); ` +
        `последняя встреча ${ruDate(cal, last.at)}, ${ago} ${plural(ago, "день", "дня", "дней")} назад; ` +
        `норма — раз в ${freq} ${plural(freq, "день", "дня", "дней")}`,
      score: null,
      facts: {
        clientId: c.clientId,
        segment: seg.segment,
        revenue12m: Math.round(seg.revenue),
        windowStart: win.start,
        windowEnd: win.end,
        lastMeetingDate: last.at.toISOString(),
        lastMeetingKind: last.kind,
        daysSince: ago,
        frequencyDays: freq,
        meetings: past.length,
      },
    })
  }
  return acc.result((f) => Number(f.facts.revenue12m) || 0)
}

// ── Catalogue (INTERNAL_PRICE_CHANGE / INTERNAL_PRODUCT_STATUS_UPDATE) ───

export type CatalogueProduct = {
  id: string
  name: string
  price: number | null
  /** entity_status: active | deleted | … */
  status: string
  totalStock: number | null
  /** `additional_metadata.year` (vintage), as text. */
  vintage: string | null
}

/** Last seen state of a product (`product_watch_state`). */
export type WatchState = {
  productId: string
  price: number | null
  status: string | null
  totalStock: number | null
  vintage: string | null
}

export type CatalogueData = {
  products: readonly CatalogueProduct[]
  /** Last seen states of the org. Empty = first run (seed, no signal). */
  states: ReadonlyMap<string, WatchState>
  /** Distinct clients with a counted order of the product in the last `buyerLookbackMonths`. */
  buyers: ReadonlyMap<string, number>
  /** Products in a counted order in the last `stockOutRecentOrderDays`. */
  recentOrdered: ReadonlySet<string>
}

const cents = (n: number) => Math.round(n * 100)

/** Instances of `code` with another key created in the cooldown window (`internalCooldownDays`). */
function recentInstances(env: CrmCheckEnv, code: string, key: string): OpenProcessInstance[] {
  const since = env.now.getTime() - env.params.internalCooldownDays * DAY_MS
  return env.existing.filter((i) => i.code === code && i.conditionKey !== key && i.createdAt.getTime() >= since)
}

export type PriceChange = {
  productId: string
  name: string
  old: number
  new: number
  /** null = old price 0. */
  pct: number | null
  buyers: number
  direction: "up" | "down"
}

/** At most this many SKUs are stored in the finding's facts (the evidence shows 5). */
export const PRICE_FACTS_MAX = 500

/**
 * Prices of ACTIVE products against the last seen state: a change ≥
 * `priceChangeThresholdPct` %, or any change for a SKU a client ordered in
 * the last `buyerLookbackMonths`. ONE finding per org and local day with all
 * changed SKUs (key `catalog:prices:<day>`, no topic / client). Per-SKU
 * cooldown `internalCooldownDays` (from the facts of earlier findings),
 * except a change of direction. No state = no signal. No clears (an event).
 */
export function checkPriceChange(data: CatalogueData, env: CrmCheckEnv): CheckResult {
  const acc = new Acc()
  acc.evaluated = data.products.length
  if (data.states.size === 0) {
    acc.skip("no_snapshot")
    return acc.result()
  }
  const p = env.params
  const day = env.calendar.localDay(env.now)
  const key = `catalog:prices:${day}`

  // Newest direction per SKU within the cooldown window.
  const lastDir = new Map<string, string>()
  for (const inst of recentInstances(env, CRM_CODE.priceChange, key)) {
    const list = Array.isArray(inst.facts.changes) ? (inst.facts.changes as Record<string, unknown>[]) : []
    for (const ch of list) {
      const id = typeof ch?.productId === "string" ? ch.productId : null
      const dir = typeof ch?.direction === "string" ? ch.direction : null
      if (id && dir && !lastDir.has(id)) lastDir.set(id, dir)
    }
  }

  const changes: PriceChange[] = []
  for (const prod of data.products) {
    if (prod.status !== "active") continue
    const st = data.states.get(prod.id)
    if (!st) continue
    if (st.price == null || prod.price == null) continue
    if (cents(st.price) === cents(prod.price)) continue
    const diff = prod.price - st.price
    const pct = st.price > 0 ? (diff / st.price) * 100 : null
    const buyers = data.buyers.get(prod.id) ?? 0
    if (pct !== null && Math.abs(pct) < p.priceChangeThresholdPct && buyers === 0) {
      acc.skip("small_change")
      continue
    }
    const direction = diff > 0 ? "up" : "down"
    if (lastDir.get(prod.id) === direction) {
      acc.skip("cooldown")
      continue
    }
    changes.push({ productId: prod.id, name: prod.name, old: st.price, new: prod.price, pct, buyers, direction })
  }
  if (changes.length === 0) return acc.result()

  changes.sort(
    (a, b) =>
      b.buyers - a.buyers || Math.abs(b.pct ?? 1000) - Math.abs(a.pct ?? 1000) || a.name.localeCompare(b.name, "ru"),
  )
  const n = changes.length
  const shown = changes.slice(0, 5).map((ch) => {
    const extras = [ch.pct === null ? "было 0" : formatPct(ch.pct), ch.buyers ? `брали ${clientsRu(ch.buyers)}` : ""]
      .filter(Boolean)
      .join(", ")
    return `${shorten(ch.name)} ${formatPrice(ch.old)} → ${formatPrice(ch.new)} ₽ (${extras})`
  })
  const more = n > 5 ? `; и ещё ${n - 5}` : ""
  const head = n === 1 ? "изменилась цена 1 позиции" : `изменились цены ${n} ${plural(n, "позиции", "позиций", "позиций")}`
  const finding: CheckFinding = {
    code: CRM_CODE.priceChange,
    conditionKey: key,
    topicId: null,
    clientId: null,
    contactId: null,
    companyName: null,
    matterRu: "Изменились цены каталога",
    evidenceRu: `${head}: ${shown.join("; ")}${more}`,
    score: null,
    facts: {
      day,
      count: n,
      truncated: n > PRICE_FACTS_MAX,
      changes: changes.slice(0, PRICE_FACTS_MAX).map((ch) => ({
        productId: ch.productId,
        name: ch.name,
        old: ch.old,
        new: ch.new,
        pct: ch.pct === null ? null : Math.round(ch.pct * 10) / 10,
        buyers: ch.buyers,
        direction: ch.direction,
      })),
    },
  }
  acc.findings.push(finding)
  return acc.result()
}

export type ProductEvent = "withdrawn" | "stock_out" | "vintage" | "stock_back" | "added"

/** Order of importance (the cap keeps the first ones). */
const EVENT_RANK: Record<ProductEvent, number> = { withdrawn: 0, stock_out: 1, vintage: 2, stock_back: 3, added: 4 }

const EVENT_MATTER_RU: Record<ProductEvent, string> = {
  withdrawn: "Позиция выведена",
  stock_out: "Закончился остаток",
  vintage: "Сменился винтаж",
  stock_back: "Снова в наличии",
  added: "Новая позиция",
}

/**
 * Per SKU and event against the last seen state: `added` (a product row
 * never seen, only when the org already has states), `withdrawn` (status
 * leaves `active`), `stock_out` (`total_stock` > 0 → 0 for a SKU ordered in
 * the last `stockOutRecentOrderDays`), `stock_back` (0 → > 0), `vintage`
 * (`additional_metadata.year` changed, both known). Key
 * `product:<id>:<event>:<day>`, no topic / client. Cooldown
 * `internalCooldownDays` per SKU + event. Findings come most important
 * first; the store writes at most `maxNewPerCheckPerRun` new ones per run and
 * defers the rest — the runner then keeps the old state of those SKUs
 * (`heldProductIds` → `planWatchStateWrites`), so the next run finds them
 * again. No state = no signal. No clears (an event).
 */
export function checkProductStatus(data: CatalogueData, env: CrmCheckEnv): CheckResult {
  const acc = new Acc()
  acc.evaluated = data.products.length
  if (data.states.size === 0) {
    acc.skip("no_snapshot")
    return acc.result()
  }
  const cal = env.calendar
  const p = env.params
  const day = cal.localDay(env.now)
  const today = ruDate(cal, env.now)
  const since = env.now.getTime() - p.internalCooldownDays * DAY_MS
  // SKU + event → condition keys created in the cooldown window.
  const recent = new Map<string, Set<string>>()
  for (const i of env.existing) {
    if (i.code !== CRM_CODE.productStatus || i.createdAt.getTime() < since) continue
    const pid = factStr(i.facts, "productId")
    const ev = factStr(i.facts, "event")
    if (!pid || !ev) continue
    const k = `${pid}\u0000${ev}`
    recent.set(k, (recent.get(k) ?? new Set()).add(i.conditionKey))
  }
  const inCooldown = (pid: string, ev: ProductEvent, key: string) =>
    [...(recent.get(`${pid}\u0000${ev}`) ?? [])].some((k) => k !== key)
  const buyersRu = (pid: string) => {
    const b = data.buyers.get(pid) ?? 0
    return b
      ? `за ${p.buyerLookbackMonths} мес. позицию заказывали ${clientsRu(b)}`
      : `за ${p.buyerLookbackMonths} мес. позицию не заказывали`
  }

  type Cand = { prod: CatalogueProduct; event: ProductEvent; evidence: string; old: unknown; new: unknown }
  const cands: Cand[] = []
  for (const prod of data.products) {
    const st = data.states.get(prod.id)
    const name = `«${prod.name}»`
    if (!st) {
      if (prod.status !== "active") continue
      const parts = [`позиция ${name} добавлена в каталог ${today}`]
      if (prod.price != null) parts.push(`цена ${formatPrice(prod.price)} ₽`)
      if (prod.totalStock != null) parts.push(`остаток ${prod.totalStock} шт.`)
      cands.push({ prod, event: "added", evidence: parts.join("; "), old: null, new: prod.status })
      continue
    }
    if (st.status === "active" && prod.status !== "active") {
      cands.push({
        prod,
        event: "withdrawn",
        evidence: `позиция ${name} выведена из ассортимента ${today}; ${buyersRu(prod.id)}`,
        old: st.status,
        new: prod.status,
      })
      continue
    }
    if (prod.status !== "active") continue
    if (st.totalStock != null && st.totalStock > 0 && prod.totalStock === 0) {
      if (data.recentOrdered.has(prod.id)) {
        cands.push({
          prod,
          event: "stock_out",
          evidence:
            `остаток позиции ${name} стал 0 (было ${st.totalStock} шт.) ${today}; ` +
            `её заказывали за последние ${p.stockOutRecentOrderDays} дн.; ${buyersRu(prod.id)}`,
          old: st.totalStock,
          new: 0,
        })
      } else acc.skip("stock_out_not_ordered")
    } else if (st.totalStock === 0 && prod.totalStock != null && prod.totalStock > 0) {
      cands.push({
        prod,
        event: "stock_back",
        evidence: `позиция ${name} снова в наличии ${today}: остаток ${prod.totalStock} шт. (был 0); ${buyersRu(prod.id)}`,
        old: 0,
        new: prod.totalStock,
      })
    }
    const ov = st.vintage?.trim() || null
    const nv = prod.vintage?.trim() || null
    if (ov && nv && ov !== nv) {
      cands.push({
        prod,
        event: "vintage",
        evidence: `у позиции ${name} сменился винтаж: ${ov} → ${nv} (${today}); ${buyersRu(prod.id)}`,
        old: ov,
        new: nv,
      })
    }
  }

  cands.sort(
    (a, b) =>
      EVENT_RANK[a.event] - EVENT_RANK[b.event] ||
      (data.buyers.get(b.prod.id) ?? 0) - (data.buyers.get(a.prod.id) ?? 0) ||
      a.prod.name.localeCompare(b.prod.name, "ru"),
  )
  for (const c of cands) {
    const key = `product:${c.prod.id}:${c.event}:${day}`
    if (inCooldown(c.prod.id, c.event, key)) {
      acc.skip("cooldown")
      continue
    }
    acc.findings.push({
      code: CRM_CODE.productStatus,
      conditionKey: key,
      topicId: null,
      clientId: null,
      contactId: null,
      companyName: null,
      matterRu: `${EVENT_MATTER_RU[c.event]}: ${shorten(c.prod.name)}`,
      evidenceRu: c.evidence,
      score: null,
      facts: {
        productId: c.prod.id,
        productName: c.prod.name,
        event: c.event,
        day,
        old: c.old,
        new: c.new,
        buyers: data.buyers.get(c.prod.id) ?? 0,
      },
    })
  }
  return acc.result()
}

// ── Watch-state refresh plan (pure; written by `refreshProductWatchState`) ──

/**
 * SKUs whose status-part state must be KEPT: their INTERNAL_PRODUCT_STATUS_UPDATE
 * finding was not written in this run (deferred by the store cap, or failed).
 */
export function heldProductIds(pending: readonly CheckFinding[]): Set<string> {
  const out = new Set<string>()
  for (const f of pending) {
    if (f.code !== CRM_CODE.productStatus) continue
    const id = factStr(f.facts, "productId")
    if (id) out.add(id)
  }
  return out
}

/** The day's INTERNAL_PRICE_CHANGE finding was not written → keep every old price. */
export function priceChangeHeld(pending: readonly CheckFinding[]): boolean {
  return pending.some((f) => f.code === CRM_CODE.priceChange)
}

export type WatchStateRow = {
  productId: string
  organizationId: string
  price: string | null
  status: string | null
  totalStock: number | null
  vintage: string | null
  /** Only on a new row. */
  firstSeenAt?: Date
  checkedAt: Date
}

/**
 * Rows to write as the new last seen state. No state for the org = SEED
 * (every product, all fields). Else, per part: `price` → prices of known
 * products; `status` → status / stock / vintage of known products + rows for
 * new products. Products in `hold` keep their status part (and get no new
 * row), so their event is found again by the next run. Only new / changed rows.
 */
export function planWatchStateWrites(
  orgId: string,
  products: readonly CatalogueProduct[],
  states: ReadonlyMap<string, WatchState>,
  now: Date,
  opts: { price?: boolean; status?: boolean; hold?: ReadonlySet<string> },
): { rows: WatchStateRow[]; seed: boolean; inserted: number; updated: number } {
  const seed = states.size === 0
  const hold = opts.hold ?? new Set<string>()
  const priceText = (n: number | null) => (n == null ? null : n.toFixed(2))
  const rows: WatchStateRow[] = []
  let inserted = 0
  let updated = 0
  for (const p of products) {
    const st = states.get(p.id)
    if (!st) {
      if (!seed && (!opts.status || hold.has(p.id))) continue
      rows.push({
        productId: p.id,
        organizationId: orgId,
        price: priceText(p.price),
        status: p.status,
        totalStock: p.totalStock,
        vintage: p.vintage,
        firstSeenAt: now,
        checkedAt: now,
      })
      inserted++
      continue
    }
    const statusPart = !!opts.status && !hold.has(p.id)
    const next = {
      price: opts.price ? p.price : st.price,
      status: statusPart ? p.status : st.status,
      totalStock: statusPart ? p.totalStock : st.totalStock,
      vintage: statusPart ? p.vintage : st.vintage,
    }
    const samePrice = next.price == null || st.price == null ? next.price === st.price : cents(next.price) === cents(st.price)
    if (samePrice && next.status === st.status && next.totalStock === st.totalStock && next.vintage === st.vintage) continue
    rows.push({
      productId: p.id,
      organizationId: orgId,
      price: priceText(next.price),
      status: next.status,
      totalStock: next.totalStock,
      vintage: next.vintage,
      checkedAt: now,
    })
    updated++
  }
  return { rows, seed, inserted: seed ? 0 : inserted, updated }
}

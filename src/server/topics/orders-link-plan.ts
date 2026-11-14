// Topics plan phase 10 (orders link) — PURE part: which ORDER_CONFIRMED
// process instance an order needs, and the Russian texts. No DB, no server
// imports (unit-tested in orders-link-plan.test.ts). The DB side is
// ./orders-link.ts.
//
// Rule: an order with `topic_id` in status `confirmed` / `finalized` has ONE
// open ORDER_CONFIRMED instance on THAT topic (condition key
// `order:<orderId>:confirmed`). Any other state (cancelled, back to draft /
// awaiting_client, unlinked, moved to another topic, order deleted) clears
// the open instance (B5). The unique index (org, code, condition_key) also
// covers cleared rows, so a confirmation AFTER a clear gets the next key
// `order:<orderId>:confirmed:2`, `…:3`, ….

import { formatRub, orderLabelOf } from "./checks/orders"

export const ORDER_CONFIRMED_CODE = "ORDER_CONFIRMED"
export const CONFIRMED_ORDER_STATUSES: readonly string[] = ["confirmed", "finalized"]

export type OrderLinkState = {
  id: string
  status: string
  topicId: string | null
  description: string | null
  /** Discounted total (what the client pays). */
  total: number
  currency: string
  /** When the order reached its current status (≈ `order.updated_at`). */
  statusAt: Date
}

export type OrderConfirmationInstance = {
  id: string
  conditionKey: string
  topicId: string | null
  clearedAt: Date | null
}

export type OrderConfirmationPlan = {
  /** Write a new instance with this condition key on `order.topicId`. */
  write: { conditionKey: string } | null
  clears: { instanceId: string; reasonRu: string }[]
}

export function confirmedConditionPrefix(orderId: string): string {
  return `order:${orderId}:confirmed`
}

/** n = 1 → `order:<id>:confirmed`; n ≥ 2 → `order:<id>:confirmed:<n>`. */
export function confirmedConditionKey(orderId: string, n: number): string {
  return n <= 1 ? confirmedConditionPrefix(orderId) : `${confirmedConditionPrefix(orderId)}:${n}`
}

/** Does this condition key belong to this order (base key or a numbered one)? */
export function isOrderConditionKey(orderId: string, key: string): boolean {
  const base = confirmedConditionPrefix(orderId)
  return key === base || (key.startsWith(`${base}:`) && /^\d+$/.test(key.slice(base.length + 1)))
}

/** Next free key: 1 + the highest number used so far (cleared rows included). */
export function nextConditionKey(orderId: string, instances: readonly OrderConfirmationInstance[]): string {
  let max = 0
  const base = confirmedConditionPrefix(orderId)
  for (const i of instances) {
    if (!isOrderConditionKey(orderId, i.conditionKey)) continue
    const n = i.conditionKey === base ? 1 : Number(i.conditionKey.slice(base.length + 1))
    if (n > max) max = n
  }
  return confirmedConditionKey(orderId, max + 1)
}

/** DD.MM.YYYY in the org time zone. */
export function ruDay(d: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("ru-RU", { timeZone, day: "2-digit", month: "2-digit", year: "numeric" }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ""
  return `${get("day")}.${get("month")}.${get("year")}`
}

export function formatMoney(amount: number, currency: string): string {
  if (currency.toUpperCase() === "RUB") return formatRub(amount)
  return `${formatRub(amount).replace(" ₽", "")} ${currency.toUpperCase()}`
}

export function orderLabel(o: Pick<OrderLinkState, "id" | "description">): string {
  return orderLabelOf(o.id, o.description)
}

/** «Заказ № 633 подтверждён 14.11.2026, сумма 125 000 ₽» */
export function confirmationEvidenceRu(o: OrderLinkState, timeZone: string): string {
  const verb = o.status === "finalized" ? "оформлен" : "подтверждён"
  return `Заказ ${orderLabel(o)} ${verb} ${ruDay(o.statusAt, timeZone)}, сумма ${formatMoney(o.total, o.currency)}`
}

const STATUS_CLEAR_RU: Record<string, string> = {
  cancelled: "Заказ отменён",
  draft: "Заказ возвращён в черновик",
  awaiting_client: "Заказ снова отправлен клиенту на подтверждение",
}

/** Reason of a clear (B5), Russian. */
export function clearReasonRu(o: OrderLinkState | null, inst: OrderConfirmationInstance, timeZone: string, now: Date): string {
  if (!o) return `Заказ удалён ${ruDay(now, timeZone)}`
  const label = orderLabel(o)
  if (!CONFIRMED_ORDER_STATUSES.includes(o.status)) {
    const what = STATUS_CLEAR_RU[o.status] ?? `Статус заказа изменился (${o.status})`
    return `${what} ${ruDay(o.statusAt, timeZone)}: ${label}`
  }
  if (!o.topicId) return `Заказ ${label} отвязан от темы ${ruDay(now, timeZone)}`
  if (inst.topicId !== o.topicId) return `Заказ ${label} привязан к другой теме ${ruDay(now, timeZone)}`
  return `Заказ ${label}: условие больше не выполняется`
}

/**
 * The plan for one order. `o` null = the order no longer exists.
 * `topicWritable` = the order's topic can take a new instance (exists, not
 * closed by a user, not merged); when false nothing new is written.
 */
export function planOrderConfirmation(
  orderId: string,
  o: OrderLinkState | null,
  instances: readonly OrderConfirmationInstance[],
  opts: { topicWritable: boolean; timeZone: string; now: Date },
): OrderConfirmationPlan {
  const want = !!o && !!o.topicId && CONFIRMED_ORDER_STATUSES.includes(o.status)
  const open = instances.filter((i) => !i.clearedAt && isOrderConditionKey(orderId, i.conditionKey))
  const keep = want ? open.find((i) => i.topicId === o!.topicId) ?? null : null
  const clears = open
    .filter((i) => i !== keep)
    .map((i) => ({ instanceId: i.id, reasonRu: clearReasonRu(o, i, opts.timeZone, opts.now) }))
  const write = want && !keep && opts.topicWritable ? { conditionKey: nextConditionKey(orderId, instances) } : null
  return { write, clears }
}

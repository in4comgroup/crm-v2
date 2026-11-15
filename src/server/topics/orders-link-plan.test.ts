import { describe, expect, it } from "vitest"
import {
  confirmationEvidenceRu,
  confirmedConditionKey,
  isOrderConditionKey,
  nextConditionKey,
  planOrderConfirmation,
  type OrderConfirmationInstance,
  type OrderLinkState,
} from "./orders-link-plan"

const TZ = "Etc/GMT-3"
const now = new Date("2026-11-14T12:00:00Z")
const ORDER = "ord-1"

function order(over: Partial<OrderLinkState> = {}): OrderLinkState {
  return {
    id: ORDER,
    status: "confirmed",
    topicId: "t1",
    description: "демо-заказ №633",
    total: 125000,
    currency: "RUB",
    statusAt: new Date("2026-11-13T21:30:00Z"),
    ...over,
  }
}

function inst(over: Partial<OrderConfirmationInstance> = {}): OrderConfirmationInstance {
  return { id: "i1", conditionKey: confirmedConditionKey(ORDER, 1), topicId: "t1", clearedAt: null, ...over }
}

const opts = { topicWritable: true, timeZone: TZ, now }

describe("condition keys", () => {
  it("base and numbered keys", () => {
    expect(confirmedConditionKey(ORDER, 1)).toBe("order:ord-1:confirmed")
    expect(confirmedConditionKey(ORDER, 3)).toBe("order:ord-1:confirmed:3")
    expect(isOrderConditionKey(ORDER, "order:ord-1:confirmed:2")).toBe(true)
    expect(isOrderConditionKey(ORDER, "order:ord-10:confirmed")).toBe(false)
    expect(isOrderConditionKey(ORDER, "order:ord-1:confirmed:x")).toBe(false)
  })
  it("next key counts cleared rows", () => {
    expect(nextConditionKey(ORDER, [])).toBe("order:ord-1:confirmed")
    expect(nextConditionKey(ORDER, [inst({ clearedAt: now })])).toBe("order:ord-1:confirmed:2")
    expect(nextConditionKey(ORDER, [inst({ clearedAt: now }), inst({ id: "i2", conditionKey: "order:ord-1:confirmed:2", clearedAt: now })])).toBe(
      "order:ord-1:confirmed:3",
    )
  })
})

describe("planOrderConfirmation", () => {
  it("confirmed + topic, no instance → write the base key", () => {
    expect(planOrderConfirmation(ORDER, order(), [], opts)).toEqual({ write: { conditionKey: "order:ord-1:confirmed" }, clears: [] })
  })
  it("finalized counts as confirmed; an open instance on the topic → nothing", () => {
    expect(planOrderConfirmation(ORDER, order({ status: "finalized" }), [inst()], opts)).toEqual({ write: null, clears: [] })
  })
  it("draft / awaiting_client → nothing to write", () => {
    expect(planOrderConfirmation(ORDER, order({ status: "draft" }), [], opts).write).toBeNull()
    expect(planOrderConfirmation(ORDER, order({ status: "awaiting_client" }), [], opts).write).toBeNull()
  })
  it("no topic → nothing to write", () => {
    expect(planOrderConfirmation(ORDER, order({ topicId: null }), [], opts).write).toBeNull()
  })
  it("cancelled after confirm → clear with the reason", () => {
    const p = planOrderConfirmation(ORDER, order({ status: "cancelled" }), [inst()], opts)
    expect(p.write).toBeNull()
    expect(p.clears).toEqual([{ instanceId: "i1", reasonRu: "Заказ отменён 14.11.2026: № 633" }])
  })
  it("unlinked → clear", () => {
    const p = planOrderConfirmation(ORDER, order({ topicId: null }), [inst()], opts)
    expect(p.clears[0].reasonRu).toBe("Заказ № 633 отвязан от темы 14.11.2026")
  })
  it("moved to another topic → clear the old one, write the next key on the new topic", () => {
    const p = planOrderConfirmation(ORDER, order({ topicId: "t2" }), [inst()], opts)
    expect(p.clears).toHaveLength(1)
    expect(p.clears[0].reasonRu).toContain("привязан к другой теме")
    expect(p.write).toEqual({ conditionKey: "order:ord-1:confirmed:2" })
  })
  it("order deleted → clear", () => {
    const p = planOrderConfirmation(ORDER, null, [inst()], opts)
    expect(p.clears[0].reasonRu).toBe("Заказ удалён 14.11.2026")
  })
  it("re-confirmed after a clear → next key", () => {
    expect(planOrderConfirmation(ORDER, order(), [inst({ clearedAt: now })], opts).write).toEqual({ conditionKey: "order:ord-1:confirmed:2" })
  })
  it("topic not writable (closed by a user) → no write, clears still apply", () => {
    expect(planOrderConfirmation(ORDER, order(), [], { ...opts, topicWritable: false }).write).toBeNull()
  })
  it("ignores instances of another order", () => {
    const other = inst({ conditionKey: "order:ord-2:confirmed" })
    expect(planOrderConfirmation(ORDER, order({ status: "cancelled" }), [other], opts).clears).toEqual([])
  })
})

describe("texts", () => {
  it("evidence: label, local date, discounted total", () => {
    expect(confirmationEvidenceRu(order(), TZ)).toBe("Заказ № 633 подтверждён 14.11.2026, сумма 125 000 ₽")
    expect(confirmationEvidenceRu(order({ status: "finalized", currency: "EUR", total: 1500 }), TZ)).toBe(
      "Заказ № 633 оформлен 14.11.2026, сумма 1 500 EUR",
    )
  })
})

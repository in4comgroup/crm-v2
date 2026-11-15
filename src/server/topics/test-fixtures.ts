// Shared fixtures of the topic engine unit tests (no DB). Not imported by
// production code.

import type { SignalClass, SignalKind } from "@/lib/signals/types"
import { normaliseReferences } from "@/lib/topics/references"
import type { CodeBook, CodeInfo, ItemInput, ItemInstance, ResolvedSubject } from "./model"

type CodeSpec = Partial<CodeInfo> & { family: string; weight: number }

const SPECS: Record<string, CodeSpec> = {
  SALES_OFFER_REQUESTED: { family: "offer", weight: 7, class: "chance", asksUs: true, effort: "complex" },
  SALES_PRICE_REQUEST: { family: "offer", weight: 6, class: "chance", asksUs: true, effort: "quick" },
  SALES_OFFER_SENT: { family: "offer", weight: 0, kind: "state", scoreRule: "state", closesCodes: ["SALES_OFFER_REQUESTED"] },
  INVOICE_OVERDUE: { family: "invoice", weight: 7, class: "risk", effort: "medium" },
  PAYMENT_PROMISE: { family: "invoice", weight: 4, class: "fyi", effort: "quick" },
  INVOICE_PAID: { family: "invoice", weight: 0, kind: "state", scoreRule: "state", closesCodes: ["INVOICE_OVERDUE", "PAYMENT_PROMISE"] },
  ORDER_REQUESTED: { family: "order", weight: 5, class: "chance", asksUs: true, effort: "quick", relevanceDays: 14 },
  ORDER_CANCELLED: { family: "order", weight: 7, class: "risk", effort: "quick", closesCodes: ["ORDER_REQUESTED", "ORDER_CHANGE_REQUESTED"] },
  DELIVERY_DISCREPANCY: { family: "delivery", weight: 7, class: "risk", asksUs: true, effort: "medium" },
  DELIVERY_DISCREPANCY_RESOLVED: {
    family: "delivery",
    weight: 0,
    kind: "state",
    scoreRule: "state",
    closesCodes: ["DELIVERY_DISCREPANCY"],
  },
  DOCUMENT_CORRECTION_REQUESTED: { family: "contract", weight: 5, class: "risk", asksUs: true, effort: "quick" },
  SUPPLIER_DELIVERY_DELAY: { family: "supplier", weight: 4, class: "fyi", effort: "quick" },
  ACCOUNT_CHURN_RISK: { family: "account", weight: 8, class: "risk", classByRelation: true, effort: "medium" },
  MAILERDEMON_RECEIVED: { family: "contact", weight: 5, class: "risk", scoreRule: "inherited", effort: "quick" },
  WATCH_CODE: { family: "account", weight: 5, class: "risk", kind: "watchdog" },
}

export function makeBook(): CodeBook {
  return new Map(
    Object.entries(SPECS).map(([code, s], i): [string, CodeInfo] => [
      code,
      {
        code,
        labelRu: code,
        kind: (s.kind ?? "event") as SignalKind,
        scoreRule: s.scoreRule ?? "fixed",
        class: (s.class ?? null) as SignalClass | null,
        classByRelation: s.classByRelation ?? false,
        asksUs: s.asksUs ?? false,
        effort: s.effort ?? null,
        relevanceDays: s.relevanceDays ?? null,
        closesCodes: s.closesCodes ?? [],
        family: s.family,
        weight: s.weight,
        order: i,
      },
    ]),
  )
}

let seq = 0
export function nextId(prefix = "id"): string {
  seq += 1
  return `${prefix}-${seq}`
}

export function subject(p: Partial<ResolvedSubject> & { refs?: { kind: string; value: string }[] } = {}): ResolvedSubject {
  const { refs, ...rest } = p
  return {
    index: 0,
    counterparty: "Норлекс",
    counterpartyKey: "norlex",
    matter: "вопрос",
    references: normaliseReferences(refs ?? []),
    products: [],
    clientId: "client-norlex",
    contactId: null,
    companyName: "ООО «Норлекс»",
    contactName: null,
    ...rest,
  }
}

export function inst(code: string, p: Partial<ItemInstance> = {}): ItemInstance {
  const book = makeBook()
  const info = book.get(code)
  const isState = info?.kind === "state"
  return {
    id: nextId("inst"),
    code,
    confidence: "high",
    counted: !isState,
    scoreContrib: isState ? 0 : (info?.weight ?? 5),
    subjectIndex: 0,
    evidence: `цитата ${code}`,
    ...p,
  }
}

export function item(p: Partial<Omit<ItemInput, "date">> & { date: string }): ItemInput {
  const { date, ...rest } = p
  return {
    itemId: nextId("item"),
    threadKey: null,
    direction: "inbound",
    subjects: [subject()],
    instances: [],
    amounts: [],
    deadlines: [],
    taxonomyVersion: 4,
    ...rest,
    date: new Date(date),
  }
}

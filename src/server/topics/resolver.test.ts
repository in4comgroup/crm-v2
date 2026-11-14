import { describe, expect, it, vi } from "vitest"
import type { ClientRelation } from "@/lib/topics/types"
import type { TopicSnapshot } from "./model"
import { resolveItem, type MatcherDecision, type MatcherInput, type ResolveContext, type TopicMatcher } from "./resolver"
import { inst, item, makeBook, nextId, subject } from "./test-fixtures"

// Acceptance examples of spec topics/01 §2.1 that need no real LLM, run on
// an in-memory pool with a fake matcher (plan phase 3 exit criterion).

const NOW = new Date("2026-11-14T12:00:00Z")

function ctx(matcher: TopicMatcher, relations: Record<string, ClientRelation> = {}): ResolveContext {
  return {
    book: makeBook(),
    relationOf: (id) => (id ? (relations[id] ?? "active") : "unknown"),
    matcher,
    now: NOW,
    newId: () => nextId("topic"),
  }
}

/** Fake matcher: picks a fixed answer (or computes one) and records calls. */
function fake(answer: MatcherDecision | ((i: MatcherInput) => MatcherDecision)) {
  return vi.fn(async (i: MatcherInput) => (typeof answer === "function" ? answer(i) : answer))
}

const NEVER = fake(() => {
  throw new Error("matcher must not be called")
})

function live(pool: TopicSnapshot[]) {
  return pool.filter((t) => t.status === "open")
}

describe("§2.1 granularity examples", () => {
  it("request + its reminder in another channel → 1 topic, waiting on us", async () => {
    const pool: TopicSnapshot[] = []
    const first = item({
      date: "2026-11-10T09:00:00Z",
      threadKey: "imap:<a@x>",
      subjects: [subject({ matter: "КП на корпоратив на 40 человек" })],
      instances: [inst("SALES_OFFER_REQUESTED")],
    })
    const r1 = await resolveItem(pool, first, ctx(NEVER))
    expect(r1.outcomes[0]).toMatchObject({ kind: "attach", via: "new", created: true })
    expect(pool).toHaveLength(1)

    const matcher = fake((i) => ({ topicId: i.candidates[0].id, confidence: "high", reason: "напоминание" }))
    const reminder = item({
      date: "2026-11-12T09:00:00Z",
      threadKey: "tg:42:1",
      subjects: [subject({ matter: "когда будет КП" })],
      instances: [inst("SALES_OFFER_REQUESTED")],
    })
    const r2 = await resolveItem(pool, reminder, ctx(matcher))
    expect(matcher).toHaveBeenCalledTimes(1)
    expect(r2.outcomes[0]).toMatchObject({ kind: "attach", via: "matcher", role: "update", created: false })
    expect(r2.events.find((e) => e.type === "item_attached")?.payload).toMatchObject({
      via: "matcher",
      matcher: { confidence: "high", candidates: 1 },
    })
    expect(pool).toHaveLength(1)
    expect(pool[0].items).toHaveLength(2)
    expect(pool[0].subState).toBe("waiting_on_us")
    expect(pool[0].score).toBe(7)
    expect(pool[0].leadCode).toBe("SALES_OFFER_REQUESTED")
  })

  it("one email with an invoice and a price request → 2 topics", async () => {
    const pool: TopicSnapshot[] = []
    const matcher = fake({ topicId: "NEW", confidence: "high", reason: "другой вопрос" })
    const r = await resolveItem(
      pool,
      item({
        date: "2026-11-10T09:00:00Z",
        subjects: [
          subject({ index: 0, matter: "счёт 124", refs: [{ kind: "invoice", value: "124" }] }),
          subject({ index: 1, matter: "прайс на осень" }),
        ],
        instances: [inst("INVOICE_OVERDUE", { subjectIndex: 0 }), inst("SALES_PRICE_REQUEST", { subjectIndex: 1 })],
      }),
      ctx(matcher),
    )
    expect(pool).toHaveLength(2)
    expect(r.outcomes.filter((o) => o.kind === "attach" && o.created)).toHaveLength(2)
    expect(pool.map((t) => t.family).sort()).toEqual(["invoice", "offer"])
    // Every instance went to the topic of its own subject.
    const invoiceTopic = pool.find((t) => t.family === "invoice")!
    expect(invoiceTopic.instances.map((i) => i.code)).toEqual(["INVOICE_OVERDUE"])
  })

  it("unsure matcher on a shared client and a different family → new topic (R15, rule 2)", async () => {
    const pool: TopicSnapshot[] = []
    await resolveItem(
      pool,
      item({
        date: "2026-11-10T09:00:00Z",
        subjects: [subject({ refs: [{ kind: "invoice", value: "124" }] })],
        instances: [inst("INVOICE_OVERDUE")],
      }),
      ctx(NEVER),
    )
    const matcher = fake((i) => ({ topicId: i.candidates[0].id, confidence: "medium", reason: "тот же клиент" }))
    const r = await resolveItem(
      pool,
      item({ date: "2026-11-11T09:00:00Z", subjects: [subject({ matter: "прайс" })], instances: [inst("SALES_PRICE_REQUEST")] }),
      ctx(matcher),
    )
    expect(r.outcomes[0]).toMatchObject({ kind: "attach", created: true })
    expect(pool).toHaveLength(2)
  })

  it("«Счёт 124 оплатили» a week later closes the invoice topic, no new topic", async () => {
    const pool: TopicSnapshot[] = []
    await resolveItem(
      pool,
      item({
        date: "2026-11-03T09:00:00Z",
        subjects: [subject({ matter: "счёт 124 не оплачен", refs: [{ kind: "invoice", value: "№ 124" }] })],
        instances: [inst("INVOICE_OVERDUE")],
      }),
      ctx(NEVER),
    )
    const r = await resolveItem(
      pool,
      item({
        date: "2026-11-10T09:00:00Z",
        subjects: [subject({ matter: "оплата счёта", refs: [{ kind: "invoice", value: "счёт 124" }] })],
        instances: [inst("INVOICE_PAID")],
      }),
      ctx(NEVER),
    )
    expect(r.outcomes[0]).toMatchObject({ kind: "attach", via: "hard_key", role: "closing" })
    expect(pool).toHaveLength(1)
    expect(pool[0].status).toBe("resolved")
    expect(pool[0].closedReason).toBe("closed_by:INVOICE_PAID")
    expect(pool[0].score).toBe(0)
    expect(r.events.map((e) => e.type)).toContain("resolved")
  })

  it("closing code with no open topic → logged only", async () => {
    const pool: TopicSnapshot[] = []
    const r = await resolveItem(
      pool,
      item({ date: "2026-11-10T09:00:00Z", instances: [inst("DELIVERY_DISCREPANCY_RESOLVED")] }),
      ctx(NEVER),
    )
    expect(pool).toHaveLength(0)
    expect(r.status).toBe("log_only")
    expect(r.outcomes[0]).toMatchObject({ kind: "log_only", codes: ["DELIVERY_DISCREPANCY_RESOLVED"] })
  })

  it("closing code + candidates but the matcher finds none → logged only, never a new topic", async () => {
    const pool: TopicSnapshot[] = []
    await resolveItem(pool, item({ date: "2026-11-09T09:00:00Z", instances: [inst("SALES_PRICE_REQUEST")] }), ctx(NEVER))
    const r = await resolveItem(
      pool,
      item({ date: "2026-11-10T09:00:00Z", instances: [inst("DELIVERY_DISCREPANCY_RESOLVED")] }),
      ctx(fake({ topicId: "NEW", confidence: "high", reason: "нет темы" })),
    )
    expect(pool).toHaveLength(1)
    expect(r.status).toBe("log_only")
  })

  it("claim + «Когда замените?» → 1 claim topic waiting on us", async () => {
    const pool: TopicSnapshot[] = []
    await resolveItem(
      pool,
      item({
        date: "2026-11-06T09:00:00Z",
        subjects: [subject({ matter: "брак в поставке от 05.11" })],
        instances: [inst("DELIVERY_DISCREPANCY")],
      }),
      ctx(NEVER),
    )
    await resolveItem(
      pool,
      item({ date: "2026-11-07T09:00:00Z", direction: "outbound", subjects: [subject({ matter: "ответ" })], instances: [] }),
      ctx(NEVER),
    )
    await resolveItem(
      pool,
      item({ date: "2026-11-09T09:00:00Z", subjects: [subject({ matter: "когда замена" })], instances: [inst("DELIVERY_DISCREPANCY")] }),
      ctx(fake((i) => ({ topicId: i.candidates[0].id, confidence: "medium", reason: "та же претензия" }))),
    )
    expect(pool).toHaveLength(1)
    expect(pool[0].instances).toHaveLength(2)
    expect(pool[0].subState).toBe("waiting_on_us")
  })

  it("same reference + same counterparty → same topic without the matcher (УПД 4512)", async () => {
    const pool: TopicSnapshot[] = []
    await resolveItem(
      pool,
      item({
        date: "2026-11-10T09:00:00Z",
        subjects: [subject({ matter: "исправить УПД", refs: [{ kind: "other", value: "УПД №4512" }] })],
        instances: [inst("DOCUMENT_CORRECTION_REQUESTED")],
      }),
      ctx(NEVER),
    )
    const r = await resolveItem(
      pool,
      item({
        date: "2026-11-11T09:00:00Z",
        subjects: [subject({ matter: "УПД ещё не пришла", refs: [{ kind: "other", value: "упд 4512" }] })],
        instances: [inst("DOCUMENT_CORRECTION_REQUESTED")],
      }),
      ctx(NEVER),
    )
    expect(r.outcomes[0]).toMatchObject({ via: "hard_key" })
    expect(pool).toHaveLength(1)
  })

  it("two invoices of one client stay two topics even when the matcher is unsure", async () => {
    const pool: TopicSnapshot[] = []
    await resolveItem(
      pool,
      item({ date: "2026-11-10T09:00:00Z", subjects: [subject({ refs: [{ kind: "invoice", value: "124" }] })], instances: [inst("INVOICE_OVERDUE")] }),
      ctx(NEVER),
    )
    await resolveItem(
      pool,
      item({ date: "2026-11-11T09:00:00Z", subjects: [subject({ refs: [{ kind: "invoice", value: "125" }] })], instances: [inst("INVOICE_OVERDUE")] }),
      ctx(fake((i) => ({ topicId: i.candidates[0].id, confidence: "low", reason: "похоже" }))),
    )
    expect(pool).toHaveLength(2)
  })

  it("supplier delay → its own supplier topic, class of the code", async () => {
    const pool: TopicSnapshot[] = []
    await resolveItem(
      pool,
      item({
        date: "2026-11-10T09:00:00Z",
        subjects: [subject({ clientId: "client-producer", counterparty: "Producer SA", companyName: "Producer SA", matter: "задержка контейнера" })],
        instances: [inst("SUPPLIER_DELIVERY_DELAY")],
      }),
      ctx(NEVER, { "client-producer": "supplier" }),
    )
    expect(pool).toHaveLength(1)
    expect(pool[0]).toMatchObject({ family: "supplier", class: "fyi", clientId: "client-producer", title: "Producer — задержка контейнера" })
  })

  it("buyer with no known company → topic on the contact only (R14)", async () => {
    const pool: TopicSnapshot[] = []
    await resolveItem(
      pool,
      item({
        date: "2026-11-10T09:00:00Z",
        subjects: [
          subject({
            clientId: null,
            contactId: "contact-ivan",
            companyName: null,
            contactName: "Иван Петров",
            counterparty: "Иван",
            counterpartyKey: "ivan",
            matter: "прайс на продукцию",
          }),
        ],
        instances: [inst("SALES_PRICE_REQUEST")],
      }),
      ctx(NEVER),
    )
    expect(pool[0]).toMatchObject({ clientId: null, contactId: "contact-ivan", title: "Иван Петров — прайс на продукцию", class: "chance" })
  })

  it("newsletter (no signal, no thread match) → ignored", async () => {
    const pool: TopicSnapshot[] = []
    const r = await resolveItem(pool, item({ date: "2026-11-10T09:00:00Z", subjects: [], instances: [] }), ctx(NEVER))
    expect(r.status).toBe("ignored")
    expect(pool).toHaveLength(0)
  })

  it("order request then cancellation: cancel closes the request and leads the topic", async () => {
    const pool: TopicSnapshot[] = []
    await resolveItem(
      pool,
      item({ date: "2026-11-10T09:00:00Z", subjects: [subject({ refs: [{ kind: "order", value: "77" }] })], instances: [inst("ORDER_REQUESTED")] }),
      ctx(NEVER),
    )
    await resolveItem(
      pool,
      item({ date: "2026-11-11T09:00:00Z", subjects: [subject({ refs: [{ kind: "order", value: "77" }] })], instances: [inst("ORDER_CANCELLED")] }),
      ctx(NEVER),
    )
    expect(pool).toHaveLength(1)
    expect(pool[0]).toMatchObject({ status: "open", leadCode: "ORDER_CANCELLED", score: 7, class: "risk" })
  })
})

describe("resolver mechanics", () => {
  it("an id that is not in the candidate list counts as NEW", async () => {
    const pool: TopicSnapshot[] = []
    await resolveItem(pool, item({ date: "2026-11-09T09:00:00Z", instances: [inst("SALES_PRICE_REQUEST")] }), ctx(NEVER))
    const r = await resolveItem(
      pool,
      item({ date: "2026-11-10T09:00:00Z", instances: [inst("SALES_PRICE_REQUEST")] }),
      ctx(fake({ topicId: "made-up-id", confidence: "high", reason: "?" })),
    )
    expect(r.outcomes[0]).toMatchObject({ created: true })
    expect(pool).toHaveLength(2)
  })

  it("R15 bias: unsure but same counterparty, family, no conflict → attach", async () => {
    const pool: TopicSnapshot[] = []
    await resolveItem(pool, item({ date: "2026-11-09T09:00:00Z", instances: [inst("SALES_PRICE_REQUEST")] }), ctx(NEVER))
    const r = await resolveItem(
      pool,
      item({ date: "2026-11-10T09:00:00Z", instances: [inst("SALES_OFFER_REQUESTED")] }),
      ctx(fake((i) => ({ topicId: i.candidates[0].id, confidence: "medium", reason: "похоже" }))),
    )
    expect(r.outcomes[0]).toMatchObject({ via: "matcher_bias" })
    expect(pool).toHaveLength(1)
  })

  it("R15 bias refused when the products conflict", async () => {
    const pool: TopicSnapshot[] = []
    await resolveItem(
      pool,
      item({ date: "2026-11-09T09:00:00Z", subjects: [subject({ products: ["Кампари"] })], instances: [inst("ORDER_REQUESTED")] }),
      ctx(NEVER),
    )
    await resolveItem(
      pool,
      item({ date: "2026-11-10T09:00:00Z", subjects: [subject({ products: ["Бейлис"] })], instances: [inst("ORDER_REQUESTED")] }),
      ctx(fake((i) => ({ topicId: i.candidates[0].id, confidence: "medium", reason: "?" }))),
    )
    expect(pool).toHaveLength(2)
  })

  it("other counterparty is not a candidate (only the same thread would be)", async () => {
    const pool: TopicSnapshot[] = []
    await resolveItem(pool, item({ date: "2026-11-09T09:00:00Z", instances: [inst("SALES_PRICE_REQUEST")] }), ctx(NEVER))
    const r = await resolveItem(
      pool,
      item({
        date: "2026-11-10T09:00:00Z",
        subjects: [subject({ clientId: "client-other", counterparty: "Вектор", counterpartyKey: "vektor", companyName: "Вектор" })],
        instances: [inst("SALES_PRICE_REQUEST")],
      }),
      ctx(NEVER),
    )
    expect(r.outcomes[0]).toMatchObject({ created: true })
    expect(pool).toHaveLength(2)
  })

  it("resolved topic reopens on a new counted signal inside 14 days", async () => {
    const pool: TopicSnapshot[] = []
    const refs = [{ kind: "invoice", value: "124" }]
    await resolveItem(pool, item({ date: "2026-11-01T09:00:00Z", subjects: [subject({ refs })], instances: [inst("INVOICE_OVERDUE")] }), ctx(NEVER))
    await resolveItem(pool, item({ date: "2026-11-03T09:00:00Z", subjects: [subject({ refs })], instances: [inst("INVOICE_PAID")] }), ctx(NEVER))
    expect(pool[0].status).toBe("resolved")
    const r = await resolveItem(
      pool,
      item({ date: "2026-11-10T09:00:00Z", subjects: [subject({ refs })], instances: [inst("INVOICE_OVERDUE")] }),
      ctx(NEVER),
    )
    expect(r.outcomes[0]).toMatchObject({ via: "hard_key", reopened: true })
    expect(pool).toHaveLength(1)
    expect(pool[0].status).toBe("open")
  })

  it("after the reopen window a new topic is created with related_topic_id", async () => {
    const pool: TopicSnapshot[] = []
    const refs = [{ kind: "invoice", value: "124" }]
    await resolveItem(pool, item({ date: "2026-10-01T09:00:00Z", subjects: [subject({ refs })], instances: [inst("INVOICE_OVERDUE")] }), ctx(NEVER))
    await resolveItem(pool, item({ date: "2026-10-03T09:00:00Z", subjects: [subject({ refs })], instances: [inst("INVOICE_PAID")] }), ctx(NEVER))
    await resolveItem(pool, item({ date: "2026-11-10T09:00:00Z", subjects: [subject({ refs })], instances: [inst("INVOICE_OVERDUE")] }), ctx(NEVER))
    expect(pool).toHaveLength(2)
    expect(pool[1].relatedTopicId).toBe(pool[0].id)
  })

  it("band-none item on the thread of an open topic → context, no score change", async () => {
    const pool: TopicSnapshot[] = []
    await resolveItem(
      pool,
      item({ date: "2026-11-09T09:00:00Z", threadKey: "imap:<t1>", instances: [inst("SALES_OFFER_REQUESTED")] }),
      ctx(NEVER),
    )
    const r = await resolveItem(
      pool,
      item({ date: "2026-11-10T09:00:00Z", threadKey: "imap:<t1>", direction: "outbound", subjects: [subject()], instances: [] }),
      ctx(NEVER),
    )
    expect(r.outcomes.find((o) => o.kind === "attach")).toMatchObject({ role: "context", via: "context_thread" })
    expect(live(pool)[0].score).toBe(7)
    expect(live(pool)[0].subState).toBe("waiting_on_them")
  })

  it("gate item without subjects (synthetic subject -1) opens a topic", async () => {
    const pool: TopicSnapshot[] = []
    await resolveItem(
      pool,
      item({
        date: "2026-11-10T09:00:00Z",
        subjects: [subject({ index: -1, matter: "" })],
        instances: [inst("MAILERDEMON_RECEIVED", { subjectIndex: -1 })],
      }),
      ctx(NEVER),
    )
    expect(pool).toHaveLength(1)
    expect(pool[0].score).toBe(5)
  })
})

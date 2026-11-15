import { describe, expect, it } from "vitest"
import type { TopicAttention } from "@/lib/topics/attention-types"
import type { TopicCardText } from "@/lib/topics/cards"
import {
  cardCategoryFor,
  cardPlacement,
  cardPriorityFor,
  compactEvents,
  cycleKey,
  effectiveCardStatus,
  legacyMessageText,
  resolveCardAction,
  sanitizeCardText,
  trimWords,
  wordCount,
  type EventCandidate,
} from "./logic"

function att(p: Partial<TopicAttention> = {}): TopicAttention {
  return {
    v: 1,
    computedAt: "2026-11-14T10:00:00.000Z",
    hiddenReason: null,
    score: 6,
    band: "normal",
    class: "chance",
    leadCode: "ORDER_REQUESTED",
    boosts: [],
    baseProfile: "D4",
    profile: "D4",
    list: "digest",
    escalations: [],
    deadline: null,
    overdue: false,
    rank: 1,
    cycleStartedAt: "2026-11-14T09:00:00.000Z",
    cycleReason: "first",
    cycleStarted: true,
    cardExpiresAt: "2026-11-21T09:00:00.000Z",
    nextCheckAt: null,
    explanation: [],
    ...p,
  }
}

const TEXT: TopicCardText = {
  headline: "Норлекс — отправить КП, чтобы не потерять заказ",
  whyNow: "Клиент напомнил про КП на корпоратив",
  whatChanged: "Клиент напомнил",
  steps: ["Подготовить КП", "Отправить КП закупщику"],
  taskTitle: "Отправить КП Норлексу",
}

describe("word limits", () => {
  it("trims to the word limit and drops a dangling mark", () => {
    expect(trimWords("один два три, четыре", 3)).toBe("один два три")
    expect(trimWords("  один   два  ", 5)).toBe("один два")
    expect(trimWords(undefined, 3)).toBe("")
  })

  it("cleans list markers and quotes", () => {
    expect(trimWords("1. Позвонить клиенту", 10)).toBe("Позвонить клиенту")
    expect(trimWords("«Норлекс — отправить КП»", 10)).toBe("Норлекс — отправить КП")
  })

  it("applies the §9.1 limits", () => {
    const long = (n: number) => Array.from({ length: n }, (_, i) => `слово${i}`).join(" ")
    const t = sanitizeCardText({
      headline: long(20),
      whyNow: long(30),
      whatChanged: long(25),
      steps: [long(20), "", long(3), long(4), long(5)],
      taskTitle: long(10),
    })
    expect(wordCount(t.headline)).toBe(12)
    expect(wordCount(t.whyNow)).toBe(20)
    expect(wordCount(t.whatChanged)).toBe(16)
    expect(t.steps).toHaveLength(3)
    expect(wordCount(t.steps[0])).toBe(15)
    expect(wordCount(t.taskTitle)).toBe(6)
  })

  it("stores an empty «Что изменилось» for «нет» / «—»", () => {
    expect(sanitizeCardText({ whatChanged: "—" }).whatChanged).toBe("")
    expect(sanitizeCardText({ whatChanged: "Нет" }).whatChanged).toBe("")
    expect(sanitizeCardText({ steps: "x" }).steps).toEqual([])
  })
})

describe("writer decision handling", () => {
  const open = { id: "card-1", status: "open" }
  const accepted = { id: "card-0", status: "accepted" }

  it("first placement → a new card whatever the decision", () => {
    expect(
      resolveCardAction({ open: null, latest: null, decision: "NOOP", copiedCardId: "", text: TEXT, forced: false }),
    ).toEqual({ kind: "insert", sinceLast: null, supersedeId: null, decision: "FIRST" })
  })

  it("first placement with empty text → invalid", () => {
    const empty = sanitizeCardText({})
    expect(
      resolveCardAction({ open: null, latest: null, decision: "NEW", copiedCardId: "", text: empty, forced: false }).kind,
    ).toBe("invalid")
  })

  it("UPDATE with the copied id → update of the open card + since_last", () => {
    expect(
      resolveCardAction({ open, latest: open, decision: "UPDATE", copiedCardId: " card-1 ", text: TEXT, forced: false }),
    ).toEqual({ kind: "update", cardId: "card-1", sinceLast: "Клиент напомнил" })
  })

  it("UPDATE with a wrong id → NEW (supersede)", () => {
    const a = resolveCardAction({ open, latest: open, decision: "UPDATE", copiedCardId: "card-9", text: TEXT, forced: false })
    expect(a).toMatchObject({ kind: "insert", supersedeId: "card-1", decision: "NEW" })
  })

  it("NEW → supersede the open card, no since_last", () => {
    expect(
      resolveCardAction({ open, latest: open, decision: "NEW", copiedCardId: "", text: TEXT, forced: false }),
    ).toEqual({ kind: "insert", sinceLast: null, supersedeId: "card-1", decision: "NEW" })
  })

  it("NOOP → nothing («Спасибо, получили»)", () => {
    expect(resolveCardAction({ open, latest: open, decision: "NOOP", copiedCardId: "", text: TEXT, forced: false })).toEqual({
      kind: "noop",
    })
  })

  it("forced (R17) NOOP → UPDATE, reason as since_last when the model gave none", () => {
    const a = resolveCardAction({
      open,
      latest: open,
      decision: "NOOP",
      copiedCardId: "card-1",
      text: { ...TEXT, whatChanged: "" },
      forced: true,
      forceReason: "Риск: затягивание решения",
    })
    expect(a).toEqual({ kind: "update", cardId: "card-1", sinceLast: "Риск: затягивание решения" })
  })

  it("UPDATE is never applied to an accepted card → a new open card", () => {
    const a = resolveCardAction({ open: null, latest: accepted, decision: "UPDATE", copiedCardId: "card-0", text: TEXT, forced: false })
    expect(a).toEqual({ kind: "insert", sinceLast: "Клиент напомнил", supersedeId: null, decision: "UPDATE" })
  })

  it("decided card + NOOP → nothing", () => {
    expect(
      resolveCardAction({ open: null, latest: accepted, decision: "NOOP", copiedCardId: "", text: TEXT, forced: false }).kind,
    ).toBe("noop")
  })
})

describe("compact events (§9.1 Q24-12)", () => {
  const ev = (p: Partial<EventCandidate>): EventCandidate => ({
    code: "X",
    labelRu: "X",
    class: "fyi",
    family: null,
    kind: "event",
    weight: 3,
    asksUs: false,
    closing: false,
    hasDeadline: false,
    at: new Date("2026-11-10T10:00:00Z"),
    sourceItemId: null,
    evidence: "",
    ...p,
  })

  it("orders urgent → decision → terms → context and keeps ≤ 3", () => {
    const list = compactEvents([
      ev({ code: "CTX", family: "market", at: new Date("2026-11-13T10:00:00Z") }),
      ev({ code: "TERMS", family: "offer" }),
      ev({ code: "ORDER", family: "order" }),
      ev({ code: "RISK", class: "risk", weight: 8 }),
    ])
    expect(list.map((e) => e.code)).toEqual(["RISK", "ORDER", "TERMS"])
    expect(list.map((e) => e.group)).toEqual(["urgent", "decision", "terms"])
  })

  it("asks-us with a deadline is urgent; newest first inside a group; one per code", () => {
    const list = compactEvents([
      ev({ code: "A", family: "order", at: new Date("2026-11-01T00:00:00Z") }),
      ev({ code: "A", family: "order", at: new Date("2026-11-05T00:00:00Z"), evidence: "новее" }),
      ev({ code: "B", family: "contract", at: new Date("2026-11-03T00:00:00Z") }),
      ev({ code: "C", asksUs: true, hasDeadline: true }),
    ])
    expect(list.map((e) => e.code)).toEqual(["C", "A", "B"])
    expect(list[1].evidence).toBe("новее")
  })

  it("closing codes count as decisions", () => {
    expect(compactEvents([ev({ code: "PAID", closing: true })])[0].group).toBe("decision")
  })
})

describe("card lifecycle", () => {
  it("topic closed → close the card", () => {
    for (const s of ["resolved", "done", "dismissed", "merged", "expired", "archived"]) {
      expect(cardPlacement(s, att())).toBe("close")
    }
  })

  it("open + placed → card; band none / S0 / null profile → close", () => {
    expect(cardPlacement("open", att())).toBe("card")
    expect(cardPlacement("open", att({ band: "none" }))).toBe("close")
    expect(cardPlacement("open", att({ profile: "S0" }))).toBe("close")
    expect(cardPlacement("open", att({ profile: null }))).toBe("close")
    expect(cardPlacement("open", att({ hiddenReason: "no_active_signal" }))).toBe("close")
  })

  it("snooze / dormant / no attention → keep the card", () => {
    expect(cardPlacement("open", att({ hiddenReason: "snoozed" }))).toBe("keep")
    expect(cardPlacement("dormant", att())).toBe("keep")
    expect(cardPlacement("open", null)).toBe("keep")
  })

  it("read-time expiry", () => {
    const now = new Date("2026-11-20T00:00:00Z")
    expect(effectiveCardStatus("open", "2026-11-19T00:00:00Z", now)).toBe("expired")
    expect(effectiveCardStatus("open", new Date("2026-11-21T00:00:00Z"), now)).toBe("open")
    expect(effectiveCardStatus("open", null, now)).toBe("open")
    expect(effectiveCardStatus("accepted", "2026-11-19T00:00:00Z", now)).toBe("accepted")
    expect(effectiveCardStatus(null, null, now)).toBeNull()
  })

  it("cycle key: attention cycle, else column, else first seen", () => {
    const first = new Date("2026-11-01T00:00:00Z")
    expect(cycleKey({ attention: att(), cycleStartedAt: null, firstSeenAt: first })).toBe("2026-11-14T09:00:00.000Z")
    expect(
      cycleKey({ attention: att({ cycleStartedAt: null }), cycleStartedAt: new Date("2026-11-02T00:00:00Z"), firstSeenAt: first }),
    ).toBe("2026-11-02T00:00:00.000Z")
    expect(cycleKey({ attention: null, cycleStartedAt: null, firstSeenAt: first })).toBe("first:2026-11-01T00:00:00.000Z")
  })
})

describe("old columns", () => {
  it("category per lead code / family / class", () => {
    expect(cardCategoryFor({ leadCode: "ORDER_REQUESTED", class: "chance", family: "order" })).toBe("new_order")
    expect(cardCategoryFor({ leadCode: "X", class: "risk", family: "complaint" })).toBe("support")
    expect(cardCategoryFor({ leadCode: "X", class: "fyi", family: "market" })).toBe("business_info")
    expect(cardCategoryFor({ leadCode: "X", class: "fyi", family: "competitor" })).toBe("data_intelligence")
    expect(cardCategoryFor({ leadCode: "X", class: "fyi", family: "team" })).toBe("colleagues_activity")
    expect(cardCategoryFor({ leadCode: "X", class: "risk", family: "invoice" })).toBe("action_required")
    expect(cardCategoryFor({ leadCode: "X", class: "chance", family: "offer" })).toBe("client_activity")
    expect(cardCategoryFor({ leadCode: null, class: null, family: null })).toBe("business_info")
  })

  it("priority from band", () => {
    expect(cardPriorityFor("high")).toBe("high")
    expect(cardPriorityFor("critical")).toBe("high")
    expect(cardPriorityFor("normal")).toBe("normal")
    expect(cardPriorityFor("low")).toBe("normal")
  })

  it("legacy message: headline + why now + what changed; numbered steps", () => {
    const m = legacyMessageText(TEXT, null)
    expect(m.analysis).toContain("Почему сейчас: Клиент напомнил")
    expect(m.analysis).toContain("Что изменилось: Клиент напомнил")
    expect(m.recommendation).toBe("1. Подготовить КП\n2. Отправить КП закупщику")
    expect(legacyMessageText({ ...TEXT, whatChanged: "" }, null).analysis).not.toContain("Что изменилось")
  })
})

import { describe, expect, it } from "vitest"
import {
  countEntries,
  cycleMarker,
  describeTopicEvent,
  filterMine,
  isMine,
  isTopicTab,
  splitDigest,
  splitWeek,
  topicStatusRu,
} from "./topic-ui"

const me = "u1"

describe("«Мои» filter (spec §8.1)", () => {
  it("keeps topics where I am the assignee or the deal owner", () => {
    expect(isMine({ ownerUserId: me, dealOwnerUserId: null }, me)).toBe(true)
    expect(isMine({ ownerUserId: "u2", dealOwnerUserId: me }, me)).toBe(true)
    expect(isMine({ ownerUserId: "u2", dealOwnerUserId: "u3" }, me)).toBe(false)
    expect(isMine({ ownerUserId: null, dealOwnerUserId: null }, me)).toBe(false)
    expect(isMine({ ownerUserId: null, dealOwnerUserId: null }, "")).toBe(false)
  })

  it("filters only when «Мои» is on", () => {
    const rows = [
      { id: 1, ownerUserId: me, dealOwnerUserId: null },
      { id: 2, ownerUserId: "u2", dealOwnerUserId: null },
      { id: 3, ownerUserId: null, dealOwnerUserId: me },
    ]
    expect(filterMine(rows, me, false).map((r) => r.id)).toEqual([1, 2, 3])
    expect(filterMine(rows, me, true).map((r) => r.id)).toEqual([1, 3])
    expect(countEntries(rows, me)).toEqual({ all: 3, mine: 2 })
  })
})

describe("cycle marker «Новое» / «Обновлено» (06 §7.1)", () => {
  const now = new Date("2026-11-14T10:00:00Z")
  it("first cycle is «Новое», later cycles «Обновлено», only for 24 h", () => {
    expect(cycleMarker({ cycleStartedAt: "2026-11-14T08:00:00Z", cycleReason: "created" }, now)).toBe("new")
    expect(cycleMarker({ cycleStartedAt: "2026-11-14T08:00:00Z", cycleReason: "new_lead" }, now)).toBe("updated")
    expect(cycleMarker({ cycleStartedAt: "2026-11-12T08:00:00Z", cycleReason: "created" }, now)).toBeNull()
    expect(cycleMarker({ cycleStartedAt: null, cycleReason: null }, now)).toBeNull()
    expect(cycleMarker(null, now)).toBeNull()
  })
  it("ignores a cycle start in the future", () => {
    expect(cycleMarker({ cycleStartedAt: "2026-11-15T08:00:00Z", cycleReason: "created" }, now)).toBeNull()
  })
})

describe("«Сводка» sections (06 §7.2)", () => {
  const e = (id: number, snapshot?: "snapshot" | "since" | null) => ({ id, snapshot })
  it("splits the frozen morning snapshot (N + «Ещё») from «Новое с утра», keeping order", () => {
    const rows = [e(1, "snapshot"), e(2, "since"), e(3, "snapshot"), e(4), e(5, "snapshot"), e(6, "snapshot"), e(7, "snapshot"), e(8, "since")]
    const r = splitDigest(rows, 5)
    expect(r.shown.map((x) => x.id)).toEqual([1, 3, 4, 5, 6])
    expect(r.more.map((x) => x.id)).toEqual([7])
    expect(r.sinceMorning.map((x) => x.id)).toEqual([2, 8])
  })
  it("uses the configured number of visible entries (min 1)", () => {
    const rows = [e(1, "snapshot"), e(2, "snapshot"), e(3, "snapshot")]
    expect(splitDigest(rows, 2).more.map((x) => x.id)).toEqual([3])
    expect(splitDigest(rows, 0).shown.map((x) => x.id)).toEqual([1])
  })
})

describe("«Неделя» sections (06 §7.2, §7.4)", () => {
  it("puts «Истекло» and «Тема затихла» after the main list, «Новое после обзора» apart", () => {
    const rows = [
      { id: 1, attention: { section: null } },
      { id: 2, attention: { section: "expired" as const } },
      { id: 3, attention: { section: "dormant" as const } },
      { id: 4, attention: null },
      { id: 5, attention: { section: "expired" as const }, snapshot: "since" as const },
      { id: 6, attention: { section: null }, snapshot: "since" as const },
    ]
    const r = splitWeek(rows)
    expect(r.main.map((x) => x.id)).toEqual([1, 4])
    expect(r.expired.map((x) => x.id)).toEqual([2])
    expect(r.dormant.map((x) => x.id)).toEqual([3])
    expect(r.since.map((x) => x.id)).toEqual([5, 6])
  })
})

describe("journal in plain Russian", () => {
  const d = (type: string, payload: Record<string, unknown> = {}, actor = "agent") =>
    describeTopicEvent({ type, actor, payload }, (c) => (c === "INVOICE_PAID" ? "Счёт оплачен" : null))
  it("describes engine and user events", () => {
    expect(d("created")).toBe("Тема создана")
    expect(d("resolved", { code: "INVOICE_PAID" })).toBe("Тема решена: Счёт оплачен")
    expect(d("attention_changed", { from: "digest", to: "now" })).toBe("Список: «Сводка» → «Сейчас»")
    expect(d("snoozed", { until: "2026-11-20T05:00:00.000Z" })).toMatch(/^Отложено до 20 ноября 2026/)
    expect(d("owner_changed", { toName: "Иван" })).toBe("Ответственный: Иван")
    expect(d("owner_changed", {})).toBe("Ответственный снят")
    expect(d("deal_linked", { dealName: "Поставка" })).toBe("Тема привязана к сделке «Поставка»")
    expect(d("item_detached", { reason: "user" })).toBe("Сообщение отвязано от темы (вручную)")
    expect(d("done", { note: "звонок сделан" })).toBe("Отмечено «Готово»: звонок сделан")
    expect(d("merged_into", { title: "Скидка" })).toBe("Тема объединена с темой «Скидка»")
  })
  it("never returns a raw type", () => {
    expect(d("something_new")).toBe("Событие системы")
    expect(d("something_new", {}, "user")).toBe("Действие пользователя")
  })
})

describe("misc", () => {
  it("tabs and status labels", () => {
    expect(isTopicTab("now")).toBe(true)
    expect(isTopicTab("none")).toBe(false)
    expect(topicStatusRu("done")).toBe("Готово")
    expect(topicStatusRu("x")).toBe("x")
  })
})

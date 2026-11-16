import { describe, expect, it } from "vitest"
import { FIELD_WEIGHT, entityMatchesFilter, searchNormalise } from "./entity-search"

const f = (...values: (string | null)[]) => values.map((value) => ({ value, weight: FIELD_WEIGHT.name }))

describe("entityMatchesFilter (UI filter boxes)", () => {
  it("matches across scripts, dashes and word order", () => {
    expect(entityMatchesFilter("Норлекс", f("Norleks – Торговая Компания"))).toBe(true)
    expect(entityMatchesFilter("Norleks — Торговая", f("Norleks – Торговая Компания"))).toBe(true)
    expect(entityMatchesFilter("Евгений Богданов", f("Богданов Евгений"))).toBe(true)
    expect(entityMatchesFilter("kva", f("Квант"))).toBe(true)
  })

  it("no fuzzy tail, one-direction prefix, empty query matches all", () => {
    expect(entityMatchesFilter("Вектр", f("Вектор"))).toBe(false)
    expect(entityMatchesFilter("kvant", f("в работе"))).toBe(false)
    expect(entityMatchesFilter("grab something", f("AB"))).toBe(false)
    expect(entityMatchesFilter("", f("x"))).toBe(true)
    expect(entityMatchesFilter("x", f(null, ""))).toBe(false)
    expect(searchNormalise("Müllerwerk")).toBe("mullerwerk")
  })
})

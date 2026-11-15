import { describe, expect, it } from "vitest"
import {
  describeOrderIntakeSeller,
  NEUTRAL_SELLER,
  ORDER_INTAKE_MAX_PRODUCTS,
} from "./order-request-prompt"

describe("describeOrderIntakeSeller — identity I4", () => {
  it("empty profile → neutral text", () => {
    expect(describeOrderIntakeSeller(null)).toBe(NEUTRAL_SELLER)
    expect(describeOrderIntakeSeller({ name: "Пример", marketRoles: [], products: [] })).toBe(NEUTRAL_SELLER)
    expect(describeOrderIntakeSeller({ name: "Пример", marketRoles: ["other"], products: [{ name: " " }] })).toBe(
      NEUTRAL_SELLER,
    )
  })
  it("roles + products", () => {
    expect(
      describeOrderIntakeSeller({
        name: "Пример",
        marketRoles: ["manufacturer", "other"],
        products: [{ name: "Модуль А" }, { name: "модуль а" }, { name: "Сервис Б" }],
      }),
    ).toBe(
      '"Пример", a company that sells to business clients (market role: Производитель; products / services: Модуль А, Сервис Б)',
    )
  })
  it("caps the product list", () => {
    const products = Array.from({ length: ORDER_INTAKE_MAX_PRODUCTS + 3 }, (_, i) => ({ name: `P${i}` }))
    const text = describeOrderIntakeSeller({ name: "", marketRoles: [], products })
    expect(text).toContain(`P${ORDER_INTAKE_MAX_PRODUCTS - 1} and 3 more`)
    expect(text).not.toContain(`P${ORDER_INTAKE_MAX_PRODUCTS},`)
    expect(text.startsWith("a company")).toBe(true)
  })
})

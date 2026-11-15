import { describe, expect, it } from "vitest"
import { orgProductsLine, orgPromptFacts, orgRoleLine } from "./prompt-org-lines"

describe("org prompt lines (identity I4)", () => {
  it("name + role labels", () => {
    const f = orgPromptFacts("Альфа", { marketRoles: ["manufacturer", "distributor"], products: [] })
    expect(orgRoleLine(f)).toBe("Наша компания: Альфа — производитель, дистрибьютор / оптовик.")
    expect(orgProductsLine(f)).toBe("")
  })

  it("name only; nothing → empty", () => {
    expect(orgRoleLine(orgPromptFacts("Альфа", null))).toBe("Наша компания: Альфа.")
    expect(orgRoleLine(orgPromptFacts("", { marketRoles: [], products: [] }))).toBe("")
  })

  it("products: deduplicated, capped with «и ещё N»", () => {
    const products = ["Продукт 1", "продукт 1", ...Array.from({ length: 20 }, (_, i) => ({ name: `П${i}` })).map((p) => p.name)]
    const f = orgPromptFacts("Альфа", { marketRoles: [], products: products.map((name) => ({ name })) })
    const line = orgProductsLine(f, 3)
    expect(line).toBe("Наши продукты и услуги: Продукт 1; П0; П1; и ещё 18.")
  })

  it("deterministic", () => {
    const p = { marketRoles: ["services" as const], products: [{ name: "Аудит" }] }
    expect(orgRoleLine(orgPromptFacts("Альфа", p))).toBe(orgRoleLine(orgPromptFacts("Альфа", p)))
  })
})

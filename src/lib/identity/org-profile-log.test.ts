import { describe, expect, it } from "vitest"
import { EMPTY_ORG_PROFILE, type OrgProfileInput } from "@/lib/identity/org-profile"
import { canonicalOrgProfile, diffOrgProfile, formatProfileValue } from "@/lib/identity/org-profile-log"

const base: OrgProfileInput = {
  ...EMPTY_ORG_PROFILE,
  description: "Импортируем оборудование.",
  industryCode: "trade",
  marketRoles: ["importer", "distributor"],
  products: [{ name: "Оборудование", description: "Европа, Азия" }],
  targetCustomers: [{ name: "Малый бизнес" }],
}

describe("canonicalOrgProfile", () => {
  it("trims, nulls empty text, drops empty lines and descriptions, orders roles", () => {
    const c = canonicalOrgProfile({
      ...EMPTY_ORG_PROFILE,
      description: "  ",
      geography: " Энск ",
      marketRoles: ["distributor", "importer", "distributor"],
      products: [
        { name: " Вино ", description: " ", categories: ["Вино", " ", "Вино"] },
        { name: "  " },
      ],
      glossary: [{ term: "ТТ", meaning: "торговая точка" }, { term: " ", meaning: "x" }],
    })
    expect(c.description).toBeNull()
    expect(c.geography).toBe("Энск")
    expect(c.marketRoles).toEqual(["importer", "distributor"])
    expect(c.products).toEqual([{ name: "Вино", categories: ["Вино"] }])
    expect(c.glossary).toEqual([{ term: "ТТ", meaning: "торговая точка" }])
  })
})

describe("diffOrgProfile", () => {
  it("no change → nothing logged (also for whitespace / role order)", () => {
    const d = diffOrgProfile(base, {
      ...base,
      description: " Импортируем оборудование. ",
      marketRoles: ["distributor", "importer"],
    })
    expect(d.changed).toEqual([])
    expect(d.before).toEqual({})
    expect(d.after).toEqual({})
  })
  it("logs before / after of the changed fields only", () => {
    const d = diffOrgProfile(base, {
      ...base,
      industryCode: "food_beverage",
      targetCustomers: [{ name: "Малый бизнес" }, { name: "Магазины" }],
      noOwnDomain: true,
    })
    expect(d.changed).toEqual(["industryCode", "targetCustomers", "noOwnDomain"])
    expect(d.before).toEqual({
      industryCode: "trade",
      targetCustomers: [{ name: "Малый бизнес" }],
      noOwnDomain: false,
    })
    expect(d.after).toEqual({
      industryCode: "food_beverage",
      targetCustomers: [{ name: "Малый бизнес" }, { name: "Магазины" }],
      noOwnDomain: true,
    })
    expect(Object.keys(d.after)).not.toContain("description")
  })
  it("first save from the empty profile", () => {
    const d = diffOrgProfile(EMPTY_ORG_PROFILE, base)
    expect(d.changed).toEqual(["description", "industryCode", "marketRoles", "products", "targetCustomers"])
    expect(d.before.description).toBeNull()
  })
})

describe("formatProfileValue", () => {
  it("renders values in Russian", () => {
    expect(formatProfileValue("marketRoles", ["importer"])).toBe("Импортёр")
    expect(formatProfileValue("industryCode", "trade", { trade: "Торговля" })).toBe("Торговля")
    expect(formatProfileValue("products", [{ name: "Вино" }, { name: "Сидр" }])).toBe("Вино, Сидр")
    expect(formatProfileValue("noOwnDomain", true)).toBe("да")
    expect(formatProfileValue("description", null)).toBe("—")
  })
})

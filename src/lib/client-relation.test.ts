import { describe, expect, it } from "vitest"
import { clientRelation } from "./client-relation"

describe("clientRelation", () => {
  it("manual tag wins over deals", () => {
    expect(clientRelation({ companyKind: "supplier", hasWonDeal: true, hasOpenDeal: true })).toBe("supplier")
    expect(clientRelation({ companyKind: "partner", hasWonDeal: false, hasOpenDeal: true })).toBe("partner")
  })
  it("won deal → customer, open deal → potential, none → unclassified", () => {
    expect(clientRelation({ companyKind: undefined, hasWonDeal: true, hasOpenDeal: true })).toBe("customers")
    expect(clientRelation({ companyKind: null, hasWonDeal: false, hasOpenDeal: true })).toBe("potential")
    expect(clientRelation({ companyKind: "other", hasWonDeal: false, hasOpenDeal: false })).toBe("unclassified")
  })
})

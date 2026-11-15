import { describe, expect, it } from "vitest"
import { EMPTY_CLIENT_PROFILE, type ClientProfileValues, type FieldMeta } from "./client-profile"
import {
  changedProfileFields,
  manualSaveMeta,
  minConfidence,
  normalizeWebProfile,
  planWebProfileApply,
  webRefreshDue,
  withFieldValue,
  type WebProfileCandidate,
} from "./client-profile-apply"

const at = "2026-11-15T10:00:00.000Z"
const manual: FieldMeta = { source: "manual", byUserId: "u1", at, verified: true }

function values(over: Partial<ClientProfileValues> = {}): ClientProfileValues {
  return { ...EMPTY_CLIENT_PROFILE, needs: { lines: [] }, ...over }
}

const codes = new Set(["manufacturing", "retail_trade"])

describe("changedProfileFields / manualSaveMeta", () => {
  it("ignores spacing, case and order", () => {
    const a = values({ description: "Делает  станки", products: [{ name: "А" }, { name: "Б" }], marketRoles: ["retail", "manufacturer"] })
    const b = values({ description: "Делает станки ", products: [{ name: "б" }, { name: "а" }], marketRoles: ["manufacturer", "retail"] })
    expect(changedProfileFields(a, b)).toEqual([])
  })

  it("stamps only changed fields as manual and drops meta of cleared fields", () => {
    const before = values({ description: "Старое", geography: "Север" })
    const after = values({ description: "Новое", geography: null, sizeBand: "small" })
    const web: FieldMeta = { source: "web", at, verified: false }
    const { meta, changed } = manualSaveMeta(before, after, { geography: web, products: web }, "u9", at)
    expect(changed.sort()).toEqual(["description", "geography", "size"])
    expect(meta.description).toEqual({ source: "manual", byUserId: "u9", at, verified: true })
    expect(meta.size?.source).toBe("manual")
    expect(meta.geography).toBeUndefined()
    expect(meta.products).toBe(web) // untouched
  })
})

describe("normalizeWebProfile", () => {
  it("drops unknown codes / roles / bands and caps confidence", () => {
    const out = normalizeWebProfile(
      {
        description: { value: "  Компания делает станки.  ", confidence: "high", sourceUrl: "https://ex.org/about" },
        industry: { code: "nope", note: "x", confidence: "high", sourceUrl: "" },
        marketRoles: { values: ["manufacturer", "pirate"], confidence: "medium", sourceUrl: "javascript:alert(1)" },
        products: { names: ["Станок", "станок", " ", "Пресс"], confidence: "high", sourceUrl: "https://ex.org" },
        size: { band: "huge", pointsOfSale: 3, confidence: "high", sourceUrl: "" },
        geography: { value: "", confidence: "high", sourceUrl: "" },
      },
      { industryCodes: codes, capConfidence: "medium" },
    )
    expect(out.map((c) => c.field)).toEqual(["description", "marketRoles", "products"])
    expect(out[0].value).toEqual({ description: "Компания делает станки." })
    expect(out[0].confidence).toBe("medium") // capped by the candidate match
    expect(out[0].evidenceUrl).toBe("https://ex.org/about")
    expect(out[1].evidenceUrl).toBeNull()
    expect(out[1].value).toEqual({ marketRoles: ["manufacturer"] })
    expect(out[2].value).toEqual({ products: [{ name: "Станок" }, { name: "Пресс" }] })
  })

  it("keeps a known industry code with its note and a size band", () => {
    const out = normalizeWebProfile(
      {
        industry: { code: "retail_trade", note: "сеть магазинов", confidence: "high", sourceUrl: "https://ex.org" },
        size: { band: "chain", pointsOfSale: 40, confidence: "low", sourceUrl: "https://ex.org" },
      },
      { industryCodes: codes },
    )
    expect(out[0].value).toEqual({ industryCode: "retail_trade", industryNote: "сеть магазинов" })
    expect(out[1]).toMatchObject({ field: "size", value: { sizeBand: "chain", pointsOfSale: 40 }, confidence: "low" })
  })

  it("minConfidence", () => {
    expect(minConfidence("high", "low")).toBe("low")
    expect(minConfidence("medium", "high")).toBe("medium")
  })
})

describe("planWebProfileApply", () => {
  const cand = (field: WebProfileCandidate["field"], value: WebProfileCandidate["value"], confidence: WebProfileCandidate["confidence"] = "high"): WebProfileCandidate => ({
    field,
    value,
    confidence,
    evidenceUrl: "https://ex.org",
  })

  it("fills empty fields unverified and proposes for filled ones", () => {
    const plan = planWebProfileApply({
      values: values({ description: "Наше описание" }),
      meta: { description: manual },
      pending: [],
      incoming: [cand("description", { description: "Описание из сети" }), cand("geography", { geography: "Юг" }, "medium")],
      at,
    })
    expect(plan.filled).toEqual(["geography"])
    expect(plan.values.geography).toBe("Юг")
    expect(plan.meta.geography).toEqual({ source: "web", at, confidence: "medium", evidenceUrl: "https://ex.org", verified: false })
    // manual value never overwritten
    expect(plan.values.description).toBe("Наше описание")
    expect(plan.meta.description).toBe(manual)
    expect(plan.proposals).toHaveLength(1)
    expect(plan.proposals[0]).toMatchObject({ field: "description", value: { description: "Описание из сети" } })
  })

  it("low confidence never auto-fills an empty field", () => {
    const plan = planWebProfileApply({
      values: values(),
      meta: {},
      pending: [],
      incoming: [cand("products", { products: [{ name: "Станок" }] }, "low")],
      at,
    })
    expect(plan.filled).toEqual([])
    expect(plan.values.products).toEqual([])
    expect(plan.proposals.map((p) => p.field)).toEqual(["products"])
  })

  it("identical value or identical pending proposal → nothing; different pending → superseded", () => {
    const base = values({ geography: "Юг", description: "Старое" })
    const same = planWebProfileApply({
      values: base,
      meta: {},
      pending: [{ id: "p1", field: "description", value: { description: "Новое" } }],
      incoming: [cand("geography", { geography: "юг " }), cand("description", { description: "Новое" })],
      at,
    })
    expect(same.unchanged.sort()).toEqual(["description", "geography"])
    expect(same.proposals).toEqual([])
    expect(same.supersede).toEqual([])

    const diff = planWebProfileApply({
      values: base,
      meta: {},
      pending: [{ id: "p1", field: "description", value: { description: "Новое" } }],
      incoming: [cand("description", { description: "Ещё новее" })],
      at,
    })
    expect(diff.supersede).toEqual(["p1"])
    expect(diff.proposals[0].value).toEqual({ description: "Ещё новее" })
  })

  it("an earlier unverified web value also gets a proposal (never overwritten)", () => {
    const plan = planWebProfileApply({
      values: values({ sizeBand: "small" }),
      meta: { size: { source: "web", at, verified: false } },
      pending: [],
      incoming: [cand("size", { sizeBand: "medium", pointsOfSale: null })],
      at,
    })
    expect(plan.values.sizeBand).toBe("small")
    expect(plan.proposals[0].value).toEqual({ sizeBand: "medium", pointsOfSale: null })
  })
})

describe("withFieldValue / webRefreshDue", () => {
  it("applies a slice and canonicalises it", () => {
    const v = withFieldValue(values(), "marketRoles", { marketRoles: ["retail", "manufacturer"] })
    expect(v.marketRoles).toEqual(["manufacturer", "retail"])
  })

  it("refresh is due after 180 days or when never enriched", () => {
    const now = new Date("2026-11-15T00:00:00Z")
    expect(webRefreshDue(null, now)).toBe(true)
    expect(webRefreshDue(new Date("2026-06-01T00:00:00Z"), now)).toBe(false)
    expect(webRefreshDue(new Date("2026-05-01T00:00:00Z"), now)).toBe(true)
  })
})

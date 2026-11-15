import { describe, expect, it } from "vitest"
import {
  CLIENT_SUMMARY_MAX_CHARS,
  EMPTY_CLIENT_PROFILE,
  clientProfileSummary,
  counterpartyProfileLine,
  isFieldEmpty,
  readFieldMeta,
  type ClientProfileValues,
  type FieldMeta,
} from "./client-profile"

const at = "2026-11-15T10:00:00.000Z"
const manual: FieldMeta = { source: "manual", byUserId: "u1", at, verified: true }
const web: FieldMeta = { source: "web", at, confidence: "medium", evidenceUrl: "https://example.org", verified: false }

function values(over: Partial<ClientProfileValues> = {}): ClientProfileValues {
  return { ...EMPTY_CLIENT_PROFILE, needs: { lines: [] }, ...over }
}

describe("clientProfileSummary", () => {
  it("returns an empty string for an empty profile", () => {
    expect(clientProfileSummary({ name: "Компания", values: values(), meta: {}, industryLabel: null })).toBe("")
  })

  it("puts verified values first and marks unverified ones", () => {
    const text = clientProfileSummary({
      name: "Компания",
      values: values({
        description: "Делает оборудование. Второе предложение.",
        industryCode: "manufacturing",
        marketRoles: ["manufacturer"],
      }),
      meta: { description: manual, industry: web, marketRoles: manual },
      industryLabel: "Производство",
      segment: "B",
    })
    expect(text.startsWith("Профиль клиента «Компания»: ")).toBe(true)
    // verified parts (role, description, segment) come before the unverified industry
    expect(text.indexOf("роль: Производитель")).toBeLessThan(text.indexOf("отрасль: Производство"))
    expect(text).toContain("отрасль: Производство (не проверено)")
    expect(text).not.toContain("роль: Производитель (не проверено)")
    expect(text).toContain("чем занимается: Делает оборудование.")
    expect(text).not.toContain("Второе предложение")
    expect(text).toContain("сегмент: B")
  })

  it("stays within 400 characters", () => {
    const long = "Очень длинное описание без точки ".repeat(30)
    const text = clientProfileSummary({
      name: "Компания",
      values: values({
        description: long,
        industryNote: "уточнение ".repeat(20),
        marketRoles: ["manufacturer", "distributor", "retail", "services"],
        needs: { lines: Array.from({ length: 20 }, (_, i) => `линия ${i}`), note: "заметка ".repeat(30) },
        sizeBand: "chain",
        pointsOfSale: 40,
      }),
      meta: { description: web },
      industryLabel: "Производство",
      segment: "A",
    })
    expect(text.length).toBeLessThanOrEqual(CLIENT_SUMMARY_MAX_CHARS)
    expect(text.length).toBeGreaterThan(0)
  })

  it("describes a chain with its points of sale", () => {
    const text = clientProfileSummary({
      name: "К",
      values: values({ sizeBand: "chain", pointsOfSale: 12 }),
      meta: { size: manual },
      industryLabel: null,
    })
    expect(text).toContain("размер: сеть (12 точек)")
  })
})

describe("counterpartyProfileLine", () => {
  it("builds the short line from industry and roles", () => {
    expect(
      counterpartyProfileLine({
        name: "Компания",
        values: values({ industryCode: "x", marketRoles: ["distributor"] }),
        meta: { industry: manual, marketRoles: manual },
        industryLabel: "Дистрибуция и логистика",
      }),
    ).toBe("Контрагент: Компания — Дистрибуция и логистика, Дистрибьютор / оптовик")
  })

  it("leaves unverified values out and returns '' when nothing is left", () => {
    expect(
      counterpartyProfileLine({
        name: "Компания",
        values: values({ industryCode: "x", marketRoles: ["retail"] }),
        meta: { industry: web, marketRoles: web },
        industryLabel: "Розничная торговля",
      }),
    ).toBe("")
  })

  it("returns '' for an empty profile", () => {
    expect(counterpartyProfileLine({ name: "К", values: values(), meta: {}, industryLabel: null })).toBe("")
  })
})

describe("readFieldMeta / isFieldEmpty", () => {
  it("drops bad entries and keeps confirm data", () => {
    const meta = readFieldMeta({
      description: { ...web, verified: true, verifiedByUserId: "u2", verifiedAt: at },
      products: { source: "nonsense", at, verified: true },
      unknownField: manual,
    })
    expect(meta.description?.verifiedByUserId).toBe("u2")
    expect(meta.products).toBeUndefined()
    expect(Object.keys(meta)).toEqual(["description"])
  })

  it("knows empty fields", () => {
    expect(isFieldEmpty(values(), "size")).toBe(true)
    expect(isFieldEmpty(values({ pointsOfSale: 3 }), "size")).toBe(false)
    expect(isFieldEmpty(values({ needs: { lines: [], note: " " } }), "needs")).toBe(true)
    expect(isFieldEmpty(values({ industryNote: "x" }), "industry")).toBe(false)
  })
})

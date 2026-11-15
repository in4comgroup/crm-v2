import { describe, expect, it } from "vitest"
import { EMPTY_ORG_PROFILE, type OrgProfileInput } from "./org-profile"
import { buildPromptCard, PROMPT_CARD_MAX_CHARS } from "./prompt-card"

const PROFILE: OrgProfileInput = {
  ...EMPTY_ORG_PROFILE,
  description: "Импортируем и продаём оборудование и расходные материалы малому бизнесу и сетям",
  industryCode: "trade",
  industryNote: "оборудование и материалы",
  marketRoles: ["importer", "distributor"],
  products: [{ name: "Оборудование" }, { name: "Расходные материалы" }, { name: "оборудование" }],
  targetCustomers: [{ name: "Малый бизнес" }, { name: "Сети супермаркетов" }],
  supplierTypes: [{ name: "Заводы-изготовители" }, { name: "Логистика" }],
  glossary: [{ term: "КП", meaning: "коммерческое предложение" }],
}

describe("buildPromptCard", () => {
  it("full card in the fixed order, Russian, de-duplicated", () => {
    const card = buildPromptCard({
      name: "Норлекс",
      otherNames: ["Норлекс", "Norleks Inter"],
      industryLabel: "Торговля",
      profile: PROFILE,
    })
    expect(card).toBe(
      [
        "О нашей компании: Норлекс (Norleks Inter).",
        "Роль: Импортёр, Дистрибьютор / оптовик.",
        "Отрасль: Торговля (оборудование и материалы).",
        "Чем занимаемся: Импортируем и продаём оборудование и расходные материалы малому бизнесу и сетям.",
        "Продукты и услуги: Оборудование; Расходные материалы.",
        "Наши клиенты: Малый бизнес; Сети супермаркетов.",
        "Кто продаёт нам: Заводы-изготовители; Логистика.",
        "Термины: КП — коммерческое предложение.",
      ].join("\n"),
    )
  })

  it("is deterministic", () => {
    const input = { name: "Норлекс", otherNames: ["Norleks Inter"], industryLabel: "Торговля", profile: PROFILE }
    expect(buildPromptCard(input)).toBe(buildPromptCard(input))
  })

  it("empty parts are left out; empty profile = name only", () => {
    expect(buildPromptCard({ name: "Globex", otherNames: [], industryLabel: null, profile: EMPTY_ORG_PROFILE })).toBe(
      "О нашей компании: Globex.",
    )
    expect(buildPromptCard({ name: "", otherNames: [], industryLabel: null, profile: EMPTY_ORG_PROFILE })).toBe("")
  })

  it("long lists are truncated with «и ещё N» and the card stays ≤ 1,500 chars", () => {
    const many = (n: number, p: string) => Array.from({ length: n }, (_, i) => ({ name: `${p} номер ${i + 1} с длинным названием линейки` }))
    const card = buildPromptCard({
      name: "Очень большая компания",
      otherNames: Array.from({ length: 8 }, (_, i) => `Бренд ${i}`),
      industryLabel: "Производство",
      profile: {
        ...PROFILE,
        description: "Д".repeat(500),
        products: many(30, "Продукт"),
        targetCustomers: many(10, "Сегмент"),
        supplierTypes: many(10, "Поставщик"),
        glossary: Array.from({ length: 30 }, (_, i) => ({ term: `Т${i}`, meaning: "з".repeat(200) })),
      },
    })
    expect(card.length).toBeLessThanOrEqual(PROMPT_CARD_MAX_CHARS)
    expect(card).toMatch(/Продукты и услуги: .*; и ещё \d+\./)
    expect(card).toContain("Бренд 0")
    expect(card).toContain("и ещё 3)")
    expect(card).toContain("Наши клиенты:")
  })
})

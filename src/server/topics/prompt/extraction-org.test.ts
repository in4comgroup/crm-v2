import { describe, expect, it, vi } from "vitest"

// Prompt builders only; keep the DB, storage and the registry out.
vi.mock("@/db/drizzle", () => ({ db: {} }))
vi.mock("@/server/storage", () => ({ getTextObject: vi.fn() }))
vi.mock("@/server/signals/registry", () => ({
  getCurrentVersion: vi.fn(),
  getEffectiveSignals: vi.fn(),
  getRegistry: vi.fn(),
}))

import {
  buildExtractionSystemPrompt,
  buildItemPrompt,
  ORG_CARD_RULES,
  type PromptCodeSet,
} from "@/server/topics/prompt/extraction"

// Identity I4: the «О нашей компании» block is in the extraction prompt only
// with `identity.promptContext`; off = the pre-I4 text.

const CARD = "О нашей компании: Альфа.\nРоль: производитель.\nКто продаёт нам: поставщики сырья."

const base: PromptCodeSet = {
  orgId: "org-1",
  codeSet: "live",
  taxonomyVersion: 7,
  codes: [
    {
      code: "SALES_OFFER_REQUESTED",
      packCode: "base",
      blockCode: "A",
      blockLabelRu: "Продажи",
      labelRu: "Запрошено КП",
      definitionRu: "Клиент просит КП",
      boundaryRu: "Не рассылка",
      cuesPromptRu: ["пришлите КП"],
      antiCuesRu: [],
      kind: "event",
      weight: 5,
      reviewOnly: false,
    },
  ],
  attributes: [],
  knownCodes: ["SALES_OFFER_REQUESTED"],
  promptContext: false,
  orgCard: "",
}

describe("extraction prompt — org profile (identity I4)", () => {
  it("off: no org block, even when a card was loaded", () => {
    const off = buildExtractionSystemPrompt(base).system
    expect(off).not.toContain("О нашей компании")
    expect(off).not.toContain(ORG_CARD_RULES)
    expect(buildExtractionSystemPrompt({ ...base, orgCard: CARD }).system).toBe(off)
  })

  it("on: the card + the usage rules sit at the end of the static system prompt", () => {
    const off = buildExtractionSystemPrompt(base).system
    const on = buildExtractionSystemPrompt({ ...base, promptContext: true, orgCard: CARD }).system
    expect(on.startsWith(off)).toBe(true)
    expect(on).toContain(CARD)
    expect(on).toContain("Мы — покупатель")
    expect(on.endsWith(ORG_CARD_RULES)).toBe(true)
  })

  it("on with an empty card = the pre-I4 text", () => {
    expect(buildExtractionSystemPrompt({ ...base, promptContext: true, orgCard: "" }).system).toBe(
      buildExtractionSystemPrompt(base).system,
    )
  })

  it("the counterparty line is in the envelope only when given", () => {
    const env = { orgName: "Альфа", date: "2026-11-10T10:00:00.000Z" }
    const without = buildItemPrompt(env, "Текст")
    expect(without).not.toContain("Контрагент")
    expect(buildItemPrompt({ ...env, counterpartyLine: null }, "Текст")).toBe(without)
    const withLine = buildItemPrompt({ ...env, counterpartyLine: "Контрагент: Бета — розница" }, "Текст")
    expect(withLine).toContain("Наша компания: Альфа\nКонтрагент: Бета — розница")
  })

  it("the usage rules carry no vertical examples", () => {
    for (const w of ["вино", "алког", "horeca", "хорека"]) expect(ORG_CARD_RULES.toLowerCase()).not.toContain(w)
  })
})

import { describe, expect, it, vi } from "vitest"

// Envelope helpers only; keep the DB, storage and the registry out.
vi.mock("@/db/drizzle", () => ({ db: {} }))
vi.mock("@/server/storage", () => ({ getTextObject: vi.fn() }))
vi.mock("@/server/signals/registry", () => ({
  getCurrentVersion: vi.fn(),
  getEffectiveSignals: vi.fn(),
  getRegistry: vi.fn(),
}))

import { buildItemPrompt } from "@/server/topics/prompt/extraction"
import { envelopeFromItem, storedAllInternal } from "./item-input"

const item = (orgAttribution: Record<string, unknown> | undefined) => ({
  provider: "nylas",
  externalType: "email",
  sourceCreatedAt: null,
  orgAttribution: "own_org",
  metadataJson: {
    from: [{ email: "ivan@acme.example" }],
    to: [{ email: "petrov@acme.example" }],
    ...(orgAttribution ? { orgAttribution } : {}),
  },
})

describe("allInternal in the extraction envelope (identity Q9)", () => {
  it("reads the parse-time fact", () => {
    expect(storedAllInternal(item({ value: "own_org", allInternal: true }).metadataJson)).toBe(true)
    expect(storedAllInternal(item({ value: "own_org", allInternal: false }).metadataJson)).toBe(false)
    expect(storedAllInternal(item(undefined).metadataJson)).toBeNull()
  })

  it("the envelope line appears only for internal mail", () => {
    const yes = buildItemPrompt(envelopeFromItem(item({ allInternal: true })), "Текст")
    expect(yes).toContain("Внутренняя переписка (все участники — наши сотрудники)")
    const no = buildItemPrompt(envelopeFromItem(item({ allInternal: false })), "Текст")
    expect(no).not.toContain("Внутренняя переписка")
  })

  it("a forward is never internal (the author is the original sender)", () => {
    const fwd = envelopeFromItem(
      { ...item({ allInternal: true }), metadataJson: { ...item({ allInternal: true }).metadataJson, subject: "Fwd: заказ" } },
      "---------- Forwarded message ---------\nFrom: Client <c@acme.example>\nDate: 1 Nov 2026\nSubject: заказ\n\nПришлите счёт",
    )
    expect(fwd.originalAuthor).toBeTruthy()
    expect(fwd.allInternal).toBe(false)
  })
})

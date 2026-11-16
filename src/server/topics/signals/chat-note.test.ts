import { describe, expect, it, vi } from "vitest"

// Pure functions only; the modules import the DB client.
vi.mock("@/db/drizzle", () => ({ db: {} }))

const { buildItemPrompt } = await import("@/server/topics/prompt/extraction")
const { envelopeFromItem } = await import("./item-input")

const chatItem = (relayedFrom: string | null) => ({
  provider: "aichat",
  externalType: "aichat_session",
  sourceCreatedAt: new Date("2026-11-16T10:00:00Z"),
  orgAttribution: "own_org",
  metadataJson: {
    from: [{ name: "Иван Петров", email: "ivan@example.com" }],
    chatNote: { hasNewBusinessInfo: true, facts: ["Норлекс хочет КП"], relayedFrom },
    orgAttribution: { allInternal: true },
  },
})

describe("AI chat note envelope (docs/specs/ai-chat §16.3, Q22)", () => {
  it("reads like a forward: employee relayed, counterparty is the original author, never internal", () => {
    const e = envelopeFromItem(chatItem("Петров (Норлекс)"))
    expect(e.forwardedBy).toBe("Иван Петров <ivan@example.com>")
    expect(e.originalAuthor).toBe("Петров (Норлекс)")
    expect(e.relayedNote).toBe(true)
    expect(e.allInternal).toBe(false)
    const p = buildItemPrompt(e, "Звонил Петров")
    expect(p).toContain("Заметка сотрудника из ИИ чата (пересказ)")
    expect(p).toContain("Исходный автор: Петров (Норлекс)")
  })

  it("no named counterparty → «не указан»; old «Сохранить чат» rows (no chatNote) stay plain", () => {
    expect(envelopeFromItem(chatItem(null)).originalAuthor).toBe("не указан")
    const old = envelopeFromItem({ ...chatItem(null), metadataJson: { senders: ["Мой чат"] } })
    expect(old.relayedNote).toBeUndefined()
    expect(old.forwardedBy).toBeNull()
  })
})

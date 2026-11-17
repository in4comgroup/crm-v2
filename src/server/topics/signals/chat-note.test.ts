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

describe("Telegram member note (docs/specs/telegram/04 Q20, TI6)", () => {
  const tgItem = (kind: string, extra: Record<string, unknown> = {}) => ({
    provider: "telegram",
    externalType: "chat_message",
    sourceCreatedAt: new Date("2026-11-17T10:00:00Z"),
    orgAttribution: "own_org",
    metadataJson: {
      telegram: {
        chatType: "private",
        from: { id: 100, firstName: "Анна", username: "anna_sales" },
        resolved: { v: 1, author: { kind, tgUserId: "100", username: "anna_sales", name: "Анна", via: "staff_binding" }, counterpartyClientIds: [], counterpartyContactId: null, verified: true, forward: false },
        ...extra,
      },
    },
  })

  it("a member's own message to the bot = a relayed note; the counterparty comes from the text", () => {
    const e = envelopeFromItem(tgItem("member"))
    expect(e.relayedNote).toBe(true)
    expect(e.relayedNoteChannel).toBe("telegram")
    expect(e.forwardedBy).toBe("Анна (@anna_sales)")
    expect(e.originalAuthor).toBe("не указан")
    const p = buildItemPrompt(e, "Звонил Петрову из Альфы")
    expect(p).toContain("Заметка сотрудника о клиенте, отправленная боту в Telegram (пересказ)")
    expect(p).not.toContain("ИИ чата")
  })

  it("a client's message, a member's forward or a group message is not a note", () => {
    expect(envelopeFromItem(tgItem("contact")).relayedNote).toBeUndefined()
    expect(envelopeFromItem(tgItem("member", { chatType: "supergroup" })).relayedNote).toBeUndefined()
    const fwd = envelopeFromItem(tgItem("member", { forwardOrigin: { type: "hidden_user", date: 1, senderUserName: "Пётр" } }))
    expect(fwd.relayedNote).toBeUndefined()
    expect(fwd.originalAuthor).toBe("Пётр")
  })
})

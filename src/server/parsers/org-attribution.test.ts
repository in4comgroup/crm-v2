import { describe, expect, it, vi } from "vitest"

// The classifier is pure; keep the AI runtime and the blocklist (DB) out.
vi.mock("@/server/ai/runtime", () => ({ aiGenerateText: vi.fn() }))
vi.mock("@/server/blocklist", () => ({ loadOrgBlocklist: vi.fn() }))
vi.mock("@/server/org-identity", () => ({ loadOrgStaffNames: vi.fn() }))

import type { OrgIdentity } from "@/server/org-identity"
import {
  buildJudgePrompt,
  classifyOrgAttribution,
  extractAuthorTelegramHandle,
} from "./org-attribution"

const ID: OrgIdentity = {
  organizationId: "org1",
  name: "Норлекс",
  url: "https://norleks-inter.example",
  address: null,
  emailDomains: ["norleks-inter.example"],
  memberEmails: new Set(["ivan@norleks-inter.example"]),
  staffEmails: new Set(["petrov@bk.ru"]),
  mailboxes: new Set(["zakaz@gmail.com"]),
  staffTelegram: new Set(["petrov_tg"]),
  nameAliases: [],
  webDomains: ["norleks-inter.example"],
  addressKeys: [],
  addressLabels: [],
}

const classify = (authorEmails: string[], authorTelegram: string | null = null) =>
  classifyOrgAttribution({ authorEmails, authorTelegram, contentHaystack: "", orgIdentity: ID })

describe("classifyOrgAttribution — identity I2 rules", () => {
  it("member email → sender_member_email", () => {
    expect(classify(["ivan@norleks-inter.example"]).matchedOn).toEqual(["sender_member_email"])
  })
  it("staff extra address on a free-mail domain → own_org / high, sender_staff_address", () => {
    const r = classify(["petrov@bk.ru"])
    expect(r).toMatchObject({ value: "own_org", confidence: "high", matchedOn: ["sender_staff_address"] })
  })
  it("shared mailbox → own_org / high, sender_mailbox", () => {
    expect(classify(["zakaz@gmail.com"])).toMatchObject({ value: "own_org", confidence: "high", matchedOn: ["sender_mailbox"] })
  })
  it("other free-mail sender stays external (no gmail.com as our domain)", () => {
    expect(classify(["someone@gmail.com"])).toMatchObject({ value: "external", matchedOn: ["external_sender"] })
  })
  it("Telegram staff handle → own_org / high, sender_staff_telegram", () => {
    expect(classify([], "@Petrov_TG")).toMatchObject({
      value: "own_org",
      confidence: "high",
      matchedOn: ["sender_staff_telegram"],
    })
    expect(classify([], "client_x")).toMatchObject({ value: "unknown" })
  })
})

describe("extractAuthorTelegramHandle", () => {
  it("sender username", () => {
    expect(extractAuthorTelegramHandle({ telegram: { from: { username: "Petrov_TG" } } })).toBe("petrov_tg")
  })
  it("forward: the ORIGINAL author, not the forwarder", () => {
    expect(
      extractAuthorTelegramHandle({
        telegram: { from: { username: "petrov_tg" }, forwardOrigin: { type: "user", user: { username: "client_x" } } },
      }),
    ).toBe("client_x")
    expect(
      extractAuthorTelegramHandle({
        telegram: { from: { username: "petrov_tg" }, forwardOrigin: { type: "hidden_user", senderUserName: "X" } },
      }),
    ).toBeNull()
  })
  it("no telegram metadata → null", () => {
    expect(extractAuthorTelegramHandle({ from: [{ email: "a@b.example" }] })).toBeNull()
    expect(extractAuthorTelegramHandle(null)).toBeNull()
  })
})

describe("buildJudgePrompt — identity I4 (mailboxes + staff names)", () => {
  it("lists shared mailboxes and staff names", () => {
    const p = buildJudgePrompt(ID, ["Иван Петров", "Anna Smith"], "Документ")
    expect(p).toContain("Its shared mailboxes: zakaz@gmail.com")
    expect(p).toContain("Its staff (people who work for the organisation): Иван Петров, Anna Smith")
    expect(p).toContain("--- BEGIN DOCUMENT ---\nДокумент\n--- END DOCUMENT ---")
  })
  it("leaves empty lists out", () => {
    const p = buildJudgePrompt({ ...ID, mailboxes: new Set() }, [], "")
    expect(p).not.toContain("shared mailboxes")
    expect(p).not.toContain("Its staff")
    expect(p).toContain("(empty)")
  })
})

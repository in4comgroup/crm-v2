import { describe, expect, it } from "vitest"
import {
  handleKey,
  readTelegramResolved,
  resolveTelegramMessage,
  telegramAddressLabel,
  telegramDuplicateGroups,
  type TelegramDirectory,
} from "./resolve"

function dir(over: Partial<TelegramDirectory> = {}): TelegramDirectory {
  return {
    staffById: new Map([["100", "u_anna"]]),
    staffByHandle: new Map([["ivan_sales", "u_ivan"]]),
    addresses: [
      { addressId: "a1", contactId: "c_petr", handle: "petr_iv", externalId: null, status: "active" },
      { addressId: "a2", contactId: "c_olga", handle: "olga_k", externalId: "300", status: "active" },
      { addressId: null, contactId: "c_legacy", handle: "legacy_one", externalId: null, status: "active" },
      { addressId: "a4", contactId: "c_d1", handle: "same_name", externalId: null, status: "active" },
      { addressId: "a5", contactId: "c_d2", handle: "same_name", externalId: null, status: "active" },
    ],
    contactClients: new Map([
      ["c_petr", ["cl_alfa"]],
      ["c_olga", ["cl_beta", "cl_gamma"]],
      ["c_legacy", []],
    ]),
    ...over,
  }
}

const msg = (from: { id?: string; username?: string; name?: string } | null, extra: Record<string, unknown> = {}) =>
  resolveTelegramMessage(
    { from: from ? { id: from.id ?? null, username: from.username ?? null, name: from.name ?? null } : null, forwardOrigin: null, chatType: "private", ...extra },
    dir(),
  )

describe("resolveTelegramMessage — author steps (§8.1)", () => {
  it("1 binding id wins over everything; 2 staff handle", () => {
    expect(msg({ id: "100", username: "petr_iv" }).resolved.author).toMatchObject({ kind: "member", userId: "u_anna", via: "staff_binding" })
    expect(msg({ id: "999", username: "Ivan_Sales" }).resolved.author).toMatchObject({ kind: "member", userId: "u_ivan", via: "staff_handle" })
    expect(msg({ id: "100" }).resolved.verified).toBe(true)
  })

  it("3 contact by id (verified); a new username → rename", () => {
    const r = msg({ id: "300", username: "olga_new" })
    expect(r.resolved.author).toMatchObject({ kind: "contact", contactId: "c_olga", via: "contact_id" })
    expect(r.resolved.verified).toBe(true)
    expect(r.resolved.counterpartyClientIds).toEqual(["cl_beta", "cl_gamma"])
    expect(r.learn).toEqual([{ kind: "rename", contactId: "c_olga", tgUserId: "300", newHandle: "olga_new", oldAddressId: "a2" }])
    expect(msg({ id: "300", username: "olga_k" }).learn).toEqual([])
  })

  it("4 contact by username → learn the id (also for a legacy alias); unique hits only", () => {
    const r = msg({ id: "200", username: "@Petr_Iv" })
    expect(r.resolved.author).toMatchObject({ kind: "contact", contactId: "c_petr", via: "contact_handle" })
    expect(r.resolved.verified).toBe(false)
    expect(r.resolved.counterpartyClientIds).toEqual(["cl_alfa"])
    expect(r.learn).toEqual([{ kind: "learn_id", contactId: "c_petr", addressId: "a1", handle: "petr_iv", tgUserId: "200" }])
    expect(msg({ id: "201", username: "legacy_one" }).learn).toEqual([{ kind: "learn_id", contactId: "c_legacy", addressId: null, handle: "legacy_one", tgUserId: "201" }])
    expect(msg({ id: "202", username: "same_name" }).resolved.author.kind).toBe("unknown")
    // The id already belongs to another contact → no second contact learns it.
    expect(msg({ id: "300", username: "petr_iv" }).resolved.author.contactId).toBe("c_olga")
  })

  it("6 unknown keeps name / id; no username, no author", () => {
    const r = msg({ id: "555", name: "Сергей" })
    expect(r.resolved.author).toMatchObject({ kind: "unknown", tgUserId: "555", name: "Сергей", via: "unknown" })
    expect(r.resolved.counterpartyClientIds).toEqual([])
    expect(msg(null).resolved.author.via).toBe("no_author")
  })

  it("a forward → the ORIGINAL author; hidden / chat origin → unknown", () => {
    const r = resolveTelegramMessage(
      { from: { id: "100", username: null, name: "Анна" }, forwardOrigin: { type: "user", user: { id: 200, username: "petr_iv", firstName: "Пётр" } }, chatType: "private" },
      dir(),
    )
    expect(r.resolved.author).toMatchObject({ kind: "contact", contactId: "c_petr" })
    expect(r.resolved.forward).toBe(true)
    const h = resolveTelegramMessage({ from: { id: "100", username: null, name: null }, forwardOrigin: { type: "hidden_user", senderUserName: "Пётр" }, chatType: "private" }, dir())
    expect(h.resolved.author).toMatchObject({ kind: "unknown", name: "Пётр", via: "hidden_forward" })
  })
})

describe("counterparty (§8.2)", () => {
  it("our member in a group → the group peer's company; in a DM → none", () => {
    const g = resolveTelegramMessage({ from: { id: "100", username: null, name: "Анна" }, forwardOrigin: null, chatType: "supergroup", groupPeer: { id: "300", username: null, name: "Ольга" } }, dir())
    expect(g.resolved.author.kind).toBe("member")
    expect(g.resolved.counterpartyContactId).toBe("c_olga")
    expect(g.resolved.counterpartyClientIds).toEqual(["cl_beta", "cl_gamma"])
    expect(g.learn).toEqual([])
    const d = resolveTelegramMessage({ from: { id: "100", username: null, name: "Анна" }, forwardOrigin: null, chatType: "private", groupPeer: { id: "300", username: null, name: null } }, dir())
    expect(d.resolved.counterpartyClientIds).toEqual([])
  })
})

describe("helpers", () => {
  it("handleKey, labels, read, duplicates", () => {
    expect(handleKey("@Petr_Iv")).toBe("petr_iv")
    expect(handleKey("ab")).toBeNull()
    expect(telegramAddressLabel("petr_iv")).toBe("@petr_iv")
    expect(telegramAddressLabel("tg:555")).toBe("Telegram id 555")
    expect(readTelegramResolved({ telegram: { resolved: { v: 1, author: { kind: "unknown" } } } })).not.toBeNull()
    expect(readTelegramResolved({ telegram: {} })).toBeNull()
    const groups = telegramDuplicateGroups(dir().addresses)
    expect(groups).toEqual([{ key: "h:same_name", label: "@same_name", contactIds: ["c_d1", "c_d2"] }])
  })
})

describe("chat bindings (TI4, §7.4) and company accounts (step 5)", () => {
  const bound = (mode: "clients" | "internal" | "auto", clientIds: string[]) =>
    dir({ chats: new Map([["-1001", { rowId: "r1", mode, clientIds }]]), companyAccounts: [{ tgUserId: "700", handle: "alfa_sales", clientIds: ["cl_alfa"] }] })
  const inGroup = (from: { id: string; username?: string }, d: TelegramDirectory, extra: Record<string, unknown> = {}) =>
    resolveTelegramMessage({ from: { id: from.id, username: from.username ?? null, name: "X" }, forwardOrigin: null, chatType: "supergroup", chatId: "-1001", ...extra }, d)

  it("check 7: bound to A — unknown author → A + «Новый контакт в A?»; our member → A (no groupPeer guess)", () => {
    const d = bound("clients", ["cl_alfa"])
    const u = inGroup({ id: "555" }, d)
    expect(u.resolved.counterpartyClientIds).toEqual(["cl_alfa"])
    expect(u.resolved.proposeContactFor).toBe("cl_alfa")
    expect(u.resolved.chat).toEqual({ rowId: "r1", mode: "clients", clientIds: ["cl_alfa"] })
    const m = inGroup({ id: "100" }, d, { groupPeer: { id: "300", username: null, name: null } })
    expect(m.resolved.author.kind).toBe("member")
    expect(m.resolved.counterpartyClientIds).toEqual(["cl_alfa"])
    expect(m.resolved.counterpartyContactId).toBeNull()
  })

  it("check 8: bound to A and B — a contact of B → B first; unknown → the primary; Q19: a contact of C → A, not the topic contact", () => {
    const d = bound("clients", ["cl_alfa", "cl_beta"])
    const b = inGroup({ id: "300" }, d)
    expect(b.resolved.counterpartyClientIds).toEqual(["cl_beta", "cl_alfa"])
    expect(b.resolved.counterpartyContactId).toBe("c_olga")
    expect(inGroup({ id: "556" }, d).resolved.counterpartyClientIds).toEqual(["cl_alfa", "cl_beta"])
    const other = inGroup({ id: "200", username: "petr_iv" }, bound("clients", ["cl_beta"]))
    expect(other.resolved.author.contactId).toBe("c_petr")
    expect(other.resolved.counterpartyClientIds).toEqual(["cl_beta"])
    expect(other.resolved.counterpartyContactId).toBeNull()
  })

  it("internal chat: no company, internal flag; a non-member → warning (Q28)", () => {
    const d = bound("internal", [])
    const m = inGroup({ id: "100" }, d)
    expect(m.resolved.internal).toBe(true)
    expect(m.resolved.counterpartyClientIds).toEqual([])
    expect(m.resolved.warnings).toBeUndefined()
    expect(inGroup({ id: "555" }, d).resolved.warnings).toEqual(["non_member_in_internal_chat"])
  })

  it("step 5: a company's own account by id or username; in a DM its company", () => {
    const d = bound("auto", [])
    const a = resolveTelegramMessage({ from: { id: "700", username: null, name: "Alfa" }, forwardOrigin: null, chatType: "private", chatId: "700" }, d)
    expect(a.resolved.author).toMatchObject({ kind: "company_account", clientId: "cl_alfa", via: "company_account" })
    expect(a.resolved.counterpartyClientIds).toEqual(["cl_alfa"])
    expect(resolveTelegramMessage({ from: { id: "701", username: "Alfa_Sales", name: null }, forwardOrigin: null, chatType: "private" }, d).resolved.author.kind).toBe("company_account")
    // A forward of an unknown person in a bound chat → no proposal (the forwarder is not the author).
    const f = resolveTelegramMessage({ from: { id: "100", username: null, name: null }, forwardOrigin: { type: "user", user: { id: 999, username: null } }, chatType: "supergroup", chatId: "-1001" }, bound("clients", ["cl_alfa"]))
    expect(f.resolved.proposeContactFor).toBeUndefined()
  })
})

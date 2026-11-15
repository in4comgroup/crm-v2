import { describe, expect, it } from "vitest"
import {
  buildOwnOrgIdentitySets,
  computeAllInternal,
  isStaffTelegram,
  matchOwnEmail,
  type OwnOrgRawInput,
} from "./own-org-sets"
import { isFreemailDomain } from "@/lib/email-domain"
import { isFreemailDomain as ruIsFreemailDomain } from "@/lib/ru-mail"

const RAW: OwnOrgRawInput = {
  org: {
    name: "ООО «Норлекс»",
    webUrl: "https://www.norleks-inter.example/about",
    email: "info@norleks-inter.example",
    address: "г. Энск, ул. Примерная, д. 1",
  },
  members: [
    { email: "Ivan@norleks-inter.example", role: "user" },
    { email: "boss@gmail.com", role: "user" },
    { email: "agent+org@agents.invalid", role: "agent" },
    { email: "admin@truffalo.ai", role: "admin" },
  ],
  registry: [
    { kind: "name", matchKey: "norleksinter", label: "Norleks Inter", channel: null },
    { kind: "website", matchKey: "norleks-group.example", label: "norleks-group.example", channel: null },
    { kind: "website", matchKey: "gmail.com", label: "gmail.com", channel: null },
    { kind: "email_domain", matchKey: "norleks-mail.example", label: "norleks-mail.example", channel: null },
    { kind: "email_domain", matchKey: "bk.ru", label: "bk.ru", channel: null },
    { kind: "mailbox", matchKey: "sales@gmail.com", label: "sales@gmail.com", channel: null },
    { kind: "person", matchKey: "petrov@bk.ru", label: "petrov@bk.ru", channel: "email" },
    { kind: "person", matchKey: "petrov_tg", label: "@Petrov_TG", channel: "telegram" },
    { kind: "person", matchKey: "79161234567", label: "8 916 123-45-67", channel: "phone" },
    // Legacy row with no channel / matchKey: inferred from the label.
    { kind: "person", matchKey: null, label: "@Sidorov_Work", channel: null },
    { kind: "address", matchKey: null, label: "Санкт-Петербург, Невский проспект 10", channel: null },
  ],
}

describe("one freemail list", () => {
  it("covers the RU / CIS providers in both exports", () => {
    for (const d of ["gmail.com", "bk.ru", "list.ru", "inbox.ru", "ya.ru", "rambler.ru", "yandex.kz", "@mail.ru"]) {
      expect(isFreemailDomain(d), d).toBe(true)
      expect(ruIsFreemailDomain(d), d).toBe(true)
    }
    expect(isFreemailDomain("norleks-inter.example")).toBe(false)
  })
})

describe("buildOwnOrgIdentitySets", () => {
  const sets = buildOwnOrgIdentitySets(RAW)

  it("own domains = website + registry websites / email domains + org email domain, freemail-guarded", () => {
    expect(sets.ownDomains).toEqual(["norleks-group.example", "norleks-inter.example", "norleks-mail.example"])
    expect(sets.webDomains).toEqual(["norleks-group.example", "norleks-inter.example"])
    expect(sets.ownDomains).not.toContain("gmail.com")
    expect(sets.ownDomains).not.toContain("bk.ru")
  })

  it("member domains never become own domains", () => {
    expect(sets.ownDomains).not.toContain("truffalo.ai")
  })

  it("org with own domains: only members on an own domain count as «us» (humans only, lower-case)", () => {
    expect(sets.memberEmails).toEqual(["ivan@norleks-inter.example"])
    expect(sets.excludedMemberEmails).toEqual(["admin@truffalo.ai", "boss@gmail.com"])
  })

  it("org with «Нет своего домена» or no domain at all: every member counts", () => {
    const noOwn = buildOwnOrgIdentitySets({ ...RAW, noOwnDomain: true })
    expect(noOwn.memberEmails).toEqual(["admin@truffalo.ai", "boss@gmail.com", "ivan@norleks-inter.example"])
    expect(noOwn.excludedMemberEmails).toEqual([])
    const noDomain = buildOwnOrgIdentitySets({
      org: { name: "X", webUrl: null, email: "x@gmail.com", address: null },
      members: [{ email: "boss@gmail.com", role: "user" }],
      registry: [],
    })
    expect(noDomain.memberEmails).toEqual(["boss@gmail.com"])
  })

  it("Globex case: test user on another domain and private gmail are not «us»", () => {
    const s = buildOwnOrgIdentitySets({
      org: { name: "Globex", webUrl: "https://www.globex-group.example/", email: "info@globex-group.example", address: null },
      members: [
        { email: "margo@globex-group.example", role: "user" },
        { email: "boris@truffalo.ai", role: "user" },
        { email: "john.black@gmail.com", role: "user" },
      ],
      registry: [],
    })
    expect(s.ownDomains).toEqual(["globex-group.example"])
    expect(s.memberEmails).toEqual(["margo@globex-group.example"])
    expect(matchOwnEmail(s, "boris@truffalo.ai")).toBeNull()
    expect(matchOwnEmail(s, "x@truffalo.ai")).toBeNull()
    expect(matchOwnEmail(s, "john.black@gmail.com")).toBeNull()
  })

  it("staff addresses per channel, mailboxes exact", () => {
    expect(sets.staffEmails).toEqual(["petrov@bk.ru"])
    expect(sets.staffTelegram).toEqual(["petrov_tg", "sidorov_work"])
    expect(sets.staffPhones).toEqual(["79161234567"])
    expect(sets.mailboxes).toEqual(["sales@gmail.com"])
  })

  it("names and company keys incl. domain-derived keys", () => {
    expect(sets.nameLabels).toEqual(["ООО «Норлекс»", "Norleks Inter"])
    expect(sets.nameKeys).toContain("norleksinter")
    expect(sets.companyKeys).toEqual(expect.arrayContaining(["norleksinter", "norleksinterexample", "norleksgroup", "norleksgroupexample"]))
  })

  it("addresses from the org record and the registry", () => {
    expect(sets.addressKeys).toHaveLength(2)
    expect(sets.addressLabels[0]).toBe("г. Энск, ул. Примерная, д. 1")
  })

  it("no org → empty sets, still reads registry and members", () => {
    const s = buildOwnOrgIdentitySets({ org: null, members: [], registry: [] })
    expect(s.ownDomains).toEqual([])
    expect(s.nameKeys).toEqual([])
  })
})

describe("matchOwnEmail / isStaffTelegram", () => {
  const sets = buildOwnOrgIdentitySets(RAW)
  it("exact sets win, on any domain", () => {
    expect(matchOwnEmail(sets, "IVAN@norleks-inter.example")).toBe("member_email")
    expect(matchOwnEmail(sets, "BOSS@gmail.com")).toBeNull() // member, but not on an own domain
    expect(matchOwnEmail(sets, "petrov@bk.ru")).toBe("staff_address")
    expect(matchOwnEmail(sets, "sales@gmail.com")).toBe("mailbox")
  })
  it("own domains and subdomains; member domains never; never free-mail", () => {
    expect(matchOwnEmail(sets, "new.hire@msk.norleks-inter.example")).toBe("own_domain")
    expect(matchOwnEmail(sets, "x@truffalo.ai")).toBeNull()
    expect(matchOwnEmail(sets, "stranger@gmail.com")).toBeNull()
    expect(matchOwnEmail(sets, "stranger@bk.ru")).toBeNull()
  })
  it("telegram handles with or without @, any case", () => {
    expect(isStaffTelegram(sets, "@PETROV_TG")).toBe(true)
    expect(isStaffTelegram(sets, "client_x")).toBe(false)
    expect(isStaffTelegram(sets, null)).toBe(false)
  })
})

describe("computeAllInternal (Q9)", () => {
  const sets = buildOwnOrgIdentitySets(RAW)
  const own = (e: string) => matchOwnEmail(sets, e) !== null
  const a = (email: string) => ({ email, name: "" })

  it("author and every recipient ours → true", () => {
    expect(
      computeAllInternal(
        { from: [a("ivan@norleks-inter.example")], to: [a("petrov@bk.ru")], cc: [a("sales@gmail.com")], bcc: [] },
        own,
      ),
    ).toBe(true)
  })
  it("one external recipient (also in bcc) → false", () => {
    expect(computeAllInternal({ from: [a("ivan@norleks-inter.example")], to: [a("client@acme.example")] }, own)).toBe(false)
    expect(
      computeAllInternal({ from: [a("ivan@norleks-inter.example")], to: [a("petrov@bk.ru")], bcc: [a("client@acme.example")] }, own),
    ).toBe(false)
  })
  it("external author → false", () => {
    expect(computeAllInternal({ from: [a("client@acme.example")], to: [a("ivan@norleks-inter.example")] }, own)).toBe(false)
  })
  it("no recipients / unreadable / non-mail items → false (model decides)", () => {
    expect(computeAllInternal({ from: [a("ivan@norleks-inter.example")], to: [], cc: [] }, own)).toBe(false)
    expect(computeAllInternal({ from: [a("ivan@norleks-inter.example")], to: [{ name: "Без адреса" }] }, own)).toBe(false)
    expect(computeAllInternal({ telegram: { from: { username: "petrov_tg" } } }, own)).toBe(false)
    expect(computeAllInternal(null, own)).toBe(false)
  })
  it("string addresses «Name <a@b>» are read", () => {
    expect(computeAllInternal({ from: ["Иван <ivan@norleks-inter.example>"], to: ["sales@gmail.com"] }, own)).toBe(true)
  })
})

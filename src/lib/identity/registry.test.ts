import { describe, expect, it } from "vitest"
import {
  normaliseIdentityInput,
  normaliseMailDomain,
  normalisePhone,
  normaliseTelegramHandle,
} from "@/lib/identity/registry"
import { isAnyFreemailDomain, isFreemailDomain } from "@/lib/email-domain"

const ok = (r: ReturnType<typeof normaliseIdentityInput>) => {
  if (!r.ok) throw new Error(`expected ok, got «${r.error}»`)
  return r
}

describe("freemail list", () => {
  it("is ONE list (global + RU / CIS)", () => {
    expect(isAnyFreemailDomain("gmail.com")).toBe(true)
    expect(isAnyFreemailDomain("bk.ru")).toBe(true)
    expect(isAnyFreemailDomain("@Rambler.RU")).toBe(true)
    expect(isAnyFreemailDomain("norleks-inter.example")).toBe(false)
    expect(isFreemailDomain("bk.ru")).toBe(true)
  })
})

describe("email_domain", () => {
  it("accepts a bare domain, @domain, an address and a URL", () => {
    expect(ok(normaliseIdentityInput("email_domain", "Norleks-Inter.example")).matchKey).toBe("norleks-inter.example")
    expect(ok(normaliseIdentityInput("email_domain", "@norleks-inter.example")).matchKey).toBe("norleks-inter.example")
    expect(ok(normaliseIdentityInput("email_domain", "ivan@mail.norleks-inter.example")).matchKey).toBe("mail.norleks-inter.example")
    expect(ok(normaliseIdentityInput("email_domain", "https://www.norleks-inter.example/x")).matchKey).toBe("norleks-inter.example")
    expect(normaliseMailDomain("сайт.рф")).toBe("сайт.рф")
  })
  it("refuses free-mail and junk", () => {
    expect(normaliseIdentityInput("email_domain", "gmail.com").ok).toBe(false)
    expect(normaliseIdentityInput("email_domain", "@bk.ru").ok).toBe(false)
    expect(normaliseIdentityInput("email_domain", "localhost").ok).toBe(false)
    expect(normaliseIdentityInput("email_domain", "   ").ok).toBe(false)
  })
})

describe("website", () => {
  it("reduces to the host and refuses free-mail hosts", () => {
    expect(ok(normaliseIdentityInput("website", "https://www.Norleks-inter.example/about")).matchKey).toBe("norleks-inter.example")
    expect(normaliseIdentityInput("website", "mail.ru").ok).toBe(false)
  })
})

describe("mailbox", () => {
  it("is an exact lower-case address, any domain", () => {
    const r = ok(normaliseIdentityInput("mailbox", "  Sales@Norleks-Inter.example "))
    expect(r.matchKey).toBe("sales@norleks-inter.example")
    expect(r.label).toBe("sales@norleks-inter.example")
    expect(ok(normaliseIdentityInput("mailbox", "zakaz.norleks@gmail.com")).matchKey).toBe("zakaz.norleks@gmail.com")
    expect(normaliseIdentityInput("mailbox", "sales@").ok).toBe(false)
    expect(normaliseIdentityInput("mailbox", "sales").ok).toBe(false)
  })
})

describe("person", () => {
  it("needs a valid channel", () => {
    expect(normaliseIdentityInput("person", "ivan@gmail.com").ok).toBe(false)
    expect(normaliseIdentityInput("person", "ivan@gmail.com", "fax").ok).toBe(false)
  })
  it("email → lower-case address (free-mail allowed)", () => {
    const r = ok(normaliseIdentityInput("person", "Ivan.Petrov@Gmail.com", "email"))
    expect(r).toMatchObject({ matchKey: "ivan.petrov@gmail.com", channel: "email" })
    expect(normaliseIdentityInput("person", "ivan@", "email").ok).toBe(false)
  })
  it("telegram → handle without @, lower-case; label keeps the case", () => {
    const r = ok(normaliseIdentityInput("person", "@Ivan_Petrov", "telegram"))
    expect(r).toMatchObject({ matchKey: "ivan_petrov", label: "@Ivan_Petrov", channel: "telegram" })
    expect(normaliseTelegramHandle("https://t.me/Ivan_Petrov")).toBe("ivan_petrov")
    expect(normaliseTelegramHandle("ivan_petrov")).toBe("ivan_petrov")
    expect(normaliseTelegramHandle("@ab")).toBe("") // too short
    expect(normaliseTelegramHandle("@1ivan")).toBe("") // must start with a letter
    expect(normaliseIdentityInput("person", "@иван", "telegram").ok).toBe(false)
  })
  it("phone → digits only, RU 8 → 7", () => {
    expect(ok(normaliseIdentityInput("person", "+7 (999) 000-11-22", "phone")).matchKey).toBe("79990001122")
    expect(normalisePhone("8 999 000 11 22")).toBe("79990001122")
    expect(normalisePhone("12-34")).toBe("")
    expect(normaliseIdentityInput("person", "abc", "phone").ok).toBe(false)
  })
})

describe("existing kinds keep their rules", () => {
  it("name / address", () => {
    expect(ok(normaliseIdentityInput("name", "ООО Норлекс")).matchKey).toBe(
      ok(normaliseIdentityInput("name", "Norleks")).matchKey,
    )
    expect(normaliseIdentityInput("address", "Энск").ok).toBe(false)
    expect(normaliseIdentityInput("address", "г. Энск, ул. Примерная, д. 5").ok).toBe(true)
  })
})

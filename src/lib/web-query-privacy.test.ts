import { describe, expect, it } from "vitest"
import { webQueryPrivacyIssue } from "./web-query-privacy"

describe("webQueryPrivacyIssue", () => {
  it("refuses e-mail addresses", () => {
    expect(webQueryPrivacyIssue("ivan.petrov@romashka.ru кто это")).toBe("email")
    expect(webQueryPrivacyIssue("контакт <a.b@x.co.uk>")).toBe("email")
  })

  it("refuses phone numbers", () => {
    expect(webQueryPrivacyIssue("+7 916 123-45-67 чей номер")).toBe("phone")
    expect(webQueryPrivacyIssue("+43 1 234 5678")).toBe("phone")
    expect(webQueryPrivacyIssue("(495) 123-45-67")).toBe("phone")
    expect(webQueryPrivacyIssue("8 916 123 45 67")).toBe("phone")
    expect(webQueryPrivacyIssue("89161234567")).toBe("phone")
    expect(webQueryPrivacyIssue("+4915112345678")).toBe("phone")
  })

  it("allows company data, years, dates, prices", () => {
    expect(webQueryPrivacyIssue("Норлекс официальный сайт")).toBeNull()
    expect(webQueryPrivacyIssue("ИНН 7707083893 ООО Ромашка")).toBeNull() // 10 digits: tax number
    expect(webQueryPrivacyIssue("ИНН 770708389312")).toBeNull() // 12 digits: tax number
    expect(webQueryPrivacyIssue("Бароло 2019 2020 цены")).toBeNull()
    expect(webQueryPrivacyIssue("выставка 16.11.2026 Вена")).toBeNull()
    expect(webQueryPrivacyIssue("выручка 1 200 000 руб")).toBeNull()
    expect(webQueryPrivacyIssue("Château Margaux 1996")).toBeNull()
    expect(webQueryPrivacyIssue("@romashka telegram канал")).toBeNull()
  })
})

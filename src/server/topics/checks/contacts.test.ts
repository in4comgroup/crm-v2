import { describe, expect, it } from "vitest"
import type { OpenProcessInstance } from "@/lib/topics/checks"
import { birthdayInYear, checkContactBirthday, type BirthdayContact } from "./contacts"

const c = (id: string, birthday: string, client: string | null = "Вектор"): BirthdayContact => ({
  contactId: id,
  name: `Контакт ${id}`,
  birthday,
  clientId: client ? `cl-${id}` : null,
  clientName: client,
})

const inst = (key: string, cleared = false): OpenProcessInstance => ({
  id: `i-${key}`,
  code: "CONTACT_BIRTHDAY",
  conditionKey: key,
  topicId: "t1",
  clientId: null,
  facts: {},
  createdAt: new Date("2026-11-25T07:00:00Z"),
  clearedAt: cleared ? new Date("2026-11-26T07:00:00Z") : null,
})

describe("birthdayInYear", () => {
  it("keeps the day; 29 Feb → 28 Feb in a non-leap year", () => {
    expect(birthdayInYear("1980-11-26", 2026)).toBe("2026-11-26")
    expect(birthdayInYear("1980-02-29", 2026)).toBe("2026-02-28")
    expect(birthdayInYear("1980-02-29", 2028)).toBe("2028-02-29")
  })
})

describe("checkContactBirthday", () => {
  it("finds today's birthdays only, one key per contact and year, with the age", () => {
    const r = checkContactBirthday([c("a", "1981-11-26"), c("b", "1990-11-27"), c("x", "1976-11-26", null)], {
      today: "2026-11-26",
      existing: [],
    })
    expect(r.findings.map((f) => f.conditionKey)).toEqual(["contact:a:birthday:2026", "contact:x:birthday:2026"])
    const a = r.findings[0]
    expect(a).toMatchObject({ code: "CONTACT_BIRTHDAY", contactId: "a", clientId: "cl-a", companyName: "Вектор", topicId: null })
    expect(a.matterRu).toBe("День рождения: Контакт a")
    expect(a.evidenceRu).toBe("Контакт a: день рождения сегодня (26.11); исполняется 45 лет")
    // No company → the contact's name is the counterparty; 50 = юбилей.
    expect(r.findings[1].companyName).toBe("Контакт x")
    expect(r.findings[1].evidenceRu).toContain("исполняется 50 лет (юбилей)")
    expect(r.clears).toEqual([])
  })
  it("clears open instances of other days, keeps today's and cleared ones", () => {
    const r = checkContactBirthday([c("a", "1981-11-26")], {
      today: "2026-11-26",
      existing: [inst("contact:a:birthday:2026"), inst("contact:b:birthday:2026"), inst("contact:z:birthday:2025", true)],
    })
    expect(r.clears).toEqual([{ instanceId: "i-contact:b:birthday:2026", reasonRu: "День рождения прошёл" }])
  })
  it("Russian year forms", () => {
    const age = (b: string) => checkContactBirthday([c("a", b)], { today: "2026-11-26", existing: [] }).findings[0].evidenceRu
    expect(age("2005-11-26")).toContain("21 год")
    expect(age("2004-11-26")).toContain("22 года")
    expect(age("2015-11-26")).toContain("11 лет")
  })
})

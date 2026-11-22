import { describe, expect, it } from "vitest"
import { hasNonLatinLetter, pickNativeName, rankDomainMatches } from "./discovery-pick"

describe("pickNativeName", () => {
  it("prefers a Cyrillic spelling over a longer Latin one", () => {
    const votes = new Map([
      ["Евгения Кондрашева", 9],
      ["Evgenia Kondrasheva", 1],
    ])
    expect(pickNativeName(votes)).toBe("Евгения Кондрашева")
  })
  it("among the same script: the most frequent, then the longer", () => {
    expect(pickNativeName(new Map([["Аня", 1], ["Анна Чехомова", 1]]))).toBe("Анна Чехомова")
    expect(pickNativeName(new Map([["Анна", 3], ["Анна Чехомова", 1]]))).toBe("Анна")
  })
  it("keeps a Latin-only name when there is nothing else", () => {
    expect(pickNativeName(new Map([["Anna Chekhomova", 2]]))).toBe("Anna Chekhomova")
    expect(pickNativeName(new Map())).toBeNull()
  })
  it("detects non-Latin letters", () => {
    expect(hasNonLatinLetter("Anna")).toBe(false)
    expect(hasNonLatinLetter("Анна")).toBe(true)
    expect(hasNonLatinLetter("мaslov")).toBe(true)
  })
})

describe("rankDomainMatches", () => {
  const existing = { existing: true, domain: "maslov.agency", name: "maslov.agency" }
  const junk = { existing: false, domain: "maslov.agency", name: "Google Calendar" }
  const dup = { existing: false, domain: "maslov.agency", name: "maslov:agency" }
  it("an existing company wins over new candidates on the same domain", () => {
    expect(rankDomainMatches("maslov.agency", [junk, existing, dup])).toEqual([existing])
  })
  it("without an existing company: exact domain first, then the name", () => {
    const parent = { existing: false, domain: "acme.com", name: "Acme" }
    const exact = { existing: false, domain: "mail.acme.com", name: "Zeta" }
    expect(rankDomainMatches("mail.acme.com", [parent, exact]).map((m) => m.name)).toEqual(["Zeta", "Acme"])
  })
})

describe("pickDisplayName", () => {
  it("most frequent real name; never the address", async () => {
    const { pickDisplayName } = await import("./discovery-pick")
    expect(pickDisplayName(new Map([["Anna Chekhomova", 8], ["Аня", 1]]))).toBe("Anna Chekhomova")
    expect(pickDisplayName(new Map([["a@x.ru", 5], ["Anna", 1]]), "a@x.ru")).toBe("Anna")
    expect(pickDisplayName(new Map([["(unknown)", 2]]))).toBeNull()
  })
})

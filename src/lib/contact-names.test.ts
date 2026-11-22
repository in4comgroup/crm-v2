import { describe, expect, it } from "vitest"
import {
  contactDisplayName,
  manualContactNames,
  namesFromManualEdit,
  namesFromSource,
  sourceContactNames,
} from "./contact-names"

describe("contactDisplayName", () => {
  it("shows the native name, else the system name", () => {
    expect(contactDisplayName({ name: "Evgenia Kondrasheva", nameNative: "Евгения Кондрашева" })).toBe("Евгения Кондрашева")
    expect(contactDisplayName({ name: "Anna", nameNative: " " })).toBe("Anna")
    expect(contactDisplayName({ name: "Anna", nameNative: null })).toBe("Anna")
  })
})

describe("rule 1 — a contact from a source", () => {
  it("only the account name → both names the same", () => {
    expect(sourceContactNames({ displayName: "Anna Chekhomova", email: "a@m.agency" })).toEqual({
      name: "Anna Chekhomova",
      nameNative: "Anna Chekhomova",
      nameNativeSource: "source",
    })
  })
  it("a signature name → native name as found", () => {
    expect(sourceContactNames({ displayName: "Evgenia Kondrasheva", signatureName: "Евгения Кондрашева" })).toMatchObject({
      name: "Evgenia Kondrasheva",
      nameNative: "Евгения Кондрашева",
    })
  })
  it("no display name → the address in both", () => {
    expect(sourceContactNames({ email: "margo@x.com" })).toMatchObject({ name: "margo@x.com", nameNative: "margo@x.com" })
  })
})

describe("rule 2 — a contact a person creates", () => {
  it("only the native name; the system name is its copy", () => {
    expect(manualContactNames("Анна Чехомова")).toEqual({ name: "Анна Чехомова", nameNative: "Анна Чехомова", nameNativeSource: "manual" })
  })
  it("later the source replaces the copied system name, never the native name", () => {
    const manual = { name: "Анна Чехомова", nameNative: "Анна Чехомова", nameNativeSource: "manual", email: "a@m.agency" }
    expect(namesFromSource(manual, { displayName: "Anna Chekhomova", signatureName: "Аня Ч." })).toEqual({ name: "Anna Chekhomova" })
  })
})

describe("namesFromSource — existing contacts", () => {
  it("a source native name takes the signature name", () => {
    const c = { name: "Evgenia Kondrasheva", nameNative: "Evgenia Kondrasheva", nameNativeSource: "source" }
    expect(namesFromSource(c, { displayName: "Evgenia Kondrasheva", signatureName: "Евгения Кондрашева" })).toEqual({
      nameNative: "Евгения Кондрашева",
    })
  })
  it("a system name from a source that differs from the native name stays", () => {
    const c = { name: "Evgenia Kondrasheva", nameNative: "Евгения Кондрашева", nameNativeSource: "source" }
    expect(namesFromSource(c, { displayName: "E. Kondrasheva" })).toEqual({})
  })
  it("a placeholder system name is replaced; a copied source native name follows it", () => {
    const c = { name: "margo@x.com", nameNative: "margo@x.com", nameNativeSource: "source", email: "margo@x.com" }
    expect(namesFromSource(c, { displayName: "Margarita A." })).toEqual({ name: "Margarita A.", nameNative: "Margarita A." })
  })
  it("never takes an address as the system name", () => {
    const c = { name: "Anna", nameNative: "Anna", nameNativeSource: "source" }
    expect(namesFromSource(c, { displayName: "anna@x.com" })).toEqual({})
  })
})

describe("namesFromManualEdit", () => {
  it("the system name follows while it was the copy", () => {
    expect(namesFromManualEdit({ name: "Анна", nameNative: "Анна" }, "Анна Чехомова")).toEqual({
      name: "Анна Чехомова",
      nameNative: "Анна Чехомова",
      nameNativeSource: "manual",
    })
  })
  it("a system name from a source stays", () => {
    expect(namesFromManualEdit({ name: "Anna Chekhomova", nameNative: "Аня" }, "Анна Чехомова")).toEqual({
      nameNative: "Анна Чехомова",
      nameNativeSource: "manual",
    })
  })
})

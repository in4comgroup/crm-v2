import { describe, expect, it } from "vitest"
import {
  normaliseReferenceValue,
  normaliseReferences,
  referencesConflict,
  sharesReference,
  shortCompanyName,
  buildTopicTitle,
} from "@/lib/topics/references"
import { buildCounterpartyIndex, resolveCounterparty } from "./counterparty"

const idx = buildCounterpartyIndex(
  [
    { id: "c-acme", name: "Acme – Trading Company", aliases: ["Акме"], webUrl: "https://www.acme.example", email: null },
    { id: "c-norlex", name: "ООО «Норлекс»", aliases: null, webUrl: null, email: "info@norlex.example" },
    { id: "c-dup1", name: "Квант-Сервис", aliases: null, webUrl: null, email: null },
    { id: "c-dup2", name: "Kvant-Servis", aliases: null, webUrl: null, email: null },
  ],
  [
    { id: "p-anna", name: "Anna Sidorova", nameNative: "Анна Сидорова", aliases: null, email: "anna@acme.example", clientId: "c-acme" },
    { id: "p-ivan", name: "Иван Петров", nameNative: null, aliases: ["@ivan_buyer"], email: null, clientId: null },
    { id: "p-gmail", name: "Олег", nameNative: null, aliases: null, email: "oleg@gmail.com", clientId: null },
  ],
)

describe("counterparty resolution (spec §6.2 step 1)", () => {
  it("client by name across scripts and legal forms", () => {
    expect(resolveCounterparty("ООО Акме", null, idx)).toMatchObject({ clientId: "c-acme", contactId: null })
    expect(resolveCounterparty("Норлекс", null, idx).clientId).toBe("c-norlex")
  })

  it("ambiguous name → not resolved", () => {
    expect(resolveCounterparty("Квант-Сервис", null, idx).clientId).toBeNull()
  })

  it("Telegram: the contact of the ONE rule (peer.contactId) wins over the name / handle (telegram/04 §8.3)", () => {
    const r = resolveCounterparty("какая-то фирма", { email: null, name: "Иван Петров", handle: "someone_else", contactId: "p-anna" }, idx)
    expect(r).toMatchObject({ clientId: "c-acme", contactId: "p-anna" })
    expect(r.via).toContain("peer_contact")
    // An unknown id (deleted contact) → the old matching.
    expect(resolveCounterparty("", { email: null, name: null, handle: "ivan_buyer", contactId: "p-gone" }, idx).contactId).toBe("p-ivan")
  })

  it("unknown string + known sender email → the sender's contact and client", () => {
    const r = resolveCounterparty("какая-то фирма", { email: "anna@acme.example", name: "Anna", handle: null }, idx)
    expect(r).toMatchObject({ clientId: "c-acme", contactId: "p-anna" })
  })

  it("named client + peer of that client → contact added", () => {
    expect(resolveCounterparty("Acme", { email: "anna@acme.example", name: null, handle: null }, idx)).toMatchObject({
      clientId: "c-acme",
      contactId: "p-anna",
    })
  })

  it("named client + peer of ANOTHER company → no contact", () => {
    expect(resolveCounterparty("Норлекс", { email: "anna@acme.example", name: null, handle: null }, idx)).toMatchObject({
      clientId: "c-norlex",
      contactId: null,
    })
  })

  it("sender domain → client when no contact matches", () => {
    expect(resolveCounterparty("", { email: "new.person@acme.example", name: null, handle: null }, idx)).toMatchObject({
      clientId: "c-acme",
      contactId: null,
    })
  })

  it("free-mail domain never links a client", () => {
    expect(resolveCounterparty("", { email: "someone@gmail.com", name: null, handle: null }, idx).clientId).toBeNull()
  })

  it("Telegram handle → contact only (R14)", () => {
    expect(resolveCounterparty("Иван", { email: null, name: "Ivan", handle: "ivan_buyer" }, idx)).toMatchObject({
      clientId: null,
      contactId: "p-ivan",
    })
  })

  it("person name in the subject (native script) → contact + its client", () => {
    expect(resolveCounterparty("Сидорова Анна", null, idx)).toMatchObject({ clientId: "c-acme", contactId: "p-anna" })
  })

  it("nothing known → nulls, raw key kept", () => {
    const r = resolveCounterparty("Неизвестная Компания", null, idx)
    expect(r).toMatchObject({ clientId: null, contactId: null })
    expect(r.key).not.toBe("")
  })
})

describe("references and titles", () => {
  it("normalises reference numbers", () => {
    expect(normaliseReferenceValue("№124")).toBe("124")
    expect(normaliseReferenceValue("счёт 124")).toBe("124")
    expect(normaliseReferenceValue("Счет № 0124")).toBe("124")
    expect(normaliseReferenceValue("УПД 4512")).toBe("4512")
    expect(normaliseReferenceValue("INV-2024/0012")).toBe("inv20240012")
    expect(normaliseReferenceValue("Договор поставки")).toBe("dogovorpostavki")
    expect(normaliseReferenceValue("  ")).toBe("")
  })

  it("shares / conflicts by kind + value", () => {
    const a = normaliseReferences([{ kind: "invoice", value: "124" }])
    const b = normaliseReferences([{ kind: "invoice", value: "№ 124" }])
    const c = normaliseReferences([{ kind: "invoice", value: "125" }])
    const d = normaliseReferences([{ kind: "order", value: "9" }])
    expect(sharesReference(a, b)).toBe(true)
    expect(referencesConflict(a, c)).toBe(true)
    expect(referencesConflict(a, d)).toBe(false)
    expect(referencesConflict(a, [])).toBe(false)
  })

  it("short company name strips legal forms and quotes", () => {
    expect(shortCompanyName("ООО «Норлекс»")).toBe("Норлекс")
    expect(shortCompanyName('АО "Квант-Сервис"')).toBe("Квант-Сервис")
    expect(shortCompanyName("Globex GmbH")).toBe("Globex")
    expect(shortCompanyName("ИП Иванов")).toBe("Иванов")
  })

  it("title: company — matter; contact-only; no counterparty", () => {
    expect(buildTopicTitle({ companyName: "ООО «Норлекс»", matter: "счёт 124 за октябрь" })).toBe("Норлекс — счёт 124 за октябрь")
    expect(buildTopicTitle({ contactName: "Иван Петров", matter: "прайс" })).toBe("Иван Петров — прайс")
    expect(buildTopicTitle({ matter: "заказ" })).toBe("заказ")
    expect(buildTopicTitle({ counterpartyRaw: "ООО Альфа", matter: "" })).toBe("Альфа — без темы")
  })
})

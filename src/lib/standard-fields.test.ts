import { describe, expect, it } from "vitest"
import {
  CLIENT_STANDARD_FIELDS,
  CONTACT_STANDARD_FIELDS,
  formatStandardValue,
  validateStandardPatch,
  validateStandardValue,
  type StandardFieldDef,
} from "./standard-fields"

const f = (key: string): StandardFieldDef =>
  [...CLIENT_STANDARD_FIELDS, ...CONTACT_STANDARD_FIELDS].find((d) => d.key === key) as StandardFieldDef

describe("validateStandardValue", () => {
  it("empty clears", () => {
    for (const d of [...CLIENT_STANDARD_FIELDS, ...CONTACT_STANDARD_FIELDS]) {
      expect(validateStandardValue(d, "  ")).toEqual({ ok: true, value: null })
      expect(validateStandardValue(d, null)).toEqual({ ok: true, value: null })
    }
  })
  it("ИНН: 10 or 12 digits, spaces dropped", () => {
    expect(validateStandardValue(f("inn"), "7727 350057")).toEqual({ ok: true, value: "7727350057" })
    expect(validateStandardValue(f("inn"), "772735005712")).toEqual({ ok: true, value: "772735005712" })
    expect(validateStandardValue(f("inn"), "77273500571").ok).toBe(false)
    expect(validateStandardValue(f("inn"), "77273500A7").ok).toBe(false)
  })
  it("КПП: 9 chars, letters only in positions 5–6, upper-cased", () => {
    expect(validateStandardValue(f("kpp"), "7727 01 001")).toEqual({ ok: true, value: "772701001" })
    expect(validateStandardValue(f("kpp"), "7727ab001")).toEqual({ ok: true, value: "7727AB001" })
    expect(validateStandardValue(f("kpp"), "772A01001").ok).toBe(false)
    expect(validateStandardValue(f("kpp"), "77270100").ok).toBe(false)
  })
  it("ОГРН: 13 or 15 digits", () => {
    expect(validateStandardValue(f("ogrn"), "1027700132195").ok).toBe(true)
    expect(validateStandardValue(f("ogrn"), "304500116000157").ok).toBe(true)
    expect(validateStandardValue(f("ogrn"), "10277001321").ok).toBe(false)
  })
  it("accounts: 20 digits in groups of 4; БИК 9 digits", () => {
    expect(validateStandardValue(f("bankAccount"), "4070 2810 9000 0000 1234")).toEqual({
      ok: true,
      value: "40702810900000001234",
    })
    expect(validateStandardValue(f("bankCorrAccount"), "3010181040000000022").ok).toBe(false)
    expect(validateStandardValue(f("bankBik"), "044525225").ok).toBe(true)
    expect(validateStandardValue(f("bankBik"), "04452522").ok).toBe(false)
  })
  it("text collapses spaces; limits", () => {
    expect(validateStandardValue(f("legalName"), "  ООО   «Ромашка» ")).toEqual({ ok: true, value: "ООО «Ромашка»" })
    expect(validateStandardValue(f("legalName"), "x".repeat(501)).ok).toBe(false)
    expect(validateStandardValue(f("legalAddress"), "a\nb ")).toEqual({ ok: true, value: "a\nb" })
  })
  it("birthday: valid past date only", () => {
    expect(validateStandardValue(f("birthday"), "1985-02-28", "2026-11-26")).toEqual({ ok: true, value: "1985-02-28" })
    expect(validateStandardValue(f("birthday"), "1985-02-30", "2026-11-26").ok).toBe(false)
    expect(validateStandardValue(f("birthday"), "2027-01-01", "2026-11-26").ok).toBe(false)
    expect(validateStandardValue(f("birthday"), "1899-12-31", "2026-11-26").ok).toBe(false)
  })
  it("non-string is an error", () => {
    expect(validateStandardValue(f("inn"), 7727350057).ok).toBe(false)
  })
})

describe("formatStandardValue", () => {
  it("groups accounts by 4 and shows dates as DD.MM.YYYY", () => {
    expect(formatStandardValue(f("bankAccount"), "40702810900000001234")).toBe("4070 2810 9000 0000 1234")
    expect(formatStandardValue(f("inn"), "7727350057")).toBe("7727350057")
    expect(formatStandardValue(f("birthday"), "1985-02-28")).toBe("28.02.1985")
    expect(formatStandardValue(f("inn"), null)).toBe("")
  })
})

describe("validateStandardPatch", () => {
  it("collects errors per key and rejects unknown keys", () => {
    expect(validateStandardPatch("client", { inn: "123", foo: "x" })).toEqual({
      ok: false,
      errors: { inn: expect.stringContaining("ИНН") as unknown as string, foo: "Неизвестное поле «foo»" },
    })
    expect(validateStandardPatch("contact", { birthday: "" })).toEqual({ ok: true, values: { birthday: null } })
    expect(validateStandardPatch("contact", { inn: "7727350057" }).ok).toBe(false)
  })
})

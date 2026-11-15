import { describe, expect, it } from "vitest"
import {
  convertValueForType,
  customFieldInputSchema,
  customValuesText,
  formatCustomValue,
  isAllowedTypeChange,
  validateCustomValue,
  type CustomFieldDef,
} from "./custom-fields"

const def = (type: CustomFieldDef["type"], config: CustomFieldDef["config"] = {}, extra: Partial<CustomFieldDef> = {}): CustomFieldDef => ({
  id: "f1",
  entity: "client",
  label: "Поле",
  type,
  config,
  helpText: null,
  section: null,
  isShown: true,
  showInList: false,
  position: 0,
  archivedAt: null,
  ...extra,
})

const opts = { options: [{ id: "a", label: "Первый" }, { id: "b", label: "Второй" }, { id: "x", label: "Старый", archived: true }] }

describe("validateCustomValue", () => {
  it("empty values clear the field", () => {
    for (const t of ["text", "number", "date", "select", "multiselect", "url"] as const) {
      expect(validateCustomValue(def(t, opts), "")).toEqual({ ok: true, value: null })
      expect(validateCustomValue(def(t, opts), null)).toEqual({ ok: true, value: null })
    }
    expect(validateCustomValue(def("multiselect", opts), [])).toEqual({ ok: true, value: null })
  })
  it("text: trims, single line collapses spaces, limits", () => {
    expect(validateCustomValue(def("text"), "  a   b ")).toEqual({ ok: true, value: "a b" })
    expect(validateCustomValue(def("text", { multiline: true }), "a\n\nb ")).toEqual({ ok: true, value: "a\n\nb" })
    expect(validateCustomValue(def("text"), "x".repeat(1001)).ok).toBe(false)
  })
  it("number and currency", () => {
    expect(validateCustomValue(def("number", { decimals: 0 }), "1 234,6")).toEqual({ ok: true, value: 1235 })
    expect(validateCustomValue(def("number"), "abc").ok).toBe(false)
    expect(validateCustomValue(def("currency", { currency: "EUR" }), { amount: "10,5" })).toEqual({
      ok: true,
      value: { amount: 10.5, currency: "EUR" },
    })
    expect(validateCustomValue(def("currency"), { amount: 1, currency: "XXX" }).ok).toBe(false)
  })
  it("date", () => {
    expect(validateCustomValue(def("date"), "2026-02-28").ok).toBe(true)
    expect(validateCustomValue(def("date"), "2026-02-30").ok).toBe(false)
  })
  it("select: active options only, an archived one only as the stored value", () => {
    expect(validateCustomValue(def("select", opts), "a")).toEqual({ ok: true, value: "a" })
    expect(validateCustomValue(def("select", opts), "x").ok).toBe(false)
    expect(validateCustomValue(def("select", opts), "x", "x")).toEqual({ ok: true, value: "x" })
    expect(validateCustomValue(def("select", opts), "zzz").ok).toBe(false)
  })
  it("multiselect: dedupes and keeps the option order", () => {
    expect(validateCustomValue(def("multiselect", opts), ["b", "a", "b"])).toEqual({ ok: true, value: ["a", "b"] })
  })
  it("boolean, url, email, phone", () => {
    expect(validateCustomValue(def("boolean"), false)).toEqual({ ok: true, value: false })
    expect(validateCustomValue(def("url"), "example.com/x")).toEqual({ ok: true, value: "https://example.com/x" })
    expect(validateCustomValue(def("url"), "not a url").ok).toBe(false)
    expect(validateCustomValue(def("email"), " A@Example.com ")).toEqual({ ok: true, value: "a@example.com" })
    expect(validateCustomValue(def("email"), "a@b").ok).toBe(false)
    expect(validateCustomValue(def("phone"), "+7 900 000-00-01").ok).toBe(true)
    expect(validateCustomValue(def("phone"), "call me").ok).toBe(false)
  })
})

describe("definitions", () => {
  it("select needs an active option; duplicate labels refused", () => {
    expect(customFieldInputSchema.safeParse({ entity: "client", label: "Л", type: "select", config: { options: [] } }).success).toBe(false)
    expect(
      customFieldInputSchema.safeParse({
        entity: "client",
        label: "Л",
        type: "select",
        config: { options: [{ id: "1", label: "А" }, { id: "2", label: "а" }] },
      }).success,
    ).toBe(false)
    expect(customFieldInputSchema.safeParse({ entity: "contact", label: "Л", type: "text" }).success).toBe(true)
  })
  it("type changes", () => {
    expect(isAllowedTypeChange("select", "multiselect")).toBe(true)
    expect(isAllowedTypeChange("multiselect", "select")).toBe(false)
    expect(isAllowedTypeChange("text", "number")).toBe(false)
    expect(convertValueForType("a", "select", "multiselect")).toEqual(["a"])
  })
})

describe("display + AI text", () => {
  it("formats values", () => {
    expect(formatCustomValue(def("boolean"), true)).toBe("Да")
    expect(formatCustomValue(def("select", opts), "x")).toBe("Старый (удалён)")
    expect(formatCustomValue(def("multiselect", opts), ["a", "b"])).toBe("Первый, Второй")
    expect(formatCustomValue(def("date"), "2026-11-15")).toMatch(/2026/)
  })
  it("AI text: shown, non-archived, with value, in order, capped", () => {
    const defs = [
      def("text", {}, { id: "t", label: "Б", position: 2 }),
      def("text", {}, { id: "h", label: "Скрытое", position: 0, isShown: false }),
      def("text", {}, { id: "a", label: "А", position: 1 }),
      def("text", {}, { id: "z", label: "Архив", position: 3, archivedAt: "2026-01-01T00:00:00Z" }),
    ]
    const values = { t: "два", h: "секрет", a: "один", z: "старое" }
    expect(customValuesText(defs, values)).toBe("А: один\nБ: два")
    expect(customValuesText(defs, values, 8)).toBe("А: один")
    expect(customValuesText(defs, {})).toBe("")
  })
})

describe("list filters", async () => {
  const { parseCustomFilters, matchesCustomFilters, filterOpsFor, encodeCustomFilters } = await import("./custom-fields")
  const defs = [
    def("text", {}, { id: "t" }),
    def("select", opts, { id: "s" }),
    def("multiselect", opts, { id: "m" }),
    def("boolean", {}, { id: "b" }),
    def("number", {}, { id: "n" }),
    def("currency", { currency: "EUR" }, { id: "c" }),
    def("date", {}, { id: "d" }),
    def("text", {}, { id: "hidden", isShown: false }),
  ]
  it("parses, drops unknown / hidden / bad ops / empty values", () => {
    const raw = encodeCustomFilters([
      { fieldId: "t", op: "contains", value: " abc " },
      { fieldId: "s", op: "in", value: ["a", "zzz"] },
      { fieldId: "hidden", op: "filled" },
      { fieldId: "nope", op: "filled" },
      { fieldId: "n", op: "contains", value: "1" },
      { fieldId: "m", op: "any", value: [] },
      { fieldId: "n", op: "range", value: { from: "1,5", to: null } },
    ] as never)
    expect(parseCustomFilters(raw, defs)).toEqual([
      { fieldId: "t", op: "contains", value: "abc" },
      { fieldId: "s", op: "in", value: ["a"] },
      { fieldId: "n", op: "range", value: { from: 1.5, to: null } },
    ])
    expect(parseCustomFilters("not json", defs)).toEqual([])
    expect(filterOpsFor("date")).toContain("range")
  })
  it("matches every op (AND)", () => {
    const row = { t: "Hello World", s: "a", m: ["b"], b: false, n: 10, c: { amount: 500, currency: "EUR" }, d: "2026-05-01" }
    const m = (f: unknown[]) => matchesCustomFilters(row, f as never, defs)
    expect(m([{ fieldId: "t", op: "contains", value: "world" }])).toBe(true)
    expect(m([{ fieldId: "s", op: "in", value: ["b"] }])).toBe(false)
    expect(m([{ fieldId: "m", op: "any", value: ["a", "b"] }])).toBe(true)
    expect(m([{ fieldId: "b", op: "is", value: false }])).toBe(true)
    expect(m([{ fieldId: "n", op: "range", value: { from: 5, to: 10 } }])).toBe(true)
    expect(m([{ fieldId: "c", op: "range", value: { from: 600 } }])).toBe(false)
    expect(m([{ fieldId: "d", op: "range", value: { from: "2026-01-01", to: "2026-04-30" } }])).toBe(false)
    expect(m([{ fieldId: "t", op: "filled" }, { fieldId: "x", op: "empty" }])).toBe(true)
    expect(matchesCustomFilters({}, [{ fieldId: "t", op: "filled" }], defs)).toBe(false)
  })
})

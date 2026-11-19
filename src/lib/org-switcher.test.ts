import { describe, expect, it } from "vitest"
import { activeOrgSessionFields, sortOrgOptions } from "./org-switcher"

describe("sortOrgOptions", () => {
  it("sorts by name with Russian collation (Cyrillic before Latin), case-insensitive", () => {
    const sorted = sortOrgOptions([
      { id: "3", name: "Яблоко" },
      { id: "1", name: "альфа" },
      { id: "2", name: "Бета" },
      { id: "4", name: "Acme" },
    ])
    expect(sorted.map((o) => o.name)).toEqual(["альфа", "Бета", "Яблоко", "Acme"])
  })

  it("breaks name ties by id and does not mutate the input", () => {
    const input = [
      { id: "b", name: "Моя организация" },
      { id: "a", name: "моя организация" },
    ]
    const sorted = sortOrgOptions(input)
    expect(sorted.map((o) => o.id)).toEqual(["a", "b"])
    expect(input.map((o) => o.id)).toEqual(["b", "a"])
  })
})

describe("activeOrgSessionFields", () => {
  it("copies name and slug of the new org", () => {
    expect(activeOrgSessionFields({ name: "Ромашка", slug: "romashka" })).toEqual({
      activeOrganizationName: "Ромашка",
      activeOrganizationSlug: "romashka",
    })
  })

  it("clears both when the org is unset or missing", () => {
    expect(activeOrgSessionFields(null)).toEqual({
      activeOrganizationName: null,
      activeOrganizationSlug: null,
    })
  })
})

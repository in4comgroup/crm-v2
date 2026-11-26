import { describe, expect, it } from "vitest"
import { statusAfterPersonSave } from "./entity-status"

describe("statusAfterPersonSave", () => {
  it("a person's save confirms an automatic record", () => {
    expect(statusAfterPersonSave("initial", undefined)).toBe("active")
    expect(statusAfterPersonSave("initial", "initial")).toBe("active")
  })
  it("an explicit other status wins", () => {
    expect(statusAfterPersonSave("initial", "deleted")).toBe("deleted")
    expect(statusAfterPersonSave("initial", "suspended")).toBe("suspended")
    expect(statusAfterPersonSave("active", "initial")).toBe("initial")
  })
  it("other statuses are never changed by a save", () => {
    expect(statusAfterPersonSave("suspended", undefined)).toBeUndefined()
    expect(statusAfterPersonSave("suspended", "suspended")).toBe("suspended")
    expect(statusAfterPersonSave("blocked", undefined)).toBeUndefined()
    expect(statusAfterPersonSave("deleted", "deleted")).toBe("deleted")
  })
})

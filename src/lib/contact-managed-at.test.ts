import { describe, expect, it } from "vitest"
import {
  contactManagedAtInputSchema,
  managedAtColumns,
  managedAtLabel,
  readManagedAt,
  sameManagedAt,
} from "./contact-managed-at"

const EMPTY = { managedAtUserId: null, managedAtPersonName: null, managedAtPersonPosition: null }

describe("contact «Ведётся на уровне»", () => {
  it("validates the input", () => {
    expect(contactManagedAtInputSchema.safeParse(null).success).toBe(true)
    expect(contactManagedAtInputSchema.safeParse({ kind: "member", userId: "u1" }).success).toBe(true)
    expect(contactManagedAtInputSchema.safeParse({ kind: "member", userId: " " }).success).toBe(false)
    expect(contactManagedAtInputSchema.safeParse({ kind: "person", name: "  " }).success).toBe(false)
    expect(contactManagedAtInputSchema.safeParse({ kind: "person", name: "x".repeat(121) }).success).toBe(false)
    expect(contactManagedAtInputSchema.safeParse({ kind: "other" }).success).toBe(false)
  })

  it("trims a person and turns an empty position into null", () => {
    const r = contactManagedAtInputSchema.parse({ kind: "person", name: " Иван Петров ", position: "  " })
    expect(r).toEqual({ kind: "person", name: "Иван Петров", position: null })
  })

  it("maps to columns: one kind only", () => {
    expect(managedAtColumns(null)).toEqual(EMPTY)
    expect(managedAtColumns({ kind: "member", userId: "u1" })).toEqual({ ...EMPTY, managedAtUserId: "u1" })
    expect(managedAtColumns({ kind: "person", name: "Иван", position: "CEO" })).toEqual({
      ...EMPTY,
      managedAtPersonName: "Иван",
      managedAtPersonPosition: "CEO",
    })
  })

  it("compares stored values", () => {
    const a = managedAtColumns({ kind: "person", name: "Иван", position: "CEO" })
    expect(sameManagedAt(a, { ...a })).toBe(true)
    expect(sameManagedAt(a, { ...a, managedAtPersonPosition: null })).toBe(false)
    expect(sameManagedAt(EMPTY, managedAtColumns({ kind: "member", userId: "u1" }))).toBe(false)
  })

  it("reads and labels the display value", () => {
    expect(readManagedAt(EMPTY, null)).toBeNull()
    const m = readManagedAt({ ...EMPTY, managedAtUserId: "u1" }, { name: "Анна", isMember: true })
    expect(managedAtLabel(m)).toBe("Анна")
    const gone = readManagedAt({ ...EMPTY, managedAtUserId: "u1" }, { name: "Анна", isMember: false })
    expect(managedAtLabel(gone)).toBe("Анна (не в организации)")
    const p = readManagedAt({ ...EMPTY, managedAtPersonName: "Иван", managedAtPersonPosition: "генеральный директор" }, null)
    expect(managedAtLabel(p)).toBe("Иван, генеральный директор")
    expect(managedAtLabel(null)).toBe("")
  })
})

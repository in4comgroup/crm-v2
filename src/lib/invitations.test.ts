import { describe, expect, it } from "vitest"
import { isInvitationExpired, selectPendingInvitations } from "./invitations"
import {
  ASSIGNABLE_ORG_ROLES,
  isAssignableOrgRole,
  orgRoleLabel,
} from "./org-roles"

describe("isInvitationExpired", () => {
  const now = new Date("2026-11-19T12:00:00Z")
  it("is false before the expiry moment", () => {
    expect(isInvitationExpired("2026-11-20T12:00:00Z", now)).toBe(false)
  })
  it("is true at and after the expiry moment", () => {
    expect(isInvitationExpired("2026-11-19T12:00:00Z", now)).toBe(true)
    expect(isInvitationExpired(new Date("2026-11-01T00:00:00Z"), now)).toBe(true)
  })
  it("treats an unreadable date as not expired", () => {
    expect(isInvitationExpired("not a date", now)).toBe(false)
  })
})

describe("selectPendingInvitations", () => {
  const now = new Date("2026-11-19T12:00:00Z")
  const live = "2026-11-25T00:00:00Z"
  const past = "2026-11-10T00:00:00Z"
  it("keeps only pending rows, newest first", () => {
    const rows = [
      { id: "a", email: "a@x.ru", status: "pending", createdAt: "2026-11-01T00:00:00Z", expiresAt: live },
      { id: "b", email: "b@x.ru", status: "accepted", createdAt: "2026-11-02T00:00:00Z", expiresAt: live },
      { id: "c", email: "c@x.ru", status: "canceled", createdAt: "2026-11-03T00:00:00Z", expiresAt: live },
      { id: "d", email: "d@x.ru", status: "rejected", createdAt: "2026-11-04T00:00:00Z", expiresAt: live },
      { id: "e", email: "e@x.ru", status: "pending", createdAt: "2026-11-05T00:00:00Z", expiresAt: past },
    ]
    expect(selectPendingInvitations(rows, now).map((r) => r.id)).toEqual(["e", "a"])
  })
  it("hides an expired row when the same e-mail has a newer pending one", () => {
    const rows = [
      { id: "old", email: "A@x.ru", status: "pending", createdAt: "2026-11-01T00:00:00Z", expiresAt: past },
      { id: "new", email: "a@x.ru", status: "pending", createdAt: "2026-11-18T00:00:00Z", expiresAt: live },
    ]
    expect(selectPendingInvitations(rows, now).map((r) => r.id)).toEqual(["new"])
  })
  it("keeps a live older row next to a newer one of the same e-mail", () => {
    const rows = [
      { id: "old", email: "a@x.ru", status: "pending", createdAt: "2026-11-01T00:00:00Z", expiresAt: live },
      { id: "new", email: "a@x.ru", status: "pending", createdAt: "2026-11-18T00:00:00Z", expiresAt: live },
    ]
    expect(selectPendingInvitations(rows, now).map((r) => r.id)).toEqual(["new", "old"])
  })
  it("does not change the input array", () => {
    const rows = [
      { id: "a", email: "a@x.ru", status: "pending", createdAt: "2026-11-01T00:00:00Z", expiresAt: live },
      { id: "b", email: "b@x.ru", status: "pending", createdAt: "2026-11-02T00:00:00Z", expiresAt: live },
    ]
    selectPendingInvitations(rows, now)
    expect(rows.map((r) => r.id)).toEqual(["a", "b"])
  })
})

describe("org roles", () => {
  it("offers only owner and member", () => {
    expect([...ASSIGNABLE_ORG_ROLES]).toEqual(["owner", "member"])
    expect(isAssignableOrgRole("admin")).toBe(false)
    expect(isAssignableOrgRole("owner")).toBe(true)
    expect(isAssignableOrgRole(null)).toBe(false)
  })
  it("still labels the legacy admin role", () => {
    expect(orgRoleLabel("admin")).toBe("Администратор")
    expect(orgRoleLabel("member")).toBe("Участник")
    expect(orgRoleLabel(null)).toBe("Участник")
    expect(orgRoleLabel("custom")).toBe("custom")
  })
})

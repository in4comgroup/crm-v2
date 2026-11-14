import { describe, expect, it } from "vitest"
import {
  checkResponsibleChange,
  matchesResponsibleFilter,
  normalizeHandoverReason,
  readHandoverNote,
  responsibleMode,
  type ResponsibleMember,
} from "./client-responsible"

const m = (userId: string, role: string, banned = false): ResponsibleMember => ({
  userId,
  role,
  name: userId,
  email: null,
  banned,
})

const members = [m("own1", "owner"), m("adm", "admin"), m("mem", "member"), m("ban", "member", true)]
const owner = { userId: "own1", role: "owner" }
const mem = { userId: "mem", role: "member" }
const adm = { userId: "adm", role: "admin" }

describe("checkResponsibleChange — assign", () => {
  it("owner assigns any human, not banned member incl. self", () => {
    for (const t of ["own1", "adm", "mem"]) {
      expect(checkResponsibleChange(owner, { responsibleUserId: "mem" }, { kind: "assign", targetUserId: t }, members)).toEqual({ ok: true, targetUserId: t })
    }
  })
  it("owner cannot assign a banned user, a non-member or the agent", () => {
    for (const t of ["ban", "stranger", "agent-org"]) {
      const r = checkResponsibleChange(owner, { responsibleUserId: "mem" }, { kind: "assign", targetUserId: t }, members)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.status).toBe(400)
    }
  })
  it("non-owners (incl. admin and the responsible member) cannot assign", () => {
    for (const a of [mem, adm]) {
      const r = checkResponsibleChange(a, { responsibleUserId: a.userId }, { kind: "assign", targetUserId: "own1" }, members)
      expect(r).toMatchObject({ ok: false, status: 403 })
    }
  })
  it("not a member → 403", () => {
    const r = checkResponsibleChange({ userId: "x", role: null }, { responsibleUserId: "x" }, { kind: "assign", targetUserId: "mem" }, members)
    expect(r).toMatchObject({ ok: false, status: 403 })
  })
})

describe("checkResponsibleChange — handover", () => {
  it("responsible non-owner hands over to the only owner", () => {
    expect(checkResponsibleChange(mem, { responsibleUserId: "mem" }, { kind: "handover" }, members)).toEqual({ ok: true, targetUserId: "own1" })
  })
  it("several owners → must pick one, only an owner", () => {
    const two = [...members, m("own2", "owner")]
    expect(checkResponsibleChange(mem, { responsibleUserId: "mem" }, { kind: "handover" }, two)).toMatchObject({ ok: false, status: 400 })
    expect(checkResponsibleChange(mem, { responsibleUserId: "mem" }, { kind: "handover", ownerUserId: "own2" }, two)).toEqual({ ok: true, targetUserId: "own2" })
    expect(checkResponsibleChange(mem, { responsibleUserId: "mem" }, { kind: "handover", ownerUserId: "adm" }, two)).toMatchObject({ ok: false, status: 400 })
  })
  it("someone who is not the responsible cannot hand over", () => {
    expect(checkResponsibleChange(adm, { responsibleUserId: "mem" }, { kind: "handover" }, members)).toMatchObject({ ok: false, status: 403 })
  })
  it("an owner does not hand over (assigns directly)", () => {
    expect(checkResponsibleChange(owner, { responsibleUserId: "own1" }, { kind: "handover" }, members)).toMatchObject({ ok: false, status: 400 })
  })
  it("no owner in the org → 400", () => {
    expect(checkResponsibleChange(mem, { responsibleUserId: "mem" }, { kind: "handover" }, [m("mem", "member")])).toMatchObject({ ok: false, status: 400 })
  })
})

describe("responsibleMode", () => {
  it("picks the control by viewer", () => {
    expect(responsibleMode(owner, { responsibleUserId: "mem" })).toBe("assign")
    expect(responsibleMode(mem, { responsibleUserId: "mem" })).toBe("handover")
    expect(responsibleMode(adm, { responsibleUserId: "mem" })).toBe("read")
    expect(responsibleMode({ userId: "mem", role: null }, { responsibleUserId: "mem" })).toBe("read")
  })
})

describe("matchesResponsibleFilter", () => {
  const row = { responsibleUserId: "own1", responsibleHandoverFromUserId: "mem" }
  it("all / mine / handover / member", () => {
    expect(matchesResponsibleFilter("all", row, "x")).toBe(true)
    expect(matchesResponsibleFilter(null, row, "x")).toBe(true)
    expect(matchesResponsibleFilter("mine", row, "own1")).toBe(true)
    expect(matchesResponsibleFilter("mine", row, "mem")).toBe(false)
    expect(matchesResponsibleFilter("handover", row, "x")).toBe(true)
    expect(matchesResponsibleFilter("handover", { ...row, responsibleHandoverFromUserId: null }, "x")).toBe(false)
    expect(matchesResponsibleFilter("own1", row, "x")).toBe(true)
    expect(matchesResponsibleFilter("adm", row, "x")).toBe(false)
  })
})

describe("reason + note helpers", () => {
  it("normalizes the reason", () => {
    expect(normalizeHandoverReason("  не  наш  клиент ")).toBe("не наш клиент")
    expect(normalizeHandoverReason("   ")).toBeNull()
    expect(normalizeHandoverReason(5)).toBeNull()
    expect(normalizeHandoverReason("x".repeat(900))?.length).toBe(500)
  })
  it("reads the pending note from custom fields", () => {
    expect(readHandoverNote({ responsibleHandover: { reason: "r", at: "t" } })).toEqual({ reason: "r", at: "t" })
    expect(readHandoverNote({})).toBeNull()
    expect(readHandoverNote(null)).toBeNull()
  })
})

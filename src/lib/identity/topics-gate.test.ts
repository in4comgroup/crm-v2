import { describe, expect, it } from "vitest"
import { profileCompleteness, EMPTY_ORG_PROFILE } from "./org-profile"
import { decideTopicsModeChange, topicsGateMessage } from "./topics-gate"

const incomplete = profileCompleteness({ orgName: "Globex", ownDomainCount: 1, profile: EMPTY_ORG_PROFILE })
const complete = profileCompleteness({
  orgName: "Норлекс",
  ownDomainCount: 0,
  profile: {
    ...EMPTY_ORG_PROFILE,
    description: "Импорт оборудования",
    industryCode: "trade",
    marketRoles: ["importer"],
    products: [{ name: "Вино" }],
    targetCustomers: [{ name: "Малый бизнес" }],
    noOwnDomain: true,
  },
})

describe("decideTopicsModeChange (identity I3)", () => {
  it("incomplete profile: off → shadow / on and shadow → on refused with 409 + missing", () => {
    for (const [from, to] of [["off", "shadow"], ["off", "on"], ["shadow", "on"]] as const) {
      const d = decideTopicsModeChange({ from, to, completeness: incomplete })
      expect(d.ok).toBe(false)
      if (!d.ok) {
        expect(d.status).toBe(409)
        expect(d.missing).toEqual(["description", "industryRole", "products", "customers"])
        expect(d.error).toContain("Не хватает")
        expect(d.error).toContain("«Чем занимается компания»")
      }
    }
  })

  it("running orgs are never stopped: → off and the same mode always pass", () => {
    expect(decideTopicsModeChange({ from: "on", to: "off", completeness: incomplete })).toEqual({
      ok: true,
      overridden: false,
      reason: null,
    })
    expect(decideTopicsModeChange({ from: "on", to: "on", completeness: incomplete }).ok).toBe(true)
    expect(decideTopicsModeChange({ from: "on", to: "shadow", completeness: incomplete }).ok).toBe(false)
  })

  it("complete profile passes (noOwnDomain counts as the domain item)", () => {
    expect(complete.complete).toBe(true)
    expect(decideTopicsModeChange({ from: "off", to: "on", completeness: complete })).toEqual({
      ok: true,
      overridden: false,
      reason: null,
    })
  })

  it("override: reason ≥ 10 chars passes and is returned; shorter → 400", () => {
    expect(
      decideTopicsModeChange({ from: "off", to: "shadow", completeness: incomplete, override: { reason: "  тестовая орг  " } }),
    ).toEqual({ ok: true, overridden: true, reason: "тестовая орг" })
    const short = decideTopicsModeChange({ from: "off", to: "shadow", completeness: incomplete, override: { reason: "тест" } })
    expect(short.ok).toBe(false)
    if (!short.ok) expect(short.status).toBe(400)
    const noReason = decideTopicsModeChange({ from: "off", to: "on", completeness: incomplete, override: {} })
    expect(noReason.ok).toBe(false)
  })

  it("override on a complete profile is not counted as an override", () => {
    expect(
      decideTopicsModeChange({ from: "off", to: "on", completeness: complete, override: { reason: "ненужная причина" } }),
    ).toEqual({ ok: true, overridden: false, reason: null })
  })

  it("message lists the labels", () => {
    expect(topicsGateMessage(["name", "domain"])).toBe(
      "Профиль организации не заполнен — темы нельзя включить. Не хватает: Название организации; Свой домен (сайт или почтовый) — или отметка «Нет своего домена».",
    )
  })
})

import { describe, expect, it } from "vitest"
import { DEFAULT_FUNNEL_REASONS, newStageCode, validateFunnelConfig, type FunnelConfig } from "./config"
import { computeForecast } from "./forecast"

const stage = (code: string, role: FunnelConfig["stages"][number]["role"], extra: Partial<FunnelConfig["stages"][number]> = {}) => ({
  code,
  name: code.toUpperCase(),
  role,
  inForecast: role === "active",
  probabilityMode: "stage" as const,
  probability: 0.5,
  ...extra,
})

const base = (): FunnelConfig => ({
  v: 1,
  stages: [stage("area0", "area0"), stage("s1", "active"), stage("s2", "active"), stage("won", "won"), stage("lost", "lost")],
  dealTypes: [{ code: "new_client", label: "Новый клиент" }],
  reasons: DEFAULT_FUNNEL_REASONS,
  entryGate: "go_no_go",
  rules: [
    { signal: "SALES_TENDER_INVITATION", effect: "create_deal", stage: "s1", dealTypes: [], requiresConfirmation: false, minConfidence: "medium", enabled: true },
    { signal: "SALES_SELECTED", effect: "move_stage", stage: "s2", dealTypes: ["new_client"], requiresConfirmation: false, minConfidence: "medium", enabled: true },
    { signal: "CONTRACT_SIGNED", effect: "outcome_won", stage: null, dealTypes: [], requiresConfirmation: false, minConfidence: "medium", enabled: true },
  ],
})

const known = new Set(["SALES_TENDER_INVITATION", "SALES_SELECTED", "CONTRACT_SIGNED", "SALES_OFFER_NO_RESPONSE", "SALES_OFFER_SENT"])
const v = (c: unknown, extra = {}) => validateFunnelConfig(c, { knownSignals: known, ...extra })

describe("validateFunnelConfig", () => {
  it("accepts a valid funnel", () => {
    const r = v(base())
    expect(r.issues).toEqual([])
    expect(r.config).not.toBeNull()
  })
  it("roles: exactly one won / lost, ≤ 1 area0, ≥ 1 active", () => {
    const c = base()
    c.stages.push(stage("won2", "won"))
    expect(v(c).issues.map((i) => i.message)).toContain("Нужна ровно одна стадия «Итог: выиграли»")
    const d = base()
    d.stages = d.stages.filter((s) => s.role !== "active")
    expect(v({ ...d, rules: [] }).issues.map((i) => i.message)).toContain("Нужна хотя бы одна стадия воронки")
  })
  it("rules: target must be an active stage; silence never closes; our side never moves; unknown signal / type", () => {
    const c = base()
    c.rules = [
      { ...c.rules[0], stage: "area0" },
      { ...c.rules[0], signal: "SALES_OFFER_NO_RESPONSE", effect: "outcome_lost", stage: null },
      { ...c.rules[0], signal: "SALES_OFFER_SENT", effect: "move_stage", stage: "s2" },
      { ...c.rules[0], signal: "NOPE", stage: "s1" },
      { ...c.rules[0], signal: "SALES_SELECTED", stage: "s2", dealTypes: ["unknown_type"] },
    ]
    const msgs = v(c).issues.map((i) => i.message).join(" | ")
    expect(msgs).toMatch(/только на стадию воронки/)
    expect(msgs).toMatch(/молчание клиента/)
    expect(msgs).toMatch(/наше собственное действие/)
    expect(msgs).toMatch(/Неизвестный сигнал NOPE/)
    expect(msgs).toMatch(/неизвестный тип сделки/)
  })
  it("a stage with deals cannot be removed; duplicates refused", () => {
    const c = base()
    c.stages = c.stages.map((s, i) => ({ ...s, id: `id${i}` }))
    const removed = { ...c, stages: c.stages.filter((s) => s.code !== "s2"), rules: c.rules.filter((r) => r.stage !== "s2") }
    const r = v(removed, { existingStageIds: c.stages.map((s) => s.id!), dealsByStageId: { id2: 3 } })
    expect(r.issues[0].message).toMatch(/Нельзя удалить стадию со сделками \(3\)/)
    const dup = base()
    dup.stages[2] = { ...dup.stages[2], name: "S1" }
    expect(v(dup).issues.map((i) => i.message).join()).toMatch(/уже есть/)
  })
  it("new stage codes", () => {
    expect(newStageCode(["st_1", "s1"])).toBe("st_2")
  })
})

describe("computeForecast", () => {
  const stages = [
    { id: "a0", role: "area0" as const, inForecast: false, probabilityMode: "stage" as const, probability: 0 },
    { id: "s2", role: "active" as const, inForecast: false, probabilityMode: "stage" as const, probability: 0.2 },
    { id: "s3", role: "active" as const, inForecast: true, probabilityMode: "expert" as const, probability: 0 },
    { id: "s4", role: "active" as const, inForecast: true, probabilityMode: "stage" as const, probability: 0.8 },
    { id: "w", role: "won" as const, inForecast: false, probabilityMode: "stage" as const, probability: 1 },
  ]
  it("counts only forecast stages with amount (+ expert probability), won apart", () => {
    const r = computeForecast(stages, [
      { stageId: "a0", status: "active", value: 1000, expertProbability: null },
      { stageId: "s2", status: "active", value: 1000, expertProbability: 90 },
      { stageId: "s3", status: "active", value: 1000, expertProbability: 40 },
      { stageId: "s3", status: "active", value: 1000, expertProbability: null },
      { stageId: "s3", status: "paused", value: 1000, expertProbability: 50 },
      { stageId: "s4", status: "active", value: 500, expertProbability: null },
      { stageId: "s4", status: "active", value: null, expertProbability: null },
      { stageId: "w", status: "active", value: 700, expertProbability: null },
    ])
    expect(r).toEqual({ weighted: 400 + 400, pipeline: 1500, counted: 2, unestimated: 2, won: 700 })
  })
})

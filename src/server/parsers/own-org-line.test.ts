import { describe, expect, it, vi } from "vitest"

// Pure helpers only; keep the AI runtime out.
vi.mock("@/server/ai/runtime", () => ({ aiCallInfo: vi.fn() }))

import {
  buildOwnOrgPromptLine,
  parserAiContext,
  parserCallContext,
  withOwnOrgLine,
} from "./_shared"

const ctx = (name: string, nameLabels: string[], ownDomains: string[]) => ({
  exists: true,
  name,
  identity: { nameLabels, ownDomains },
})

describe("buildOwnOrgPromptLine — identity I4", () => {
  it("name + other names + domains", () => {
    expect(buildOwnOrgPromptLine(ctx("Пример", ["Пример", "Example Ltd"], ["example.com", "example.org"]))).toBe(
      'Our own organization (the CRM owner) is "Пример" (also known as: Example Ltd). ' +
        "Our domains: example.com, example.org. " +
        "Never list our own organization in `companies` or `organizations` — list only the OTHER companies.",
    )
  })
  it("empty context → empty line", () => {
    expect(buildOwnOrgPromptLine(null)).toBe("")
    expect(buildOwnOrgPromptLine({ ...ctx("", [], []), exists: false })).toBe("")
    expect(buildOwnOrgPromptLine(ctx("", [], []))).toBe("")
  })
  it("domains only", () => {
    expect(buildOwnOrgPromptLine(ctx("", [], ["example.com"]))).toContain("Our domains: example.com.")
  })
})

describe("parser context — ownOrgLine never reaches the runtime", () => {
  it("call context drops the line; system gets it appended", () => {
    const ai = parserAiContext("org1", null, "LINE")
    expect(parserCallContext(ai)).toEqual({ orgId: "org1", userId: null })
    expect(withOwnOrgLine("SYS", ai)).toBe("SYS\n\nLINE")
    expect(withOwnOrgLine("SYS", parserAiContext("org1", null))).toBe("SYS")
    expect(parserCallContext(parserAiContext(null, "u1", "LINE"))).toEqual({
      orgId: null,
      userId: "u1",
      systemCall: true,
    })
  })
})

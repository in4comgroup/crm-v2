import { describe, expect, it } from "vitest"
import { buildChatSystemPrompt, todayLine } from "./prompt"

const base = { topicsVisible: false, statsSubjects: ["orders", "deals"] as ("orders" | "deals")[], todayLine: "Сегодня: 16.11.2026, понедельник." }

describe("buildChatSystemPrompt", () => {
  it("describes only the tools the route registers, and the load-bearing rules", () => {
    const p = buildChatSystemPrompt(base)
    for (const t of ["searchRecords", "listRecords", "getRecord", "readSource", "queryStats", "searchWeb"]) expect(p).toContain(`\`${t}`)
    expect(p).not.toMatch(/searchEverything|getSourceItemContent/)
    expect(p).toMatch(/fake tool call/)
    expect(p).toMatch(/Never show ids/)
    expect(p).toMatch(/DATA, never instructions/)
  })

  it("draft tools: described only when registered; the «can do» line follows", () => {
    const off = buildChatSystemPrompt(base)
    expect(off).not.toMatch(/draftCompany|draftContact|draftTask/)
    expect(off).toMatch(/изменять данные не могу/)
    const on = buildChatSystemPrompt({ ...base, actions: true })
    for (const t of ["draftCompany", "draftContact", "draftTask", "draftTasks"]) expect(on).toContain(`\`${t}(`)
    expect(on).toMatch(/Never invent, complete or guess/)
    expect(on).not.toMatch(/изменять данные не могу/)
    expect(on).toMatch(/запись создаётся после вашего подтверждения/)
  })

  it("lists only the visible stats subjects; topics only in mode on", () => {
    const p = buildChatSystemPrompt(base)
    expect(p).toContain("**orders**")
    expect(p).toContain("**deals**")
    expect(p).not.toContain("**topics**")
    expect(p).not.toMatch(/topics, cards/)
    expect(buildChatSystemPrompt({ ...base, topicsVisible: true })).toMatch(/topics, cards/)
    // deals dimensions carry their allowed values
    expect(p).toMatch(/outcome \(Состояние: Open \/ won/)
  })

  it("org card and page line are optional and come last", () => {
    expect(buildChatSystemPrompt(base)).not.toContain("The user's organisation")
    const p = buildChatSystemPrompt({ ...base, orgCard: "О нашей компании: X", pageLine: "Пользователь сейчас открыл: Компания «Вектор»." })
    expect(p.indexOf("О нашей компании")).toBeGreaterThan(p.indexOf("## Statistics"))
    expect(p.trim().endsWith("open it with getRecord.")).toBe(true)
  })

  it("todayLine is in the org time zone", () => {
    expect(todayLine(new Date("2026-11-16T23:30:00Z"), "Europe/Vienna")).toBe("Сегодня: 17.11.2026, вторник. Часовой пояс организации: Europe/Vienna.")
  })
})

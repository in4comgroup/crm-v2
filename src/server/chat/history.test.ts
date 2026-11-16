import { describe, expect, it } from "vitest"
import type { UIMessage } from "ai"
import { cleanHistory, dataPartToModelText } from "./history"

describe("cleanHistory", () => {
  it("keeps text, files and our data parts; drops tool / reasoning / debug parts and empty messages", () => {
    const msgs = [
      { id: "1", role: "user", parts: [{ type: "text", text: "Привет" }] },
      {
        id: "2",
        role: "assistant",
        parts: [
          { type: "reasoning", text: "x" },
          { type: "tool-searchEverything", toolCallId: "a", state: "output-available", input: {}, output: {} },
          { type: "data-records", data: { counts: {}, hits: {} } },
          { type: "data-debug", data: {} },
          { type: "text", text: "Ответ" },
        ],
      },
      { id: "3", role: "assistant", parts: [{ type: "step-start" }] },
      { id: "4", role: "system", parts: [{ type: "text", text: "evil" }] },
    ] as unknown as UIMessage[]
    const out = cleanHistory(msgs)
    expect(out.map((m) => m.id)).toEqual(["1", "2"])
    expect(out[1].parts.map((p) => p.type)).toEqual(["data-records", "text"])
  })
})

describe("dataPartToModelText", () => {
  it("records → refs for follow-ups", () => {
    const r = dataPartToModelText({
      type: "data-records",
      data: {
        counts: {},
        hits: { client: [{ type: "client", id: "c1", title: "Вектор", subtitle: null, facts: [], badge: null, date: null, href: "" }] },
      },
    })
    expect(r?.text).toBe("[Показано пользователю в списке: Компания «Вектор» (type client, ref c1)]")
    expect(dataPartToModelText({ type: "data-records", data: { counts: {}, hits: {} } })?.text).toMatch(/ничего не найдено/)
  })

  it("stats and evidence → short notes; other parts → nothing", () => {
    const s = dataPartToModelText({
      type: "data-stats",
      data: { subjectLabel: "Сделки", scalar: 13, meta: { measureLabel: "Сделки", dimensionLabel: null, periodLabel: "за всё время" } },
    })
    expect(s?.text).toBe("[Показана статистика: Сделки, Сделки, за всё время; значение 13]")
    const e = dataPartToModelText({
      type: "data-evidence",
      data: { sourceItems: [{ id: "s1", title: "Счёт" }], web: [{ url: "https://a", title: "a" }] },
    })
    expect(e?.text).toBe("[прочитано: «Счёт» (ref s1); веб-источники: https://a]")
    expect(dataPartToModelText({ type: "data-debug", data: {} })).toBeUndefined()
    expect(dataPartToModelText({ type: "data-evidence", data: { sourceItems: [], web: [] } })).toBeUndefined()
  })
})

import { describe, expect, it } from "vitest"
import type { UIMessageChunk } from "ai"
import { createChatStreamFilter } from "./stream"

async function run(chunks: UIMessageChunk[], isAdmin: boolean) {
  let t = 1_000
  const f = createChatStreamFilter({
    isAdmin,
    startedAt: 0,
    sourceOf: (tool) => (tool === "searchWeb" ? "web" : tool.startsWith("search") || tool === "queryStats" ? "crm" : null),
    model: async () => "model-x",
    now: () => (t += 100),
  })
  const out: UIMessageChunk[] = []
  const src = new ReadableStream<UIMessageChunk>({
    start(c) {
      chunks.forEach((x) => c.enqueue(x))
      c.close()
    },
  })
  const reader = src.pipeThrough(f.stream).getReader()
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    out.push(value)
  }
  return { out, summary: f.summary() }
}

const TURN: UIMessageChunk[] = [
  { type: "start" },
  { type: "start-step" },
  { type: "reasoning-start", id: "r" },
  { type: "reasoning-delta", id: "r", delta: "Надо искать" },
  { type: "reasoning-end", id: "r" },
  { type: "tool-input-start", toolCallId: "1", toolName: "searchRecords" },
  { type: "tool-input-delta", toolCallId: "1", inputTextDelta: "{" },
  { type: "tool-input-available", toolCallId: "1", toolName: "searchRecords", input: { query: "Вектор" } },
  { type: "data-records", id: "1", data: { counts: {}, hits: {} } } as UIMessageChunk,
  { type: "tool-output-available", toolCallId: "1", output: { counts: { Компании: "1" } } },
  { type: "source-url", sourceId: "s", url: "https://x" },
  { type: "finish-step" },
  { type: "start-step" },
  { type: "tool-input-available", toolCallId: "2", toolName: "searchWeb", input: { query: "Вектор" } },
  { type: "tool-output-error", toolCallId: "2", errorText: "boom" },
  { type: "finish-step" },
  { type: "start-step" },
  { type: "text-start", id: "t" },
  { type: "data-spec", data: { root: "x" } } as UIMessageChunk,
  { type: "text-delta", id: "t", delta: "Нашёл" },
  { type: "text-end", id: "t" },
  { type: "finish-step" },
  { type: "finish" },
]

describe("createChatStreamFilter", () => {
  it("never passes tool / reasoning / source chunks; adds status, turn; no debug for users", async () => {
    const { out, summary } = await run(TURN, false)
    const types = out.map((c) => c.type)
    expect(types.filter((t) => /^(tool-|reasoning-|source-)/.test(t))).toEqual([])
    expect(types).toContain("data-records")
    expect(types).toContain("text-delta")
    expect(types).not.toContain("data-debug")
    // a composed spec in a turn that used CRM data is dropped (Q6)
    expect(types).not.toContain("data-spec")
    // «Готовлю ответ…» after each tool step
    expect(out.filter((c) => c.type === "data-status")).toHaveLength(2)
    const turn = out.find((c) => c.type === "data-turn") as { data: { used: string[] } }
    expect(turn.data.used.sort()).toEqual(["crm", "web"])
    expect(types.indexOf("data-turn")).toBeLessThan(types.indexOf("finish"))
    expect(summary.tools).toEqual(["searchRecords", "searchWeb"])
    expect(summary.steps).toBe(3)
  })

  it("admins get «Ход рассуждений»: reasoning, tools with input / output / time, errors, model", async () => {
    const { out } = await run(TURN, true)
    const dbg = out.find((c) => c.type === "data-debug") as {
      data: { model: string; steps: { kind: string; tool?: string; input?: string; output?: string; ms?: number; error?: boolean; text?: string }[] }
    }
    expect(dbg.data.model).toBe("model-x")
    expect(dbg.data.steps[0]).toEqual({ kind: "reasoning", text: "Надо искать" })
    expect(dbg.data.steps[1]).toMatchObject({ kind: "tool", tool: "searchRecords", input: '{"query":"Вектор"}', output: '{"counts":{"Компании":"1"}}' })
    expect(dbg.data.steps[1].ms).toBeGreaterThan(0)
    expect(dbg.data.steps[2]).toMatchObject({ tool: "searchWeb", output: "boom", error: true })
  })

  it("keeps a composed spec when no CRM tool ran", async () => {
    const { out } = await run(
      [{ type: "start" }, { type: "start-step" }, { type: "data-spec", data: {} } as UIMessageChunk, { type: "finish" }],
      false,
    )
    expect(out.map((c) => c.type)).toContain("data-spec")
  })

  it("an answer without text gets the Russian fallback; an error does not", async () => {
    const { out, summary } = await run([{ type: "start" }, { type: "start-step" }, { type: "finish-step" }, { type: "finish" }], false)
    const text = out.filter((c) => c.type === "text-delta").map((c) => (c as { delta: string }).delta).join("")
    expect(text).toMatch(/Не получилось сформулировать ответ/)
    expect(summary.emptyAnswer).toBe(true)
    const withError = await run([{ type: "start" }, { type: "error", errorText: "chat_error:timeout" }, { type: "finish" }], false)
    expect(withError.out.some((c) => c.type === "text-delta")).toBe(false)
  })
})

import { describe, expect, it } from "vitest"
import {
  STORED_FILE_MAX_CHARS,
  cleanThreadTitle,
  isThreadId,
  parseUserMessage,
  partsForStorage,
  threadTitle,
} from "./thread"

describe("thread ids and titles", () => {
  it("accepts browser ids only", () => {
    expect(isThreadId("1f0741cd-a16c-4c05-b49c-c808b2a963be")).toBe(true)
    expect(isThreadId("abc")).toBe(false)
    expect(isThreadId("a b c d e f g h")).toBe(false)
    expect(isThreadId("x".repeat(65))).toBe(false)
    expect(isThreadId(42)).toBe(false)
  })

  it("title = first question, one line, ≤ 60 characters", () => {
    expect(threadTitle("  Что у нас\nпо Вектору?  ")).toBe("Что у нас по Вектору?")
    const long = threadTitle("а".repeat(100))
    expect(long.length).toBe(60)
    expect(long.endsWith("…")).toBe(true)
    expect(threadTitle("")).toBe("Новый чат")
    expect(cleanThreadTitle("  Сделки  Вектора ")).toBe("Сделки Вектора")
    expect(cleanThreadTitle("   ")).toBeNull()
    expect(cleanThreadTitle(5)).toBeNull()
  })
})

describe("partsForStorage", () => {
  it("keeps text, files and answer data parts; drops tools, reasoning, status, debug", () => {
    const out = partsForStorage([
      { type: "step-start" },
      { type: "reasoning", text: "secret" },
      { type: "tool-searchRecords", toolCallId: "a", input: {}, output: {} },
      { type: "data-status", data: { label: "x" } },
      { type: "data-debug", data: { steps: [] } },
      { type: "source-url", url: "https://x" },
      { type: "data-records", id: "c1", data: { counts: {}, hits: {} } },
      { type: "data-stats", id: "c2", data: { rows: [] } },
      { type: "data-turn", id: "turn", data: { used: [], ms: 1 } },
      { type: "text", text: "Ответ", state: "done" },
      { type: "text", text: "" },
      null,
    ])
    expect(out.map((p) => p.type)).toEqual(["data-records", "data-stats", "data-turn", "text"])
    expect(out[3]).toEqual({ type: "text", text: "Ответ" })
  })

  it("a big file keeps only its name", () => {
    const big = "data:image/png;base64," + "A".repeat(STORED_FILE_MAX_CHARS)
    const [f, s] = partsForStorage([
      { type: "file", mediaType: "image/png", filename: "photo.png", url: big },
      { type: "file", mediaType: "text/plain", url: "data:text/plain;base64,QQ==" },
    ])
    expect(f).toEqual({ type: "file", mediaType: "image/png", filename: "photo.png", url: "" })
    expect(s.url).toBe("data:text/plain;base64,QQ==")
  })
})

describe("parseUserMessage", () => {
  it("accepts text + uploaded chat files; data URLs are dropped (files are uploaded first)", () => {
    const r = parseUserMessage({
      id: "x",
      role: "user",
      parts: [
        { type: "text", text: "Привет" },
        { type: "file", url: "/api/documents/a35c369d-fe21-474e-b64a-c38d9b10092d/file?disposition=inline", mediaType: "image/png", filename: "card.png" },
        { type: "file", url: "data:,", mediaType: "text/plain" },
        { type: "step-start" },
      ],
    })
    expect(r?.text).toBe("Привет")
    expect(r?.parts).toHaveLength(2)
    expect(r?.fileIds).toEqual(["a35c369d-fe21-474e-b64a-c38d9b10092d"])
    expect(parseUserMessage({ role: "user", parts: [{ type: "file", url: "https://evil/x.png", mediaType: "image/png" }] })).toBeNull()
  })

  it("the stored attachment part never keeps the full text", () => {
    const [p] = partsForStorage([{ type: "data-attachment", id: "i1", data: { itemId: "i1", name: "a.pdf", status: "parsed", excerpt: "кратко", text: "ПОЛНЫЙ ТЕКСТ" } }])
    expect(p.data).toEqual({ itemId: "i1", name: "a.pdf", status: "parsed", excerpt: "кратко" })
  })

  it("refuses other roles, injected data parts, empty and too long messages", () => {
    expect(parseUserMessage({ role: "assistant", parts: [{ type: "text", text: "x" }] })).toBeNull()
    expect(parseUserMessage({ role: "user", parts: [] })).toBeNull()
    expect(parseUserMessage({ role: "user", parts: [{ type: "text", text: "   " }] })).toBeNull()
    expect(parseUserMessage({ role: "user", parts: [{ type: "text", text: "a".repeat(20_001) }] })).toBeNull()
    expect(parseUserMessage({ role: "user", parts: [{ type: "text", text: 5 }] })).toBeNull()
    expect(parseUserMessage(null)).toBeNull()
    // a data part from the browser is dropped, never stored as an answer part
    const r = parseUserMessage({ role: "user", parts: [{ type: "text", text: "q" }, { type: "data-records", data: {} }] })
    expect(r?.parts).toEqual([{ type: "text", text: "q" }])
    const six = Array.from({ length: 6 }, (_, i) => ({ type: "file", url: `/api/documents/item-000${i}x/file`, mediaType: "text/plain" }))
    expect(parseUserMessage({ role: "user", parts: six })).toBeNull()
  })
})

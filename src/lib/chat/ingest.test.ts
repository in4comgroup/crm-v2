import { describe, expect, it } from "vitest"
import { splitQuotedHistory } from "@/lib/ru-mail"
import {
  AI_ANSWERS_HEADER,
  chatIngestDue,
  chatSegmentExternalId,
  chatThreadKey,
  dataUrlBytes,
  messageFiles,
  segmentContent,
  segmentHasUserContent,
  segmentTranscript,
  type SegmentMessage,
} from "./ingest"

const at = (iso: string) => new Date(iso)
const u = (seq: number, text: string, extra: unknown[] = []): SegmentMessage => ({
  seq,
  role: "user",
  createdAt: at(`2026-11-16T10:0${seq}:00Z`),
  parts: [{ type: "text", text }, ...extra],
})
const a = (seq: number, text: string): SegmentMessage => ({
  seq,
  role: "assistant",
  createdAt: at(`2026-11-16T10:0${seq}:30Z`),
  parts: [{ type: "data-records", data: { counts: {}, hits: {} } }, { type: "text", text }],
})

const SEG = [
  u(1, "Что у нас по Норлексу?"),
  a(2, "Нашёл компанию «Norleks», 2 контакта и открытую сделку на 1,2 млн ₽."),
  u(3, "Звонил Петров из Норлекса: хотят КП на 200 позиций до пятницы."),
  a(4, "Записал. Хотите, я найду их последние заказы?"),
]

describe("segmentContent", () => {
  it("user messages first, AI answers in ONE quoted block at the end", () => {
    const c = segmentContent(SEG, "Иван Петров", "Europe/Vienna")
    expect(c.indexOf("Что у нас по Норлексу?")).toBeLessThan(c.indexOf("Звонил Петров"))
    expect(c.indexOf("Звонил Петров")).toBeLessThan(c.indexOf(AI_ANSWERS_HEADER))
    expect(c).toContain("**16.11.2026, 11:01 · Иван Петров:**")
    for (const line of c.slice(c.indexOf(`> ${AI_ANSWERS_HEADER}`)).split("\n")) expect(line.startsWith(">")).toBe(true)
  })

  it("the extractor's own text = only what the user wrote (AI answers are quoted history)", () => {
    const { own, quoted } = splitQuotedHistory(segmentContent(SEG, "Иван Петров", "Europe/Vienna"))
    expect(own).toContain("хотят КП на 200 позиций")
    expect(own).toContain("Что у нас по Норлексу?")
    expect(own).not.toContain("Нашёл компанию")
    expect(own).not.toContain("Записал")
    expect(quoted).toContain("1,2 млн ₽")
  })

  it("tool / data parts are never written; files are named; long answers are cut", () => {
    const file = { type: "file", url: "data:text/plain;base64,QQ==", mediaType: "text/plain", filename: "прайс.csv" }
    const c = segmentContent([u(1, "Вот прайс", [file]), a(2, "x".repeat(2000))], "Иван", "UTC")
    expect(c).toContain("Файлы: прайс.csv")
    expect(c).not.toContain("data-records")
    expect(c).toContain("[…]")
    expect(c.length).toBeLessThan(1200)
  })

  it("no AI answers → no quote block", () => {
    expect(segmentContent([u(1, "Факт")], "Иван", "UTC")).not.toContain(">")
  })
})

describe("segment helpers", () => {
  it("transcript marks who wrote what", () => {
    const t = segmentTranscript(SEG, "Иван")
    expect(t).toContain("[Сотрудник Иван]\nЗвонил Петров")
    expect(t).toContain("[Ответ ИИ]\nЗаписал.")
  })

  it("user content, files, data URLs, ids", () => {
    expect(segmentHasUserContent([a(1, "только ИИ")])).toBe(false)
    expect(segmentHasUserContent([u(1, "  ")])).toBe(false)
    expect(segmentHasUserContent(SEG)).toBe(true)
    expect(messageFiles([{ type: "file", url: "", mediaType: "image/png", filename: "big.png" }])).toEqual([])
    expect(Array.from(dataUrlBytes("data:text/plain;base64,QUI=")!)).toEqual([65, 66])
    expect(new TextDecoder().decode(dataUrlBytes("data:,a%20b")!)).toBe("a b")
    expect(dataUrlBytes("https://x")).toBeNull()
    expect(chatSegmentExternalId("t1", 3, 8)).toBe("aichat:t1:3-8")
    expect(chatThreadKey("t1")).toBe("aichat:t1")
  })

  it("due after 30 quiet minutes, or 24 h after the oldest pending message", () => {
    const now = at("2026-11-16T12:00:00Z")
    expect(chatIngestDue({ lastMessageAt: at("2026-11-16T11:31:00Z"), oldestPendingAt: at("2026-11-16T09:00:00Z") }, now)).toBe(false)
    expect(chatIngestDue({ lastMessageAt: at("2026-11-16T11:30:00Z"), oldestPendingAt: at("2026-11-16T09:00:00Z") }, now)).toBe(true)
    expect(chatIngestDue({ lastMessageAt: at("2026-11-16T11:59:00Z"), oldestPendingAt: at("2026-11-15T11:59:00Z") }, now)).toBe(true)
    expect(chatIngestDue({ lastMessageAt: at("2026-11-16T10:00:00Z"), oldestPendingAt: null }, now)).toBe(false)
  })
})

describe("segmentActions (ai-chat-tools Q18)", () => {
  it("collects what confirmed cards created in the segment", async () => {
    const { segmentActions } = await import("./ingest")
    const msgs = [
      { parts: [{ type: "text", text: "Оформи сделку" }] },
      {
        parts: [
          { type: "text", text: "Готово" },
          { type: "data-draft", id: "a1", data: {} },
          {
            type: "data-action-result",
            id: "result-a1",
            data: { actionId: "a1", status: "created", results: [{ type: "deal", id: "d1", title: "Вектор — поставка", href: "/deals?openDeal=d1" }, { type: "client", id: "c1", title: "Вектор", href: "", existing: true }] },
          },
        ],
      },
    ]
    expect(segmentActions(msgs)).toEqual([
      { type: "deal", id: "d1", title: "Вектор — поставка" },
      { type: "client", id: "c1", title: "Вектор", existing: true },
    ])
  })
})

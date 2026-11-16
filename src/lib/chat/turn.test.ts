import { describe, expect, it } from "vitest"
import type { RecordHit } from "@/lib/chat/records"
import {
  CHAT_ERROR_MESSAGES_RU,
  chatErrorText,
  dataParts,
  mergeEvidenceParts,
  mergeRecordsParts,
  statusForTool,
  turnLine,
} from "./turn"

const hit = (type: RecordHit["type"], id: string, title = id): RecordHit => ({
  type,
  id,
  title,
  subtitle: null,
  facts: [],
  badge: null,
  date: null,
  href: `/x/${id}`,
})

describe("statusForTool", () => {
  it("builds Russian labels from the input, never the tool name", () => {
    expect(statusForTool("searchRecords", { query: "Норлекс" }).label).toBe("Ищу в CRM: «Норлекс»…")
    expect(statusForTool("listRecords", { type: "task" }).label).toBe("Подбираю задачи…")
    expect(statusForTool("getRecord", {}, "ООО Ромашка").label).toBe("Открываю: ООО Ромашка…")
    expect(statusForTool("readSource", {}, "Счёт № 418").label).toBe("Читаю: «Счёт № 418»…")
    expect(statusForTool("queryStats", {}, "Выручка, по месяцам").label).toBe("Считаю статистику: Выручка, по месяцам…")
    expect(statusForTool("searchWeb", { query: "x" }).label).toBe("Ищу в интернете…")
    expect(statusForTool("unknownTool", {}).label).toBe("Думаю…")
    for (const t of ["searchRecords", "listRecords", "getRecord", "readSource", "queryStats", "searchWeb"]) {
      expect(statusForTool(t, { query: "q", type: "deal" }).label).not.toMatch(/[A-Z][a-z]+[A-Z]/)
    }
  })

  it("cuts a long query", () => {
    expect(statusForTool("searchRecords", { query: "a".repeat(100) }).label.length).toBeLessThan(60)
  })
})

describe("mergeRecordsParts", () => {
  it("merges calls, de-duplicates hits, keeps the largest count", () => {
    const m = mergeRecordsParts([
      { counts: { client: { total: 1, capped: false }, deal: { total: 7, capped: false } }, hits: { client: [hit("client", "c1")], deal: [hit("deal", "d1")] } },
      { counts: { deal: { total: 1, capped: false } }, hits: { deal: [hit("deal", "d1")] } },
      { counts: { task: { total: 3, capped: false } }, hits: { task: [hit("task", "t1"), hit("task", "t2")] }, applied: [{ label: "Статус", value: "открыта" }] },
    ])!
    expect(m.hits.deal).toHaveLength(1)
    expect(m.counts.deal).toEqual({ total: 7, capped: false })
    expect(m.counts.task?.total).toBe(3)
    expect(m.applied).toEqual([{ label: "Статус", value: "открыта" }])
  })

  it("count never below the hits shown; capped wins", () => {
    const m = mergeRecordsParts([
      { counts: { deal: { total: 0, capped: false } }, hits: { deal: [hit("deal", "a"), hit("deal", "b")] } },
      { counts: { client: { total: 12, capped: false } }, hits: {} },
      { counts: { client: { total: 500, capped: true } }, hits: {} },
    ])!
    expect(m.counts.deal).toEqual({ total: 2, capped: false })
    expect(m.counts.client).toEqual({ total: 500, capped: true })
  })

  it("no chips when two calls carry filters; null for no parts", () => {
    const f = [{ label: "a", value: "b" }]
    expect(mergeRecordsParts([{ counts: {}, hits: {}, applied: f }, { counts: {}, hits: {}, applied: f }])!.applied).toBeUndefined()
    expect(mergeRecordsParts([])).toBeNull()
  })
})

describe("mergeEvidenceParts / dataParts / turnLine", () => {
  it("de-duplicates items and web URLs", () => {
    const e = mergeEvidenceParts([
      { sourceItems: [hit("source_item", "s1")], web: [{ url: "https://a", title: "a" }] },
      { sourceItems: [hit("source_item", "s1")], web: [{ url: "https://a", title: "a" }, { url: "https://b", title: "b" }] },
    ])!
    expect(e.sourceItems).toHaveLength(1)
    expect(e.web.map((w) => w.url)).toEqual(["https://a", "https://b"])
    expect(mergeEvidenceParts([{ sourceItems: [], web: [] }])).toBeNull()
  })

  it("reads data parts by name", () => {
    const parts = [
      { type: "text", text: "x" },
      { type: "data-turn", data: { used: ["crm"], ms: 7000 } },
      { type: "data-stats", data: null },
    ]
    expect(dataParts(parts, "turn")).toEqual([{ used: ["crm"], ms: 7000 }])
    expect(dataParts(parts, "stats")).toEqual([])
  })

  it("«CRM · интернет · 7 с»", () => {
    expect(turnLine({ used: ["web", "crm"], ms: 6_600 })).toBe("CRM · интернет · 7 с")
    expect(turnLine({ used: [], ms: 200 })).toBe("1 с")
  })
})

describe("chatErrorText", () => {
  it("maps stream codes and HTTP bodies to Russian, never echoes the raw error", () => {
    expect(chatErrorText("chat_error:timeout")).toEqual({ cls: "timeout", text: CHAT_ERROR_MESSAGES_RU.timeout })
    expect(chatErrorText("chat_error:model_unavailable").cls).toBe("model_unavailable")
    expect(chatErrorText(JSON.stringify({ error: "monthly_limit", message: "Лимит исчерпан." }))).toEqual({ cls: "limit", text: "Лимит исчерпан." })
    expect(chatErrorText("Gateway error: model google/x 503 key sk-123")).toEqual({ cls: "unknown", text: CHAT_ERROR_MESSAGES_RU.unknown })
    expect(chatErrorText(undefined).cls).toBe("unknown")
    expect(chatErrorText("chat_error:bogus").cls).toBe("unknown")
  })
})

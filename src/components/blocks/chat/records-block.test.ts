import { createElement } from "react"
import { renderToReadableStream } from "react-dom/server"
import { describe, expect, test } from "vitest"
import type { RecordHit } from "@/lib/chat/records"
import { RecordsBlock, type RecordsBlockData } from "./records-block"

async function render(data: RecordsBlockData): Promise<string> {
  const s = await renderToReadableStream(createElement(RecordsBlock, { data, onOpen: () => {} }))
  await s.allReady
  return (await new Response(s).text()).replace(/<!-- -->/g, "")
}

function hit(type: RecordHit["type"], n: number): RecordHit {
  return {
    type,
    id: `secret-id-${type}-${n}`,
    title: `Запись ${n}`,
    subtitle: n === 1 ? "ООО Ромашка" : null,
    facts: [{ label: "Статус", value: "открыта" }],
    badge: n === 1 ? { label: "Просрочена", tone: "bad" } : null,
    date: "2026-11-16T10:00:00.000Z",
    href: `/tasks?openTask=secret-id-${type}-${n}`,
  }
}

describe("RecordsBlock", () => {
  test("header counts, chips, sections, «Показать ещё», no ids in text", async () => {
    const html = await render({
      counts: { client: { total: 1, capped: false }, task: { total: 12, capped: false }, source_item: { total: 500, capped: true } },
      hits: {
        client: [hit("client", 1)],
        task: Array.from({ length: 7 }, (_, i) => hit("task", i + 1)),
        source_item: [hit("source_item", 1)],
      },
      applied: [{ label: "Статус", value: "открыта" }],
    })
    expect(html).toContain("Компании: 1 · Задачи: 12 · Источники: 500+")
    expect(html).toContain("Показать ещё (2)")
    expect(html).toContain("… всего 12")
    expect(html).toContain("… всего 500+")
    expect(html).toContain("16.11.2026")
    expect(html).toContain("Просрочена")
    // Sections in RECORD_TYPE_ORDER: companies before tasks before sources.
    expect(html.indexOf(">Компании<")).toBeLessThan(html.indexOf(">Задачи<"))
    expect(html.indexOf(">Задачи<")).toBeLessThan(html.indexOf(">Источники<"))
    // Ids appear only inside hrefs, never as visible text.
    const text = html.replace(/<[^>]+>/g, " ")
    expect(text).not.toContain("secret-id")
    // 5 task rows shown, not 7.
    expect(html.match(/Задача: Запись/g)?.length).toBe(5)
  })

  test("empty result", async () => {
    const html = await render({ counts: {}, hits: {} })
    expect(html).toContain("ничего не найдено")
  })
})

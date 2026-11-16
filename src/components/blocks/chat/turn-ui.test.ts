import { createElement, type ReactElement } from "react"
import { renderToReadableStream } from "react-dom/server"
import { describe, expect, test } from "vitest"
import { ChatErrorLine, ChatStatusLine, DebugBlock, EvidenceBlock, TurnLine } from "./turn-ui"

async function render(el: ReactElement): Promise<string> {
  const s = await renderToReadableStream(el)
  await s.allReady
  return (await new Response(s).text()).replace(/<!-- -->/g, "")
}

describe("answer parts around the prose", () => {
  test("status line shows the Russian label", async () => {
    expect(await render(createElement(ChatStatusLine, { status: { stage: "crm", label: "Ищу в CRM: «Вектор»…" } }))).toContain(
      "Ищу в CRM: «Вектор»…",
    )
    expect(await render(createElement(ChatStatusLine, { status: null }))).toContain("Думаю…")
  })

  test("evidence: count in the trigger, no ids or redirect URLs as text", async () => {
    const html = await render(
      createElement(EvidenceBlock, {
        evidence: {
          sourceItems: [
            { type: "source_item", id: "secret-item-id", title: "Счёт № 418", subtitle: null, facts: [], badge: null, date: null, href: "/sources?item=secret-item-id" },
          ],
          web: [{ url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/XYZ", title: "vektor-it.ru" }],
        },
        onOpen: () => {},
      }),
    )
    expect(html).toContain("Источники ответа (2)")
    expect(html.replace(/<[^>]+>/g, " ")).not.toContain("secret-item-id")
  })

  test("turn line and error line", async () => {
    expect(await render(createElement(TurnLine, { turn: { used: ["crm", "web"], ms: 7_000 } }))).toContain("CRM · интернет · 7 с")
    const err = await render(createElement(ChatErrorLine, { text: "Ответ занял слишком много времени.", onRetry: () => {} }))
    expect(err).toContain("Ответ занял слишком много времени.")
    expect(err).toContain("Повторить")
    expect(await render(createElement(ChatErrorLine, { text: "Лимит" }))).not.toContain("Повторить")
  })

  test("«Ход рассуждений» is closed by default and names the model", async () => {
    const html = await render(
      createElement(DebugBlock, {
        debug: { model: "model-x", steps: [{ kind: "tool", tool: "searchRecords", input: "{}", output: "{}", ms: 300 }] },
      }),
    )
    expect(html).toContain("Ход рассуждений (администратор) · 1 вызов(ов) · model-x")
    expect(html).not.toContain("300 мс")
  })
})

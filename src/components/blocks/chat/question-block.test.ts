import { createElement } from "react"
import { renderToReadableStream } from "react-dom/server"
import { describe, expect, test } from "vitest"
import type { ChatQuestionPart } from "@/lib/chat/turn"
import { QuestionBlock } from "./question-block"

async function render(answer: string | null, busy = false): Promise<string> {
  const part: ChatQuestionPart = {
    id: "q1",
    question: "Какую компанию вы имеете в виду?",
    options: ["Вектор (Екатеринбург)", "Вектор-Плюс", "Другая компания…"],
    allowFreeText: true,
  }
  const s = await renderToReadableStream(createElement(QuestionBlock, { part, answer, busy, onAnswer: () => {} }))
  await s.allReady
  return (await new Response(s).text()).replace(/<!-- -->/g, "")
}

/** The opening <button …> tag of the button with this text. */
function buttonTag(html: string, text: string): string {
  return new RegExp(`<button[^>]*>(?:(?!</button>).)*${text}`).exec(html)?.[0] ?? ""
}

describe("QuestionBlock", () => {
  test("open question: buttons enabled, free-text hint", async () => {
    const html = await render(null)
    expect(html).toContain("Какую компанию вы имеете в виду?")
    expect(html).toContain("или напишите свой ответ")
    for (const o of ["Вектор \\(Екатеринбург\\)", "Вектор-Плюс", "Другая компания…"]) {
      const tag = buttonTag(html, o)
      expect(tag).not.toBe("")
      expect(tag).not.toContain('disabled=""')
    }
  })

  test("answered: all buttons disabled, the chosen one marked", async () => {
    const html = await render("Вектор-Плюс")
    expect(buttonTag(html, "Вектор-Плюс")).toContain('aria-pressed="true"')
    expect(buttonTag(html, "Вектор-Плюс")).toContain('disabled=""')
    expect(buttonTag(html, "Вектор \\(Екатеринбург\\)")).toContain('aria-pressed="false"')
    expect(buttonTag(html, "Вектор \\(Екатеринбург\\)")).toContain('disabled=""')
    expect(html).not.toContain("или напишите свой ответ")
  })

  test("a request is running: buttons disabled", async () => {
    const html = await render(null, true)
    expect(buttonTag(html, "Вектор-Плюс")).toContain('disabled=""')
  })
})

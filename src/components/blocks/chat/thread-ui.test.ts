import { createElement, type ReactElement } from "react"
import { renderToReadableStream } from "react-dom/server"
import { describe, expect, test } from "vitest"
import { FeedbackButtons, ThreadControls } from "./thread-ui"

async function render(el: ReactElement): Promise<string> {
  const s = await renderToReadableStream(el)
  await s.allReady
  return (await new Response(s).text()).replace(/<!-- -->/g, "")
}

const base = {
  title: "Что у нас по Вектору?",
  currentId: "t1",
  threads: [],
  disabled: false,
  onSelect: () => {},
  onNew: () => {},
  onRename: async () => true,
  onDelete: async () => {},
}

describe("chat history controls", () => {
  test("a saved chat: title, rename, delete, new", async () => {
    const html = await render(createElement(ThreadControls, { ...base, saved: true }))
    expect(html).toContain("Что у нас по Вектору?")
    expect(html).toContain('aria-label="Переименовать чат"')
    expect(html).toContain('aria-label="Удалить чат"')
    expect(html).toContain('aria-label="Новый чат"')
  })

  test("a new empty chat: no rename / delete", async () => {
    const html = await render(createElement(ThreadControls, { ...base, title: "Новый чат", saved: false }))
    expect(html).toContain("Новый чат")
    expect(html).not.toContain("Переименовать чат")
    expect(html).not.toContain("Удалить чат")
  })

  test("thumbs show the stored state", async () => {
    const html = await render(createElement(FeedbackButtons, { messageId: "m1", initial: "down" }))
    expect((html.match(/fill-current/g) ?? []).length).toBe(1)
    expect(html).not.toContain("Что не так с ответом?")
  })
})

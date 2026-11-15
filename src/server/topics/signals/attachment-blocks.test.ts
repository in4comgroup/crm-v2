import { describe, expect, it } from "vitest"
import {
  ATTACHMENT_CUT_MARK,
  ATTACHMENT_LIMITS,
  buildAttachmentBlocks,
  buildSignalItemText,
  cutAttachmentText,
  isEmptySignalItem,
} from "./attachment-blocks"

const para = (n: number, ch = "а") => `${ch.repeat(n - 1)}.`

describe("cutAttachmentText", () => {
  it("returns short text trimmed and unchanged", () => {
    expect(cutAttachmentText("  Счёт № 124  \n", 100)).toBe("Счёт № 124")
  })

  it("cuts at the last paragraph end and adds the mark", () => {
    const text = `${para(60)}\n\n${para(30)}\n\n${para(60)}`
    const cut = cutAttachmentText(text, 120)
    expect(cut).toBe(`${para(60)}\n\n${para(30)}\n${ATTACHMENT_CUT_MARK}`)
    expect(cut.length).toBeLessThanOrEqual(120)
  })

  it("falls back to a line end when there is no paragraph end", () => {
    const text = `${para(70)}\n${para(70)}`
    const cut = cutAttachmentText(text, 100)
    expect(cut).toBe(`${para(70)}\n${ATTACHMENT_CUT_MARK}`)
  })

  it("ignores a paragraph end in the first half and cuts at a line end", () => {
    const text = `${para(10)}\n\n${para(60)}\n${para(60)}`
    const cut = cutAttachmentText(text, 100)
    expect(cut).toBe(`${para(10)}\n\n${para(60)}\n${ATTACHMENT_CUT_MARK}`)
  })

  it("cuts hard when the text has no line break", () => {
    const cut = cutAttachmentText("б".repeat(500), 100)
    expect(cut.length).toBe(100)
    expect(cut.endsWith(`\n${ATTACHMENT_CUT_MARK}`)).toBe(true)
    expect(cut.startsWith("б".repeat(80))).toBe(true)
  })
})

describe("buildAttachmentBlocks", () => {
  it("builds one block per file in order with the heading", () => {
    const blocks = buildAttachmentBlocks([
      { name: "заявка.pdf", content: "\n Нужно 40 коробок \n" },
      { name: "фото.jpg", content: "Накладная № 7" },
    ])
    expect(blocks).toEqual(["### Вложение: заявка.pdf\nНужно 40 коробок", "### Вложение: фото.jpg\nНакладная № 7"])
  })

  it("leaves out empty files and names a nameless one", () => {
    expect(
      buildAttachmentBlocks([
        { name: "пусто.pdf", content: "   " },
        { name: "  ", content: "Текст" },
      ]),
    ).toEqual(["### Вложение: без имени\nТекст"])
  })

  it("caps every file at 6,000 characters", () => {
    const [block] = buildAttachmentBlocks([{ name: "a.pdf", content: "в".repeat(20_000) }])
    const body = block.slice(block.indexOf("\n") + 1)
    expect(body.length).toBeLessThanOrEqual(ATTACHMENT_LIMITS.perFile)
    expect(body.endsWith(ATTACHMENT_CUT_MARK)).toBe(true)
  })

  it("caps all files of one item at 15,000 characters, first files first", () => {
    const big = { content: "г".repeat(10_000) }
    const blocks = buildAttachmentBlocks([
      { name: "1.pdf", ...big },
      { name: "2.pdf", ...big },
      { name: "3.pdf", ...big },
      { name: "4.pdf", content: "Короткий файл" },
    ])
    const bodies = blocks.map((b) => b.slice(b.indexOf("\n") + 1))
    expect(blocks.map((b) => b.split("\n")[0])).toEqual([
      "### Вложение: 1.pdf",
      "### Вложение: 2.pdf",
      "### Вложение: 3.pdf",
    ])
    expect(bodies.reduce((n, b) => n + b.length, 0)).toBeLessThanOrEqual(ATTACHMENT_LIMITS.perItem)
    expect(bodies[0].length).toBe(6_000)
    expect(bodies[1].length).toBe(6_000)
    expect(bodies[2].length).toBe(3_000)
  })

  it("still takes a short file that fits the budget left", () => {
    const blocks = buildAttachmentBlocks(
      [
        { name: "1.pdf", content: "д".repeat(950) },
        { name: "2.pdf", content: "Счёт № 5" },
      ],
      { perFile: 1_000, perItem: 1_000, minBlock: 200 },
    )
    expect(blocks).toHaveLength(2)
  })

  it("returns no block for no files", () => {
    expect(buildAttachmentBlocks([])).toEqual([])
  })
})

describe("buildSignalItemText", () => {
  it("appends the blocks after the message", () => {
    const t = buildSignalItemText("Добрый день, файл во вложении.", [{ name: "a.pdf", content: "Заказ № 12" }])
    expect(t.text).toBe("Добрый день, файл во вложении.\n\n### Вложение: a.pdf\nЗаказ № 12")
    expect(t.ownText).toBe(t.text)
    expect(isEmptySignalItem(t)).toBe(false)
  })

  it("is the message alone without attachments (unchanged behaviour)", () => {
    const t = buildSignalItemText("  Текст  ", [])
    expect(t.text).toBe("Текст")
    expect(t.blocks).toEqual([])
  })

  it("analyses a file-only message", () => {
    const t = buildSignalItemText("", [{ name: "a.pdf", content: "Заказ № 12" }])
    expect(t.text).toBe("### Вложение: a.pdf\nЗаказ № 12")
    expect(isEmptySignalItem(t)).toBe(false)
  })

  it("is empty only when the message and every file are empty", () => {
    expect(isEmptySignalItem(buildSignalItemText(" ", [{ name: "a.pdf", content: "  " }]))).toBe(true)
  })

  it("keeps the quoted history out of the own text but the blocks in", () => {
    const message = "Смотрите файл.\n\nОт: Иван\nОтправлено: 1 ноября\nСтарый текст"
    const t = buildSignalItemText(message, [{ name: "a.pdf", content: "Заказ № 12" }])
    expect(t.ownText).toBe("Смотрите файл.\n\n### Вложение: a.pdf\nЗаказ № 12")
    expect(t.text).toContain("Старый текст")
  })
})

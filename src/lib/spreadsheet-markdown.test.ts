import { describe, expect, it } from "vitest"
import { csvDelimiter, parseCsv, sheetsToMarkdown } from "./spreadsheet-markdown"

describe("spreadsheet → markdown", () => {
  it("one sheet: a table without a sheet heading, empty rows / columns dropped, pipes escaped", () => {
    const md = sheetsToMarkdown([
      {
        name: "Лист1",
        rows: [
          ["Компания", "Сумма", ""],
          ["", "", ""],
          ["Вектор | Плюс", "1 200 000", ""],
        ],
      },
    ])
    expect(md).not.toContain("### Лист")
    expect(md).toContain("| Компания | Сумма |")
    expect(md).toContain("| --- | --- |")
    expect(md).toContain("| Вектор \\| Плюс | 1 200 000 |")
    expect(md).toContain("строк данных: 1")
  })

  it("several sheets get headings; empty sheets are left out; limits are noted", () => {
    const rows = [["A", "B", "C"], ...Array.from({ length: 5 }, (_, i) => [`${i}`, "x", "y"])]
    const md = sheetsToMarkdown(
      [
        { name: "Клиенты", rows },
        { name: "Пусто", rows: [["", ""]] },
        { name: "Итоги", rows: [["Итого"], ["10"]] },
      ],
      { sheets: 10, rowsPerSheet: 3, columns: 2, cellChars: 200, totalChars: 60_000 },
    )
    expect(md).toContain("### Лист «Клиенты»")
    expect(md).toContain("### Лист «Итоги»")
    expect(md).not.toContain("Пусто")
    expect(md).toContain("ещё строк: 2")
    expect(md).toContain("ещё столбцов: 1")
    expect(md).not.toContain("| 3 |")
  })

  it("an empty workbook", () => {
    expect(sheetsToMarkdown([{ name: "Лист1", rows: [] }])).toBe("_(пустая таблица)_")
  })

  it("CSV: delimiter by the first line, quotes, BOM, newlines in quotes", () => {
    expect(csvDelimiter("a;b;c\n1;2;3")).toBe(";")
    expect(csvDelimiter("a,b\n1,2")).toBe(",")
    expect(csvDelimiter("a\tb")).toBe("\t")
    expect(parseCsv('﻿Имя;Комментарий\r\nИван;"Сказал ""да""; потом\nперезвонил"\r\n')).toEqual([
      ["Имя", "Комментарий"],
      ["Иван", 'Сказал "да"; потом\nперезвонил'],
    ])
  })
})

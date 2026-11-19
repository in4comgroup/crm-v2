import { describe, expect, it } from "vitest"
import ExcelJS from "exceljs"
import { sheetsToMarkdown } from "@/lib/spreadsheet-markdown"
import { detectOfficeFormat, isSupportedOfficeType, officeMediaType } from "./office-format"
import { extractSpreadsheetSheets } from "./spreadsheet"

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

describe("office formats", () => {
  it("detects Excel / CSV by type (also with a name= parameter) or extension; legacy .xls stays unsupported", () => {
    expect(detectOfficeFormat(XLSX, "a.bin")).toBe("xlsx")
    expect(detectOfficeFormat(`${XLSX}; name="Отчёт.xlsx"`, "x")).toBe("xlsx")
    expect(detectOfficeFormat("application/octet-stream", "Pipeline.XLSX")).toBe("xlsx")
    expect(detectOfficeFormat("text/csv; charset=utf-8", "x")).toBe("csv")
    expect(detectOfficeFormat("application/octet-stream", "list.csv")).toBe("csv")
    expect(detectOfficeFormat("application/vnd.ms-excel", "old.xls")).toBeNull()
    expect(isSupportedOfficeType("application/octet-stream", "Клиенты.xlsx")).toBe(true)
    // The octet-stream fallback of an Excel file is the Excel type (it was the PowerPoint type before).
    expect(detectOfficeFormat(officeMediaType("xlsx"), "Клиенты.xlsx")).toBe("xlsx")
  })

  it("reads an .xlsx: visible sheets, displayed values, formula results, dates", async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet("Сделки")
    ws.addRow(["Компания", "Сумма", "Дата"])
    ws.addRow(["Вектор", 1200000, new Date(Date.UTC(2026, 10, 19))])
    ws.addRow(["Итого", { formula: "B2*2", result: 2400000 }, null])
    const hidden = wb.addWorksheet("Служебный")
    hidden.state = "hidden"
    hidden.addRow(["секрет"])
    const buf = Buffer.from(await wb.xlsx.writeBuffer())

    const sheets = await extractSpreadsheetSheets(buf, "xlsx", "deals.xlsx")
    expect(sheets.map((s) => s.name)).toEqual(["Сделки"])
    const md = sheetsToMarkdown(sheets)
    expect(md).toContain("| Компания | Сумма | Дата |")
    expect(md).toContain("Вектор")
    expect(md).toContain("1200000")
    expect(md).toContain("2400000")
    expect(md).toMatch(/2026/)
    expect(md).not.toContain("секрет")
  })

  it("reads a CSV in UTF-8 and in Windows-1251 (Russian Excel export)", async () => {
    const utf8 = Buffer.from("﻿Компания;Сумма\nВектор;100\n", "utf8")
    expect((await extractSpreadsheetSheets(utf8, "csv", "a.csv"))[0].rows).toEqual([["Компания", "Сумма"], ["Вектор", "100"]])
    // «Компания;Сумма» in Windows-1251.
    const cp1251 = Buffer.from([0xca, 0xee, 0xec, 0xef, 0xe0, 0xed, 0xe8, 0xff, 0x3b, 0xd1, 0xf3, 0xec, 0xec, 0xe0, 0x0a])
    expect((await extractSpreadsheetSheets(cp1251, "csv", "b.csv"))[0].rows[0]).toEqual(["Компания", "Сумма"])
  })
})

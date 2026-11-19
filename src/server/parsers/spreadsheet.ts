import "server-only"
import ExcelJS from "exceljs"
import { parseCsv, SHEET_LIMITS, type SheetData } from "@/lib/spreadsheet-markdown"

// Spreadsheet extraction (.xlsx via exceljs, .csv) → text rows. No AI here —
// unit-testable; the parser (office.ts) renders them with sheetsToMarkdown.

/** Sheets of a spreadsheet as text rows (exported for tests). */
export async function extractSpreadsheetSheets(buffer: Buffer, format: "xlsx" | "csv", fileName: string): Promise<SheetData[]> {
  return format === "xlsx" ? extractXlsxSheets(buffer) : [{ name: fileName, rows: parseCsv(decodeText(buffer)) }]
}

/** Visible sheets of an .xlsx as text rows (the cell's displayed text; formulas → their result). */
async function extractXlsxSheets(buffer: Buffer): Promise<SheetData[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer as unknown as ArrayBuffer)
  const out: SheetData[] = []
  wb.eachSheet((ws) => {
    if (ws.state && ws.state !== "visible") return
    const rows: string[][] = []
    // A little over the render limit, so «ещё строк» stays right without reading huge sheets whole.
    const maxRows = SHEET_LIMITS.rowsPerSheet + 50
    ws.eachRow({ includeEmpty: false }, (row) => {
      if (rows.length >= maxRows) return
      const cells: string[] = []
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        if (col > SHEET_LIMITS.columns + 5) return
        let text = ""
        try {
          text = cell.text ?? ""
        } catch {
          text = String(cell.value ?? "")
        }
        cells[col - 1] = text
      })
      rows.push(Array.from(cells, (c) => c ?? ""))
    })
    out.push({ name: ws.name, rows })
  })
  return out
}

/** UTF-8 (with or without BOM); a file that is not valid UTF-8 is read as Windows-1251 (Russian Excel CSV). */
function decodeText(buffer: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer)
  } catch {
    return new TextDecoder("windows-1251").decode(buffer)
  }
}

// Spreadsheets (.xlsx / .csv) → Markdown tables (the text of a parsed
// spreadsheet document). PURE, client-safe, unit-tested. The cell values go
// into the document text as they are — the model only writes the summary
// and the metadata, it never retypes a table (no invented numbers).

export type SheetData = { name: string; rows: string[][] }

export const SHEET_LIMITS = {
  /** Sheets rendered (the rest are listed by name). */
  sheets: 10,
  /** Data rows per sheet (after the header row). */
  rowsPerSheet: 200,
  columns: 30,
  cellChars: 200,
  /** Characters of the whole rendered text. */
  totalChars: 60_000,
}
export type SheetLimits = typeof SHEET_LIMITS

const cellText = (v: string, max: number) => {
  const t = (v ?? "").replace(/\s+/g, " ").trim().replace(/\|/g, "\\|")
  return t.length > max ? `${t.slice(0, max)}…` : t
}

/** Rows without empty rows and without empty trailing columns. */
function tidy(rows: string[][]): string[][] {
  const kept = rows.filter((r) => r.some((c) => (c ?? "").trim()))
  let width = 0
  for (const r of kept) {
    for (let i = r.length - 1; i >= 0; i--) {
      if ((r[i] ?? "").trim()) {
        width = Math.max(width, i + 1)
        break
      }
    }
  }
  return kept.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ""))
}

function renderSheet(rows: string[][], l: SheetLimits): string {
  const all = tidy(rows)
  if (!all.length) return "_(пустой лист)_"
  const width = all[0].length
  const cols = Math.min(width, l.columns)
  const cut = (r: string[]) => r.slice(0, cols).map((c) => cellText(c, l.cellChars))
  const [head, ...body] = all
  const out = [`| ${cut(head).map((c) => c || " ").join(" | ")} |`, `| ${cut(head).map(() => "---").join(" | ")} |`]
  for (const r of body.slice(0, l.rowsPerSheet)) out.push(`| ${cut(r).join(" | ")} |`)
  const notes: string[] = []
  if (body.length > l.rowsPerSheet) notes.push(`ещё строк: ${body.length - l.rowsPerSheet}`)
  if (width > cols) notes.push(`ещё столбцов: ${width - cols}`)
  notes.unshift(`строк данных: ${body.length}`)
  return `${out.join("\n")}\n\n_${notes.join(" · ")}_`
}

/** All sheets as Markdown: «### Лист «Имя»» + a table per sheet (one sheet without a heading). */
export function sheetsToMarkdown(sheets: SheetData[], limits: SheetLimits = SHEET_LIMITS): string {
  const used = sheets.filter((s) => tidy(s.rows).length > 0)
  if (!used.length) return "_(пустая таблица)_"
  const parts: string[] = []
  let total = 0
  const shown = used.slice(0, limits.sheets)
  for (let i = 0; i < shown.length; i++) {
    const s = shown[i]
    const block = used.length === 1 ? renderSheet(s.rows, limits) : `### Лист «${s.name}»\n\n${renderSheet(s.rows, limits)}`
    if (total + block.length > limits.totalChars && parts.length) {
      parts.push(`_Не показаны листы: ${shown.slice(i).map((x) => `«${x.name}»`).join(", ")} (текст слишком большой)._`)
      break
    }
    parts.push(block.length > limits.totalChars ? `${block.slice(0, limits.totalChars)}\n\n_… таблица обрезана_` : block)
    total += block.length
  }
  if (used.length > shown.length) parts.push(`_Не показаны листы: ${used.slice(shown.length).map((x) => `«${x.name}»`).join(", ")}._`)
  return parts.join("\n\n")
}

/** Delimiter of a CSV by its first line: «;» (Russian Excel), tab or «,». */
export function csvDelimiter(text: string): string {
  const first = text.split(/\r?\n/, 1)[0] ?? ""
  const count = (ch: string) => first.split(ch).length - 1
  const best = [";", "\t", ","].map((d) => ({ d, n: count(d) })).sort((a, b) => b.n - a.n)[0]
  return best.n > 0 ? best.d : ","
}

/** CSV text → rows (quoted fields, doubled quotes, newlines inside quotes). */
export function parseCsv(text: string, delimiter = csvDelimiter(text)): string[][] {
  const s = text.replace(/^﻿/, "")
  const rows: string[][] = []
  let row: string[] = []
  let cur = ""
  let quoted = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        cur += '"'
        i++
      } else if (c === '"') quoted = false
      else cur += c
      continue
    }
    if (c === '"' && cur === "") quoted = true
    else if (c === delimiter) {
      row.push(cur)
      cur = ""
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++
      row.push(cur)
      rows.push(row)
      row = []
      cur = ""
    } else cur += c
  }
  if (cur !== "" || row.length) {
    row.push(cur)
    rows.push(row)
  }
  return rows
}

// Telegram HTML for the AI chat over Telegram (docs/specs/ai-chat-telegram/
// 01-specification.md §3 L1–L3, §7). PURE and client-safe.
//
// Telegram's `parse_mode: "HTML"` knows only a small tag set: b / strong,
// i / em, u / ins, s / strike / del, tg-spoiler, a href, code, pre,
// pre > code class="language-x", blockquote (+ expandable). No tables, no
// headings. Text escapes only `&`, `<`, `>` (and `"` inside an attribute).
// A message holds ≤ 4,096 characters AFTER entity parsing (UTF-16 units).
//
// Nesting rules of the Bot API ("Formatting options"): b / i / u / s /
// spoiler may contain and be part of any other entity EXCEPT pre and code;
// blockquotes are never nested; all other entities (a, code, pre) never
// contain each other. The renderer below produces only such HTML, and
// `answerAllowedTagsOnly` (render.ts) checks it.

export const TELEGRAM_MAX_TEXT = 4096

/** Escape text for Telegram HTML (`&`, `<`, `>` only — what Telegram requires). */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/** Escape an attribute value (adds `"`). */
export function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;")
}

/** Only absolute http(s) URLs become links (no javascript:, tg:, relative paths). */
export function safeHttpUrl(raw: string): string | null {
  const url = raw.trim()
  if (!/^https?:\/\/[^\s<>"]+$/i.test(url)) return null
  try {
    const u = new URL(url)
    return u.protocol === "http:" || u.protocol === "https:" ? url : null
  } catch {
    return null
  }
}

/** `<a href="…">text</a>` for an http(s) URL; plain escaped text otherwise. */
export function linkHtml(url: string, text: string): string {
  const safe = safeHttpUrl(url)
  return safe ? `<a href="${escapeAttr(safe)}">${escapeHtml(text)}</a>` : escapeHtml(text)
}

// ── Entities / visible length ───────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"' }

function decodeEntity(entity: string): string {
  const body = entity.slice(1, -1)
  if (body[0] === "#") {
    const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
    return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ""
  }
  return NAMED_ENTITIES[body] ?? entity
}

const ENTITY_RE = /&(?:#\d{1,7}|#x[0-9a-f]{1,6}|lt|gt|amp|quot);/gi

/** Text of the HTML as Telegram shows it: tags removed, entities decoded. */
export function htmlToVisibleText(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(ENTITY_RE, decodeEntity)
}

/** Visible length in UTF-16 code units (Telegram counts after entity parsing, in UTF-16). */
export function visibleLength(html: string): number {
  return htmlToVisibleText(html).length
}

// ── Inline markdown ─────────────────────────────────────────────────────

export type InlineCtx = {
  bold: boolean
  italic: boolean
  strike: boolean
  link: boolean
  /** Code spans are allowed only where no other entity is open (and not in a quote). */
  noCode: boolean
}

const TOP: InlineCtx = { bold: false, italic: false, strike: false, link: false, noCode: false }

const isWordChar = (c: string | undefined): boolean => !!c && /[\p{L}\p{N}]/u.test(c)
const isSpace = (c: string | undefined): boolean => c === undefined || /\s/.test(c)
const ASCII_PUNCT = /[!-/:-@[-`{-~]/

function runLength(s: string, i: number, ch: string): number {
  let n = 0
  while (s[i + n] === ch) n++
  return n
}

/** End index (exclusive) of a code span starting at `i` (a backtick run), or -1. */
function codeSpanEnd(s: string, i: number): number {
  const n = runLength(s, i, "`")
  let j = i + n
  while (j < s.length) {
    const k = s.indexOf("`", j)
    if (k < 0) return -1
    const m = runLength(s, k, "`")
    if (m === n) return k + m
    j = k + m
  }
  return -1
}

/**
 * Index of the closing delimiter for `delim` (`*`, `**`, `***`, `_`, `__`,
 * `~~`) searched from `from`; -1 = none. Skips code spans and escapes; a
 * delimiter run must have exactly the delimiter's length.
 */
function findClosing(s: string, from: number, delim: string): number {
  const ch = delim[0]
  let j = from
  while (j < s.length) {
    const c = s[j]
    if (c === "\\") {
      j += 2
      continue
    }
    if (c === "`") {
      const end = codeSpanEnd(s, j)
      j = end < 0 ? j + runLength(s, j, "`") : end
      continue
    }
    if (c === ch) {
      const run = runLength(s, j, ch)
      // «**bold *it***»: a run of 3 closes a `**` with its last two characters.
      const tripleForDouble = delim.length === 2 && run === 3 && ch === "*"
      if ((run === delim.length || tripleForDouble) && j > from && !isSpace(s[j - 1])) {
        if (tripleForDouble) return j + 1
        const after = s[j + run]
        if (ch === "_" && isWordChar(after)) {
          j += run
          continue
        }
        if (ch === "*" && delim.length === 1 && /\d/.test(after ?? "")) {
          j += run
          continue
        }
        return j
      }
      j += run
      continue
    }
    j++
  }
  return -1
}

/** Matching `]` of a `[` at `i` (balanced, code spans skipped); -1 = none. */
function closingBracket(s: string, i: number): number {
  let depth = 0
  let j = i
  while (j < s.length) {
    const c = s[j]
    if (c === "\\") {
      j += 2
      continue
    }
    if (c === "`") {
      const end = codeSpanEnd(s, j)
      j = end < 0 ? j + 1 : end
      continue
    }
    if (c === "[") depth++
    else if (c === "]") {
      depth--
      if (depth === 0) return j
    } else if (c === "\n" && s[j + 1] === "\n") return -1
    j++
  }
  return -1
}

/** `(url "title")` at `i` → [url, end index]; null = not a link destination. */
function linkDestination(s: string, i: number): [string, number] | null {
  if (s[i] !== "(") return null
  let depth = 0
  let j = i
  while (j < s.length) {
    const c = s[j]
    if (c === "\\") {
      j += 2
      continue
    }
    if (c === "(") depth++
    else if (c === ")") {
      depth--
      if (depth === 0) break
    } else if (c === "\n") return null
    j++
  }
  if (j >= s.length) return null
  let inner = s.slice(i + 1, j).trim()
  if (inner.startsWith("<")) {
    const close = inner.indexOf(">")
    inner = close > 0 ? inner.slice(1, close) : inner.slice(1)
  } else {
    inner = inner.split(/\s+/)[0] ?? ""
  }
  return [inner, j + 1]
}

/** Inline markdown → Telegram HTML (no block structure). */
export function inlineMarkdownToHtml(s: string, ctx: InlineCtx = TOP): string {
  let out = ""
  let i = 0
  const inner = (from: number, to: number, next: Partial<InlineCtx>) =>
    inlineMarkdownToHtml(s.slice(from, to), { ...ctx, ...next, noCode: true })

  while (i < s.length) {
    const c = s[i]

    // Escaped punctuation.
    if (c === "\\" && i + 1 < s.length && ASCII_PUNCT.test(s[i + 1])) {
      out += escapeHtml(s[i + 1])
      i += 2
      continue
    }

    // Code span.
    if (c === "`") {
      const end = codeSpanEnd(s, i)
      if (end > 0) {
        const n = runLength(s, i, "`")
        let code = s.slice(i + n, end - n).replace(/\n/g, " ")
        if (/^ .* $/.test(code) && code.trim()) code = code.slice(1, -1)
        out += ctx.noCode ? escapeHtml(code) : `<code>${escapeHtml(code)}</code>`
        i = end
        continue
      }
      const n = runLength(s, i, "`")
      out += escapeHtml(s.slice(i, i + n))
      i += n
      continue
    }

    // Autolink <https://…>.
    if (c === "<") {
      const m = /^<(https?:\/\/[^\s<>]+)>/i.exec(s.slice(i))
      if (m) {
        const url = safeHttpUrl(m[1])
        out += url && !ctx.link ? `<a href="${escapeAttr(url)}">${escapeHtml(m[1])}</a>` : escapeHtml(m[1])
        i += m[0].length
        continue
      }
    }

    // Link [text](url) / image ![alt](url) → its text.
    if (c === "[" || (c === "!" && s[i + 1] === "[")) {
      const open = c === "!" ? i + 1 : i
      const close = closingBracket(s, open)
      if (close > 0) {
        const dest = linkDestination(s, close + 1)
        if (dest) {
          const [rawUrl, end] = dest
          const url = safeHttpUrl(rawUrl)
          const text = inner(open + 1, close, { link: true })
          if (url && !ctx.link && c !== "!") {
            out += `<a href="${escapeAttr(url)}">${text || escapeHtml(rawUrl)}</a>`
          } else {
            out += text
          }
          i = end
          continue
        }
      }
    }

    // Emphasis: *** / ** / * / __ / _ / ~~.
    if (c === "*" || c === "_" || c === "~") {
      const run = runLength(s, i, c)
      const prev = s[i - 1]
      const nextCh = s[i + run]
      const canOpen = !isSpace(nextCh) && !(c === "_" && isWordChar(prev)) && !(c === "*" && run === 1 && /\d/.test(prev ?? ""))
      if (canOpen) {
        const tries: string[] =
          c === "~" ? (run === 2 ? ["~~"] : []) : run >= 3 ? [c.repeat(3), c.repeat(2), c] : run === 2 ? [c.repeat(2)] : [c]
        let done = false
        for (const delim of tries) {
          const close = findClosing(s, i + delim.length, delim)
          if (close < 0) continue
          const from = i + delim.length
          if (close <= from) continue
          let html: string
          if (delim === "~~") {
            const body = inner(from, close, { strike: true })
            html = ctx.strike ? body : `<s>${body}</s>`
          } else if (delim.length === 3) {
            const body = inner(from, close, { bold: true, italic: true })
            const it = ctx.italic ? body : `<i>${body}</i>`
            html = ctx.bold ? it : `<b>${it}</b>`
          } else if (delim.length === 2) {
            const body = inner(from, close, { bold: true })
            html = ctx.bold ? body : `<b>${body}</b>`
          } else {
            const body = inner(from, close, { italic: true })
            html = ctx.italic ? body : `<i>${body}</i>`
          }
          out += html
          i = close + delim.length
          // A longer opening run than the delimiter used: the rest stays literal.
          done = true
          break
        }
        if (done) continue
      }
      out += escapeHtml(s.slice(i, i + run))
      i += run
      continue
    }

    out += escapeHtml(c)
    i++
  }
  return out
}

/** Inline markdown → plain text (for monospace table cells). */
export function inlineMarkdownToText(s: string): string {
  return htmlToVisibleText(inlineMarkdownToHtml(s, { ...TOP, noCode: true }))
}

// ── Tables ──────────────────────────────────────────────────────────────

/** Cells of a pre table: ≤ 18 characters each (spec §7). */
export const PRE_TABLE_MAX_CELL = 18
export const PRE_TABLE_MAX_COLUMNS = 3

const NUMERIC_CELL =
  /^[-+−–]?\d[\d\s  .,]*(?:\s*(?:%|₽|\$|€|¥|£|млн|млрд|тыс\.?|шт\.?|дн\.?|руб\.?|ч\.?|мин\.?))*$/i

export function isNumericCell(cell: string): boolean {
  return NUMERIC_CELL.test(cell.trim())
}

/** Rows (plain text) fit a monospace `pre` table: ≤ 3 columns, every cell ≤ 18 chars. */
export function fitsPreTable(rows: readonly (readonly string[])[]): boolean {
  if (!rows.length) return false
  const cols = Math.max(...rows.map((r) => r.length))
  if (cols < 1 || cols > PRE_TABLE_MAX_COLUMNS) return false
  return rows.every((r) => r.every((c) => c.length <= PRE_TABLE_MAX_CELL))
}

/**
 * Monospace table in `<pre>`: columns padded, numeric columns right-aligned,
 * a rule under the header. Cells are PLAIN text (escaped here).
 */
export function preTableHtml(body: readonly (readonly string[])[], header?: readonly string[]): string {
  const all = header ? [header, ...body] : [...body]
  const cols = Math.max(...all.map((r) => r.length))
  const cell = (r: readonly string[], k: number) => (r[k] ?? "").replace(/\s+/g, " ").trim()
  const widths = Array.from({ length: cols }, (_, k) => Math.max(...all.map((r) => cell(r, k).length)))
  const numeric = Array.from({ length: cols }, (_, k) => {
    const vals = body.map((r) => cell(r, k)).filter(Boolean)
    return vals.length > 0 && vals.every(isNumericCell)
  })
  const line = (r: readonly string[]) =>
    Array.from({ length: cols }, (_, k) => {
      const v = cell(r, k)
      return numeric[k] ? v.padStart(widths[k]) : v.padEnd(widths[k])
    })
      .join("  ")
      .replace(/\s+$/, "")
  const lines: string[] = []
  if (header) {
    lines.push(line(header))
    lines.push("─".repeat(Math.min(40, widths.reduce((a, b) => a + b, 0) + 2 * (cols - 1))))
  }
  for (const r of body) lines.push(line(r))
  return `<pre>${escapeHtml(lines.join("\n"))}</pre>`
}

/**
 * A table as Telegram HTML (spec §7): a `pre` table when it fits
 * (`fitsPreTable` on the plain cells), else one line per row
 * «cell1 — cell2 — cell3» (the header as an italic line first).
 * Cells are MARKDOWN (inline formatting kept in the line form).
 */
export function tableToTelegramHtml(header: readonly string[] | null, rows: readonly (readonly string[])[]): string {
  const plainHeader = header ? header.map(inlineMarkdownToText) : null
  const plainRows = rows.map((r) => r.map(inlineMarkdownToText))
  const headerUseful = plainHeader && plainHeader.some((h) => h.trim())
  if (fitsPreTable(headerUseful && plainHeader ? [plainHeader, ...plainRows] : plainRows)) {
    return preTableHtml(plainRows, headerUseful && plainHeader ? plainHeader : undefined)
  }
  const lines: string[] = []
  if (headerUseful && header) {
    const h = header.map((c) => inlineMarkdownToHtml(c.trim(), { ...TOP, italic: true, noCode: true })).filter(Boolean)
    if (h.length) lines.push(`<i>${h.join(" — ")}</i>`)
  }
  for (const r of rows) {
    const cells = r.map((c) => inlineMarkdownToHtml(c.trim())).filter((c) => c.length > 0)
    if (cells.length) lines.push(cells.join(" — "))
  }
  return lines.join("\n")
}

function splitTableRow(line: string): string[] {
  let t = line.trim()
  if (t.startsWith("|")) t = t.slice(1)
  if (t.endsWith("|") && !t.endsWith("\\|")) t = t.slice(0, -1)
  const cells: string[] = []
  let cur = ""
  let inCode = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (c === "\\" && t[i + 1] === "|") {
      cur += "|"
      i++
      continue
    }
    if (c === "`") inCode = !inCode
    if (c === "|" && !inCode) {
      cells.push(cur.trim())
      cur = ""
      continue
    }
    cur += c
  }
  cells.push(cur.trim())
  return cells
}

const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

// ── Blocks ──────────────────────────────────────────────────────────────

type BlockCtx = { inQuote: boolean }

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+#.-]*)?.*$/
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/
const BULLET = /^(\s*)[-*+]\s+(.*)$/
const ORDERED = /^(\s*)(\d{1,4})[.)]\s+(.*)$/
const QUOTE = /^\s{0,3}>\s?(.*)$/

function renderBlocks(md: string, ctx: BlockCtx): string {
  const lines = md.replace(/\r\n?/g, "\n").split("\n")
  // Output segments; "" = a paragraph border.
  const out: string[] = []
  const inlineCtx: InlineCtx = ctx.inQuote ? { ...TOP, noCode: true } : TOP
  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim()) {
      out.push("")
      i++
      continue
    }

    // Fenced code.
    const fence = FENCE.exec(line)
    if (fence) {
      const marker = fence[1]
      const lang = (fence[2] ?? "").toLowerCase()
      const body: string[] = []
      i++
      while (i < lines.length && !new RegExp(`^\\s{0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}\\s*$`).test(lines[i])) {
        body.push(lines[i])
        i++
      }
      i++ // closing fence (or end)
      const code = body.join("\n").replace(/\s+$/, "")
      if (!code) continue
      if (ctx.inQuote) {
        // A quote cannot hold a pre block: plain text.
        out.push(escapeHtml(code))
      } else if (lang && /^[a-z0-9+#.-]{1,20}$/.test(lang)) {
        out.push(`<pre><code class="language-${escapeAttr(lang)}">${escapeHtml(code)}</code></pre>`)
      } else {
        out.push(`<pre>${escapeHtml(code)}</pre>`)
      }
      out.push("")
      continue
    }

    // Horizontal rule → dropped (a paragraph border).
    if (RULE.test(line)) {
      out.push("")
      i++
      continue
    }

    // Heading → a bold line.
    const heading = HEADING.exec(line)
    if (heading) {
      const text = heading[1].replace(/(\*\*|__)/g, "")
      const html = inlineMarkdownToHtml(text, { ...inlineCtx, bold: true, noCode: true })
      if (html.trim()) out.push(`<b>${html}</b>`)
      i++
      continue
    }

    // Table: a row line followed by a separator line.
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      TABLE_SEPARATOR.test(lines[i + 1]) &&
      lines[i + 1].includes("-") &&
      (lines[i + 1].includes("|") || line.trim().startsWith("|"))
    ) {
      const header = splitTableRow(line)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
        rows.push(splitTableRow(lines[i]))
        i++
      }
      const cols = header.length
      const norm = rows.map((r) => Array.from({ length: cols }, (_, k) => r[k] ?? ""))
      const html = ctx.inQuote ? tableAsLines(header, norm) : tableToTelegramHtml(header, norm)
      if (html) {
        out.push("")
        out.push(html)
        out.push("")
      }
      continue
    }

    // Quote.
    if (QUOTE.test(line)) {
      const body: string[] = []
      while (i < lines.length && QUOTE.test(lines[i])) {
        // Nested «>» levels are flattened (Telegram quotes are never nested).
        body.push(lines[i].replace(/^(\s{0,3}>\s?)+/, ""))
        i++
      }
      if (ctx.inQuote) {
        out.push(renderBlocks(body.join("\n"), ctx))
      } else {
        const inner = renderBlocks(body.join("\n"), { inQuote: true })
        if (inner.trim()) out.push(`<blockquote>${inner}</blockquote>`)
      }
      continue
    }

    // Lists.
    const bullet = BULLET.exec(line)
    if (bullet) {
      const nested = bullet[1].replace(/\t/g, "    ").length >= 2
      out.push(`${nested ? "    ◦ " : "• "}${inlineMarkdownToHtml(bullet[2].replace(/^\[[ xX]\]\s+/, ""), inlineCtx)}`)
      i++
      continue
    }
    const ordered = ORDERED.exec(line)
    if (ordered) {
      const nested = ordered[1].replace(/\t/g, "    ").length >= 2
      out.push(`${nested ? "    " : ""}${ordered[2]}. ${inlineMarkdownToHtml(ordered[3], inlineCtx)}`)
      i++
      continue
    }

    // Paragraph line (soft line breaks kept: the chat model uses them on purpose).
    // A trailing «  » / «\» hard break is just a line break here.
    out.push(inlineMarkdownToHtml(line.replace(/(\s{2,}|\\)$/, "").trim(), inlineCtx))
    i++
  }
  return joinSegments(out)
}

function tableAsLines(header: string[], rows: string[][]): string {
  const lines = rows.map((r) => r.map((c) => inlineMarkdownToHtml(c, { ...TOP, noCode: true })).filter(Boolean).join(" — "))
  const h = header.map((c) => inlineMarkdownToText(c)).filter(Boolean)
  return [h.length ? `<i>${escapeHtml(h.join(" — "))}</i>` : "", ...lines].filter(Boolean).join("\n")
}

/** Segments → text: adjacent lines with "\n", a "" marker = one blank line. */
function joinSegments(segments: string[]): string {
  let out = ""
  let pendingBreak = false
  for (const s of segments) {
    if (s === "") {
      pendingBreak = out.length > 0
      continue
    }
    if (out) out += pendingBreak ? "\n\n" : "\n"
    out += s
    pendingBreak = false
  }
  return out
}

/**
 * The CommonMark-ish subset the chat model writes → Telegram HTML:
 * paragraphs, bold / italic / strike, code, fenced code → `pre`, http(s)
 * links, headings → bold lines, lists → «• » / «1. », quotes → blockquote,
 * tables → a `pre` table or «a — b — c» lines, rules dropped. The output
 * is always balanced HTML of the allowed tags only.
 */
export function markdownToTelegramHtml(md: string): string {
  return renderBlocks(md ?? "", { inQuote: false })
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

// ── Splitting ───────────────────────────────────────────────────────────

type TagAtom = { kind: "open"; name: string; raw: string } | { kind: "close"; name: string; raw: string }
type Atom = TagAtom | { kind: "text"; raw: string; len: number; ch: string }
type Cut = { at: number; stack: TagAtom[]; used: number }

function tokenize(html: string): Atom[] {
  const atoms: Atom[] = []
  const re = /<\/?([a-z][a-z0-9-]*)\b[^>]*>|&(?:#\d{1,7}|#x[0-9a-f]{1,6}|lt|gt|amp|quot);|[\s\S]/giu
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const raw = m[0]
    if (raw.length > 1 && raw[0] === "<") {
      const name = m[1].toLowerCase()
      atoms.push(raw[1] === "/" ? { kind: "close", name, raw } : { kind: "open", name, raw })
    } else if (raw[0] === "&" && raw.length > 1) {
      const ch = decodeEntity(raw)
      atoms.push({ kind: "text", raw, len: ch.length, ch })
    } else {
      atoms.push({ kind: "text", raw, len: raw.length, ch: raw })
    }
  }
  return atoms
}

/**
 * Split Telegram HTML into messages of ≤ `max` VISIBLE characters. Cuts at
 * a paragraph border ("\n\n"), else a line border, else a space, else
 * anywhere — never inside a tag or an entity, and (when possible) never
 * inside a link or inline code. Tags open at a cut are closed and reopened
 * in the next part (a long `pre` / `blockquote` continues there).
 */
export function splitTelegramHtml(html: string, max = TELEGRAM_MAX_TEXT): string[] {
  const text = html.trim()
  if (!text) return []
  if (visibleLength(text) <= max) return [text]

  const atoms = tokenize(text)
  const parts: string[] = []
  // Open tags at the start of the current part (reopened from the last cut).
  let carried: TagAtom[] = []
  let start = 0

  while (start < atoms.length) {
    const stack: TagAtom[] = [...carried]
    let used = 0
    let i = start
    // Best cut candidates: index AFTER which to cut, the stack at that point.
    let para: Cut | null = null
    let line: Cut | null = null
    let space: Cut | null = null
    let overflow = false
    for (; i < atoms.length; i++) {
      const a = atoms[i]
      if (a.kind === "open") {
        stack.push(a)
        continue
      }
      if (a.kind === "close") {
        const k = stack.map((s) => s.name).lastIndexOf(a.name)
        if (k >= 0) stack.splice(k, 1)
        continue
      }
      if (used + a.len > max) {
        overflow = true
        break
      }
      used += a.len
      const inline = stack.some((s) => s.name === "a" || (s.name === "code" && !stack.some((p) => p.name === "pre")))
      if (inline) continue
      if (a.ch === "\n" && atoms[i - 1]?.kind === "text" && (atoms[i - 1] as { ch: string }).ch === "\n") {
        para = { at: i, stack: [...stack], used }
      } else if (a.ch === "\n") {
        line = { at: i, stack: [...stack], used }
      } else if (a.ch === " ") {
        space = { at: i, stack: [...stack], used }
      }
    }
    if (!overflow) {
      parts.push(carried.map((t) => t.raw).join("") + atoms.slice(start).map((t) => t.raw).join(""))
      break
    }
    const half = max / 2
    const pick =
      (para && para.used >= half ? para : null) ??
      (line && line.used >= half ? line : null) ??
      (space && space.used >= half ? space : null) ??
      para ??
      line ??
      space
    let cutAt: number
    let openAtCut: TagAtom[]
    if (pick && pick.at >= start) {
      cutAt = pick.at + 1
      openAtCut = pick.stack
    } else {
      cutAt = i
      openAtCut = stack
    }
    if (cutAt <= start) cutAt = start + 1
    const body = atoms.slice(start, cutAt).map((t) => t.raw).join("")
    const closeTags = [...openAtCut].reverse().map((t) => `</${t.name}>`).join("")
    parts.push(carried.map((t) => t.raw).join("") + body + closeTags)
    carried = openAtCut
    start = cutAt
  }

  return parts.map(tidyPart).filter((p) => htmlToVisibleText(p).trim().length > 0)
}

/** Trim whitespace at the edges of a part's text and drop empty tag pairs. */
function tidyPart(p: string): string {
  let s = p
  // Leading / trailing whitespace right inside or outside of tags.
  s = s.replace(/^((?:<[^>]+>)*)\n+/, "$1").replace(/\s+((?:<\/[^>]+>)*)$/, "$1")
  // Empty pairs created by a cut (e.g. «<b></b>»), repeated for nesting.
  for (let k = 0; k < 4; k++) s = s.replace(/<([a-z][a-z0-9-]*)\b[^>]*>(\s*)<\/\1>/gi, "$2")
  return s.trim()
}

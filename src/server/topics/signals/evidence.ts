// Evidence check (spec topics/01 §5.4 rule 1): the quote must appear in the
// item text — fuzzy, case-, quote- and whitespace-insensitive. PURE.

const squash = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"“”„'’`]/g, "")
    .replace(/[  ]/g, " ")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()

export function evidenceInText(evidence: string, text: string): boolean {
  const e = squash(evidence).replace(/^[.…\s]+|[.…\s]+$/g, "")
  if (!e) return false
  const t = squash(text)
  if (t.includes(e)) return true
  // Ellipsis-joined quotes: every fragment must be present.
  const parts = e
    .split(/…|\.\.\./)
    .map((p) => p.trim())
    .filter((p) => p.length > 3)
  return parts.length > 1 && parts.every((p) => t.includes(p))
}

/**
 * The message text the model judges: the `## Content` section of the parsed
 * markdown (parsers write frontmatter + `## Summary` + `## Content`). The
 * summary is the parser's own wording, so evidence must never come from it.
 * Text without that structure (synthetic items, older rows) is returned
 * without its YAML frontmatter.
 */
export function messageContent(markdown: string): string {
  const m = markdown.match(/(^|\n)## Content[ \t]*\n/)
  if (m && m.index !== undefined) return markdown.slice(m.index + m[0].length).trim()
  const fm = markdown.match(/^---\n[\s\S]*?\n---\n/)
  return (fm ? markdown.slice(fm[0].length) : markdown).trim()
}

// Voice messages in the AI chat over Telegram (docs/specs/ai-chat-telegram/
// 01-specification.md §6.2, decision Q3). PURE and client-safe.
//
// A voice message without text: the transcript IS the member's message, and
// the bot shows it back so a wrong recognition is visible.

import { TELEGRAM_MAX_TEXT, escapeHtml } from "@/lib/telegram/html"

/** Characters of the transcript shown in the open part of the echo. */
export const TRANSCRIPT_ECHO_HEAD = 300

const TOP_LINE = /^\*\*Total duration:\*\*.*$/
// «**0:05** · *12s* · **Speaker 1**» — one header line per segment.
const SEGMENT_HEADER = /^\*\*\d+(?::\d{2}){1,2}\*\*\s*·\s*\*[^*]*\*\s*·\s*\*\*[^*]*\*\*\s*$/
const NO_SPEECH = /^_\(no speech detected\)_$/

/**
 * Spoken text of an audio parser transcript (`renderTranscript` in
 * src/server/parsers/audio.ts — the `## Content` section, or the whole
 * parsed markdown): the duration / speakers line and the per-segment
 * timing / speaker headers are dropped; segments are joined by a newline.
 */
export function transcriptPlainText(content: string): string {
  let text = (content ?? "").replace(/\r\n?/g, "\n")
  // Whole parsed markdown → only its «## Content» section.
  const m = /^##\s+Content\s*$/m.exec(text)
  if (m) {
    text = text.slice(m.index + m[0].length)
    const next = /^##\s+\S/m.exec(text)
    if (next) text = text.slice(0, next.index)
  }
  const segments: string[] = []
  let current: string[] = []
  const flush = () => {
    const s = current.join(" ").replace(/\s+/g, " ").trim()
    if (s) segments.push(s)
    current = []
  }
  for (const raw of text.split("\n")) {
    const line = raw.trim()
    if (TOP_LINE.test(line) || NO_SPEECH.test(line)) continue
    if (SEGMENT_HEADER.test(line)) {
      flush()
      continue
    }
    if (!line) continue
    current.push(line)
  }
  flush()
  return segments.join("\n")
}

/**
 * The echo of a recognised voice message: «🎤 <i>first 300 chars</i>», the
 * rest in an expandable quote. Telegram HTML.
 */
export function transcriptEcho(text: string): string {
  const t = (text ?? "").trim()
  if (!t) return "🎤 <i>(речь не распознана)</i>"
  const chars = Array.from(t)
  if (chars.length <= TRANSCRIPT_ECHO_HEAD) return `🎤 <i>${escapeHtml(t)}</i>`
  // Cut at the last space of the head when there is one (no broken word).
  let head = chars.slice(0, TRANSCRIPT_ECHO_HEAD).join("")
  const space = head.lastIndexOf(" ")
  if (space > TRANSCRIPT_ECHO_HEAD * 0.6) head = head.slice(0, space)
  let rest = t.slice(head.length).trim()
  // One message (≤ 4,096 visible chars): a very long transcript is cut in the quote.
  const room = TELEGRAM_MAX_TEXT - head.length - 8
  if (rest.length > room) rest = `${rest.slice(0, room - 1).replace(/[\uD800-\uDBFF]$/, "")}…`
  return `🎤 <i>${escapeHtml(head)}…</i>\n<blockquote expandable>${escapeHtml(rest)}</blockquote>`
}

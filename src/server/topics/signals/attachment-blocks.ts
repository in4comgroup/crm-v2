// Attachment text in signal extraction (spec telegram/01 §4.6). PURE — no DB,
// no `server-only`, unit-tested in attachment-blocks.test.ts.
//
// The model sees the message text, then one block per parsed attachment:
//
//   ### Вложение: <file name>
//   <the file's `## Content`, trimmed, capped>
//
// The text of a file counts as the AUTHOR's own text (the sender sent the
// file), so evidence may quote it. Quoted mail history is split off the
// MESSAGE text only — the attachment blocks are never treated as history.

import { splitQuotedHistory } from "@/lib/ru-mail"

/** Caps of §4.6: per file and for all files of one item (characters). */
export const ATTACHMENT_LIMITS = {
  perFile: 6_000,
  perItem: 15_000,
  /**
   * A file is left out when less than this is left of the item budget —
   * a few words cut off mid-sentence are noise, not evidence.
   */
  minBlock: 200,
  /**
   * The MESSAGE part is cut here (the old whole-body cap), so a long message
   * never pushes the attachment blocks out of the prompt; the prompt cap
   * (`EXTRACTION_LIMITS.itemChars`) = message + blocks + headings.
   */
  message: 24_000,
} as const

export const ATTACHMENT_CUT_MARK = "[…сокращено]"
export const ATTACHMENT_HEADING = "### Вложение:"

/** One parsed attachment: display name + its `## Content` text. */
export type AttachmentText = { name: string; content: string }

/**
 * Cut `text` to at most `max` characters INCLUDING the cut mark: at the last
 * paragraph end (blank line) in the allowed part, else the last line end,
 * else hard. A paragraph / line end in the first half is not used (it would
 * drop most of the budget). Text that fits is returned trimmed, unchanged.
 */
export function cutAttachmentText(text: string, max: number): string {
  const t = text.trim()
  if (t.length <= max) return t
  const room = max - ATTACHMENT_CUT_MARK.length - 1 // "\n" before the mark
  if (room <= 0) return ""
  const head = t.slice(0, room)
  const floor = Math.floor(room / 2)
  let end = head.lastIndexOf("\n\n")
  if (end < floor) end = head.lastIndexOf("\n")
  if (end < floor) end = room
  const kept = head.slice(0, end).trimEnd()
  return kept ? `${kept}\n${ATTACHMENT_CUT_MARK}` : ""
}

/**
 * One block per file with non-empty content, in the given order (first
 * files first): content ≤ `perFile`, all contents together ≤ `perItem`.
 * Empty files are left out (they say nothing); so are files once the item
 * budget left is below `minBlock`.
 */
export function buildAttachmentBlocks(
  files: readonly AttachmentText[],
  limits: { perFile: number; perItem: number; minBlock: number } = ATTACHMENT_LIMITS,
): string[] {
  const blocks: string[] = []
  let left = limits.perItem
  for (const f of files) {
    const content = f.content.trim()
    if (!content) continue
    const cap = Math.min(limits.perFile, left)
    if (cap < limits.minBlock && content.length > cap) break
    const body = cutAttachmentText(content, cap)
    if (!body) break
    left -= body.length
    const name = f.name.replace(/\s+/g, " ").trim() || "без имени"
    blocks.push(`${ATTACHMENT_HEADING} ${name}\n${body}`)
  }
  return blocks
}

function joinParts(parts: readonly string[]): string {
  return parts.filter((p) => p.trim()).join("\n\n")
}

export type SignalItemText = {
  /** Message text alone (gates, forward detection). */
  messageText: string
  blocks: string[]
  /** What the model sees and what evidence must be in: message + blocks. */
  text: string
  /**
   * The author's own text for the quoted-history check: the message without
   * its quoted history + every attachment block. Null when the message has
   * no own text at all (whole message quoted / forwarded) — no check, as
   * before attachments were read.
   */
  ownText: string | null
}

/** The full extraction input of one item (spec §4.6 points 1–3). */
export function buildSignalItemText(messageText: string, files: readonly AttachmentText[]): SignalItemText {
  const full = messageText.trim()
  const message =
    full.length > ATTACHMENT_LIMITS.message ? `${full.slice(0, ATTACHMENT_LIMITS.message)}\n\n[… текст обрезан]` : full
  const blocks = buildAttachmentBlocks(files)
  const own = message ? splitQuotedHistory(message).own : ""
  return {
    messageText: message,
    blocks,
    text: joinParts([message, ...blocks]),
    ownText: own.trim() ? joinParts([own, ...blocks]) : null,
  }
}

/** «no_text» gate: the message AND every attachment block are empty. */
export function isEmptySignalItem(t: SignalItemText): boolean {
  return !t.messageText && t.blocks.length === 0
}

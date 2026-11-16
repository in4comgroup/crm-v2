// The AI chat as a source of the org (docs/specs/ai-chat/01-specification.md
// §16.2–§16.3, CH6). Pure + client-safe: what a chat segment looks like as a
// source item. Unit-tested.
//
// The one rule that keeps AI answers out of the evidence: the signal
// extractor takes evidence only from the author's OWN text = the text before
// the first quote marker (`splitQuotedHistory`, src/lib/ru-mail/quotes.ts).
// So the segment content is ALL user messages first, then the AI answers as
// one quoted block (every line starts with «> »). Web findings and tool data
// are never written.

/** A thread is ingested after this quiet time (§16.3) … */
export const CHAT_INGEST_IDLE_MINUTES = 30
/** … or when its oldest un-ingested message is this old. */
export const CHAT_INGEST_MAX_WAIT_HOURS = 24
/** Characters of one AI answer kept in the quoted block (context only). */
export const CHAT_INGEST_ANSWER_CHARS = 800
/** Characters of one user message kept (the parse limit of a message). */
export const CHAT_INGEST_USER_CHARS = 8_000

export const AI_ANSWERS_HEADER = "Ответы ИИ (не являются новой информацией):"

export type SegmentMessage = {
  seq: number
  role: "user" | "assistant"
  createdAt: Date
  parts: readonly unknown[]
}

export function chatSegmentExternalId(threadId: string, fromSeq: number, toSeq: number): string {
  return `aichat:${threadId}:${fromSeq}-${toSeq}`
}

export function chatThreadKey(threadId: string): string {
  return `aichat:${threadId}`
}

type Part = { type?: unknown; text?: unknown; url?: unknown; mediaType?: unknown; filename?: unknown }

/** Text of a stored message (its text parts, in order). */
export function messageText(parts: readonly unknown[]): string {
  return parts
    .filter((p): p is Part => !!p && typeof p === "object" && (p as Part).type === "text")
    .map((p) => (typeof p.text === "string" ? p.text : ""))
    .filter((t) => t.trim())
    .join("\n")
    .trim()
}

/** Files of a message already detached + parsed at send (ai-chat-tools §5.2): `data-attachment` parts. */
export function messageAttachments(parts: readonly unknown[]): { itemId: string; name: string; excerpt: string; parsed: boolean }[] {
  const out: { itemId: string; name: string; excerpt: string; parsed: boolean }[] = []
  for (const p of parts as { type?: unknown; data?: unknown }[]) {
    if (!p || p.type !== "data-attachment" || !p.data || typeof p.data !== "object") continue
    const d = p.data as { itemId?: unknown; name?: unknown; excerpt?: unknown; status?: unknown }
    if (typeof d.itemId !== "string") continue
    out.push({
      itemId: d.itemId,
      name: typeof d.name === "string" ? d.name : "file",
      excerpt: typeof d.excerpt === "string" ? d.excerpt : "",
      parsed: d.status === "parsed",
    })
  }
  return out
}

export type SegmentFile = { url: string; mediaType: string; filename: string }

/** Files a user attached that are still stored with their data (data URLs). */
export function messageFiles(parts: readonly unknown[]): SegmentFile[] {
  const out: SegmentFile[] = []
  for (const p of parts as Part[]) {
    if (!p || p.type !== "file" || typeof p.url !== "string" || !p.url.startsWith("data:")) continue
    const mediaType = typeof p.mediaType === "string" ? p.mediaType : "application/octet-stream"
    out.push({ url: p.url, mediaType, filename: typeof p.filename === "string" && p.filename ? p.filename : "file" })
  }
  return out
}

/** Data URL → bytes (base64 or percent-encoded); null when not a data URL. */
export function dataUrlBytes(url: string): Uint8Array | null {
  const m = /^data:([^,]*?)(;base64)?,([\s\S]*)$/.exec(url)
  if (!m) return null
  try {
    if (m[2]) {
      const bin = atob(m[3])
      const out = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
      return out
    }
    return new TextEncoder().encode(decodeURIComponent(m[3]))
  } catch {
    return null
  }
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).trimEnd()} […]` : s)

function stamp(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d)
}

/**
 * `## Content` of a segment: the user's messages (the author's own text),
 * then the AI answers as ONE quoted block. Files are named, not inlined
 * (they become child items).
 */
export function segmentContent(messages: readonly SegmentMessage[], authorName: string, timeZone: string): string {
  const own: string[] = []
  const answers: string[] = []
  for (const m of messages) {
    const text = messageText(m.parts)
    const files =
      m.role === "user" ? [...messageFiles(m.parts).map((f) => f.filename), ...messageAttachments(m.parts).map((a) => a.name)] : []
    if (!text && !files.length) continue
    if (m.role === "user") {
      own.push(
        [
          `**${stamp(m.createdAt, timeZone)} · ${authorName}:**`,
          cut(text, CHAT_INGEST_USER_CHARS),
          ...(files.length ? [`Файлы: ${files.join(", ")}`] : []),
        ]
          .filter(Boolean)
          .join("\n"),
      )
    } else if (text) {
      answers.push(`**${stamp(m.createdAt, timeZone)}:** ${cut(text.replace(/\s+/g, " "), CHAT_INGEST_ANSWER_CHARS)}`)
    }
  }
  const parts = [own.join("\n\n")]
  if (answers.length) {
    parts.push([AI_ANSWERS_HEADER, "", ...answers.flatMap((a, i) => (i ? ["", a] : [a]))].map((l) => `> ${l}`.trimEnd()).join("\n"))
  }
  return parts.filter(Boolean).join("\n\n")
}

/** Transcript for the gate model (`chat.session_analysis`): who said what. */
export function segmentTranscript(messages: readonly SegmentMessage[], authorName: string): string {
  return messages
    .map((m) => {
      const text = messageText(m.parts)
      if (m.role !== "user") return text ? `[Ответ ИИ]\n${cut(text, 2_000)}` : ""
      // The employee's attachments count as the employee's input (a card, notes, a voice message).
      const files = messageAttachments(m.parts)
        .filter((a) => a.parsed && a.excerpt.trim())
        .map((a) => `[Вложение сотрудника «${a.name}»]\n${a.excerpt}`)
      return [text ? `[Сотрудник ${authorName}]\n${cut(text, CHAT_INGEST_USER_CHARS)}` : "", ...files].filter(Boolean).join("\n\n")
    })
    .filter(Boolean)
    .join("\n\n")
}

/** A segment is worth a source item only when the user wrote something (text or a file). */
export function segmentHasUserContent(messages: readonly SegmentMessage[]): boolean {
  return messages.some(
    (m) => m.role === "user" && (messageText(m.parts) || messageFiles(m.parts).length || messageAttachments(m.parts).length),
  )
}

/** Is a thread due for ingest (§16.3)? */
export function chatIngestDue(
  t: { lastMessageAt: Date; oldestPendingAt: Date | null },
  now: Date,
): boolean {
  if (!t.oldestPendingAt) return false
  if (now.getTime() - t.lastMessageAt.getTime() >= CHAT_INGEST_IDLE_MINUTES * 60_000) return true
  return now.getTime() - t.oldestPendingAt.getTime() >= CHAT_INGEST_MAX_WAIT_HOURS * 3_600_000
}

/** Envelope line of a relayed chat note (topics extractor). */
export const CHAT_NOTE_ENVELOPE = "Заметка сотрудника из ИИ чата (пересказ)"

// Chat history rules (docs/specs/ai-chat/01-specification.md §16.1, CH5).
// Pure + client-safe: shared by the chat route, the thread store and the
// chat panel. Unit-tested.

import { chatFileIdFromUrl } from "@/lib/chat/files"

/** Thread ids are made in the browser (a new chat exists before its first send). */
export const THREAD_ID_RE = /^[A-Za-z0-9_-]{8,64}$/
export const THREAD_TITLE_MAX = 60
export const NEW_CHAT_TITLE = "Новый чат"
/** Threads with no message for this long are deleted by the daily pipeline (§16.1). */
export const CHAT_RETENTION_DAYS = 90
/** A thread the user deleted stays this long (CH6 may still send its last segment to sources). */
export const CHAT_DELETED_GRACE_DAYS = 2
/** Messages of a thread loaded for the model and the panel. */
export const THREAD_LOAD_MAX_MESSAGES = 60

/** Text of one user message (limits for the route). */
export const USER_TEXT_MAX_CHARS = 20_000
export const USER_FILES_MAX = 5
/** A file kept in the history as data (base64 data URL chars); larger ones are stored as name only. */
export const STORED_FILE_MAX_CHARS = 700_000

export function isThreadId(v: unknown): v is string {
  return typeof v === "string" && THREAD_ID_RE.test(v)
}

/** Title = the first user question, one line, ≤ 60 characters (§16.1). */
export function threadTitle(text: string | null | undefined): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim()
  if (!t) return NEW_CHAT_TITLE
  return t.length > THREAD_TITLE_MAX ? `${t.slice(0, THREAD_TITLE_MAX - 1).trimEnd()}…` : t
}

/** A title the user typed (rename); null = not valid. */
export function cleanThreadTitle(v: unknown): string | null {
  if (typeof v !== "string") return null
  const t = v.replace(/\s+/g, " ").trim()
  if (!t) return null
  return t.slice(0, 120)
}

type Part = { type: string; [k: string]: unknown }

/** Data parts that belong to the stored answer (re-rendered after a reload). */
const STORED_DATA = new Set(["data-records", "data-stats", "data-evidence", "data-turn", "data-spec", "data-attachment", "data-draft", "data-action-result"])

/**
 * Parts of a UI message as they are stored (§16.1): text, files and our data
 * parts. Never tool calls, reasoning, sources, transient status or the admin
 * debug block. A big file keeps only its name and type (the history must not
 * hold megabytes of base64).
 */
export function partsForStorage(parts: readonly unknown[]): Part[] {
  const out: Part[] = []
  for (const raw of parts) {
    if (!raw || typeof raw !== "object") continue
    const p = raw as Part
    if (p.type === "text") {
      if (typeof p.text === "string" && p.text.length) out.push({ type: "text", text: p.text })
    } else if (p.type === "file") {
      const url = typeof p.url === "string" ? p.url : ""
      const keep = url && url.length <= STORED_FILE_MAX_CHARS
      out.push({
        type: "file",
        mediaType: typeof p.mediaType === "string" ? p.mediaType : "application/octet-stream",
        ...(typeof p.filename === "string" ? { filename: p.filename } : {}),
        url: keep ? url : "",
      })
    } else if (STORED_DATA.has(p.type) && p.data != null) {
      // An attachment's full text is for the current turn only; the stored part keeps the excerpt.
      const data =
        p.type === "data-attachment" && typeof p.data === "object"
          ? Object.fromEntries(Object.entries(p.data as Record<string, unknown>).filter(([k]) => k !== "text"))
          : p.data
      out.push({ type: p.type, ...(typeof p.id === "string" ? { id: p.id } : {}), data })
    }
  }
  return out
}

export type UserMessageInput = { text: string; parts: Part[]; fileIds: string[] }

/**
 * The user message the browser sends (role user; text + files only). Returns
 * null for anything else — the route answers 400.
 */
export function parseUserMessage(raw: unknown): UserMessageInput | null {
  if (!raw || typeof raw !== "object") return null
  const m = raw as { role?: unknown; parts?: unknown }
  if (m.role !== "user" || !Array.isArray(m.parts)) return null
  const parts: Part[] = []
  const fileIds: string[] = []
  let text = ""
  let files = 0
  for (const p of m.parts as Part[]) {
    if (!p || typeof p !== "object") return null
    if (p.type === "text") {
      if (typeof p.text !== "string") return null
      text += (text ? "\n" : "") + p.text
      parts.push({ type: "text", text: p.text })
    } else if (p.type === "file") {
      if (typeof p.url !== "string" || typeof p.mediaType !== "string") return null
      // Files are uploaded first (docs/specs/ai-chat-tools §5.1) — only a
      // reference to the stored item is accepted; data URLs are dropped.
      const id = chatFileIdFromUrl(p.url)
      if (!id) continue
      if (++files > USER_FILES_MAX) return null
      fileIds.push(id)
      parts.push({ type: "file", url: p.url, mediaType: p.mediaType, ...(typeof p.filename === "string" ? { filename: p.filename } : {}) })
    }
    // other part types (step-start, …) are ignored
  }
  if (text.length > USER_TEXT_MAX_CHARS) return null
  if (!text.trim() && files === 0) return null
  return { text, parts, fileIds }
}

/** One chat in the panel's list. */
export type ChatThreadSummary = {
  id: string
  title: string
  createdAt: string
  lastMessageAt: string
  /** CH6: off = «Не передавать в источники». */
  ingestMode?: "on" | "off"
}

export type ChatFeedback = "up" | "down"

export function isChatFeedback(v: unknown): v is ChatFeedback {
  return v === "up" || v === "down"
}

/** Message metadata the panel reads (feedback state of an assistant answer). */
export type ChatMessageMetadata = { feedback?: ChatFeedback | null; feedbackComment?: string | null }

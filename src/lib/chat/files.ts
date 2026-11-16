// Files in the AI chat (docs/specs/ai-chat-tools/01-specification.md §5,
// decision Q22). Client-safe rules shared by the upload route, the chat
// route and the panel. A chat file is detached from the chat at once: it is
// uploaded in chunks to our own route, stored as a source item of the org's
// «AI Chat» source (with its original, like a mail attachment) and parsed by
// the parser of its type. The chat model only ever gets the parsed TEXT.

import { PARSER_CONFIG } from "@/lib/parser-config"

export type ChatFileKind = "image" | "pdf" | "office" | "audio" | "video" | "text"

/** Raw body of one upload request: below the 4.5 MB request limit of a Vercel function. */
export const CHAT_UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024
export const CHAT_TEXT_FILE_MAX_BYTES = 2 * 1024 * 1024
export const CHAT_FILES_PER_MESSAGE = 5
/** Characters of one file's text the model gets in the current turn (the rest via readSource). */
export const CHAT_ATTACHMENT_TEXT_CHARS = 20_000
/** Characters of a file's text kept on the stored message (history note, CH6 gate). */
export const CHAT_ATTACHMENT_EXCERPT_CHARS = 1_500

const TEXT_TYPES = ["text/plain", "text/markdown", "text/csv", "application/json", "text/x-markdown"]
const TEXT_EXT = [".txt", ".md", ".csv", ".json"]

/** `accept` of the file input. Images other than JPEG / PNG are converted to JPEG in the browser. */
export const CHAT_FILE_ACCEPT = [
  "image/*",
  ".pdf",
  ".docx",
  ".pptx",
  ".mp3",
  ".m4a",
  ".aac",
  ".ogg",
  ".oga",
  ".wav",
  ".mp4",
  ...TEXT_EXT,
].join(",")

const ext = (name: string) => {
  const m = /\.[a-z0-9]+$/i.exec(name.trim())
  return m ? m[0].toLowerCase() : ""
}

/** Kind of a chat file by type / extension; null = not accepted. */
export function chatFileKind(mediaType: string, name: string): ChatFileKind | null {
  const mt = (mediaType || "").split(";")[0].trim().toLowerCase()
  const e = ext(name)
  if (mt === "application/pdf" || e === ".pdf") return "pdf"
  if (PARSER_CONFIG.video.supportedMediaTypes.includes(mt) || PARSER_CONFIG.video.supportedExtensions.includes(e)) return "video"
  if (PARSER_CONFIG.audio.supportedMediaTypes.includes(mt) || PARSER_CONFIG.audio.supportedExtensions.includes(e)) return "audio"
  if (PARSER_CONFIG.image.supportedMediaTypes.includes(mt) || PARSER_CONFIG.image.supportedExtensions.includes(e)) return "image"
  if (PARSER_CONFIG.office.supportedMediaTypes.includes(mt) || PARSER_CONFIG.office.supportedExtensions.includes(e)) return "office"
  if (TEXT_TYPES.includes(mt) || TEXT_EXT.includes(e)) return "text"
  return null
}

/** Size limit of a kind = the limit of its parser (a bigger file would be skipped anyway). */
export function chatFileMaxBytes(kind: ChatFileKind): number {
  return kind === "text" ? CHAT_TEXT_FILE_MAX_BYTES : PARSER_CONFIG[kind].maxBytes
}

/** Russian check of a file before upload; null = fine. */
export function chatFileProblem(mediaType: string, name: string, size: number): string | null {
  const kind = chatFileKind(mediaType, name)
  if (!kind) return `Файл «${name}»: такой тип не поддерживается (изображения JPEG / PNG, PDF, DOCX, PPTX, аудио, MP4, TXT / CSV / JSON)`
  const max = chatFileMaxBytes(kind)
  if (size <= 0) return `Файл «${name}» пустой`
  if (size > max) return `Файл «${name}» больше ${Math.round(max / 1024 / 1024)} МБ`
  return null
}

/** The URL a chat file part carries (the org-checked document file route). */
export function chatFileUrl(itemId: string): string {
  return `/api/documents/${encodeURIComponent(itemId)}/file?disposition=inline`
}

/** Item id of a chat file URL; null for anything else (data URLs, foreign URLs). */
export function chatFileIdFromUrl(url: unknown): string | null {
  if (typeof url !== "string") return null
  const m = /^\/api\/documents\/([A-Za-z0-9_-]{8,64})\/file(\?.*)?$/.exec(url)
  return m ? decodeURIComponent(m[1]) : null
}

export function chatUploadParts(size: number): number {
  return Math.max(1, Math.ceil(size / CHAT_UPLOAD_CHUNK_BYTES))
}

/** What a stored user message keeps about one attachment (`data-attachment`). */
export type ChatAttachmentPart = {
  itemId: string
  name: string
  mediaType: string
  kind: ChatFileKind
  status: "parsed" | "skipped" | "failed"
  /** Russian reason when not parsed. */
  reason?: string
  /** Start of the parsed text (history note, CH6 gate). */
  excerpt?: string
  /** Full text for the CURRENT turn only — never stored. */
  text?: string
}

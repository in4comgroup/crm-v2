// Telegram files and groups (docs/specs/telegram/01-telegram-files.md). PURE,
// no network, no DB: which files a Telegram message carries, the 20 MB bot
// download limit, chat kinds and the Russian bot replies.

import type { Message } from "grammy/types"

/** Cloud Bot API: a bot cannot download a file larger than this (`getFile`). */
export const TELEGRAM_BOT_DOWNLOAD_MAX = 20 * 1024 * 1024

export type TelegramFileKind = "document" | "photo" | "video" | "video_note" | "audio"

/** One file of a message, stored in `metadata_json.telegram.attachments[]`. */
export type TelegramFileRef = {
  kind: TelegramFileKind
  fileId: string
  fileUniqueId: string | null
  fileName: string
  mimeType: string
  /** Bytes as Telegram reports them; null = unknown (checked after `getFile`). */
  fileSize: number | null
}

/** Chat kinds we read: private chats with the bot and groups (Q15). Channels never. */
export function isReadableChat(type: string): boolean {
  return type === "private" || type === "group" || type === "supergroup"
}

export function isGroupChat(type: string): boolean {
  return type === "group" || type === "supergroup"
}

/**
 * PURE. Files of a message (Q1, Q3): document, photo (the LARGEST size that a
 * bot can download, else the largest), video, video note, audio file. Voice
 * notes are NOT here (they stay the message text, Q4); stickers, GIFs, polls,
 * locations, contact cards are not files for us.
 */
export function extractTelegramFiles(message: Message): TelegramFileRef[] {
  const out: TelegramFileRef[] = []
  const id = message.message_id
  if (message.document) {
    const d = message.document
    out.push({
      kind: "document",
      fileId: d.file_id,
      fileUniqueId: d.file_unique_id ?? null,
      fileName: d.file_name || `file-${id}`,
      mimeType: d.mime_type || "application/octet-stream",
      fileSize: d.file_size ?? null,
    })
  }
  if (message.photo && message.photo.length > 0) {
    const sizes = [...message.photo].sort((a, b) => (b.file_size ?? b.width * b.height) - (a.file_size ?? a.width * a.height))
    const best = sizes.find((p) => (p.file_size ?? 0) <= TELEGRAM_BOT_DOWNLOAD_MAX) ?? sizes[0]
    out.push({
      kind: "photo",
      fileId: best.file_id,
      fileUniqueId: best.file_unique_id ?? null,
      fileName: `photo-${id}.jpg`,
      mimeType: "image/jpeg",
      fileSize: best.file_size ?? null,
    })
  }
  if (message.video) {
    const v = message.video
    out.push({
      kind: "video",
      fileId: v.file_id,
      fileUniqueId: v.file_unique_id ?? null,
      fileName: v.file_name || `video-${id}.mp4`,
      mimeType: v.mime_type || "video/mp4",
      fileSize: v.file_size ?? null,
    })
  }
  if (message.video_note) {
    const v = message.video_note
    out.push({
      kind: "video_note",
      fileId: v.file_id,
      fileUniqueId: v.file_unique_id ?? null,
      fileName: `video-note-${id}.mp4`,
      mimeType: "video/mp4",
      fileSize: v.file_size ?? null,
    })
  }
  if (message.audio) {
    const a = message.audio
    out.push({
      kind: "audio",
      fileId: a.file_id,
      fileUniqueId: a.file_unique_id ?? null,
      fileName: a.file_name || `audio-${id}.mp3`,
      mimeType: a.mime_type || "audio/mpeg",
      fileSize: a.file_size ?? null,
    })
  }
  return out
}

/** A file the bot cannot download (Telegram's 20 MB limit). */
export function isTooLargeForBot(f: Pick<TelegramFileRef, "fileSize">): boolean {
  return f.fileSize != null && f.fileSize > TELEGRAM_BOT_DOWNLOAD_MAX
}

/** Read `metadata_json.telegram.attachments` back (tolerant). */
export function readTelegramFileRefs(meta: Record<string, unknown> | null | undefined): TelegramFileRef[] {
  const tg = (meta?.telegram ?? null) as Record<string, unknown> | null
  const raw = Array.isArray(tg?.attachments) ? (tg!.attachments as unknown[]) : []
  const out: TelegramFileRef[] = []
  for (const r of raw) {
    if (!r || typeof r !== "object") continue
    const o = r as Record<string, unknown>
    if (typeof o.fileId !== "string" || !o.fileId) continue
    out.push({
      kind: (["document", "photo", "video", "video_note", "audio"] as const).includes(o.kind as TelegramFileKind)
        ? (o.kind as TelegramFileKind)
        : "document",
      fileId: o.fileId,
      fileUniqueId: typeof o.fileUniqueId === "string" ? o.fileUniqueId : null,
      fileName: typeof o.fileName === "string" && o.fileName ? o.fileName : "file",
      mimeType: typeof o.mimeType === "string" && o.mimeType ? o.mimeType : "application/octet-stream",
      fileSize: typeof o.fileSize === "number" ? o.fileSize : null,
    })
  }
  return out
}

/** External id of the i-th file child of a message (unique per source). */
export function telegramFileExternalId(chatId: number | string, messageId: number | string, index: number): string {
  return `tg-att:${chatId}:${messageId}:${index}`
}

// ── Bot replies (Q6, Q7) — private chats only; never in groups (G3) ──────────

export type TelegramAckKind = "text" | "voice" | "file"

export function telegramAckText(kind: TelegramAckKind, inserted: boolean, files = 1): string {
  if (!inserted) return "✅ Уже получено — спасибо."
  if (kind === "voice") return "🎙️ Голосовое получено — расшифровываем."
  if (kind === "file") return files > 1 ? `📎 Файлы получены (${files}) — разбираем.` : "📎 Файл получен — разбираем."
  return "✅ Получено."
}

export function telegramTooLargeText(names: readonly string[]): string {
  const list = names.length ? ` (${names.join(", ")})` : ""
  return `⚠️ Файл больше 20 МБ${list} — Telegram не передаёт боту такие файлы. Отправьте его другим способом.`
}

/** Text of a message with files only (no caption) — keeps the root parsable. */
export function fileOnlyMessageText(files: readonly Pick<TelegramFileRef, "fileName">[]): string {
  return files.map((f) => `Файл: ${f.fileName}`).join("\n")
}

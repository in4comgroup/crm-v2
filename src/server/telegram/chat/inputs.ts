import "server-only"

import { downloadTelegramFile } from "@/lib/telegram"
import { CHAT_UPLOAD_CHUNK_BYTES, chatFileProblem, chatFileUrl } from "@/lib/chat/files"
import { ChatFileError, completeChatUpload, createChatUpload, putChatUploadPart } from "@/server/chat/files"

// Telegram files → AI chat files (docs/specs/ai-chat-telegram §6.2): the
// bytes are downloaded from Telegram (≤ 20 MB) and stored through the SAME
// path as a web chat upload (an «AI Chat» source item with its original), so
// they are parsed and given to the model exactly as in the web chat.

export type ChatFileFromTelegram =
  | { ok: true; itemId: string; url: string; mediaType: string; name: string }
  | { ok: false; name: string; reason: string }

/** Image documents the server cannot convert (the web converts in the browser). */
const IMAGE_NEEDS_PHOTO = /^image\/(heic|heif|webp|gif|bmp|tiff)/i

export async function telegramFileToChat(
  orgId: string,
  userId: string,
  botToken: string,
  ref: { fileId: string; fileName: string; mimeType: string; fileSize: number | null },
): Promise<ChatFileFromTelegram> {
  const name = ref.fileName || "file"
  if (IMAGE_NEEDS_PHOTO.test(ref.mimeType)) return { ok: false, name, reason: "отправьте изображение как фото (не файлом)" }
  const pre = chatFileProblem(ref.mimeType, name, ref.fileSize ?? 1)
  if (pre) return { ok: false, name, reason: pre.replace(/\.$/, "").toLowerCase() }
  try {
    const { bytes } = await downloadTelegramFile(botToken, ref.fileId)
    const up = await createChatUpload(orgId, userId, { name, mediaType: ref.mimeType, size: bytes.byteLength })
    for (let i = 0; i < up.parts; i++) {
      await putChatUploadPart(orgId, userId, up.itemId, i + 1, bytes.subarray(i * CHAT_UPLOAD_CHUNK_BYTES, (i + 1) * CHAT_UPLOAD_CHUNK_BYTES))
    }
    await completeChatUpload(orgId, userId, up.itemId)
    return { ok: true, itemId: up.itemId, url: chatFileUrl(up.itemId), mediaType: ref.mimeType, name }
  } catch (e) {
    if (e instanceof ChatFileError) return { ok: false, name, reason: e.message.replace(/\.$/, "").toLowerCase() }
    console.error("[telegram/chat] file download / store failed", name, e)
    return { ok: false, name, reason: "не удалось скачать файл из Telegram" }
  }
}

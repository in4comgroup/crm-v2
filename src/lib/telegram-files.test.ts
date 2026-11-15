import { describe, expect, it } from "vitest"
import type { Message } from "grammy/types"
import {
  TELEGRAM_BOT_DOWNLOAD_MAX,
  extractTelegramFiles,
  fileOnlyMessageText,
  isGroupChat,
  isReadableChat,
  isTooLargeForBot,
  readTelegramFileRefs,
  telegramAckText,
  telegramFileExternalId,
  telegramTooLargeText,
} from "./telegram-files"

const msg = (o: Record<string, unknown>) => ({ message_id: 7, date: 0, chat: { id: 1, type: "private" }, ...o }) as unknown as Message

describe("extractTelegramFiles", () => {
  it("document keeps name, mime and size", () => {
    const f = extractTelegramFiles(msg({ document: { file_id: "d1", file_unique_id: "u", file_name: "Договор.pdf", mime_type: "application/pdf", file_size: 1000 } }))
    expect(f).toEqual([{ kind: "document", fileId: "d1", fileUniqueId: "u", fileName: "Договор.pdf", mimeType: "application/pdf", fileSize: 1000 }])
  })
  it("photo: the largest size a bot can download", () => {
    const f = extractTelegramFiles(
      msg({
        photo: [
          { file_id: "s", file_unique_id: "a", width: 90, height: 90, file_size: 1_000 },
          { file_id: "m", file_unique_id: "b", width: 800, height: 800, file_size: 200_000 },
          { file_id: "huge", file_unique_id: "c", width: 9000, height: 9000, file_size: TELEGRAM_BOT_DOWNLOAD_MAX + 1 },
        ],
      }),
    )
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ kind: "photo", fileId: "m", fileName: "photo-7.jpg", mimeType: "image/jpeg" })
  })
  it("video, round video, audio file; voice / sticker / GIF are not files", () => {
    expect(extractTelegramFiles(msg({ video: { file_id: "v", file_unique_id: "x", width: 1, height: 1, duration: 1 } }))[0]).toMatchObject({ kind: "video", fileName: "video-7.mp4", mimeType: "video/mp4" })
    expect(extractTelegramFiles(msg({ video_note: { file_id: "n", file_unique_id: "x", length: 1, duration: 1 } }))[0]).toMatchObject({ kind: "video_note", mimeType: "video/mp4" })
    expect(extractTelegramFiles(msg({ audio: { file_id: "a", file_unique_id: "x", duration: 1, mime_type: "audio/mp4", file_name: "call.m4a" } }))[0]).toMatchObject({ kind: "audio", fileName: "call.m4a" })
    expect(extractTelegramFiles(msg({ voice: { file_id: "o", file_unique_id: "x", duration: 3 } }))).toEqual([])
    expect(extractTelegramFiles(msg({ sticker: { file_id: "s" } }))).toEqual([])
    expect(extractTelegramFiles(msg({ animation: { file_id: "g" } }))).toEqual([])
  })
})

describe("helpers", () => {
  it("20 MB limit", () => {
    expect(isTooLargeForBot({ fileSize: TELEGRAM_BOT_DOWNLOAD_MAX })).toBe(false)
    expect(isTooLargeForBot({ fileSize: TELEGRAM_BOT_DOWNLOAD_MAX + 1 })).toBe(true)
    expect(isTooLargeForBot({ fileSize: null })).toBe(false)
  })
  it("chat kinds: private and groups, never channels", () => {
    expect(isReadableChat("private")).toBe(true)
    expect(isReadableChat("supergroup")).toBe(true)
    expect(isReadableChat("channel")).toBe(false)
    expect(isGroupChat("group")).toBe(true)
    expect(isGroupChat("private")).toBe(false)
  })
  it("refs round-trip through metadata and get stable child ids", () => {
    const files = extractTelegramFiles(msg({ document: { file_id: "d1", file_unique_id: "u", file_name: "a.pdf" } }))
    expect(readTelegramFileRefs({ telegram: { attachments: files } })).toEqual(files)
    expect(readTelegramFileRefs({ telegram: { attachments: [{ nope: 1 }] } })).toEqual([])
    expect(telegramFileExternalId(-100, 7, 0)).toBe("tg-att:-100:7:0")
  })
  it("Russian replies", () => {
    expect(telegramAckText("file", true, 3)).toBe("📎 Файлы получены (3) — разбираем.")
    expect(telegramAckText("voice", true)).toContain("Голосовое")
    expect(telegramAckText("text", false)).toContain("Уже получено")
    expect(telegramTooLargeText(["big.mp4"])).toContain("больше 20 МБ (big.mp4)")
    expect(fileOnlyMessageText([{ fileName: "a.pdf" }, { fileName: "b.jpg" }])).toBe("Файл: a.pdf\nФайл: b.jpg")
  })
})

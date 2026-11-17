import { describe, expect, it } from "vitest"
import type { Message } from "grammy/types"
import { inboxEntryFromMessage, mergeInbox, TURN_FILES_MAX } from "./inbox"

const msg = (m: Partial<Message> & Record<string, unknown>): Message =>
  ({ message_id: 10, date: 1_763_400_000, chat: { id: 1, type: "private", first_name: "A" }, from: { id: 1, is_bot: false, first_name: "A" }, ...m }) as unknown as Message

describe("inboxEntryFromMessage", () => {
  it("text, caption + file, voice, contact, forward, unsupported", () => {
    expect(inboxEntryFromMessage(msg({ text: " Привет " })).payload.text).toBe("Привет")
    const f = inboxEntryFromMessage(msg({ caption: "О чём договор?", document: { file_id: "d", file_unique_id: "u", file_name: "a.pdf", mime_type: "application/pdf", file_size: 10 } }))
    expect(f.kind).toBe("file")
    expect(f.payload.files?.[0].fileName).toBe("a.pdf")
    expect(f.payload.text).toBe("О чём договор?")
    expect(inboxEntryFromMessage(msg({ voice: { file_id: "v", file_unique_id: "u", duration: 4 } })).kind).toBe("voice")
    const c = inboxEntryFromMessage(msg({ contact: { phone_number: "+79161234567", first_name: "Пётр", last_name: "Иванов", user_id: 7 } }))
    expect(c.payload.contact).toEqual({ name: "Пётр Иванов", phone: "+79161234567", tgUserId: 7 })
    const fw = inboxEntryFromMessage(msg({ text: "Нужно КП", forward_origin: { type: "user", date: 1_763_300_000, sender_user: { id: 9, is_bot: false, first_name: "Пётр" } } }))
    expect(fw.kind).toBe("forward")
    expect(fw.payload.forward?.from).toBe("Пётр")
    expect(inboxEntryFromMessage(msg({ sticker: { file_id: "s" } as never })).payload.unsupported).toBe("стикер")
  })

  it("reply to the bot: only when the replied message is from THIS bot", () => {
    const r = inboxEntryFromMessage(msg({ text: "а сделки?", reply_to_message: { message_id: 5, date: 1, chat: { id: 1, type: "private" }, from: { id: 99, is_bot: true, first_name: "Bot" }, text: "Альфа ООО — клиент" } as never }), 99)
    expect(r.payload.replyTo).toEqual({ tgMessageId: 5, fromBot: true, text: "Альфа ООО — клиент" })
    const other = inboxEntryFromMessage(msg({ text: "x", reply_to_message: { message_id: 5, date: 1, chat: { id: 1, type: "private" }, from: { id: 98, is_bot: true, first_name: "B" } } as never }), 99)
    expect(other.payload.replyTo?.fromBot).toBe(false)
  })
})

describe("mergeInbox", () => {
  it("joins a split paste and an album into ONE turn", () => {
    const parts = ["часть 1", "часть 2", "часть 3"].map((t) => inboxEntryFromMessage(msg({ text: t })))
    expect(mergeInbox(parts).text).toBe("часть 1\n\nчасть 2\n\nчасть 3")
    const album = [1, 2, 3].map((i) =>
      inboxEntryFromMessage(msg({ message_id: i, media_group_id: "g", ...(i === 1 ? { caption: "Визитки" } : {}), photo: [{ file_id: `p${i}`, file_unique_id: `u${i}`, width: 10, height: 10, file_size: 100 }] })),
    )
    const m = mergeInbox(album)
    expect(m.text).toBe("Визитки")
    expect(m.files).toHaveLength(3)
  })

  it("forwards are quoted data; contacts and options are lines; notices for unsupported / too large / too many", () => {
    const m = mergeInbox([
      inboxEntryFromMessage(msg({ text: "Нужно КП на 200 шт", forward_origin: { type: "hidden_user", date: 1_763_300_000, sender_user_name: "Пётр" } })),
      { kind: "option", mediaGroupId: null, payload: { option: "Вектор (Екатеринбург)" } },
      inboxEntryFromMessage(msg({ sticker: { file_id: "s" } as never })),
      inboxEntryFromMessage(msg({ document: { file_id: "big", file_unique_id: "u", file_name: "big.mp4", mime_type: "video/mp4", file_size: 30 * 1024 * 1024 } })),
    ])
    expect(m.text).toMatch(/^Пересланное сообщение \(от Пётр, \d\d\.\d\d\.\d{4}\):\n«Нужно КП на 200 шт»/)
    expect(m.text).toContain("Вектор (Екатеринбург)")
    expect(m.notices.some((n) => n.includes("стикер"))).toBe(true)
    expect(m.notices.some((n) => n.includes("20 МБ") && n.includes("big.mp4"))).toBe(true)
    expect(m.files).toHaveLength(0)

    const many = mergeInbox(
      Array.from({ length: 7 }, (_, i) => inboxEntryFromMessage(msg({ message_id: i, document: { file_id: `d${i}`, file_unique_id: `u${i}`, file_name: `${i}.pdf`, mime_type: "application/pdf", file_size: 10 } }))),
    )
    expect(many.files).toHaveLength(TURN_FILES_MAX)
    expect(many.notices[0]).toMatch(/первые 5/)
  })

  it("retry is taken alone", () => {
    const m = mergeInbox([{ kind: "retry", mediaGroupId: null, payload: { retry: { threadId: "t1" } } }])
    expect(m.retry).toEqual({ threadId: "t1" })
    expect(m.text).toBe("")
  })
})

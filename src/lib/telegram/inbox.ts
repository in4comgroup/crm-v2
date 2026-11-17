// AI chat over Telegram — inbox rows (docs/specs/ai-chat-telegram §6). PURE,
// no DB, no network: what one Telegram message of a member becomes, and how
// close messages merge into ONE chat turn (§6.1). Unit-tested.

import type { Message } from "grammy/types"
import { extractTelegramFiles, isTooLargeForBot, type TelegramFileRef } from "@/lib/telegram-files"

export type InboxKind = "text" | "voice" | "file" | "contact" | "forward" | "option" | "retry" | "unsupported"

export type InboxPayload = {
  /** Text or caption. */
  text?: string
  voice?: { fileId: string; mimeType: string; duration: number; fileSize: number | null }
  files?: TelegramFileRef[]
  contact?: { name: string; phone: string | null; tgUserId: number | null }
  /** A forwarded message: who wrote it and when (§6.2, Q8). */
  forward?: { from: string; date: number }
  replyTo?: { tgMessageId: number; fromBot: boolean; text: string | null }
  /** Russian label of a kind we do not read (sticker, location …). */
  unsupported?: string
  /** A pressed option of a question (§8.2). */
  option?: string
  /** «Повторить»: answer the last question of this thread again. */
  retry?: { threadId: string }
  /** Unix seconds of the Telegram message. */
  date?: number
}

export type InboxEntry = { kind: InboxKind; payload: InboxPayload; mediaGroupId: string | null }

/** Telegram allows ≤ 5 files per chat turn (= the web chat). */
export const TURN_FILES_MAX = 5
/** Merge window (§6.1): wait this long after the LAST pending message … */
export const MERGE_QUIET_MS = 2_000
/** … but never longer than this after the first one. */
export const MERGE_MAX_MS = 10_000
/** A new thread after this long without a message (Q4). */
export const THREAD_IDLE_MS = 6 * 3_600_000
/** Turn limit per member (Q12). */
export const TURN_LIMIT = { turns: 20, windowMs: 10 * 60_000 }

const UNSUPPORTED: [keyof Message, string][] = [
  ["sticker", "стикер"],
  ["location", "геопозицию"],
  ["venue", "место"],
  ["poll", "опрос"],
  ["dice", "кубик"],
  ["animation", "GIF"],
  ["game", "игру"],
  ["story", "историю"],
]

function originName(m: Message): string {
  const o = m.forward_origin
  if (!o) return "неизвестно"
  switch (o.type) {
    case "user":
      return [o.sender_user.first_name, o.sender_user.last_name].filter(Boolean).join(" ") || (o.sender_user.username ? `@${o.sender_user.username}` : "неизвестно")
    case "hidden_user":
      return o.sender_user_name || "скрытый пользователь"
    case "chat":
      return ("title" in o.sender_chat && o.sender_chat.title) || "чат"
    case "channel":
      return ("title" in o.chat && o.chat.title) || "канал"
    default:
      return "неизвестно"
  }
}

/** One Telegram message of a member → one inbox entry. */
export function inboxEntryFromMessage(message: Message, botId?: number | null): InboxEntry {
  const text = (message.text ?? message.caption ?? "").trim()
  const reply = message.reply_to_message
  const replyTo = reply
    ? {
        tgMessageId: reply.message_id,
        fromBot: !!reply.from?.is_bot && (botId == null || reply.from.id === botId),
        text: (reply.text ?? reply.caption ?? "").trim().slice(0, 500) || null,
      }
    : undefined
  const base: InboxPayload = { ...(text ? { text } : {}), ...(replyTo ? { replyTo } : {}), date: message.date }
  const mediaGroupId = message.media_group_id ?? null

  if (message.voice) {
    const v = message.voice
    return { kind: "voice", mediaGroupId, payload: { ...base, voice: { fileId: v.file_id, mimeType: v.mime_type ?? "audio/ogg", duration: v.duration, fileSize: v.file_size ?? null } } }
  }
  if (message.contact) {
    const c = message.contact
    const name = [c.first_name, c.last_name].filter(Boolean).join(" ").trim()
    return { kind: "contact", mediaGroupId, payload: { ...base, contact: { name, phone: c.phone_number || null, tgUserId: c.user_id ?? null } } }
  }
  const files = extractTelegramFiles(message)
  if (message.forward_origin) {
    return { kind: "forward", mediaGroupId, payload: { ...base, forward: { from: originName(message), date: message.forward_origin.date }, ...(files.length ? { files } : {}) } }
  }
  if (files.length) return { kind: "file", mediaGroupId, payload: { ...base, files } }
  if (text) return { kind: "text", mediaGroupId, payload: base }
  const hit = UNSUPPORTED.find(([k]) => message[k] != null)
  return { kind: "unsupported", mediaGroupId, payload: { ...base, unsupported: hit ? hit[1] : "сообщение" } }
}

const day = (unix: number) => {
  const d = new Date(unix * 1000)
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`
}

export type MergedTurn = {
  /** The user text of the turn (texts, forwards, contacts, options in order). */
  text: string
  files: TelegramFileRef[]
  voices: NonNullable<InboxPayload["voice"]>[]
  /** The LAST reply in the batch (its record = the context, Q9). */
  replyTo: InboxPayload["replyTo"] | null
  /** Russian lines to send back before the answer (unsupported kinds, too large / too many files). */
  notices: string[]
  /** A «Повторить» press: regenerate this thread (alone — never merged with new text). */
  retry: { threadId: string } | null
}

/**
 * Rows of one batch (in order) → one chat turn. A forward is quoted as data
 * («Пересланное сообщение …»), never as the member's own words.
 */
export function mergeInbox(entries: readonly InboxEntry[]): MergedTurn {
  const lines: string[] = []
  const files: TelegramFileRef[] = []
  const voices: MergedTurn["voices"] = []
  const notices: string[] = []
  let replyTo: MergedTurn["replyTo"] = null
  let retry: MergedTurn["retry"] = null
  const tooLarge: string[] = []
  let dropped = 0
  for (const e of entries) {
    const p = e.payload
    if (p.retry) {
      retry = p.retry
      continue
    }
    if (p.replyTo) replyTo = p.replyTo
    if (p.unsupported) {
      notices.push(`Этот тип сообщения (${p.unsupported}) я пока не понимаю. Напишите текстом или голосом.`)
      continue
    }
    if (p.option) lines.push(p.option)
    if (p.contact) lines.push(`Контакт: ${[p.contact.name, p.contact.phone].filter(Boolean).join(", ")}`)
    if (p.forward) {
      const body = p.text ? `\n«${p.text}»` : ""
      lines.push(`Пересланное сообщение (от ${p.forward.from}, ${day(p.forward.date)}):${body}`)
    } else if (p.text) {
      lines.push(p.text)
    }
    if (p.voice) voices.push(p.voice)
    for (const f of p.files ?? []) {
      if (isTooLargeForBot(f)) tooLarge.push(f.fileName)
      else if (files.length < TURN_FILES_MAX) files.push(f)
      else dropped++
    }
  }
  if (tooLarge.length) {
    notices.push(`Файл больше 20 МБ — Telegram не даёт боту его скачать. Загрузите его в CRM: ${tooLarge.map((n) => `«${n}»`).join(", ")}.`)
  }
  if (dropped) notices.push(`Принял первые ${TURN_FILES_MAX} файлов, остальные (${dropped}) — отправьте следующим сообщением.`)
  return { text: lines.join("\n\n").trim(), files, voices, replyTo, notices, retry }
}

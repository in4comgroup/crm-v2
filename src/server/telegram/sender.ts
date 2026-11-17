import "server-only"

import { randomBytes, randomUUID } from "node:crypto"
import { and, eq, gt, isNull, ne } from "drizzle-orm"
import { Bot, GrammyError, InputFile } from "grammy"
import type { InlineKeyboardButton } from "grammy/types"
import { db } from "@/db/drizzle"
import { telegramBinding, telegramButton, telegramOutMessage } from "@/db/schema"

// ONE Telegram sender for every producer (docs/specs/telegram/04 §5.5 C6):
// binding replies, AI chat answers, cards, files — later topic pushes and
// notifications. Telegram HTML, a short-id button store (callback_data ≤ 64
// bytes), 429 `retry_after`, 403 → the binding is `blocked`, a log row per
// message. Never throws: every function returns a result.

export type SendTarget = {
  orgId: string
  sourceId: string
  botToken: string
  chatId: string | number
  /** The member binding (buttons, 403 → blocked); null for an unbound chat. */
  binding?: { id: string; userId: string } | null
}

export type SendMeta = {
  kind: string
  aiChatThreadId?: string | null
  aiChatMessageId?: string | null
  entity?: { type: string; id: string } | null
}

export type SendResult = { ok: true; messageId: number } | { ok: false; error: string; blocked?: boolean }

/**
 * A button action: `kind` + its payload (stored server-side under a short id).
 * The answer renderer's `TgButtonAction`s, plus `retry` / `feedback` /
 * extra fields the worker adds (thread and message ids).
 */
export type ServerButtonAction = { kind: string } & Record<string, unknown>
export type ServerButton = { text: string; action: ServerButtonAction } | { text: string; url: string }

const BUTTON_TTL_MS = 7 * 86_400_000
const MAX_RETRY_WAIT_S = 30

function api(botToken: string) {
  return new Bot(botToken).api
}

/** Plain text of Telegram HTML (fallback when Telegram refuses the markup). */
export function htmlToPlain(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
}

async function log(target: SendTarget, meta: SendMeta, result: SendResult): Promise<void> {
  try {
    await db.insert(telegramOutMessage).values({
      id: randomUUID(),
      organizationId: target.orgId,
      sourceId: target.sourceId,
      bindingId: target.binding?.id ?? null,
      chatId: String(target.chatId),
      kind: meta.kind,
      status: result.ok ? "sent" : "failed",
      error: result.ok ? null : result.error.slice(0, 500),
      tgMessageId: result.ok ? result.messageId : null,
      aiChatThreadId: meta.aiChatThreadId ?? null,
      aiChatMessageId: meta.aiChatMessageId ?? null,
      entityType: meta.entity?.type ?? null,
      entityId: meta.entity?.id ?? null,
    })
  } catch (e) {
    console.warn("[telegram/sender] log failed", e)
  }
}

async function markBlocked(target: SendTarget): Promise<void> {
  if (!target.binding) return
  await db
    .update(telegramBinding)
    .set({ status: "blocked", updatedAt: new Date() })
    .where(and(eq(telegramBinding.id, target.binding.id), eq(telegramBinding.status, "active")))
    .catch((e) => console.warn("[telegram/sender] mark blocked failed", e))
}

/** Run one Bot API call: one retry after a 429; 403 → blocked. */
async function call<T>(target: SendTarget, fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string; code?: number; blocked?: boolean }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return { ok: true, value: await fn() }
    } catch (e) {
      if (e instanceof GrammyError) {
        const wait = e.parameters?.retry_after
        if (e.error_code === 429 && attempt === 0 && wait && wait <= MAX_RETRY_WAIT_S) {
          await new Promise((r) => setTimeout(r, wait * 1000 + 200))
          continue
        }
        if (e.error_code === 403) {
          await markBlocked(target)
          return { ok: false, error: e.description, code: 403, blocked: true }
        }
        return { ok: false, error: e.description, code: e.error_code }
      }
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
  return { ok: false, error: "retry failed" }
}

/** Short random button id; `callback_data` = "b:<id>" (≤ 64 bytes). */
function buttonId(): string {
  return randomBytes(9).toString("base64url")
}

/**
 * Inline keyboard for the rows: action buttons get a stored short id (needs
 * a binding), URL buttons go as they are. Returns the keyboard and the ids.
 */
async function keyboard(target: SendTarget, rows: readonly (readonly ServerButton[])[] | undefined): Promise<{ markup: InlineKeyboardButton[][] | null; ids: string[] }> {
  if (!rows?.length) return { markup: null, ids: [] }
  const markup: InlineKeyboardButton[][] = []
  const ids: string[] = []
  const inserts: (typeof telegramButton.$inferInsert)[] = []
  const expiresAt = new Date(Date.now() + BUTTON_TTL_MS)
  rows.forEach((row, r) => {
    const out: InlineKeyboardButton[] = []
    for (const b of row) {
      if ("url" in b) {
        if (/^https:\/\//i.test(b.url)) out.push({ text: b.text, url: b.url })
        continue
      }
      if (!target.binding) continue
      const id = buttonId()
      ids.push(id)
      const { kind, ...rest } = b.action
      inserts.push({
        id,
        organizationId: target.orgId,
        userId: target.binding.userId,
        bindingId: target.binding.id,
        kind,
        payload: { ...rest, _label: b.text, _row: r },
        expiresAt,
      })
      out.push({ text: b.text, callback_data: `b:${id}` })
    }
    if (out.length) markup.push(out)
  })
  if (inserts.length) await db.insert(telegramButton).values(inserts)
  return { markup: markup.length ? markup : null, ids }
}

async function stampButtons(ids: string[], messageId: number): Promise<void> {
  if (!ids.length) return
  for (const id of ids) {
    await db.update(telegramButton).set({ tgMessageId: messageId }).where(eq(telegramButton.id, id)).catch(() => {})
  }
}

/** Send one HTML message (≤ 4,096 visible chars — the renderer splits). */
export async function sendTelegramHtml(
  target: SendTarget,
  html: string,
  meta: SendMeta,
  opts: { buttons?: readonly (readonly ServerButton[])[]; replyTo?: number } = {},
): Promise<SendResult> {
  const { markup, ids } = await keyboard(target, opts.buttons)
  const other = {
    parse_mode: "HTML" as const,
    link_preview_options: { is_disabled: true },
    ...(markup ? { reply_markup: { inline_keyboard: markup } } : {}),
    ...(opts.replyTo ? { reply_parameters: { message_id: opts.replyTo, allow_sending_without_reply: true } } : {}),
  }
  let res = await call(target, () => api(target.botToken).sendMessage(target.chatId, html, other))
  // Telegram refused the markup → the same text as plain text (never lose an answer).
  if (!res.ok && res.code === 400 && /parse entities|can't find end|unsupported start tag/i.test(res.error)) {
    console.warn("[telegram/sender] HTML refused, sending plain text:", res.error)
    const { parse_mode: _drop, ...plainOther } = other
    void _drop
    res = await call(target, () => api(target.botToken).sendMessage(target.chatId, htmlToPlain(html), plainOther))
  }
  const result: SendResult = res.ok ? { ok: true, messageId: res.value.message_id } : { ok: false, error: res.error, blocked: res.blocked }
  if (result.ok) await stampButtons(ids, result.messageId)
  await log(target, meta, result)
  return result
}

/** Replace the text (and buttons) of a message the bot sent. */
export async function editTelegramHtml(
  target: SendTarget,
  messageId: number,
  html: string,
  buttons?: readonly (readonly ServerButton[])[],
): Promise<boolean> {
  const { markup, ids } = await keyboard(target, buttons)
  const res = await call(target, () =>
    api(target.botToken).editMessageText(target.chatId, messageId, html, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: markup ?? [] },
    }),
  )
  if (res.ok) await stampButtons(ids, messageId)
  else if (!/message is not modified/i.test(res.error)) console.warn("[telegram/sender] edit failed", res.error)
  return res.ok
}

/**
 * Replace only the keyboard of a message, rebuilt from its stored action
 * buttons except `dropKinds` (e.g. remove 👍 / 👎 but keep «📎 CSV»).
 */
export async function dropTelegramButtons(target: SendTarget, messageId: number, dropKinds: readonly string[]): Promise<void> {
  if (!target.binding) return
  const rows = await db
    .select({ id: telegramButton.id, kind: telegramButton.kind, payload: telegramButton.payload })
    .from(telegramButton)
    .where(and(eq(telegramButton.bindingId, target.binding.id), eq(telegramButton.tgMessageId, messageId)))
  const keep = rows.filter((r) => !dropKinds.includes(r.kind))
  const byRow = new Map<number, InlineKeyboardButton[]>()
  for (const r of keep) {
    const p = r.payload as { _label?: string; _row?: number }
    const row = typeof p._row === "number" ? p._row : 0
    if (!byRow.has(row)) byRow.set(row, [])
    byRow.get(row)!.push({ text: p._label ?? "•", callback_data: `b:${r.id}` })
  }
  const markup = [...byRow.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v)
  const res = await call(target, () => api(target.botToken).editMessageReplyMarkup(target.chatId, messageId, { reply_markup: { inline_keyboard: markup } }))
  if (!res.ok && !/message is not modified/i.test(res.error)) console.warn("[telegram/sender] keyboard edit failed", res.error)
  const dropped = rows.filter((r) => dropKinds.includes(r.kind)).map((r) => r.id)
  for (const id of dropped) await db.update(telegramButton).set({ usedAt: new Date() }).where(eq(telegramButton.id, id)).catch(() => {})
}

/** Send a file (≤ 50 MB). */
export async function sendTelegramDocument(
  target: SendTarget,
  file: { bytes: Uint8Array; name: string; caption?: string },
  meta: SendMeta,
): Promise<SendResult> {
  const res = await call(target, () =>
    api(target.botToken).sendDocument(target.chatId, new InputFile(Buffer.from(file.bytes), file.name), file.caption ? { caption: file.caption } : undefined),
  )
  const result: SendResult = res.ok ? { ok: true, messageId: res.value.message_id } : { ok: false, error: res.error, blocked: res.blocked }
  await log(target, meta, result)
  return result
}

/** «печатает…» for ≤ 5 s. Best effort. */
export async function sendTelegramTyping(target: SendTarget): Promise<void> {
  await call(target, () => api(target.botToken).sendChatAction(target.chatId, "typing"))
}

/**
 * A temporary preview of a message being generated (private chats only,
 * Bot API `sendMessageDraft`). Returns false when Telegram refused it — the
 * caller then falls back to «печатает…».
 */
export async function sendTelegramDraft(target: SendTarget, draftId: number, text: string): Promise<boolean> {
  const chat = Number(target.chatId)
  if (!Number.isFinite(chat)) return false
  const res = await call(target, () => api(target.botToken).sendMessageDraft(chat, draftId, text))
  return res.ok
}

/** Answer a button press at once (the client shows a spinner until then). */
export async function answerTelegramCallback(botToken: string, callbackQueryId: string, text?: string): Promise<void> {
  try {
    await api(botToken).answerCallbackQuery(callbackQueryId, text ? { text } : undefined)
  } catch (e) {
    console.warn("[telegram/sender] answerCallbackQuery failed", e)
  }
}

/** The unused, unexpired feedback buttons of a binding (to remove them from older answers). */
export async function openFeedbackMessages(bindingId: string): Promise<number[]> {
  const rows = await db
    .select({ tgMessageId: telegramButton.tgMessageId })
    .from(telegramButton)
    .where(
      and(
        eq(telegramButton.bindingId, bindingId),
        eq(telegramButton.kind, "feedback"),
        isNull(telegramButton.usedAt),
        gt(telegramButton.expiresAt, new Date()),
        ne(telegramButton.tgMessageId, 0),
      ),
    )
  return [...new Set(rows.map((r) => r.tgMessageId).filter((x): x is number => typeof x === "number"))]
}


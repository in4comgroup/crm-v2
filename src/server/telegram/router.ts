import "server-only"

import type { Message, Update } from "grammy/types"
import { db } from "@/db/drizzle"
import { telegramUpdateSeen } from "@/db/schema"
import { inboxEntryFromMessage } from "@/lib/telegram/inbox"
import {
  ingestVerifiedTelegramUpdate,
  parseAndUploadTelegramItem,
  type TelegramWebhookContext,
} from "@/server/ingest/telegram"
import { findTelegramBinding, redeemTelegramBindCode, touchTelegramBinding, unbindTelegram, type TelegramBindingRow } from "@/server/telegram/bindings"
import { sendTelegramHtml, type SendTarget } from "@/server/telegram/sender"
import { enqueueTelegramChat, updatePendingText } from "@/server/telegram/chat/inbox"
import { handleTelegramButton } from "@/server/telegram/chat/buttons"
import { runTelegramChatWorker } from "@/server/telegram/chat/worker"
import { startNewTelegramThread } from "@/server/telegram/chat/threads"
import { TELEGRAM_TEXTS } from "@/lib/telegram/texts"

// ONE router per bot update (docs/specs/telegram/04 §5.5 C2), BEFORE storage:
// a button press → button handler; a command → command handler; a private
// message of a member with an active binding → the AI chat inbox (when the
// org switched the AI chat on); everything else → ingest (source items, as
// before). The secret header is checked by the caller.

export type TelegramUpdateOutcome = "ingested" | "ignored" | "chat" | "command" | "button" | "duplicate"

export type TelegramUpdateResult = {
  outcome: TelegramUpdateOutcome
  itemId?: string
  inserted?: boolean
  /** Work to run after the 200 answer (`after()`), or inline on the manual fetch. */
  deferred: (() => Promise<void>)[]
}

/** The bot's own user id = the number before «:» in its token. */
export function botIdFromToken(token: string): number | null {
  const n = Number(token.split(":")[0])
  return Number.isFinite(n) && n > 0 ? n : null
}

/** First handling of this update id on this bot? (Telegram re-sends unanswered updates, C5.) */
async function firstSeen(sourceId: string, updateId: number): Promise<boolean> {
  const r = await db.insert(telegramUpdateSeen).values({ sourceId, updateId }).onConflictDoNothing().returning({ id: telegramUpdateSeen.updateId })
  return r.length > 0
}

function target(ctx: TelegramWebhookContext, chatId: number, binding?: TelegramBindingRow | null): SendTarget | null {
  if (!ctx.organizationId) return null
  return { orgId: ctx.organizationId, sourceId: ctx.sourceId, botToken: ctx.botToken, chatId, binding: binding ? { id: binding.id, userId: binding.userId } : null }
}

async function reply(ctx: TelegramWebhookContext, chatId: number, html: string, binding?: TelegramBindingRow | null): Promise<void> {
  const t = target(ctx, chatId, binding)
  if (t) await sendTelegramHtml(t, html, { kind: "system" })
}

type RouteOpts = {
  /** The private-chat reply of the ingest (off on the manual fetch). */
  ack: boolean
  /** The user who pressed «Fetch» (parse attribution); null for the webhook. */
  parseUserId?: string | null
}

async function ingest(ctx: TelegramWebhookContext, update: Update, opts: RouteOpts): Promise<TelegramUpdateResult> {
  const r = await ingestVerifiedTelegramUpdate(ctx, update, { ack: opts.ack })
  if (r.outcome === "ingested" && r.inserted && r.itemId) {
    const itemId = r.itemId
    const userId = opts.parseUserId ?? null
    return { outcome: "ingested", itemId, inserted: true, deferred: [() => parseAndUploadTelegramItem(itemId, { userId })] }
  }
  return { outcome: r.outcome, itemId: r.itemId, inserted: r.inserted, deferred: [] }
}

/** `/start <code>`, `/start`, `/stop`, `/new`, `/help`. null = not one of ours (falls through to ingest). */
async function handleCommand(ctx: TelegramWebhookContext, message: Message, text: string): Promise<TelegramUpdateResult | null> {
  const from = message.from
  if (!from) return null
  const [cmdRaw, ...args] = text.trim().split(/\s+/)
  const cmd = cmdRaw.toLowerCase().replace(/@.*$/, "")
  const chatId = message.chat.id
  const binding = await findTelegramBinding(ctx.sourceId, from.id)

  if (cmd === "/start" && args[0]) {
    const r = await redeemTelegramBindCode(ctx.sourceId, from, chatId, args[0])
    if (r.status === "bound") {
      await reply(ctx, chatId, `${TELEGRAM_TEXTS.bound}\n\n${ctx.aiChatEnabled ? TELEGRAM_TEXTS.help : TELEGRAM_TEXTS.aiChatOff}`, r.binding)
    } else {
      await reply(ctx, chatId, r.status === "taken" ? TELEGRAM_TEXTS.bindTaken : r.status === "not_member" ? TELEGRAM_TEXTS.bindNotMember : TELEGRAM_TEXTS.bindInvalid)
    }
    return { outcome: "command", deferred: [] }
  }
  // An unknown person's /start, /help … stays as before (no reply, not stored).
  if (!binding) return null
  const b = await touchTelegramBinding(binding, from)
  switch (cmd) {
    case "/stop":
      await unbindTelegram(b.organizationId, b.userId, "stop_command")
      await reply(ctx, chatId, TELEGRAM_TEXTS.unbound)
      return { outcome: "command", deferred: [] }
    case "/new":
      if (!ctx.aiChatEnabled) await reply(ctx, chatId, TELEGRAM_TEXTS.aiChatOff, b)
      else {
        await startNewTelegramThread(b.id)
        await reply(ctx, chatId, TELEGRAM_TEXTS.newThread, b)
      }
      return { outcome: "command", deferred: [] }
    default:
      // /start without a code, /help, any other command of a member.
      await reply(ctx, chatId, ctx.aiChatEnabled ? TELEGRAM_TEXTS.help : TELEGRAM_TEXTS.aiChatOff, b)
      return { outcome: "command", deferred: [] }
  }
}

export async function handleTelegramUpdate(ctx: TelegramWebhookContext, update: Update, opts: RouteOpts): Promise<TelegramUpdateResult> {
  if (!ctx.organizationId) return ingest(ctx, update, opts)

  // Button press (C8): answered at once inside the handler; the work runs after.
  if (update.callback_query) {
    if (!(await firstSeen(ctx.sourceId, update.update_id))) return { outcome: "duplicate", deferred: [] }
    return { outcome: "button", deferred: await handleTelegramButton(ctx, update.callback_query) }
  }

  // An edit of a message that still waits for its turn (ai-chat-telegram §6.1).
  const edited = update.edited_message
  if (edited) {
    if (edited.chat.type === "private" && edited.from && !edited.from.is_bot) {
      const b = await findTelegramBinding(ctx.sourceId, edited.from.id)
      const text = (edited.text ?? edited.caption ?? "").trim()
      if (b && text) await updatePendingText(b.id, edited.message_id, text)
    }
    return { outcome: "ignored", deferred: [] }
  }

  const message = update.message
  if (!message || message.chat.type !== "private" || !message.from || message.from.is_bot) return ingest(ctx, update, opts)

  const text = (message.text ?? "").trim()
  if (text.startsWith("/")) {
    const r = await handleCommand(ctx, message, text)
    if (r) return r
    return ingest(ctx, update, opts)
  }

  const found = await findTelegramBinding(ctx.sourceId, message.from.id)
  if (!found) return ingest(ctx, update, opts)
  const binding = await touchTelegramBinding(found, message.from)
  // AI chat off: a member's message is stored as before (internal note, telegram/04 Q20).
  if (!ctx.aiChatEnabled) return ingest(ctx, update, opts)

  if (!(await firstSeen(ctx.sourceId, update.update_id))) return { outcome: "duplicate", deferred: [] }
  const entry = inboxEntryFromMessage(message, botIdFromToken(ctx.botToken))
  await enqueueTelegramChat(binding, entry, message.message_id)
  const deferred: (() => Promise<void>)[] = []
  // Q8 (a): a forwarded client message is ALSO saved as the client's message (no ack — the chat answers).
  if (entry.kind === "forward") {
    const r = await ingest(ctx, update, { ...opts, ack: false })
    deferred.push(...r.deferred)
  }
  deferred.push(() => runTelegramChatWorker(ctx, binding.id))
  return { outcome: "chat", deferred }
}

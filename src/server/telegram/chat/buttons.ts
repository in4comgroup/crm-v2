import "server-only"

import { and, eq, isNull } from "drizzle-orm"
import type { CallbackQuery } from "grammy/types"
import { db } from "@/db/drizzle"
import { telegramBinding, telegramButton } from "@/db/schema"
import type { ChatDraftPart } from "@/lib/chat/actions"
import { dataParts } from "@/lib/chat/turn"
import { statsCsv } from "@/lib/chat/stats"
import { escapeHtml } from "@/lib/telegram/html"
import { renderTelegramAnswer, telegramCardConfirmInput, type TgButton } from "@/lib/telegram/render"
import { TELEGRAM_TEXTS } from "@/lib/telegram/texts"
import { runAsMember } from "@/server/acting-member"
import { ChatActionError, cancelChatAction, confirmChatAction, getChatAction } from "@/server/chat/actions/confirm"
import { getChatMessage, getChatThread, setChatMessageFeedback } from "@/server/chat/threads"
import type { TelegramWebhookContext } from "@/server/ingest/telegram"
import { isActiveOrgMember } from "@/server/telegram/bindings"
import { enqueueTelegramChat } from "@/server/telegram/chat/inbox"
import { runTelegramChatWorker } from "@/server/telegram/chat/worker"
import {
  answerTelegramCallback,
  dropTelegramButtons,
  editTelegramHtml,
  sendTelegramDocument,
  sendTelegramHtml,
  type SendTarget,
  type ServerButton,
} from "@/server/telegram/sender"

// Button presses of the AI chat over Telegram (docs/specs/ai-chat-telegram
// §8, Q11; telegram/04 §5.5 C8). `callback_data` = "b:<short id>" → the
// stored button (action, member, expiry). The press is answered AT ONCE; the
// work runs after the webhook's 200. Only the member the button was made for
// may press it (the Telegram user id of its binding).

const SINGLE_USE = new Set(["card_confirm", "card_cancel", "card_decision", "question_option", "retry", "feedback"])

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL ?? "").replace(/\/+$/, "")
}

/** Re-render one draft card (after confirm / cancel) as the card message's new text + buttons. */
function cardMessage(draft: ChatDraftPart, threadId: string): { html: string; buttons?: TgButton[][] } | null {
  const out = renderTelegramAnswer([{ type: "data-draft", id: draft.actionId, data: draft }], { appUrl: appUrl(), threadId })
  return out.find((m) => m.role === "card") ?? null
}

function withIds(rows: TgButton[][] | undefined, threadId: string, messageId: string): ServerButton[][] | undefined {
  return rows?.map((row) => row.map((b): ServerButton => ("url" in b ? { text: b.text, url: b.url } : { text: b.text, action: { ...b.action, threadId, messageId } })))
}

function safeFileName(title: string): string {
  const base = title.replace(/[\\/:*?"<>|\n\r]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60)
  return `${base || "статистика"}.csv`
}

export async function handleTelegramButton(ctx: TelegramWebhookContext, cq: CallbackQuery): Promise<(() => Promise<void>)[]> {
  const data = cq.data ?? ""
  const id = data.startsWith("b:") ? data.slice(2) : ""
  const [btn] = id ? await db.select().from(telegramButton).where(eq(telegramButton.id, id)).limit(1) : []
  const [binding] = btn ? await db.select().from(telegramBinding).where(eq(telegramBinding.id, btn.bindingId)).limit(1) : []
  const valid =
    !!btn &&
    !!binding &&
    binding.sourceId === ctx.sourceId &&
    binding.status !== "unbound" &&
    binding.tgUserId === String(cq.from.id) &&
    btn.expiresAt.getTime() > Date.now() &&
    ctx.aiChatEnabled
  if (!valid || !btn || !binding) {
    await answerTelegramCallback(ctx.botToken, cq.id, TELEGRAM_TEXTS.expiredButton)
    return []
  }
  if (SINGLE_USE.has(btn.kind)) {
    const claimed = await db
      .update(telegramButton)
      .set({ usedAt: new Date() })
      .where(and(eq(telegramButton.id, btn.id), isNull(telegramButton.usedAt)))
      .returning({ id: telegramButton.id })
    if (!claimed.length) {
      await answerTelegramCallback(ctx.botToken, cq.id, TELEGRAM_TEXTS.expiredButton)
      return []
    }
  }
  await answerTelegramCallback(ctx.botToken, cq.id, btn.kind === "feedback" ? TELEGRAM_TEXTS.feedbackThanks : undefined)

  const orgId = binding.organizationId
  const userId = binding.userId
  const p = btn.payload as Record<string, unknown>
  const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "")
  const tgt: SendTarget = { orgId, sourceId: ctx.sourceId, botToken: ctx.botToken, chatId: binding.chatId, binding: { id: binding.id, userId } }
  const messageId = cq.message?.message_id ?? btn.tgMessageId ?? null
  const threadId = str("threadId")

  switch (btn.kind) {
    case "card_confirm":
    case "card_decision":
    case "card_cancel":
      return [
        async () => {
          if (!(await isActiveOrgMember(orgId, userId))) return
          const actionId = str("actionId")
          try {
            const updated = await runAsMember(orgId, userId, "telegram", async () => {
              if (btn.kind === "card_cancel") return cancelChatAction(orgId, userId, actionId)
              const draft = await getChatAction(orgId, userId, actionId)
              const choice = btn.kind === "card_decision" ? { itemKey: str("itemKey"), decision: str("decision"), ...(str("existingId") ? { existingId: str("existingId") } : {}) } : undefined
              const input = telegramCardConfirmInput(draft, choice)
              if (!input) return draft
              return confirmChatAction(orgId, userId, input)
            })
            const card = cardMessage(updated, threadId)
            if (card && messageId) await editTelegramHtml(tgt, messageId, card.html, withIds(card.buttons, threadId, str("messageId")))
          } catch (e) {
            const msg = e instanceof ChatActionError ? e.message : "Не удалось выполнить действие. Откройте карточку в CRM."
            if (!(e instanceof ChatActionError)) console.error("[telegram/chat] card action failed", actionId, e)
            if (e instanceof ChatActionError && e.action && messageId) {
              const card = cardMessage(e.action, threadId)
              if (card) await editTelegramHtml(tgt, messageId, card.html, withIds(card.buttons, threadId, str("messageId")))
            }
            await sendTelegramHtml(tgt, `⚠️ ${escapeHtml(msg)}`, { kind: "chat_notice", aiChatThreadId: threadId || null })
          }
        },
      ]
    case "question_option": {
      const option = str("option")
      if (messageId) {
        const question = escapeHtml(cq.message && "text" in cq.message ? (cq.message.text ?? "") : "")
        await editTelegramHtml(tgt, messageId, `${question}\n\nОтвет: <b>${escapeHtml(option)}</b>`)
      }
      await enqueueTelegramChat(binding, { kind: "option", payload: { option }, mediaGroupId: null }, null)
      return [() => runTelegramChatWorker(ctx, binding.id)]
    }
    case "retry":
      await enqueueTelegramChat(binding, { kind: "retry", payload: { retry: { threadId } }, mediaGroupId: null }, null)
      if (messageId) await dropTelegramButtons(tgt, messageId, ["retry"])
      return [() => runTelegramChatWorker(ctx, binding.id)]
    case "stats_csv":
      return [
        async () => {
          const thread = threadId ? await getChatThread(orgId, userId, threadId) : null
          const msg = thread ? await getChatMessage(thread.id, str("messageId")) : null
          const stats = msg ? dataParts(msg.parts as never, "stats")[Number(p.statsIndex ?? 0)] : null
          if (!stats) {
            await sendTelegramHtml(tgt, "Данные статистики не найдены — спросите ещё раз.", { kind: "chat_notice" })
            return
          }
          const csv = statsCsv(stats)
          const title = (stats as { title?: string; meta?: { title?: string } }).title ?? (stats as { meta?: { title?: string } }).meta?.title ?? "статистика"
          await sendTelegramDocument(tgt, { bytes: new TextEncoder().encode(csv), name: safeFileName(title) }, { kind: "chat_csv", aiChatThreadId: thread?.id ?? null })
        },
      ]
    case "feedback": {
      const value = p.value === "down" ? "down" : "up"
      await setChatMessageFeedback(orgId, userId, str("messageId"), value, null)
      if (messageId) await dropTelegramButtons(tgt, messageId, ["feedback"])
      return []
    }
    default:
      return []
  }
}

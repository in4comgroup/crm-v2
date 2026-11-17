import "server-only"

import { randomBytes } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { telegramBinding, telegramOutMessage } from "@/db/schema"
import { THREAD_IDLE_MS } from "@/lib/telegram/inbox"
import { RECORD_TYPES, type RecordType } from "@/lib/chat/records"
import { getChatThread } from "@/server/chat/threads"
import type { TelegramBindingRow } from "@/server/telegram/bindings"

// Threads of the AI chat over Telegram (docs/specs/ai-chat-telegram §9, Q4):
// the member's CURRENT thread lives on the binding; a new one after `/new`
// or 6 h without a message.

/** A new thread id (`THREAD_ID_RE`-valid). */
export function newTelegramThreadId(): string {
  return `tg_${randomBytes(12).toString("base64url")}`
}

/** The thread for the next turn: the current one if it is the member's, alive and fresh; else a new id. */
export async function resolveTelegramThread(b: TelegramBindingRow, now = new Date()): Promise<string> {
  if (b.aiChatThreadId) {
    const t = await getChatThread(b.organizationId, b.userId, b.aiChatThreadId)
    if (t && now.getTime() - new Date(t.lastMessageAt).getTime() < THREAD_IDLE_MS) return t.id
  }
  return newTelegramThreadId()
}

/** After a turn created / used the thread. */
export async function setTelegramThread(bindingId: string, threadId: string): Promise<void> {
  await db.update(telegramBinding).set({ aiChatThreadId: threadId, updatedAt: new Date() }).where(eq(telegramBinding.id, bindingId))
}

/** `/new`. */
export async function startNewTelegramThread(bindingId: string): Promise<void> {
  await db.update(telegramBinding).set({ aiChatThreadId: null, updatedAt: new Date() }).where(eq(telegramBinding.id, bindingId))
}

/** The record a bot message was about (reply context, Q9); null = none / not ours. */
export async function recordOfBotMessage(sourceId: string, chatId: string, tgMessageId: number): Promise<{ type: RecordType; id: string } | null> {
  const [r] = await db
    .select({ type: telegramOutMessage.entityType, id: telegramOutMessage.entityId })
    .from(telegramOutMessage)
    .where(and(eq(telegramOutMessage.sourceId, sourceId), eq(telegramOutMessage.chatId, chatId), eq(telegramOutMessage.tgMessageId, tgMessageId)))
    .limit(1)
  if (!r?.type || !r.id || !(RECORD_TYPES as readonly string[]).includes(r.type)) return null
  return { type: r.type as RecordType, id: r.id }
}

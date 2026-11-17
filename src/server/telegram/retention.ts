import "server-only"

import { and, inArray, isNotNull, lt, or } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { telegramBindCode, telegramButton, telegramChatInbox, telegramOutMessage, telegramUpdateSeen } from "@/db/schema"

// Retention of the bot's technical rows (docs/specs/telegram/04 §5.5,
// docs/specs/ai-chat-telegram §5): run by the daily pipeline (phase 0).
// The chat messages themselves follow the AI chat retention (90 days).

const DAY_MS = 86_400_000

export async function purgeTelegramRows(now: Date = new Date()): Promise<Record<string, number>> {
  const ago = (days: number) => new Date(now.getTime() - days * DAY_MS)
  const seen = await db.delete(telegramUpdateSeen).where(lt(telegramUpdateSeen.createdAt, ago(7))).returning({ id: telegramUpdateSeen.updateId })
  const codes = await db
    .delete(telegramBindCode)
    .where(or(lt(telegramBindCode.expiresAt, ago(1)), and(isNotNull(telegramBindCode.usedAt), lt(telegramBindCode.usedAt, ago(1)))))
    .returning({ id: telegramBindCode.id })
  // Buttons live 7 days; keep them 7 more (a late press answers «Кнопка устарела»).
  const buttons = await db.delete(telegramButton).where(lt(telegramButton.expiresAt, ago(7))).returning({ id: telegramButton.id })
  const inbox = await db
    .delete(telegramChatInbox)
    .where(and(inArray(telegramChatInbox.status, ["done", "failed"]), lt(telegramChatInbox.createdAt, ago(30))))
    .returning({ id: telegramChatInbox.id })
  const sent = await db.delete(telegramOutMessage).where(lt(telegramOutMessage.createdAt, ago(90))).returning({ id: telegramOutMessage.id })
  return { updates: seen.length, codes: codes.length, buttons: buttons.length, inbox: inbox.length, sent: sent.length }
}

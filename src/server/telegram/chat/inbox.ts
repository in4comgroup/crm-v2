import "server-only"

import { randomUUID } from "node:crypto"
import { and, asc, count, eq, gt, inArray, isNull, lt, or } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { aiChatMessage, aiChatThread, telegramBinding, telegramChatInbox } from "@/db/schema"
import type { InboxEntry } from "@/lib/telegram/inbox"

// Inbox of the AI chat over Telegram (docs/specs/ai-chat-telegram §5): the
// router writes one row per member message and answers 200 at once; ONE
// worker per member (a lock row on the binding) merges close rows into one
// chat turn. Org-explicit through the binding.

/** A worker lock lives this long (turn ≤ 110 s + files + sending). */
const LOCK_MS = 5 * 60_000
/** Pending rows older than this are not answered any more (a lost worker). */
const STALE_MS = 30 * 60_000

export type InboxRow = typeof telegramChatInbox.$inferSelect

export async function enqueueTelegramChat(
  binding: { id: string; organizationId: string; sourceId: string },
  entry: InboxEntry,
  tgMessageId: number | null,
): Promise<string> {
  const id = randomUUID()
  await db.insert(telegramChatInbox).values({
    id,
    organizationId: binding.organizationId,
    bindingId: binding.id,
    sourceId: binding.sourceId,
    tgMessageId,
    kind: entry.kind,
    payload: entry.payload as Record<string, unknown>,
    mediaGroupId: entry.mediaGroupId,
  })
  return id
}

/** An edit of a message that is still waiting updates its text (§6.1); later edits are ignored. */
export async function updatePendingText(bindingId: string, tgMessageId: number, text: string): Promise<boolean> {
  const [row] = await db
    .select({ id: telegramChatInbox.id, payload: telegramChatInbox.payload })
    .from(telegramChatInbox)
    .where(and(eq(telegramChatInbox.bindingId, bindingId), eq(telegramChatInbox.tgMessageId, tgMessageId), eq(telegramChatInbox.status, "pending")))
    .limit(1)
  if (!row) return false
  await db
    .update(telegramChatInbox)
    .set({ payload: { ...(row.payload ?? {}), text } })
    .where(and(eq(telegramChatInbox.id, row.id), eq(telegramChatInbox.status, "pending")))
  return true
}

/** Take the member's worker lock (null = another worker runs). */
export async function acquireChatLock(bindingId: string): Promise<string | null> {
  const token = randomUUID()
  const now = new Date()
  const r = await db
    .update(telegramBinding)
    .set({ chatLockUntil: new Date(now.getTime() + LOCK_MS), chatLockToken: token })
    .where(and(eq(telegramBinding.id, bindingId), or(isNull(telegramBinding.chatLockUntil), lt(telegramBinding.chatLockUntil, now))))
    .returning({ id: telegramBinding.id })
  return r.length ? token : null
}

/** Extend the lock while a long turn runs. */
export async function extendChatLock(bindingId: string, token: string): Promise<void> {
  await db
    .update(telegramBinding)
    .set({ chatLockUntil: new Date(Date.now() + LOCK_MS) })
    .where(and(eq(telegramBinding.id, bindingId), eq(telegramBinding.chatLockToken, token)))
}

export async function releaseChatLock(bindingId: string, token: string): Promise<void> {
  await db
    .update(telegramBinding)
    .set({ chatLockUntil: null, chatLockToken: null })
    .where(and(eq(telegramBinding.id, bindingId), eq(telegramBinding.chatLockToken, token)))
}

/** Times of the member's pending rows (merge window, §6.1). */
export async function pendingTimes(bindingId: string): Promise<{ first: Date; last: Date } | null> {
  const rows = await db
    .select({ at: telegramChatInbox.createdAt })
    .from(telegramChatInbox)
    .where(and(eq(telegramChatInbox.bindingId, bindingId), eq(telegramChatInbox.status, "pending")))
    .orderBy(asc(telegramChatInbox.createdAt))
  if (!rows.length) return null
  return { first: rows[0].at, last: rows[rows.length - 1].at }
}

/**
 * Claim the member's pending rows (call with the lock held). Stale rows are
 * marked failed. A «Повторить» row is claimed ALONE (with nothing before it).
 */
export async function claimPending(bindingId: string): Promise<InboxRow[]> {
  const staleBefore = new Date(Date.now() - STALE_MS)
  await db
    .update(telegramChatInbox)
    .set({ status: "failed", error: "stale", processedAt: new Date() })
    .where(and(eq(telegramChatInbox.bindingId, bindingId), eq(telegramChatInbox.status, "pending"), lt(telegramChatInbox.createdAt, staleBefore)))
  const rows = await db
    .select()
    .from(telegramChatInbox)
    .where(and(eq(telegramChatInbox.bindingId, bindingId), eq(telegramChatInbox.status, "pending")))
    .orderBy(asc(telegramChatInbox.createdAt))
  if (!rows.length) return []
  // A retry runs alone: rows before it make one turn, the retry the next one.
  const firstRetry = rows.findIndex((r) => r.kind === "retry")
  const batch = firstRetry === 0 ? rows.slice(0, 1) : firstRetry > 0 ? rows.slice(0, firstRetry) : rows
  await db
    .update(telegramChatInbox)
    .set({ status: "processing" })
    .where(inArray(telegramChatInbox.id, batch.map((r) => r.id)))
  return batch
}

export async function finishInbox(ids: string[], status: "done" | "failed", extra: { error?: string; threadId?: string | null } = {}): Promise<void> {
  if (!ids.length) return
  await db
    .update(telegramChatInbox)
    .set({ status, error: extra.error ?? null, aiChatThreadId: extra.threadId ?? null, processedAt: new Date() })
    .where(inArray(telegramChatInbox.id, ids))
}

/** Chat turns of the member in Telegram threads in the window (Q12 limit) = their user messages. */
export async function recentTurnCount(orgId: string, userId: string, windowMs: number): Promise<number> {
  const [r] = await db
    .select({ n: count() })
    .from(aiChatMessage)
    .innerJoin(aiChatThread, eq(aiChatThread.id, aiChatMessage.threadId))
    .where(
      and(
        eq(aiChatThread.organizationId, orgId),
        eq(aiChatThread.userId, userId),
        eq(aiChatThread.channel, "telegram"),
        eq(aiChatMessage.role, "user"),
        gt(aiChatMessage.createdAt, new Date(Date.now() - windowMs)),
      ),
    )
  return Number(r?.n ?? 0)
}

export async function hasPending(bindingId: string): Promise<boolean> {
  const [r] = await db
    .select({ id: telegramChatInbox.id })
    .from(telegramChatInbox)
    .where(and(eq(telegramChatInbox.bindingId, bindingId), eq(telegramChatInbox.status, "pending")))
    .limit(1)
  return !!r
}

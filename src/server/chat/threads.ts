import "server-only"

import type { UIMessage } from "ai"
import { and, desc, eq, gt, isNull, lt, max, or, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { aiChatMessage, aiChatThread } from "@/db/schema"
import {
  CHAT_DELETED_GRACE_DAYS,
  CHAT_RETENTION_DAYS,
  THREAD_LOAD_MAX_MESSAGES,
  partsForStorage,
  type ChatFeedback,
  type ChatMessageMetadata,
  type ChatThreadSummary,
} from "@/lib/chat/thread"

// Chat history store (docs/specs/ai-chat/01-specification.md §16.1, CH5).
// Org-explicit (AGENTS.md rules 4–5): the caller passes the org + user from
// the SESSION. A thread belongs to one user in one org; every read checks
// both, so another user — also of the same org — gets "not found".

export type ChatThreadRow = ChatThreadSummary & { ingestMode: "on" | "off" }

const DAY_MS = 86_400_000

/** The user's threads in the org, newest first. */
export async function listChatThreads(orgId: string, userId: string, limit = 50): Promise<ChatThreadRow[]> {
  const rows = await db
    .select({
      id: aiChatThread.id,
      title: aiChatThread.title,
      createdAt: aiChatThread.createdAt,
      lastMessageAt: aiChatThread.lastMessageAt,
      ingestMode: aiChatThread.ingestMode,
    })
    .from(aiChatThread)
    .where(and(eq(aiChatThread.organizationId, orgId), eq(aiChatThread.userId, userId), isNull(aiChatThread.deletedAt)))
    .orderBy(desc(aiChatThread.lastMessageAt))
    .limit(Math.min(Math.max(limit, 1), 200))
  return rows.map((r) => ({ ...r, ingestMode: r.ingestMode === "off" ? "off" : "on", createdAt: r.createdAt.toISOString(), lastMessageAt: r.lastMessageAt.toISOString() }))
}

/** One thread of the user (not deleted) or null. */
export async function getChatThread(orgId: string, userId: string, threadId: string): Promise<ChatThreadRow | null> {
  const [r] = await db
    .select({
      id: aiChatThread.id,
      title: aiChatThread.title,
      createdAt: aiChatThread.createdAt,
      lastMessageAt: aiChatThread.lastMessageAt,
      ingestMode: aiChatThread.ingestMode,
    })
    .from(aiChatThread)
    .where(
      and(
        eq(aiChatThread.id, threadId),
        eq(aiChatThread.organizationId, orgId),
        eq(aiChatThread.userId, userId),
        isNull(aiChatThread.deletedAt),
      ),
    )
    .limit(1)
  return r
    ? { ...r, ingestMode: r.ingestMode === "off" ? "off" : "on", createdAt: r.createdAt.toISOString(), lastMessageAt: r.lastMessageAt.toISOString() }
    : null
}

/**
 * The thread for a send: the user's existing thread, or a new one with this
 * id. null = the id belongs to another user / org or was deleted (the route
 * answers 404 — never reveals whose it is).
 */
export async function ensureChatThread(
  orgId: string,
  userId: string,
  threadId: string,
  title: string,
  ingestMode: "on" | "off" = "on",
): Promise<{ created: boolean } | null> {
  const inserted = await db
    .insert(aiChatThread)
    .values({ id: threadId, organizationId: orgId, userId, title, ingestMode })
    .onConflictDoNothing({ target: aiChatThread.id })
    .returning({ id: aiChatThread.id })
  if (inserted.length) return { created: true }
  return (await getChatThread(orgId, userId, threadId)) ? { created: false } : null
}

/** Last messages of a thread as UI messages (seq order). Call only after an ownership check. */
export async function loadChatMessages(threadId: string, limit = THREAD_LOAD_MAX_MESSAGES): Promise<UIMessage<ChatMessageMetadata>[]> {
  const rows = await db
    .select({
      id: aiChatMessage.id,
      role: aiChatMessage.role,
      parts: aiChatMessage.parts,
      feedback: aiChatMessage.feedback,
      feedbackComment: aiChatMessage.feedbackComment,
    })
    .from(aiChatMessage)
    .where(eq(aiChatMessage.threadId, threadId))
    .orderBy(desc(aiChatMessage.seq))
    .limit(limit)
  return rows.reverse().map((r) => ({
    id: r.id,
    role: r.role === "assistant" ? "assistant" : "user",
    parts: r.parts as UIMessage["parts"],
    ...(r.role === "assistant"
      ? { metadata: { feedback: (r.feedback as ChatFeedback | null) ?? null, feedbackComment: r.feedbackComment ?? null } }
      : {}),
  }))
}

/**
 * Append one message (next seq) and move the thread's last_message_at.
 * Parts go through `partsForStorage` (no tool / reasoning / debug parts).
 * A race of two tabs on one thread → retried once on the seq conflict.
 */
export async function appendChatMessage(
  threadId: string,
  msg: { id: string; role: "user" | "assistant"; parts: readonly unknown[] },
): Promise<number | null> {
  const parts = partsForStorage(msg.parts)
  if (!parts.length) return null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // Never below what was already sent to sources (CH6): after «Повторить»
      // removed an ingested answer, a new message must still count as new.
      const [m] = await db
        .select({ seq: max(aiChatMessage.seq), ingested: max(aiChatThread.ingestedSeq) })
        .from(aiChatThread)
        .leftJoin(aiChatMessage, eq(aiChatMessage.threadId, aiChatThread.id))
        .where(eq(aiChatThread.id, threadId))
      const seq = Math.max(m?.seq ?? 0, m?.ingested ?? 0) + 1
      const now = new Date()
      await db.batch([
        db.insert(aiChatMessage).values({ id: msg.id, threadId, seq, role: msg.role, parts }),
        db
          .update(aiChatThread)
          .set({ lastMessageAt: now, updatedAt: now })
          .where(eq(aiChatThread.id, threadId)),
      ])
      return seq
    } catch (e) {
      if (attempt === 1) throw e
    }
  }
  return null
}

/**
 * Change the stored parts of one message (chat actions: the draft card's
 * status + the `data-action-result` part after confirm). No-op when the
 * message is gone (e.g. removed by «Повторить»).
 */
export async function updateChatMessageParts(
  threadId: string,
  messageId: string,
  update: (parts: unknown[]) => unknown[],
): Promise<boolean> {
  const [m] = await db
    .select({ parts: aiChatMessage.parts })
    .from(aiChatMessage)
    .where(and(eq(aiChatMessage.threadId, threadId), eq(aiChatMessage.id, messageId)))
  if (!m) return false
  const parts = partsForStorage(update([...(m.parts ?? [])]))
  await db.update(aiChatMessage).set({ parts }).where(and(eq(aiChatMessage.threadId, threadId), eq(aiChatMessage.id, messageId)))
  return true
}

/**
 * «Повторить» / regenerate: remove the assistant messages after the last
 * user message. Returns the role of the last message left (null = empty).
 */
export async function dropTrailingAssistant(threadId: string): Promise<"user" | "assistant" | null> {
  const [lastUser] = await db
    .select({ seq: max(aiChatMessage.seq) })
    .from(aiChatMessage)
    .where(and(eq(aiChatMessage.threadId, threadId), eq(aiChatMessage.role, "user")))
  if (lastUser?.seq == null) {
    await db.delete(aiChatMessage).where(eq(aiChatMessage.threadId, threadId))
    return null
  }
  await db.delete(aiChatMessage).where(and(eq(aiChatMessage.threadId, threadId), gt(aiChatMessage.seq, lastUser.seq)))
  return "user"
}

export async function renameChatThread(orgId: string, userId: string, threadId: string, title: string): Promise<boolean> {
  const r = await db
    .update(aiChatThread)
    .set({ title, updatedAt: new Date() })
    .where(
      and(
        eq(aiChatThread.id, threadId),
        eq(aiChatThread.organizationId, orgId),
        eq(aiChatThread.userId, userId),
        isNull(aiChatThread.deletedAt),
      ),
    )
    .returning({ id: aiChatThread.id })
  return r.length > 0
}

/** «Не передавать в источники» (§16.3): on = segments go to the org's «AI Chat» source. */
export async function setChatThreadIngestMode(
  orgId: string,
  userId: string,
  threadId: string,
  mode: "on" | "off",
): Promise<boolean> {
  const r = await db
    .update(aiChatThread)
    .set({ ingestMode: mode, updatedAt: new Date() })
    .where(
      and(
        eq(aiChatThread.id, threadId),
        eq(aiChatThread.organizationId, orgId),
        eq(aiChatThread.userId, userId),
        isNull(aiChatThread.deletedAt),
      ),
    )
    .returning({ id: aiChatThread.id })
  return r.length > 0
}

/** «Удалить чат»: hidden at once, removed by the daily pipeline later. */
export async function deleteChatThread(orgId: string, userId: string, threadId: string): Promise<boolean> {
  const now = new Date()
  const r = await db
    .update(aiChatThread)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        eq(aiChatThread.id, threadId),
        eq(aiChatThread.organizationId, orgId),
        eq(aiChatThread.userId, userId),
        isNull(aiChatThread.deletedAt),
      ),
    )
    .returning({ id: aiChatThread.id })
  return r.length > 0
}

/** Thumbs up / down on an assistant answer of the user's own thread (Q14). null clears it. */
export async function setChatMessageFeedback(
  orgId: string,
  userId: string,
  messageId: string,
  feedback: ChatFeedback | null,
  comment: string | null,
): Promise<boolean> {
  const own = db
    .select({ id: aiChatThread.id })
    .from(aiChatThread)
    .where(
      and(eq(aiChatThread.organizationId, orgId), eq(aiChatThread.userId, userId), isNull(aiChatThread.deletedAt)),
    )
  const r = await db
    .update(aiChatMessage)
    .set({
      feedback,
      feedbackComment: feedback ? (comment?.trim().slice(0, 2000) || null) : null,
      feedbackAt: feedback ? new Date() : null,
    })
    .where(
      and(
        eq(aiChatMessage.id, messageId),
        eq(aiChatMessage.role, "assistant"),
        sql`${aiChatMessage.threadId} in (${own})`,
      ),
    )
    .returning({ id: aiChatMessage.id })
  return r.length > 0
}

/**
 * Retention (§16.1), daily pipeline: delete threads with no message for 90
 * days and threads the user deleted ≥ 2 days ago (messages cascade). Source
 * items made from them stay (Q23).
 */
export async function purgeChatThreads(now: Date = new Date()): Promise<{ deleted: number }> {
  const old = new Date(now.getTime() - CHAT_RETENTION_DAYS * DAY_MS)
  const deletedBefore = new Date(now.getTime() - CHAT_DELETED_GRACE_DAYS * DAY_MS)
  const r = await db
    .delete(aiChatThread)
    .where(or(lt(aiChatThread.lastMessageAt, old), lt(aiChatThread.deletedAt, deletedBefore)))
    .returning({ id: aiChatThread.id })
  return { deleted: r.length }
}


import "server-only"

import { and, eq, gt, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { aiChatAction } from "@/db/schema"
import {
  ACTION_LIMITS,
  isOpenActionStatus,
  type ActionKind,
  type ActionResult,
  type ActionStatus,
  type ChatActionResultPart,
  type ChatDraft,
  type ChatDraftPart,
} from "@/lib/chat/actions"
import { updateChatMessageParts } from "@/server/chat/threads"

// Rows of `ai_chat_action` (docs/specs/ai-chat-tools §13). Org + user are
// explicit and checked on every read: another user — also of the same org —
// never sees or confirms a draft.

export type ActionRow = typeof aiChatAction.$inferSelect

export async function insertAction(row: {
  id: string
  orgId: string
  userId: string
  threadId: string
  messageId: string
  kind: ActionKind
  status: ActionStatus
  draft: ChatDraft
}): Promise<void> {
  await db.insert(aiChatAction).values({
    id: row.id,
    organizationId: row.orgId,
    userId: row.userId,
    threadId: row.threadId,
    messageId: row.messageId,
    kind: row.kind,
    status: row.status,
    draft: row.draft,
    sourceItemIds: draftFileIds(row.draft),
  })
}

export async function updateActionDraft(id: string, kind: ActionKind, status: ActionStatus, draft: ChatDraft): Promise<void> {
  await db
    .update(aiChatAction)
    .set({ kind, status, draft, sourceItemIds: draftFileIds(draft), updatedAt: new Date() })
    .where(eq(aiChatAction.id, id))
}

/** Files the values of a draft came from (the card's «Прикрепить файл»). */
export function draftFileIds(d: ChatDraft): string[] {
  return d.files.map((f) => f.itemId)
}

export async function loadAction(orgId: string, userId: string, id: string): Promise<ActionRow | null> {
  const [r] = await db
    .select()
    .from(aiChatAction)
    .where(and(eq(aiChatAction.id, id), eq(aiChatAction.organizationId, orgId), eq(aiChatAction.userId, userId)))
  if (!r) return null
  // A draft lives 7 days (§8.5).
  if (isOpenActionStatus(r.status) && Date.now() - r.createdAt.getTime() > ACTION_LIMITS.draftTtlDays * 86_400_000) {
    await db.update(aiChatAction).set({ status: "expired", updatedAt: new Date() }).where(eq(aiChatAction.id, id))
    return { ...r, status: "expired" }
  }
  return r
}

export function actionPart(r: ActionRow): ChatDraftPart {
  return {
    actionId: r.id,
    kind: r.kind as ActionKind,
    status: r.status as ActionStatus,
    draft: r.draft as ChatDraft,
    results: (r.results ?? []) as ActionResult[],
    error: r.error,
  }
}

/** Take the row for a confirm (open → confirming); false = another request has it / not open. */
export async function claimAction(id: string): Promise<boolean> {
  const r = await db
    .update(aiChatAction)
    .set({ status: "confirming", updatedAt: new Date() })
    .where(and(eq(aiChatAction.id, id), sql`${aiChatAction.status} in ('draft', 'needs_input')`))
    .returning({ id: aiChatAction.id })
  return r.length > 0
}

export async function finishAction(
  id: string,
  set: { status: ActionStatus; draft?: ChatDraft; confirmedValues?: unknown; results?: ActionResult[]; error?: string | null; confirmed?: boolean },
): Promise<void> {
  const now = new Date()
  await db
    .update(aiChatAction)
    .set({
      status: set.status,
      ...(set.draft ? { draft: set.draft } : {}),
      ...(set.confirmedValues !== undefined ? { confirmedValues: set.confirmedValues } : {}),
      ...(set.results ? { results: set.results } : {}),
      ...(set.error !== undefined ? { error: set.error } : {}),
      ...(set.confirmed ? { confirmedAt: now } : {}),
      updatedAt: now,
    })
    .where(eq(aiChatAction.id, id))
}

/** Records created by the user's chat actions in the last hour (§8.5 limit). */
export async function createdLastHour(orgId: string, userId: string): Promise<number> {
  const [r] = await db
    .select({
      n: sql<number>`coalesce(sum(jsonb_array_length(coalesce(${aiChatAction.results}, '[]'::jsonb))), 0)::int`,
    })
    .from(aiChatAction)
    .where(
      and(
        eq(aiChatAction.organizationId, orgId),
        eq(aiChatAction.userId, userId),
        gt(aiChatAction.confirmedAt, new Date(Date.now() - 3_600_000)),
      ),
    )
  return r?.n ?? 0
}

/**
 * Keep the stored assistant message in step with the row: the draft card's
 * part gets the current status / results, and after a confirm a
 * `data-action-result` part (the model reads it next turn).
 */
export async function syncActionMessage(r: ActionRow, opts: { result?: boolean } = {}): Promise<void> {
  if (!r.threadId || !r.messageId) return
  const part = actionPart(r)
  await updateChatMessageParts(r.threadId, r.messageId, (parts) => {
    const out = parts.map((p) => {
      const q = p as { type?: string; id?: string }
      return q.type === "data-draft" && q.id === r.id ? { type: "data-draft", id: r.id, data: part } : p
    })
    if (opts.result) {
      const res: ChatActionResultPart = { actionId: r.id, status: part.status, results: part.results ?? [] }
      out.push({ type: "data-action-result", id: `result-${r.id}`, data: res })
    }
    return out
  }).catch((e) => console.error("[chat/actions] message sync failed", r.id, e))
}

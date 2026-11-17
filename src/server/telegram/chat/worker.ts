import "server-only"

import { randomInt, randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import type { UIMessageChunk } from "ai"
import { db } from "@/db/drizzle"
import { telegramBinding } from "@/db/schema"
import { EMPTY_ANSWER_FALLBACK, chatErrorText, dataParts, mergeRecordsParts } from "@/lib/chat/turn"
import { USER_TEXT_MAX_CHARS, type UserMessageInput } from "@/lib/chat/thread"
import type { RecordType } from "@/lib/chat/records"
import { MERGE_MAX_MS, MERGE_QUIET_MS, TURN_LIMIT, mergeInbox, type InboxEntry, type InboxKind, type InboxPayload } from "@/lib/telegram/inbox"
import { renderTelegramAnswer, type TgButton, type TgOutMessage } from "@/lib/telegram/render"
import { transcriptEcho, transcriptPlainText } from "@/lib/telegram/voice"
import { escapeHtml } from "@/lib/telegram/html"
import { TELEGRAM_TEXTS } from "@/lib/telegram/texts"
import { getChatMessage, getChatThread } from "@/server/chat/threads"
import { prepareChatAttachments, readChatAttachmentContents } from "@/server/chat/files"
import { runChatTurn } from "@/server/chat/turn"
import type { TelegramWebhookContext } from "@/server/ingest/telegram"
import { isActiveOrgMember, unbindTelegram, type TelegramBindingRow } from "@/server/telegram/bindings"
import {
  acquireChatLock,
  claimPending,
  extendChatLock,
  finishInbox,
  hasPending,
  pendingTimes,
  recentTurnCount,
  releaseChatLock,
  type InboxRow,
} from "@/server/telegram/chat/inbox"
import { telegramFileToChat } from "@/server/telegram/chat/inputs"
import { recordOfBotMessage, resolveTelegramThread, setTelegramThread } from "@/server/telegram/chat/threads"
import {
  dropTelegramButtons,
  openFeedbackMessages,
  sendTelegramDraft,
  sendTelegramHtml,
  sendTelegramTyping,
  type SendTarget,
  type ServerButton,
} from "@/server/telegram/sender"

// The AI chat worker of one member (docs/specs/ai-chat-telegram §5–§10):
// lock → wait for the merge window → claim the pending rows → ONE chat turn
// through `runChatTurn` (channel telegram) → render the stored answer →
// send. Runs after the webhook's 200 answer (`after()`), or inline on the
// manual fetch. Never throws.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const STATUS_EVERY_MS = 1_200
const TYPING_EVERY_MS = 4_000

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL ?? "").replace(/\/+$/, "")
}

async function loadBinding(id: string): Promise<TelegramBindingRow | null> {
  const [b] = await db.select().from(telegramBinding).where(eq(telegramBinding.id, id)).limit(1)
  return b ?? null
}

function targetOf(ctx: TelegramWebhookContext, b: TelegramBindingRow): SendTarget {
  return { orgId: b.organizationId, sourceId: ctx.sourceId, botToken: ctx.botToken, chatId: b.chatId, binding: { id: b.id, userId: b.userId } }
}

/** Wait until the member stopped sending (2 s quiet) or 10 s passed since the first message. */
async function waitForQuiet(bindingId: string): Promise<void> {
  const deadline = Date.now() + MERGE_MAX_MS + 2_000
  while (Date.now() < deadline) {
    const t = await pendingTimes(bindingId)
    if (!t) return
    const now = Date.now()
    if (now - t.last.getTime() >= MERGE_QUIET_MS || now - t.first.getTime() >= MERGE_MAX_MS) return
    await sleep(Math.min(500, MERGE_QUIET_MS - (now - t.last.getTime()) + 50))
  }
}

export async function runTelegramChatWorker(ctx: TelegramWebhookContext, bindingId: string): Promise<void> {
  try {
    for (let round = 0; round < 5; round++) {
      const token = await acquireChatLock(bindingId)
      if (!token) return
      try {
        for (let turn = 0; turn < 10; turn++) {
          await waitForQuiet(bindingId)
          const rows = await claimPending(bindingId)
          if (!rows.length) break
          try {
            await processBatch(ctx, bindingId, rows, token)
          } catch (e) {
            console.error(`[telegram/chat] batch failed (binding ${bindingId})`, e)
            await finishInbox(rows.map((r) => r.id), "failed", { error: e instanceof Error ? e.message.slice(0, 300) : "error" })
          }
        }
      } finally {
        await releaseChatLock(bindingId, token)
      }
      // A message that arrived while the lock was released must not wait for the next one.
      if (!(await hasPending(bindingId))) return
    }
  } catch (e) {
    console.error(`[telegram/chat] worker failed (binding ${bindingId})`, e)
  }
}

async function processBatch(ctx: TelegramWebhookContext, bindingId: string, rows: InboxRow[], lockToken: string): Promise<void> {
  const ids = rows.map((r) => r.id)
  const b = await loadBinding(bindingId)
  if (!b || b.status === "unbound") return finishInbox(ids, "failed", { error: "unbound" })
  const tgt = targetOf(ctx, b)
  if (!ctx.aiChatEnabled) {
    await sendTelegramHtml(tgt, TELEGRAM_TEXTS.aiChatOff, { kind: "system" })
    return finishInbox(ids, "failed", { error: "ai_chat_off" })
  }
  if (!(await isActiveOrgMember(b.organizationId, b.userId))) {
    await unbindTelegram(b.organizationId, b.userId, "not_member")
    await sendTelegramHtml({ ...tgt, binding: null }, TELEGRAM_TEXTS.notMember, { kind: "system" })
    return finishInbox(ids, "failed", { error: "not_member" })
  }

  const merged = mergeInbox(rows.map((r) => ({ kind: r.kind as InboxKind, payload: r.payload as InboxPayload, mediaGroupId: r.mediaGroupId }) satisfies InboxEntry))
  for (const n of merged.notices) await sendTelegramHtml(tgt, escapeHtml(n), { kind: "chat_notice" })

  // «Повторить» (§10): answer the last question of that thread again.
  if (merged.retry) {
    const thread = await getChatThread(b.organizationId, b.userId, merged.retry.threadId)
    if (!thread) return finishInbox(ids, "failed", { error: "thread_not_found" })
    await answerTurn(tgt, b, { threadId: thread.id, userMessage: null, regenerate: true, contextRecord: null }, lockToken)
    return finishInbox(ids, "done", { threadId: thread.id })
  }
  if (!merged.text && !merged.files.length && !merged.voices.length) return finishInbox(ids, "done")

  if ((await recentTurnCount(b.organizationId, b.userId, TURN_LIMIT.windowMs)) >= TURN_LIMIT.turns) {
    await sendTelegramHtml(tgt, TELEGRAM_TEXTS.limit, { kind: "system" })
    return finishInbox(ids, "failed", { error: "rate_limited" })
  }

  const threadId = await resolveTelegramThread(b)
  const userMessageId = randomUUID()
  if (merged.voices.length || merged.files.length) await sendTelegramTyping(tgt)

  // Files → chat files (same path as the web chat).
  const fileParts: { type: "file"; url: string; mediaType: string; filename: string }[] = []
  const fileIds: string[] = []
  for (const f of merged.files) {
    const r = await telegramFileToChat(b.organizationId, b.userId, ctx.botToken, f)
    if (r.ok) {
      fileParts.push({ type: "file", url: r.url, mediaType: r.mediaType, filename: r.name })
      fileIds.push(r.itemId)
    } else {
      await sendTelegramHtml(tgt, escapeHtml(TELEGRAM_TEXTS.fileFailed(r.name, r.reason)), { kind: "chat_notice" })
    }
  }

  // Voice (Q3 = a): the transcript IS the member's message; the audio stays an attachment.
  const transcripts: string[] = []
  for (const [i, v] of merged.voices.entries()) {
    const r = await telegramFileToChat(b.organizationId, b.userId, ctx.botToken, {
      fileId: v.fileId,
      fileName: `voice-${Date.now()}-${i + 1}.ogg`,
      mimeType: v.mimeType || "audio/ogg",
      fileSize: v.fileSize,
    })
    if (!r.ok) {
      await sendTelegramHtml(tgt, escapeHtml(TELEGRAM_TEXTS.fileFailed("голосовое сообщение", r.reason)), { kind: "chat_notice" })
      continue
    }
    await prepareChatAttachments(b.organizationId, b.userId, [r.itemId], { threadId, messageId: userMessageId })
    const [content] = await readChatAttachmentContents(b.organizationId, [r.itemId])
    const text = transcriptPlainText(content?.content ?? "").trim()
    fileParts.push({ type: "file", url: r.url, mediaType: r.mediaType, filename: r.name })
    fileIds.push(r.itemId)
    if (text) transcripts.push(text)
  }
  if (merged.voices.length && !transcripts.length && !merged.text && !fileIds.length) {
    await sendTelegramHtml(tgt, TELEGRAM_TEXTS.voiceFailed, { kind: "chat_notice" })
    return finishInbox(ids, "failed", { error: "voice_failed" })
  }
  for (const t of transcripts) await sendTelegramHtml(tgt, transcriptEcho(t), { kind: "chat_notice" })

  // Reply to a bot message (Q9): its record is the context; else the quoted text.
  let contextRecord: { type: RecordType; id: string } | null = null
  let text = [merged.text, ...transcripts].filter(Boolean).join("\n\n")
  if (merged.replyTo) {
    contextRecord = merged.replyTo.fromBot ? await recordOfBotMessage(ctx.sourceId, b.chatId, merged.replyTo.tgMessageId) : null
    if (!contextRecord && merged.replyTo.text) text = `(В ответ на: «${merged.replyTo.text.slice(0, 300)}»)\n\n${text}`
  }
  text = text.slice(0, USER_TEXT_MAX_CHARS)
  if (!text.trim() && !fileIds.length) return finishInbox(ids, "done")

  const userMessage: UserMessageInput = {
    text,
    parts: [...(text.trim() ? [{ type: "text", text }] : []), ...fileParts],
    fileIds,
  }
  await answerTurn(tgt, b, { threadId, userMessage, userMessageId, regenerate: false, contextRecord }, lockToken)
  await finishInbox(ids, "done", { threadId })
}

type TurnArgs = {
  threadId: string
  userMessage: UserMessageInput | null
  userMessageId?: string
  regenerate: boolean
  contextRecord: { type: RecordType; id: string } | null
}

/** One record shown alone = what the answer is about (a reply to it continues about it, Q9). */
function answerEntity(parts: readonly { type: string; data?: unknown }[]): { type: string; id: string } | null {
  const merged = mergeRecordsParts(dataParts(parts as never, "records"))
  if (!merged) return null
  const hits = Object.values(merged.hits).flat().filter(Boolean)
  return hits.length === 1 && hits[0] ? { type: hits[0].type, id: hits[0].id } : null
}

const KIND_BY_ROLE: Record<TgOutMessage["role"], string> = {
  answer: "chat_answer",
  card: "chat_card",
  question: "chat_question",
  sources: "chat_sources",
  notice: "chat_notice",
}

/** Renderer buttons → sender buttons; every action gets the thread + answer ids (CSV, checks). */
function serverButtons(rows: TgButton[][] | undefined, threadId: string, messageId: string): ServerButton[][] | undefined {
  if (!rows?.length) return undefined
  return rows.map((row) =>
    row.map((btn): ServerButton =>
      "url" in btn
        ? { text: btn.text, url: btn.url }
        : { text: btn.text, action: { ...btn.action, threadId, messageId } },
    ),
  )
}

async function answerTurn(tgt: SendTarget, b: TelegramBindingRow, args: TurnArgs, lockToken: string): Promise<void> {
  // Status while waiting (Q6 = a): a draft preview with the status lines; else «печатает…».
  const draftId = randomInt(1, 2_000_000_000)
  let preview = await sendTelegramDraft(tgt, draftId, TELEGRAM_TEXTS.thinking)
  const typing = preview ? null : setInterval(() => void sendTelegramTyping(tgt), TYPING_EVERY_MS)
  if (!preview) await sendTelegramTyping(tgt)

  try {
    const turn = await runChatTurn({
      orgId: b.organizationId,
      userId: b.userId,
      isAdmin: false,
      threadId: args.threadId,
      userMessage: args.userMessage,
      userMessageId: args.userMessageId,
      regenerate: args.regenerate,
      contextRecord: args.contextRecord,
      channel: "telegram",
    })
    if (!turn.ok) {
      const html = turn.status === 402 ? TELEGRAM_TEXTS.aiLimit : escapeHtml(chatErrorText(turn.message ?? turn.error).text)
      await sendTelegramHtml(tgt, html, { kind: "chat_notice" })
      return
    }
    await setTelegramThread(b.id, args.threadId)

    // Read the stream: status lines → preview, an error chunk → the error class.
    let errorText: string | null = null
    let lastStatus = 0
    let lastExtend = Date.now()
    const reader = turn.stream.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = value as UIMessageChunk & { data?: { label?: string }; errorText?: string }
      if (chunk.type === "data-status" && preview && chunk.data?.label && Date.now() - lastStatus > STATUS_EVERY_MS) {
        lastStatus = Date.now()
        preview = await sendTelegramDraft(tgt, draftId, chunk.data.label)
      } else if (chunk.type === "error") {
        errorText = chunk.errorText ?? "chat_error:unknown"
      }
      if (Date.now() - lastExtend > 60_000) {
        lastExtend = Date.now()
        await extendChatLock(b.id, lockToken)
      }
    }
    await Promise.race([turn.saved, sleep(8_000)])
    const stored = await getChatMessage(args.threadId, turn.assistantId)
    const parts = (stored?.parts ?? []) as { type: string; text?: string; data?: unknown; id?: string }[]
    const out = renderTelegramAnswer(parts, { appUrl: appUrl(), threadId: args.threadId })

    // 👍 / 👎 only on the LATEST answer (Q11): remove them from older answers.
    for (const mid of await openFeedbackMessages(b.id)) await dropTelegramButtons(tgt, mid, ["feedback"])

    const entity = answerEntity(parts)
    const lastAnswer = out.map((m) => m.role).lastIndexOf("answer")
    let sent = 0
    for (const [i, m] of out.entries()) {
      const rows = serverButtons(m.buttons, args.threadId, turn.assistantId) ?? []
      if (i === lastAnswer && stored && !errorText) {
        rows.push([
          { text: "👍", action: { kind: "feedback", value: "up", threadId: args.threadId, messageId: turn.assistantId } },
          { text: "👎", action: { kind: "feedback", value: "down", threadId: args.threadId, messageId: turn.assistantId } },
        ])
      }
      const r = await sendTelegramHtml(tgt, m.html, {
        kind: KIND_BY_ROLE[m.role],
        aiChatThreadId: args.threadId,
        aiChatMessageId: turn.assistantId,
        entity: m.role === "answer" ? entity : null,
      }, { buttons: rows })
      if (r.ok) sent++
      if (!r.ok && r.blocked) return
    }
    if (errorText) {
      await sendTelegramHtml(tgt, escapeHtml(chatErrorText(errorText).text), { kind: "chat_notice", aiChatThreadId: args.threadId }, {
        buttons: [[{ text: "🔁 Повторить", action: { kind: "retry", threadId: args.threadId } }]],
      })
    } else if (!sent) {
      await sendTelegramHtml(tgt, escapeHtml(EMPTY_ANSWER_FALLBACK), { kind: "chat_notice", aiChatThreadId: args.threadId })
    }
  } finally {
    if (typing) clearInterval(typing)
  }
}

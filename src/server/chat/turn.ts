import "server-only"

import {
  convertToModelMessages,
  createUIMessageStream,
  isStepCount,
  toUIMessageStream,
  type UIMessage,
  type UIMessageChunk,
} from "ai"
import { pipeJsonRender } from "@json-render/core"
import { RECORD_TYPE_LABELS, type RecordType } from "@/lib/chat/records"
import { parsePageRecord } from "@/lib/chat/page-context"
import { threadTitle, type UserMessageInput } from "@/lib/chat/thread"
import { chatFileIdFromUrl, type ChatAttachmentPart } from "@/lib/chat/files"
import { buildChatSystemPrompt, todayLine } from "@/lib/chat/prompt"
import { STATUS_THINKING } from "@/lib/chat/turn"
import { prepareChatAttachments, readChatAttachments } from "@/server/chat/files"
import { aiStreamText } from "@/server/ai/runtime"
import { CHAT_LIMIT_ERROR, getChatLimitState } from "@/server/chat/limit"
import { chatErrorCode, classifyChatError } from "@/server/chat/errors"
import { cleanHistory, dataPartToModelText } from "@/server/chat/history"
import { appendChatMessage, dropTrailingAssistant, ensureChatThread, loadChatMessages } from "@/server/chat/threads"
import { getRecord, loadRecordsContext, type RecordsContext } from "@/server/chat/records"
import { visibleStatsSubjects } from "@/server/chat/stats"
import { createChatStreamFilter } from "@/server/chat/stream"
import { CRM_TOOLS, buildChatTools } from "@/server/chat/tools"
import { getOwnOrgContext } from "@/server/identity/own-org"

// ONE chat turn for every channel (docs/specs/ai-chat-telegram §5 «Turn
// runner»): the web route `/api/chat` and the Telegram worker call this. It
// stores the user message (after its files are read), loads the history,
// runs the model with the read + draft tools and stores the answer at the end
// (also a stopped one). Org + user come from the caller's trusted context
// (the session, or an active Telegram binding) — never from the message.

/** Hard stop of one answer (ai-chat spec §13); below the routes' maxDuration. */
export const TURN_TIMEOUT_MS = 110_000
const MAX_STEPS = 8
const MAX_OUTPUT_TOKENS = 2_000

export type ChatChannel = "web" | "telegram"

export type ChatTurnInput = {
  orgId: string
  userId: string
  /** Platform admin: the stream carries `data-debug` (never in Telegram). */
  isAdmin: boolean
  threadId: string
  /** The new user message; null only for a regenerate. */
  userMessage: UserMessageInput | null
  /** Id of the stored user message (the Telegram worker reads files before the turn). */
  userMessageId?: string
  /** «Повторить»: answer the last user message again. */
  regenerate: boolean
  /** «Не передавать в источники» for a NEW thread. */
  ingestMode?: "on" | "off"
  /** A model id the user picked (web only; the runtime ignores ids outside the allowed list). */
  model?: string
  /** Web: the page address (Q12). */
  page?: string
  /** Telegram: the record of the message the user replied to (ai-chat-telegram Q9). */
  contextRecord?: { type: RecordType; id: string } | null
  channel: ChatChannel
  abortSignal?: AbortSignal
}

export type ChatTurnStart =
  | {
      ok: true
      stream: ReadableStream<UIMessageChunk>
      assistantId: string
      /** Resolves after the answer was stored (or storing failed — logged). */
      saved: Promise<void>
    }
  | { ok: false; status: number; error: string; message?: string }

async function contextLine(ctx: RecordsContext, ref: { type: RecordType; id: string } | null, channel: ChatChannel): Promise<string | null> {
  if (!ref) return null
  const d = await getRecord(ctx, ref.type, ref.id).catch(() => null)
  if (!d) return null
  const what = `${RECORD_TYPE_LABELS[d.type].one} «${d.title}» (type ${d.type}, ref ${d.id})`
  return channel === "telegram"
    ? `Пользователь отвечает в Telegram на сообщение о записи: ${what}.`
    : `Пользователь сейчас открыл в CRM: ${what}.`
}

/**
 * Put the full text of its files into the `data-attachment` parts of the
 * latest user message (in memory only — the stored message keeps the
 * excerpt). New files: the text just parsed; «Повторить»: read again.
 */
async function withAttachmentText(orgId: string, msg: UIMessage, current: ChatAttachmentPart[]): Promise<void> {
  const parts = msg.parts.filter((p) => p.type === "data-attachment") as unknown as { data: ChatAttachmentPart }[]
  if (!parts.length) return
  const fresh = new Map(current.filter((a) => a.text).map((a) => [a.itemId, a]))
  const missing = parts.map((p) => p.data.itemId).filter((id) => !fresh.has(id))
  if (missing.length) for (const a of await readChatAttachments(orgId, missing, true)) fresh.set(a.itemId, a)
  for (const p of parts) {
    const a = fresh.get(p.data.itemId)
    if (a) p.data = a
  }
}

export async function runChatTurn(input: ChatTurnInput): Promise<ChatTurnStart> {
  const { orgId, userId, threadId, userMessage, regenerate, channel } = input

  // Monthly AI limit (Q15): at 100 % no model call.
  const limit = await getChatLimitState(orgId).catch((e) => {
    console.error("[chat] limit check failed", e)
    return null
  })
  if (limit?.blocked) return { ok: false, status: 402, error: CHAT_LIMIT_ERROR, message: limit.message ?? undefined }
  if (!userMessage && !regenerate) return { ok: false, status: 400, error: "Bad request" }

  // History (§16.1): the thread is the user's own in the org; the user
  // message is stored BEFORE the model call (after its files are read).
  const thread = await ensureChatThread(orgId, userId, threadId, threadTitle(userMessage?.text), input.ingestMode === "off" ? "off" : "on", channel)
  if (!thread) return { ok: false, status: 404, error: "chat_not_found" }
  const lastLeft = regenerate ? await dropTrailingAssistant(threadId) : null
  const appendUser = !!userMessage && (!regenerate || lastLeft !== "user")
  if (!appendUser && lastLeft !== "user") return { ok: false, status: 400, error: "Bad request" }
  const assistantId = crypto.randomUUID()

  const requestId = crypto.randomUUID().slice(0, 8)
  const startedAt = Date.now()
  let resolveSaved: () => void = () => {}
  const saved = new Promise<void>((r) => (resolveSaved = r))

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      writer.write({ type: "start", messageId: assistantId })
      // The first status line before any model call (spec §13: ≤ 1 s).
      writer.write({ type: "data-status", data: STATUS_THINKING, transient: true } as UIMessageChunk)

      // Files (docs/specs/ai-chat-tools §5.2, Q22): detached from the chat,
      // parsed by the parser of their type; the model gets only their TEXT.
      let current: ChatAttachmentPart[] = []
      if (appendUser && userMessage) {
        const messageId = input.userMessageId ?? crypto.randomUUID()
        current = await prepareChatAttachments(orgId, userId, userMessage.fileIds, { threadId, messageId }, (label) =>
          writer.write({ type: "data-status", data: { stage: "reading", label }, transient: true } as UIMessageChunk),
        )
        const kept = new Set(current.map((a) => a.itemId))
        await appendChatMessage(threadId, {
          id: messageId,
          role: "user",
          parts: [
            // Only file parts of files that really are the user's uploads.
            ...userMessage.parts.filter((p) => p.type !== "file" || kept.has(chatFileIdFromUrl(String(p.url ?? "")) ?? "")),
            ...current.map((a) => ({ type: "data-attachment", id: a.itemId, data: a })),
          ],
        })
        writer.write({ type: "data-status", data: STATUS_THINKING, transient: true } as UIMessageChunk)
      }
      const history = cleanHistory(await loadChatMessages(threadId))
      if (!history.length || history[history.length - 1].role !== "user") throw new Error("chat history does not end with a user message")
      // The latest user message gets the FULL text of its files (older turns: a short note).
      await withAttachmentText(orgId, history[history.length - 1], current)

      const ctx = await loadRecordsContext(orgId, userId)
      const ref = channel === "web" ? parsePageRecord(input.page) : (input.contextRecord ?? null)
      const [orgCard, page] = await Promise.all([
        getOwnOrgContext(orgId)
          .then((c) => c.promptCard)
          .catch((e) => {
            console.error("[chat] own-org context failed", e)
            return ""
          }),
        contextLine(ctx, ref, channel),
      ])
      const tools = buildChatTools({
        ctx,
        writer,
        ai: { orgId, userId },
        actions: {
          orgId,
          userId,
          threadId,
          messageId: assistantId,
          history,
          pageClientId: ref?.type === "client" ? ref.id : null,
        },
      })
      const instructions = buildChatSystemPrompt({
        orgCard,
        topicsVisible: ctx.topicsVisible,
        statsSubjects: visibleStatsSubjects(ctx),
        todayLine: todayLine(ctx.now, ctx.timeZone),
        pageLine: page,
        actions: true,
        channel,
      })
      const messages = await convertToModelMessages(history, {
        convertDataPart: (part) => dataPartToModelText(part),
      })

      let servedModel: string | null = null
      let resolveServed: () => void = () => {}
      const served = new Promise<void>((r) => (resolveServed = r))

      const signals = [AbortSignal.timeout(TURN_TIMEOUT_MS), ...(input.abortSignal ? [input.abortSignal] : [])]
      const result = await aiStreamText({
        process: "chat.assistant",
        orgId,
        userId,
        requestedModelId: channel === "web" ? input.model : undefined,
        instructions,
        messages,
        tools,
        stopWhen: isStepCount(MAX_STEPS),
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        abortSignal: AbortSignal.any(signals),
        onEnd: (event) => {
          const last = event as { finalStep?: { response?: { modelId?: string } }; response?: { modelId?: string } }
          servedModel = last.finalStep?.response?.modelId ?? last.response?.modelId ?? null
          resolveServed()
        },
      })

      const filter = createChatStreamFilter({
        isAdmin: channel === "web" && input.isAdmin,
        startedAt,
        sourceOf: (t) => (CRM_TOOLS.has(t) ? "crm" : t === "searchWeb" ? "web" : null),
        model: async () => {
          await served
          return servedModel
        },
      })

      const ui = toUIMessageStream({
        stream: result.stream,
        tools,
        sendStart: false,
        onError: (e) => {
          const cls = classifyChatError(e)
          const calls = filter.summary().calls.map((c) => (c.kind === "tool" ? `${c.tool} ${c.input}` : "")).join(" | ")
          console.error(`[chat ${requestId}] stream error (${cls}, org ${orgId}, ${channel}) after [${calls}]`, e)
          return chatErrorCode(cls)
        },
      })
      writer.merge(pipeJsonRender(ui).pipeThrough(filter.stream))

      // Server log of the turn (never sent to the user).
      void served.then(() => {
        const s = filter.summary()
        console.log(`[chat ${requestId}] org ${orgId} ${channel} model ${servedModel ?? "-"} steps ${s.steps} tools [${s.tools.join(", ")}] ${s.ms} ms`)
        if (s.emptyAnswer) console.warn(`[chat ${requestId}] the model wrote no answer text — fallback shown`)
        if (s.falseDraftClaim) console.warn(`[chat ${requestId}] the model claimed a draft card without a draft tool call — note shown`)
      })
    },
    onError: (e) => {
      const cls = classifyChatError(e)
      console.error(`[chat ${requestId}] failed (${cls}, org ${orgId}, ${channel})`, e)
      return chatErrorCode(cls)
    },
    // The answer is stored at the end — also a broken / stopped one, with
    // what was produced (§16.1). Admin debug and status parts are not stored.
    onEnd: async ({ responseMessage }) => {
      try {
        if (responseMessage.role !== "assistant") return
        await appendChatMessage(threadId, { id: assistantId, role: "assistant", parts: responseMessage.parts })
      } catch (e) {
        console.error(`[chat ${requestId}] saving the answer failed (thread ${threadId})`, e)
      } finally {
        resolveSaved()
      }
    },
  })

  return { ok: true, stream, assistantId, saved }
}

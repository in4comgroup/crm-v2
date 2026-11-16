import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  isStepCount,
  toUIMessageStream,
  type UIMessage,
  type UIMessageChunk,
} from "ai"
import { pipeJsonRender } from "@json-render/core"
import { getServerSession } from "@/lib/get-session"
import { RECORD_TYPE_LABELS } from "@/lib/chat/records"
import { parsePageRecord } from "@/lib/chat/page-context"
import { isThreadId, parseUserMessage, threadTitle } from "@/lib/chat/thread"
import { buildChatSystemPrompt, todayLine } from "@/lib/chat/prompt"
import { STATUS_THINKING } from "@/lib/chat/turn"
import { aiStreamText } from "@/server/ai/runtime"
import { CHAT_LIMIT_ERROR, getChatLimitState } from "@/server/chat/limit"
import { chatErrorCode, classifyChatError } from "@/server/chat/errors"
import { cleanHistory, dataPartToModelText } from "@/server/chat/history"
import {
  appendChatMessage,
  dropTrailingAssistant,
  ensureChatThread,
  loadChatMessages,
} from "@/server/chat/threads"
import { getRecord, loadRecordsContext, type RecordsContext } from "@/server/chat/records"
import { visibleStatsSubjects } from "@/server/chat/stats"
import { createChatStreamFilter } from "@/server/chat/stream"
import { CRM_TOOLS, buildChatTools } from "@/server/chat/tools"
import { getOwnOrgContext } from "@/server/identity/own-org"

// AI chat v2 (docs/specs/ai-chat/01-specification.md §10). The model comes
// from the AI process «ИИ чат» (`chat.assistant`): the user's pick from the
// admin-allowed list, else the admin's choice (Q1). Read-only tools over the
// org's CRM (records engine, statistics) + web search; the org and user come
// from the session, never from the request body or the model.

export const maxDuration = 120

/** Hard stop of one answer (spec §13); below maxDuration so the stream can end cleanly. */
const TURN_TIMEOUT_MS = 110_000
const MAX_STEPS = 8
const MAX_OUTPUT_TOKENS = 2_000
type ChatRequest = {
  /** Thread id (browser-made, §16.1); the thread is created on its first send. */
  chatId?: string
  /** The new user message (the history comes from the DB, never from the browser). */
  message?: UIMessage
  /** "regenerate-message" = «Повторить»: answer the last user message again. */
  trigger?: string
  /** A model id from GET /api/ai/models?process=chat.assistant; others are ignored by the runtime. */
  model?: string
  /** Address of the page the user is on (Q12), e.g. "/clients/abc". */
  page?: string
}

/** «Пользователь сейчас открыл: Компания «X» …» — only for a record of the org the user can see. */
async function pageLine(ctx: RecordsContext, page: string | undefined): Promise<string | null> {
  const ref = parsePageRecord(page)
  if (!ref) return null
  const d = await getRecord(ctx, ref.type, ref.id).catch(() => null)
  if (!d) return null
  return `Пользователь сейчас открыл в CRM: ${RECORD_TYPE_LABELS[d.type].one} «${d.title}» (type ${d.type}, ref ${d.id}).`
}

export async function POST(req: Request) {
  // Sign-in + active org before any work: an anonymous caller never reaches
  // the (paid) model or the web-search sub-call.
  const session = await getServerSession()
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const orgId = session.session.activeOrganizationId ?? null
  if (!orgId) return Response.json({ error: "No active organization" }, { status: 403 })
  const userId = session.user.id
  const isAdmin = session.user.role === "admin"

  // Monthly AI limit (Q15): at 100 % no model call; the panel shows a banner.
  const limit = await getChatLimitState(orgId).catch((e) => {
    console.error("[chat] limit check failed", e)
    return null
  })
  if (limit?.blocked) {
    return Response.json({ error: CHAT_LIMIT_ERROR, message: limit.message }, { status: 402 })
  }

  let body: ChatRequest
  try {
    body = (await req.json()) as ChatRequest
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 })
  }
  const chatId = body.chatId
  const userMessage = parseUserMessage(body.message)
  const regenerate = body.trigger === "regenerate-message"
  if (!isThreadId(chatId) || (!userMessage && !regenerate)) {
    return Response.json({ error: "Bad request" }, { status: 400 })
  }

  // History (§16.1): the thread is the user's own in the active org; the
  // user message is stored BEFORE the model call.
  const thread = await ensureChatThread(orgId, userId, chatId, threadTitle(userMessage?.text))
  if (!thread) return Response.json({ error: "chat_not_found" }, { status: 404 })
  const lastLeft = regenerate ? await dropTrailingAssistant(chatId) : null
  if (userMessage && (!regenerate || lastLeft !== "user")) {
    await appendChatMessage(chatId, { id: crypto.randomUUID(), role: "user", parts: userMessage.parts })
  }
  const history = cleanHistory(await loadChatMessages(chatId))
  if (!history.length || history[history.length - 1].role !== "user") {
    return Response.json({ error: "Bad request" }, { status: 400 })
  }
  const assistantId = crypto.randomUUID()

  const requestId = crypto.randomUUID().slice(0, 8)
  const startedAt = Date.now()

  const stream = createUIMessageStream({
    originalMessages: history,
    execute: async ({ writer }) => {
      writer.write({ type: "start", messageId: assistantId })
      // The first status line before any model call (spec §13: ≤ 1 s).
      writer.write({ type: "data-status", data: STATUS_THINKING, transient: true } as UIMessageChunk)

      const ctx = await loadRecordsContext(orgId, userId)
      const [orgCard, page] = await Promise.all([
        getOwnOrgContext(orgId)
          .then((c) => c.promptCard)
          .catch((e) => {
            console.error("[chat] own-org context failed", e)
            return ""
          }),
        pageLine(ctx, body.page),
      ])
      const tools = buildChatTools({ ctx, writer, ai: { orgId, userId } })
      const instructions = buildChatSystemPrompt({
        orgCard,
        topicsVisible: ctx.topicsVisible,
        statsSubjects: visibleStatsSubjects(ctx),
        todayLine: todayLine(ctx.now, ctx.timeZone),
        pageLine: page,
      })
      const messages = await convertToModelMessages(history, {
        convertDataPart: (part) => dataPartToModelText(part),
      })

      let servedModel: string | null = null
      let resolveServed: () => void = () => {}
      const served = new Promise<void>((r) => (resolveServed = r))

      const result = await aiStreamText({
        process: "chat.assistant",
        orgId,
        userId,
        requestedModelId: body.model,
        instructions,
        messages,
        tools,
        stopWhen: isStepCount(MAX_STEPS),
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        abortSignal: AbortSignal.any([req.signal, AbortSignal.timeout(TURN_TIMEOUT_MS)]),
        onEnd: (event) => {
          const last = (event as { finalStep?: { response?: { modelId?: string } }; response?: { modelId?: string } })
          servedModel = last.finalStep?.response?.modelId ?? last.response?.modelId ?? null
          resolveServed()
        },
      })

      const filter = createChatStreamFilter({
        isAdmin,
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
          console.error(`[chat ${requestId}] stream error (${cls}, org ${orgId}) after [${calls}]`, e)
          return chatErrorCode(cls)
        },
      })
      writer.merge(pipeJsonRender(ui).pipeThrough(filter.stream))

      // Server log of the turn (never sent to the browser).
      void served.then(() => {
        const s = filter.summary()
        console.log(`[chat ${requestId}] org ${orgId} model ${servedModel ?? "-"} steps ${s.steps} tools [${s.tools.join(", ")}] ${s.ms} ms`)
      })
    },
    onError: (e) => {
      const cls = classifyChatError(e)
      console.error(`[chat ${requestId}] failed (${cls}, org ${orgId})`, e)
      return chatErrorCode(cls)
    },
    // The answer is stored at the end — also a broken / stopped one, with
    // what was produced (§16.1). Admin debug and status parts are not stored.
    onEnd: async ({ responseMessage }) => {
      if (responseMessage.role !== "assistant") return
      try {
        await appendChatMessage(chatId, { id: assistantId, role: "assistant", parts: responseMessage.parts })
      } catch (e) {
        console.error(`[chat ${requestId}] saving the answer failed (thread ${chatId})`, e)
      }
    },
  })

  return createUIMessageStreamResponse({ stream })
}

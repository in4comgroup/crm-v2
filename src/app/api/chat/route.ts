import { createUIMessageStreamResponse, type UIMessage } from "ai"
import { getServerSession } from "@/lib/get-session"
import { isThreadId, parseUserMessage } from "@/lib/chat/thread"
import { runChatTurn } from "@/server/chat/turn"

// AI chat v2 (docs/specs/ai-chat/01-specification.md §10). The model comes
// from the AI process «ИИ чат» (`chat.assistant`): the user's pick from the
// admin-allowed list, else the admin's choice (Q1). Read-only tools over the
// org's CRM (records engine, statistics) + web search + draft cards; the org
// and user come from the session, never from the request body or the model.
// The turn itself is `runChatTurn` (src/server/chat/turn.ts), shared with the
// Telegram channel (docs/specs/ai-chat-telegram §5).

export const maxDuration = 120

type ChatRequest = {
  /** Thread id (browser-made, §16.1); the thread is created on its first send. */
  chatId?: string
  /** The new user message (the history comes from the DB, never from the browser). */
  message?: UIMessage
  /** "regenerate-message" = «Повторить»: answer the last user message again. */
  trigger?: string
  /** «Не передавать в источники» chosen before the first message (used only when the thread is created). */
  ingestMode?: string
  /** A model id from GET /api/ai/models?process=chat.assistant; others are ignored by the runtime. */
  model?: string
  /** Address of the page the user is on (Q12), e.g. "/clients/abc". */
  page?: string
}

export async function POST(req: Request) {
  // Sign-in + active org before any work: an anonymous caller never reaches
  // the (paid) model or the web-search sub-call.
  const session = await getServerSession()
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const orgId = session.session.activeOrganizationId ?? null
  if (!orgId) return Response.json({ error: "No active organization" }, { status: 403 })

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

  const turn = await runChatTurn({
    orgId,
    userId: session.user.id,
    isAdmin: session.user.role === "admin",
    threadId: chatId,
    userMessage,
    regenerate,
    ingestMode: body.ingestMode === "off" ? "off" : "on",
    model: body.model,
    page: body.page,
    channel: "web",
    abortSignal: req.signal,
  })
  if (!turn.ok) {
    return Response.json({ error: turn.error, ...(turn.message ? { message: turn.message } : {}) }, { status: turn.status })
  }
  return createUIMessageStreamResponse({ stream: turn.stream })
}

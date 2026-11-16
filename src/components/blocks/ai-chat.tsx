"use client"

// AI chat v2 (docs/specs/ai-chat/01-specification.md §3, §7–§9). The answer
// = the model's prose + blocks the app builds from data parts of the route:
// found records (<RecordsBlock>), statistics (<StatsBlock>), «Источники
// ответа», «CRM · интернет · N с», and for platform admins «Ход
// рассуждений». No tool calls, JSON, ids or reasoning reach this component
// for other users — the route strips them on the server (§9).
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport, type FileUIPart, type UIMessage } from "ai"
import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  Component,
  type ReactNode,
} from "react"
import { CopyIcon, CheckIcon, CircleAlert, Paperclip } from "lucide-react"
import { toast } from "sonner"
import {
  useJsonRenderMessage,
  Renderer,
  JSONUIProvider,
} from "@json-render/react"

import { registry } from "@/lib/registry"
import { usePanelContext } from "@/lib/chat-panel-context"
import { useGlobalChat } from "@/lib/global-chat-context"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { sanitizeSpec } from "@/lib/json-render-sanitize"
import {
  chatErrorText,
  dataParts,
  mergeEvidenceParts,
  mergeRecordsParts,
  type ChatStatus,
} from "@/lib/chat/turn"
import {
  NEW_CHAT_TITLE,
  isThreadId,
  type ChatMessageMetadata,
  type ChatThreadSummary,
} from "@/lib/chat/thread"
import { ChatSourceMenu, FeedbackButtons, ThreadControls } from "@/components/blocks/chat/thread-ui"
import {
  AttachmentReadStatus,
  CameraMenuItem,
  InputAttachmentChips,
  SentFileChip,
  VoiceAttachButton,
  uploadChatFiles,
} from "@/components/blocks/chat/chat-files"
import { CHAT_FILE_ACCEPT, CHAT_FILES_PER_MESSAGE } from "@/lib/chat/files"

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation"
import {
  Message,
  MessageContent,
  MessageActions,
  MessageAction,
  MessageResponse,
} from "@/components/ai-elements/message"
import {
  PromptInputProvider,
  PromptInput,
  PromptInputTextarea,
  PromptInputTools,
  PromptInputActionMenu,
  PromptInputActionMenuTrigger,
  PromptInputActionMenuContent,
  PromptInputActionAddAttachments,
  PromptInputSubmit,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input"
import { SpeechInput } from "@/components/ai-elements/speech-input"
import {
  ModelSelector,
  ModelSelectorTrigger,
  ModelSelectorContent,
  ModelSelectorInput,
  ModelSelectorList,
  ModelSelectorGroup,
  ModelSelectorItem,
  ModelSelectorLogo,
  ModelSelectorName,
} from "@/components/ai-elements/model-selector"
import { RecordsBlock } from "@/components/blocks/chat/records-block"
import { StatsBlock } from "@/components/blocks/chat/stats-block"
import { DraftCard } from "@/components/blocks/chat/draft-card"
import { QuestionBlock } from "@/components/blocks/chat/question-block"
import {
  ChatErrorLine,
  ChatStatusLine,
  DebugBlock,
  EvidenceBlock,
  TurnLine,
} from "@/components/blocks/chat/turn-ui"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import Image from "next/image"
import { BrandMark } from "./brand-mark"
import { useAiProcessModels } from "@/lib/use-ai-process-models"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Files: any type the parsers read (docs/specs/ai-chat-tools §5); the exact
// per-type limits are checked on upload (src/lib/chat/files.ts).
const MAX_FILE_SIZE = 50 * 1024 * 1024

/** The page the user is on (Q12) — the route checks the record in the org. */
function currentPage(): string | undefined {
  if (typeof window === "undefined") return undefined
  return window.location.pathname + window.location.search
}

// ---------------------------------------------------------------------------
// Chat history (§16.1): which chat is open. The messages live on the server;
// this part loads a chat, starts a new one and keeps the user's chat list.
// ---------------------------------------------------------------------------

const LAST_THREAD_KEY = "ai-chat:last-thread"

function rememberThread(id: string | null) {
  try {
    if (id) window.localStorage.setItem(LAST_THREAD_KEY, id)
    else window.localStorage.removeItem(LAST_THREAD_KEY)
  } catch {
    // storage blocked — the chat still works, it just opens empty after a reload
  }
}

function recallThread(): string | null {
  try {
    const v = window.localStorage.getItem(LAST_THREAD_KEY)
    return isThreadId(v) ? v : null
  } catch {
    return null
  }
}

type OpenChat = { id: string; messages: UIMessage[]; saved: boolean; ingestOff: boolean }

export function AIChat({ className, isAdmin = false }: { className?: string; isAdmin?: boolean }) {
  const { open: panelOpen } = useGlobalChat()
  const [threads, setThreads] = useState<ChatThreadSummary[]>([])
  const [current, setCurrent] = useState<OpenChat | null>(null)
  const started = useRef(false)

  const refreshThreads = useCallback(async () => {
    try {
      const r = await fetch("/api/chat/threads")
      if (!r.ok) return
      const data = (await r.json()) as { threads?: ChatThreadSummary[] }
      setThreads(data.threads ?? [])
    } catch {
      // list stays as it was
    }
  }, [])

  const newChat = useCallback(() => {
    setCurrent({ id: crypto.randomUUID(), messages: [], saved: false, ingestOff: false })
    rememberThread(null)
  }, [])

  const openThread = useCallback(
    async (id: string) => {
      try {
        const r = await fetch(`/api/chat/threads/${encodeURIComponent(id)}`)
        if (!r.ok) throw new Error(String(r.status))
        const data = (await r.json()) as { messages: UIMessage[]; thread?: ChatThreadSummary }
        setCurrent({ id, messages: data.messages ?? [], saved: true, ingestOff: data.thread?.ingestMode === "off" })
        rememberThread(id)
      } catch {
        toast.error("Не удалось открыть чат")
        newChat()
      }
    },
    [newChat],
  )

  // First open of the panel: the chat list + the last chat of this browser.
  useEffect(() => {
    if (!panelOpen || started.current) return
    started.current = true
    void refreshThreads()
    const last = recallThread()
    if (last) void openThread(last)
    else newChat()
  }, [panelOpen, refreshThreads, openThread, newChat])

  const title = current ? (threads.find((t) => t.id === current.id)?.title ?? NEW_CHAT_TITLE) : NEW_CHAT_TITLE

  const renameCurrent = useCallback(
    async (next: string) => {
      if (!current) return false
      const r = await fetch(`/api/chat/threads/${encodeURIComponent(current.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next }),
      }).catch(() => null)
      if (!r?.ok) {
        toast.error("Не удалось переименовать чат")
        return false
      }
      setThreads((list) => list.map((t) => (t.id === current.id ? { ...t, title: next } : t)))
      return true
    },
    [current],
  )

  const deleteCurrent = useCallback(async () => {
    if (!current) return
    const r = await fetch(`/api/chat/threads/${encodeURIComponent(current.id)}`, { method: "DELETE" }).catch(() => null)
    if (!r?.ok) {
      toast.error("Не удалось удалить чат")
      return
    }
    setThreads((list) => list.filter((t) => t.id !== current.id))
    newChat()
  }, [current, newChat])

  // «Не передавать в источники»: a chat not yet on the server keeps it
  // locally and creates the thread with it on the first send.
  const toggleIngest = useCallback(
    async (off: boolean, onServer: boolean) => {
      if (!current) return
      if (onServer) {
        const r = await fetch(`/api/chat/threads/${encodeURIComponent(current.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ingestMode: off ? "off" : "on" }),
        }).catch(() => null)
        if (!r?.ok) {
          toast.error("Не удалось изменить настройку чата")
          return
        }
      }
      setCurrent((c) => (c && c.id === current.id ? { ...c, ingestOff: off } : c))
      toast.success(off ? "Эта беседа не будет передаваться в источники" : "Беседа снова передаётся в источники")
    },
    [current],
  )

  const ingestNow = useCallback(async () => {
    if (!current) return
    const r = await fetch(`/api/chat/threads/${encodeURIComponent(current.id)}/ingest`, { method: "POST" }).catch(() => null)
    const data = (await r?.json().catch(() => null)) as { message?: string; error?: string } | null
    if (!r?.ok) toast.error(data?.error ?? "Не удалось передать чат в источники")
    else toast.success(data?.message ?? "Передано в источники")
  }, [current])

  if (!current) {
    return (
      <div
        className={cn(
          "flex h-full flex-col items-center justify-center rounded-md border-2 border-gray-200 dark:border-gray-700 bg-card text-sm text-muted-foreground",
          className,
        )}
      >
        Загрузка…
      </div>
    )
  }

  return (
    <ChatSession
      key={current.id}
      className={className}
      isAdmin={isAdmin}
      threadId={current.id}
      initialMessages={current.messages}
      ingestOff={current.ingestOff}
      renderMenu={({ busy, hasMessages }) => (
        <ChatSourceMenu
          ingestOff={current.ingestOff}
          canIngestNow={current.saved || hasMessages}
          disabled={busy}
          onIngestNow={() => void ingestNow()}
          onToggleIngest={(off) => void toggleIngest(off, current.saved || hasMessages)}
        />
      )}
      renderControls={({ busy, hasMessages }) => (
        <ThreadControls
          title={title}
          currentId={current.id}
          threads={threads}
          saved={current.saved || hasMessages}
          disabled={busy}
          onSelect={(id) => {
            if (id !== current.id) void openThread(id)
          }}
          onNew={newChat}
          onRename={renameCurrent}
          onDelete={deleteCurrent}
        />
      )}
      onAnswered={() => {
        rememberThread(current.id)
        void refreshThreads()
      }}
    />
  )
}

// ---------------------------------------------------------------------------
// One chat session (useChat). Keyed by the thread id: another chat = a new
// session with the messages loaded from the server.
// ---------------------------------------------------------------------------

function ChatSession({
  className,
  isAdmin,
  threadId,
  initialMessages,
  ingestOff,
  renderControls,
  renderMenu,
  onAnswered,
}: {
  className?: string
  isAdmin: boolean
  threadId: string
  initialMessages: UIMessage[]
  /** «Не передавать в источники» (sent when the first message creates the thread). */
  ingestOff: boolean
  renderControls: (s: { busy: boolean; hasMessages: boolean }) => ReactNode
  renderMenu: (s: { busy: boolean; hasMessages: boolean }) => ReactNode
  onAnswered: () => void
}) {
  // Model picker only when the admin allowed more than one model (Q1).
  const { models, defaultModelId } = useAiProcessModels("chat.assistant")
  const [pickedModel, setPickedModel] = useState<string | null>(null)
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false)
  const selectedModel =
    (pickedModel && models.some((m) => m.id === pickedModel) ? pickedModel : null) ??
    defaultModelId
  const currentModel = models.find((m) => m.id === selectedModel) ?? models[0] ?? null
  const showPicker = models.length > 1

  // Read at request time (ref) so the transport is created once.
  const bodyRef = useRef<{ model: string | null | undefined; ingestMode: "on" | "off" }>({
    model: selectedModel,
    ingestMode: ingestOff ? "off" : "on",
  })
  useEffect(() => {
    bodyRef.current = { model: showPicker ? selectedModel : undefined, ingestMode: ingestOff ? "off" : "on" }
  }, [selectedModel, showPicker, ingestOff])

  /* eslint-disable react-hooks/refs */
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        // Only the new message: the server loads the history of the thread (§16.1).
        prepareSendMessagesRequest: ({ id, messages, trigger }) => ({
          body: {
            chatId: id,
            message: messages[messages.length - 1],
            trigger,
            ...bodyRef.current,
            page: currentPage(),
          },
        }),
      }),
    [],
  )
  /* eslint-enable react-hooks/refs */

  // Monthly AI limit (Q15): checked when the panel opens and on a refused request.
  const [limitMessage, setLimitMessage] = useState<string | null>(null)
  const { open: panelOpen } = useGlobalChat()
  const refreshLimit = useCallback(() => {
    fetch("/api/chat/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { limit?: { blocked?: boolean; message?: string | null } } | null) => {
        if (!data?.limit) return
        setLimitMessage(data.limit.blocked ? (data.limit.message ?? null) : null)
      })
      .catch(() => {})
  }, [])
  useEffect(() => {
    if (panelOpen) refreshLimit()
  }, [panelOpen, refreshLimit])

  // The status line of the running request (transient data parts, §9).
  const [liveStatus, setLiveStatus] = useState<ChatStatus | null>(null)

  const { messages, sendMessage, status, stop, error, clearError, regenerate } = useChat({
    id: threadId,
    messages: initialMessages,
    transport,
    onFinish: () => onAnswered(),
    onData: (part) => {
      if (part.type === "data-status") setLiveStatus(part.data as ChatStatus)
    },
    onError: (err) => {
      const { cls, text } = chatErrorText(err.message)
      if (cls === "limit") {
        setLimitMessage(text)
        refreshLimit()
      }
    },
  })

  const isStreaming = status === "streaming"
  const isLoading = status === "submitted" || isStreaming
  useEffect(() => {
    if (!isLoading) setLiveStatus(null)
  }, [isLoading])

  const failure = error ? chatErrorText(error.message) : null

  const handleSubmit = useCallback(
    async (message: PromptInputMessage) => {
      clearError()
      setLiveStatus(null)
      // Files are detached from the chat first (uploaded + stored as source
      // items); the message carries only their links (ai-chat-tools Q22).
      let files: FileUIPart[] = []
      if (message.files.length) {
        const t = toast.loading(message.files.length > 1 ? `Загружаю файлы (${message.files.length})…` : "Загружаю файл…")
        try {
          files = await uploadChatFiles(message.files)
          toast.dismiss(t)
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Не удалось загрузить файл", { id: t })
          throw e // keeps the text and the files in the input
        }
      }
      await sendMessage({ text: message.text, files })
    },
    [sendMessage, clearError],
  )

  const handleSpeechTranscription = useCallback(
    (text: string) => {
      clearError()
      sendMessage({ text })
    },
    [sendMessage, clearError],
  )

  // A quick reply of a clarification question = a normal user message (ai-chat-tools §12).
  const handleQuickReply = useCallback(
    (text: string) => {
      clearError()
      void sendMessage({ text })
    },
    [sendMessage, clearError],
  )

  const handleRetry = useCallback(() => {
    clearError()
    setLiveStatus(null)
    void regenerate()
  }, [regenerate, clearError])

  const last = messages[messages.length - 1]
  // While the request is sent but no assistant message exists yet.
  const pendingStatus = isLoading && last?.role === "user"

  return (
    <div
      className={cn(
        "flex h-full flex-col rounded-md border-2 border-gray-200 dark:border-gray-700 bg-card text-card-foreground",
        className,
      )}
    >
      {/* Header */}
      <div className="flex min-h-11 items-center gap-2 border-b px-2 py-2">
        {renderControls({ busy: isLoading, hasMessages: messages.length > 0 })}
        <div className="flex shrink-0 items-center gap-1">
          {showPicker && (
            <ModelSelector open={modelSelectorOpen} onOpenChange={setModelSelectorOpen}>
              <ModelSelectorTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-2 text-xs">
                  {currentModel?.vendor && (
                    <ModelSelectorLogo provider={currentModel.vendor} className="size-4" />
                  )}
                  {currentModel?.name ?? "Модель"}
                </Button>
              </ModelSelectorTrigger>
              <ModelSelectorContent>
                <ModelSelectorInput placeholder="Поиск моделей..." />
                <ModelSelectorList>
                  <ModelSelectorGroup heading="Доступные модели">
                    {models.map((model) => (
                      <ModelSelectorItem
                        key={model.id}
                        value={`${model.name} ${model.id}`}
                        onSelect={() => {
                          setPickedModel(model.id)
                          setModelSelectorOpen(false)
                        }}
                      >
                        {model.vendor && (
                          <ModelSelectorLogo provider={model.vendor} className="size-4" />
                        )}
                        <ModelSelectorName>{model.name}</ModelSelectorName>
                      </ModelSelectorItem>
                    ))}
                  </ModelSelectorGroup>
                </ModelSelectorList>
              </ModelSelectorContent>
            </ModelSelector>
          )}

          {renderMenu({ busy: isLoading, hasMessages: messages.length > 0 })}
        </div>
      </div>

      {/* Messages area */}
      <Conversation className="flex-1">
        <ConversationContent>
          {messages.length === 0 ? (
            <ConversationEmptyState
              title=""
              description={
                ingestOff
                  ? "Спросите о клиентах, сделках, заказах, задачах, письмах или попросите статистику. Эта беседа не передаётся в источники."
                  : "Спросите о клиентах, сделках, заказах, задачах, письмах или попросите статистику. Беседы с ИИ попадают в источники организации."
              }
              icon={<BrandMark className="size-9 rounded-xl" />}
            />
          ) : (
            messages.map((message, i) => (
              <ChatMessage
                key={message.id}
                message={message}
                isLive={isLoading && i === messages.length - 1 && message.role === "assistant"}
                liveStatus={liveStatus}
                isAdmin={isAdmin}
                answer={message.role === "assistant" ? nextUserText(messages, i) : null}
                busy={isLoading}
                onQuickReply={handleQuickReply}
              />
            ))
          )}
          {pendingStatus && (
            <Message from="assistant">
              <MessageContent>
                <ChatStatusLine status={liveStatus} />
              </MessageContent>
            </Message>
          )}
          {failure && !isLoading && (
            <ChatErrorLine
              text={failure.text}
              onRetry={failure.cls === "limit" ? undefined : handleRetry}
            />
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {/* Input area */}
      <div className="border-t p-4">
        {limitMessage ? (
          <Alert>
            <CircleAlert />
            <AlertDescription>{limitMessage}</AlertDescription>
          </Alert>
        ) : (
          <PromptInputProvider>
            <PromptInput
              onSubmit={handleSubmit}
              accept={CHAT_FILE_ACCEPT}
              maxFileSize={MAX_FILE_SIZE}
              maxFiles={CHAT_FILES_PER_MESSAGE}
              onError={(err) => toast.error(err.message)}
            >
              <InputAttachmentChips />
              <PromptInputTextarea placeholder="Введите сообщение или прикрепите файл / голосовое…" />
              <PromptInputTools className="pr-3 flex flex-row gap-2">
                <PromptInputActionMenu>
                  <PromptInputActionMenuTrigger />
                  <PromptInputActionMenuContent>
                    <PromptInputActionAddAttachments label="Прикрепить файл" />
                    <CameraMenuItem />
                  </PromptInputActionMenuContent>
                </PromptInputActionMenu>
                <SpeechInput
                  size="icon-sm"
                  variant="ghost"
                  onTranscriptionChange={handleSpeechTranscription}
                />
                <VoiceAttachButton disabled={isLoading} />
                <PromptInputSubmit variant="ghost" status={status} onStop={stop} />
              </PromptInputTools>
            </PromptInput>
          </PromptInputProvider>
        )}

        <p className="mt-3 px-6 text-xs leading-snug text-muted-foreground text-left">
          В чате используются большие языковые модели для агентного поиска и
          рассуждений. Эти модели могут ошибаться или давать неверные
          рекомендации.
          <br />
          Если информация важна для ваших бизнес-процессов или решений,
          рекомендуем перепроверять её по другим источникам.
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// One message
// ---------------------------------------------------------------------------

/** Text of the first user message after `index`; null = none yet. */
function nextUserText(messages: readonly UIMessage[], index: number): string | null {
  const next = messages.slice(index + 1).find((m) => m.role === "user")
  if (!next) return null
  return next.parts
    .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n")
}

function ChatMessage({
  message,
  isLive,
  liveStatus,
  isAdmin,
  answer,
  busy,
  onQuickReply,
}: {
  message: UIMessage
  /** The assistant message of the request that is still running. */
  isLive: boolean
  liveStatus: ChatStatus | null
  isAdmin: boolean
  /** The user's reply after this message (questions); null = not answered yet. */
  answer: string | null
  /** A chat request is running. */
  busy: boolean
  onQuickReply: (text: string) => void
}) {
  const isAssistant = message.role === "assistant"
  const { openRecord, openPanel } = usePanelContext()

  const { spec, hasSpec } = useJsonRenderMessage(message.parts)
  const records = useMemo(() => mergeRecordsParts(dataParts(message.parts, "records")), [message.parts])
  const stats = useMemo(() => dataParts(message.parts, "stats"), [message.parts])
  const evidence = useMemo(() => mergeEvidenceParts(dataParts(message.parts, "evidence")), [message.parts])
  const turn = dataParts(message.parts, "turn")[0] ?? null
  const debug = isAdmin ? (dataParts(message.parts, "debug")[0] ?? null) : null

  const text = message.parts
    .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n")
  // The status line stays until the answer text starts (§9).
  const showStatus = isLive && !text

  const recordsShown =
    records && (Object.values(records.hits).some((l) => l && l.length) || records.applied?.length)

  return (
    <Message from={message.role}>
      <MessageContent className={isAssistant ? "w-full max-w-full" : undefined}>
        {showStatus && <ChatStatusLine status={liveStatus} />}

        {message.parts.map((part, index) => {
          const key = `${message.id}-${index}`
          if (part.type === "text") {
            if (!part.text) return null
            return isAssistant ? (
              <MessageResponse key={key} isAnimating={isLive}>
                {part.text}
              </MessageResponse>
            ) : (
              <p key={key} className="whitespace-pre-wrap">
                {part.text}
              </p>
            )
          }
          if (part.type === "file" && !part.url) {
            // A big file is kept in the history by name only (§16.1).
            return (
              <p key={key} className="text-muted-foreground flex items-center gap-1 text-xs">
                <Paperclip className="size-3.5" />
                {part.filename ?? "Файл"} — не сохранён в истории чата
              </p>
            )
          }
          if (part.type === "file" && !part.mediaType?.startsWith("image/")) {
            return <SentFileChip key={key} url={part.url} mediaType={part.mediaType} name={part.filename ?? "Файл"} />
          }
          if (part.type === "file" && part.mediaType?.startsWith("image/")) {
            return (
              <div key={key} className="relative max-w-sm">
                <Image
                  src={part.url}
                  alt="Изображение"
                  width={512}
                  height={512}
                  className="rounded-lg"
                  unoptimized
                />
              </div>
            )
          }
          return null
        })}

        {!isAssistant && <AttachmentReadStatus items={dataParts(message.parts, "attachment")} />}

        {isAssistant &&
          dataParts(message.parts, "question").map((q) => (
            <QuestionBlock key={q.id} part={q} answer={answer} busy={busy} onAnswer={onQuickReply} />
          ))}

        {isAssistant && dataParts(message.parts, "draft").map((p) => <DraftCard key={p.actionId} part={p} />)}

        {isAssistant && recordsShown && records && (
          <RecordsBlock data={records} onOpen={(type, id, title) => openRecord(type, id, title)} className="mt-2" />
        )}

        {isAssistant && stats.map((s, i) => <StatsBlock key={`${message.id}-stats-${i}`} result={s} />)}

        {isAssistant && hasSpec && spec && (
          <div
            className="w-full rounded-lg border bg-card cursor-pointer hover:border-primary/50 transition-colors mt-3"
            onClick={() => openPanel({ spec, messageId: message.id, title: "Подробности" })}
          >
            <div className="flex items-center justify-between px-3 py-2 border-b">
              <span className="text-xs font-medium text-muted-foreground">Подробнее</span>
              <span className="text-xs text-muted-foreground">Нажмите, чтобы развернуть ↗</span>
            </div>
            <InlinePreview spec={spec} loading={isLive} />
          </div>
        )}

        {isAssistant && evidence && <EvidenceBlock evidence={evidence} onOpen={openRecord} />}
        {isAssistant && turn && !isLive && <TurnLine turn={turn} />}
        {isAssistant && debug && !isLive && <DebugBlock debug={debug} />}
      </MessageContent>

      {isAssistant && !isLive && text && (
        <MessageActions className="flex-wrap">
          <CopyButton text={text} />
          <FeedbackButtons
            messageId={message.id}
            initial={(message.metadata as ChatMessageMetadata | undefined)?.feedback ?? null}
          />
        </MessageActions>
      )}
    </Message>
  )
}

// ---------------------------------------------------------------------------
// Inline preview of a composed json-render view (Q6). Forces a resize tick
// after mount so Recharts' ResponsiveContainer measures its parent.
// ---------------------------------------------------------------------------

function InlinePreview({ spec, loading }: { spec: unknown; loading?: boolean }) {
  useEffect(() => {
    if (loading) return
    const raf = requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"))
    })
    return () => cancelAnimationFrame(raf)
  }, [spec, loading])

  const safeSpec = useMemo(() => sanitizeSpec(spec), [spec])

  return (
    <div className="w-full max-h-96 overflow-auto relative p-3">
      <RendererErrorBoundary>
        <JSONUIProvider
          registry={registry}
          initialState={(safeSpec as { state?: Record<string, unknown> })?.state ?? {}}
        >
          <Renderer
            spec={safeSpec as Parameters<typeof Renderer>[0]["spec"]}
            registry={registry}
            loading={loading}
          />
        </JSONUIProvider>
      </RendererErrorBoundary>
    </div>
  )
}

class RendererErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) {
      return (
        <p className="text-xs text-muted-foreground italic py-2">
          Не удалось отобразить структурированный контент.
        </p>
      )
    }
    return this.props.children
  }
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [text])

  return (
    <MessageAction tooltip="Копировать" onClick={handleCopy}>
      {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
    </MessageAction>
  )
}

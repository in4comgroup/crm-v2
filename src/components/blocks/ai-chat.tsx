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
import { CopyIcon, CheckIcon, Save, Trash2Icon, CircleAlert } from "lucide-react"
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
import { SaveChatDialog } from "@/components/blocks/save-chat-dialog"
import { RecordsBlock } from "@/components/blocks/chat/records-block"
import { StatsBlock } from "@/components/blocks/chat/stats-block"
import {
  ChatErrorLine,
  ChatStatusLine,
  DebugBlock,
  EvidenceBlock,
  TurnLine,
} from "@/components/blocks/chat/turn-ui"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import Image from "next/image"
import { BrandMark } from "./brand-mark"
import { useAiProcessModels } from "@/lib/use-ai-process-models"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACCEPTED_FILE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
]

const ACCEPTED_EXTENSIONS = ".png,.jpg,.jpeg,.gif,.webp,.txt,.md,.csv,.json"

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

function validateFiles(files: FileUIPart[]): FileUIPart[] {
  const valid: FileUIPart[] = []
  for (const file of files) {
    if (!ACCEPTED_FILE_TYPES.includes(file.mediaType)) {
      toast.error(
        `Неподдерживаемый тип файла: ${file.mediaType}. Поддерживаются: изображения, .txt, .md, .csv, .json`,
      )
      continue
    }
    valid.push(file)
  }
  return valid
}

/** The page the user is on (Q12) — the route checks the record in the org. */
function currentPage(): string | undefined {
  if (typeof window === "undefined") return undefined
  return window.location.pathname + window.location.search
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AIChat({ className, isAdmin = false }: { className?: string; isAdmin?: boolean }) {
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
  const bodyRef = useRef<{ model: string | null | undefined }>({ model: selectedModel })
  useEffect(() => {
    bodyRef.current = { model: showPicker ? selectedModel : undefined }
  }, [selectedModel, showPicker])

  /* eslint-disable react-hooks/refs */
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: () => ({ ...bodyRef.current, page: currentPage() }),
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

  const { messages, sendMessage, status, stop, setMessages, error, clearError, regenerate } = useChat({
    transport,
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
      await sendMessage({ text: message.text, files: validateFiles(message.files) })
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

  const handleRetry = useCallback(() => {
    clearError()
    setLiveStatus(null)
    void regenerate()
  }, [regenerate, clearError])

  const handleClear = useCallback(() => {
    clearError()
    setMessages([])
  }, [setMessages, clearError])

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
      <div className="flex min-h-11 items-center justify-end border-b px-4 py-2">
        <div className="flex items-center gap-1">
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

          {messages.length > 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-sm" onClick={handleClear} disabled={isLoading}>
                    <Trash2Icon className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Очистить переписку</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* Replaced by automatic ingest + «Передать в источники сейчас» in CH6 (Q24). */}
          {messages.length > 0 && (
            <SaveChatDialog
              messages={messages}
              onSaved={() => {}}
              trigger={
                <Button variant="outline" size="sm" disabled={isLoading} className="gap-1">
                  <Save className="size-4" />
                  Сохранить чат
                </Button>
              }
            />
          )}
        </div>
      </div>

      {/* Messages area */}
      <Conversation className="flex-1">
        <ConversationContent>
          {messages.length === 0 ? (
            <ConversationEmptyState
              title=""
              description="Спросите о клиентах, сделках, заказах, задачах, письмах или попросите статистику — я найду в CRM и, если нужно, в интернете."
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
              accept={ACCEPTED_EXTENSIONS}
              maxFileSize={MAX_FILE_SIZE}
              onError={(err) => toast.error(err.message)}
            >
              <PromptInputTextarea placeholder="Введите сообщение..." />
              <PromptInputTools className="pr-3 flex flex-row gap-2">
                <PromptInputActionMenu>
                  <PromptInputActionMenuTrigger />
                  <PromptInputActionMenuContent>
                    <PromptInputActionAddAttachments />
                  </PromptInputActionMenuContent>
                </PromptInputActionMenu>
                <SpeechInput
                  size="icon-sm"
                  variant="ghost"
                  onTranscriptionChange={handleSpeechTranscription}
                />
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

function ChatMessage({
  message,
  isLive,
  liveStatus,
  isAdmin,
}: {
  message: UIMessage
  /** The assistant message of the request that is still running. */
  isLive: boolean
  liveStatus: ChatStatus | null
  isAdmin: boolean
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
        <MessageActions>
          <CopyButton text={text} />
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

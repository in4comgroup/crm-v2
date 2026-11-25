"use client"

// The AI chat, lifted from the dashboard into an app-wide slide-over —
// reachable from any page's header via <AiChatTrigger/>, same as
// <GlobalSearch/>. <AiChatPanel/> is mounted ONCE at the (protected) layout
// level so it survives page navigation and never remounts <AIChat/> (which
// would reset the conversation) — it's always in the DOM, just translated
// off-screen via CSS when closed, not conditionally rendered.
import { useEffect, useState } from "react"
import { AIChat } from "@/components/blocks/ai-chat"
import { RecordDetailView } from "@/components/blocks/chat/record-detail-view"
import type { RecordDetail } from "@/lib/chat/records"
import {
  isRecordPanelContent,
  usePanelContext,
} from "@/lib/chat-panel-context"
import { useGlobalChat } from "@/lib/global-chat-context"
import { Renderer, JSONUIProvider } from "@json-render/react"
import { registry } from "@/lib/registry"
import { sanitizeSpec } from "@/lib/json-render-sanitize"
import { XIcon, ArrowLeftIcon, Bot } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { CodeHighlighter } from "@/components/code-highlighter"
import { cn } from "@/lib/utils"
import { Component, type ReactNode } from "react"

export function AiChatTrigger() {
  const { open, openChat } = useGlobalChat()
  return (
    <Button variant={open ? "default" : "outline"} size="sm" onClick={openChat}>
      <Bot className="h-4 w-4 mr-1" />
      ИИ чат
    </Button>
  )
}

/**
 * `isAdmin` = platform admin (from the layout's session): «Отладка» views
 * (record JSON, composed spec source) — docs/specs/ai-chat Q5. Never shown
 * to other users; the chat route also strips debug data for them.
 */
export function AiChatPanel({ isAdmin = false }: { isAdmin?: boolean }) {
  const { open, closeChat } = useGlobalChat()
  const { content, history, closePanel, goBack, openRecord } =
    usePanelContext()
  // Titles of records whose detail has loaded (panel title when the record
  // was opened without one), keyed by "type:id".
  const [recordTitles, setRecordTitles] = useState<Record<string, string>>({})
  // Last loaded record detail (admin «Отладка» JSON view), keyed by "type:id".
  const [recordDetails, setRecordDetails] = useState<Record<string, RecordDetail>>({})

  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !e.defaultPrevented) closeChat()
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [open, closeChat])

  const record = isRecordPanelContent(content) ? content : null
  const specContent =
    content && !isRecordPanelContent(content) ? content : null
  const safeSpec = specContent?.spec ? sanitizeSpec(specContent.spec) : null
  const panelTitle = record
    ? record.title ||
      recordTitles[`${record.type}:${record.id}`] ||
      "Загрузка…"
    : content?.title || "Подробности"

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40"
          onClick={closeChat}
          aria-hidden
        />
      )}
      <div
        role="dialog"
        aria-modal={open}
        inert={!open}
        aria-label="ИИ чат"
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-full border-l bg-background shadow-xl transition-transform duration-300",
          content ? "md:w-[90vw] lg:w-[70vw]" : "sm:w-[520px]",
          open ? "translate-x-0" : "translate-x-full pointer-events-none",
        )}
      >
        {/* Chat column */}
        <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", content && "hidden md:flex")}>
          <div className="flex items-center justify-between border-b px-3 py-2">
            <h3 className="text-sm font-semibold">ИИ чат</h3>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={closeChat}
              aria-label="Закрыть чат"
            >
              <XIcon className="size-4" />
            </Button>
          </div>
          <div className="min-h-0 flex-1 p-3">
            <AIChat className="h-full" isAdmin={isAdmin} />
          </div>
        </div>

        {/* Detail panel */}
        {content && (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-card md:w-1/2 md:flex-none md:border-l">
            <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
              <div className="flex min-w-0 items-center gap-2">
                {history.length > 0 && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={goBack}
                    aria-label="Назад"
                  >
                    <ArrowLeftIcon className="size-4" />
                  </Button>
                )}
                <h3 className="truncate text-sm font-semibold">{panelTitle}</h3>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={closePanel}
                aria-label="Закрыть панель"
              >
                <XIcon className="size-4" />
              </Button>
            </div>

            {record ? (
              <Tabs
                key={`${record.type}:${record.id}`}
                defaultValue="rendered"
                className="flex-1 min-h-0 flex flex-col"
              >
                {isAdmin && (
                  <div className="px-4 pt-3">
                    <TabsList>
                      <TabsTrigger value="rendered">Просмотр</TabsTrigger>
                      <TabsTrigger value="debug">Отладка</TabsTrigger>
                    </TabsList>
                  </div>
                )}
                <TabsContent value="rendered" className="flex-1 min-h-0 overflow-y-auto p-4">
                  <RecordDetailView
                    type={record.type}
                    id={record.id}
                    onOpenRecord={openRecord}
                    onLoaded={(d) => {
                      const k = `${d.type}:${d.id}`
                      setRecordTitles((t) => (t[k] === d.title ? t : { ...t, [k]: d.title }))
                      if (isAdmin) setRecordDetails((m) => (m[k] === d ? m : { ...m, [k]: d }))
                    }}
                  />
                </TabsContent>
                {isAdmin && (
                  <TabsContent value="debug" className="flex-1 min-h-0 overflow-y-auto p-4">
                    <CodeHighlighter
                      code={JSON.stringify(recordDetails[`${record.type}:${record.id}`] ?? null, null, 2)}
                      language="json"
                      showLineNumbers
                    />
                  </TabsContent>
                )}
              </Tabs>
            ) : (
            <Tabs defaultValue="rendered" className="flex-1 min-h-0 flex flex-col">
              <div className="px-4 pt-3">
                {isAdmin && (
                  <TabsList>
                    <TabsTrigger value="rendered">Просмотр</TabsTrigger>
                    <TabsTrigger value="source">Отладка</TabsTrigger>
                  </TabsList>
                )}
              </div>

              <TabsContent
                value="rendered"
                className="flex-1 min-h-0 overflow-y-auto p-4"
              >
                <RendererErrorBoundary>
                  <JSONUIProvider
                    registry={registry}
                    initialState={
                      (safeSpec as { state?: Record<string, unknown> })
                        ?.state ?? {}
                    }
                  >
                    <Renderer
                      spec={safeSpec as Parameters<typeof Renderer>[0]["spec"]}
                      registry={registry}
                    />
                  </JSONUIProvider>
                </RendererErrorBoundary>
              </TabsContent>

              {isAdmin && (
              <TabsContent
                value="source"
                className="flex-1 min-h-0 overflow-y-auto p-4"
              >
                <CodeHighlighter
                  code={JSON.stringify(specContent?.spec, null, 2)}
                  language="json"
                  showLineNumbers
                />
              </TabsContent>
              )}
            </Tabs>
            )}
          </div>
        )}
      </div>
    </>
  )
}

class RendererErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
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
        <p className="text-sm text-muted-foreground italic p-4">
          Не удалось отобразить структурированный контент.
        </p>
      )
    }
    return this.props.children
  }
}

"use client"

// Parts of one AI chat answer around the prose (docs/specs/ai-chat/01-
// specification.md §3, §9): the status line while the request runs, the
// «Источники ответа» block, the line «CRM · интернет · 7 с» and — for
// platform admins only — the collapsed «Ход рассуждений». Everything here
// is built from data parts the route wrote; nothing from the model's text.
import { useState } from "react"
import { ChevronRight, Globe, RotateCcw, TriangleAlert } from "lucide-react"
import { Shimmer } from "@/components/ai-elements/shimmer"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import type { RecordType } from "@/lib/chat/records"
import { turnLine, type ChatDebugPart, type ChatEvidencePart, type ChatStatus, type ChatTurnPart } from "@/lib/chat/turn"
import { cn } from "@/lib/utils"
import { RECORD_TYPE_ICONS, formatRecordDate } from "./record-ui"

/** One status line with a shimmer (§9); updates in place. */
export function ChatStatusLine({ status }: { status: ChatStatus | null }) {
  return (
    <Shimmer duration={1.2} className="text-sm">
      {status?.label ?? "Думаю…"}
    </Shimmer>
  )
}

function webHost(url: string, title: string): string {
  // Grounding links are redirects; their title is the real site.
  if (title && !/^https?:/i.test(title)) return title
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

/** «Источники ответа»: the source items the model read + the web pages it used. */
export function EvidenceBlock({
  evidence,
  onOpen,
}: {
  evidence: ChatEvidencePart
  onOpen: (type: RecordType, id: string, title: string) => void
}) {
  const [open, setOpen] = useState(false)
  const count = evidence.sourceItems.length + evidence.web.length
  const Icon = RECORD_TYPE_ICONS.source_item
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-2 text-sm">
      <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs">
        <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        Источники ответа ({count})
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1.5 space-y-1 pl-4">
        {evidence.sourceItems.map((h) => (
          <button
            key={h.id}
            type="button"
            onClick={() => onOpen("source_item", h.id, h.title)}
            className="hover:bg-muted flex w-full items-center gap-2 rounded px-1.5 py-1 text-left"
          >
            <Icon className="text-muted-foreground size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{h.title}</span>
            {h.date && <span className="text-muted-foreground shrink-0 text-xs">{formatRecordDate(h.date)}</span>}
          </button>
        ))}
        {evidence.web.map((w) => (
          <a
            key={w.url}
            href={w.url}
            target="_blank"
            rel="noreferrer noopener"
            className="hover:bg-muted flex items-center gap-2 rounded px-1.5 py-1"
          >
            <Globe className="text-muted-foreground size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{webHost(w.url, w.title)}</span>
          </a>
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}

/** «CRM · интернет · 7 с» (Q10). */
export function TurnLine({ turn }: { turn: ChatTurnPart }) {
  return <p className="text-muted-foreground mt-1 text-xs">{turnLine(turn)}</p>
}

/** «Ход рассуждений» — platform admins only (Q5, Q11); closed by default. */
export function DebugBlock({ debug }: { debug: ChatDebugPart }) {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-2 rounded-md border border-dashed text-xs">
      <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex w-full items-center gap-1 px-2 py-1.5">
        <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        Ход рассуждений (администратор) · {debug.steps.filter((s) => s.kind === "tool").length} вызов(ов)
        {debug.model ? ` · ${debug.model}` : ""}
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 px-2 pb-2">
        {debug.steps.length === 0 && <p className="text-muted-foreground">Шагов нет — модель ответила сразу.</p>}
        {debug.steps.map((s, i) =>
          s.kind === "reasoning" ? (
            <div key={i}>
              <p className="font-medium">Рассуждение</p>
              <p className="text-muted-foreground whitespace-pre-wrap">{s.text}</p>
            </div>
          ) : (
            <div key={i} className={cn(s.error && "text-red-600 dark:text-red-400")}>
              <p className="font-medium">
                {s.tool} · {s.ms} мс{s.error ? " · ошибка" : ""}
              </p>
              <pre className="bg-muted mt-0.5 max-h-40 overflow-auto rounded p-1.5 whitespace-pre-wrap break-all">
                {s.input}
              </pre>
              {s.output && (
                <pre className="bg-muted mt-0.5 max-h-56 overflow-auto rounded p-1.5 whitespace-pre-wrap break-all">
                  {s.output}
                </pre>
              )}
            </div>
          ),
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

/** A failed request: Russian text by error class + «Повторить» (§9). */
export function ChatErrorLine({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm">
      <TriangleAlert className="size-4 shrink-0 text-red-600 dark:text-red-400" />
      <span className="flex-1">{text}</span>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="gap-1">
          <RotateCcw className="size-3.5" />
          Повторить
        </Button>
      )}
    </div>
  )
}

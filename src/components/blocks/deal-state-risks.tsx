"use client"

import { useCallback, useEffect, useState, useTransition } from "react"
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FileText,
  History,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ParsedMarkdownDialog } from "@/components/blocks/parsed-markdown-dialog"
import { getProvider } from "@/lib/sources/providers"
import type {
  DealRow,
  DealRisksResult,
  DealSourceRef,
  DealStateResult,
} from "@/app/api/deals/route"
import {
  DEAL_RISK_CLEARED_BY_LABELS_RU,
  DEAL_STATE_DECISION_LABELS_RU,
  DEAL_STATE_NO_DATA_TEXT,
  type DealRiskView,
} from "@/lib/topics/deal-state"

// «Текущее состояние» + «Риски» of the deal drawer (topics plan phase 5a,
// spec topics/01 §9.3 / §9.4 / §14). Data: GET /api/deals?stateFor= /
// ?risksFor= (stored text + version history; active + cleared risks). No LLM
// call on open — only «Обновить» runs the engine for this deal now (one
// `deals.state_summary` call at most).

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

type OpenItem = { id: string; title: string }

// «Источники»: one chip per item; a click opens the parsed markdown.
function SourceLinks({
  ids,
  sources,
  onOpen,
}: {
  ids: string[]
  sources: Record<string, DealSourceRef>
  onOpen: (item: OpenItem) => void
}) {
  const refs = ids.map((id) => sources[id]).filter((r): r is DealSourceRef => !!r)
  if (refs.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs">
      <span className="text-muted-foreground">Источники:</span>
      {refs.map((r) => {
        const provider = r.provider ? getProvider(r.provider) : null
        const title = r.title || "Сообщение без темы"
        return (
          <button
            key={r.id}
            type="button"
            onClick={() => onOpen({ id: r.id, title })}
            className="inline-flex max-w-[16rem] items-center gap-1 rounded border px-1.5 py-0.5 text-left hover:bg-accent"
            title={[provider?.label, r.date ? formatDate(r.date) : null, title]
              .filter(Boolean)
              .join(" · ")}
          >
            <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="truncate">{title}</span>
            {r.date && (
              <span className="shrink-0 text-muted-foreground">
                · {formatDate(r.date)}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

async function readError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  return body.error || fallback
}

// ---------------------------------------------------------------------------
// «Текущее состояние»
// ---------------------------------------------------------------------------

export function DealStateBlock({
  deal,
  active,
  onChanged,
}: {
  deal: DealRow
  // Load only while the drawer is open.
  active: boolean
  // After «Обновить» — the board re-reads the deals (card text + badge).
  onChanged: () => void
}) {
  const [data, setData] = useState<{
    dealId: string
    view: DealStateResult | null
    error: boolean
  } | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [openItem, setOpenItem] = useState<OpenItem | null>(null)
  const [isPending, startTransition] = useTransition()

  const load = useCallback((dealId: string) => {
    fetch(`/api/deals?stateFor=${encodeURIComponent(dealId)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error()
        const body = (await r.json()) as { state?: DealStateResult }
        setData({ dealId, view: body.state ?? null, error: false })
      })
      .catch(() => setData({ dealId, view: null, error: true }))
  }, [])

  // Reload on deal updates too (a stage move / edit marks the state dirty).
  useEffect(() => {
    if (!active) return
    load(deal.id)
  }, [active, deal.id, deal.updatedAt, deal.stateUpdatedAt, load])

  const view = data && data.dealId === deal.id ? data.view : null
  // The board row already carries the stored text — no flash while loading.
  const text = view ? view.text : deal.stateText
  const sourceIds = view ? view.sourceItemIds : deal.stateSourceItemIds
  const updatedAt = view ? view.updatedAt : deal.stateUpdatedAt
  const versions = view?.versions ?? []
  const hasNewState = !!text || versions.length > 0

  const refresh = () => {
    startTransition(async () => {
      try {
        const res = await fetch("/api/deals", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: deal.id, action: "refreshState" }),
        })
        if (!res.ok) {
          toast.error(await readError(res, "Не удалось обновить состояние"))
          return
        }
        const body = (await res.json()) as {
          decision?: string
          state?: DealStateResult
        }
        if (body.state) setData({ dealId: deal.id, view: body.state, error: false })
        else load(deal.id)
        toast.success(
          body.decision === "UPDATE"
            ? "Состояние сделки обновлено"
            : body.decision === "NOOP"
              ? "Существенных изменений нет — текст оставлен"
              : body.decision === "REJECTED"
                ? "Новый текст не прошёл проверку — оставлен прежний"
                : "Состояние сделки проверено",
        )
        // The board card shows the stored text too.
        onChanged()
      } catch {
        toast.error("Не удалось обновить состояние")
      }
    })
  }

  // Spec §9.3: the old discovery text (reasoning / changes) stays for orgs
  // with topics off / shadow — shown only when there is no new state.
  if (!hasNewState) {
    const canRefresh = view?.canRefresh ?? false
    if (!deal.reasoning && !deal.changes && !canRefresh) return null
    return (
      <div className="mt-3 rounded-lg border bg-violet-500/5 p-3 text-sm space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-300">
            <Sparkles className="h-3.5 w-3.5" />
            {deal.reasoning || deal.changes ? "Состояние сделки" : "Текущее состояние"}
          </div>
          {canRefresh && (
            <RefreshButton
              pending={isPending}
              dirty={!!view?.pending}
              onClick={refresh}
            />
          )}
        </div>
        {deal.reasoning && (
          <div className="max-w-[32rem] whitespace-pre-wrap">{deal.reasoning}</div>
        )}
        {deal.changes && (
          <div>
            <div className="text-xs text-muted-foreground">Последнее изменение</div>
            <div className="max-w-[32rem] whitespace-pre-wrap">{deal.changes}</div>
          </div>
        )}
        {!deal.reasoning && !deal.changes && (
          <div className="text-muted-foreground">
            Текст состояния ещё не подготовлен.
          </div>
        )}
      </div>
    )
  }

  const isNoData = text?.trim() === DEAL_STATE_NO_DATA_TEXT
  const sources = view?.sources ?? {}

  return (
    <div className="mt-3 rounded-lg border bg-violet-500/5 p-3 text-sm space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-300">
          <Sparkles className="h-3.5 w-3.5" />
          Текущее состояние
        </div>
        {(view?.canRefresh ?? false) && (
          <RefreshButton pending={isPending} dirty={!!view?.pending} onClick={refresh} />
        )}
      </div>
      {text ? (
        <div
          className={`max-w-[32rem] whitespace-pre-wrap ${isNoData ? "text-muted-foreground" : ""}`}
        >
          {text}
        </div>
      ) : (
        <div className="text-muted-foreground">Текст состояния ещё не подготовлен.</div>
      )}
      {updatedAt && (
        <div className="text-xs text-muted-foreground">
          Обновлено {formatDateTime(updatedAt)}
        </div>
      )}
      {view ? (
        <SourceLinks ids={sourceIds} sources={sources} onOpen={setOpenItem} />
      ) : (
        data === null &&
        sourceIds.length > 0 && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        )
      )}
      {data?.error && data.dealId === deal.id && (
        <div className="text-xs text-muted-foreground">
          Не удалось загрузить историю состояния.
        </div>
      )}

      {versions.length > 0 && (
        <div className="border-t pt-2">
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {historyOpen ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            <History className="h-3.5 w-3.5" />
            История версий ({versions.length})
          </button>
          {historyOpen && (
            <div className="mt-2 space-y-2">
              {versions.map((v) => (
                <div key={v.id} className="border-l-2 pl-3 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span>{formatDateTime(v.createdAt)}</span>
                    <span>·</span>
                    <span>
                      {v.actor === "agent" ? "Агент" : (v.actorName ?? "Пользователь")}
                    </span>
                    <Badge variant="secondary" className="text-[10px]">
                      {DEAL_STATE_DECISION_LABELS_RU[v.decision] ?? v.decision}
                    </Badge>
                  </div>
                  {v.text && (
                    <div className="max-w-[32rem] whitespace-pre-wrap">{v.text}</div>
                  )}
                  {v.reason && (
                    <div className="max-w-[32rem] text-xs text-muted-foreground whitespace-pre-wrap">
                      {v.reason}
                    </div>
                  )}
                  <SourceLinks
                    ids={v.sourceItemIds}
                    sources={sources}
                    onOpen={setOpenItem}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <ParsedMarkdownDialog
        itemId={openItem?.id ?? null}
        title={openItem?.title ?? ""}
        open={openItem !== null}
        onOpenChange={(o) => {
          if (!o) setOpenItem(null)
        }}
      />
    </div>
  )
}

function RefreshButton({
  pending,
  dirty,
  onClick,
}: {
  pending: boolean
  dirty: boolean
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="h-7 gap-1 px-2 text-xs"
      onClick={onClick}
      disabled={pending}
      title={
        dirty
          ? "Есть новая информация по сделке — агент обновит текст при ближайшем запуске; «Обновить» — сейчас"
          : "Проверить и обновить текст сейчас"
      }
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <RefreshCw className="h-3.5 w-3.5" />
      )}
      {pending ? "Обновляем…" : "Обновить"}
      {dirty && !pending && (
        <span className="h-1.5 w-1.5 rounded-full bg-violet-500" aria-label="есть новая информация" />
      )}
    </Button>
  )
}

// ---------------------------------------------------------------------------
// «Риски»
// ---------------------------------------------------------------------------

// Trigger items first, then the items the explanation cites (deduped).
function riskSourceIds(r: DealRiskView): string[] {
  return [...new Set([...r.sourceItemIds, ...r.explanationSourceItemIds])]
}

function severityClass(severity: number): string {
  if (severity >= 7) return "bg-[#C1121F]/10 text-[#A31018] dark:bg-[#C1121F]/15 dark:text-[#FF8F96]"
  if (severity >= 4) return "bg-amber-500/15 text-amber-700 dark:text-amber-300"
  return "bg-muted text-muted-foreground"
}

export function DealRisksBlock({
  deal,
  active,
  onChanged,
}: {
  deal: DealRow
  active: boolean
  // After «Риск снят» — the board re-reads the deals (badge on the card).
  onChanged: () => void
}) {
  const [data, setData] = useState<{
    dealId: string
    view: DealRisksResult | null
    error: boolean
  } | null>(null)
  const [openItem, setOpenItem] = useState<OpenItem | null>(null)
  const [clearing, setClearing] = useState<DealRiskView | null>(null)
  const [reason, setReason] = useState("")
  const [clearedOpen, setClearedOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const load = useCallback((dealId: string) => {
    fetch(`/api/deals?risksFor=${encodeURIComponent(dealId)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error()
        const body = (await r.json()) as { risks?: DealRisksResult }
        setData({ dealId, view: body.risks ?? null, error: false })
      })
      .catch(() => setData({ dealId, view: null, error: true }))
  }, [])

  useEffect(() => {
    if (!active) return
    load(deal.id)
  }, [active, deal.id, deal.updatedAt, deal.riskSummary?.top?.riskId, load])

  const current = data && data.dealId === deal.id ? data : null
  const view = current?.view ?? null

  const submitClear = () => {
    if (!clearing) return
    const trimmed = reason.trim()
    if (!trimmed) {
      toast.error("Укажите причину")
      return
    }
    startTransition(async () => {
      try {
        const res = await fetch("/api/deals", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: deal.id,
            action: "clearRisk",
            riskId: clearing.id,
            reason: trimmed,
          }),
        })
        if (!res.ok) {
          toast.error(await readError(res, "Не удалось снять риск"))
          return
        }
        const body = (await res.json().catch(() => ({}))) as { cleared?: boolean }
        toast.success(body.cleared === false ? "Риск уже был снят" : "Риск снят")
        setClearing(null)
        setReason("")
        load(deal.id)
        onChanged()
      } catch {
        toast.error("Не удалось снять риск")
      }
    })
  }

  if (!current) {
    // Board row knows there is an active risk — keep the block's place.
    if (!deal.riskSummary) return null
    return (
      <div className="mt-3 flex justify-center rounded-lg border border-[#C1121F]/20 p-3">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (current.error || !view) {
    if (!deal.riskSummary) return null
    return (
      <div className="mt-3 rounded-lg border border-[#C1121F]/20 bg-[#C1121F]/5 p-3 text-sm text-muted-foreground">
        Не удалось загрузить риски сделки.
      </div>
    )
  }
  if (view.active.length === 0 && view.cleared.length === 0) return null

  return (
    <div
      className={`mt-3 rounded-lg border p-3 text-sm space-y-3 ${
        view.active.length > 0
          ? "border-[#C1121F]/20 bg-[#C1121F]/5"
          : "bg-muted/40"
      }`}
    >
      <div
        className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide ${
          view.active.length > 0
            ? "text-[#A31018] dark:text-[#FF8F96]"
            : "text-muted-foreground"
        }`}
      >
        <AlertTriangle className="h-3.5 w-3.5" />
        {view.active.length > 0 ? `Риски · ${view.active.length}` : "Риски"}
      </div>

      {view.active.length === 0 && (
        <div className="text-muted-foreground">Активных рисков нет.</div>
      )}

      {view.active.map((r) => (
        <div key={r.id} className="space-y-1.5 rounded-md border bg-background/60 p-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="font-medium leading-snug">{r.labelRu}</div>
            <Badge variant="secondary" className={`shrink-0 text-[10px] ${severityClass(r.severity)}`}>
              Серьёзность {r.severity}/9
            </Badge>
          </div>
          {r.explanationRu && (
            <div className="max-w-[32rem] whitespace-pre-wrap">{r.explanationRu}</div>
          )}
          {r.triggers.length > 0 && (
            <div className="space-y-1">
              {r.triggers
                .filter((t) => t.evidence)
                .slice(0, 3)
                .map((t) => (
                  <div
                    key={t.instanceId}
                    className="max-w-[32rem] border-l-2 border-[#C1121F]/30 pl-2 text-xs italic text-muted-foreground"
                  >
                    «{t.evidence}»
                  </div>
                ))}
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            Выявлен {formatDate(r.detectedAt)}
            {r.occurrences > 1 ? ` · повторений: ${r.occurrences}` : ""}
          </div>
          <SourceLinks
            ids={riskSourceIds(r)}
            sources={view.sources}
            onOpen={setOpenItem}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 gap-1 text-xs"
            onClick={() => {
              setReason("")
              setClearing(r)
            }}
            disabled={isPending}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            Риск снят
          </Button>
        </div>
      ))}

      {view.cleared.length > 0 && (
        <div className={view.active.length > 0 ? "border-t pt-2" : ""}>
          <button
            type="button"
            onClick={() => setClearedOpen((v) => !v)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {clearedOpen ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            Снятые риски ({view.cleared.length})
          </button>
          {clearedOpen && (
            <div className="mt-2 space-y-2">
              {view.cleared.map((r) => (
                <div key={r.id} className="border-l-2 pl-3 space-y-1">
                  <div className="font-medium leading-snug text-muted-foreground">
                    {r.labelRu}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Выявлен {formatDate(r.detectedAt)}
                    {r.clearedAt ? ` · снят ${formatDate(r.clearedAt)}` : ""}
                    {r.clearedBy
                      ? ` · ${
                          r.clearedBy === "user" && r.clearedByUserName
                            ? r.clearedByUserName
                            : (DEAL_RISK_CLEARED_BY_LABELS_RU[r.clearedBy] ?? r.clearedBy)
                        }`
                      : ""}
                  </div>
                  {r.clearedReason && (
                    <div className="max-w-[32rem] whitespace-pre-wrap text-xs">
                      Причина: {r.clearedReason}
                    </div>
                  )}
                  <SourceLinks
                    ids={riskSourceIds(r)}
                    sources={view.sources}
                    onOpen={setOpenItem}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <ParsedMarkdownDialog
        itemId={openItem?.id ?? null}
        title={openItem?.title ?? ""}
        open={openItem !== null}
        onOpenChange={(o) => {
          if (!o) setOpenItem(null)
        }}
      />

      {/* No <form> here: the drawer body is already inside the deal edit
          form, and a submit would bubble through the React tree to it. */}
      <Dialog
        open={clearing !== null}
        onOpenChange={(o) => {
          if (!o) setClearing(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Риск снят</DialogTitle>
            <DialogDescription>
              {clearing?.labelRu}. Укажите, почему риска больше нет — причина
              останется в истории сделки.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Например: клиент назвал новую дату решения"
            autoFocus
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setClearing(null)}>
              Отмена
            </Button>
            <Button
              type="button"
              onClick={submitClear}
              disabled={isPending || !reason.trim()}
            >
              Риск снят
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

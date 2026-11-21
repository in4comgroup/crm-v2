"use client"

// «Компании» toolbar: the manual-review queue of web enrichment («На
// проверке (N)») + its dialog. The batch button «Обогатить» (enrich EVERY
// company with no enrichment yet, one web search per company) was removed
// 2026-11-21 (bug list item 14: slow, costly, not controlled). One company is
// still enriched on request: «Поиск в интернете» / «Заполнить из интернета».
// The batch API (`/api/clients/enrich/pending`, `POST /api/clients/[id]/enrich`)
// stays; nothing in the UI calls the batch loop any more.

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ExternalLink, ClipboardCheck, Loader } from "lucide-react"
import type { EnrichReviewRow } from "@/app/api/clients/enrich/review/route"

type Confidence = "high" | "medium" | "low"

const CONFIDENCE_COLOR: Record<Confidence, string> = {
  high: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  medium: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  low: "bg-rose-500/15 text-rose-600 dark:text-rose-300",
}
const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: "высокая",
  medium: "средняя",
  low: "низкая",
}

const COUNT_POLL_MS = 30_000

export function ClientEnrichControl({
  refreshKey,
  onChanged,
}: {
  refreshKey: number
  onChanged: () => void
}) {
  const [reviewCount, setReviewCount] = useState(0)
  const [reviewOpen, setReviewOpen] = useState(false)

  // The count is informational — transient failures stay silent.
  const pollCounts = useCallback(
    () =>
      fetch("/api/clients/enrich/review")
        .then((res) => (res.ok ? res.json() : null))
        .then((d) => {
          if (d) setReviewCount((d.rows ?? []).length)
        })
        .catch(() => {}),
    [],
  )

  // Poll on mount + every 30s + on refreshKey change.
  useEffect(() => {
    void pollCounts()
    const t = setInterval(pollCounts, COUNT_POLL_MS)
    return () => clearInterval(t)
  }, [pollCounts, refreshKey])

  return (
    <>
      {reviewCount > 0 && (
        <Button size="sm" variant="outline" onClick={() => setReviewOpen(true)}>
          <ClipboardCheck className="h-4 w-4 mr-1" />
          На проверке ({reviewCount})
        </Button>
      )}

      <EnrichReviewDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        onChanged={() => {
          onChanged()
          void pollCounts()
        }}
      />
    </>
  )
}

// ── Manual disambiguation dialog (Phase B) ───────────────────────────
// Replays the candidates parked during the batch — no new web calls.

function EnrichReviewDialog({
  open,
  onOpenChange,
  onChanged,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  onChanged: () => void
}) {
  const [rows, setRows] = useState<EnrichReviewRow[]>([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/clients/enrich/review")
      const data = await res.json()
      if (res.ok) setRows(data.rows ?? [])
    } catch {
      toast.error("Не удалось загрузить список на проверку")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  async function resolve(
    clientId: string,
    choice: { candidateIndex: number } | { skip: true },
  ) {
    setBusyId(clientId)
    try {
      const res = await fetch(`/api/clients/${clientId}/enrich/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(choice),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? "Не удалось сохранить выбор")
        return
      }
      toast.success("skip" in choice ? "Клиент пропущен" : "Данные применены")
      setRows((prev) => prev.filter((r) => r.id !== clientId))
      onChanged()
    } catch {
      toast.error("Ошибка сети")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Проверка обогащения клиентов</DialogTitle>
          <DialogDescription>
            Для этих клиентов поиск нашёл несколько подходящих компаний. Выберите
            верную карточку, чтобы заполнить пустые поля, или пропустите клиента.
            Уже заполненные вами поля не перезаписываются.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-5 pr-1">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <Loader className="h-4 w-4 animate-spin" />
              Загрузка…
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Нет клиентов на проверке.
            </p>
          ) : (
            rows.map((row) => (
              <div key={row.id} className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm">{row.name}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => resolve(row.id, { skip: true })}
                    disabled={busyId === row.id}
                  >
                    Пропустить
                  </Button>
                </div>
                <div className="space-y-2">
                  {row.candidates.map((c, i) => (
                    <button
                      key={i}
                      type="button"
                      className="w-full text-left rounded-md border p-3 hover:bg-muted/40 hover:border-primary/40 transition-colors space-y-1 disabled:opacity-50"
                      onClick={() => resolve(row.id, { candidateIndex: i })}
                      disabled={busyId === row.id}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{c.name}</span>
                        <Badge
                          variant="secondary"
                          className={CONFIDENCE_COLOR[c.confidence]}
                        >
                          {CONFIDENCE_LABEL[c.confidence]}
                        </Badge>
                      </div>
                      {c.address && (
                        <div className="text-xs text-muted-foreground">
                          {c.address}
                        </div>
                      )}
                      {(c.email || c.phone) && (
                        <div className="text-xs text-muted-foreground">
                          {[c.email, c.phone].filter(Boolean).join(" · ")}
                        </div>
                      )}
                      {c.webUrl && (
                        <span className="text-xs text-blue-600 dark:text-blue-400 inline-flex items-center gap-1">
                          {c.webUrl}
                          <ExternalLink className="h-3 w-3" />
                        </span>
                      )}
                      {c.whyMatch && (
                        <div className="text-xs italic text-muted-foreground">
                          {c.whyMatch}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

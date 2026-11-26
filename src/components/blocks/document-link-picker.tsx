"use client"

// «Привязать документ» (docs/specs/attachments §5, «Привязать ещё»): pick
// companies / contacts / deals / tasks / orders of the org and add `manual`
// links to one document. Entity lists come from the existing APIs:
//   - companies / contacts / deals → GET /api/search?q= (≥ 2 characters;
//     deals = open deals only, the global-search rule),
//   - orders → GET /api/orders?q=&limit= (also without a query = newest),
//   - tasks  → GET /api/tasks (whole org list, filtered here).
// Entities the document is already linked to are not offered. The dialog
// stays open after a link so several entities can be added; the caller
// refreshes its list through `onLinked`.
// Rendered in a portal, but its React events still bubble through the
// parent tree (drawers wrap their content in a <form>): every button is
// type="button" and Enter in the search box never submits.

import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { Link2, Loader, Search } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { entityMatchesFilter } from "@/lib/entity-search"
import {
  DOCUMENT_ENTITY_LABELS_RU,
  DOCUMENT_ENTITY_TYPES,
  type DocumentEntityType,
  type DocumentLinkView,
} from "@/lib/documents"
import type { GlobalSearchResult } from "@/app/api/search/route"
import type { TaskRow } from "@/app/api/tasks/route"
import { useOrgTime } from "@/lib/org-time-context"
import { formatOrgDay } from "@/lib/org-time"

type Option = { id: string; label: string; sub: string | null }

const SEARCH_MIN = 2
const TASKS_SHOWN = 30

function formatDay(iso: string | null | undefined): string {
  if (!iso) return ""
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("ru-RU")
}

function orderLabel(o: { orderDate: string; clientName: string | null }): Option["label"] {
  return `Заказ от ${formatDay(o.orderDate)}${o.clientName ? ` · ${o.clientName}` : ""}`
}

export function DocumentLinkPicker({
  open,
  onOpenChange,
  itemId,
  documentName,
  existingLinks,
  onLinked,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** `source_item.id` of the document; null = closed. */
  itemId: string | null
  documentName: string
  /** Links the document already has (their entities are not offered). */
  existingLinks: DocumentLinkView[]
  onLinked: () => void
}) {
  const { timeZone } = useOrgTime()
  const [entityType, setEntityType] = useState<DocumentEntityType>("client")
  const [qInput, setQInput] = useState("")
  const [q, setQ] = useState("")
  // Server results, keyed by the request they answer (loading is derived).
  const [result, setResult] = useState<{ key: string; options: Option[]; error?: string } | null>(null)
  const [tasks, setTasks] = useState<TaskRow[] | null>(null)
  const [tasksError, setTasksError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  // Links added in this dialog session (the parent list refreshes later).
  const [added, setAdded] = useState<Set<string>>(() => new Set())

  // Fresh state for every document the dialog is opened for.
  const [openedFor, setOpenedFor] = useState<string | null>(null)
  if (open && itemId && openedFor !== itemId) {
    setOpenedFor(itemId)
    setAdded(new Set())
    setQInput("")
    setQ("")
  }

  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 300)
    return () => clearTimeout(t)
  }, [qInput])

  const requestKey = `${entityType}|${q}`
  const needsServer = entityType !== "task" && (entityType === "order" || q.length >= SEARCH_MIN)

  useEffect(() => {
    if (!open || !needsServer) return
    const ctrl = new AbortController()
    const key = `${entityType}|${q}`
    const url =
      entityType === "order"
        ? `/api/orders?limit=20&offset=0${q ? `&q=${encodeURIComponent(q)}` : ""}`
        : `/api/search?q=${encodeURIComponent(q)}`
    fetch(url, { signal: ctrl.signal })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setResult({ key, options: [], error: data.error || "Не удалось загрузить список" })
          return
        }
        let options: Option[] = []
        if (entityType === "order") {
          const rows = (data.rows ?? []) as { id: string; orderDate: string; clientName: string | null }[]
          options = rows.map((o) => ({ id: o.id, label: orderLabel(o), sub: null }))
        } else {
          const r = data as GlobalSearchResult
          if (entityType === "client") {
            options = r.clients.map((c) => ({ id: c.id, label: c.name, sub: c.email }))
          } else if (entityType === "contact") {
            options = r.contacts.map((c) => ({
              id: c.id,
              label: c.name,
              sub: [c.clientName, c.email].filter(Boolean).join(" · ") || null,
            }))
          } else if (entityType === "deal") {
            options = r.deals.map((d) => ({
              id: d.id,
              label: d.name,
              sub: [d.clientName, d.funnelStageName].filter(Boolean).join(" · ") || null,
            }))
          }
        }
        setResult({ key, options })
      })
      .catch((e) => {
        if (ctrl.signal.aborted) return
        setResult({ key, options: [], error: e instanceof Error ? e.message : "Не удалось загрузить список" })
      })
    return () => ctrl.abort()
  }, [open, needsServer, entityType, q])

  // Tasks: one org list, loaded on the first visit of the type.
  useEffect(() => {
    if (!open || entityType !== "task" || tasks !== null) return
    let cancelled = false
    fetch("/api/tasks")
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) {
          setTasksError(data.error || "Не удалось загрузить задачи")
          setTasks([])
          return
        }
        setTasks((data.tasks ?? []) as TaskRow[])
      })
      .catch(() => {
        if (cancelled) return
        setTasksError("Не удалось загрузить задачи")
        setTasks([])
      })
    return () => {
      cancelled = true
    }
  }, [open, entityType, tasks])

  const linkedKeys = useMemo(() => {
    const s = new Set(existingLinks.map((l) => `${l.entityType}:${l.entityId}`))
    for (const k of added) s.add(k)
    return s
  }, [existingLinks, added])

  let options: Option[] = []
  let loading = false
  let error: string | null = null
  let hint: string | null = null
  if (entityType === "task") {
    loading = tasks === null
    error = tasksError
    if (tasks) {
      options = tasks
        .filter((t) =>
          entityMatchesFilter(q, [
            { value: t.name, weight: 1 },
            { value: t.clientName, weight: 0.7 },
            { value: t.dealName, weight: 0.7 },
          ]),
        )
        .slice(0, TASKS_SHOWN)
        .map((t) => ({
          id: t.id,
          label: t.name,
          sub: [t.clientName, t.dueDate ? `срок ${formatOrgDay(t.dueDate, timeZone)}` : null].filter(Boolean).join(" · ") || null,
        }))
    }
  } else if (!needsServer) {
    hint = `Введите не менее ${SEARCH_MIN} символов`
  } else if (result?.key !== requestKey) {
    loading = true
  } else {
    options = result.options
    error = result.error ?? null
  }
  const visible = options.filter((o) => !linkedKeys.has(`${entityType}:${o.id}`))

  async function link(o: Option) {
    if (!itemId) return
    setBusyId(o.id)
    try {
      const res = await fetch(`/api/documents/${encodeURIComponent(itemId)}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityType, entityId: o.id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || "Не удалось привязать документ")
        return
      }
      setAdded((prev) => new Set(prev).add(`${entityType}:${o.id}`))
      toast.success(`Привязан: ${DOCUMENT_ENTITY_LABELS_RU[entityType]} · ${o.label}`)
      onLinked()
    } catch {
      toast.error("Не удалось привязать документ")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Привязать документ</DialogTitle>
          <DialogDescription className="truncate">{documentName}</DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Select
            value={entityType}
            onValueChange={(v) => setEntityType(v as DocumentEntityType)}
          >
            <SelectTrigger className="w-36 shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DOCUMENT_ENTITY_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {DOCUMENT_ENTITY_LABELS_RU[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.preventDefault()
              }}
              placeholder="Поиск"
              className="pl-8"
              autoFocus
            />
          </div>
        </div>

        <div className="max-h-80 min-h-32 overflow-y-auto rounded-md border">
          {loading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <p className="p-4 text-sm text-destructive">{error}</p>
          ) : hint ? (
            <p className="p-4 text-sm text-muted-foreground">{hint}</p>
          ) : visible.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              {options.length > 0 ? "Документ уже привязан ко всем найденным записям" : "Ничего не найдено"}
            </p>
          ) : (
            <ul className="divide-y">
              {visible.map((o) => (
                <li key={o.id} className="flex items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{o.label}</div>
                    {o.sub && <div className="truncate text-xs text-muted-foreground">{o.sub}</div>}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busyId !== null}
                    onClick={() => void link(o)}
                  >
                    {busyId === o.id ? (
                      <Loader className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Link2 className="h-3.5 w-3.5" />
                    )}
                    Привязать
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Готово
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

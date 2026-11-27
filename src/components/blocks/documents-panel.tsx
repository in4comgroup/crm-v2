"use client"

// «Документы» of ONE entity (docs/specs/attachments §5–§6): company, contact,
// deal, task or order. Upload («Добавить файл» + drag and drop), type filter,
// text search, the switch «Включая …» = files of related records (Q11 for a
// company; every entity since 2026-11-21, bug list item 19),
// server paging (TablePager), per-row actions («Открыть» in a new tab /
// «Скачать» / «Текст» / «Привязать ещё» / «Отвязать» / «Удалить файл») and
// link chips with the «авто» badge + «Подтвердить» for medium links.
// No preview code (Q7): the browser shows the file itself in a new tab.
//
// Mounted inside drawers that wrap their content in a <form>: this panel
// never renders a <form>, every button is type="button", Enter in its
// inputs never submits the outer form.

import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from "react"
import { toast } from "sonner"
import {
  Check,
  Download,
  ExternalLink,
  File as FileIcon,
  FileAudio,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Link2,
  Loader,
  MoreHorizontal,
  Search,
  Trash2,
  Unlink,
  Upload,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { AnchorTooltip, useAnchorTooltip } from "@/components/blocks/anchor-tooltip"
import { TablePager, DEFAULT_PAGE_SIZE, type PageSize } from "@/components/blocks/table-pager"
import { ParsedMarkdownDialog } from "@/components/blocks/parsed-markdown-dialog"
import { DocumentLinkPicker } from "@/components/blocks/document-link-picker"
import {
  DOCUMENT_ENTITY_LABELS_RU,
  DOCUMENT_MAX_BYTES,
  DOCUMENT_TYPE_BUCKETS,
  DOCUMENT_TYPE_LABELS_RU,
  DOCUMENT_UPLOAD_MAX_FILES,
  LINK_ORIGIN_LABELS_RU,
  formatFileSize,
  isAutoOrigin,
  opensInBrowser,
  type DocumentEntityType,
  type DocumentLinkView,
  type DocumentTypeBucket,
  type DocumentView,
  type DocumentsListResponse,
  DOCUMENT_SKIP_LABELS_RU,
  DOCUMENT_PROVIDER_LABELS_RU,
} from "@/lib/documents"

const ALL_TYPES = "__all__"
const POLL_MS = 5_000
const POLL_MAX_MS = 2 * 60_000

const BUCKET_ICON: Record<DocumentTypeBucket, typeof FileIcon> = {
  pdf: FileText,
  image: FileImage,
  audio: FileAudio,
  video: FileVideo,
  office: FileSpreadsheet,
  other: FileIcon,
}

const isAnalysing = (d: DocumentView) => d.parseStatus === "pending" || d.parseStatus === "processing"

function formatDay(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("ru-RU")
}

/** Russian status of the file / its analysis; null = nothing to say. */
function statusLabel(d: DocumentView): { text: string; tone: "muted" | "warn" } | null {
  if (d.fileStatus === "too_large") return { text: "больше 50 МБ — не сохранён", tone: "warn" }
  if (isAnalysing(d)) return { text: "анализируется", tone: "muted" }
  if (d.skipReason) return { text: DOCUMENT_SKIP_LABELS_RU[d.skipReason], tone: d.skipReason === "error" ? "warn" : "muted" }
  return null
}

/** Hover hint (AnchorTooltip) on any inline element — never a native `title`. */
function Hint({ text, children, className }: { text: string; children: ReactNode; className?: string }) {
  const tip = useAnchorTooltip()
  return (
    <>
      <span {...tip.bind} className={className ?? "inline-flex"}>
        {children}
      </span>
      <AnchorTooltip text={text} open={tip.open} virtualRef={tip.virtualRef} />
    </>
  )
}

/** The «related files» switch per view (server rule: `viewRefs` in src/server/documents.ts). */
const RELATED_LABEL_RU: Record<DocumentEntityType, string> = {
  client: "Включая контакты и сделки",
  contact: "Включая сделки и задачи",
  deal: "Включая контакты и задачи",
  task: "Включая файлы сделки",
  order: "Включая файлы компании",
}

export function DocumentsPanel({
  entityType,
  entityId,
  onChanged,
}: {
  entityType: DocumentEntityType
  entityId: string
  /** Called after an upload / link / unlink / delete. */
  onChanged?: () => void
}) {
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE)
  const [type, setType] = useState<string>(ALL_TYPES)
  const [sourceFilter, setSourceFilter] = useState<string>(ALL_TYPES)
  const [qInput, setQInput] = useState("")
  const [q, setQ] = useState("")
  const [related, setRelated] = useState(true)
  const [tick, setTick] = useState(0)

  // Result keyed by the request it answers: `loading` is derived.
  const [data, setData] = useState<{ key: string; res: DocumentsListResponse; error?: string } | null>(null)

  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const dragDepth = useRef(0)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [textFor, setTextFor] = useState<DocumentView | null>(null)
  const [linkFor, setLinkFor] = useState<DocumentView | null>(null)
  const [deleteFor, setDeleteFor] = useState<DocumentView | null>(null)
  const [busy, setBusy] = useState(false)

  // Polling window start while rows are being analysed (null = not polling).
  const pollStart = useRef<number | null>(null)

  // ONE key for the request and for `loading` (the source filter used to be
  // missing here, so `loading` never became false: the list stayed dimmed).
  const requestKey = [entityType, entityId, related ? 1 : 0, type, sourceFilter, q, page, pageSize].join("|")

  // Debounced search; a new query starts from the first page.
  useEffect(() => {
    const next = qInput.trim()
    if (next === q) return
    const t = setTimeout(() => {
      setQ(next)
      setPage(0)
    }, 300)
    return () => clearTimeout(t)
  }, [qInput, q])

  useEffect(() => {
    const ctrl = new AbortController()
    const key = requestKey
    const sp = new URLSearchParams({
      entityType,
      entityId,
      limit: String(pageSize),
      offset: String(page * pageSize),
    })
    sp.set("related", related ? "1" : "0")
    if (type !== ALL_TYPES) sp.set("type", type)
    if (sourceFilter !== ALL_TYPES) sp.set("source", sourceFilter)
    if (q) sp.set("q", q)
    fetch(`/api/documents?${sp.toString()}`, { signal: ctrl.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          setData((prev) => ({
            key,
            res: prev?.res ?? { documents: [], total: 0, providers: [] },
            error: body.error || "Не удалось загрузить документы",
          }))
          return
        }
        setData({ key, res: body as DocumentsListResponse })
      })
      .catch((e) => {
        if (ctrl.signal.aborted) return
        setData((prev) => ({
          key,
          res: prev?.res ?? { documents: [], total: 0, providers: [] },
          error: e instanceof Error ? e.message : "Не удалось загрузить документы",
        }))
      })
    return () => ctrl.abort()
  }, [requestKey, entityType, entityId, related, type, sourceFilter, q, page, pageSize, tick])

  const reload = useCallback(() => setTick((t) => t + 1), [])

  const documents = data?.res.documents ?? []
  const total = data?.res.total ?? 0
  const loading = data?.key !== requestKey
  const firstLoad = data === null
  const anyAnalysing = documents.some(isAnalysing)

  // Refresh every 5 s while a row is analysed, for at most 2 minutes.
  useEffect(() => {
    if (!anyAnalysing) {
      pollStart.current = null
      return
    }
    if (pollStart.current === null) pollStart.current = Date.now()
    if (Date.now() - pollStart.current > POLL_MAX_MS) return
    const t = setTimeout(() => setTick((n) => n + 1), POLL_MS)
    return () => clearTimeout(t)
  }, [anyAnalysing, data])

  const changed = useCallback(() => {
    reload()
    onChanged?.()
  }, [reload, onChanged])

  async function upload(list: File[]) {
    if (list.length === 0) return
    if (list.length > DOCUMENT_UPLOAD_MAX_FILES) {
      toast.error(`Не больше ${DOCUMENT_UPLOAD_MAX_FILES} файлов за раз`)
      return
    }
    const tooBig = list.filter((f) => f.size > DOCUMENT_MAX_BYTES)
    if (tooBig.length > 0) {
      toast.error(
        `Файл больше 50 МБ: ${tooBig.map((f) => f.name).join(", ")}`,
      )
      return
    }
    const fd = new FormData()
    fd.set("entityType", entityType)
    fd.set("entityId", entityId)
    for (const f of list) fd.append("files", f, f.name)
    setUploading(true)
    try {
      const res = await fetch("/api/documents/upload", { method: "POST", body: fd })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body.error || "Не удалось загрузить файлы")
        return
      }
      const results = (body.results ?? []) as {
        name: string
        ok: boolean
        duplicate?: boolean
        error?: string
      }[]
      const ok = results.filter((r) => r.ok && !r.duplicate).length
      const dup = results.filter((r) => r.ok && r.duplicate)
      if (ok > 0) toast.success(ok === 1 ? "Файл загружен" : `Загружено файлов: ${ok}`)
      for (const r of dup) toast.info(`«${r.name}» уже был загружен — привязан к этой записи`)
      for (const r of results.filter((x) => !x.ok)) {
        toast.error(`«${r.name}»: ${r.error || "не удалось загрузить"}`)
      }
      pollStart.current = null
      setPage(0)
      changed()
    } catch {
      toast.error("Не удалось загрузить файлы")
    } finally {
      setUploading(false)
    }
  }

  async function call(url: string, init: RequestInit, okText: string, errText: string): Promise<boolean> {
    setBusy(true)
    try {
      const res = await fetch(url, init)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body.error || errText)
        return false
      }
      toast.success(okText)
      changed()
      return true
    } catch {
      toast.error(errText)
      return false
    } finally {
      setBusy(false)
    }
  }

  const unlink = (doc: DocumentView, link: DocumentLinkView) =>
    call(
      `/api/documents/${encodeURIComponent(doc.id)}/links/${encodeURIComponent(link.id)}`,
      { method: "DELETE" },
      "Документ отвязан",
      "Не удалось отвязать документ",
    )

  const confirmLink = (doc: DocumentView, link: DocumentLinkView) =>
    call(
      `/api/documents/${encodeURIComponent(doc.id)}/links/${encodeURIComponent(link.id)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      },
      "Привязка подтверждена",
      "Не удалось подтвердить привязку",
    )

  async function deleteFile(doc: DocumentView) {
    const ok = await call(
      `/api/documents/${encodeURIComponent(doc.id)}`,
      { method: "DELETE" },
      "Файл удалён",
      "Не удалось удалить файл",
    )
    if (ok) setDeleteFor(null)
  }

  // Drag and drop of files onto the whole panel. React events from portals
  // (dialogs, menus) bubble here too — only real drops on the panel count.
  const isFileDrag = (e: DragEvent) => Array.from(e.dataTransfer.types).includes("Files")
  const dropHandlers = {
    onDragEnter: (e: DragEvent<HTMLDivElement>) => {
      if (!isFileDrag(e) || !e.currentTarget.contains(e.target as Node)) return
      e.preventDefault()
      dragDepth.current += 1
      setDragOver(true)
    },
    onDragOver: (e: DragEvent<HTMLDivElement>) => {
      if (!isFileDrag(e) || !e.currentTarget.contains(e.target as Node)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = "copy"
    },
    onDragLeave: (e: DragEvent<HTMLDivElement>) => {
      if (!isFileDrag(e) || !e.currentTarget.contains(e.target as Node)) return
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDragOver(false)
    },
    onDrop: (e: DragEvent<HTMLDivElement>) => {
      if (!isFileDrag(e) || !e.currentTarget.contains(e.target as Node)) return
      e.preventDefault()
      dragDepth.current = 0
      setDragOver(false)
      if (uploading) return
      void upload(Array.from(e.dataTransfer.files))
    },
  }

  const filtered = type !== ALL_TYPES || q !== ""

  return (
    <div
      {...dropHandlers}
      // Safety net for the outer <form> of the drawers: shared children
      // (TablePager) render buttons without a type, i.e. submit buttons.
      // Cancelling the default action stops the form submit; the buttons'
      // own onClick handlers still run.
      onClickCapture={(e) => {
        const b = (e.target as HTMLElement).closest("button")
        if (b && b.type === "submit") e.preventDefault()
      }}
      className="relative space-y-4"
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            e.target.value = ""
            void upload(files)
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? <Loader className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Добавить файл
        </Button>
        <Select
          value={type}
          onValueChange={(v) => {
            setType(v)
            setPage(0)
          }}
        >
          <SelectTrigger size="sm" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_TYPES}>Все форматы</SelectItem>
            {DOCUMENT_TYPE_BUCKETS.map((b) => (
              <SelectItem key={b} value={b}>
                {DOCUMENT_TYPE_LABELS_RU[b]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(() => {
          const providers = data?.res.providers ?? []
          if (providers.length < 2 && sourceFilter === ALL_TYPES) return null
          return (
            <Select
              value={sourceFilter}
              onValueChange={(v) => {
                setSourceFilter(v)
                setPage(0)
              }}
            >
              <SelectTrigger size="sm" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_TYPES}>Все источники</SelectItem>
                {providers.map((p) => (
                  <SelectItem key={p} value={p}>
                    {DOCUMENT_PROVIDER_LABELS_RU[p] ?? p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )
        })()}
        <div className="relative min-w-40 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.preventDefault()
            }}
            placeholder="Поиск по названию и описанию"
            className="h-8 pl-8"
          />
        </div>
      </div>

      {/* Related files, every entity (bug list 2026-11-21, item 19). */}
      <div className="flex items-center gap-2">
        <Switch
          id={`docs-related-${entityId}`}
          checked={related}
          onCheckedChange={(v) => {
            setRelated(v)
            setPage(0)
          }}
        />
        <Label htmlFor={`docs-related-${entityId}`} className="text-xs font-normal text-muted-foreground">
          {RELATED_LABEL_RU[entityType]}
        </Label>
      </div>

      {data?.error && <p className="text-sm text-destructive">{data.error}</p>}

      {/* List */}
      {firstLoad ? (
        <div className="flex h-24 items-center justify-center">
          <Loader className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : documents.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          <p className="font-medium text-foreground">{filtered ? "Ничего не найдено" : "Документов нет"}</p>
          {!filtered && (
            <p className="mt-1">Нажмите «Добавить файл» или перетащите файлы сюда — до {DOCUMENT_UPLOAD_MAX_FILES} файлов, каждый до 50 МБ.</p>
          )}
        </div>
      ) : (
        <ul className={`divide-y rounded-md border ${loading ? "opacity-60" : ""}`}>
          {documents.map((d) => (
            <DocumentRow
              key={d.id}
              doc={d}
              busy={busy}
              onText={() => setTextFor(d)}
              onLinkMore={() => setLinkFor(d)}
              onUnlink={(l) => void unlink(d, l)}
              onConfirm={(l) => void confirmLink(d, l)}
              onDelete={() => setDeleteFor(d)}
            />
          ))}
        </ul>
      )}

      {total > 0 && (
        <TablePager
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={setPage}
          onPageSizeChange={(s) => {
            setPageSize(s)
            setPage(0)
          }}
          disabled={loading}
        />
      )}

      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-md border-2 border-dashed border-primary bg-background/80 text-sm font-medium">
          Отпустите файлы, чтобы загрузить
        </div>
      )}

      <ParsedMarkdownDialog
        itemId={textFor?.id ?? null}
        title={textFor?.name ?? ""}
        open={textFor !== null}
        onOpenChange={(o) => {
          if (!o) setTextFor(null)
        }}
      />

      <DocumentLinkPicker
        open={linkFor !== null}
        onOpenChange={(o) => {
          if (!o) setLinkFor(null)
        }}
        itemId={linkFor?.id ?? null}
        documentName={linkFor?.name ?? ""}
        existingLinks={linkFor?.links ?? []}
        onLinked={changed}
      />

      <AlertDialog
        open={deleteFor !== null}
        onOpenChange={(o) => {
          if (!o) setDeleteFor(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить файл?</AlertDialogTitle>
            <AlertDialogDescription>
              Файл «{deleteFor?.name}» будет удалён из хранилища и отвязан от всех записей. Это действие
              нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={busy}>
              Отмена
            </AlertDialogCancel>
            <AlertDialogAction
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={(e) => {
                e.preventDefault()
                if (deleteFor) void deleteFile(deleteFor)
              }}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function DocumentRow({
  doc,
  busy,
  onText,
  onLinkMore,
  onUnlink,
  onConfirm,
  onDelete,
}: {
  doc: DocumentView
  busy: boolean
  onText: () => void
  onLinkMore: () => void
  onUnlink: (link: DocumentLinkView) => void
  onConfirm: (link: DocumentLinkView) => void
  onDelete: () => void
}) {
  const Icon = BUCKET_ICON[doc.bucket] ?? FileIcon
  const status = statusLabel(doc)
  const viaLink = doc.viaLinkId ? doc.links.find((l) => l.id === doc.viaLinkId) ?? null : null
  const fileUrl = (disposition: "inline" | "attachment") =>
    `/api/documents/${encodeURIComponent(doc.id)}/file?disposition=${disposition}`
  const meta = [formatFileSize(doc.sizeBytes), formatDay(doc.date), doc.sourceLabel].filter(Boolean)

  return (
    <li className="flex gap-3 px-3 py-2.5">
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{doc.name}</div>
            <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
              {meta.map((m, i) => (
                <span key={i} className="inline-flex items-center gap-1.5">
                  {i > 0 && <span aria-hidden>·</span>}
                  {m}
                </span>
              ))}
              {status && (
                <span
                  className={`inline-flex items-center gap-1 ${status.tone === "warn" ? "text-amber-600 dark:text-amber-400" : ""}`}
                >
                  {meta.length > 0 && <span aria-hidden className="text-muted-foreground">·</span>}
                  {isAnalysing(doc) && <Loader className="h-3 w-3 animate-spin" />}
                  {status.text}
                </span>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex shrink-0 items-center gap-0.5">
            {doc.downloadable ? (
              <>
                {opensInBrowser(doc.bucket, doc.mime) && (
                  <Hint text="Открыть в новой вкладке">
                    <Button variant="ghost" size="icon-sm" asChild>
                      <a href={fileUrl("inline")} target="_blank" rel="noopener" aria-label="Открыть">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                  </Hint>
                )}
                <Hint text="Скачать">
                  <Button variant="ghost" size="icon-sm" asChild>
                    <a href={fileUrl("attachment")} download={doc.name} aria-label="Скачать">
                      <Download className="h-4 w-4" />
                    </a>
                  </Button>
                </Hint>
              </>
            ) : (
              <span className="px-1 text-xs text-muted-foreground">Оригинал не сохранён</span>
            )}
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Действия с документом">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {doc.hasText && (
                  <DropdownMenuItem onSelect={onText}>
                    <FileText className="h-4 w-4" />
                    Текст
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={onLinkMore}>
                  <Link2 className="h-4 w-4" />
                  Привязать ещё
                </DropdownMenuItem>
                {viaLink && (
                  <DropdownMenuItem disabled={busy} onSelect={() => onUnlink(viaLink)}>
                    <Unlink className="h-4 w-4" />
                    Отвязать
                  </DropdownMenuItem>
                )}
                {doc.canDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                      <Trash2 className="h-4 w-4" />
                      Удалить файл
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {doc.summary && (
          <Hint text={doc.summary} className="block min-w-0">
            <div className="line-clamp-1 text-xs text-muted-foreground">{doc.summary}</div>
          </Hint>
        )}

        {doc.links.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {doc.links.map((l) => (
              <LinkChip
                key={l.id}
                link={l}
                busy={busy}
                onUnlink={() => onUnlink(l)}
                onConfirm={() => onConfirm(l)}
              />
            ))}
          </div>
        )}
      </div>
    </li>
  )
}

function LinkChip({
  link,
  busy,
  onUnlink,
  onConfirm,
}: {
  link: DocumentLinkView
  busy: boolean
  onUnlink: () => void
  onConfirm: () => void
}) {
  const auto = isAutoOrigin(link.origin)
  const medium = link.confidence === "medium"
  // The origin labels already start with «авто · » — the badge says it.
  const origin = (LINK_ORIGIN_LABELS_RU[link.origin] ?? link.origin).replace(/^авто · /, "")
  const reason = [origin, link.reason].filter(Boolean).join(": ")
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={`inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs hover:bg-accent ${
            medium ? "border-dashed border-muted-foreground/50 text-muted-foreground" : "bg-muted/50"
          }`}
        >
          <span className="truncate">
            {DOCUMENT_ENTITY_LABELS_RU[link.entityType]} · {link.entityLabel}
          </span>
          {auto && (
            <Hint text={medium ? `${reason} — требует подтверждения` : reason}>
              <span className="rounded bg-foreground/10 px-1 text-[10px] leading-4 text-muted-foreground">авто</span>
            </Hint>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {auto && medium && (
          <DropdownMenuItem disabled={busy} onSelect={onConfirm}>
            <Check className="h-4 w-4" />
            Подтвердить
          </DropdownMenuItem>
        )}
        <DropdownMenuItem disabled={busy} onSelect={onUnlink}>
          <Unlink className="h-4 w-4" />
          Отвязать
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

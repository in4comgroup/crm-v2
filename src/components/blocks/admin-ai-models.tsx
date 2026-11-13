"use client"

// «Модели» (Models) tab on /settings — the AI model registry, read-only.
// Spec: docs/specs/models/02-model-registry.md §6. Data: /api/admin/ai/models,
// sync: /api/admin/ai/catalog/sync. Vendor-neutral: everything shown comes
// from the normalized ai_model record.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowDown,
  ArrowUp,
  AudioLines,
  Braces,
  Brain,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  FileText,
  Globe,
  Image as ImageIcon,
  Loader,
  RefreshCcw,
  Search,
  Video,
  Wrench,
  type LucideIcon,
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  AI_CAPABILITIES,
  AI_CAPABILITY_LABELS,
  AI_MODEL_TYPE_LABELS,
  modelCapabilities,
  type AiCapability,
} from "@/lib/ai-capabilities"
import type {
  AiGatewayRow,
  AiModelDetail,
  AiModelListRow,
} from "@/app/api/admin/ai/models/route"

const PAGE_SIZE = 50
const ALL_TYPES = "all"

type Sort = "name" | "vendor" | "cost_input" | "cost_output" | "context"

export const CAPABILITY_ICONS: Record<AiCapability, LucideIcon> = {
  tools: Wrench,
  structured_output: Braces,
  web_search: Globe,
  reasoning: Brain,
  image_input: ImageIcon,
  pdf_input: FileText,
  audio_input: AudioLines,
  video_input: Video,
}

export const ZDR_LABELS: Record<string, string> = {
  all: "Да",
  some: "Частично",
  none: "Нет",
}

// ── formatting ──────────────────────────────────────────────────────────

const usd = new Intl.NumberFormat("ru-RU", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
})

export function formatUsd(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—"
  const n = Number(v)
  return Number.isFinite(n) ? `$${usd.format(n)}` : "—"
}

export function formatTokens(n: number | null | undefined): string {
  if (!n) return "—"
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}

export function formatDateTime(v: string | Date | null | undefined): string {
  if (!v) return "—"
  return new Date(v).toLocaleString("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
  })
}

function typeLabel(t: string): string {
  return AI_MODEL_TYPE_LABELS[t] ?? t
}

// ── small pieces ────────────────────────────────────────────────────────

export function CapabilityIcons({ caps }: { caps: AiCapability[] }) {
  if (caps.length === 0) return <span className="text-muted-foreground">—</span>
  return (
    <span className="inline-flex items-center gap-1.5">
      {caps.map((c) => {
        const Icon = CAPABILITY_ICONS[c]
        return (
          <Tooltip key={c}>
            <TooltipTrigger asChild>
              <span className="text-muted-foreground">
                <Icon className="h-3.5 w-3.5" />
              </span>
            </TooltipTrigger>
            <TooltipContent>{AI_CAPABILITY_LABELS[c]}</TooltipContent>
          </Tooltip>
        )
      })}
    </span>
  )
}

function StatusBadges({
  isAvailable,
  status,
}: {
  isAvailable: boolean | null
  status: string | null
}) {
  return (
    <>
      {isAvailable === false && (
        <Badge variant="destructive" className="ml-1.5">
          Недоступна
        </Badge>
      )}
      {status === "deprecated" && (
        <Badge variant="outline" className="ml-1.5">
          Устарела
        </Badge>
      )}
    </>
  )
}

// Popover + checkbox list multi-select (same pattern as the /deals client
// filter). Empty selection = no filter.
export function MultiCheckSelect({
  label,
  emptyLabel,
  options,
  values,
  onChange,
  searchable,
}: {
  label: string
  emptyLabel: string
  options: { value: string; label: string; hint?: string }[]
  values: string[]
  onChange: (values: string[]) => void
  searchable?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const selected = new Set(values)
  const query = q.trim().toLowerCase()
  const visible = query
    ? options.filter((o) => o.label.toLowerCase().includes(query))
    : options
  const toggle = (v: string) =>
    onChange(selected.has(v) ? values.filter((x) => x !== v) : [...values, v])

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setQ("")
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          className="w-48 justify-between font-normal"
        >
          <span className="truncate">
            {values.length === 0 ? emptyLabel : `${label}: ${values.length}`}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        {searchable && (
          <div className="border-b p-2">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск…"
              className="h-8"
            />
          </div>
        )}
        <div className="max-h-72 overflow-y-auto p-1">
          {values.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="w-full rounded-sm px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent"
            >
              Очистить выбор
            </button>
          )}
          {visible.length === 0 ? (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">
              Ничего не найдено
            </div>
          ) : (
            visible.map((o) => (
              <label
                key={o.value}
                className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
              >
                <Checkbox
                  checked={selected.has(o.value)}
                  onCheckedChange={() => toggle(o.value)}
                />
                <span className="truncate">{o.label}</span>
                {o.hint && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    {o.hint}
                  </span>
                )}
              </label>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function SortHead({
  label,
  column,
  sort,
  dir,
  onSort,
  className,
}: {
  label: string
  column: Sort
  sort: Sort
  dir: "asc" | "desc"
  onSort: (c: Sort) => void
  className?: string
}) {
  const active = sort === column
  const Icon = dir === "asc" ? ArrowUp : ArrowDown
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(column)}
        className="inline-flex cursor-pointer items-center gap-1 hover:text-foreground"
      >
        {label}
        {active && <Icon className="h-3.5 w-3.5" />}
      </button>
    </TableHead>
  )
}

// ── drawer ──────────────────────────────────────────────────────────────

// Russian labels for the «источник данных» (data source) list.
const FIELD_LABELS: Record<string, string> = {
  vendor: "Разработчик",
  name: "Название",
  family: "Семейство",
  description: "Описание",
  type: "Тип",
  canonicalModelId: "Канонический ID",
  attachment: "Файлы на входе",
  reasoning: "Рассуждения",
  toolCall: "Инструменты",
  structuredOutput: "Структурированный вывод",
  temperature: "Температура",
  openWeights: "Открытые веса",
  webSearch: "Поиск в интернете",
  inputModalities: "Входные данные",
  outputModalities: "Выходные данные",
  limitContext: "Контекст",
  limitOutput: "Макс. ответ",
  costInput: "Цена: вход",
  costOutput: "Цена: выход",
  costCacheRead: "Цена: чтение кэша",
  costCacheWrite: "Цена: запись кэша",
  costWebSearch: "Цена: поиск",
  costRaw: "Полный прайс",
  knowledge: "Знания до",
  releaseDate: "Дата выпуска",
  lastUpdated: "Обновлена",
  status: "Статус",
  zdr: "ZDR",
  noTraining: "Без обучения",
  regions: "Регионы",
  deprecatedAt: "Устаревает",
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[11rem_1fr] gap-3 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="rounded-lg border px-3 py-2">{children}</div>
    </section>
  )
}

function boolLabel(v: boolean | null | undefined) {
  return v === true ? "Да" : v === false ? "Нет" : "—"
}

function ModelDrawer({
  gatewayId,
  modelId,
  onClose,
}: {
  gatewayId: string
  modelId: string | null
  onClose: () => void
}) {
  // Results are keyed by model id, so a stale result is never shown for
  // another model (and no reset-in-effect is needed).
  const [loaded, setLoaded] = useState<{
    key: string
    detail: AiModelDetail | null
    error: string | null
  } | null>(null)

  useEffect(() => {
    if (!modelId) return
    let cancelled = false
    const key = modelId
    const params = new URLSearchParams({ gatewayId, modelId })
    fetch(`/api/admin/ai/models?${params}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`)
        return r.json() as Promise<AiModelDetail>
      })
      .then((d) => !cancelled && setLoaded({ key, detail: d, error: null }))
      .catch(
        (e) =>
          !cancelled &&
          setLoaded({ key, detail: null, error: e instanceof Error ? e.message : String(e) }),
      )
    return () => {
      cancelled = true
    }
  }, [gatewayId, modelId])

  const current = loaded && loaded.key === modelId ? loaded : null
  const detail = current?.detail ?? null
  const error = current?.error ?? null
  const m = detail?.model
  return (
    <Sheet open={!!modelId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="pr-10">
          <SheetTitle>{m?.name ?? modelId}</SheetTitle>
          <SheetDescription className="font-mono text-xs">{modelId}</SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-6">
          {error && <p className="text-sm text-red-500">{error}</p>}
          {!m && !error && (
            <div className="flex justify-center py-10">
              <Loader className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {m && (
            <>
              {m.description && (
                <p className="text-sm text-muted-foreground">{m.description}</p>
              )}

              <Section title="Основное">
                <DetailRow label="Разработчик">{m.vendor ?? "—"}</DetailRow>
                <DetailRow label="Семейство">{m.family ?? "—"}</DetailRow>
                <DetailRow label="Тип">{typeLabel(m.type)}</DetailRow>
                <DetailRow label="Канонический ID">
                  <span className="font-mono text-xs">{m.canonicalModelId ?? "—"}</span>
                </DetailRow>
                <DetailRow label="Статус">
                  {m.isAvailable ? "Доступна" : "Недоступна"}
                  {m.status ? ` · ${m.status}` : ""}
                  {m.deprecatedAt ? ` · устаревает ${formatDateTime(m.deprecatedAt)}` : ""}
                </DetailRow>
                <DetailRow label="Дата выпуска">{m.releaseDate ?? "—"}</DetailRow>
                <DetailRow label="Знания до">{m.knowledge ?? "—"}</DetailRow>
                <DetailRow label="В каталоге">
                  с {formatDateTime(m.firstSeenAt)}, проверена {formatDateTime(m.lastSeenAt)}
                </DetailRow>
              </Section>

              <Section title="Возможности">
                <div className="flex flex-wrap gap-1.5 py-1">
                  {modelCapabilities(m).length === 0 ? (
                    <span className="text-sm text-muted-foreground">—</span>
                  ) : (
                    modelCapabilities(m).map((c) => (
                      <Badge key={c} variant="secondary">
                        {AI_CAPABILITY_LABELS[c]}
                      </Badge>
                    ))
                  )}
                </div>
                <DetailRow label="Входные данные">
                  {m.inputModalities?.join(", ") || "—"}
                </DetailRow>
                <DetailRow label="Выходные данные">
                  {m.outputModalities?.join(", ") || "—"}
                </DetailRow>
                <DetailRow label="Температура">{boolLabel(m.temperature)}</DetailRow>
                <DetailRow label="Открытые веса">{boolLabel(m.openWeights)}</DetailRow>
                <DetailRow label="Контекст">{formatTokens(m.limitContext)}</DetailRow>
                <DetailRow label="Макс. ответ">{formatTokens(m.limitOutput)}</DetailRow>
              </Section>

              <Section title="Цены (USD)">
                <DetailRow label="Вход, за 1M токенов">{formatUsd(m.costInput)}</DetailRow>
                <DetailRow label="Выход, за 1M токенов">{formatUsd(m.costOutput)}</DetailRow>
                <DetailRow label="Чтение кэша, за 1M">{formatUsd(m.costCacheRead)}</DetailRow>
                <DetailRow label="Запись кэша, за 1M">{formatUsd(m.costCacheWrite)}</DetailRow>
                <DetailRow label="Поиск, за 1 000 запросов">
                  {formatUsd(m.costWebSearch)}
                </DetailRow>
                {m.costRaw && (
                  <details className="py-1">
                    <summary className="cursor-pointer text-sm text-muted-foreground">
                      Полный прайс (уровни, регионы, медиа)
                    </summary>
                    <pre className="mt-2 max-h-80 overflow-auto rounded bg-muted p-2 text-xs">
                      {JSON.stringify(m.costRaw, null, 2)}
                    </pre>
                  </details>
                )}
              </Section>

              <Section title="Конфиденциальность">
                <DetailRow label="Нулевое хранение (ZDR)">
                  {m.zdr ? ZDR_LABELS[m.zdr] ?? m.zdr : "—"}
                </DetailRow>
                <DetailRow label="Без обучения на данных">
                  {m.noTraining ? ZDR_LABELS[m.noTraining] ?? m.noTraining : "—"}
                </DetailRow>
                <DetailRow label="Регионы">{m.regions?.join(", ") || "—"}</DetailRow>
              </Section>

              <Section title="Использование за 30 дней">
                <DetailRow label="Вызовы">
                  {detail.usage30d.calls.toLocaleString("ru-RU")}
                  {detail.usage30d.errors ? ` (ошибок: ${detail.usage30d.errors})` : ""}
                </DetailRow>
                <DetailRow label="Стоимость">{formatUsd(detail.usage30d.cost)}</DetailRow>
                <DetailRow label="Процессов">{detail.usage30d.processes}</DetailRow>
              </Section>

              <Section title="История цен">
                {detail.priceHistory.length === 0 ? (
                  <p className="py-1 text-sm text-muted-foreground">Нет записей</p>
                ) : (
                  detail.priceHistory.map((h) => (
                    <DetailRow key={h.id} label={formatDateTime(h.validFrom)}>
                      вход {formatUsd(h.costInput)} · выход {formatUsd(h.costOutput)}
                    </DetailRow>
                  ))
                )}
              </Section>

              <Section title="Источник данных">
                {Object.entries(m.fieldSources)
                  .sort(([a], [b]) =>
                    (FIELD_LABELS[a] ?? a).localeCompare(FIELD_LABELS[b] ?? b, "ru"),
                  )
                  .map(([field, source]) => (
                    <DetailRow key={field} label={FIELD_LABELS[field] ?? field}>
                      <span className="font-mono text-xs">{source}</span>
                    </DetailRow>
                  ))}
              </Section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ── main ────────────────────────────────────────────────────────────────

export function AdminAiModels() {
  const [gateways, setGateways] = useState<AiGatewayRow[]>([])
  const [gatewayId, setGatewayId] = useState<string | null>(null)
  const [types, setTypes] = useState<{ value: string; count: number }[]>([])
  const [vendorOptions, setVendorOptions] = useState<{ value: string; count: number }[]>([])

  const [type, setType] = useState<string>("language")
  const [vendors, setVendors] = useState<string[]>([])
  const [caps, setCaps] = useState<string[]>([])
  const [search, setSearch] = useState("")
  const [q, setQ] = useState("")
  const [availableOnly, setAvailableOnly] = useState(true)
  const [sort, setSort] = useState<Sort>("name")
  const [dir, setDir] = useState<"asc" | "desc">("asc")
  const [page, setPage] = useState(0)

  const [rows, setRows] = useState<AiModelListRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [openModel, setOpenModel] = useState<string | null>(null)

  const gateway = gateways.find((g) => g.id === gatewayId) ?? null
  // Ignore responses of superseded requests (fast filter changes).
  const requestSeq = useRef(0)

  const loadGateways = useCallback(async () => {
    const r = await fetch("/api/admin/ai/models?gateways=1")
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const d = (await r.json()) as { gateways: AiGatewayRow[] }
    setGateways(d.gateways)
    setGatewayId((cur) => cur ?? d.gateways.find((g) => g.isDefault)?.id ?? d.gateways[0]?.id ?? null)
  }, [])

  useEffect(() => {
    loadGateways().catch((e) => {
      setError(e instanceof Error ? e.message : String(e))
      setLoading(false)
    })
  }, [loadGateways])

  // Debounced search box.
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  // Any filter change → back to page 1.
  useEffect(() => {
    setPage(0)
  }, [gatewayId, type, vendors, caps, q, availableOnly, sort, dir])

  const loadFacets = useCallback(async () => {
    if (!gatewayId) return
    const params = new URLSearchParams({ facets: "1", gatewayId, type })
    const r = await fetch(`/api/admin/ai/models?${params}`)
    if (!r.ok) return
    const d = (await r.json()) as {
      types: { value: string; count: number }[]
      vendors: { value: string; count: number }[]
    }
    setTypes(d.types)
    setVendorOptions(d.vendors)
  }, [gatewayId, type])

  useEffect(() => {
    loadFacets()
  }, [loadFacets])

  const loadModels = useCallback(async () => {
    if (!gatewayId) return
    const seq = ++requestSeq.current
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        gatewayId,
        type,
        sort,
        dir,
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      })
      if (q) params.set("q", q)
      if (availableOnly) params.set("available", "1")
      vendors.forEach((v) => params.append("vendor", v))
      caps.forEach((c) => params.append("cap", c))
      const r = await fetch(`/api/admin/ai/models?${params}`)
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`)
      const d = (await r.json()) as { rows: AiModelListRow[]; total: number }
      if (seq !== requestSeq.current) return
      setRows(d.rows)
      setTotal(d.total)
    } catch (e) {
      if (seq !== requestSeq.current) return
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }, [gatewayId, type, sort, dir, page, q, availableOnly, vendors, caps])

  useEffect(() => {
    loadModels()
  }, [loadModels])

  const onSort = (c: Sort) => {
    if (sort === c) setDir(dir === "asc" ? "desc" : "asc")
    else {
      setSort(c)
      setDir("asc")
    }
  }

  const syncNow = async () => {
    if (!gatewayId) return
    setSyncing(true)
    try {
      const r = await fetch("/api/admin/ai/catalog/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gatewayId }),
      })
      const d = (await r.json().catch(() => ({}))) as {
        results?: {
          ok: boolean
          models: number
          inserted: number
          markedUnavailable: number
          priceChanges: number
          warnings: string[]
          error?: string
        }[]
        error?: string
      }
      const res = d.results?.[0]
      if (!r.ok || !res?.ok) {
        toast.error(`Синхронизация не удалась: ${res?.error ?? d.error ?? `HTTP ${r.status}`}`)
      } else {
        toast.success(
          `Моделей: ${res.models}. Новых: ${res.inserted}, изменений цен: ${res.priceChanges}, недоступных: ${res.markedUnavailable}`,
        )
        if (res.warnings.length) toast.warning(res.warnings.join("; "))
      }
    } catch (e) {
      toast.error(`Синхронизация не удалась: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSyncing(false)
      await Promise.all([loadGateways().catch(() => {}), loadFacets(), loadModels()])
    }
  }

  const vendorSelectOptions = useMemo(
    () => vendorOptions.map((v) => ({ value: v.value, label: v.value, hint: String(v.count) })),
    [vendorOptions],
  )
  const capOptions = useMemo(
    () => AI_CAPABILITIES.map((c) => ({ value: c, label: AI_CAPABILITY_LABELS[c] })),
    [],
  )

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const filtered = vendors.length > 0 || caps.length > 0 || q !== ""

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-3">
        {/* White toolbar (src/app/AGENTS.md § "White toolbar convention") */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3">
          <Select value={gatewayId ?? undefined} onValueChange={setGatewayId}>
            <SelectTrigger size="sm" className="w-52" aria-label="Провайдер шлюза">
              <SelectValue placeholder="Провайдер шлюза" />
            </SelectTrigger>
            <SelectContent>
              {gateways.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name}
                  {!g.isEnabled ? " (выключен)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={type} onValueChange={(v) => { setType(v); setVendors([]) }}>
            <SelectTrigger size="sm" className="w-48" aria-label="Тип">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_TYPES}>Все типы</SelectItem>
              {types.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {typeLabel(t.value)} ({t.count})
                </SelectItem>
              ))}
              {!types.some((t) => t.value === type) && type !== ALL_TYPES && (
                <SelectItem value={type}>{typeLabel(type)}</SelectItem>
              )}
            </SelectContent>
          </Select>

          <MultiCheckSelect
            label="Разработчики"
            emptyLabel="Все разработчики"
            options={vendorSelectOptions}
            values={vendors}
            onChange={setVendors}
            searchable
          />

          <MultiCheckSelect
            label="Возможности"
            emptyLabel="Любые возможности"
            options={capOptions}
            values={caps}
            onChange={setCaps}
          />

          <div className="relative w-56">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Модель, разработчик…"
              className="h-8 pl-8"
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={availableOnly}
              onCheckedChange={(v) => setAvailableOnly(v === true)}
            />
            Только доступные
          </label>

          <div className="ml-auto flex items-center gap-3">
            <div className="text-right text-xs text-muted-foreground">
              <div>Обновлено: {formatDateTime(gateway?.lastSyncedAt)}</div>
              {gateway &&
                (!gateway.lastSyncedAt ||
                  Date.now() - new Date(gateway.lastSyncedAt).getTime() > 26 * 3_600_000) && (
                  <div className="text-amber-600">Ежедневная синхронизация не запускалась больше суток</div>
                )}
              {gateway?.lastSyncError && (
                <div className="max-w-64 truncate text-red-500" title={gateway.lastSyncError}>
                  {gateway.lastSyncError}
                </div>
              )}
            </div>
            <Button size="sm" variant="outline" onClick={syncNow} disabled={syncing || !gatewayId}>
              {syncing ? (
                <Loader className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCcw className="h-4 w-4" />
              )}
              Синхронизировать
            </Button>
          </div>
        </div>

        <div className="flex min-h-8 items-center gap-3 text-sm text-muted-foreground">
          <span>Найдено моделей: {total}</span>
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setVendors([])
                setCaps([])
                setSearch("")
              }}
            >
              Сбросить фильтры
            </Button>
          )}
        </div>

        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <SortHead label="Модель" column="name" sort={sort} dir={dir} onSort={onSort} />
                <SortHead label="Разработчик" column="vendor" sort={sort} dir={dir} onSort={onSort} />
                {type === ALL_TYPES && <TableHead>Тип</TableHead>}
                <SortHead label="Контекст" column="context" sort={sort} dir={dir} onSort={onSort} className="text-right" />
                <SortHead label="Вход $/1M" column="cost_input" sort={sort} dir={dir} onSort={onSort} className="text-right" />
                <SortHead label="Выход $/1M" column="cost_output" sort={sort} dir={dir} onSort={onSort} className="text-right" />
                <TableHead>Возможности</TableHead>
                <TableHead>ZDR</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {error ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-red-500">
                    Не удалось загрузить модели: {error}
                  </TableCell>
                </TableRow>
              ) : loading && rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center">
                    <Loader className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                    {gateway && !gateway.lastSyncedAt
                      ? "Каталог ещё не загружен. Нажмите «Синхронизировать»."
                      : "Модели не найдены"}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow
                    key={r.modelId}
                    onClick={() => setOpenModel(r.modelId)}
                    className={`cursor-pointer even:bg-muted/40 ${loading ? "opacity-60" : ""} ${r.isAvailable === false ? "text-muted-foreground" : ""}`}
                  >
                    <TableCell>
                      <div className="font-medium">
                        {r.name}
                        <StatusBadges isAvailable={r.isAvailable} status={r.status} />
                      </div>
                      <div className="font-mono text-xs text-muted-foreground">{r.modelId}</div>
                    </TableCell>
                    <TableCell>{r.vendor ?? "—"}</TableCell>
                    {type === ALL_TYPES && <TableCell>{typeLabel(r.type ?? "")}</TableCell>}
                    <TableCell className="text-right tabular-nums">{formatTokens(r.limitContext)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatUsd(r.costInput)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatUsd(r.costOutput)}</TableCell>
                    <TableCell>
                      <CapabilityIcons
                        caps={modelCapabilities({
                          toolCall: r.toolCall,
                          structuredOutput: r.structuredOutput,
                          webSearch: r.webSearch,
                          reasoning: r.reasoning,
                          inputModalities: r.inputModalities,
                        })}
                      />
                    </TableCell>
                    <TableCell>{r.zdr ? ZDR_LABELS[r.zdr] ?? r.zdr : "—"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>

        {pages > 1 && (
          <div className="flex items-center justify-end gap-2 text-sm">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0 || loading}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="tabular-nums">
              {page + 1} / {pages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
              disabled={page >= pages - 1 || loading}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}

        {gatewayId && (
          <ModelDrawer
            gatewayId={gatewayId}
            modelId={openModel}
            onClose={() => setOpenModel(null)}
          />
        )}
      </div>
    </TooltipProvider>
  )
}

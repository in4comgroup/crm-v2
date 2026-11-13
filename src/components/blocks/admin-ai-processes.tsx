"use client"

// «Процессы ИИ» (AI processes) tab on /settings: the model of every place
// that calls AI. Spec: docs/specs/models/03-processes-and-model-selection.md
// §5. Data: /api/admin/ai/processes. Cost per 1,000 calls = this process's
// average tokens (last 30 days) × the model's prices.

import { Fragment, useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Loader,
  Pencil,
  RotateCcw,
  Search,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
  AI_CAPABILITY_LABELS,
  modelCapabilities,
  type AiCapability,
} from "@/lib/ai-capabilities"
import {
  CapabilityIcons,
  formatDateTime,
  formatTokens,
  formatUsd,
  ZDR_LABELS,
} from "@/components/blocks/admin-ai-models"
import type { AdminAiProcess } from "@/app/api/admin/ai/processes/route"
import { AdminAiPolicy } from "@/components/blocks/admin-ai-policy"
import type { AiModelListRow } from "@/app/api/admin/ai/models/route"

type CompatibleModel = AiModelListRow & { costPer1000: number | null }

const MAX_FALLBACKS = 3
const ALL_VENDORS = "__all__"

const PROBLEM_LABELS: Record<string, string> = {
  unknown_model: "модели нет в каталоге",
  unavailable: "модель недоступна",
  not_language: "не языковая модель",
  missing_capability: "нет возможности",
  no_vendor_tool: "шлюз не даёт инструмент",
  policy_zdr: "нарушает правило ZDR",
  policy_no_training: "нарушает правило «без обучения»",
  policy_vendor: "разработчик не разрешён правилами",
}

function problemText(p: AdminAiProcess["problems"][number]): string {
  const base = PROBLEM_LABELS[p.reason] ?? p.reason
  const cap = p.capability
    ? `: ${AI_CAPABILITY_LABELS[p.capability as AiCapability] ?? p.capability}`
    : ""
  return `${p.modelId} — ${base}${cap}`
}

function modelName(p: AdminAiProcess, id: string) {
  return p.models[id]?.name ?? id
}

// ── edit dialog ─────────────────────────────────────────────────────────

function EditProcessDialog({
  process,
  onClose,
  onSaved,
}: {
  process: AdminAiProcess | null
  onClose: () => void
  onSaved: () => void
}) {
  const open = !!process
  const [loaded, setLoaded] = useState<{
    key: string
    models: CompatibleModel[]
    incompatibleCount: number
    hasUsage: boolean
    error: string | null
  } | null>(null)
  const [primary, setPrimary] = useState("")
  const [fallbacks, setFallbacks] = useState<string[]>([])
  const [allowed, setAllowed] = useState<string[]>([])
  const [q, setQ] = useState("")
  const [vendor, setVendor] = useState(ALL_VENDORS)
  const [saving, setSaving] = useState(false)

  // Reset the form when another process opens (render-time sync).
  const [formKey, setFormKey] = useState<string | null>(null)
  if (process && formKey !== process.key) {
    setFormKey(process.key)
    setPrimary(process.primaryModelId)
    setFallbacks(process.fallbackModelIds)
    setAllowed(process.allowedModelIds)
    setQ("")
    setVendor(ALL_VENDORS)
  }
  if (!process && formKey !== null) setFormKey(null)

  useEffect(() => {
    if (!process?.gatewayId) return
    let cancelled = false
    const key = process.key
    const params = new URLSearchParams({ compatible: key, gatewayId: process.gatewayId })
    fetch(`/api/admin/ai/processes?${params}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`)
        return r.json() as Promise<{
          models: CompatibleModel[]
          incompatibleCount: number
          hasUsage: boolean
        }>
      })
      .then((d) => !cancelled && setLoaded({ key, ...d, error: null }))
      .catch(
        (e) =>
          !cancelled &&
          setLoaded({
            key,
            models: [],
            incompatibleCount: 0,
            hasUsage: false,
            error: e instanceof Error ? e.message : String(e),
          }),
      )
    return () => {
      cancelled = true
    }
  }, [process?.key, process?.gatewayId])

  const current = loaded && process && loaded.key === process.key ? loaded : null
  // Cheapest first: by cost per 1,000 calls when the process has usage,
  // else by input price (the server's order).
  const models = useMemo(() => {
    const list = current?.models ?? []
    if (!current?.hasUsage) return list
    return [...list].sort(
      (a, b) => (a.costPer1000 ?? Infinity) - (b.costPer1000 ?? Infinity),
    )
  }, [current])
  const byId = useMemo(() => new Map(models.map((m) => [m.modelId, m])), [models])
  const vendors = useMemo(
    () => [...new Set(models.map((m) => m.vendor).filter((v): v is string => !!v))].sort(),
    [models],
  )
  const query = q.trim().toLowerCase()
  const visible = models.filter(
    (m) =>
      (vendor === ALL_VENDORS || m.vendor === vendor) &&
      (!query ||
        `${m.modelId} ${m.name} ${m.vendor ?? ""}`.toLowerCase().includes(query)),
  )

  const nameOf = (id: string) => byId.get(id)?.name ?? process?.models[id]?.name ?? id
  const before = process ? byId.get(process.primaryModelId)?.costPer1000 ?? null : null
  const after = byId.get(primary)?.costPer1000 ?? null

  const setAsPrimary = (id: string) => {
    setPrimary(id)
    setFallbacks((f) => f.filter((x) => x !== id))
  }
  const toggleFallback = (id: string) => {
    if (id === primary) return
    setFallbacks((f) =>
      f.includes(id) ? f.filter((x) => x !== id) : f.length < MAX_FALLBACKS ? [...f, id] : f,
    )
  }
  const moveFallback = (i: number, d: -1 | 1) =>
    setFallbacks((f) => {
      const j = i + d
      if (j < 0 || j >= f.length) return f
      const next = [...f]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  const toggleAllowed = (id: string) =>
    setAllowed((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]))

  const save = async (reset = false) => {
    if (!process) return
    setSaving(true)
    try {
      const r = await fetch("/api/admin/ai/processes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          reset
            ? { processKey: process.key, reset: true }
            : {
                processKey: process.key,
                gatewayId: process.gatewayId,
                primaryModelId: primary,
                fallbackModelIds: fallbacks,
                allowedModelIds: process.userSelectable
                  ? [...new Set([primary, ...allowed])]
                  : [],
              },
        ),
      })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`)
      toast.success(reset ? "Возвращена модель по умолчанию" : "Сохранено")
      onSaved()
      onClose()
    } catch (e) {
      toast.error(`Не удалось сохранить: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{process?.label}</DialogTitle>
          <DialogDescription>{process?.description}</DialogDescription>
        </DialogHeader>

        {process && (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            {/* Current choice */}
            <div className="space-y-2 rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-32 text-muted-foreground">Основная модель</span>
                <Badge variant="secondary">{nameOf(primary)}</Badge>
                {primary === process.defaultModelId && (
                  <span className="text-xs text-muted-foreground">(по умолчанию)</span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-32 text-muted-foreground">Резервные</span>
                {fallbacks.length === 0 ? (
                  <span className="text-xs text-muted-foreground">
                    нет — добавьте кнопкой «В резерв» (до {MAX_FALLBACKS})
                  </span>
                ) : (
                  fallbacks.map((id, i) => (
                    <Badge key={id} variant="outline" className="gap-1">
                      {i + 1}. {nameOf(id)}
                      <button type="button" onClick={() => moveFallback(i, -1)} aria-label="Выше">
                        <ArrowUp className="h-3 w-3" />
                      </button>
                      <button type="button" onClick={() => moveFallback(i, 1)} aria-label="Ниже">
                        <ArrowDown className="h-3 w-3" />
                      </button>
                      <button type="button" onClick={() => toggleFallback(id)} aria-label="Убрать">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))
                )}
              </div>
              {current?.hasUsage && primary !== process.primaryModelId && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-32 text-muted-foreground">Стоимость</span>
                  <span>
                    Было ≈ {formatUsd(before)} → станет ≈ {formatUsd(after)} за 1 000 вызовов
                  </span>
                </div>
              )}
              {process.userSelectable && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-32 text-muted-foreground">Доступны пользователям</span>
                  {[...new Set([primary, ...allowed])].map((id) => (
                    <Badge key={id} variant="outline">
                      {nameOf(id)}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* Picker toolbar */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-64">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Модель, разработчик…"
                  className="h-8 pl-8"
                />
              </div>
              <Select value={vendor} onValueChange={setVendor}>
                <SelectTrigger size="sm" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_VENDORS}>Все разработчики</SelectItem>
                  {vendors.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="ml-auto text-xs text-muted-foreground">
                Совместимых: {models.length}
                {current?.incompatibleCount
                  ? ` · скрыто несовместимых: ${current.incompatibleCount}`
                  : ""}
              </span>
            </div>

            {/* Compatible models, cheapest first */}
            <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border">
              {!current ? (
                <div className="flex justify-center py-10">
                  <Loader className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : current.error ? (
                <p className="p-4 text-sm text-red-500">{current.error}</p>
              ) : (
                <Table>
                  <TableHeader className="sticky top-0 bg-card">
                    <TableRow>
                      <TableHead>Модель</TableHead>
                      <TableHead className="text-right">Вход $/1M</TableHead>
                      <TableHead className="text-right">Выход $/1M</TableHead>
                      {current.hasUsage && (
                        <TableHead className="text-right">≈ $ / 1 000 вызовов</TableHead>
                      )}
                      <TableHead className="text-right">Контекст</TableHead>
                      <TableHead>Возможности</TableHead>
                      <TableHead>ZDR</TableHead>
                      <TableHead className="text-right">Выбор</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.map((m) => {
                      const isPrimary = m.modelId === primary
                      const fbIndex = fallbacks.indexOf(m.modelId)
                      return (
                        <TableRow
                          key={m.modelId}
                          className={isPrimary ? "bg-primary/10" : "even:bg-muted/40"}
                        >
                          <TableCell>
                            <div className="font-medium">{m.name}</div>
                            <div className="font-mono text-xs text-muted-foreground">
                              {m.modelId}
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatUsd(m.costInput)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatUsd(m.costOutput)}
                          </TableCell>
                          {current.hasUsage && (
                            <TableCell className="text-right tabular-nums">
                              {formatUsd(m.costPer1000)}
                            </TableCell>
                          )}
                          <TableCell className="text-right tabular-nums">
                            {formatTokens(m.limitContext)}
                          </TableCell>
                          <TableCell>
                            <CapabilityIcons
                              caps={modelCapabilities({
                                toolCall: m.toolCall,
                                structuredOutput: m.structuredOutput,
                                webSearch: m.webSearch,
                                reasoning: m.reasoning,
                                inputModalities: m.inputModalities,
                              })}
                            />
                          </TableCell>
                          <TableCell>{m.zdr ? ZDR_LABELS[m.zdr] ?? m.zdr : "—"}</TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-1.5">
                              <Button
                                size="sm"
                                variant={isPrimary ? "default" : "outline"}
                                className="h-7"
                                onClick={() => setAsPrimary(m.modelId)}
                              >
                                Основная
                              </Button>
                              <Button
                                size="sm"
                                variant={fbIndex >= 0 ? "secondary" : "ghost"}
                                className="h-7"
                                disabled={
                                  isPrimary ||
                                  (fbIndex < 0 && fallbacks.length >= MAX_FALLBACKS)
                                }
                                onClick={() => toggleFallback(m.modelId)}
                              >
                                {fbIndex >= 0 ? `Резерв ${fbIndex + 1}` : "В резерв"}
                              </Button>
                              {process.userSelectable && (
                                <label className="flex items-center gap-1 text-xs">
                                  <Checkbox
                                    checked={isPrimary || allowed.includes(m.modelId)}
                                    disabled={isPrimary}
                                    onCheckedChange={() => toggleAllowed(m.modelId)}
                                  />
                                  польз.
                                </label>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            onClick={() => save(true)}
            disabled={saving || !process || process.isDefault}
          >
            <RotateCcw className="h-4 w-4" />
            Сбросить на модель по умолчанию
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>
              Отмена
            </Button>
            <Button onClick={() => save(false)} disabled={saving || !primary || !current}>
              {saving && <Loader className="h-4 w-4 animate-spin" />}
              Сохранить
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── main table ──────────────────────────────────────────────────────────

export function AdminAiProcesses() {
  const [processes, setProcesses] = useState<AdminAiProcess[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<AdminAiProcess | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/ai/processes")
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`)
      const d = (await r.json()) as { processes: AdminAiProcess[] }
      setProcesses(d.processes)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const groups = useMemo(() => {
    const out = new Map<string, AdminAiProcess[]>()
    for (const p of processes ?? []) {
      const list = out.get(p.group) ?? []
      list.push(p)
      out.set(p.group, list)
    }
    return [...out.entries()]
  }, [processes])

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Модель для каждого места, где система обращается к ИИ. Изменения действуют без
          релиза (до 1 минуты). «≈ $ / 1 000 вызовов» — по среднему числу токенов процесса
          за 30 дней и ценам модели.
        </p>
        <AdminAiPolicy onSaved={load} />
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Процесс</TableHead>
                <TableHead>Требует</TableHead>
                <TableHead>Модель</TableHead>
                <TableHead>Резервные</TableHead>
                <TableHead className="text-right">≈ $ / 1 000 вызовов</TableHead>
                <TableHead className="text-right">За 30 дней</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {error ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-red-500">
                    Не удалось загрузить процессы: {error}
                  </TableCell>
                </TableRow>
              ) : !processes ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center">
                    <Loader className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : (
                groups.map(([group, list]) => (
                  <Fragment key={group}>
                    <TableRow className="bg-muted/60 hover:bg-muted/60">
                      <TableCell colSpan={8} className="py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {group}
                      </TableCell>
                    </TableRow>
                    {list.map((p) => {
                      const deviates = p.effectiveModelId !== p.primaryModelId
                      return (
                        <TableRow key={p.key}>
                          <TableCell className="max-w-80">
                            <div className="flex items-center gap-2 font-medium">
                              {p.label}
                              <Badge variant="outline" className="font-normal">
                                {p.kind === "background" ? "фоновый" : "интерактивный"}
                              </Badge>
                            </div>
                            <div className="text-xs text-muted-foreground">{p.description}</div>
                          </TableCell>
                          <TableCell>
                            <CapabilityIcons caps={p.requires as AiCapability[]} />
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{modelName(p, p.primaryModelId)}</span>
                              {p.isDefault && (
                                <Badge variant="secondary" className="font-normal">
                                  по умолчанию
                                </Badge>
                              )}
                            </div>
                            <div className="font-mono text-xs text-muted-foreground">
                              {p.primaryModelId}
                            </div>
                            {p.userSelectable && (
                              <div className="text-xs text-muted-foreground">
                                Пользователям доступно: {p.allowedModelIds.length}
                              </div>
                            )}
                            {!p.isDefault && p.updatedAt && (
                              <div className="text-xs text-muted-foreground">
                                Изменено {formatDateTime(p.updatedAt)}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            {p.fallbackModelIds.length === 0 ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="cursor-default underline decoration-dotted">
                                    {p.fallbackModelIds.length}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {p.fallbackModelIds.map((id, i) => (
                                    <div key={id}>
                                      {i + 1}. {modelName(p, id)}
                                    </div>
                                  ))}
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {p.costPer1000 == null ? (
                              <span className="text-xs text-muted-foreground">нет данных</span>
                            ) : (
                              formatUsd(p.costPer1000)
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {p.usage30d ? (
                              <>
                                <div>{p.usage30d.calls.toLocaleString("ru-RU")} выз.</div>
                                <div className="text-xs text-muted-foreground">
                                  {formatUsd(p.usage30d.cost)}
                                </div>
                              </>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="max-w-64">
                            {p.problems.length === 0 ? (
                              <span className="text-sm text-muted-foreground">OK</span>
                            ) : (
                              <div className="space-y-0.5">
                                {deviates && (
                                  <div className="text-xs text-amber-600">
                                    Работает на {modelName(p, p.effectiveModelId)}
                                  </div>
                                )}
                                {p.problems.map((x) => (
                                  <div
                                    key={x.modelId}
                                    className="flex items-start gap-1 text-xs text-amber-600"
                                  >
                                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                                    {problemText(x)}
                                  </div>
                                ))}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Изменить"
                              disabled={!p.gatewayId}
                              onClick={() => setEditing(p)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </Fragment>
                ))
              )}
            </TableBody>
          </Table>
        </Card>

        <EditProcessDialog
          process={editing}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      </div>
    </TooltipProvider>
  )
}

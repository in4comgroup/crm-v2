"use client"

// «Использование ИИ» (AI usage) tab on /settings: AI spend by day,
// organization, process and model, from the usage ledger.
// Spec: docs/specs/models/04-usage-and-cost.md §5, §6. Data:
// /api/admin/ai/usage (page) + /api/admin/ai/usage?chart=1 (cost chart with
// its own scale and range — src/lib/ai-usage-chart.ts). Charts reuse the analytics chart kit (fixed series
// colors, tail folded into «Прочее»). Markup block: admin-ai-markup.tsx.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, ArrowDown, ArrowUp, Download, Loader, RefreshCcw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  buildSeries,
  remapStack,
  StackedPeriodBars,
} from "@/components/blocks/analytics/analytics-charts"
import { ChartCard, NoData, StatTile } from "@/components/blocks/analytics/analytics-primitives"
import { MAX_SERIES, OTHER_LABEL } from "@/lib/analytics-format"
import { AdminAiMarkup } from "@/components/blocks/admin-ai-markup"
import { AdminAiBudget } from "@/components/blocks/admin-ai-budget"
import type {
  AdminAiUsageChartResponse,
  AdminAiUsageResponse,
} from "@/app/api/admin/ai/usage/route"
import {
  bucketKeys,
  bucketLabel,
  buildStackedBuckets,
  CHART_SCALE_LABELS,
  CHART_SCALES,
  checkChartRange,
  defaultChartRange,
  type ChartScale,
} from "@/lib/ai-usage-chart"
import { usePersistentTab } from "@/lib/use-persistent-tab"

const ALL = "__all__"
// The daily run is "late" after 26 h (24 h + slack for the cron window).
const STALE_SYNC_MS = 26 * 3_600_000
const SYSTEM_ORG = "system"

type Period = "7d" | "30d" | "this_month" | "last_month" | "custom"
type Group = "org" | "process" | "model"
const GROUPS = ["org", "process", "model"] as const satisfies readonly Group[]
const STACKS = ["process", "model"] as const
type Row = AdminAiUsageResponse["byOrg"][number]
type SortKey = "label" | "calls" | "errors" | "tokens" | "cost" | "avgCost"

// ── formatting ──────────────────────────────────────────────────────────

function usd(n: number, full = false): string {
  if (n === 0) return "$0"
  if (!full && n > 0 && n < 0.01) return "< $0.01"
  return `$${n.toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: full ? 4 : 2,
  })}`
}

const int = (n: number) => Math.round(n).toLocaleString("ru-RU")

function compactTokens(n: number): string {
  if (n >= 1e9) return `${+(n / 1e9).toFixed(1)} млрд`
  if (n >= 1e6) return `${+(n / 1e6).toFixed(1)} млн`
  if (n >= 1e3) return `${+(n / 1e3).toFixed(1)} тыс.`
  return int(n)
}

const pct = (n: number) => `${(n * 100).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`

// ── dates (UTC days, YYYY-MM-DD) ────────────────────────────────────────

const iso = (d: Date) => d.toISOString().slice(0, 10)

function periodRange(p: Period, custom: { from: string; to: string }) {
  const today = new Date()
  const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d))
  const y = today.getUTCFullYear()
  const m = today.getUTCMonth()
  switch (p) {
    case "7d":
      return { from: iso(new Date(today.getTime() - 6 * 86_400_000)), to: iso(today) }
    case "30d":
      return { from: iso(new Date(today.getTime() - 29 * 86_400_000)), to: iso(today) }
    case "this_month":
      return { from: iso(utc(y, m, 1)), to: iso(today) }
    case "last_month":
      return { from: iso(utc(y, m - 1, 1)), to: iso(utc(y, m, 0)) }
    case "custom":
      return custom
  }
}

// ── component ───────────────────────────────────────────────────────────

export function AdminAiUsage() {
  const [period, setPeriod] = useState<Period>("30d")
  const [custom, setCustom] = useState(() => periodRange("30d", { from: "", to: "" }))
  const [org, setOrg] = useState(ALL)
  const [processKey, setProcessKey] = useState(ALL)
  const [model, setModel] = useState(ALL)
  const [status, setStatus] = useState(ALL)
  // Chart stack + table grouping are remembered per browser (no URL param).
  const [stack, setStack] = usePersistentTab<"process" | "model">("settings.aiUsage.stack", "process", {
    allowed: STACKS,
    urlParam: false,
  })
  // Chart scale and range. `chartRange` null = the default for the scale
  // (day → the page period, month → 12 months, year → 5 years).
  const [scale, setScale] = useState<ChartScale>("day")
  const [chartRange, setChartRange] = useState<{ from: string; to: string } | null>(null)
  const [chartData, setChartData] = useState<AdminAiUsageChartResponse["chart"] | null>(null)
  const [chartLoading, setChartLoading] = useState(true)
  const [chartError, setChartError] = useState<string | null>(null)
  const chartSeq = useRef(0)
  const [group, setGroup] = usePersistentTab<Group>("settings.aiUsage.group", "process", {
    allowed: GROUPS,
    urlParam: false,
  })
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "cost", dir: "desc" })

  const [data, setData] = useState<AdminAiUsageResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reconciling, setReconciling] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const seq = useRef(0)

  const range = periodRange(period, custom)
  const cRange = chartRange ?? defaultChartRange(scale, range, iso(new Date()))
  const cCheck = checkChartRange(scale, cRange.from, cRange.to)

  const load = useCallback(async () => {
    const id = ++seq.current
    setLoading(true)
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to })
      if (org !== ALL) params.set("org", org)
      if (processKey !== ALL) params.set("process", processKey)
      if (model !== ALL) params.set("model", model)
      if (status !== ALL) params.set("status", status)
      const r = await fetch(`/api/admin/ai/usage?${params}`)
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`)
      const d = (await r.json()) as AdminAiUsageResponse
      if (id !== seq.current) return
      setData(d)
      setError(null)
    } catch (e) {
      if (id !== seq.current) return
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (id === seq.current) setLoading(false)
    }
  }, [range.from, range.to, org, processKey, model, status])

  useEffect(() => {
    load()
  }, [load])

  // Cost chart: own request, so a change of scale / range / stacking does
  // not reload the whole page. The other page filters apply to it too.
  const cValid = cCheck.ok
  const loadChart = useCallback(async () => {
    const id = ++chartSeq.current
    if (!cValid) {
      setChartLoading(false)
      return
    }
    setChartLoading(true)
    try {
      const params = new URLSearchParams({ chart: "1", scale, from: cRange.from, to: cRange.to, stack })
      if (org !== ALL) params.set("org", org)
      if (processKey !== ALL) params.set("process", processKey)
      if (model !== ALL) params.set("model", model)
      if (status !== ALL) params.set("status", status)
      const r = await fetch(`/api/admin/ai/usage?${params}`)
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`)
      const d = (await r.json()) as AdminAiUsageChartResponse
      if (id !== chartSeq.current) return
      setChartData(d.chart)
      setChartError(null)
    } catch (e) {
      if (id !== chartSeq.current) return
      setChartError(e instanceof Error ? e.message : String(e))
    } finally {
      if (id === chartSeq.current) setChartLoading(false)
    }
  }, [cValid, scale, cRange.from, cRange.to, stack, org, processKey, model, status])

  useEffect(() => {
    loadChart()
  }, [loadChart])

  const processLabel = useMemo(
    () => new Map((data?.options.processes ?? []).map((p) => [p.key, p.label])),
    [data],
  )
  const orgLabel = useCallback(
    (id: string, name?: string | null) =>
      id === SYSTEM_ORG ? "Без организации" : (name ?? data?.options.orgs.find((o) => o.id === id)?.name ?? id),
    [data],
  )
  const labelOf = useCallback(
    (g: Group, r: Pick<Row, "key" | "label">) =>
      g === "org" ? orgLabel(r.key, r.label) : g === "process" ? (processLabel.get(r.key) ?? r.key) : r.key,
    [orgLabel, processLabel],
  )

  // Stacked cost per bucket: every bucket of the range (empty = 0), top
  // series by range cost, tail folded into «Прочее».
  const chart = useMemo(() => {
    if (!chartData) return null
    const name = (k: string) => (chartData.stack === "process" ? (processLabel.get(k) ?? k) : k)
    const { labels, points } = buildStackedBuckets(
      bucketKeys(chartData.scale, chartData.from, chartData.to),
      chartData.rows,
      { name, maxSeries: MAX_SERIES, otherLabel: OTHER_LABEL },
    )
    const series = buildSeries(labels)
    return { series, points: remapStack(points, series) }
  }, [chartData, processLabel])

  const rows = useMemo(() => {
    if (!data) return []
    const list = group === "org" ? data.byOrg : group === "process" ? data.byProcess : data.byModel
    const val = (r: Row): number | string =>
      sort.key === "label"
        ? labelOf(group, r)
        : sort.key === "tokens"
          ? r.inputTokens + r.outputTokens
          : r[sort.key]
    return [...list].sort((a, b) => {
      const x = val(a)
      const y = val(b)
      const c = typeof x === "string" ? x.localeCompare(String(y), "ru") : x - (y as number)
      return sort.dir === "asc" ? c : -c
    })
  }, [data, group, sort, labelOf])

  // Row click narrows the page to that entity.
  const drill = (r: Row) => {
    if (group === "org") setOrg(r.key)
    else if (group === "process") setProcessKey(r.key)
    else setModel(r.key)
  }

  const exportCsv = () => {
    const head = ["Название", "Ключ", "Вызовы", "Ошибки", "Токены вход", "Токены выход", "Стоимость USD", "С наценкой USD", "Доля", "Средняя стоимость вызова USD"]
    const lines = rows.map((r) =>
      [labelOf(group, r), r.key, r.calls, r.errors, r.inputTokens, r.outputTokens, r.cost.toFixed(6), r.costWithMarkup.toFixed(6), r.share.toFixed(4), r.avgCost.toFixed(6)]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    )
    const blob = new Blob(["﻿" + [head.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `ai-usage-${group}-${range.from}_${range.to}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const reconcileNow = async () => {
    setReconciling(true)
    try {
      const r = await fetch("/api/admin/ai/usage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reconcile" }),
      })
      const d = (await r.json().catch(() => ({}))) as { checked?: number; updated?: number }
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      toast.success(`Уточнено: ${d.updated ?? 0} из ${d.checked ?? 0}`)
      await Promise.all([load(), loadChart()])
    } catch (e) {
      toast.error(`Не удалось уточнить стоимость: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setReconciling(false)
    }
  }

  // Manual run of what the daily cron does (price sync + exact-cost check),
  // for when the cron did not run.
  const syncAll = async () => {
    setSyncing(true)
    try {
      const r = await fetch("/api/admin/ai/usage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync_all" }),
      })
      const d = (await r.json().catch(() => ({}))) as {
        catalogs?: { ok: boolean; models: number; priceChanges: number; error?: string }[]
        reconcile?: { checked: number; updated: number; failed: number }
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const failed = d.catalogs?.filter((c) => !c.ok) ?? []
      const prices = d.catalogs?.reduce((n, c) => n + (c.priceChanges ?? 0), 0) ?? 0
      const models = d.catalogs?.reduce((n, c) => n + (c.models ?? 0), 0) ?? 0
      if (failed.length) {
        toast.error(`Цены не обновлены: ${failed.map((c) => c.error).join("; ")}`)
      } else {
        toast.success(
          `Цены обновлены (моделей: ${models}, изменений цен: ${prices}). Стоимость уточнена: ${d.reconcile?.updated ?? 0} из ${d.reconcile?.checked ?? 0}`,
        )
      }
      await Promise.all([load(), loadChart()])
    } catch (e) {
      toast.error(`Синхронизация не удалась: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSyncing(false)
    }
  }

  const sync = data?.sync
  const syncStale =
    !!sync && (!sync.lastPriceSyncAt || Date.now() - new Date(sync.lastPriceSyncAt).getTime() > STALE_SYNC_MS)

  const onSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "label" ? "asc" : "desc" }))
  const SortHead = ({ k, label, right }: { k: SortKey; label: string; right?: boolean }) => (
    <TableHead className={right ? "text-right" : undefined}>
      <button type="button" onClick={() => onSort(k)} className="inline-flex cursor-pointer items-center gap-1 hover:text-foreground">
        {label}
        {sort.key === k && (sort.dir === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />)}
      </button>
    </TableHead>
  )

  const filtered = org !== ALL || processKey !== ALL || model !== ALL || status !== ALL
  const s = data?.summary

  return (
    <div className="flex flex-col gap-3">
      {/* White toolbar (src/app/AGENTS.md § "White toolbar convention") */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3">
        <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
          <SelectTrigger size="sm" className="w-40" aria-label="Период">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">7 дней</SelectItem>
            <SelectItem value="30d">30 дней</SelectItem>
            <SelectItem value="this_month">Этот месяц</SelectItem>
            <SelectItem value="last_month">Прошлый месяц</SelectItem>
            <SelectItem value="custom">Свой период</SelectItem>
          </SelectContent>
        </Select>
        {period === "custom" && (
          <>
            <Input type="date" className="h-8 w-36" value={custom.from} max={custom.to}
              onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))} aria-label="С" />
            <Input type="date" className="h-8 w-36" value={custom.to} min={custom.from}
              onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))} aria-label="По" />
          </>
        )}

        <Select value={org} onValueChange={setOrg}>
          <SelectTrigger size="sm" className="w-48" aria-label="Организация">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Все организации</SelectItem>
            {(data?.options.orgs ?? []).map((o) => (
              <SelectItem key={o.id} value={o.id}>{orgLabel(o.id, o.name)}</SelectItem>
            ))}
            {org !== ALL && !data?.options.orgs.some((o) => o.id === org) && (
              <SelectItem value={org}>{orgLabel(org)}</SelectItem>
            )}
          </SelectContent>
        </Select>

        <Select value={processKey} onValueChange={setProcessKey}>
          <SelectTrigger size="sm" className="w-56" aria-label="Процесс">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Все процессы</SelectItem>
            {(data?.options.processes ?? []).map((p) => (
              <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={model} onValueChange={setModel}>
          <SelectTrigger size="sm" className="w-56" aria-label="Модель">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Все модели</SelectItem>
            {(data?.options.models ?? []).map((m) => (
              <SelectItem key={m} value={m}>{m}</SelectItem>
            ))}
            {model !== ALL && !data?.options.models.includes(model) && <SelectItem value={model}>{model}</SelectItem>}
          </SelectContent>
        </Select>

        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger size="sm" className="w-36" aria-label="Статус">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Любой статус</SelectItem>
            <SelectItem value="ok">Успешно</SelectItem>
            <SelectItem value="error">Ошибка</SelectItem>
            <SelectItem value="aborted">Прервано</SelectItem>
            <SelectItem value="blocked">Остановлено бюджетом</SelectItem>
          </SelectContent>
        </Select>

        {filtered && (
          <Button variant="ghost" size="sm" onClick={() => { setOrg(ALL); setProcessKey(ALL); setModel(ALL); setStatus(ALL) }}>
            Сбросить
          </Button>
        )}

        <div className="ml-auto flex items-center gap-2">
          {loading && <Loader className="h-4 w-4 animate-spin text-muted-foreground" />}
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={!rows.length}>
            <Download className="h-4 w-4" />
            CSV
          </Button>
          <Button size="sm" variant="outline" onClick={syncAll} disabled={syncing}>
            {syncing ? <Loader className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            Синхронизировать цены и стоимость
          </Button>
        </div>
      </div>

      {sync && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>
            Цены моделей обновлены:{" "}
            {sync.lastPriceSyncAt
              ? new Date(sync.lastPriceSyncAt).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })
              : "ни разу"}
          </span>
          {sync.pendingExactCost > 0 && <span>Ждут точной стоимости: {int(sync.pendingExactCost)} вызовов</span>}
          {syncStale && (
            <span className="inline-flex items-center gap-1 text-amber-600">
              <AlertTriangle className="h-3 w-3" />
              Ежедневная синхронизация не запускалась больше суток — нажмите «Синхронизировать цены и стоимость»
            </span>
          )}
          {sync.priceSyncError && <span className="text-red-500">Ошибка синхронизации: {sync.priceSyncError}</span>}
        </div>
      )}

      {error && <p className="text-sm text-red-500">Не удалось загрузить статистику: {error}</p>}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="Вызовы" value={s ? int(s.calls) : "—"} />
        <StatTile
          label="Токены"
          value={s ? compactTokens(s.inputTokens + s.outputTokens) : "—"}
          hint={s ? `вход ${compactTokens(s.inputTokens)} · выход ${compactTokens(s.outputTokens)}` : undefined}
        />
        <StatTile label="Себестоимость" value={s ? usd(s.cost) : "—"} hint="стоимость шлюза, USD" />
        <StatTile label="С наценкой" value={s ? usd(s.costWithMarkup) : "—"} hint="что видят клиенты, USD" />
        <StatTile
          label="Ошибки"
          value={s ? int(s.errors) : "—"}
          hint={s && s.calls ? `${pct(s.errors / s.calls)} вызовов` : undefined}
        />
      </div>
      {s && (s.estimated > 0 || s.unpriced > 0) && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {s.estimated > 0 && <span>{int(s.estimated)} вызовов ещё со сметной стоимостью.</span>}
          {s.unpriced > 0 && <span>{int(s.unpriced)} вызовов без цены модели.</span>}
          {s.estimated > 0 && (
            <Button variant="ghost" size="sm" className="h-6" onClick={reconcileNow} disabled={reconciling}>
              {reconciling ? <Loader className="h-3 w-3 animate-spin" /> : <RefreshCcw className="h-3 w-3" />}
              Уточнить
            </Button>
          )}
        </div>
      )}

      {/* Cost chart: scale «По дням / месяцам / годам» + its own range */}
      <ChartCard
        title={`Стоимость ${scale === "day" ? "по дням" : scale === "month" ? "по месяцам" : "по годам"}, USD`}
        description={stack === "process" ? "По процессам" : "По моделям"}
        action={
          <Tabs value={stack} onValueChange={(v) => setStack(v as "process" | "model")}>
            <TabsList>
              <TabsTrigger value="process">Процессы</TabsTrigger>
              <TabsTrigger value="model">Модели</TabsTrigger>
            </TabsList>
          </Tabs>
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-2 px-2 sm:px-0">
          <Select value={scale} onValueChange={(v) => setScale(v as ChartScale)}>
            <SelectTrigger size="sm" className="w-36" aria-label="Шкала графика">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHART_SCALES.map((sc) => (
                <SelectItem key={sc} value={sc}>{CHART_SCALE_LABELS[sc]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">с</span>
          <Input type="date" className="h-8 w-36" value={cRange.from} max={cRange.to}
            onChange={(e) => e.target.value && setChartRange({ from: e.target.value, to: cRange.to })}
            aria-label="Начало диапазона графика" />
          <span className="text-sm text-muted-foreground">по</span>
          <Input type="date" className="h-8 w-36" value={cRange.to} min={cRange.from}
            onChange={(e) => e.target.value && setChartRange({ from: cRange.from, to: e.target.value })}
            aria-label="Конец диапазона графика" />
          {chartRange && (
            <Button variant="ghost" size="sm" onClick={() => setChartRange(null)}>
              По умолчанию
            </Button>
          )}
          {chartLoading && <Loader className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
        {!cCheck.ok ? (
          <div className="flex h-[280px] items-center justify-center px-4 text-center text-sm text-amber-600">
            {cCheck.message}
          </div>
        ) : chartError ? (
          <div className="flex h-[280px] items-center justify-center px-4 text-center text-sm text-red-500">
            Не удалось загрузить график: {chartError}
          </div>
        ) : chart && chart.series.keys.length > 0 ? (
          <StackedPeriodBars
            data={chart.points}
            keys={chart.series.keys}
            config={chart.series.config}
            metricFormat={(n) => usd(n)}
            metricFormatFull={(n) => usd(n, true)}
            periodFormat={(p, long) => bucketLabel(p, long)}
          />
        ) : chartData ? (
          <NoData label="Нет вызовов ИИ за выбранный диапазон" />
        ) : (
          <div className="flex h-[280px] items-center justify-center">
            <Loader className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        <p className="mt-2 px-2 text-xs text-muted-foreground sm:px-0">
          {chartRange || scale !== "day"
            ? "Диапазон «с … по …» заменяет для графика только период страницы; фильтры организации, процесса, модели и статуса действуют и на график."
            : "Диапазон графика = период страницы. Измените даты «с … по …», чтобы задать свой; фильтры организации, процесса, модели и статуса действуют и на график."}{" "}
          Дни — по UTC.
        </p>
      </ChartCard>

      <AdminAiMarkup periodCost={s?.cost ?? null} />
      <AdminAiBudget />

      {/* Breakdown */}
      <div className="flex items-center gap-3">
        <Tabs value={group} onValueChange={(v) => setGroup(v as Group)}>
          <TabsList>
            <TabsTrigger value="org">Организации</TabsTrigger>
            <TabsTrigger value="process">Процессы</TabsTrigger>
            <TabsTrigger value="model">Модели</TabsTrigger>
          </TabsList>
        </Tabs>
        <span className="text-xs text-muted-foreground">Нажмите на строку, чтобы отфильтровать страницу</span>
      </div>
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <SortHead k="label" label={group === "org" ? "Организация" : group === "process" ? "Процесс" : "Модель"} />
              <SortHead k="calls" label="Вызовы" right />
              <SortHead k="errors" label="Ошибки" right />
              <SortHead k="tokens" label="Токены (вход / выход)" right />
              <SortHead k="cost" label="Стоимость" right />
              <TableHead className="text-right">С наценкой</TableHead>
              <TableHead className="text-right">Доля</TableHead>
              <SortHead k="avgCost" label="За вызов" right />
              {group === "model" && <TableHead className="text-right">Резервом</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                  {data ? "Нет вызовов ИИ за выбранный период" : <Loader className="mx-auto h-5 w-5 animate-spin" />}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.key} className="cursor-pointer even:bg-muted/40" onClick={() => drill(r)}>
                  <TableCell>
                    <div className="font-medium">{labelOf(group, r)}</div>
                    {group !== "model" && r.key !== SYSTEM_ORG && (
                      <div className="font-mono text-xs text-muted-foreground">{r.key}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{int(r.calls)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.errors ? `${int(r.errors)} (${pct(r.errors / r.calls)})` : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {compactTokens(r.inputTokens)} / {compactTokens(r.outputTokens)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{usd(r.cost)}</TableCell>
                  <TableCell className="text-right tabular-nums">{usd(r.costWithMarkup)}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(r.share)}</TableCell>
                  <TableCell className="text-right tabular-nums">{usd(r.avgCost, true)}</TableCell>
                  {group === "model" && (
                    <TableCell className="text-right tabular-nums">
                      {r.fallbackRate ? pct(r.fallbackRate) : "—"}
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}

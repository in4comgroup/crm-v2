"use client"

// «Использование ИИ» tab on /account — the organization's AI usage for its
// OWNERS: the same views as the admin tab on /settings (period, filters,
// KPIs, cost chart with scale + range, breakdowns by process / model /
// user), limited to the active organization. Every amount is the END-USER
// cost (with the platform markup); the gateway cost, the markup % and the
// gateway are never shown (the API does not send them).
// The monthly AI limit (spec 08) is shown on top with this month's spend.
// Spec: docs/specs/models/05-markup-and-end-user-cost.md §5. Data:
// /api/account/ai-usage (page) + ?chart=1 (cost chart).

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowDown, ArrowUp, Download, Loader } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { buildSeries, remapStack, StackedPeriodBars } from "@/components/blocks/analytics/analytics-charts"
import { ChartCard, NoData, StatTile } from "@/components/blocks/analytics/analytics-primitives"
import { TablePager } from "@/components/blocks/table-pager"
import { AiLimitNotice, AiMonthlyLimitCard } from "@/components/blocks/ai-limit-banner"
import { useTablePaging } from "@/components/blocks/use-table-paging"
import { MAX_SERIES, OTHER_LABEL } from "@/lib/analytics-format"
import type { AccountAiUsageChartResponse, AccountAiUsageResponse } from "@/app/api/account/ai-usage/route"
import {
  AI_USAGE_BACKGROUND_USER,
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

type Period = "7d" | "30d" | "this_month" | "last_month" | "custom"
type Group = "process" | "model" | "user"
const GROUPS = ["process", "model", "user"] as const satisfies readonly Group[]
type Row = AccountAiUsageResponse["byProcess"][number]
type SortKey = "label" | "calls" | "errors" | "tokens" | "cost" | "avgCost"

const GROUP_LABELS: Record<Group, string> = { process: "Функции", model: "Модели", user: "Пользователи" }
const GROUP_HEAD: Record<Group, string> = { process: "Функция", model: "Модель", user: "Пользователь" }

// ── formatting ──────────────────────────────────────────────────────────

// Rounded to cents; tiny amounts show «< $0.01» (05 §3).
function usd(n: number, full = false): string {
  if (n === 0) return "$0"
  if (!full && n > 0 && n < 0.01) return "< $0.01"
  return `$${n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: full ? 4 : 2 })}`
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

export function AccountAiUsage() {
  const [period, setPeriod] = useState<Period>("this_month")
  const [custom, setCustom] = useState(() => periodRange("30d", { from: "", to: "" }))
  const [processKey, setProcessKey] = useState(ALL)
  const [model, setModel] = useState(ALL)
  const [userId, setUserId] = useState(ALL)
  const [status, setStatus] = useState(ALL)
  // Chart stack + table grouping are remembered per browser (no URL param).
  const [stack, setStack] = usePersistentTab<Group>("account.aiUsage.stack", "process", {
    allowed: GROUPS,
    urlParam: false,
  })
  const [scale, setScale] = useState<ChartScale>("day")
  // null = the default chart range for the scale (day → the page period).
  const [chartRange, setChartRange] = useState<{ from: string; to: string } | null>(null)
  const [chartData, setChartData] = useState<AccountAiUsageChartResponse["chart"] | null>(null)
  const [chartLoading, setChartLoading] = useState(true)
  const [chartError, setChartError] = useState<string | null>(null)
  const chartSeq = useRef(0)
  const [group, setGroup] = usePersistentTab<Group>("account.aiUsage.group", "process", {
    allowed: GROUPS,
    urlParam: false,
  })
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "cost", dir: "desc" })

  const [data, setData] = useState<AccountAiUsageResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)

  const range = periodRange(period, custom)
  const cRange = chartRange ?? defaultChartRange(scale, range, iso(new Date()))
  const cCheck = checkChartRange(scale, cRange.from, cRange.to)

  const filterParams = useCallback(() => {
    const params = new URLSearchParams()
    if (processKey !== ALL) params.set("process", processKey)
    if (model !== ALL) params.set("model", model)
    if (userId !== ALL) params.set("user", userId)
    if (status !== ALL) params.set("status", status)
    return params
  }, [processKey, model, userId, status])

  const load = useCallback(async () => {
    const id = ++seq.current
    setLoading(true)
    try {
      const params = filterParams()
      params.set("from", range.from)
      params.set("to", range.to)
      const r = await fetch(`/api/account/ai-usage?${params}`)
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`)
      const d = (await r.json()) as AccountAiUsageResponse
      if (id !== seq.current) return
      setData(d)
      setError(null)
    } catch (e) {
      if (id !== seq.current) return
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (id === seq.current) setLoading(false)
    }
  }, [range.from, range.to, filterParams])

  useEffect(() => {
    load()
  }, [load])

  const cValid = cCheck.ok
  const loadChart = useCallback(async () => {
    const id = ++chartSeq.current
    if (!cValid) {
      setChartLoading(false)
      return
    }
    setChartLoading(true)
    try {
      const params = filterParams()
      params.set("chart", "1")
      params.set("scale", scale)
      params.set("from", cRange.from)
      params.set("to", cRange.to)
      params.set("stack", stack)
      const r = await fetch(`/api/account/ai-usage?${params}`)
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`)
      const d = (await r.json()) as AccountAiUsageChartResponse
      if (id !== chartSeq.current) return
      setChartData(d.chart)
      setChartError(null)
    } catch (e) {
      if (id !== chartSeq.current) return
      setChartError(e instanceof Error ? e.message : String(e))
    } finally {
      if (id === chartSeq.current) setChartLoading(false)
    }
  }, [cValid, scale, cRange.from, cRange.to, stack, filterParams])

  useEffect(() => {
    loadChart()
  }, [loadChart])

  const processLabel = useMemo(
    () => new Map((data?.options.processes ?? []).map((p) => [p.key, p.label])),
    [data],
  )
  const userLabel = useMemo(
    () => new Map((data?.options.users ?? []).map((u) => [u.id, u.name])),
    [data],
  )
  const nameOf = useCallback(
    (g: Group, key: string, label?: string | null): string => {
      if (g === "process") return processLabel.get(key) ?? "Снятая функция"
      if (g === "model") return key
      if (key === AI_USAGE_BACKGROUND_USER) return "Фоновая обработка"
      return label ?? userLabel.get(key) ?? "Удалённый пользователь"
    },
    [processLabel, userLabel],
  )

  const chart = useMemo(() => {
    if (!chartData) return null
    const { labels, points } = buildStackedBuckets(
      bucketKeys(chartData.scale, chartData.from, chartData.to),
      chartData.rows,
      { name: (k) => nameOf(chartData.stack, k), maxSeries: MAX_SERIES, otherLabel: OTHER_LABEL },
    )
    const series = buildSeries(labels)
    return { series, points: remapStack(points, series) }
  }, [chartData, nameOf])

  const rows = useMemo(() => {
    if (!data) return []
    const list = group === "process" ? data.byProcess : group === "model" ? data.byModel : data.byUser
    const val = (r: Row): number | string =>
      sort.key === "label"
        ? nameOf(group, r.key, r.label)
        : sort.key === "tokens"
          ? r.inputTokens + r.outputTokens
          : r[sort.key]
    return [...list].sort((a, b) => {
      const x = val(a)
      const y = val(b)
      const c = typeof x === "string" ? x.localeCompare(String(y), "ru") : x - (y as number)
      return sort.dir === "asc" ? c : -c
    })
  }, [data, group, sort, nameOf])
  const paging = useTablePaging(rows)

  // Row click narrows the page to that entity.
  const drill = (r: Row) => {
    if (group === "process") setProcessKey(r.key)
    else if (group === "model") setModel(r.key)
    else setUserId(r.key)
  }

  const exportCsv = () => {
    const head = ["Название", "Вызовы", "Ошибки", "Токены вход", "Токены выход", "Стоимость USD", "Доля", "За вызов USD"]
    const lines = rows.map((r) =>
      [nameOf(group, r.key, r.label), r.calls, r.errors, r.inputTokens, r.outputTokens, r.cost.toFixed(6), r.share.toFixed(4), r.avgCost.toFixed(6)]
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

  const filtered = processKey !== ALL || model !== ALL || userId !== ALL || status !== ALL
  const s = data?.summary

  return (
    <div className="flex flex-col gap-3">
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

        <Select value={processKey} onValueChange={setProcessKey}>
          <SelectTrigger size="sm" className="w-56" aria-label="Функция">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Все функции</SelectItem>
            {(data?.options.processes ?? []).map((p) => (
              <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>
            ))}
            {processKey !== ALL && !processLabel.has(processKey) && (
              <SelectItem value={processKey}>{nameOf("process", processKey)}</SelectItem>
            )}
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

        <Select value={userId} onValueChange={setUserId}>
          <SelectTrigger size="sm" className="w-48" aria-label="Пользователь">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Все пользователи</SelectItem>
            {(data?.options.users ?? []).map((u) => (
              <SelectItem key={u.id} value={u.id}>{nameOf("user", u.id, u.name)}</SelectItem>
            ))}
            {userId !== ALL && !data?.options.users.some((u) => u.id === userId) && (
              <SelectItem value={userId}>{nameOf("user", userId)}</SelectItem>
            )}
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
            <SelectItem value="blocked">Остановлено лимитом</SelectItem>
          </SelectContent>
        </Select>

        {filtered && (
          <Button variant="ghost" size="sm" onClick={() => { setProcessKey(ALL); setModel(ALL); setUserId(ALL); setStatus(ALL) }}>
            Сбросить
          </Button>
        )}

        <div className="ml-auto flex items-center gap-2">
          {loading && <Loader className="h-4 w-4 animate-spin text-muted-foreground" />}
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={!rows.length}>
            <Download className="h-4 w-4" />
            CSV
          </Button>
        </div>
      </div>

      {data && <AiLimitNotice limits={data.limits} />}
      <AiMonthlyLimitCard monthly={data?.limits.monthly ?? null} />

      {error && <p className="text-sm text-red-500">Не удалось загрузить статистику: {error}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="Вызовы ИИ" value={s ? int(s.calls) : "—"} />
        <StatTile
          label="Токены"
          value={s ? compactTokens(s.inputTokens + s.outputTokens) : "—"}
          hint={s ? `вход ${compactTokens(s.inputTokens)} · выход ${compactTokens(s.outputTokens)}` : undefined}
        />
        <StatTile label="Стоимость" value={s ? usd(s.cost) : "—"} hint="USD" />
        <StatTile label="За вызов" value={s && s.calls ? usd(s.cost / s.calls, true) : "—"} hint="средняя стоимость, USD" />
        <StatTile
          label="Ошибки"
          value={s ? int(s.errors) : "—"}
          hint={s && s.calls ? `${pct(s.errors / s.calls)} вызовов` : undefined}
        />
      </div>
      {s && s.estimated > 0 && (
        <p className="text-xs text-muted-foreground">
          Стоимость {int(s.estimated)} вызовов предварительная — точная сумма появится в течение суток.
        </p>
      )}

      <ChartCard
        title={`Стоимость ${scale === "day" ? "по дням" : scale === "month" ? "по месяцам" : "по годам"}, USD`}
        description={`По ${stack === "process" ? "функциям" : stack === "model" ? "моделям" : "пользователям"}`}
        action={
          <Tabs value={stack} onValueChange={(v) => setStack(v as Group)}>
            <TabsList>
              {(Object.keys(GROUP_LABELS) as Group[]).map((g) => (
                <TabsTrigger key={g} value={g}>{GROUP_LABELS[g]}</TabsTrigger>
              ))}
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
            ? "Диапазон «с … по …» заменяет для графика только период страницы; фильтры функции, модели, пользователя и статуса действуют и на график."
            : "Диапазон графика = период страницы. Измените даты «с … по …», чтобы задать свой."}{" "}
          Дни — по UTC.
        </p>
      </ChartCard>

      <div className="flex items-center gap-3">
        <Tabs value={group} onValueChange={(v) => setGroup(v as Group)}>
          <TabsList>
            {(Object.keys(GROUP_LABELS) as Group[]).map((g) => (
              <TabsTrigger key={g} value={g}>{GROUP_LABELS[g]}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <span className="text-xs text-muted-foreground">Нажмите на строку, чтобы отфильтровать страницу</span>
      </div>
      <Card className="gap-0 py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <SortHead k="label" label={GROUP_HEAD[group]} />
              <SortHead k="calls" label="Вызовы" right />
              <SortHead k="errors" label="Ошибки" right />
              <SortHead k="tokens" label="Токены (вход / выход)" right />
              <SortHead k="cost" label="Стоимость" right />
              <TableHead className="text-right">Доля</TableHead>
              <SortHead k="avgCost" label="За вызов" right />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  {data ? "Нет вызовов ИИ за выбранный период" : <Loader className="mx-auto h-5 w-5 animate-spin" />}
                </TableCell>
              </TableRow>
            ) : (
              paging.pageRows.map((r) => (
                <TableRow key={r.key} className="cursor-pointer even:bg-muted/40" onClick={() => drill(r)}>
                  <TableCell>
                    <div className="font-medium">{nameOf(group, r.key, r.label)}</div>
                    {group === "process" && (
                      <div className="text-xs text-muted-foreground">
                        {data?.options.processes.find((p) => p.key === r.key)?.group ?? ""}
                      </div>
                    )}
                    {group === "user" && r.key === AI_USAGE_BACKGROUND_USER && (
                      <div className="text-xs text-muted-foreground">Разбор источников, темы и другие задачи без пользователя</div>
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
                  <TableCell className="text-right tabular-nums">{pct(r.share)}</TableCell>
                  <TableCell className="text-right tabular-nums">{usd(r.avgCost, true)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {rows.length > 0 && <TablePager {...paging.pagerProps} className="border-t px-3 py-2" />}
      </Card>
      <p className="text-xs text-muted-foreground">Суммы в долларах США.</p>
    </div>
  )
}

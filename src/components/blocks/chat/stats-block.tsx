"use client"

// Renders ONE `queryStats` result of the AI chat (docs/specs/ai-chat/
// 01-specification.md §8): header with the period + filter chips, the chart
// (the SAME chart code as the /analytics «ИИ ассистент» card —
// `AnalyticsAnswerChart`), a «График / Таблица» switch with a sortable table,
// and «Скачать CSV».
//
// Numbers go SQL → React unchanged; the model never re-types them. A scalar
// renders as a small tile (in the chat a number can still be worth a glance;
// the analytics card keeps its own "scalar = prose only" rule).

import { useMemo, useState } from "react"
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BarChart3,
  CalendarDays,
  Download,
  Table2,
} from "lucide-react"
import {
  AnalyticsAnswerChart,
  type ChartValueFormat,
} from "@/components/blocks/analytics/analytics-answer-card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  formatMoney,
  formatMoneyFull,
  formatNumber,
  formatPercent,
} from "@/lib/analytics-format"
import {
  STATS_VOCAB,
  statsCsv,
  statsValueText,
  type StatsChart,
  type StatsMeasureKind,
  type StatsResult,
  type StatsRow,
} from "@/lib/chat/stats"
import { cn } from "@/lib/utils"

/** A donut reads only with a few slices (spec §8). */
const DONUT_MAX_SLICES = 6

type View = "chart" | "table"
type Sort = { by: "label" | "value"; dir: "asc" | "desc" } | null

/** Chart formatters by measure kind: money / count as on /analytics, percent / days via `statsValueText`. */
export function statsChartFormat(kind: StatsMeasureKind): ChartValueFormat {
  if (kind === "money") return { fmt: formatMoney, fmtFull: formatMoneyFull }
  if (kind === "count") return { fmt: formatNumber, fmtFull: formatNumber }
  const text = (n: number) => statsValueText(n, kind)
  return { fmt: text, fmtFull: text }
}

/** Exact value for the table and the scalar tile. */
function cellText(value: number, kind: StatsMeasureKind): string {
  const text = statsValueText(value, kind)
  return kind === "money" && text ? `${text} ₽` : text
}

/** Sums of rows mean something only for money and counts (not for % or days). */
function isAdditive(kind: StatsMeasureKind): boolean {
  return kind === "money" || kind === "count"
}

/**
 * The chart form actually drawn: a donut only for ≤ 6 slices of an additive
 * measure, `table` → bar / line when the person switches to the chart.
 */
function chartForm(result: StatsResult): StatsChart {
  const { chart, measureKind } = result.meta
  const dims = STATS_VOCAB[result.subject]?.dimensions ?? {}
  const isTime = Boolean(result.query.dimension && dims[result.query.dimension]?.isTime)
  if (chart === "table") return isTime ? "line" : "bar"
  if (chart === "donut" && (result.rows.length > DONUT_MAX_SLICES || !isAdditive(measureKind))) {
    return "bar"
  }
  return chart
}

/** `deals-amount-2026-11-16.csv` — latin keys only, so the name is safe everywhere. */
export function statsCsvFileName(result: StatsResult, now = new Date()): string {
  const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase()
  const measure = result.query.measure ?? STATS_VOCAB[result.subject]?.defaultMeasure ?? ""
  const pad = (n: number) => String(n).padStart(2, "0")
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  return [slug(result.subject), slug(measure), day].filter(Boolean).join("-") + ".csv"
}

function downloadCsv(result: StatsResult) {
  const blob = new Blob([statsCsv(result)], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = statsCsvFileName(result)
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function StatsBlock({ result }: { result: StatsResult }) {
  const { rows, meta } = result
  const [view, setView] = useState<View>(meta.chart === "table" ? "table" : "chart")

  if (!rows.length) return <ScalarOrEmpty result={result} />

  const additive = isAdditive(meta.measureKind)
  const format = statsChartFormat(meta.measureKind)
  const drawn: StatsResult = { ...result, meta: { ...meta, chart: chartForm(result) } }

  return (
    <div className="bg-card mt-2 w-full min-w-0 overflow-hidden rounded-xl border">
      <Header result={result} showTotal={additive} />

      <div className="flex items-center justify-between gap-2 px-4 pt-2">
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={view}
          onValueChange={(v) => v && setView(v as View)}
          aria-label="Вид"
        >
          <ToggleGroupItem value="chart" className="h-7 gap-1 px-2 text-xs">
            <BarChart3 className="size-3.5" />
            График
          </ToggleGroupItem>
          <ToggleGroupItem value="table" className="h-7 gap-1 px-2 text-xs">
            <Table2 className="size-3.5" />
            Таблица
          </ToggleGroupItem>
        </ToggleGroup>
        <CsvButton result={result} />
      </div>

      {view === "chart" ? (
        <div className="px-1 pt-2 pb-2 sm:px-3">
          <AnalyticsAnswerChart result={drawn} fmt={format.fmt} fmtFull={format.fmtFull} />
        </div>
      ) : (
        <div className="pt-2">
          <StatsTable result={result} showShare={additive} />
        </div>
      )}

      {meta.truncated ? (
        <p className="text-muted-foreground px-4 pb-3 text-[11px]">
          Показаны только первые {meta.rowCount} — остальные значения меньше.
        </p>
      ) : null}
      <Warnings warnings={meta.warnings} />
    </div>
  )
}

// ── Header ───────────────────────────────────────────────────────────

function Header({ result, showTotal }: { result: StatsResult; showTotal: boolean }) {
  const { meta } = result
  return (
    <div className="px-4 pt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <div className="min-w-0 text-sm font-medium">
          {meta.measureLabel}
          {meta.dimensionLabel ? (
            <span className="text-muted-foreground font-normal">
              {" · "}
              {meta.dimensionLabel.toLowerCase()}
              {meta.splitLabel ? ` × ${meta.splitLabel.toLowerCase()}` : ""}
            </span>
          ) : null}
        </div>
        {showTotal ? (
          <div className="text-muted-foreground text-xs tabular-nums">
            Всего: {cellText(meta.total, meta.measureKind)}
          </div>
        ) : null}
      </div>
      <div className="text-muted-foreground mt-0.5 text-xs">{result.subjectLabel}</div>
      <Chips result={result} />
    </div>
  )
}

function Chips({ result }: { result: StatsResult }) {
  const { meta } = result
  if (!meta.periodLabel && !meta.applied.length) return null
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {meta.periodLabel ? (
        <Badge variant="secondary" className="max-w-full font-normal">
          <CalendarDays />
          <span className="truncate">{meta.periodLabel}</span>
        </Badge>
      ) : null}
      {meta.applied.map((f, i) => (
        <Badge key={`${f.label}-${i}`} variant="outline" className="max-w-full font-normal">
          <span className="text-muted-foreground">{f.label}:</span>
          <span className="truncate">{f.value}</span>
        </Badge>
      ))}
    </div>
  )
}

function CsvButton({ result, iconOnly }: { result: StatsResult; iconOnly?: boolean }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size={iconOnly ? "icon-xs" : "xs"}
      className="text-muted-foreground"
      onClick={() => downloadCsv(result)}
      aria-label="Скачать CSV"
      title="Скачать CSV"
    >
      <Download />
      {iconOnly ? null : "Скачать CSV"}
    </Button>
  )
}

function Warnings({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null
  return (
    <div className="text-muted-foreground flex items-start gap-1.5 px-4 pb-3 text-[11px]">
      <AlertTriangle className="mt-0.5 size-3 shrink-0 text-amber-600 dark:text-amber-400" />
      <span>{warnings.join(" ")}</span>
    </div>
  )
}

// ── Scalar / empty ───────────────────────────────────────────────────

function ScalarOrEmpty({ result }: { result: StatsResult }) {
  const { meta, scalar } = result
  if (scalar == null) {
    return (
      <div className="bg-card mt-2 w-full min-w-0 overflow-hidden rounded-xl border pb-1">
        <Header result={result} showTotal={false} />
        <p className="text-muted-foreground px-4 py-3 text-sm">Нет данных для этого запроса.</p>
        <Warnings warnings={meta.warnings} />
      </div>
    )
  }
  return (
    <div className="bg-card mt-2 w-full max-w-sm min-w-0 overflow-hidden rounded-xl border">
      <div className="flex items-start justify-between gap-2 px-4 pt-3">
        <div className="min-w-0">
          <div className="text-muted-foreground text-xs">{result.subjectLabel}</div>
          <div className="text-sm font-medium">{meta.measureLabel}</div>
        </div>
        <CsvButton result={result} iconOnly />
      </div>
      <div className="px-4 pt-1 text-2xl font-semibold tabular-nums">
        {cellText(scalar, meta.measureKind)}
      </div>
      <div className="px-4 pb-3">
        <Chips result={result} />
      </div>
      <Warnings warnings={meta.warnings} />
    </div>
  )
}

// ── Table ────────────────────────────────────────────────────────────

const collator = new Intl.Collator("ru", { numeric: true, sensitivity: "base" })

function sortRows(rows: StatsRow[], sort: Sort): StatsRow[] {
  if (!sort) return rows
  const sign = sort.dir === "asc" ? 1 : -1
  return [...rows].sort((a, b) => {
    const d =
      sort.by === "value"
        ? a.value - b.value
        : collator.compare(a.label, b.label) || collator.compare(a.splitLabel ?? "", b.splitLabel ?? "")
    return d * sign
  })
}

function StatsTable({ result, showShare }: { result: StatsResult; showShare: boolean }) {
  const { rows, meta } = result
  const [sort, setSort] = useState<Sort>(null)
  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort])
  const split = Boolean(meta.splitLabel)

  // First click: labels A→Я, values big → small; then flip; third click = original order.
  const toggle = (by: "label" | "value") =>
    setSort((s) => {
      const first = by === "label" ? "asc" : "desc"
      if (!s || s.by !== by) return { by, dir: first }
      if (s.dir === first) return { by, dir: first === "asc" ? "desc" : "asc" }
      return null
    })

  return (
    <div className="max-h-80 overflow-auto border-t">
      <Table>
        <TableHeader>
          <TableRow>
            <SortHead label={meta.dimensionLabel ?? "Значение"} by="label" sort={sort} onSort={toggle} />
            {split ? <TableHead className="text-xs">{meta.splitLabel}</TableHead> : null}
            <SortHead label={meta.measureLabel} by="value" sort={sort} onSort={toggle} right />
            {showShare ? <TableHead className="text-right text-xs">Доля</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((r, i) => (
            <TableRow key={`${r.key}-${r.splitKey ?? ""}-${i}`}>
              <TableCell className="max-w-64 truncate text-xs font-medium">{r.label}</TableCell>
              {split ? (
                <TableCell className="text-muted-foreground max-w-40 truncate text-xs">
                  {r.splitLabel}
                </TableCell>
              ) : null}
              <TableCell className="text-right text-xs tabular-nums">
                {cellText(r.value, meta.measureKind)}
              </TableCell>
              {showShare ? (
                <TableCell className="text-right text-xs tabular-nums">
                  {meta.total > 0 ? formatPercent(r.value / meta.total, 1) : "—"}
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function SortHead({
  label,
  by,
  sort,
  onSort,
  right,
}: {
  label: string
  by: "label" | "value"
  sort: Sort
  onSort: (by: "label" | "value") => void
  right?: boolean
}) {
  const active = sort?.by === by ? sort.dir : null
  const Icon = active === "asc" ? ArrowUp : active === "desc" ? ArrowDown : ArrowUpDown
  return (
    <TableHead
      className={cn("text-xs", right && "text-right")}
      aria-sort={active === "asc" ? "ascending" : active === "desc" ? "descending" : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(by)}
        className={cn(
          "hover:text-foreground inline-flex items-center gap-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          right && "flex-row-reverse",
        )}
      >
        <span>{label}</span>
        <Icon className={cn("size-3", active ? "text-foreground" : "text-muted-foreground/60")} />
      </button>
    </TableHead>
  )
}

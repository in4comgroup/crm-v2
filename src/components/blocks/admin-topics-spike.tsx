"use client"

// Topics extraction eval (plan phase 0 task 8 = model spike; phase 2 task 8 =
// eval) — platform admin. Runs topics.signal_extraction + the server
// post-processing over the org's golden set in small batches (POST
// /api/admin/topics/spike, resumable by runId) and shows the report:
// failures, latency, tokens / cost from the usage ledger, precision / recall
// / F1 per code on raw model codes and on the codes the engine keeps, real
// and synthetic items apart, and the quality-gate verdict. Finished runs
// store a report snapshot (topics_eval_run.metrics) that can be reopened.
// Second input: «Выборка последних сообщений» = offline batch for «review»
// codes (R6) over recent items outside the golden set — lists which
// review-only codes fired, with quotes and item ids.
// The model under test is the one assigned to «Извлечение сигналов» on
// «Процессы ИИ»; switch it there between runs to compare models.
// Below: «Оценка группировки по темам» (admin-topics-grouping.tsx) for the same org.

import { PagedTable } from "@/components/blocks/paged-table"
import { Fragment, useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { ChevronDown, ChevronRight, Copy, Loader, Play, RefreshCcw, Save, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
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
import { useGoldenOrgs } from "@/components/blocks/admin-topics-golden"
import { AdminTopicsGrouping } from "@/components/blocks/admin-topics-grouping"
import {
  SIGNAL_BAND_LABELS_RU,
  SIGNAL_DROP_REASONS,
  SIGNAL_NOT_COUNTED_REASONS,
  SIGNAL_SKIP_REASONS,
  type SignalBand,
} from "@/lib/signals/extraction-types"
import type {
  EvalBucket,
  EvalGate,
  EvalReport,
  PrStats,
  SampleReport,
  SpikeBatchResult,
  SpikeReport,
  SpikeRunRow,
} from "@/app/api/admin/topics/spike/route"

const VARIANT_LABEL: Record<string, string> = {
  single: "Один проход",
  two_pass: "Два прохода",
}
const CODESET_LABEL: Record<string, string> = {
  live: "Активные коды («on»)",
  review: "Активные + на проверке",
}
// Identity I4 «С профилем организации»: org profile in the extraction prompt.
const PROFILE_LABEL: Record<string, string> = {
  setting: "По настройке организации",
  on: "С профилем",
  off: "Без профиля",
}
const profileText = (v: boolean | null) => (v === true ? "с профилем" : v === false ? "без профиля" : "—")
const INPUT_LABEL: Record<string, string> = {
  golden: "Эталонный набор",
  sample: "Выборка последних сообщений",
}
const BUCKET_LABEL: Record<EvalBucket, string> = {
  all: "Все",
  real: "Реальные",
  synthetic: "Синтетические",
}
const VERDICT: Record<EvalGate["verdict"], { label: string; variant: "default" | "destructive" | "secondary" }> = {
  pass: { label: "Пройден", variant: "default" },
  fail: { label: "Не пройден", variant: "destructive" },
  insufficient_data: { label: "Мало данных", variant: "secondary" },
}
const GATE_STATUS: Record<string, string> = { pass: "да", fail: "нет", insufficient: "мало данных" }
const GATED_LABEL: Record<string, string> = {
  ...SIGNAL_SKIP_REASONS,
  gate: "Детерминированная проверка",
}
const SAMPLE_MAX = 100

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }) : "—"
const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(0)} %`)
const ms = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${(v / 1000).toFixed(1)} с`)
const usd = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `$${v.toFixed(4)}`)
const num = (v: number) => v.toLocaleString("ru-RU")
const labelOf = (map: Record<string, string>, k: string) => map[k] ?? k
const entries = (m: Record<string, number>) => Object.entries(m).sort((a, b) => b[1] - a[1])

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  )
}

function VerdictBadge({ verdict }: { verdict: EvalGate["verdict"] | null }) {
  if (!verdict) return <span className="text-muted-foreground">—</span>
  const v = VERDICT[verdict]
  return <Badge variant={v.variant}>{v.label}</Badge>
}

function ItemId({ id }: { id: string }) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 font-mono text-xs hover:underline"
      title={`${id} — скопировать`}
      onClick={() => {
        navigator.clipboard.writeText(id).then(
          () => toast.success("ID скопирован"),
          () => toast.error("Не удалось скопировать"),
        )
      }}
    >
      {id.slice(0, 8)}
      <Copy className="size-3 opacity-60" />
    </button>
  )
}

type ReportState = { report: EvalReport; stored: boolean; savedAt: string | null }

export function AdminTopicsSpike() {
  const { orgs } = useGoldenOrgs()
  const [orgId, setOrgId] = useState("")
  const [input, setInput] = useState<"golden" | "sample">("golden")
  const [variant, setVariant] = useState("single")
  const [codeSet, setCodeSet] = useState("live")
  const [profile, setProfile] = useState<"setting" | "on" | "off">("setting")
  const [sampleSize, setSampleSize] = useState("50")
  const [batch, setBatch] = useState("5")
  const [runs, setRuns] = useState<SpikeRunRow[]>([])
  const [runId, setRunId] = useState<string | null>(null)
  const [state, setState] = useState<ReportState | null>(null)
  const [loadingReport, setLoadingReport] = useState(false)
  const [saving, setSaving] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const stopRef = useRef(false)
  const [stopping, setStopping] = useState(false)

  useEffect(() => {
    if (!orgId && orgs.length > 0) {
      const withItems = orgs.find((o) => o.goldenItems > 0)
      setOrgId((withItems ?? orgs[0]).id)
    }
  }, [orgs, orgId])

  const loadRuns = useCallback(async (): Promise<SpikeRunRow[]> => {
    if (!orgId) return []
    try {
      const res = await fetch(`/api/admin/topics/spike?orgId=${encodeURIComponent(orgId)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Ошибка")
      setRuns(data.runs ?? [])
      return data.runs ?? []
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось загрузить прогоны")
      return []
    }
  }, [orgId])

  /** `stored` = the snapshot in topics_eval_run.metrics; else computed now. */
  const loadReport = useCallback(async (id: string, stored: boolean) => {
    setLoadingReport(true)
    try {
      const res = await fetch(
        `/api/admin/topics/spike?runId=${encodeURIComponent(id)}${stored ? "&stored=1" : ""}`,
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Ошибка")
      setState({ report: data.report, stored, savedAt: data.savedAt ?? null })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось загрузить отчёт")
    } finally {
      setLoadingReport(false)
    }
  }, [])

  const saveMetrics = async (id: string) => {
    setSaving(true)
    try {
      const res = await fetch("/api/admin/topics/spike", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", runId: id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Ошибка")
      setState({ report: data.report, stored: true, savedAt: new Date().toISOString() })
      toast.success("Метрики сохранены")
      await loadRuns()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить метрики")
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    setRunId(null)
    setState(null)
    loadRuns()
  }, [loadRuns])

  /** Loop batches until the run is done or stopped. `resumeId` continues a run. */
  const run = async (resumeId: string | null) => {
    if (!orgId) return
    stopRef.current = false
    setStopping(false)
    let currentId = resumeId
    let done = 0
    setProgress({ done: 0, total: 0 })
    try {
      while (!stopRef.current) {
        const res = await fetch("/api/admin/topics/spike", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orgId,
            runId: currentId,
            limit: Math.max(1, Math.min(10, Number(batch) || 5)),
            variant,
            codeSet: input === "sample" ? "review" : codeSet,
            input,
            sampleSize: Math.max(1, Math.min(SAMPLE_MAX, Number(sampleSize) || 50)),
            // Only a NEW run takes it; a resumed run keeps its stored value.
            ...(profile === "setting" ? {} : { promptContext: profile === "on" }),
          }),
        })
        const data = (await res.json()) as SpikeBatchResult & { error?: string }
        if (!res.ok) throw new Error(data.error ?? "Ошибка")
        if (!currentId) {
          currentId = data.runId
          setRunId(data.runId)
        }
        done += data.processed
        setProgress({ done, total: done + data.remaining })
        if (data.done || data.processed === 0) break
      }
      toast.success(stopRef.current ? "Прогон остановлен" : "Прогон завершён")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка прогона")
    } finally {
      setProgress(null)
      await loadRuns()
      if (currentId) {
        setRunId(currentId)
        await loadReport(currentId, false)
      }
    }
  }

  const running = progress !== null
  const selectedRun = runs.find((r) => r.runId === runId) ?? null

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2 rounded-xl border bg-card p-3">
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Организация</Label>
          <Select value={orgId} onValueChange={setOrgId} disabled={running}>
            <SelectTrigger size="sm" className="w-56">
              <SelectValue placeholder="Выберите организацию" />
            </SelectTrigger>
            <SelectContent>
              {orgs.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name} {o.goldenItems > 0 ? `(${o.goldenItems})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Вход</Label>
          <Select value={input} onValueChange={(v) => setInput(v === "sample" ? "sample" : "golden")} disabled={running}>
            <SelectTrigger size="sm" className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(INPUT_LABEL).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Вариант</Label>
          <Select value={variant} onValueChange={setVariant} disabled={running}>
            <SelectTrigger size="sm" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(VARIANT_LABEL).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Набор кодов</Label>
          <Select
            value={input === "sample" ? "review" : codeSet}
            onValueChange={setCodeSet}
            disabled={running || input === "sample"}
          >
            <SelectTrigger size="sm" className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(CODESET_LABEL).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {input === "sample" && (
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">Сообщений (≤ {SAMPLE_MAX})</Label>
            <Input
              className="h-8 w-20"
              type="number"
              min={1}
              max={SAMPLE_MAX}
              value={sampleSize}
              onChange={(e) => setSampleSize(e.target.value)}
              disabled={running}
            />
          </div>
        )}
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">С профилем организации</Label>
          <Select
            value={profile}
            onValueChange={(v) => setProfile(v === "on" ? "on" : v === "off" ? "off" : "setting")}
            disabled={running}
          >
            <SelectTrigger size="sm" className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(PROFILE_LABEL).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Пакет</Label>
          <Input
            className="h-8 w-16"
            type="number"
            min={1}
            max={10}
            value={batch}
            onChange={(e) => setBatch(e.target.value)}
            disabled={running}
          />
        </div>
        <Button size="sm" onClick={() => run(null)} disabled={!orgId || running}>
          <Play className="size-4" />
          Новый прогон
        </Button>
        {selectedRun && (
          <Button size="sm" variant="outline" onClick={() => run(selectedRun.runId)} disabled={running}>
            <Play className="size-4" />
            Продолжить выбранный
          </Button>
        )}
        {running && (
          <Button
            size="sm"
            variant="destructive"
            onClick={() => {
              stopRef.current = true
              setStopping(true)
            }}
          >
            <Square className="size-4" />
            Остановить
          </Button>
        )}
        <Button
          size="icon-sm"
          variant="ghost"
          className="ml-auto"
          onClick={loadRuns}
          disabled={running}
          aria-label="Обновить"
        >
          <RefreshCcw className="size-4" />
        </Button>
      </div>

      {running && (
        <div className="flex items-center gap-3 rounded-xl border bg-card p-3 text-sm">
          <Loader className="size-4 animate-spin" />
          <span>
            Обработано {progress.done}
            {progress.total ? ` из ${progress.total}` : ""}
            {stopping ? " · останавливается после текущего пакета" : ""}
          </span>
          <Progress
            className="flex-1"
            value={progress.total ? (progress.done / progress.total) * 100 : 0}
          />
        </div>
      )}

      <div className="text-xs text-muted-foreground">
        Модель берётся из «Процессы ИИ» → «Извлечение сигналов» в момент вызова. Для сравнения моделей
        переключите её там и запустите новый прогон. Выборка последних сообщений берёт разобранные сообщения
        вне эталонного набора и проверяет коды «на проверке» (без точности и полноты — оценивает человек).
        «С профилем организации» — блок «О нашей компании» и строка «Контрагент» в промпте извлечения на
        время прогона; сравните прогоны с профилем и без него перед включением «Профиль в промптах».
      </div>

      <Card className="py-0">
        <PagedTable rows={runs}>{(pageRows) => (
<Table>
          <TableHeader>
            <TableRow>
              <TableHead>Начат</TableHead>
              <TableHead>Вход</TableHead>
              <TableHead>Вариант</TableHead>
              <TableHead>Коды</TableHead>
              <TableHead>Профиль</TableHead>
              <TableHead>Модели</TableHead>
              <TableHead className="text-right">Элементы</TableHead>
              <TableHead className="text-right">Успешно</TableHead>
              <TableHead className="text-right">Ср. время</TableHead>
              <TableHead>Итог</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="py-6 text-center text-muted-foreground">
                  Прогонов ещё нет.
                </TableCell>
              </TableRow>
            )}
            {pageRows.map((r) => (
              <TableRow
                key={r.runId}
                className={`cursor-pointer even:bg-muted/40 ${r.runId === runId ? "bg-accent" : ""}`}
                onClick={() => {
                  setRunId(r.runId)
                  loadReport(r.runId, r.stored)
                }}
              >
                <TableCell className="whitespace-nowrap text-xs">{fmtDate(r.startedAt)}</TableCell>
                <TableCell className="text-xs">
                  {r.input === "sample" ? "Выборка" : "Эталон"}
                  {r.kind === "spike" && <span className="ml-1 text-muted-foreground">(спайк)</span>}
                </TableCell>
                <TableCell className="text-xs">{VARIANT_LABEL[r.variant ?? ""] ?? r.variant ?? "—"}</TableCell>
                <TableCell className="text-xs">{CODESET_LABEL[r.codeSet ?? ""] ?? r.codeSet ?? "—"}</TableCell>
                <TableCell className="text-xs">{profileText(r.promptContext)}</TableCell>
                <TableCell className="text-xs font-mono">{r.models.join(", ") || "—"}</TableCell>
                <TableCell className="text-right">
                  {r.items}
                  {r.planned !== null ? ` / ${r.planned}` : ""}
                </TableCell>
                <TableCell className="text-right">{r.ok}</TableCell>
                <TableCell className="text-right">{ms(r.avgDurationMs)}</TableCell>
                <TableCell className="text-xs whitespace-nowrap">
                  {r.input === "sample" ? (
                    r.finishedAt ? (
                      "готова"
                    ) : (
                      <span className="text-muted-foreground">не завершена</span>
                    )
                  ) : r.stored ? (
                    <span className="flex items-center gap-1">
                      <VerdictBadge verdict={r.verdict} />
                      {!r.finishedAt && <span className="text-muted-foreground">не завершён</span>}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">не сохранён</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
)}</PagedTable>
      </Card>

      {loadingReport && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader className="size-4 animate-spin" /> Загрузка отчёта…
        </div>
      )}
      {state && !loadingReport && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-2 text-xs">
            <span className="text-muted-foreground">
              {state.stored
                ? `Сохранённые метрики${state.savedAt ? ` от ${fmtDate(state.savedAt)}` : ""}`
                : "Метрики пересчитаны сейчас по результатам прогона и текущему эталонному набору"}
            </span>
            <div className="ml-auto flex gap-2">
              {state.stored ? (
                <Button size="xs" variant="outline" onClick={() => loadReport(state.report.runId, false)}>
                  <RefreshCcw className="size-3" />
                  Пересчитать
                </Button>
              ) : (
                selectedRun?.stored && (
                  <Button size="xs" variant="outline" onClick={() => loadReport(state.report.runId, true)}>
                    Сохранённые
                  </Button>
                )
              )}
              <Button size="xs" variant="outline" onClick={() => saveMetrics(state.report.runId)} disabled={saving || running}>
                {saving ? <Loader className="size-3 animate-spin" /> : <Save className="size-3" />}
                Сохранить метрики
              </Button>
            </div>
          </div>
          {state.report.input === "sample" ? (
            <SampleReportView report={state.report} />
          ) : (
            <SpikeReportView report={state.report} />
          )}
        </div>
      )}

      {/* Grouping eval (plan phase 3 exit gate): same org, no AI call. */}
      <div className="mt-2 flex flex-col gap-2 border-t pt-4">
        <h3 className="text-sm font-medium">Оценка группировки по темам</h3>
        <AdminTopicsGrouping orgId={orgId} />
      </div>
    </div>
  )
}

// ── Golden-set report ────────────────────────────────────────────────────

function PrRow({ label, s }: { label: string; s: PrStats }) {
  return (
    <TableRow className="even:bg-muted/40">
      <TableCell>{label}</TableCell>
      <TableCell className="text-right">{s.items}</TableCell>
      <TableCell className="text-right">{s.tp}</TableCell>
      <TableCell className="text-right">{s.fp}</TableCell>
      <TableCell className="text-right">{s.fn}</TableCell>
      <TableCell className="text-right font-medium">{pct(s.precision)}</TableCell>
      <TableCell className="text-right font-medium">{pct(s.recall)}</TableCell>
      <TableCell className="text-right">{pct(s.f1)}</TableCell>
    </TableRow>
  )
}

function GateCard({ gate }: { gate: EvalGate }) {
  const [showAll, setShowAll] = useState(false)
  const t = gate.thresholds
  const judged = gate.codes.filter((c) => c.status !== "insufficient")
  const shown = showAll ? gate.codes : judged
  return (
    <Card className="gap-2 p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Порог качества (реальные элементы, после обработки)</span>
        <VerdictBadge verdict={gate.verdict} />
        <span className="text-xs text-muted-foreground">
          точность ≥ {pct(t.precisionMin)} для кодов P6 / P8 (или без профиля с весом ≥ {t.minWeightNoProfile}),
          полнота ≥ {pct(t.recallMin)}; код с ожидаемыми случаями &lt; {t.minExpectedPerCode} не оценивается
        </span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span>
          Полнота: <b>{pct(gate.recall.value)}</b> ({GATE_STATUS[gate.recall.status]}, ожидаемых {gate.recall.expected})
        </span>
        <span>Реальных элементов: {gate.realItems}</span>
        <span>
          Коды P6 / P8: прошли {gate.counts.pass} · не прошли {gate.counts.fail} · мало данных {gate.counts.insufficient}
        </span>
      </div>
      {gate.reasons.length > 0 && (
        <ul className="list-disc pl-5 text-xs text-muted-foreground">
          {gate.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {gate.codes.length > 0 && (
        <>
          <PagedTable rows={shown}>{(pageRows) => (
<Table>
            <TableHeader>
              <TableRow>
                <TableHead>Код</TableHead>
                <TableHead>Название</TableHead>
                <TableHead>Профиль</TableHead>
                <TableHead className="text-right">Вес</TableHead>
                <TableHead className="text-right">Ожидался</TableHead>
                <TableHead className="text-right">TP</TableHead>
                <TableHead className="text-right">FP</TableHead>
                <TableHead className="text-right">Точность</TableHead>
                <TableHead>Прошёл</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="py-3 text-center text-xs text-muted-foreground">
                    Ни один код P6 / P8 не набрал {t.minExpectedPerCode} ожидаемых случаев.
                  </TableCell>
                </TableRow>
              )}
              {pageRows.map((c) => (
                <TableRow key={c.code} className="even:bg-muted/40">
                  <TableCell className="font-mono text-xs">{c.code}</TableCell>
                  <TableCell className="text-xs">{c.labelRu}</TableCell>
                  <TableCell className="text-xs">
                    {c.effectiveProfile ?? "—"}
                    {!c.profile && c.effectiveProfile && <span className="text-muted-foreground"> (по весу)</span>}
                  </TableCell>
                  <TableCell className="text-right">{c.weight ?? "—"}</TableCell>
                  <TableCell className="text-right">{c.expected}</TableCell>
                  <TableCell className="text-right">{c.tp}</TableCell>
                  <TableCell className="text-right">{c.fp}</TableCell>
                  <TableCell className="text-right font-medium">{pct(c.precision)}</TableCell>
                  <TableCell
                    className={`text-xs ${c.status === "fail" ? "text-destructive" : c.status === "insufficient" ? "text-muted-foreground" : ""}`}
                  >
                    {GATE_STATUS[c.status]}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
)}</PagedTable>
          {gate.counts.insufficient > 0 && (
            <Button size="xs" variant="ghost" className="self-start" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Скрыть коды с малым числом данных" : `Показать коды с малым числом данных (${gate.counts.insufficient})`}
            </Button>
          )}
        </>
      )}
    </Card>
  )
}

function SpikeReportView({ report: r }: { report: SpikeReport }) {
  const [bucket, setBucket] = useState<EvalBucket>("real")
  const notCounted = entries(r.post.notCounted)
  const dropped = entries(r.post.dropped)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Отчёт прогона</span>
        <Badge variant="outline">{r.kind === "spike" ? "Спайк (фаза 0)" : "Eval"}</Badge>
        <Badge variant="outline">{VARIANT_LABEL[r.variant] ?? r.variant}</Badge>
        <Badge variant="outline">{CODESET_LABEL[r.codeSet] ?? r.codeSet}</Badge>
        <Badge variant="outline">{r.promptContext ? "С профилем организации" : "Без профиля организации"}</Badge>
        {r.models.map((m) => (
          <Badge key={m} variant="secondary" className="font-mono">
            {m}
          </Badge>
        ))}
        <span className="text-muted-foreground">
          {fmtDate(r.startedAt)} — {fmtDate(r.lastAt)}
          {r.codeBlockChars !== null && ` · блок кодов ${num(r.codeBlockChars)} симв. (${r.codesInPrompt} кодов)`}
          {r.taxonomyVersions.length > 0 && ` · версия реестра ${r.taxonomyVersions.join(", ")}`}
          {r.items.remaining > 0 && ` · не обработано: ${r.items.remaining}`}
        </span>
      </div>

      <GateCard gate={r.gate} />

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
        <Tile
          label="Элементы"
          value={`${r.items.ok} / ${r.items.total}`}
          hint={`ошибок ${r.items.failed} · с ответом: реальн. ${r.items.judgedReal}, синт. ${r.items.judgedSynthetic}`}
        />
        <Tile
          label="Сбои структуры"
          value={pct(r.items.structuredFailureRate)}
          hint={`${r.items.structuredFailures} шт., прочих ${r.items.otherFailures}`}
        />
        <Tile label="Задержка p50" value={ms(r.latency.p50)} hint={`среднее ${ms(r.latency.mean)}`} />
        <Tile label="Задержка p95" value={ms(r.latency.p95)} hint={`макс ${ms(r.latency.max)}`} />
        <Tile
          label="Токены"
          value={num(r.usage.inputTokens + r.usage.outputTokens)}
          hint={`вход ${num(r.usage.inputTokens)} · выход ${num(r.usage.outputTokens)} · кэш ${num(r.usage.cacheReadTokens)}`}
        />
        <Tile label="Стоимость" value={usd(r.usage.costUsd)} hint={`на элемент ${usd(r.usage.costPerItemUsd)}`} />
        <Tile
          label="Точность (реальные, после обработки)"
          value={pct(r.overall.post.real.precision)}
          hint={`полнота ${pct(r.overall.post.real.recall)} · F1 ${pct(r.overall.post.real.f1)} · ${r.overall.post.real.items} эл.`}
        />
        <Tile
          label="Сигналы модели"
          value={num(r.signals.total)}
          hint={`low ${r.signals.lowConfidence} · без цитаты ${r.signals.evidenceNotFound} · чужие ${r.signals.unknownCodes}`}
        />
      </div>

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Итого (элементы с проверенным ответом)</TableHead>
              <TableHead className="text-right">Элементы</TableHead>
              <TableHead className="text-right">TP</TableHead>
              <TableHead className="text-right">FP</TableHead>
              <TableHead className="text-right">FN</TableHead>
              <TableHead className="text-right">Точность</TableHead>
              <TableHead className="text-right">Полнота</TableHead>
              <TableHead className="text-right">F1</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <PrRow label="После обработки · реальные" s={r.overall.post.real} />
            <PrRow label="После обработки · синтетические" s={r.overall.post.synthetic} />
            <PrRow label="После обработки · все" s={r.overall.post.all} />
            <PrRow label="Модель (сырые) · реальные" s={r.overall.raw.real} />
            <PrRow label="Модель (сырые) · синтетические" s={r.overall.raw.synthetic} />
            <PrRow label="Модель (сырые) · все" s={r.overall.raw.all} />
          </TableBody>
        </Table>
      </Card>

      <div className="rounded-xl border bg-card p-3 text-xs">
        <div className="mb-1 font-medium">
          Постобработка: {r.post.items} эл., экземпляров {r.post.instances}, учтено {r.post.counted}
          {r.post.items < r.items.ok && (
            <span className="font-normal text-muted-foreground">
              {" "}
              · у {r.items.ok - r.post.items} эл. нет постобработки (прогон до фазы 2)
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
          <span>
            Не учтены:{" "}
            {notCounted.length
              ? notCounted.map(([k, n]) => `${labelOf(SIGNAL_NOT_COUNTED_REASONS, k)} ${n}`).join(" · ")
              : "—"}
          </span>
          <span>
            Отброшены:{" "}
            {dropped.length ? dropped.map(([k, n]) => `${labelOf(SIGNAL_DROP_REASONS, k)} ${n}`).join(" · ") : "—"}
          </span>
          <span>
            Полосы:{" "}
            {entries(r.post.bands)
              .map(([k, n]) => `${SIGNAL_BAND_LABELS_RU[k as SignalBand] ?? k} ${n}`)
              .join(" · ") || "—"}
          </span>
        </div>
      </div>

      {r.usage.byProcessModel.length > 0 && (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Процесс</TableHead>
                <TableHead>Модель</TableHead>
                <TableHead className="text-right">Вызовы</TableHead>
                <TableHead className="text-right">Ошибки</TableHead>
                <TableHead className="text-right">Вход</TableHead>
                <TableHead className="text-right">Выход</TableHead>
                <TableHead className="text-right">Стоимость</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.usage.byProcessModel.map((u) => (
                <TableRow key={`${u.process}-${u.model}`} className="even:bg-muted/40">
                  <TableCell className="font-mono text-xs">{u.process}</TableCell>
                  <TableCell className="font-mono text-xs">{u.model}</TableCell>
                  <TableCell className="text-right">{u.calls}</TableCell>
                  <TableCell className="text-right">{u.errors}</TableCell>
                  <TableCell className="text-right">{num(u.inputTokens)}</TableCell>
                  <TableCell className="text-right">{num(u.outputTokens)}</TableCell>
                  <TableCell className="text-right">{usd(u.costUsd)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-1 text-xs">
        <span className="mr-1 text-muted-foreground">Коды по элементам:</span>
        {(Object.keys(BUCKET_LABEL) as EvalBucket[]).map((b) => (
          <Button key={b} size="xs" variant={bucket === b ? "secondary" : "ghost"} onClick={() => setBucket(b)}>
            {BUCKET_LABEL[b]}
          </Button>
        ))}
        <span className="ml-2 text-muted-foreground">* — код порога качества (P6 / P8)</span>
      </div>
      <Card className="py-0">
        <PagedTable rows={r.codes}>{(pageRows) => (
<Table>
          <TableHeader>
            <TableRow>
              <TableHead>Код</TableHead>
              <TableHead>Название</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead>Профиль</TableHead>
              <TableHead className="text-right">Вес</TableHead>
              <TableHead className="text-right" title="Модель вернула (high / medium), все элементы">
                Найден
              </TableHead>
              <TableHead className="text-right">low</TableHead>
              <TableHead className="text-right" title="Движок оставил (учтён или код состояния)">
                Оставлен
              </TableHead>
              <TableHead className="text-right">Ожидался</TableHead>
              <TableHead className="text-right" title="Точность / полнота по сырому ответу модели">
                Сырые Т / П
              </TableHead>
              <TableHead className="text-right">TP</TableHead>
              <TableHead className="text-right">FP</TableHead>
              <TableHead className="text-right">FN</TableHead>
              <TableHead className="text-right">Точность</TableHead>
              <TableHead className="text-right">Полнота</TableHead>
              <TableHead className="text-right">F1</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {r.codes.length === 0 && (
              <TableRow>
                <TableCell colSpan={16} className="py-6 text-center text-muted-foreground">
                  Коды не найдены.
                </TableCell>
              </TableRow>
            )}
            {pageRows.map((c) => {
              const s = c.stats[bucket]
              return (
                <TableRow key={c.code} className="even:bg-muted/40">
                  <TableCell className="font-mono text-xs">
                    {c.code}
                    {c.gateCode && "*"}
                  </TableCell>
                  <TableCell className="text-xs">{c.labelRu}</TableCell>
                  <TableCell className="text-xs">{c.status ?? "—"}</TableCell>
                  <TableCell className="text-xs">
                    {c.effectiveProfile ?? "—"}
                    {!c.profile && c.effectiveProfile && <span className="text-muted-foreground">˚</span>}
                  </TableCell>
                  <TableCell className="text-right">{c.weight ?? "—"}</TableCell>
                  <TableCell className="text-right">{c.found}</TableCell>
                  <TableCell className="text-right">{c.foundLow}</TableCell>
                  <TableCell className="text-right">{c.kept}</TableCell>
                  <TableCell className="text-right">{s.post.tp + s.post.fn || s.raw.tp + s.raw.fn}</TableCell>
                  <TableCell className="text-right whitespace-nowrap text-xs text-muted-foreground">
                    {pct(s.raw.precision)} / {pct(s.raw.recall)}
                  </TableCell>
                  <TableCell className="text-right">{s.post.tp}</TableCell>
                  <TableCell className="text-right">{s.post.fp}</TableCell>
                  <TableCell className="text-right">{s.post.fn}</TableCell>
                  <TableCell className="text-right font-medium">{pct(s.post.precision)}</TableCell>
                  <TableCell className="text-right font-medium">{pct(s.post.recall)}</TableCell>
                  <TableCell className="text-right">{pct(s.post.f1)}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
)}</PagedTable>
      </Card>
      <div className="text-xs text-muted-foreground">
        TP / FP / FN, точность, полнота и F1 — по кодам, которые движок оставил после обработки (низкая
        уверенность, перекрытые и отброшенные коды не считаются найденными). ˚ — профиль по весу (полоса §5.5).
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Самые медленные</TableHead>
                <TableHead className="text-right">Время</TableHead>
                <TableHead>Коды</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.slowest.map((s) => (
                <TableRow key={s.goldenItemId} className="even:bg-muted/40">
                  <TableCell className="font-mono text-xs">{s.goldenItemId.slice(0, 8)}</TableCell>
                  <TableCell className="text-right">{ms(s.durationMs)}</TableCell>
                  <TableCell className="text-xs">{s.ok ? s.codes.join(", ") || "—" : "ошибка"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
        <Card className="py-0">
          <PagedTable rows={r.failed}>{(pageRows) => (
<Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ошибки</TableHead>
                <TableHead>Тип</TableHead>
                <TableHead>Сообщение</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.failed.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="py-4 text-center text-muted-foreground">
                    Ошибок нет.
                  </TableCell>
                </TableRow>
              )}
              {pageRows.map((f) => (
                <TableRow key={f.goldenItemId} className="even:bg-muted/40">
                  <TableCell className="font-mono text-xs">{f.goldenItemId.slice(0, 8)}</TableCell>
                  <TableCell className="text-xs">
                    {f.errorKind === "structured_output" ? "структура" : "прочее"}
                  </TableCell>
                  <TableCell className="max-w-sm truncate text-xs">{f.error}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
)}</PagedTable>
        </Card>
      </div>

      {r.mismatches.length > 0 && (
        <Card className="py-0">
          <PagedTable rows={r.mismatches}>{(pageRows) => (
<Table>
            <TableHeader>
              <TableRow>
                <TableHead>Расхождения</TableHead>
                <TableHead>Ожидалось</TableHead>
                <TableHead>Модель</TableHead>
                <TableHead>Оставлено</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map((m) => (
                <TableRow key={m.goldenItemId} className="even:bg-muted/40">
                  <TableCell className="font-mono text-xs">
                    {m.goldenItemId.slice(0, 8)}
                    {m.synthetic && <span className="ml-1 text-muted-foreground">синт.</span>}
                  </TableCell>
                  <TableCell className="text-xs">{m.expected.join(", ") || "нет сигнала"}</TableCell>
                  <TableCell className="text-xs">{m.predicted.join(", ") || "нет сигнала"}</TableCell>
                  <TableCell className="text-xs">
                    {m.kept === null ? <span className="text-muted-foreground">—</span> : m.kept.join(", ") || "нет сигнала"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
)}</PagedTable>
        </Card>
      )}
    </div>
  )
}

// ── Review sample report (R6) ────────────────────────────────────────────

function SampleReportView({ report: r }: { report: SampleReport }) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const s = r.summary
  const toggle = (code: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  const gated = entries(s.gatedBy)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Выборка последних сообщений: коды «на проверке»</span>
        <Badge variant="outline">{VARIANT_LABEL[r.variant] ?? r.variant}</Badge>
        <Badge variant="outline">{r.promptContext ? "С профилем организации" : "Без профиля организации"}</Badge>
        {r.models.map((m) => (
          <Badge key={m} variant="secondary" className="font-mono">
            {m}
          </Badge>
        ))}
        <span className="text-muted-foreground">
          {fmtDate(r.startedAt)} — {fmtDate(r.lastAt)}
          {r.taxonomyVersions.length > 0 && ` · версия реестра ${r.taxonomyVersions.join(", ")}`}
          {r.remaining > 0 && ` · не обработано: ${r.remaining}`}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <Tile label="Сообщения" value={`${s.items.total} / ${r.planned}`} hint={`ошибок ${s.items.failed}`} />
        <Tile
          label="Отсеяно проверками"
          value={num(s.items.gated)}
          hint={gated.map(([k, n]) => `${labelOf(GATED_LABEL, k)} ${n}`).join(" · ") || "—"}
        />
        <Tile label="С сигналами" value={num(s.items.withSignals)} />
        <Tile label="Задержка p50" value={ms(r.latency.p50)} hint={`p95 ${ms(r.latency.p95)}`} />
        <Tile
          label="Токены"
          value={num(r.usage.inputTokens + r.usage.outputTokens)}
          hint={`вход ${num(r.usage.inputTokens)} · выход ${num(r.usage.outputTokens)}`}
        />
        <Tile label="Стоимость" value={usd(r.usage.costUsd)} hint={`на сообщение ${usd(r.usage.costPerItemUsd)}`} />
      </div>

      <Card className="py-0">
        <PagedTable rows={s.reviewCodes}>{(pageRows) => (
<Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-6" />
              <TableHead>Код «на проверке»</TableHead>
              <TableHead>Название</TableHead>
              <TableHead>Профиль</TableHead>
              <TableHead className="text-right">Вес</TableHead>
              <TableHead className="text-right" title="Сообщения, где модель вернула код">
                Сообщений
              </TableHead>
              <TableHead className="text-right" title="Учтён в оценке сообщения">
                Учтён
              </TableHead>
              <TableHead className="text-right">Только low</TableHead>
              <TableHead className="text-right" title="Отброшен постобработкой">
                Отброшен
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {s.reviewCodes.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="py-6 text-center text-muted-foreground">
                  Нет кодов «на проверке».
                </TableCell>
              </TableRow>
            )}
            {pageRows.map((c) => {
              const isOpen = open.has(c.code)
              return (
                <Fragment key={c.code}>
                  <TableRow
                    className={`even:bg-muted/40 ${c.examples.length ? "cursor-pointer" : ""}`}
                    onClick={() => c.examples.length && toggle(c.code)}
                  >
                    <TableCell>
                      {c.examples.length > 0 &&
                        (isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{c.code}</TableCell>
                    <TableCell className="text-xs">{c.labelRu}</TableCell>
                    <TableCell className="text-xs">{c.effectiveProfile ?? "—"}</TableCell>
                    <TableCell className="text-right">{c.weight ?? "—"}</TableCell>
                    <TableCell className="text-right font-medium">{c.items}</TableCell>
                    <TableCell className="text-right">{c.counted}</TableCell>
                    <TableCell className="text-right">{c.low}</TableCell>
                    <TableCell className="text-right">{c.dropped}</TableCell>
                  </TableRow>
                  {isOpen &&
                    c.examples.map((e, i) => (
                      <TableRow key={`${c.code}-${e.itemId}-${i}`} className="bg-muted/20">
                        <TableCell />
                        <TableCell>
                          <ItemId id={e.itemId} />
                        </TableCell>
                        <TableCell colSpan={5} className="text-xs">
                          <div className="text-muted-foreground">
                            {fmtDate(e.date)}
                            {e.subject ? ` · ${e.subject}` : ""}
                          </div>
                          <div className="whitespace-pre-wrap">«{e.evidence}»</div>
                        </TableCell>
                        <TableCell colSpan={2} className="text-xs">
                          {e.confidence}
                          {e.counted
                            ? " · учтён"
                            : e.notCountedReason
                              ? ` · ${labelOf(SIGNAL_NOT_COUNTED_REASONS, e.notCountedReason)}`
                              : ""}
                        </TableCell>
                      </TableRow>
                    ))}
                </Fragment>
              )
            })}
          </TableBody>
        </Table>
)}</PagedTable>
      </Card>

      {s.liveCodes.length > 0 && (
        <div className="rounded-xl border bg-card p-3 text-xs">
          <span className="font-medium">Активные коды в выборке: </span>
          <span className="text-muted-foreground">
            {s.liveCodes.map((c) => `${c.code} ${c.items}`).join(" · ")}
          </span>
        </div>
      )}

      {s.failed.length > 0 && (
        <Card className="py-0">
          <PagedTable rows={s.failed}>{(pageRows) => (
<Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ошибки</TableHead>
                <TableHead>Сообщение</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map((f) => (
                <TableRow key={f.itemId} className="even:bg-muted/40">
                  <TableCell>
                    <ItemId id={f.itemId} />
                  </TableCell>
                  <TableCell className="max-w-md truncate text-xs">{f.error}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
)}</PagedTable>
        </Card>
      )}
    </div>
  )
}

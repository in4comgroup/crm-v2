"use client"

// Topics model spike / eval runner (plan phase 0 task 8) — platform admin.
// Runs topics.signal_extraction over the org's golden set in small batches
// (POST /api/admin/topics/spike, resumable by runId) and shows the report:
// failures, latency, tokens / cost from the usage ledger, codes found and
// precision / recall against the reviewed `expected` answers.
// The model under test is the one assigned to «Извлечение сигналов» on
// «Процессы ИИ»; switch it there between runs to compare models.

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Loader, Play, RefreshCcw, Square } from "lucide-react"
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
import type {
  PrStats,
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

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })
const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(0)} %`)
const ms = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${(v / 1000).toFixed(1)} с`)
const usd = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `$${v.toFixed(4)}`)
const num = (v: number) => v.toLocaleString("ru-RU")

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  )
}

export function AdminTopicsSpike() {
  const { orgs } = useGoldenOrgs()
  const [orgId, setOrgId] = useState("")
  const [variant, setVariant] = useState("single")
  const [codeSet, setCodeSet] = useState("live")
  const [batch, setBatch] = useState("5")
  const [runs, setRuns] = useState<SpikeRunRow[]>([])
  const [runId, setRunId] = useState<string | null>(null)
  const [report, setReport] = useState<SpikeReport | null>(null)
  const [loadingReport, setLoadingReport] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const stopRef = useRef(false)
  const [stopping, setStopping] = useState(false)

  useEffect(() => {
    if (!orgId && orgs.length > 0) {
      const withItems = orgs.find((o) => o.goldenItems > 0)
      setOrgId((withItems ?? orgs[0]).id)
    }
  }, [orgs, orgId])

  const loadRuns = useCallback(async () => {
    if (!orgId) return
    try {
      const res = await fetch(`/api/admin/topics/spike?orgId=${encodeURIComponent(orgId)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Ошибка")
      setRuns(data.runs ?? [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось загрузить прогоны")
    }
  }, [orgId])

  const loadReport = useCallback(async (id: string) => {
    setLoadingReport(true)
    try {
      const res = await fetch(`/api/admin/topics/spike?runId=${encodeURIComponent(id)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Ошибка")
      setReport(data.report)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось загрузить отчёт")
    } finally {
      setLoadingReport(false)
    }
  }, [])

  useEffect(() => {
    setRunId(null)
    setReport(null)
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
            codeSet,
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
        await loadReport(currentId)
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
          <Select value={codeSet} onValueChange={setCodeSet} disabled={running}>
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
        {selectedRun && selectedRun.items > 0 && (
          <Button size="sm" variant="outline" onClick={() => run(selectedRun.runId)} disabled={running}>
            <Play className="size-4" />
            Продолжить выбранный
          </Button>
        )}
        {running && (
          <Button size="sm" variant="destructive" onClick={() => {
              stopRef.current = true
              setStopping(true)
            }}>
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
        переключите её там и запустите новый прогон.
      </div>

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Начат</TableHead>
              <TableHead>Вариант</TableHead>
              <TableHead>Коды</TableHead>
              <TableHead>Модели</TableHead>
              <TableHead className="text-right">Элементы</TableHead>
              <TableHead className="text-right">Успешно</TableHead>
              <TableHead className="text-right">Ср. время</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                  Прогонов ещё нет.
                </TableCell>
              </TableRow>
            )}
            {runs.map((r) => (
              <TableRow
                key={r.runId}
                className={`cursor-pointer even:bg-muted/40 ${r.runId === runId ? "bg-accent" : ""}`}
                onClick={() => {
                  setRunId(r.runId)
                  loadReport(r.runId)
                }}
              >
                <TableCell className="whitespace-nowrap text-xs">{fmtDate(r.startedAt)}</TableCell>
                <TableCell className="text-xs">{VARIANT_LABEL[r.variant ?? ""] ?? r.variant ?? "—"}</TableCell>
                <TableCell className="text-xs">{CODESET_LABEL[r.codeSet ?? ""] ?? r.codeSet ?? "—"}</TableCell>
                <TableCell className="text-xs font-mono">{r.models.join(", ") || "—"}</TableCell>
                <TableCell className="text-right">{r.items}</TableCell>
                <TableCell className="text-right">{r.ok}</TableCell>
                <TableCell className="text-right">{ms(r.avgDurationMs)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {loadingReport && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader className="size-4 animate-spin" /> Загрузка отчёта…
        </div>
      )}
      {report && !loadingReport && <SpikeReportView report={report} />}
    </div>
  )
}

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
    </TableRow>
  )
}

function SpikeReportView({ report: r }: { report: SpikeReport }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Отчёт прогона</span>
        <Badge variant="outline">{VARIANT_LABEL[r.variant] ?? r.variant}</Badge>
        <Badge variant="outline">{CODESET_LABEL[r.codeSet] ?? r.codeSet}</Badge>
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

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
        <Tile label="Элементы" value={`${r.items.ok} / ${r.items.total}`} hint={`ошибок ${r.items.failed}`} />
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
          label="Точность (реальные)"
          value={pct(r.overall.real.precision)}
          hint={`полнота ${pct(r.overall.real.recall)} · ${r.overall.real.items} эл.`}
        />
        <Tile
          label="Сигналы"
          value={num(r.signals.total)}
          hint={`low ${r.signals.lowConfidence} · без цитаты ${r.signals.evidenceNotFound} · чужие ${r.signals.unknownCodes}`}
        />
      </div>

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Итого (по элементам с ожидаемым ответом)</TableHead>
              <TableHead className="text-right">Элементы</TableHead>
              <TableHead className="text-right">TP</TableHead>
              <TableHead className="text-right">FP</TableHead>
              <TableHead className="text-right">FN</TableHead>
              <TableHead className="text-right">Точность</TableHead>
              <TableHead className="text-right">Полнота</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <PrRow label="Все" s={r.overall.all} />
            <PrRow label="Реальные" s={r.overall.real} />
            <PrRow label="Синтетические" s={r.overall.synthetic} />
          </TableBody>
        </Table>
      </Card>

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

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Код</TableHead>
              <TableHead>Название</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead className="text-right">Найден</TableHead>
              <TableHead className="text-right">low</TableHead>
              <TableHead className="text-right">Ожидался</TableHead>
              <TableHead className="text-right">TP</TableHead>
              <TableHead className="text-right">FP</TableHead>
              <TableHead className="text-right">FN</TableHead>
              <TableHead className="text-right">Точность</TableHead>
              <TableHead className="text-right">Полнота</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {r.codes.length === 0 && (
              <TableRow>
                <TableCell colSpan={11} className="py-6 text-center text-muted-foreground">
                  Коды не найдены.
                </TableCell>
              </TableRow>
            )}
            {r.codes.map((c) => (
              <TableRow key={c.code} className="even:bg-muted/40">
                <TableCell className="font-mono text-xs">{c.code}</TableCell>
                <TableCell className="text-xs">{c.labelRu}</TableCell>
                <TableCell className="text-xs">{c.status ?? "—"}</TableCell>
                <TableCell className="text-right">{c.found}</TableCell>
                <TableCell className="text-right">{c.foundLow}</TableCell>
                <TableCell className="text-right">{c.expected}</TableCell>
                <TableCell className="text-right">{c.tp}</TableCell>
                <TableCell className="text-right">{c.fp}</TableCell>
                <TableCell className="text-right">{c.fn}</TableCell>
                <TableCell className="text-right">{pct(c.precision)}</TableCell>
                <TableCell className="text-right">{pct(c.recall)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

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
              {r.failed.map((f) => (
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
        </Card>
      </div>

      {r.mismatches.length > 0 && (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Расхождения</TableHead>
                <TableHead>Ожидалось</TableHead>
                <TableHead>Найдено</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.mismatches.map((m) => (
                <TableRow key={m.goldenItemId} className="even:bg-muted/40">
                  <TableCell className="font-mono text-xs">
                    {m.goldenItemId.slice(0, 8)}
                    {m.synthetic && <span className="ml-1 text-muted-foreground">синт.</span>}
                  </TableCell>
                  <TableCell className="text-xs">{m.expected.join(", ") || "нет сигнала"}</TableCell>
                  <TableCell className="text-xs">{m.predicted.join(", ") || "нет сигнала"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  )
}

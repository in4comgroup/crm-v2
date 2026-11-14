"use client"

// «Оценка группировки по темам» (plan phase 3 exit gate, spec 01 §12) —
// platform admin, part of the eval block. Deterministic, no AI call:
// reviewed REAL golden items with «Темы сообщения» vs the topics the engine
// linked them to (`topic_item`, merged topics → their target). Pairwise
// precision / recall, gate ≥ 0.9 / ≥ 0.8, details «Разбитые темы» /
// «Склеенные темы» / items with a group but no engine topic. Every run is
// stored (`topics_eval_run.kind = "grouping"`). API: /api/admin/topics/grouping.

import { PagedTable } from "@/components/blocks/paged-table"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Loader, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { GroupingRunReport, GroupingRunRow } from "@/app/api/admin/topics/grouping/route"

const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(0)} %`)
const fmtDate = (iso: string) => new Date(iso).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })

const VERDICT: Record<string, { label: string; variant: "default" | "destructive" | "secondary" }> = {
  pass: { label: "Порог пройден", variant: "default" },
  fail: { label: "Порог не пройден", variant: "destructive" },
  insufficient: { label: "Мало данных", variant: "secondary" },
}

const TOPIC_STATUS_LABEL: Record<string, string> = {
  done: "обработано",
  log_only: "только запись в журнал",
  ignored: "без значимых сигналов",
  deferred: "отложено",
  failed: "ошибка",
}

export function AdminTopicsGrouping({ orgId }: { orgId: string }) {
  const [runs, setRuns] = useState<GroupingRunRow[]>([])
  const [report, setReport] = useState<GroupingRunReport | null>(null)
  const [openRun, setOpenRun] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  const loadRuns = useCallback(async () => {
    if (!orgId) return
    try {
      const res = await fetch(`/api/admin/topics/grouping?orgId=${encodeURIComponent(orgId)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Ошибка")
      setRuns(data.runs ?? [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось загрузить прогоны")
    }
  }, [orgId])

  useEffect(() => {
    setReport(null)
    setOpenRun(null)
    loadRuns()
  }, [loadRuns])

  const run = async () => {
    setRunning(true)
    try {
      const res = await fetch("/api/admin/topics/grouping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Ошибка")
      setReport(data.report)
      setOpenRun(data.runId)
      await loadRuns()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось посчитать")
    } finally {
      setRunning(false)
    }
  }

  const open = async (runId: string) => {
    try {
      const res = await fetch(`/api/admin/topics/grouping?runId=${encodeURIComponent(runId)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Ошибка")
      setReport(data.report)
      setOpenRun(runId)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось открыть прогон")
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3">
        <Button size="sm" onClick={run} disabled={!orgId || running}>
          {running ? <Loader className="size-4 animate-spin" /> : <Play className="size-4" />}
          Посчитать
        </Button>
        <span className="text-xs text-muted-foreground">
          Проверенные реальные сообщения с полем «Темы сообщения» против тем движка. Пары сообщений:
          «в одной теме по эталону» и «в одной теме у движка». Синтетика не участвует — движок её не
          обрабатывает. Без вызовов ИИ.
        </span>
      </div>

      {runs.length > 0 && (
        <Card className="py-0">
          <PagedTable rows={runs}>{(pageRows) => (
<Table>
            <TableHeader>
              <TableRow>
                <TableHead>Прогон</TableHead>
                <TableHead className="text-right">Сообщений</TableHead>
                <TableHead className="text-right">Пар «одна тема»</TableHead>
                <TableHead className="text-right">Точность</TableHead>
                <TableHead className="text-right">Полнота</TableHead>
                <TableHead>Итог</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map((r) => (
                <TableRow
                  key={r.runId}
                  className={`cursor-pointer even:bg-muted/40 ${openRun === r.runId ? "bg-accent" : ""}`}
                  onClick={() => open(r.runId)}
                >
                  <TableCell className="text-xs">{fmtDate(r.createdAt)}</TableCell>
                  <TableCell className="text-right">{r.items}</TableCell>
                  <TableCell className="text-right">{r.expectedSame}</TableCell>
                  <TableCell className="text-right">{pct(r.precision)}</TableCell>
                  <TableCell className="text-right">{pct(r.recall)}</TableCell>
                  <TableCell>
                    {r.verdict ? <Badge variant={VERDICT[r.verdict].variant}>{VERDICT[r.verdict].label}</Badge> : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
)}</PagedTable>
        </Card>
      )}

      {report && <GroupingReportView report={report} />}
    </div>
  )
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  )
}

function GroupingReportView({ report: r }: { report: GroupingRunReport }) {
  const t = r.thresholds
  const v = VERDICT[r.verdict]
  return (
    <div className="flex flex-col gap-3">
      <Card className="gap-2 p-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">Порог группировки</span>
          <Badge variant={v.variant}>{v.label}</Badge>
          <span className="text-xs text-muted-foreground">
            точность ≥ {pct(t.precisionMin)}, полнота ≥ {pct(t.recallMin)}; меньше {t.minExpectedPairs} пар «одна
            тема по эталону» = мало данных · посчитано {fmtDate(r.computedAt)}
          </span>
        </div>
        <div className="text-xs text-muted-foreground">
          В оценке: {r.stats.included} сообщ. Не вошли: проверенные без поля «Темы сообщения» —{" "}
          {r.stats.reviewedWithoutField}, проверенная синтетика — {r.stats.syntheticReviewed}.
        </div>
      </Card>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-6">
        <Tile label="Точность" value={pct(r.precision)} hint={`${r.pairs.both} из ${r.pairs.predictedSame} пар движка`} />
        <Tile label="Полнота" value={pct(r.recall)} hint={`${r.pairs.both} из ${r.pairs.expectedSame} пар эталона`} />
        <Tile label="Сообщений" value={String(r.items)} hint={`с темой по эталону ${r.itemsWithGroups}, у движка ${r.itemsWithTopic}`} />
        <Tile label="Тем по эталону / движка" value={`${r.groups} / ${r.topics}`} />
        <Tile label="Доля разбитых тем" value={pct(r.overSplitRate)} />
        <Tile label="Доля склеенных тем" value={pct(r.overMergeRate)} />
      </div>
      {r.itemsNoGroupWithTopic > 0 && (
        <div className="text-xs text-muted-foreground">
          Сообщений без темы по эталону, но с темой у движка: {r.itemsNoGroupWithTopic}.
        </div>
      )}

      <DetailCard title={`Разбитые темы (${r.split.length})`} empty="Нет: каждая тема эталона — в одной теме движка.">
        {r.split.map((s) => (
          <div key={s.group} className="border-b py-2 text-sm last:border-b-0">
            <div className="font-medium">
              {s.group}{" "}
              <span className="text-xs font-normal text-muted-foreground">
                · {s.items} сообщ.{s.itemsWithoutTopic ? `, без темы движка ${s.itemsWithoutTopic}` : ""}
              </span>
            </div>
            <ul className="ml-4 list-disc text-xs text-muted-foreground">
              {s.topics.map((tp) => (
                <li key={tp.id}>
                  {tp.title} — {tp.items} сообщ.
                </li>
              ))}
            </ul>
          </div>
        ))}
      </DetailCard>

      <DetailCard title={`Склеенные темы (${r.merged.length})`} empty="Нет: каждая тема движка — об одном вопросе эталона.">
        {r.merged.map((m) => (
          <div key={m.topicId} className="border-b py-2 text-sm last:border-b-0">
            <div className="font-medium">
              {m.title}{" "}
              <span className="text-xs font-normal text-muted-foreground">
                · {m.items} сообщ.{m.itemsWithoutGroup ? `, без темы по эталону ${m.itemsWithoutGroup}` : ""}
              </span>
            </div>
            <ul className="ml-4 list-disc text-xs text-muted-foreground">
              {m.groups.map((g) => (
                <li key={g.group}>
                  {g.group} — {g.items} сообщ.
                </li>
              ))}
            </ul>
          </div>
        ))}
      </DetailCard>

      <DetailCard
        title={`Есть тема по эталону, нет темы у движка (${r.missing.length})`}
        empty="Нет."
      >
        {r.missing.map((m) => (
          <div key={m.goldenItemId} className="border-b py-2 text-xs last:border-b-0">
            <div className="text-sm">{m.preview ?? m.sourceItemId}</div>
            <div className="text-muted-foreground">
              Темы по эталону: {m.groups.join("; ")} · движок:{" "}
              {m.topicStatus ? (TOPIC_STATUS_LABEL[m.topicStatus] ?? m.topicStatus) : "ещё не обработано"}
              {m.topicReason ? ` (${m.topicReason})` : ""} · <span className="font-mono">{m.sourceItemId}</span>
            </div>
          </div>
        ))}
      </DetailCard>
    </div>
  )
}

function DetailCard({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <Card className="gap-1 p-3">
      <div className="text-sm font-medium">{title}</div>
      {children.length === 0 ? <div className="text-xs text-muted-foreground">{empty}</div> : children}
    </Card>
  )
}

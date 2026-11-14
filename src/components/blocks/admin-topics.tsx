"use client"

// «Темы» (Topics) tab on /settings — platform admin only.
// Spec: docs/specs/topics/01-specification.md §12–§13, plan phase 0 tasks
// 3 and 6. Data: /api/admin/topics (mode per org) and
// /api/admin/topics/runs (run log + «Запустить сейчас»).

import { Fragment, useCallback, useEffect, useState } from "react"
import { ChevronDown, ChevronRight, Loader, Play, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
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
import { formatDateTime } from "@/components/blocks/admin-ai-models"
import { AdminTopicsDelivery } from "@/components/blocks/admin-topics-delivery"
import { AdminTopicsGolden } from "@/components/blocks/admin-topics-golden"
import { AdminTopicsSignals } from "@/components/blocks/admin-topics-signals"
import { AdminTopicsSpike } from "@/components/blocks/admin-topics-spike"
import { AdminTopicsTopics } from "@/components/blocks/admin-topics-topics"
import type {
  AdminTopicsModeUpdateResponse,
  AdminTopicsOrgsResponse,
} from "@/app/api/admin/topics/route"
import type {
  AdminTopicsRunNowResponse,
  AdminTopicsRunsResponse,
} from "@/app/api/admin/topics/runs/route"

type Mode = "off" | "shadow" | "on"
type OrgRow = AdminTopicsOrgsResponse["orgs"][number]
type RunRow = AdminTopicsRunsResponse["runs"][number]
type OrgOutcome = RunRow["orgs"][number]

const MODE_LABEL: Record<Mode, string> = {
  off: "Выключено",
  shadow: "Тень",
  on: "Включено",
}

const MODE_HINT: Record<Mode, string> = {
  off: "движок не работает",
  shadow: "движок работает, пользователи ничего не видят",
  on: "темы видны организации",
}

const PHASE_LABEL: Record<string, string> = {
  intake: "Загрузка и разбор",
  signals: "Сигналы",
  topics: "Темы",
  attention: "Внимание",
  cards: "Карточки",
  deals: "Сделки",
  dealState: "Состояние сделок",
  delivery: "Рассылка",
}

const PHASE_ORDER = ["intake", "signals", "topics", "attention", "cards", "deals", "dealState", "delivery"]

const TRIGGER_LABEL: Record<string, string> = { cron: "По расписанию", manual: "Вручную" }

const SKIP_REASON_LABEL: Record<string, string> = { "not built yet": "ещё не реализовано" }

function modeLabel(m: Mode | null | undefined): string {
  return m ? MODE_LABEL[m] : "—"
}

function formatDuration(startedAt: string | Date, finishedAt: string | Date | null): string {
  if (!finishedAt) return "—"
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime()
  if (ms < 1000) return `${ms} мс`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} с`
  return `${Math.floor(s / 60)} мин ${s % 60} с`
}

function StatusBadge({ status }: { status: RunRow["status"] }) {
  if (status === "running") {
    return (
      <Badge variant="secondary" className="gap-1 font-normal">
        <Loader className="h-3 w-3 animate-spin" /> идёт
      </Badge>
    )
  }
  if (status === "success") {
    return (
      <Badge variant="outline" className="border-emerald-300 font-normal text-emerald-700 dark:text-emerald-400">
        успешно
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="border-red-300 font-normal text-red-600 dark:text-red-400">
      с ошибками
    </Badge>
  )
}

function PhaseOutcome({ value }: { value: unknown }) {
  if (value === undefined) return <span className="text-muted-foreground">—</span>
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>
    if (typeof v.error === "string") {
      return <span className="text-red-600 dark:text-red-400">ошибка: {v.error}</span>
    }
    if (typeof v.skipped === "string") {
      return (
        <span className="text-muted-foreground">
          пропущено ({SKIP_REASON_LABEL[v.skipped] ?? v.skipped})
        </span>
      )
    }
    const parts = Object.entries(v).map(([k, n]) => `${k}: ${String(n)}`)
    return <span>{parts.length ? parts.join(", ") : "—"}</span>
  }
  return <span>{String(value)}</span>
}

function OrgOutcomeBlock({ org }: { org: OrgOutcome }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{org.orgName}</span>
        <Badge variant="outline" className="font-normal">
          {modeLabel(org.mode)}
        </Badge>
        <span className="text-xs text-muted-foreground">{org.durationMs} мс</span>
      </div>
      {org.error && (
        <div className="mt-1 text-sm text-red-600 dark:text-red-400">Ошибка: {org.error}</div>
      )}
      <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {PHASE_ORDER.map((p) => (
          <div key={p} className="flex gap-2">
            <span className="w-36 shrink-0 text-muted-foreground">{PHASE_LABEL[p]}</span>
            <PhaseOutcome value={(org.phases as Record<string, unknown>)[p]} />
          </div>
        ))}
      </div>
    </div>
  )
}

export function AdminTopics() {
  const [orgs, setOrgs] = useState<OrgRow[] | null>(null)
  const [orgsError, setOrgsError] = useState<string | null>(null)
  const [savingOrgId, setSavingOrgId] = useState<string | null>(null)

  const [runs, setRuns] = useState<RunRow[] | null>(null)
  const [runsError, setRunsError] = useState<string | null>(null)
  const [runsLoading, setRunsLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const loadOrgs = useCallback(async () => {
    setOrgsError(null)
    try {
      const res = await fetch("/api/admin/topics")
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      setOrgs((data as AdminTopicsOrgsResponse).orgs)
    } catch (e) {
      setOrgsError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const loadRuns = useCallback(async () => {
    setRunsError(null)
    setRunsLoading(true)
    try {
      const res = await fetch("/api/admin/topics/runs?limit=20")
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      setRuns((data as AdminTopicsRunsResponse).runs)
    } catch (e) {
      setRunsError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadOrgs()
    void loadRuns()
  }, [loadOrgs, loadRuns])

  const saveMode = async (org: OrgRow, mode: Mode) => {
    if (mode === org.mode) return
    setSavingOrgId(org.organizationId)
    try {
      const res = await fetch("/api/admin/topics", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: org.organizationId, mode }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      const saved = data as AdminTopicsModeUpdateResponse
      setOrgs((prev) =>
        prev?.map((o) =>
          o.organizationId === saved.organizationId
            ? { ...o, mode: saved.mode, lastChange: saved.lastChange }
            : o,
        ) ?? prev,
      )
      toast.success(`«${org.name}»: режим «${MODE_LABEL[saved.mode]}»`)
    } catch (e) {
      toast.error(`Не удалось сохранить режим: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSavingOrgId(null)
    }
  }

  const runNow = async () => {
    setRunning(true)
    try {
      const res = await fetch("/api/admin/topics/runs", { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      const r = data as AdminTopicsRunNowResponse
      if (r.status === "skipped") {
        toast.info("Другой запуск ещё идёт — новый не начат")
      } else if (r.status === "success") {
        toast.success(`Запуск завершён: организаций ${r.orgsProcessed}`)
        if (r.topicsRunId) setExpanded((prev) => new Set(prev).add(r.topicsRunId as string))
      } else {
        toast.warning(`Запуск завершён с ошибками: ${r.errors.length}`)
        if (r.topicsRunId) setExpanded((prev) => new Set(prev).add(r.topicsRunId as string))
      }
    } catch (e) {
      toast.error(`Запуск не удался: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setRunning(false)
      void loadRuns()
    }
  }

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="flex flex-col gap-6">
      {/* ── Mode per organization ─────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-base font-medium">Режим тем по организациям</h2>
          <p className="text-sm text-muted-foreground">
            Выключено — движок не работает. Тень — движок обрабатывает данные каждый час, но
            пользователи их не видят. Включено — темы видны организации.
          </p>
        </div>
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Организация</TableHead>
                <TableHead className="w-48">Режим</TableHead>
                <TableHead>Последнее изменение</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orgsError ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-10 text-center text-red-500">
                    Не удалось загрузить организации: {orgsError}
                  </TableCell>
                </TableRow>
              ) : !orgs ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-10 text-center">
                    <Loader className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : orgs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-10 text-center text-muted-foreground">
                    Организаций нет.
                  </TableCell>
                </TableRow>
              ) : (
                orgs.map((o) => (
                  <TableRow key={o.organizationId} className="even:bg-muted/40">
                    <TableCell>
                      <div className="font-medium">{o.name}</div>
                      {o.slug && <div className="text-xs text-muted-foreground">{o.slug}</div>}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Select
                          value={o.mode}
                          onValueChange={(v) => void saveMode(o, v as Mode)}
                          disabled={savingOrgId === o.organizationId}
                        >
                          <SelectTrigger size="sm" className="w-36" aria-label={`Режим тем: ${o.name}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
                              <SelectItem key={m} value={m}>
                                {MODE_LABEL[m]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {savingOrgId === o.organizationId && (
                          <Loader className="h-4 w-4 animate-spin text-muted-foreground" />
                        )}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">{MODE_HINT[o.mode]}</div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {o.lastChange ? (
                        <>
                          <div>
                            {modeLabel(o.lastChange.from ?? "off")} → {modeLabel(o.lastChange.to)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {o.lastChange.by ?? "—"} · {formatDateTime(o.lastChange.at)}
                          </div>
                        </>
                      ) : (
                        <span className="text-muted-foreground">не менялся</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </section>

      {/* ── Runs ──────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-base font-medium">Запуски</h2>
          <p className="text-sm text-muted-foreground">
            Ежечасный цикл: сигналы → темы → внимание → карточки → сделки → состояние сделок.
            Организации в режиме «Выключено» не обрабатываются.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-xl border bg-card p-3">
          <Button size="sm" onClick={() => void runNow()} disabled={running}>
            {running ? <Loader className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Запустить сейчас
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={() => void loadRuns()}
            disabled={runsLoading}
          >
            <RefreshCw className={`h-4 w-4 ${runsLoading ? "animate-spin" : ""}`} />
            Обновить
          </Button>
        </div>
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Начало</TableHead>
                <TableHead>Запуск</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead className="text-right">Организаций</TableHead>
                <TableHead className="text-right">Длительность</TableHead>
                <TableHead className="text-right">Ошибки</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runsError ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-red-500">
                    Не удалось загрузить запуски: {runsError}
                  </TableCell>
                </TableRow>
              ) : !runs ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center">
                    <Loader className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : runs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    Запусков ещё не было.
                  </TableCell>
                </TableRow>
              ) : (
                runs.map((r, i) => {
                  const open = expanded.has(r.id)
                  const zebra = i % 2 === 1 ? "bg-muted/40" : ""
                  return (
                    <Fragment key={r.id}>
                      <TableRow
                        className={`cursor-pointer ${zebra}`}
                        onClick={() => toggle(r.id)}
                        aria-expanded={open}
                      >
                        <TableCell>
                          {open ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          )}
                        </TableCell>
                        <TableCell>{formatDateTime(r.startedAt)}</TableCell>
                        <TableCell>{TRIGGER_LABEL[r.trigger] ?? r.trigger}</TableCell>
                        <TableCell>
                          <StatusBadge status={r.status} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{r.orgsProcessed}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatDuration(r.startedAt, r.finishedAt)}
                        </TableCell>
                        <TableCell
                          className={`text-right tabular-nums ${r.errors.length ? "text-red-600 dark:text-red-400" : ""}`}
                        >
                          {r.errors.length}
                        </TableCell>
                      </TableRow>
                      {open && (
                        <TableRow className={`hover:bg-transparent ${zebra}`}>
                          <TableCell />
                          <TableCell colSpan={6} className="whitespace-normal pb-4">
                            <div className="flex flex-col gap-2">
                              {r.orgs.length === 0 ? (
                                <div className="text-sm text-muted-foreground">
                                  Нет организаций в режиме «Тень» или «Включено».
                                </div>
                              ) : (
                                r.orgs.map((o) => <OrgOutcomeBlock key={o.orgId} org={o} />)
                              )}
                              {r.errors.length > 0 && (
                                <div className="rounded-lg border border-red-200 bg-red-50/60 p-3 text-sm dark:border-red-900 dark:bg-red-950/30">
                                  <div className="mb-1 font-medium">Ошибки</div>
                                  <ul className="flex flex-col gap-0.5">
                                    {r.errors.map((e, k) => {
                                      const orgName = r.orgs.find((o) => o.orgId === e.orgId)?.orgName
                                      const where = [orgName ?? e.orgId, e.phase ? PHASE_LABEL[e.phase] ?? e.phase : null]
                                        .filter(Boolean)
                                        .join(" · ")
                                      return (
                                        <li key={k} className="break-words">
                                          {where && <span className="text-muted-foreground">{where}: </span>}
                                          {e.message}
                                        </li>
                                      )
                                    })}
                                  </ul>
                                </div>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  )
                })
              )}
            </TableBody>
          </Table>
        </Card>
      </section>

      {/* Delivery: email digests + evening reminders (plan phase 7). */}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-base font-medium">Рассылка</h2>
          <p className="text-sm text-muted-foreground">
            Письма по темам: утренняя сводка, итоги недели, вечерние напоминания «Не закрыто сегодня».
            Почта уходит только когда тема организации «Включено» и включён переключатель ниже.
          </p>
        </div>
        <AdminTopicsDelivery />
      </section>

      {/* Shadow review of the signal extraction (plan phase 2). */}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-base font-medium">Сигналы сообщений</h2>
          <p className="text-sm text-muted-foreground">
            Результат извлечения сигналов по сообщениям организации: статус, балл, коды, факты и
            предметы. Пользователи этого не видят.
          </p>
        </div>
        <AdminTopicsSignals />
      </section>

      {/* Topic engine debug (plan phase 3 task 8). */}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-base font-medium">Темы (отладка)</h2>
          <p className="text-sm text-muted-foreground">
            Темы организации: контрагент, ведущий код, балл, статус, сообщения, сигналы и журнал.
            Действия: «Готово», «Не относится», объединение, отвязка и повторный разбор сообщения.
            Пользователи этого не видят.
          </p>
        </div>
        <AdminTopicsTopics />
      </section>

      {/* Golden set and model spike (plan phase 0 tasks 7–8). */}
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-medium">Эталонный набор</h2>
        <AdminTopicsGolden />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-medium">Оценка извлечения (eval)</h2>
        <AdminTopicsSpike />
      </section>
    </div>
  )
}

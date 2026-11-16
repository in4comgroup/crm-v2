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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
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
import { AdminTopicsChecks } from "@/components/blocks/admin-topics-checks"
import { AdminTopicsDelivery } from "@/components/blocks/admin-topics-delivery"
import type {
  AdminTopicsModeGateError,
  AdminTopicsModeUpdateResponse,
  AdminTopicsOrgsResponse,
  AdminTopicsPromptContextResponse,
  AdminTopicsChatSignalsResponse,
} from "@/app/api/admin/topics/route"
import { COMPLETENESS_LABELS_RU, type CompletenessItem } from "@/lib/identity/org-profile"
import { TOPICS_GATE_OVERRIDE_MIN_REASON } from "@/lib/identity/topics-gate"
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
  checks: "Проверки CRM",
  attention: "Внимание",
  cards: "Карточки",
  deals: "Сделки",
  dealState: "Состояние сделок",
  delivery: "Рассылка",
}

const PHASE_ORDER = ["intake", "signals", "topics", "checks", "attention", "cards", "deals", "dealState", "delivery"]

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

function ProfileBadge({ profile }: { profile: OrgRow["profile"] }) {
  if (profile.complete) {
    return (
      <Badge variant="outline" className="border-emerald-300 font-normal text-emerald-700 dark:text-emerald-400">
        Заполнен
      </Badge>
    )
  }
  return (
    <Badge
      variant="outline"
      className="border-amber-300 font-normal text-amber-700 dark:text-amber-400"
      title={`Не хватает: ${profile.missing.map((m) => COMPLETENESS_LABELS_RU[m]).join("; ")}`}
    >
      {profile.done} из {profile.total}
    </Badge>
  )
}

export function AdminTopics() {
  const [orgs, setOrgs] = useState<OrgRow[] | null>(null)
  const [orgsError, setOrgsError] = useState<string | null>(null)
  const [savingOrgId, setSavingOrgId] = useState<string | null>(null)
  const [savingPromptOrgId, setSavingPromptOrgId] = useState<string | null>(null)
  const [savingChatOrgId, setSavingChatOrgId] = useState<string | null>(null)
  // Identity gate (identity spec I3): a 409 opens this dialog with the
  // missing profile items and the «Включить без профиля» override.
  const [gate, setGate] = useState<{
    org: OrgRow
    mode: Mode
    error: string
    missing: CompletenessItem[]
  } | null>(null)
  const [overrideReason, setOverrideReason] = useState("")
  const [overrideError, setOverrideError] = useState<string | null>(null)
  const [overriding, setOverriding] = useState(false)

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

  const applySaved = (org: OrgRow, saved: AdminTopicsModeUpdateResponse) => {
    setOrgs((prev) =>
      prev?.map((o) =>
        o.organizationId === saved.organizationId
          ? { ...o, mode: saved.mode, lastChange: saved.lastChange }
          : o,
      ) ?? prev,
    )
    toast.success(
      `«${org.name}»: режим «${MODE_LABEL[saved.mode]}»${saved.overridden ? " (без профиля)" : ""}`,
    )
  }

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
      if (res.status === 409) {
        const g = data as AdminTopicsModeGateError
        setOverrideReason("")
        setOverrideError(null)
        setGate({ org, mode, error: g.error, missing: g.missing ?? [] })
        return
      }
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      applySaved(org, data as AdminTopicsModeUpdateResponse)
    } catch (e) {
      toast.error(`Не удалось сохранить режим: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSavingOrgId(null)
    }
  }

  // docs/specs/ai-chat Q22 «Чат в сигналах» (`topics.chatSignals`).
  const saveChatSignals = async (org: OrgRow, chatSignals: boolean) => {
    setSavingChatOrgId(org.organizationId)
    try {
      const res = await fetch("/api/admin/topics", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: org.organizationId, chatSignals }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      const saved = data as AdminTopicsChatSignalsResponse
      setOrgs((prev) =>
        prev?.map((o) => (o.organizationId === saved.organizationId ? { ...o, chatSignals: saved.chatSignals } : o)) ??
        prev,
      )
      toast.success(`«${org.name}»: чат в сигналах ${saved.chatSignals ? "включён" : "выключен"}`)
    } catch (e) {
      toast.error(`Не удалось сохранить: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSavingChatOrgId(null)
    }
  }

  // Identity I4 «Профиль в промптах» (`identity.promptContext`).
  const savePromptContext = async (org: OrgRow, promptContext: boolean) => {
    setSavingPromptOrgId(org.organizationId)
    try {
      const res = await fetch("/api/admin/topics", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: org.organizationId, promptContext }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      const saved = data as AdminTopicsPromptContextResponse
      setOrgs((prev) =>
        prev?.map((o) =>
          o.organizationId === saved.organizationId ? { ...o, promptContext: saved.promptContext } : o,
        ) ?? prev,
      )
      toast.success(`«${org.name}»: профиль в промптах ${saved.promptContext ? "включён" : "выключен"}`)
    } catch (e) {
      toast.error(`Не удалось сохранить: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSavingPromptOrgId(null)
    }
  }

  const saveWithOverride = async () => {
    if (!gate) return
    const reason = overrideReason.trim()
    if (reason.length < TOPICS_GATE_OVERRIDE_MIN_REASON) {
      setOverrideError(`Причина — не короче ${TOPICS_GATE_OVERRIDE_MIN_REASON} символов.`)
      return
    }
    setOverriding(true)
    setOverrideError(null)
    try {
      const res = await fetch("/api/admin/topics", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: gate.org.organizationId,
          mode: gate.mode,
          override: { reason },
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setOverrideError(data?.error ?? `HTTP ${res.status}`)
        return
      }
      applySaved(gate.org, data as AdminTopicsModeUpdateResponse)
      setGate(null)
    } catch (e) {
      setOverrideError(e instanceof Error ? e.message : String(e))
    } finally {
      setOverriding(false)
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
            пользователи их не видят. Включено — темы видны организации. «Профиль в промптах» —
            профиль организации и профиль клиента в промптах тем (извлечение сигналов, сопоставление
            тем, карточки, состояние сделки). «Чат в сигналах» — заметки сотрудников из ИИ чата
            дают сигналы в режиме «Включено» (в тени — всегда, для проверки).
          </p>
        </div>
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Организация</TableHead>
                <TableHead className="w-48">Режим</TableHead>
                <TableHead className="w-32">Профиль</TableHead>
                <TableHead className="w-44">Профиль в промптах</TableHead>
                <TableHead className="w-40">Чат в сигналах</TableHead>
                <TableHead>Последнее изменение</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orgsError ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-red-500">
                    Не удалось загрузить организации: {orgsError}
                  </TableCell>
                </TableRow>
              ) : !orgs ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center">
                    <Loader className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : orgs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
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
                      <ProfileBadge profile={o.profile} />
                    </TableCell>
                    <TableCell className="text-sm">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={o.promptContext}
                          onCheckedChange={(v) => void savePromptContext(o, v)}
                          disabled={savingPromptOrgId === o.organizationId}
                          aria-label={`Профиль в промптах: ${o.name}`}
                        />
                        {savingPromptOrgId === o.organizationId && (
                          <Loader className="h-4 w-4 animate-spin text-muted-foreground" />
                        )}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">Включать после оценки на эталоне</div>
                    </TableCell>
                    <TableCell className="text-sm">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={o.chatSignals}
                          onCheckedChange={(v) => void saveChatSignals(o, v)}
                          disabled={savingChatOrgId === o.organizationId}
                          aria-label={`Чат в сигналах: ${o.name}`}
                        />
                        {savingChatOrgId === o.organizationId && (
                          <Loader className="h-4 w-4 animate-spin text-muted-foreground" />
                        )}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">Включать после проверки заметок в тени</div>
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

      <Dialog open={!!gate} onOpenChange={(open) => !open && !overriding && setGate(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Профиль организации не заполнен</DialogTitle>
            <DialogDescription>
              {gate
                ? `«${gate.org.name}» нельзя перевести в режим «${MODE_LABEL[gate.mode]}»: без профиля ИИ не отличает внутреннюю переписку от внешней. Владелец заполняет профиль на /account → «Профиль организации».`
                : null}
            </DialogDescription>
          </DialogHeader>
          {gate && (
            <div className="flex flex-col gap-4">
              <div>
                <div className="mb-1 text-sm font-medium">Не хватает:</div>
                <ul className="list-disc space-y-0.5 pl-5 text-sm">
                  {gate.missing.map((m) => (
                    <li key={m}>{COMPLETENESS_LABELS_RU[m]}</li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="topics-gate-reason">Причина включения без профиля</Label>
                <Textarea
                  id="topics-gate-reason"
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="Например: тестовая организация, проверка движка"
                  rows={3}
                />
                <p className="text-xs text-muted-foreground">
                  Не короче {TOPICS_GATE_OVERRIDE_MIN_REASON} символов. Причина записывается в журнал
                  изменений режима.
                </p>
                {overrideError && (
                  <p className="text-sm text-red-600 dark:text-red-400">{overrideError}</p>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setGate(null)} disabled={overriding}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={() => void saveWithOverride()}
              disabled={overriding || overrideReason.trim().length < TOPICS_GATE_OVERRIDE_MIN_REASON}
            >
              {overriding && <Loader className="h-4 w-4 animate-spin" />}
              Включить без профиля
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                          <TableCell colSpan={5} className="whitespace-normal pb-4">
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

      {/* CRM checks + watchdogs (plan phase 8). */}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-base font-medium">Проверки CRM</h2>
          <p className="text-sm text-muted-foreground">
            Темы из данных о заказах и сторожа по переписке. Проверки не вызывают ИИ.
          </p>
        </div>
        <AdminTopicsChecks />
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

    </div>
  )
}

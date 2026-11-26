"use client"

// Block «Проверки CRM» on /settings → «Темы» (topics plan phase 8) — platform
// admin only. Per org: two switches (orders / watchdogs = org_setting
// `topics.checks`), the table of checks with the last run, a dry-run preview
// («Проверить без записи»), a manual run («Запустить сейчас»), read-only
// parameters, the list of not-built codes and the last runs.
// Data: /api/admin/topics/checks.

import { useCallback, useEffect, useState } from "react"
import { Eye, Loader, Play, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatDateTime } from "@/components/blocks/admin-ai-models"
import {
  CHECK_BY_KEY,
  CHECK_SCHEDULE_LABELS_RU,
  type CheckKey,
  type CheckRunView,
  type ChecksOrgView,
  type ChecksSwitch,
} from "@/lib/topics/checks"
import type { CheckPreview, CheckRunOutcome } from "@/server/topics/checks/run"

type OrgRow = { organizationId: string; name: string; mode: string; switch: ChecksSwitch }

const MODE_LABEL: Record<string, string> = { off: "Выключено", shadow: "Тень", on: "Включено" }
const GROUP_LABEL: Record<string, string> = { orders: "Заказы", watchdogs: "Сторож", contacts: "Контакты" }
const STATUS_LABEL: Record<string, string> = { running: "Идёт", ok: "Успешно", failed: "Ошибка", skipped: "Пропущено" }
const COUNT_LABEL: Record<string, string> = {
  created: "создано",
  refreshed: "обновлено",
  cleared: "снято",
  skipped: "пропущено",
}
const TRIGGER_LABEL: Record<string, string> = { schedule: "По расписанию", manual: "Вручную", preview: "Проверка" }

function countsText(c: Record<string, number>): string {
  return Object.keys(COUNT_LABEL)
    .filter((k) => typeof c[k] === "number")
    .map((k) => `${COUNT_LABEL[k]} ${c[k]}`)
    .join(" · ")
}

function RunStatus({ run }: { run: CheckRunView | null }) {
  if (!run) return <span className="text-muted-foreground">Не запускалась</span>
  return (
    <div className="flex flex-col gap-0.5 text-xs">
      <span className={run.status === "failed" ? "text-destructive" : undefined}>
        {STATUS_LABEL[run.status] ?? run.status} · {formatDateTime(run.startedAt)}
      </span>
      {countsText(run.counts) && <span className="text-muted-foreground">{countsText(run.counts)}</span>}
      {run.error && <span className="text-destructive">{run.error}</span>}
    </div>
  )
}

export function AdminTopicsChecks() {
  const [orgs, setOrgs] = useState<OrgRow[] | null>(null)
  const [orgId, setOrgId] = useState("")
  const [view, setView] = useState<ChecksOrgView | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<string | null>(null) // "preview:<key|all>" | "run:<key|all>"
  const [previews, setPreviews] = useState<CheckPreview[] | null>(null)
  const [outcomes, setOutcomes] = useState<CheckRunOutcome[] | null>(null)
  // Inline confirm of «Запустить сейчас»: the scope (a key or "all").
  const [confirmRun, setConfirmRun] = useState<CheckKey | "all" | null>(null)

  useEffect(() => {
    fetch("/api/admin/topics/checks")
      .then(async (r) => {
        const d = await r.json()
        if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`)
        const list = (d.orgs ?? []) as OrgRow[]
        setOrgs(list)
        const first = list.find((o) => o.mode === "on") ?? list.find((o) => o.mode !== "off") ?? list[0]
        if (first) setOrgId(first.organizationId)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      const r = await fetch(`/api/admin/topics/checks?organizationId=${encodeURIComponent(orgId)}`)
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`)
      setView(d.view as ChecksOrgView)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    setView(null)
    void load()
  }, [load])

  const saveSwitch = async (next: ChecksSwitch) => {
    if (!view) return
    setSaving(true)
    try {
      const r = await fetch("/api/admin/topics/checks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: view.organizationId, switch: next }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`)
      setView(d.view as ChecksOrgView)
      setOrgs((prev) => prev?.map((o) => (o.organizationId === view.organizationId ? { ...o, switch: next } : o)) ?? prev)
      toast.success("Сохранено")
    } catch (e) {
      toast.error(`Не удалось сохранить: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  const call = async (action: "preview" | "run", key: CheckKey | "all") => {
    if (!orgId) return
    setBusy(`${action}:${key}`)
    try {
      const r = await fetch("/api/admin/topics/checks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: orgId, action, checks: key === "all" ? undefined : [key] }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`)
      if (action === "preview") setPreviews(d.previews as CheckPreview[])
      else {
        setOutcomes(d.outcomes as CheckRunOutcome[])
        void load()
      }
    } catch (e) {
      toast.error(`${action === "preview" ? "Проверка" : "Запуск"} не удался: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(null)
    }
  }

  const runConfirmed = async () => {
    const scope = confirmRun
    setConfirmRun(null)
    if (scope) await call("run", scope)
  }

  const label = (k: CheckKey) => CHECK_BY_KEY.get(k)?.labelRu ?? k

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={orgId} onValueChange={setOrgId} disabled={!orgs?.length}>
          <SelectTrigger size="sm" className="w-fit min-w-56">
            <SelectValue placeholder="Организация" />
          </SelectTrigger>
          <SelectContent>
            {(orgs ?? []).map((o) => (
              <SelectItem key={o.organizationId} value={o.organizationId}>
                {o.name} · {MODE_LABEL[o.mode] ?? o.mode}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="icon-sm" aria-label="Обновить" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {view && (
        <>
          <Card className="p-4 gap-3">
            <div className="flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-2">
                <Switch
                  id="checks-orders-switch"
                  checked={view.switch.orders}
                  disabled={saving}
                  onCheckedChange={(v) => void saveSwitch({ ...view.switch, orders: v })}
                />
                <Label htmlFor="checks-orders-switch">Проверки по заказам</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="checks-watchdogs-switch"
                  checked={view.switch.watchdogs}
                  disabled={saving}
                  onCheckedChange={(v) => void saveSwitch({ ...view.switch, watchdogs: v })}
                />
                <Label htmlFor="checks-watchdogs-switch">Сторожа по переписке</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="checks-contacts-switch"
                  checked={view.switch.contacts}
                  disabled={saving}
                  onCheckedChange={(v) => void saveSwitch({ ...view.switch, contacts: v })}
                />
                <Label htmlFor="checks-contacts-switch">Контакты (дни рождения, включено по умолчанию)</Label>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Пока выключено, движок не создаёт темы из этих проверок. Сначала посмотрите «Проверить без записи».
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void call("preview", "all")}>
                {busy === "preview:all" ? <Loader className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                Проверить без записи
              </Button>
              <Button size="sm" disabled={busy !== null} onClick={() => setConfirmRun("all")}>
                {busy === "run:all" ? <Loader className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Запустить сейчас
              </Button>
            </div>
          </Card>

          <Card className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Проверка</TableHead>
                  <TableHead>Коды</TableHead>
                  <TableHead>Расписание</TableHead>
                  <TableHead>Группа</TableHead>
                  <TableHead>Последний запуск</TableHead>
                  <TableHead className="text-right">Открытых</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.checks.map((c) => (
                  <TableRow key={c.key}>
                    <TableCell className="align-top">{c.labelRu}</TableCell>
                    <TableCell className="align-top font-mono text-[11px]">{c.codes.join(", ")}</TableCell>
                    <TableCell className="align-top text-xs">{CHECK_SCHEDULE_LABELS_RU[c.schedule]}</TableCell>
                    <TableCell className="align-top text-xs">{GROUP_LABEL[c.group] ?? c.group}</TableCell>
                    <TableCell className="align-top">
                      <RunStatus run={c.lastRun} />
                    </TableCell>
                    <TableCell className="text-right align-top tabular-nums">{c.openInstances}</TableCell>
                    <TableCell className="align-top">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Проверить без записи"
                          title="Проверить без записи"
                          disabled={busy !== null}
                          onClick={() => void call("preview", c.key)}
                        >
                          {busy === `preview:${c.key}` ? <Loader className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Запустить сейчас"
                          title="Запустить сейчас"
                          disabled={busy !== null}
                          onClick={() => setConfirmRun(c.key)}
                        >
                          {busy === `run:${c.key}` ? <Loader className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm">
                Параметры
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <Card className="mt-2 p-4">
                <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
                  {Object.entries(view.params).map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-2">
                      <dt className="font-mono text-muted-foreground">{k}</dt>
                      <dd className="tabular-nums">{String(v)}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
            </CollapsibleContent>
          </Collapsible>

          <div>
            <h3 className="text-sm font-medium">Не построено</h3>
            <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              {view.notBuilt.map((n) => (
                <li key={n.code}>
                  <span className="font-mono">{n.code}</span> — {n.reasonRu}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-medium">Последние запуски</h3>
            {view.runs.length === 0 ? (
              <p className="text-xs text-muted-foreground">Запусков пока нет.</p>
            ) : (
              <Card className="mt-1 p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Время</TableHead>
                      <TableHead>Проверка</TableHead>
                      <TableHead>Запуск</TableHead>
                      <TableHead>Итог</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {view.runs.slice(0, 20).map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-xs">{formatDateTime(r.startedAt)}</TableCell>
                        <TableCell className="text-xs">{label(r.checkKey)}</TableCell>
                        <TableCell className="text-xs">{TRIGGER_LABEL[r.trigger] ?? r.trigger}</TableCell>
                        <TableCell className="text-xs">
                          <span className={r.status === "failed" ? "text-destructive" : undefined}>
                            {STATUS_LABEL[r.status] ?? r.status}
                          </span>
                          {countsText(r.counts) && <span className="text-muted-foreground"> · {countsText(r.counts)}</span>}
                          {r.error && <span className="text-destructive"> · {r.error}</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            )}
          </div>
        </>
      )}

      {/* Confirm of a manual run (writes data). */}
      <Dialog open={confirmRun !== null} onOpenChange={(o) => !o && setConfirmRun(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Запустить проверки сейчас?</DialogTitle>
            <DialogDescription>
              {confirmRun === "all" ? "Все проверки" : confirmRun ? `«${label(confirmRun)}»` : ""} запишут темы и сигналы в
              организацию. Нужен режим «Тень» или «Включено». Сначала можно посмотреть «Проверить без записи».
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRun(null)}>
              Отмена
            </Button>
            <Button onClick={() => void runConfirmed()}>Запустить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dry-run preview. */}
      <Dialog open={previews !== null} onOpenChange={(o) => !o && setPreviews(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Проверка без записи</DialogTitle>
            <DialogDescription>Ничего не записано. Так выглядел бы результат запуска сейчас.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            {(previews ?? []).map((p) => (
              <div key={p.key} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {label(p.key)}
                  <span className="text-xs font-normal text-muted-foreground">
                    просмотрено {p.evaluated} · найдено {p.rows.length} · снимется {p.clears.length}
                  </span>
                </div>
                {p.error && <p className="text-xs text-destructive">{p.error}</p>}
                {Object.keys(p.skipped).length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Пропущено: {Object.entries(p.skipped).map(([k, v]) => `${k} — ${v}`).join("; ")}
                  </p>
                )}
                {p.rows.length > 0 && (
                  <div className="rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Компания</TableHead>
                          <TableHead>Тема</TableHead>
                          <TableHead>Основание</TableHead>
                          <TableHead className="text-right">Балл</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {p.rows.map((row) => (
                          <TableRow key={`${row.code}:${row.conditionKey}`}>
                            <TableCell className="align-top text-xs">{row.companyName ?? "—"}</TableCell>
                            <TableCell className="align-top text-xs">
                              {row.matterRu}{" "}
                              {row.exists && (
                                <Badge variant="outline" className="font-normal text-[10px]">
                                  уже есть
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="max-w-md whitespace-normal align-top text-xs">{row.evidenceRu}</TableCell>
                            <TableCell className="text-right align-top tabular-nums text-xs">{row.score}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                {p.clears.length > 0 && (
                  <ul className="text-xs text-muted-foreground">
                    {p.clears.map((c) => (
                      <li key={c.instanceId}>Условие будет снято: {c.reasonRu}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Outcomes of a manual run. */}
      <Dialog open={outcomes !== null} onOpenChange={(o) => !o && setOutcomes(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Результат запуска</DialogTitle>
          </DialogHeader>
          <ul className="flex flex-col gap-1 text-sm">
            {(outcomes ?? []).map((o) => (
              <li key={o.key}>
                <span className="font-medium">{label(o.key)}</span> — {STATUS_LABEL[o.status] ?? o.status}
                {countsText(o.counts) && <span className="text-muted-foreground"> · {countsText(o.counts)}</span>}
                {o.error && <span className="text-destructive"> · {o.error}</span>}
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  )
}

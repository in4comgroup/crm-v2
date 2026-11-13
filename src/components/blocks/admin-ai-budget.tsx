"use client"

// «Дневной бюджет ИИ» block on the «Использование ИИ» tab: the default daily
// AI budget (USD of gateway cost per UTC day) and per-organization overrides,
// with today's spend. Background AI of an org stops when its budget is used
// up; interactive AI keeps working. Spec: docs/specs/models/07-daily-budget.md.

import { useCallback, useEffect, useState } from "react"
import { Loader } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { AdminAiSettingsResponse } from "@/app/api/admin/ai/settings/route"

type Budget = AdminAiSettingsResponse["budget"]

const usd = (n: number) =>
  `$${n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const parse = (s: string): number | null => {
  const n = Number(s.replace(",", "."))
  return s.trim() !== "" && Number.isFinite(n) && n >= 0 && n <= 100_000 ? n : null
}

async function put(body: unknown) {
  const r = await fetch("/api/admin/ai/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`)
}

export function AdminAiBudget() {
  const [budget, setBudget] = useState<Budget | null>(null)
  const [defaultDraft, setDefaultDraft] = useState("")
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/ai/settings")
    if (!r.ok) return
    const d = (await r.json()) as AdminAiSettingsResponse
    setBudget(d.budget)
    setDefaultDraft(String(d.budget.defaultUsd))
    setDrafts(
      Object.fromEntries(d.budget.orgs.map((o) => [o.organizationId, o.overrideUsd == null ? "" : String(o.overrideUsd)])),
    )
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const saveDefault = async () => {
    const v = parse(defaultDraft)
    if (v == null) return
    setSaving("default")
    try {
      await put({ budgetDefaultUsd: v })
      toast.success("Бюджет по умолчанию сохранён")
      await load()
    } catch (e) {
      toast.error(`Не удалось сохранить: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSaving(null)
    }
  }

  const saveOrg = async (orgId: string) => {
    const raw = drafts[orgId] ?? ""
    const v = raw.trim() === "" ? null : parse(raw)
    if (raw.trim() !== "" && v == null) return
    setSaving(orgId)
    try {
      await put({ orgBudget: { organizationId: orgId, dailyUsd: v } })
      toast.success(v == null ? "Используется бюджет по умолчанию" : "Бюджет организации сохранён")
      await load()
    } catch (e) {
      toast.error(`Не удалось сохранить: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSaving(null)
    }
  }

  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="text-sm font-medium">Дневной бюджет ИИ</CardTitle>
        <CardDescription className="text-xs">
          Себестоимость шлюза в USD за сутки (UTC) на организацию. Когда бюджет исчерпан,
          фоновые процессы ИИ (разбор источников, генерация) останавливаются до следующих суток;
          ИИ чат и другие функции, которые запускает пользователь, продолжают работать.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!budget ? (
          <Loader className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-sm" htmlFor="ai-budget-default">
                По умолчанию, $ в сутки
              </label>
              <Input
                id="ai-budget-default"
                inputMode="decimal"
                className="h-8 w-28"
                value={defaultDraft}
                onChange={(e) => setDefaultDraft(e.target.value)}
                aria-invalid={parse(defaultDraft) == null}
              />
              <Button
                size="sm"
                onClick={saveDefault}
                disabled={saving != null || parse(defaultDraft) == null || parse(defaultDraft) === budget.defaultUsd}
              >
                {saving === "default" && <Loader className="h-4 w-4 animate-spin" />}
                Сохранить
              </Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Организация</TableHead>
                  <TableHead className="text-right">Сегодня</TableHead>
                  <TableHead className="text-right">Бюджет</TableHead>
                  <TableHead>Свой бюджет, $</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {budget.orgs.map((o) => {
                  const draft = drafts[o.organizationId] ?? ""
                  const current = o.overrideUsd == null ? "" : String(o.overrideUsd)
                  const invalid = draft.trim() !== "" && parse(draft) == null
                  const exceeded = o.spentTodayUsd >= o.budgetUsd
                  return (
                    <TableRow key={o.organizationId} className="even:bg-muted/40">
                      <TableCell>{o.name}</TableCell>
                      <TableCell className={`text-right tabular-nums ${exceeded ? "font-medium text-red-600" : ""}`}>
                        {usd(o.spentTodayUsd)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {usd(o.budgetUsd)}
                        {o.overrideUsd == null && (
                          <span className="ml-1 text-xs text-muted-foreground">(по умолч.)</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Input
                            inputMode="decimal"
                            className="h-8 w-24"
                            placeholder="—"
                            value={draft}
                            onChange={(e) => setDrafts((d) => ({ ...d, [o.organizationId]: e.target.value }))}
                            aria-invalid={invalid}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => saveOrg(o.organizationId)}
                            disabled={saving != null || invalid || draft.trim() === current}
                          >
                            {saving === o.organizationId && <Loader className="h-4 w-4 animate-spin" />}
                            Сохранить
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            <p className="text-xs text-muted-foreground">
              Пустое поле «Свой бюджет» — используется бюджет по умолчанию.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}

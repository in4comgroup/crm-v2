"use client"

// «Лимиты ИИ по организациям» block on the «Использование ИИ» tab:
// - DAILY budget: USD of gateway cost per UTC day (spec 07). Owners never
//   see its amounts.
// - MONTHLY limit: USD of END-USER cost (with markup) per calendar month,
//   UTC (spec 08). Owners see it on /account: a note from 70 %, a warning from 90 %.
// Defaults + per-organization overrides, with today's / this month's spend.
// Background AI of an org stops when either is used up; interactive AI
// keeps working.

import { useCallback, useEffect, useState } from "react"
import { Loader } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { aiMonthlyLimitState } from "@/lib/ai-budget"
import type { AdminAiSettingsResponse } from "@/app/api/admin/ai/settings/route"

type Budget = AdminAiSettingsResponse["budget"]
type Draft = { daily: string; monthly: string }

const usd = (n: number) =>
  `$${n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const parse = (s: string, max = 1_000_000): number | null => {
  const n = Number(s.replace(",", "."))
  return s.trim() !== "" && Number.isFinite(n) && n >= 0 && n <= max ? n : null
}

const asText = (v: number | null) => (v == null ? "" : String(v))

async function put(body: unknown) {
  const r = await fetch("/api/admin/ai/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`)
}

function DefaultField({
  id,
  label,
  value,
  onChange,
  onSave,
  current,
  savingKey,
  max,
  saving,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  onSave: () => void
  current: number
  savingKey: string
  max?: number
  saving: string | null
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="w-64 text-sm" htmlFor={id}>{label}</label>
      <Input id={id} inputMode="decimal" className="h-8 w-28" value={value}
        onChange={(e) => onChange(e.target.value)} aria-invalid={parse(value, max) == null} />
      <Button size="sm" onClick={onSave}
        disabled={saving != null || parse(value, max) == null || parse(value, max) === current}>
        {saving === savingKey && <Loader className="h-4 w-4 animate-spin" />}
        Сохранить
      </Button>
    </div>
  )
}

export function AdminAiBudget() {
  const [budget, setBudget] = useState<Budget | null>(null)
  const [dailyDefault, setDailyDefault] = useState("")
  const [monthlyDefault, setMonthlyDefault] = useState("")
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [saving, setSaving] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/ai/settings")
    if (!r.ok) return
    const d = (await r.json()) as AdminAiSettingsResponse
    setBudget(d.budget)
    setDailyDefault(String(d.budget.defaultUsd))
    setMonthlyDefault(String(d.budget.monthlyDefaultUsd))
    setDrafts(
      Object.fromEntries(
        d.budget.orgs.map((o) => [o.organizationId, { daily: asText(o.overrideUsd), monthly: asText(o.monthlyOverrideUsd) }]),
      ),
    )
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const run = async (key: string, fn: () => Promise<void>, ok: string) => {
    setSaving(key)
    try {
      await fn()
      toast.success(ok)
      await load()
    } catch (e) {
      toast.error(`Не удалось сохранить: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSaving(null)
    }
  }

  const saveDailyDefault = () => {
    const v = parse(dailyDefault, 100_000)
    if (v != null) run("daily-default", () => put({ budgetDefaultUsd: v }), "Дневной бюджет по умолчанию сохранён")
  }
  const saveMonthlyDefault = () => {
    const v = parse(monthlyDefault)
    if (v != null) run("monthly-default", () => put({ monthlyLimitDefaultUsd: v }), "Месячный лимит по умолчанию сохранён")
  }

  // One «Сохранить» per row: writes only the changed overrides.
  const saveOrg = (orgId: string, o: Budget["orgs"][number]) => {
    const d = drafts[orgId] ?? { daily: "", monthly: "" }
    const daily = d.daily.trim() === "" ? null : parse(d.daily, 100_000)
    const monthly = d.monthly.trim() === "" ? null : parse(d.monthly)
    run(
      orgId,
      async () => {
        if (d.daily.trim() !== asText(o.overrideUsd)) await put({ orgBudget: { organizationId: orgId, dailyUsd: daily } })
        if (d.monthly.trim() !== asText(o.monthlyOverrideUsd)) {
          await put({ orgMonthlyLimit: { organizationId: orgId, monthlyUsd: monthly } })
        }
      },
      "Лимиты организации сохранены",
    )
  }

  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="text-sm font-medium">Лимиты ИИ по организациям</CardTitle>
        <CardDescription className="text-xs">
          <b>Дневной бюджет</b> — себестоимость шлюза в USD за сутки (UTC); владельцы организаций
          его сумм не видят. <b>Месячный лимит</b> — стоимость для клиента (с наценкой) в USD за
          календарный месяц (UTC); владелец видит его на странице организации: уведомление от 70 %,
          предупреждение от 90 %. Когда исчерпан любой из них, фоновые процессы ИИ (разбор источников, темы)
          останавливаются. ИИ чат останавливается только при исчерпании месячного лимита; дневной
          бюджет его не останавливает.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!budget ? (
          <Loader className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <>
            <DefaultField id="ai-budget-default" label="Дневной бюджет по умолчанию, $ (шлюз)"
              value={dailyDefault} onChange={setDailyDefault} onSave={saveDailyDefault}
              current={budget.defaultUsd} savingKey="daily-default" max={100_000} saving={saving} />
            <DefaultField id="ai-monthly-default" label="Месячный лимит по умолчанию, $ (с наценкой)"
              value={monthlyDefault} onChange={setMonthlyDefault} onSave={saveMonthlyDefault}
              current={budget.monthlyDefaultUsd} savingKey="monthly-default" saving={saving} />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Организация</TableHead>
                  <TableHead className="text-right">Сегодня</TableHead>
                  <TableHead className="text-right">Дневной бюджет</TableHead>
                  <TableHead className="text-right">За месяц</TableHead>
                  <TableHead className="text-right">Месячный лимит</TableHead>
                  <TableHead>Свои лимиты, $ (день / месяц)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {budget.orgs.map((o) => {
                  const d = drafts[o.organizationId] ?? { daily: "", monthly: "" }
                  const dailyInvalid = d.daily.trim() !== "" && parse(d.daily, 100_000) == null
                  const monthlyInvalid = d.monthly.trim() !== "" && parse(d.monthly) == null
                  const unchanged =
                    d.daily.trim() === asText(o.overrideUsd) && d.monthly.trim() === asText(o.monthlyOverrideUsd)
                  const month = aiMonthlyLimitState(o.spentMonthUsd, o.monthlyLimitUsd, new Date())
                  const setDraft = (patch: Partial<Draft>) =>
                    setDrafts((all) => ({ ...all, [o.organizationId]: { ...d, ...patch } }))
                  return (
                    <TableRow key={o.organizationId} className="even:bg-muted/40">
                      <TableCell>{o.name}</TableCell>
                      <TableCell className={`text-right tabular-nums ${o.spentTodayUsd >= o.budgetUsd ? "font-medium text-red-600" : ""}`}>
                        {usd(o.spentTodayUsd)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {usd(o.budgetUsd)}
                        {o.overrideUsd == null && <span className="ml-1 text-xs text-muted-foreground">(по умолч.)</span>}
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums ${
                          month.level === "exceeded" ? "font-medium text-red-600" : month.level === "warning" ? "font-medium text-amber-600" : ""
                        }`}
                      >
                        {usd(o.spentMonthUsd)}
                        <span className="ml-1 text-xs text-muted-foreground">
                          ({Math.round(Math.min(month.share, 9.99) * 100)}%)
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {usd(o.monthlyLimitUsd)}
                        {o.monthlyOverrideUsd == null && <span className="ml-1 text-xs text-muted-foreground">(по умолч.)</span>}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Input inputMode="decimal" className="h-8 w-20" placeholder="—" aria-label="Свой дневной бюджет"
                            value={d.daily} onChange={(e) => setDraft({ daily: e.target.value })} aria-invalid={dailyInvalid} />
                          <Input inputMode="decimal" className="h-8 w-20" placeholder="—" aria-label="Свой месячный лимит"
                            value={d.monthly} onChange={(e) => setDraft({ monthly: e.target.value })} aria-invalid={monthlyInvalid} />
                          <Button size="sm" variant="outline" onClick={() => saveOrg(o.organizationId, o)}
                            disabled={saving != null || dailyInvalid || monthlyInvalid || unchanged}>
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
              Пустое поле — используется значение по умолчанию. 0 — фоновый ИИ выключен.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}

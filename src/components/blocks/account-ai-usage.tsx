"use client"

// «Использование ИИ» tab on /account — the organization's AI usage for its
// OWNERS. Shows only calls and the cost WITH the platform markup, per
// process and per user; never the gateway cost, the markup % or model ids.
// Spec: docs/specs/models/05-markup-and-end-user-cost.md §5. Data:
// /api/account/ai-usage.

import { useEffect, useState } from "react"
import { Loader } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
import { StatTile } from "@/components/blocks/analytics/analytics-primitives"
import type { AccountAiUsageResponse } from "@/app/api/account/ai-usage/route"

type Period = "7d" | "30d" | "this_month" | "last_month"

const iso = (d: Date) => d.toISOString().slice(0, 10)

function range(p: Period) {
  const today = new Date()
  const y = today.getUTCFullYear()
  const m = today.getUTCMonth()
  switch (p) {
    case "7d":
      return { from: iso(new Date(today.getTime() - 6 * 86_400_000)), to: iso(today) }
    case "30d":
      return { from: iso(new Date(today.getTime() - 29 * 86_400_000)), to: iso(today) }
    case "this_month":
      return { from: iso(new Date(Date.UTC(y, m, 1))), to: iso(today) }
    case "last_month":
      return { from: iso(new Date(Date.UTC(y, m - 1, 1))), to: iso(new Date(Date.UTC(y, m, 0))) }
  }
}

// Rounded to cents; tiny amounts show «< $0.01» (05 §3).
function usd(n: number): string {
  if (n === 0) return "$0.00"
  if (n < 0.01) return "< $0.01"
  return `$${n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function AccountAiUsage() {
  const [period, setPeriod] = useState<Period>("this_month")
  const [state, setState] = useState<{
    period: Period
    data: AccountAiUsageResponse | null
    error: string | null
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    const { from, to } = range(period)
    fetch(`/api/account/ai-usage?from=${from}&to=${to}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`)
        return (await r.json()) as AccountAiUsageResponse
      })
      .then((data) => !cancelled && setState({ period, data, error: null }))
      .catch(
        (e) => !cancelled && setState({ period, data: null, error: e instanceof Error ? e.message : String(e) }),
      )
    return () => {
      cancelled = true
    }
  }, [period])

  const current = state?.period === period ? state : null
  const data = current?.data ?? null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3">
        <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
          <SelectTrigger size="sm" className="w-44" aria-label="Период">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">7 дней</SelectItem>
            <SelectItem value="30d">30 дней</SelectItem>
            <SelectItem value="this_month">Этот месяц</SelectItem>
            <SelectItem value="last_month">Прошлый месяц</SelectItem>
          </SelectContent>
        </Select>
        {!current && <Loader className="h-4 w-4 animate-spin text-muted-foreground" />}
        <span className="ml-auto text-xs text-muted-foreground">Суммы в долларах США</span>
      </div>

      {data?.budgetExhausted && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Дневной лимит ИИ исчерпан: фоновая обработка источников продолжится завтра. ИИ чат и
          другие функции, которые вы запускаете сами, работают.
        </div>
      )}

      {current?.error && (
        <p className="text-sm text-red-500">Не удалось загрузить данные: {current.error}</p>
      )}

      <div className="grid grid-cols-2 gap-3 md:max-w-xl">
        <StatTile label="Вызовы ИИ" value={data ? data.calls.toLocaleString("ru-RU") : "—"} />
        <StatTile label="Стоимость" value={data ? usd(data.cost) : "—"} />
      </div>

      <Card className="gap-3">
        <CardHeader>
          <CardTitle className="text-sm font-medium">По функциям</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Функция</TableHead>
                <TableHead className="text-right">Вызовы</TableHead>
                <TableHead className="text-right">Стоимость</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!data?.byProcess.length ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                    {data ? "Нет вызовов ИИ за выбранный период" : "—"}
                  </TableCell>
                </TableRow>
              ) : (
                data.byProcess.map((r) => (
                  <TableRow key={r.label} className="even:bg-muted/40">
                    <TableCell>
                      <div>{r.label}</div>
                      <div className="text-xs text-muted-foreground">{r.group}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.calls.toLocaleString("ru-RU")}</TableCell>
                    <TableCell className="text-right tabular-nums">{usd(r.cost)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="gap-3">
        <CardHeader>
          <CardTitle className="text-sm font-medium">По пользователям</CardTitle>
          <p className="text-xs text-muted-foreground">
            ИИ чат, ассистенты и другие функции, которые запускает пользователь. Фоновая
            обработка источников сюда не входит.
          </p>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Пользователь</TableHead>
                <TableHead className="text-right">Вызовы</TableHead>
                <TableHead className="text-right">Стоимость</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!data?.byUser.length ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                    {data ? "Нет вызовов за выбранный период" : "—"}
                  </TableCell>
                </TableRow>
              ) : (
                data.byUser.map((r, i) => (
                  <TableRow key={`${r.name}-${i}`} className="even:bg-muted/40">
                    <TableCell>{r.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.calls.toLocaleString("ru-RU")}</TableCell>
                    <TableCell className="text-right tabular-nums">{usd(r.cost)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

"use client"

// «Наценка» (Markup) block on the «Использование ИИ» tab: one global % on
// top of the AI gateway cost; end users see only the marked-up cost.
// Spec: docs/specs/models/05-markup-and-end-user-cost.md §3, §4.
// Applies to NEW calls only: every usage event stores the markup in force.

import { useCallback, useEffect, useState } from "react"
import { Loader } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import type { AdminAiSettingsResponse } from "@/app/api/admin/ai/settings/route"

const fmtUsd = (n: number) =>
  `$${n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtDate = (v: string | Date) =>
  new Date(v).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })

export function AdminAiMarkup({
  periodCost,
  onSaved,
}: {
  // Gateway cost of the selected period, for the example line.
  periodCost: number | null
  onSaved?: () => void
}) {
  const [settings, setSettings] = useState<AdminAiSettingsResponse | null>(null)
  const [draft, setDraft] = useState("")
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/ai/settings")
    if (!r.ok) return
    const d = (await r.json()) as AdminAiSettingsResponse
    setSettings(d)
    setDraft(String(d.markupPercent))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const value = Number(draft.replace(",", "."))
  const valid = draft.trim() !== "" && Number.isFinite(value) && value >= 0 && value <= 1000
  const dirty = settings != null && valid && value !== settings.markupPercent
  const example = periodCost && periodCost > 0 ? periodCost : 10

  const save = async () => {
    setSaving(true)
    try {
      const r = await fetch("/api/admin/ai/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markupPercent: value }),
      })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`)
      toast.success("Наценка сохранена. Действует для новых вызовов.")
      await load()
      onSaved?.()
    } catch (e) {
      toast.error(`Не удалось сохранить: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  const last = settings?.markupLog[0]

  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="text-sm font-medium">Наценка</CardTitle>
        <CardDescription className="text-xs">
          Процент сверху стоимости шлюза. Клиенты видят только стоимость с наценкой. Изменение
          действует для новых вызовов, прошлые суммы не меняются.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!settings ? (
          <Loader className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-sm" htmlFor="ai-markup">
                Наценка, %
              </label>
              <Input
                id="ai-markup"
                inputMode="decimal"
                className="h-8 w-28"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                aria-invalid={!valid}
              />
              <Button size="sm" onClick={save} disabled={!dirty || saving}>
                {saving && <Loader className="h-4 w-4 animate-spin" />}
                Сохранить
              </Button>
              {valid && (
                <span className="text-sm text-muted-foreground">
                  Себестоимость {fmtUsd(example)} → для клиента {fmtUsd(example * (1 + value / 100))}
                </span>
              )}
              {!valid && <span className="text-sm text-red-500">Число от 0 до 1000</span>}
            </div>
            <div className="text-xs text-muted-foreground">
              {last
                ? `Изменено ${fmtDate(last.changedAt)}${last.changedBy ? `, ${last.changedBy}` : ""}`
                : "Ещё не задавалась (0 %)"}
            </div>
            {settings.markupLog.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">История изменений</summary>
                <ul className="mt-2 space-y-1">
                  {settings.markupLog.map((l) => (
                    <li key={l.id}>
                      {fmtDate(l.changedAt)} · {l.changedBy ?? "—"}: {String(l.oldValue ?? 0)} % →{" "}
                      {String(l.newValue)} %
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

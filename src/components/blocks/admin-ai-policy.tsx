"use client"

// Model policy block on the «Процессы ИИ» tab (docs/specs/models/03 §7):
// rules for ALL AI processes. ZDR / no-training also make the gateway route
// every call only to compliant providers. A save that would leave a process
// without any compliant model is refused (the server lists those processes).

import { useCallback, useEffect, useState } from "react"
import { Loader } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { MultiCheckSelect } from "@/components/blocks/admin-ai-models"
import type { AdminAiSettingsResponse } from "@/app/api/admin/ai/settings/route"

type Policy = AdminAiSettingsResponse["policy"]

const same = (a: Policy, b: Policy) =>
  a.zdrOnly === b.zdrOnly &&
  a.noTrainingOnly === b.noTrainingOnly &&
  [...a.allowedVendors].sort().join() === [...b.allowedVendors].sort().join()

export function AdminAiPolicy({ onSaved }: { onSaved?: () => void }) {
  const [settings, setSettings] = useState<AdminAiSettingsResponse | null>(null)
  const [draft, setDraft] = useState<Policy | null>(null)
  const [saving, setSaving] = useState(false)
  const [blocked, setBlocked] = useState<{ error: string; processes: string[] } | null>(null)

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/ai/settings")
    if (!r.ok) return
    const d = (await r.json()) as AdminAiSettingsResponse
    setSettings(d)
    setDraft(d.policy)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const save = async () => {
    if (!draft) return
    setSaving(true)
    setBlocked(null)
    try {
      const r = await fetch("/api/admin/ai/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policy: draft }),
      })
      const d = (await r.json().catch(() => ({}))) as { error?: string; blockedProcesses?: string[] }
      if (r.status === 409) {
        setBlocked({ error: d.error ?? "", processes: d.blockedProcesses ?? [] })
        return
      }
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`)
      toast.success("Правила сохранены. Действуют для новых вызовов (до 1 минуты).")
      await load()
      onSaved?.()
    } catch (e) {
      toast.error(`Не удалось сохранить: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="text-sm font-medium">Правила выбора моделей</CardTitle>
        <CardDescription className="text-xs">
          Действуют для всех процессов: несовместимые модели нельзя выбрать, а шлюз
          направляет каждый вызов только к поставщикам, которые соблюдают правила.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!settings || !draft ? (
          <Loader className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={draft.zdrOnly}
                  onCheckedChange={(v) => setDraft({ ...draft, zdrOnly: v === true })}
                />
                Только с нулевым хранением данных (ZDR)
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={draft.noTrainingOnly}
                  onCheckedChange={(v) => setDraft({ ...draft, noTrainingOnly: v === true })}
                />
                Только без обучения на данных
              </label>
              <div className="flex items-center gap-2 text-sm">
                <span>Разрешённые разработчики</span>
                <MultiCheckSelect
                  label="Разработчики"
                  emptyLabel="Все разработчики"
                  options={settings.vendors.map((v) => ({ value: v, label: v }))}
                  values={draft.allowedVendors}
                  onChange={(allowedVendors) => setDraft({ ...draft, allowedVendors })}
                  searchable
                />
              </div>
              <Button size="sm" onClick={save} disabled={saving || same(draft, settings.policy)}>
                {saving && <Loader className="h-4 w-4 animate-spin" />}
                Сохранить
              </Button>
            </div>
            {blocked && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                <div>Не сохранено. {blocked.error}</div>
                <ul className="mt-1 list-disc pl-5">
                  {blocked.processes.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

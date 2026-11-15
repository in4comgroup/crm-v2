"use client"

// Org setting `clients.enrichOnCreate` (identity I6, Q6): web enrichment of
// every NEW company (manual create + discovery) right after it is created.
// Any member sees the state; the org owner and platform admins switch it
// (PUT /api/clients/enrich/settings → 403 for others).

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import type { EnrichOnCreateSetting } from "@/app/api/clients/enrich/settings/route"

export function ClientEnrichOnCreateSwitch() {
  const [state, setState] = useState<EnrichOnCreateSetting | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch("/api/clients/enrich/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setState(d))
      .catch(() => setState(null))
  }, [])

  if (!state) return null

  const change = async (value: boolean) => {
    setSaving(true)
    try {
      const res = await fetch("/api/clients/enrich/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? "Не удалось сохранить настройку")
        return
      }
      setState(data)
      toast.success(value ? "Новые компании будут заполняться из интернета" : "Заполнение новых компаний выключено")
    } catch {
      toast.error("Не удалось сохранить настройку")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-start gap-3">
      <Switch
        id="client-enrich-on-create"
        checked={state.value}
        disabled={!state.canManage || saving}
        onCheckedChange={(v) => void change(v)}
      />
      <div className="space-y-1">
        <Label htmlFor="client-enrich-on-create" className="text-sm font-medium">
          Заполнять профиль новых компаний из интернета
        </Label>
        <p className="text-xs text-muted-foreground">
          Расход ИИ на каждую новую компанию.
          {!state.canManage && " Меняет владелец организации."}
        </p>
      </div>
    </div>
  )
}

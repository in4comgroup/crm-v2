"use client"

// Org setting `discovery.autoApply` «Создавать компании и контакты
// автоматически» (2026-11-24, src/server/discovery-auto.ts). Shown to the org
// owner on Sources → «Управление»; any member sees the state, the org owner
// and platform admins switch it (PUT /api/sources/auto-discovery).

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import type { AutoDiscoverySetting } from "@/app/api/sources/auto-discovery/route"

export function AutoDiscoverySwitch() {
  const [state, setState] = useState<AutoDiscoverySetting | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch("/api/sources/auto-discovery")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setState(d))
      .catch(() => setState(null))
  }, [])

  if (!state) return null

  const change = async (value: boolean) => {
    setSaving(true)
    try {
      const res = await fetch("/api/sources/auto-discovery", {
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
      toast.success(
        value
          ? "Компании и контакты будут создаваться автоматически"
          : "Автоматическое создание компаний и контактов выключено",
      )
    } catch {
      toast.error("Не удалось сохранить настройку")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-start gap-3">
      <Switch
        id="auto-discovery"
        checked={state.value}
        disabled={!state.canManage || saving}
        onCheckedChange={(v) => void change(v)}
      />
      <div className="space-y-1">
        <Label htmlFor="auto-discovery" className="text-sm font-medium">
          Создавать компании и контакты автоматически
        </Label>
        <p className="text-xs text-muted-foreground">
          После автоматического разбора новых писем и сообщений система сама делает то же, что кнопка «Найти в
          источниках» → «Применить»: создаёт компании, контакты и связи с высокой и средней уверенностью (статус
          «Новая» / «Новый», ответственный — владелец организации). Возможные дубликаты и сомнительные находки остаются для
          проверки в «Найти в источниках». Расхода ИИ нет.
          {!state.canManage && " Меняет владелец организации."}
        </p>
      </div>
    </div>
  )
}

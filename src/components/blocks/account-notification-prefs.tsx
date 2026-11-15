"use client"

// «Уведомления в приложении» on /account → «Уведомления»
// (docs/specs/notifications §6, Q8): the current user's own choice per
// notification category in the active org. Important notifications of some
// categories always arrive (`importantAlwaysOn`). Any member.
// Data: GET / PUT /api/account/notification-prefs.

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { PageLoader } from "@/components/blocks/page-loader"
import type { NotificationCategory, NotificationPrefsView } from "@/lib/notifications/kinds"

export function AccountNotificationPrefs() {
  const [view, setView] = useState<NotificationPrefsView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<NotificationCategory | null>(null)

  useEffect(() => {
    fetch("/api/account/notification-prefs")
      .then(async (r) => {
        const d = await r.json()
        if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`)
        setView(d as NotificationPrefsView)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  const save = async (category: NotificationCategory, enabled: boolean) => {
    if (!view) return
    const before = view
    setView({
      categories: view.categories.map((c) => (c.category === category ? { ...c, enabled } : c)),
    })
    setSaving(category)
    try {
      const r = await fetch("/api/account/notification-prefs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories: { [category]: enabled } }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`)
      setView(d as NotificationPrefsView)
    } catch (e) {
      setView(before)
      toast.error(`Не удалось сохранить: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSaving(null)
    }
  }

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!view) return <PageLoader />

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-base">Уведомления в приложении</CardTitle>
        <CardDescription>
          Какие уведомления показывать под колокольчиком в шапке страницы. Настройка действует только для вас в этой
          организации.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {view.categories.map((c) => {
          const id = `notif-pref-${c.category}`
          return (
            <div key={c.category} className="flex items-start justify-between gap-4">
              <div>
                <Label htmlFor={id} className="cursor-pointer">
                  {c.label}
                </Label>
                {c.importantAlwaysOn && (
                  <p className="text-sm text-muted-foreground">Важные приходят всегда</p>
                )}
              </div>
              <Switch
                id={id}
                checked={c.enabled}
                disabled={saving !== null}
                onCheckedChange={(v) => void save(c.category, v)}
              />
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

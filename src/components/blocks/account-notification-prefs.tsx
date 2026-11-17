"use client"

// «Уведомления в приложении» on /account → «Уведомления»
// (docs/specs/notifications §6, Q8): the current user's own choice per
// notification category in the active org. Important notifications of some
// categories always arrive (`importantAlwaysOn`). Second column «Telegram» =
// a Telegram copy of the category's IMPORTANT notifications (docs/specs/telegram/04
// Q21) — usable only after the member linked Telegram on /profile. Any member.
// Data: GET / PUT /api/account/notification-prefs.

import { useEffect, useState } from "react"
import Link from "next/link"
import { Info } from "lucide-react"
import { toast } from "sonner"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { AnchorTooltip, useAnchorTooltip } from "@/components/blocks/anchor-tooltip"
import { PageLoader } from "@/components/blocks/page-loader"
import type { NotificationCategory, NotificationPrefsView } from "@/lib/notifications/kinds"

/** Which switch of a category: in the app (`categories`) or the Telegram copy (`telegram`). */
type PrefColumn = "categories" | "telegram"

export function AccountNotificationPrefs() {
  const [view, setView] = useState<NotificationPrefsView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<NotificationCategory | null>(null)
  const tgTip = useAnchorTooltip()

  useEffect(() => {
    fetch("/api/account/notification-prefs")
      .then(async (r) => {
        const d = await r.json()
        if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`)
        setView(d as NotificationPrefsView)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  const save = async (column: PrefColumn, category: NotificationCategory, value: boolean) => {
    if (!view) return
    const before = view
    const field = column === "categories" ? "enabled" : "telegram"
    setView({
      ...view,
      categories: view.categories.map((c) => (c.category === category ? { ...c, [field]: value } : c)),
    })
    setSaving(category)
    try {
      const r = await fetch("/api/account/notification-prefs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [column]: { [category]: value } }),
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
        <div className="grid grid-cols-[1fr_auto_auto] items-start gap-x-6 gap-y-4">
          <span />
          <span className="text-xs text-muted-foreground">В приложении</span>
          <span
            className="inline-flex items-center gap-1 text-xs text-muted-foreground cursor-help"
            aria-label="копия важных уведомлений в Telegram"
            {...tgTip.bind}
          >
            Telegram
            <Info className="h-3.5 w-3.5" />
          </span>
          {view.categories.map((c) => {
            const id = `notif-pref-${c.category}`
            return (
              <div key={c.category} className="contents">
                <div>
                  <Label htmlFor={id} className="cursor-pointer">
                    {c.label}
                  </Label>
                  {c.importantAlwaysOn && (
                    <p className="text-sm text-muted-foreground">Важные приходят всегда</p>
                  )}
                </div>
                <div className="flex justify-center">
                  <Switch
                    id={id}
                    checked={c.enabled}
                    disabled={saving !== null}
                    onCheckedChange={(v) => void save("categories", c.category, v)}
                  />
                </div>
                <div className="flex justify-center">
                  <Switch
                    checked={c.telegram}
                    disabled={!view.telegramBound || saving !== null}
                    aria-label={`${c.label}: копия важных уведомлений в Telegram`}
                    onCheckedChange={(v) => void save("telegram", c.category, v)}
                  />
                </div>
              </div>
            )
          })}
        </div>
        {!view.telegramBound && (
          <p className="text-sm text-muted-foreground">
            Чтобы получать важные уведомления в Telegram, привяжите его:{" "}
            <Link href="/profile" className="underline underline-offset-2 hover:text-foreground">
              Профиль → Telegram
            </Link>
          </p>
        )}
        <AnchorTooltip
          text="Важные уведомления этой категории приходят и в Telegram — в рабочее время"
          open={tgTip.open}
          virtualRef={tgTip.virtualRef}
        />
      </CardContent>
    </Card>
  )
}

"use client"

// «Уведомления по темам» on /account (topics plan phase 7): the current
// user's email choices in the active org — morning digest, weekly digest,
// evening reminders — and the Telegram topic pushes (topics/08 T2: enabled
// only when the org has a bot, the member linked Telegram on /profile and the
// platform admin switch is on). Rendered only when the org's topics mode is
// `on` (the page decides). Data: /api/account/topic-delivery.

import { useEffect, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { PageLoader } from "@/components/blocks/page-loader"
import type { AccountDeliveryView } from "@/app/api/account/topic-delivery/route"

type PrefKey = keyof AccountDeliveryView["prefs"]
type SaveKey = PrefKey | "telegramEnabled"

const WEEKDAY_RU = ["", "в понедельник", "во вторник", "в среду", "в четверг", "в пятницу", "в субботу", "в воскресенье"]

export function AccountTopicDelivery() {
  const [view, setView] = useState<AccountDeliveryView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<SaveKey | null>(null)

  useEffect(() => {
    fetch("/api/account/topic-delivery")
      .then(async (r) => {
        const d = await r.json()
        if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`)
        setView(d as AccountDeliveryView)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  const save = async (key: SaveKey, value: boolean) => {
    if (!view) return
    const before = view
    setView(
      key === "telegramEnabled"
        ? { ...view, telegram: { ...view.telegram, enabled: value } }
        : { ...view, prefs: { ...view.prefs, [key]: value } },
    )
    setSaving(key)
    try {
      const r = await fetch("/api/account/topic-delivery", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`)
      setView(d as AccountDeliveryView)
    } catch (e) {
      setView(before)
      toast.error(`Не удалось сохранить: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSaving(null)
    }
  }

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!view) return <PageLoader />
  const s = view.schedule
  const tg = view.telegram
  const tgUsable = tg.available && tg.bound && tg.orgOn

  const rows: { key: PrefKey; title: string; hint: string }[] = [
    {
      key: "emailMorning",
      title: "Утренняя сводка",
      hint: `Каждый рабочий день в ${s.morning}: темы «Сейчас» и «Сводка».`,
    },
    {
      key: "emailWeekly",
      title: "Итоги недели",
      hint: `${WEEKDAY_RU[s.weeklyWeekday] ?? ""} в ${s.weekly}: темы «Неделя», «Истекло», «Тема затихла».`.replace(/^./, (c) => c.toUpperCase()),
    },
    {
      key: "emailEvening",
      title: "Вечерние напоминания",
      hint: `В рабочие дни в ${s.evening}: темы, по которым ждут нашего ответа («Не закрыто сегодня»).`,
    },
  ]

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-base">Уведомления по темам</CardTitle>
        <CardDescription>
          Письма приходят на адрес вашего профиля. Время — {s.timeZone}. Вы получаете темы, где вы ответственный или
          владелец сделки, и общие темы без ответственного.
          {!view.orgEmailOn && " Сейчас рассылка для организации ещё не включена — письма начнут приходить после включения."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {rows.map((r) => (
          <div key={r.key} className="flex items-start justify-between gap-4">
            <div>
              <Label htmlFor={`delivery-${r.key}`} className="cursor-pointer">
                {r.title}
              </Label>
              <p className="text-sm text-muted-foreground">{r.hint}</p>
            </div>
            <Switch
              id={`delivery-${r.key}`}
              checked={view.prefs[r.key]}
              disabled={saving !== null}
              onCheckedChange={(v) => void save(r.key, v)}
            />
          </div>
        ))}
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="delivery-telegram" className={tgUsable ? "cursor-pointer" : undefined}>
              Темы в Telegram
            </Label>
            <p className="text-sm text-muted-foreground">
              Сообщение в Telegram, когда тема попадает в «Сейчас»: с кнопками «Готово» и «Отложить до завтра». Только
              в рабочее время, не больше 2 сообщений по одной теме за 7 дней.
            </p>
            {!tg.available ? (
              <p className="text-sm text-muted-foreground pt-1">В организации не подключён Telegram-бот.</p>
            ) : !tg.bound ? (
              <p className="text-sm text-muted-foreground pt-1">
                Сначала привяжите Telegram:{" "}
                <Link href="/profile" className="underline underline-offset-2 hover:text-foreground">
                  Профиль → Telegram
                </Link>
              </p>
            ) : !tg.orgOn ? (
              <p className="text-sm text-muted-foreground pt-1">Сообщения в Telegram выключены администратором платформы.</p>
            ) : null}
          </div>
          <Switch
            id="delivery-telegram"
            checked={tg.enabled}
            disabled={!tgUsable || saving !== null}
            onCheckedChange={(v) => void save("telegramEnabled", v)}
          />
        </div>
      </CardContent>
    </Card>
  )
}

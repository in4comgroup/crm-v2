"use client"

// Telegram source → «ИИ-чат в Telegram» (docs/specs/ai-chat-telegram §13, Q1,
// §11): the org switch of the AI chat in the bot's private chats (saved at
// once, independent of the provider-config form's «Сохранить») and the list
// of members who bound their Telegram. Any member reads the switch; only the
// org owner switches it, sees the members and unbinds them.

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

type TelegramBindingRow = {
  userId: string
  name: string
  email: string
  tgUsername: string | null
  tgName: string | null
  status: string
  boundAt: string
  lastSeenAt: string | null
}

type TelegramSourceSettings = {
  aiChatEnabled: boolean
  canManage: boolean
  botUsername: string | null
  bindings: TelegramBindingRow[]
}

const ENDPOINT = "/api/sources/telegram/settings"

async function send(
  method: "GET" | "PUT" | "POST",
  sourceId: string,
  body?: Record<string, unknown>,
): Promise<{ ok: true; settings: TelegramSourceSettings } | { ok: false; error: string }> {
  try {
    const res =
      method === "GET"
        ? await fetch(`${ENDPOINT}?sourceId=${encodeURIComponent(sourceId)}`)
        : await fetch(ENDPOINT, {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sourceId, ...body }),
          })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.settings) return { ok: false, error: data.error ?? "Не удалось выполнить действие" }
    return { ok: true, settings: data.settings as TelegramSourceSettings }
  } catch {
    return { ok: false, error: "Не удалось выполнить действие" }
  }
}

function telegramLabel(b: TelegramBindingRow): string | null {
  const handle = b.tgUsername ? `@${b.tgUsername.replace(/^@/, "")}` : null
  if (handle && b.tgName) return `${handle} · ${b.tgName}`
  return handle ?? b.tgName
}

export function TelegramAiChatSettings({ sourceId }: { sourceId: string }) {
  const [settings, setSettings] = useState<TelegramSourceSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [unbinding, setUnbinding] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    send("GET", sourceId).then((r) => {
      if (cancelled) return
      if (r.ok) setSettings(r.settings)
      else setError(r.error)
    })
    return () => {
      cancelled = true
    }
  }, [sourceId])

  const toggle = async (value: boolean) => {
    setSaving(true)
    const r = await send("PUT", sourceId, { aiChatEnabled: value })
    setSaving(false)
    if (!r.ok) {
      toast.error(r.error)
      return
    }
    setSettings(r.settings)
    toast.success(value ? "ИИ-чат в Telegram включён" : "ИИ-чат в Telegram выключен")
  }

  const unbind = useCallback(
    async (userId: string) => {
      setUnbinding(userId)
      const r = await send("POST", sourceId, { action: "unbind", userId })
      setUnbinding(null)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      setSettings(r.settings)
      toast.success("Telegram сотрудника отвязан")
    },
    [sourceId],
  )

  return (
    <div className="space-y-3 rounded-md border p-3 text-sm">
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : settings === null ? (
        <p className="text-xs text-muted-foreground">Загрузка…</p>
      ) : (
        <>
          <div className="flex items-start gap-3">
            <Switch
              id={`telegram-ai-chat-${sourceId}`}
              checked={settings.aiChatEnabled}
              disabled={!settings.canManage || saving}
              onCheckedChange={(v) => void toggle(v)}
            />
            <div className="space-y-1">
              <Label htmlFor={`telegram-ai-chat-${sourceId}`} className="font-medium">
                ИИ-чат в Telegram
              </Label>
              <p className="text-xs text-muted-foreground">
                Сотрудники, привязавшие Telegram, могут задавать вопросы ИИ-чату в личном чате с ботом. Данные CRM
                (названия, суммы, телефоны) будут видны в Telegram — это облачный чат без сквозного шифрования.
                {!settings.canManage && " Меняет владелец организации."}
              </p>
            </div>
          </div>

          {settings.canManage && (
            <div className="space-y-2">
              <div className="font-medium">Привязанные сотрудники ({settings.bindings.length})</div>
              {settings.bindings.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Пока никто не привязал Telegram. Сотрудник делает это сам: Профиль → Telegram.
                </p>
              ) : (
                <ul className="divide-y">
                  {settings.bindings.map((b) => {
                    const tg = telegramLabel(b)
                    return (
                      <li key={b.userId} className="flex items-center gap-2 py-1.5">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate">{b.name || b.email}</span>
                            {b.status === "blocked" && (
                              <Badge
                                variant="outline"
                                className="border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-400"
                              >
                                заблокировал бота
                              </Badge>
                            )}
                          </div>
                          {tg && <div className="truncate text-xs text-muted-foreground">{tg}</div>}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={unbinding !== null}
                          onClick={() => void unbind(b.userId)}
                        >
                          {unbinding === b.userId ? "Отвязка…" : "Отвязать"}
                        </Button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

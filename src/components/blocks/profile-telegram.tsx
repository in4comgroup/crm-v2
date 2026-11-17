"use client"

// /profile → «Telegram» (docs/specs/telegram/04 §5.2, docs/specs/ai-chat-telegram
// §13): the member binds their own Telegram account to the org bot through a
// one-time deep link (15 min), sees the binding and unbinds it. The bot then
// sends CRM notifications and, when the org owner switched it on, answers as
// the AI chat. Org + user come from the session on the server.

import { useCallback, useEffect, useState } from "react"
import { Copy, ExternalLink, Send } from "lucide-react"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { LoadingButton } from "@/components/blocks/loading-button"

type TelegramBindingView = {
  status: "active" | "blocked"
  tgUsername: string | null
  tgName: string | null
  boundAt: string
  lastSeenAt: string | null
}

type MyTelegramView = {
  available: boolean
  botUsername: string | null
  aiChatEnabled: boolean
  binding: TelegramBindingView | null
}

type LinkResult = { deepLink: string; expiresAt: string; botUsername: string }

async function fetchView(): Promise<{ ok: true; view: MyTelegramView } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/account/telegram")
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.view) return { ok: false, error: data.error ?? "Не удалось загрузить Telegram" }
    return { ok: true, view: data.view as MyTelegramView }
  } catch {
    return { ok: false, error: "Не удалось загрузить Telegram" }
  }
}

async function postAction<T>(action: "link" | "unlink"): Promise<T | null> {
  try {
    const res = await fetch("/api/account/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(data.error ?? "Не удалось выполнить действие")
      return null
    }
    return data as T
  } catch {
    toast.error("Не удалось выполнить действие")
    return null
  }
}

const TIME = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" })

function boundLabel(b: TelegramBindingView): string {
  const handle = b.tgUsername ? `@${b.tgUsername.replace(/^@/, "")}` : null
  if (handle && b.tgName) return `${handle} (${b.tgName})`
  return handle ?? b.tgName ?? "аккаунт Telegram"
}

export function ProfileTelegram() {
  const [view, setView] = useState<MyTelegramView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [link, setLink] = useState<LinkResult | null>(null)
  const [linking, setLinking] = useState(false)
  const [checking, setChecking] = useState(false)
  const [unlinking, setUnlinking] = useState(false)
  const [confirmUnlink, setConfirmUnlink] = useState(false)

  const apply = useCallback((r: { ok: true; view: MyTelegramView } | { ok: false; error: string }) => {
    if (!r.ok) {
      setError(r.error)
      return
    }
    setError(null)
    setView(r.view)
    // A finished binding makes the pending deep link useless.
    if (r.view.binding) setLink(null)
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchView().then((r) => {
      if (!cancelled) apply(r)
    })
    return () => {
      cancelled = true
    }
  }, [apply])

  const startLink = async () => {
    setLinking(true)
    const r = await postAction<LinkResult>("link")
    setLinking(false)
    if (r?.deepLink) setLink(r)
  }

  const check = async () => {
    setChecking(true)
    const r = await fetchView()
    setChecking(false)
    apply(r)
    if (r.ok) {
      if (r.view.binding) toast.success("Telegram привязан")
      else toast.info("Привязка ещё не завершена. Откройте бота и нажмите «Старт».")
    }
  }

  const unlink = async () => {
    setUnlinking(true)
    const r = await postAction<{ ok: boolean }>("unlink")
    setUnlinking(false)
    if (!r) return
    toast.success("Telegram отвязан")
    apply(await fetchView())
  }

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      toast.success("Ссылка скопирована")
    } catch {
      toast.error("Не удалось скопировать ссылку")
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-medium">Telegram</CardTitle>
        {view?.available && !view.binding && (
          <CardDescription>
            Привяжите свой Telegram: бот будет присылать уведомления CRM, а если владелец включил ИИ-чат — отвечать
            на вопросы о клиентах, сделках и задачах.
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error ? (
          <span className="text-sm text-destructive">{error}</span>
        ) : view === null ? (
          <span className="text-sm text-muted-foreground">Загрузка…</span>
        ) : !view.available ? (
          <span className="text-sm text-muted-foreground">
            В организации не подключён Telegram-бот. Его подключает владелец организации на странице «Источники».
          </span>
        ) : view.binding ? (
          <div className="flex flex-col gap-2 text-sm">
            <div>
              Привязан: <span className="font-medium">{boundLabel(view.binding)}</span>
            </div>
            {view.binding.status === "blocked" ? (
              <div className="text-amber-700 dark:text-amber-400">
                Вы заблокировали бота в Telegram — разблокируйте его, чтобы получать сообщения
              </div>
            ) : (
              <div className="text-emerald-700 dark:text-emerald-400">Бот может присылать вам сообщения</div>
            )}
            <div className="text-muted-foreground">
              ИИ-чат в Telegram: {view.aiChatEnabled ? "доступен" : "выключен владельцем организации"}
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {view.botUsername && (
                <Button variant="outline" size="sm" asChild>
                  <a href={`https://t.me/${view.botUsername}`} target="_blank" rel="noopener noreferrer">
                    <Send className="size-4" />
                    Открыть бота
                  </a>
                </Button>
              )}
              <LoadingButton
                variant="outline"
                size="sm"
                loading={unlinking}
                onClick={() => setConfirmUnlink(true)}
              >
                Отвязать
              </LoadingButton>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 text-sm">
            {!link ? (
              <div>
                <LoadingButton size="sm" loading={linking} onClick={() => void startLink()}>
                  <Send className="size-4" />
                  Подключить Telegram
                </LoadingButton>
              </div>
            ) : (
              <div className="flex flex-col gap-2 rounded-md border p-3 lg:w-2/3">
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" asChild>
                    <a href={link.deepLink} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="size-4" />
                      Открыть Telegram
                    </a>
                  </Button>
                  <LoadingButton variant="outline" size="sm" loading={checking} onClick={() => void check()}>
                    Проверить
                  </LoadingButton>
                </div>
                <div className="flex min-w-0 items-center gap-1">
                  <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs">{link.deepLink}</code>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => void copyLink(link.deepLink)}
                    aria-label="Скопировать ссылку"
                  >
                    <Copy className="size-3.5" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Откройте ссылку на устройстве с Telegram и нажмите «Старт» в чате с ботом, затем вернитесь сюда и
                  нажмите «Проверить». Ссылка действует 15 минут
                  {Number.isNaN(new Date(link.expiresAt).getTime())
                    ? ""
                    : ` (до ${TIME.format(new Date(link.expiresAt))})`}
                  .
                </p>
              </div>
            )}
          </div>
        )}

        {view?.available && (
          <p className="text-xs text-muted-foreground">
            Сообщения ИИ-чата хранятся в Telegram на серверах Telegram (облачный чат, без сквозного шифрования).
          </p>
        )}
      </CardContent>

      <AlertDialog open={confirmUnlink} onOpenChange={setConfirmUnlink}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Отвязать Telegram?</AlertDialogTitle>
            <AlertDialogDescription>
              Бот перестанет присылать вам уведомления и отвечать на вопросы. Привязать Telegram снова можно в любой
              момент.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={() => void unlink()}>Отвязать</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

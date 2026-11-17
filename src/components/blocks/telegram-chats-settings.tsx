"use client"

// Telegram source → «Группы» (docs/specs/telegram/04 §7.2–§7.4, TI4): every
// chat the org bot sees + companies' accounts typed by @name, with the chat
// binding per row — mode «Авто (по авторам)» / «Компании» (one or more
// companies, exactly one primary) / «Внутренний чат», binding suggestions
// (§7.3, «Привязать» / «Нет») and «Не анализировать» (= a chat exclusion,
// org owner only, `/api/sources/exclusions`).
//
// Who may change a binding (Q24): the org owner, or the «Ответственный» of
// every company the change touches; «Внутренний чат» = owner only. The API is
// the gate — a 403 carries a Russian message, shown as a toast.
//
// Data: GET /api/telegram/chats?sourceId=, PUT /api/telegram/chats/<id>,
// POST /api/telegram/chat-suggestions/<id>, GET /api/contacts?clientOptions=1
// (company picker), GET / POST / DELETE /api/sources/exclusions. No DB here.
// Every button is type="button": this block sits inside the source dialog.

import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { ChevronsUpDown, Loader, Star, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { AnchorTooltip, useAnchorTooltip } from "@/components/blocks/anchor-tooltip"
import { cn } from "@/lib/utils"
import type { TelegramChatView } from "@/server/telegram/chats"
import type { AnalysisExclusionRow } from "@/app/api/sources/exclusions/route"

type ChatMode = TelegramChatView["mode"]
type ClientOption = { id: string; name: string }
type DraftClient = { id: string; name: string; isPrimary: boolean }

const MODE_LABEL: Record<ChatMode, string> = {
  auto: "Авто (по авторам)",
  clients: "Компании",
  internal: "Внутренний чат",
}

const SUGGESTION_REASON: Record<string, string> = {
  title: "по названию",
  authors: "по авторам",
}

/** Display name of a chat row: title, else @username, else the chat id. */
export function telegramChatLabel(c: { title: string | null; username: string | null; chatId?: string | null }): string {
  if (c.title) return c.title
  if (c.username) return `@${c.username.replace(/^@/, "")}`
  return c.chatId ?? "Без названия"
}

/** Russian type badge of a chat row (private chat = a company's account). */
export function telegramChatTypeLabel(type: string): string | null {
  if (type === "group" || type === "supergroup") return "группа"
  if (type === "private") return "аккаунт компании"
  if (type === "channel") return "канал"
  return null
}

function fmtDate(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("ru-RU")
}

function botRemoved(status: string | null): boolean {
  return status === "left" || status === "kicked"
}

/** The exclusion entry of a chat: value `telegram:<chatId>` (or its @username). */
function exclusionOf(entries: AnalysisExclusionRow[], chat: TelegramChatView): AnalysisExclusionRow | null {
  const keys = new Set<string>()
  if (chat.chatId) keys.add(`telegram:${chat.chatId}`)
  if (chat.username) keys.add(`telegram:@${chat.username.replace(/^@/, "").toLowerCase()}`)
  return (
    entries.find(
      (e) => e.kind === "chat" && (keys.has(e.normalizedValue) || keys.has(e.value.trim().toLowerCase())),
    ) ?? null
  )
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>
}

function errorOf(data: Record<string, unknown>, fallback: string): string {
  return typeof data.error === "string" && data.error ? data.error : fallback
}

// Signature of the saved binding: a row remounts (= its draft resets) only
// when ITS binding changed, so other rows keep their unsaved edits.
function bindingKey(c: TelegramChatView): string {
  return `${c.id}:${c.mode}:${c.clients.map((x) => `${x.id}${x.isPrimary ? "*" : ""}`).join(",")}`
}

export function TelegramChatsSettings({ sourceId }: { sourceId: string }) {
  const [chats, setChats] = useState<TelegramChatView[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [exclusions, setExclusions] = useState<AnalysisExclusionRow[]>([])
  const [canManageExclusions, setCanManageExclusions] = useState(false)
  const [options, setOptions] = useState<ClientOption[]>([])

  const loadChats = useCallback(async () => {
    setLoadError(null)
    try {
      const res = await fetch(`/api/telegram/chats?sourceId=${encodeURIComponent(sourceId)}`)
      const data = await readJson(res)
      if (!res.ok) {
        setLoadError(errorOf(data, "Не удалось загрузить чаты"))
        return
      }
      setChats((data.chats as TelegramChatView[]) ?? [])
    } catch {
      setLoadError("Не удалось загрузить чаты")
    }
  }, [sourceId])

  const loadExclusions = useCallback(async () => {
    try {
      const res = await fetch("/api/sources/exclusions")
      if (!res.ok) return
      const data = await readJson(res)
      setExclusions((data.entries as AnalysisExclusionRow[]) ?? [])
      setCanManageExclusions(Boolean(data.canManage))
    } catch {
      // Best effort: without the list only the toggle is hidden.
    }
  }, [])

  useEffect(() => {
    void loadChats()
    void loadExclusions()
  }, [loadChats, loadExclusions])

  useEffect(() => {
    let cancelled = false
    fetch("/api/contacts?clientOptions=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { options?: ClientOption[] } | null) => {
        if (!cancelled && d) setOptions(d.options ?? [])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const replaceChat = useCallback((chat: TelegramChatView) => {
    setChats((prev) => (prev ? prev.map((c) => (c.id === chat.id ? chat : c)) : prev))
  }, [])

  async function toggleExclusion(chat: TelegramChatView, on: boolean) {
    if (!chat.chatId) return
    try {
      if (on) {
        const res = await fetch("/api/sources/exclusions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "chat", value: `telegram:${chat.chatId}` }),
        })
        const data = await readJson(res)
        if (!res.ok) throw new Error(errorOf(data, "Не удалось исключить чат"))
        toast.success("Чат не анализируется")
      } else {
        const entry = exclusionOf(exclusions, chat)
        if (!entry) {
          toast.error("Исключение не найдено — удалите его в «Исключения из анализа»")
          return
        }
        const res = await fetch(`/api/sources/exclusions/${encodeURIComponent(entry.id)}`, { method: "DELETE" })
        const data = await readJson(res)
        if (!res.ok) throw new Error(errorOf(data, "Не удалось вернуть чат в анализ"))
        toast.success("Чат снова анализируется")
      }
      await Promise.all([loadExclusions(), loadChats()])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось выполнить действие")
    }
  }

  return (
    <div className="space-y-2">
      {loadError ? (
        <p className="text-xs text-destructive">{loadError}</p>
      ) : chats == null ? (
        <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
          <Loader className="h-3.5 w-3.5 animate-spin" />
          Загрузка…
        </div>
      ) : chats.length === 0 ? (
        <p className="text-xs text-muted-foreground">Бот пока не видит ни одной группы и ни одного аккаунта компании.</p>
      ) : (
        <div className="divide-y rounded-md border">
          {chats.map((c) => (
            <TelegramChatRow
              key={bindingKey(c)}
              chat={c}
              options={options}
              canManageExclusions={canManageExclusions}
              onChat={replaceChat}
              onToggleExclusion={(on) => toggleExclusion(c, on)}
            />
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Привяжите группу к компании — всё из этой группы будет относиться к ней, даже от неизвестных авторов.
        «Внутренний чат» — только наши сотрудники. Привязка действует для новых сообщений.
      </p>
    </div>
  )
}

function TelegramChatRow({
  chat,
  options,
  canManageExclusions,
  onChat,
  onToggleExclusion,
}: {
  chat: TelegramChatView
  options: ClientOption[]
  canManageExclusions: boolean
  onChat: (chat: TelegramChatView) => void
  onToggleExclusion: (on: boolean) => Promise<void>
}) {
  const [mode, setMode] = useState<ChatMode>(chat.mode)
  const [clients, setClients] = useState<DraftClient[]>(chat.clients)
  const [busy, setBusy] = useState(false)
  const [exclBusy, setExclBusy] = useState(false)

  const dirty = useMemo(() => {
    if (mode !== chat.mode) return true
    if (mode !== "clients") return false
    const a = clients.map((c) => `${c.id}${c.isPrimary ? "*" : ""}`).sort().join(",")
    const b = chat.clients.map((c) => `${c.id}${c.isPrimary ? "*" : ""}`).sort().join(",")
    return a !== b
  }, [mode, clients, chat])

  function addClient(o: ClientOption) {
    setClients((prev) =>
      prev.some((c) => c.id === o.id) ? prev : [...prev, { id: o.id, name: o.name, isPrimary: prev.length === 0 }],
    )
  }

  function removeClient(id: string) {
    setClients((prev) => {
      const rest = prev.filter((c) => c.id !== id)
      if (rest.length > 0 && !rest.some((c) => c.isPrimary)) rest[0] = { ...rest[0], isPrimary: true }
      return rest
    })
  }

  function setPrimary(id: string) {
    setClients((prev) => prev.map((c) => ({ ...c, isPrimary: c.id === id })))
  }

  async function save() {
    if (mode === "clients" && clients.length === 0) {
      toast.error("Выберите хотя бы одну компанию")
      return
    }
    setBusy(true)
    try {
      const res = await fetch(`/api/telegram/chats/${encodeURIComponent(chat.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "clients"
            ? { mode, clients: clients.map((c) => ({ clientId: c.id, isPrimary: c.isPrimary })) }
            : { mode },
        ),
      })
      const data = await readJson(res)
      if (!res.ok || !data.chat) throw new Error(errorOf(data, "Не удалось сохранить привязку"))
      toast.success("Привязка сохранена")
      onChat(data.chat as TelegramChatView)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось сохранить привязку")
    } finally {
      setBusy(false)
    }
  }

  async function decide(suggestionId: string, accept: boolean) {
    setBusy(true)
    try {
      const res = await fetch(`/api/telegram/chat-suggestions/${encodeURIComponent(suggestionId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accept }),
      })
      const data = await readJson(res)
      if (!res.ok || !data.chat) throw new Error(errorOf(data, "Не удалось выполнить действие"))
      toast.success(accept ? "Чат привязан к компании" : "Предложение отклонено")
      onChat(data.chat as TelegramChatView)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось выполнить действие")
    } finally {
      setBusy(false)
    }
  }

  const typeLabel = telegramChatTypeLabel(chat.type)
  const removed = botRemoved(chat.botStatus)
  const choices = options.filter((o) => !clients.some((c) => c.id === o.id))

  return (
    <div className={cn("space-y-2 px-3 py-2.5 text-sm", removed && "opacity-70")}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="min-w-0 truncate font-medium">{telegramChatLabel(chat)}</span>
        {chat.waitingFirstMessage ? (
          <Badge variant="outline" className="font-normal">ждём первое сообщение</Badge>
        ) : (
          typeLabel && <Badge variant="secondary" className="font-normal">{typeLabel}</Badge>
        )}
        {chat.excluded && (
          <Badge variant="outline" className="border-amber-500/60 font-normal text-amber-700 dark:text-amber-400">
            не анализируется
          </Badge>
        )}
        {removed && <span className="text-xs text-muted-foreground">бот удалён</span>}
        {chat.lastMessageAt && (
          <span className="ml-auto text-xs text-muted-foreground">
            последнее сообщение {fmtDate(chat.lastMessageAt)}
          </span>
        )}
      </div>

      {chat.suggestions.map((s) => (
        <div key={s.id} className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">
            Похоже на компанию «{s.clientName}» ({SUGGESTION_REASON[s.reason] ?? s.reason})
          </span>
          <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={busy} onClick={() => void decide(s.id, true)}>
            Привязать
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={busy} onClick={() => void decide(s.id, false)}>
            Нет
          </Button>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <Select value={mode} onValueChange={(v) => setMode(v as ChatMode)}>
          <SelectTrigger size="sm" className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(MODE_LABEL) as ChatMode[]).map((m) => (
              <SelectItem key={m} value={m}>
                {MODE_LABEL[m]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {mode === "clients" && <CompanyPicker choices={choices} onPick={addClient} />}
        <Button type="button" size="sm" className="ml-auto h-8" disabled={busy || !dirty} onClick={() => void save()}>
          {busy && <Loader className="mr-1 h-3.5 w-3.5 animate-spin" />}
          Сохранить
        </Button>
      </div>

      {mode === "clients" && (
        clients.length === 0 ? (
          <p className="text-xs text-muted-foreground">Компании не выбраны.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {clients.map((c) => (
              <span key={c.id} className="inline-flex items-center gap-1 rounded-md border py-0.5 pl-1 pr-1.5 text-xs">
                <PrimaryStar primary={c.isPrimary} onClick={() => setPrimary(c.id)} />
                <span className="max-w-48 truncate">{c.name}</span>
                {c.isPrimary && <span className="text-muted-foreground">основная</span>}
                <button
                  type="button"
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                  aria-label={`Убрать компанию «${c.name}»`}
                  onClick={() => removeClient(c.id)}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )
      )}

      {canManageExclusions && chat.chatId && (
        <div className="flex items-center gap-2">
          <Switch
            id={`tg-chat-excl-${chat.id}`}
            checked={chat.excluded}
            disabled={exclBusy}
            onCheckedChange={async (on) => {
              setExclBusy(true)
              await onToggleExclusion(on)
              setExclBusy(false)
            }}
          />
          <Label htmlFor={`tg-chat-excl-${chat.id}`} className="text-xs font-normal">
            Не анализировать
          </Label>
        </div>
      )}
    </div>
  )
}

function PrimaryStar({ primary, onClick }: { primary: boolean; onClick: () => void }) {
  const tip = useAnchorTooltip()
  return (
    <>
      <button
        type="button"
        className={cn("rounded p-0.5", primary ? "text-amber-500" : "text-muted-foreground hover:text-foreground")}
        aria-label={primary ? "Основная компания" : "Сделать основной"}
        aria-pressed={primary}
        onClick={onClick}
        {...tip.bind}
      >
        <Star className={cn("h-3 w-3", primary && "fill-current")} />
      </button>
      <AnchorTooltip
        text={primary ? "Основная компания чата" : "Сделать основной компанией чата"}
        open={tip.open}
        virtualRef={tip.virtualRef}
      />
    </>
  )
}

function CompanyPicker({ choices, onPick }: { choices: ClientOption[]; onPick: (o: ClientOption) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" role="combobox" aria-expanded={open} className="h-8 justify-between font-normal">
          Добавить компанию
          <ChevronsUpDown className="ml-1 h-3.5 w-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Поиск компании…" />
          <CommandList className="max-h-64">
            <CommandEmpty>Ничего не найдено</CommandEmpty>
            {choices.map((o) => (
              <CommandItem
                key={o.id}
                value={o.id}
                keywords={[o.name]}
                onSelect={() => {
                  onPick(o)
                  setOpen(false)
                }}
              >
                <span className="truncate">{o.name}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

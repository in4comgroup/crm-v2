"use client"

// Company card block «Telegram» (docs/specs/telegram/04 §7.2, Q18, Q25, TI4):
// the client's groups / shared accounts bound to this company («Отвязать»),
// «Добавить» by @name / t.me link (a row waiting for the first message) or
// from the bot's other chats, and «Новые контакты из Telegram» — unknown
// authors of bound chats: «Создать контакт» / «Это существующий контакт» /
// «Не контакт». Editors = the org owner and the company's «Ответственный»
// (`canEdit`; the API is the gate).
//
// Data: GET / POST /api/clients/<id>/telegram, POST
// /api/telegram/contact-proposals/<id>, GET /api/contacts?q=&clientId=&limit=
// (the contact picker). No DB here.
//
// NOTE: in the company drawer this block sits INSIDE the drawer's <form>:
// every button is type="button" and Enter in an input is swallowed.

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Loader, Plus, Search, Unlink } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { telegramChatLabel, telegramChatTypeLabel } from "@/components/blocks/telegram-chats-settings"
import type { ClientTelegramView } from "@/server/telegram/chats"

type Proposal = ClientTelegramView["proposals"][number]

type ContactSearchRow = {
  id: string
  name: string
  nameNative: string | null
  email: string | null
  clientName: string | null
}

function fmtDate(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("ru-RU")
}

/** «1 сообщение» / «3 сообщения» / «5 сообщений». */
function messagesLabel(n: number): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return `${n} сообщение`
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} сообщения`
  return `${n} сообщений`
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>
}

function errorOf(data: Record<string, unknown>, fallback: string): string {
  return typeof data.error === "string" && data.error ? data.error : fallback
}

export function ClientTelegramBlock({
  clientId,
  className,
  onContactsChanged,
}: {
  clientId: string
  className?: string
  /** After a contact was created / linked from a proposal (refresh the caller's contacts). */
  onContactsChanged?: () => void
}) {
  const [view, setView] = useState<ClientTelegramView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [username, setUsername] = useState("")
  const [otherRowId, setOtherRowId] = useState("")

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/telegram`)
      const data = await readJson(res)
      if (!res.ok || !data.view) {
        setLoadError(errorOf(data, "Не удалось загрузить Telegram компании"))
        return
      }
      setView(data.view as ClientTelegramView)
    } catch {
      setLoadError("Не удалось загрузить Telegram компании")
    }
  }, [clientId])

  useEffect(() => {
    void load()
  }, [load])

  async function post(body: Record<string, unknown>, success: string): Promise<boolean> {
    setBusy(true)
    try {
      const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/telegram`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await readJson(res)
      if (!res.ok || !data.view) throw new Error(errorOf(data, "Не удалось выполнить действие"))
      setView(data.view as ClientTelegramView)
      toast.success(success)
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось выполнить действие")
      return false
    } finally {
      setBusy(false)
    }
  }

  async function addByUsername() {
    const value = username.trim()
    if (!value) {
      toast.error("Укажите @имя или ссылку t.me")
      return
    }
    if (await post({ action: "add", username: value }, "Telegram добавлен")) setUsername("")
  }

  async function addFromList() {
    if (!otherRowId) return
    if (await post({ action: "add", rowId: otherRowId }, "Чат привязан к компании")) setOtherRowId("")
  }

  const header = <div className="text-sm font-medium">Telegram</div>

  if (loadError) {
    return (
      <div className={cn("flex flex-col gap-2 rounded-lg border p-3", className)}>
        {header}
        <p className="text-xs text-destructive">{loadError}</p>
      </div>
    )
  }
  if (!view) {
    return (
      <div className={cn("flex flex-col gap-2 rounded-lg border p-3", className)}>
        {header}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader className="h-3.5 w-3.5 animate-spin" />
          Загрузка…
        </div>
      </div>
    )
  }
  if (!view.available) {
    return (
      <div className={cn("flex flex-col gap-2 rounded-lg border p-3", className)}>
        {header}
        <p className="text-xs text-muted-foreground">В организации не подключён Telegram-бот.</p>
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col gap-3 rounded-lg border p-3", className)}>
      {header}

      {view.chats.length === 0 ? (
        <p className="text-xs text-muted-foreground">Группы и аккаунты компании в Telegram не привязаны.</p>
      ) : (
        <div className="divide-y rounded-md border">
          {view.chats.map((c) => {
            const me = c.clients.find((x) => x.id === clientId)
            const others = c.clients.filter((x) => x.id !== clientId)
            const typeLabel = telegramChatTypeLabel(c.type)
            return (
              <div key={c.id} className="flex items-start gap-2 px-2.5 py-2 text-sm">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="min-w-0 truncate font-medium">{telegramChatLabel(c)}</span>
                    {c.waitingFirstMessage ? (
                      <Badge variant="outline" className="font-normal">ждём первое сообщение</Badge>
                    ) : (
                      typeLabel && <Badge variant="secondary" className="font-normal">{typeLabel}</Badge>
                    )}
                    {me?.isPrimary && others.length > 0 && (
                      <Badge variant="outline" className="font-normal">основная</Badge>
                    )}
                    {c.excluded && (
                      <Badge variant="outline" className="border-amber-500/60 font-normal text-amber-700 dark:text-amber-400">
                        не анализируется
                      </Badge>
                    )}
                  </div>
                  {(others.length > 0 || c.lastMessageAt) && (
                    <div className="truncate text-xs text-muted-foreground">
                      {[
                        others.length > 0 ? `также: ${others.map((o) => o.name).join(", ")}` : null,
                        c.lastMessageAt ? `последнее сообщение ${fmtDate(c.lastMessageAt)}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  )}
                </div>
                {view.canEdit && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 shrink-0 px-2 text-xs"
                    disabled={busy}
                    onClick={() => void post({ action: "remove", rowId: c.id }, "Чат отвязан от компании")}
                  >
                    <Unlink className="mr-1 h-3.5 w-3.5" />
                    Отвязать
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {view.canEdit && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  void addByUsername()
                }
              }}
              placeholder="@имя или ссылка t.me"
              className="h-8 min-w-40 flex-1"
              autoComplete="off"
              spellCheck={false}
            />
            <Button type="button" size="sm" variant="outline" className="h-8" disabled={busy || !username.trim()} onClick={() => void addByUsername()}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              Добавить
            </Button>
          </div>
          {view.otherChats.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Select value={otherRowId} onValueChange={setOtherRowId}>
                <SelectTrigger size="sm" className="min-w-40 flex-1">
                  <SelectValue placeholder="Или выберите чат бота" />
                </SelectTrigger>
                <SelectContent>
                  {view.otherChats.map((o) => {
                    const t = telegramChatTypeLabel(o.type)
                    return (
                      <SelectItem key={o.id} value={o.id}>
                        {telegramChatLabel(o)}
                        {t ? ` · ${t}` : ""}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
              <Button type="button" size="sm" variant="outline" className="h-8" disabled={busy || !otherRowId} onClick={() => void addFromList()}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                Добавить
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Группа клиента или его общий аккаунт в Telegram. Сообщения оттуда будут относиться к этой компании.
          </p>
        </div>
      )}

      {view.proposals.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground">Новые контакты из Telegram</div>
          <div className="divide-y rounded-md border">
            {view.proposals.map((p) => (
              <ProposalRow
                key={p.id}
                proposal={p}
                clientId={clientId}
                canEdit={view.canEdit}
                onDone={() => {
                  void load()
                }}
                onContactsChanged={onContactsChanged}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ProposalRow({
  proposal: p,
  clientId,
  canEdit,
  onDone,
  onContactsChanged,
}: {
  proposal: Proposal
  clientId: string
  canEdit: boolean
  onDone: () => void
  onContactsChanged?: () => void
}) {
  const [step, setStep] = useState<"none" | "create" | "link">("none")
  const [name, setName] = useState(p.name ?? (p.username ? p.username.replace(/^@/, "") : ""))
  const [busy, setBusy] = useState(false)

  async function decide(body: Record<string, unknown>, success: string) {
    setBusy(true)
    try {
      const res = await fetch(`/api/telegram/contact-proposals/${encodeURIComponent(p.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await readJson(res)
      if (!res.ok) throw new Error(errorOf(data, "Не удалось выполнить действие"))
      toast.success(success)
      if (body.action !== "reject") onContactsChanged?.()
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось выполнить действие")
    } finally {
      setBusy(false)
    }
  }

  const handle = p.username ? `@${p.username.replace(/^@/, "")}` : null

  return (
    <div className="space-y-2 px-2.5 py-2 text-sm">
      <div className="min-w-0">
        <div className="truncate font-medium">{p.name || handle || "Без имени"}</div>
        <div className="truncate text-xs text-muted-foreground">
          {[p.name ? handle : null, messagesLabel(p.messageCount), p.chatTitle, p.lastMessageAt ? fmtDate(p.lastMessageAt) : null]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>

      {step === "none" && (
        <div className="flex flex-wrap gap-1.5">
          <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={!canEdit || busy} onClick={() => setStep("create")}>
            Создать контакт
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={!canEdit || busy} onClick={() => setStep("link")}>
            Это существующий контакт
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            disabled={!canEdit || busy}
            onClick={() => void decide({ action: "reject" }, "Отмечено: не контакт")}
          >
            Не контакт
          </Button>
        </div>
      )}

      {step === "create" && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                if (name.trim()) void decide({ action: "create", name: name.trim() }, "Контакт создан")
              }
            }}
            placeholder="Имя контакта"
            className="h-8 min-w-40 flex-1"
            autoComplete="off"
          />
          <Button
            type="button"
            size="sm"
            className="h-8"
            disabled={busy || !name.trim()}
            onClick={() => void decide({ action: "create", name: name.trim() }, "Контакт создан")}
          >
            {busy && <Loader className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Создать
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-8" disabled={busy} onClick={() => setStep("none")}>
            Отмена
          </Button>
        </div>
      )}

      {step === "link" && (
        <ContactPicker
          clientId={clientId}
          busy={busy}
          onPick={(c) => void decide({ action: "link", contactId: c.id }, `Telegram связан с контактом «${c.nameNative || c.name}»`)}
          onCancel={() => setStep("none")}
        />
      )}
    </div>
  )
}

function ContactPicker({
  clientId,
  busy,
  onPick,
  onCancel,
}: {
  clientId: string
  busy: boolean
  onPick: (c: ContactSearchRow) => void
  onCancel: () => void
}) {
  const [q, setQ] = useState("")
  const [allCompanies, setAllCompanies] = useState(false)
  const [rows, setRows] = useState<ContactSearchRow[]>([])
  const [searching, setSearching] = useState(false)
  const reqRef = useRef(0)

  // This company's contacts are listed without typing; across all companies
  // the search needs ≥ 2 characters. Debounced 300 ms.
  useEffect(() => {
    const query = q.trim()
    const reqId = ++reqRef.current
    // Too short across all companies: nothing to fetch (render shows the hint).
    if (allCompanies && query.length < 2) return
    const params = new URLSearchParams({ limit: "10" })
    if (query) params.set("q", query)
    if (!allCompanies) params.set("clientId", clientId)
    const t = setTimeout(() => {
      setSearching(true)
      fetch(`/api/contacts?${params.toString()}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { rows?: ContactSearchRow[] } | null) => {
          if (reqRef.current === reqId) setRows(d?.rows ?? [])
        })
        .catch(() => {})
        .finally(() => {
          if (reqRef.current === reqId) setSearching(false)
        })
    }, 300)
    return () => clearTimeout(t)
  }, [q, allCompanies, clientId])

  const tooShort = allCompanies && q.trim().length < 2
  const shown = tooShort ? [] : rows

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-40 flex-1">
          <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
          <Input
            autoFocus
            className="h-8 pl-8"
            value={q}
            placeholder="Имя или email контакта"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.preventDefault()
            }}
          />
        </div>
        <Button type="button" size="sm" variant="ghost" className="h-8" disabled={busy} onClick={onCancel}>
          Отмена
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id={`tg-contact-all-${clientId}`}
          checked={allCompanies}
          onCheckedChange={(v) => setAllCompanies(v === true)}
        />
        <Label htmlFor={`tg-contact-all-${clientId}`} className="text-xs font-normal">
          Искать во всех компаниях
        </Label>
      </div>
      <div className="max-h-56 space-y-1 overflow-y-auto">
        {tooShort ? (
          <div className="py-1 text-xs text-muted-foreground">Введите не меньше 2 символов.</div>
        ) : searching && shown.length === 0 ? (
          <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
            <Loader className="h-3.5 w-3.5 animate-spin" />
            Поиск…
          </div>
        ) : shown.length === 0 ? (
          <div className="py-1 text-xs text-muted-foreground">Ничего не найдено.</div>
        ) : (
          shown.map((r) => (
            <button
              key={r.id}
              type="button"
              disabled={busy}
              className="w-full rounded-md border px-2.5 py-1.5 text-left hover:bg-accent disabled:opacity-50"
              onClick={() => onPick(r)}
            >
              <div className="truncate text-sm font-medium">{r.nameNative || r.name}</div>
              <div className="truncate text-xs text-muted-foreground">
                {[r.email, r.clientName].filter(Boolean).join(" · ") || "—"}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

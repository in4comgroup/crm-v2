"use client"

// «Исключения из анализа» — owner-managed deny-list of addresses, domains and
// chats the engine never analyses (spec topics/01 §5.2 gate 3a). Mounted on
// the Sources page tab «Управление источниками организации». Owner-gating
// here is best-effort (`canManage` from the API); the API is the real gate.

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Loader, ShieldOff, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  chatExclusionValue,
  splitChatExclusionValue,
  type AnalysisExclusionKind,
  type ExclusionChatProvider,
} from "@/lib/analysis-exclusion-match"
import type { AnalysisExclusionRow } from "@/app/api/sources/exclusions/route"

const KIND_OPTIONS: { value: AnalysisExclusionKind; label: string }[] = [
  { value: "email", label: "Адрес" },
  { value: "domain", label: "Домен" },
  { value: "chat", label: "Чат" },
]

const CHAT_PROVIDER_OPTIONS: { value: ExclusionChatProvider; label: string }[] = [
  { value: "telegram", label: "Telegram" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "gchat", label: "Google Chat" },
]

const PLACEHOLDER: Record<AnalysisExclusionKind, string> = {
  email: "напр. ivan@example.com",
  domain: "напр. example.com",
  chat: "",
}

const CHAT_PLACEHOLDER: Record<ExclusionChatProvider, string> = {
  telegram: "id чата или @username",
  whatsapp: "название чата или имя собеседника",
  gchat: "spaces/… или ссылка на пространство",
}

const PROVIDER_LABEL: Record<ExclusionChatProvider, string> = {
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  gchat: "Google Chat",
}

function entryLabel(e: AnalysisExclusionRow): string {
  if (e.kind !== "chat") return e.normalizedValue
  const { provider, rest } = splitChatExclusionValue(e.normalizedValue)
  return provider ? `${PROVIDER_LABEL[provider]} · ${rest}` : e.normalizedValue
}

export function AnalysisExclusionsSection() {
  const [entries, setEntries] = useState<AnalysisExclusionRow[]>([])
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [kind, setKind] = useState<AnalysisExclusionKind>("email")
  const [chatProvider, setChatProvider] = useState<ExclusionChatProvider>("telegram")
  const [value, setValue] = useState("")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/sources/exclusions")
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? "Не удалось загрузить исключения")
        return
      }
      setEntries(data.entries ?? [])
      setCanManage(Boolean(data.canManage))
    } catch {
      toast.error("Не удалось загрузить исключения")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function handleAdd() {
    const raw = value.trim()
    if (!raw) {
      toast.error("Укажите значение")
      return
    }
    setBusy(true)
    try {
      const res = await fetch("/api/sources/exclusions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          value: kind === "chat" ? chatExclusionValue(chatProvider, raw) : raw,
          note: note.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? "Не удалось добавить")
        return
      }
      toast.success(data.added ? "Исключение добавлено" : "Такое исключение уже есть")
      setValue("")
      setNote("")
      await load()
    } catch {
      toast.error("Ошибка сети")
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove(id: string) {
    try {
      const res = await fetch(`/api/sources/exclusions/${id}`, { method: "DELETE" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? "Не удалось удалить")
        return
      }
      toast.success("Исключение удалено")
      setEntries((prev) => prev.filter((e) => e.id !== id))
    } catch {
      toast.error("Ошибка сети")
    }
  }

  const grouped = KIND_OPTIONS.map((k) => ({
    kind: k.value,
    label: k.label,
    items: entries.filter((e) => e.kind === k.value),
  })).filter((g) => g.items.length > 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldOff className="h-4 w-4" />
          Исключения из анализа
        </CardTitle>
        <CardDescription>
          Сообщения с этих адресов, доменов и чатов никогда не анализируются и
          не отправляются в ИИ.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {canManage && (
          <div className="flex flex-wrap items-start gap-2">
            <Select value={kind} onValueChange={(v) => setKind(v as AnalysisExclusionKind)}>
              <SelectTrigger size="sm" className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KIND_OPTIONS.map((k) => (
                  <SelectItem key={k.value} value={k.value}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {kind === "chat" && (
              <Select
                value={chatProvider}
                onValueChange={(v) => setChatProvider(v as ExclusionChatProvider)}
              >
                <SelectTrigger size="sm" className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHAT_PROVIDER_OPTIONS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd()
              }}
              placeholder={kind === "chat" ? CHAT_PLACEHOLDER[chatProvider] : PLACEHOLDER[kind]}
              className="h-8 min-w-40 flex-1"
              autoComplete="off"
              spellCheck={false}
            />
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Примечание (необязательно)"
              className="h-8 min-w-40 flex-1"
              autoComplete="off"
            />
            <Button size="sm" onClick={handleAdd} disabled={busy}>
              {busy ? "Добавление…" : "Добавить"}
            </Button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader className="h-4 w-4 animate-spin" />
            Загрузка…
          </div>
        ) : entries.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Исключений нет.
          </p>
        ) : (
          <div className="space-y-4">
            {grouped.map((g) => (
              <div key={g.kind} className="space-y-1.5">
                <div className="text-xs font-medium text-muted-foreground">
                  {g.label} ({g.items.length})
                </div>
                <div className="divide-y rounded-md border">
                  {g.items.map((e) => (
                    <div key={e.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{entryLabel(e)}</div>
                        {e.note && (
                          <div className="truncate text-xs text-muted-foreground">{e.note}</div>
                        )}
                      </div>
                      {canManage && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0"
                          aria-label="Удалить исключение"
                          onClick={() => handleRemove(e.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

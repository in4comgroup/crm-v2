"use client"

// Shared controls for the own-organisation identity registry
// (`/api/org-identity`): entry chips with delete, the add row (value + an
// optional type select), the report-only «похожие записи» panel, and the
// fetch helpers. Used by the /account tab «Профиль организации» (group A) and
// by /profile «Мои адреса для работы». The server is the real gate; these
// controls only hide what the viewer may not do.

import { useState } from "react"
import { toast } from "sonner"
import { TriangleAlert, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type {
  AddOrgIdentityResult,
  IdentityMatches,
  OrgIdentityEntryView,
} from "@/app/api/org-identity/route"

export type IdentityAddPayload = {
  kind: string
  value: string
  channel?: string
  userId?: string
}

/** POST an entry. Returns the result, or null after showing the error toast. */
export async function postIdentityEntry(p: IdentityAddPayload): Promise<AddOrgIdentityResult | null> {
  try {
    const res = await fetch("/api/org-identity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(p),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(data.error ?? "Не удалось добавить")
      return null
    }
    toast.success(data.added > 0 ? "Добавлено" : "Такая запись уже есть")
    return data as AddOrgIdentityResult
  } catch {
    toast.error("Ошибка сети")
    return null
  }
}

/** DELETE an entry. True on success (errors are toasted). */
export async function deleteIdentityEntry(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/org-identity/${id}`, { method: "DELETE" })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(data.error ?? "Не удалось удалить")
      return false
    }
    toast.success("Удалено")
    return true
  } catch {
    toast.error("Ошибка сети")
    return false
  }
}

export function matchCount(m: IdentityMatches | null | undefined): number {
  return (m?.clients?.length ?? 0) + (m?.contacts?.length ?? 0)
}

/** Read-only chip (e.g. a value from «Информация об организации»). */
export function FixedChip({ children }: { children: React.ReactNode }) {
  return (
    <Badge variant="secondary" className="font-normal">
      {children}
    </Badge>
  )
}

export function EntryChips({
  entries,
  canDelete,
  onDeleted,
  prefix,
  empty,
}: {
  entries: OrgIdentityEntryView[]
  canDelete: (e: OrgIdentityEntryView) => boolean
  onDeleted: (id: string) => void
  /** Small label before each chip value (e.g. the channel). */
  prefix?: (e: OrgIdentityEntryView) => string | null
  /** Shown when there are no entries and nothing else in the row. */
  empty?: React.ReactNode
}) {
  const [busy, setBusy] = useState<string | null>(null)
  if (entries.length === 0) return empty ? <>{empty}</> : null
  return (
    <>
      {entries.map((e) => {
        const p = prefix?.(e)
        return (
          <Badge key={e.id} variant="outline" className="gap-1 font-normal">
            {p && <span className="text-muted-foreground">{p}:</span>}
            <span className="max-w-64 truncate">{e.label}</span>
            {e.note && <span className="max-w-40 truncate text-muted-foreground">· {e.note}</span>}
            {canDelete(e) && (
              <button
                type="button"
                className="ml-0.5 rounded-sm opacity-60 hover:opacity-100 disabled:opacity-30"
                aria-label={`Удалить ${e.label}`}
                disabled={busy === e.id}
                onClick={async () => {
                  setBusy(e.id)
                  try {
                    if (await deleteIdentityEntry(e.id)) onDeleted(e.id)
                  } finally {
                    setBusy(null)
                  }
                }}
              >
                <X className="size-3" />
              </button>
            )}
          </Badge>
        )
      })}
    </>
  )
}

export type AddOption = { value: string; label: string; placeholder: string }

/**
 * Value input + «Добавить». With `options` a type select is shown in front
 * (registry kind or person channel); `onAdd` gets the chosen option value.
 */
export function AddIdentityEntry({
  options,
  placeholder,
  onAdd,
  buttonLabel = "Добавить",
}: {
  options?: AddOption[]
  placeholder?: string
  onAdd: (value: string, option: string | null) => Promise<boolean>
  buttonLabel?: string
}) {
  const [option, setOption] = useState<string | null>(options?.[0]?.value ?? null)
  const [value, setValue] = useState("")
  const [busy, setBusy] = useState(false)
  const current = options?.find((o) => o.value === option)

  const submit = async () => {
    if (!value.trim()) {
      toast.error("Укажите значение")
      return
    }
    setBusy(true)
    try {
      if (await onAdd(value.trim(), option)) setValue("")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      {options && options.length > 1 && (
        <Select value={option ?? undefined} onValueChange={setOption}>
          <SelectTrigger size="sm" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            void submit()
          }
        }}
        placeholder={current?.placeholder ?? placeholder}
        className="h-8 min-w-40 flex-1"
        autoComplete="off"
        spellCheck={false}
      />
      <Button size="sm" variant="outline" onClick={() => void submit()} disabled={busy}>
        {busy ? "Добавление…" : buttonLabel}
      </Button>
    </div>
  )
}

/**
 * Existing clients / contacts that look like US (report only). The owner
 * soft-deletes them row by row through the normal CRUD endpoints.
 */
export function IdentityMatchesPanel({
  matches,
  onClose,
}: {
  matches: IdentityMatches
  onClose: () => void
}) {
  const [resolved, setResolved] = useState<Set<string>>(new Set())
  const rows = [
    ...matches.clients.map((m) => ({ ...m, entity: "client" as const })),
    ...matches.contacts.map((m) => ({ ...m, entity: "contact" as const })),
  ].filter((m) => !resolved.has(m.id))
  if (rows.length === 0) return null

  const remove = async (entity: "client" | "contact", id: string, name: string) => {
    try {
      const res = await fetch(entity === "client" ? "/api/clients" : "/api/contacts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: "deleted" }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? "Не удалось удалить")
        return
      }
      toast.success(`«${name}» удалён(а)`)
      setResolved((prev) => new Set(prev).add(id))
    } catch {
      toast.error("Ошибка сети")
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3">
      <div className="flex items-start gap-2 text-sm">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
        <div className="flex-1">
          <div className="font-medium">Эти записи похожи на вашу организацию</div>
          <div className="text-xs text-muted-foreground">
            Они были заведены раньше. Ничего не изменено автоматически — удалите лишнее вручную.
            Заново система их не создаст.
          </div>
        </div>
        <Button variant="ghost" size="sm" className="h-7" onClick={onClose}>
          Скрыть
        </Button>
      </div>
      <div className="divide-y rounded-md border bg-background">
        {rows.map((m) => (
          <div key={`${m.entity}-${m.id}`} className="flex items-center gap-2 px-3 py-2 text-sm">
            <Badge variant="outline" className="shrink-0 font-normal">
              {m.entity === "client" ? "Клиент" : "Контакт"}
            </Badge>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{m.name}</div>
              {m.detail && <div className="truncate text-xs text-muted-foreground">{m.detail}</div>}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 shrink-0"
              onClick={() => void remove(m.entity, m.id, m.name)}
            >
              Удалить
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}

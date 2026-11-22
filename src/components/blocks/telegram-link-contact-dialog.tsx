"use client"

// «Связать с контактом» of a Telegram message (docs/specs/telegram/04 §6.2,
// TI5): shows who wrote the message (by the ONE resolve rule) and lets a
// person pick the contact this Telegram author is. The author's Telegram id
// (+ username) is stored on the contact as a verified Telegram address, so
// the next messages of this person resolve to the contact even after a
// username change. Items already parsed are not changed.
//
// Data: GET / POST /api/sources/items/<itemId>/telegram-contact,
// GET /api/contacts?q=&limit=10 (the picker). No DB here.

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Loader, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { contactDisplayName } from "@/lib/contact-names"

type TelegramAuthor = {
  telegram: boolean
  kind: "member" | "contact" | "unknown" | null
  name: string | null
  username: string | null
  hasId: boolean
  contactId: string | null
  contactName: string | null
  via: string | null
}

type ContactSearchRow = {
  id: string
  name: string
  nameNative: string | null
  email: string | null
  clientName: string | null
}

const VIA_LABEL: Record<string, string> = {
  contact_id: "по id",
  contact_handle: "по имени пользователя",
}

function contactLabel(r: ContactSearchRow): string {
  return contactDisplayName(r)
}

export function TelegramLinkContactDialog({
  itemId,
  open,
  onOpenChange,
  onLinked,
}: {
  itemId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** After a successful link (refresh the caller's list). */
  onLinked?: () => void
}) {
  const [author, setAuthor] = useState<TelegramAuthor | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState("")
  const [rows, setRows] = useState<ContactSearchRow[]>([])
  const [searching, setSearching] = useState(false)
  const [picked, setPicked] = useState<ContactSearchRow | null>(null)
  const [busy, setBusy] = useState(false)
  const searchReqRef = useRef(0)

  // Load the author on every open.
  useEffect(() => {
    if (!open || !itemId) return
    let cancelled = false
    setAuthor(null)
    setLoadError(null)
    setQ("")
    setRows([])
    setPicked(null)
    setLoading(true)
    fetch(`/api/sources/items/${encodeURIComponent(itemId)}/telegram-contact`)
      .then(async (res) => {
        const d = (await res.json().catch(() => ({}))) as { author?: TelegramAuthor; error?: string }
        if (cancelled) return
        if (!res.ok || !d.author) setLoadError(d.error || "Не удалось загрузить автора сообщения")
        else setAuthor(d.author)
      })
      .catch(() => {
        if (!cancelled) setLoadError("Не удалось загрузить автора сообщения")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, itemId])

  // Contact search, debounced 300 ms.
  useEffect(() => {
    if (!open) return
    const query = q.trim()
    if (query.length < 2) {
      setRows([])
      setSearching(false)
      return
    }
    const reqId = ++searchReqRef.current
    const t = setTimeout(() => {
      setSearching(true)
      fetch(`/api/contacts?q=${encodeURIComponent(query)}&limit=10`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { rows?: ContactSearchRow[] } | null) => {
          if (searchReqRef.current !== reqId) return
          setRows(d?.rows ?? [])
        })
        .catch(() => {})
        .finally(() => {
          if (searchReqRef.current === reqId) setSearching(false)
        })
    }, 300)
    return () => clearTimeout(t)
  }, [q, open])

  async function link() {
    if (!itemId || !picked) return
    setBusy(true)
    try {
      const res = await fetch(`/api/sources/items/${encodeURIComponent(itemId)}/telegram-contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId: picked.id }),
      })
      const d = (await res.json().catch(() => ({}))) as { author?: TelegramAuthor; error?: string }
      if (!res.ok) throw new Error(d.error || "Не удалось связать Telegram с контактом")
      toast.success(`Telegram связан с контактом «${d.author?.contactName || contactLabel(picked)}»`)
      onLinked?.()
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось связать Telegram с контактом")
    } finally {
      setBusy(false)
    }
  }

  const canPick = !!author && author.telegram && author.kind !== "member" && author.hasId

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Связать с контактом</DialogTitle>
          <DialogDescription>Автор сообщения в Telegram и контакт CRM, которым он является.</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
            <Loader className="h-4 w-4 animate-spin" />
            Загрузка…
          </div>
        ) : loadError ? (
          <p className="py-3 text-sm text-destructive">{loadError}</p>
        ) : author && !author.telegram ? (
          <p className="py-3 text-sm text-muted-foreground">Это не сообщение Telegram — связать нельзя.</p>
        ) : author ? (
          <div className="space-y-3 text-sm">
            <div className="rounded-md border px-2.5 py-2">
              <div className="truncate font-medium">{author.name || "Без имени"}</div>
              <div className="truncate text-xs text-muted-foreground">
                {author.username ? `@${author.username}` : "без имени пользователя"}
              </div>
            </div>

            {author.kind === "member" ? (
              <p className="text-muted-foreground">Это сотрудник организации</p>
            ) : !author.hasId ? (
              <p className="text-muted-foreground">Автор скрыл свой Telegram — связать нельзя</p>
            ) : author.kind === "contact" && author.contactName ? (
              <p className="text-muted-foreground">
                Связан с контактом «{author.contactName}»
                {author.via && VIA_LABEL[author.via] ? ` ${VIA_LABEL[author.via]}` : ""}
              </p>
            ) : null}

            {canPick && (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    autoFocus
                    className="pl-8"
                    value={q}
                    placeholder={author.kind === "contact" ? "Другой контакт: имя или email" : "Имя или email контакта"}
                    onChange={(e) => {
                      setQ(e.target.value)
                      setPicked(null)
                    }}
                  />
                </div>
                <div className="max-h-60 space-y-1 overflow-y-auto">
                  {searching && rows.length === 0 ? (
                    <div className="flex items-center gap-2 py-2 text-muted-foreground">
                      <Loader className="h-4 w-4 animate-spin" />
                      Поиск…
                    </div>
                  ) : q.trim().length >= 2 && rows.length === 0 ? (
                    <div className="py-2 text-muted-foreground">Ничего не найдено.</div>
                  ) : (
                    rows.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        className={cn(
                          "w-full rounded-md border px-2.5 py-1.5 text-left hover:bg-accent",
                          picked?.id === r.id && "border-primary bg-accent",
                        )}
                        onClick={() => setPicked(r)}
                      >
                        <div className="truncate font-medium">{contactLabel(r)}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {[r.email, r.clientName].filter(Boolean).join(" · ") || "—"}
                        </div>
                      </button>
                    ))
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Telegram id автора сохранится у контакта — следующие сообщения этого человека будут
                  связаны с ним, даже если он сменит имя пользователя. Уже разобранные сообщения не
                  меняются.
                </p>
              </div>
            )}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
            {canPick ? "Отмена" : "Закрыть"}
          </Button>
          {canPick && (
            <Button disabled={busy || !picked} onClick={() => void link()}>
              {busy && <Loader className="mr-1 h-4 w-4 animate-spin" />}
              Связать
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

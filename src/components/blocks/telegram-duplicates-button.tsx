"use client"

// «Дубли Telegram» on /contacts (docs/specs/telegram/04 §6.3, TI5): live
// contacts that share one Telegram id or username. The button shows only
// when there is at least one group; the dialog lists the groups and merges
// every other contact of a group into the one a person keeps.
//
// Data: GET /api/contacts/telegram-duplicates, POST /api/contacts/merge
// { keepId, mergeId } (one call per merged contact, in sequence). No DB here.

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Loader, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { AnchorTooltip, useAnchorTooltip } from "@/components/blocks/anchor-tooltip"

type DuplicateContact = { id: string; name: string; clientId: string | null }
type DuplicateGroup = { key: string; label: string; contacts: DuplicateContact[] }

/** 1 контакт, 2 контакта, 5 контактов. */
function contactsWord(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return "контакт"
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "контакта"
  return "контактов"
}

export function TelegramDuplicatesButton({
  onMerged,
  onOpenContact,
}: {
  /** After a merge (refresh the contacts list). */
  onMerged: () => void
  /** Open one contact (the page's contact drawer). */
  onOpenContact: (contactId: string) => void
}) {
  const [groups, setGroups] = useState<DuplicateGroup[]>([])
  const [open, setOpen] = useState(false)
  const [keep, setKeep] = useState<{ group: DuplicateGroup; contact: DuplicateContact } | null>(null)
  const [busy, setBusy] = useState(false)
  const tip = useAnchorTooltip()

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/contacts/telegram-duplicates")
      if (!res.ok) return
      const d = (await res.json()) as { groups?: DuplicateGroup[] }
      setGroups((d.groups ?? []).filter((g) => g.contacts.length > 1))
    } catch {
      // The list is optional; the button just stays hidden.
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function merge() {
    if (!keep) return
    const others = keep.group.contacts.filter((c) => c.id !== keep.contact.id)
    setBusy(true)
    let merged = 0
    try {
      for (const c of others) {
        const res = await fetch("/api/contacts/merge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keepId: keep.contact.id, mergeId: c.id }),
        })
        const d = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) throw new Error(d.error || "Не удалось объединить контакты")
        merged++
      }
      toast.success(`Контакты объединены в «${keep.contact.name}»`)
    } catch (err) {
      const text = err instanceof Error ? err.message : "Не удалось объединить контакты"
      toast.error(merged > 0 ? `${text} (объединено: ${merged} из ${others.length})` : text)
    } finally {
      setBusy(false)
      setKeep(null)
      if (merged > 0) onMerged()
      await load()
    }
  }

  if (groups.length === 0 && !open) return null

  const mergeCount = keep ? keep.group.contacts.length - 1 : 0

  return (
    <>
      {groups.length > 0 && (
        <>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setOpen(true)}
            {...tip.bind}
          >
            <Users className="h-4 w-4 mr-1" />
            Дубли Telegram ({groups.length})
          </Button>
          <AnchorTooltip
            text="Контакты с одним и тем же Telegram"
            open={tip.open}
            virtualRef={tip.virtualRef}
          />
        </>
      )}

      <Dialog open={open && !keep} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Дубли Telegram</DialogTitle>
            <DialogDescription>
              У этих контактов один и тот же Telegram. Выберите запись, которую оставить, —
              остальные записи группы объединятся с ней.
            </DialogDescription>
          </DialogHeader>
          {groups.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">Дублей больше нет.</p>
          ) : (
            <div className="max-h-[60vh] space-y-3 overflow-y-auto">
              {groups.map((g) => (
                <section key={g.key} className="space-y-1 rounded-md border p-2.5">
                  <div className="text-sm font-medium">{g.label}</div>
                  {g.contacts.map((c) => (
                    <div key={c.id} className="flex items-center gap-2 text-sm">
                      <button
                        type="button"
                        className="min-w-0 flex-1 truncate text-left hover:underline"
                        onClick={() => {
                          setOpen(false)
                          onOpenContact(c.id)
                        }}
                      >
                        {c.name}
                      </button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2"
                        disabled={busy}
                        onClick={() => setKeep({ group: g, contact: c })}
                      >
                        Оставить этот
                      </Button>
                    </div>
                  ))}
                </section>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={open && Boolean(keep)}
        onOpenChange={(o) => {
          if (!o && !busy) setKeep(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Объединить {mergeCount} {contactsWord(mergeCount)} в «{keep?.contact.name}»?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Это нельзя отменить. Адреса, компании, сделки, задачи и документы перейдут в
              оставленную запись.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="ghost" disabled={busy} onClick={() => setKeep(null)}>
              Отмена
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => void merge()}>
              {busy && <Loader className="mr-1 h-4 w-4 animate-spin" />}
              Объединить
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

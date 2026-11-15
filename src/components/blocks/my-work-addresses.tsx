"use client"

// /profile → «Мои адреса для работы» (identity spec §3.1 A, §3.4): any member
// adds / removes their OWN extra addresses in the active organization —
// personal email, Telegram @handle, phone (registry kind `person`). Mail and
// messages from these addresses count as ours: they never become contacts.

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  AddIdentityEntry,
  EntryChips,
  FixedChip,
  postIdentityEntry,
} from "@/components/blocks/identity-entry-controls"
import { PERSON_CHANNEL_LABELS_RU } from "@/lib/identity/org-profile"
import type { OrgIdentityEntryView } from "@/app/api/org-identity/route"

const OPTIONS = [
  { value: "email", label: "Email", placeholder: "" },
  { value: "telegram", label: "Telegram", placeholder: "" },
  { value: "phone", label: "Телефон", placeholder: "" },
]

async function fetchMine(): Promise<
  { ok: true; entries: OrgIdentityEntryView[]; signInEmail: string } | { ok: false; error: string }
> {
  try {
    const res = await fetch("/api/org-identity?mine=1")
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: data.error ?? "Не удалось загрузить адреса" }
    return { ok: true, entries: data.entries ?? [], signInEmail: data.signInEmail ?? "" }
  } catch {
    return { ok: false, error: "Не удалось загрузить адреса" }
  }
}

export function MyWorkAddresses() {
  const [entries, setEntries] = useState<OrgIdentityEntryView[] | null>(null)
  const [signInEmail, setSignInEmail] = useState("")
  const [error, setError] = useState<string | null>(null)

  const apply = useCallback(
    (r: { ok: true; entries: OrgIdentityEntryView[]; signInEmail: string } | { ok: false; error: string }) => {
      if (!r.ok) {
        setError(r.error)
        return
      }
      setError(null)
      setEntries(r.entries)
      setSignInEmail(r.signInEmail)
    },
    [],
  )
  const load = useCallback(() => fetchMine().then(apply), [apply])

  useEffect(() => {
    let cancelled = false
    fetchMine().then((r) => {
      if (!cancelled) apply(r)
    })
    return () => {
      cancelled = true
    }
  }, [apply])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-medium">Мои адреса для работы</CardTitle>
        <CardDescription>
          Личная почта, Telegram и телефон, с которых вы пишете по работе. Письма и сообщения с этих
          адресов считаются нашими и не станут контактами. Адрес входа учитывается всегда.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error ? (
          <span className="text-sm text-destructive">{error}</span>
        ) : entries === null ? (
          <span className="text-sm text-muted-foreground">Загрузка…</span>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              {signInEmail && <FixedChip>Вход: {signInEmail}</FixedChip>}
              <EntryChips
                entries={entries}
                canDelete={() => true}
                onDeleted={(id) => setEntries((prev) => (prev ?? []).filter((e) => e.id !== id))}
                prefix={(e) => (e.channel ? PERSON_CHANNEL_LABELS_RU[e.channel] : null)}
              />
            </div>
            <div className="lg:w-2/3">
              <AddIdentityEntry
                options={OPTIONS}
                buttonLabel="Добавить адрес"
                onAdd={async (value, channel) => {
                  const r = await postIdentityEntry({ kind: "person", value, channel: channel ?? "email" })
                  if (!r) return false
                  await load()
                  return true
                }}
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

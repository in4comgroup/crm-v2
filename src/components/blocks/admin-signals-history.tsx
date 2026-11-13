"use client"

// «История» of the signals registry: one row per taxonomy version with its
// change rows (entity, key, before → after as a compact diff).

import { Fragment, useEffect, useState } from "react"
import { ChevronDown, ChevronRight, Loader } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { formatDateTime } from "@/components/blocks/admin-ai-models"
import type { SignalsHistoryResponse } from "@/lib/signals/types"
import {
  ACTION_LABELS_RU,
  ENTITY_LABELS_RU,
  SIGNALS_API,
  getJson,
  shortValue,
} from "@/components/blocks/admin-signals-shared"

type Version = SignalsHistoryResponse["versions"][number]
type Change = Version["changes"][number]

const PAGE = 50

function changedFields(c: Change): { field: string; before: unknown; after: unknown }[] {
  const keys = new Set([...Object.keys(c.before ?? {}), ...Object.keys(c.after ?? {})])
  keys.delete("updatedAt")
  const out: { field: string; before: unknown; after: unknown }[] = []
  for (const k of keys) {
    const b = c.before?.[k]
    const a = c.after?.[k]
    if (JSON.stringify(b ?? null) !== JSON.stringify(a ?? null)) out.push({ field: k, before: b, after: a })
  }
  return out
}

function ChangeRow({ c, orgName }: { c: Change; orgName: (id: string) => string }) {
  const fields = changedFields(c)
  return (
    <div className="space-y-1 rounded-md border px-2 py-1.5 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="font-normal">{ENTITY_LABELS_RU[c.entity] ?? c.entity}</Badge>
        <span className="font-mono">{c.entityKey}</span>
        <span
          className={
            c.action === "delete" ? "text-red-600" : c.action === "create" ? "text-emerald-600" : "text-muted-foreground"
          }
        >
          {ACTION_LABELS_RU[c.action]}
        </span>
        {c.organizationId && <span className="text-muted-foreground">· {orgName(c.organizationId)}</span>}
      </div>
      {c.action === "update" && fields.length > 0 && (
        <div className="space-y-0.5 pl-1">
          {fields.map((f) => (
            <div key={f.field} className="grid grid-cols-[9rem_1fr] gap-2">
              <span className="truncate font-mono text-muted-foreground">{f.field}</span>
              <span className="min-w-0 break-words">
                <span className="text-red-600 line-through decoration-red-600/40">{shortValue(f.before)}</span>
                {" → "}
                <span className="text-emerald-700 dark:text-emerald-400">{shortValue(f.after)}</span>
              </span>
            </div>
          ))}
        </div>
      )}
      {c.action !== "update" && (
        <div className="break-words pl-1 text-muted-foreground">
          {shortValue(c.action === "delete" ? c.before : c.after, 240)}
        </div>
      )}
    </div>
  )
}

export function SignalsHistorySheet({
  open,
  onClose,
  orgs,
  refreshKey,
}: {
  open: boolean
  onClose: () => void
  orgs: { id: string; name: string }[]
  /** Changes when the registry version changes, to refetch while open. */
  refreshKey: number
}) {
  const [limit, setLimit] = useState(PAGE)
  const [data, setData] = useState<{ key: string; versions: Version[] | null; error: string | null } | null>(null)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const reqKey = `${limit}:${refreshKey}`

  useEffect(() => {
    if (!open) return
    let cancelled = false
    getJson<SignalsHistoryResponse>(`${SIGNALS_API}?view=history&limit=${limit}`)
      .then((d) => !cancelled && setData({ key: reqKey, versions: d.versions, error: null }))
      .catch(
        (e) =>
          !cancelled &&
          setData({ key: reqKey, versions: null, error: e instanceof Error ? e.message : String(e) }),
      )
    return () => {
      cancelled = true
    }
  }, [open, limit, reqKey])

  const versions = data?.versions ?? null
  const loading = open && data?.key !== reqKey
  const orgName = (id: string) => orgs.find((o) => o.id === id)?.name ?? id
  const toggle = (v: number) =>
    setExpanded((s) => {
      const n = new Set(s)
      if (n.has(v)) n.delete(v)
      else n.add(v)
      return n
    })

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader className="pr-12">
          <SheetTitle>История реестра сигналов</SheetTitle>
          <SheetDescription>Каждое принятое сохранение — новая версия таксономии.</SheetDescription>
        </SheetHeader>
        <div className="space-y-2 px-4 pb-6">
          {data?.error && <p className="text-sm text-red-500">Не удалось загрузить историю: {data.error}</p>}
          {loading && !versions && (
            <div className="flex justify-center py-10">
              <Loader className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {versions && versions.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">Изменений ещё не было</p>
          )}
          {versions?.map((v) => {
            const isOpen = expanded.has(v.version)
            return (
              <Fragment key={v.version}>
                <button
                  type="button"
                  onClick={() => toggle(v.version)}
                  className="flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left hover:bg-accent"
                >
                  {isOpen ? (
                    <ChevronDown className="mt-0.5 h-4 w-4 shrink-0" />
                  ) : (
                    <ChevronRight className="mt-0.5 h-4 w-4 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge variant="secondary">Версия {v.version}</Badge>
                      <span className="text-muted-foreground">{formatDateTime(v.createdAt)}</span>
                      <span className="text-muted-foreground">· {v.createdBy ?? "система"}</span>
                      <span className="ml-auto text-xs text-muted-foreground">изменений: {v.changes.length}</span>
                    </div>
                    <div className="mt-0.5 text-sm">{v.summary || "—"}</div>
                  </div>
                </button>
                {isOpen && (
                  <div className="space-y-1 pl-6">
                    {v.changes.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Нет строк изменений</p>
                    ) : (
                      v.changes.map((c, i) => <ChangeRow key={i} c={c} orgName={orgName} />)
                    )}
                  </div>
                )}
              </Fragment>
            )
          })}
          {versions && versions.length >= limit && (
            <div className="flex justify-center pt-2">
              <Button size="sm" variant="outline" onClick={() => setLimit((l) => l + PAGE)} disabled={loading}>
                {loading && <Loader className="h-4 w-4 animate-spin" />}
                Показать ещё
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

"use client"

// Platform admin block «Автоматическая обработка» on /settings → «Источники»
// (2026-11-24): per org — how many active sources have «Авторазбор» (sync +
// parse on schedule; switched per source in the table «Источники» above) and
// the org switch «Компании и контакты автоматически» (`discovery.autoApply`,
// src/server/discovery-auto.ts) + «Запустить сейчас» (runs once, also when
// the switch is off). API: /api/admin/sources/auto-processing.

import { useCallback, useEffect, useState } from "react"
import { Loader, Play } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { AutoDiscoveryOrgResult, AutoProcessingOrgRow } from "@/app/api/admin/sources/auto-processing/route"

const API = "/api/admin/sources/auto-processing"

function resultText(r: AutoDiscoveryOrgResult): string {
  if ("skipped" in r) return r.skipped === "nothing new" ? "Новых разобранных сообщений нет" : "Пропущено"
  const companies = r.clientsCreated + r.clientsRevived
  const contacts = r.contactsCreated + r.contactsRevived
  return (
    `Просмотрено сообщений: ${r.scanned}. Компаний: ${companies}, контактов: ${contacts}, связей: ${r.linksApplied}` +
    (r.leftForReview > 0 ? `. На проверку: ${r.leftForReview}` : "")
  )
}

export function AdminAutoProcessing() {
  const [rows, setRows] = useState<AutoProcessingOrgRow[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(API)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Не удалось загрузить")
      setRows(data.rows)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось загрузить")
      setRows([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const toggle = async (row: AutoProcessingOrgRow, value: boolean) => {
    setBusy(row.organizationId)
    try {
      const res = await fetch(API, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: row.organizationId, value }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? "Не удалось сохранить")
      setRows((rs) => rs?.map((r) => (r.organizationId === row.organizationId ? { ...r, autoDiscovery: value } : r)) ?? rs)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить")
    } finally {
      setBusy(null)
    }
  }

  const run = async (row: AutoProcessingOrgRow) => {
    setBusy(row.organizationId)
    try {
      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: row.organizationId, action: "run" }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? "Не удалось запустить")
      toast.success(`${row.name}: ${resultText(data.result)}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось запустить")
    } finally {
      setBusy(null)
    }
  }

  if (!rows) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader className="size-4 animate-spin" /> Загрузка…
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Организация</TableHead>
          <TableHead>Авторазбор источников</TableHead>
          <TableHead>Компании и контакты автоматически</TableHead>
          <TableHead className="w-44" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.organizationId}>
            <TableCell className="font-medium">{r.name}</TableCell>
            <TableCell className="tabular-nums text-sm">
              {r.sourcesActive === 0 ? (
                <span className="text-muted-foreground">нет активных источников</span>
              ) : (
                `${r.sourcesAutomated} из ${r.sourcesActive}`
              )}
            </TableCell>
            <TableCell>
              <Switch
                checked={r.autoDiscovery}
                disabled={busy === r.organizationId}
                onCheckedChange={(v) => void toggle(r, v)}
                aria-label={`Компании и контакты автоматически — ${r.name}`}
              />
            </TableCell>
            <TableCell>
              <Button size="sm" variant="outline" disabled={busy === r.organizationId} onClick={() => void run(r)}>
                {busy === r.organizationId ? <Loader className="size-4 animate-spin" /> : <Play className="size-4" />}
                Запустить сейчас
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

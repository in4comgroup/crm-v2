"use client"

// «Этап воронки» of a company — READ ONLY, derived from its deals in the
// org's funnel (bug list 2026-11-21, item 13). Replaces the old manual field
// `client.funnel_phase` (a fixed list «Осведомлённость … Удержание» that had
// nothing to do with the funnel). Used by the company panel and /clients/[id].

import { useEffect, useState } from "react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { stageColorClass } from "@/lib/deal-board"
import { cn } from "@/lib/utils"
import type { ClientDealStage } from "@/app/api/deals/route"

function dealDisplayName(dealName: string, clientName: string): string {
  const name = clientName.trim()
  const title = dealName.trim()
  if (!name || !title.toLowerCase().startsWith(name.toLowerCase())) return title.replaceAll("—", "-")
  const suffix = title.slice(name.length).match(/^\s*[-–—:]\s*(.+)$/)?.[1]
  return (suffix || title).replaceAll("—", "-")
}

export function ClientFunnelStages({ clientId, clientName, className }: { clientId: string; clientName: string; className?: string }) {
  // Keyed by the company the answer is for, so another company never shows
  // an old answer and no state reset is needed when `clientId` changes.
  const [data, setData] = useState<{ clientId: string; stages: ClientDealStage[] | null } | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/deals?clientStages=${encodeURIComponent(clientId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!cancelled) setData({ clientId, stages: (d.stages ?? []) as ClientDealStage[] })
      })
      .catch(() => {
        if (!cancelled) setData({ clientId, stages: null })
      })
    return () => {
      cancelled = true
    }
  }, [clientId])

  const current = data?.clientId === clientId ? data : null
  const failed = current !== null && current.stages === null
  const stages = current?.stages ?? null

  return (
    <div className={cn("space-y-1", className)}>
      <div className="text-xs text-muted-foreground">Этап воронки</div>
      {failed ? (
        <div className="text-sm text-muted-foreground">Не удалось загрузить сделки</div>
      ) : stages === null ? (
        <div className="text-sm text-muted-foreground">Загрузка…</div>
      ) : stages.length === 0 ? (
        <div className="text-sm text-muted-foreground">Нет сделок</div>
      ) : (
        <ul className="space-y-1">
          {stages.slice(0, 5).map((s) => (
            <li key={s.dealId} className="flex min-w-0 flex-col items-start gap-1 text-sm">
              <Badge variant="secondary" className={cn("shrink-0", stageColorClass({ name: s.stageLabel, role: s.stageRole }))}>
                {s.stageLabel}
              </Badge>
              <Link href={`/deals?openDeal=${s.dealId}`} className="max-w-full wrap-anywhere hover:underline">
                {dealDisplayName(s.dealName, clientName)}
              </Link>
              {s.paused && <span className="shrink-0 text-xs text-muted-foreground">пауза</span>}
            </li>
          ))}
          {stages.length > 5 && <li className="text-xs text-muted-foreground">и ещё {stages.length - 5}</li>}
        </ul>
      )}
    </div>
  )
}

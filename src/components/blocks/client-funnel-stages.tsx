"use client"

// «Этап воронки» of a company — READ ONLY, derived from its deals in the
// org's funnel (bug list 2026-11-21, item 13). Replaces the old manual field
// `client.funnel_phase` (a fixed list «Осведомлённость … Удержание» that had
// nothing to do with the funnel). Used by the company panel and /clients/[id].

import { useEffect, useState } from "react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { stageColorClass } from "@/lib/deal-board"
import { isOpenStageRole } from "@/lib/deal-funnel"
import { clientRelation, type ClientRelation } from "@/lib/client-relation"
import { cn } from "@/lib/utils"
import type { ClientDealStage } from "@/app/api/deals/route"

function dealDisplayName(dealName: string, clientName: string): string {
  const name = clientName.trim()
  const title = dealName.trim()
  if (!name || !title.toLowerCase().startsWith(name.toLowerCase())) return title.replaceAll("—", "-")
  const suffix = title.slice(name.length).match(/^\s*[-–—:]\s*(.+)$/)?.[1]
  return (suffix || title).replaceAll("—", "-")
}

export type ClientDealStagesState = { clientId: string; stages: ClientDealStage[] | null } | null

/**
 * The company's open deals with their stage (`GET /api/deals?clientStages=`).
 * `null` clientId = do not load (the caller passes the state in instead).
 * Keyed by the company the answer is for, so another company never shows
 * an old answer and no state reset is needed when `clientId` changes.
 */
export function useClientDealStages(clientId: string | null): ClientDealStagesState {
  const [data, setData] = useState<ClientDealStagesState>(null)

  useEffect(() => {
    if (!clientId) return
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

  return clientId && data?.clientId === clientId ? data : null
}

/**
 * Relationship from the deals alone (no manual «Поставщик» / «Партнёр»
 * tag) — the same rule as the «Компании» tabs (`clientRelation`): a won deal
 * → «Клиент», an open one (incl. «Контакт до запроса», area 0) →
 * «Потенциальный», none → «Не определено». `null` while loading / failed.
 */
export function relationFromDealStages(state: ClientDealStagesState): ClientRelation | null {
  if (!state?.stages) return null
  return clientRelation({
    companyKind: null,
    hasWonDeal: state.stages.some((s) => s.stageRole === "won"),
    hasOpenDeal: state.stages.some((s) => isOpenStageRole(s.stageRole)),
  })
}

export function ClientFunnelStages({
  clientId,
  clientName,
  className,
  state,
}: {
  clientId: string
  clientName: string
  className?: string
  /** Already loaded by the parent (`useClientDealStages`) — no second request. */
  state?: ClientDealStagesState
}) {
  const own = useClientDealStages(state === undefined ? clientId : null)
  const data = state === undefined ? own : state

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

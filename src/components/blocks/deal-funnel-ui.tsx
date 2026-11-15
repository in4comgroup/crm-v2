"use client"

// Shared client helpers of the custom deal funnel UI (docs/specs/funnel §3, §7):
// board / drawer stage + deal fields, stage roles (replace the old
// «Closed» / «Rejected» name checks), the money forecast per currency, the
// org outcome-reason lists (GET /api/deals/funnel) and the go / no-go card
// helpers. Pure UI glue — no server imports.

import { useEffect, useState } from "react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { DealFunnelStageOption, DealRow } from "@/app/api/deals/route"
import {
  DEFAULT_FUNNEL_REASONS,
  type FunnelConfig,
  type FunnelReason,
  type StageRole,
} from "@/lib/funnel/config"
import { computeForecast, type ForecastResult } from "@/lib/funnel/forecast"
import type { DealCardProposal } from "@/lib/topics/cards"
import type {
  FunnelCatalogEntry,
  FunnelPreviewResult,
  FunnelView,
} from "@/server/funnel-config"
import { stageRoleOf } from "@/lib/deal-funnel"

// ── Stage / deal fields of the funnel contract ────────────────────────────

/** A board stage (the API row carries role / code / forecast fields). */
export type BoardStage = DealFunnelStageOption

/** A board deal (the API row carries the expert probability / brief budget). */
export type BoardDeal = DealRow

export function stageRole(stage: BoardStage | null | undefined): StageRole | null {
  return stage ? stageRoleOf(stage.role) : null
}

export function isOutcomeRole(role: StageRole | null | undefined): boolean {
  return role === "won" || role === "lost"
}

/** Short suffix of a stage in pickers: «(до воронки)», «(итог)», «(30%)», «(эксперт.)». */
export function stagePickerSuffix(stage: BoardStage): string {
  const role = stageRole(stage)
  if (role === "area0") return "(до воронки)"
  if (role === "won" || role === "lost") return "(итог)"
  if (stage.inForecast === false) return "(вне прогноза)"
  if (stage.probabilityMode === "expert") return "(эксперт.)"
  return `(${Math.round(stage.closureProbability * 100)}%)`
}

// ── Forecast (spec §3.4) ──────────────────────────────────────────────────

function toNumber(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

export type CurrencyForecast = ForecastResult & { currency: string }

/** `computeForecast` per currency (the board may hold deals in several). */
export function forecastByCurrency(
  stages: readonly BoardStage[],
  deals: readonly BoardDeal[],
): CurrencyForecast[] {
  const fs = stages.map((s) => ({
    id: s.id,
    role: stageRole(s) ?? "active",
    inForecast: s.inForecast,
    probabilityMode: s.probabilityMode,
    probability: s.closureProbability,
  }))
  const byCur = new Map<string, BoardDeal[]>()
  for (const d of deals) {
    const cur = (d.currency || "RUB").toUpperCase()
    const list = byCur.get(cur) ?? []
    list.push(d)
    byCur.set(cur, list)
  }
  return Array.from(byCur.entries()).map(([currency, list]) => ({
    currency,
    ...computeForecast(
      fs,
      list.map((d) => ({
        stageId: d.funnelStageId,
        status: d.status,
        value: toNumber(d.value),
        expertProbability: toNumber(d.expertProbability),
        currency,
      })),
    ),
  }))
}

// ── Org funnel config (reasons) ───────────────────────────────────────────

/** GET /api/deals/funnel. */
export type FunnelGetResponse = FunnelView
export type { FunnelCatalogEntry, FunnelPreviewResult }

export type FunnelReasons = FunnelConfig["reasons"]

/** The org's outcome-reason lists; generic defaults until loaded / on error. */
export function useFunnelReasons(reloadKey?: unknown): FunnelReasons {
  const [reasons, setReasons] = useState<FunnelReasons>(DEFAULT_FUNNEL_REASONS)
  useEffect(() => {
    let cancelled = false
    fetch("/api/deals/funnel")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Partial<FunnelGetResponse> | null) => {
        if (cancelled || !data?.config?.reasons) return
        setReasons(data.config.reasons)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [reloadKey])
  return reasons
}

/** Required reason picker of one org list (lost / noGo / withdrawn). */
export function ReasonSelect({
  reasons,
  value,
  onChange,
  disabled,
  placeholder = "Выберите причину",
  ariaLabel = "Причина",
}: {
  reasons: readonly FunnelReason[]
  value: string
  onChange: (code: string) => void
  disabled?: boolean
  placeholder?: string
  ariaLabel?: string
}) {
  return (
    <Select value={value || undefined} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="w-full" aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {reasons.map((r) => (
          <SelectItem key={r.code} value={r.code}>
            {r.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// ── Go / no-go card (spec §3.2) ───────────────────────────────────────────

export const NO_GO_PREFIX = "nogo:"

/**
 * A `deal_proposal` written under the entry gate `go_no_go`: «Go» / «No-go»
 * instead of «Создать» / «Не сделка»; no-go reasons from the card snapshot
 * (generic defaults when the snapshot is empty).
 */
export function dealCardGate(card: {
  kind?: string | null
  proposal?: DealCardProposal | null
}): { gate: boolean; noGoReasons: FunnelReason[] } {
  const gate = card.kind === "deal_proposal" && card.proposal?.gate === true
  if (!gate) return { gate: false, noGoReasons: [] }
  const list = card.proposal?.noGoReasons
  return {
    gate: true,
    noGoReasons: list && list.length > 0 ? list : DEFAULT_FUNNEL_REASONS.noGo,
  }
}

export const GO_LABEL = "Go"
export const NO_GO_LABEL = "No-go"
export const NO_GO_DIALOG_TITLE = "No-go: не участвуем"
export const NO_GO_DIALOG_DESCRIPTION =
  "Выберите причину отказа от участия. Комментарий — по желанию. Решение сохранится в истории темы и компании."

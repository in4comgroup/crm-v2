"use client"

// AI limit warnings for the org OWNER (docs/specs/models/08-monthly-limit.md):
// - `AiLimitBanner` — on /account (like the «Профиль организации» banner);
//   amber from 80 % of the monthly limit or when today's daily budget is
//   used up, red when the monthly limit is used up. The server decides who
//   sees it (GET /api/account/ai-usage?banner=1; non-owners get show:false).
//   Later the same states go to the general notifications.
// - `AiMonthlyLimitCard` — the limit with this month's spend on the
//   «Использование ИИ» tab.
// Amounts = end-user cost (with markup), USD; the daily budget has no
// amounts (gateway cost, owners never see it).

import { useEffect, useState } from "react"
import { TriangleAlert } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import type { AiMonthlyLimitState } from "@/lib/ai-budget"
import type { AccountAiLimitBanner, AccountAiLimits } from "@/app/api/account/ai-usage/route"

const usd = (n: number) =>
  `$${n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** «1 декабря» (UTC: the limit resets at 00:00 UTC). */
const resetDay = (iso: string) =>
  new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" })

const pctText = (share: number) => `${Math.round(share * 100)} %`

/** Russian warning text; null = nothing to warn about. */
export function aiLimitMessage(l: AccountAiLimits): { severe: boolean; text: string } | null {
  const m = l.monthly
  if (m.level === "exceeded") {
    return {
      severe: true,
      text: `Месячный лимит ИИ исчерпан: ${usd(m.spentUsd)} из ${usd(m.budgetUsd)}. Фоновая обработка (разбор источников, темы) остановлена до ${resetDay(m.resetsAt)}. ИИ чат и функции, которые вы запускаете сами, работают.`,
    }
  }
  if (m.level === "warning") {
    return {
      severe: false,
      text: `Израсходовано ${pctText(m.share)} месячного лимита ИИ: ${usd(m.spentUsd)} из ${usd(m.budgetUsd)}. Когда лимит закончится, фоновая обработка остановится до ${resetDay(m.resetsAt)}.`,
    }
  }
  if (l.dailyExceeded) {
    return {
      severe: false,
      text: "Дневной лимит ИИ исчерпан: фоновая обработка источников продолжится завтра. ИИ чат и функции, которые вы запускаете сами, работают.",
    }
  }
  return null
}

function Notice({ severe, text, action, className }: { severe: boolean; text: string; action?: React.ReactNode; className?: string }) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-sm",
        severe
          ? "border-destructive/50 bg-destructive/10 text-destructive"
          : "border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-200",
        className,
      )}
    >
      <TriangleAlert className="size-4 shrink-0" />
      <span className="flex-1">{text}</span>
      {action}
    </div>
  )
}

export function AiLimitBanner({
  onOpen,
  refreshKey,
  className,
}: {
  /** Opens the «Использование ИИ» tab. */
  onOpen?: () => void
  refreshKey?: number
  className?: string
}) {
  const [state, setState] = useState<AccountAiLimitBanner | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/account/ai-usage?banner=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && setState(d))
      .catch(() => !cancelled && setState(null))
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  if (!state?.show) return null
  const msg = aiLimitMessage(state)
  if (!msg) return null
  return (
    <Notice
      severe={msg.severe}
      text={msg.text}
      className={className}
      action={
        onOpen ? (
          <button type="button" className="font-medium underline underline-offset-2" onClick={onOpen}>
            Использование ИИ
          </button>
        ) : undefined
      }
    />
  )
}

/** Inline notice for the «Использование ИИ» tab (no fetch). */
export function AiLimitNotice({ limits }: { limits: AccountAiLimits }) {
  const msg = aiLimitMessage(limits)
  return msg ? <Notice severe={msg.severe} text={msg.text} /> : null
}

export function AiMonthlyLimitCard({ monthly }: { monthly: AiMonthlyLimitState | null }) {
  const bar = monthly ? Math.min(1, monthly.share) : 0
  const color =
    monthly?.level === "exceeded" ? "bg-destructive" : monthly?.level === "warning" ? "bg-amber-500" : "bg-primary"
  return (
    <Card className="gap-2">
      <CardHeader>
        <CardTitle className="text-sm font-medium">Месячный лимит ИИ</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {!monthly ? (
          <p className="text-sm text-muted-foreground">—</p>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-lg font-medium tabular-nums">
                {usd(monthly.spentUsd)} <span className="text-sm font-normal text-muted-foreground">из {usd(monthly.budgetUsd)}</span>
              </span>
              <span className="text-sm tabular-nums text-muted-foreground">
                {monthly.budgetUsd > 0 ? pctText(monthly.share) : "—"}
              </span>
            </div>
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(bar * 100)}
              aria-label="Израсходовано месячного лимита"
            >
              <div className={cn("h-full rounded-full", color)} style={{ width: `${bar * 100}%` }} />
            </div>
            <p className="text-xs text-muted-foreground">
              Осталось {usd(monthly.remainingUsd)} · лимит обновится {resetDay(monthly.resetsAt)} · расход этого
              месяца с начала месяца (UTC). Когда лимит исчерпан, фоновая обработка останавливается; ИИ чат
              работает.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}

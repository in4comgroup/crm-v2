"use client"

// AI limit warnings for the org OWNER (docs/specs/models/08-monthly-limit.md):
// - `AiLimitBanner` — on /account (like the «Профиль организации» banner);
//   steps of docs/specs/notifications Q3: a calm (neutral) note from 70 %
//   of the monthly limit, amber from 90 % or when today's daily budget is
//   used up, red when the monthly limit is used up. The server decides who
//   sees it (GET /api/account/ai-usage?banner=1; non-owners get show:false).
//   The same steps also go to the bell (notifications `ai.limit.month.*`).
// - `AiMonthlyLimitCard` — the limit with this month's spend on the
//   «Использование ИИ» tab.
// Amounts = end-user cost (with markup), USD; the daily budget has no
// amounts (gateway cost, owners never see it).

import { useEffect, useState } from "react"
import { Info, TriangleAlert } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { aiLimitStep, type AiMonthlyLimitState } from "@/lib/ai-budget"
import type { AccountAiLimitBanner, AccountAiLimits } from "@/app/api/account/ai-usage/route"

const usd = (n: number) =>
  `$${n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** «1 декабря» (UTC: the limit resets at 00:00 UTC). */
const resetDay = (iso: string) =>
  new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" })

const pctText = (share: number) => `${Math.round(share * 100)} %`

export type AiLimitTone = "info" | "warning" | "severe"

/** Russian warning text; null = nothing to warn about. */
export function aiLimitMessage(l: AccountAiLimits): { tone: AiLimitTone; text: string } | null {
  const m = l.monthly
  if (m.level === "exceeded") {
    return {
      tone: "severe",
      text: `Месячный лимит ИИ исчерпан: ${usd(m.spentUsd)} из ${usd(m.budgetUsd)}. Фоновая обработка (разбор источников, темы) остановлена до ${resetDay(m.resetsAt)}. ИИ чат (в приложении и в Telegram) тоже недоступен до этой даты.`,
    }
  }
  if (m.level === "warning") {
    return {
      tone: "warning",
      text: `Израсходовано ${pctText(m.share)} месячного лимита ИИ: ${usd(m.spentUsd)} из ${usd(m.budgetUsd)}. Когда лимит закончится, фоновая обработка остановится до ${resetDay(m.resetsAt)}.`,
    }
  }
  if (l.dailyExceeded) {
    return {
      tone: "warning",
      text: "Дневной лимит ИИ исчерпан: фоновая обработка источников продолжится завтра. ИИ чат и функции, которые вы запускаете сами, работают.",
    }
  }
  if (m.level === "info") {
    return {
      tone: "info",
      text: `Израсходовано ${pctText(m.share)} месячного лимита ИИ: ${usd(m.spentUsd)} из ${usd(m.budgetUsd)}. Лимит обновится ${resetDay(m.resetsAt)}.`,
    }
  }
  return null
}

function Notice({ tone, text, action, className }: { tone: AiLimitTone; text: string; action?: React.ReactNode; className?: string }) {
  const Icon = tone === "info" ? Info : TriangleAlert
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-sm",
        tone === "severe"
          ? "border-destructive/50 bg-destructive/10 text-destructive"
          : tone === "warning"
            ? "border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-200"
            : "bg-muted/40 text-muted-foreground",
        className,
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
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
      tone={msg.tone}
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
  return msg ? <Notice tone={msg.tone} text={msg.text} /> : null
}

export function AiMonthlyLimitCard({ monthly }: { monthly: AiMonthlyLimitState | null }) {
  const bar = monthly ? Math.min(1, monthly.share) : 0
  const color =
    monthly?.level === "exceeded" ? "bg-destructive" : monthly?.level === "warning" ? "bg-amber-500" : "bg-primary"
  const step = monthly ? aiLimitStep(monthly.share) : 0
  const stepText =
    !monthly || monthly.level === "ok"
      ? null
      : monthly.level === "exceeded"
        ? "Лимит исчерпан"
        : `Пройден порог ${step} %`
  const stepClass =
    monthly?.level === "exceeded"
      ? "text-destructive"
      : monthly?.level === "warning"
        ? "text-amber-700 dark:text-amber-300"
        : "text-muted-foreground"
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
              <span className="flex items-baseline gap-2 text-sm tabular-nums text-muted-foreground">
                {stepText && <span className={cn("text-xs font-medium", stepClass)}>{stepText}</span>}
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
              месяца с начала месяца (UTC). Когда лимит исчерпан, фоновая обработка и ИИ чат
              останавливаются до обновления лимита.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}

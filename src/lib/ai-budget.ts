// Monthly AI limit per organization (docs/specs/models/08-monthly-limit.md).
// PURE, client-safe: the state of the limit and the reset date, shared by
// the server (runtime gate, owner API) and the UI (/account banner + the
// «Использование ИИ» tab). The limit is END-USER cost (gateway cost with
// the markup in force at call time), USD per calendar month (UTC).

/** Share of the limit from which the owner is warned. */
export const AI_MONTHLY_WARN_SHARE = 0.8

export type AiMonthlyLimitLevel = "ok" | "warning" | "exceeded"

export type AiMonthlyLimitState = {
  budgetUsd: number
  spentUsd: number
  /** spent / budget (1 when the budget is 0). */
  share: number
  remainingUsd: number
  level: AiMonthlyLimitLevel
  /** First day of the next month, 00:00 UTC (ISO). */
  resetsAt: string
}

/** First instant of the calendar month of `now` (UTC). */
export function startOfUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

/** First instant of the next calendar month (UTC). */
export function nextUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
}

/** PURE. Level: exceeded at ≥ 100 % (or any spend with a 0 budget), warning at ≥ 80 %. */
export function aiMonthlyLimitState(spentUsd: number, budgetUsd: number, now: Date): AiMonthlyLimitState {
  const spent = Math.max(0, spentUsd)
  const budget = Math.max(0, budgetUsd)
  const share = budget > 0 ? spent / budget : 1
  const level: AiMonthlyLimitLevel =
    spent >= budget ? "exceeded" : share >= AI_MONTHLY_WARN_SHARE ? "warning" : "ok"
  return {
    budgetUsd: budget,
    spentUsd: spent,
    share,
    remainingUsd: Math.max(0, budget - spent),
    level,
    resetsAt: nextUtcMonth(now).toISOString(),
  }
}

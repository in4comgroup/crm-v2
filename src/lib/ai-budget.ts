// Monthly AI limit per organization (docs/specs/models/08-monthly-limit.md).
// PURE, client-safe: the state of the limit and the reset date, shared by
// the server (runtime gate, owner API) and the UI (/account banner + the
// «Использование ИИ» tab). The limit is END-USER cost (gateway cost with
// the markup in force at call time), USD per calendar month (UTC).

// Steps of the limit (docs/specs/notifications Q3, one rule everywhere —
// banner, usage card, notifications): ≥ 70 % `info`, ≥ 90 % `warning`,
// ≥ 100 % `exceeded`.

/** Share of the limit from which the owner is informed (calm note). */
export const AI_MONTHLY_INFO_SHARE = 0.7
/** Share of the limit from which the owner is warned. */
export const AI_MONTHLY_WARN_SHARE = 0.9

export type AiMonthlyLimitLevel = "ok" | "info" | "warning" | "exceeded"

/** The highest step reached, in percent of the limit. */
export type AiLimitStep = 0 | 70 | 90 | 100

/**
 * PURE. Step of the monthly limit for a spend share (spent / budget; pass 1
 * for a 0 budget): 100 at ≥ 1, 90 at ≥ 0.9, 70 at ≥ 0.7, else 0. Used by the
 * hourly notification check (one notification per step and month).
 */
export function aiLimitStep(share: number): AiLimitStep {
  if (!Number.isFinite(share)) return share > 0 ? 100 : 0
  if (share >= 1) return 100
  if (share >= AI_MONTHLY_WARN_SHARE) return 90
  if (share >= AI_MONTHLY_INFO_SHARE) return 70
  return 0
}

const LEVEL_BY_STEP: Record<AiLimitStep, AiMonthlyLimitLevel> = {
  0: "ok",
  70: "info",
  90: "warning",
  100: "exceeded",
}

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

/** PURE. Level: exceeded at ≥ 100 % (or with a 0 budget), warning at ≥ 90 %, info at ≥ 70 %. */
export function aiMonthlyLimitState(spentUsd: number, budgetUsd: number, now: Date): AiMonthlyLimitState {
  const spent = Math.max(0, spentUsd)
  const budget = Math.max(0, budgetUsd)
  const share = budget > 0 ? spent / budget : 1
  const level: AiMonthlyLimitLevel = spent >= budget ? "exceeded" : LEVEL_BY_STEP[aiLimitStep(share)]
  return {
    budgetUsd: budget,
    spentUsd: spent,
    share,
    remainingUsd: Math.max(0, budget - spent),
    level,
    resetsAt: nextUtcMonth(now).toISOString(),
  }
}

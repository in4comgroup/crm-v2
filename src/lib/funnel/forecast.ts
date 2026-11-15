// Money forecast of a custom funnel (docs/specs/funnel §3.4, rule W5). PURE,
// client-safe: the board header and the server use the same function.

import type { ProbabilityMode, StageRole } from "./config"

export type ForecastStage = {
  id: string
  role: StageRole
  inForecast: boolean
  probabilityMode: ProbabilityMode
  /** 0..1 */
  probability: number
}

export type ForecastDeal = {
  stageId: string
  /** active | paused | cancelled | deleted */
  status: string
  value: number | null
  /** 0..100 */
  expertProbability: number | null
  currency?: string | null
}

export type ForecastResult = {
  /** Σ value × probability of the counted deals. */
  weighted: number
  /** Σ value of the counted deals (unweighted). */
  pipeline: number
  counted: number
  /** Deals in forecast stages that miss the amount or the expert probability («Без оценки»). */
  unestimated: number
  /** Σ value of active deals at the won stage (actual, shown apart). */
  won: number
}

/**
 * PURE. A deal counts when it is `active` (not paused), its stage is an
 * `active`-role stage with `inForecast`, it has an amount, and — for
 * `probabilityMode = expert` — an expert probability. Area 0, won and lost
 * never count in `weighted`; won is summed apart. Currency mixing is the
 * caller's concern (the board shows one currency).
 */
export function computeForecast(stages: readonly ForecastStage[], deals: readonly ForecastDeal[]): ForecastResult {
  const byId = new Map(stages.map((s) => [s.id, s]))
  const r: ForecastResult = { weighted: 0, pipeline: 0, counted: 0, unestimated: 0, won: 0 }
  for (const d of deals) {
    const s = byId.get(d.stageId)
    if (!s) continue
    if (s.role === "won") {
      if (d.status === "active" && d.value != null) r.won += d.value
      continue
    }
    if (d.status !== "active" || s.role !== "active" || !s.inForecast) continue
    const p = s.probabilityMode === "expert" ? (d.expertProbability == null ? null : d.expertProbability / 100) : s.probability
    if (d.value == null || d.value <= 0 || p == null) {
      r.unestimated++
      continue
    }
    r.counted++
    r.pipeline += d.value
    r.weighted += d.value * p
  }
  return r
}

// Parameters of the attention engine (docs/specs/topics/06-attention-engine.md
// §13). Client-safe: typed defaults + a zod schema of a PARTIAL override.
// Settings ladder (06 §13): org_setting `attention.params` → platform_setting
// `attention.params` → these defaults (src/server/topics/attention/store.ts).
// Evening reminders / P6 daily limit / delivery are phase 7 — not here.

import { z } from "zod"

export type EffortKey = "quick" | "medium" | "complex"

export type AttentionParams = {
  /** `cards.timeZone` — org time zone (IANA). */
  timeZone: string
  /** `cards.workingHours` — Mon–Fri (production calendar) start / end, "HH:MM". */
  workStart: string
  workEnd: string
  /** `cards.morningDigestTime` — «Сводка» snapshot, every working day. */
  morningDigestTime: string
  /** `cards.weeklyReview` — «Неделя» snapshot: ISO weekday (1 = Mon … 7 = Sun) + time. */
  weeklyReviewWeekday: number
  weeklyReviewTime: string
  /** `cards.deadlineImmediateHours` (I1). */
  deadlineImmediateHours: number
  /** `cards.digestActionBufferHours` (I2). */
  digestActionBufferHours: number
  /** `cards.deadlineLeadDays` — working days by effort (I3). */
  deadlineLeadDays: Record<EffortKey, number>
  /** `cards.expiryDays` — working days by profile at cycle start (06 §7.3). */
  expiryDays: { P8: number; P6: number; D4: number; W1: number }
  /** `cards.weeklyGraceDays` — calendar days in «Неделя / Истекло». */
  weeklyGraceDays: number
  /** `attention.boostMax` + switches (06 §4.4). */
  boostMax: number
  boostReminder: boolean
  boostOverdueReaction: boolean
  boostCorroboration: boolean
  /** `attention.reactionWorkingDays` — boost O threshold by effort. */
  reactionWorkingDays: Record<EffortKey, number>
  /** `attention.waitingOnThemLowersLevel` (H3). */
  waitingOnThemLowersLevel: boolean
  /** `topics.dormantDays` (H5, next check). */
  dormantDays: number
  /** `topics.expireDays` (next check). */
  expireDays: number
  /** `deals.riskImmediateMinSeverity` (I5). */
  riskImmediateMinSeverity: number
}

export const ATTENTION_DEFAULTS: AttentionParams = {
  timeZone: "Europe/Moscow",
  workStart: "08:00",
  workEnd: "18:00",
  morningDigestTime: "07:30",
  weeklyReviewWeekday: 5,
  weeklyReviewTime: "12:00",
  deadlineImmediateHours: 24,
  digestActionBufferHours: 3,
  deadlineLeadDays: { quick: 2, medium: 3, complex: 5 },
  expiryDays: { P8: 10, P6: 7, D4: 5, W1: 10 },
  weeklyGraceDays: 7,
  boostMax: 2,
  boostReminder: true,
  boostOverdueReaction: true,
  boostCorroboration: true,
  reactionWorkingDays: { quick: 1, medium: 2, complex: 3 },
  waitingOnThemLowersLevel: true,
  dormantDays: 21,
  expireDays: 60,
  riskImmediateMinSeverity: 7,
}

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const days = z.number().int().min(0).max(60)
const effort = z.object({ quick: days, medium: days, complex: days }).partial()

/** A partial override (org or platform level). Unknown keys are dropped. */
export const attentionParamsOverrideSchema = z
  .object({
    timeZone: z.string().min(1).max(64),
    workStart: hhmm,
    workEnd: hhmm,
    morningDigestTime: hhmm,
    weeklyReviewWeekday: z.number().int().min(1).max(7),
    weeklyReviewTime: hhmm,
    deadlineImmediateHours: z.number().min(1).max(168),
    digestActionBufferHours: z.number().min(0).max(48),
    deadlineLeadDays: effort,
    expiryDays: z.object({ P8: days, P6: days, D4: days, W1: days }).partial(),
    weeklyGraceDays: days,
    boostMax: z.number().int().min(0).max(5),
    boostReminder: z.boolean(),
    boostOverdueReaction: z.boolean(),
    boostCorroboration: z.boolean(),
    reactionWorkingDays: effort,
    waitingOnThemLowersLevel: z.boolean(),
    dormantDays: z.number().int().min(1).max(365),
    expireDays: z.number().int().min(1).max(730),
    riskImmediateMinSeverity: z.number().int().min(0).max(10),
  })
  .partial()

export type AttentionParamsOverride = z.infer<typeof attentionParamsOverrideSchema>

/** Defaults ← platform override ← org override (later wins, nested maps merged). */
export function mergeAttentionParams(...overrides: (AttentionParamsOverride | null | undefined)[]): AttentionParams {
  let p: AttentionParams = {
    ...ATTENTION_DEFAULTS,
    deadlineLeadDays: { ...ATTENTION_DEFAULTS.deadlineLeadDays },
    expiryDays: { ...ATTENTION_DEFAULTS.expiryDays },
    reactionWorkingDays: { ...ATTENTION_DEFAULTS.reactionWorkingDays },
  }
  for (const o of overrides) {
    if (!o) continue
    const { deadlineLeadDays, expiryDays, reactionWorkingDays, ...flat } = o
    p = {
      ...p,
      ...flat,
      deadlineLeadDays: { ...p.deadlineLeadDays, ...deadlineLeadDays },
      expiryDays: { ...p.expiryDays, ...expiryDays },
      reactionWorkingDays: { ...p.reactionWorkingDays, ...reactionWorkingDays },
    }
  }
  return p
}

/** Short stable hash of the parameters (+ extra parts, e.g. the taxonomy version). */
export function attentionParamsHash(p: AttentionParams, ...extra: (string | number)[]): string {
  const s = JSON.stringify([p, extra])
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

// Parameters of topics delivery (topics plan phase 7; spec topics/01 §8.1,
// §8.4; 06-attention-engine.md §7.2–7.3, §13). Client-safe: typed defaults +
// a zod schema of a PARTIAL override.
// Settings ladder: org_setting `delivery.params` → platform_setting
// `delivery.params` → these defaults (src/server/topics/delivery/store.ts).
// The morning / weekly snapshot times, the time zone and the working hours
// are attention parameters (`attention.params`: `morningDigestTime`,
// `weeklyReviewWeekday` + `weeklyReviewTime`, `timeZone`) — one source.

import { z } from "zod"

export type DeliveryParams = {
  /** `cards.eveningDigestTime` — evening reminders «Не закрыто сегодня», working days, org time. */
  eveningDigestTime: string
  /** `cards.dailyPushLimit` — distinct P6 topics per recipient per local day in «Сейчас» (overflow → «Сводка»). 0 = no limit. */
  dailyPushLimit: number
  /** `cards.p6RepeatMax` — evening reminders per display cycle (P6 and P8, 06 §15 A7). */
  p6RepeatMax: number
  /** `cards.digestVisibleItems` — «Сводка» entries shown in the morning email (rest = «Ещё N»). */
  digestVisibleItems: number
  /** `cards.telegramMaxPerCard7d` — Telegram pushes per card in 7 days (Telegram channel, later). */
  telegramMaxPerCard7d: number
  /** Hours after a scheduled time in which the hourly run may still send that email (cron gaps). */
  sendWindowHours: number
}

export const DELIVERY_DEFAULTS: DeliveryParams = {
  eveningDigestTime: "17:00",
  dailyPushLimit: 3,
  p6RepeatMax: 3,
  digestVisibleItems: 5,
  telegramMaxPerCard7d: 2,
  sendWindowHours: 4,
}

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)

/** A partial override (org or platform level). Unknown keys are dropped. */
export const deliveryParamsOverrideSchema = z
  .object({
    eveningDigestTime: hhmm,
    dailyPushLimit: z.number().int().min(0).max(20),
    p6RepeatMax: z.number().int().min(0).max(10),
    digestVisibleItems: z.number().int().min(1).max(20),
    telegramMaxPerCard7d: z.number().int().min(0).max(20),
    sendWindowHours: z.number().int().min(1).max(12),
  })
  .partial()

export type DeliveryParamsOverride = z.infer<typeof deliveryParamsOverrideSchema>

/** Defaults ← platform override ← org override (later wins). */
export function mergeDeliveryParams(...overrides: (DeliveryParamsOverride | null | undefined)[]): DeliveryParams {
  let p: DeliveryParams = { ...DELIVERY_DEFAULTS }
  for (const o of overrides) if (o) p = { ...p, ...o }
  return p
}

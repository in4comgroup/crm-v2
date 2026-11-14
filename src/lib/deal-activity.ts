// «N дн без активности» on the deal card — the pure part (client-safe, no DB).
//
// Last activity of a deal (product decision, 2026-11-14):
//   1. "topic" — the latest date of a real MESSAGE on any topic linked to the
//      deal (`topic.deal_id`, status ≠ `merged`): max of
//      `coalesce(source_item.source_created_at, source_item.created_at)` over
//      `topic_item` → `source_item`, inbound and outbound, any role. NOT
//      `topic.last_activity_at` (it also moves on process signals that mean
//      silence) and no process instances. Used only in topics mode `on`.
//   2. "deal" — otherwise (no linked topic, no message on them, mode not
//      `on`): max of the deal's `deal_activity` rows, its tasks' `updated_at`
//      and the deal's `created_at`. NOT `deal.updated_at` (agent / technical
//      writes such as kanban position touch it).
// The DB side is `loadDealLastActivity` in src/server/deal-activity.ts.

// Stage norm when `deal_funnel_stage.stale_norm_days` is null.
export const DEFAULT_STALE_NORM_DAYS = 14
export const STALE_NORM_MIN_DAYS = 1
export const STALE_NORM_MAX_DAYS = 365

export type DealLastActivitySource = "topic" | "deal"

export type DealLastActivity = {
  at: Date
  source: DealLastActivitySource
  // Only for source "topic": the topic that holds the latest message.
  topicId: string | null
  topicTitle: string | null
}

export type DealActivityInputs = {
  // Latest message on the deal's topics (null = none / mode not `on`).
  topic: { at: Date; topicId: string; topicTitle: string } | null
  // Latest `deal_activity.created_at` of the deal.
  dealActivityAt: Date | null
  // Latest `task.updated_at` of the deal's tasks.
  taskAt: Date | null
  dealCreatedAt: Date
}

const validDate = (d: Date | null | undefined): d is Date =>
  !!d && Number.isFinite(d.getTime())

// Source pick: a topic message wins whenever there is one; else the deal's
// own activity (never earlier than its creation).
export function pickDealLastActivity(input: DealActivityInputs): DealLastActivity {
  if (input.topic && validDate(input.topic.at)) {
    return {
      at: input.topic.at,
      source: "topic",
      topicId: input.topic.topicId,
      topicTitle: input.topic.topicTitle,
    }
  }
  let at = input.dealCreatedAt
  for (const c of [input.dealActivityAt, input.taskAt]) {
    if (validDate(c) && c.getTime() > at.getTime()) at = c
  }
  return { at, source: "deal", topicId: null, topicTitle: null }
}

// Whole days since `at` (floor of elapsed ms / 86 400 000), never negative.
// Same org-agnostic rule as the old mock `staleDaysFrom`.
export function daysSinceActivity(
  at: string | Date | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!at) return null
  const then = (typeof at === "string" ? new Date(at) : at).getTime()
  if (!Number.isFinite(then)) return null
  const days = Math.floor((now.getTime() - then) / 86_400_000)
  return days < 0 ? 0 : days
}

export function effectiveStaleNorm(staleNormDays: number | null | undefined): number {
  return typeof staleNormDays === "number" && staleNormDays > 0
    ? staleNormDays
    : DEFAULT_STALE_NORM_DAYS
}

const TERMINAL_STAGE_NAMES = new Set(["Closed", "Rejected"])

export type DealStaleInput = {
  lastActivityAt?: string | null
  funnelStageName: string
  status: string
  staleNormDays?: number | null
}

export type DealStaleInfo = {
  days: number
  norm: number
  isStale: boolean
}

// What the card shows: null = nothing (unknown date, terminal stage, a
// paused / cancelled / deleted deal). `isStale` = days > stage norm.
export function dealStaleInfo(
  d: DealStaleInput,
  now: Date = new Date(),
): DealStaleInfo | null {
  if (d.status !== "active") return null
  if (TERMINAL_STAGE_NAMES.has(d.funnelStageName)) return null
  const days = daysSinceActivity(d.lastActivityAt, now)
  if (days === null) return null
  const norm = effectiveStaleNorm(d.staleNormDays)
  return { days, norm, isStale: days > norm }
}

// Tooltip: «Последняя активность: 03.11.2026 · по теме «…»» (+ the norm).
export function lastActivityHint(
  d: {
    lastActivityAt?: string | null
    lastActivitySource?: DealLastActivitySource | null
    lastActivityTopicTitle?: string | null
  },
  norm?: number,
): string | null {
  if (!d.lastActivityAt) return null
  const date = new Date(d.lastActivityAt)
  if (!Number.isFinite(date.getTime())) return null
  const parts = [`Последняя активность: ${formatActivityDate(date)}`]
  if (d.lastActivitySource === "topic") {
    parts.push(d.lastActivityTopicTitle ? `по теме «${d.lastActivityTopicTitle}»` : "по теме")
  } else if (d.lastActivitySource === "deal") {
    parts.push("по сделке")
  }
  if (norm !== undefined) parts.push(`Норма стадии: ${norm} дн`)
  return parts.join(" · ")
}

export function formatActivityDate(date: Date): string {
  return date.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

// «Настройки стадий» input → stored value: empty = null (default 14),
// else a whole number 1–365. Returns undefined when invalid.
export function parseStaleNormInput(
  value: unknown,
): number | null | undefined {
  if (value === null || value === undefined) return null
  if (typeof value === "string") {
    const t = value.trim()
    if (t === "") return null
    if (!/^\d+$/.test(t)) return undefined
    return parseStaleNormInput(Number(t))
  }
  if (typeof value !== "number" || !Number.isInteger(value)) return undefined
  if (value < STALE_NORM_MIN_DAYS || value > STALE_NORM_MAX_DAYS) return undefined
  return value
}

// Contract between the attention engine (src/server/topics/attention/) and
// the card engine (src/server/topics/cards/), topics plan phase 4,
// docs/specs/topics/06-attention-engine.md. Client-safe (no server imports).
// Stored in `topic.attention` (jsonb); `topic.display_profile`, `topic.list`,
// `topic.next_attention_check_at` and the cycle columns mirror parts of it.

export const DISPLAY_PROFILES = ["P8", "P6", "D4", "W1", "S0"] as const
export type DisplayProfile = (typeof DISPLAY_PROFILES)[number]

/** now = «Сейчас», digest = «Сводка», week = «Неделя», none = only «Все темы». */
export const TOPIC_LISTS = ["now", "digest", "week", "none"] as const
export type TopicList = (typeof TOPIC_LISTS)[number]

export const TOPIC_LIST_LABELS_RU: Record<TopicList, string> = {
  now: "Сейчас",
  digest: "Сводка",
  week: "Неделя",
  none: "Все темы",
}

/** Escalations of 06 §6 that fired (I1–I5). */
export type AttentionEscalation = "I1" | "I2" | "I3" | "I4" | "I5"

export type TopicAttention = {
  /** Contract version of this JSON. */
  v: 1
  computedAt: string // ISO
  /** Why the topic has no placement: status, no_active_signal, snoozed, … (null = placed). */
  hiddenReason: string | null
  /** Score after boosts and caps (06 §4.4–4.5); the base score stays on `topic.score`. */
  score: number
  band: "none" | "low" | "normal" | "high" | "very_high" | "critical"
  class: "risk" | "chance" | "fyi" | null
  leadCode: string | null
  /** Boosts that applied (R, O, C) with their points. */
  boosts: { code: "R" | "O" | "C"; points: number }[]
  /** Base profile (step G) and final profile after H and I. */
  baseProfile: DisplayProfile | null
  profile: DisplayProfile | null
  list: TopicList
  escalations: AttentionEscalation[]
  /** Next relevant deadline (owner us / unknown), ISO date or datetime. */
  deadline: string | null
  overdue: boolean
  /** Rank inside the list (06 §7.4): lower = higher in the list. */
  rank: number
  /** Display cycle (06 §7.1). `cycleStarted` = a NEW cycle started in THIS computation (material change). */
  cycleStartedAt: string | null
  cycleReason: string | null
  cycleStarted: boolean
  /** Card expiry moment for this cycle (06 §7.3), ISO; null = no expiry. */
  cardExpiresAt: string | null
  /** Next time the hourly run must recompute (06 §10), ISO. */
  nextCheckAt: string | null
  /** «Почему в этом списке» (06 §11): short Russian lines, in order. */
  explanation: string[]

  // ── Optional fields (added by the attention engine; readers may ignore) ──
  /** «Неделя» section: `expired` = «Истекло» (card expired, 7-day grace), `dormant` = «Тема затихла». */
  section?: "expired" | "dormant" | null
  /** Exact sort key inside the list (06 §7.4); ascending string order = `rank` order. */
  rankKey?: string
  /** Score of the lead before boosts (06 §4.3). */
  baseScore?: number
  leadInstanceId?: string | null
  /** H-rules that lowered the profile (06 §5.2): H3 waiting on them, H4 dampener. */
  adjustments?: { rule: "H3" | "H4"; levels: number; until: string | null }[]
  /** Since when the topic waits on us (boost O), ISO. */
  waitingSince?: string | null
  /** Snooze end while the topic is hidden by a snooze (H2), ISO. */
  snoozedUntil?: string | null
  /** Hash of the parameters + taxonomy version used (recompute on change, 06 §10). */
  paramsHash?: string
  /** Engine memory for the next run and the read-time check. Not for the UI. */
  engine?: Record<string, unknown>
}

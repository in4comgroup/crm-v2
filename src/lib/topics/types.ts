// Client-safe contract of the topics engine, topic resolution (spec
// topics/01 §2, §6, §7; plan phase 3). Shared by the engine
// (`src/server/topics/`), the later admin debug page and its API.
// No DB, no server imports. The DB columns are text; these lists validate them.

/** topic.status (spec §7.1). */
export const TOPIC_STATUSES = [
  "open",
  "dormant",
  "resolved",
  "done",
  "dismissed",
  "merged",
  "expired",
  "archived",
] as const
export type TopicStatus = (typeof TOPIC_STATUSES)[number]

export const TOPIC_STATUS_LABELS_RU: Record<TopicStatus, string> = {
  open: "Открыта",
  dormant: "Затихла",
  resolved: "Решена",
  done: "Готово",
  dismissed: "Не относится",
  merged: "Объединена",
  expired: "Истекла",
  archived: "В архиве",
}

/** Statuses that take new items (a dormant topic reopens on any new item). */
export const TOPIC_LIVE_STATUSES: readonly TopicStatus[] = ["open", "dormant"]
/** Statuses that reopen inside the reopen window (from `closed_at`). */
export const TOPIC_REOPENABLE_STATUSES: readonly TopicStatus[] = ["resolved", "done"]

/** topic.sub_state (spec §7.1). */
export const TOPIC_SUB_STATES = ["waiting_on_us", "waiting_on_them", "none"] as const
export type TopicSubState = (typeof TOPIC_SUB_STATES)[number]

export const TOPIC_SUB_STATE_LABELS_RU: Record<TopicSubState, string> = {
  waiting_on_us: "Ждут нас",
  waiting_on_them: "Ждём их",
  none: "—",
}

/** topic_item.role */
export const TOPIC_ITEM_ROLES = ["origin", "update", "closing", "context"] as const
export type TopicItemRole = (typeof TOPIC_ITEM_ROLES)[number]

export const TOPIC_ITEM_ROLE_LABELS_RU: Record<TopicItemRole, string> = {
  origin: "Начало",
  update: "Обновление",
  closing: "Закрытие",
  context: "Контекст",
}

/** topic_event.type */
export const TOPIC_EVENT_TYPES = [
  "created",
  "item_attached",
  "item_detached",
  "reopened",
  "resolved",
  "dormant",
  "expired",
  "archived",
  "done",
  "dismissed",
  "merged_into",
  "merged_from",
  "relinked",
  // Attention engine (phase 4): the list changed (payload { from, to, reason }).
  "attention_changed",
  // Deal bridge (phase 5) / deal state + risks (phase 5a).
  "deal_decision",
  "deal_context",
  "deal_undone",
  "deal_risk",
  // User actions of the topics UI (phase 6).
  "snoozed",
  "unsnoozed",
  "owner_changed",
  "deal_linked",
  "deal_unlinked",
  // CRM checks + watchdogs (phase 8): a process instance was added to the
  // topic or its condition was cleared (payload { code, action: added |
  // cleared, instanceId, evidence?, reason? }).
  "process_signal",
] as const
export type TopicEventType = (typeof TOPIC_EVENT_TYPES)[number]

/** topic_event.actor */
export const TOPIC_ACTORS = ["agent", "user"] as const
export type TopicActor = (typeof TOPIC_ACTORS)[number]

/** source_item.topic_status */
export const TOPIC_ITEM_STATUSES = ["done", "log_only", "ignored", "deferred", "failed"] as const
export type TopicItemStatus = (typeof TOPIC_ITEM_STATUSES)[number]

/** Client relation used for `class_by_relation` codes (06 §4.6). */
export type ClientRelation = "active" | "dormant" | "prospect" | "supplier" | "unknown"

/** Timers of spec §7.1 (settings `topicReopenDays` / `topicDormantDays` / `topicExpireDays`). */
export const TOPIC_TIMERS = {
  reopenDays: 14,
  dormantDays: 21,
  expireDays: 60,
} as const
export type TopicTimers = { reopenDays: number; dormantDays: number; expireDays: number }

/** Normalised reference of a subject / topic (`key` = kind:normalised value). */
export type TopicReference = { kind: string; value: string; key: string }

export function isTopicStatus(v: unknown): v is TopicStatus {
  return typeof v === "string" && (TOPIC_STATUSES as readonly string[]).includes(v)
}

// Client-safe contract of topic cards (topics plan phase 4, spec topics/01
// §9.1). Value lists for the text columns `card.kind` / `card.status` /
// `card.reject_reason_code`, Russian labels, text limits and the shapes the
// card engine (src/server/topics/cards/) stores in `card.message.topicCard`
// and `card.events`. No DB, no server imports.

/** card.kind (null = old Custom-rule card). */
export const CARD_KINDS = ["topic", "deal_proposal", "stage_confirmation"] as const
export type CardKind = (typeof CARD_KINDS)[number]

export const CARD_KIND_LABELS_RU: Record<CardKind, string> = {
  topic: "Карточка темы",
  deal_proposal: "Новая возможность?",
  stage_confirmation: "Подтвердить стадию",
}

/** card.status (null = old Custom-rule card). */
export const CARD_STATUSES = ["open", "accepted", "rejected", "superseded", "expired", "closed"] as const
export type CardStatus = (typeof CARD_STATUSES)[number]

export const CARD_STATUS_LABELS_RU: Record<CardStatus, string> = {
  open: "Открыта",
  accepted: "Принята",
  rejected: "Отклонена",
  superseded: "Заменена новой",
  expired: "Истекла",
  closed: "Закрыта",
}

/** Statuses after a person's decision (UPDATE never touches them, §9.1). */
export const CARD_DECIDED_STATUSES: readonly CardStatus[] = ["accepted", "rejected"]

/**
 * Reject reason codes (spec §9.1: «reject asks for a reason code (list) +
 * optional text»). Stored in `card.reject_reason_code` for evaluation.
 */
export const CARD_REJECT_REASONS = [
  "not_relevant",
  "already_done",
  "wrong_counterparty",
  "wrong_facts",
  "wrong_priority",
  "duplicate",
  "not_now",
  "other",
] as const
export type CardRejectReason = (typeof CARD_REJECT_REASONS)[number]

export const CARD_REJECT_REASON_LABELS_RU: Record<CardRejectReason, string> = {
  not_relevant: "Не относится к работе",
  already_done: "Уже сделано",
  wrong_counterparty: "Не тот клиент или контакт",
  wrong_facts: "Ошибка в фактах карточки",
  wrong_priority: "Неверная важность",
  duplicate: "Дубликат другой карточки",
  not_now: "Не сейчас",
  other: "Другое",
}

export function isCardKind(v: unknown): v is CardKind {
  return typeof v === "string" && (CARD_KINDS as readonly string[]).includes(v)
}
export function isCardStatus(v: unknown): v is CardStatus {
  return typeof v === "string" && (CARD_STATUSES as readonly string[]).includes(v)
}
export function isCardRejectReason(v: unknown): v is CardRejectReason {
  return typeof v === "string" && (CARD_REJECT_REASONS as readonly string[]).includes(v)
}

/** Text limits of spec §9.1 (words). */
export const CARD_TEXT_LIMITS = {
  headlineWords: 12,
  whyNowWords: 20,
  whatChangedWords: 16,
  stepWords: 15,
  maxSteps: 3,
  taskTitleWords: 6,
} as const

/** The card text the writer produces (Russian). */
export type TopicCardText = {
  /** «<Компания> — <наше действие>, <цель>», ≤ 12 words. */
  headline: string
  /** «Почему сейчас», ≤ 20 words. */
  whyNow: string
  /** «Что изменилось», ≤ 16 words; "" when nothing changed in the work. */
  whatChanged: string
  /** ≤ 3 steps, each ≤ 15 words (numbered on display). */
  steps: string[]
  /** Short task name for «Принять» → task (≤ 6 words). */
  taskTitle: string
}

/** Event groups of the compact view, in display order (spec §9.1 Q24-12). */
export const CARD_EVENT_GROUPS = ["urgent", "decision", "terms", "context"] as const
export type CardEventGroup = (typeof CARD_EVENT_GROUPS)[number]

export const CARD_EVENT_GROUP_LABELS_RU: Record<CardEventGroup, string> = {
  urgent: "Риск / срочно",
  decision: "Решение клиента",
  terms: "Условия",
  context: "Контекст",
}

/** One event of the compact view (`card.events`, ≤ 3, written by code). */
export type TopicCardEvent = {
  group: CardEventGroup
  code: string
  labelRu: string
  /** ISO date of the item. */
  at: string
  sourceItemId: string | null
  /** Short quote (≤ 120 chars). */
  evidence: string
}

/** Writer decision (spec §9.1 continuity). */
export const CARD_WRITER_DECISIONS = ["NEW", "UPDATE", "NOOP"] as const
export type CardWriterDecision = (typeof CARD_WRITER_DECISIONS)[number]

/**
 * Engine metadata of a topic card, stored in `card.message.topicCard` next
 * to the old `analysis` / `recommendation` fields the existing UI reads.
 */
export type TopicCardMeta = TopicCardText & {
  /** Display cycle the text was written for (06 §7.1); the phase compares it. */
  cycle: string
  /** Last writer decision and when it ran. */
  decision: CardWriterDecision | "FIRST"
  writtenAt: string
  /** R17 / admin: force one UPDATE on the next run. */
  force: { reason: string; at: string } | null
}

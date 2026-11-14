// Client-safe contract of the topics signal extraction (spec topics/01 §5,
// plan phase 2). Shared by the engine (`src/server/topics/signals/`), the
// admin API and the admin UI. No DB, no server imports.

/** source_item.signal_status */
export const SIGNAL_ITEM_STATUSES = ["done", "skipped", "deferred", "failed"] as const
export type SignalItemStatus = (typeof SIGNAL_ITEM_STATUSES)[number]

/** Bands of spec §5.5. */
export const SIGNAL_BANDS = ["none", "low", "normal", "high", "very_high", "critical"] as const
export type SignalBand = (typeof SIGNAL_BANDS)[number]

export const SIGNAL_BAND_LABELS_RU: Record<SignalBand, string> = {
  none: "нет",
  low: "низкая",
  normal: "обычная",
  high: "высокая",
  very_high: "очень высокая",
  critical: "критическая",
}

/** Item / instance score → band (spec §5.5). */
export function scoreToBand(score: number): SignalBand {
  if (score <= 0) return "none"
  if (score <= 3) return "low"
  if (score <= 5) return "normal"
  if (score <= 7) return "high"
  if (score <= 9) return "very_high"
  return "critical"
}

/** signal_instance.origin */
export const SIGNAL_ORIGINS = ["communication", "system_of_record", "external"] as const
export type SignalOrigin = (typeof SIGNAL_ORIGINS)[number]

export type SignalDirection = "inbound" | "outbound" | "internal"

/** Gates of spec §5.2 that skip an item (signal_reason of a skipped item). */
export const SIGNAL_SKIP_REASONS = {
  not_root: "Не корневое сообщение",
  not_parsed: "Сообщение не разобрано",
  topics_off: "Темы выключены для организации",
  no_text: "Нет текста",
  excluded: "Исключено из анализа",
  blocklist: "Отправитель в чёрном списке",
  automated: "Автоматическая рассылка",
  bounce: "Недоставленное письмо",
  out_of_office: "Автоответ «нет на месте»",
  calendar_reply: "Ответ на приглашение",
} as const
export type SignalSkipReason = keyof typeof SIGNAL_SKIP_REASONS

/** Why a model-returned code was dropped (never stored as an instance). */
export const SIGNAL_DROP_REASONS = {
  unknown_code: "Кода нет в списке промпта",
  not_active: "Код не активен для организации",
  process_code: "Код ставит только процесс",
  empty_evidence: "Нет цитаты",
  evidence_not_found: "Цитата не найдена в тексте",
  evidence_in_quote: "Цитата из цитируемой переписки",
  inbound_only: "Только для входящих, а сообщение наше",
  internal_only_block: "Внутренний блок на внешнем сообщении",
  date_gate: "Не прошёл проверку даты",
  over_cap: "Больше технического лимита",
} as const
export type SignalDropReason = keyof typeof SIGNAL_DROP_REASONS

/** Why a stored instance does not count for the score. */
export const SIGNAL_NOT_COUNTED_REASONS = {
  low_confidence: "Низкая уверенность",
  state: "Код состояния (закрывает, не оценивается)",
  outranked: "Перекрыт более сильным кодом",
  merged: "Слит с другим кодом",
} as const
export type SignalNotCountedReason = keyof typeof SIGNAL_NOT_COUNTED_REASONS

export type SignalSubjectReference = {
  kind: "invoice" | "order" | "offer" | "contract" | "claim" | "other"
  value: string
}

export type SignalSubject = {
  index: number
  counterparty: string
  onBehalfOf: string
  matter: string
  references: SignalSubjectReference[]
  products: string[]
}

export type SignalAmount = {
  value: number
  currency: "RUB" | "USD" | "EUR" | "CNY" | ""
  scope: "total" | "per_unit" | "per_month" | "per_year"
  vat: "incl" | "excl" | "unknown"
  evidence: string
  subjectIndex: number
}

export type SignalDeadline = {
  date: string
  precision: "exact" | "resolved"
  what: string
  owner: "us" | "them" | "unknown"
  evidence: string
  subjectIndex: number
}

/** Facts of one item after server validation (sentinels → null). */
export type SignalFacts = {
  amounts: SignalAmount[]
  deadlines: SignalDeadline[]
  contractEndDate: string | null
  proposedMeetingDate: string | null
  paymentTermsDays: number | null
  creditLimitRequested: number | null
  /** Deterministic gates (bounce, out-of-office, calendar reply). */
  bouncedMessageIds?: string[]
  oooReturnDate?: string | null
  oooDeputy?: string | null
  meetingReply?: { response: "accepted" | "declined" | "tentative" | null; meetingTitle: string | null } | null
}

/** source_item.signal_facts — everything one run produced besides instances. */
export type SignalItemFacts = {
  facts: SignalFacts
  direction: SignalDirection
  /** Direction the model returned (before the cross-check with attribution). */
  modelDirection: SignalDirection | null
  attributes: { code: string; evidence: string; weight: number }[]
  /** Sum of attribute weights, clamped to [−2, +2] (applied to the dominant instance). */
  attrAdj: number
  dominantCode: string | null
  dropped: { code: string; reason: SignalDropReason; evidence: string }[]
  /** Model / gate that produced the result. */
  producer: { kind: "llm" | "gate"; model: string | null; process: string | null; gate?: string }
  forward?: { forwardedBy: string | null; originalAuthor: string | null } | null
  durationMs?: number
  inputTokens?: number | null
  outputTokens?: number | null
}

/** Admin review row: one scanned item with its instances. */
export type SignalReviewItem = {
  id: string
  provider: string | null
  externalType: string
  sourceCreatedAt: string | null
  subject: string | null
  from: string | null
  status: SignalItemStatus | null
  reason: string | null
  score: number | null
  band: SignalBand | null
  scannedAt: string | null
  taxonomyVersion: number | null
  facts: SignalItemFacts | null
  instances: {
    id: string
    code: string
    labelRu: string | null
    evidence: string
    confidence: string
    subjectIndex: number
    counted: boolean
    notCountedReason: string | null
    scoreContrib: number
  }[]
  subjects: SignalSubject[]
}

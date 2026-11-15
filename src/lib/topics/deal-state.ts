// Client-safe contract of topics plan phase 5a: deal state («Текущее
// состояние», spec topics/01 §9.3) and deal risks («Есть риски», §9.4).
// Shared by the engine (src/server/topics/deal-state/), the read / action
// helpers (src/server/deal-state.ts, src/server/deal-risks.ts) and the UI.
// No DB, no server imports.

/** deal_state_version.decision */
export const DEAL_STATE_DECISIONS = ["UPDATE", "NOOP", "FIXED", "REJECTED", "USER"] as const
export type DealStateDecision = (typeof DEAL_STATE_DECISIONS)[number]

export const DEAL_STATE_DECISION_LABELS_RU: Record<DealStateDecision, string> = {
  UPDATE: "Обновлено",
  NOOP: "Без изменений",
  FIXED: "Фиксированный текст",
  REJECTED: "Отклонено проверкой",
  USER: "Изменено вручную",
}

/** Fixed text when the deal has no linked topic / too little data (§9.3). */
export const DEAL_STATE_NO_DATA_TEXT = "Недостаточно информации о текущем состоянии сделки"

/** deal_risk.status */
export const DEAL_RISK_STATUSES = ["active", "cleared"] as const
export type DealRiskStatus = (typeof DEAL_RISK_STATUSES)[number]

/** deal_risk.cleared_by */
export const DEAL_RISK_CLEARED_BY = ["signal", "condition", "outcome", "user", "state_summary"] as const
export type DealRiskClearedBy = (typeof DEAL_RISK_CLEARED_BY)[number]

export const DEAL_RISK_CLEARED_BY_LABELS_RU: Record<DealRiskClearedBy, string> = {
  signal: "Новый сигнал",
  condition: "Ситуация изменилась",
  outcome: "Итог сделки",
  user: "Пользователь",
  state_summary: "Агент по источнику",
}

/** One version of the state text (newest first in `DealStateView.versions`). */
export type DealStateVersionView = {
  id: string
  decision: DealStateDecision
  text: string | null
  reason: string | null
  sourceItemIds: string[]
  topicIds: string[]
  actor: "agent" | "user"
  actorUserId: string | null
  actorName: string | null
  model: string | null
  createdAt: string
}

/** `getDealState(orgId, dealId)` */
export type DealStateView = {
  dealId: string
  /** Stored text; null until the first run. */
  text: string | null
  sourceItemIds: string[]
  updatedAt: string | null
  /** New deal information arrived after `updatedAt` (a run is pending). */
  dirtyAt: string | null
  pending: boolean
  versions: DealStateVersionView[]
  /**
   * Topics linked to the deal (spec topics/10). Empty = the state is NOT
   * updated from sources; the UI says so instead of showing old text.
   */
  linkedTopics: DealLinkedTopicView[]
  /** The org runs topics in mode `on` (topic links can be made by users). */
  topicsOn: boolean
  /** Live topics of the deal's client without a deal (mode `on` only), newest first, ≤ 20. */
  linkableTopics: DealLinkedTopicView[]
}

export type DealLinkedTopicView = {
  id: string
  title: string
  status: string
  lastActivityAt: string | null
}

/** Source item cited by a risk (for «Источники»). */
export type DealRiskSourceView = {
  sourceItemId: string
  date: string | null
  provider: string | null
  subject: string | null
}

/** One row of `listDealRisks(orgId, dealId)`. */
export type DealRiskView = {
  id: string
  dealId: string
  riskType: string
  /** deal_risk_type.label_ru («Решение откладывается»). */
  labelRu: string
  /** deal_risk_type.description_ru (fixed text). */
  descriptionRu: string
  /** What to show: the `deals.state_summary` explanation, else the type's fixed text (R17). */
  explanationRu: string
  /** true when `explanationRu` came from the state run (with cited sources). */
  explanationFromAgent: boolean
  explanationSourceItemIds: string[]
  status: DealRiskStatus
  severity: number
  occurrences: number
  /** Highest trigger score (signal_instance.score_contrib) — tie-break of the «most critical» risk. */
  triggerScore: number
  topicId: string | null
  topicTitle: string | null
  triggerInstanceIds: string[]
  /** Trigger codes with their evidence quotes. */
  triggers: { instanceId: string; code: string; evidence: string; sourceItemId: string | null }[]
  sourceItemIds: string[]
  sources: DealRiskSourceView[]
  detectedAt: string
  clearedAt: string | null
  clearedBy: DealRiskClearedBy | null
  clearedReason: string | null
  clearedByUserId: string | null
  clearedByUserName: string | null
  clearInstanceId: string | null
}

/** Per deal: `listActiveRiskSummaries(orgId, dealIds)` (kanban badge + tooltip). */
export type DealRiskSummary = {
  dealId: string
  activeCount: number
  /** The most critical active risk: highest severity × trigger score, then the newest. */
  top: {
    riskId: string
    riskType: string
    labelRu: string
    explanationRu: string
    severity: number
    detectedAt: string
  } | null
}

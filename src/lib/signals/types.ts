// Signals registry — shared, client-safe contract between the server module
// (src/server/signals/) and the admin UI («Сигналы» tab).
// Spec: docs/specs/topics/05-signals-registry.md (fields §3, effective
// parameters §5, validation §7), 01-specification.md §4.
//
// Value lists live HERE (not as pg enums): the DB columns are text and the
// server validates against these lists.

// ── value lists ───────────────────────────────────────────────────────────

export const SIGNAL_CLASSES = ["risk", "chance", "fyi"] as const
export const SIGNAL_KINDS = ["event", "watchdog", "derived", "trend", "state"] as const
export const SIGNAL_SCORE_RULES = ["fixed", "state", "inherited"] as const
export const SIGNAL_EFFORTS = ["quick", "medium", "complex"] as const
export const SIGNAL_STAGES = ["active", "onHold", "parked", "gated"] as const
export const SIGNAL_EMITTED_BY = ["parser", "process", "both"] as const
export const DISPLAY_PROFILES = ["W1", "D4", "P6", "P8", "S0", "S1"] as const
export const RECIPIENT_ROLES = [
  "relationship",
  "opportunity",
  "account",
  "finance",
  "accounting",
  "logistics",
  "team",
  "new_biz",
  "events",
] as const
export const SIGNAL_FAMILIES = [
  "offer",
  "order",
  "invoice",
  "contract",
  "complaint",
  "meeting",
  "contact",
  "pitch",
  "delivery",
  "account",
  "market",
  "supplier",
  "team",
  "internal",
  "competitor",
] as const
export const RELATION_KINDS = ["outranks", "leads_over", "both", "merges_into", "dampens"] as const
export const ATTRIBUTE_SCOPES = ["message", "account", "contact"] as const
export const STAGE_RULE_EFFECTS = [
  "create_deal",
  "move_stage",
  "in_stage",
  "outcome_won",
  "outcome_lost",
  "pause",
  "resume",
] as const
export const STAGE_MEANINGS = ["S1", "S2", "S3", "S4", "S5", "won", "lost"] as const
export const CONFIDENCES = ["low", "medium", "high"] as const

export type SignalClass = (typeof SIGNAL_CLASSES)[number]
export type SignalKind = (typeof SIGNAL_KINDS)[number]
export type SignalScoreRule = (typeof SIGNAL_SCORE_RULES)[number]
export type SignalEffort = (typeof SIGNAL_EFFORTS)[number]
export type SignalStage = (typeof SIGNAL_STAGES)[number]
export type SignalEmittedBy = (typeof SIGNAL_EMITTED_BY)[number]
export type DisplayProfile = (typeof DISPLAY_PROFILES)[number]
export type RecipientRole = (typeof RECIPIENT_ROLES)[number]
export type SignalFamily = (typeof SIGNAL_FAMILIES)[number]

/** Russian labels of signal / topic families (the «Сигналы» tab, the AI chat). */
export const FAMILY_LABELS_RU: Record<SignalFamily, string> = {
  offer: "Предложение (КП)",
  order: "Заказ",
  invoice: "Счёт",
  contract: "Договор",
  complaint: "Жалоба",
  meeting: "Встреча",
  contact: "Контакт",
  pitch: "Питч / тендер",
  delivery: "Поставка",
  account: "Аккаунт",
  market: "Рынок",
  supplier: "Поставщик",
  team: "Команда",
  internal: "Внутреннее",
  competitor: "Конкурент",
}
export type RelationKind = (typeof RELATION_KINDS)[number]
export type StageRuleEffect = (typeof STAGE_RULE_EFFECTS)[number]

// Russian UI labels.
export const STAGE_LABELS_RU: Record<SignalStage, string> = {
  active: "Активен",
  onHold: "Ожидает",
  parked: "Отложен",
  gated: "По условию",
}
export const CLASS_LABELS_RU: Record<SignalClass, string> = {
  risk: "Риск",
  chance: "Возможность",
  fyi: "К сведению",
}
export const KIND_LABELS_RU: Record<SignalKind, string> = {
  event: "Событие",
  watchdog: "Наблюдатель",
  derived: "Производный",
  trend: "Тренд",
  state: "Состояние",
}
export const PROFILE_LABELS_RU: Record<DisplayProfile, string> = {
  W1: "W1 · Неделя",
  D4: "D4 · Сводка",
  P6: "P6 · Сейчас",
  P8: "P8 · Сейчас (срочно)",
  S0: "S0 · Без карточки",
  S1: "S1 · Закрывающий",
}

// ── records (one per table row; camelCase as in src/db/schema.ts) ─────────

export type SignalPackRecord = {
  code: string
  labelRu: string
  descriptionRu: string | null
  sort: number
}

export type SignalBlockRecord = {
  code: string
  packCode: string
  labelRu: string
  audience: string | null
  internalOnly: boolean
  firstPartyOnly: boolean
  sort: number
}

export type AntiCue = { text: string; code: string | null }

export type SignalCategoryRecord = {
  code: string
  packCode: string
  blockCode: string
  family: string
  labelRu: string
  definitionRu: string
  boundaryRu: string
  cuesPromptRu: string[]
  synonymsRu: Record<string, string[]>
  antiCuesRu: AntiCue[]
  exampleRu: string
  counterExampleRu: string
  cardNoteRu: string
  weight: number
  scoreRule: SignalScoreRule
  class: SignalClass | null
  classByRelation: boolean
  kind: SignalKind
  effort: SignalEffort | null
  carriesAmount: boolean
  asksUs: boolean
  inboundOnly: boolean
  emittedBy: SignalEmittedBy
  stage: SignalStage
  displayProfile: DisplayProfile | null
  recipientRole: RecipientRole | null
  closesCodes: string[]
  dateGate: Record<string, unknown> | null
  relevanceDays: number | null
  triggerRule: Record<string, unknown> | null
  noteRu: string | null
  retiredAt: string | null
  successorCode: string | null
  updatedAt: string
}

export type SignalAttributeRecord = {
  code: string
  packCode: string
  groupCode: string | null
  scope: (typeof ATTRIBUTE_SCOPES)[number]
  labelRu: string
  definitionRu: string
  weight: number
  stage: SignalStage
  defaultOff: boolean
  profiles: string[]
  cuesRu: string[]
  antiCuesRu: string[]
  noteRu: string | null
  sort: number
}

export type SignalRelationRecord = {
  id: string
  packCode: string
  kind: RelationKind
  codeA: string
  codeB: string
  settingKey: string | null
  fact: string | null
  noteRu: string | null
}

export type SignalPackOverrideRecord = {
  packCode: string
  code: string
  weight: number | null
  displayProfile: DisplayProfile | null
  recipientRole: RecipientRole | null
  stage: SignalStage | null
  closesCodes: string[] | null
  noteRu: string | null
}

export type OrganizationSignalPackRecord = {
  organizationId: string
  packCode: string
  enabled: boolean
}

export type OrganizationSignalOverrideRecord = {
  organizationId: string
  code: string
  stage: SignalStage | null
  weight: number | null
  displayProfile: DisplayProfile | null
  recipientRole: RecipientRole | null
  reviewOnly: boolean
  noteRu: string | null
}

export type StageRuleGuards = {
  minConfidence?: (typeof CONFIDENCES)[number]
  minScore?: number
  fromStageIds?: string[]
  fromStageMeanings?: string[]
  forwardOnly?: boolean
  requiresConfirmation?: boolean
  requiresFact?: string
  clientGuard?: string
}

export type SignalStageRuleRecord = {
  id: string
  organizationId: string | null // null = pack template
  packCode: string | null
  code: string
  effect: StageRuleEffect
  targetStageId: string | null
  targetStageMeaning: string | null
  dealTypes: string[]
  guards: StageRuleGuards
  enabled: boolean
  sort: number
  noteRu: string | null
}

export type DealRiskTypeRecord = {
  code: string
  packCode: string
  labelRu: string
  descriptionRu: string
  explanationRu: string
  triggerCodes: string[]
  clearCodes: string[]
  severity: number
  minOccurrences: number
  condition: string | null
  scope: "deal" | "client"
  reactionRole: string | null
  stageGuardTemplate: string | null
  noteRu: string | null
  enabled: boolean
}

export type DealRiskStageGuardRecord = {
  organizationId: string
  riskCode: string
  enabled: boolean
  stageIds: string[] | null
}

// ── effective parameters (05 §5) ─────────────────────────────────────────

export type EffectiveSignal = {
  code: string
  packCode: string
  blockCode: string
  /** Pack on for the org AND stage = active after overrides AND not retired. */
  active: boolean
  /** "review" for this org (R6): runs only in the offline eval batch. */
  reviewOnly: boolean
  stage: SignalStage
  weight: number
  displayProfile: DisplayProfile | null
  recipientRole: RecipientRole | null
  closesCodes: string[]
  /** Parser-emittable and active → goes into the live extraction prompt. */
  inPrompt: boolean
  /** Which level each overridable value came from. */
  source: Partial<Record<"stage" | "weight" | "displayProfile" | "recipientRole" | "closesCodes", "org" | "pack" | "base">>
}

// ── API (all under /api/admin/signals, platform admin only) ──────────────

/** GET /api/admin/signals?view=registry */
export type SignalsRegistryResponse = {
  version: number
  packs: SignalPackRecord[]
  blocks: SignalBlockRecord[]
  categories: SignalCategoryRecord[]
  attributes: SignalAttributeRecord[]
  relations: SignalRelationRecord[]
  packOverrides: SignalPackOverrideRecord[]
  riskTypes: DealRiskTypeRecord[]
  stageRuleTemplates: SignalStageRuleRecord[]
}

/** GET /api/admin/signals?view=org&orgId= */
export type SignalsOrgResponse = {
  organizationId: string
  organizationName: string
  packs: OrganizationSignalPackRecord[]
  overrides: OrganizationSignalOverrideRecord[]
  stageRules: SignalStageRuleRecord[]
  riskGuards: DealRiskStageGuardRecord[]
  effective: EffectiveSignal[]
  /** The org's funnel stages (org-or-system), for rule targets and guards. */
  funnelStages: { id: string; name: string; displayName: string | null; sortOrder: number; isHidden: boolean }[]
  /** Activation presets that can be applied to this org. */
  presets: { key: string; labelRu: string; descriptionRu: string }[]
}

/** GET /api/admin/signals?view=orgs → orgs for the org selector */
export type SignalsOrgsResponse = {
  orgs: { id: string; name: string; packsEnabled: string[]; activeCodes: number }[]
}

/** GET /api/admin/signals?view=history&limit=&offset= (newest first; `total` = all versions). */
export type SignalsHistoryResponse = {
  total: number
  versions: {
    version: number
    createdAt: string
    createdBy: string | null
    summary: string
    changes: {
      entity: SignalRegistryEntity
      entityKey: string
      organizationId: string | null
      action: "create" | "update" | "delete"
      before: Record<string, unknown> | null
      after: Record<string, unknown> | null
    }[]
  }[]
}

export type SignalRegistryEntity =
  | "pack"
  | "block"
  | "category"
  | "attribute"
  | "relation"
  | "pack_override"
  | "org_pack"
  | "org_override"
  | "stage_rule"
  | "risk_type"
  | "risk_guard"

/**
 * PUT /api/admin/signals — one validated save = one new taxonomy version.
 * `key`: the entity's primary key (code; "pack:code"; id; …) for update /
 * delete. `organizationId` is required for org_* / stage_rule (org rows) /
 * risk_guard. `data` = the full record for create, a partial one for update.
 */
export type SignalsSaveRequest = {
  entity: SignalRegistryEntity
  action: "create" | "update" | "delete"
  key?: string
  organizationId?: string | null
  data?: Record<string, unknown>
  /** Short reason, stored on the version («Изменён вес …»). */
  summary?: string
}

export type SignalsValidationError = { field: string; message: string }

/** 200 → { version }; 400 → { errors } (05 §7); nothing is saved on 400. */
export type SignalsSaveResponse = { version: number } | { errors: SignalsValidationError[] }

/** POST /api/admin/signals/presets { organizationId, preset } → { version, changed } */
export type SignalsApplyPresetRequest = { organizationId: string; preset: string }

/**
 * POST /api/admin/signals/stage-rules/copy
 * { organizationId, packCode, stageMap: { S1: stageId, …, won: stageId, lost: stageId } }
 * → { version, created } — copies the pack's template rules to the org.
 */
export type SignalsCopyStageRulesRequest = {
  organizationId: string
  packCode: string
  stageMap: Partial<Record<(typeof STAGE_MEANINGS)[number], string>>
}

/** GET /api/admin/signals/export?orgId= → text/markdown (attachment) */

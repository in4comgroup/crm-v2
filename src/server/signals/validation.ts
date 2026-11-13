import "server-only"

import { z } from "zod"
import {
  ATTRIBUTE_SCOPES,
  CONFIDENCES,
  DISPLAY_PROFILES,
  RECIPIENT_ROLES,
  RELATION_KINDS,
  SIGNAL_CLASSES,
  SIGNAL_EFFORTS,
  SIGNAL_EMITTED_BY,
  SIGNAL_FAMILIES,
  SIGNAL_KINDS,
  SIGNAL_SCORE_RULES,
  SIGNAL_STAGES,
  STAGE_MEANINGS,
  STAGE_RULE_EFFECTS,
  type DealRiskStageGuardRecord,
  type DealRiskTypeRecord,
  type OrganizationSignalOverrideRecord,
  type OrganizationSignalPackRecord,
  type SignalAttributeRecord,
  type SignalBlockRecord,
  type SignalCategoryRecord,
  type SignalPackOverrideRecord,
  type SignalPackRecord,
  type SignalRegistryEntity,
  type SignalRelationRecord,
  type SignalStageRuleRecord,
  type SignalsRegistryResponse,
  type SignalsValidationError,
} from "@/lib/signals/types"

// Validation of registry saves (docs/specs/topics/05-signals-registry.md §7).
//
// Two layers:
//   1. a zod schema per entity, built from the value lists of the contract
//      (src/lib/signals/types.ts) — field types, ranges, enums;
//   2. cross-record rules of 05 §7 (1–8 + 4a), checked against the
//      would-be registry state (the current rows with the change applied).
//
// Every message is Russian (the «Сигналы» UI shows them as is). `field` is
// the camelCase record field (with an index for list items, e.g.
// "cuesPromptRu.3"), so the editor can put the message next to the input.
//
// Cross-record rules are checked for the CHANGED record (and for records a
// retire / delete would break), not for the whole registry: one old bad row
// must not block every unrelated save. `validateWholeRegistry` runs every
// rule over every row for diagnostics.

export type ValidationResult = {
  errors: SignalsValidationError[]
  /** Accepted, but shown to the admin (e.g. a cross-family close, 05 §7 rule 4). */
  warnings: SignalsValidationError[]
}

// ── zod schemas ───────────────────────────────────────────────────────────

const ru = z.locales.ru()

const CATEGORY_CODE = /^[A-Z][A-Z0-9_]*$/
const PACK_CODE = /^[a-z][a-z0-9_]*$/
const BLOCK_CODE = /^[A-Z][A-Z0-9_]*$/

const text = (max?: number) => (max ? z.string().trim().max(max, `Не длиннее ${max} символов`) : z.string().trim())
const requiredText = (max?: number) => text(max).min(1, "Обязательное поле")
const nullableText = () => z.string().trim().nullable().default(null).transform((v) => (v === "" ? null : v))
const stringList = () => z.array(z.string().trim().min(1, "Пустой элемент списка")).default([])
const codeRef = () => z.string().trim().min(1, "Обязательное поле")

export const packSchema = z.object({
  code: z
    .string()
    .trim()
    .max(32, "Код пакета — не длиннее 32 символов")
    .regex(PACK_CODE, "Код пакета: латиница в нижнем регистре, цифры и «_»"),
  labelRu: requiredText(120),
  descriptionRu: nullableText(),
  sort: z.number().int().default(0),
})

export const blockSchema = z.object({
  code: z
    .string()
    .trim()
    .max(16, "Код блока — не длиннее 16 символов")
    .regex(BLOCK_CODE, "Код блока: латиница в верхнем регистре, цифры и «_»"),
  packCode: codeRef(),
  labelRu: requiredText(120),
  audience: z.enum(["client_activity", "colleagues_activity", "business_info"]).nullable().default(null),
  internalOnly: z.boolean().default(false),
  firstPartyOnly: z.boolean().default(false),
  sort: z.number().int().default(0),
})

const antiCueSchema = z.object({
  text: requiredText(),
  code: z
    .string()
    .trim()
    .nullable()
    .default(null)
    .transform((v) => (v === "" ? null : v)),
})

const dateGateSchema = z.looseObject({
  fact: requiredText(),
  test: z.enum(["within", "beyond"]),
  settingKey: z.string().trim().nullable().optional(),
  days: z.number().int().positive().nullable().optional(),
})

const isoDate = z
  .string()
  .nullable()
  .default(null)
  .refine((v) => v === null || !Number.isNaN(Date.parse(v)), "Неверная дата")

export const categorySchema = z.object({
  code: z
    .string()
    .trim()
    .max(48, "Код — не длиннее 48 символов")
    .regex(CATEGORY_CODE, "Код: UPPER_SNAKE (латиница в верхнем регистре, цифры и «_»)"),
  packCode: codeRef(),
  blockCode: codeRef(),
  // Rule 7: family is required (and must be one of the list).
  family: z.enum(SIGNAL_FAMILIES, "Семейство обязательно (одно из списка)"),
  labelRu: requiredText(60),
  definitionRu: text().default(""),
  boundaryRu: text().default(""),
  cuesPromptRu: z.array(z.string().trim()).default([]),
  synonymsRu: z.record(z.string(), z.array(z.string().trim())).default({}),
  antiCuesRu: z.array(antiCueSchema).default([]),
  exampleRu: text().default(""),
  counterExampleRu: text().default(""),
  cardNoteRu: text().default(""),
  weight: z.number().int("Вес — целое число").min(0, "Вес 0–9").max(9, "Вес 0–9"),
  scoreRule: z.enum(SIGNAL_SCORE_RULES),
  class: z.enum(SIGNAL_CLASSES).nullable().default(null),
  classByRelation: z.boolean().default(false),
  kind: z.enum(SIGNAL_KINDS),
  effort: z.enum(SIGNAL_EFFORTS).nullable().default(null),
  carriesAmount: z.boolean().default(false),
  asksUs: z.boolean().default(false),
  inboundOnly: z.boolean().default(false),
  emittedBy: z.enum(SIGNAL_EMITTED_BY).default("parser"),
  stage: z.enum(SIGNAL_STAGES).default("active"),
  displayProfile: z.enum(DISPLAY_PROFILES).nullable().default(null),
  recipientRole: z.enum(RECIPIENT_ROLES).nullable().default(null),
  closesCodes: z.array(z.string().trim().min(1)).default([]),
  dateGate: dateGateSchema.nullable().default(null),
  relevanceDays: z.number().int().positive("Окно актуальности — положительное число дней").nullable().default(null),
  triggerRule: z.record(z.string(), z.unknown()).nullable().default(null),
  noteRu: nullableText(),
  retiredAt: isoDate,
  successorCode: nullableText(),
})

export const attributeSchema = z.object({
  code: z.string().trim().max(48, "Код — не длиннее 48 символов").regex(CATEGORY_CODE, "Код: UPPER_SNAKE"),
  packCode: codeRef(),
  groupCode: nullableText(),
  scope: z.enum(ATTRIBUTE_SCOPES).default("message"),
  labelRu: requiredText(60),
  definitionRu: text().default(""),
  weight: z.number().int("Вес — целое число").min(-1, "Вес атрибута −1…+2").max(2, "Вес атрибута −1…+2"),
  stage: z.enum(SIGNAL_STAGES).default("active"),
  defaultOff: z.boolean().default(false),
  profiles: stringList(),
  cuesRu: stringList(),
  antiCuesRu: stringList(),
  noteRu: nullableText(),
  sort: z.number().int().default(0),
})

export const relationSchema = z.object({
  id: requiredText(200),
  packCode: codeRef(),
  kind: z.enum(RELATION_KINDS),
  codeA: codeRef(),
  codeB: codeRef(),
  settingKey: nullableText(),
  fact: nullableText(),
  noteRu: nullableText(),
})

export const packOverrideSchema = z.object({
  packCode: codeRef(),
  code: codeRef(),
  weight: z.number().int().min(0, "Вес 0–9").max(9, "Вес 0–9").nullable().default(null),
  displayProfile: z.enum(DISPLAY_PROFILES).nullable().default(null),
  recipientRole: z.enum(RECIPIENT_ROLES).nullable().default(null),
  stage: z.enum(SIGNAL_STAGES).nullable().default(null),
  closesCodes: z.array(z.string().trim().min(1)).nullable().default(null),
  noteRu: nullableText(),
})

export const orgPackSchema = z.object({
  organizationId: codeRef(),
  packCode: codeRef(),
  enabled: z.boolean().default(true),
})

export const orgOverrideSchema = z.object({
  organizationId: codeRef(),
  code: codeRef(),
  stage: z.enum(SIGNAL_STAGES).nullable().default(null),
  weight: z.number().int().min(0, "Вес 0–9").max(9, "Вес 0–9").nullable().default(null),
  displayProfile: z.enum(DISPLAY_PROFILES).nullable().default(null),
  recipientRole: z.enum(RECIPIENT_ROLES).nullable().default(null),
  reviewOnly: z.boolean().default(false),
  noteRu: nullableText(),
})

const guardsSchema = z.looseObject({
  minConfidence: z.enum(CONFIDENCES).optional(),
  minScore: z.number().optional(),
  fromStageIds: z.array(z.string().min(1)).optional(),
  fromStageMeanings: z.array(z.enum(STAGE_MEANINGS)).optional(),
  forwardOnly: z.boolean().optional(),
  requiresConfirmation: z.boolean().optional(),
  requiresFact: z.string().optional(),
  clientGuard: z.string().optional(),
})

export const stageRuleSchema = z.object({
  id: requiredText(200),
  organizationId: z.string().nullable().default(null),
  packCode: nullableText(),
  code: codeRef(),
  effect: z.enum(STAGE_RULE_EFFECTS),
  targetStageId: nullableText(),
  targetStageMeaning: z.enum(STAGE_MEANINGS).nullable().default(null),
  dealTypes: stringList(),
  guards: guardsSchema.default({}),
  enabled: z.boolean().default(true),
  sort: z.number().int().default(0),
  noteRu: nullableText(),
})

export const riskTypeSchema = z.object({
  code: z.string().trim().max(64, "Код — не длиннее 64 символов").regex(CATEGORY_CODE, "Код: UPPER_SNAKE"),
  packCode: codeRef(),
  labelRu: requiredText(120),
  descriptionRu: text().default(""),
  explanationRu: text().default(""),
  triggerCodes: stringList(),
  clearCodes: stringList(),
  severity: z.number().int("Серьёзность — целое число").min(0, "Серьёзность ≥ 0"),
  minOccurrences: z.number().int().min(1, "Минимум повторов ≥ 1").default(1),
  condition: nullableText(),
  scope: z.enum(["deal", "client"]).default("deal"),
  reactionRole: nullableText(),
  stageGuardTemplate: nullableText(),
  noteRu: nullableText(),
  enabled: z.boolean().default(true),
})

export const riskGuardSchema = z.object({
  organizationId: codeRef(),
  riskCode: codeRef(),
  enabled: z.boolean().default(true),
  stageIds: z.array(z.string().min(1)).nullable().default(null),
})

export const ENTITY_SCHEMAS = {
  pack: packSchema,
  block: blockSchema,
  category: categorySchema,
  attribute: attributeSchema,
  relation: relationSchema,
  pack_override: packOverrideSchema,
  org_pack: orgPackSchema,
  org_override: orgOverrideSchema,
  stage_rule: stageRuleSchema,
  risk_type: riskTypeSchema,
  risk_guard: riskGuardSchema,
} as const satisfies Record<SignalRegistryEntity, z.ZodType>

export type EntityRecordMap = {
  pack: SignalPackRecord
  block: SignalBlockRecord
  category: Omit<SignalCategoryRecord, "updatedAt">
  attribute: SignalAttributeRecord
  relation: SignalRelationRecord
  pack_override: SignalPackOverrideRecord
  org_pack: OrganizationSignalPackRecord
  org_override: OrganizationSignalOverrideRecord
  stage_rule: SignalStageRuleRecord
  risk_type: DealRiskTypeRecord
  risk_guard: DealRiskStageGuardRecord
}

/** Parse one record with its entity schema. Errors are Russian, `field` = path. */
export function parseEntityRecord<E extends SignalRegistryEntity>(
  entity: E,
  data: unknown,
): { ok: true; record: EntityRecordMap[E] } | { ok: false; errors: SignalsValidationError[] } {
  const schema = ENTITY_SCHEMAS[entity] as z.ZodType
  const res = schema.safeParse(data, { error: ru.localeError })
  if (res.success) return { ok: true, record: res.data as EntityRecordMap[E] }
  return {
    ok: false,
    errors: res.error.issues.map((i) => ({
      field: i.path.map(String).join(".") || "data",
      message: i.message,
    })),
  }
}

// ── cross-record rules (05 §7) ────────────────────────────────────────────

/** Registry state the rules run against (same shape as the GET response). */
export type RegistryState = Omit<SignalsRegistryResponse, "version">

/** The org's side of the state (for org_* / stage_rule / risk_guard saves). */
export type OrgStateForRules = {
  organizationId: string
  /** Ids of the org's funnel stages (org-or-system). */
  stageIds: Set<string>
}

const PROCESS_KINDS = new Set(["watchdog", "derived", "trend"])
const CLOSES_ALLOWED_KINDS = new Set(["state", "event"])
const PROFILE_RANK: Record<string, number> = { W1: 1, D4: 2, P6: 3, P8: 4 }

function isEmpty(v: string | null | undefined) {
  return !v || v.trim() === ""
}

function isRetired(c: { retiredAt: string | null } | undefined) {
  return !!c?.retiredAt
}

function categoryIndex(state: RegistryState) {
  return new Map(state.categories.map((c) => [c.code, c]))
}

/** Rule 1: an active code needs definition, boundary and prompt cues. */
function requireActiveTexts(
  c: Pick<SignalCategoryRecord, "code" | "definitionRu" | "boundaryRu" | "cuesPromptRu" | "emittedBy">,
  errors: SignalsValidationError[],
  prefix = "",
) {
  const who = prefix ? `${prefix}: код ${c.code}` : "Активный код"
  if (isEmpty(c.definitionRu)) errors.push({ field: "definitionRu", message: `${who} — нужно определение` })
  // Process codes are never in the extraction prompt (05 §3.4, §3.6): they
  // carry no prompt cues and no «Граница»; only the definition is required.
  if (c.emittedBy === "process") return
  if (isEmpty(c.boundaryRu)) errors.push({ field: "boundaryRu", message: `${who} — нужна «Граница» (что не считается)` })
  if (c.cuesPromptRu.filter((x) => !isEmpty(x)).length === 0) {
    errors.push({ field: "cuesPromptRu", message: `${who} — нужны признаки для промпта` })
  }
}

/** Rule 4 (shared by category and pack override). */
function checkClosesCodes(
  owner: Pick<SignalCategoryRecord, "code" | "kind" | "family">,
  closesCodes: string[],
  cats: Map<string, SignalCategoryRecord | Omit<SignalCategoryRecord, "updatedAt">>,
  res: ValidationResult,
) {
  if (closesCodes.length === 0) return
  if (!CLOSES_ALLOWED_KINDS.has(owner.kind)) {
    res.errors.push({
      field: "closesCodes",
      message: `«Закрывает коды» допустимо только для кодов вида «Событие» и «Состояние», не для «${owner.kind}»`,
    })
  }
  const seen = new Set<string>()
  closesCodes.forEach((code, i) => {
    if (seen.has(code)) {
      res.errors.push({ field: `closesCodes.${i}`, message: `Код ${code} указан дважды` })
    }
    seen.add(code)
    if (code === owner.code) {
      res.errors.push({ field: `closesCodes.${i}`, message: "Код не может закрывать сам себя" })
      return
    }
    const target = cats.get(code)
    if (!target) {
      res.errors.push({ field: `closesCodes.${i}`, message: `Код ${code} не существует` })
      return
    }
    if (target.family !== owner.family) {
      res.warnings.push({
        field: `closesCodes.${i}`,
        message: `${owner.code} закрывает ${code} из другого семейства (${owner.family} → ${target.family})`,
      })
    }
  })
}

/** Rule 6: a trend code can't have an explicit profile above D4. */
function checkTrendProfile(kind: string, profile: string | null, res: ValidationResult) {
  if (kind !== "trend" || !profile) return
  if ((PROFILE_RANK[profile] ?? 0) > PROFILE_RANK.D4) {
    res.errors.push({
      field: "displayProfile",
      message: `Тренд не может иметь профиль выше D4 (указан ${profile})`,
    })
  }
}

export function checkCategoryRules(
  c: Omit<SignalCategoryRecord, "updatedAt">,
  state: RegistryState,
): ValidationResult {
  const res: ValidationResult = { errors: [], warnings: [] }
  const cats = categoryIndex(state)

  // References: pack and block exist, block belongs to the pack.
  if (!state.packs.some((p) => p.code === c.packCode)) {
    res.errors.push({ field: "packCode", message: `Пакет ${c.packCode} не существует` })
  }
  const block = state.blocks.find((b) => b.code === c.blockCode)
  if (!block) res.errors.push({ field: "blockCode", message: `Блок ${c.blockCode} не существует` })
  else if (block.packCode !== c.packCode) {
    res.errors.push({
      field: "blockCode",
      message: `Блок ${c.blockCode} относится к пакету ${block.packCode}, а код — к пакету ${c.packCode}`,
    })
  }

  // Rule 1.
  if (c.stage === "active" && !c.retiredAt) requireActiveTexts(c, res.errors)

  // Rule 2.
  if (c.cuesPromptRu.length > 8) {
    res.errors.push({ field: "cuesPromptRu", message: `Признаков для промпта не больше 8 (сейчас ${c.cuesPromptRu.length})` })
  }
  c.cuesPromptRu.forEach((cue, i) => {
    if (cue.length > 60) {
      res.errors.push({ field: `cuesPromptRu.${i}`, message: `Признак длиннее 60 символов: «${cue.slice(0, 40)}…»` })
    }
    if (isEmpty(cue)) res.errors.push({ field: `cuesPromptRu.${i}`, message: "Пустой признак" })
  })

  // Rule 3.
  if (c.scoreRule === "state") {
    if (c.weight !== 0) res.errors.push({ field: "weight", message: "Правило «state»: вес должен быть 0" })
    if (c.class !== null) res.errors.push({ field: "class", message: "Правило «state»: класс должен быть пустым" })
  } else if (c.class === null && !c.classByRelation) {
    // 05 §3.2: "null only for state" — a warning, §7 does not refuse it.
    res.warnings.push({ field: "class", message: "Класс пустой: обычно так только у кодов с правилом «state»" })
  }

  // Rule 4.
  checkClosesCodes(c, c.closesCodes, cats, res)

  // Rule 5.
  if (PROCESS_KINDS.has(c.kind)) {
    if (c.emittedBy !== "process") {
      res.errors.push({
        field: "emittedBy",
        message: `Код вида «${c.kind}» создаётся только процессом (emittedBy = process)`,
      })
    }
    if (!c.triggerRule || Object.keys(c.triggerRule).length === 0) {
      res.errors.push({ field: "triggerRule", message: `Для кода вида «${c.kind}» нужно правило запуска (triggerRule)` })
    }
  }

  // Rule 6.
  checkTrendProfile(c.kind, c.displayProfile, res)

  // Rule 7 is in the schema (family enum); keep a guard for raw callers.
  if (isEmpty(c.family)) res.errors.push({ field: "family", message: "Семейство обязательно" })

  // Anti-cue targets must exist.
  c.antiCuesRu.forEach((a, i) => {
    if (a.code && !cats.has(a.code)) {
      res.warnings.push({ field: `antiCuesRu.${i}.code`, message: `Анти-признак ссылается на несуществующий код ${a.code}` })
    }
  })

  // Retire: successor must exist and be live; rule 8 for relations.
  if (c.successorCode) {
    if (c.successorCode === c.code) {
      res.errors.push({ field: "successorCode", message: "Код-преемник не может совпадать с кодом" })
    } else {
      const succ = cats.get(c.successorCode)
      if (!succ) res.errors.push({ field: "successorCode", message: `Код-преемник ${c.successorCode} не существует` })
      else if (isRetired(succ)) {
        res.errors.push({ field: "successorCode", message: `Код-преемник ${c.successorCode} выведен из обращения` })
      }
    }
  }
  if (c.retiredAt) {
    for (const r of state.relations) {
      if (r.codeA === c.code || r.codeB === c.code) {
        res.errors.push({
          field: "retiredAt",
          message: `Код используется в связи ${r.id} (${r.codeA} ${r.kind} ${r.codeB}); сначала удалите или измените связь`,
        })
      }
    }
  }
  return res
}

export function checkPackOverrideRules(o: SignalPackOverrideRecord, state: RegistryState): ValidationResult {
  const res: ValidationResult = { errors: [], warnings: [] }
  const cats = categoryIndex(state)
  if (!state.packs.some((p) => p.code === o.packCode)) {
    res.errors.push({ field: "packCode", message: `Пакет ${o.packCode} не существует` })
  }
  const base = cats.get(o.code)
  if (!base) {
    res.errors.push({ field: "code", message: `Код ${o.code} не существует` })
    return res
  }
  if (base.scoreRule === "state" && o.weight !== null && o.weight !== 0) {
    res.errors.push({ field: "weight", message: "Код с правилом «state»: вес должен быть 0" })
  }
  if (o.stage === "active" && !base.retiredAt) requireActiveTexts(base, res.errors, "Переопределение включает код")
  if (o.closesCodes !== null) checkClosesCodes(base, o.closesCodes, cats, res)
  checkTrendProfile(base.kind, o.displayProfile, res)
  return res
}

/**
 * Org override. `rawData` is the request payload: rule 4a rejects any
 * attempt to set closesCodes per org (only a pack override may, R12).
 */
export function checkOrgOverrideRules(
  o: OrganizationSignalOverrideRecord,
  rawData: Record<string, unknown> | undefined,
  state: RegistryState,
): ValidationResult {
  const res: ValidationResult = { errors: [], warnings: [] }
  if (rawData && "closesCodes" in rawData) {
    res.errors.push({
      field: "closesCodes",
      message: "«Закрывает коды» нельзя переопределить для организации — только в переопределении пакета",
    })
  }
  const base = state.categories.find((c) => c.code === o.code)
  if (!base) {
    res.errors.push({ field: "code", message: `Код ${o.code} не существует` })
    return res
  }
  if (base.retiredAt && o.stage === "active") {
    res.errors.push({ field: "stage", message: `Код ${o.code} выведен из обращения и не может быть включён` })
  }
  if (base.scoreRule === "state" && o.weight !== null && o.weight !== 0) {
    res.errors.push({ field: "weight", message: "Код с правилом «state»: вес должен быть 0" })
  }
  if (o.stage === "active" && !base.retiredAt) requireActiveTexts(base, res.errors, "Включение для организации")
  checkTrendProfile(base.kind, o.displayProfile, res)
  return res
}

export function checkOrgPackRules(p: OrganizationSignalPackRecord, state: RegistryState): ValidationResult {
  const res: ValidationResult = { errors: [], warnings: [] }
  if (!state.packs.some((x) => x.code === p.packCode)) {
    res.errors.push({ field: "packCode", message: `Пакет ${p.packCode} не существует` })
  }
  return res
}

export function checkBlockRules(b: SignalBlockRecord, state: RegistryState): ValidationResult {
  const res: ValidationResult = { errors: [], warnings: [] }
  if (!state.packs.some((x) => x.code === b.packCode)) {
    res.errors.push({ field: "packCode", message: `Пакет ${b.packCode} не существует` })
  }
  return res
}

export function checkAttributeRules(a: SignalAttributeRecord, state: RegistryState): ValidationResult {
  const res: ValidationResult = { errors: [], warnings: [] }
  if (!state.packs.some((x) => x.code === a.packCode)) {
    res.errors.push({ field: "packCode", message: `Пакет ${a.packCode} не существует` })
  }
  return res
}

/** Rule 8 + existence of both codes. */
export function checkRelationRules(r: SignalRelationRecord, state: RegistryState): ValidationResult {
  const res: ValidationResult = { errors: [], warnings: [] }
  const cats = categoryIndex(state)
  if (!state.packs.some((x) => x.code === r.packCode)) {
    res.errors.push({ field: "packCode", message: `Пакет ${r.packCode} не существует` })
  }
  if (r.codeA === r.codeB) res.errors.push({ field: "codeB", message: "Связь кода с самим собой" })
  for (const field of ["codeA", "codeB"] as const) {
    const c = cats.get(r[field])
    if (!c) res.errors.push({ field, message: `Код ${r[field]} не существует` })
    else if (isRetired(c)) res.errors.push({ field, message: `Код ${r[field]} выведен из обращения` })
  }
  return res
}

export function checkStageRuleRules(
  r: SignalStageRuleRecord,
  state: RegistryState,
  org: OrgStateForRules | null,
): ValidationResult {
  const res: ValidationResult = { errors: [], warnings: [] }
  const cat = state.categories.find((c) => c.code === r.code)
  if (!cat) res.errors.push({ field: "code", message: `Код ${r.code} не существует` })
  else if (cat.retiredAt) res.warnings.push({ field: "code", message: `Код ${r.code} выведен из обращения` })
  if (r.packCode && !state.packs.some((x) => x.code === r.packCode)) {
    res.errors.push({ field: "packCode", message: `Пакет ${r.packCode} не существует` })
  }
  if (r.organizationId === null) {
    // Template: targets by stage meaning; no org stage ids.
    if (!r.packCode) res.errors.push({ field: "packCode", message: "У шаблона правила нужен пакет" })
    if (r.targetStageId) res.errors.push({ field: "targetStageId", message: "Шаблон задаёт стадию по смыслу (S1…S5, won, lost), не по id" })
    if (r.effect === "move_stage" && !r.targetStageMeaning) {
      res.errors.push({ field: "targetStageMeaning", message: "Для «move_stage» нужна целевая стадия" })
    }
    if (r.guards.fromStageIds?.length) {
      res.errors.push({ field: "guards.fromStageIds", message: "Шаблон задаёт исходные стадии по смыслу (fromStageMeanings)" })
    }
  } else {
    if (r.effect === "move_stage" && !r.targetStageId) {
      res.errors.push({ field: "targetStageId", message: "Для «move_stage» нужна целевая стадия" })
    }
    if (org) {
      if (r.targetStageId && !org.stageIds.has(r.targetStageId)) {
        res.errors.push({ field: "targetStageId", message: "Стадия не принадлежит воронке организации" })
      }
      r.guards.fromStageIds?.forEach((id, i) => {
        if (!org.stageIds.has(id)) {
          res.errors.push({ field: `guards.fromStageIds.${i}`, message: "Стадия не принадлежит воронке организации" })
        }
      })
    }
  }
  return res
}

export function checkRiskTypeRules(t: DealRiskTypeRecord, state: RegistryState): ValidationResult {
  const res: ValidationResult = { errors: [], warnings: [] }
  const cats = categoryIndex(state)
  if (!state.packs.some((x) => x.code === t.packCode)) {
    res.errors.push({ field: "packCode", message: `Пакет ${t.packCode} не существует` })
  }
  for (const field of ["triggerCodes", "clearCodes"] as const) {
    t[field].forEach((code, i) => {
      if (!cats.has(code)) res.errors.push({ field: `${field}.${i}`, message: `Код ${code} не существует` })
    })
  }
  if (t.triggerCodes.length === 0 && !t.condition) {
    res.warnings.push({ field: "triggerCodes", message: "Нет кодов-триггеров и нет условия: риск никогда не сработает" })
  }
  return res
}

export function checkRiskGuardRules(
  g: DealRiskStageGuardRecord,
  state: RegistryState,
  org: OrgStateForRules | null,
): ValidationResult {
  const res: ValidationResult = { errors: [], warnings: [] }
  if (!state.riskTypes.some((t) => t.code === g.riskCode)) {
    res.errors.push({ field: "riskCode", message: `Тип риска ${g.riskCode} не существует` })
  }
  if (org && g.stageIds) {
    g.stageIds.forEach((id, i) => {
      if (!org.stageIds.has(id)) {
        res.errors.push({ field: `stageIds.${i}`, message: "Стадия не принадлежит воронке организации" })
      }
    })
  }
  return res
}

/**
 * Deletes that would leave dangling references. Categories are never
 * deleted (retire instead) — the caller rejects that before this runs.
 */
export function checkDeleteRules(
  entity: SignalRegistryEntity,
  key: string,
  state: RegistryState,
): ValidationResult {
  const res: ValidationResult = { errors: [], warnings: [] }
  const used = (what: string, n: number) => {
    if (n > 0) res.errors.push({ field: "key", message: `Нельзя удалить: используется (${what}: ${n})` })
  }
  if (entity === "pack") {
    used("блоки", state.blocks.filter((b) => b.packCode === key).length)
    used("коды", state.categories.filter((c) => c.packCode === key).length)
    used("атрибуты", state.attributes.filter((a) => a.packCode === key).length)
    used("связи", state.relations.filter((r) => r.packCode === key).length)
    used("переопределения", state.packOverrides.filter((o) => o.packCode === key).length)
    used("типы рисков", state.riskTypes.filter((t) => t.packCode === key).length)
    used("шаблоны правил стадий", state.stageRuleTemplates.filter((t) => t.packCode === key).length)
  } else if (entity === "block") {
    used("коды", state.categories.filter((c) => c.blockCode === key).length)
  }
  return res
}

/** Run every rule over every row (diagnostics; not used to gate a save). */
export function validateWholeRegistry(state: RegistryState): {
  entity: SignalRegistryEntity
  key: string
  errors: SignalsValidationError[]
  warnings: SignalsValidationError[]
}[] {
  const out: ReturnType<typeof validateWholeRegistry> = []
  const push = (entity: SignalRegistryEntity, key: string, r: ValidationResult) => {
    if (r.errors.length || r.warnings.length) out.push({ entity, key, ...r })
  }
  for (const c of state.categories) push("category", c.code, checkCategoryRules(c, state))
  for (const o of state.packOverrides) push("pack_override", `${o.packCode}:${o.code}`, checkPackOverrideRules(o, state))
  for (const r of state.relations) push("relation", r.id, checkRelationRules(r, state))
  for (const t of state.riskTypes) push("risk_type", t.code, checkRiskTypeRules(t, state))
  for (const s of state.stageRuleTemplates) push("stage_rule", s.id, checkStageRuleRules(s, state, null))
  return out
}

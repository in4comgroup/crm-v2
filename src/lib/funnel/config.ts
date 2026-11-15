// Client-safe contract of a custom deal funnel (docs/specs/funnel/01-specification.md
// §3). ONE config shape `FunnelConfig` for the owner dialog, templates, admin
// import / export and `applyFunnelConfig`; the PURE validation every save
// runs. No DB, no server imports.

import { z } from "zod"

// ── Value lists ───────────────────────────────────────────────────────────

export const STAGE_ROLES = ["area0", "active", "won", "lost"] as const
export type StageRole = (typeof STAGE_ROLES)[number]

export const STAGE_ROLE_LABELS_RU: Record<StageRole, string> = {
  area0: "Контакт до запроса (вне воронки)",
  active: "Стадия воронки",
  won: "Итог: выиграли",
  lost: "Итог: не состоялась",
}

export const PROBABILITY_MODES = ["stage", "expert"] as const
export type ProbabilityMode = (typeof PROBABILITY_MODES)[number]

export const PROBABILITY_MODE_LABELS_RU: Record<ProbabilityMode, string> = {
  stage: "По стадии",
  expert: "Экспертная (по сделке)",
}

export const ENTRY_GATES = ["none", "go_no_go"] as const
export type EntryGate = (typeof ENTRY_GATES)[number]

export const ENTRY_GATE_LABELS_RU: Record<EntryGate, string> = {
  none: "Сделка создаётся по сигналу клиента (по правилам)",
  go_no_go: "Решение go / no-go перед воронкой",
}

/** Effects of a stage rule the OWNER editor offers (the admin editor has the same list). */
export const RULE_EFFECTS = ["create_deal", "move_stage", "in_stage", "outcome_won", "outcome_lost", "pause", "resume"] as const
export type RuleEffect = (typeof RULE_EFFECTS)[number]

export const RULE_EFFECT_LABELS_RU: Record<RuleEffect, string> = {
  create_deal: "Создать сделку",
  move_stage: "Перевести на стадию",
  in_stage: "Событие внутри стадии",
  outcome_won: "Итог: выиграли",
  outcome_lost: "Итог: не состоялась",
  pause: "Пауза",
  resume: "Снять с паузы",
}

/** Effects that need a target stage. */
export const EFFECTS_WITH_STAGE: readonly RuleEffect[] = ["create_deal", "move_stage"]

export const REASON_KINDS = ["lost", "noGo", "withdrawn"] as const
export type ReasonKind = (typeof REASON_KINDS)[number]

export const REASON_KIND_LABELS_RU: Record<ReasonKind, string> = {
  lost: "Не состоялась",
  noGo: "No-go (отказ от участия)",
  withdrawn: "Мы вышли",
}

/**
 * Codes that may NEVER close a deal: watchdogs about silence (spec W4 —
 * silence is not a loss). Prefix / suffix rules + exact codes.
 */
export function isSilenceCode(code: string): boolean {
  return /_NO_RESPONSE$/.test(code) || /_CONFIRMATION_OPEN$/.test(code) || code === "DELIVERY_REPORT_OPEN" || code === "CONTACT_OOO"
}

/** Codes of OUR side that may never move a deal (author-only rule, spec W2). */
export function isOurSideCode(code: string): boolean {
  return /_SENT$/.test(code) || code === "ORDER_CONFIRMED"
}

export const FUNNEL_LIMITS = {
  activeStages: 15,
  stageName: 60,
  description: 300,
  entryCondition: 500,
  signalsHint: 800,
  rules: 200,
  dealTypes: 20,
  dealTypeLabel: 80,
  reasonsPerKind: 20,
  reasonLabel: 80,
} as const

const L = FUNNEL_LIMITS

// ── Config shape ──────────────────────────────────────────────────────────

const codeSchema = z.string().trim().min(1).max(64).regex(/^[a-z0-9_]+$/, "Код: латиница, цифры, «_»")
const optText = (max: number) => z.string().trim().max(max).nullable().optional()

export const funnelStageConfigSchema = z.object({
  /** Existing stage id (owner dialog); absent = a new stage. */
  id: z.string().optional(),
  code: codeSchema,
  name: z.string().trim().min(1, "Укажите название стадии").max(L.stageName),
  role: z.enum(STAGE_ROLES),
  description: optText(L.description),
  entryCondition: optText(L.entryCondition),
  signalsHint: optText(L.signalsHint),
  inForecast: z.boolean(),
  probabilityMode: z.enum(PROBABILITY_MODES),
  /** 0..1 (stage probability; used when probabilityMode = stage). */
  probability: z.number().min(0).max(1),
  staleNormDays: z.number().int().min(1).max(365).nullable().optional(),
  isHidden: z.boolean().optional(),
})
export type FunnelStageConfig = z.infer<typeof funnelStageConfigSchema>

export const funnelDealTypeSchema = z.object({
  id: z.string().optional(),
  code: codeSchema,
  label: z.string().trim().min(1, "Укажите название типа").max(L.dealTypeLabel),
  hidden: z.boolean().optional(),
})
export type FunnelDealType = z.infer<typeof funnelDealTypeSchema>

const reasonSchema = z.object({ code: codeSchema, label: z.string().trim().min(1, "Пустая причина").max(L.reasonLabel) })
export type FunnelReason = z.infer<typeof reasonSchema>

export const funnelRuleSchema = z.object({
  /** Existing `signal_stage_rule.id` (keeps admin guards); absent = new. */
  id: z.string().optional(),
  /** Signal code of the shared catalog. */
  signal: z.string().trim().min(1).max(80),
  effect: z.enum(RULE_EFFECTS),
  /** Stage CODE (create_deal / move_stage); null otherwise. */
  stage: z.string().trim().max(64).nullable(),
  /** Deal type codes; empty = any type. */
  dealTypes: z.array(codeSchema).max(20).default([]),
  requiresConfirmation: z.boolean().default(false),
  minConfidence: z.enum(["medium", "high"]).default("medium"),
  enabled: z.boolean().default(true),
})
export type FunnelRule = z.infer<typeof funnelRuleSchema>

export const funnelConfigSchema = z.object({
  v: z.literal(1),
  stages: z.array(funnelStageConfigSchema).min(1).max(L.activeStages + 3),
  dealTypes: z.array(funnelDealTypeSchema).max(L.dealTypes),
  reasons: z.object({
    lost: z.array(reasonSchema).max(L.reasonsPerKind),
    noGo: z.array(reasonSchema).max(L.reasonsPerKind),
    withdrawn: z.array(reasonSchema).max(L.reasonsPerKind),
  }),
  entryGate: z.enum(ENTRY_GATES),
  rules: z.array(funnelRuleSchema).max(L.rules),
})
export type FunnelConfig = z.infer<typeof funnelConfigSchema>

/** Generic default reasons (an org without its own lists). */
export const DEFAULT_FUNNEL_REASONS: FunnelConfig["reasons"] = {
  lost: [
    { code: "competitor", label: "Выбрали другого" },
    { code: "cancelled", label: "Клиент отменил закупку" },
    { code: "price", label: "Цена" },
    { code: "other", label: "Другое" },
  ],
  noGo: [
    { code: "not_our_profile", label: "Не наш профиль" },
    { code: "low_chances", label: "Низкие шансы" },
    { code: "no_resources", label: "Нет ресурсов" },
    { code: "other", label: "Другое" },
  ],
  withdrawn: [
    { code: "decided_to_stop", label: "Решили не участвовать дальше" },
    { code: "other", label: "Другое" },
  ],
}

// ── Validation (spec §3.7) ────────────────────────────────────────────────

export type FunnelIssue = { path: string; message: string }

export type FunnelValidationContext = {
  /** Signal codes of the shared catalog that a rule may use. */
  knownSignals: ReadonlySet<string>
  /** Deal count per EXISTING stage id (a stage with deals cannot be removed). */
  dealsByStageId?: Readonly<Record<string, number>>
  /** Existing stage ids of the org (to detect removals). */
  existingStageIds?: readonly string[]
}

/**
 * PURE. Every rule of spec §3.7: structure (zod), roles, unique codes /
 * names, removable stages, rule targets and forbidden rules. Russian
 * messages; empty = valid.
 */
export function validateFunnelConfig(raw: unknown, ctx: FunnelValidationContext): { config: FunnelConfig | null; issues: FunnelIssue[] } {
  const parsed = funnelConfigSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      config: null,
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    }
  }
  const c = parsed.data
  const issues: FunnelIssue[] = []
  const add = (path: string, message: string) => issues.push({ path, message })

  const count = (r: StageRole) => c.stages.filter((s) => s.role === r).length
  if (count("won") !== 1) add("stages", "Нужна ровно одна стадия «Итог: выиграли»")
  if (count("lost") !== 1) add("stages", "Нужна ровно одна стадия «Итог: не состоялась»")
  if (count("area0") > 1) add("stages", "Стадия «Контакт до запроса» может быть только одна")
  const active = count("active")
  if (active < 1) add("stages", "Нужна хотя бы одна стадия воронки")
  if (active > L.activeStages) add("stages", `Не больше ${L.activeStages} стадий воронки`)

  const codes = new Set<string>()
  const names = new Set<string>()
  c.stages.forEach((s, i) => {
    if (codes.has(s.code)) add(`stages.${i}.code`, `Код стадии «${s.code}» повторяется`)
    codes.add(s.code)
    const n = s.name.toLowerCase()
    if (names.has(n)) add(`stages.${i}.name`, `Стадия «${s.name}» уже есть`)
    names.add(n)
    if (s.role !== "active" && s.inForecast) add(`stages.${i}.inForecast`, `«${s.name}»: в прогноз входят только стадии воронки`)
  })

  // Removed stages must be empty.
  const kept = new Set(c.stages.map((s) => s.id).filter((x): x is string => !!x))
  for (const id of ctx.existingStageIds ?? []) {
    if (!kept.has(id) && (ctx.dealsByStageId?.[id] ?? 0) > 0) {
      add("stages", `Нельзя удалить стадию со сделками (${ctx.dealsByStageId?.[id]}) — сначала перенесите их`)
    }
  }

  const typeCodes = new Set<string>()
  c.dealTypes.forEach((t, i) => {
    if (typeCodes.has(t.code)) add(`dealTypes.${i}.code`, `Тип «${t.label}» повторяется`)
    typeCodes.add(t.code)
  })

  for (const kind of REASON_KINDS) {
    const seen = new Set<string>()
    c.reasons[kind].forEach((r, i) => {
      if (seen.has(r.code)) add(`reasons.${kind}.${i}`, `Причина «${r.label}» повторяется`)
      seen.add(r.code)
    })
  }

  const stageByCode = new Map(c.stages.map((s) => [s.code, s]))
  const ruleKeys = new Set<string>()
  c.rules.forEach((r, i) => {
    const p = `rules.${i}`
    if (!ctx.knownSignals.has(r.signal)) add(p, `Неизвестный сигнал ${r.signal}`)
    const needsStage = EFFECTS_WITH_STAGE.includes(r.effect)
    if (needsStage) {
      const st = r.stage ? stageByCode.get(r.stage) : undefined
      if (!st) add(p, `${r.signal}: укажите стадию`)
      else if (st.role !== "active") add(p, `${r.signal}: переводить можно только на стадию воронки (не «${st.name}»)`)
    } else if (r.stage) {
      add(p, `${r.signal}: для «${RULE_EFFECT_LABELS_RU[r.effect]}» стадия не нужна`)
    }
    if ((r.effect === "outcome_lost" || r.effect === "outcome_won") && isSilenceCode(r.signal)) {
      add(p, `${r.signal}: молчание клиента не закрывает сделку`)
    }
    if (r.effect !== "in_stage" && isOurSideCode(r.signal)) {
      add(p, `${r.signal}: наше собственное действие не двигает сделку`)
    }
    for (const t of r.dealTypes) if (!typeCodes.has(t)) add(p, `${r.signal}: неизвестный тип сделки ${t}`)
    const key = `${r.signal}|${r.effect}|${r.stage ?? ""}|${[...r.dealTypes].sort().join(",")}`
    if (ruleKeys.has(key)) add(p, `${r.signal}: такое правило уже есть`)
    ruleKeys.add(key)
  })

  return { config: issues.length ? null : c, issues }
}

/** PURE. A new unique stage code for an owner-added stage. */
export function newStageCode(existing: readonly string[]): string {
  const taken = new Set(existing)
  for (let n = 1; n < 1000; n++) {
    const c = `st_${n}`
    if (!taken.has(c)) return c
  }
  return `st_${Date.now()}`
}

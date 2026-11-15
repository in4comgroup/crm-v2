import "server-only"

import { randomUUID } from "node:crypto"
import { and, asc, desc, eq, gte, inArray, isNotNull, ne, notInArray, sql } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"
import { db } from "@/db/drizzle"
import {
  client,
  deal,
  dealActivity,
  dealFunnelStage,
  dealRiskStageGuard,
  dealType,
  funnelTemplate,
  orgSettingLog,
  signalInstance,
  signalStageRule,
  sourceItem,
  topic,
} from "@/db/schema"
import { dealStageLabel, stageDisplayLabel, stageRoleOf } from "@/lib/deal-funnel"
import {
  DEFAULT_FUNNEL_REASONS,
  EFFECTS_WITH_STAGE,
  funnelConfigSchema,
  isOurSideCode,
  isSilenceCode,
  newStageCode,
  RULE_EFFECTS,
  validateFunnelConfig,
  type EntryGate,
  type FunnelConfig,
  type FunnelIssue,
  type FunnelReason,
  type FunnelRule,
  type ReasonKind,
  type RuleEffect,
} from "@/lib/funnel/config"
import type { StageRuleGuards } from "@/lib/signals/types"
import { getServerSession } from "@/lib/get-session"
import { DEFAULT_DEAL_TYPES, ensureDefaultDealTypes } from "@/server/deal-types"
import { getOrgSetting, setOrgSetting } from "@/server/org-settings"
import { getEffectiveSignals, getRegistry } from "@/server/signals/registry"
import { commitRegistryBatch, type RegistryChangeRow } from "@/server/signals/save"
import { getActiveOrgRole } from "@/server/sources"

// Custom deal funnel (docs/specs/funnel §3, §8): ONE config shape
// (`FunnelConfig`, src/lib/funnel/config.ts) read from and written to the
// DB. `server-only`, org-explicit (every function takes the org id); the
// session wrappers at the end check the session + org role for the API.
//
// What belongs to the funnel config:
// - stages (`deal_funnel_stage`, org rows — or the system rows while the org
//   has none; the first save copies them into the org),
// - deal types (`deal_type`; a removed type is deleted only when no deal uses
//   it and it is not a generic default — else it is hidden),
// - outcome reasons (`org_setting` `deals.outcomeReasons`, null = defaults),
// - the entry gate (`org_setting` `deals.entryGate`),
// - the OWNER-editable stage rules (org rows of `signal_stage_rule`): a rule
//   whose effect is outside RULE_EFFECTS, whose target stage is missing / not
//   an active stage, whose signal / deal type is unknown, or that the
//   validation would refuse, is NOT returned and is never touched by a save
//   (it keeps working; the admin edits it in «Сигналы»).
// Admin-only rule guards (minScore, fromStageIds, requiresFact, clientGuard,
// …) are kept untouched; the owner sets only `minConfidence` and
// `requiresConfirmation`.

type Batch = [BatchItem<"pg">, ...BatchItem<"pg">[]]

const DEFAULT_TYPE_CODES = new Set(DEFAULT_DEAL_TYPES.map((t) => t.code))

export class FunnelConfigError extends Error {
  constructor(
    message: string,
    readonly code: "invalid" | "forbidden" | "not_found" | "unauthorized" = "invalid",
    readonly issues: FunnelIssue[] = [],
  ) {
    super(message)
    this.name = "FunnelConfigError"
  }
}

// ── Loaders ───────────────────────────────────────────────────────────────

type StageRow = typeof dealFunnelStage.$inferSelect
type RuleRow = typeof signalStageRule.$inferSelect

/** Active stages of the org's funnel: org rows (own = true) or the system rows. */
async function loadFunnelRows(orgId: string): Promise<{ rows: StageRow[]; own: boolean }> {
  const own = await db
    .select()
    .from(dealFunnelStage)
    .where(
      and(
        eq(dealFunnelStage.isActive, true),
        eq(dealFunnelStage.isSystem, false),
        eq(dealFunnelStage.ownerOrganizationId, orgId),
      ),
    )
    .orderBy(asc(dealFunnelStage.sortOrder), asc(dealFunnelStage.name))
  if (own.length > 0) return { rows: own, own: true }
  const sys = await db
    .select()
    .from(dealFunnelStage)
    .where(and(eq(dealFunnelStage.isActive, true), eq(dealFunnelStage.isSystem, true)))
    .orderBy(asc(dealFunnelStage.sortOrder), asc(dealFunnelStage.name))
  return { rows: sys, own: false }
}

/** Deal count of the org per stage id (every status: a deal keeps its stage row). */
export async function countDealsByStage(orgId: string): Promise<Record<string, number>> {
  const rows = await db
    .select({ stageId: deal.funnelStageId, n: sql<number>`count(*)::int` })
    .from(deal)
    .where(eq(deal.organizationId, orgId))
    .groupBy(deal.funnelStageId)
  return Object.fromEntries(rows.map((r) => [r.stageId, r.n]))
}

/** Signal codes a rule may use: the registry codes that are not retired. */
async function knownSignalCodes(): Promise<Set<string>> {
  const reg = await getRegistry()
  return new Set(reg.categories.filter((c) => !c.retiredAt).map((c) => c.code))
}

async function loadOrgRules(orgId: string): Promise<RuleRow[]> {
  return db
    .select()
    .from(signalStageRule)
    .where(eq(signalStageRule.organizationId, orgId))
    .orderBy(asc(signalStageRule.sort), asc(signalStageRule.id))
}

/** Stored stage code; legacy rows without one get a stable fallback. */
function stageCodeOf(r: StageRow, taken: Set<string>): string {
  if (r.code) return r.code
  const role = stageRoleOf(r.role)
  const want = role === "active" ? newStageCode([...taken]) : role
  return taken.has(want) ? newStageCode([...taken]) : want
}

function stageToConfig(r: StageRow, code: string): FunnelConfig["stages"][number] {
  const role = stageRoleOf(r.role)
  return {
    id: r.id,
    code,
    name: stageDisplayLabel(r.name, r.displayName),
    role,
    description: r.description ?? null,
    entryCondition: r.entryCondition ?? null,
    signalsHint: r.signalsHint ?? null,
    // Only active stages may be in the forecast (validation rule).
    inForecast: role === "active" ? r.inForecast : false,
    probabilityMode: r.probabilityMode === "expert" ? "expert" : "stage",
    probability: Number(r.closureProbability),
    staleNormDays: r.staleNormDays ?? null,
    isHidden: r.isHidden,
  }
}

function minConfidenceOf(g: StageRuleGuards): "medium" | "high" {
  return g.minConfidence === "high" ? "high" : "medium"
}

/**
 * Rule rows the owner may edit, mapped to the config (in sort order). A row
 * that the config cannot express (see the module comment) is left out.
 */
function editableRules(
  rules: readonly RuleRow[],
  stageById: ReadonlyMap<string, { code: string; role: string }>,
  known: ReadonlySet<string>,
  typeCodes: ReadonlySet<string>,
): { row: RuleRow; rule: FunnelRule }[] {
  const out: { row: RuleRow; rule: FunnelRule }[] = []
  const keys = new Set<string>()
  for (const r of rules) {
    if (!(RULE_EFFECTS as readonly string[]).includes(r.effect)) continue
    const effect = r.effect as RuleEffect
    if (!known.has(r.code)) continue
    const types = r.dealTypes ?? []
    if (types.some((t) => !typeCodes.has(t)) || types.length > 20) continue
    if (types.some((t) => !/^[a-z0-9_]+$/.test(t))) continue
    let stage: string | null = null
    if (EFFECTS_WITH_STAGE.includes(effect)) {
      const st = r.targetStageId ? stageById.get(r.targetStageId) : undefined
      if (!st || stageRoleOf(st.role) !== "active") continue
      stage = st.code
    }
    if ((effect === "outcome_lost" || effect === "outcome_won") && isSilenceCode(r.code)) continue
    if (effect !== "in_stage" && isOurSideCode(r.code)) continue
    const key = `${r.code}|${effect}|${stage ?? ""}|${[...types].sort().join(",")}`
    if (keys.has(key)) continue
    keys.add(key)
    const g = (r.guards ?? {}) as StageRuleGuards
    out.push({
      row: r,
      rule: {
        id: r.id,
        signal: r.code,
        effect,
        stage,
        dealTypes: [...types],
        requiresConfirmation: g.requiresConfirmation === true,
        minConfidence: minConfidenceOf(g),
        enabled: r.enabled,
      },
    })
  }
  return out
}

/** Effective outcome reasons of the org (org setting, else the generic defaults). */
export async function getOutcomeReasons(orgId: string): Promise<FunnelConfig["reasons"]> {
  return (await getOrgSetting(orgId, "deals.outcomeReasons")) ?? DEFAULT_FUNNEL_REASONS
}

/**
 * Label of one reason code of the org list `kind`; throws a Russian
 * FunnelConfigError for a code that is not in the list.
 */
export async function resolveOutcomeReason(orgId: string, kind: ReasonKind, code: string): Promise<FunnelReason> {
  const list = (await getOutcomeReasons(orgId))[kind]
  const hit = list.find((r) => r.code === code)
  if (!hit) throw new FunnelConfigError("Причина не из списка организации")
  return hit
}

// ── Read ──────────────────────────────────────────────────────────────────

/**
 * The org's funnel as one `FunnelConfig` (spec §3.7): stages (org rows, or
 * the system funnel while the org has none), deal types, reasons, gate and
 * the owner-editable stage rules. Round-trips through `validateFunnelConfig`.
 */
export async function getFunnelConfig(orgId: string): Promise<FunnelConfig> {
  const [{ rows }, types, reasons, gate, rules, known] = await Promise.all([
    loadFunnelRows(orgId),
    ensureDefaultDealTypes(orgId),
    getOutcomeReasons(orgId),
    getOrgSetting(orgId, "deals.entryGate"),
    loadOrgRules(orgId),
    knownSignalCodes(),
  ])
  const taken = new Set(rows.map((r) => r.code).filter((c): c is string => !!c))
  const stages = rows.map((r) => {
    const code = stageCodeOf(r, taken)
    taken.add(code)
    return stageToConfig(r, code)
  })
  const stageById = new Map(stages.map((s) => [s.id!, { code: s.code, role: s.role }]))
  const typeCodes = new Set(types.map((t) => t.code))
  return {
    v: 1,
    stages,
    dealTypes: types.map((t) => ({ id: t.id, code: t.code, label: t.labelRu, hidden: t.isHidden })),
    reasons,
    entryGate: gate,
    rules: editableRules(rules, stageById, known, typeCodes).map((x) => x.rule),
  }
}

// ── Apply ─────────────────────────────────────────────────────────────────

export type ApplyFunnelResult = {
  config: FunnelConfig
  changed: boolean
  counts: {
    stagesAdded: number
    stagesUpdated: number
    stagesRemoved: number
    dealTypesAdded: number
    dealTypesUpdated: number
    dealTypesHidden: number
    dealTypesDeleted: number
    rulesAdded: number
    rulesUpdated: number
    rulesDeleted: number
    settingsChanged: number
    /** true = the org was on the system funnel and got its own copy now. */
    copiedSystemFunnel: boolean
  }
}

const num3 = (p: number) => (Math.round(p * 1000) / 1000).toFixed(3)
const sameJson = (a: unknown, b: unknown) => stableJson(a) === stableJson(b)

function stableJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null)
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
    .join(",")}}`
}

/** Short before / after picture of a funnel for the change log. */
function funnelSummary(c: FunnelConfig) {
  return {
    stages: c.stages.map((s) => ({ code: s.code, name: s.name, role: s.role, inForecast: s.inForecast, probabilityMode: s.probabilityMode })),
    dealTypes: c.dealTypes.filter((t) => !t.hidden).map((t) => t.code),
    entryGate: c.entryGate,
    rules: c.rules.length,
    reasons: { lost: c.reasons.lost.length, noGo: c.reasons.noGo.length, withdrawn: c.reasons.withdrawn.length },
  }
}

export type ApplyFunnelOptions = {
  /**
   * Admin import of a config exported from ANOTHER org: ids that do not
   * belong to this org are ignored (the entry is matched by code / created).
   * Default false: an unknown id is an error.
   */
  portable?: boolean
}

/**
 * Validates and saves the org's funnel (spec §3.7) in as few batches as
 * possible: stages (+ the first copy of the system funnel, which re-points
 * the org's deals, journal, rules and risk guards to the copies), deal
 * types, stage rules (with a registry version + change rows when a rule
 * changed) and the change log row `deals.funnel`; then the gate and the
 * reasons (org settings, with their own log). An unchanged config writes
 * nothing. Throws FunnelConfigError (`issues`) when invalid.
 */
/** PURE-ish helper of `applyFunnelConfig`: ids by code for stages / types that have none. */
function attachIdsByCode(
  raw: unknown,
  stageRows: readonly { id: string; code: string | null }[],
  types: readonly { id: string; code: string }[],
): unknown {
  if (!raw || typeof raw !== "object") return raw
  const c = structuredClone(raw) as { stages?: { id?: string; code?: string }[]; dealTypes?: { id?: string; code?: string }[] }
  const stageByCode = new Map(stageRows.filter((r) => r.code).map((r) => [r.code as string, r.id]))
  const typeByCode = new Map(types.map((t) => [t.code, t.id]))
  const claimed = new Set((c.stages ?? []).map((s) => s.id).filter(Boolean))
  for (const s of c.stages ?? []) {
    const id = !s.id && s.code ? stageByCode.get(s.code) : undefined
    if (id && !claimed.has(id)) {
      s.id = id
      claimed.add(id)
    }
  }
  const claimedT = new Set((c.dealTypes ?? []).map((t) => t.id).filter(Boolean))
  for (const t of c.dealTypes ?? []) {
    const id = !t.id && t.code ? typeByCode.get(t.code) : undefined
    if (id && !claimedT.has(id)) {
      t.id = id
      claimedT.add(id)
    }
  }
  return c
}

export async function applyFunnelConfig(
  orgId: string,
  raw: unknown,
  userId: string,
  opts: ApplyFunnelOptions = {},
): Promise<ApplyFunnelResult> {
  const [{ rows: stageRows, own }, dealsByStageId, known, types, ruleRows, before] = await Promise.all([
    loadFunnelRows(orgId),
    countDealsByStage(orgId),
    knownSignalCodes(),
    ensureDefaultDealTypes(orgId),
    loadOrgRules(orgId),
    getFunnelConfig(orgId),
  ])
  const existingIds = stageRows.map((r) => r.id)
  // A stage / type WITHOUT an id but with the code of an existing row IS that
  // row (templates, imports, the IN4COM file): attach the id BEFORE the
  // validation, else the row looks "removed" and a stage with deals blocks it.
  raw = attachIdsByCode(raw, stageRows, types)
  const { config: validated, issues } = validateFunnelConfig(raw, {
    knownSignals: known,
    dealsByStageId,
    existingStageIds: existingIds,
  })
  if (!validated) throw new FunnelConfigError("Воронку нельзя сохранить", "invalid", issues)
  const config: FunnelConfig = structuredClone(validated)

  const extra: FunnelIssue[] = []
  const rowById = new Map(stageRows.map((r) => [r.id, r]))
  const typeById = new Map(types.map((t) => [t.id, t]))
  const ruleById = new Map(ruleRows.map((r) => [r.id, r]))
  // Foreign ids (portable import) are dropped; otherwise they are errors.
  config.stages.forEach((s, i) => {
    if (s.id && !rowById.has(s.id)) {
      if (opts.portable) delete s.id
      else extra.push({ path: `stages.${i}`, message: `Стадия «${s.name}» не найдена в воронке организации` })
    }
  })
  config.dealTypes.forEach((t, i) => {
    if (t.id && !typeById.has(t.id)) {
      if (opts.portable) delete t.id
      else extra.push({ path: `dealTypes.${i}`, message: `Тип «${t.label}» не найден` })
    }
    const cur = t.id ? typeById.get(t.id) : undefined
    if (cur && cur.code !== t.code) extra.push({ path: `dealTypes.${i}.code`, message: `Код типа «${cur.labelRu}» менять нельзя` })
  })
  // Editable rules NOW (the only rows a save may update / delete).
  const stageInfoNow = new Map(before.stages.map((s) => [s.id!, { code: s.code, role: s.role }]))
  const editableNow = new Map(
    editableRules(ruleRows, stageInfoNow, known, new Set(types.map((t) => t.code))).map((x) => [x.row.id, x]),
  )
  config.rules.forEach((r, i) => {
    if (!r.id) return
    if (editableNow.has(r.id)) return
    if (opts.portable && !ruleById.has(r.id)) {
      delete r.id
      return
    }
    extra.push({ path: `rules.${i}`, message: `${r.signal}: правило не найдено или его меняет только администратор платформы` })
  })
  if (extra.length) throw new FunnelConfigError("Воронку нельзя сохранить", "invalid", extra)

  // ── Stages ──
  // Match: by id, else (no id) by code among the rows not referenced by id.
  const referenced = new Set(config.stages.map((s) => s.id).filter((x): x is string => !!x))
  const byCode = new Map(stageRows.filter((r) => r.code && !referenced.has(r.id)).map((r) => [r.code!, r]))
  type Planned = { cfg: FunnelConfig["stages"][number]; row: StageRow | null; finalId: string }
  const planned: Planned[] = config.stages.map((cfg) => {
    const row = cfg.id ? rowById.get(cfg.id)! : (byCode.get(cfg.code) ?? null)
    if (row && !cfg.id) byCode.delete(cfg.code)
    return { cfg, row, finalId: row?.id ?? randomUUID() }
  })
  const keptIds = new Set(planned.map((p) => p.row?.id).filter((x): x is string => !!x))
  const removed = stageRows.filter((r) => !keptIds.has(r.id))
  // Same order as now → keep the stored sort orders.
  const sameOrder =
    removed.length === 0 &&
    planned.every((p) => !!p.row) &&
    planned.map((p) => p.row!.id).join("|") === stageRows.map((r) => r.id).join("|")

  const stageFields = (p: Planned, i: number) => {
    const c = p.cfg
    const base = {
      role: c.role,
      code: c.code,
      description: c.description?.trim() || null,
      entryCondition: c.entryCondition?.trim() || null,
      signalsHint: c.signalsHint?.trim() || null,
      inForecast: c.role === "active" ? c.inForecast : false,
      probabilityMode: c.probabilityMode,
      closureProbability: num3(c.probability),
      staleNormDays: c.staleNormDays ?? null,
      isHidden: c.isHidden ?? false,
      isPrePipeline: c.role === "area0",
      sortOrder: sameOrder && p.row ? p.row.sortOrder : (i + 1) * 10,
    }
    // Name: an existing stage keeps its internal `name`; a changed label goes
    // to `display_name` (null when it equals the default label of the name).
    let names: { name?: string; displayName?: string | null } = {}
    if (!p.row) names = { name: c.name, displayName: null }
    else if (stageDisplayLabel(p.row.name, p.row.displayName) !== c.name) {
      names = { displayName: c.name === dealStageLabel(p.row.name) ? null : c.name }
    }
    return { ...base, ...names }
  }

  const stageStatements: BatchItem<"pg">[] = []
  let stagesAdded = 0
  let stagesUpdated = 0
  const copying = !own
  // Does anything differ for the existing rows?
  const diffs = planned.map((p, i) => {
    const f = stageFields(p, i)
    if (!p.row) return { p, f, changed: true }
    const r = p.row
    const changed =
      stageRoleOf(r.role) !== f.role ||
      r.code !== f.code ||
      (r.description ?? null) !== f.description ||
      (r.entryCondition ?? null) !== f.entryCondition ||
      (r.signalsHint ?? null) !== f.signalsHint ||
      r.inForecast !== f.inForecast ||
      (r.probabilityMode === "expert" ? "expert" : "stage") !== f.probabilityMode ||
      num3(Number(r.closureProbability)) !== f.closureProbability ||
      (r.staleNormDays ?? null) !== f.staleNormDays ||
      r.isHidden !== f.isHidden ||
      r.isPrePipeline !== f.isPrePipeline ||
      r.sortOrder !== f.sortOrder ||
      ("name" in f && f.name !== r.name) ||
      ("displayName" in f && (f.displayName ?? null) !== (r.displayName ?? null))
    return { p, f, changed }
  })
  const stagesChanged = removed.length > 0 || diffs.some((d) => d.changed)
  // Old id → new id (first copy of the system funnel only).
  const idMap = new Map<string, string>()

  if (copying && stagesChanged) {
    // First save of an org on the system funnel: every stage becomes an org row.
    for (const d of diffs) {
      const newId = randomUUID()
      if (d.p.row) idMap.set(d.p.row.id, newId)
      d.p.finalId = newId
      stageStatements.push(
        db.insert(dealFunnelStage).values({
          id: newId,
          name: d.f.name ?? d.p.row!.name,
          displayName: "displayName" in d.f ? (d.f.displayName ?? null) : (d.p.row?.displayName ?? null),
          ...withoutNames(d.f),
          isSystem: false,
          ownerOrganizationId: orgId,
          isActive: true,
        }),
      )
      stagesAdded++
    }
    stageStatements.push(...repointOps(orgId, idMap))
  } else if (stagesChanged) {
    // Unique (funnel, code): removed rows drop their code, changing codes go
    // through a temporary value first, so swaps never collide mid-batch.
    for (const r of removed) {
      stageStatements.push(
        db
          .update(dealFunnelStage)
          .set({ isActive: false, code: null })
          .where(and(eq(dealFunnelStage.id, r.id), eq(dealFunnelStage.ownerOrganizationId, orgId))),
      )
    }
    for (const d of diffs) {
      if (d.p.row && d.p.row.code !== d.f.code && d.p.row.code) {
        stageStatements.push(
          db
            .update(dealFunnelStage)
            .set({ code: `tmp_${d.p.row.id}` })
            .where(and(eq(dealFunnelStage.id, d.p.row.id), eq(dealFunnelStage.ownerOrganizationId, orgId))),
        )
      }
    }
    for (const d of diffs) {
      if (d.p.row) {
        if (!d.changed) continue
        stagesUpdated++
        stageStatements.push(
          db
            .update(dealFunnelStage)
            .set({ ...withoutNames(d.f), ...namesOf(d.f) })
            .where(and(eq(dealFunnelStage.id, d.p.row.id), eq(dealFunnelStage.ownerOrganizationId, orgId))),
        )
      } else {
        stagesAdded++
        stageStatements.push(
          db.insert(dealFunnelStage).values({
            id: d.p.finalId,
            name: d.f.name!,
            displayName: null,
            ...withoutNames(d.f),
            isSystem: false,
            ownerOrganizationId: orgId,
            isActive: true,
          }),
        )
      }
    }
  }
  const stagesRemoved = copying ? 0 : stagesChanged ? removed.length : 0

  // ── Deal types ──
  const typeStatements: BatchItem<"pg">[] = []
  let dealTypesAdded = 0
  let dealTypesUpdated = 0
  let dealTypesHidden = 0
  let dealTypesDeleted = 0
  const typeByCode = new Map(types.map((t) => [t.code, t]))
  const keptTypes = new Set<string>()
  const typeSameOrder =
    config.dealTypes.every((t) => !!(t.id ? typeById.get(t.id) : typeByCode.get(t.code))) &&
    config.dealTypes.length === types.length &&
    config.dealTypes.map((t) => t.code).join("|") === types.map((t) => t.code).join("|")
  config.dealTypes.forEach((t, i) => {
    const cur = t.id ? typeById.get(t.id) : typeByCode.get(t.code)
    const sort = typeSameOrder && cur ? cur.sort : i
    const hidden = t.hidden ?? false
    if (cur) {
      keptTypes.add(cur.id)
      if (cur.labelRu !== t.label || cur.isHidden !== hidden || cur.sort !== sort) {
        dealTypesUpdated++
        typeStatements.push(
          db
            .update(dealType)
            .set({ labelRu: t.label, isHidden: hidden, sort })
            .where(and(eq(dealType.id, cur.id), eq(dealType.organizationId, orgId))),
        )
      }
    } else {
      dealTypesAdded++
      typeStatements.push(
        db.insert(dealType).values({ id: randomUUID(), organizationId: orgId, code: t.code, labelRu: t.label, sort, isHidden: hidden }),
      )
    }
  })
  const droppedTypes = types.filter((t) => !keptTypes.has(t.id))
  if (droppedTypes.length > 0) {
    const used = await db
      .select({ typeId: deal.dealTypeId, n: sql<number>`count(*)::int` })
      .from(deal)
      .where(and(eq(deal.organizationId, orgId), inArray(deal.dealTypeId, droppedTypes.map((t) => t.id))))
      .groupBy(deal.dealTypeId)
    const usedIds = new Set(used.filter((u) => u.n > 0).map((u) => u.typeId))
    for (const t of droppedTypes) {
      // A generic default type is re-created by `ensureDefaultDealTypes` on
      // the next read — hide it instead of deleting it.
      if (usedIds.has(t.id) || DEFAULT_TYPE_CODES.has(t.code)) {
        if (t.isHidden) continue
        dealTypesHidden++
        typeStatements.push(
          db.update(dealType).set({ isHidden: true }).where(and(eq(dealType.id, t.id), eq(dealType.organizationId, orgId))),
        )
      } else {
        dealTypesDeleted++
        typeStatements.push(db.delete(dealType).where(and(eq(dealType.id, t.id), eq(dealType.organizationId, orgId))))
      }
    }
  }

  // ── Rules ──
  const finalStageIdByCode = new Map(planned.map((p) => [p.cfg.code, p.finalId]))
  const finalRoleById = new Map(planned.map((p) => [p.finalId, p.cfg.role]))
  const ruleStatements: BatchItem<"pg">[] = []
  const ruleChanges: RegistryChangeRow[] = []
  let rulesAdded = 0
  let rulesUpdated = 0
  let rulesDeleted = 0
  const remap = (id: string | null) => (id && idMap.has(id) ? idMap.get(id)! : id)
  const keptRuleIds = new Set(config.rules.map((r) => r.id).filter((x): x is string => !!x))
  let nextSort = ruleRows.reduce((m, r) => Math.max(m, r.sort), 0) + 1

  const ruleRecord = (r: RuleRow) => ({
    id: r.id,
    organizationId: r.organizationId,
    packCode: r.packCode,
    code: r.code,
    effect: r.effect,
    targetStageId: r.targetStageId,
    targetStageMeaning: r.targetStageMeaning,
    dealTypes: r.dealTypes ?? [],
    guards: (r.guards ?? {}) as Record<string, unknown>,
    enabled: r.enabled,
    sort: r.sort,
    noteRu: r.noteRu,
  })

  for (const rule of config.rules) {
    const needsStage = EFFECTS_WITH_STAGE.includes(rule.effect)
    if (rule.id) {
      const row = ruleById.get(rule.id)!
      const g = { ...((row.guards ?? {}) as StageRuleGuards) }
      if (minConfidenceOf(g) !== rule.minConfidence) g.minConfidence = rule.minConfidence
      if ((g.requiresConfirmation === true) !== rule.requiresConfirmation) {
        if (rule.requiresConfirmation) g.requiresConfirmation = true
        else delete g.requiresConfirmation
      }
      if (g.fromStageIds?.length) g.fromStageIds = g.fromStageIds.map((x) => remap(x)!)
      // Target: a stage effect → the config stage; an outcome keeps its stored
      // target only when it is the stage of that outcome role; other effects
      // keep it only while the effect is unchanged.
      const curTarget = remap(row.targetStageId)
      let target: string | null
      if (needsStage) target = finalStageIdByCode.get(rule.stage!) ?? null
      else if (rule.effect === "outcome_won" || rule.effect === "outcome_lost") {
        const want = rule.effect === "outcome_won" ? "won" : "lost"
        target = row.effect === rule.effect && curTarget && finalRoleById.get(curTarget) === want ? curTarget : null
      } else target = row.effect === rule.effect ? curTarget : null
      const next = {
        code: rule.signal,
        effect: rule.effect,
        targetStageId: target,
        dealTypes: [...rule.dealTypes],
        guards: g as Record<string, unknown>,
        enabled: rule.enabled,
      }
      const cur = {
        code: row.code,
        effect: row.effect,
        targetStageId: row.targetStageId,
        dealTypes: row.dealTypes ?? [],
        guards: (row.guards ?? {}) as Record<string, unknown>,
        enabled: row.enabled,
      }
      if (sameJson(next, cur)) continue
      rulesUpdated++
      ruleStatements.push(
        db
          .update(signalStageRule)
          .set({ ...next, updatedAt: new Date() })
          .where(and(eq(signalStageRule.id, row.id), eq(signalStageRule.organizationId, orgId))),
      )
      ruleChanges.push({
        entity: "stage_rule",
        entityKey: row.id,
        organizationId: orgId,
        action: "update",
        before: ruleRecord(row),
        after: { ...ruleRecord(row), ...next },
      })
    } else {
      const guards: StageRuleGuards = { minConfidence: rule.minConfidence }
      if (rule.requiresConfirmation) guards.requiresConfirmation = true
      const values = {
        id: randomUUID(),
        organizationId: orgId,
        packCode: "base",
        code: rule.signal,
        effect: rule.effect,
        targetStageId: needsStage ? (finalStageIdByCode.get(rule.stage!) ?? null) : null,
        targetStageMeaning: null,
        dealTypes: [...rule.dealTypes],
        guards: guards as Record<string, unknown>,
        enabled: rule.enabled,
        sort: nextSort++,
        noteRu: null,
      }
      rulesAdded++
      ruleStatements.push(db.insert(signalStageRule).values(values))
      ruleChanges.push({ entity: "stage_rule", entityKey: values.id, organizationId: orgId, action: "create", before: null, after: values })
    }
  }
  for (const [id, { row }] of editableNow) {
    if (keptRuleIds.has(id)) continue
    rulesDeleted++
    ruleStatements.push(db.delete(signalStageRule).where(and(eq(signalStageRule.id, id), eq(signalStageRule.organizationId, orgId))))
    ruleChanges.push({ entity: "stage_rule", entityKey: id, organizationId: orgId, action: "delete", before: ruleRecord(row), after: null })
  }
  // First copy: the rules the owner does not edit (and the risk guards) move
  // to the copied stages too.
  if (idMap.size > 0) {
    for (const row of ruleRows) {
      if (ruleChanges.some((c) => c.entityKey === row.id)) continue
      const g = (row.guards ?? {}) as StageRuleGuards
      const from = g.fromStageIds?.map((x) => remap(x)!)
      const target = remap(row.targetStageId)
      if (target === row.targetStageId && sameJson(from ?? null, g.fromStageIds ?? null)) continue
      const guards = from ? { ...g, fromStageIds: from } : g
      ruleStatements.push(
        db
          .update(signalStageRule)
          .set({ targetStageId: target, guards: guards as Record<string, unknown>, updatedAt: new Date() })
          .where(and(eq(signalStageRule.id, row.id), eq(signalStageRule.organizationId, orgId))),
      )
      ruleChanges.push({
        entity: "stage_rule",
        entityKey: row.id,
        organizationId: orgId,
        action: "update",
        before: ruleRecord(row),
        after: { ...ruleRecord(row), targetStageId: target, guards: guards as Record<string, unknown> },
      })
    }
    stageStatements.push(...(await riskGuardRemapOps(orgId, idMap)))
  }

  // ── Settings (own writes + logs) ──
  const curReasons = await getOrgSetting(orgId, "deals.outcomeReasons")
  const reasonsChanged = !sameJson(config.reasons, curReasons ?? DEFAULT_FUNNEL_REASONS)
  const gateChanged = config.entryGate !== before.entryGate
  const settingsChanged = (reasonsChanged ? 1 : 0) + (gateChanged ? 1 : 0)

  const counts: ApplyFunnelResult["counts"] = {
    stagesAdded,
    stagesUpdated,
    stagesRemoved,
    dealTypesAdded,
    dealTypesUpdated,
    dealTypesHidden,
    dealTypesDeleted,
    rulesAdded,
    rulesUpdated,
    rulesDeleted,
    settingsChanged,
    copiedSystemFunnel: copying && stagesChanged,
  }
  const statements = [...stageStatements, ...typeStatements, ...ruleStatements]
  const changed = statements.length > 0 || settingsChanged > 0
  if (!changed) return { config: before, changed: false, counts }

  // One change-log row for the whole save (key `deals.funnel`).
  statements.push(
    db.insert(orgSettingLog).values({
      id: randomUUID(),
      organizationId: orgId,
      key: "deals.funnel",
      oldValue: funnelSummary(before),
      newValue: { ...funnelSummary(config), counts },
      changedByUserId: userId,
    }),
  )
  if (ruleChanges.length > 0) {
    await commitRegistryBatch(
      statements,
      ruleChanges,
      `Воронка организации: правила стадий (+${rulesAdded} / ~${rulesUpdated} / −${rulesDeleted})`,
      userId,
    )
  } else {
    await db.batch(statements as Batch)
  }
  if (gateChanged) await setOrgSetting(orgId, "deals.entryGate", config.entryGate satisfies EntryGate, userId)
  if (reasonsChanged) {
    const isDefault = sameJson(config.reasons, DEFAULT_FUNNEL_REASONS)
    await setOrgSetting(orgId, "deals.outcomeReasons", isDefault ? null : config.reasons, userId)
  }
  return { config: await getFunnelConfig(orgId), changed: true, counts }
}

function withoutNames<T extends { name?: string; displayName?: string | null }>(f: T): Omit<T, "name" | "displayName"> {
  const { name: _n, displayName: _d, ...rest } = f
  void _n
  void _d
  return rest
}

function namesOf(f: { name?: string; displayName?: string | null }): { name?: string; displayName?: string | null } {
  const out: { name?: string; displayName?: string | null } = {}
  if (f.name !== undefined) out.name = f.name
  if (f.displayName !== undefined) out.displayName = f.displayName
  return out
}

/** First copy of the system funnel: the org's deals + their journal move to the copies (deal.updated_at kept). */
function repointOps(orgId: string, idMap: ReadonlyMap<string, string>): BatchItem<"pg">[] {
  const orgDealIds = db.select({ id: deal.id }).from(deal).where(eq(deal.organizationId, orgId))
  const ops: BatchItem<"pg">[] = []
  for (const [from, to] of idMap) {
    ops.push(
      db
        .update(deal)
        .set({ funnelStageId: to, updatedAt: sql`${deal.updatedAt}` })
        .where(and(eq(deal.organizationId, orgId), eq(deal.funnelStageId, from))),
      db
        .update(dealActivity)
        .set({ fromStageId: to })
        .where(and(eq(dealActivity.fromStageId, from), inArray(dealActivity.dealId, orgDealIds))),
      db
        .update(dealActivity)
        .set({ toStageId: to })
        .where(and(eq(dealActivity.toStageId, from), inArray(dealActivity.dealId, orgDealIds))),
    )
  }
  return ops
}

async function riskGuardRemapOps(orgId: string, idMap: ReadonlyMap<string, string>): Promise<BatchItem<"pg">[]> {
  const guards = await db
    .select()
    .from(dealRiskStageGuard)
    .where(and(eq(dealRiskStageGuard.organizationId, orgId), isNotNull(dealRiskStageGuard.stageIds)))
  const ops: BatchItem<"pg">[] = []
  for (const g of guards) {
    const ids = g.stageIds ?? []
    const next = ids.map((x) => idMap.get(x) ?? x)
    if (next.join("|") === ids.join("|")) continue
    ops.push(
      db
        .update(dealRiskStageGuard)
        .set({ stageIds: next })
        .where(and(eq(dealRiskStageGuard.organizationId, orgId), eq(dealRiskStageGuard.riskCode, g.riskCode))),
    )
  }
  return ops
}

// ── Preview («Проверить на данных», spec §3.7) ────────────────────────────

export const FUNNEL_PREVIEW_DAYS = 30

export type FunnelPreviewExample = { topicId: string; topicTitle: string; company: string | null; date: string }

export type FunnelPreviewRule = {
  /** Index in `config.rules`. */
  index: number
  ruleId: string | null
  signal: string
  effect: RuleEffect
  stage: string | null
  /** Counted instances of the signal in the window (any topic). */
  instances: number
  /** Distinct topics with such an instance. */
  topics: number
  /**
   * Topics the rule would act on: create_deal → topics WITHOUT a deal;
   * move / outcome / pause / resume / in_stage → topics WITH a deal.
   */
  wouldAct: number
  examples: FunnelPreviewExample[]
}

export type FunnelPreviewStage = {
  code: string
  name: string
  role: string
  create: number
  move: number
  won: number
  lost: number
}

export type FunnelPreviewResult = {
  days: number
  since: string
  rules: FunnelPreviewRule[]
  stages: FunnelPreviewStage[]
  totals: { create: number; move: number; won: number; lost: number; pause: number; resume: number; inStage: number }
  issues: FunnelIssue[]
}

/**
 * DRY RUN of the edited rules (nothing written): the org's counted signal
 * instances of the last 30 days — confidence ≠ low, not from our own
 * outbound / internal items (the deal bridge's author rule), on a live
 * topic — matched per enabled rule by code. An APPROXIMATION of the deal
 * bridge: admin guards (min score, from-stages, client guard, deal type of
 * an existing deal) and dedupe are not applied; distinct topics are counted
 * once per stage and effect.
 */
export async function previewFunnelRules(orgId: string, raw: unknown, now: Date = new Date()): Promise<FunnelPreviewResult> {
  const [known, dealsByStageId, { rows }] = await Promise.all([knownSignalCodes(), countDealsByStage(orgId), loadFunnelRows(orgId)])
  const since = new Date(now.getTime() - FUNNEL_PREVIEW_DAYS * 86_400_000)
  const empty = { create: 0, move: 0, won: 0, lost: 0, pause: 0, resume: 0, inStage: 0 }
  const { config, issues } = validateFunnelConfig(raw, {
    knownSignals: known,
    dealsByStageId,
    existingStageIds: rows.map((r) => r.id),
  })
  if (!config) return { days: FUNNEL_PREVIEW_DAYS, since: since.toISOString(), rules: [], stages: [], totals: empty, issues }

  const codes = [...new Set(config.rules.filter((r) => r.enabled).map((r) => r.signal))]
  const instances = codes.length
    ? await db
        .select({
          code: signalInstance.code,
          confidence: signalInstance.confidence,
          topicId: signalInstance.topicId,
          createdAt: signalInstance.createdAt,
          topicTitle: topic.title,
          dealId: topic.dealId,
          company: client.name,
        })
        .from(signalInstance)
        .innerJoin(topic, eq(topic.id, signalInstance.topicId))
        .leftJoin(client, eq(client.id, topic.clientId))
        .leftJoin(sourceItem, eq(sourceItem.id, signalInstance.sourceItemId))
        .where(
          and(
            eq(signalInstance.organizationId, orgId),
            inArray(signalInstance.code, codes),
            eq(signalInstance.counted, true),
            ne(signalInstance.confidence, "low"),
            gte(signalInstance.createdAt, since),
            notInArray(topic.status, ["merged", "dismissed"]),
            // Author-only (deal bridge W2): our own outbound / internal items never act.
            sql`coalesce(${sourceItem.signalFacts}->>'direction', 'inbound') not in ('outbound', 'internal')`,
          ),
        )
        .orderBy(desc(signalInstance.createdAt))
    : []

  const byCode = new Map<string, typeof instances>()
  for (const i of instances) byCode.set(i.code, [...(byCode.get(i.code) ?? []), i])
  const stageByCode = new Map(config.stages.map((s) => [s.code, s]))
  const wonStage = config.stages.find((s) => s.role === "won")
  const lostStage = config.stages.find((s) => s.role === "lost")
  const perStage = new Map<string, { create: Set<string>; move: Set<string>; won: Set<string>; lost: Set<string> }>()
  const stageSets = (code: string) => {
    let e = perStage.get(code)
    if (!e) {
      e = { create: new Set(), move: new Set(), won: new Set(), lost: new Set() }
      perStage.set(code, e)
    }
    return e
  }
  const totalSets = { create: new Set<string>(), move: new Set<string>(), won: new Set<string>(), lost: new Set<string>(), pause: new Set<string>(), resume: new Set<string>(), inStage: new Set<string>() }

  const out: FunnelPreviewRule[] = config.rules.map((rule, index) => {
    const list = rule.enabled ? (byCode.get(rule.signal) ?? []) : []
    const topics = new Map<string, (typeof list)[number]>()
    for (const i of list) if (i.topicId && !topics.has(i.topicId)) topics.set(i.topicId, i)
    const acting = [...topics.values()].filter((i) => (rule.effect === "create_deal" ? !i.dealId : !!i.dealId))
    for (const i of acting) {
      const t = i.topicId!
      switch (rule.effect) {
        case "create_deal":
          totalSets.create.add(t)
          if (rule.stage) stageSets(rule.stage).create.add(t)
          break
        case "move_stage":
          totalSets.move.add(t)
          if (rule.stage) stageSets(rule.stage).move.add(t)
          break
        case "outcome_won":
          totalSets.won.add(t)
          if (wonStage) stageSets(wonStage.code).won.add(t)
          break
        case "outcome_lost":
          totalSets.lost.add(t)
          if (lostStage) stageSets(lostStage.code).lost.add(t)
          break
        case "pause":
          totalSets.pause.add(t)
          break
        case "resume":
          totalSets.resume.add(t)
          break
        case "in_stage":
          totalSets.inStage.add(t)
          break
      }
    }
    return {
      index,
      ruleId: rule.id ?? null,
      signal: rule.signal,
      effect: rule.effect,
      stage: rule.stage,
      instances: list.length,
      topics: topics.size,
      wouldAct: acting.length,
      examples: acting.slice(0, 3).map((i) => ({
        topicId: i.topicId!,
        topicTitle: i.topicTitle,
        company: i.company ?? null,
        date: i.createdAt.toISOString(),
      })),
    }
  })

  return {
    days: FUNNEL_PREVIEW_DAYS,
    since: since.toISOString(),
    rules: out,
    stages: config.stages.map((s) => {
      const e = perStage.get(s.code)
      return {
        code: s.code,
        name: stageByCode.get(s.code)?.name ?? s.name,
        role: s.role,
        create: e?.create.size ?? 0,
        move: e?.move.size ?? 0,
        won: e?.won.size ?? 0,
        lost: e?.lost.size ?? 0,
      }
    }),
    totals: {
      create: totalSets.create.size,
      move: totalSets.move.size,
      won: totalSets.won.size,
      lost: totalSets.lost.size,
      pause: totalSets.pause.size,
      resume: totalSets.resume.size,
      inStage: totalSets.inStage.size,
    },
    issues: [],
  }
}

// ── Templates (platform reference data, spec §3.7) ────────────────────────

export type FunnelTemplateSummary = { code: string; labelRu: string; description: string | null }

export async function listFunnelTemplates(): Promise<FunnelTemplateSummary[]> {
  return db
    .select({ code: funnelTemplate.code, labelRu: funnelTemplate.labelRu, description: funnelTemplate.description })
    .from(funnelTemplate)
    .where(eq(funnelTemplate.isActive, true))
    .orderBy(asc(funnelTemplate.sort), asc(funnelTemplate.code))
}

/**
 * A template as a DRAFT config (nothing written): ids removed, so on save
 * its stages / types match the org's by CODE (else they are new) and its
 * rules are new rows. Null when the template does not exist / is broken.
 */
export async function getFunnelTemplateConfig(code: string): Promise<FunnelConfig | null> {
  const [row] = await db
    .select({ config: funnelTemplate.config })
    .from(funnelTemplate)
    .where(and(eq(funnelTemplate.code, code), eq(funnelTemplate.isActive, true)))
  if (!row) return null
  const parsed = funnelConfigSchema.safeParse(row.config)
  if (!parsed.success) {
    console.error(`[funnel-config] template ${code} is not a valid FunnelConfig`, parsed.error.issues.slice(0, 5))
    return null
  }
  const c = parsed.data
  return {
    ...c,
    stages: c.stages.map(({ id: _id, ...s }) => (void _id, s)),
    dealTypes: c.dealTypes.map(({ id: _id, ...t }) => (void _id, t)),
    rules: c.rules.map(({ id: _id, ...r }) => (void _id, r)),
  }
}

// ── Catalog for the rule editor ───────────────────────────────────────────

export type FunnelCatalogEntry = { code: string; labelRu: string; family: string; cls: string | null }

/** Active codes of the org's effective registry (spec §3.7: owners pick from the catalog). */
export async function listFunnelSignalCatalog(orgId: string): Promise<FunnelCatalogEntry[]> {
  const [effective, reg] = await Promise.all([getEffectiveSignals(orgId), getRegistry()])
  const active = new Set(effective.filter((e) => e.active).map((e) => e.code))
  return reg.categories
    .filter((c) => active.has(c.code) && !c.retiredAt)
    .map((c) => ({ code: c.code, labelRu: c.labelRu, family: c.family, cls: c.class }))
    .sort((a, b) => a.code.localeCompare(b.code))
}

// ── Session wrappers (API) ────────────────────────────────────────────────

export type FunnelView = {
  config: FunnelConfig
  /** Deal count per stage id (every status). */
  stagesUsage: Record<string, number>
  catalog: FunnelCatalogEntry[]
  templates: FunnelTemplateSummary[]
  canManage: boolean
}

async function sessionOrg(): Promise<{ orgId: string; userId: string; isOwner: boolean }> {
  const session = await getServerSession()
  if (!session) throw new FunnelConfigError("Нет доступа", "unauthorized")
  const orgId = session.session.activeOrganizationId
  if (!orgId) throw new FunnelConfigError("Не выбрана организация", "unauthorized")
  const role = await getActiveOrgRole()
  return { orgId, userId: session.user.id, isOwner: !!role && role.organizationId === orgId && role.role === "owner" }
}

async function requireOwner(): Promise<{ orgId: string; userId: string }> {
  const s = await sessionOrg()
  if (!s.isOwner) throw new FunnelConfigError("Воронку может менять только владелец организации", "forbidden")
  return s
}

/** GET /api/deals/funnel — any member reads. */
export async function getFunnelViewForSession(): Promise<FunnelView> {
  const { orgId, isOwner } = await sessionOrg()
  const [config, stagesUsage, catalog, templates] = await Promise.all([
    getFunnelConfig(orgId),
    countDealsByStage(orgId),
    listFunnelSignalCatalog(orgId),
    listFunnelTemplates(),
  ])
  return { config, stagesUsage, catalog, templates, canManage: isOwner }
}

/** PUT /api/deals/funnel — org owner. */
export async function applyFunnelConfigForSession(raw: unknown): Promise<ApplyFunnelResult> {
  const { orgId, userId } = await requireOwner()
  return applyFunnelConfig(orgId, raw, userId)
}

/** POST /api/deals/funnel { action: "preview" } — org owner. */
export async function previewFunnelRulesForSession(raw: unknown): Promise<FunnelPreviewResult> {
  const { orgId } = await requireOwner()
  return previewFunnelRules(orgId, raw)
}

/** POST /api/deals/funnel { action: "template" } — org owner. */
export async function getFunnelTemplateForSession(code: string): Promise<FunnelConfig> {
  await requireOwner()
  const c = await getFunnelTemplateConfig(code)
  if (!c) throw new FunnelConfigError("Шаблон не найден", "not_found")
  return c
}

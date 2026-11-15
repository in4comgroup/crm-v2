import "server-only"

import { randomUUID } from "node:crypto"
import { and, eq } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"
import { db } from "@/db/drizzle"
import {
  dealRiskStageGuard,
  dealRiskType,
  organizationSignalOverride,
  organizationSignalPack,
  signalAttribute,
  signalBlock,
  signalCategory,
  signalPack,
  signalPackOverride,
  signalRegistryChange,
  signalRelation,
  signalStageRule,
  signalTaxonomyVersion,
} from "@/db/schema"
import type {
  OrganizationSignalOverrideRecord,
  OrganizationSignalPackRecord,
  SignalRegistryEntity,
  SignalsCopyStageRulesRequest,
  SignalsRegistryResponse,
  SignalsSaveRequest,
  SignalsValidationError,
  SignalStageRuleRecord,
  StageRuleGuards,
} from "@/lib/signals/types"
import {
  getCurrentVersion,
  getOrganizationName,
  getOrgFunnelStages,
  invalidateSignalsCache,
  loadOrgRows,
  loadRegistry,
  type OrgSignalRows,
} from "@/server/signals/registry"
import { getSignalPreset } from "@/server/signals/presets"
import {
  checkAttributeRules,
  checkBlockRules,
  checkCategoryRules,
  checkDeleteRules,
  checkOrgOverrideRules,
  checkOrgPackRules,
  checkPackOverrideRules,
  checkRelationRules,
  checkRiskGuardRules,
  checkRiskTypeRules,
  checkStageRuleRules,
  parseEntityRecord,
  type EntityRecordMap,
  type OrgStateForRules,
  type RegistryState,
  type ValidationResult,
} from "@/server/signals/validation"

// Signals registry — writes (05 §7 validation, §9 change process).
//
// One accepted save = one new `signal_taxonomy_version` row (max + 1) plus
// one `signal_registry_change` row per changed entity (before / after JSON).
//
// Atomicity: neon-http has no interactive transactions, so a save first
// reads and validates (fresh rows, never the cache), then sends ALL writes
// in ONE `db.batch([...])`. Neon runs a batch as a single non-interactive
// transaction: either every statement commits or none does. Statement order
// inside the batch is still "entity rows → version row → change rows", so
// even without the batch guarantee the version row would be written only
// after the entity rows. Two concurrent saves compute the same next version;
// the second batch fails on the version primary key and rolls back as a
// whole — we then re-read and retry (MAX_ATTEMPTS). The read-validate-write
// window is not locked: a concurrent save of the SAME record may be lost
// (last write wins) — acceptable for a single-admin editor.

const MAX_ATTEMPTS = 3

export type SaveResult =
  | { version: number; warnings?: SignalsValidationError[] }
  | { errors: SignalsValidationError[] }

type Batch = [BatchItem<"pg">, ...BatchItem<"pg">[]]

export type RegistryChangeRow = ChangeRow

type ChangeRow = {
  entity: SignalRegistryEntity
  entityKey: string
  organizationId: string | null
  action: "create" | "update" | "delete"
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
}

const ORG_ENTITIES = new Set<SignalRegistryEntity>(["org_pack", "org_override", "risk_guard"])
const ENTITIES = new Set<SignalRegistryEntity>([
  "pack",
  "block",
  "category",
  "attribute",
  "relation",
  "pack_override",
  "org_pack",
  "org_override",
  "stage_rule",
  "risk_type",
  "risk_guard",
])

const ENTITY_LABEL_RU: Record<SignalRegistryEntity, string> = {
  pack: "пакет",
  block: "блок",
  category: "код",
  attribute: "атрибут",
  relation: "связь",
  pack_override: "переопределение пакета",
  org_pack: "пакет организации",
  org_override: "настройка кода для организации",
  stage_rule: "правило стадии",
  risk_type: "тип риска",
  risk_guard: "стадии риска для организации",
}

const ACTION_LABEL_RU = { create: "Создание", update: "Изменение", delete: "Удаление" } as const

function isUniqueVersionConflict(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.message} ${String((err as { cause?: unknown }).cause ?? "")}` : String(err)
  return msg.includes("signal_taxonomy_version_pkey")
}

/**
 * Write the entity statements + version row + change rows in one batch
 * (one transaction). Retries with a fresh version number on a version
 * primary-key conflict.
 */
async function commit(
  statements: BatchItem<"pg">[],
  changes: ChangeRow[],
  summary: string,
  userId: string,
): Promise<number> {
  for (let attempt = 1; ; attempt++) {
    const version = (await getCurrentVersion()) + 1
    const now = new Date()
    const batch: BatchItem<"pg">[] = [
      ...statements,
      db.insert(signalTaxonomyVersion).values({ version, createdByUserId: userId, summary, createdAt: now }),
    ]
    if (changes.length > 0) {
      batch.push(
        db.insert(signalRegistryChange).values(
          changes.map((c) => ({
            id: randomUUID(),
            version,
            entity: c.entity,
            entityKey: c.entityKey,
            organizationId: c.organizationId,
            action: c.action,
            before: c.before,
            after: c.after,
            changedByUserId: userId,
            changedAt: now,
          })),
        ),
      )
    }
    try {
      await db.batch(batch as unknown as Batch)
      invalidateSignalsCache()
      return version
    } catch (err) {
      if (attempt < MAX_ATTEMPTS && isUniqueVersionConflict(err)) continue
      throw err
    }
  }
}

/**
 * Other modules' registry writes (custom funnel: the owner's stage rules,
 * src/server/funnel-config.ts): the caller's statements + one new taxonomy
 * version + the change rows, in ONE batch (same retry as `commit`).
 */
export async function commitRegistryBatch(
  statements: BatchItem<"pg">[],
  changes: RegistryChangeRow[],
  summary: string,
  userId: string,
): Promise<number> {
  return commit(statements, changes, summary, userId)
}

// ── key helpers ───────────────────────────────────────────────────────────

/** Primary key of a record, as stored in `signal_registry_change.entity_key`. */
function keyOf(entity: SignalRegistryEntity, r: Record<string, unknown>): string {
  switch (entity) {
    case "pack":
    case "block":
    case "category":
    case "attribute":
    case "risk_type":
      return String(r.code ?? "")
    case "relation":
    case "stage_rule":
      return String(r.id ?? "")
    case "pack_override":
      return `${String(r.packCode ?? "")}:${String(r.code ?? "")}`
    case "org_pack":
      return String(r.packCode ?? "")
    case "org_override":
      return String(r.code ?? "")
    case "risk_guard":
      return String(r.riskCode ?? "")
  }
}

/** Fields that make up the key (an update may not change them). */
const KEY_FIELDS: Record<SignalRegistryEntity, string[]> = {
  pack: ["code"],
  block: ["code"],
  category: ["code"],
  attribute: ["code"],
  risk_type: ["code"],
  relation: ["id"],
  stage_rule: ["id", "organizationId"],
  pack_override: ["packCode", "code"],
  org_pack: ["organizationId", "packCode"],
  org_override: ["organizationId", "code"],
  risk_guard: ["organizationId", "riskCode"],
}

function findBefore(
  entity: SignalRegistryEntity,
  key: string,
  reg: SignalsRegistryResponse,
  org: OrgSignalRows | null,
): Record<string, unknown> | null {
  const find = <T>(list: T[], pred: (x: T) => boolean) => (list.find(pred) as Record<string, unknown> | undefined) ?? null
  switch (entity) {
    case "pack":
      return find(reg.packs, (x) => x.code === key)
    case "block":
      return find(reg.blocks, (x) => x.code === key)
    case "category": {
      const c = reg.categories.find((x) => x.code === key)
      if (!c) return null
      const { updatedAt: _ignored, ...rest } = c
      void _ignored
      return rest
    }
    case "attribute":
      return find(reg.attributes, (x) => x.code === key)
    case "relation":
      return find(reg.relations, (x) => x.id === key)
    case "pack_override":
      return find(reg.packOverrides, (x) => `${x.packCode}:${x.code}` === key)
    case "risk_type":
      return find(reg.riskTypes, (x) => x.code === key)
    case "stage_rule":
      return org ? find(org.stageRules, (x) => x.id === key) : find(reg.stageRuleTemplates, (x) => x.id === key)
    case "org_pack":
      return org ? find(org.packs, (x) => x.packCode === key) : null
    case "org_override":
      return org ? find(org.overrides, (x) => x.code === key) : null
    case "risk_guard":
      return org ? find(org.riskGuards, (x) => x.riskCode === key) : null
  }
}

/** The registry state with the change applied (for the cross-record rules). */
function applyToState(
  entity: SignalRegistryEntity,
  key: string,
  record: Record<string, unknown> | null,
  reg: SignalsRegistryResponse,
): RegistryState {
  const replace = <T>(list: T[], match: (x: T) => boolean): T[] => {
    const rest = list.filter((x) => !match(x))
    return record ? [...rest, record as T] : rest
  }
  const s: RegistryState = { ...reg }
  switch (entity) {
    case "pack":
      s.packs = replace(reg.packs, (x) => x.code === key)
      break
    case "block":
      s.blocks = replace(reg.blocks, (x) => x.code === key)
      break
    case "category":
      s.categories = replace(reg.categories, (x) => x.code === key)
      break
    case "attribute":
      s.attributes = replace(reg.attributes, (x) => x.code === key)
      break
    case "relation":
      s.relations = replace(reg.relations, (x) => x.id === key)
      break
    case "pack_override":
      s.packOverrides = replace(reg.packOverrides, (x) => `${x.packCode}:${x.code}` === key)
      break
    case "risk_type":
      s.riskTypes = replace(reg.riskTypes, (x) => x.code === key)
      break
    default:
      break // org-scoped rows are not part of the platform state
  }
  return s
}

function runRules(
  entity: SignalRegistryEntity,
  record: Record<string, unknown>,
  rawData: Record<string, unknown> | undefined,
  state: RegistryState,
  org: OrgStateForRules | null,
): ValidationResult {
  const r = record as never
  switch (entity) {
    case "pack":
      return { errors: [], warnings: [] }
    case "block":
      return checkBlockRules(r, state)
    case "category":
      return checkCategoryRules(r, state)
    case "attribute":
      return checkAttributeRules(r, state)
    case "relation":
      return checkRelationRules(r, state)
    case "pack_override":
      return checkPackOverrideRules(r, state)
    case "org_pack":
      return checkOrgPackRules(r, state)
    case "org_override":
      return checkOrgOverrideRules(r, rawData, state)
    case "stage_rule":
      return checkStageRuleRules(r, state, org)
    case "risk_type":
      return checkRiskTypeRules(r, state)
    case "risk_guard":
      return checkRiskGuardRules(r, state, org)
  }
}

// ── DB statements per entity ──────────────────────────────────────────────

function writeStatement(
  entity: SignalRegistryEntity,
  action: "create" | "update" | "delete",
  key: string,
  rec: Record<string, unknown>,
  organizationId: string | null,
  userId: string,
): BatchItem<"pg"> {
  switch (entity) {
    case "pack": {
      const r = rec as EntityRecordMap["pack"]
      if (action === "delete") return db.delete(signalPack).where(eq(signalPack.code, key))
      if (action === "create") return db.insert(signalPack).values(r)
      return db.update(signalPack).set(r).where(eq(signalPack.code, key))
    }
    case "block": {
      const r = rec as EntityRecordMap["block"]
      if (action === "delete") return db.delete(signalBlock).where(eq(signalBlock.code, key))
      if (action === "create") return db.insert(signalBlock).values(r)
      return db.update(signalBlock).set(r).where(eq(signalBlock.code, key))
    }
    case "category": {
      const r = rec as EntityRecordMap["category"]
      const values = {
        ...r,
        retiredAt: r.retiredAt ? new Date(r.retiredAt) : null,
        updatedByUserId: userId,
      }
      if (action === "create") return db.insert(signalCategory).values(values)
      // Categories are never deleted (retire instead); saveRegistryEntity refuses earlier.
      return db
        .update(signalCategory)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(signalCategory.code, key))
    }
    case "attribute": {
      const r = rec as EntityRecordMap["attribute"]
      if (action === "delete") return db.delete(signalAttribute).where(eq(signalAttribute.code, key))
      if (action === "create") return db.insert(signalAttribute).values(r)
      return db.update(signalAttribute).set(r).where(eq(signalAttribute.code, key))
    }
    case "relation": {
      const r = rec as EntityRecordMap["relation"]
      if (action === "delete") return db.delete(signalRelation).where(eq(signalRelation.id, key))
      if (action === "create") return db.insert(signalRelation).values(r)
      return db.update(signalRelation).set(r).where(eq(signalRelation.id, key))
    }
    case "pack_override": {
      const r = rec as EntityRecordMap["pack_override"]
      const where = and(eq(signalPackOverride.packCode, r.packCode), eq(signalPackOverride.code, r.code))
      if (action === "delete") return db.delete(signalPackOverride).where(where)
      if (action === "create") return db.insert(signalPackOverride).values(r)
      return db.update(signalPackOverride).set(r).where(where)
    }
    case "org_pack": {
      const r = rec as EntityRecordMap["org_pack"]
      const where = and(
        eq(organizationSignalPack.organizationId, organizationId!),
        eq(organizationSignalPack.packCode, r.packCode),
      )
      if (action === "delete") return db.delete(organizationSignalPack).where(where)
      if (action === "create") return db.insert(organizationSignalPack).values(r)
      return db.update(organizationSignalPack).set({ enabled: r.enabled, updatedAt: new Date() }).where(where)
    }
    case "org_override": {
      const r = rec as EntityRecordMap["org_override"]
      const where = and(
        eq(organizationSignalOverride.organizationId, organizationId!),
        eq(organizationSignalOverride.code, r.code),
      )
      if (action === "delete") return db.delete(organizationSignalOverride).where(where)
      if (action === "create") return db.insert(organizationSignalOverride).values(r)
      return db
        .update(organizationSignalOverride)
        .set({ ...r, updatedAt: new Date() })
        .where(where)
    }
    case "stage_rule": {
      const r = rec as EntityRecordMap["stage_rule"]
      const values = { ...r, guards: r.guards as Record<string, unknown> }
      if (action === "delete") return db.delete(signalStageRule).where(eq(signalStageRule.id, key))
      if (action === "create") return db.insert(signalStageRule).values(values)
      return db
        .update(signalStageRule)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(signalStageRule.id, key))
    }
    case "risk_type": {
      const r = rec as EntityRecordMap["risk_type"]
      if (action === "delete") return db.delete(dealRiskType).where(eq(dealRiskType.code, key))
      if (action === "create") return db.insert(dealRiskType).values(r)
      return db
        .update(dealRiskType)
        .set({ ...r, updatedAt: new Date() })
        .where(eq(dealRiskType.code, key))
    }
    case "risk_guard": {
      const r = rec as EntityRecordMap["risk_guard"]
      const where = and(
        eq(dealRiskStageGuard.organizationId, organizationId!),
        eq(dealRiskStageGuard.riskCode, r.riskCode),
      )
      if (action === "delete") return db.delete(dealRiskStageGuard).where(where)
      if (action === "create") return db.insert(dealRiskStageGuard).values(r)
      return db
        .update(dealRiskStageGuard)
        .set({ enabled: r.enabled, stageIds: r.stageIds, updatedAt: new Date() })
        .where(where)
    }
  }
}

/** JSON with sorted object keys: jsonb reorders keys, so plain JSON.stringify can't compare. */
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`
  if (v && typeof v === "object") {
    return `{${Object.keys(v)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`)
      .join(",")}}`
  }
  return JSON.stringify(v ?? null)
}

function changedFields(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...keys].filter((k) => stableJson(before[k]) !== stableJson(after[k]))
}

// ── public: one entity save ───────────────────────────────────────────────

/**
 * Validate and apply one create / update / delete (PUT /api/admin/signals).
 * Returns `{ errors }` (nothing written) or `{ version }` (+ warnings).
 * An update that changes nothing writes nothing and returns the current
 * version.
 */
export async function saveRegistryEntity(req: SignalsSaveRequest, userId: string): Promise<SaveResult> {
  const err = (field: string, message: string): SaveResult => ({ errors: [{ field, message }] })

  if (!req || !ENTITIES.has(req.entity)) return err("entity", "Неизвестный тип записи")
  if (!["create", "update", "delete"].includes(req.action)) return err("action", "Неизвестное действие")
  const { entity, action } = req
  const data = req.data && typeof req.data === "object" && !Array.isArray(req.data) ? req.data : undefined

  // Org scope: org_* / risk_guard always; stage_rule when organizationId is
  // given (null / absent = a pack template).
  const organizationId = ORG_ENTITIES.has(entity) || entity === "stage_rule" ? (req.organizationId ?? null) : null
  if (ORG_ENTITIES.has(entity) && !organizationId) return err("organizationId", "Не выбрана организация")
  let orgName: string | null = null
  if (organizationId) {
    const org = await getOrganizationName(organizationId)
    if (!org) return err("organizationId", "Организация не найдена")
    orgName = org.name
  }

  const [reg, orgRows, stages] = await Promise.all([
    loadRegistry(),
    organizationId ? loadOrgRows(organizationId) : Promise.resolve(null),
    organizationId && (entity === "stage_rule" || entity === "risk_guard")
      ? getOrgFunnelStages(organizationId)
      : Promise.resolve(null),
  ])
  const orgState: OrgStateForRules | null =
    organizationId && stages ? { organizationId, stageIds: new Set(stages.map((s) => s.id)) } : null

  // ── build the would-be record ──
  let key = (req.key ?? "").trim()
  let before: Record<string, unknown> | null = null
  let after: Record<string, unknown> | null = null

  if (action === "create") {
    if (!data) return err("data", "Нет данных записи")
    const input: Record<string, unknown> = { ...data }
    if (ORG_ENTITIES.has(entity) || entity === "stage_rule") input.organizationId = organizationId
    if (entity === "category") {
      // A new code never starts retired; retire via update.
      input.retiredAt = null
      input.successorCode = null
    }
    if (entity === "relation" && !input.id) {
      input.id = `rel:${String(input.kind ?? "")}:${String(input.codeA ?? "")}:${String(input.codeB ?? "")}`
    }
    if (entity === "stage_rule" && !input.id) input.id = randomUUID()
    const parsed = parseEntityRecord(entity, input)
    if (!parsed.ok) return { errors: parsed.errors }
    after = parsed.record as Record<string, unknown>
    key = keyOf(entity, after)
    if (findBefore(entity, key, reg, orgRows)) {
      return err(KEY_FIELDS[entity].at(-1) ?? "key", `Запись ${key} уже существует`)
    }
  } else {
    if (!key) return err("key", "Не указан ключ записи")
    before = findBefore(entity, key, reg, orgRows)
    if (!before) return err("key", `Запись ${key} не найдена`)
    if (action === "delete") {
      if (entity === "category") {
        return err(
          "key",
          "Коды не удаляются: выведите код из обращения (дата вывода и код-преемник), чтобы сохранить историю",
        )
      }
    } else {
      if (!data) return err("data", "Нет данных записи")
      for (const f of KEY_FIELDS[entity]) {
        if (f in data && data[f] !== before[f] && !(f === "organizationId" && data[f] === organizationId)) {
          return err(f, "Ключевое поле нельзя изменить; создайте новую запись")
        }
      }
      const merged = { ...before, ...data }
      for (const f of KEY_FIELDS[entity]) merged[f] = before[f]
      const parsed = parseEntityRecord(entity, merged)
      if (!parsed.ok) return { errors: parsed.errors }
      after = parsed.record as Record<string, unknown>
    }
  }

  // ── cross-record rules (05 §7) ──
  const state = applyToState(entity, key, after, reg)
  const result: ValidationResult =
    action === "delete"
      ? checkDeleteRules(entity, key, reg)
      : runRules(entity, after!, data, state, orgState)
  if (action === "delete" && entity === "risk_type") {
    // FK from deal_risk_stage_guard (any org).
    const guarded = await db
      .select({ org: dealRiskStageGuard.organizationId })
      .from(dealRiskStageGuard)
      .where(eq(dealRiskStageGuard.riskCode, key))
      .limit(1)
    if (guarded.length > 0) {
      result.errors.push({ field: "key", message: "Нельзя удалить: тип риска настроен у организаций (стадии риска)" })
    }
  }
  if (result.errors.length > 0) return { errors: result.errors }

  // ── no-op update ──
  if (action === "update" && changedFields(before!, after!).length === 0) {
    return { version: reg.version, warnings: result.warnings }
  }

  const statement = writeStatement(entity, action, key, (after ?? before)!, organizationId, userId)
  const fields = action === "update" ? changedFields(before!, after!) : []
  const summary =
    req.summary?.trim() ||
    `${ACTION_LABEL_RU[action]}: ${ENTITY_LABEL_RU[entity]} ${key}` +
      (fields.length ? ` (${fields.join(", ")})` : "") +
      (orgName ? ` — организация «${orgName}»` : "")

  const version = await commit(
    [statement],
    [{ entity, entityKey: key, organizationId, action, before, after }],
    summary,
    userId,
  )
  return result.warnings.length ? { version, warnings: result.warnings } : { version }
}

// ── public: activation preset ─────────────────────────────────────────────

export type ApplyPresetResult =
  | { version: number; changed: number; skipped: string[]; warnings?: SignalsValidationError[] }
  | { errors: SignalsValidationError[] }

/**
 * Apply an activation preset to one org (R6):
 *   packs: the preset's packs → enabled; other packs the org has → disabled;
 *   codes: on → stage active; review → stage onHold + reviewOnly;
 *          off → stage onHold. Weight / profile / recipient / note of an
 *          existing org override are kept. Codes the preset does not list
 *          keep their current setting.
 * One version; one change row per changed org_pack / org_override row.
 * Unknown codes are skipped and returned in `skipped`; unknown packs and
 * rule-1 failures (an «on» code without texts) refuse the whole preset.
 */
export async function applyPreset(organizationId: string, presetKey: string, userId: string): Promise<ApplyPresetResult> {
  const preset = getSignalPreset(presetKey)
  if (!preset) return { errors: [{ field: "preset", message: `Пресет ${presetKey} не найден` }] }
  const org = await getOrganizationName(organizationId)
  if (!org) return { errors: [{ field: "organizationId", message: "Организация не найдена" }] }

  const [reg, rows] = await Promise.all([loadRegistry(), loadOrgRows(organizationId)])
  const errors: SignalsValidationError[] = []
  const warnings: SignalsValidationError[] = []
  const statements: BatchItem<"pg">[] = []
  const changes: ChangeRow[] = []
  const skipped: string[] = []

  // Packs.
  const knownPacks = new Set(reg.packs.map((p) => p.code))
  for (const p of preset.packs) {
    if (!knownPacks.has(p)) errors.push({ field: `packs.${p}`, message: `Пакет ${p} не существует` })
  }
  const wanted = new Set(preset.packs)
  const orgPacks = new Map(rows.packs.map((p) => [p.packCode, p]))
  for (const packCode of new Set([...preset.packs, ...orgPacks.keys()])) {
    if (!knownPacks.has(packCode)) continue
    const cur = orgPacks.get(packCode) ?? null
    const enabled = wanted.has(packCode)
    if (cur ? cur.enabled === enabled : !enabled) continue
    const next: OrganizationSignalPackRecord = { organizationId, packCode, enabled }
    statements.push(
      db
        .insert(organizationSignalPack)
        .values(next)
        .onConflictDoUpdate({
          target: [organizationSignalPack.organizationId, organizationSignalPack.packCode],
          set: { enabled, updatedAt: new Date() },
        }),
    )
    changes.push({
      entity: "org_pack",
      entityKey: packCode,
      organizationId,
      action: cur ? "update" : "create",
      before: cur,
      after: next,
    })
  }

  // Codes.
  const cats = new Set(reg.categories.map((c) => c.code))
  const overrides = new Map(rows.overrides.map((o) => [o.code, o]))
  for (const [code, mode] of Object.entries(preset.codes)) {
    if (!cats.has(code)) {
      skipped.push(code)
      continue
    }
    const cur = overrides.get(code) ?? null
    const next: OrganizationSignalOverrideRecord = {
      organizationId,
      code,
      stage: mode === "on" ? "active" : "onHold",
      weight: cur?.weight ?? null,
      displayProfile: cur?.displayProfile ?? null,
      recipientRole: cur?.recipientRole ?? null,
      reviewOnly: mode === "review",
      noteRu: cur?.noteRu ?? null,
    }
    if (cur && cur.stage === next.stage && cur.reviewOnly === next.reviewOnly) continue
    const check = checkOrgOverrideRules(next, undefined, reg)
    check.errors.forEach((e) => errors.push({ field: `codes.${code}`, message: e.message }))
    check.warnings.forEach((e) => warnings.push({ field: `codes.${code}`, message: e.message }))
    statements.push(
      db
        .insert(organizationSignalOverride)
        .values(next)
        .onConflictDoUpdate({
          target: [organizationSignalOverride.organizationId, organizationSignalOverride.code],
          set: { stage: next.stage, reviewOnly: next.reviewOnly, updatedAt: new Date() },
        }),
    )
    changes.push({
      entity: "org_override",
      entityKey: code,
      organizationId,
      action: cur ? "update" : "create",
      before: cur,
      after: next,
    })
  }

  if (errors.length > 0) return { errors }
  if (statements.length === 0) {
    return { version: reg.version, changed: 0, skipped, ...(warnings.length ? { warnings } : {}) }
  }
  const nOrgPacks = changes.filter((c) => c.entity === "org_pack").length
  const summary =
    `Пресет «${preset.labelRu}» применён к организации «${org.name}»: ` +
    `пакетов изменено ${nOrgPacks}, кодов ${changes.length - nOrgPacks}`
  const version = await commit(statements, changes, summary, userId)
  return { version, changed: changes.length, skipped, ...(warnings.length ? { warnings } : {}) }
}

// ── public: copy stage-rule templates ─────────────────────────────────────

export type CopyStageRulesResult =
  | {
      version: number
      created: number
      skipped: { templateId: string; code: string; reason: string }[]
    }
  | { errors: SignalsValidationError[] }

/**
 * Copy a pack's stage-rule templates (organization_id NULL) to an org
 * (05 §5, spec §9.2). `stageMap` maps stage meanings (S1…S5, won, lost) to
 * the org's stage ids; `targetStageMeaning` → `targetStageId` and
 * `guards.fromStageMeanings` → `guards.fromStageIds`. A template whose
 * target or from-stage meaning is unmapped is skipped and reported. Copies
 * get the id `<orgId>:<templateId>`, so a second copy skips templates that
 * were already copied instead of duplicating them.
 */
export async function copyStageRuleTemplates(
  organizationId: string,
  packCode: string,
  stageMap: SignalsCopyStageRulesRequest["stageMap"],
  userId: string,
): Promise<CopyStageRulesResult> {
  const org = await getOrganizationName(organizationId)
  if (!org) return { errors: [{ field: "organizationId", message: "Организация не найдена" }] }
  const [reg, rows, stages] = await Promise.all([
    loadRegistry(),
    loadOrgRows(organizationId),
    getOrgFunnelStages(organizationId),
  ])
  if (!reg.packs.some((p) => p.code === packCode)) {
    return { errors: [{ field: "packCode", message: `Пакет ${packCode} не существует` }] }
  }
  const stageIds = new Set(stages.map((s) => s.id))
  const errors: SignalsValidationError[] = []
  for (const [meaning, id] of Object.entries(stageMap ?? {})) {
    if (id && !stageIds.has(id)) {
      errors.push({ field: `stageMap.${meaning}`, message: "Стадия не принадлежит воронке организации" })
    }
  }
  if (errors.length > 0) return { errors }

  const map = (m: string): string | undefined => (stageMap as Record<string, string | undefined>)[m] || undefined
  const existing = new Set(rows.stageRules.map((r) => r.id))
  const cats = new Map(reg.categories.map((c) => [c.code, c]))
  const created: SignalStageRuleRecord[] = []
  const skipped: { templateId: string; code: string; reason: string }[] = []

  for (const t of reg.stageRuleTemplates.filter((x) => x.packCode === packCode)) {
    const id = `${organizationId}:${t.id}`
    const skip = (reason: string) => skipped.push({ templateId: t.id, code: t.code, reason })
    if (existing.has(id)) {
      skip("уже скопировано")
      continue
    }
    if (!cats.has(t.code)) {
      skip(`код ${t.code} не существует`)
      continue
    }
    let targetStageId: string | null = null
    if (t.targetStageMeaning) {
      targetStageId = map(t.targetStageMeaning) ?? null
      if (!targetStageId) {
        skip(`целевая стадия ${t.targetStageMeaning} не сопоставлена`)
        continue
      }
    }
    const { fromStageMeanings, ...restGuards } = t.guards ?? {}
    const guards: StageRuleGuards = { ...restGuards }
    if (fromStageMeanings?.length) {
      const ids = fromStageMeanings.map(map)
      const missing = fromStageMeanings.filter((_, i) => !ids[i])
      if (missing.length > 0) {
        skip(`исходные стадии ${missing.join(", ")} не сопоставлены`)
        continue
      }
      guards.fromStageIds = ids as string[]
    }
    created.push({
      id,
      organizationId,
      packCode,
      code: t.code,
      effect: t.effect,
      targetStageId,
      targetStageMeaning: t.targetStageMeaning,
      dealTypes: t.dealTypes,
      guards,
      enabled: t.enabled,
      sort: t.sort,
      noteRu: t.noteRu,
    })
  }

  if (created.length === 0) return { version: reg.version, created: 0, skipped }
  const statements: BatchItem<"pg">[] = [
    db
      .insert(signalStageRule)
      .values(created.map((r) => ({ ...r, guards: r.guards as Record<string, unknown> }))),
  ]
  const changes: ChangeRow[] = created.map((r) => ({
    entity: "stage_rule",
    entityKey: r.id,
    organizationId,
    action: "create",
    before: null,
    after: r as unknown as Record<string, unknown>,
  }))
  const summary = `Скопированы правила стадий пакета ${packCode} в организацию «${org.name}»: ${created.length}`
  const version = await commit(statements, changes, summary, userId)
  return { version, created: created.length, skipped }
}

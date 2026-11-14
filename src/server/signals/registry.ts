import "server-only"

import { and, asc, count, desc, eq, inArray, isNull, max } from "drizzle-orm"
import { db } from "@/db/drizzle"
import {
  dealFunnelStage,
  dealRiskStageGuard,
  dealRiskType,
  organization,
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
  user,
} from "@/db/schema"
import type {
  DealRiskStageGuardRecord,
  DealRiskTypeRecord,
  DisplayProfile,
  EffectiveSignal,
  OrganizationSignalOverrideRecord,
  OrganizationSignalPackRecord,
  RecipientRole,
  RelationKind,
  SignalAttributeRecord,
  SignalBlockRecord,
  SignalCategoryRecord,
  SignalClass,
  SignalEffort,
  SignalEmittedBy,
  SignalKind,
  SignalPackOverrideRecord,
  SignalPackRecord,
  SignalRegistryEntity,
  SignalRelationRecord,
  SignalScoreRule,
  SignalStage,
  SignalStageRuleRecord,
  SignalsHistoryResponse,
  SignalsOrgResponse,
  SignalsOrgsResponse,
  SignalsRegistryResponse,
  StageRuleEffect,
  StageRuleGuards,
} from "@/lib/signals/types"
import { SIGNAL_PRESETS } from "@/server/signals/presets"

// Signals registry — reads (docs/specs/topics/05-signals-registry.md).
// Org-explicit and session-free: callers (admin routes, the topics engine)
// pass the org id. Platform-admin gating happens in the routes.
//
// Cache: one in-memory snapshot of the platform registry and one
// EffectiveSignal[] per org, kept on globalThis (so every route chunk shares
// it), invalidated by every save in this process (`invalidateSignalsCache`)
// and expired after CACHE_TTL_MS so other server instances pick up a save
// within a minute. Saves validate against a FRESH load, never the cache.

const CACHE_TTL_MS = 60_000

type Cache = {
  registry: { at: number; value: SignalsRegistryResponse } | null
  effective: Map<string, { at: number; value: EffectiveSignal[] }>
}

const g = globalThis as unknown as { __signalsRegistryCache?: Cache }
const cache: Cache = (g.__signalsRegistryCache ??= { registry: null, effective: new Map() })

export function invalidateSignalsCache() {
  cache.registry = null
  cache.effective.clear()
}

export class SignalsOrgNotFoundError extends Error {
  constructor(public organizationId: string) {
    super(`Organization ${organizationId} not found`)
    this.name = "SignalsOrgNotFoundError"
  }
}

// ── row → record mappers ──────────────────────────────────────────────────

type Row<T extends { $inferSelect: unknown }> = T["$inferSelect"]

const iso = (d: Date | null) => (d ? d.toISOString() : null)

export function toPackRecord(r: Row<typeof signalPack>): SignalPackRecord {
  return { code: r.code, labelRu: r.labelRu, descriptionRu: r.descriptionRu, sort: r.sort }
}

export function toBlockRecord(r: Row<typeof signalBlock>): SignalBlockRecord {
  return {
    code: r.code,
    packCode: r.packCode,
    labelRu: r.labelRu,
    audience: r.audience,
    internalOnly: r.internalOnly,
    firstPartyOnly: r.firstPartyOnly,
    sort: r.sort,
  }
}

export function toCategoryRecord(r: Row<typeof signalCategory>): SignalCategoryRecord {
  return {
    code: r.code,
    packCode: r.packCode,
    blockCode: r.blockCode,
    family: r.family,
    labelRu: r.labelRu,
    definitionRu: r.definitionRu,
    boundaryRu: r.boundaryRu,
    cuesPromptRu: r.cuesPromptRu ?? [],
    synonymsRu: r.synonymsRu ?? {},
    antiCuesRu: r.antiCuesRu ?? [],
    exampleRu: r.exampleRu,
    counterExampleRu: r.counterExampleRu,
    cardNoteRu: r.cardNoteRu,
    weight: r.weight,
    scoreRule: r.scoreRule as SignalScoreRule,
    class: r.class as SignalClass | null,
    classByRelation: r.classByRelation,
    kind: r.kind as SignalKind,
    effort: r.effort as SignalEffort | null,
    carriesAmount: r.carriesAmount,
    asksUs: r.asksUs,
    inboundOnly: r.inboundOnly,
    emittedBy: r.emittedBy as SignalEmittedBy,
    stage: r.stage as SignalStage,
    displayProfile: r.displayProfile as DisplayProfile | null,
    recipientRole: r.recipientRole as RecipientRole | null,
    closesCodes: r.closesCodes ?? [],
    dateGate: r.dateGate ?? null,
    relevanceDays: r.relevanceDays,
    triggerRule: r.triggerRule ?? null,
    noteRu: r.noteRu,
    retiredAt: iso(r.retiredAt),
    successorCode: r.successorCode,
    updatedAt: r.updatedAt.toISOString(),
  }
}

export function toAttributeRecord(r: Row<typeof signalAttribute>): SignalAttributeRecord {
  return {
    code: r.code,
    packCode: r.packCode,
    groupCode: r.groupCode,
    scope: r.scope as SignalAttributeRecord["scope"],
    labelRu: r.labelRu,
    definitionRu: r.definitionRu,
    weight: r.weight,
    stage: r.stage as SignalStage,
    defaultOff: r.defaultOff,
    profiles: r.profiles ?? [],
    cuesRu: r.cuesRu ?? [],
    antiCuesRu: r.antiCuesRu ?? [],
    noteRu: r.noteRu,
    sort: r.sort,
  }
}

export function toRelationRecord(r: Row<typeof signalRelation>): SignalRelationRecord {
  return {
    id: r.id,
    packCode: r.packCode,
    kind: r.kind as RelationKind,
    codeA: r.codeA,
    codeB: r.codeB,
    settingKey: r.settingKey,
    fact: r.fact,
    noteRu: r.noteRu,
  }
}

export function toPackOverrideRecord(r: Row<typeof signalPackOverride>): SignalPackOverrideRecord {
  return {
    packCode: r.packCode,
    code: r.code,
    weight: r.weight,
    displayProfile: r.displayProfile as DisplayProfile | null,
    recipientRole: r.recipientRole as RecipientRole | null,
    stage: r.stage as SignalStage | null,
    closesCodes: r.closesCodes ?? null,
    noteRu: r.noteRu,
  }
}

export function toOrgPackRecord(r: Row<typeof organizationSignalPack>): OrganizationSignalPackRecord {
  return { organizationId: r.organizationId, packCode: r.packCode, enabled: r.enabled }
}

export function toOrgOverrideRecord(r: Row<typeof organizationSignalOverride>): OrganizationSignalOverrideRecord {
  return {
    organizationId: r.organizationId,
    code: r.code,
    stage: r.stage as SignalStage | null,
    weight: r.weight,
    displayProfile: r.displayProfile as DisplayProfile | null,
    recipientRole: r.recipientRole as RecipientRole | null,
    reviewOnly: r.reviewOnly,
    noteRu: r.noteRu,
  }
}

export function toStageRuleRecord(r: Row<typeof signalStageRule>): SignalStageRuleRecord {
  return {
    id: r.id,
    organizationId: r.organizationId,
    packCode: r.packCode,
    code: r.code,
    effect: r.effect as StageRuleEffect,
    targetStageId: r.targetStageId,
    targetStageMeaning: r.targetStageMeaning,
    dealTypes: r.dealTypes ?? [],
    guards: (r.guards ?? {}) as StageRuleGuards,
    enabled: r.enabled,
    sort: r.sort,
    noteRu: r.noteRu,
  }
}

export function toRiskTypeRecord(r: Row<typeof dealRiskType>): DealRiskTypeRecord {
  return {
    code: r.code,
    packCode: r.packCode,
    labelRu: r.labelRu,
    descriptionRu: r.descriptionRu,
    explanationRu: r.explanationRu,
    triggerCodes: r.triggerCodes ?? [],
    clearCodes: r.clearCodes ?? [],
    severity: r.severity,
    minOccurrences: r.minOccurrences,
    condition: r.condition,
    scope: r.scope === "client" ? "client" : "deal",
    reactionRole: r.reactionRole,
    stageGuardTemplate: r.stageGuardTemplate,
    noteRu: r.noteRu,
    enabled: r.enabled,
  }
}

export function toRiskGuardRecord(r: Row<typeof dealRiskStageGuard>): DealRiskStageGuardRecord {
  return { organizationId: r.organizationId, riskCode: r.riskCode, enabled: r.enabled, stageIds: r.stageIds ?? null }
}

// ── platform registry ─────────────────────────────────────────────────────

/** Current taxonomy version (0 = no version row yet). */
export async function getCurrentVersion(): Promise<number> {
  const [row] = await db.select({ v: max(signalTaxonomyVersion.version) }).from(signalTaxonomyVersion)
  return row?.v ?? 0
}

/** Uncached full load of the platform registry. */
export async function loadRegistry(): Promise<SignalsRegistryResponse> {
  const [version, packs, blocks, categories, attributes, relations, packOverrides, riskTypes, templates] =
    await Promise.all([
      getCurrentVersion(),
      db.select().from(signalPack).orderBy(asc(signalPack.sort), asc(signalPack.code)),
      db.select().from(signalBlock).orderBy(asc(signalBlock.sort), asc(signalBlock.code)),
      db.select().from(signalCategory),
      db.select().from(signalAttribute).orderBy(asc(signalAttribute.sort), asc(signalAttribute.code)),
      db.select().from(signalRelation).orderBy(asc(signalRelation.id)),
      db.select().from(signalPackOverride).orderBy(asc(signalPackOverride.packCode), asc(signalPackOverride.code)),
      db.select().from(dealRiskType).orderBy(asc(dealRiskType.packCode), asc(dealRiskType.code)),
      db
        .select()
        .from(signalStageRule)
        .where(isNull(signalStageRule.organizationId))
        .orderBy(asc(signalStageRule.packCode), asc(signalStageRule.sort), asc(signalStageRule.id)),
    ])

  const packRecords = packs.map(toPackRecord)
  const blockRecords = blocks.map(toBlockRecord)
  return {
    version,
    packs: packRecords,
    blocks: blockRecords,
    categories: sortCategories(categories.map(toCategoryRecord), packRecords, blockRecords),
    attributes: attributes.map(toAttributeRecord),
    relations: relations.map(toRelationRecord),
    packOverrides: packOverrides.map(toPackOverrideRecord),
    riskTypes: riskTypes.map(toRiskTypeRecord),
    stageRuleTemplates: templates.map(toStageRuleRecord),
  }
}

/** Pack sort → block sort → weight desc → code (the 05a table order). */
function sortCategories(
  cats: SignalCategoryRecord[],
  packs: SignalPackRecord[],
  blocks: SignalBlockRecord[],
): SignalCategoryRecord[] {
  const packSort = new Map(packs.map((p, i) => [p.code, i]))
  const blockSort = new Map(blocks.map((b, i) => [b.code, i]))
  return [...cats].sort(
    (a, b) =>
      (packSort.get(a.packCode) ?? 999) - (packSort.get(b.packCode) ?? 999) ||
      (blockSort.get(a.blockCode) ?? 999) - (blockSort.get(b.blockCode) ?? 999) ||
      b.weight - a.weight ||
      a.code.localeCompare(b.code),
  )
}

/** Platform registry (cached ≤ 60 s, invalidated on save). */
export async function getRegistry(): Promise<SignalsRegistryResponse> {
  const hit = cache.registry
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value
  const value = await loadRegistry()
  cache.registry = { at: Date.now(), value }
  return value
}

// ── per org ───────────────────────────────────────────────────────────────

export type OrgSignalRows = {
  packs: OrganizationSignalPackRecord[]
  overrides: OrganizationSignalOverrideRecord[]
  stageRules: SignalStageRuleRecord[]
  riskGuards: DealRiskStageGuardRecord[]
}

/** Uncached load of one org's registry rows. */
export async function loadOrgRows(organizationId: string): Promise<OrgSignalRows> {
  const [packs, overrides, stageRules, riskGuards] = await Promise.all([
    db.select().from(organizationSignalPack).where(eq(organizationSignalPack.organizationId, organizationId)),
    db
      .select()
      .from(organizationSignalOverride)
      .where(eq(organizationSignalOverride.organizationId, organizationId))
      .orderBy(asc(organizationSignalOverride.code)),
    db
      .select()
      .from(signalStageRule)
      .where(eq(signalStageRule.organizationId, organizationId))
      .orderBy(asc(signalStageRule.sort), asc(signalStageRule.code), asc(signalStageRule.id)),
    db
      .select()
      .from(dealRiskStageGuard)
      .where(eq(dealRiskStageGuard.organizationId, organizationId))
      .orderBy(asc(dealRiskStageGuard.riskCode)),
  ])
  return {
    packs: packs.map(toOrgPackRecord),
    overrides: overrides.map(toOrgOverrideRecord),
    stageRules: stageRules.map(toStageRuleRecord),
    riskGuards: riskGuards.map(toRiskGuardRecord),
  }
}

/**
 * Effective parameters of every code for one org (05 §5):
 *   pack enabled for the org (organization_signal_pack.enabled);
 *   stage / weight / profile / recipient = org override ?? pack override ?? base;
 *   closes_codes = pack override ?? base (org may not override, R12);
 *   active = pack enabled AND stage = active AND not retired;
 *   inPrompt = active AND not reviewOnly AND emittedBy ≠ process (05 §6:
 *     process codes — incl. state codes the CRM emits itself — and
 *     review / onHold / parked codes are never in the live prompt).
 *
 * Pack overrides count only from packs ENABLED for the org. When several
 * enabled packs override the same code, the pack with the highest `sort`
 * (the most specific vertical) wins. Retired codes are kept in the list
 * (active = false) so the UI can show them.
 */
export function computeEffectiveSignals(
  registry: Pick<SignalsRegistryResponse, "packs" | "categories" | "packOverrides">,
  orgPacks: OrganizationSignalPackRecord[],
  orgOverrides: OrganizationSignalOverrideRecord[],
): EffectiveSignal[] {
  const enabled = new Set(orgPacks.filter((p) => p.enabled).map((p) => p.packCode))
  const packSort = new Map(registry.packs.map((p) => [p.code, p.sort]))
  const packOv = new Map<string, SignalPackOverrideRecord>()
  for (const o of registry.packOverrides) {
    if (!enabled.has(o.packCode)) continue
    const cur = packOv.get(o.code)
    if (!cur || (packSort.get(o.packCode) ?? 0) >= (packSort.get(cur.packCode) ?? 0)) packOv.set(o.code, o)
  }
  const orgOv = new Map(orgOverrides.map((o) => [o.code, o]))

  return registry.categories.map((c) => {
    const po = packOv.get(c.code)
    const oo = orgOv.get(c.code)
    const source: EffectiveSignal["source"] = {}
    const pick = <K extends "stage" | "weight" | "displayProfile" | "recipientRole">(
      key: K,
      base: SignalCategoryRecord[K],
    ): SignalCategoryRecord[K] => {
      const orgV = oo?.[key] as SignalCategoryRecord[K] | null | undefined
      if (orgV !== null && orgV !== undefined) {
        source[key] = "org"
        return orgV
      }
      const packV = po?.[key] as SignalCategoryRecord[K] | null | undefined
      if (packV !== null && packV !== undefined) {
        source[key] = "pack"
        return packV
      }
      source[key] = "base"
      return base
    }
    const stage = pick("stage", c.stage)
    const weight = pick("weight", c.weight)
    const displayProfile = pick("displayProfile", c.displayProfile)
    const recipientRole = pick("recipientRole", c.recipientRole)
    let closesCodes = c.closesCodes
    if (po?.closesCodes) {
      closesCodes = po.closesCodes
      source.closesCodes = "pack"
    } else source.closesCodes = "base"

    const reviewOnly = oo?.reviewOnly ?? false
    const active = enabled.has(c.packCode) && stage === "active" && !c.retiredAt
    return {
      code: c.code,
      packCode: c.packCode,
      blockCode: c.blockCode,
      active,
      reviewOnly,
      stage,
      weight,
      displayProfile,
      recipientRole,
      closesCodes,
      inPrompt: active && !reviewOnly && c.emittedBy !== "process",
      source,
    }
  })
}

/**
 * Effective signals of one org for the engine (topics prompt builder,
 * attention). Cached per org ≤ 60 s, invalidated on save.
 */
export async function getEffectiveSignals(organizationId: string): Promise<EffectiveSignal[]> {
  const hit = cache.effective.get(organizationId)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value
  const [registry, packs, overrides] = await Promise.all([
    getRegistry(),
    db.select().from(organizationSignalPack).where(eq(organizationSignalPack.organizationId, organizationId)),
    db.select().from(organizationSignalOverride).where(eq(organizationSignalOverride.organizationId, organizationId)),
  ])
  const value = computeEffectiveSignals(registry, packs.map(toOrgPackRecord), overrides.map(toOrgOverrideRecord))
  cache.effective.set(organizationId, { at: Date.now(), value })
  return value
}

/**
 * The org's funnel stages, org-or-system (same rule as `listDealFunnelStages`
 * in src/server/deals.ts, which is session-bound): active org-owned rows if
 * any exist, else the active system rows.
 */
export async function getOrgFunnelStages(organizationId: string): Promise<SignalsOrgResponse["funnelStages"]> {
  const cols = {
    id: dealFunnelStage.id,
    name: dealFunnelStage.name,
    displayName: dealFunnelStage.displayName,
    sortOrder: dealFunnelStage.sortOrder,
    isHidden: dealFunnelStage.isHidden,
  }
  const orgRows = await db
    .select(cols)
    .from(dealFunnelStage)
    .where(
      and(
        eq(dealFunnelStage.isActive, true),
        eq(dealFunnelStage.isSystem, false),
        eq(dealFunnelStage.ownerOrganizationId, organizationId),
      ),
    )
    .orderBy(asc(dealFunnelStage.sortOrder), asc(dealFunnelStage.name))
  if (orgRows.length > 0) return orgRows
  return db
    .select(cols)
    .from(dealFunnelStage)
    .where(and(eq(dealFunnelStage.isActive, true), eq(dealFunnelStage.isSystem, true)))
    .orderBy(asc(dealFunnelStage.sortOrder), asc(dealFunnelStage.name))
}

export async function getOrganizationName(organizationId: string): Promise<{ name: string; slug: string } | null> {
  const [row] = await db
    .select({ name: organization.name, slug: organization.slug })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1)
  return row ?? null
}

export function listPresetSummaries(): SignalsOrgResponse["presets"] {
  return SIGNAL_PRESETS.map((p) => ({
    key: p.key,
    labelRu: p.labelRu,
    descriptionRu: p.descriptionRu,
  }))
}

/** Everything the «Сигналы» tab shows for one org. Throws SignalsOrgNotFoundError. */
export async function getOrgRegistry(organizationId: string): Promise<SignalsOrgResponse> {
  const org = await getOrganizationName(organizationId)
  if (!org) throw new SignalsOrgNotFoundError(organizationId)
  const [registry, rows, funnelStages] = await Promise.all([
    getRegistry(),
    loadOrgRows(organizationId),
    getOrgFunnelStages(organizationId),
  ])
  return {
    organizationId,
    organizationName: org.name,
    packs: rows.packs,
    overrides: rows.overrides,
    stageRules: rows.stageRules,
    riskGuards: rows.riskGuards,
    effective: computeEffectiveSignals(registry, rows.packs, rows.overrides),
    funnelStages,
    presets: listPresetSummaries(),
  }
}

/** Orgs for the selector: enabled packs + number of active codes. */
export async function listOrgsForSignals(): Promise<SignalsOrgsResponse> {
  const [registry, orgs, packs, overrides] = await Promise.all([
    getRegistry(),
    db.select({ id: organization.id, name: organization.name }).from(organization),
    db.select().from(organizationSignalPack),
    db.select().from(organizationSignalOverride),
  ])
  const packsByOrg = new Map<string, OrganizationSignalPackRecord[]>()
  for (const p of packs) {
    const list = packsByOrg.get(p.organizationId) ?? []
    list.push(toOrgPackRecord(p))
    packsByOrg.set(p.organizationId, list)
  }
  const ovByOrg = new Map<string, OrganizationSignalOverrideRecord[]>()
  for (const o of overrides) {
    const list = ovByOrg.get(o.organizationId) ?? []
    list.push(toOrgOverrideRecord(o))
    ovByOrg.set(o.organizationId, list)
  }
  const packSort = new Map(registry.packs.map((p) => [p.code, p.sort]))
  return {
    orgs: orgs
      .map((o) => {
        const orgPacks = packsByOrg.get(o.id) ?? []
        const effective = orgPacks.some((p) => p.enabled)
          ? computeEffectiveSignals(registry, orgPacks, ovByOrg.get(o.id) ?? [])
          : []
        return {
          id: o.id,
          name: o.name,
          packsEnabled: orgPacks
            .filter((p) => p.enabled)
            .map((p) => p.packCode)
            .sort((a, b) => (packSort.get(a) ?? 0) - (packSort.get(b) ?? 0)),
          activeCodes: effective.filter((e) => e.active).length,
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name, "ru")),
  }
}

/**
 * One page of taxonomy versions with their change rows, newest first:
 * `limit` (1–200, default 20) versions after skipping `offset`. `total` =
 * all versions (for the pager).
 */
export async function getHistory(limit = 20, offset = 0): Promise<SignalsHistoryResponse> {
  const n = Math.min(Math.max(Math.trunc(limit) || 20, 1), 200)
  const skip = Math.max(Math.trunc(offset) || 0, 0)
  const [{ total }] = await db.select({ total: count() }).from(signalTaxonomyVersion)
  const versions = await db
    .select({
      version: signalTaxonomyVersion.version,
      createdAt: signalTaxonomyVersion.createdAt,
      summary: signalTaxonomyVersion.summary,
      userName: user.name,
      userEmail: user.email,
    })
    .from(signalTaxonomyVersion)
    .leftJoin(user, eq(user.id, signalTaxonomyVersion.createdByUserId))
    .orderBy(desc(signalTaxonomyVersion.version))
    .limit(n)
    .offset(skip)
  if (versions.length === 0) return { total, versions: [] }
  const changes = await db
    .select()
    .from(signalRegistryChange)
    .where(
      inArray(
        signalRegistryChange.version,
        versions.map((v) => v.version),
      ),
    )
    .orderBy(asc(signalRegistryChange.changedAt), asc(signalRegistryChange.id))
  const byVersion = new Map<number, SignalsHistoryResponse["versions"][number]["changes"]>()
  for (const c of changes) {
    const list = byVersion.get(c.version) ?? []
    list.push({
      entity: c.entity as SignalRegistryEntity,
      entityKey: c.entityKey,
      organizationId: c.organizationId,
      action: c.action as "create" | "update" | "delete",
      before: c.before ?? null,
      after: c.after ?? null,
    })
    byVersion.set(c.version, list)
  }
  return {
    total,
    versions: versions.map((v) => ({
      version: v.version,
      createdAt: v.createdAt.toISOString(),
      createdBy: v.userName ?? v.userEmail ?? null,
      summary: v.summary,
      changes: byVersion.get(v.version) ?? [],
    })),
  }
}

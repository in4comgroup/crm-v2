import "server-only"

import { randomUUID } from "node:crypto"
import { desc, eq } from "drizzle-orm"
import { db } from "@/db/drizzle"
import {
  aiGateway,
  aiModel,
  aiProcessAssignment,
  aiProcessAssignmentLog,
  type AiProcessAssignment,
} from "@/db/schema"
import { modelCapabilities, type AiCapability } from "@/lib/ai-capabilities"
import { getGatewayAdapter } from "@/server/ai/gateways"
import {
  AI_PROCESSES,
  getAiProcess,
  type AiProcessDefinition,
} from "@/server/ai/processes"
import type { AiGatewayAdapter, GatewayConfig } from "@/server/ai/types"
import { getPlatformSetting } from "@/server/platform-settings"

// Process → model resolution and compatibility rules
// (docs/specs/models/03-processes-and-model-selection.md §3, §4).
// No session logic here: admin routes check access; the runtime calls
// resolveProcess().

const CACHE_TTL_MS = 60_000

// ── cached registry snapshots ──────────────────────────────────────────

type ModelInfo = {
  modelId: string
  vendor: string | null
  type: string
  isAvailable: boolean
  caps: Set<AiCapability>
  price: ModelPrice
  zdr: string | null
  noTraining: string | null
}

// Admin model policy (docs/specs/models/03-processes-and-model-selection.md §7),
// from platform settings.
export type AiModelPolicy = {
  zdrOnly: boolean
  noTrainingOnly: boolean
  allowedVendors: string[] // empty = all
}

// USD per 1M tokens (web search: per 1,000 requests); null = unknown.
export type ModelPrice = {
  input: number | null
  output: number | null
  cacheRead: number | null
  cacheWrite: number | null
  webSearch: number | null
}

type Snapshot = {
  at: number
  gateways: Map<string, GatewayConfig>
  defaultGatewayId: string | null
  assignments: Map<string, AiProcessAssignment>
  models: Map<string, Map<string, ModelInfo>> // gatewayId → modelId → info
  policy: AiModelPolicy
}

const num = (v: string | null) => (v == null ? null : Number(v))

let snapshot: Snapshot | null = null
let loading: Promise<Snapshot> | null = null

async function loadSnapshot(): Promise<Snapshot> {
  const [gateways, assignments, models, zdrOnly, noTrainingOnly, allowedVendors] = await Promise.all([
    db.select().from(aiGateway),
    db.select().from(aiProcessAssignment),
    db
      .select({
        gatewayId: aiModel.gatewayId,
        modelId: aiModel.modelId,
        vendor: aiModel.vendor,
        type: aiModel.type,
        isAvailable: aiModel.isAvailable,
        toolCall: aiModel.toolCall,
        structuredOutput: aiModel.structuredOutput,
        webSearch: aiModel.webSearch,
        reasoning: aiModel.reasoning,
        inputModalities: aiModel.inputModalities,
        costInput: aiModel.costInput,
        costOutput: aiModel.costOutput,
        costCacheRead: aiModel.costCacheRead,
        costCacheWrite: aiModel.costCacheWrite,
        costWebSearch: aiModel.costWebSearch,
        zdr: aiModel.zdr,
        noTraining: aiModel.noTraining,
      })
      .from(aiModel),
    getPlatformSetting("ai.policy.zdr_only"),
    getPlatformSetting("ai.policy.no_training_only"),
    getPlatformSetting("ai.policy.allowed_vendors"),
  ])
  const byGateway = new Map<string, Map<string, ModelInfo>>()
  for (const m of models) {
    let g = byGateway.get(m.gatewayId)
    if (!g) byGateway.set(m.gatewayId, (g = new Map()))
    g.set(m.modelId, {
      modelId: m.modelId,
      vendor: m.vendor,
      type: m.type,
      isAvailable: m.isAvailable,
      caps: new Set(modelCapabilities(m)),
      price: {
        input: num(m.costInput),
        output: num(m.costOutput),
        cacheRead: num(m.costCacheRead),
        cacheWrite: num(m.costCacheWrite),
        webSearch: num(m.costWebSearch),
      },
      zdr: m.zdr,
      noTraining: m.noTraining,
    })
  }
  return {
    at: Date.now(),
    gateways: new Map(gateways.map((g) => [g.id, g])),
    defaultGatewayId:
      gateways.find((g) => g.isDefault && g.isEnabled)?.id ??
      gateways.find((g) => g.isEnabled)?.id ??
      null,
    assignments: new Map(assignments.map((a) => [a.processKey, a])),
    models: byGateway,
    policy: { zdrOnly, noTrainingOnly, allowedVendors },
  }
}

async function getSnapshot(): Promise<Snapshot> {
  if (snapshot && Date.now() - snapshot.at < CACHE_TTL_MS) return snapshot
  if (!loading) {
    loading = loadSnapshot()
      .then((s) => (snapshot = s))
      .finally(() => (loading = null))
  }
  return loading
}

// Registry prices of one model (cached), for the usage cost estimate.
export async function getModelPrice(
  gatewayId: string,
  modelId: string,
): Promise<ModelPrice | null> {
  const s = await getSnapshot()
  return s.models.get(gatewayId)?.get(modelId)?.price ?? null
}

// Call after any change to assignments (this instance; others refresh
// within CACHE_TTL_MS).
export function invalidateAiRegistryCache() {
  snapshot = null
}

// ── compatibility (03 §3) ──────────────────────────────────────────────

export type Incompatibility =
  | { reason: "unknown_model" }
  | { reason: "unavailable" }
  | { reason: "not_language" }
  | { reason: "missing_capability"; capability: AiCapability }
  | { reason: "no_vendor_tool"; capability: AiCapability }
  | { reason: "policy_zdr" }
  | { reason: "policy_no_training" }
  | { reason: "policy_vendor" }

/** Rule 5 of 03 §3: the admin model policy. null = compliant. */
function checkPolicy(
  model: ModelInfo,
  adapter: AiGatewayAdapter,
  policy: AiModelPolicy,
): Incompatibility | null {
  // With privacy routing the gateway can pick compliant providers of a
  // partly compliant model ("some"); without it the model must be "all".
  const ok = (v: string | null) => v === "all" || (adapter.privacyRouting && v === "some")
  if (policy.zdrOnly && !ok(model.zdr)) return { reason: "policy_zdr" }
  if (policy.noTrainingOnly && !ok(model.noTraining)) return { reason: "policy_no_training" }
  if (
    policy.allowedVendors.length > 0 &&
    !policy.allowedVendors.includes(model.vendor ?? model.modelId.split("/")[0])
  ) {
    return { reason: "policy_vendor" }
  }
  return null
}

function checkCompatible(
  process: AiProcessDefinition,
  model: ModelInfo | undefined,
  adapter: AiGatewayAdapter,
  policy: AiModelPolicy,
): Incompatibility | null {
  if (!model) return { reason: "unknown_model" }
  if (!model.isAvailable) return { reason: "unavailable" }
  if (model.type !== "language") return { reason: "not_language" }
  const policyProblem = checkPolicy(model, adapter, policy)
  if (policyProblem) return policyProblem
  for (const cap of process.requires) {
    if (cap === "web_search") {
      // Needs a vendor tool the adapter can supply for this model.
      if (!adapter.capabilityTools("web_search", model)) {
        return { reason: "no_vendor_tool", capability: cap }
      }
      continue
    }
    if (!model.caps.has(cap)) return { reason: "missing_capability", capability: cap }
  }
  return null
}

// ── resolution (03 §4) ─────────────────────────────────────────────────

export type ResolvedProcess = {
  process: AiProcessDefinition
  gateway: GatewayConfig
  adapter: AiGatewayAdapter
  modelId: string
  vendor: string | null
  fallbackModelIds: string[]
  // Admin call settings of the process (applied when the caller sets none).
  assignmentSettings?: { maxOutputTokens?: number; temperature?: number }
  // Admin model policy flags to pass to the gateway on every call.
  privacy: { zeroDataRetention: boolean; noPromptTraining: boolean }
  // Set when the runtime had to deviate from the admin's choice.
  warning?: string
}

export class AiProcessResolutionError extends Error {}
export class AiPolicyError extends AiProcessResolutionError {}

/**
 * Resolve a process to a gateway + model + fallbacks.
 * Order: requested model (only for user-selectable processes, only from the
 * allowed list) → assignment primary → assignment fallbacks → code default.
 * The first compatible candidate wins; the rest (compatible) are fallbacks.
 * Before the first catalog sync (empty registry) the candidates are used
 * unchecked, so a fresh DB still works.
 */
export async function resolveProcess(
  processKey: string,
  requestedModelId?: string | null,
): Promise<ResolvedProcess> {
  const process = getAiProcess(processKey)
  if (!process) throw new AiProcessResolutionError(`Unknown AI process: ${processKey}`)

  const s = await getSnapshot()
  const assignment = s.assignments.get(processKey)
  const gatewayId = assignment?.gatewayId ?? s.defaultGatewayId
  const gateway = gatewayId ? s.gateways.get(gatewayId) : undefined
  if (!gateway || !gateway.isEnabled) {
    throw new AiProcessResolutionError(`No enabled AI gateway for process ${processKey}`)
  }
  const adapter = getGatewayAdapter(gateway.adapter)
  const models = s.models.get(gateway.id) ?? new Map<string, ModelInfo>()
  const registryEmpty = models.size === 0

  const candidates: string[] = []
  if (requestedModelId && process.userSelectable) {
    const allowed = allowedModelIdsOf(process, assignment)
    if (allowed.includes(requestedModelId)) candidates.push(requestedModelId)
  }
  if (assignment) candidates.push(assignment.primaryModelId, ...assignment.fallbackModelIds)
  candidates.push(process.defaultModelId)

  const usable = [...new Set(candidates)].filter(
    (id) => registryEmpty || !checkCompatible(process, models.get(id), adapter, s.policy),
  )
  // Nothing compatible at all: run on the code default, unchecked, rather
  // than fail the business call — unless the default breaks the admin
  // model policy: a privacy / vendor rule is never bypassed silently.
  if (!usable.length && !registryEmpty) {
    const def = models.get(process.defaultModelId)
    if (def && checkPolicy(def, adapter, s.policy)) {
      throw new AiPolicyError(
        `No model of process ${processKey} meets the AI model policy (/settings → «Процессы ИИ»)`,
      )
    }
  }
  const chosen = usable[0] ?? process.defaultModelId
  const intended = candidates[0]
  const warning =
    chosen !== intended
      ? `process ${processKey}: ${intended} not usable, using ${chosen}`
      : undefined
  if (warning) console.warn(`[ai] ${warning}`)

  return {
    process,
    gateway,
    adapter,
    modelId: chosen,
    vendor: models.get(chosen)?.vendor ?? chosen.split("/")[0] ?? null,
    fallbackModelIds: usable.filter((id) => id !== chosen).slice(0, 3),
    assignmentSettings: assignment?.settings,
    privacy: {
      zeroDataRetention: s.policy.zdrOnly,
      noPromptTraining: s.policy.noTrainingOnly,
    },
    warning,
  }
}

function allowedModelIdsOf(
  process: AiProcessDefinition,
  assignment: AiProcessAssignment | undefined,
): string[] {
  if (assignment?.allowedModelIds.length) return assignment.allowedModelIds
  if (assignment) return [assignment.primaryModelId]
  return process.defaultAllowedModelIds ?? [process.defaultModelId]
}

// Models a user may pick for a user-selectable process (chat picker etc.),
// only the compatible + available ones, plus which one is the default.
export async function listUserSelectableModels(processKey: string) {
  const process = getAiProcess(processKey)
  if (!process?.userSelectable) return null
  const s = await getSnapshot()
  const assignment = s.assignments.get(processKey)
  const gatewayId = assignment?.gatewayId ?? s.defaultGatewayId
  const gateway = gatewayId ? s.gateways.get(gatewayId) : undefined
  if (!gateway) return { defaultModelId: process.defaultModelId, modelIds: [] }
  const adapter = getGatewayAdapter(gateway.adapter)
  const models = s.models.get(gateway.id) ?? new Map<string, ModelInfo>()
  const modelIds = allowedModelIdsOf(process, assignment).filter(
    (id) => models.size === 0 || !checkCompatible(process, models.get(id), adapter, s.policy),
  )
  const primary = assignment?.primaryModelId ?? process.defaultModelId
  return {
    gatewayId: gateway.id,
    defaultModelId: modelIds.includes(primary) ? primary : (modelIds[0] ?? primary),
    modelIds,
  }
}

// ── admin view + edit ──────────────────────────────────────────────────

export type ProcessStatus = {
  key: string
  assignment: AiProcessAssignment | null
  gatewayId: string | null
  effectiveModelId: string
  isDefault: boolean
  // Problems with the admin's (or default) choice, for the warning column.
  problems: { modelId: string; problem: Incompatibility }[]
  allowedModelIds: string[]
}

export async function listProcessStatuses(): Promise<ProcessStatus[]> {
  const s = await getSnapshot()
  const out: ProcessStatus[] = []
  for (const p of AI_PROCESSES) {
    const a = s.assignments.get(p.key) ?? null
    const gatewayId = a?.gatewayId ?? s.defaultGatewayId
    const gateway = gatewayId ? s.gateways.get(gatewayId) : undefined
    const problems: ProcessStatus["problems"] = []
    let effective = a?.primaryModelId ?? p.defaultModelId
    if (gateway) {
      const adapter = getGatewayAdapter(gateway.adapter)
      const models = s.models.get(gateway.id) ?? new Map()
      if (models.size > 0) {
        const ids = [...new Set([...(a ? [a.primaryModelId, ...a.fallbackModelIds] : []), p.defaultModelId])]
        for (const id of ids) {
          const problem = checkCompatible(p, models.get(id), adapter, s.policy)
          if (problem) problems.push({ modelId: id, problem })
        }
        effective = ids.find((id) => !problems.some((x) => x.modelId === id)) ?? p.defaultModelId
      }
    }
    out.push({
      key: p.key,
      assignment: a,
      gatewayId: gatewayId ?? null,
      effectiveModelId: effective,
      isDefault: !a,
      problems,
      allowedModelIds: p.userSelectable ? allowedModelIdsOf(p, a ?? undefined) : [],
    })
  }
  return out
}

// Compatible models of a gateway for one process, for the edit dialog.
export async function listCompatibleModelIds(
  processKey: string,
  gatewayId: string,
): Promise<{ compatible: string[]; incompatible: { modelId: string; problem: Incompatibility }[] }> {
  const process = getAiProcess(processKey)
  if (!process) throw new AiProcessResolutionError(`Unknown AI process: ${processKey}`)
  const s = await getSnapshot()
  const gateway = s.gateways.get(gatewayId)
  if (!gateway) throw new AiProcessResolutionError(`Unknown gateway: ${gatewayId}`)
  const adapter = getGatewayAdapter(gateway.adapter)
  const compatible: string[] = []
  const incompatible: { modelId: string; problem: Incompatibility }[] = []
  for (const m of s.models.get(gatewayId)?.values() ?? []) {
    if (m.type !== "language" || !m.isAvailable) continue
    const problem = checkCompatible(process, m, adapter, s.policy)
    if (problem) incompatible.push({ modelId: m.modelId, problem })
    else compatible.push(m.modelId)
  }
  return { compatible, incompatible }
}

export type SaveAssignmentInput = {
  processKey: string
  gatewayId: string
  primaryModelId: string
  fallbackModelIds: string[]
  allowedModelIds: string[]
}

export class AssignmentValidationError extends Error {}

export async function saveProcessAssignment(
  input: SaveAssignmentInput,
  userId: string,
): Promise<void> {
  const process = getAiProcess(input.processKey)
  if (!process) throw new AssignmentValidationError("Неизвестный процесс")
  const fallbacks = [...new Set(input.fallbackModelIds)].filter(
    (id) => id !== input.primaryModelId,
  )
  if (fallbacks.length > 3) throw new AssignmentValidationError("Не больше 3 резервных моделей")
  const allowed = process.userSelectable ? [...new Set(input.allowedModelIds)] : []

  invalidateAiRegistryCache()
  const s = await getSnapshot()
  const gateway = s.gateways.get(input.gatewayId)
  if (!gateway || !gateway.isEnabled) throw new AssignmentValidationError("Шлюз недоступен")
  const adapter = getGatewayAdapter(gateway.adapter)
  const models = s.models.get(gateway.id) ?? new Map()
  for (const id of [input.primaryModelId, ...fallbacks, ...allowed]) {
    const problem = checkCompatible(process, models.get(id), adapter, s.policy)
    if (problem) {
      throw new AssignmentValidationError(`Модель ${id} несовместима с процессом (${problem.reason})`)
    }
  }

  const before = s.assignments.get(input.processKey) ?? null
  const row = {
    processKey: input.processKey,
    gatewayId: input.gatewayId,
    primaryModelId: input.primaryModelId,
    fallbackModelIds: fallbacks,
    allowedModelIds: allowed,
    updatedByUserId: userId,
  }
  await db
    .insert(aiProcessAssignment)
    .values(row)
    .onConflictDoUpdate({ target: aiProcessAssignment.processKey, set: row })
  await db.insert(aiProcessAssignmentLog).values({
    id: randomUUID(),
    processKey: input.processKey,
    changedByUserId: userId,
    before: before ? snapshotOf(before) : null,
    after: snapshotOf(row),
  })
  invalidateAiRegistryCache()
}

// Reset = delete the row; the process runs on its code default again.
export async function resetProcessAssignment(processKey: string, userId: string) {
  if (!getAiProcess(processKey)) throw new AssignmentValidationError("Неизвестный процесс")
  const [before] = await db
    .delete(aiProcessAssignment)
    .where(eq(aiProcessAssignment.processKey, processKey))
    .returning()
  if (before) {
    await db.insert(aiProcessAssignmentLog).values({
      id: randomUUID(),
      processKey,
      changedByUserId: userId,
      before: snapshotOf(before),
      after: null,
    })
  }
  invalidateAiRegistryCache()
}

function snapshotOf(a: Pick<AiProcessAssignment, "gatewayId" | "primaryModelId" | "fallbackModelIds" | "allowedModelIds">) {
  return {
    gatewayId: a.gatewayId,
    primaryModelId: a.primaryModelId,
    fallbackModelIds: a.fallbackModelIds,
    allowedModelIds: a.allowedModelIds,
  }
}

// Recent changes of one process (edit dialog footer).
export async function listAssignmentLog(processKey: string, limit = 10) {
  return db
    .select()
    .from(aiProcessAssignmentLog)
    .where(eq(aiProcessAssignmentLog.processKey, processKey))
    .orderBy(desc(aiProcessAssignmentLog.changedAt))
    .limit(limit)
}

// ── model policy (03 §7) ───────────────────────────────────────────────

export async function getAiModelPolicy(): Promise<AiModelPolicy> {
  return (await getSnapshot()).policy
}

/**
 * Processes that would have NO usable model under a new policy (none of
 * primary, fallbacks or the code default complies). A policy save is
 * refused while this list is not empty, so a privacy rule can never stop
 * a process silently.
 */
export async function processesBlockedByPolicy(policy: AiModelPolicy): Promise<string[]> {
  const s = await getSnapshot()
  const out: string[] = []
  for (const p of AI_PROCESSES) {
    const a = s.assignments.get(p.key)
    const gatewayId = a?.gatewayId ?? s.defaultGatewayId
    const gateway = gatewayId ? s.gateways.get(gatewayId) : undefined
    if (!gateway) continue
    const adapter = getGatewayAdapter(gateway.adapter)
    const models = s.models.get(gateway.id)
    if (!models?.size) continue
    const ids = [...new Set([...(a ? [a.primaryModelId, ...a.fallbackModelIds] : []), p.defaultModelId])]
    if (!ids.some((id) => !checkCompatible(p, models.get(id), adapter, policy))) out.push(p.key)
  }
  return out
}

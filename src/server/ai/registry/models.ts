import "server-only"

import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  sql,
  type SQL,
} from "drizzle-orm"
import { db } from "@/db/drizzle"
import { aiGateway, aiModel, aiModelPriceHistory } from "@/db/schema"
import type { AiCapability } from "@/lib/ai-capabilities"

// Read access to the model registry (docs/specs/models/02-model-registry.md).
// No session logic here: callers (admin API routes) check access.

export type AiModelSort =
  | "name"
  | "vendor"
  | "cost_input"
  | "cost_output"
  | "context"

export type ListAiModelsParams = {
  gatewayId: string
  type?: string | null // null / "all" = every type
  vendors?: string[]
  capabilities?: AiCapability[]
  q?: string
  availableOnly?: boolean
  sort?: AiModelSort
  dir?: "asc" | "desc"
  limit?: number
  offset?: number
}

// Same expression as the trigram index in migrations/0006.
const SEARCH_EXPR = sql`(${aiModel.modelId} || ' ' || ${aiModel.name} || ' ' || coalesce(${aiModel.vendor}, ''))`

function capabilityFilter(cap: AiCapability): SQL {
  switch (cap) {
    case "tools":
      return eq(aiModel.toolCall, true)
    case "structured_output":
      return eq(aiModel.structuredOutput, true)
    case "web_search":
      return eq(aiModel.webSearch, true)
    case "reasoning":
      return eq(aiModel.reasoning, true)
    case "image_input":
      return sql`'image' = ANY(${aiModel.inputModalities})`
    case "pdf_input":
      return sql`'pdf' = ANY(${aiModel.inputModalities})`
    case "audio_input":
      return sql`'audio' = ANY(${aiModel.inputModalities})`
    case "video_input":
      return sql`'video' = ANY(${aiModel.inputModalities})`
  }
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

// Fields for the table view (the drawer loads the full row).
const LIST_COLUMNS = {
  gatewayId: aiModel.gatewayId,
  modelId: aiModel.modelId,
  name: aiModel.name,
  vendor: aiModel.vendor,
  type: aiModel.type,
  limitContext: aiModel.limitContext,
  limitOutput: aiModel.limitOutput,
  costInput: aiModel.costInput,
  costOutput: aiModel.costOutput,
  toolCall: aiModel.toolCall,
  structuredOutput: aiModel.structuredOutput,
  webSearch: aiModel.webSearch,
  reasoning: aiModel.reasoning,
  inputModalities: aiModel.inputModalities,
  zdr: aiModel.zdr,
  status: aiModel.status,
  deprecatedAt: aiModel.deprecatedAt,
  isAvailable: aiModel.isAvailable,
}

type Col = (typeof LIST_COLUMNS)[keyof typeof LIST_COLUMNS]
type ColValue<C extends Col> = C["_"]["notNull"] extends true
  ? C["_"]["data"]
  : C["_"]["data"] | null

export type AiModelListRow = {
  [K in keyof typeof LIST_COLUMNS]: ColValue<(typeof LIST_COLUMNS)[K]>
}

export async function listAiModels(p: ListAiModelsParams) {
  const where: SQL[] = [eq(aiModel.gatewayId, p.gatewayId)]
  if (p.type && p.type !== "all") where.push(eq(aiModel.type, p.type))
  if (p.vendors?.length) where.push(inArray(aiModel.vendor, p.vendors))
  for (const cap of p.capabilities ?? []) where.push(capabilityFilter(cap))
  if (p.availableOnly) where.push(eq(aiModel.isAvailable, true))
  const q = p.q?.trim()
  if (q) {
    for (const word of q.split(/\s+/).slice(0, 5)) {
      where.push(ilike(SEARCH_EXPR, `%${escapeLike(word)}%`))
    }
  }

  const dir = p.dir === "desc" ? desc : asc
  // Models without a price / context sort last in both directions.
  const nulls = sql`NULLS LAST`
  const order: SQL[] = (() => {
    switch (p.sort) {
      case "vendor":
        return [dir(aiModel.vendor), asc(aiModel.name)]
      case "cost_input":
        return [sql`${dir(aiModel.costInput)} ${nulls}`, asc(aiModel.name)]
      case "cost_output":
        return [sql`${dir(aiModel.costOutput)} ${nulls}`, asc(aiModel.name)]
      case "context":
        return [sql`${dir(aiModel.limitContext)} ${nulls}`, asc(aiModel.name)]
      default:
        return [dir(aiModel.name)]
    }
  })()

  const limit = Math.min(Math.max(p.limit ?? 50, 1), 200)
  const offset = Math.max(p.offset ?? 0, 0)
  const cond = and(...where)

  const [rows, [{ total }]] = await Promise.all([
    db
      .select(LIST_COLUMNS)
      .from(aiModel)
      .where(cond)
      .orderBy(...order)
      .limit(limit)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(aiModel).where(cond),
  ])
  return { rows: rows as AiModelListRow[], total }
}

export async function getAiModel(gatewayId: string, modelId: string) {
  const [model] = await db
    .select()
    .from(aiModel)
    .where(and(eq(aiModel.gatewayId, gatewayId), eq(aiModel.modelId, modelId)))
    .limit(1)
  if (!model) return null
  const priceHistory = await db
    .select()
    .from(aiModelPriceHistory)
    .where(
      and(
        eq(aiModelPriceHistory.gatewayId, gatewayId),
        eq(aiModelPriceHistory.modelId, modelId),
      ),
    )
    .orderBy(desc(aiModelPriceHistory.validFrom))
    .limit(20)
  return { model, priceHistory }
}

// Gateways with sync status, for the provider select and the status line.
export async function listAiGateways() {
  return db
    .select({
      id: aiGateway.id,
      name: aiGateway.name,
      adapter: aiGateway.adapter,
      isEnabled: aiGateway.isEnabled,
      isDefault: aiGateway.isDefault,
      catalogSources: aiGateway.catalogSources,
      lastSyncedAt: aiGateway.lastSyncedAt,
      lastSyncError: aiGateway.lastSyncError,
      models: sql<number>`(select count(*)::int from ${aiModel} where ${aiModel.gatewayId} = ${aiGateway.id})`,
    })
    .from(aiGateway)
    .orderBy(desc(aiGateway.isDefault), asc(aiGateway.name))
}

// Filter options for one gateway: types and vendors with counts.
export async function listAiModelFacets(gatewayId: string, type?: string | null) {
  const typeCond =
    type && type !== "all" ? eq(aiModel.type, type) : sql`true`
  const [types, vendors] = await Promise.all([
    db
      .select({ value: aiModel.type, count: sql<number>`count(*)::int` })
      .from(aiModel)
      .where(eq(aiModel.gatewayId, gatewayId))
      .groupBy(aiModel.type)
      .orderBy(desc(sql`count(*)`)),
    db
      .select({ value: aiModel.vendor, count: sql<number>`count(*)::int` })
      .from(aiModel)
      .where(and(eq(aiModel.gatewayId, gatewayId), typeCond))
      .groupBy(aiModel.vendor)
      .orderBy(asc(aiModel.vendor)),
  ])
  return {
    types,
    vendors: vendors.filter((v): v is { value: string; count: number } => !!v.value),
  }
}

// Display names for a set of model ids of one gateway (pickers).
export async function getAiModelNames(gatewayId: string, modelIds: string[]) {
  if (modelIds.length === 0) return new Map<string, { name: string; vendor: string | null }>()
  const rows = await db
    .select({ modelId: aiModel.modelId, name: aiModel.name, vendor: aiModel.vendor })
    .from(aiModel)
    .where(and(eq(aiModel.gatewayId, gatewayId), inArray(aiModel.modelId, modelIds)))
  return new Map(rows.map((r) => [r.modelId, { name: r.name, vendor: r.vendor }]))
}

// Table rows for a set of model ids of one gateway (process edit dialog).
export async function getAiModelRows(gatewayId: string, modelIds: string[]) {
  if (modelIds.length === 0) return [] as AiModelListRow[]
  const rows = await db
    .select(LIST_COLUMNS)
    .from(aiModel)
    .where(and(eq(aiModel.gatewayId, gatewayId), inArray(aiModel.modelId, modelIds)))
    .orderBy(sql`${aiModel.costInput} ASC NULLS LAST`, asc(aiModel.name))
  return rows as AiModelListRow[]
}

// Vendors of available language models (all gateways), for the policy picker.
export async function listAiLanguageVendors(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ vendor: aiModel.vendor })
    .from(aiModel)
    .where(and(eq(aiModel.type, "language"), eq(aiModel.isAvailable, true), sql`${aiModel.vendor} is not null`))
  return rows.map((r) => r.vendor!).sort()
}

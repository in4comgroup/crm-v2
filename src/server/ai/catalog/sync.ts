import "server-only"

import { randomUUID } from "node:crypto"
import { and, eq, getTableColumns, notInArray, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { aiGateway, aiModel, aiModelPriceHistory } from "@/db/schema"
import { getCatalogSource } from "@/server/ai/catalog-sources"
import type { GatewayConfig } from "@/server/ai/types"
import { mergeCatalogs, type MergedModel, type SourceResult } from "./merge"

// Catalog sync (docs/specs/models/02-model-registry.md §5): read every
// catalog source of a gateway, merge, upsert into ai_model, write price
// history, mark vanished models unavailable. Idempotent. Called by the
// daily pipeline and by the «Синхронизировать» (Sync) button.

export type CatalogSyncResult = {
  gatewayId: string
  ok: boolean
  models: number
  inserted: number
  updated: number
  markedUnavailable: number
  priceChanges: number
  // Non-fatal problems (a non-authoritative source failed).
  warnings: string[]
  error?: string
}

const COST_FIELDS = [
  "costInput",
  "costOutput",
  "costCacheRead",
  "costCacheWrite",
  "costWebSearch",
] as const

const UPSERT_CHUNK = 100

const toNumeric = (v: unknown): string | null =>
  typeof v === "number" && Number.isFinite(v) ? v.toFixed(6) : null

function toRow(gatewayId: string, m: MergedModel, now: Date) {
  const f = m.fields
  const str = (v: unknown) => (typeof v === "string" ? v : null)
  const bool = (v: unknown) => (typeof v === "boolean" ? v : null)
  const int = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null
  const arr = (v: unknown) => (Array.isArray(v) ? (v as string[]) : null)
  return {
    gatewayId,
    modelId: m.modelId,
    vendor: str(f.vendor),
    name: str(f.name) ?? m.modelId,
    family: str(f.family),
    description: str(f.description),
    type: str(f.type) ?? "language",
    canonicalModelId: str(f.canonicalModelId),
    attachment: bool(f.attachment),
    reasoning: bool(f.reasoning),
    toolCall: bool(f.toolCall),
    structuredOutput: bool(f.structuredOutput),
    temperature: bool(f.temperature),
    openWeights: bool(f.openWeights),
    webSearch: bool(f.webSearch),
    inputModalities: arr(f.inputModalities),
    outputModalities: arr(f.outputModalities),
    limitContext: int(f.limitContext),
    limitOutput: int(f.limitOutput),
    costInput: toNumeric(f.costInput),
    costOutput: toNumeric(f.costOutput),
    costCacheRead: toNumeric(f.costCacheRead),
    costCacheWrite: toNumeric(f.costCacheWrite),
    costWebSearch: toNumeric(f.costWebSearch),
    costRaw: (f.costRaw as Record<string, unknown> | null | undefined) ?? null,
    knowledge: str(f.knowledge),
    releaseDate: str(f.releaseDate),
    lastUpdated: str(f.lastUpdated),
    status: str(f.status),
    zdr: str(f.zdr),
    noTraining: str(f.noTraining),
    regions: arr(f.regions),
    deprecatedAt: f.deprecatedAt instanceof Date ? f.deprecatedAt : null,
    isAvailable: true,
    fieldSources: m.fieldSources,
    raw: m.raw,
    lastSeenAt: now,
  }
}

type Row = ReturnType<typeof toRow>

// Numeric columns come back from Postgres as strings with scale 6.
const priceKey = (r: Pick<Row, (typeof COST_FIELDS)[number]>) =>
  COST_FIELDS.map((f) => (r[f] == null ? "" : Number(r[f]).toFixed(6))).join("|")

// ON CONFLICT … DO UPDATE SET <every column except the key and first_seen_at>.
const UPDATE_SET = (() => {
  const cols = getTableColumns(aiModel)
  const set: Record<string, ReturnType<typeof sql.raw>> = {}
  for (const [prop, col] of Object.entries(cols)) {
    if (["gatewayId", "modelId", "firstSeenAt"].includes(prop)) continue
    set[prop] = sql.raw(`excluded."${col.name}"`)
  }
  return set
})()

async function readSources(
  gw: GatewayConfig,
): Promise<{ results: SourceResult[]; warnings: string[] }> {
  const keys = gw.catalogSources ?? []
  if (keys.length === 0) throw new Error("Gateway has no catalog sources")
  const warnings: string[] = []
  const results: SourceResult[] = []
  for (const [i, key] of keys.entries()) {
    try {
      const models = await getCatalogSource(key).listModels(gw)
      if (i === 0 && models.length === 0) {
        // Never treat an empty authoritative answer as "all models gone".
        throw new Error("returned no models")
      }
      results.push({ key, models })
    } catch (e) {
      const msg = `${key}: ${e instanceof Error ? e.message : String(e)}`
      if (i === 0) throw new Error(msg)
      warnings.push(msg)
    }
  }
  return { results, warnings }
}

export async function syncModelCatalog(
  gatewayId: string,
): Promise<CatalogSyncResult> {
  const result: CatalogSyncResult = {
    gatewayId,
    ok: false,
    models: 0,
    inserted: 0,
    updated: 0,
    markedUnavailable: 0,
    priceChanges: 0,
    warnings: [],
  }

  const [gw] = await db
    .select()
    .from(aiGateway)
    .where(eq(aiGateway.id, gatewayId))
    .limit(1)
  if (!gw) {
    result.error = `Unknown gateway: ${gatewayId}`
    return result
  }

  try {
    const { results, warnings } = await readSources(gw)
    result.warnings = warnings

    const now = new Date()
    const rows = mergeCatalogs(results).map((m) => toRow(gw.id, m, now))
    result.models = rows.length

    const existing = await db
      .select({
        modelId: aiModel.modelId,
        costInput: aiModel.costInput,
        costOutput: aiModel.costOutput,
        costCacheRead: aiModel.costCacheRead,
        costCacheWrite: aiModel.costCacheWrite,
        costWebSearch: aiModel.costWebSearch,
      })
      .from(aiModel)
      .where(eq(aiModel.gatewayId, gw.id))
    const oldPrice = new Map(existing.map((r) => [r.modelId, priceKey(r)]))

    const history: (typeof aiModelPriceHistory.$inferInsert)[] = []
    for (const r of rows) {
      const before = oldPrice.get(r.modelId)
      if (before === undefined) result.inserted++
      else result.updated++
      if (before !== priceKey(r)) {
        history.push({
          id: randomUUID(),
          gatewayId: gw.id,
          modelId: r.modelId,
          validFrom: now,
          costInput: r.costInput,
          costOutput: r.costOutput,
          costCacheRead: r.costCacheRead,
          costCacheWrite: r.costCacheWrite,
          costWebSearch: r.costWebSearch,
          costRaw: r.costRaw,
        })
      }
    }
    result.priceChanges = history.length

    for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
      await db
        .insert(aiModel)
        .values(rows.slice(i, i + UPSERT_CHUNK))
        .onConflictDoUpdate({
          target: [aiModel.gatewayId, aiModel.modelId],
          set: UPDATE_SET,
        })
    }
    for (let i = 0; i < history.length; i += UPSERT_CHUNK) {
      await db.insert(aiModelPriceHistory).values(history.slice(i, i + UPSERT_CHUNK))
    }

    // Models gone from the authoritative source: keep the row (usage
    // events reference it), flag it unavailable.
    const gone = await db
      .update(aiModel)
      .set({ isAvailable: false })
      .where(
        and(
          eq(aiModel.gatewayId, gw.id),
          eq(aiModel.isAvailable, true),
          notInArray(
            aiModel.modelId,
            rows.map((r) => r.modelId),
          ),
        ),
      )
      .returning({ modelId: aiModel.modelId })
    result.markedUnavailable = gone.length

    await db
      .update(aiGateway)
      .set({
        lastSyncedAt: now,
        lastSyncError: warnings.length ? warnings.join("; ") : null,
      })
      .where(eq(aiGateway.id, gw.id))

    result.ok = true
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e)
    console.error(`[ai/catalog] sync ${gatewayId} failed:`, e)
    await db
      .update(aiGateway)
      .set({ lastSyncError: result.error })
      .where(eq(aiGateway.id, gatewayId))
  }
  return result
}

// Every enabled gateway, one after another. Never throws.
export async function syncAllModelCatalogs(): Promise<CatalogSyncResult[]> {
  const gateways = await db
    .select({ id: aiGateway.id })
    .from(aiGateway)
    .where(eq(aiGateway.isEnabled, true))
  const out: CatalogSyncResult[] = []
  for (const g of gateways) out.push(await syncModelCatalog(g.id))
  return out
}

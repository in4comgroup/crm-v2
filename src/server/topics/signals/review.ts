import "server-only"

import { and, desc, eq, gte, inArray, isNotNull, sql, type SQL } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { signalInstance, source, sourceItem, sourceItemSubject } from "@/db/schema"
import {
  SIGNAL_BANDS,
  SIGNAL_ITEM_STATUSES,
  type SignalBand,
  type SignalItemFacts,
  type SignalItemStatus,
  type SignalReviewItem,
  type SignalSubject,
  type SignalSubjectReference,
} from "@/lib/signals/extraction-types"
import { getRegistry } from "@/server/signals/registry"
import { envelopeFromItem } from "./item-input"
import { countPendingSignalItems, signalHistoryStart } from "./runner"

// Shadow review of the signal extraction (plan phase 2; spec topics/01 §13):
// scanned items of one org with their instances and subjects, plus summary
// stats. Platform-admin surface only (the route checks the role); the org id
// is always explicit.

const DAY_MS = 86_400_000
const TOP_CODES_DAYS = 7
const TOP_CODES_LIMIT = 15

export type SignalReviewFilters = {
  status?: string | null
  band?: string | null
  code?: string | null
  limit: number
  offset: number
}

export type SignalStats = {
  /** Items per signal_status (only statuses that occur). */
  byStatus: Partial<Record<SignalItemStatus, number>>
  /** Skipped items per gate (signal_reason before the first ':'). */
  bySkipReason: Record<string, number>
  /** Done items per band. */
  byBand: Partial<Record<SignalBand, number>>
  /** Counted instances per code, last 7 days. */
  topCodes: { code: string; labelRu: string | null; count: number }[]
  topCodesDays: number
  /** Items the hourly runner would still pick up (0 when never switched on). */
  pending: number
  /** Start of the org's history window (ISO), null = topics never switched on. */
  historyStart: string | null
}

/** Last activity of an item (deferred / failed rows have no scannedAt). */
const activityAt = sql`coalesce(${sourceItem.signalScannedAt}, ${sourceItem.updatedAt})`

function isStatus(v: unknown): v is SignalItemStatus {
  return typeof v === "string" && (SIGNAL_ITEM_STATUSES as readonly string[]).includes(v)
}

function isBand(v: unknown): v is SignalBand {
  return typeof v === "string" && (SIGNAL_BANDS as readonly string[]).includes(v)
}

async function codeLabels(): Promise<Map<string, string>> {
  const registry = await getRegistry()
  return new Map(registry.categories.map((c) => [c.code, c.labelRu]))
}

type BaseRow = {
  id: string
  provider: string | null
  externalType: string
  sourceCreatedAt: Date | null
  orgAttribution: string | null
  metadataJson: unknown
  signalStatus: string | null
  signalReason: string | null
  signalScore: number | null
  signalBand: string | null
  signalFacts: Record<string, unknown> | null
  signalScannedAt: Date | null
  signalTaxonomyVersion: number | null
}

const baseSelect = {
  id: sourceItem.id,
  provider: source.provider,
  externalType: sourceItem.externalType,
  sourceCreatedAt: sourceItem.sourceCreatedAt,
  orgAttribution: sourceItem.orgAttribution,
  metadataJson: sourceItem.metadataJson,
  signalStatus: sourceItem.signalStatus,
  signalReason: sourceItem.signalReason,
  signalScore: sourceItem.signalScore,
  signalBand: sourceItem.signalBand,
  signalFacts: sourceItem.signalFacts,
  signalScannedAt: sourceItem.signalScannedAt,
  signalTaxonomyVersion: sourceItem.signalTaxonomyVersion,
}

/** Attach instances + subjects and shape the rows (order kept). */
async function toReviewItems(rows: BaseRow[]): Promise<SignalReviewItem[]> {
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)
  const [instances, subjects, labels] = await Promise.all([
    db
      .select({
        id: signalInstance.id,
        sourceItemId: signalInstance.sourceItemId,
        code: signalInstance.code,
        evidence: signalInstance.evidence,
        confidence: signalInstance.confidence,
        subjectIndex: signalInstance.subjectIndex,
        counted: signalInstance.counted,
        notCountedReason: signalInstance.notCountedReason,
        scoreContrib: signalInstance.scoreContrib,
      })
      .from(signalInstance)
      .where(inArray(signalInstance.sourceItemId, ids))
      .orderBy(desc(signalInstance.counted), desc(signalInstance.scoreContrib), signalInstance.code),
    db
      .select({
        sourceItemId: sourceItemSubject.sourceItemId,
        subjectIndex: sourceItemSubject.subjectIndex,
        counterparty: sourceItemSubject.counterparty,
        onBehalfOf: sourceItemSubject.onBehalfOf,
        matter: sourceItemSubject.matter,
        references: sourceItemSubject.references,
        products: sourceItemSubject.products,
      })
      .from(sourceItemSubject)
      .where(inArray(sourceItemSubject.sourceItemId, ids))
      .orderBy(sourceItemSubject.subjectIndex),
    codeLabels(),
  ])

  const instByItem = new Map<string, SignalReviewItem["instances"]>()
  for (const i of instances) {
    if (!i.sourceItemId) continue
    const list = instByItem.get(i.sourceItemId) ?? []
    list.push({
      id: i.id,
      code: i.code,
      labelRu: labels.get(i.code) ?? null,
      evidence: i.evidence,
      confidence: i.confidence,
      subjectIndex: i.subjectIndex,
      counted: i.counted,
      notCountedReason: i.notCountedReason,
      scoreContrib: i.scoreContrib,
    })
    instByItem.set(i.sourceItemId, list)
  }
  const subjByItem = new Map<string, SignalSubject[]>()
  for (const s of subjects) {
    const list = subjByItem.get(s.sourceItemId) ?? []
    list.push({
      index: s.subjectIndex,
      counterparty: s.counterparty,
      onBehalfOf: s.onBehalfOf,
      matter: s.matter,
      references: (s.references ?? []) as SignalSubjectReference[],
      products: s.products ?? [],
    })
    subjByItem.set(s.sourceItemId, list)
  }

  return rows.map((r) => {
    const env = envelopeFromItem(r)
    return {
      id: r.id,
      provider: r.provider,
      externalType: r.externalType,
      sourceCreatedAt: r.sourceCreatedAt?.toISOString() ?? null,
      subject: env.subject ?? null,
      from: env.from ?? null,
      status: isStatus(r.signalStatus) ? r.signalStatus : null,
      reason: r.signalReason,
      score: r.signalScore,
      band: isBand(r.signalBand) ? r.signalBand : null,
      scannedAt: r.signalScannedAt?.toISOString() ?? null,
      taxonomyVersion: r.signalTaxonomyVersion,
      facts: (r.signalFacts as SignalItemFacts | null) ?? null,
      instances: instByItem.get(r.id) ?? [],
      subjects: subjByItem.get(r.id) ?? [],
    }
  })
}

/**
 * Scanned items of the org (signal_status set), newest scan first.
 * Filters: status, band, code (items with an instance of that code).
 */
export async function listSignalReviewItems(
  orgId: string,
  filters: SignalReviewFilters,
): Promise<{ rows: SignalReviewItem[]; total: number }> {
  const limit = Math.max(1, Math.min(200, Math.floor(filters.limit) || 50))
  const offset = Math.max(0, Math.floor(filters.offset) || 0)
  const conds: SQL[] = [eq(sourceItem.organizationId, orgId), isNotNull(sourceItem.signalStatus)]
  if (filters.status && isStatus(filters.status)) conds.push(eq(sourceItem.signalStatus, filters.status))
  if (filters.band && isBand(filters.band)) conds.push(eq(sourceItem.signalBand, filters.band))
  const code = filters.code?.trim()
  if (code) {
    conds.push(
      sql`exists (select 1 from ${signalInstance} si where si.source_item_id = ${sourceItem.id} and si.code = ${code})`,
    )
  }
  const where = and(...conds)

  const [rows, [count]] = await Promise.all([
    db
      .select(baseSelect)
      .from(sourceItem)
      .innerJoin(source, eq(source.id, sourceItem.sourceId))
      .where(where)
      .orderBy(desc(activityAt), desc(sourceItem.id))
      .limit(limit)
      .offset(offset),
    db.select({ n: sql<number>`count(*)::int` }).from(sourceItem).where(where),
  ])
  return { rows: await toReviewItems(rows), total: count?.n ?? 0 }
}

/** One review row of the org (null when the item is not in the org). */
export async function getSignalReviewItem(orgId: string, itemId: string): Promise<SignalReviewItem | null> {
  const rows = await db
    .select(baseSelect)
    .from(sourceItem)
    .innerJoin(source, eq(source.id, sourceItem.sourceId))
    .where(and(eq(sourceItem.organizationId, orgId), eq(sourceItem.id, itemId)))
  const [row] = await toReviewItems(rows)
  return row ?? null
}

export async function getSignalStats(orgId: string): Promise<SignalStats> {
  const since = new Date(Date.now() - TOP_CODES_DAYS * DAY_MS)
  const historyStart = await signalHistoryStart(orgId)
  const [statusRows, skipRows, bandRows, codeRows, labels, pending] = await Promise.all([
    db
      .select({ k: sourceItem.signalStatus, n: sql<number>`count(*)::int` })
      .from(sourceItem)
      .where(and(eq(sourceItem.organizationId, orgId), isNotNull(sourceItem.signalStatus)))
      .groupBy(sourceItem.signalStatus),
    db
      .select({
        k: sql<string>`split_part(coalesce(${sourceItem.signalReason}, ''), ':', 1)`,
        n: sql<number>`count(*)::int`,
      })
      .from(sourceItem)
      .where(and(eq(sourceItem.organizationId, orgId), eq(sourceItem.signalStatus, "skipped")))
      .groupBy(sql`1`),
    db
      .select({ k: sourceItem.signalBand, n: sql<number>`count(*)::int` })
      .from(sourceItem)
      .where(and(eq(sourceItem.organizationId, orgId), eq(sourceItem.signalStatus, "done")))
      .groupBy(sourceItem.signalBand),
    db
      .select({ code: signalInstance.code, n: sql<number>`count(*)::int` })
      .from(signalInstance)
      .where(
        and(
          eq(signalInstance.organizationId, orgId),
          eq(signalInstance.counted, true),
          gte(signalInstance.createdAt, since),
        ),
      )
      .groupBy(signalInstance.code)
      .orderBy(desc(sql`count(*)`), signalInstance.code)
      .limit(TOP_CODES_LIMIT),
    codeLabels(),
    historyStart ? countPendingSignalItems(orgId, historyStart) : Promise.resolve(0),
  ])

  const byStatus: SignalStats["byStatus"] = {}
  for (const r of statusRows) if (isStatus(r.k)) byStatus[r.k] = r.n
  const bySkipReason: Record<string, number> = {}
  for (const r of skipRows) bySkipReason[r.k.trim() || "—"] = r.n
  const byBand: SignalStats["byBand"] = {}
  for (const r of bandRows) if (isBand(r.k)) byBand[r.k] = r.n

  return {
    byStatus,
    bySkipReason,
    byBand,
    topCodes: codeRows.map((r) => ({ code: r.code, labelRu: labels.get(r.code) ?? null, count: r.n })),
    topCodesDays: TOP_CODES_DAYS,
    pending,
    historyStart: historyStart?.toISOString() ?? null,
  }
}

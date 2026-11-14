import "server-only"

import { and, desc, eq, inArray } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { dealRisk, signalInstance, source, sourceItem, topic, user } from "@/db/schema"
import {
  DEAL_RISK_CLEARED_BY,
  type DealRiskClearedBy,
  type DealRiskSummary,
  type DealRiskView,
} from "@/lib/topics/deal-state"
import { clearRisk, DealRiskError, loadRiskTypes } from "@/server/topics/deal-state/risk-store"
import { compareRiskCriticality } from "@/server/topics/deal-state/risk-engine"

export { DealRiskError } from "@/server/topics/deal-state/risk-store"
export type { DealRiskSummary, DealRiskView } from "@/lib/topics/deal-state"

// Deal risks for the deal UI (spec topics/01 §9.4, plan phase 5a): the risk
// list in the drawer, the kanban badge «Есть риски» + tooltip, and the user
// action «Риск снят». `server-only`, org-explicit (NOT "use server"): the
// caller (route / deals.ts) checks the session and passes the active org.
// The explanation shown is the `deals.state_summary` text when it passed the
// checks, else the risk type's fixed `description_ru` (R17).

const iso = (d: Date | null) => (d ? d.toISOString() : null)

function isClearedBy(v: string | null): v is DealRiskClearedBy {
  return !!v && (DEAL_RISK_CLEARED_BY as readonly string[]).includes(v)
}

/** Active + cleared risks of one deal (active first, then newest). */
export async function listDealRisks(orgId: string, dealId: string): Promise<DealRiskView[]> {
  const rows = await db
    .select({
      r: dealRisk,
      topicTitle: topic.title,
      clearedByUserName: user.name,
    })
    .from(dealRisk)
    .leftJoin(topic, eq(topic.id, dealRisk.topicId))
    .leftJoin(user, eq(user.id, dealRisk.clearedByUserId))
    .where(and(eq(dealRisk.organizationId, orgId), eq(dealRisk.dealId, dealId)))
    .orderBy(desc(dealRisk.detectedAt))
  if (rows.length === 0) return []
  const types = await loadRiskTypes()
  const typeBy = new Map(types.map((t) => [t.code, t]))
  const instIds = [...new Set(rows.flatMap((x) => x.r.triggerInstanceIds))]
  const itemIds = [...new Set(rows.flatMap((x) => [...x.r.sourceItemIds, ...x.r.explanationSourceItemIds]))]
  const [insts, items] = await Promise.all([
    instIds.length
      ? db
          .select({
            id: signalInstance.id,
            code: signalInstance.code,
            evidence: signalInstance.evidence,
            sourceItemId: signalInstance.sourceItemId,
            scoreContrib: signalInstance.scoreContrib,
          })
          .from(signalInstance)
          .where(and(eq(signalInstance.organizationId, orgId), inArray(signalInstance.id, instIds)))
      : Promise.resolve([]),
    itemIds.length
      ? db
          .select({
            id: sourceItem.id,
            sourceCreatedAt: sourceItem.sourceCreatedAt,
            createdAt: sourceItem.createdAt,
            provider: source.provider,
            metadataJson: sourceItem.metadataJson,
          })
          .from(sourceItem)
          .leftJoin(source, eq(source.id, sourceItem.sourceId))
          .where(and(eq(sourceItem.organizationId, orgId), inArray(sourceItem.id, itemIds)))
      : Promise.resolve([]),
  ])
  const instBy = new Map(insts.map((i) => [i.id, i]))
  const itemBy = new Map(items.map((i) => [i.id, i]))
  const views = rows.map(({ r, topicTitle, clearedByUserName }): DealRiskView => {
    const t = typeBy.get(r.riskType)
    const triggers = r.triggerInstanceIds
      .map((id) => instBy.get(id))
      .filter((x): x is NonNullable<typeof x> => !!x)
    const description = t?.descriptionRu ?? ""
    const fromAgent = !!r.explanationRu?.trim()
    return {
      id: r.id,
      dealId: r.dealId,
      riskType: r.riskType,
      labelRu: t?.labelRu ?? r.riskType,
      descriptionRu: description,
      explanationRu: fromAgent ? r.explanationRu!.trim() : description,
      explanationFromAgent: fromAgent,
      explanationSourceItemIds: fromAgent ? r.explanationSourceItemIds : [],
      status: r.status === "cleared" ? "cleared" : "active",
      severity: r.severity,
      occurrences: r.occurrences,
      triggerScore: Math.max(0, ...triggers.map((i) => i.scoreContrib)),
      topicId: r.topicId,
      topicTitle: topicTitle ?? null,
      triggerInstanceIds: r.triggerInstanceIds,
      triggers: triggers.map((i) => ({ instanceId: i.id, code: i.code, evidence: i.evidence, sourceItemId: i.sourceItemId })),
      sourceItemIds: r.sourceItemIds,
      sources: [...new Set([...r.sourceItemIds, ...(fromAgent ? r.explanationSourceItemIds : [])])]
        .map((id) => itemBy.get(id))
        .filter((x): x is NonNullable<typeof x> => !!x)
        .map((i) => {
          const m = (i.metadataJson ?? {}) as Record<string, unknown>
          return {
            sourceItemId: i.id,
            date: iso(i.sourceCreatedAt ?? i.createdAt),
            provider: i.provider ?? null,
            subject: typeof m.subject === "string" && m.subject.trim() ? m.subject : null,
          }
        }),
      detectedAt: r.detectedAt.toISOString(),
      clearedAt: iso(r.clearedAt),
      clearedBy: isClearedBy(r.clearedBy) ? r.clearedBy : null,
      clearedReason: r.clearedReason,
      clearedByUserId: r.clearedByUserId,
      clearedByUserName: clearedByUserName ?? null,
      clearInstanceId: r.clearInstanceId,
    }
  })
  const active = views.filter((v) => v.status === "active").sort(compareRiskCriticality)
  const cleared = views.filter((v) => v.status !== "active")
  return [...active, ...cleared]
}

/**
 * Kanban badge «Есть риски» + tooltip: per requested deal, the active count
 * and the MOST critical active risk (highest severity × trigger score, then
 * the newest) with its label and explanation. Deals without active risks get
 * `{ activeCount: 0, top: null }`.
 */
export async function listActiveRiskSummaries(orgId: string, dealIds: readonly string[]): Promise<DealRiskSummary[]> {
  const ids = [...new Set(dealIds.filter(Boolean))]
  if (ids.length === 0) return []
  const rows = await db
    .select()
    .from(dealRisk)
    .where(and(eq(dealRisk.organizationId, orgId), inArray(dealRisk.dealId, ids), eq(dealRisk.status, "active")))
  const out = new Map<string, DealRiskSummary>(ids.map((id) => [id, { dealId: id, activeCount: 0, top: null }]))
  if (rows.length === 0) return [...out.values()]
  const [types, insts] = await Promise.all([
    loadRiskTypes(),
    (async () => {
      const instIds = [...new Set(rows.flatMap((r) => r.triggerInstanceIds))]
      return instIds.length
        ? db
            .select({ id: signalInstance.id, scoreContrib: signalInstance.scoreContrib })
            .from(signalInstance)
            .where(and(eq(signalInstance.organizationId, orgId), inArray(signalInstance.id, instIds)))
        : []
    })(),
  ])
  const typeBy = new Map(types.map((t) => [t.code, t]))
  const scoreBy = new Map(insts.map((i) => [i.id, i.scoreContrib]))
  const byDeal = new Map<string, typeof rows>()
  for (const r of rows) byDeal.set(r.dealId, [...(byDeal.get(r.dealId) ?? []), r])
  for (const [dealId, list] of byDeal) {
    const ranked = list
      .map((r) => ({
        r,
        severity: r.severity,
        detectedAt: r.detectedAt,
        triggerScore: Math.max(0, ...r.triggerInstanceIds.map((id) => scoreBy.get(id) ?? 0)),
      }))
      .sort(compareRiskCriticality)
    const top = ranked[0]!.r
    const t = typeBy.get(top.riskType)
    out.set(dealId, {
      dealId,
      activeCount: list.length,
      top: {
        riskId: top.id,
        riskType: top.riskType,
        labelRu: t?.labelRu ?? top.riskType,
        explanationRu: top.explanationRu?.trim() || t?.descriptionRu || "",
        severity: top.severity,
        detectedAt: top.detectedAt.toISOString(),
      },
    })
  }
  return [...out.values()]
}

/**
 * User action «Риск снят» (§9.4): reason required. Journaled (deal activity
 * + topic event, actor user), marks the deal state dirty, ends the I5
 * escalation of the trigger topic. Returns false when the risk was already
 * cleared. Throws DealRiskError ('not_found' for a risk / deal of another
 * org, 'invalid' for an empty reason).
 */
export async function clearDealRiskByUser(
  orgId: string,
  dealId: string,
  riskId: string,
  userId: string,
  reason: string,
): Promise<{ cleared: boolean }> {
  const why = reason?.trim()
  if (!why) throw new DealRiskError("Укажите, почему риск снят", "invalid")
  const cleared = await clearRisk(orgId, dealId, riskId, {
    by: "user",
    reason: why,
    actor: { kind: "user", userId },
    userId,
  })
  return { cleared }
}

import "server-only"

import { randomUUID } from "node:crypto"
import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import {
  deal,
  dealActivity,
  dealContact,
  dealRisk,
  dealType,
  signalInstance,
  sourceItem,
  sourceItemSubject,
  topic,
  topicEvent,
  topicItem,
} from "@/db/schema"
import type { SignalItemFacts } from "@/lib/signals/extraction-types"
import type { DealRiskTypeRecord } from "@/lib/signals/types"
import type { DealRiskClearedBy } from "@/lib/topics/deal-state"
import { getOrgFunnel, outcomeStage } from "@/server/deal-engine"
import { getEffectiveSignals, getRegistry, loadOrgRows } from "@/server/signals/registry"
import { getDealStateParams, markDealsStateDirty } from "./params"
import {
  EMPTY_RISK_FACTS,
  evaluateDealRisks,
  RISK_LOOKBACK_DAYS,
  riskScope,
  type ExistingRisk,
  type RiskAction,
  type RiskFacts,
  type RiskInstance,
  type RiskItem,
  type RiskTopic,
  type RiskTypeDef,
} from "./risk-engine"

// DB side of the deal risk engine (spec topics/01 §9.4, plan phase 5a):
// loads one deal's inputs, runs the PURE engine (risk-engine.ts), writes the
// `deal_risk` rows, journals them (`deal_activity` note on the deal +
// `topic_event` `deal_risk` on the trigger topic), marks the deal state dirty
// (R16), forces the trigger topic's card to UPDATE (R17) and recomputes its
// attention (I5). Org-explicit, session-free; callers check access.

type BatchOps = Parameters<typeof db.batch>[0]
const asBatch = (ops: unknown[]) => ops as unknown as BatchOps
const DAY_MS = 86_400_000

export const DEAL_RISK_EVENT = "deal_risk"
/** Our reply / an item that says the product is not in stock (NO_STOCK_FOR_DEAL). */
const OUT_OF_STOCK_CUE = /нет\s+в\s+наличии|нет\s+на\s+склад|отсутству\w*\s+(?:на\s+склад|в\s+наличии)|законч(?:ил|ат)\w*|out\s+of\s+stock|not\s+(?:in|available\s+in)\s+stock|sold\s+out/i

export class DealRiskError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "invalid" = "invalid",
  ) {
    super(message)
    this.name = "DealRiskError"
  }
}

function toTypeDef(r: DealRiskTypeRecord): RiskTypeDef {
  return {
    code: r.code,
    labelRu: r.labelRu,
    descriptionRu: r.explanationRu?.trim() || r.descriptionRu,
    triggerCodes: r.triggerCodes,
    clearCodes: r.clearCodes,
    severity: r.severity,
    minOccurrences: r.minOccurrences,
    condition: r.condition?.trim() || null,
    scope: r.scope,
    enabled: r.enabled,
  }
}

export async function loadRiskTypes(): Promise<RiskTypeDef[]> {
  const reg = await getRegistry()
  return reg.riskTypes.map(toTypeDef)
}

function factsOf(raw: unknown): { facts: RiskFacts; direction: string | null } {
  const f = (raw ?? null) as Partial<SignalItemFacts> | null
  const x = f?.facts
  return {
    direction: typeof f?.direction === "string" ? f.direction : null,
    facts: x
      ? {
          deadlines: (x.deadlines ?? []).map((d) => ({ date: d.date, what: d.what ?? "", subjectIndex: d.subjectIndex ?? -1 })),
          proposedMeetingDate: x.proposedMeetingDate ?? null,
          contractEndDate: x.contractEndDate ?? null,
          paymentTermsDays: x.paymentTermsDays ?? null,
          creditLimitRequested: x.creditLimitRequested ?? null,
        }
      : EMPTY_RISK_FACTS,
  }
}

const dateExpr = sql<Date>`coalesce(${sourceItem.sourceCreatedAt}, ${sourceItem.createdAt})`.mapWith(sourceItem.createdAt)

export type DealRiskContext = {
  orgId: string
  types: RiskTypeDef[]
  guards: Map<string, { enabled: boolean; stageIds: string[] | null }>
  activeCodes: Set<string>
  params: Awaited<ReturnType<typeof getDealStateParams>>
}

export async function loadDealRiskContext(orgId: string): Promise<DealRiskContext> {
  const [types, rows, effective, params] = await Promise.all([
    loadRiskTypes(),
    loadOrgRows(orgId),
    getEffectiveSignals(orgId),
    getDealStateParams(orgId),
  ])
  return {
    orgId,
    types,
    guards: new Map(rows.riskGuards.map((g) => [g.riskCode, { enabled: g.enabled, stageIds: g.stageIds }])),
    activeCodes: new Set(effective.filter((e) => e.active).map((e) => e.code)),
    params,
  }
}

type LoadedDeal = {
  id: string
  name: string
  clientId: string
  funnelStageId: string
  status: string
  dealTypeCode: string | null
  outcomeReason: string | null
}

/** Everything the pure engine needs for one deal. */
export async function loadDealRiskInput(rctx: DealRiskContext, dealId: string, now: Date) {
  const orgId = rctx.orgId
  const [d] = await db
    .select({
      id: deal.id,
      name: deal.name,
      clientId: deal.clientId,
      funnelStageId: deal.funnelStageId,
      status: deal.status,
      dealTypeCode: dealType.code,
      outcomeReason: deal.outcomeReason,
    })
    .from(deal)
    .leftJoin(dealType, eq(dealType.id, deal.dealTypeId))
    .where(and(eq(deal.organizationId, orgId), eq(deal.id, dealId)))
  if (!d) throw new DealRiskError("Сделка не найдена", "not_found")
  const dl = d as LoadedDeal
  const [stages, contacts, existingRows] = await Promise.all([
    getOrgFunnel(orgId),
    db.select({ id: dealContact.contactId }).from(dealContact).where(eq(dealContact.dealId, dealId)),
    db
      .select()
      .from(dealRisk)
      .where(and(eq(dealRisk.organizationId, orgId), eq(dealRisk.dealId, dealId)))
      .orderBy(desc(dealRisk.detectedAt)),
  ])
  const won = outcomeStage(stages, "won")?.id
  const lost = outcomeStage(stages, "lost")?.id
  const closed =
    dl.status === "cancelled" || dl.status === "deleted" || dl.funnelStageId === won || dl.funnelStageId === lost
  const closedReason =
    dl.funnelStageId === won
      ? "Сделка выиграна"
      : dl.funnelStageId === lost
        ? "Сделка проиграна"
        : dl.status === "cancelled"
          ? "Сделка закрыта"
          : dl.status === "deleted"
            ? "Сделка удалена"
            : null

  const since = new Date(now.getTime() - (RISK_LOOKBACK_DAYS + 90) * DAY_MS)
  // Topics: of the deal, of the client (client scope), and org topics with a
  // fresh org_sku trigger (NO_STOCK_FOR_DEAL).
  const skuCodes = [...new Set(rctx.types.filter((t) => riskScope(t) === "org_sku").flatMap((t) => t.triggerCodes))]
  const topicRows = await db
    .select({ id: topic.id, status: topic.status, dealId: topic.dealId, clientId: topic.clientId, products: topic.products })
    .from(topic)
    .where(
      and(
        eq(topic.organizationId, orgId),
        or(
          eq(topic.dealId, dealId),
          eq(topic.clientId, dl.clientId),
          ...(skuCodes.length && !closed
            ? [
                sql`exists (select 1 from ${signalInstance} si where si.topic_id = ${topic.id} and si.code in ${skuCodes} and si.created_at >= ${new Date(now.getTime() - RISK_LOOKBACK_DAYS * DAY_MS)})`,
              ]
            : []),
        ),
      ),
    )
  const topics = new Map<string, RiskTopic>(
    topicRows.map((t) => [t.id, { id: t.id, status: t.status, dealId: t.dealId, clientId: t.clientId, products: t.products }]),
  )
  const topicIds = [...topics.keys()]

  const [instRows, itemRows] = topicIds.length
    ? await Promise.all([
        db
          .select({
            id: signalInstance.id,
            code: signalInstance.code,
            topicId: signalInstance.topicId,
            itemId: signalInstance.sourceItemId,
            confidence: signalInstance.confidence,
            counted: signalInstance.counted,
            scoreContrib: signalInstance.scoreContrib,
            evidence: signalInstance.evidence,
            subjectIndex: signalInstance.subjectIndex,
            createdAt: signalInstance.createdAt,
            date: dateExpr,
            signalFacts: sourceItem.signalFacts,
            products: sourceItemSubject.products,
            contactId: sourceItemSubject.contactId,
          })
          .from(signalInstance)
          .leftJoin(sourceItem, eq(sourceItem.id, signalInstance.sourceItemId))
          .leftJoin(
            sourceItemSubject,
            and(
              eq(sourceItemSubject.sourceItemId, signalInstance.sourceItemId),
              sql`${sourceItemSubject.subjectIndex} = greatest(${signalInstance.subjectIndex}, 0)`,
            ),
          )
          .where(
            and(
              eq(signalInstance.organizationId, orgId),
              inArray(signalInstance.topicId, topicIds),
              gte(signalInstance.createdAt, since),
            ),
          ),
        db
          .select({
            itemId: topicItem.sourceItemId,
            topicId: topicItem.topicId,
            subjectIndex: topicItem.subjectIndex,
            date: dateExpr,
            signalFacts: sourceItem.signalFacts,
            contactId: sourceItemSubject.contactId,
            rawText: sql<string | null>`coalesce(${sourceItem.metadataJson}->>'rawText', ${sourceItem.metadataJson}->>'text', ${sourceItem.metadataJson}->>'snippet')`,
          })
          .from(topicItem)
          .innerJoin(sourceItem, eq(sourceItem.id, topicItem.sourceItemId))
          .leftJoin(
            sourceItemSubject,
            and(
              eq(sourceItemSubject.sourceItemId, topicItem.sourceItemId),
              sql`${sourceItemSubject.subjectIndex} = greatest(${topicItem.subjectIndex}, 0)`,
            ),
          )
          .where(and(eq(topicItem.organizationId, orgId), inArray(topicItem.topicId, topicIds))),
      ])
    : [[], []]

  const instances: RiskInstance[] = instRows
    .filter((r) => !!r.topicId)
    .map((r) => {
      const { facts, direction } = factsOf(r.signalFacts)
      return {
        id: r.id,
        code: r.code,
        topicId: r.topicId!,
        itemId: r.itemId,
        itemDate: r.date ?? r.createdAt,
        confidence: r.confidence === "high" || r.confidence === "low" ? r.confidence : "medium",
        counted: r.counted,
        scoreContrib: r.scoreContrib,
        evidence: r.evidence,
        direction,
        subjectIndex: r.subjectIndex,
        products: r.products ?? topics.get(r.topicId!)?.products ?? [],
        authorContactId: r.contactId ?? null,
        facts,
        outOfStockCue: OUT_OF_STOCK_CUE.test(r.evidence),
      }
    })
  const seenItem = new Set<string>()
  const items: RiskItem[] = []
  for (const r of itemRows) {
    const key = `${r.topicId}:${r.itemId}`
    if (seenItem.has(key)) continue
    seenItem.add(key)
    const { facts, direction } = factsOf(r.signalFacts)
    items.push({
      itemId: r.itemId,
      topicId: r.topicId,
      date: r.date,
      direction,
      authorContactId: r.contactId ?? null,
      facts,
      outOfStockCue: !!r.rawText && OUT_OF_STOCK_CUE.test(r.rawText),
    })
  }
  const existing: ExistingRisk[] = existingRows.map((r) => ({
    id: r.id,
    riskType: r.riskType,
    status: r.status === "cleared" ? "cleared" : "active",
    triggerInstanceIds: r.triggerInstanceIds,
    occurrences: r.occurrences,
    topicId: r.topicId,
    detectedAt: r.detectedAt,
    clearedAt: r.clearedAt,
  }))
  return {
    deal: dl,
    input: {
      deal: {
        id: dl.id,
        clientId: dl.clientId,
        stageId: dl.funnelStageId,
        status: dl.status,
        dealTypeCode: dl.dealTypeCode,
        contactIds: contacts.map((c) => c.id),
        closed,
        closedReason,
      },
      types: rctx.types,
      guards: rctx.guards,
      activeCodes: rctx.activeCodes,
      topics,
      instances,
      items,
      existing,
      settings: { maxDeferralDays: rctx.params.maxDeferralDays, maxCreditLimitRub: rctx.params.maxCreditLimitRub },
      now,
    },
  }
}

// ── Writes ────────────────────────────────────────────────────────────────

type Actor = { kind: "agent" | "user"; userId: string | null }

function activityOp(
  dealId: string,
  stageId: string,
  actor: Actor,
  note: string,
  prov: { topicId?: string | null; sourceItemId?: string | null; evidence?: string | null },
) {
  return db.insert(dealActivity).values({
    id: randomUUID(),
    dealId,
    actor: actor.kind,
    actorUserId: actor.userId,
    fromStageId: stageId,
    toStageId: stageId,
    note,
    topicId: prov.topicId ?? null,
    sourceItemId: prov.sourceItemId ?? null,
    evidence: prov.evidence?.trim().slice(0, 1000) || null,
  })
}

function riskEventOp(
  orgId: string,
  topicId: string,
  actor: Actor,
  sourceItemId: string | null,
  payload: Record<string, unknown>,
) {
  return db.insert(topicEvent).values({
    id: randomUUID(),
    organizationId: orgId,
    topicId,
    type: DEAL_RISK_EVENT,
    actor: actor.kind,
    userId: actor.userId,
    sourceItemId,
    payload,
  })
}

/** After a risk change: I5 attention recompute of the topics + (new risk) R17 card force. Never throws. */
async function afterRiskChange(
  orgId: string,
  changed: { topicId: string | null; activated: boolean; labelRu: string; descriptionRu: string }[],
): Promise<void> {
  const topicIds = [...new Set(changed.map((c) => c.topicId).filter((x): x is string => !!x))]
  if (topicIds.length === 0) return
  try {
    const { forceTopicCardUpdate } = await import("@/server/topics/cards/phase")
    for (const c of changed) {
      if (!c.activated || !c.topicId) continue
      await forceTopicCardUpdate(orgId, c.topicId, `Риск по сделке: ${c.labelRu}. ${c.descriptionRu}`)
    }
  } catch (e) {
    console.error(`[topics:dealState] card force for org ${orgId}:`, e)
  }
  try {
    const { recomputeTopicsAttention } = await import("@/server/topics/attention/store")
    await recomputeTopicsAttention(orgId, topicIds)
  } catch (e) {
    console.error(`[topics:dealState] attention recompute for org ${orgId}:`, e)
  }
}

export type RiskApplyResult = { activated: number; updated: number; cleared: number }

/** Write the engine's actions for one deal (one batch), then the R17 / I5 hooks. */
export async function applyRiskActions(
  orgId: string,
  d: { id: string; funnelStageId: string },
  actions: readonly RiskAction[],
  actor: Actor,
  types: readonly RiskTypeDef[],
  instanceEvidence: ReadonlyMap<string, { itemId: string | null; evidence: string }>,
): Promise<RiskApplyResult & { newRiskIds: string[] }> {
  const res = { activated: 0, updated: 0, cleared: 0, newRiskIds: [] as string[] }
  if (actions.length === 0) return res
  const typeBy = new Map(types.map((t) => [t.code, t]))
  const now = new Date()
  const ops: unknown[] = []
  const changed: { topicId: string | null; activated: boolean; labelRu: string; descriptionRu: string }[] = []
  const clearedTopics = new Map<string, string | null>()
  if (actions.some((a) => a.kind === "clear")) {
    const ids = actions.filter((a) => a.kind === "clear").map((a) => (a as { riskId: string }).riskId)
    const rows = await db
      .select({ id: dealRisk.id, topicId: dealRisk.topicId })
      .from(dealRisk)
      .where(and(eq(dealRisk.organizationId, orgId), inArray(dealRisk.id, ids)))
    for (const r of rows) clearedTopics.set(r.id, r.topicId)
  }
  for (const a of actions) {
    const t = typeBy.get(a.riskType)
    const label = t?.labelRu ?? a.riskType
    if (a.kind === "activate") {
      const id = randomUUID()
      const newest = a.triggerInstanceIds[a.triggerInstanceIds.length - 1]
      const ev = newest ? instanceEvidence.get(newest) : undefined
      ops.push(
        db
          .insert(dealRisk)
          .values({
            id,
            organizationId: orgId,
            dealId: d.id,
            riskType: a.riskType,
            status: "active",
            severity: a.severity,
            occurrences: a.occurrences,
            topicId: a.topicId,
            triggerInstanceIds: a.triggerInstanceIds,
            sourceItemIds: a.sourceItemIds,
            detectedAt: now,
          })
          .onConflictDoNothing(),
        activityOp(d.id, d.funnelStageId, actor, `Риск: ${label}`, {
          topicId: a.topicId,
          sourceItemId: ev?.itemId ?? null,
          evidence: a.evidence,
        }),
        riskEventOp(orgId, a.topicId, actor, ev?.itemId ?? null, {
          action: "activated",
          riskId: id,
          riskType: a.riskType,
          labelRu: label,
          severity: a.severity,
          occurrences: a.occurrences,
          dealId: d.id,
          triggerInstanceIds: a.triggerInstanceIds,
        }),
      )
      res.activated++
      res.newRiskIds.push(id)
      changed.push({ topicId: a.topicId, activated: true, labelRu: label, descriptionRu: t?.descriptionRu ?? "" })
    } else if (a.kind === "update") {
      ops.push(
        db
          .update(dealRisk)
          .set({
            occurrences: a.occurrences,
            topicId: a.topicId,
            triggerInstanceIds: a.triggerInstanceIds,
            sourceItemIds: a.sourceItemIds,
          })
          .where(and(eq(dealRisk.organizationId, orgId), eq(dealRisk.id, a.riskId), eq(dealRisk.status, "active"))),
      )
      res.updated++
    } else {
      ops.push(...clearOps(orgId, d, a.riskId, clearedTopics.get(a.riskId) ?? null, label, actor, {
        by: a.by,
        reason: a.reason,
        clearInstanceId: a.clearInstanceId,
        sourceItemId: a.clearItemId,
        userId: null,
        now,
      }))
      res.cleared++
      changed.push({ topicId: clearedTopics.get(a.riskId) ?? null, activated: false, labelRu: label, descriptionRu: "" })
    }
  }
  if (res.activated || res.cleared) ops.push(markDealsStateDirtyOp(orgId, [d.id], now))
  await db.batch(asBatch(ops))
  await afterRiskChange(orgId, changed)
  if (res.activated > 0) await notifyNewRisks(orgId, d.id, actions, typeBy, res.newRiskIds)
  return res
}

/**
 * Notifications (docs/specs/notifications §5 `deal.risk_new`): each new risk
 * → the deal owner; important when severity ≥ the immediate threshold (7).
 * Never throws.
 */
async function notifyNewRisks(
  orgId: string,
  dealId: string,
  actions: readonly RiskAction[],
  typeBy: ReadonlyMap<string, RiskTypeDef>,
  newRiskIds: readonly string[],
): Promise<void> {
  try {
    const [row] = await db.select({ name: deal.name, owner: deal.userId }).from(deal).where(eq(deal.id, dealId))
    if (!row?.owner) return
    const { notify } = await import("@/server/notifications/engine")
    const activated = actions.filter((a): a is Extract<RiskAction, { kind: "activate" }> => a.kind === "activate")
    for (let i = 0; i < activated.length; i++) {
      const a = activated[i]
      const t = typeBy.get(a.riskType)
      await notify(orgId, {
        kind: "deal.risk_new",
        userIds: [row.owner],
        priority: a.severity >= 7 ? "important" : "info",
        title: `Риск по сделке «${row.name}»: ${t?.labelRu ?? a.riskType}`,
        body: a.evidence || t?.descriptionRu || null,
        href: `/deals?openDeal=${dealId}`,
        entity: { type: "deal", id: dealId },
        dedupeKey: `deal.risk_new:${newRiskIds[i] ?? `${dealId}:${a.riskType}:${Date.now()}`}`,
      })
    }
  } catch (err) {
    console.error("[topics:dealState] risk notifications failed", orgId, dealId, err)
  }
}

function markDealsStateDirtyOp(orgId: string, dealIds: string[], now: Date) {
  return db
    .update(deal)
    .set({ stateDirtyAt: now, updatedAt: sql`${deal.updatedAt}` })
    .where(and(eq(deal.organizationId, orgId), inArray(deal.id, dealIds)))
}

function clearOps(
  orgId: string,
  d: { id: string; funnelStageId: string },
  riskId: string,
  topicId: string | null,
  label: string,
  actor: Actor,
  c: {
    by: DealRiskClearedBy
    reason: string
    clearInstanceId: string | null
    sourceItemId: string | null
    userId: string | null
    now: Date
  },
): unknown[] {
  const ops: unknown[] = [
    db
      .update(dealRisk)
      .set({
        status: "cleared",
        clearedAt: c.now,
        clearedBy: c.by,
        clearedReason: c.reason.slice(0, 1000),
        clearedByUserId: c.userId,
        clearInstanceId: c.clearInstanceId,
      })
      .where(and(eq(dealRisk.organizationId, orgId), eq(dealRisk.id, riskId), eq(dealRisk.status, "active"))),
    activityOp(d.id, d.funnelStageId, actor, `Риск снят: ${label} — ${c.reason.slice(0, 300)}`, {
      topicId,
      sourceItemId: c.sourceItemId,
    }),
  ]
  if (topicId) {
    ops.push(
      riskEventOp(orgId, topicId, actor, c.sourceItemId, {
        action: "cleared",
        riskId,
        labelRu: label,
        dealId: d.id,
        by: c.by,
        reason: c.reason,
        clearInstanceId: c.clearInstanceId,
      }),
    )
  }
  return ops
}

/**
 * Clear ONE active risk (user «Риск снят», or an accepted `deals.state_summary`
 * proposal). Journaled, marks the deal state dirty, recomputes the topic's
 * attention (I5 ends). Returns false when the risk was not active.
 */
export async function clearRisk(
  orgId: string,
  dealId: string,
  riskId: string,
  c: { by: DealRiskClearedBy; reason: string; actor: Actor; userId: string | null; sourceItemId?: string | null },
): Promise<boolean> {
  const [r] = await db
    .select({
      id: dealRisk.id,
      status: dealRisk.status,
      topicId: dealRisk.topicId,
      riskType: dealRisk.riskType,
      stageId: deal.funnelStageId,
    })
    .from(dealRisk)
    .innerJoin(deal, eq(deal.id, dealRisk.dealId))
    .where(and(eq(dealRisk.organizationId, orgId), eq(dealRisk.dealId, dealId), eq(dealRisk.id, riskId)))
  if (!r) throw new DealRiskError("Риск не найден", "not_found")
  if (r.status !== "active") return false
  const types = await loadRiskTypes()
  const label = types.find((t) => t.code === r.riskType)?.labelRu ?? r.riskType
  const now = new Date()
  await db.batch(
    asBatch([
      ...clearOps(orgId, { id: dealId, funnelStageId: r.stageId }, riskId, r.topicId, label, c.actor, {
        by: c.by,
        reason: c.reason,
        clearInstanceId: null,
        sourceItemId: c.sourceItemId ?? null,
        userId: c.userId,
        now,
      }),
      markDealsStateDirtyOp(orgId, [dealId], now),
    ]),
  )
  await afterRiskChange(orgId, [{ topicId: r.topicId, activated: false, labelRu: label, descriptionRu: "" }])
  return true
}

/** Evaluate + apply the risks of ONE deal (idempotent). */
export async function evaluateRisksForDeal(
  rctx: DealRiskContext,
  dealId: string,
  actor: Actor,
  now: Date = new Date(),
): Promise<RiskApplyResult & { actions: RiskAction[] }> {
  const { deal: d, input } = await loadDealRiskInput(rctx, dealId, now)
  const actions = evaluateDealRisks(input)
  const ev = new Map(input.instances.map((i) => [i.id, { itemId: i.itemId, evidence: i.evidence }]))
  const res = await applyRiskActions(rctx.orgId, d, actions, actor, rctx.types, ev)
  return { activated: res.activated, updated: res.updated, cleared: res.cleared, actions }
}

/**
 * Deals whose risks the phase re-evaluates: open deals with a linked topic
 * or an active risk (closed deals with an active risk → outcome clear), plus
 * open deals of clients with a fresh signal (client scope) — newest first.
 */
export async function selectRiskCandidateDeals(orgId: string, now: Date, limit: number): Promise<string[]> {
  const fresh = new Date(now.getTime() - 2 * DAY_MS)
  const rows = await db
    .select({ id: deal.id })
    .from(deal)
    .where(
      and(
        eq(deal.organizationId, orgId),
        or(
          sql`exists (select 1 from ${dealRisk} r where r.deal_id = ${deal.id} and r.status = 'active')`,
          and(
            inArray(deal.status, ["active", "paused"]),
            or(
              sql`exists (select 1 from ${topic} t where t.deal_id = ${deal.id})`,
              sql`exists (select 1 from ${topic} t join ${signalInstance} si on si.topic_id = t.id where t.client_id = ${deal.clientId} and t.organization_id = ${orgId} and si.created_at >= ${fresh})`,
            ),
          ),
        ),
      ),
    )
    .orderBy(desc(deal.updatedAt))
    .limit(limit)
  return rows.map((r) => r.id)
}

export { markDealsStateDirty }

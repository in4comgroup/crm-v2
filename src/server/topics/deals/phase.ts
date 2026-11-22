import "server-only"

import { randomUUID } from "node:crypto"
import { and, asc, desc, eq, gte, inArray, isNotNull, ne, notExists, notInArray, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import {
  client,
  contact,
  deal,
  dealType,
  signalInstance,
  signalStageRule,
  topic,
  topicEvent,
} from "@/db/schema"
import { stageDisplayLabel } from "@/lib/deal-funnel"
import type { StageRuleGuards } from "@/lib/signals/types"
import type { DealCardProposal } from "@/lib/topics/cards"
import { ensureDefaultDealTypes } from "@/server/deal-types"
import {
  createAgentDeal,
  getDealBridgeParams,
  getOrgFunnel,
  linkTopicToDeal,
  listOpenClientDeals,
  loadClientGuardFacts,
  moveDealForward,
  pauseDeal,
  resumeDeal,
  setDealOutcome,
  type DealActor,
  type OrgFunnelStage,
} from "@/server/deal-engine"
import { closeOpenDealProposals, insertDealCard, openDealCardKinds } from "@/server/topics/cards/deal-cards"
import { getOutcomeReasons } from "@/server/funnel-config"
import { runDealAutoLink } from "./auto-link"
import { loadCodeBook, hydrateTopics } from "@/server/topics/topic-store"
import type { TopicSnapshot } from "@/server/topics/model"
import type { TopicsPhaseContext, TopicsPhaseResult } from "@/server/topics/phases"
import {
  DEAL_REASON_LABELS_RU,
  evaluateTopicDeals,
  NEW_DEAL_ID,
  type DealDecision,
  type DealLite,
  type InstanceLite,
  type RuleLite,
  type StageLite,
} from "./rules"
import { contactDisplaySql } from "@/server/contact-display"

// Phase «deals» of the hourly run (plan phase 5, deal bridge, spec topics/01
// §9.2). Runs after «cards». Deterministic, no AI cost.
//
// Picks the NEW signal instances of the org whose code has an org stage rule
// (`signal_stage_rule` with organization_id = org; none → `{ skipped: "no
// stage rules" }` — the platform admin copies the templates in «Сигналы»):
// confidence ≠ low, created in the last DEALS_LOOKBACK_DAYS, on a live topic,
// and without a decision marker. Per topic (≤ DEALS_MAX_TOPICS_PER_RUN):
// evaluate the pure rules (./rules.ts), execute the decisions, then write
// one `topic_event` of type `deal_decision` per instance (payload:
// instanceId, code, results[{ ruleId, effect, action, reason, dealId,
// cardId }]). That event is the idempotency marker: an instance is decided
// once. An instance whose execution failed gets no marker (retried next run).
//
// Mode: `on` → real deal writes (system actor «Агент»). `shadow` → DRY RUN:
// decisions and hidden proposal / confirmation cards are stored, deals are
// NOT created or moved (deals are visible on the board, shadow must show
// users nothing). Markers of a dry run carry `dryRun: true`; after the switch
// to `on` those instances are decided again for real (within the lookback).
//
// Never throws for one topic: a failing topic is counted in `errors`.

export const DEALS_MAX_TOPICS_PER_RUN = 50
export const DEALS_LOOKBACK_DAYS = 30
const SKIP_TOPIC_STATUSES = ["merged", "dismissed", "archived", "expired"]
export const DEAL_DECISION_EVENT = "deal_decision"
/** Skip reasons that leave the instance undecided (retried next run). */
const RETRY_REASONS = new Set(["no_counterparty"])

export type DealDecisionResult = {
  ruleId: string
  effect: string
  action: string
  reason: string
  dealId: string | null
  cardId: string | null
  stageId: string | null
  error?: string
}

export async function loadOrgStageRules(orgId: string): Promise<RuleLite[]> {
  const rows = await db
    .select()
    .from(signalStageRule)
    .where(and(eq(signalStageRule.organizationId, orgId), eq(signalStageRule.enabled, true)))
    .orderBy(asc(signalStageRule.sort))
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    effect: r.effect,
    targetStageId: r.targetStageId,
    dealTypes: r.dealTypes ?? [],
    guards: (r.guards ?? {}) as StageRuleGuards,
    enabled: r.enabled,
    sort: r.sort,
    noteRu: r.noteRu,
  }))
}

/** Stages for the pure rules — meaning by ROLE (docs/specs/funnel §3.1), never by name. */
function stageLite(stages: readonly OrgFunnelStage[]): StageLite[] {
  return stages.map((s) => ({
    id: s.id,
    sortOrder: s.sortOrder,
    isPrePipeline: s.role === "area0",
    terminal: s.role === "won" ? "won" : s.role === "lost" ? "lost" : null,
  }))
}

/** Topics + their undecided instances (grouped, newest topic activity first). */
async function selectCandidates(
  orgId: string,
  codes: string[],
  since: Date,
  dryRun: boolean,
  limitTopics: number,
  onlyTopicId?: string,
): Promise<Map<string, Set<string>>> {
  const marker = db
    .select({ x: sql`1` })
    .from(topicEvent)
    .where(
      and(
        eq(topicEvent.topicId, signalInstance.topicId),
        eq(topicEvent.type, DEAL_DECISION_EVENT),
        sql`${topicEvent.payload}->>'instanceId' = ${signalInstance.id}`,
        // In mode `on`, a dry-run (shadow) marker does not count.
        ...(dryRun ? [] : [sql`coalesce(${topicEvent.payload}->>'dryRun', 'false') <> 'true'`]),
      ),
    )
  const rows = await db
    .select({ id: signalInstance.id, topicId: signalInstance.topicId })
    .from(signalInstance)
    .innerJoin(topic, eq(topic.id, signalInstance.topicId))
    .where(
      and(
        eq(signalInstance.organizationId, orgId),
        eq(topic.organizationId, orgId),
        isNotNull(signalInstance.topicId),
        inArray(signalInstance.code, codes),
        ne(signalInstance.confidence, "low"),
        gte(signalInstance.createdAt, since),
        notInArray(topic.status, SKIP_TOPIC_STATUSES),
        notExists(marker),
        ...(onlyTopicId ? [eq(topic.id, onlyTopicId)] : []),
      ),
    )
    // Topics with a counterparty first (unresolved ones are retried and must
    // not starve the cap), then the newest activity.
    .orderBy(
      sql`(${topic.clientId} is null and ${topic.contactId} is null)`,
      desc(topic.lastActivityAt),
      asc(signalInstance.createdAt),
    )
    .limit(2000)
  const out = new Map<string, Set<string>>()
  for (const r of rows) {
    if (!r.topicId) continue
    if (!out.has(r.topicId)) {
      if (out.size >= limitTopics) continue
      out.set(r.topicId, new Set())
    }
    out.get(r.topicId)!.add(r.id)
  }
  return out
}

async function closeOpenDealProposalsSafe(orgId: string, topicId: string): Promise<void> {
  try {
    await closeOpenDealProposals(orgId, topicId)
  } catch (e) {
    console.error(`[topics:deals] close proposals of topic ${topicId}:`, e)
  }
}

function hasConcreteTask(t: TopicSnapshot): boolean {
  return (
    t.products.length > 0 ||
    t.references.length > 0 ||
    t.items.some((i) => i.amounts.length > 0) ||
    t.instances.some((i) => i.deadlines.length > 0)
  )
}

type OrgDealContext = {
  orgId: string
  actor: DealActor
  dryRun: boolean
  stages: OrgFunnelStage[]
  stageLites: StageLite[]
  typeByCode: Map<string, { id: string; labelRu: string }>
  rules: RuleLite[]
  params: Awaited<ReturnType<typeof getDealBridgeParams>>
  book: Awaited<ReturnType<typeof loadCodeBook>>
  /** No-go reasons of the org (snapshot on gated proposals, docs/specs/funnel §3.2). */
  noGoReasons: { code: string; label: string }[]
}

export type TopicDealOutcome = {
  topicId: string
  decisions: (DealDecision & { result: DealDecisionResult })[]
  error?: string
}

/** Evaluate + execute one topic (exported for the admin debug action). */
export async function processTopicDeals(
  octx: OrgDealContext,
  snap: TopicSnapshot,
  newInstanceIds: ReadonlySet<string>,
): Promise<TopicDealOutcome> {
  const { orgId } = octx
  const [names] = await db
    .select({ clientName: client.name, contactName: contactDisplaySql(), ownerUserId: topic.ownerUserId })
    .from(topic)
    .leftJoin(client, eq(client.id, topic.clientId))
    .leftJoin(contact, eq(contact.id, topic.contactId))
    .where(and(eq(topic.organizationId, orgId), eq(topic.id, snap.id)))

  let linked: DealLite | null = null
  if (snap.dealId) {
    const [d] = await db
      .select({ id: deal.id, stageId: deal.funnelStageId, status: deal.status, dealTypeCode: dealType.code })
      .from(deal)
      .leftJoin(dealType, eq(dealType.id, deal.dealTypeId))
      .where(and(eq(deal.organizationId, orgId), eq(deal.id, snap.dealId)))
    if (d) linked = { id: d.id, stageId: d.stageId, status: d.status as DealLite["status"], dealTypeCode: d.dealTypeCode }
  }
  const [openClient, facts, cardKinds] = await Promise.all([
    snap.clientId ? listOpenClientDeals(orgId, snap.clientId) : Promise.resolve([]),
    snap.clientId ? loadClientGuardFacts(orgId, snap.clientId) : Promise.resolve(null),
    openDealCardKinds(orgId, snap.id),
  ])

  const dirByItem = new Map(snap.items.map((i) => [i.itemId, i.direction]))
  const relayedItems = new Set(snap.items.filter((i) => i.relayed).map((i) => i.itemId))
  const instances: InstanceLite[] = snap.instances
    .filter((i) => newInstanceIds.has(i.id) && i.confidence !== "low")
    .sort((a, b) => a.itemDate.getTime() - b.itemDate.getTime() || a.id.localeCompare(b.id))
    .map((i) => ({
      id: i.id,
      code: i.code,
      itemId: i.itemId,
      confidence: i.confidence,
      evidence: i.evidence ?? "",
      direction: i.itemId ? (dirByItem.get(i.itemId) ?? null) : null,
      ...(i.itemId && relayedItems.has(i.itemId) ? { relayed: true } : {}),
    }))

  // «Topics with counted instances» (task scope): a topic with no counted
  // instance and no deal is noise for the bridge.
  const anyCounted = snap.instances.some((i) => i.counted)
  const decisions: DealDecision[] =
    !anyCounted && !linked
      ? instances.map((i) => ({
          instanceId: i.id,
          code: i.code,
          ruleId: "",
          effect: "",
          action: "skip",
          reason: "no_counted",
          dealId: null,
          dealTypeCode: null,
          stageId: null,
          fromStageId: null,
          outcome: null,
          confirmEffect: null,
          sourceItemId: i.itemId,
          evidence: i.evidence,
          confidence: i.confidence,
        }))
      : evaluateTopicDeals({
          topic: {
            id: snap.id,
            score: snap.score,
            clientId: snap.clientId,
            contactId: snap.contactId,
            hasConcreteTask: hasConcreteTask(snap),
          },
          deal: linked,
          openClientDeals: openClient.map((d) => ({
            id: d.id,
            stageId: d.funnelStageId,
            status: d.status as DealLite["status"],
            dealTypeCode: d.dealTypeCode,
          })),
          clientFacts: facts,
          stages: octx.stageLites,
          dealTypeCodes: new Set(octx.typeByCode.keys()),
          params: octx.params,
          rules: octx.rules,
          instances,
          openCardKinds: cardKinds,
        })

  const stageLabel = (id: string | null) => {
    const s = id ? octx.stages.find((x) => x.id === id) : undefined
    return s ? stageDisplayLabel(s.name, s.displayName) : null
  }
  // «Условие входа» of the target stage (docs/specs/funnel §6, Q13): shown on
  // the card so the person decides by the org's own definition.
  const targetStageCondition = (id: string | null): string | null =>
    (id ? octx.stages.find((x) => x.id === id)?.entryCondition?.trim() : null) || null
  const proposalFor = (d: DealDecision, action: DealCardProposal["action"], dealId: string | null): DealCardProposal => {
    const type = d.dealTypeCode ? octx.typeByCode.get(d.dealTypeCode) : undefined
    return {
      v: 1,
      action,
      ruleId: d.ruleId || null,
      code: d.code,
      codeLabelRu: octx.book.get(d.code)?.labelRu ?? d.code,
      instanceId: d.instanceId,
      sourceItemId: d.sourceItemId,
      evidence: d.evidence,
      confidence: d.confidence,
      topicScore: snap.score,
      reasonRu: DEAL_REASON_LABELS_RU[d.reason] ?? d.reason,
      reasonCode: d.reason,
      clientId: snap.clientId,
      clientName: names?.clientName ?? null,
      contactId: snap.contactId,
      contactName: names?.contactName ?? null,
      dealName: snap.title,
      dealTypeId: type?.id ?? null,
      dealTypeCode: d.dealTypeCode,
      dealTypeLabelRu: type?.labelRu ?? null,
      stageId: d.stageId,
      stageLabelRu: stageLabel(d.stageId),
      fromStageId: d.fromStageId,
      fromStageLabelRu: stageLabel(d.fromStageId),
      dealId,
      // Entry gate (docs/specs/funnel §3.2): every proposal of a gated org is
      // a «go / no-go?» card; «No-go» needs one of these reasons.
      ...(action === "create" && octx.params.entryGate === "go_no_go"
        ? { gate: true, noGoReasons: octx.noGoReasons }
        : {}),
    }
  }

  let newDealId: string | null = null
  const realId = (id: string | null) => (id === NEW_DEAL_ID ? newDealId : id)
  const out: TopicDealOutcome["decisions"] = []
  const failed = new Set<string>()

  for (const d of decisions) {
    const result: DealDecisionResult = {
      ruleId: d.ruleId,
      effect: d.effect,
      action: d.action,
      reason: d.reason,
      dealId: realId(d.dealId),
      cardId: null,
      stageId: d.stageId,
    }
    const prov = {
      topicId: snap.id,
      sourceItemId: d.sourceItemId,
      ruleId: d.ruleId || null,
      evidence: d.evidence,
    }
    const label = octx.book.get(d.code)?.labelRu ?? d.code
    const dealWrite = ["create", "link", "move", "outcome", "pause", "resume", "context"].includes(d.action)
    try {
      if (octx.dryRun && dealWrite) {
        result.action = `${d.action}:dry_run`
      } else {
        switch (d.action) {
          case "create": {
            const type = d.dealTypeCode ? octx.typeByCode.get(d.dealTypeCode) : undefined
            const res = await createAgentDeal(
              orgId,
              {
                clientId: snap.clientId!,
                dealTypeId: type?.id ?? null,
                stageId: d.stageId!,
                name: snap.title,
                topicId: snap.id,
                contactIds: snap.contactId ? [snap.contactId] : [],
                createdByAgent: true,
                provenance: { ...prov, note: `Создал агент: ${label}` },
              },
              octx.actor,
            )
            newDealId = res.id
            result.dealId = res.id
            await closeOpenDealProposalsSafe(orgId, snap.id)
            break
          }
          case "link":
            await linkTopicToDeal(orgId, snap.id, d.dealId!, octx.actor, {
              ...prov,
              note: `Агент привязал тему к открытой сделке того же типа: ${label}`,
            })
            await closeOpenDealProposalsSafe(orgId, snap.id)
            break
          case "move": {
            const r = await moveDealForward(orgId, realId(d.dealId)!, d.stageId!, octx.actor, {
              ...prov,
              note: `Перевёл агент: ${label}`,
            })
            if (!r.moved) result.action = "skip"
            break
          }
          case "outcome":
            await setDealOutcome(orgId, realId(d.dealId)!, d.outcome!, octx.actor, {
              ...prov,
              stageId: d.stageId,
              reason: d.evidence,
              note: `Итог по сигналу (агент): ${label}`,
            })
            break
          case "pause":
            await pauseDeal(orgId, realId(d.dealId)!, octx.actor, { ...prov, reason: d.evidence, note: `Пауза (агент): ${label}` })
            break
          case "resume":
            await resumeDeal(orgId, realId(d.dealId)!, octx.actor, { ...prov, note: `Пауза снята (агент): ${label}` })
            break
          case "context":
            await db.insert(topicEvent).values({
              id: randomUUID(),
              organizationId: orgId,
              topicId: snap.id,
              type: "deal_context",
              actor: "agent",
              userId: octx.actor.userId,
              sourceItemId: d.sourceItemId,
              payload: { dealId: realId(d.dealId), code: d.code, labelRu: label, ruleId: d.ruleId, evidence: d.evidence },
            })
            break
          case "propose":
          case "confirm": {
            const kind = d.action === "propose" ? "deal_proposal" : "stage_confirmation"
            const action: DealCardProposal["action"] = d.action === "propose" ? "create" : d.confirmEffect ?? "move"
            const cardId = await insertDealCard(orgId, {
              kind,
              topicId: snap.id,
              proposal: proposalFor(d, action, d.action === "confirm" ? realId(d.dealId) : null),
              stageEntryCondition: targetStageCondition(d.stageId),
              score: snap.score,
              band: snap.band,
              leadCode: snap.leadCode,
              taxonomyVersion: snap.taxonomyVersion,
            })
            result.cardId = cardId
            if (!cardId) result.action = "skip"
            if (!cardId) result.reason = kind === "deal_proposal" ? "proposal_open" : "confirmation_open"
            break
          }
        }
      }
    } catch (e) {
      result.error = e instanceof Error ? e.message : String(e)
      failed.add(d.instanceId)
    }
    out.push({ ...d, result })
  }

  // Markers: one deal_decision event per instance (not for failed ones).
  const byInstance = new Map<string, DealDecisionResult[]>()
  for (const d of out) byInstance.set(d.instanceId, [...(byInstance.get(d.instanceId) ?? []), d.result])
  // An instance whose rules all skipped and one of them only waits for a
  // counterparty («no_counterparty») stays undecided: the hourly re-link may
  // resolve the client later (within the lookback).
  const retryOnly = (id: string) => {
    const rs = byInstance.get(id) ?? []
    return rs.some((r) => RETRY_REASONS.has(r.reason)) && rs.every((r) => r.action === "skip")
  }
  const rows = instances
    .filter((i) => !failed.has(i.id) && !retryOnly(i.id))
    .map((i) => ({
      id: randomUUID(),
      organizationId: orgId,
      topicId: snap.id,
      type: DEAL_DECISION_EVENT,
      actor: "agent",
      userId: octx.actor.userId,
      sourceItemId: i.itemId,
      payload: {
        instanceId: i.id,
        code: i.code,
        confidence: i.confidence,
        topicScore: snap.score,
        dryRun: octx.dryRun,
        results: byInstance.get(i.id) ?? [],
      },
    }))
  if (rows.length > 0) await db.insert(topicEvent).values(rows)
  return { topicId: snap.id, decisions: out, ...(failed.size ? { error: `${failed.size} instance(s) failed` } : {}) }
}

export async function loadOrgDealContext(
  orgId: string,
  actorUserId: string,
  dryRun: boolean,
): Promise<OrgDealContext | null> {
  const rules = await loadOrgStageRules(orgId)
  if (rules.length === 0) return null
  const [types, stages, params, book, reasons] = await Promise.all([
    ensureDefaultDealTypes(orgId),
    getOrgFunnel(orgId),
    getDealBridgeParams(orgId),
    loadCodeBook(orgId),
    getOutcomeReasons(orgId),
  ])
  return {
    orgId,
    actor: { kind: "agent", userId: actorUserId },
    dryRun,
    stages,
    stageLites: stageLite(stages),
    typeByCode: new Map(types.map((t) => [t.code, { id: t.id, labelRu: t.labelRu }])),
    rules,
    params,
    book,
    noGoReasons: reasons.noGo.map((r) => ({ code: r.code, label: r.label })),
  }
}

export async function runDealsPhase(ctx: TopicsPhaseContext): Promise<TopicsPhaseResult> {
  // 1) Stage rules (create / link / move by signal codes); 2) auto-link of
  // the remaining business topics to the client's open deal (spec
  // topics/10) — also for orgs without stage rules.
  const rules = await runStageRules(ctx)
  let link: Record<string, number>
  try {
    link = await runDealAutoLink(ctx.organizationId, ctx.actorUserId, ctx.mode)
  } catch (e) {
    console.error(`[topics:deals] org ${ctx.organizationId} auto-link:`, e)
    link = { linkErrors: 1 }
  }
  return "skipped" in rules ? { noStageRules: 1, ...link } : { ...rules, ...link }
}

async function runStageRules(ctx: TopicsPhaseContext): Promise<TopicsPhaseResult> {
  const orgId = ctx.organizationId
  const octx = await loadOrgDealContext(orgId, ctx.actorUserId, ctx.mode !== "on")
  if (!octx) return { skipped: "no stage rules" }
  const codes = [...new Set(octx.rules.map((r) => r.code))]
  const since = new Date(Date.now() - DEALS_LOOKBACK_DAYS * 86_400_000)
  const candidates = await selectCandidates(orgId, codes, since, octx.dryRun, DEALS_MAX_TOPICS_PER_RUN)
  const counts = {
    topics: candidates.size,
    instances: 0,
    created: 0,
    linked: 0,
    proposals: 0,
    moved: 0,
    confirmations: 0,
    outcomes: 0,
    paused: 0,
    context: 0,
    dryRun: 0,
    skipped: 0,
    errors: 0,
  }
  if (candidates.size === 0) return counts
  const topicRows = await db
    .select()
    .from(topic)
    .where(and(eq(topic.organizationId, orgId), inArray(topic.id, [...candidates.keys()])))
  const snaps = await hydrateTopics(topicRows)
  for (const snap of snaps) {
    const ids = candidates.get(snap.id) ?? new Set<string>()
    counts.instances += ids.size
    try {
      const res = await processTopicDeals(octx, snap, ids)
      if (res.error) counts.errors++
      for (const d of res.decisions) {
        const a = d.result.action
        if (d.result.error) continue
        if (a.endsWith(":dry_run")) counts.dryRun++
        else if (a === "create") counts.created++
        else if (a === "link") counts.linked++
        else if (a === "propose") counts.proposals++
        else if (a === "move") counts.moved++
        else if (a === "confirm") counts.confirmations++
        else if (a === "outcome") counts.outcomes++
        else if (a === "pause" || a === "resume") counts.paused++
        else if (a === "context") counts.context++
        else counts.skipped++
      }
    } catch (e) {
      counts.errors++
      console.error(`[topics:deals] org ${orgId} topic ${snap.id}:`, e)
    }
  }
  return counts
}

export type TopicDealsRunResult =
  | { skipped: string }
  | { dryRun: boolean; instances: number; decisions: { instanceId: string; code: string; ruleId: string; action: string; reason: string; error?: string }[] }

/**
 * Admin debug action («Темы (отладка)» → «Решить по сделке»): run the deal
 * bridge for ONE topic now (its undecided instances, no lookback). Follows the
 * org mode like the hourly run: `on` = real deal writes, otherwise a dry run.
 */
export async function runDealsForTopic(orgId: string, topicId: string): Promise<TopicDealsRunResult> {
  const { getTopicsMode } = await import("@/server/topics/mode")
  const { ensureSystemActor } = await import("@/server/topics/system-actor")
  const mode = await getTopicsMode(orgId)
  const actorUserId = await ensureSystemActor(orgId)
  const octx = await loadOrgDealContext(orgId, actorUserId, mode !== "on")
  if (!octx) return { skipped: "no stage rules" }
  const codes = [...new Set(octx.rules.map((r) => r.code))]
  const candidates = await selectCandidates(orgId, codes, new Date(0), octx.dryRun, 1, topicId)
  const ids = candidates.get(topicId)
  if (!ids || ids.size === 0) return { dryRun: octx.dryRun, instances: 0, decisions: [] }
  const rows = await db
    .select()
    .from(topic)
    .where(and(eq(topic.organizationId, orgId), eq(topic.id, topicId)))
  const [snap] = await hydrateTopics(rows)
  if (!snap) return { skipped: "topic not found" }
  const res = await processTopicDeals(octx, snap, ids)
  return {
    dryRun: octx.dryRun,
    instances: ids.size,
    decisions: res.decisions.map((d) => ({
      instanceId: d.instanceId,
      code: d.code,
      ruleId: d.ruleId,
      action: d.result.action,
      reason: d.result.reason,
      ...(d.result.error ? { error: d.result.error } : {}),
    })),
  }
}

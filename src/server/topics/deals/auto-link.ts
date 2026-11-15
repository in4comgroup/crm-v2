import "server-only"

import { randomUUID } from "node:crypto"
import { and, desc, eq, exists, gte, inArray, isNotNull, isNull, notExists, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { card, client, deal, signalInstance, topic, topicEvent } from "@/db/schema"
import { stageDisplayLabel } from "@/lib/deal-funnel"
import type { DealCardProposal } from "@/lib/topics/cards"
import { getOrgFunnel, isTerminalStage, linkTopicToDeal, OPEN_DEAL_STATUSES, type DealActor } from "@/server/deal-engine"
import { closeStaleDealLinkCards, insertDealCard } from "@/server/topics/cards/deal-cards"
import {
  decideDealLink,
  DEAL_LINK_EVENT,
  DEAL_LINK_FAMILIES,
  DEAL_LINK_LOOKBACK_DAYS,
  DEAL_LINK_MAX_TOPICS_PER_RUN,
  DEAL_LINK_TOPIC_STATUSES,
  type LinkDealOption,
} from "./link-rules"

// Step «auto-link» of the hourly phase «deals» (spec
// docs/specs/topics/10-deal-status-from-topics.md §3). Runs AFTER the stage
// rules (so a `create_deal` rule first gets the chance to create / link /
// propose), also for orgs without stage rules. Deterministic, no AI cost.
//
// Candidates: topics of the org with a client and no deal, family in
// DEAL_LINK_FAMILIES, status open / dormant / resolved, activity in the last
// 30 days, ≥ 1 counted signal instance, no person-made unlink, no open
// `deal_proposal` card; newest activity first, ≤ 100 per run. The PURE
// `decideDealLink` decides; every decision that acts writes ONE marker
// `topic_event` `deal_link_decision` { result, dealIds, dealId?, cardId?,
// dryRun }.
//   link (1 open deal)  → mode `on`: `linkTopicToDeal` as «Агент» (deal
//                         activity + deal state dirty) + journal `deal_linked`
//                         { auto: true }; mode `shadow`: dry-run marker only.
//   card (2+ open deals) → a `deal_link` card (an older open one is
//                         superseded); hidden in `shadow` like all deal cards.
// First, open `deal_link` cards whose topic got a deal are closed.

type Counts = { linkCandidates: number; autoLinked: number; linkCards: number; linkDryRun: number; linkErrors: number; linkCardsClosed: number }

const asBatch = (ops: unknown[]) => ops as unknown as Parameters<typeof db.batch>[0]

export async function runDealAutoLink(
  orgId: string,
  actorUserId: string,
  mode: "shadow" | "on",
  opts: { now?: Date; onlyTopicId?: string } = {},
): Promise<Counts> {
  const now = opts.now ?? new Date()
  const dryRun = mode !== "on"
  const counts: Counts = { linkCandidates: 0, autoLinked: 0, linkCards: 0, linkDryRun: 0, linkErrors: 0, linkCardsClosed: 0 }
  counts.linkCardsClosed = await closeStaleDealLinkCards(orgId, opts.onlyTopicId)

  const since = new Date(now.getTime() - DEAL_LINK_LOOKBACK_DAYS * 86_400_000)
  const rows = await db
    .select({
      id: topic.id,
      title: topic.title,
      clientId: topic.clientId,
      clientName: client.name,
      family: topic.family,
      status: topic.status,
      score: topic.score,
      band: topic.band,
      leadCode: topic.leadCode,
    })
    .from(topic)
    .leftJoin(client, eq(client.id, topic.clientId))
    .where(
      and(
        eq(topic.organizationId, orgId),
        isNull(topic.dealId),
        isNotNull(topic.clientId),
        inArray(topic.family, [...DEAL_LINK_FAMILIES]),
        inArray(topic.status, [...DEAL_LINK_TOPIC_STATUSES]),
        gte(topic.lastActivityAt, since),
        exists(
          db
            .select({ x: sql`1` })
            .from(signalInstance)
            .where(and(eq(signalInstance.topicId, topic.id), eq(signalInstance.counted, true))),
        ),
        notExists(
          db
            .select({ x: sql`1` })
            .from(topicEvent)
            .where(and(eq(topicEvent.topicId, topic.id), eq(topicEvent.type, "deal_unlinked"), eq(topicEvent.actor, "user"))),
        ),
        notExists(
          db
            .select({ x: sql`1` })
            .from(card)
            .where(and(eq(card.topicId, topic.id), eq(card.kind, "deal_proposal"), eq(card.status, "open"))),
        ),
        ...(opts.onlyTopicId ? [eq(topic.id, opts.onlyTopicId)] : []),
      ),
    )
    .orderBy(desc(topic.lastActivityAt))
    .limit(DEAL_LINK_MAX_TOPICS_PER_RUN)
  counts.linkCandidates = rows.length
  if (rows.length === 0) return counts

  const clientIds = [...new Set(rows.map((r) => r.clientId!))]
  const topicIds = rows.map((r) => r.id)
  const [stages, deals, markers, openLinkCards] = await Promise.all([
    getOrgFunnel(orgId),
    db
      .select({ id: deal.id, name: deal.name, clientId: deal.clientId, status: deal.status, stageId: deal.funnelStageId })
      .from(deal)
      .where(and(eq(deal.organizationId, orgId), inArray(deal.clientId, clientIds), inArray(deal.status, [...OPEN_DEAL_STATUSES]))),
    db
      .select({ topicId: topicEvent.topicId, payload: topicEvent.payload, createdAt: topicEvent.createdAt })
      .from(topicEvent)
      .where(and(eq(topicEvent.organizationId, orgId), inArray(topicEvent.topicId, topicIds), eq(topicEvent.type, DEAL_LINK_EVENT)))
      .orderBy(desc(topicEvent.createdAt)),
    db
      .select({ id: card.id, topicId: card.topicId })
      .from(card)
      .where(and(eq(card.organizationId, orgId), inArray(card.topicId, topicIds), eq(card.kind, "deal_link"), eq(card.status, "open"))),
  ])
  const stageById = new Map(stages.map((s) => [s.id, s]))
  const dealsByClient = new Map<string, LinkDealOption[]>()
  for (const d of deals) {
    const s = stageById.get(d.stageId)
    const list = dealsByClient.get(d.clientId) ?? []
    list.push({
      id: d.id,
      name: d.name,
      stageLabelRu: s ? stageDisplayLabel(s.name, s.displayName) : null,
      status: d.status === "paused" ? "paused" : "active",
      terminal: isTerminalStage(stages, d.stageId),
    })
    dealsByClient.set(d.clientId, list)
  }
  const lastMarker = new Map<string, { dealIds: string[]; dryRun: boolean }>()
  for (const m of markers) {
    if (!m.topicId || lastMarker.has(m.topicId)) continue
    const p = (m.payload ?? {}) as { dealIds?: unknown; dryRun?: unknown }
    lastMarker.set(m.topicId, {
      dealIds: Array.isArray(p.dealIds) ? p.dealIds.filter((x): x is string => typeof x === "string") : [],
      dryRun: p.dryRun === true,
    })
  }
  const openCardByTopic = new Map(openLinkCards.map((c) => [c.topicId!, c.id]))
  const actor: DealActor = { kind: "agent", userId: actorUserId }
  const linkedIds: string[] = []

  for (const t of rows) {
    const options = dealsByClient.get(t.clientId!) ?? []
    const decision = decideDealLink({
      family: t.family,
      status: t.status,
      hasCountedInstance: true,
      userUnlinked: false,
      openProposal: false,
      deals: options,
      lastMarker: lastMarker.get(t.id) ?? null,
      dryRun,
    })
    if (decision.action === "skip") continue
    const marker = (payload: Record<string, unknown>) =>
      db.insert(topicEvent).values({
        id: randomUUID(),
        organizationId: orgId,
        topicId: t.id,
        type: DEAL_LINK_EVENT,
        actor: "agent",
        userId: actorUserId,
        payload: { dealIds: decision.dealIds, dryRun, ...payload },
      })
    try {
      if (decision.action === "link") {
        if (dryRun) {
          await marker({ result: "dry_run", action: "link", dealId: decision.dealId })
          counts.linkDryRun++
          continue
        }
        const target = options.find((o) => o.id === decision.dealId)!
        await linkTopicToDeal(orgId, t.id, decision.dealId, actor, {
          topicId: t.id,
          note: "Тема привязана к единственной открытой сделке компании (автоматически)",
        })
        await db.batch(
          asBatch([
            marker({ result: "linked", dealId: decision.dealId }),
            db.insert(topicEvent).values({
              id: randomUUID(),
              organizationId: orgId,
              topicId: t.id,
              type: "deal_linked",
              actor: "agent",
              userId: actorUserId,
              payload: { dealId: decision.dealId, dealName: target.name, auto: true, reason: "single_open_deal" },
            }),
          ]),
        )
        counts.autoLinked++
        linkedIds.push(t.id)
        continue
      }
      // card: 2+ open deals — a person picks one.
      const old = openCardByTopic.get(t.id)
      if (old) {
        await db
          .update(card)
          .set({ status: "superseded" })
          .where(and(eq(card.organizationId, orgId), eq(card.id, old), eq(card.status, "open")))
      }
      const proposal: DealCardProposal = {
        v: 1,
        action: "link",
        ruleId: null,
        code: t.leadCode ?? "",
        codeLabelRu: "Тема без сделки",
        instanceId: null,
        sourceItemId: null,
        evidence: "",
        confidence: "high",
        topicScore: t.score ?? 0,
        reasonRu: `у компании ${decision.options.length} открытых сделок — выберите, к какой относится тема`,
        reasonCode: "several_open_deals",
        clientId: t.clientId,
        clientName: t.clientName ?? null,
        contactId: null,
        contactName: null,
        dealName: t.title ?? "Тема",
        dealTypeId: null,
        dealTypeCode: null,
        dealTypeLabelRu: null,
        stageId: null,
        stageLabelRu: null,
        fromStageId: null,
        fromStageLabelRu: null,
        dealId: null,
        dealOptions: decision.options.map((o) => ({ id: o.id, name: o.name, stageLabelRu: o.stageLabelRu, status: o.status })),
      }
      const cardId = await insertDealCard(orgId, {
        kind: "deal_link",
        topicId: t.id,
        proposal,
        score: t.score ?? null,
        band: t.band ?? null,
        leadCode: t.leadCode ?? null,
        taxonomyVersion: null,
      })
      await marker({ result: "card", cardId })
      counts.linkCards++
    } catch (e) {
      counts.linkErrors++
      console.error(`[topics:deals:auto-link] org ${orgId} topic ${t.id}:`, e)
    }
  }
  if (linkedIds.length > 0) {
    // Attention of the linked topics: the default assignee is the deal owner.
    try {
      const { recomputeTopicsAttention } = await import("@/server/topics/attention/store")
      await recomputeTopicsAttention(orgId, linkedIds, now)
    } catch (e) {
      console.error(`[topics:deals:auto-link] org ${orgId} attention:`, e)
    }
  }
  return counts
}

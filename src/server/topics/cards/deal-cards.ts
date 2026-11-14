import "server-only"

import { randomUUID } from "node:crypto"
import { and, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { card, cardClient, cardContact, topic, topicEvent } from "@/db/schema"
import {
  CARD_REJECT_REASON_LABELS_RU,
  isCardRejectReason,
  type DealCardProposal,
} from "@/lib/topics/cards"
import {
  createAgentDeal,
  DealEngineError,
  linkTopicToDeal,
  listOpenClientDeals,
  moveDealForward,
  pauseDeal,
  resumeDeal,
  setDealOutcome,
  type DealActor,
} from "@/server/deal-engine"
import { dealCardText } from "@/server/topics/deals/text"

// Deal cards of the deal bridge (topics plan phase 5, spec topics/01 §9.1):
// `deal_proposal` («Новая возможность?» → Создать / Не сделка) and
// `stage_confirmation` (Подтвердить / Отклонить). One OPEN card per topic and
// kind (partial unique index `card_topic_kind_open_uq`). Stored in `shadow`
// too; users see them only in mode `on` (`userCardFilter`). Org-explicit,
// `server-only`: the "use server" wrapper in src/server/cards.ts checks the
// session, the org and the card's visibility before calling the actions.

export type DealCardKind = "deal_proposal" | "stage_confirmation"

type BatchOps = Parameters<typeof db.batch>[0]
const asBatch = (ops: unknown[]) => ops as unknown as BatchOps

/** Kinds of the topic's open deal cards. */
export async function openDealCardKinds(orgId: string, topicId: string): Promise<Set<DealCardKind>> {
  const rows = await db
    .select({ kind: card.kind })
    .from(card)
    .where(
      and(
        eq(card.organizationId, orgId),
        eq(card.topicId, topicId),
        eq(card.status, "open"),
        inArray(card.kind, ["deal_proposal", "stage_confirmation"]),
      ),
    )
  return new Set(rows.map((r) => r.kind as DealCardKind))
}

/**
 * New open deal card. Returns null when the topic already has an open card
 * of this kind (unique index) — the engine then keeps the existing one.
 */
export async function insertDealCard(
  orgId: string,
  args: {
    kind: DealCardKind
    topicId: string
    proposal: DealCardProposal
    score: number | null
    band: string | null
    leadCode: string | null
    taxonomyVersion: number | null
  },
): Promise<string | null> {
  const id = randomUUID()
  const text = dealCardText(args.kind, args.proposal)
  const ops: unknown[] = [
    db.insert(card).values({
      id,
      organizationId: orgId,
      topicId: args.topicId,
      kind: args.kind,
      status: "open",
      accepted: false,
      priority: "normal",
      category: args.kind === "deal_proposal" ? "momentum" : "action_required",
      message: {
        analysis: text.analysis,
        recommendation: text.recommendation,
        taskTitle: text.taskTitle,
        dealCard: { headline: text.headline },
      },
      sourceItemId: args.proposal.sourceItemId,
      score: args.score,
      band: args.band,
      leadCode: args.leadCode,
      taxonomyVersion: args.taxonomyVersion,
      dealId: args.proposal.dealId,
      proposal: args.proposal,
    }),
  ]
  if (args.proposal.clientId) {
    ops.push(db.insert(cardClient).values({ cardId: id, clientId: args.proposal.clientId }).onConflictDoNothing())
  }
  if (args.proposal.contactId) {
    ops.push(db.insert(cardContact).values({ cardId: id, contactId: args.proposal.contactId }).onConflictDoNothing())
  }
  try {
    await db.batch(asBatch(ops))
    return id
  } catch (e) {
    if (String((e as { message?: string })?.message ?? e).includes("card_topic_kind_open_uq")) return null
    throw e
  }
}

/** Open proposals of a topic become `closed` (the deal now exists). */
export async function closeOpenDealProposals(orgId: string, topicId: string): Promise<number> {
  const rows = await db
    .update(card)
    .set({ status: "closed" })
    .where(
      and(eq(card.organizationId, orgId), eq(card.topicId, topicId), eq(card.kind, "deal_proposal"), eq(card.status, "open")),
    )
    .returning({ id: card.id })
  return rows.length
}

export function proposalOf(c: Pick<typeof card.$inferSelect, "proposal">): DealCardProposal | null {
  const p = c.proposal as DealCardProposal | null
  return p && typeof p === "object" && p.v === 1 && typeof p.action === "string" ? p : null
}

async function loadOpenDealCard(orgId: string, cardId: string) {
  const [c] = await db
    .select()
    .from(card)
    .where(and(eq(card.organizationId, orgId), eq(card.id, cardId)))
  if (!c) throw new DealEngineError("Card not found", "not_found")
  if (c.kind !== "deal_proposal" && c.kind !== "stage_confirmation") {
    throw new DealEngineError("Это не карточка сделки")
  }
  if (c.status !== "open") throw new DealEngineError("Card is no longer open")
  const p = proposalOf(c)
  if (!p) throw new DealEngineError("У карточки нет предложения")
  return { c, p }
}

function topicEventRow(orgId: string, topicId: string, type: string, userId: string, sourceItemId: string | null, payload: Record<string, unknown>) {
  return {
    id: randomUUID(),
    organizationId: orgId,
    topicId,
    type,
    actor: "user",
    userId,
    sourceItemId,
    payload,
  }
}

/**
 * «Создать» (deal_proposal) / «Подтвердить» (stage_confirmation) by a person.
 * Proposal: creates the deal of the proposed type (or links the client's
 * open deal of that type, spec §9.2 dedupe), links the topic, journals.
 * Confirmation: moves the stage / sets the outcome / pauses, journaled with
 * the rule id, topic and evidence. The card becomes `accepted`.
 */
export async function acceptDealCard(
  orgId: string,
  cardId: string,
  userId: string,
): Promise<{ dealId: string; linked?: boolean }> {
  const { c, p } = await loadOpenDealCard(orgId, cardId)
  const actor: DealActor = { kind: "user", userId }
  const prov = {
    topicId: c.topicId,
    sourceItemId: p.sourceItemId,
    ruleId: p.ruleId,
    evidence: p.evidence,
  }
  let dealId: string
  let linked = false
  if (c.kind === "deal_proposal") {
    if (!p.clientId) throw new DealEngineError("Сначала привяжите тему к компании — сделка без компании невозможна")
    if (c.topicId) {
      const [t] = await db
        .select({ dealId: topic.dealId })
        .from(topic)
        .where(and(eq(topic.organizationId, orgId), eq(topic.id, c.topicId)))
      if (t?.dealId) throw new DealEngineError("Тема уже привязана к сделке")
    }
    const open = await listOpenClientDeals(orgId, p.clientId)
    const same = open.find((d) => (d.dealTypeId ?? null) === (p.dealTypeId ?? null))
    if (same && c.topicId) {
      await linkTopicToDeal(orgId, c.topicId, same.id, actor, {
        ...prov,
        note: "Тема привязана к открытой сделке того же типа (предложение агента)",
      })
      dealId = same.id
      linked = true
    } else {
      if (!p.stageId) throw new DealEngineError("В предложении нет стадии")
      const res = await createAgentDeal(
        orgId,
        {
          clientId: p.clientId,
          dealTypeId: p.dealTypeId,
          stageId: p.stageId,
          name: p.dealName,
          topicId: c.topicId,
          contactIds: p.contactId ? [p.contactId] : [],
          createdByAgent: false,
          provenance: { ...prov, note: `Создана по предложению агента: ${p.codeLabelRu}` },
        },
        actor,
      )
      dealId = res.id
    }
  } else {
    if (!p.dealId) throw new DealEngineError("В карточке нет сделки")
    dealId = p.dealId
    const note = `Подтверждено пользователем: ${p.codeLabelRu}`
    switch (p.action) {
      case "move": {
        if (!p.stageId) throw new DealEngineError("В карточке нет стадии")
        const r = await moveDealForward(orgId, dealId, p.stageId, actor, { ...prov, note })
        if (!r.moved) throw new DealEngineError("Сделка уже на этой стадии или дальше")
        break
      }
      case "outcome_won":
      case "outcome_lost":
        await setDealOutcome(orgId, dealId, p.action === "outcome_won" ? "won" : "lost", actor, {
          ...prov,
          note,
          stageId: p.stageId,
          reason: p.evidence,
        })
        break
      case "pause":
        await pauseDeal(orgId, dealId, actor, { ...prov, note, reason: p.evidence })
        break
      case "resume":
        await resumeDeal(orgId, dealId, actor, { ...prov, note })
        break
      default:
        throw new DealEngineError("Неизвестное действие карточки")
    }
  }
  const ops: unknown[] = [
    db
      .update(card)
      .set({
        status: "accepted",
        accepted: true,
        rejectionReason: null,
        rejectReasonCode: null,
        decidedAt: new Date(),
        decidedByUserId: userId,
        dealId,
      })
      .where(and(eq(card.organizationId, orgId), eq(card.id, cardId), eq(card.status, "open"))),
  ]
  if (c.topicId) {
    ops.push(
      db.insert(topicEvent).values(
        topicEventRow(orgId, c.topicId, c.kind === "deal_proposal" ? "deal_proposal_accepted" : "stage_confirmed", userId, p.sourceItemId, {
          cardId,
          dealId,
          action: p.action,
          ruleId: p.ruleId,
          linked,
        }),
      ),
    )
  }
  await db.batch(asBatch(ops))
  return { dealId, linked }
}

/**
 * «Не сделка» / «Отклонить»: the card becomes `rejected` with the reason
 * code + text (kept for evaluation) and the topic journal gets an event.
 */
export async function rejectDealCard(
  orgId: string,
  cardId: string,
  userId: string,
  reasonCode: string,
  text?: string | null,
): Promise<void> {
  const { c, p } = await loadOpenDealCard(orgId, cardId)
  if (!isCardRejectReason(reasonCode)) throw new DealEngineError("Rejection reason code is required")
  const trimmed = text?.trim() ?? ""
  const ops: unknown[] = [
    db
      .update(card)
      .set({
        status: "rejected",
        accepted: false,
        rejectionReason: trimmed || CARD_REJECT_REASON_LABELS_RU[reasonCode],
        rejectReasonCode: reasonCode,
        decidedAt: new Date(),
        decidedByUserId: userId,
      })
      .where(and(eq(card.organizationId, orgId), eq(card.id, cardId), eq(card.status, "open"))),
  ]
  if (c.topicId) {
    ops.push(
      db.insert(topicEvent).values(
        topicEventRow(orgId, c.topicId, c.kind === "deal_proposal" ? "deal_proposal_rejected" : "stage_confirmation_rejected", userId, p.sourceItemId, {
          cardId,
          action: p.action,
          ruleId: p.ruleId,
          reasonCode,
          reason: trimmed || null,
        }),
      ),
    )
  }
  await db.batch(asBatch(ops))
}

/** Count of deal cards per kind and status (debug header). */
export async function countDealCards(orgId: string): Promise<Record<string, Record<string, number>>> {
  const rows = await db
    .select({ kind: card.kind, status: card.status, n: sql<number>`count(*)::int` })
    .from(card)
    .where(and(eq(card.organizationId, orgId), inArray(card.kind, ["deal_proposal", "stage_confirmation"])))
    .groupBy(card.kind, card.status)
  const out: Record<string, Record<string, number>> = {}
  for (const r of rows) {
    if (!r.kind || !r.status) continue
    out[r.kind] = { ...(out[r.kind] ?? {}), [r.status]: r.n }
  }
  return out
}

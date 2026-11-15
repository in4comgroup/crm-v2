import "server-only"

import { randomUUID } from "node:crypto"
import { and, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { card, cardClient, cardContact, topic, topicEvent } from "@/db/schema"
import {
  CARD_REJECT_REASON_LABELS_RU,
  isCardRejectReason,
  type DealCardKind,
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

export type { DealCardKind } from "@/lib/topics/cards"
const DEAL_CARD_KINDS: DealCardKind[] = ["deal_proposal", "stage_confirmation", "deal_link"]

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
        inArray(card.kind, DEAL_CARD_KINDS),
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

/**
 * Open `deal_link` cards become `closed` when their topic already has a deal
 * (linked by a person, by the rules or by the auto-link step) or is no
 * longer live (spec topics/10 §3). `topicId` limits it to one topic.
 */
export async function closeStaleDealLinkCards(orgId: string, topicId?: string): Promise<number> {
  const rows = await db
    .update(card)
    .set({ status: "closed" })
    .where(
      and(
        eq(card.organizationId, orgId),
        eq(card.kind, "deal_link"),
        eq(card.status, "open"),
        ...(topicId ? [eq(card.topicId, topicId)] : []),
        sql`exists (select 1 from ${topic} t where t.id = ${card.topicId} and (t.deal_id is not null or t.status in ('merged','dismissed','archived','expired')))`,
      ),
    )
    .returning({ id: card.id })
  return rows.length
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
  if (!DEAL_CARD_KINDS.includes(c.kind as DealCardKind)) {
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
  opts: { dealId?: string | null } = {},
): Promise<{ dealId: string; linked?: boolean }> {
  const { c, p } = await loadOpenDealCard(orgId, cardId)
  if (c.kind === "deal_link") return acceptDealLinkCard(orgId, c, p, userId, opts.dealId ?? null)
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
 * «Связать» on a `deal_link` card (spec topics/10 §3): the person picks one
 * of the card's deals; it must still be an open deal of the topic's client.
 * Links through `setTopicDeal` (deal activity + dirty state + the topic
 * journal line `deal_linked` + attention), then the card is `accepted`.
 */
async function acceptDealLinkCard(
  orgId: string,
  c: typeof card.$inferSelect,
  p: DealCardProposal,
  userId: string,
  dealId: string | null,
): Promise<{ dealId: string; linked: boolean }> {
  if (!c.topicId) throw new DealEngineError("У карточки нет темы")
  if (!dealId || !(p.dealOptions ?? []).some((o) => o.id === dealId)) {
    throw new DealEngineError("Выберите сделку из списка")
  }
  const [t] = await db
    .select({ dealId: topic.dealId, clientId: topic.clientId })
    .from(topic)
    .where(and(eq(topic.organizationId, orgId), eq(topic.id, c.topicId)))
  if (!t) throw new DealEngineError("Тема не найдена", "not_found")
  if (t.dealId) throw new DealEngineError("Тема уже привязана к сделке")
  const open = t.clientId ? await listOpenClientDeals(orgId, t.clientId) : []
  if (!open.some((d) => d.id === dealId)) throw new DealEngineError("Сделка уже закрыта или относится к другой компании")
  const { setTopicDeal } = await import("@/server/topics/topic-store")
  await setTopicDeal(orgId, c.topicId, dealId, userId)
  await db.batch(
    asBatch([
      db
        .update(card)
        .set({ status: "accepted", accepted: true, decidedAt: new Date(), decidedByUserId: userId, dealId })
        .where(and(eq(card.organizationId, orgId), eq(card.id, c.id), eq(card.status, "open"))),
      db.insert(topicEvent).values(
        topicEventRow(orgId, c.topicId, "deal_link_accepted", userId, p.sourceItemId, { cardId: c.id, dealId }),
      ),
    ]),
  )
  return { dealId, linked: true }
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
        topicEventRow(
          orgId,
          c.topicId,
          c.kind === "deal_proposal"
            ? "deal_proposal_rejected"
            : c.kind === "deal_link"
              ? "deal_link_rejected"
              : "stage_confirmation_rejected",
          userId,
          p.sourceItemId,
          {
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
    .where(and(eq(card.organizationId, orgId), inArray(card.kind, DEAL_CARD_KINDS)))
    .groupBy(card.kind, card.status)
  const out: Record<string, Record<string, number>> = {}
  for (const r of rows) {
    if (!r.kind || !r.status) continue
    out[r.kind] = { ...(out[r.kind] ?? {}), [r.status]: r.n }
  }
  return out
}

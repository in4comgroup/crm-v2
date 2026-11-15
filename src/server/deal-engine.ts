import "server-only"

import { randomUUID } from "node:crypto"
import { and, asc, desc, eq, inArray, isNotNull, ne, or, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import {
  client,
  contact,
  deal,
  dealActivity,
  dealContact,
  dealFunnelStage,
  dealRisk,
  dealType,
  member,
  order,
  signalStageRule,
  source,
  sourceItem,
  sourceItemSubject,
  topic,
  topicEvent,
  topicItem,
  user,
  type DealStatus,
} from "@/db/schema"
import { computePosition } from "@/lib/kanban-move"
import { getOrgSetting } from "@/server/org-settings"
import { getPlatformSetting } from "@/server/platform-settings"

// Org-explicit deal helpers of the topics engine (plan phase 5, spec
// topics/01 §9.2). `server-only`, NOT "use server": every function takes the
// org id (and the actor) as parameters and checks that the rows belong to
// that org; the caller (topics phase, card action route, deals route)
// checks the session / role. Same table semantics as the session-bound
// src/server/deals.ts: funnel stages org-or-system, `deal_activity` journal
// on every write, kanban `position` appended to the target column.
//
// Every write journals one `deal_activity` row with the provenance
// (topic_id, source_item_id, rule_id, evidence). Non-move events (pause,
// resume, undo, link) are journaled with from = to = the current stage and
// the meaning in `note`.

// ── Types ─────────────────────────────────────────────────────────────────

/** Who acts: the org's system actor «Агент» (topics engine) or a person. */
export type DealActor = { kind: "agent" | "user"; userId: string }

/** Provenance of one engine write (spec §9.2: rule id, topic, evidence). */
export type DealProvenance = {
  topicId?: string | null
  sourceItemId?: string | null
  ruleId?: string | null
  evidence?: string | null
  note?: string | null
}

export type DealOutcome = "won" | "lost" | "withdrawn"

/** Status values in which a deal is «open» (auto-create dedupe, spec §9.2). */
export const OPEN_DEAL_STATUSES: readonly DealStatus[] = ["active", "paused"]

export class DealEngineError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "forbidden" | "invalid" = "invalid",
  ) {
    super(message)
    this.name = "DealEngineError"
  }
}

export type OrgFunnelStage = {
  id: string
  name: string
  displayName: string | null
  sortOrder: number
  isPrePipeline: boolean
  isHidden: boolean
  closureProbability: number
}

// ── Funnel ────────────────────────────────────────────────────────────────

/**
 * The org's funnel, org-or-system (same rule as `listDealFunnelStages` in
 * src/server/deals.ts): active org-owned stages if any exist, else the
 * active system stages. Ordered by sort order.
 */
export async function getOrgFunnel(orgId: string): Promise<OrgFunnelStage[]> {
  const cols = {
    id: dealFunnelStage.id,
    name: dealFunnelStage.name,
    displayName: dealFunnelStage.displayName,
    sortOrder: dealFunnelStage.sortOrder,
    isPrePipeline: dealFunnelStage.isPrePipeline,
    isHidden: dealFunnelStage.isHidden,
    closureProbability: dealFunnelStage.closureProbability,
  }
  const map = (rows: { closureProbability: string }[]) =>
    rows.map((r) => ({ ...r, closureProbability: Number(r.closureProbability) })) as OrgFunnelStage[]
  const orgRows = await db
    .select(cols)
    .from(dealFunnelStage)
    .where(
      and(
        eq(dealFunnelStage.isActive, true),
        eq(dealFunnelStage.isSystem, false),
        eq(dealFunnelStage.ownerOrganizationId, orgId),
      ),
    )
    .orderBy(asc(dealFunnelStage.sortOrder), asc(dealFunnelStage.name))
  if (orgRows.length > 0) return map(orgRows)
  const sys = await db
    .select(cols)
    .from(dealFunnelStage)
    .where(and(eq(dealFunnelStage.isActive, true), eq(dealFunnelStage.isSystem, true)))
    .orderBy(asc(dealFunnelStage.sortOrder), asc(dealFunnelStage.name))
  return map(sys)
}

/**
 * Terminal stages by meaning: won = «Closed», lost = «Rejected» (the
 * board's terminal columns are keyed by `name`, never renamed — see
 * `deal_funnel_stage.display_name`).
 */
export function outcomeStage(stages: readonly OrgFunnelStage[], outcome: "won" | "lost"): OrgFunnelStage | null {
  const name = outcome === "won" ? "closed" : "rejected"
  return stages.find((s) => s.name.trim().toLowerCase() === name) ?? null
}

/** Won / lost stage of the org funnel («Closed» / «Rejected»). */
export function isTerminalStage(stages: readonly OrgFunnelStage[], stageId: string): boolean {
  return isTerminal(stages, stageId)
}

function isTerminal(stages: readonly OrgFunnelStage[], stageId: string): boolean {
  return stageId === outcomeStage(stages, "won")?.id || stageId === outcomeStage(stages, "lost")?.id
}

// ── Settings (spec §9.2, 06 §13; ladder org → platform → default) ────────

export type DealBridgeParams = {
  autoCreateEnabled: boolean
  autoCreateMinScore: number
  autoCreateMinConfidence: "low" | "medium" | "high"
  proposalMinScore: number
}

export async function getDealBridgeParams(orgId: string): Promise<DealBridgeParams> {
  const [oe, os, oc, op, pe, ps, pc, pp] = await Promise.all([
    getOrgSetting(orgId, "deals.autoCreateEnabled"),
    getOrgSetting(orgId, "deals.autoCreateMinScore"),
    getOrgSetting(orgId, "deals.autoCreateMinConfidence"),
    getOrgSetting(orgId, "deals.proposalMinScore"),
    getPlatformSetting("deals.autoCreateEnabled"),
    getPlatformSetting("deals.autoCreateMinScore"),
    getPlatformSetting("deals.autoCreateMinConfidence"),
    getPlatformSetting("deals.proposalMinScore"),
  ])
  return {
    autoCreateEnabled: oe ?? pe,
    autoCreateMinScore: os ?? ps,
    autoCreateMinConfidence: oc ?? pc,
    proposalMinScore: op ?? pp,
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────

type DealRowLite = {
  id: string
  name: string
  clientId: string
  funnelStageId: string
  status: DealStatus
  createdByAgent: boolean
  dealTypeId: string | null
}

async function loadDeal(orgId: string, dealId: string): Promise<DealRowLite> {
  const [d] = await db
    .select({
      id: deal.id,
      name: deal.name,
      clientId: deal.clientId,
      funnelStageId: deal.funnelStageId,
      status: deal.status,
      createdByAgent: deal.createdByAgent,
      dealTypeId: deal.dealTypeId,
    })
    .from(deal)
    .where(and(eq(deal.id, dealId), eq(deal.organizationId, orgId)))
    .limit(1)
  if (!d) throw new DealEngineError("Сделка не найдена", "not_found")
  return d
}

/** Kanban key that appends a deal to the end of a column. */
async function appendPosition(orgId: string, stageId: string): Promise<string | null> {
  const [last] = await db
    .select({ position: deal.position })
    .from(deal)
    .where(and(eq(deal.organizationId, orgId), eq(deal.funnelStageId, stageId), isNotNull(deal.position)))
    .orderBy(desc(deal.position))
    .limit(1)
  try {
    return computePosition(last?.position ?? null, null)
  } catch {
    return null
  }
}

function activityRow(
  dealId: string,
  actor: DealActor,
  fromStageId: string | null,
  toStageId: string | null,
  prov: DealProvenance,
) {
  return {
    id: randomUUID(),
    dealId,
    actor: actor.kind,
    actorUserId: actor.userId,
    fromStageId,
    toStageId,
    note: prov.note?.trim() || null,
    topicId: prov.topicId ?? null,
    sourceItemId: prov.sourceItemId ?? null,
    ruleId: prov.ruleId ?? null,
    evidence: prov.evidence?.trim() || null,
  }
}

type BatchOps = Parameters<typeof db.batch>[0]
const asBatch = (ops: unknown[]) => ops as unknown as BatchOps

// Phase 5a hooks (spec §9.3 R16, §9.4): every deal write here marks the deal
// state dirty (`state_dirty_at`, the «dealState» phase re-runs the text after
// the debounce); an outcome / undo clears the deal's active risks (journaled
// by the deal activity row of the same batch) and marks their topics due for
// the attention engine (I5 ends).
const DIRTY = () => ({ stateDirtyAt: new Date() })

function clearRisksOnOutcomeOps(orgId: string, dealId: string, reason: string): unknown[] {
  const now = new Date()
  return [
    db
      .update(topic)
      .set({ nextAttentionCheckAt: now })
      .where(
        and(
          eq(topic.organizationId, orgId),
          sql`${topic.id} in (select ${dealRisk.topicId} from ${dealRisk} where ${dealRisk.dealId} = ${dealId} and ${dealRisk.status} = 'active' and ${dealRisk.topicId} is not null)`,
        ),
      ),
    db
      .update(dealRisk)
      .set({ status: "cleared", clearedAt: now, clearedBy: "outcome", clearedReason: reason.slice(0, 1000) })
      .where(and(eq(dealRisk.organizationId, orgId), eq(dealRisk.dealId, dealId), eq(dealRisk.status, "active"))),
  ]
}

/**
 * Owner of an agent-created deal (spec §9.2 says «actor = system agent
 * user»; the owner must be a person). Rule, first that applies:
 * 1. the topic's assignee (`topic.owner_user_id`) when it is a member;
 * 2. the client's responsible member («Ответственный»,
 *    `client.responsible_user_id`, 06 §7.2) when still a member of the org;
 * 3. the client's creator (`client.user_id`) when still a member of the org;
 * 4. the org owner (oldest `member` with role `owner`), else the oldest member.
 * Agent users (`role = 'agent'`) are never owners.
 */
export async function resolveDealOwner(
  orgId: string,
  opts: { clientId?: string | null; topicOwnerUserId?: string | null },
): Promise<string | null> {
  const members = await db
    .select({ userId: member.userId, role: member.role, createdAt: member.createdAt, userRole: user.role })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, orgId))
    .orderBy(asc(member.createdAt))
  const humans = members.filter((m) => m.userRole !== "agent")
  const isMember = (id: string | null | undefined) => !!id && humans.some((m) => m.userId === id)
  if (isMember(opts.topicOwnerUserId)) return opts.topicOwnerUserId!
  if (opts.clientId) {
    const [c] = await db
      .select({ userId: client.userId, responsibleUserId: client.responsibleUserId })
      .from(client)
      .where(and(eq(client.id, opts.clientId), eq(client.organizationId, orgId)))
    if (isMember(c?.responsibleUserId)) return c!.responsibleUserId!
    if (isMember(c?.userId)) return c!.userId
  }
  return humans.find((m) => m.role === "owner")?.userId ?? humans[0]?.userId ?? null
}

// ── Create ────────────────────────────────────────────────────────────────

export type CreateAgentDealInput = {
  clientId: string
  dealTypeId: string | null
  stageId: string
  /** Deal name (the engine passes the topic title). */
  name: string
  description?: string | null
  /** Topic to link (`topic.deal_id`). */
  topicId?: string | null
  contactIds?: string[]
  /** Owner; default by `resolveDealOwner`. */
  ownerUserId?: string | null
  /** true for the engine (badge «создал агент»); false when a person accepts a proposal. */
  createdByAgent: boolean
  provenance?: DealProvenance
}

/**
 * Creates a deal for the org (engine auto-create or «Создать» on a
 * `deal_proposal` card). Links `topic.deal_id` and journals the creation.
 */
export async function createAgentDeal(
  orgId: string,
  input: CreateAgentDealInput,
  actor: DealActor,
): Promise<{ id: string }> {
  const name = input.name.trim().slice(0, 200)
  if (!name) throw new DealEngineError("Название сделки пустое")
  const [c] = await db
    .select({ id: client.id, currency: client.currency })
    .from(client)
    .where(and(eq(client.id, input.clientId), eq(client.organizationId, orgId)))
  if (!c) throw new DealEngineError("Клиент не найден", "not_found")
  const stages = await getOrgFunnel(orgId)
  const stage = stages.find((s) => s.id === input.stageId)
  if (!stage) throw new DealEngineError("Стадия не принадлежит воронке организации")
  if (input.dealTypeId) {
    const [t] = await db
      .select({ id: dealType.id })
      .from(dealType)
      .where(and(eq(dealType.id, input.dealTypeId), eq(dealType.organizationId, orgId)))
    if (!t) throw new DealEngineError("Тип сделки не найден")
  }
  let topicOwner: string | null = null
  if (input.topicId) {
    const [t] = await db
      .select({ id: topic.id, ownerUserId: topic.ownerUserId })
      .from(topic)
      .where(and(eq(topic.id, input.topicId), eq(topic.organizationId, orgId)))
    if (!t) throw new DealEngineError("Тема не найдена", "not_found")
    topicOwner = t.ownerUserId
  }
  const owner =
    input.ownerUserId ??
    (actor.kind === "user" ? actor.userId : null) ??
    (await resolveDealOwner(orgId, { clientId: input.clientId, topicOwnerUserId: topicOwner }))
  if (!owner) throw new DealEngineError("Нет владельца для сделки (в организации нет участников)")

  const contactIds = input.contactIds?.length
    ? (
        await db
          .select({ id: contact.id })
          .from(contact)
          .where(and(eq(contact.organizationId, orgId), inArray(contact.id, [...new Set(input.contactIds)])))
      ).map((r) => r.id)
    : []

  const id = randomUUID()
  const position = await appendPosition(orgId, stage.id)
  const ops: unknown[] = [
    db.insert(deal).values({
      id,
      name,
      description: input.description?.trim() || null,
      funnelStageId: stage.id,
      clientId: c.id,
      currency: c.currency ?? "RUB",
      status: "active",
      position,
      dealTypeId: input.dealTypeId,
      createdByAgent: input.createdByAgent,
      lastMovedBy: actor.kind,
      ...DIRTY(),
      userId: owner,
      organizationId: orgId,
    }),
  ]
  if (contactIds.length > 0) {
    ops.push(db.insert(dealContact).values(contactIds.map((contactId) => ({ dealId: id, contactId }))).onConflictDoNothing())
  }
  ops.push(db.insert(dealActivity).values(activityRow(id, actor, null, stage.id, input.provenance ?? {})))
  if (input.topicId) {
    ops.push(
      db
        .update(topic)
        .set({ dealId: id, nextAttentionCheckAt: new Date() })
        .where(and(eq(topic.id, input.topicId), eq(topic.organizationId, orgId))),
    )
  }
  await db.batch(asBatch(ops))
  return { id }
}

/** Links a topic to an existing deal of the org (journaled on the deal). */
export async function linkTopicToDeal(
  orgId: string,
  topicId: string,
  dealId: string,
  actor: DealActor,
  prov: DealProvenance = {},
): Promise<void> {
  const d = await loadDeal(orgId, dealId)
  const [t] = await db
    .select({ id: topic.id, dealId: topic.dealId })
    .from(topic)
    .where(and(eq(topic.id, topicId), eq(topic.organizationId, orgId)))
  if (!t) throw new DealEngineError("Тема не найдена", "not_found")
  if (t.dealId === dealId) return
  await db.batch(
    asBatch([
      db
        .update(topic)
        .set({ dealId, nextAttentionCheckAt: new Date() })
        .where(and(eq(topic.id, topicId), eq(topic.organizationId, orgId))),
      db
        .update(deal)
        .set({ ...DIRTY(), updatedAt: sql`${deal.updatedAt}` })
        .where(and(eq(deal.id, dealId), eq(deal.organizationId, orgId))),
      db.insert(dealActivity).values(
        activityRow(dealId, actor, d.funnelStageId, d.funnelStageId, {
          ...prov,
          topicId,
          note: prov.note ?? "Тема привязана к сделке",
        }),
      ),
    ]),
  )
}

// ── Stage moves ───────────────────────────────────────────────────────────

/**
 * Forward-only stage move (spec §9.2: skip allowed, never backward; a
 * terminal stage is reached only by `setDealOutcome`). Only `active` deals
 * move. Returns `{ moved: false }` when the deal is already at / past the
 * target stage.
 */
export async function moveDealForward(
  orgId: string,
  dealId: string,
  toStageId: string,
  actor: DealActor,
  prov: DealProvenance = {},
): Promise<{ moved: boolean; fromStageId: string }> {
  const d = await loadDeal(orgId, dealId)
  if (d.status !== "active") throw new DealEngineError("Двигать можно только активную сделку")
  const stages = await getOrgFunnel(orgId)
  const from = stages.find((s) => s.id === d.funnelStageId)
  const to = stages.find((s) => s.id === toStageId)
  if (!to) throw new DealEngineError("Стадия не принадлежит воронке организации")
  if (to.isPrePipeline) throw new DealEngineError("В «Контакт до запроса» сделку не переводят")
  if (isTerminal(stages, to.id)) throw new DealEngineError("Финальная стадия ставится только итогом сделки")
  if (from && isTerminal(stages, from.id)) return { moved: false, fromStageId: d.funnelStageId }
  if (from && to.sortOrder <= from.sortOrder) return { moved: false, fromStageId: d.funnelStageId }
  const position = await appendPosition(orgId, to.id)
  await db.batch(
    asBatch([
      db
        .update(deal)
        .set({
          funnelStageId: to.id,
          lastMovedBy: actor.kind,
          changes: prov.note?.trim() || null,
          ...DIRTY(),
          ...(position ? { position } : {}),
        })
        .where(and(eq(deal.id, dealId), eq(deal.organizationId, orgId))),
      db.insert(dealActivity).values(activityRow(dealId, actor, d.funnelStageId, to.id, prov)),
    ]),
  )
  return { moved: true, fromStageId: d.funnelStageId }
}

/**
 * Deal outcome (spec §9.2). `won` / `lost` → the terminal stage by meaning
 * (backward moves are allowed only here), status stays `active` (the
 * terminal column is the visible outcome). `withdrawn` (the org decided to
 * stop) is set ONLY by a person → status `cancelled`. The reason is kept in
 * `outcome_reason`.
 */
export async function setDealOutcome(
  orgId: string,
  dealId: string,
  outcome: DealOutcome,
  actor: DealActor,
  opts: DealProvenance & { reason?: string | null; stageId?: string | null } = {},
): Promise<{ fromStageId: string; toStageId: string }> {
  if (outcome === "withdrawn" && actor.kind !== "user") {
    throw new DealEngineError("Итог «Отказались мы» ставит только пользователь", "forbidden")
  }
  const d = await loadDeal(orgId, dealId)
  if (d.status === "deleted" || d.status === "cancelled") throw new DealEngineError("Сделка уже закрыта")
  const reason = (opts.reason ?? opts.evidence ?? "").trim() || null
  if (outcome === "withdrawn") {
    await db.batch(
      asBatch([
        db
          .update(deal)
          .set({ status: "cancelled", outcomeReason: reason, pausedUntil: null, pauseReason: null, ...DIRTY() })
          .where(and(eq(deal.id, dealId), eq(deal.organizationId, orgId))),
        ...clearRisksOnOutcomeOps(orgId, dealId, "Итог сделки: отказались мы"),
        db.insert(dealActivity).values(
          activityRow(dealId, actor, d.funnelStageId, d.funnelStageId, {
            ...opts,
            note: opts.note ?? `Итог: отказались мы${reason ? ` — ${reason}` : ""}`,
          }),
        ),
      ]),
    )
    return { fromStageId: d.funnelStageId, toStageId: d.funnelStageId }
  }
  const stages = await getOrgFunnel(orgId)
  const target = opts.stageId ? stages.find((s) => s.id === opts.stageId) : outcomeStage(stages, outcome)
  if (!target) throw new DealEngineError(`В воронке нет стадии для итога «${outcome}»`)
  const position = await appendPosition(orgId, target.id)
  await db.batch(
    asBatch([
      db
        .update(deal)
        .set({
          funnelStageId: target.id,
          status: "active",
          outcomeReason: reason,
          pausedUntil: null,
          pauseReason: null,
          lastMovedBy: actor.kind,
          changes: opts.note?.trim() || null,
          ...DIRTY(),
          ...(position ? { position } : {}),
        })
        .where(and(eq(deal.id, dealId), eq(deal.organizationId, orgId))),
      ...clearRisksOnOutcomeOps(orgId, dealId, outcome === "won" ? "Итог сделки: выиграна" : "Итог сделки: проиграна"),
      db.insert(dealActivity).values(
        activityRow(dealId, actor, d.funnelStageId, target.id, {
          ...opts,
          note: opts.note ?? (outcome === "won" ? "Итог: выиграна" : "Итог: проиграна"),
        }),
      ),
    ]),
  )
  return { fromStageId: d.funnelStageId, toStageId: target.id }
}

// ── Pause / resume ────────────────────────────────────────────────────────

/** `paused` is a status, not a stage (spec §9.2): the deal keeps its stage. */
export async function pauseDeal(
  orgId: string,
  dealId: string,
  actor: DealActor,
  opts: { until?: Date | null; reason?: string | null } & DealProvenance = {},
): Promise<void> {
  const d = await loadDeal(orgId, dealId)
  if (d.status !== "active" && d.status !== "paused") throw new DealEngineError("Приостановить можно только открытую сделку")
  const reason = opts.reason?.trim() || null
  const until = opts.until ?? null
  await db.batch(
    asBatch([
      db
        .update(deal)
        .set({ status: "paused", pausedUntil: until, pauseReason: reason, ...DIRTY() })
        .where(and(eq(deal.id, dealId), eq(deal.organizationId, orgId))),
      db.insert(dealActivity).values(
        activityRow(dealId, actor, d.funnelStageId, d.funnelStageId, {
          ...opts,
          note:
            opts.note ??
            `Пауза${until ? ` до ${until.toISOString().slice(0, 10)}` : ""}${reason ? ` — ${reason}` : ""}`,
        }),
      ),
    ]),
  )
}

export async function resumeDeal(
  orgId: string,
  dealId: string,
  actor: DealActor,
  opts: DealProvenance = {},
): Promise<void> {
  const d = await loadDeal(orgId, dealId)
  if (d.status !== "paused") return
  await db.batch(
    asBatch([
      db
        .update(deal)
        .set({ status: "active", pausedUntil: null, pauseReason: null, ...DIRTY() })
        .where(and(eq(deal.id, dealId), eq(deal.organizationId, orgId))),
      db.insert(dealActivity).values(
        activityRow(dealId, actor, d.funnelStageId, d.funnelStageId, { ...opts, note: opts.note ?? "Пауза снята" }),
      ),
    ]),
  )
}

// ── Undo («создал агент» → Отменить) ──────────────────────────────────────

/**
 * Undo of an agent-created deal (spec §9.2): status `deleted`, the reason is
 * kept in `outcome_reason`, journaled. The deal's topics are unlinked
 * (`topic.deal_id` = null) and get a `deal_undone` event, so the engine
 * never re-creates a deal from the same instances (their decision markers
 * stay). Throws for a deal a person created.
 */
export async function undoAgentDeal(
  orgId: string,
  dealId: string,
  userId: string,
  reason?: string | null,
): Promise<void> {
  const d = await loadDeal(orgId, dealId)
  if (!d.createdByAgent) throw new DealEngineError("Отменить можно только сделку, которую создал агент", "forbidden")
  if (d.status === "deleted") return
  const why = reason?.trim() || null
  const topics = await db
    .select({ id: topic.id })
    .from(topic)
    .where(and(eq(topic.organizationId, orgId), eq(topic.dealId, dealId)))
  const ops: unknown[] = [
    ...clearRisksOnOutcomeOps(orgId, dealId, "Сделка агента отменена"),
    db
      .update(deal)
      .set({ status: "deleted", outcomeReason: why ? `Отменено: ${why}` : "Отменено пользователем" })
      .where(and(eq(deal.id, dealId), eq(deal.organizationId, orgId))),
    db.insert(dealActivity).values(
      activityRow(dealId, { kind: "user", userId }, d.funnelStageId, d.funnelStageId, {
        note: `Сделка агента отменена${why ? `: ${why}` : ""}`,
      }),
    ),
  ]
  if (topics.length > 0) {
    ops.push(
      db
        .update(topic)
        .set({ dealId: null, nextAttentionCheckAt: new Date() })
        .where(and(eq(topic.organizationId, orgId), eq(topic.dealId, dealId))),
      db.insert(topicEvent).values(
        topics.map((t) => ({
          id: randomUUID(),
          organizationId: orgId,
          topicId: t.id,
          type: "deal_undone",
          actor: "user",
          userId,
          sourceItemId: null,
          payload: { dealId, reason: why },
        })),
      ),
    )
  }
  await db.batch(asBatch(ops))
}

// ── Dedupe helpers ────────────────────────────────────────────────────────

/** Open deals (active / paused) of one client, with their type code. */
export async function listOpenClientDeals(
  orgId: string,
  clientId: string,
): Promise<{ id: string; dealTypeId: string | null; dealTypeCode: string | null; funnelStageId: string; status: DealStatus }[]> {
  return db
    .select({
      id: deal.id,
      dealTypeId: deal.dealTypeId,
      dealTypeCode: dealType.code,
      funnelStageId: deal.funnelStageId,
      status: deal.status,
    })
    .from(deal)
    .leftJoin(dealType, eq(dealType.id, deal.dealTypeId))
    .where(
      and(eq(deal.organizationId, orgId), eq(deal.clientId, clientId), inArray(deal.status, [...OPEN_DEAL_STATUSES])),
    )
}

/** Client facts for the stage-rule `clientGuard` (new client, client type). */
export async function loadClientGuardFacts(
  orgId: string,
  clientId: string,
): Promise<{ isNew: boolean; type: string | null }> {
  const [[c], [d], [o]] = await Promise.all([
    db
      .select({ customFields: client.customFields })
      .from(client)
      .where(and(eq(client.id, clientId), eq(client.organizationId, orgId))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(deal)
      .where(and(eq(deal.organizationId, orgId), eq(deal.clientId, clientId), ne(deal.status, "deleted"))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(order)
      .where(and(eq(order.organizationId, orgId), eq(order.clientId, clientId))),
  ])
  const cf = (c?.customFields ?? {}) as Record<string, unknown>
  return {
    isNew: (d?.n ?? 0) === 0 && (o?.n ?? 0) === 0,
    type: typeof cf.type === "string" && cf.type.trim() ? cf.type.trim() : null,
  }
}

// ── Provenance («Происхождение», deal drawer) ─────────────────────────────

export type DealProvenanceItem = {
  sourceItemId: string
  date: string
  provider: string | null
  role: string
  subject: string | null
}

export type DealProvenanceTopic = {
  id: string
  title: string
  status: string
  list: string
  leadCode: string | null
  lastActivityAt: string
  items: DealProvenanceItem[]
}

export type DealProvenanceActivity = {
  id: string
  createdAt: string
  actor: string
  /** Name of the person / «Агент» (null when the user row is gone). */
  actorName: string | null
  fromStageId: string | null
  toStageId: string | null
  note: string | null
  topicId: string | null
  sourceItemId: string | null
  ruleId: string | null
  /** Rule note (`signal_stage_rule.note_ru`) or «<code> → <effect>». */
  ruleNote: string | null
  evidence: string | null
}

export type DealProvenanceView = {
  topics: DealProvenanceTopic[]
  activity: DealProvenanceActivity[]
}

/**
 * «Происхождение» of one deal: the topics linked to it (now, or named in
 * its journal) with their items, and the full journal with the provenance
 * columns. Throws `DealEngineError('not_found')` for a deal of another org.
 */
export async function listDealProvenance(orgId: string, dealId: string): Promise<DealProvenanceView> {
  await loadDeal(orgId, dealId)
  const activityRows = await db
    .select({
      id: dealActivity.id,
      createdAt: dealActivity.createdAt,
      actor: dealActivity.actor,
      actorName: user.name,
      fromStageId: dealActivity.fromStageId,
      toStageId: dealActivity.toStageId,
      note: dealActivity.note,
      topicId: dealActivity.topicId,
      sourceItemId: dealActivity.sourceItemId,
      ruleId: dealActivity.ruleId,
      ruleNoteRu: signalStageRule.noteRu,
      ruleCode: signalStageRule.code,
      ruleEffect: signalStageRule.effect,
      evidence: dealActivity.evidence,
    })
    .from(dealActivity)
    .leftJoin(user, eq(user.id, dealActivity.actorUserId))
    .leftJoin(signalStageRule, eq(signalStageRule.id, dealActivity.ruleId))
    .where(eq(dealActivity.dealId, dealId))
    .orderBy(desc(dealActivity.createdAt))

  const topicIds = new Set(activityRows.map((a) => a.topicId).filter((x): x is string => !!x))
  const linked = await db
    .select({ id: topic.id })
    .from(topic)
    .where(and(eq(topic.organizationId, orgId), eq(topic.dealId, dealId)))
  for (const t of linked) topicIds.add(t.id)

  const topics = topicIds.size
    ? await db
        .select({
          id: topic.id,
          title: topic.title,
          status: topic.status,
          list: topic.list,
          leadCode: topic.leadCode,
          lastActivityAt: topic.lastActivityAt,
        })
        .from(topic)
        .where(and(eq(topic.organizationId, orgId), inArray(topic.id, [...topicIds])))
        .orderBy(desc(topic.lastActivityAt))
    : []
  const items = topics.length
    ? await db
        .select({
          topicId: topicItem.topicId,
          sourceItemId: topicItem.sourceItemId,
          role: topicItem.role,
          date: sql<Date>`coalesce(${sourceItem.sourceCreatedAt}, ${sourceItem.createdAt})`.mapWith(sourceItem.createdAt),
          provider: source.provider,
          subject: sql<string | null>`coalesce(nullif(${sourceItem.metadataJson}->>'subject', ''), nullif(${sourceItemSubject.matter}, ''))`,
        })
        .from(topicItem)
        .innerJoin(sourceItem, eq(sourceItem.id, topicItem.sourceItemId))
        .leftJoin(source, eq(source.id, sourceItem.sourceId))
        .leftJoin(
          sourceItemSubject,
          and(
            eq(sourceItemSubject.sourceItemId, topicItem.sourceItemId),
            or(eq(sourceItemSubject.subjectIndex, topicItem.subjectIndex), eq(topicItem.subjectIndex, -1)),
          ),
        )
        .where(and(eq(topicItem.organizationId, orgId), inArray(topicItem.topicId, topics.map((t) => t.id))))
    : []
  const byTopic = new Map<string, DealProvenanceItem[]>()
  const seen = new Set<string>()
  for (const i of items.sort((a, b) => a.date.getTime() - b.date.getTime())) {
    const key = `${i.topicId}:${i.sourceItemId}`
    if (seen.has(key)) continue
    seen.add(key)
    const list = byTopic.get(i.topicId) ?? []
    list.push({
      sourceItemId: i.sourceItemId,
      date: i.date.toISOString(),
      provider: i.provider ?? null,
      role: i.role,
      subject: i.subject ?? null,
    })
    byTopic.set(i.topicId, list)
  }
  return {
    topics: topics.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      list: t.list,
      leadCode: t.leadCode,
      lastActivityAt: t.lastActivityAt.toISOString(),
      items: byTopic.get(t.id) ?? [],
    })),
    activity: activityRows.map((a) => ({
      id: a.id,
      createdAt: a.createdAt.toISOString(),
      actor: a.actor,
      actorName: a.actorName ?? null,
      fromStageId: a.fromStageId,
      toStageId: a.toStageId,
      note: a.note,
      topicId: a.topicId,
      sourceItemId: a.sourceItemId,
      ruleId: a.ruleId,
      ruleNote: a.ruleNoteRu ?? (a.ruleCode ? `${a.ruleCode} → ${a.ruleEffect}` : null),
      evidence: a.evidence,
    })),
  }
}

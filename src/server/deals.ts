"use server"

import { db } from "@/db/drizzle"
import {
  deal,
  dealActivity,
  dealContact,
  dealFunnelStage,
  dealType,
  signalCategory,
  source,
  sourceItem,
  client,
  contact,
  user,
  dealStatus,
  dealContactRole,
  type DealStatus,
  type DealContactRole,
} from "@/db/schema"
import { aliasedTable, and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm"
import { getServerSession } from "@/lib/get-session"
import { randomUUID } from "crypto"
import {
  dealStageLabel,
  OPEN_DEAL_STATUSES,
  PRE_PIPELINE_VIRTUAL_ID,
  stageDisplayLabel,
} from "@/lib/deal-funnel"
import {
  DealTypeForbiddenError,
  FunnelStageForbiddenError,
  ensureDefaultDealTypes,
  saveDealTypes,
  type DealTypeInput,
  type DealTypeRow,
} from "@/server/deal-types"
import { getActiveOrgRole } from "@/server/sources"
import type {
  DealRiskSummary,
  DealRiskView,
  DealStateView,
} from "@/lib/topics/deal-state"
import {
  listDealProvenance,
  pauseDeal,
  resumeDeal,
  undoAgentDeal,
  type DealProvenanceView,
} from "@/server/deal-engine"
import { getTopicsMode } from "@/server/topics/mode"
import { loadDealLastActivity } from "@/server/deal-activity"
import type { DealLastActivity, DealLastActivitySource } from "@/lib/deal-activity"
import {
  getDealState,
  markDealStateDirty,
  requestDealStateRefresh,
} from "@/server/deal-state"
import {
  clearDealRiskByUser,
  listActiveRiskSummaries,
  listDealRisks,
} from "@/server/deal-risks"

export type DealContactSummary = { id: string; name: string }

export type DealRow = {
  id: string
  name: string
  description: string | null
  reasoning: string | null
  changes: string | null
  // Who performed the last funnel-stage move: 'agent' | 'user'; null = never
  // moved since the column landed. Drives the «перевёл агент» kanban badge.
  lastMovedBy: string | null
  funnelStageId: string
  funnelStageName: string
  // Что показывать пользователю (displayName из настроек или русская
  // подпись). funnelStageName остаётся внутренним именем — по нему
  // определяются терминальные Closed/Rejected.
  funnelStageLabel: string
  funnelStageProbability: number
  clientId: string
  clientName: string | null
  contacts: DealContactSummary[]
  value: string | null
  currency: string
  status: DealStatus
  // Fractional-indexing key for manual kanban order within a stage; null until
  // the deal is first dragged (board sorts null to the end by updatedAt).
  position: string | null
  // ── Topics plan phase 5 (deal bridge) ──
  // Deal type from the org's list (`deal_type`); null = untyped.
  dealTypeId: string | null
  dealTypeCode: string | null
  dealTypeLabel: string | null
  // status `paused`: until when (ISO) and why. The deal keeps its stage.
  pausedUntil: string | null
  pauseReason: string | null
  // Why the deal ended (won / lost / undone by a user).
  outcomeReason: string | null
  // Badge «создал агент»: created by the topics engine.
  createdByAgent: boolean
  // ── Topics plan phase 5a (spec topics/01 §9.3 / §9.4) ──
  // «Текущее состояние»: stored engine text (null = none yet → the UI shows
  // the old `changes` / `reasoning`), its source items and update time.
  stateText: string | null
  stateSourceItemIds: string[]
  stateUpdatedAt: string | null
  // Badge «Есть риски»: active count + the MOST critical active risk
  // (`top`); null = no active risk. One batched query for the whole board.
  riskSummary: DealRiskSummary | null
  // ── «N дн без активности» (src/lib/deal-activity.ts) ──
  // Last activity, computed at read time: the latest message on the deal's
  // topics (source "topic", mode `on` only), else the deal's own journal /
  // tasks / creation (source "deal"). Optional: other DealRow producers may
  // leave them out.
  lastActivityAt?: string | null
  lastActivitySource?: DealLastActivitySource | null
  lastActivityTopicTitle?: string | null
  // The stage's norm (`deal_funnel_stage.stale_norm_days`); null = default 14.
  staleNormDays?: number | null
  userId: string
  userName: string | null
  organizationId: string
  createdAt: string
  updatedAt: string
}

export type DealClientOption = { id: string; name: string; currency: string }
export type DealContactOption = {
  id: string
  name: string
  clientId: string | null
}
export type DealFunnelStageOption = {
  id: string
  name: string
  closureProbability: number
  sortOrder: number
  isSystem: boolean
  // См. dealFunnelStage.isPrePipeline (src/db/schema.ts).
  isPrePipeline: boolean
  // Подпись для UI (displayName ?? русская подпись по name) + сырые настройки.
  label: string
  displayName: string | null
  isHidden: boolean
  // «Норма, дн» for the «N дн без активности» badge; null = default 14.
  staleNormDays: number | null
}

async function requireOrgContext() {
  const session = await getServerSession()
  if (!session) throw new Error("Unauthorized")
  const activeOrgId = session.session.activeOrganizationId
  if (!activeOrgId) throw new Error("No active organization")
  return { session, activeOrgId }
}

async function assertDealInOrg(dealId: string, organizationId: string) {
  const rows = await db
    .select()
    .from(deal)
    .where(eq(deal.id, dealId))
    .limit(1)
  const current = rows[0]
  if (!current) throw new Error("Deal not found")
  if (current.organizationId !== organizationId) {
    throw new Error("Unauthorized")
  }
  return current
}

async function assertClientInOrg(clientId: string, organizationId: string) {
  const rows = await db
    .select()
    .from(client)
    .where(eq(client.id, clientId))
    .limit(1)
  const current = rows[0]
  if (!current || current.organizationId !== organizationId) {
    throw new Error("Invalid client")
  }
}

async function assertFunnelStageAccessible(
  funnelStageId: string,
  organizationId: string,
) {
  const rows = await db
    .select()
    .from(dealFunnelStage)
    .where(eq(dealFunnelStage.id, funnelStageId))
    .limit(1)
  const stage = rows[0]
  if (!stage) throw new Error("Invalid funnel stage")
  if (!stage.isActive) throw new Error("Funnel stage is inactive")
  // System stage is always available; org-scoped stage must match the caller.
  if (
    !stage.isSystem &&
    stage.ownerOrganizationId !== organizationId
  ) {
    throw new Error("Invalid funnel stage")
  }
  return stage
}

async function assertContactsInOrg(
  contactIds: string[],
  organizationId: string,
) {
  if (contactIds.length === 0) return
  const unique = Array.from(new Set(contactIds))
  const rows = await db
    .select({ id: contact.id, organizationId: contact.organizationId })
    .from(contact)
    .where(inArray(contact.id, unique))
  if (rows.length !== unique.length) {
    throw new Error("One or more contacts not found")
  }
  for (const row of rows) {
    if (row.organizationId !== organizationId) {
      throw new Error("One or more contacts not in this organization")
    }
  }
}

// Deal type must belong to the caller's org. `null` / "" = untyped.
async function resolveDealTypeId(
  dealTypeId: string | null | undefined,
  organizationId: string,
): Promise<string | null> {
  if (!dealTypeId) return null
  const rows = await db
    .select({ id: dealType.id })
    .from(dealType)
    .where(
      and(eq(dealType.id, dealTypeId), eq(dealType.organizationId, organizationId)),
    )
    .limit(1)
  if (!rows[0]) throw new Error("Invalid deal type")
  return rows[0].id
}

// Drizzle's `numeric` accepts string or number; we normalise to a fixed
// 2-decimal string so the column store is consistent regardless of how the
// caller framed the input (form string vs. parsed number).
function normaliseValue(
  input: number | string | null | undefined,
): string | null {
  if (input === null || input === undefined || input === "") return null
  const n = typeof input === "number" ? input : Number(input)
  if (!Number.isFinite(n)) throw new Error("Invalid deal value")
  if (n < 0) throw new Error("Deal value must be non-negative")
  return n.toFixed(2)
}

// Resolution: if the org has any active org-scoped stages, return ONLY
// those (the org has explicitly customised its funnel). Otherwise fall
// back to the platform-wide system stages. Mirrors the org-vs-system
// pattern used elsewhere in the project — orgs that haven't opted in
// inherit the default; orgs that have, get exactly what they configured
// without bleed-through from the system bucket.
export async function listDealFunnelStages(): Promise<DealFunnelStageOption[]> {
  const { activeOrgId } = await requireOrgContext()

  const orgRows = await db
    .select({
      id: dealFunnelStage.id,
      name: dealFunnelStage.name,
      closureProbability: dealFunnelStage.closureProbability,
      sortOrder: dealFunnelStage.sortOrder,
      isSystem: dealFunnelStage.isSystem,
      isPrePipeline: dealFunnelStage.isPrePipeline,
      displayName: dealFunnelStage.displayName,
      isHidden: dealFunnelStage.isHidden,
      staleNormDays: dealFunnelStage.staleNormDays,
    })
    .from(dealFunnelStage)
    .where(
      and(
        eq(dealFunnelStage.isActive, true),
        eq(dealFunnelStage.isSystem, false),
        eq(dealFunnelStage.ownerOrganizationId, activeOrgId),
      ),
    )
    .orderBy(asc(dealFunnelStage.sortOrder), asc(dealFunnelStage.name))

  if (orgRows.length > 0) {
    return orgRows.map((r) => ({
      id: r.id,
      name: r.name,
      closureProbability: Number(r.closureProbability),
      sortOrder: r.sortOrder,
      isSystem: r.isSystem,
      isPrePipeline: r.isPrePipeline,
      label: stageDisplayLabel(r.name, r.displayName),
      displayName: r.displayName,
      isHidden: r.isHidden,
      staleNormDays: r.staleNormDays,
    }))
  }

  const systemRows = await db
    .select({
      id: dealFunnelStage.id,
      name: dealFunnelStage.name,
      closureProbability: dealFunnelStage.closureProbability,
      sortOrder: dealFunnelStage.sortOrder,
      isSystem: dealFunnelStage.isSystem,
      isPrePipeline: dealFunnelStage.isPrePipeline,
      displayName: dealFunnelStage.displayName,
      isHidden: dealFunnelStage.isHidden,
      staleNormDays: dealFunnelStage.staleNormDays,
    })
    .from(dealFunnelStage)
    .where(
      and(
        eq(dealFunnelStage.isActive, true),
        eq(dealFunnelStage.isSystem, true),
      ),
    )
    .orderBy(asc(dealFunnelStage.sortOrder), asc(dealFunnelStage.name))

  return systemRows.map((r) => ({
    id: r.id,
    name: r.name,
    closureProbability: Number(r.closureProbability),
    sortOrder: r.sortOrder,
    isSystem: r.isSystem,
    isPrePipeline: r.isPrePipeline,
    label: stageDisplayLabel(r.name, r.displayName),
    displayName: r.displayName,
    isHidden: r.isHidden,
    staleNormDays: r.staleNormDays,
  }))
}

// Picker scope: any non-suspended, non-deleted client in the org. We
// deliberately include `initial` (auto-discovered, not yet reviewed)
// alongside `active` so operators can attach deals to freshly-discovered
// clients without having to bounce through the Clients tab to flip the
// status first. `suspended` (archived) and `deleted` (soft-deleted) are both
// excluded.
export async function listDealClientOptions(): Promise<DealClientOption[]> {
  const { activeOrgId } = await requireOrgContext()
  const rows = await db
    .select({ id: client.id, name: client.name, currency: client.currency })
    .from(client)
    .where(
      and(
        eq(client.organizationId, activeOrgId),
        ne(client.status, "suspended"),
        ne(client.status, "deleted"),
      ),
    )
    .orderBy(client.name)
  return rows
}

export async function listDealContactOptions(
  clientId?: string | null,
): Promise<DealContactOption[]> {
  const { activeOrgId } = await requireOrgContext()
  // Same scope rule as the client picker — `initial` contacts surface
  // alongside `active`; `suspended` and `deleted` stay hidden.
  const conditions = [
    eq(contact.organizationId, activeOrgId),
    ne(contact.status, "suspended"),
    ne(contact.status, "deleted"),
  ]
  if (clientId) {
    conditions.push(eq(contact.clientId, clientId))
  }
  const rows = await db
    .select({
      id: contact.id,
      name: contact.name,
      clientId: contact.clientId,
    })
    .from(contact)
    .where(and(...conditions))
    .orderBy(contact.name)
  return rows
}

// One select shape for `listDeals` + `getDeal` (deal + stage + client +
// owner + deal type), mapped by `toDealRow`.
const dealRowColumns = {
  deal,
  funnelStageName: dealFunnelStage.name,
  funnelStageProbability: dealFunnelStage.closureProbability,
  funnelStageDisplayName: dealFunnelStage.displayName,
  funnelStageStaleNormDays: dealFunnelStage.staleNormDays,
  clientName: client.name,
  userName: user.name,
  dealTypeCode: dealType.code,
  dealTypeLabel: dealType.labelRu,
}

type DealRowSelect = {
  deal: typeof deal.$inferSelect
  funnelStageName: string
  funnelStageProbability: string
  funnelStageDisplayName: string | null
  funnelStageStaleNormDays: number | null
  clientName: string | null
  userName: string | null
  dealTypeCode: string | null
  dealTypeLabel: string | null
}

function toDealRow(
  r: DealRowSelect,
  contacts: DealContactSummary[],
  riskSummary: DealRiskSummary | null = null,
  // Engine output (state text, risks) is shown only in topics mode `on`
  // (shadow = users see nothing from the engine, spec topics/01 §12).
  engineVisible = true,
  lastActivity: DealLastActivity | null = null,
): DealRow {
  return {
    id: r.deal.id,
    name: r.deal.name,
    description: r.deal.description,
    reasoning: r.deal.reasoning,
    changes: r.deal.changes,
    lastMovedBy: r.deal.lastMovedBy,
    funnelStageId: r.deal.funnelStageId,
    funnelStageName: r.funnelStageName,
    funnelStageLabel: stageDisplayLabel(
      r.funnelStageName,
      r.funnelStageDisplayName,
    ),
    funnelStageProbability: Number(r.funnelStageProbability),
    clientId: r.deal.clientId,
    clientName: r.clientName,
    contacts,
    value: r.deal.value,
    currency: r.deal.currency,
    status: r.deal.status,
    position: r.deal.position,
    dealTypeId: r.deal.dealTypeId,
    dealTypeCode: r.dealTypeCode,
    dealTypeLabel: r.dealTypeLabel,
    pausedUntil: r.deal.pausedUntil ? r.deal.pausedUntil.toISOString() : null,
    pauseReason: r.deal.pauseReason,
    outcomeReason: r.deal.outcomeReason,
    createdByAgent: r.deal.createdByAgent,
    stateText: engineVisible ? r.deal.stateText : null,
    stateSourceItemIds: engineVisible ? (r.deal.stateSourceItemIds ?? []) : [],
    stateUpdatedAt: engineVisible && r.deal.stateUpdatedAt ? r.deal.stateUpdatedAt.toISOString() : null,
    riskSummary,
    lastActivityAt: lastActivity ? lastActivity.at.toISOString() : null,
    lastActivitySource: lastActivity?.source ?? null,
    lastActivityTopicTitle: lastActivity?.topicTitle ?? null,
    staleNormDays: r.funnelStageStaleNormDays,
    userId: r.deal.userId,
    userName: r.userName,
    organizationId: r.deal.organizationId,
    createdAt: r.deal.createdAt.toISOString(),
    updatedAt: r.deal.updatedAt.toISOString(),
  }
}

export async function listDeals(
  options?: { includeCancelled?: boolean; includeDeleted?: boolean },
): Promise<DealRow[]> {
  const { activeOrgId } = await requireOrgContext()

  // Open deals (`active` + `paused` — a paused deal keeps its stage and stays
  // on the board) always show. `cancelled` / `deleted` are soft-deleted and
  // only surface when explicitly requested — the board passes both flags and
  // does the final hide/show client-side so toggling doesn't refetch.
  const allowedStatuses: DealStatus[] = [...OPEN_DEAL_STATUSES]
  if (options?.includeCancelled) allowedStatuses.push("cancelled")
  if (options?.includeDeleted) allowedStatuses.push("deleted")

  const conditions = [
    eq(deal.organizationId, activeOrgId),
    inArray(deal.status, allowedStatuses),
  ]

  const rows = await db
    .select(dealRowColumns)
    .from(deal)
    .innerJoin(dealFunnelStage, eq(deal.funnelStageId, dealFunnelStage.id))
    .leftJoin(client, eq(deal.clientId, client.id))
    .leftJoin(user, eq(deal.userId, user.id))
    .leftJoin(dealType, eq(deal.dealTypeId, dealType.id))
    .where(and(...conditions))
    .orderBy(desc(deal.updatedAt))

  // Single follow-up query for all attached contacts to avoid N+1.
  const dealIds = rows.map((r) => r.deal.id)
  const contactsByDeal = new Map<string, DealContactSummary[]>()
  if (dealIds.length > 0) {
    const contactRows = await db
      .select({
        dealId: dealContact.dealId,
        id: contact.id,
        name: contact.name,
      })
      .from(dealContact)
      .innerJoin(contact, eq(dealContact.contactId, contact.id))
      .where(inArray(dealContact.dealId, dealIds))
      .orderBy(contact.name)
    for (const c of contactRows) {
      const list = contactsByDeal.get(c.dealId) ?? []
      list.push({ id: c.id, name: c.name })
      contactsByDeal.set(c.dealId, list)
    }
  }

  // Badge «Есть риски»: ONE batched query for all deals (no N+1).
  const engineVisible = (await getTopicsMode(activeOrgId)) === "on"
  const [risks, activity] = await Promise.all([
    engineVisible ? loadRiskSummaries(activeOrgId, dealIds) : new Map<string, DealRiskSummary>(),
    // «N дн без активности»: one aggregated pass for the whole list.
    loadDealLastActivity(
      activeOrgId,
      rows.map((r) => ({ id: r.deal.id, createdAt: r.deal.createdAt })),
      { topicsVisible: engineVisible },
    ),
  ])

  return rows.map((r) =>
    toDealRow(
      r,
      contactsByDeal.get(r.deal.id) ?? [],
      risks.get(r.deal.id) ?? null,
      engineVisible,
      activity.get(r.deal.id) ?? null,
    ),
  )
}

async function loadRiskSummaries(
  organizationId: string,
  dealIds: string[],
): Promise<Map<string, DealRiskSummary>> {
  if (dealIds.length === 0) return new Map()
  const summaries = await listActiveRiskSummaries(organizationId, dealIds)
  const byDeal = new Map<string, DealRiskSummary>()
  for (const s of summaries) {
    if (s.activeCount > 0 && s.top) byDeal.set(s.dealId, s)
  }
  return byDeal
}

export async function getDeal(dealId: string): Promise<DealRow | null> {
  const { activeOrgId } = await requireOrgContext()
  const rows = await db
    .select(dealRowColumns)
    .from(deal)
    .innerJoin(dealFunnelStage, eq(deal.funnelStageId, dealFunnelStage.id))
    .leftJoin(client, eq(deal.clientId, client.id))
    .leftJoin(user, eq(deal.userId, user.id))
    .leftJoin(dealType, eq(deal.dealTypeId, dealType.id))
    .where(eq(deal.id, dealId))
    .limit(1)

  const r = rows[0]
  if (!r) return null
  if (r.deal.organizationId !== activeOrgId) return null

  const contactRows = await db
    .select({ id: contact.id, name: contact.name })
    .from(dealContact)
    .innerJoin(contact, eq(dealContact.contactId, contact.id))
    .where(eq(dealContact.dealId, dealId))
    .orderBy(contact.name)

  const engineVisible = (await getTopicsMode(activeOrgId)) === "on"
  const [risks, activity] = await Promise.all([
    engineVisible ? loadRiskSummaries(activeOrgId, [dealId]) : new Map<string, DealRiskSummary>(),
    loadDealLastActivity(
      activeOrgId,
      [{ id: dealId, createdAt: r.deal.createdAt }],
      { topicsVisible: engineVisible },
    ),
  ])
  return toDealRow(
    r,
    contactRows,
    risks.get(dealId) ?? null,
    engineVisible,
    activity.get(dealId) ?? null,
  )
}

export async function createDeal(data: {
  name: string
  description?: string | null
  funnelStageId: string
  clientId: string
  contactIds?: string[]
  value?: number | string | null
  dealTypeId?: string | null
}) {
  const { session, activeOrgId } = await requireOrgContext()
  if (!data.name?.trim()) throw new Error("Name is required")
  if (!data.clientId) throw new Error("Client is required")
  if (!data.funnelStageId) throw new Error("Funnel stage is required")

  await assertClientInOrg(data.clientId, activeOrgId)
  await assertFunnelStageAccessible(data.funnelStageId, activeOrgId)
  const contactIds = data.contactIds ?? []
  await assertContactsInOrg(contactIds, activeOrgId)
  const dealTypeId = await resolveDealTypeId(data.dealTypeId, activeOrgId)

  const value = normaliseValue(data.value)
  const clientRow = await db
    .select({ currency: client.currency })
    .from(client)
    .where(eq(client.id, data.clientId))
    .limit(1)
  const currency = clientRow[0]?.currency ?? "RUB"

  const id = randomUUID()
  const now = new Date()

  await db.insert(deal).values({
    id,
    name: data.name.trim(),
    description: data.description?.trim() || null,
    funnelStageId: data.funnelStageId,
    clientId: data.clientId,
    value,
    currency,
    status: "active",
    dealTypeId,
    userId: session.user.id,
    organizationId: activeOrgId,
    createdAt: now,
    updatedAt: now,
  })

  if (contactIds.length > 0) {
    await db
      .insert(dealContact)
      .values(
        Array.from(new Set(contactIds)).map((contactId) => ({
          dealId: id,
          contactId,
        })),
      )
  }

  await db.insert(dealActivity).values({
    id: randomUUID(),
    dealId: id,
    actor: "user",
    actorUserId: session.user.id,
    fromStageId: null,
    toStageId: data.funnelStageId,
    createdAt: now,
  })

  return { id }
}

export async function updateDeal(
  dealId: string,
  data: {
    name?: string
    description?: string | null
    funnelStageId?: string
    clientId?: string
    contactIds?: string[]
    value?: number | string | null
    currency?: string | null
    status?: DealStatus
    dealTypeId?: string | null
  },
) {
  const { session, activeOrgId } = await requireOrgContext()
  const current = await assertDealInOrg(dealId, activeOrgId)

  if (data.name !== undefined && !data.name.trim()) {
    throw new Error("Name is required")
  }
  if (data.clientId !== undefined) {
    await assertClientInOrg(data.clientId, activeOrgId)
  }
  if (data.funnelStageId !== undefined) {
    await assertFunnelStageAccessible(data.funnelStageId, activeOrgId)
  }
  if (data.contactIds !== undefined) {
    await assertContactsInOrg(data.contactIds, activeOrgId)
  }

  const patch: Record<string, unknown> = {}
  if (data.name !== undefined) patch.name = data.name.trim()
  if (data.description !== undefined) {
    patch.description = data.description?.trim() || null
  }
  if (data.funnelStageId !== undefined) patch.funnelStageId = data.funnelStageId
  if (data.clientId !== undefined) patch.clientId = data.clientId
  if (data.value !== undefined) patch.value = normaliseValue(data.value)
  // Валюта сделки всегда равна валюте её клиента: при смене клиента
  // пересчитываем, присланное data.currency игнорируем (инвариант).
  if (data.clientId !== undefined) {
    const clientRow = await db
      .select({ currency: client.currency })
      .from(client)
      .where(eq(client.id, data.clientId))
      .limit(1)
    patch.currency = clientRow[0]?.currency ?? "RUB"
  }
  if (data.dealTypeId !== undefined) {
    patch.dealTypeId = await resolveDealTypeId(data.dealTypeId, activeOrgId)
  }
  // paused → active = «Снять с паузы» (journaled by the deal engine below).
  const resume = current.status === "paused" && data.status === "active"
  if (data.status !== undefined && data.status !== current.status && !resume) {
    Object.assign(patch, statusPatch(current.status, data.status))
  }

  if (Object.keys(patch).length > 0) {
    await db.update(deal).set(patch).where(eq(deal.id, dealId))
  }
  if (resume) {
    await resumeDeal(activeOrgId, dealId, { kind: "user", userId: session.user.id })
  }

  // Replace-style contact membership update: delete the existing edges,
  // insert the new set. Сохраняем назначенные роли существующих связей, чтобы
  // редактирование сделки не обнуляло роли контактов.
  if (data.contactIds !== undefined) {
    const existing = await db
      .select({ contactId: dealContact.contactId, role: dealContact.role })
      .from(dealContact)
      .where(eq(dealContact.dealId, dealId))
    const roleByContact = new Map(existing.map((e) => [e.contactId, e.role]))
    await db.delete(dealContact).where(eq(dealContact.dealId, dealId))
    const unique = Array.from(new Set(data.contactIds))
    if (unique.length > 0) {
      await db.insert(dealContact).values(
        unique.map((contactId) => ({
          dealId,
          contactId,
          role: roleByContact.get(contactId) ?? null,
        })),
      )
    }
  }

  // R16: amount / contacts / type / client / stage / status changed → the
  // state text is out of date. Name / description edits alone do not count.
  const changed: string[] = []
  if ("value" in patch && patch.value !== current.value) changed.push("сумма")
  if ("dealTypeId" in patch && patch.dealTypeId !== current.dealTypeId) changed.push("тип")
  if ("clientId" in patch && patch.clientId !== current.clientId) changed.push("клиент")
  if ("funnelStageId" in patch && patch.funnelStageId !== current.funnelStageId) changed.push("стадия")
  if ("status" in patch || resume) changed.push("статус")
  if (data.contactIds !== undefined) changed.push("контакты")
  if (changed.length > 0) {
    await markStateDirtySafe(activeOrgId, dealId, `Изменено вручную: ${changed.join(", ")}`)
  }
}

// Status-only shortcut (mirrors tasks' `updateTaskStatus`). Used by the
// `statusOnly` PUT path for quick cancel / delete / restore toggles.
export async function setDealStatus(dealId: string, status: DealStatus) {
  const { session, activeOrgId } = await requireOrgContext()
  const current = await assertDealInOrg(dealId, activeOrgId)
  if (status === current.status) return
  if (current.status === "paused" && status === "active") {
    await resumeDeal(activeOrgId, dealId, { kind: "user", userId: session.user.id })
  } else {
    await db
      .update(deal)
      .set(statusPatch(current.status, status))
      .where(eq(deal.id, dealId))
  }
  await markStateDirtySafe(activeOrgId, dealId, "Изменено вручную: статус")
}

// Status change through the edit form / the quick shortcut. `paused` needs a
// return date + reason, so it is set ONLY by «Поставить на паузу»
// (`pauseDealForUser` → deal engine). Leaving `paused` here (cancel / delete
// / plain «Активна») clears the pause fields.
function statusPatch(
  from: DealStatus,
  to: DealStatus,
): Partial<typeof deal.$inferInsert> {
  if (!dealStatus.enumValues.includes(to)) {
    throw new Error("Invalid deal status")
  }
  if (to === "paused") {
    throw new Error("Чтобы поставить сделку на паузу, используйте «Поставить на паузу»")
  }
  const patch: Partial<typeof deal.$inferInsert> = { status: to }
  if (from === "paused") {
    patch.pausedUntil = null
    patch.pauseReason = null
  }
  return patch
}

// Перевод сделки по воронке вручную (drag&drop в канбане / кросс-стадийный
// перевод через диалог). Ставит стадию, пишет заметку-основание в `changes`
// (provenance ручного перевода). `reasoning` не трогаем — оно за discovery-
// агентом. Опционально ставит `position` (append в целевую колонку) — при
// кросс-стадийном переводе с заметкой, чтобы порядок внутри стадии остался
// консистентным.
export async function moveDealStage(
  dealId: string,
  funnelStageId: string,
  note: string | null,
  opts?: {
    position?: string | null
    actor?: "agent" | "user"
    // Текст события для журнала (deal_activity), если отличается от `note`
    // (карточечное поле deal.changes). Сегодня используется только обратным
    // переводом: карточке — дежурная запись «Переведено: X» (не путать с
    // реальным изменением состояния), а в журнал ВСЕГДА идёт настоящая
    // причина. По умолчанию совпадает с `note`.
    historyNote?: string | null
    reasoning?: string | null
  },
) {
  const { session, activeOrgId } = await requireOrgContext()
  await assertDealInOrg(dealId, activeOrgId)
  await assertFunnelStageAccessible(funnelStageId, activeOrgId)

  const before = await db
    .select({ funnelStageId: deal.funnelStageId })
    .from(deal)
    .where(eq(deal.id, dealId))
    .limit(1)
  const fromStageId = before[0]?.funnelStageId ?? null

  const trimmed = note?.trim()
  const position = opts?.position
  const actor = opts?.actor ?? "user"
  // Всегда переписываем `changes` (заметка или null), чтобы при переводе без
  // заметки в provenance не оставался устаревший текст прошлого изменения.
  // `lastMovedBy` помечает автора перевода: 'agent' (авто-применённое
  // предложение) или 'user' (диалог переноса) — питает бейдж «перевёл агент».
  // `updatedAt` обновляется автоматически через $onUpdate в схеме.
  await db
    .update(deal)
    .set({
      funnelStageId,
      changes: trimmed || null,
      lastMovedBy: actor,
      ...(typeof position === "string" && position.length > 0
        ? { position }
        : {}),
    })
    .where(eq(deal.id, dealId))

  // Журнал (deal_activity) — ПОЛНАЯ история, отдельно от карточечного
  // deal.changes: пишется на КАЖДЫЙ перевод, никогда не перезаписывается.
  const historyTrimmed = (opts?.historyNote ?? note)?.trim()
  await db.insert(dealActivity).values({
    id: randomUUID(),
    dealId,
    actor,
    actorUserId: actor === "agent" ? null : session.user.id,
    fromStageId,
    toStageId: funnelStageId,
    note: historyTrimmed || null,
    reasoning: opts?.reasoning ?? null,
  })
  if (fromStageId !== funnelStageId) {
    await markStateDirtySafe(activeOrgId, dealId, "Перевод по стадии")
  }
}

export type DealContactWithRole = {
  id: string
  name: string
  nameNative: string | null
  position: string | null
  email: string | null
  role: DealContactRole | null
}

export async function listDealContactsWithRoles(
  dealId: string,
): Promise<DealContactWithRole[]> {
  const { activeOrgId } = await requireOrgContext()
  await assertDealInOrg(dealId, activeOrgId)
  const rows = await db
    .select({
      id: contact.id,
      name: contact.name,
      nameNative: contact.nameNative,
      position: contact.position,
      email: contact.email,
      role: dealContact.role,
    })
    .from(dealContact)
    .innerJoin(contact, eq(dealContact.contactId, contact.id))
    .where(eq(dealContact.dealId, dealId))
  return rows
}

export async function addDealContact(dealId: string, contactId: string) {
  const { activeOrgId } = await requireOrgContext()
  await assertDealInOrg(dealId, activeOrgId)
  await assertContactsInOrg([contactId], activeOrgId)
  await db
    .insert(dealContact)
    .values({ dealId, contactId })
    .onConflictDoNothing()
  await markStateDirtySafe(activeOrgId, dealId, "Изменено вручную: контакты")
}

export async function setDealContactRole(
  dealId: string,
  contactId: string,
  role: DealContactRole | null,
) {
  const { activeOrgId } = await requireOrgContext()
  await assertDealInOrg(dealId, activeOrgId)
  if (role !== null && !dealContactRole.enumValues.includes(role)) {
    throw new Error("Invalid contact role")
  }
  await db
    .update(dealContact)
    .set({ role })
    .where(
      and(
        eq(dealContact.dealId, dealId),
        eq(dealContact.contactId, contactId),
      ),
    )
  await markStateDirtySafe(activeOrgId, dealId, "Изменено вручную: роль контакта")
}

export async function removeDealContact(dealId: string, contactId: string) {
  const { activeOrgId } = await requireOrgContext()
  await assertDealInOrg(dealId, activeOrgId)
  await db
    .delete(dealContact)
    .where(
      and(
        eq(dealContact.dealId, dealId),
        eq(dealContact.contactId, contactId),
      ),
    )
  await markStateDirtySafe(activeOrgId, dealId, "Изменено вручную: контакты")
}

export type DealActivityRow = {
  id: string
  actor: "agent" | "user"
  actorUserName: string | null
  fromStageName: string | null
  toStageName: string | null
  note: string | null
  reasoning: string | null
  createdAt: string
}

// Полная хронология ОДНОЙ сделки (drawer, вкладка «Хронология») — читает
// deal_activity, а не deal.changes (которое переписывается на каждый перевод).
export async function listDealActivity(
  dealId: string,
): Promise<DealActivityRow[]> {
  const { activeOrgId } = await requireOrgContext()
  await assertDealInOrg(dealId, activeOrgId)

  const fromStage = aliasedTable(dealFunnelStage, "from_stage")
  const toStage = aliasedTable(dealFunnelStage, "to_stage")

  const rows = await db
    .select({
      id: dealActivity.id,
      actor: dealActivity.actor,
      actorUserName: user.name,
      fromStageName: sql<string | null>`coalesce(${fromStage.displayName}, ${fromStage.name})`,
      toStageName: sql<string | null>`coalesce(${toStage.displayName}, ${toStage.name})`,
      note: dealActivity.note,
      reasoning: dealActivity.reasoning,
      createdAt: dealActivity.createdAt,
    })
    .from(dealActivity)
    .leftJoin(user, eq(dealActivity.actorUserId, user.id))
    .leftJoin(fromStage, eq(dealActivity.fromStageId, fromStage.id))
    .leftJoin(toStage, eq(dealActivity.toStageId, toStage.id))
    .where(eq(dealActivity.dealId, dealId))
    .orderBy(desc(dealActivity.createdAt))

  return rows.map((r) => ({
    ...r,
    actor: r.actor as "agent" | "user",
    createdAt: r.createdAt.toISOString(),
  }))
}

// Event shape of the «Лента решений» feed (deal-decision-feed.tsx). `{deal}`
// in the text is a placeholder the UI replaces with the deal name in bold.
export type FeedEvent = {
  id: string
  actor: string
  isAI: boolean
  at: string
  text: string
  dealName: string | null
}

// Latest events of the WHOLE org (not one deal), read from the deal_activity
// journal (every moveDealStage / createDeal writes a row).
// The org comes from the caller's session (never a parameter): this module
// is "use server", so every export must check the session itself.
export async function listRecentDealActivity(limit = 100): Promise<FeedEvent[]> {
  const { activeOrgId: organizationId } = await requireOrgContext()
  const fromStage = aliasedTable(dealFunnelStage, "from_stage")
  const toStage = aliasedTable(dealFunnelStage, "to_stage")

  const rows = await db
    .select({
      id: dealActivity.id,
      actor: dealActivity.actor,
      actorUserName: user.name,
      dealName: deal.name,
      clientName: client.name,
      fromStageName: sql<string | null>`coalesce(${fromStage.displayName}, ${fromStage.name})`,
      toStageName: sql<string | null>`coalesce(${toStage.displayName}, ${toStage.name})`,
      note: dealActivity.note,
      reasoning: dealActivity.reasoning,
      createdAt: dealActivity.createdAt,
    })
    .from(dealActivity)
    .innerJoin(deal, eq(dealActivity.dealId, deal.id))
    .leftJoin(client, eq(deal.clientId, client.id))
    .leftJoin(user, eq(dealActivity.actorUserId, user.id))
    .leftJoin(fromStage, eq(dealActivity.fromStageId, fromStage.id))
    .leftJoin(toStage, eq(dealActivity.toStageId, toStage.id))
    .where(eq(deal.organizationId, organizationId))
    .orderBy(desc(dealActivity.createdAt))
    .limit(limit)

  return rows.map((r) => {
    const isAI = r.actor === "agent"
    const dealName = r.clientName ? `${r.clientName} — ${r.dealName}` : r.dealName
    const move = r.fromStageName
      ? `${dealStageLabel(r.fromStageName)} → ${dealStageLabel(r.toStageName ?? "")}`
      : "Сделка создана"
    const parts = [move]
    if (r.note) parts.push(r.note)
    if (isAI && r.reasoning) parts.push(r.reasoning)
    return {
      id: r.id,
      actor: isAI ? "Агент" : (r.actorUserName ?? "Пользователь"),
      isAI,
      at: r.createdAt.toISOString(),
      text: "{deal}: " + parts.join(" — ") + ".",
      dealName,
    }
  })
}

// «Не состоялись» по своим колонкам (доска): активная Rejected-сделка не
// хранит, с какого этапа её отклонили — funnel_stage_id указывает на сам
// Rejected. Источник — журнал deal_activity: последняя запись, где
// to_stage_id = Rejected, её from_stage_id и есть исходный этап. Для сделок,
// отклонённых ДО появления журнала (бэкфилл без истории — see
// scripts/add-deal-activity.ts), fromStageId может отсутствовать — таких
// в возвращаемой карте просто нет, вызывающая сторона (deals-board.tsx)
// откатывается на fallback-показ в колонке «Закрытие».
// (Отменённые (`cancelled`) сделки сюда не входят — их funnelStageId сам по
// себе уже корректный «этап, на котором отменили», т.к. setDealStatus()
// его не трогает — доп. запрос не нужен.)
export async function listRejectedDealOrigins(): Promise<
  Record<string, string>
> {
  const { activeOrgId } = await requireOrgContext()
  const stages = await listDealFunnelStages()
  const rejected = stages.find((s) => s.name === "Rejected")
  if (!rejected) return {}

  const rows = await db
    .select({
      dealId: dealActivity.dealId,
      fromStageId: dealActivity.fromStageId,
      createdAt: dealActivity.createdAt,
    })
    .from(dealActivity)
    .innerJoin(deal, eq(dealActivity.dealId, deal.id))
    .where(
      and(
        eq(deal.organizationId, activeOrgId),
        eq(dealActivity.toStageId, rejected.id),
      ),
    )
    .orderBy(desc(dealActivity.createdAt))

  const result: Record<string, string> = {}
  for (const r of rows) {
    if (!result[r.dealId] && r.fromStageId) result[r.dealId] = r.fromStageId
  }
  return result
}

// Kanban drag: move a deal to a column (funnel stage) at a manual-order slot.
// The CLIENT computes `position` via fractional-indexing (computePosition in
// src/lib/kanban-move.ts) from the neighbours at the drop point; the server
// only validates tenant + stage ownership and writes both fields. This is the
// only path that sets `deal.position`. (`updatedAt` bumps via $onUpdate — a
// drag counts as a touch, same as the stage-move dropdown.)
export async function moveDeal(
  dealId: string,
  data: { funnelStageId: string; position: string },
) {
  const { activeOrgId } = await requireOrgContext()
  const current = await assertDealInOrg(dealId, activeOrgId)
  await assertFunnelStageAccessible(data.funnelStageId, activeOrgId)
  if (typeof data.position !== "string" || data.position.length === 0) {
    throw new Error("Invalid position")
  }
  // Drag — всегда действие человека: сбрасывает метку агентского перевода
  // (после ручного переноса агент снова вправе сделать один шаг по сделке).
  await db
    .update(deal)
    .set({
      funnelStageId: data.funnelStageId,
      position: data.position,
      lastMovedBy: "user",
    })
    .where(eq(deal.id, dealId))
  // A same-stage reorder is not new deal information.
  if (current.funnelStageId !== data.funnelStageId) {
    await markStateDirtySafe(activeOrgId, dealId, "Перевод по стадии")
  }
}

// ---------------------------------------------------------------------------
// «Настройки стадий» (/deals → кнопка со слайдерами): название + видимость
// колонок. Терминальные Closed/Rejected сюда не входят — на доске это одна
// колонка «Закрытие» со своей подписью.
// ---------------------------------------------------------------------------

const PRE_PIPELINE_DEFAULT_NAME = "Контакт до запроса"

export type FunnelStageSetting = {
  id: string
  name: string
  // Подпись по умолчанию (без пользовательского названия) — плейсхолдер.
  defaultLabel: string
  displayName: string | null
  isHidden: boolean
  isPrePipeline: boolean
  // «Норма, дн»: null = default (DEFAULT_STALE_NORM_DAYS = 14).
  staleNormDays: number | null
}

const TERMINAL_NAMES = new Set(["Closed", "Rejected"])

export async function getFunnelStageSettings(): Promise<FunnelStageSetting[]> {
  const stages = await listDealFunnelStages()
  const flow = stages.filter((s) => !TERMINAL_NAMES.has(s.name))
  const rows: FunnelStageSetting[] = flow.map((s) => ({
    id: s.id,
    name: s.name,
    defaultLabel: dealStageLabel(s.name),
    displayName: s.displayName,
    isHidden: s.isHidden,
    isPrePipeline: s.isPrePipeline,
    staleNormDays: s.staleNormDays,
  }))
  if (!flow.some((s) => s.isPrePipeline)) {
    rows.unshift({
      id: PRE_PIPELINE_VIRTUAL_ID,
      name: PRE_PIPELINE_DEFAULT_NAME,
      defaultLabel: PRE_PIPELINE_DEFAULT_NAME,
      displayName: null,
      isHidden: false,
      isPrePipeline: true,
      staleNormDays: null,
    })
  }
  return rows
}

// Орга на системной воронке → своя копия: системные стадии клонируются в
// оргу с теми же именами/вероятностями (+ 0-я стадия «до воронки»), её
// сделки и журнал deal_activity переводятся на клоны. Возвращает карту
// старый id → новый. deal.updatedAt НЕ трогаем (иначе «дни без активности»
// у всех сделок обнулились бы от технической операции).
async function materializeOrgFunnel(
  organizationId: string,
  systemStages: DealFunnelStageOption[],
): Promise<Map<string, string>> {
  const idMap = new Map<string, string>()
  const minSort = Math.min(...systemStages.map((s) => s.sortOrder), 10)
  const preId = randomUUID()
  idMap.set(PRE_PIPELINE_VIRTUAL_ID, preId)
  const values = [
    {
      id: preId,
      name: PRE_PIPELINE_DEFAULT_NAME,
      closureProbability: "0",
      sortOrder: minSort - 10,
      isSystem: false,
      ownerOrganizationId: organizationId,
      isActive: true,
      isPrePipeline: true,
    },
    ...systemStages.map((s) => {
      const id = randomUUID()
      idMap.set(s.id, id)
      return {
        id,
        name: s.name,
        closureProbability: String(s.closureProbability),
        sortOrder: s.sortOrder,
        isSystem: false,
        ownerOrganizationId: organizationId,
        isActive: true,
        isPrePipeline: false,
        staleNormDays: s.staleNormDays,
      }
    }),
  ]
  await db.insert(dealFunnelStage).values(values)

  const orgDealIds = db
    .select({ id: deal.id })
    .from(deal)
    .where(eq(deal.organizationId, organizationId))
  for (const s of systemStages) {
    const to = idMap.get(s.id)!
    await db
      .update(deal)
      .set({ funnelStageId: to, updatedAt: sql`${deal.updatedAt}` })
      .where(
        and(
          eq(deal.organizationId, organizationId),
          eq(deal.funnelStageId, s.id),
        ),
      )
    await db
      .update(dealActivity)
      .set({ fromStageId: to })
      .where(
        and(
          eq(dealActivity.fromStageId, s.id),
          inArray(dealActivity.dealId, orgDealIds),
        ),
      )
    await db
      .update(dealActivity)
      .set({ toStageId: to })
      .where(
        and(
          eq(dealActivity.toStageId, s.id),
          inArray(dealActivity.dealId, orgDealIds),
        ),
      )
  }
  return idMap
}

/** «Настройки стадий» for the dialog + whether the caller may save (org owner only). */
export async function getFunnelStageSettingsView(): Promise<{ stages: FunnelStageSetting[]; canManage: boolean }> {
  const { activeOrgId } = await requireOrgContext()
  const [stages, role] = await Promise.all([getFunnelStageSettings(), getActiveOrgRole()])
  return { stages, canManage: !!role && role.organizationId === activeOrgId && role.role === "owner" }
}

/** Owner only (same rule as «Типы сделок»): names, visibility and «Норма, дн». */
export async function saveFunnelStageSettings(
  input: {
    id: string
    displayName: string | null
    isHidden: boolean
    // null = default 14; undefined = keep the stored value.
    staleNormDays?: number | null
  }[],
): Promise<void> {
  const { activeOrgId } = await requireOrgContext()
  const role = await getActiveOrgRole()
  if (!role || role.organizationId !== activeOrgId || role.role !== "owner") {
    throw new FunnelStageForbiddenError()
  }
  const current = await listDealFunnelStages()
  const idMap =
    current.length > 0 && current[0].isSystem
      ? await materializeOrgFunnel(activeOrgId, current)
      : new Map<string, string>()

  for (const entry of input) {
    const id = idMap.get(entry.id) ?? entry.id
    if (id === PRE_PIPELINE_VIRTUAL_ID) continue
    const custom = entry.displayName?.trim() || null
    await db
      .update(dealFunnelStage)
      .set({
        displayName: custom,
        isHidden: !!entry.isHidden,
        ...(entry.staleNormDays !== undefined
          ? { staleNormDays: entry.staleNormDays }
          : {}),
      })
      .where(
        and(
          eq(dealFunnelStage.id, id),
          eq(dealFunnelStage.isSystem, false),
          eq(dealFunnelStage.ownerOrganizationId, activeOrgId),
        ),
      )
  }
}

// ---------------------------------------------------------------------------
// Deal types (topics plan phase 5, spec 01 §9.2 / §14): the org's list,
// edited by the org OWNER next to «Настройки стадий». Tenant data — the
// generic defaults are created on first use (`ensureDefaultDealTypes`).
// ---------------------------------------------------------------------------

export type DealTypeOption = DealTypeRow

/** All types of the active org (hidden too — the UI filters for pickers). */
export async function listDealTypeOptions(): Promise<DealTypeOption[]> {
  const { activeOrgId } = await requireOrgContext()
  return ensureDefaultDealTypes(activeOrgId)
}

/** Editor payload: the full list + whether the caller may change it. */
export async function getDealTypeSettings(): Promise<{
  types: DealTypeOption[]
  canManage: boolean
}> {
  const { activeOrgId } = await requireOrgContext()
  const [types, role] = await Promise.all([
    ensureDefaultDealTypes(activeOrgId),
    getActiveOrgRole(),
  ])
  return { types, canManage: role?.role === "owner" }
}

/** Owner only. Types are never deleted — hide instead. */
export async function saveDealTypeSettings(
  rows: DealTypeInput[],
): Promise<DealTypeOption[]> {
  const { activeOrgId } = await requireOrgContext()
  const role = await getActiveOrgRole()
  if (!role || role.organizationId !== activeOrgId || role.role !== "owner") {
    throw new DealTypeForbiddenError()
  }
  // DealTypeValidationError (Russian message) passes through → 400.
  return saveDealTypes(activeOrgId, rows)
}

// ---------------------------------------------------------------------------
// Deal bridge lifecycle (topics plan phase 5, spec 01 §9.2): pause / resume
// and undo of an agent-created deal. Session-bound wrappers around the
// org-explicit deal engine (src/server/deal-engine.ts), which journals every
// write in `deal_activity`.
// ---------------------------------------------------------------------------

/** «Поставить на паузу»: `until` = YYYY-MM-DD (future), reason required. */
export async function pauseDealForUser(
  dealId: string,
  input: { until: string; reason: string },
): Promise<void> {
  const { session, activeOrgId } = await requireOrgContext()
  await assertDealInOrg(dealId, activeOrgId)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.until ?? "")) {
    throw new Error("Укажите дату возврата")
  }
  const until = new Date(`${input.until}T00:00:00Z`)
  if (Number.isNaN(until.getTime())) throw new Error("Неверная дата возврата")
  const today = new Date().toISOString().slice(0, 10)
  if (input.until <= today) {
    throw new Error("Дата возврата должна быть в будущем")
  }
  const reason = input.reason?.trim()
  if (!reason) throw new Error("Укажите причину паузы")
  await pauseDeal(
    activeOrgId,
    dealId,
    { kind: "user", userId: session.user.id },
    { until, reason },
  )
  await markStateDirtySafe(activeOrgId, dealId, "Изменено вручную: пауза")
}

/** «Снять с паузы» → status `active` (no-op when the deal is not paused). */
export async function resumeDealForUser(dealId: string): Promise<void> {
  const { session, activeOrgId } = await requireOrgContext()
  await assertDealInOrg(dealId, activeOrgId)
  await resumeDeal(activeOrgId, dealId, { kind: "user", userId: session.user.id })
  await markStateDirtySafe(activeOrgId, dealId, "Изменено вручную: снята пауза")
}

/** «Отменить» at the «создал агент» badge: status `deleted`, reason kept. */
export async function undoAgentCreatedDeal(
  dealId: string,
  reason: string | null,
): Promise<void> {
  const { session, activeOrgId } = await requireOrgContext()
  const current = await assertDealInOrg(dealId, activeOrgId)
  if (current.status !== "active" && current.status !== "paused") {
    throw new Error("Отменить можно только открытую сделку")
  }
  await undoAgentDeal(activeOrgId, dealId, session.user.id, reason)
}

export type DealProvenanceResult = DealProvenanceView & {
  /** Stage id → display label for the journal's from / to stages. */
  stageLabels: Record<string, string>
  /** Topic lead code → registry label (`signal_category.label_ru`). */
  leadCodeLabels: Record<string, string>
}

/** Deal drawer «Происхождение»: topics + items + the provenance journal. */
export async function getDealProvenance(
  dealId: string,
): Promise<DealProvenanceResult> {
  const { activeOrgId } = await requireOrgContext()
  await assertDealInOrg(dealId, activeOrgId)
  const view = await listDealProvenance(activeOrgId, dealId)

  const stageIds = new Set<string>()
  for (const a of view.activity) {
    if (a.fromStageId) stageIds.add(a.fromStageId)
    if (a.toStageId) stageIds.add(a.toStageId)
  }
  const leadCodes = new Set(
    view.topics.map((t) => t.leadCode).filter((c): c is string => !!c),
  )
  const [stageRows, codeRows] = await Promise.all([
    stageIds.size
      ? db
          .select({
            id: dealFunnelStage.id,
            name: dealFunnelStage.name,
            displayName: dealFunnelStage.displayName,
          })
          .from(dealFunnelStage)
          .where(inArray(dealFunnelStage.id, [...stageIds]))
      : Promise.resolve([]),
    leadCodes.size
      ? db
          .select({ code: signalCategory.code, labelRu: signalCategory.labelRu })
          .from(signalCategory)
          .where(inArray(signalCategory.code, [...leadCodes]))
      : Promise.resolve([]),
  ])
  return {
    ...view,
    stageLabels: Object.fromEntries(
      stageRows.map((r) => [r.id, stageDisplayLabel(r.name, r.displayName)]),
    ),
    leadCodeLabels: Object.fromEntries(codeRows.map((r) => [r.code, r.labelRu])),
  }
}

// ---------------------------------------------------------------------------
// «Текущее состояние» + «Риски» (topics plan phase 5a, spec topics/01 §9.3 /
// §9.4 / §14). Session-bound wrappers over the org-explicit engine
// (src/server/deal-state.ts, src/server/deal-risks.ts). The UI reads the
// stored text — no LLM call on page open.
// ---------------------------------------------------------------------------

/** One source item for «Источники» (opens /api/sources/items/[id]/markdown). */
export type DealSourceRef = {
  id: string
  title: string | null
  provider: string | null
  date: string | null
}

/** Source items of the caller's org only (foreign ids are dropped). */
async function loadSourceRefs(
  organizationId: string,
  ids: Iterable<string>,
): Promise<Record<string, DealSourceRef>> {
  const unique = [...new Set(ids)].filter(Boolean)
  if (unique.length === 0) return {}
  const rows = await db
    .select({
      id: sourceItem.id,
      provider: source.provider,
      title: sql<string | null>`coalesce(nullif(${sourceItem.metadataJson}->>'subject', ''), nullif(${sourceItem.filename}, ''))`,
      date: sql<Date | null>`coalesce(${sourceItem.sourceCreatedAt}, ${sourceItem.fetchedAt})`.mapWith(
        sourceItem.fetchedAt,
      ),
    })
    .from(sourceItem)
    .innerJoin(source, eq(sourceItem.sourceId, source.id))
    .where(
      and(
        inArray(sourceItem.id, unique),
        eq(sourceItem.organizationId, organizationId),
      ),
    )
  return Object.fromEntries(
    rows.map((r) => [
      r.id,
      {
        id: r.id,
        title: r.title,
        provider: r.provider,
        date: r.date ? new Date(r.date).toISOString() : null,
      },
    ]),
  )
}

/** Drawer «Текущее состояние»: stored text + versions + their source items. */
export type DealStateResult = DealStateView & {
  sources: Record<string, DealSourceRef>
  /** «Обновить» works only while the topics engine runs for the org. */
  canRefresh: boolean
}

/** Drawer «Риски»: active (most critical first) and cleared (newest first). */
export type DealRisksResult = {
  active: DealRiskView[]
  cleared: DealRiskView[]
  sources: Record<string, DealSourceRef>
}

export async function getDealStateForUser(dealId: string): Promise<DealStateResult> {
  const { activeOrgId } = await requireOrgContext()
  await assertDealInOrg(dealId, activeOrgId)
  const [state, mode] = await Promise.all([
    getDealState(activeOrgId, dealId),
    getTopicsMode(activeOrgId),
  ])
  // Shadow / off: users see nothing from the engine (spec topics/01 §12).
  if (mode !== "on") {
    return {
      ...state,
      text: null,
      sourceItemIds: [],
      updatedAt: null,
      dirtyAt: null,
      pending: false,
      versions: [],
      sources: {},
      canRefresh: false,
    }
  }
  return withStateSources(activeOrgId, state, true)
}

async function withStateSources(
  organizationId: string,
  state: DealStateView,
  canRefresh: boolean,
): Promise<DealStateResult> {
  const ids = [
    ...state.sourceItemIds,
    ...state.versions.flatMap((v) => v.sourceItemIds),
  ]
  return {
    ...state,
    sources: await loadSourceRefs(organizationId, ids),
    canRefresh,
  }
}

/**
 * «Обновить»: re-evaluates the deal's risks and runs `deals.state_summary`
 * NOW (one LLM call at most; the engine's `requestDealStateRefresh`). Only
 * while users see the engine output (topics mode `on`).
 */
export async function requestDealStateRefreshForUser(dealId: string): Promise<{
  decision: string
  state: DealStateResult
}> {
  const { session, activeOrgId } = await requireOrgContext()
  await assertDealInOrg(dealId, activeOrgId)
  if ((await getTopicsMode(activeOrgId)) !== "on") {
    throw new Error("Анализ тем не включён для организации — состояние сделки не обновляется")
  }
  const { result, state } = await requestDealStateRefresh(
    activeOrgId,
    dealId,
    session.user.id,
  )
  return {
    decision: result.decision,
    state: await withStateSources(activeOrgId, state, true),
  }
}

export async function listDealRisksForUser(dealId: string): Promise<DealRisksResult> {
  const { activeOrgId } = await requireOrgContext()
  await assertDealInOrg(dealId, activeOrgId)
  // Shadow / off: users see nothing from the engine (spec topics/01 §12).
  if ((await getTopicsMode(activeOrgId)) !== "on") return { active: [], cleared: [], sources: {} }
  const risks = await listDealRisks(activeOrgId, dealId)
  const sources: Record<string, DealSourceRef> = {}
  for (const r of risks) {
    for (const s of r.sources) {
      sources[s.sourceItemId] = {
        id: s.sourceItemId,
        title: s.subject,
        provider: s.provider,
        date: s.date,
      }
    }
  }
  // Explanation items the risk's own `sources` may not cover.
  const missing = risks
    .flatMap((r) => [...r.sourceItemIds, ...r.explanationSourceItemIds])
    .filter((id) => !sources[id])
  Object.assign(sources, await loadSourceRefs(activeOrgId, missing))
  return {
    active: risks.filter((r) => r.status === "active"),
    cleared: risks.filter((r) => r.status !== "active"),
    sources,
  }
}

/** «Риск снят»: reason required; journaled by the engine. `cleared: false`
 * = the risk was already cleared. */
export async function clearDealRiskForUser(
  dealId: string,
  riskId: string,
  reason: string,
): Promise<{ cleared: boolean }> {
  const { session, activeOrgId } = await requireOrgContext()
  await assertDealInOrg(dealId, activeOrgId)
  const trimmed = reason?.trim()
  if (!trimmed) throw new Error("Укажите, почему риск снят")
  if (!riskId) throw new Error("Не указан риск")
  return clearDealRiskByUser(activeOrgId, dealId, riskId, session.user.id, trimmed)
}

// R16: a manual deal edit is new deal information → the state run picks the
// deal up after the debounce. Never fails the edit itself.
async function markStateDirtySafe(
  organizationId: string,
  dealId: string,
  reason: string,
): Promise<void> {
  try {
    await markDealStateDirty(organizationId, dealId, reason)
  } catch (error) {
    console.error("[deals] markDealStateDirty failed", { dealId, reason, error })
  }
}

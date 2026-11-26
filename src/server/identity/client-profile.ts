// Client business profile «Профиль компании» — WRITE side + the block view
// (identity spec I5 / I6, docs/specs/identity/01-specification.md §4).
// Org-explicit core + session-bound wrappers (`*ForSession`, org and user from
// the session, never from input). Rules:
//   - read: any member of the org (tenant check on every client id → 404);
//   - edit (save, confirm a web value, accept / reject a proposal, «Заполнить
//     из интернета»): the client's responsible member («Ответственный») or
//     the org OWNER (Q3) — else 403;
//   - manual save: provenance `{ source: manual, byUserId, at, verified }` for
//     the CHANGED fields only (pure `manualSaveMeta`);
//   - web data: `applyWebProfileToClient` = the apply rule of §4.3 / Q5 (pure
//     `planWebProfileApply`) — empty fields filled unverified, filled fields
//     get a proposal, nothing is ever overwritten.
// Prompt texts / segments: src/server/identity/client-profile-context.ts.
//
// `import "server-only"`, NOT `"use server"` (rule 5).
import "server-only"

import { randomUUID } from "crypto"
import { and, desc, eq, inArray, sql } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"
import { db } from "@/db/drizzle"
import {
  client,
  clientProfile,
  clientProfileProposal,
  deal,
  dealFunnelStage,
  industry,
  member,
  order,
} from "@/db/schema"
import { getServerSession } from "@/lib/get-session"
import {
  CLIENT_PROFILE_FIELDS,
  clientProfileValuesSchema,
  isFieldEmpty,
  readFieldMeta,
  type ClientProfileField,
  type ClientProfileValues,
  type FieldMeta,
  type ProfileConfidence,
  type ProfileSource,
} from "@/lib/identity/client-profile"
import {
  canonicalClientProfile,
  fieldKey,
  fieldSlice,
  manualSaveMeta,
  planWebProfileApply,
  webRefreshDue,
  withFieldValue,
  type FieldSlice,
  type WebProfileCandidate,
} from "@/lib/identity/client-profile-apply"
import type { ClientRelation } from "@/lib/topics/types"
import { getClientSegments, profileRowToValues } from "@/server/identity/client-profile-context"
import { listIndustries, readOrgProfile, type IndustryOption } from "@/server/identity/org-profile"
import { loadUserNames } from "@/server/client-responsible"
import { deriveClientRelation } from "@/server/topics/lifecycle"
import { activateInitialRecord } from "@/server/entity-status"

export class ClientProfileError extends Error {
  constructor(
    public readonly status: 400 | 401 | 403 | 404 | 409,
    message: string,
  ) {
    super(message)
    this.name = "ClientProfileError"
  }
}

// ── Access ────────────────────────────────────────────────────────────────

type ClientHead = {
  id: string
  name: string
  organizationId: string
  responsibleUserId: string | null
  customFields: unknown
}

async function loadClientHead(orgId: string, clientId: string): Promise<ClientHead> {
  const rows = await db
    .select({
      id: client.id,
      name: client.name,
      organizationId: client.organizationId,
      responsibleUserId: client.responsibleUserId,
      customFields: client.customFields,
    })
    .from(client)
    .where(eq(client.id, clientId))
    .limit(1)
  const row = rows[0]
  // Another org's id reads as «not found» (no existence leak).
  if (!row || row.organizationId !== orgId) throw new ClientProfileError(404, "Компания не найдена")
  return row
}

async function orgRole(orgId: string, userId: string): Promise<string | null> {
  const rows = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)))
    .limit(1)
  return rows[0]?.role ?? null
}

/** Q3: the client's responsible member (main or additional, 2026-11-19) or the org owner. */
async function canEdit(orgId: string, userId: string, head: ClientHead): Promise<boolean> {
  const role = await orgRole(orgId, userId)
  if (!role) return false
  if (role === "owner" || head.responsibleUserId === userId) return true
  const { loadCoResponsibleIds } = await import("@/server/client-responsible")
  return ((await loadCoResponsibleIds(orgId, [head.id])).get(head.id) ?? []).includes(userId)
}

/** Throws 404 (not in org) / 403 (not responsible / owner). Returns the client head. */
export async function assertCanEditClientProfile(orgId: string, userId: string, clientId: string): Promise<ClientHead> {
  const head = await loadClientHead(orgId, clientId)
  if (!(await canEdit(orgId, userId, head))) {
    throw new ClientProfileError(403, "Профиль компании меняют ответственный за компанию и владелец организации")
  }
  return head
}

// ── Stored row ────────────────────────────────────────────────────────────

type ProfileRow = typeof clientProfile.$inferSelect

async function loadProfileRow(orgId: string, clientId: string): Promise<ProfileRow | null> {
  const rows = await db
    .select()
    .from(clientProfile)
    .where(and(eq(clientProfile.organizationId, orgId), eq(clientProfile.clientId, clientId)))
    .limit(1)
  return rows[0] ?? null
}

function valuesToColumns(v: ClientProfileValues) {
  return {
    description: v.description,
    industryCode: v.industryCode,
    industryNote: v.industryNote,
    marketRoles: v.marketRoles as string[],
    products: v.products,
    needs: v.needs,
    sizeBand: v.sizeBand,
    pointsOfSale: v.pointsOfSale,
    geography: v.geography,
  }
}

async function assertIndustry(code: string | null) {
  if (!code) return
  const ok = await db
    .select({ code: industry.code })
    .from(industry)
    .where(and(eq(industry.code, code), eq(industry.isActive, true)))
    .limit(1)
  if (!ok[0]) throw new ClientProfileError(400, "Неизвестная отрасль")
}

// ── View ──────────────────────────────────────────────────────────────────

export type FieldMetaView = FieldMeta & {
  byName: string | null
  verifiedByName: string | null
}

export type ClientProfileProposalView = {
  id: string
  field: ClientProfileField
  /** The proposed value slice of the field (same keys as `ClientProfileValues`). */
  value: FieldSlice
  source: ProfileSource
  confidence: ProfileConfidence | null
  evidenceUrl: string | null
  createdAt: string
}

export type ClientProfileView = {
  clientId: string
  clientName: string
  canEdit: boolean
  values: ClientProfileValues
  meta: Partial<Record<ClientProfileField, FieldMetaView>>
  /** Derived A / B / C by 12-month revenue; null = no revenue. */
  segment: "A" | "B" | "C" | null
  /** Derived relation (topics 06 §4.6): active | dormant | prospect | supplier. */
  relation: ClientRelation | null
  industries: IndustryOption[]
  /** Names of OUR product / service lines («Продукты и услуги» of the org profile) for «Что им интересно у нас». */
  ourProductLines: string[]
  proposals: ClientProfileProposalView[]
  webEnrichedAt: string | null
  /** A re-enrichment is allowed (never enriched, or ≥ 180 days ago). */
  webRefreshDue: boolean
  updatedAt: string | null
  updatedByName: string | null
}

/** Derived relation of ONE client (orders rhythm → companies tab tag → won deal). */
async function loadClientRelation(orgId: string, head: ClientHead, now: Date): Promise<ClientRelation | null> {
  try {
    const [orders, won] = await Promise.all([
      db
        .select({ at: order.orderDate })
        .from(order)
        .where(
          and(
            eq(order.organizationId, orgId),
            eq(order.clientId, head.id),
            inArray(order.status, ["confirmed", "finalized"]),
          ),
        ),
      db
        .select({ id: deal.id })
        .from(deal)
        .innerJoin(dealFunnelStage, eq(dealFunnelStage.id, deal.funnelStageId))
        .where(
          and(
            eq(deal.organizationId, orgId),
            eq(deal.clientId, head.id),
            eq(deal.status, "active"),
            eq(dealFunnelStage.role, "won"),
          ),
        )
        .limit(1),
    ])
    const kind = (head.customFields as { companyKind?: unknown } | null)?.companyKind
    return deriveClientRelation(
      {
        orderDates: orders.map((o) => o.at),
        companyKind: typeof kind === "string" ? kind : null,
        hasWonDeal: won.length > 0,
      },
      now,
    )
  } catch (e) {
    console.error("[client-profile] relation failed", orgId, head.id, e)
    return null
  }
}

function isProfileField(f: string): f is ClientProfileField {
  return (CLIENT_PROFILE_FIELDS as readonly string[]).includes(f)
}

export async function getClientProfileView(
  orgId: string,
  viewerUserId: string,
  clientId: string,
  now = new Date(),
): Promise<ClientProfileView> {
  const head = await loadClientHead(orgId, clientId)
  if (!(await orgRole(orgId, viewerUserId))) throw new ClientProfileError(404, "Компания не найдена")
  const [row, editable, segments, relation, industries, orgProfile, proposals] = await Promise.all([
    loadProfileRow(orgId, clientId),
    canEdit(orgId, viewerUserId, head),
    getClientSegments(orgId, now),
    loadClientRelation(orgId, head, now),
    listIndustries(),
    readOrgProfile(orgId),
    db
      .select()
      .from(clientProfileProposal)
      .where(
        and(
          eq(clientProfileProposal.organizationId, orgId),
          eq(clientProfileProposal.clientId, clientId),
          eq(clientProfileProposal.status, "pending"),
        ),
      )
      .orderBy(desc(clientProfileProposal.createdAt)),
  ])
  const meta = readFieldMeta(row?.fieldMeta)
  const names = await loadUserNames([
    row?.updatedByUserId,
    ...Object.values(meta).flatMap((m) => [m?.byUserId, m?.verifiedByUserId]),
  ])
  const metaView: Partial<Record<ClientProfileField, FieldMetaView>> = {}
  for (const f of CLIENT_PROFILE_FIELDS) {
    const m = meta[f]
    if (!m) continue
    metaView[f] = {
      ...m,
      byName: m.byUserId ? (names.get(m.byUserId) ?? null) : null,
      verifiedByName: m.verifiedByUserId ? (names.get(m.verifiedByUserId) ?? null) : null,
    }
  }
  return {
    clientId,
    clientName: head.name,
    canEdit: editable,
    values: profileRowToValues(row),
    meta: metaView,
    segment: segments.get(clientId) ?? null,
    relation,
    industries,
    ourProductLines: orgProfile.profile.products.map((p) => p.name).filter(Boolean),
    proposals: proposals
      .filter((p) => isProfileField(p.field))
      .map((p) => ({
        id: p.id,
        field: p.field as ClientProfileField,
        value: (p.value ?? {}) as FieldSlice,
        source: p.source as ProfileSource,
        confidence: (p.confidence as ProfileConfidence | null) ?? null,
        evidenceUrl: p.evidenceUrl,
        createdAt: p.createdAt.toISOString(),
      })),
    webEnrichedAt: row?.webEnrichedAt?.toISOString() ?? null,
    webRefreshDue: webRefreshDue(row?.webEnrichedAt ?? null, now),
    updatedAt: row?.updatedAt?.toISOString() ?? null,
    updatedByName: row?.updatedByUserId ? (names.get(row.updatedByUserId) ?? null) : null,
  }
}

// ── Manual save ───────────────────────────────────────────────────────────

export type SaveClientProfileResult = { changed: ClientProfileField[] }

/**
 * Save as `userId` (responsible / owner, else 403). zod → 400, unknown
 * industry → 400. Only CHANGED fields get manual provenance; no change = no
 * write.
 */
export async function saveClientProfile(
  orgId: string,
  userId: string,
  clientId: string,
  input: unknown,
  now = new Date(),
): Promise<SaveClientProfileResult> {
  await assertCanEditClientProfile(orgId, userId, clientId)
  const parsed = clientProfileValuesSchema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new ClientProfileError(400, issue?.message ? `Некорректные данные: ${issue.message}` : "Некорректные данные")
  }
  const next = canonicalClientProfile(parsed.data)
  await assertIndustry(next.industryCode)

  const row = await loadProfileRow(orgId, clientId)
  const before = canonicalClientProfile(profileRowToValues(row))
  const { meta, changed } = manualSaveMeta(before, next, readFieldMeta(row?.fieldMeta), userId, now.toISOString())
  if (changed.length === 0) return { changed: [] }

  const cols = { ...valuesToColumns(next), fieldMeta: meta as Record<string, unknown>, updatedByUserId: userId, updatedAt: now }
  await db
    .insert(clientProfile)
    .values({ clientId, organizationId: orgId, ...cols, createdAt: now })
    .onConflictDoUpdate({ target: clientProfile.clientId, set: cols })
  return { changed }
}

// ── Confirm an automatic value («Подтвердить») ────────────────────────────

export async function confirmClientProfileField(
  orgId: string,
  userId: string,
  clientId: string,
  field: unknown,
  now = new Date(),
): Promise<{ field: ClientProfileField }> {
  await assertCanEditClientProfile(orgId, userId, clientId)
  if (typeof field !== "string" || !isProfileField(field)) throw new ClientProfileError(400, "Неизвестное поле профиля")
  const row = await loadProfileRow(orgId, clientId)
  const meta = readFieldMeta(row?.fieldMeta)
  const m = meta[field]
  if (!row || !m || isFieldEmpty(profileRowToValues(row), field)) {
    throw new ClientProfileError(400, "Нечего подтверждать: поле пустое")
  }
  if (m.verified) return { field }
  meta[field] = { ...m, verified: true, verifiedByUserId: userId, verifiedAt: now.toISOString() }
  await db
    .update(clientProfile)
    .set({ fieldMeta: meta as Record<string, unknown>, updatedByUserId: userId, updatedAt: now })
    .where(and(eq(clientProfile.organizationId, orgId), eq(clientProfile.clientId, clientId)))
  return { field }
}

/**
 * «Убрать» (2026-11-21): a person removes an AUTOMATIC value they did not
 * confirm (web / communications / import, `verified: false`). The field
 * becomes empty; its meta becomes a tombstone with `removedKey` so the next
 * web fill skips the same value (`planWebProfileApply`).
 */
export async function removeClientProfileField(
  orgId: string,
  userId: string,
  clientId: string,
  field: unknown,
  now = new Date(),
): Promise<{ field: ClientProfileField }> {
  await assertCanEditClientProfile(orgId, userId, clientId)
  if (typeof field !== "string" || !isProfileField(field)) throw new ClientProfileError(400, "Неизвестное поле профиля")
  const row = await loadProfileRow(orgId, clientId)
  const meta = readFieldMeta(row?.fieldMeta)
  const m = meta[field]
  const values = profileRowToValues(row)
  if (!row || !m || isFieldEmpty(values, field)) throw new ClientProfileError(400, "Нечего убирать: поле пустое")
  if (m.source === "manual" || m.verified) {
    throw new ClientProfileError(400, "Убрать можно только непроверенное значение из интернета или переписки")
  }
  const next = withFieldValue(values, field, {})
  meta[field] = {
    source: m.source,
    at: m.at,
    verified: false,
    removedKey: fieldKey(values, field),
    removedByUserId: userId,
    removedAt: now.toISOString(),
  }
  await db
    .update(clientProfile)
    .set({ ...valuesToColumns(next), fieldMeta: meta as Record<string, unknown>, updatedByUserId: userId, updatedAt: now })
    .where(and(eq(clientProfile.organizationId, orgId), eq(clientProfile.clientId, clientId)))
  return { field }
}

// ── Proposals («Принять» / «Отклонить») ───────────────────────────────────

/**
 * Accept writes the proposal value with ITS source + confidence + evidence,
 * `verified: true`, `verifiedByUserId` = the decider (the field had a value —
 * the KAM chose to replace it). Reject only closes the proposal. Other
 * pending proposals of the same field are superseded on accept.
 */
export async function decideClientProfileProposal(
  orgId: string,
  userId: string,
  clientId: string,
  proposalId: unknown,
  accept: boolean,
  now = new Date(),
): Promise<{ field: ClientProfileField; status: "accepted" | "rejected" }> {
  await assertCanEditClientProfile(orgId, userId, clientId)
  if (typeof proposalId !== "string" || !proposalId) throw new ClientProfileError(400, "Не указано предложение")
  const rows = await db
    .select()
    .from(clientProfileProposal)
    .where(
      and(
        eq(clientProfileProposal.id, proposalId),
        eq(clientProfileProposal.organizationId, orgId),
        eq(clientProfileProposal.clientId, clientId),
      ),
    )
    .limit(1)
  const p = rows[0]
  if (!p || !isProfileField(p.field)) throw new ClientProfileError(404, "Предложение не найдено")
  if (p.status !== "pending") throw new ClientProfileError(409, "Предложение уже обработано")
  const field = p.field

  const closeThis = db
    .update(clientProfileProposal)
    .set({ status: accept ? "accepted" : "rejected", decidedByUserId: userId, decidedAt: now })
    .where(eq(clientProfileProposal.id, p.id))
  if (!accept) {
    await closeThis
    return { field, status: "rejected" }
  }

  const row = await loadProfileRow(orgId, clientId)
  const current = canonicalClientProfile(profileRowToValues(row))
  const next = withFieldValue(current, field, (p.value ?? {}) as FieldSlice)
  const checked = clientProfileValuesSchema.safeParse(next)
  if (!checked.success) throw new ClientProfileError(400, "Предложение содержит некорректное значение")
  await assertIndustry(next.industryCode)
  const meta = readFieldMeta(row?.fieldMeta)
  const at = now.toISOString()
  const source = (["manual", "web", "communications", "import"] as const).includes(p.source as ProfileSource)
    ? (p.source as ProfileSource)
    : "web"
  meta[field] = {
    source,
    at,
    confidence: (p.confidence as ProfileConfidence | null) ?? null,
    evidenceUrl: p.evidenceUrl,
    verified: true,
    verifiedByUserId: userId,
    verifiedAt: at,
  }
  const cols = { ...valuesToColumns(next), fieldMeta: meta as Record<string, unknown>, updatedByUserId: userId, updatedAt: now }
  await db.batch([
    db
      .insert(clientProfile)
      .values({ clientId, organizationId: orgId, ...cols, createdAt: now })
      .onConflictDoUpdate({ target: clientProfile.clientId, set: cols }),
    closeThis,
    db
      .update(clientProfileProposal)
      .set({ status: "superseded", decidedByUserId: userId, decidedAt: now })
      .where(
        and(
          eq(clientProfileProposal.organizationId, orgId),
          eq(clientProfileProposal.clientId, clientId),
          eq(clientProfileProposal.field, field),
          eq(clientProfileProposal.status, "pending"),
          sql`${clientProfileProposal.id} <> ${p.id}`,
        ),
      ),
  ])
  return { field, status: "accepted" }
}

// ── Web data → profile (apply rule) ───────────────────────────────────────

export type ApplyWebProfileResult = {
  filled: ClientProfileField[]
  proposed: ClientProfileField[]
  unchanged: ClientProfileField[]
}

/**
 * Apply web values to the client's profile (spec §4.3 / Q5, pure
 * `planWebProfileApply`): empty fields filled unverified, filled fields → a
 * pending proposal (older pending proposal of the field → superseded),
 * identical values → nothing. Always stamps `web_enriched_at`. One batch.
 * Org-explicit, no permission check (callers check: the button, the batch
 * of the active org, enrichment on create).
 */
export async function applyWebProfileToClient(
  orgId: string,
  clientId: string,
  incoming: readonly WebProfileCandidate[],
  now = new Date(),
  source: ProfileSource = "web",
): Promise<ApplyWebProfileResult> {
  await loadClientHead(orgId, clientId)
  const [row, pending] = await Promise.all([
    loadProfileRow(orgId, clientId),
    db
      .select({ id: clientProfileProposal.id, field: clientProfileProposal.field, value: clientProfileProposal.value })
      .from(clientProfileProposal)
      .where(
        and(
          eq(clientProfileProposal.organizationId, orgId),
          eq(clientProfileProposal.clientId, clientId),
          eq(clientProfileProposal.status, "pending"),
        ),
      ),
  ])
  const plan = planWebProfileApply({
    values: profileRowToValues(row),
    meta: readFieldMeta(row?.fieldMeta),
    pending,
    incoming,
    at: now.toISOString(),
    source,
  })

  const cols = {
    ...(plan.filled.length > 0 ? valuesToColumns(plan.values) : {}),
    fieldMeta: plan.meta as Record<string, unknown>,
    webEnrichedAt: now,
    updatedAt: now,
  }
  const upsert: BatchItem<"pg"> = row
    ? db
        .update(clientProfile)
        .set(cols)
        .where(and(eq(clientProfile.organizationId, orgId), eq(clientProfile.clientId, clientId)))
    : db
        .insert(clientProfile)
        .values({ clientId, organizationId: orgId, ...valuesToColumns(plan.values), ...cols, createdAt: now })
        .onConflictDoNothing()

  const rest: BatchItem<"pg">[] = []
  if (plan.supersede.length > 0) {
    rest.push(
      db
        .update(clientProfileProposal)
        .set({ status: "superseded", decidedAt: now })
        .where(
          and(
            eq(clientProfileProposal.organizationId, orgId),
            inArray(clientProfileProposal.id, plan.supersede),
            eq(clientProfileProposal.status, "pending"),
          ),
        ),
    )
  }
  if (plan.proposals.length > 0) {
    rest.push(
      db.insert(clientProfileProposal).values(
        plan.proposals.map((p) => ({
          id: randomUUID(),
          clientId,
          organizationId: orgId,
          field: p.field,
          value: fieldSlice(withFieldValue(plan.values, p.field, p.value), p.field),
          source,
          confidence: p.confidence,
          evidenceUrl: p.evidenceUrl,
          status: "pending",
          createdAt: now,
        })),
      ),
    )
  }
  await db.batch([upsert, ...rest])
  return { filled: plan.filled, proposed: plan.proposals.map((p) => p.field), unchanged: plan.unchanged }
}

// ── Session wrappers ──────────────────────────────────────────────────────

export async function requireClientProfileSession(): Promise<{ orgId: string; userId: string; isPlatformAdmin: boolean }> {
  const session = await getServerSession()
  const orgId = session?.session.activeOrganizationId
  if (!session || !orgId) throw new ClientProfileError(401, "Нужно войти в систему")
  return { orgId, userId: session.user.id, isPlatformAdmin: session.user.role === "admin" }
}

export async function getClientProfileViewForSession(clientId: string): Promise<ClientProfileView> {
  const { orgId, userId } = await requireClientProfileSession()
  return getClientProfileView(orgId, userId, clientId)
}

export async function saveClientProfileForSession(clientId: string, input: unknown): Promise<SaveClientProfileResult> {
  const { orgId, userId } = await requireClientProfileSession()
  const result = await saveClientProfile(orgId, userId, clientId, input)
  // A person saved «Профиль компании» → an automatic «Новая» company is
  // confirmed (2026-11-26, src/server/entity-status.ts).
  if (result.changed.length > 0) await activateInitialRecord(orgId, "client", clientId)
  return result
}

export async function confirmClientProfileFieldForSession(clientId: string, field: unknown) {
  const { orgId, userId } = await requireClientProfileSession()
  return confirmClientProfileField(orgId, userId, clientId, field)
}

export async function removeClientProfileFieldForSession(clientId: string, field: unknown) {
  const { orgId, userId } = await requireClientProfileSession()
  return removeClientProfileField(orgId, userId, clientId, field)
}

export async function decideClientProfileProposalForSession(clientId: string, proposalId: unknown, accept: boolean) {
  const { orgId, userId } = await requireClientProfileSession()
  return decideClientProfileProposal(orgId, userId, clientId, proposalId, accept)
}

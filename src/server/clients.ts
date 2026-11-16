"use server"

import { db } from "@/db/drizzle"
import { clientRelation } from "@/lib/client-relation"
import {
  client,
  clientProfile,
  contact,
  order,
  deal,
  type FunnelPhase,
  type EntityStatus,
  type ClientLookupCandidateJson,
  user,
} from "@/db/schema"
import {
  and,
  eq,
  ne,
  desc,
  isNull,
  or,
  count,
  inArray,
  gte,
  sql,
} from "drizzle-orm"
import { isOpenStageRole, OPEN_DEAL_STATUSES } from "@/lib/deal-funnel"
import { computeOrderDiscount } from "@/lib/orders-format"
import { loadClientLastActivity } from "@/server/client-activity"
import { listDealFunnelStages } from "@/server/deals"
import {
  listTaskSummaryByClient,
  type ClientTaskSummary,
} from "@/server/tasks"
import { getServerSession } from "@/lib/get-session"
import { matchesCustomFilters, parseCustomFilters } from "@/lib/custom-fields"
import { listCustomFields } from "@/server/custom-fields"
import { onEntityStatusChanged } from "@/server/topics/integration"
import {
  loadResponsibleNames,
  responsibleInfoOf,
  type ClientResponsibleInfo,
} from "@/server/client-responsible"
import {
  HANDOVER_NOTE_KEY,
  matchesResponsibleFilter,
  type ResponsibleFilter,
} from "@/lib/client-responsible"
import { randomUUID } from "crypto"
import {
  applyCandidateProfileForOrg,
  candidatePatch,
  enrichClientForOrg,
  lookupClientOnWebForOrg,
  scheduleEnrichOnCreate,
  type ClientLookupCandidate,
  type ClientLookupHints,
  type ClientLookupResult,
  type EnrichClientResult,
  type EnrichFillable,
} from "@/server/identity/client-enrichment"
import {
  isCompanyKind,
  normalizeDiscountPercent,
  type ClientCustomFields,
} from "@/lib/client-custom-fields"

export type ClientContactPreview = {
  id: string
  name: string
  nameNative: string | null
  email: string | null
  phone: string | null
  position: string | null
  status: EntityStatus
}

export type ClientRow = ClientResponsibleInfo & {
  id: string
  name: string
  namePhys: string | null
  comment: string | null
  aliases: string[] | null
  phone: string | null
  email: string | null
  address: string | null
  webUrl: string | null
  customFields: ClientCustomFields
  funnelPhase: FunnelPhase
  status: EntityStatus
  currency: string
  userId: string
  userName: string | null
  organizationId: string
  createdAt: string
  updatedAt: string
  // Реальная последняя активность (письма/карточки, задачи, сделки, заказы,
  // контакты — см. loadClientLastActivity). Заполняется лентой /clients;
  // где её нет, бейдж «N дн без контакта» откатывается на updatedAt.
  lastActivityAt?: string
  contacts: ClientContactPreview[]
  /**
   * Short «Профиль компании» tags (identity I5) for the Companies feed badges
   * — only on `listClientsFeed` rows; null when the client has no profile row.
   */
  profileTags?: ClientProfileTags | null
  /** Custom field values («Поля») — only on `listClientsFeed` rows (list columns). */
  customValues?: Record<string, unknown>
}

export type ClientProfileTags = {
  industryCode: string | null
  marketRoles: string[]
  sizeBand: string | null
  pointsOfSale: number | null
}

function maxIso(a: Date, b: Date | undefined): string {
  return (b && b > a ? b : a).toISOString()
}

async function requireOrgContext() {
  const session = await getServerSession()
  if (!session) throw new Error("Unauthorized")
  const activeOrgId = session.session.activeOrganizationId
  if (!activeOrgId) throw new Error("No active organization")
  return { session, activeOrgId }
}

async function assertClientInOrg(clientId: string, organizationId: string) {
  const existing = await db
    .select()
    .from(client)
    .where(eq(client.id, clientId))
    .limit(1)
  const current = existing[0]
  if (!current) throw new Error("Client not found")
  if (current.organizationId !== organizationId) {
    throw new Error("Unauthorized")
  }
  return current
}

export async function listClients(): Promise<ClientRow[]> {
  const { activeOrgId } = await requireOrgContext()

  const rows = await db
    .select({
      client,
      userName: user.name,
    })
    .from(client)
    .leftJoin(user, eq(client.userId, user.id))
    .where(eq(client.organizationId, activeOrgId))
    .orderBy(desc(client.updatedAt))

  const clientIds = rows.map((r) => r.client.id)
  const responsibleNames = await loadResponsibleNames(rows.map((r) => r.client))
  const contacts = clientIds.length
    ? await db
        .select()
        .from(contact)
        .where(
          and(
            eq(contact.organizationId, activeOrgId),
            // Show every linked contact except soft-deleted ones — matches the
            // client detail page (`getClientDetail`, `ne(status,'deleted')`).
            // The old `status='active'` filter hid `initial` (New) contacts, so
            // a discovery-linked contact (created `initial`) silently vanished
            // from a New client's card even though the link exists.
            ne(contact.status, "deleted"),
          ),
        )
    : []

  const contactsByClient = new Map<string, ClientContactPreview[]>()
  for (const c of contacts) {
    if (!c.clientId) continue
    const list = contactsByClient.get(c.clientId) ?? []
    list.push({
      id: c.id,
      name: c.name,
      nameNative: c.nameNative,
      email: c.email,
      phone: c.phone,
      position: c.position,
      status: c.status,
    })
    contactsByClient.set(c.clientId, list)
  }

  return rows.map((r) => ({
    id: r.client.id,
    name: r.client.name,
    namePhys: r.client.namePhys,
    comment: r.client.comment,
    aliases: r.client.aliases,
    phone: r.client.phone,
    email: r.client.email,
    address: r.client.address,
    webUrl: r.client.webUrl,
    customFields: r.client.customFields ?? {},
    funnelPhase: r.client.funnelPhase,
    status: r.client.status,
    currency: r.client.currency,
    userId: r.client.userId,
    userName: r.userName,
    ...responsibleInfoOf(r.client, responsibleNames),
    organizationId: r.client.organizationId,
    createdAt: r.client.createdAt.toISOString(),
    updatedAt: r.client.updatedAt.toISOString(),
    contacts: contactsByClient.get(r.client.id) ?? [],
  }))
}

export type ClientRevenueSummary = { revenue: number; orders: number }

// Выручка по компании за последние 12 мес. — один батч-запрос на всю
// страницу (не по одному на карточку). Те же BOOKED (finalized|confirmed) +
// NET (computeOrderDiscount) правила, что и в аналитике
// (src/server/analytics-query.ts), но без top-12-лимита и с окном "последний
// год" вместо произвольного диапазона дашборда.
export async function listClientRevenue12mo(): Promise<
  Record<string, ClientRevenueSummary>
> {
  const { activeOrgId } = await requireOrgContext()
  const since = new Date()
  since.setFullYear(since.getFullYear() - 1)

  const rows = await db
    .select({
      clientId: order.clientId,
      totalAmount: order.totalAmount,
      discountPercent: order.discountPercent,
    })
    .from(order)
    .where(
      and(
        eq(order.organizationId, activeOrgId),
        inArray(order.status, ["finalized", "confirmed"]),
        gte(order.orderDate, since),
      ),
    )

  const result: Record<string, ClientRevenueSummary> = {}
  for (const r of rows) {
    const { discountedTotal } = computeOrderDiscount(
      Number(r.totalAmount),
      Number(r.discountPercent),
    )
    const bucket = result[r.clientId] ?? { revenue: 0, orders: 0 }
    bucket.revenue += discountedTotal
    bucket.orders += 1
    result[r.clientId] = bucket
  }
  return result
}

export type ClientFeedTab =
  | "all"
  | "customers"
  | "potential"
  | "supplier"
  | "partner"
  | "unclassified"

// Companies page (redesign): 5 tabs, driven by a mix of deal state (Клиенты/
// Потенциальные — auto) and a manual `customFields.companyKind` tag
// (Поставщики/Партнёры, since deal state can't tell them apart — both may
// have zero deals). A manual tag always wins over deal-derived classification.
// «Не определено» catches companies with neither signal, so nothing silently
// disappears from every tab.
//
// Sort ("criticality", a heuristic proxy — TODO(backend): a real priority
// score, mirroring the same disclaimer already on `clientAtRisk` / the deals
// board's mock `agentPriorityScore`): overdue tasks first, then stale
// (no-contact) clients, then most-recently-touched first as the final tiebreak.
//
// This runs the tab/sort logic in JS over the org's full client set rather
// than a single paginated SQL query — acceptable at demo/pilot scale, same
// posture as `src/server/teardown.ts`'s org-wide resolution and the chat's
// `searchEverything` tool.
export async function listClientsFeed(params: {
  tab: ClientFeedTab
  status?: EntityStatus | "all"
  /** «Ответственный» filter: all | mine | handover | <member user id>. */
  responsible?: ResponsibleFilter | null
  /** «Профиль компании» filters (identity I5): industry code / market role / size band; "none" = not set. */
  industry?: string | null
  role?: string | null
  size?: string | null
  /** Custom field filters, `?cf=` JSON (docs/specs/clients-contacts §3.5). */
  customFilters?: string | null
  limit?: number
  offset?: number
}): Promise<{
  rows: ClientRow[]
  total: number
  taskSummary: Record<string, ClientTaskSummary>
}> {
  const { activeOrgId, session } = await requireOrgContext()
  const viewerUserId = session.user.id
  // До 500 — страница /clients грузит вкладку целиком и сортирует на клиенте.
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 500)
  const offset = Math.max(params.offset ?? 0, 0)

  const stages = await listDealFunnelStages()
  // By stage ROLE (docs/specs/funnel §3.1), never by name / probability:
  // won = «закрыта», area0 + active = «потенциальный» (area 0 — a target
  // company we already work with, even before an active opportunity).
  const closedStageIds = new Set(
    stages.filter((s) => s.role === "won").map((s) => s.id),
  )
  const openStageIds = new Set(
    stages.filter((s) => isOpenStageRole(s.role)).map((s) => s.id),
  )

  const dealRows = await db
    .select({ clientId: deal.clientId, funnelStageId: deal.funnelStageId })
    .from(deal)
    .where(and(eq(deal.organizationId, activeOrgId), inArray(deal.status, [...OPEN_DEAL_STATUSES])))

  const hasClosed = new Set<string>()
  const hasOpen = new Set<string>()
  for (const d of dealRows) {
    if (closedStageIds.has(d.funnelStageId)) hasClosed.add(d.clientId)
    else if (openStageIds.has(d.funnelStageId)) hasOpen.add(d.clientId)
  }

  const statusConditions =
    params.status && params.status !== "all"
      ? [eq(client.status, params.status)]
      : [ne(client.status, "deleted"), ne(client.status, "blocked")]

  const rows = await db
    .select({
      client,
      userName: user.name,
      profile: {
        clientId: clientProfile.clientId,
        industryCode: clientProfile.industryCode,
        marketRoles: clientProfile.marketRoles,
        sizeBand: clientProfile.sizeBand,
        pointsOfSale: clientProfile.pointsOfSale,
      },
    })
    .from(client)
    .leftJoin(user, eq(client.userId, user.id))
    .leftJoin(clientProfile, eq(clientProfile.clientId, client.id))
    .where(and(eq(client.organizationId, activeOrgId), ...statusConditions))

  const taskSummary = await listTaskSummaryByClient()
  const cfDefs = params.customFilters ? await listCustomFields(activeOrgId, "client") : []
  const cfFilters = parseCustomFilters(params.customFilters, cfDefs)

  const industryFilter = (params.industry ?? "").trim()
  const roleFilter = (params.role ?? "").trim()
  const sizeFilter = (params.size ?? "").trim()
  const matchesProfile = (p: (typeof rows)[number]["profile"]) => {
    if (industryFilter) {
      const code = p?.industryCode ?? null
      if (industryFilter === "none" ? code !== null : code !== industryFilter) return false
    }
    if (roleFilter) {
      const roles = p?.marketRoles ?? []
      if (roleFilter === "none" ? roles.length > 0 : !roles.includes(roleFilter)) return false
    }
    if (sizeFilter) {
      const band = p?.sizeBand ?? null
      if (sizeFilter === "none" ? band !== null : band !== sizeFilter) return false
    }
    return true
  }

  const matching = rows.filter((r) => {
    if (!matchesResponsibleFilter(params.responsible, r.client, viewerUserId)) return false
    if (!matchesProfile(r.profile)) return false
    if (cfFilters.length && !matchesCustomFilters(r.client.customValues as Record<string, unknown>, cfFilters, cfDefs)) return false
    if (params.tab === "all") return true
    // ONE rule for the tabs and the AI chat's «Отношения» (src/lib/client-relation.ts).
    return (
      clientRelation({
        companyKind: r.client.customFields?.companyKind,
        hasWonDeal: hasClosed.has(r.client.id),
        hasOpenDeal: hasOpen.has(r.client.id),
      }) === params.tab
    )
  })

  // Базовый порядок — по дате добавления, новые наверху. Страница грузит
  // ленту вкладки целиком (limit до 500) и пересортировывает её сама
  // (`sortClientFeed` в src/lib/client-feed-sort.ts — там же «Сначала
  // критичные»), чтобы переключение было мгновенным и с анимацией.
  matching.sort(
    (a, b) => b.client.createdAt.getTime() - a.client.createdAt.getTime(),
  )

  const total = matching.length
  const page = matching.slice(offset, offset + limit)

  const clientIds = page.map((r) => r.client.id)
  const contacts = clientIds.length
    ? await db
        .select()
        .from(contact)
        .where(
          and(
            eq(contact.organizationId, activeOrgId),
            ne(contact.status, "deleted"),
            inArray(contact.clientId, clientIds),
          ),
        )
    : []
  const contactsByClient = new Map<string, ClientContactPreview[]>()
  for (const c of contacts) {
    if (!c.clientId) continue
    const list = contactsByClient.get(c.clientId) ?? []
    list.push({
      id: c.id,
      name: c.name,
      nameNative: c.nameNative,
      email: c.email,
      phone: c.phone,
      position: c.position,
      status: c.status,
    })
    contactsByClient.set(c.clientId, list)
  }

  const [lastActivity, responsibleNames] = await Promise.all([
    loadClientLastActivity(activeOrgId, clientIds),
    loadResponsibleNames(page.map((r) => r.client)),
  ])

  const pageTaskSummary: Record<string, ClientTaskSummary> = {}
  for (const id of clientIds) {
    if (taskSummary[id]) pageTaskSummary[id] = taskSummary[id]
  }

  return {
    total,
    taskSummary: pageTaskSummary,
    rows: page.map((r) => ({
      id: r.client.id,
      name: r.client.name,
      namePhys: r.client.namePhys,
      comment: r.client.comment,
      aliases: r.client.aliases,
      phone: r.client.phone,
      email: r.client.email,
      address: r.client.address,
      webUrl: r.client.webUrl,
      customFields: r.client.customFields ?? {},
      customValues: (r.client.customValues ?? {}) as Record<string, unknown>,
      funnelPhase: r.client.funnelPhase,
      status: r.client.status,
      currency: r.client.currency,
      userId: r.client.userId,
      userName: r.userName,
      ...responsibleInfoOf(r.client, responsibleNames),
      organizationId: r.client.organizationId,
      createdAt: r.client.createdAt.toISOString(),
      updatedAt: r.client.updatedAt.toISOString(),
      lastActivityAt: maxIso(
        r.client.updatedAt,
        lastActivity.get(r.client.id),
      ),
      contacts: contactsByClient.get(r.client.id) ?? [],
      profileTags: r.profile?.clientId
        ? {
            industryCode: r.profile.industryCode,
            marketRoles: r.profile.marketRoles ?? [],
            sizeBand: r.profile.sizeBand,
            pointsOfSale: r.profile.pointsOfSale,
          }
        : null,
    })),
  }
}

/** Trim, drop empties + dups; return null for an empty list. */
function cleanAliases(raw: string[] | null | undefined): string[] | null {
  if (!Array.isArray(raw)) return null
  const out: string[] = []
  const seen = new Set<string>()
  for (const a of raw) {
    const t = (typeof a === "string" ? a : "").trim()
    if (!t) continue
    const lower = t.toLowerCase()
    if (seen.has(lower)) continue
    seen.add(lower)
    out.push(t)
  }
  return out.length > 0 ? out : null
}

/**
 * Normalise the system bag `client.custom_fields`: the `discount` percentage
 * (a whole 0–100, omitted when unset) and `companyKind`. Unknown keys are
 * dropped — the server controls what lands. Org-defined fields (incl. the
 * «Тип клиента» converted from the old `type` key) live in
 * `client.custom_values` (src/server/custom-fields.ts).
 */
function normalizeClientCustomFields(
  raw: ClientCustomFields | null | undefined,
): ClientCustomFields {
  const out: ClientCustomFields = {}
  const discount = normalizeDiscountPercent(raw?.discount)
  if (discount != null) out.discount = discount
  if (isCompanyKind(raw?.companyKind)) out.companyKind = raw.companyKind
  return out
}

/** The pending-handover note is server-controlled: keep the stored one, never the form's. */
function keepHandoverNote(
  next: ClientCustomFields,
  stored: ClientCustomFields | null | undefined,
): ClientCustomFields {
  const note = stored?.[HANDOVER_NOTE_KEY]
  return note === undefined ? next : { ...next, [HANDOVER_NOTE_KEY]: note }
}

// Допустимые валюты расчётов. Неизвестное значение приводим к RUB
// (форма присылает корректные коды; защита от мусора через API).
const ALLOWED_CURRENCIES = ["RUB", "USD", "EUR", "GBP", "CNY"]
function normaliseClientCurrency(currency: string | null | undefined): string {
  const c = (currency ?? "").toUpperCase()
  return ALLOWED_CURRENCIES.includes(c) ? c : "RUB"
}

export async function createClient(data: {
  name: string
  namePhys?: string | null
  comment?: string | null
  aliases?: string[] | null
  phone?: string | null
  email?: string | null
  address?: string | null
  webUrl?: string | null
  customFields?: ClientCustomFields | null
  funnelPhase?: FunnelPhase
  status?: EntityStatus
  currency?: string
}) {
  const { session, activeOrgId } = await requireOrgContext()
  if (!data.name?.trim()) throw new Error("Name is required")

  const id = randomUUID()
  const now = new Date()
  await db.insert(client).values({
    id,
    name: data.name.trim(),
    namePhys: data.namePhys?.trim() || null,
    comment: data.comment?.trim() || null,
    aliases: cleanAliases(data.aliases),
    phone: data.phone?.trim() || null,
    email: data.email?.trim() || null,
    address: data.address?.trim() || null,
    webUrl: data.webUrl?.trim() || null,
    customFields: normalizeClientCustomFields(data.customFields),
    funnelPhase: data.funnelPhase ?? "awareness",
    status: data.status ?? "active",
    currency: normaliseClientCurrency(data.currency),
    userId: session.user.id,
    // «Ответственный» defaults to the creator; changed only through
    // src/server/client-responsible.ts (owner assigns / handover to owner).
    responsibleUserId: session.user.id,
    organizationId: activeOrgId,
    createdAt: now,
    updatedAt: now,
  })
  // Identity I6 (Q6): when the org switched on «Заполнять профиль новых
  // компаний из интернета», enrich the new client after the response
  // (never blocks / fails the create).
  await scheduleEnrichOnCreate(activeOrgId, session.user.id, [id])
  return { id }
}

export async function updateClient(
  clientId: string,
  data: {
    name?: string
    namePhys?: string | null
    comment?: string | null
    aliases?: string[] | null
    phone?: string | null
    email?: string | null
    address?: string | null
    webUrl?: string | null
    customFields?: ClientCustomFields | null
    funnelPhase?: FunnelPhase
    status?: EntityStatus
    currency?: string
  },
) {
  const { session, activeOrgId } = await requireOrgContext()
  const current = await assertClientInOrg(clientId, activeOrgId)
  // «Ответственный» is NOT editable here (src/server/client-responsible.ts):
  // refuse a payload that tries, so this generic update is no way around
  // the owner / handover rules.
  const raw = data as Record<string, unknown>
  if (
    "responsibleUserId" in raw ||
    "responsibleHandoverFromUserId" in raw ||
    "responsibleChangedByUserId" in raw ||
    "responsibleChangedAt" in raw
  ) {
    throw new Error("Ответственного меняют отдельным действием (назначение владельцем или передача владельцу)")
  }

  if (data.name !== undefined && !data.name.trim()) {
    throw new Error("Name is required")
  }

  await db
    .update(client)
    .set({
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.namePhys !== undefined
        ? { namePhys: data.namePhys?.trim() || null }
        : {}),
      ...(data.comment !== undefined
        ? { comment: data.comment?.trim() || null }
        : {}),
      ...(data.aliases !== undefined
        ? { aliases: cleanAliases(data.aliases) }
        : {}),
      ...(data.phone !== undefined
        ? { phone: data.phone?.trim() || null }
        : {}),
      ...(data.email !== undefined
        ? { email: data.email?.trim() || null }
        : {}),
      ...(data.address !== undefined
        ? { address: data.address?.trim() || null }
        : {}),
      ...(data.webUrl !== undefined
        ? { webUrl: data.webUrl?.trim() || null }
        : {}),
      ...(data.customFields !== undefined
        ? {
            customFields: keepHandoverNote(
              normalizeClientCustomFields(data.customFields),
              current.customFields,
            ),
          }
        : {}),
      ...(data.funnelPhase !== undefined
        ? { funnelPhase: data.funnelPhase }
        : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.currency !== undefined
        ? { currency: normaliseClientCurrency(data.currency) }
        : {}),
    })
    .where(eq(client.id, clientId))

  // Topics engine: a deleted / blocked client leaves its topics (they become
  // unresolved and are re-linked when the client comes back).
  await onEntityStatusChanged(activeOrgId, { clientIds: [clientId] }, data.status, session.user.id)
}

// ── Web lookup (grounded web search + structured extract) ────────────
//
// The lookup itself lives in the org-explicit module
// src/server/identity/client-enrichment.ts (also used by background
// enrichment on create, identity I6). This is the session-bound wrapper.

export type {
  ClientLookupCandidate,
  ClientLookupSource,
  ClientLookupResult,
  ClientLookupHints,
} from "@/server/identity/client-enrichment"

/**
 * Run a web lookup for the given client of the ACTIVE org (see
 * `lookupClientOnWebForOrg`). NO writes — the lookup dialog saves what the
 * user picks via PUT /api/clients.
 */
export async function lookupClientOnWeb(
  clientId: string,
  hints?: ClientLookupHints,
): Promise<ClientLookupResult> {
  const { session, activeOrgId } = await requireOrgContext()
  return lookupClientOnWebForOrg(activeOrgId, session.user.id, clientId, hints)
}


// ── Batch web enrichment (refs/enrich-clients.md) ────────────────────
//
// Orchestration layer over the web lookup: a browser-driven loop POSTs one
// client at a time; each client's `enrichment_status` is committed as it
// finishes, so re-running processes ONLY what's still NULL (unprocessed or
// previously failed). The per-client core (contact fields fill-blanks + the
// client profile apply rule, identity I6) is org-explicit in
// src/server/identity/client-enrichment.ts; these are the session wrappers.

export type { EnrichClientResult, EnrichFillable } from "@/server/identity/client-enrichment"

// 2.1 — the worklist + count for the button.
export async function listPendingEnrichIds(
  limit = 200,
): Promise<{ ids: string[]; total: number }> {
  const { activeOrgId } = await requireOrgContext()
  const cap = Math.min(limit, 500)

  const blankFillable = or(
    isNull(client.webUrl),
    eq(client.webUrl, ""),
    isNull(client.email),
    eq(client.email, ""),
    isNull(client.phone),
    eq(client.phone, ""),
    isNull(client.address),
    eq(client.address, ""),
  )
  // Identity I6: a client whose business profile was never web-enriched is
  // in the worklist too (the same lookup fills both).
  const profileNeverEnriched = sql`not exists (select 1 from ${clientProfile} cp where cp.client_id = ${client.id} and cp.web_enriched_at is not null)`
  const where = and(
    eq(client.organizationId, activeOrgId),
    isNull(client.enrichmentStatus),
    inArray(client.status, ["active", "initial"]),
    or(blankFillable, profileNeverEnriched),
  )

  const idRows = await db
    .select({ id: client.id })
    .from(client)
    .where(where)
    .orderBy(desc(client.updatedAt))
    .limit(cap)
  const totalRows = await db
    .select({ c: count() })
    .from(client)
    .where(where)

  return { ids: idRows.map((r) => r.id), total: totalRows[0]?.c ?? 0 }
}

// 2.2 — process ONE client. Never catches the lookup error: on a throw the
// row stays NULL so the next run retries only it (the whole resumability
// guarantee depends on this).
export async function enrichClientFromWeb(
  clientId: string,
): Promise<EnrichClientResult> {
  const { session, activeOrgId } = await requireOrgContext()
  return enrichClientForOrg(activeOrgId, session.user.id, clientId)
}

export type EnrichReviewRow = {
  id: string
  name: string
  webUrl: string | null
  email: string | null
  phone: string | null
  address: string | null
  candidates: ClientLookupCandidateJson[]
}

// 2.3 — the manual disambiguation queue (status='review') + its count.
export async function listEnrichReview(): Promise<EnrichReviewRow[]> {
  const { activeOrgId } = await requireOrgContext()
  const rows = await db
    .select({
      id: client.id,
      name: client.name,
      webUrl: client.webUrl,
      email: client.email,
      phone: client.phone,
      address: client.address,
      candidates: client.enrichmentCandidates,
    })
    .from(client)
    .where(
      and(
        eq(client.organizationId, activeOrgId),
        eq(client.enrichmentStatus, "review"),
      ),
    )
    .orderBy(desc(client.updatedAt))
  return rows.map((r) => ({ ...r, candidates: r.candidates ?? [] }))
}

export async function countEnrichReview(): Promise<number> {
  const { activeOrgId } = await requireOrgContext()
  const rows = await db
    .select({ c: count() })
    .from(client)
    .where(
      and(
        eq(client.organizationId, activeOrgId),
        eq(client.enrichmentStatus, "review"),
      ),
    )
  return rows[0]?.c ?? 0
}

export type ResolveEnrichmentChoice =
  | { candidateIndex: number }
  | { skip: true }

// 2.4 — apply a human's pick (or dismiss) for a parked client. No new web
// call — replays the candidates stored during the batch.
export async function resolveEnrichment(
  clientId: string,
  choice: ResolveEnrichmentChoice,
): Promise<{ outcome: "enriched" | "no_match"; filledFields: EnrichFillable[] }> {
  const { activeOrgId } = await requireOrgContext()
  const target = await assertClientInOrg(clientId, activeOrgId)

  if ("skip" in choice && choice.skip) {
    await db
      .update(client)
      .set({ enrichmentStatus: "no_match", enrichmentCandidates: null })
      .where(eq(client.id, clientId))
    return { outcome: "no_match", filledFields: [] }
  }

  const candidateIndex = "candidateIndex" in choice ? choice.candidateIndex : -1
  const candidates = (target.enrichmentCandidates ??
    []) as ClientLookupCandidateJson[]
  const chosen = candidates[candidateIndex]
  if (!chosen) throw new Error("Candidate not found")

  const patch = candidatePatch(target, chosen)
  await db
    .update(client)
    .set({ ...patch, enrichmentStatus: "enriched", enrichmentCandidates: null })
    .where(eq(client.id, clientId))
  // Identity I6: the picked candidate's business profile → apply rule
  // (candidates parked before I6 carry no profile → only the stamp).
  await applyCandidateProfileForOrg(activeOrgId, clientId, chosen as ClientLookupCandidate)
  return { outcome: "enriched", filledFields: Object.keys(patch) as EnrichFillable[] }
}

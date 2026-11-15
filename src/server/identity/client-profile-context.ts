import "server-only"

// Client profile READ side for prompts and the derived segment (identity spec
// I5, docs/specs/identity/01-specification.md §4.1 / §4.5). Org-explicit,
// cron-safe (no session). Writes live in src/server/identity/client-profile.ts.
//
// - `getClientSegments(orgId)`: derived A / B / C by 12-month revenue (the
//   same rule as the topics phase 8 check `meeting_overdue`), 10-min cache.
// - `loadClientProfileTexts(orgId, clientIds)`: per client the «Профиль
//   клиента» summary (card writer, deal state) and the short counterparty
//   line (signal extraction). Clients without a profile row get "" texts.

import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { client, clientProfile, industry } from "@/db/schema"
import {
  clientProfileSummary,
  counterpartyProfileLine,
  CLIENT_SIZE_BANDS,
  EMPTY_CLIENT_PROFILE,
  readFieldMeta,
  type ClientProfileValues,
  type ClientSizeBand,
} from "@/lib/identity/client-profile"
import { MARKET_ROLES, type MarketRole } from "@/lib/identity/org-profile"
import { deriveSegments, type Segment } from "@/server/topics/checks/crm-data"
import { loadOrderClients } from "@/server/topics/checks/orders-data"
import { loadChecksParams, loadOrgCalendar } from "@/server/topics/checks/run"

// ── Segments ──────────────────────────────────────────────────────────────

const SEGMENT_TTL_MS = 10 * 60 * 1000
const segmentCache = new Map<string, { at: number; value: Map<string, Segment> }>()

/** Derived segment per client id (no revenue → absent). Never throws (empty map on error). */
export async function getClientSegments(orgId: string, now = new Date()): Promise<Map<string, Segment>> {
  const hit = segmentCache.get(orgId)
  if (hit && Date.now() - hit.at < SEGMENT_TTL_MS) return hit.value
  try {
    const [clients, params, calendar] = await Promise.all([
      loadOrderClients(orgId),
      loadChecksParams(orgId),
      loadOrgCalendar(orgId),
    ])
    const segs = deriveSegments(clients, { now, params, calendar, existing: [] })
    const value = new Map<string, Segment>()
    for (const [id, s] of segs) value.set(id, s.segment)
    segmentCache.set(orgId, { at: Date.now(), value })
    return value
  } catch (e) {
    console.error("[client-profile] segments failed", orgId, e)
    return new Map()
  }
}

// ── Row → values ──────────────────────────────────────────────────────────

type ProfileRow = typeof clientProfile.$inferSelect

/** DB row → validated-shape values (bad list entries dropped, unknown codes dropped). */
export function profileRowToValues(r: ProfileRow | null | undefined): ClientProfileValues {
  if (!r) return { ...EMPTY_CLIENT_PROFILE, needs: { lines: [] } }
  const roles = (r.marketRoles ?? []).filter((x): x is MarketRole => (MARKET_ROLES as readonly string[]).includes(x))
  const products = Array.isArray(r.products)
    ? r.products.filter((p) => p && typeof p.name === "string" && p.name.trim()).map((p) => ({ name: p.name.trim() }))
    : []
  const needsRaw = (r.needs ?? { lines: [] }) as { lines?: unknown; note?: unknown }
  const needs = {
    lines: Array.isArray(needsRaw.lines) ? needsRaw.lines.filter((x): x is string => typeof x === "string" && !!x.trim()) : [],
    ...(typeof needsRaw.note === "string" && needsRaw.note.trim() ? { note: needsRaw.note } : {}),
  }
  const sizeBand = (CLIENT_SIZE_BANDS as readonly string[]).includes(r.sizeBand ?? "") ? (r.sizeBand as ClientSizeBand) : null
  return {
    description: r.description,
    industryCode: r.industryCode,
    industryNote: r.industryNote,
    marketRoles: roles,
    products,
    needs,
    sizeBand,
    pointsOfSale: r.pointsOfSale,
    geography: r.geography,
  }
}

// ── Prompt texts ──────────────────────────────────────────────────────────

export type ClientProfileTexts = {
  /** «Профиль клиента «…»: …» ≤ 400 chars, "" when the profile says nothing. */
  summary: string
  /** «Контрагент: <name> — <отрасль>, <роль>», "" when unknown. */
  counterpartyLine: string
}

/**
 * Prompt texts of the given clients of ONE org (tenant check: rows of another
 * org are ignored). Missing ids map to empty texts. `withSegment` adds the
 * derived segment to the summary (one extra order load per org, cached).
 */
export async function loadClientProfileTexts(
  orgId: string,
  clientIds: readonly string[],
  opts: { withSegment?: boolean } = {},
): Promise<Map<string, ClientProfileTexts>> {
  const ids = [...new Set(clientIds.filter(Boolean))]
  const out = new Map<string, ClientProfileTexts>()
  if (ids.length === 0) return out
  const [rows, segments] = await Promise.all([
    db
      .select({ c: { id: client.id, name: client.name }, p: clientProfile, industryLabel: industry.labelRu })
      .from(client)
      .leftJoin(clientProfile, eq(clientProfile.clientId, client.id))
      .leftJoin(industry, eq(industry.code, clientProfile.industryCode))
      .where(and(eq(client.organizationId, orgId), inArray(client.id, ids))),
    opts.withSegment ? getClientSegments(orgId) : Promise.resolve(new Map<string, Segment>()),
  ])
  for (const r of rows) {
    const values = profileRowToValues(r.p)
    const meta = readFieldMeta(r.p?.fieldMeta)
    const base = { name: r.c.name, values, meta, industryLabel: r.industryLabel ?? null }
    out.set(r.c.id, {
      summary: clientProfileSummary({ ...base, segment: segments.get(r.c.id) ?? null }),
      counterpartyLine: counterpartyProfileLine(base),
    })
  }
  for (const id of ids) if (!out.has(id)) out.set(id, { summary: "", counterpartyLine: "" })
  return out
}

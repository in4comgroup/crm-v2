import "server-only"

import { and, eq, gte, inArray, lte, sql, type AnyColumn, type SQL } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { deal, member, user } from "@/db/schema"
import {
  RECORD_COUNT_CAP,
  recordHref,
  type RecordFact,
  type RecordHit,
  type RecordType,
} from "@/lib/chat/records"
import { OPEN_DEAL_STATUSES, isOpenStageRole } from "@/lib/deal-funnel"
import { getOrgFunnel } from "@/server/deal-engine"
import { parseDayInZone } from "./format"
import type { RecordsContext, SearchOptions } from "./types"

// Shared SQL helpers of the records engine (src/server/chat/records/).

/**
 * Total number of matching rows, computed in the same query as the page
 * (`count(*) over ()` runs before LIMIT). Select it as a column.
 */
export const totalOver = sql<number>`(count(*) over ())::int`

/** Exact up to RECORD_COUNT_CAP, then capped (shown as «500+»). */
export function capTotal(total: number | null | undefined): { total: number; capped: boolean } {
  const n = total ?? 0
  return n > RECORD_COUNT_CAP ? { total: RECORD_COUNT_CAP, capped: true } : { total: n, capped: false }
}

/** Inclusive date range on one column; undefined when no bound is set. */
export function dateRange(col: AnyColumn, opts: Pick<SearchOptions, "dateFrom" | "dateTo">): SQL | undefined {
  return and(
    opts.dateFrom ? gte(col, opts.dateFrom) : undefined,
    opts.dateTo ? lte(col, opts.dateTo) : undefined,
  )
}

/**
 * «2026-11-16» / ISO → Date. A plain day is cut at the ORG's midnight
 * (`timeZone`, from RecordsContext), so «по 31.12» means the end of 31.12 in
 * Vienna, not UTC. null for empty / invalid input.
 */
export function parseDay(v: string | undefined, endOfDay = false, timeZone = "UTC"): Date | null {
  return parseDayInZone(v, timeZone, endOfDay)
}

/** A compact hit for a linked record inside a detail view. */
export function basicHit(
  type: RecordType,
  id: string,
  title: string,
  subtitle: string | null = null,
  factList: RecordFact[] = [],
  date: string | null = null,
): RecordHit {
  return { type, id, title, subtitle, facts: factList, badge: null, date, href: recordHref(type, id, title) }
}

// ── Members ───────────────────────────────────────────────────────────

export type OrgMember = { userId: string; name: string }

/** Human members of the org (never «Агент»), for names in facts and «me» / name filters. */
export async function loadOrgMembers(orgId: string): Promise<Map<string, OrgMember>> {
  const rows = await db
    .select({ userId: user.id, name: user.name, role: user.role })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, orgId))
  const out = new Map<string, OrgMember>()
  for (const r of rows) if (r.role !== "agent") out.set(r.userId, { userId: r.userId, name: r.name })
  return out
}

/**
 * A person filter value → user ids. "me" = the signed-in user; otherwise a
 * member id or a (part of a) member name, case-insensitive. [] = nobody
 * matched (the filter then matches nothing, which is the honest answer).
 */
export function resolvePersonFilter(
  ctx: RecordsContext,
  members: Map<string, OrgMember>,
  value: string,
): string[] {
  const v = value.trim()
  if (!v) return []
  if (v.toLowerCase() === "me" || v.toLowerCase() === "я") return [ctx.userId]
  if (members.has(v)) return [v]
  const needle = v.toLowerCase()
  return [...members.values()].filter((m) => m.name.toLowerCase().includes(needle)).map((m) => m.userId)
}

/** «Я» for the signed-in user, else the member's name. */
export function personLabel(ctx: RecordsContext, members: Map<string, OrgMember>, userId: string | null): string {
  if (!userId) return ""
  if (userId === ctx.userId) return `${members.get(userId)?.name ?? "Я"} (я)`
  return members.get(userId)?.name ?? ""
}

// ── Deal facts per company ────────────────────────────────────────────

/**
 * Per company of the org: has a won deal / has an open deal — the input of
 * `clientRelation` (src/lib/client-relation.ts). Stages count by role.
 */
export async function loadClientDealFlags(
  orgId: string,
  clientIds?: readonly string[],
): Promise<{ won: Set<string>; open: Set<string> }> {
  const stages = await getOrgFunnel(orgId)
  const wonStages = new Set(stages.filter((s) => s.role === "won").map((s) => s.id))
  const openStages = new Set(stages.filter((s) => isOpenStageRole(s.role)).map((s) => s.id))
  if (clientIds && clientIds.length === 0) return { won: new Set(), open: new Set() }
  const rows = await db
    .select({ clientId: deal.clientId, funnelStageId: deal.funnelStageId })
    .from(deal)
    .where(
      and(
        eq(deal.organizationId, orgId),
        inArray(deal.status, [...OPEN_DEAL_STATUSES]),
        clientIds ? inArray(deal.clientId, [...clientIds]) : undefined,
      ),
    )
  const won = new Set<string>()
  const open = new Set<string>()
  for (const r of rows) {
    if (wonStages.has(r.funnelStageId)) won.add(r.clientId)
    else if (openStages.has(r.funnelStageId)) open.add(r.clientId)
  }
  return { won, open }
}

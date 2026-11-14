import "server-only"

import { randomUUID } from "node:crypto"
import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { deal, dealRisk, signalInstance, sourceItem, topic, topicEvent, workCalendarDay } from "@/db/schema"
import type { SignalItemFacts } from "@/lib/signals/extraction-types"
import type { DisplayProfile as RegistryDisplayProfile } from "@/lib/signals/types"
import type { TopicAttention, TopicList } from "@/lib/topics/attention-types"
import { WorkCalendar, type CalendarDay } from "@/lib/topics/attention-calendar"
import { attentionParamsHash, mergeAttentionParams, type AttentionParams } from "@/lib/topics/attention-params"
import { TOPIC_LIVE_STATUSES, type TopicStatus } from "@/lib/topics/types"
import { getOrgSetting } from "@/server/org-settings"
import { getPlatformSetting } from "@/server/platform-settings"
import { getEffectiveSignals, getRegistry } from "@/server/signals/registry"
import type { CodeBook, RelationLookup, TopicSnapshot } from "../model"
import { hydrateTopics, loadCodeBook, loadRelationLookup } from "../topic-store"
import {
  compareRank,
  computeAttention,
  placeStoredAttention,
  type AttentionDealRisk,
  type AttentionEnv,
  type AttentionInstance,
  type AttentionItem,
  type AttentionRelation,
  type DeadlineOwner,
} from "./engine"

// DB side of the attention engine (06-attention-engine.md, plan phase 4):
// loads the context (code book, display profiles, relations, parameters,
// production calendar), builds the pure inputs from topic snapshots, writes
// `topic.attention` + mirrored columns and one `attention_changed` event when
// the list changes. Org-explicit, session-free; the caller checks access.

type BatchOps = Parameters<typeof db.batch>[0]
const LIVE: TopicStatus[] = [...TOPIC_LIVE_STATUSES]

// ── Context ───────────────────────────────────────────────────────────────

export type AttentionContext = {
  orgId: string
  book: CodeBook
  profiles: Map<string, RegistryDisplayProfile | null>
  relations: AttentionRelation[]
  relationOf: RelationLookup
  params: AttentionParams
  calendar: WorkCalendar
  paramsHash: string
  /** Active deal risks whose trigger instance is on the topic (phase 5a, I5). */
  dealRisks: (topicId: string) => AttentionDealRisk[]
}

const CAL_TTL_MS = 60 * 60_000
let calCache: { at: number; days: CalendarDay[] } | null = null

/** Rows of `work_calendar_day` (region RU), cached 1 h per server instance. */
export async function loadCalendarDays(): Promise<CalendarDay[]> {
  if (calCache && Date.now() - calCache.at < CAL_TTL_MS) return calCache.days
  const rows = await db
    .select({ day: workCalendarDay.day, isWorking: workCalendarDay.isWorking, isShort: workCalendarDay.isShort })
    .from(workCalendarDay)
    .where(eq(workCalendarDay.region, "RU"))
  calCache = { at: Date.now(), days: rows }
  return rows
}

/**
 * Parameters through the settings ladder: org → platform → code defaults (06
 * §13). `riskImmediateMinSeverity` (I5) comes from the deal setting
 * `deals.riskImmediateMinSeverity` (org → platform, default 7, phase 5a).
 */
export async function loadAttentionParams(orgId: string): Promise<AttentionParams> {
  const [platform, org, riskOrg, riskPlatform] = await Promise.all([
    getPlatformSetting("attention.params"),
    getOrgSetting(orgId, "attention.params"),
    getOrgSetting(orgId, "deals.riskImmediateMinSeverity"),
    getPlatformSetting("deals.riskImmediateMinSeverity"),
  ])
  return { ...mergeAttentionParams(platform, org), riskImmediateMinSeverity: riskOrg ?? riskPlatform }
}

/**
 * Active deal risks of the org by the topic of their trigger instances (I5,
 * phase 5a). The engine keeps only risks whose trigger instance is on the
 * topic; a risk on a client-scope topic escalates that topic too.
 */
async function loadActiveDealRisks(orgId: string): Promise<Map<string, AttentionDealRisk[]>> {
  const risks = await db
    .select({ severity: dealRisk.severity, triggerInstanceIds: dealRisk.triggerInstanceIds })
    .from(dealRisk)
    .where(and(eq(dealRisk.organizationId, orgId), eq(dealRisk.status, "active")))
  const out = new Map<string, AttentionDealRisk[]>()
  const instIds = [...new Set(risks.flatMap((r) => r.triggerInstanceIds))]
  if (instIds.length === 0) return out
  const insts = await db
    .select({ id: signalInstance.id, topicId: signalInstance.topicId })
    .from(signalInstance)
    .where(and(eq(signalInstance.organizationId, orgId), inArray(signalInstance.id, instIds)))
  const topicOf = new Map(insts.map((i) => [i.id, i.topicId]))
  for (const r of risks) {
    for (const id of r.triggerInstanceIds) {
      const t = topicOf.get(id)
      if (!t) continue
      const list = out.get(t) ?? []
      list.push({ triggerInstanceId: id, severity: r.severity, active: true })
      out.set(t, list)
    }
  }
  return out
}

export async function loadAttentionContext(orgId: string, now: Date = new Date()): Promise<AttentionContext> {
  const [book, effective, registry, relationOf, params, days, risksByTopic] = await Promise.all([
    loadCodeBook(orgId),
    getEffectiveSignals(orgId),
    getRegistry(),
    loadRelationLookup(orgId, now),
    loadAttentionParams(orgId),
    loadCalendarDays(),
    loadActiveDealRisks(orgId),
  ])
  const calendar = new WorkCalendar(days, { timeZone: params.timeZone, workStart: params.workStart, workEnd: params.workEnd })
  return {
    orgId,
    book,
    profiles: new Map(effective.map((e) => [e.code, e.displayProfile])),
    relations: registry.relations
      .filter((r) => r.kind === "dampens" || r.kind === "merges_into")
      .map((r) => ({ kind: r.kind, codeA: r.codeA, codeB: r.codeB })),
    relationOf,
    params,
    calendar,
    paramsHash: attentionParamsHash(params, registry.version, calendar.seededYears().join(",")),
    dealRisks: (topicId) => risksByTopic.get(topicId) ?? [],
  }
}

// ── Inputs ────────────────────────────────────────────────────────────────

type TopicRow = typeof topic.$inferSelect

function owner(v: unknown): DeadlineOwner {
  return v === "us" || v === "them" ? v : "unknown"
}

function asAttention(v: unknown): TopicAttention | null {
  return v && typeof v === "object" && (v as { v?: unknown }).v === 1 ? (v as TopicAttention) : null
}

type ItemFacts = Pick<SignalItemFacts, "facts" | "attributes" | "attrAdj" | "dominantCode">

async function loadItemFacts(itemIds: string[]): Promise<Map<string, Partial<ItemFacts>>> {
  const out = new Map<string, Partial<ItemFacts>>()
  for (let i = 0; i < itemIds.length; i += 500) {
    const chunk = itemIds.slice(i, i + 500)
    const rows = await db
      .select({ id: sourceItem.id, f: sourceItem.signalFacts })
      .from(sourceItem)
      .where(inArray(sourceItem.id, chunk))
    for (const r of rows) out.set(r.id, (r.f ?? {}) as Partial<ItemFacts>)
  }
  return out
}

function buildItems(t: TopicSnapshot, facts: Map<string, Partial<ItemFacts>>): AttentionItem[] {
  const byItem = new Map<string, AttentionItem>()
  for (const l of t.items) {
    const f = facts.get(l.itemId)?.facts
    const forSubject = (i: number) => i === l.subjectIndex || i === -1 || l.subjectIndex === -1
    const deadlines = (f?.deadlines ?? [])
      .filter((d) => forSubject(d.subjectIndex))
      .map((d) => ({ date: d.date, owner: owner(d.owner) }))
    const prevItem = byItem.get(l.itemId)
    if (prevItem) prevItem.deadlines.push(...deadlines)
    else
      byItem.set(l.itemId, {
        itemId: l.itemId,
        date: l.date,
        direction: l.direction,
        deadlines,
        meetingDate: f?.proposedMeetingDate ?? null,
      })
  }
  return [...byItem.values()]
}

function buildInstances(t: TopicSnapshot, facts: Map<string, Partial<ItemFacts>>): AttentionInstance[] {
  return t.instances.map((i) => {
    const f = i.itemId ? facts.get(i.itemId) : undefined
    return {
      ...i,
      dominant: !!f?.dominantCode && f.dominantCode === i.code,
      itemAttrs: (f?.attributes ?? []).map((a) => ({ code: a.code, weight: a.weight })),
      itemAttrAdj: f?.attrAdj ?? 0,
    }
  })
}

// ── Compute + write ───────────────────────────────────────────────────────

export type AttentionWriteResult = { topicId: string; list: TopicList; changed: boolean; listChanged: boolean }

/** JSON with sorted keys (jsonb does not keep key order). */
function stableJson(v: unknown): string {
  return JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : x,
  )
}

export type AttentionComputed = { row: TopicRow; prev: TopicAttention | null; attention: TopicAttention; ownerUserId: string | null }

/** Compute attention for topic rows at `now` WITHOUT writing (also a dry run for debugging). */
export async function computeAttentionForRows(
  ctx: AttentionContext,
  rows: TopicRow[],
  now: Date = new Date(),
): Promise<AttentionComputed[]> {
  if (rows.length === 0) return []
  const snaps = await hydrateTopics(rows)
  const itemIds = [
    ...new Set(snaps.flatMap((s) => [...s.items.map((l) => l.itemId), ...s.instances.map((i) => i.itemId)]).filter((x): x is string => !!x)),
  ]
  const facts = await loadItemFacts(itemIds)
  const dealIds = [...new Set(rows.map((r) => r.dealId).filter((x): x is string => !!x))]
  const dealOwners = new Map<string, string>()
  if (dealIds.length) {
    const ds = await db.select({ id: deal.id, userId: deal.userId }).from(deal).where(and(eq(deal.organizationId, ctx.orgId), inArray(deal.id, dealIds)))
    for (const d of ds) dealOwners.set(d.id, d.userId)
  }
  const env: AttentionEnv = {
    book: ctx.book,
    profiles: ctx.profiles,
    relations: ctx.relations,
    params: ctx.params,
    calendar: ctx.calendar,
    now,
    paramsHash: ctx.paramsHash,
  }
  const out: AttentionComputed[] = []
  for (let k = 0; k < rows.length; k++) {
    const row = rows[k]
    const snap = snaps[k]
    const prev = asAttention(row.attention)
    const a = computeAttention(
      {
        id: row.id,
        status: snap.status,
        subState: snap.subState,
        lastActivityAt: snap.lastActivityAt,
        snoozedUntil: row.snoozedUntil,
        snoozedAt: row.snoozedAt,
        relation: ctx.relationOf(snap.clientId),
        cycleStartedAt: row.cycleStartedAt,
        cycleReason: row.cycleReason,
        instances: buildInstances(snap, facts),
        items: buildItems(snap, facts),
        prev,
        dealRisks: ctx.dealRisks(row.id),
      },
      env,
    )
    const ownerUserId = row.ownerUserId ?? (row.dealId ? (dealOwners.get(row.dealId) ?? null) : null)
    out.push({ row, prev, attention: a, ownerUserId })
  }
  return out
}

/**
 * Recompute and store attention for the given topic rows (one batch per
 * call). Writes only when the result differs from the stored one.
 */
export async function recomputeAttentionForRows(
  ctx: AttentionContext,
  rows: TopicRow[],
  now: Date = new Date(),
  opts: { actorUserId?: string | null } = {},
): Promise<AttentionWriteResult[]> {
  const computed = await computeAttentionForRows(ctx, rows, now)
  const ops: unknown[] = []
  const events: (typeof topicEvent.$inferInsert)[] = []
  const out: AttentionWriteResult[] = []
  for (const { row, prev, attention: a, ownerUserId } of computed) {
    const snoozeEnded = !!row.snoozedUntil && row.snoozedUntil.getTime() > now.getTime() && a.hiddenReason !== "snoozed" && a.cycleReason === "snooze_end" && a.cycleStarted
    const same =
      !!prev &&
      stableJson({ ...prev, computedAt: "" }) === stableJson({ ...a, computedAt: "" }) &&
      row.list === a.list &&
      ownerUserId === row.ownerUserId &&
      !snoozeEnded
    const listChanged = row.list !== a.list
    out.push({ topicId: row.id, list: a.list, changed: !same, listChanged })
    if (same) {
      // Nothing changed: only move the next check (keeps the hourly pick small).
      const next = a.nextCheckAt ? new Date(a.nextCheckAt) : null
      if ((next?.getTime() ?? null) !== (row.nextAttentionCheckAt?.getTime() ?? null)) {
        ops.push(
          db
            .update(topic)
            .set({ nextAttentionCheckAt: next, updatedAt: row.updatedAt })
            .where(and(eq(topic.organizationId, ctx.orgId), eq(topic.id, row.id))),
        )
      }
      continue
    }
    ops.push(
      db
        .update(topic)
        .set({
          displayProfile: a.profile,
          list: a.list,
          attention: a,
          nextAttentionCheckAt: a.nextCheckAt ? new Date(a.nextCheckAt) : null,
          cycleStartedAt: a.cycleStartedAt ? new Date(a.cycleStartedAt) : null,
          cycleReason: a.cycleReason,
          ...(a.cycleStarted ? { cycleReminders: 0 } : {}),
          waitingSince: a.waitingSince ? new Date(a.waitingSince) : null,
          ownerUserId,
          ...(snoozeEnded ? { snoozedUntil: null } : {}),
          // Attention is derived data: keep the topic's own updated_at.
          updatedAt: row.updatedAt,
        })
        .where(and(eq(topic.organizationId, ctx.orgId), eq(topic.id, row.id))),
    )
    if (listChanged) {
      events.push({
        id: randomUUID(),
        organizationId: ctx.orgId,
        topicId: row.id,
        type: "attention_changed",
        actor: "agent",
        userId: opts.actorUserId ?? null,
        sourceItemId: null,
        payload: {
          from: row.list,
          to: a.list,
          reason: a.hiddenReason ?? a.cycleReason ?? null,
          escalations: a.escalations,
          score: a.score,
          profile: a.profile,
        },
      })
    }
  }
  if (events.length) ops.push(db.insert(topicEvent).values(events))
  for (let i = 0; i < ops.length; i += 100) {
    const chunk = ops.slice(i, i + 100)
    if (chunk.length) await db.batch(chunk as unknown as BatchOps)
  }
  return out
}

/**
 * Recompute attention of some topics of one org now (06 §10 triggers: item
 * attached / detached, closing, user action). Safe for any status.
 */
export async function recomputeTopicsAttention(
  orgId: string,
  topicIds: readonly string[],
  now: Date = new Date(),
  opts: { ctx?: AttentionContext; actorUserId?: string | null } = {},
): Promise<AttentionWriteResult[]> {
  const ids = [...new Set(topicIds)]
  if (ids.length === 0) return []
  const rows = await db.select().from(topic).where(and(eq(topic.organizationId, orgId), inArray(topic.id, ids)))
  if (rows.length === 0) return []
  const ctx = opts.ctx ?? (await loadAttentionContext(orgId, now))
  return recomputeAttentionForRows(ctx, rows, now, opts)
}

/** Recompute attention of ONE topic (06 §10). Returns null when the topic does not exist. */
export async function recomputeTopicAttention(
  orgId: string,
  topicId: string,
  now: Date = new Date(),
): Promise<AttentionWriteResult | null> {
  const [r] = await recomputeTopicsAttention(orgId, [topicId], now)
  return r ?? null
}

/**
 * Topics the hourly run must recompute: live topics with no attention yet or
 * computed with other parameters / taxonomy, plus every topic whose
 * `next_attention_check_at` has come (phase 3 writes set it to "now").
 */
export async function selectDueTopics(orgId: string, now: Date, paramsHash: string, limit: number): Promise<TopicRow[]> {
  return db
    .select()
    .from(topic)
    .where(
      and(
        eq(topic.organizationId, orgId),
        or(
          lte(topic.nextAttentionCheckAt, now),
          and(
            inArray(topic.status, LIVE),
            or(isNull(topic.attention), sql`${topic.attention} ->> 'paramsHash' is distinct from ${paramsHash}`),
          ),
        ),
      ),
    )
    .orderBy(sql`${topic.nextAttentionCheckAt} asc nulls first`, asc(topic.id))
    .limit(limit)
}

// ── Read-time (06 §6, §10) ────────────────────────────────────────────────

export type TopicListEntry = {
  topicId: string
  title: string
  status: string
  clientId: string | null
  contactId: string | null
  dealId: string | null
  ownerUserId: string | null
  lastActivityAt: Date
  attention: TopicAttention
}

/**
 * One list as a person sees it NOW: the stored attention of the org's topics
 * with the read-time check (I1–I5, snooze end, card expiry) applied from the
 * stored fields — no write. Sorted by rank (06 §7.4).
 */
export async function readTopicList(orgId: string, list: TopicList, now: Date = new Date()): Promise<TopicListEntry[]> {
  const [params, days] = await Promise.all([loadAttentionParams(orgId), loadCalendarDays()])
  const cal = new WorkCalendar(days, { timeZone: params.timeZone, workStart: params.workStart, workEnd: params.workEnd })
  const rows = await db
    .select({
      id: topic.id,
      title: topic.title,
      status: topic.status,
      clientId: topic.clientId,
      contactId: topic.contactId,
      dealId: topic.dealId,
      ownerUserId: topic.ownerUserId,
      lastActivityAt: topic.lastActivityAt,
      attention: topic.attention,
    })
    .from(topic)
    .where(and(eq(topic.organizationId, orgId), inArray(topic.status, LIVE), sql`${topic.attention} is not null`))
    .limit(5000)
  const out: TopicListEntry[] = []
  for (const r of rows) {
    const stored = asAttention(r.attention)
    if (!stored) continue
    const a = placeStoredAttention(stored, now, cal, params)
    if (a.list !== list) continue
    out.push({
      topicId: r.id,
      title: r.title,
      status: r.status,
      clientId: r.clientId,
      contactId: r.contactId,
      dealId: r.dealId,
      ownerUserId: r.ownerUserId,
      lastActivityAt: r.lastActivityAt,
      attention: a,
    })
  }
  return out.sort((a, b) => compareRank(a.attention, b.attention))
}

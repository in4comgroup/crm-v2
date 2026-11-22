import "server-only"

import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { client, contact, signalInstance, source, sourceItem, sourceItemSubject, topic, topicItem } from "@/db/schema"
import { automatedPipelineProviders, syncableProviders } from "@/lib/sources/providers"
import type { CheckEvaluators, CheckContext } from "./types"
import {
  checkContractNotRenewed,
  checkMaterialNoResponse,
  checkOfferNoResponse,
  checkOrderConfirmationOpen,
  checkPriceNoResponse,
  checkReportOpen,
  WD_CODES,
  WD_INPUT_CODES,
  WD_TOPIC_PROCESS_CODES,
  type ContractData,
  type WatchdogData,
  type WdActivityItem,
  type WdDeadline,
  type WdDirection,
  type WdTopic,
  type WdTopicItem,
} from "./watchdogs"
import { contactDisplaySql } from "@/server/contact-display"

// Loaders of the phase 8 watchdogs (org-explicit, READ ONLY) + the
// evaluators. The pure logic is `watchdogs.ts`.
//
// The five topic watchdogs share ONE load per org and run moment (memo by
// org + `now` + lookback, short TTL), so an hourly run costs ~8 queries per
// org, not 5 × 8. The contract check has its own load (2 queries).
// The memo is safe across the store writes between checks: the store only
// adds process instances (not inputs) and reopens topics (only user-closed
// statuses matter here).

const DAY_MS = 86_400_000
const MEMO_TTL_MS = 120_000

const itemDate = sql<Date>`coalesce(${sourceItem.sourceCreatedAt}, ${sourceItem.createdAt})`.mapWith(sourceItem.createdAt)

/** Signal skip reasons / gates whose items are never a response (spec 01 §5.2 gates). */
const NON_RESPONSE_REASONS = ["bounce", "out_of_office", "automated", "excluded", "blocklist"]
const NON_RESPONSE_GATES = new Set(["bounce", "out_of_office"])

type RawFacts = {
  direction?: string
  facts?: { deadlines?: unknown; contractEndDate?: unknown } | null
  producer?: { gate?: string | null } | null
} | null

function directionOf(signalFacts: unknown, orgAttribution: string | null): WdDirection {
  const d = (signalFacts as RawFacts)?.direction
  if (d === "inbound" || d === "outbound" || d === "internal") return d
  if (orgAttribution === "own_org") return "outbound"
  if (orgAttribution === "external") return "inbound"
  return "unknown"
}

function isAutomated(signalFacts: unknown, signalReason: string | null): boolean {
  const gate = (signalFacts as RawFacts)?.producer?.gate
  if (gate && NON_RESPONSE_GATES.has(gate)) return true
  if (!signalReason) return false
  return NON_RESPONSE_REASONS.some((r) => signalReason === r || signalReason.startsWith(`${r}:`))
}

function deadlinesOf(signalFacts: unknown): WdDeadline[] {
  const raw = (signalFacts as RawFacts)?.facts?.deadlines
  if (!Array.isArray(raw)) return []
  const out: WdDeadline[] = []
  for (const d of raw as Record<string, unknown>[]) {
    if (typeof d?.date !== "string") continue
    const owner = d.owner === "us" || d.owner === "them" ? d.owner : "unknown"
    out.push({ date: d.date, owner, subjectIndex: typeof d.subjectIndex === "number" ? d.subjectIndex : -1 })
  }
  return out
}

function companyNameOf(clientName: string | null, contactName: string | null, raw: string | null): string | null {
  return clientName || contactName || (raw && raw.trim()) || null
}

// ── Topic watchdogs ──────────────────────────────────────────────────────

const memo = new Map<string, { at: number; data: Promise<WatchdogData> }>()

/** Shared input of the five topic watchdogs (memoised per org + run moment). */
export function loadWatchdogData(orgId: string, now: Date, lookbackDays: number): Promise<WatchdogData> {
  const key = `${orgId}|${now.getTime()}|${lookbackDays}`
  const t = Date.now()
  for (const [k, v] of memo) if (t - v.at > MEMO_TTL_MS) memo.delete(k)
  const hit = memo.get(key)
  if (hit) return hit.data
  const data = loadWatchdogDataUncached(orgId, now, lookbackDays)
  memo.set(key, { at: t, data })
  data.catch(() => memo.delete(key))
  return data
}

export async function loadWatchdogDataUncached(orgId: string, now: Date, lookbackDays: number): Promise<WatchdogData> {
  // Requests can precede the sending they trigger: look twice as far back
  // for base instances; the pure check gates the SENDING date.
  const since = new Date(now.getTime() - 2 * lookbackDays * DAY_MS)

  const [baseTopicRows, openProcessRows, sources] = await Promise.all([
    db
      .selectDistinct({ topicId: signalInstance.topicId })
      .from(signalInstance)
      .innerJoin(sourceItem, eq(sourceItem.id, signalInstance.sourceItemId))
      .where(
        and(
          eq(signalInstance.organizationId, orgId),
          inArray(signalInstance.code, [...WD_INPUT_CODES]),
          isNotNull(signalInstance.topicId),
          ne(signalInstance.confidence, "low"),
          sql`${itemDate} >= ${since}`,
        ),
      ),
    // Topics of open watchdog instances (refresh / clear even when the base is older).
    db
      .selectDistinct({ topicId: signalInstance.topicId })
      .from(signalInstance)
      .where(
        and(
          eq(signalInstance.organizationId, orgId),
          inArray(signalInstance.code, [...WD_TOPIC_PROCESS_CODES]),
          isNotNull(signalInstance.topicId),
          isNull(signalInstance.clearedAt),
        ),
      ),
    loadChannels(orgId),
  ])
  const topicIds = [
    ...new Set([...baseTopicRows, ...openProcessRows].map((r) => r.topicId).filter((x): x is string => !!x)),
  ]
  if (topicIds.length === 0) return { topics: [], activity: [], sources }

  const [topicRows, linkRows, instRows] = await Promise.all([
    db
      .select({
        id: topic.id,
        status: topic.status,
        clientId: topic.clientId,
        contactId: topic.contactId,
        matter: topic.matter,
        counterpartyRaw: topic.counterpartyRaw,
        clientName: client.name,
        contactName: contactDisplaySql(),
      })
      .from(topic)
      .leftJoin(client, eq(client.id, topic.clientId))
      .leftJoin(contact, eq(contact.id, topic.contactId))
      .where(and(eq(topic.organizationId, orgId), inArray(topic.id, topicIds))),
    db
      .select({
        topicId: topicItem.topicId,
        itemId: topicItem.sourceItemId,
        subjectIndex: topicItem.subjectIndex,
        date: itemDate,
        threadKey: sourceItem.threadKey,
        signalFacts: sourceItem.signalFacts,
        signalReason: sourceItem.signalReason,
        orgAttribution: sourceItem.orgAttribution,
      })
      .from(topicItem)
      .innerJoin(sourceItem, eq(sourceItem.id, topicItem.sourceItemId))
      .where(and(eq(topicItem.organizationId, orgId), inArray(topicItem.topicId, topicIds))),
    db
      .select({
        id: signalInstance.id,
        topicId: signalInstance.topicId,
        code: signalInstance.code,
        itemId: signalInstance.sourceItemId,
        subjectIndex: signalInstance.subjectIndex,
        confidence: signalInstance.confidence,
        date: itemDate,
      })
      .from(signalInstance)
      .innerJoin(sourceItem, eq(sourceItem.id, signalInstance.sourceItemId))
      .where(
        and(
          eq(signalInstance.organizationId, orgId),
          inArray(signalInstance.topicId, topicIds),
          inArray(signalInstance.code, [...WD_INPUT_CODES]),
        ),
      ),
  ])

  const topics = new Map<string, WdTopic>()
  for (const r of topicRows) {
    topics.set(r.id, {
      id: r.id,
      status: r.status,
      clientId: r.clientId,
      contactId: r.contactId,
      companyName: companyNameOf(r.clientName, r.contactName, r.counterpartyRaw),
      matter: r.matter,
      items: [],
      instances: [],
    })
  }
  for (const l of linkRows) {
    const t = topics.get(l.topicId)
    if (!t) continue
    const item: WdTopicItem = {
      itemId: l.itemId,
      date: l.date,
      direction: directionOf(l.signalFacts, l.orgAttribution),
      threadKey: l.threadKey,
      automated: isAutomated(l.signalFacts, l.signalReason),
      subjectIndex: l.subjectIndex,
      deadlines: deadlinesOf(l.signalFacts),
    }
    t.items.push(item)
  }
  for (const i of instRows) {
    const t = i.topicId ? topics.get(i.topicId) : undefined
    if (!t || !i.itemId) continue
    t.instances.push({
      id: i.id,
      code: i.code,
      itemId: i.itemId,
      itemDate: i.date,
      subjectIndex: i.subjectIndex,
      confidence: i.confidence,
    })
  }

  // Activity outside the topics: items after the earliest base event, on the
  // same threads or of the same clients / contacts (any topic or none).
  const baseDates = instRows.map((i) => i.date.getTime())
  const activitySince = new Date(baseDates.length ? Math.min(...baseDates) : since.getTime())
  const all = [...topics.values()]
  const threadKeys = [...new Set(all.flatMap((t) => t.items.map((l) => l.threadKey)).filter((x): x is string => !!x))]
  const clientIds = [...new Set(all.map((t) => t.clientId).filter((x): x is string => !!x))]
  const contactIds = [...new Set(all.map((t) => t.contactId).filter((x): x is string => !!x))]
  const activity = await loadActivity(orgId, activitySince, threadKeys, clientIds, contactIds)
  return { topics: all, activity, sources }
}

/** Connected channels: active sources of the org in the automated pipeline (pull = synced by cron). */
async function loadChannels(orgId: string): Promise<WatchdogData["sources"]> {
  const pull = new Set<string>(syncableProviders())
  const rows = await db
    .select({ id: source.id, name: source.name, provider: source.provider, lastSyncedAt: source.lastSyncedAt })
    .from(source)
    .where(
      and(
        eq(source.ownerOrganizationId, orgId),
        eq(source.status, "active"),
        eq(source.automatedParsingIsAllowed, true),
        inArray(source.provider, automatedPipelineProviders()),
      ),
    )
  // Upload-only providers (file drop-off) are not channels the client answers on.
  return rows
    .filter((r) => r.provider !== "dropoff")
    .map((r) => ({ id: r.id, name: r.name, pull: pull.has(r.provider), lastSyncedAt: r.lastSyncedAt }))
}

async function loadActivity(
  orgId: string,
  since: Date,
  threadKeys: string[],
  clientIds: string[],
  contactIds: string[],
): Promise<WdActivityItem[]> {
  const cols = {
    itemId: sourceItem.id,
    date: itemDate,
    threadKey: sourceItem.threadKey,
    signalFacts: sourceItem.signalFacts,
    signalReason: sourceItem.signalReason,
    orgAttribution: sourceItem.orgAttribution,
  }
  const after = sql`${itemDate} > ${since}`
  const [byThread, bySubject, byTopic] = await Promise.all([
    threadKeys.length
      ? db
          .select(cols)
          .from(sourceItem)
          .where(
            and(
              eq(sourceItem.organizationId, orgId),
              isNull(sourceItem.parentSourceItemId),
              inArray(sourceItem.threadKey, threadKeys),
              after,
            ),
          )
      : Promise.resolve([]),
    clientIds.length || contactIds.length
      ? db
          .select({ ...cols, clientId: sourceItemSubject.clientId, contactId: sourceItemSubject.contactId })
          .from(sourceItemSubject)
          .innerJoin(sourceItem, eq(sourceItem.id, sourceItemSubject.sourceItemId))
          .where(
            and(
              eq(sourceItemSubject.organizationId, orgId),
              or(
                clientIds.length ? inArray(sourceItemSubject.clientId, clientIds) : undefined,
                contactIds.length ? inArray(sourceItemSubject.contactId, contactIds) : undefined,
              ),
              after,
            ),
          )
      : Promise.resolve([]),
    clientIds.length || contactIds.length
      ? db
          .select({ ...cols, clientId: topic.clientId, contactId: topic.contactId })
          .from(topicItem)
          .innerJoin(topic, eq(topic.id, topicItem.topicId))
          .innerJoin(sourceItem, eq(sourceItem.id, topicItem.sourceItemId))
          .where(
            and(
              eq(topicItem.organizationId, orgId),
              or(
                clientIds.length ? inArray(topic.clientId, clientIds) : undefined,
                contactIds.length ? inArray(topic.contactId, contactIds) : undefined,
              ),
              after,
            ),
          )
      : Promise.resolve([]),
  ])
  const byId = new Map<string, WdActivityItem>()
  const add = (r: (typeof byThread)[number], clientId: string | null, contactId: string | null) => {
    let a = byId.get(r.itemId)
    if (!a) {
      a = {
        itemId: r.itemId,
        date: r.date,
        direction: directionOf(r.signalFacts, r.orgAttribution),
        automated: isAutomated(r.signalFacts, r.signalReason),
        threadKey: r.threadKey,
        clientIds: [],
        contactIds: [],
      }
      byId.set(r.itemId, a)
    }
    if (clientId && !a.clientIds.includes(clientId)) a.clientIds.push(clientId)
    if (contactId && !a.contactIds.includes(contactId)) a.contactIds.push(contactId)
  }
  for (const r of byThread) add(r, null, null)
  for (const r of bySubject) add(r, r.clientId, r.contactId)
  for (const r of byTopic) add(r, r.clientId, r.contactId)
  return [...byId.values()]
}

// ── Contract not renewed ─────────────────────────────────────────────────

/** Items with `facts.contractEndDate` on topics with a client + the clients' renewal intents. */
export async function loadContractData(orgId: string): Promise<ContractData> {
  const endDate = sql<string>`${sourceItem.signalFacts} -> 'facts' ->> 'contractEndDate'`
  const [links, intents] = await Promise.all([
    db
      .select({
        itemId: sourceItem.id,
        itemDate,
        endDate,
        topicId: topic.id,
        topicStatus: topic.status,
        clientId: topic.clientId,
        contactId: topic.contactId,
        matter: topic.matter,
        counterpartyRaw: topic.counterpartyRaw,
        clientName: client.name,
      })
      .from(topicItem)
      .innerJoin(topic, eq(topic.id, topicItem.topicId))
      .innerJoin(sourceItem, eq(sourceItem.id, topicItem.sourceItemId))
      .leftJoin(client, eq(client.id, topic.clientId))
      .where(and(eq(topicItem.organizationId, orgId), isNotNull(topic.clientId), sql`${endDate} is not null`)),
    db
      .select({
        instanceId: signalInstance.id,
        topicClientId: topic.clientId,
        subjectClientId: sourceItemSubject.clientId,
        itemDate,
      })
      .from(signalInstance)
      .innerJoin(sourceItem, eq(sourceItem.id, signalInstance.sourceItemId))
      .leftJoin(topic, eq(topic.id, signalInstance.topicId))
      .leftJoin(
        sourceItemSubject,
        and(
          eq(sourceItemSubject.sourceItemId, signalInstance.sourceItemId),
          or(eq(signalInstance.subjectIndex, -1), eq(sourceItemSubject.subjectIndex, signalInstance.subjectIndex)),
        ),
      )
      .where(
        and(
          eq(signalInstance.organizationId, orgId),
          eq(signalInstance.code, WD_CODES.renewalIntent),
          ne(signalInstance.confidence, "low"),
        ),
      ),
  ])
  const seen = new Set<string>()
  const renewals: ContractData["renewals"] = []
  for (const r of intents) {
    for (const clientId of [r.topicClientId, r.subjectClientId]) {
      if (!clientId || seen.has(`${r.instanceId}|${clientId}`)) continue
      seen.add(`${r.instanceId}|${clientId}`)
      renewals.push({ instanceId: r.instanceId, clientId, itemDate: r.itemDate })
    }
  }
  return {
    links: links
      .filter((l): l is typeof l & { clientId: string } => !!l.clientId)
      .map((l) => ({
        itemId: l.itemId,
        itemDate: l.itemDate,
        endDate: l.endDate,
        topicId: l.topicId,
        topicStatus: l.topicStatus,
        clientId: l.clientId,
        contactId: l.contactId,
        companyName: companyNameOf(l.clientName, null, l.counterpartyRaw),
        matter: l.matter,
      })),
    renewals,
  }
}

// ── Evaluators ───────────────────────────────────────────────────────────

const topicData = (ctx: CheckContext) => loadWatchdogData(ctx.orgId, ctx.now, ctx.params.watchdogLookbackDays)

export const WATCHDOG_CHECKS: CheckEvaluators = {
  offer_no_response: async (ctx) => checkOfferNoResponse(await topicData(ctx), ctx),
  price_no_response: async (ctx) => checkPriceNoResponse(await topicData(ctx), ctx),
  material_no_response: async (ctx) => checkMaterialNoResponse(await topicData(ctx), ctx),
  order_confirmation_open: async (ctx) => checkOrderConfirmationOpen(await topicData(ctx), ctx),
  report_open: async (ctx) => checkReportOpen(await topicData(ctx), ctx),
  contract_not_renewed: async (ctx) => checkContractNotRenewed(await loadContractData(ctx.orgId), ctx),
}

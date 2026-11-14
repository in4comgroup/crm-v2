import "server-only"

import { randomUUID } from "node:crypto"
import { and, desc, eq, gte, inArray, isNotNull, isNull, or, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { deal, signalInstance, topic, topicEvent } from "@/db/schema"
import type { CheckDef, CheckFinding, CheckResult, OpenProcessInstance } from "@/lib/topics/checks"
import { buildTopicTitle } from "@/lib/topics/references"
import type { TopicStatus } from "@/lib/topics/types"
import { getRegistry, getEffectiveSignals } from "@/server/signals/registry"
import { recomputeTopic } from "../lifecycle"
import type { CodeBook, RelationLookup, TopicEventDraft, TopicInstance, TopicSnapshot } from "../model"
import { eventRows, loadCodeBook, loadRelationLookup, loadTopicSnapshot, topicUpsertOp } from "../topic-store"

// Store of topics plan phase 8 (CRM checks + watchdogs): turns a pure
// `CheckResult` into DB writes. Per finding ONE `db.batch` (topic insert /
// update + process `signal_instance` + journal + deal dirty), so a failure
// of one finding never leaves half a topic. Rules:
//  - dedupe by (org, code, condition_key) (unique index): an existing NOT
//    cleared instance → `checked_at` refresh; an existing cleared one → the
//    condition already had its topic, nothing new (one topic per condition);
//  - `topicId` set (watchdogs) → the instance is attached to that topic; a
//    resolved / archived / expired / dormant topic is reopened; a topic the
//    user closed (done / dismissed) or a merged one is skipped;
//  - `topicId` null → a NEW topic with no source item («<Компания> — <matter>»);
//  - the code must be ACTIVE for the org (`getEffectiveSignals`), else skipped;
//  - clears (B5) set `cleared_at` / `cleared_reason`; the topic is
//    recomputed (it resolves when nothing else is active: `condition_cleared:<CODE>`).
// Every touched topic is due for the attention phase (`topicUpsertOp`).

type BatchOps = Parameters<typeof db.batch>[0]
const asBatch = (ops: unknown[]) => ops as unknown as BatchOps

const EXISTING_LOOKBACK_DAYS = 400
const USER_CLOSED: TopicStatus[] = ["done", "dismissed", "merged"]
const REOPEN: TopicStatus[] = ["resolved", "archived", "expired", "dormant"]

/** Origin of the instances of a check group (spec 01 §5.6). */
export function originOf(def: CheckDef): "system_of_record" | "communication" {
  return def.group === "orders" ? "system_of_record" : "communication"
}

export function processKeyOf(def: CheckDef): string {
  return `check.${def.key}`
}

/** Process instances of the codes: all not cleared + the rest of the last 400 days (newest first). */
export async function loadExistingInstances(orgId: string, codes: readonly string[], now: Date): Promise<OpenProcessInstance[]> {
  if (codes.length === 0) return []
  const since = new Date(now.getTime() - EXISTING_LOOKBACK_DAYS * 86_400_000)
  const rows = await db
    .select({
      id: signalInstance.id,
      code: signalInstance.code,
      conditionKey: signalInstance.conditionKey,
      topicId: signalInstance.topicId,
      clientId: topic.clientId,
      facts: signalInstance.facts,
      createdAt: signalInstance.createdAt,
      clearedAt: signalInstance.clearedAt,
    })
    .from(signalInstance)
    .leftJoin(topic, eq(topic.id, signalInstance.topicId))
    .where(
      and(
        eq(signalInstance.organizationId, orgId),
        inArray(signalInstance.code, [...codes]),
        isNotNull(signalInstance.conditionKey),
        or(isNull(signalInstance.clearedAt), gte(signalInstance.createdAt, since)),
      ),
    )
    .orderBy(desc(signalInstance.createdAt))
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    conditionKey: r.conditionKey as string,
    topicId: r.topicId,
    clientId: r.clientId,
    facts: (r.facts as Record<string, unknown> | null) ?? {},
    createdAt: r.createdAt,
    clearedAt: r.clearedAt,
  }))
}

export type StoreContext = {
  orgId: string
  now: Date
  actorUserId: string | null
  book: CodeBook
  relationOf: RelationLookup
  /** Codes ACTIVE for the org → effective weight. */
  activeWeights: Map<string, number>
  taxonomyVersion: number
}

export async function loadStoreContext(orgId: string, now: Date, actorUserId: string | null): Promise<StoreContext> {
  const [book, relationOf, effective, registry] = await Promise.all([
    loadCodeBook(orgId),
    loadRelationLookup(orgId, now),
    getEffectiveSignals(orgId),
    getRegistry(),
  ])
  return {
    orgId,
    now,
    actorUserId,
    book,
    relationOf,
    activeWeights: new Map(effective.filter((e) => e.active).map((e) => [e.code, e.weight])),
    taxonomyVersion: registry.version,
  }
}

export type ApplyCounts = {
  found: number
  created: number
  attached: number
  reopened: number
  refreshed: number
  cleared: number
  skipped: number
  deferred: number
  failed: number
}

/** Short reason keys for the skipped findings (counted in `skipped_<reason>`). */
type SkipReason = "code_inactive" | "seen_before" | "topic_closed_by_user" | "topic_missing"

export type ApplyOutcome = { counts: ApplyCounts; skipped: Partial<Record<SkipReason, number>>; topicIds: string[]; errors: string[] }

function emptyCounts(found: number): ApplyCounts {
  return { found, created: 0, attached: 0, reopened: 0, refreshed: 0, cleared: 0, skipped: 0, deferred: 0, failed: 0 }
}

function dealDirtyOp(orgId: string, dealId: string | null, now: Date) {
  if (!dealId) return []
  return [
    db
      .update(deal)
      .set({ stateDirtyAt: now, updatedAt: sql`${deal.updatedAt}` })
      .where(and(eq(deal.organizationId, orgId), eq(deal.id, dealId))),
  ]
}

/**
 * Write one check result. `maxNew` caps NEW instances per run (flood guard;
 * the rest is `deferred` and found again by the next run). Never throws for
 * one finding / clear (errors are collected).
 */
export async function applyCheckResult(
  sc: StoreContext,
  def: CheckDef,
  result: CheckResult,
  existing: readonly OpenProcessInstance[],
  maxNew: number,
): Promise<ApplyOutcome> {
  const { orgId, now } = sc
  const counts = emptyCounts(result.findings.length)
  const skipped: Partial<Record<SkipReason, number>> = {}
  const skip = (r: SkipReason) => {
    counts.skipped++
    skipped[r] = (skipped[r] ?? 0) + 1
  }
  const errors: string[] = []
  const touched = new Set<string>()
  const byKey = new Map(existing.map((e) => [`${e.code}\u0000${e.conditionKey}`, e]))

  // 1. Refresh conditions that are still true.
  const refreshIds: string[] = []
  const fresh: CheckFinding[] = []
  for (const f of result.findings) {
    const e = byKey.get(`${f.code}\u0000${f.conditionKey}`)
    if (!e) fresh.push(f)
    else if (e.clearedAt) skip("seen_before")
    else refreshIds.push(e.id)
  }
  if (refreshIds.length) {
    await db
      .update(signalInstance)
      .set({ checkedAt: now })
      .where(and(eq(signalInstance.organizationId, orgId), inArray(signalInstance.id, refreshIds)))
    counts.refreshed = refreshIds.length
  }

  // 2. New conditions → new instance on a new / existing topic.
  for (const f of fresh) {
    const weight = sc.activeWeights.get(f.code)
    if (weight === undefined) {
      skip("code_inactive")
      continue
    }
    if (counts.created + counts.attached >= maxNew) {
      counts.deferred++
      continue
    }
    try {
      const r = await writeFinding(sc, def, f, weight)
      if (r.kind === "skipped") skip(r.reason)
      else {
        touched.add(r.topicId)
        if (r.kind === "created") counts.created++
        else {
          counts.attached++
          if (r.reopened) counts.reopened++
        }
      }
    } catch (e) {
      counts.failed++
      errors.push(`${f.code} ${f.conditionKey}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // 3. Clears (B5).
  for (const c of result.clears) {
    try {
      const topicId = await clearInstance(sc, c.instanceId, c.reasonRu)
      if (topicId !== false) {
        counts.cleared++
        if (topicId) touched.add(topicId)
      }
    } catch (e) {
      counts.failed++
      errors.push(`clear ${c.instanceId}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return { counts, skipped, topicIds: [...touched], errors }
}

type WriteResult =
  | { kind: "created"; topicId: string }
  | { kind: "attached"; topicId: string; reopened: boolean }
  | { kind: "skipped"; reason: SkipReason }

async function writeFinding(sc: StoreContext, def: CheckDef, f: CheckFinding, weight: number): Promise<WriteResult> {
  const { orgId, now } = sc
  const instanceId = randomUUID()
  const score = Math.max(0, f.score ?? weight)
  const inst: TopicInstance = {
    id: instanceId,
    code: f.code,
    itemId: null,
    itemDate: now,
    confidence: "high",
    counted: score > 0,
    scoreContrib: score,
    deadlines: [],
    evidence: f.evidenceRu,
    clearedAt: null,
    conditionKey: f.conditionKey,
  }
  let t: TopicSnapshot
  let reopened = false
  const events: TopicEventDraft[] = []
  if (f.topicId) {
    const loaded = await loadTopicSnapshot(orgId, f.topicId)
    if (!loaded) return { kind: "skipped", reason: "topic_missing" }
    if (USER_CLOSED.includes(loaded.status)) return { kind: "skipped", reason: "topic_closed_by_user" }
    t = loaded
    if (REOPEN.includes(t.status)) {
      events.push({ topicId: t.id, type: "reopened", sourceItemId: null, payload: { from: t.status, code: f.code, process: true } })
      t.status = "open"
      t.closedAt = null
      t.closedReason = null
      reopened = true
    }
  } else {
    const matter = f.matterRu.trim() || (sc.book.get(f.code)?.labelRu ?? f.code)
    t = {
      id: randomUUID(),
      status: "open",
      subState: "none",
      clientId: f.clientId,
      contactId: f.contactId,
      counterpartyRaw: f.companyName ?? "",
      counterpartyKey: "",
      dealId: null,
      title: buildTopicTitle({ companyName: f.companyName, counterpartyRaw: f.companyName, matter }),
      matter,
      family: sc.book.get(f.code)?.family ?? null,
      leadCode: null,
      class: null,
      score: 0,
      band: "none",
      references: [],
      products: [],
      firstSeenAt: now,
      lastActivityAt: now,
      closedAt: null,
      closedReason: null,
      relatedTopicId: null,
      mergedIntoTopicId: null,
      taxonomyVersion: sc.taxonomyVersion,
      instances: [],
      items: [],
      isNew: true,
    }
    events.push({
      topicId: t.id,
      type: "created",
      sourceItemId: null,
      payload: { code: f.code, process: true, origin: originOf(def), conditionKey: f.conditionKey },
    })
  }
  t.instances.push(inst)
  events.push(...recomputeTopic(t, sc.book, now, sc.relationOf))
  events.push({
    topicId: t.id,
    type: "process_signal",
    sourceItemId: null,
    payload: { code: f.code, action: "added", instanceId, evidence: f.evidenceRu, check: def.key },
  })
  const row = {
    id: instanceId,
    organizationId: orgId,
    code: f.code,
    origin: originOf(def),
    sourceItemId: null,
    processKey: processKeyOf(def),
    evidence: f.evidenceRu,
    evidenceFound: true,
    confidence: "high",
    subjectIndex: -1,
    counted: inst.counted,
    notCountedReason: inst.counted ? null : "process_score_zero",
    scoreContrib: score,
    topicId: t.id,
    taxonomyVersion: sc.taxonomyVersion,
    conditionKey: f.conditionKey,
    facts: f.facts,
    checkedAt: now,
    createdAt: now,
  }
  await db.batch(
    asBatch([
      topicUpsertOp(orgId, t),
      db.insert(signalInstance).values(row),
      db.insert(topicEvent).values(eventRows(orgId, events, { actor: "agent", userId: sc.actorUserId })),
      ...dealDirtyOp(orgId, t.dealId, now),
    ]),
  )
  return f.topicId ? { kind: "attached", topicId: t.id, reopened } : { kind: "created", topicId: t.id }
}

/** B5 clear. Returns the topic id (null = no topic), or false when nothing changed. */
async function clearInstance(sc: StoreContext, instanceId: string, reasonRu: string): Promise<string | null | false> {
  const { orgId, now } = sc
  const [row] = await db
    .select({ id: signalInstance.id, code: signalInstance.code, topicId: signalInstance.topicId, clearedAt: signalInstance.clearedAt })
    .from(signalInstance)
    .where(and(eq(signalInstance.organizationId, orgId), eq(signalInstance.id, instanceId), isNotNull(signalInstance.conditionKey)))
  if (!row || row.clearedAt) return false
  const update = db
    .update(signalInstance)
    .set({ clearedAt: now, clearedReason: reasonRu })
    .where(and(eq(signalInstance.organizationId, orgId), eq(signalInstance.id, instanceId)))
  const t = row.topicId ? await loadTopicSnapshot(orgId, row.topicId) : null
  if (!t) {
    await update
    return null
  }
  const inst = t.instances.find((i) => i.id === instanceId)
  if (inst) inst.clearedAt = now
  const events: TopicEventDraft[] = [
    { topicId: t.id, type: "process_signal", sourceItemId: null, payload: { code: row.code, action: "cleared", instanceId, reason: reasonRu } },
  ]
  // A topic the user closed / merged keeps its status; only derived fields change.
  if (!USER_CLOSED.includes(t.status)) events.push(...recomputeTopic(t, sc.book, now, sc.relationOf))
  await db.batch(
    asBatch([
      update,
      ...(USER_CLOSED.includes(t.status) ? [] : [topicUpsertOp(orgId, t)]),
      db.insert(topicEvent).values(eventRows(orgId, events, { actor: "agent", userId: sc.actorUserId })),
      ...dealDirtyOp(orgId, t.dealId, now),
    ]),
  )
  return t.id
}

/** Open (not cleared) process instances per code for the admin view. */
export async function countOpenProcessInstances(orgId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ code: signalInstance.code, n: sql<number>`count(*)::int` })
    .from(signalInstance)
    .where(and(eq(signalInstance.organizationId, orgId), isNotNull(signalInstance.conditionKey), isNull(signalInstance.clearedAt)))
    .groupBy(signalInstance.code)
  return new Map(rows.map((r) => [r.code, r.n]))
}

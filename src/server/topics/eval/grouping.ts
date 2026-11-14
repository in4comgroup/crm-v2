import "server-only"
import { randomUUID } from "crypto"
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { sourceItem, topic, topicItem, topicsEvalRun, topicsGoldenItem } from "@/db/schema"
import { readTopicGroups } from "@/lib/topics/golden-expected"
import { computeGroupingEval, type GroupingEvalItem, type GroupingReport } from "@/lib/topics/grouping-eval"

// Grouping eval («Оценка группировки по темам», plan phase 3 exit gate,
// spec 01 §12). Platform-admin tooling, org id explicit; the admin route
// does the session check. Runs are stored in `topics_eval_run` with
// kind = "grouping", config = { input: "golden", kind: "grouping" } and
// metrics = { schema: 1, report: GroupingReport, savedAt } (finished at once).
// Synthetic golden items are never part of it: the engine never processed them.

export type EngineTopicLink = { id: string; title: string; status: string; roles: string[] }

/**
 * Engine topics of root source items (`topic_item`), merged topics replaced
 * by their final `merged_into_topic_id` target. Map: source item id → topics.
 */
export async function loadEngineTopicsBySourceItem(
  orgId: string,
  sourceItemIds: readonly string[],
): Promise<Map<string, EngineTopicLink[]>> {
  const out = new Map<string, EngineTopicLink[]>()
  const ids = [...new Set(sourceItemIds)]
  if (ids.length === 0) return out
  const links: { sourceItemId: string; topicId: string; role: string }[] = []
  for (let i = 0; i < ids.length; i += 500) {
    links.push(
      ...(await db
        .select({ sourceItemId: topicItem.sourceItemId, topicId: topicItem.topicId, role: topicItem.role })
        .from(topicItem)
        .where(and(eq(topicItem.organizationId, orgId), inArray(topicItem.sourceItemId, ids.slice(i, i + 500))))),
    )
  }
  // Load topics, following merge chains (≤ 10 hops).
  const topics = new Map<string, { title: string; status: string; mergedInto: string | null }>()
  let pending = [...new Set(links.map((l) => l.topicId))]
  for (let hop = 0; hop < 10 && pending.length > 0; hop++) {
    const rows = await db
      .select({ id: topic.id, title: topic.title, status: topic.status, mergedInto: topic.mergedIntoTopicId })
      .from(topic)
      .where(and(eq(topic.organizationId, orgId), inArray(topic.id, pending)))
    for (const r of rows) topics.set(r.id, { title: r.title, status: r.status, mergedInto: r.mergedInto })
    pending = [...new Set(rows.map((r) => r.mergedInto).filter((x): x is string => !!x && !topics.has(x)))]
  }
  const finalId = (id: string): string => {
    let cur = id
    for (let hop = 0; hop < 10; hop++) {
      const t = topics.get(cur)
      if (!t?.mergedInto || !topics.has(t.mergedInto)) return cur
      cur = t.mergedInto
    }
    return cur
  }
  for (const l of links) {
    const id = finalId(l.topicId)
    const t = topics.get(id)
    if (!t) continue
    const list = out.get(l.sourceItemId) ?? []
    const existing = list.find((x) => x.id === id)
    if (existing) {
      if (!existing.roles.includes(l.role)) existing.roles.push(l.role)
    } else {
      list.push({ id, title: t.title, status: t.status, roles: [l.role] })
    }
    out.set(l.sourceItemId, list)
  }
  return out
}

export type GroupingInputStats = {
  /** Reviewed real items with topic groups set (the eval input). */
  included: number
  /** Reviewed real items whose answer has no topic-group field (old JSON answers). */
  reviewedWithoutField: number
  /** Reviewed synthetic items (never part of the grouping eval). */
  syntheticReviewed: number
}

/** Eval input: reviewed REAL items with `topicGroups` set + their engine topics. */
export async function loadGroupingEvalItems(
  orgId: string,
): Promise<{ items: GroupingEvalItem[]; stats: GroupingInputStats }> {
  const rows = await db
    .select({
      id: topicsGoldenItem.id,
      synthetic: topicsGoldenItem.synthetic,
      sourceItemId: topicsGoldenItem.sourceItemId,
      expected: topicsGoldenItem.expected,
      text: topicsGoldenItem.text,
      topicStatus: sourceItem.topicStatus,
      topicReason: sourceItem.topicReason,
      subject: sourceItem.metadataJson,
    })
    .from(topicsGoldenItem)
    .leftJoin(sourceItem, eq(sourceItem.id, topicsGoldenItem.sourceItemId))
    .where(
      and(
        eq(topicsGoldenItem.organizationId, orgId),
        eq(topicsGoldenItem.status, "reviewed"),
        isNotNull(topicsGoldenItem.expected),
      ),
    )
  const stats: GroupingInputStats = { included: 0, reviewedWithoutField: 0, syntheticReviewed: 0 }
  const chosen: { row: (typeof rows)[number]; groups: string[] }[] = []
  for (const r of rows) {
    if (r.synthetic) {
      stats.syntheticReviewed++
      continue
    }
    if (!r.sourceItemId) continue // the real item was deleted (teardown)
    const groups = readTopicGroups(r.expected)
    if (groups === null) {
      stats.reviewedWithoutField++
      continue
    }
    chosen.push({ row: r, groups })
  }
  stats.included = chosen.length
  const topicsBy = await loadEngineTopicsBySourceItem(
    orgId,
    chosen.map((c) => c.row.sourceItemId!),
  )
  const items: GroupingEvalItem[] = chosen.map(({ row, groups }) => {
    const meta = (row.subject ?? {}) as { subject?: unknown }
    const subject = typeof meta.subject === "string" ? meta.subject : null
    return {
      goldenItemId: row.id,
      sourceItemId: row.sourceItemId!,
      groups,
      topics: (topicsBy.get(row.sourceItemId!) ?? []).map((t) => ({ id: t.id, title: t.title })),
      topicStatus: row.topicStatus,
      topicReason: row.topicReason,
      preview: subject ?? previewOf(row.text),
    }
  })
  return { items, stats }
}

function previewOf(text: string | null): string | null {
  if (!text) return null
  const m = text.match(/(^|\n)## Content[ \t]*\n/)
  const body = m && m.index !== undefined ? text.slice(m.index + m[0].length) : text
  const line = body.replace(/\s+/g, " ").trim()
  return line ? line.slice(0, 140) : null
}

export type GroupingRunReport = GroupingReport & { stats: GroupingInputStats; computedAt: string }

/** Compute now (no write). */
export async function computeGroupingReport(orgId: string): Promise<GroupingRunReport> {
  const { items, stats } = await loadGroupingEvalItems(orgId)
  return { ...computeGroupingEval(items), stats, computedAt: new Date().toISOString() }
}

/** Compute and store one run (`topics_eval_run.kind = "grouping"`). */
export async function runGroupingEval(
  orgId: string,
  userId: string | null,
): Promise<{ runId: string; report: GroupingRunReport }> {
  const report = await computeGroupingReport(orgId)
  const runId = randomUUID()
  await db.insert(topicsEvalRun).values({
    id: runId,
    organizationId: orgId,
    kind: "grouping",
    config: { input: "golden", kind: "grouping", items: report.items },
    metrics: { schema: 1, report, savedAt: report.computedAt },
    createdByUserId: userId,
    finishedAt: new Date(),
  })
  return { runId, report }
}

export type GroupingRunRow = {
  runId: string
  createdAt: string
  items: number
  expectedSame: number
  precision: number | null
  recall: number | null
  verdict: GroupingReport["verdict"] | null
}

export async function listGroupingRuns(orgId: string, limit = 30): Promise<GroupingRunRow[]> {
  const rows = await db
    .select({ id: topicsEvalRun.id, createdAt: topicsEvalRun.createdAt, metrics: topicsEvalRun.metrics })
    .from(topicsEvalRun)
    .where(and(eq(topicsEvalRun.organizationId, orgId), eq(topicsEvalRun.kind, "grouping")))
    .orderBy(desc(topicsEvalRun.createdAt))
    .limit(limit)
  return rows.map((r) => {
    const rep = ((r.metrics ?? {}) as { report?: Partial<GroupingReport> }).report ?? {}
    return {
      runId: r.id,
      createdAt: r.createdAt.toISOString(),
      items: rep.items ?? 0,
      expectedSame: rep.pairs?.expectedSame ?? 0,
      precision: rep.precision ?? null,
      recall: rep.recall ?? null,
      verdict: rep.verdict ?? null,
    }
  })
}

/** Stored report of a grouping run (null = unknown run or another kind). */
export async function getGroupingRun(
  runId: string,
): Promise<{ runId: string; organizationId: string; report: GroupingRunReport } | null> {
  const [r] = await db
    .select({ id: topicsEvalRun.id, organizationId: topicsEvalRun.organizationId, metrics: topicsEvalRun.metrics })
    .from(topicsEvalRun)
    .where(and(eq(topicsEvalRun.id, runId), eq(topicsEvalRun.kind, "grouping")))
  const report = ((r?.metrics ?? {}) as { report?: GroupingRunReport }).report
  return r && report ? { runId: r.id, organizationId: r.organizationId, report } : null
}

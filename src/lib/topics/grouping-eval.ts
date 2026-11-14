// Grouping eval («Оценка группировки по темам», spec topics/01 §12, plan
// phase 3 exit gate). PURE and client-safe (the report type is shown in the
// admin UI).
//
// Input: reviewed REAL golden items with `expected.topicGroups` set (an empty
// list = «no topic») and the engine topics each item is linked to
// (`topic_item`, merged topics already replaced by their target).
// Pairwise over every item pair:
//   expected-same  = the two items share ≥ 1 expected group (by label key)
//   predicted-same = the two items share ≥ 1 engine topic
//   precision = both / predicted-same, recall = both / expected-same.
// Gate: precision ≥ 0.9 and recall ≥ 0.8; fewer than 20 expected-same pairs
// = «мало данных».

import { topicGroupKey } from "@/lib/topics/golden-expected"

export const GROUPING_THRESHOLDS = { precisionMin: 0.9, recallMin: 0.8, minExpectedPairs: 20 } as const

export type GroupingEvalTopic = { id: string; title: string }

export type GroupingEvalItem = {
  goldenItemId: string
  sourceItemId: string
  /** Expected topic-group labels (may be empty = no topic). */
  groups: string[]
  /** Engine topics of the item (merged → target, deduplicated by the caller or here). */
  topics: GroupingEvalTopic[]
  /** source_item.topic_status / topic_reason (why there is no topic). */
  topicStatus?: string | null
  topicReason?: string | null
  /** Short text for the details lists. */
  preview?: string | null
}

export type GroupingVerdict = "pass" | "fail" | "insufficient"

export type GroupingReport = {
  thresholds: typeof GROUPING_THRESHOLDS
  items: number
  itemsWithGroups: number
  itemsWithTopic: number
  /** Items with no expected group but an engine topic. */
  itemsNoGroupWithTopic: number
  groups: number
  topics: number
  pairs: { total: number; expectedSame: number; predictedSame: number; both: number }
  precision: number | null
  recall: number | null
  verdict: GroupingVerdict
  /** Share of groups (≥ 2 items with a topic) that are split. */
  overSplitRate: number | null
  /** Share of topics (≥ 2 items with a group) that are merged. */
  overMergeRate: number | null
  /** «Разбитые темы»: one expected group over several engine topics. */
  split: {
    group: string
    items: number
    itemsWithoutTopic: number
    topics: { id: string; title: string; items: number }[]
  }[]
  /** «Склеенные темы»: one engine topic holding items of several groups. */
  merged: {
    topicId: string
    title: string
    items: number
    itemsWithoutGroup: number
    groups: { group: string; items: number }[]
  }[]
  /** Items with an expected group but no engine topic. */
  missing: {
    goldenItemId: string
    sourceItemId: string
    groups: string[]
    topicStatus: string | null
    topicReason: string | null
    preview: string | null
  }[]
}

const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null)

export function computeGroupingEval(input: readonly GroupingEvalItem[]): GroupingReport {
  const t = GROUPING_THRESHOLDS
  // Normalise: group keys (first spelling = display label), unique topics.
  const groupLabel = new Map<string, string>()
  const topicTitle = new Map<string, string>()
  const items = input.map((it) => {
    const keys = new Set<string>()
    for (const g of it.groups) {
      const k = topicGroupKey(g)
      if (!k) continue
      keys.add(k)
      if (!groupLabel.has(k)) groupLabel.set(k, g.trim())
    }
    const topics = new Set<string>()
    for (const tp of it.topics) {
      topics.add(tp.id)
      if (!topicTitle.has(tp.id)) topicTitle.set(tp.id, tp.title)
    }
    return { src: it, keys, topics }
  })

  // Pairwise counts. A group is «split» when two of its items that both have
  // engine topics share no topic; a topic is «merged» when two of its items
  // that both have expected groups share no group. (An item in two groups and
  // two topics — one email, two questions — is neither by itself.)
  let total = 0
  let expectedSame = 0
  let predictedSame = 0
  let both = 0
  const splitKeys = new Set<string>()
  const mergedIds = new Set<string>()
  const shares = (a: Set<string>, b: Set<string>) => {
    const [small, big] = a.size <= b.size ? [a, b] : [b, a]
    for (const x of small) if (big.has(x)) return true
    return false
  }
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      total++
      const e = shares(items[i].keys, items[j].keys)
      const p = shares(items[i].topics, items[j].topics)
      if (e) expectedSame++
      if (p) predictedSame++
      if (e && p) both++
      const a = items[i]
      const b = items[j]
      if (e && !p && a.topics.size > 0 && b.topics.size > 0) {
        for (const k of a.keys) if (b.keys.has(k)) splitKeys.add(k)
      }
      if (p && !e && a.keys.size > 0 && b.keys.size > 0) {
        for (const tp of a.topics) if (b.topics.has(tp)) mergedIds.add(tp)
      }
    }
  }
  const precision = ratio(both, predictedSame)
  const recall = ratio(both, expectedSame)
  let verdict: GroupingVerdict
  if (expectedSame < t.minExpectedPairs) verdict = "insufficient"
  else verdict = (precision === null || precision >= t.precisionMin) && (recall ?? 0) >= t.recallMin ? "pass" : "fail"

  // Group → topics («Разбитые темы»).
  const byGroup = new Map<string, { items: number; noTopic: number; topics: Map<string, number> }>()
  // Topic → groups («Склеенные темы»).
  const byTopic = new Map<string, { items: number; noGroup: number; groups: Map<string, number> }>()
  for (const it of items) {
    for (const k of it.keys) {
      const g = byGroup.get(k) ?? { items: 0, noTopic: 0, topics: new Map() }
      g.items++
      if (it.topics.size === 0) g.noTopic++
      for (const tp of it.topics) g.topics.set(tp, (g.topics.get(tp) ?? 0) + 1)
      byGroup.set(k, g)
    }
    for (const tp of it.topics) {
      const e = byTopic.get(tp) ?? { items: 0, noGroup: 0, groups: new Map() }
      e.items++
      if (it.keys.size === 0) e.noGroup++
      for (const k of it.keys) e.groups.set(k, (e.groups.get(k) ?? 0) + 1)
      byTopic.set(tp, e)
    }
  }

  const sortCount = <T extends { items: number }>(a: T[]) => a.sort((x, y) => y.items - x.items)
  const split = sortCount(
    [...byGroup.entries()]
      .filter(([k]) => splitKeys.has(k))
      .map(([k, g]) => ({
        group: groupLabel.get(k) ?? k,
        items: g.items,
        itemsWithoutTopic: g.noTopic,
        topics: sortCount(
          [...g.topics.entries()].map(([id, n]) => ({ id, title: topicTitle.get(id) ?? id, items: n })),
        ),
      })),
  )
  const merged = sortCount(
    [...byTopic.entries()]
      .filter(([id]) => mergedIds.has(id))
      .map(([id, e]) => ({
        topicId: id,
        title: topicTitle.get(id) ?? id,
        items: e.items,
        itemsWithoutGroup: e.noGroup,
        groups: sortCount([...e.groups.entries()].map(([k, n]) => ({ group: groupLabel.get(k) ?? k, items: n }))),
      })),
  )
  const groupsWithTopicPairs = [...byGroup.values()].filter((g) => g.items - g.noTopic >= 2).length
  const topicsWithGroupPairs = [...byTopic.values()].filter((e) => e.items - e.noGroup >= 2).length
  const splitCounted = splitKeys.size
  const mergedCounted = mergedIds.size

  const missing = items
    .filter((it) => it.keys.size > 0 && it.topics.size === 0)
    .map((it) => ({
      goldenItemId: it.src.goldenItemId,
      sourceItemId: it.src.sourceItemId,
      groups: [...it.keys].map((k) => groupLabel.get(k) ?? k),
      topicStatus: it.src.topicStatus ?? null,
      topicReason: it.src.topicReason ?? null,
      preview: it.src.preview ?? null,
    }))

  return {
    thresholds: t,
    items: items.length,
    itemsWithGroups: items.filter((it) => it.keys.size > 0).length,
    itemsWithTopic: items.filter((it) => it.topics.size > 0).length,
    itemsNoGroupWithTopic: items.filter((it) => it.keys.size === 0 && it.topics.size > 0).length,
    groups: byGroup.size,
    topics: byTopic.size,
    pairs: { total, expectedSame, predictedSame, both },
    precision,
    recall,
    verdict,
    overSplitRate: ratio(splitCounted, groupsWithTopicPairs),
    overMergeRate: ratio(mergedCounted, topicsWithGroupPairs),
    split,
    merged,
    missing,
  }
}

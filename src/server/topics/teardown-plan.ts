// PURE part of the topic side of a source teardown (plan phase 3 task 7):
// which topics a removal of items deletes or recomputes. No DB, unit-tested.

/** One topic_item link of a topic touched by a source (any source of the org). */
export type TopicTeardownLink = {
  topicId: string
  title: string
  status: string
  sourceItemId: string
  sourceId: string
  role: string
}

export type TopicTeardownPlan = {
  /** Topics whose every non-context item is removed → deleted. */
  deleteTopicIds: string[]
  /** Topics that keep evidence outside the removed items → recomputed. */
  changeTopicIds: string[]
  /** Context items (kept) of deleted topics → topic progress reset. */
  resetItemIds: string[]
}

/**
 * Pure: which topics a removal of `removedItemIds` deletes or changes. Same
 * rule as `detachSourceItemFromTopics`: a topic left with no item, or only
 * `context` items, is deleted.
 */
export function planTopicTeardown(links: readonly TopicTeardownLink[], removedItemIds: ReadonlySet<string>): TopicTeardownPlan {
  const byTopic = new Map<string, TopicTeardownLink[]>()
  for (const l of links) {
    const list = byTopic.get(l.topicId) ?? []
    list.push(l)
    byTopic.set(l.topicId, list)
  }
  const deleteTopicIds: string[] = []
  const changeTopicIds: string[] = []
  const reset = new Set<string>()
  for (const [topicId, list] of byTopic) {
    if (!list.some((l) => removedItemIds.has(l.sourceItemId))) continue
    const keepsEvidence = list.some((l) => l.role !== "context" && !removedItemIds.has(l.sourceItemId))
    if (keepsEvidence) {
      changeTopicIds.push(topicId)
    } else {
      deleteTopicIds.push(topicId)
      for (const l of list) if (!removedItemIds.has(l.sourceItemId)) reset.add(l.sourceItemId)
    }
  }
  return { deleteTopicIds, changeTopicIds, resetItemIds: [...reset] }
}


import { describe, expect, it } from "vitest"
import { planTopicTeardown, type TopicTeardownLink } from "./teardown-plan"

// Delete vs recompute of topics when a source teardown removes items.

const link = (topicId: string, sourceItemId: string, role = "update", sourceId = "s1"): TopicTeardownLink => ({
  topicId,
  title: topicId,
  status: "open",
  sourceItemId,
  sourceId,
  role,
})

describe("planTopicTeardown", () => {
  it("deletes a topic whose evidence items are all removed and resets its kept context items", () => {
    const plan = planTopicTeardown(
      [link("t1", "a", "origin"), link("t1", "b"), link("t1", "c", "context", "s2")],
      new Set(["a", "b"]),
    )
    expect(plan.deleteTopicIds).toEqual(["t1"])
    expect(plan.changeTopicIds).toEqual([])
    expect(plan.resetItemIds).toEqual(["c"])
  })

  it("recomputes a topic that keeps an evidence item outside the selection", () => {
    const plan = planTopicTeardown([link("t1", "a", "origin"), link("t1", "x", "update", "s2")], new Set(["a"]))
    expect(plan.deleteTopicIds).toEqual([])
    expect(plan.changeTopicIds).toEqual(["t1"])
    expect(plan.resetItemIds).toEqual([])
  })

  it("leaves untouched topics alone", () => {
    const plan = planTopicTeardown([link("t1", "x"), link("t2", "a")], new Set(["a"]))
    expect(plan.deleteTopicIds).toEqual(["t2"])
    expect(plan.changeTopicIds).toEqual([])
  })

  it("deletes a topic that only had context items left in the selection", () => {
    const plan = planTopicTeardown([link("t1", "a", "context")], new Set(["a"]))
    expect(plan.deleteTopicIds).toEqual(["t1"])
  })
})

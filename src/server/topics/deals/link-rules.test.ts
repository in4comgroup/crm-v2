import { describe, expect, it } from "vitest"
import { decideDealLink, type LinkDealOption, type LinkTopicInput } from "./link-rules"

const deal = (id: string, extra: Partial<LinkDealOption> = {}): LinkDealOption => ({
  id,
  name: `Сделка ${id}`,
  stageLabelRu: "Квалификация",
  status: "active",
  terminal: false,
  ...extra,
})

const base: LinkTopicInput = {
  family: "offer",
  status: "open",
  hasCountedInstance: true,
  userUnlinked: false,
  openProposal: false,
  deals: [deal("d1")],
  lastMarker: null,
  dryRun: false,
}

describe("decideDealLink", () => {
  it("one open deal → link", () => {
    expect(decideDealLink(base)).toEqual({ action: "link", dealId: "d1", dealIds: ["d1"] })
  })
  it("two or more open deals → card with sorted options", () => {
    const r = decideDealLink({ ...base, deals: [deal("d2", { name: "Б" }), deal("d1", { name: "А" })] })
    expect(r.action).toBe("card")
    if (r.action === "card") {
      expect(r.options.map((o) => o.id)).toEqual(["d1", "d2"])
      expect(r.dealIds).toEqual(["d1", "d2"])
    }
  })
  it("won / lost deals are never targets", () => {
    expect(decideDealLink({ ...base, deals: [deal("d1"), deal("d2", { terminal: true })] })).toMatchObject({ action: "link", dealId: "d1" })
    expect(decideDealLink({ ...base, deals: [deal("d2", { terminal: true })] })).toMatchObject({ action: "skip", reason: "no_deal" })
  })
  it("paused deals are targets", () => {
    expect(decideDealLink({ ...base, deals: [deal("d1", { status: "paused" })] })).toMatchObject({ action: "link" })
  })
  it("skips: family, status, user unlink, no counted signal, open proposal, no deal", () => {
    expect(decideDealLink({ ...base, family: "supplier" })).toMatchObject({ reason: "family" })
    expect(decideDealLink({ ...base, family: null })).toMatchObject({ reason: "family" })
    expect(decideDealLink({ ...base, status: "merged" })).toMatchObject({ reason: "status" })
    expect(decideDealLink({ ...base, userUnlinked: true })).toMatchObject({ reason: "user_unlinked" })
    expect(decideDealLink({ ...base, hasCountedInstance: false })).toMatchObject({ reason: "no_signal" })
    expect(decideDealLink({ ...base, openProposal: true })).toMatchObject({ reason: "open_proposal" })
    expect(decideDealLink({ ...base, deals: [] })).toMatchObject({ reason: "no_deal" })
  })
  it("decided once per set of deals; a changed set decides again", () => {
    expect(decideDealLink({ ...base, lastMarker: { dealIds: ["d1"], dryRun: false } })).toMatchObject({ reason: "decided" })
    const two = { ...base, deals: [deal("d1"), deal("d2")], lastMarker: { dealIds: ["d1"], dryRun: false } }
    expect(decideDealLink(two).action).toBe("card")
  })
  it("a shadow (dry-run) marker does not count after the switch to on", () => {
    expect(decideDealLink({ ...base, lastMarker: { dealIds: ["d1"], dryRun: true } }).action).toBe("link")
    expect(decideDealLink({ ...base, dryRun: true, lastMarker: { dealIds: ["d1"], dryRun: true } })).toMatchObject({ reason: "decided" })
  })
})

import { describe, expect, it } from "vitest"
import {
  evalClientGuard,
  evaluateTopicDeals,
  NEW_DEAL_ID,
  type InstanceLite,
  type RuleLite,
  type TopicDealInput,
} from "./rules"

const STAGES = [
  { id: "s0", sortOrder: 0, isPrePipeline: true, terminal: null },
  { id: "s1", sortOrder: 10, isPrePipeline: false, terminal: null },
  { id: "s2", sortOrder: 20, isPrePipeline: false, terminal: null },
  { id: "s3", sortOrder: 30, isPrePipeline: false, terminal: null },
  { id: "s5", sortOrder: 50, isPrePipeline: false, terminal: null },
  { id: "won", sortOrder: 60, isPrePipeline: false, terminal: "won" as const },
  { id: "lost", sortOrder: 70, isPrePipeline: false, terminal: "lost" as const },
]

function rule(p: Partial<RuleLite> & Pick<RuleLite, "id" | "code" | "effect">): RuleLite {
  return { targetStageId: null, dealTypes: [], guards: {}, enabled: true, sort: 0, noteRu: null, ...p }
}

const CREATE_OFFER = rule({
  id: "r-create",
  code: "SALES_OFFER_REQUESTED",
  effect: "create_deal",
  targetStageId: "s1",
  dealTypes: ["new_location"],
  guards: { minConfidence: "medium", minScore: 5 },
  sort: 6,
})
const MOVE_OFFER = rule({
  id: "r-move",
  code: "SALES_OFFER_REQUESTED",
  effect: "move_stage",
  targetStageId: "s2",
  dealTypes: ["new_location", "listing"],
  guards: { minConfidence: "high", minScore: 5, fromStageIds: ["s1"], forwardOnly: true },
  sort: 7,
})

function inst(p: Partial<InstanceLite> = {}): InstanceLite {
  return {
    id: "i1",
    code: "SALES_OFFER_REQUESTED",
    itemId: "item1",
    confidence: "high",
    evidence: "Пришлите КП",
    direction: "inbound",
    ...p,
  }
}

function input(p: Partial<TopicDealInput> = {}): TopicDealInput {
  return {
    topic: { id: "t1", score: 7, clientId: "c1", contactId: null, hasConcreteTask: true },
    deal: null,
    openClientDeals: [],
    clientFacts: { isNew: true, type: null },
    stages: STAGES,
    dealTypeCodes: new Set(["new_location", "listing", "tender", "renewal", "supply_agreement"]),
    params: { autoCreateEnabled: true, autoCreateMinScore: 7, autoCreateMinConfidence: "high", proposalMinScore: 5 },
    rules: [CREATE_OFFER],
    instances: [inst()],
    openCardKinds: new Set(),
    ...p,
  }
}

const actions = (i: TopicDealInput) => evaluateTopicDeals(i).map((d) => `${d.ruleId}:${d.action}:${d.reason}`)

describe("evaluateTopicDeals — create", () => {
  it("auto-creates at high confidence, score ≥ 7, client resolved", () => {
    const [d] = evaluateTopicDeals(input())
    expect(d.action).toBe("create")
    expect(d.stageId).toBe("s1")
    expect(d.dealTypeCode).toBe("new_location")
    expect(d.evidence).toBe("Пришлите КП")
  })

  it("proposes at medium confidence", () => {
    expect(actions(input({ instances: [inst({ confidence: "medium" })] }))).toEqual(["r-create:propose:medium_confidence"])
  })

  it("source trust: a relayed note never auto-creates → proposal, also at high confidence", () => {
    expect(actions(input({ instances: [inst({ relayed: true })] }))).toEqual(["r-create:propose:relayed_source"])
  })

  it("proposes when the score is between proposalMinScore and the auto threshold", () => {
    expect(actions(input({ topic: { id: "t1", score: 6, clientId: "c1", contactId: null, hasConcreteTask: true } }))).toEqual([
      "r-create:propose:score_below_auto",
    ])
  })

  it("does nothing below the rule's / proposal minimum score", () => {
    expect(actions(input({ topic: { id: "t1", score: 4, clientId: "c1", contactId: null, hasConcreteTask: true } }))).toEqual([
      "r-create:skip:rule_min_score",
    ])
    const noRuleMin = input({
      rules: [{ ...CREATE_OFFER, guards: { minConfidence: "medium" } }],
      topic: { id: "t1", score: 4, clientId: "c1", contactId: null, hasConcreteTask: true },
    })
    expect(actions(noRuleMin)).toEqual(["r-create:skip:below_proposal"])
  })

  it("proposes for a contact without a client", () => {
    expect(actions(input({ topic: { id: "t1", score: 9, clientId: null, contactId: "k1", hasConcreteTask: true } }))).toEqual([
      "r-create:propose:no_client",
    ])
  })

  it("auto-create off → proposal only", () => {
    const i = input()
    i.params = { ...i.params, autoCreateEnabled: false }
    expect(actions(i)).toEqual(["r-create:propose:auto_off"])
  })

  it("links to the client's open deal of the same type instead of creating a duplicate", () => {
    const d = evaluateTopicDeals(
      input({ openClientDeals: [{ id: "d9", stageId: "s2", status: "paused", dealTypeCode: "new_location" }] }),
    )
    expect(d.map((x) => x.action)).toEqual(["link"])
    expect(d[0].dealId).toBe("d9")
  })

  it("an open deal of another type does not block", () => {
    const d = evaluateTopicDeals(input({ openClientDeals: [{ id: "d9", stageId: "s2", status: "active", dealTypeCode: "tender" }] }))
    expect(d[0].action).toBe("create")
  })

  it("never creates when the topic already has a deal", () => {
    expect(actions(input({ deal: { id: "d1", stageId: "s1", status: "active", dealTypeCode: "new_location" } }))).toEqual([
      "r-create:skip:topic_has_deal",
    ])
  })

  it("client guard: client_is_new / client_type", () => {
    const guarded = { ...CREATE_OFFER, guards: { ...CREATE_OFFER.guards, clientGuard: "client_is_new only (draft)" } }
    expect(actions(input({ rules: [guarded], clientFacts: { isNew: false, type: null } }))).toEqual([
      "r-create:skip:client_guard",
    ])
    expect(actions(input({ rules: [guarded], clientFacts: { isNew: true, type: null } }))).toEqual(["r-create:create:auto"])
    const unknown = { ...CREATE_OFFER, guards: { ...CREATE_OFFER.guards, clientGuard: "client has a buyer" } }
    expect(actions(input({ rules: [unknown] }))).toEqual(["r-create:propose:client_guard_unknown"])
  })

  it("requires_confirmation on a create rule → proposal", () => {
    const r = { ...CREATE_OFFER, guards: { ...CREATE_OFFER.guards, requiresConfirmation: true } }
    expect(actions(input({ rules: [r] }))).toEqual(["r-create:propose:requires_confirmation"])
  })

  it("one open proposal per topic", () => {
    expect(actions(input({ instances: [inst({ confidence: "medium" })], openCardKinds: new Set(["deal_proposal"]) }))).toEqual([
      "r-create:skip:proposal_open",
    ])
    const two = input({ instances: [inst({ id: "a", confidence: "medium" }), inst({ id: "b", confidence: "medium" })] })
    expect(actions(two)).toEqual(["r-create:propose:medium_confidence", "r-create:skip:proposal_open"])
  })

  it("area 0 never creates a deal", () => {
    expect(actions(input({ rules: [{ ...CREATE_OFFER, targetStageId: "s0" }] }))).toEqual(["r-create:skip:area0"])
  })

  it("PROSPECT_NEED_EXPRESSED only with a concrete task", () => {
    const r = rule({ id: "r-p", code: "PROSPECT_NEED_EXPRESSED", effect: "create_deal", targetStageId: "s1" })
    const i = (concrete: boolean) =>
      input({
        rules: [r],
        instances: [inst({ code: "PROSPECT_NEED_EXPRESSED" })],
        topic: { id: "t1", score: 8, clientId: "c1", contactId: null, hasConcreteTask: concrete },
      })
    expect(actions(i(false))).toEqual(["r-p:skip:requires_fact"])
    expect(actions(i(true))).toEqual(["r-p:create:auto"])
  })

  it("ORDER_* codes have no deal effect", () => {
    const r = rule({ id: "r-o", code: "ORDER_REQUESTED", effect: "create_deal", targetStageId: "s1" })
    expect(actions(input({ rules: [r], instances: [inst({ code: "ORDER_REQUESTED" })] }))).toEqual(["r-o:skip:order_code"])
  })

  it("our own outbound item never creates a deal", () => {
    expect(actions(input({ instances: [inst({ direction: "outbound" })] }))).toEqual(["r-create:skip:own_item"])
  })

  it("low confidence never acts", () => {
    expect(actions(input({ instances: [inst({ confidence: "low" })] }))).toEqual(["r-create:skip:low_confidence"])
  })

  it("missing deal type in the org → skip", () => {
    expect(actions(input({ dealTypeCodes: new Set() }))).toEqual(["r-create:skip:deal_type_missing"])
  })
})

describe("evaluateTopicDeals — move / outcome / context", () => {
  const deal = { id: "d1", stageId: "s1", status: "active" as const, dealTypeCode: "new_location" }

  it("moves forward with a high-confidence instance", () => {
    const [d] = evaluateTopicDeals(input({ rules: [MOVE_OFFER], deal }))
    expect(d.action).toBe("move")
    expect(d.fromStageId).toBe("s1")
    expect(d.stageId).toBe("s2")
  })

  it("never moves backward or sideways", () => {
    expect(actions(input({ rules: [{ ...MOVE_OFFER, guards: {} }], deal: { ...deal, stageId: "s3" } }))).toEqual([
      "r-move:skip:not_forward",
    ])
  })

  it("from_stages guard", () => {
    expect(actions(input({ rules: [MOVE_OFFER], deal: { ...deal, stageId: "s2" } }))).toEqual(["r-move:skip:from_stage"])
  })

  it("deal type guard (untyped deals pass only rules without types)", () => {
    expect(actions(input({ rules: [MOVE_OFFER], deal: { ...deal, dealTypeCode: null } }))).toEqual(["r-move:skip:deal_type"])
    expect(actions(input({ rules: [{ ...MOVE_OFFER, dealTypes: [] }], deal: { ...deal, dealTypeCode: null } }))).toEqual([
      "r-move:move:move",
    ])
  })

  it("medium confidence on a «high» move rule → stage_confirmation", () => {
    const [d] = evaluateTopicDeals(input({ rules: [MOVE_OFFER], deal, instances: [inst({ confidence: "medium" })] }))
    expect(d.action).toBe("confirm")
    expect(d.reason).toBe("one_level_below")
    expect(d.confirmEffect).toBe("move")
  })

  it("source trust: a relayed note never moves a deal alone → stage_confirmation", () => {
    const loose = { ...MOVE_OFFER, guards: { ...MOVE_OFFER.guards, minConfidence: "medium" as const } }
    const [d] = evaluateTopicDeals(input({ rules: [loose], deal, instances: [inst({ confidence: "medium", relayed: true })] }))
    expect(d.action).toBe("confirm")
    expect(d.reason).toBe("relayed_source")
    // The same instance from the client's own message moves the deal.
    expect(actions(input({ rules: [loose], deal, instances: [inst({ confidence: "medium" })] }))).toEqual(["r-move:move:move"])
  })

  it("requires_confirmation → stage_confirmation; one open per topic", () => {
    const r = { ...MOVE_OFFER, guards: { ...MOVE_OFFER.guards, requiresConfirmation: true } }
    expect(actions(input({ rules: [r], deal }))).toEqual(["r-move:confirm:requires_confirmation"])
    expect(actions(input({ rules: [r], deal, openCardKinds: new Set(["stage_confirmation"]) }))).toEqual([
      "r-move:skip:confirmation_open",
    ])
  })

  it("paused deal does not move", () => {
    expect(actions(input({ rules: [MOVE_OFFER], deal: { ...deal, status: "paused" } }))).toEqual(["r-move:skip:deal_paused"])
  })

  it("our own item never moves a stage", () => {
    expect(actions(input({ rules: [MOVE_OFFER], deal, instances: [inst({ direction: "outbound" })] }))).toEqual([
      "r-move:skip:own_item",
    ])
  })

  it("create then move in one evaluation: a later instance moves the new deal, the same one does not", () => {
    const d = evaluateTopicDeals(
      input({ rules: [CREATE_OFFER, MOVE_OFFER], instances: [inst({ id: "a" }), inst({ id: "b" })] }),
    )
    expect(d.map((x) => `${x.instanceId}:${x.ruleId}:${x.action}:${x.reason}`)).toEqual([
      "a:r-create:create:auto",
      "a:r-move:skip:same_signal",
      "b:r-create:skip:topic_has_deal",
      "b:r-move:move:move",
    ])
    expect(d[3].dealId).toBe(NEW_DEAL_ID)
  })

  it("outcome won goes to the terminal stage (backward allowed only here)", () => {
    const r = rule({
      id: "r-won",
      code: "LISTING_CONFIRMED",
      effect: "outcome_won",
      targetStageId: "won",
      guards: { minConfidence: "high", fromStageIds: ["s1", "s2", "s3", "s5"] },
    })
    const [d] = evaluateTopicDeals(input({ rules: [r], deal, instances: [inst({ code: "LISTING_CONFIRMED" })] }))
    expect(d.action).toBe("outcome")
    expect(d.outcome).toBe("won")
    expect(d.stageId).toBe("won")
    const [m] = evaluateTopicDeals(
      input({ rules: [r], deal, instances: [inst({ code: "LISTING_CONFIRMED", confidence: "medium" })] }),
    )
    expect(m.action).toBe("confirm")
    expect(m.confirmEffect).toBe("outcome_won")
  })

  it("outcome lost with requires_confirmation → confirmation card", () => {
    const r = rule({
      id: "r-lost",
      code: "CONTRACT_TERMINATED",
      effect: "outcome_lost",
      targetStageId: "lost",
      dealTypes: [],
      guards: { minConfidence: "high", requiresConfirmation: true },
    })
    const [d] = evaluateTopicDeals(input({ rules: [r], deal, instances: [inst({ code: "CONTRACT_TERMINATED" })] }))
    expect(d.action).toBe("confirm")
    expect(d.confirmEffect).toBe("outcome_lost")
    expect(d.stageId).toBe("lost")
  })

  it("in_stage → context only; needs a deal", () => {
    const r = rule({ id: "r-ctx", code: "DECISION_POSTPONED", effect: "in_stage", guards: { minConfidence: "medium" } })
    expect(actions(input({ rules: [r], deal, instances: [inst({ code: "DECISION_POSTPONED" })] }))).toEqual([
      "r-ctx:context:context",
    ])
    expect(actions(input({ rules: [r], instances: [inst({ code: "DECISION_POSTPONED" })] }))).toEqual(["r-ctx:skip:no_deal"])
    // Our own item may still add context.
    expect(
      actions(input({ rules: [r], deal, instances: [inst({ code: "DECISION_POSTPONED", direction: "outbound" })] })),
    ).toEqual(["r-ctx:context:context"])
  })

  it("pause / resume", () => {
    const p = rule({ id: "r-pause", code: "X", effect: "pause", guards: { minConfidence: "medium" } })
    expect(actions(input({ rules: [p], deal, instances: [inst({ code: "X" })] }))).toEqual(["r-pause:pause:pause"])
    const r = rule({ id: "r-res", code: "X", effect: "resume", guards: { minConfidence: "medium" } })
    expect(actions(input({ rules: [r], deal, instances: [inst({ code: "X" })] }))).toEqual(["r-res:skip:already_active"])
    expect(actions(input({ rules: [r], deal: { ...deal, status: "paused" }, instances: [inst({ code: "X" })] }))).toEqual([
      "r-res:resume:resume",
    ])
  })

  it("disabled rules are ignored", () => {
    expect(evaluateTopicDeals(input({ rules: [{ ...CREATE_OFFER, enabled: false }] }))).toEqual([])
  })
})

describe("evalClientGuard", () => {
  it("handles the template forms", () => {
    expect(evalClientGuard(undefined, null)).toBe("pass")
    expect(evalClientGuard("client_type = Розница", { isNew: false, type: "розница" })).toBe("pass")
    expect(evalClientGuard("client_type = Розница", { isNew: false, type: "Сеть" })).toBe("fail")
    expect(evalClientGuard("client_type = Розница", { isNew: false, type: null })).toBe("fail")
    expect(evalClientGuard("client_type = Розница", { isNew: false, type: "retail", typeLabel: "Розница" })).toBe("pass")
    expect(evalClientGuard("client_type = retail", { isNew: false, type: "retail", typeLabel: "Розница" })).toBe("pass")
    expect(evalClientGuard("client_type = Сеть", { isNew: false, type: "retail", typeLabel: "Розница" })).toBe("fail")
    expect(evalClientGuard("client_is_new only", { isNew: true, type: null })).toBe("pass")
    expect(evalClientGuard("something else", { isNew: true, type: null })).toBe("unknown")
    expect(evalClientGuard("client_is_new", null)).toBe("unknown")
  })
})

describe("evaluateTopicDeals — entry gate go / no-go (docs/specs/funnel §3.2)", () => {
  const gated = (p: Partial<TopicDealInput> = {}) => {
    const base = input(p)
    return input({ ...p, params: { ...base.params, entryGate: "go_no_go" } })
  }

  it("a create that would happen becomes a go / no-go proposal at the rule's stage", () => {
    const [d] = evaluateTopicDeals(gated())
    expect(d.action).toBe("propose")
    expect(d.reason).toBe("entry_gate")
    expect(d.stageId).toBe("s1")
  })

  it("never auto-creates even with the proposal threshold above the score", () => {
    const i = gated()
    expect(actions({ ...i, params: { ...i.params, proposalMinScore: 9 } })).toEqual(["r-create:propose:entry_gate"])
  })

  it("weaker signals keep the normal proposal path", () => {
    expect(actions(gated({ instances: [inst({ confidence: "medium" })] }))).toEqual(["r-create:propose:medium_confidence"])
  })

  it("the client's open deal of the same type is still linked (no gate)", () => {
    const open = { id: "d1", stageId: "s2", status: "active" as const, dealTypeCode: "new_location" }
    expect(actions(gated({ openClientDeals: [open] }))).toEqual(["r-create:link:existing_deal"])
  })

  it("an open proposal is not duplicated", () => {
    expect(actions(gated({ openCardKinds: new Set(["deal_proposal"]) }))).toEqual(["r-create:skip:proposal_open"])
  })
})

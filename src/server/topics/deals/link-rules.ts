// Auto-link of topics to the client's existing deal (spec
// docs/specs/topics/10-deal-status-from-topics.md §3). PURE, unit-tested in
// ./link-rules.test.ts; the DB side is ./auto-link.ts.
//
// A topic without a deal never updates any deal's «Текущее состояние»
// (`deal.state_text` is built only from linked topics). The stage rules
// (./rules.ts) link or create deals only for codes with a `create_deal`
// rule; every other business topic of a client with an open deal (a deal
// made by hand, an old deal) stayed unlinked. This rule closes that gap:
//   exactly one open deal of the client → link the topic to it;
//   two or more → a `deal_link` card: the person picks the deal;
//   none → nothing (the stage rules may still propose a new deal).

/** Topic families that are about the work with a client (deal context). */
export const DEAL_LINK_FAMILIES = [
  "offer",
  "order",
  "invoice",
  "contract",
  "complaint",
  "meeting",
  "contact",
  "pitch",
  "delivery",
] as const

/** Topic statuses that may be linked (live, or resolved recently). */
export const DEAL_LINK_TOPIC_STATUSES = ["open", "dormant", "resolved"] as const

/** Topics with activity in the last N days are considered. */
export const DEAL_LINK_LOOKBACK_DAYS = 30

/** Topics decided per org per hourly run. */
export const DEAL_LINK_MAX_TOPICS_PER_RUN = 100

/** `topic_event.type` of the decision marker (idempotency). */
export const DEAL_LINK_EVENT = "deal_link_decision"

export type LinkDealOption = {
  id: string
  name: string
  stageLabelRu: string | null
  status: "active" | "paused"
  /** At the won / lost stage («Closed» / «Rejected»): never a target. */
  terminal: boolean
}

export type LinkTopicInput = {
  family: string | null
  status: string
  /** The topic has ≥ 1 counted signal instance. */
  hasCountedInstance: boolean
  /** A person unlinked a deal from this topic before: never auto-link again. */
  userUnlinked: boolean
  /** An open `deal_proposal` card: the stage rules want a NEW deal — a person decides. */
  openProposal: boolean
  /** Open deals (active / paused) of the topic's client. */
  deals: readonly LinkDealOption[]
  /** Last decision marker of this topic, if any. */
  lastMarker: { dealIds: readonly string[]; dryRun: boolean } | null
  /** Org mode `shadow`: decide, but do not write links. */
  dryRun: boolean
}

export type LinkSkipReason =
  | "family"
  | "status"
  | "no_signal"
  | "user_unlinked"
  | "open_proposal"
  | "no_deal"
  | "decided"

export type LinkDecision =
  | { action: "link"; dealId: string; dealIds: string[] }
  | { action: "card"; options: LinkDealOption[]; dealIds: string[] }
  | { action: "skip"; reason: LinkSkipReason; dealIds: string[] }

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i])

/** PURE. What to do with one topic that has a client and no deal. */
export function decideDealLink(i: LinkTopicInput): LinkDecision {
  const targets = i.deals.filter((d) => !d.terminal)
  const dealIds = targets.map((d) => d.id).sort()
  const skip = (reason: LinkSkipReason): LinkDecision => ({ action: "skip", reason, dealIds })
  if (!i.family || !(DEAL_LINK_FAMILIES as readonly string[]).includes(i.family)) return skip("family")
  if (!(DEAL_LINK_TOPIC_STATUSES as readonly string[]).includes(i.status)) return skip("status")
  if (i.userUnlinked) return skip("user_unlinked")
  if (!i.hasCountedInstance) return skip("no_signal")
  if (i.openProposal) return skip("open_proposal")
  if (targets.length === 0) return skip("no_deal")
  // Decided before for the same set of deals — unless that was a dry run
  // and the org now runs in mode `on`. A new / closed deal of the client
  // changes the set, so the topic is decided again.
  if (i.lastMarker && sameSet(i.lastMarker.dealIds, dealIds) && !(i.lastMarker.dryRun && !i.dryRun)) {
    return skip("decided")
  }
  if (targets.length === 1) return { action: "link", dealId: targets[0].id, dealIds }
  return { action: "card", options: [...targets].sort((a, b) => a.name.localeCompare(b.name, "ru")), dealIds }
}

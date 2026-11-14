// Deal risk engine (spec topics/01 §9.4, plan phase 5a task 3). PURE: no DB,
// no I/O. The store (risk-store.ts) loads the inputs, this module decides
// which `deal_risk` rows to activate, update or clear, the store writes them.
//
// Activation (deterministic): a COUNTED trigger instance (confidence ≠ low,
// code active for the org — parked / inactive codes never trigger) on a topic
// in the type's scope (deal = topics linked to the deal; client = topics of
// the deal's client; org_sku = any org topic whose products match the deal's
// topics), the org stage guard allows the deal's stage (no guard row = every
// stage; guard disabled = type off for the org), the occurrence count is
// reached and the named `condition` is true. Insufficient data → the
// condition is false (never a warning, spec §5.6). Our own outbound /
// internal items never trigger (the client's / supplier's words do).
//
// Clearing: a `clear_codes` instance on an in-scope topic newer than the
// newest trigger, a per-condition clearing check (date + next step agreed,
// handover, all trigger topics resolved, no live overdue topic), a deal
// outcome / closed deal, a user «Риск снят» (risk-store) or a
// `deals.state_summary` proposal with a cited item (deal-state summary).
// After a clear, only instances on items newer than the clear time count
// again for that type (the old evidence never re-activates it).
//
// Risks never move stages and never change amounts (§9.2).

export type RiskScope = "deal" | "client" | "org_sku"

export type RiskTypeDef = {
  code: string
  labelRu: string
  descriptionRu: string
  triggerCodes: string[]
  clearCodes: string[]
  severity: number
  minOccurrences: number
  condition: string | null
  scope: string
  enabled: boolean
}

/** deal_risk_stage_guard row of the org (undefined = no row = every stage). */
export type RiskGuard = { enabled: boolean; stageIds: string[] | null }

export type RiskFacts = {
  deadlines: { date: string; what: string; subjectIndex: number }[]
  proposedMeetingDate: string | null
  contractEndDate: string | null
  paymentTermsDays: number | null
  creditLimitRequested: number | null
}

export const EMPTY_RISK_FACTS: RiskFacts = {
  deadlines: [],
  proposedMeetingDate: null,
  contractEndDate: null,
  paymentTermsDays: null,
  creditLimitRequested: null,
}

/** One signal instance in a risk's scope (with what its item says). */
export type RiskInstance = {
  id: string
  code: string
  topicId: string
  itemId: string | null
  itemDate: Date
  confidence: "high" | "medium" | "low"
  counted: boolean
  scoreContrib: number
  evidence: string
  direction: string | null
  subjectIndex: number
  /** Products of the instance's subject (or the item's). */
  products: string[]
  /** Counterparty contact of the item's subject (≈ the author of an inbound item). */
  authorContactId: string | null
  facts: RiskFacts
  /** Our reply / the item says the product is out of stock (store regex). */
  outOfStockCue: boolean
}

export type RiskTopic = {
  id: string
  status: string
  dealId: string | null
  clientId: string | null
  products: string[]
}

/** One item on a deal topic (for the «date + next step agreed» and handover checks). */
export type RiskItem = {
  itemId: string
  topicId: string
  date: Date
  direction: string | null
  authorContactId: string | null
  facts: RiskFacts
  outOfStockCue: boolean
}

export type ExistingRisk = {
  id: string
  riskType: string
  status: "active" | "cleared"
  triggerInstanceIds: string[]
  occurrences: number
  topicId: string | null
  detectedAt: Date
  clearedAt: Date | null
}

export type RiskDealInput = {
  deal: {
    id: string
    clientId: string
    stageId: string
    /** active | paused | cancelled | deleted */
    status: string
    dealTypeCode: string | null
    contactIds: string[]
    /** Terminal stage (won / lost) or a closed status → every risk clears. */
    closed: boolean
    closedReason: string | null
  }
  types: RiskTypeDef[]
  guards: ReadonlyMap<string, RiskGuard>
  /** Codes active for the org (effective `active`; parked / inactive codes are absent). */
  activeCodes: ReadonlySet<string>
  topics: ReadonlyMap<string, RiskTopic>
  /** Instances on every topic in any scope (deal, client, org_sku candidates). */
  instances: RiskInstance[]
  /** Items of the deal's topics (and the client's topics), any role. */
  items: RiskItem[]
  existing: ExistingRisk[]
  settings: { maxDeferralDays: number | null; maxCreditLimitRub: number | null }
  now: Date
}

export type RiskAction =
  | {
      kind: "activate"
      riskType: string
      severity: number
      occurrences: number
      topicId: string
      triggerInstanceIds: string[]
      sourceItemIds: string[]
      /** Evidence of the newest trigger (journal). */
      evidence: string
      triggerScore: number
    }
  | {
      kind: "update"
      riskId: string
      riskType: string
      occurrences: number
      topicId: string
      triggerInstanceIds: string[]
      sourceItemIds: string[]
    }
  | {
      kind: "clear"
      riskId: string
      riskType: string
      by: "signal" | "condition" | "outcome"
      reason: string
      clearInstanceId: string | null
      clearItemId: string | null
    }

export const RISK_LOOKBACK_DAYS = 90
const DAY_MS = 86_400_000
const LIVE_TOPIC = new Set(["open", "dormant"])
/** Two postponement mentions closer than this are one postponement (a copy, a reminder). */
const SAME_POSTPONEMENT_MS = DAY_MS
const COMPLAINT_WINDOW_DAYS = 30
const RENEWAL_WINDOW_DAYS = 56
const LISTING_DEAL_TYPES = new Set(["listing", "supply_agreement", "renewal"])
const RENEWAL_DEAL_TYPES = new Set(["supply_agreement", "renewal"])
/** CONTACT_NEW_DECISION_MAKER counts only when the evidence names a replacement (05 note). */
const REPLACEMENT_CUE = /вместо|замен|смени|сменил|теперь\s+(?:я|он|она|вопрос|за)|передал|передаю|преемник|новый\s+(?:закупщик|менеджер|руководител|категорийн|контакт)|новая\s+(?:закупщица|менеджер)|replac|instead of|taking over|successor|new\s+(?:buyer|manager|contact)/i

/** Effective scope: the 05 note puts NO_STOCK_FOR_DEAL (deal_sku_out_of_stock) on org + SKU. */
export function riskScope(t: Pick<RiskTypeDef, "scope" | "condition">): RiskScope {
  if (t.condition === "deal_sku_out_of_stock") return "org_sku"
  return t.scope === "client" ? "client" : t.scope === "org_sku" ? "org_sku" : "deal"
}

/** Org stage guard: no row = every stage; disabled = type off; stage ids null / empty = every stage. */
export function guardAllows(guard: RiskGuard | undefined, stageId: string): boolean {
  if (!guard) return true
  if (!guard.enabled) return false
  if (!guard.stageIds || guard.stageIds.length === 0) return true
  return guard.stageIds.includes(stageId)
}

function normProduct(p: string): string {
  return p
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
}

/** Product names match: equal, or one contains the other (≥ 4 characters). */
export function productsMatch(a: readonly string[], b: readonly string[]): boolean {
  const bs = b.map(normProduct).filter((x) => x.length > 0)
  for (const raw of a) {
    const x = normProduct(raw)
    if (!x) continue
    for (const y of bs) {
      if (x === y) return true
      const [short, long] = x.length <= y.length ? [x, y] : [y, x]
      if (short.length >= 4 && (` ${long} `).includes(` ${short}`)) return true
    }
  }
  return false
}

const isOurs = (direction: string | null) => direction === "outbound" || direction === "internal"

/** Item carries an agreed date + next step: a proposed meeting date or a deadline with a «what». */
export function hasDateAndNextStep(f: RiskFacts): boolean {
  if (f.proposedMeetingDate) return true
  return f.deadlines.some((d) => !!d.date && d.what.trim().length > 0)
}

/** Distinct postponements (Q24-3): one per ≥ 24 h apart; a mention with a new date + step does not count. */
export function distinctPostponements(instances: readonly RiskInstance[]): RiskInstance[] {
  const sorted = [...instances]
    .filter((i) => !hasDateAndNextStep(i.facts))
    .sort((a, b) => a.itemDate.getTime() - b.itemDate.getTime() || a.id.localeCompare(b.id))
  const out: RiskInstance[] = []
  for (const i of sorted) {
    const last = out[out.length - 1]
    if (last && i.itemDate.getTime() - last.itemDate.getTime() < SAME_POSTPONEMENT_MS) continue
    if (last && i.itemId && last.itemId === i.itemId) continue
    out.push(i)
  }
  return out
}

type Eval = {
  /** Trigger instances that count for the risk (passed the condition). */
  triggers: RiskInstance[]
  /** Occurrence count compared with min_occurrences. */
  occurrences: number
  minOccurrences: number
}

function dateMs(iso: string | null): number | null {
  if (!iso) return null
  const t = Date.parse(iso.length === 10 ? `${iso}T00:00:00Z` : iso)
  return Number.isNaN(t) ? null : t
}

/** Condition per type. Returns the counting triggers + occurrences. */
function evaluateCondition(
  type: RiskTypeDef,
  candidates: RiskInstance[],
  input: RiskDealInput,
  scopeInstances: RiskInstance[],
  dealTopicIds: ReadonlySet<string>,
): Eval {
  const min = Math.max(1, type.minOccurrences)
  const distinctItems = (xs: RiskInstance[]) => new Set(xs.map((i) => i.itemId ?? i.id)).size
  const plain = (xs: RiskInstance[]): Eval => ({ triggers: xs, occurrences: distinctItems(xs), minOccurrences: min })
  const topicOf = (id: string) => input.topics.get(id)
  switch (type.condition) {
    case null:
    case "":
      return plain(candidates)

    case "no_other_overdue_open": {
      // Activation: an overdue invoice on a LIVE topic of the client (the debt is open).
      return plain(candidates.filter((i) => LIVE_TOPIC.has(topicOf(i.topicId)?.status ?? "")))
    }

    case "no_renewal_intent_in_window": {
      if (!input.deal.dealTypeCode || !RENEWAL_DEAL_TYPES.has(input.deal.dealTypeCode)) return plain([])
      const renewals = scopeInstances.filter((i) => i.code === "CONTRACT_RENEWAL_INTENT" && i.confidence !== "low")
      return plain(
        candidates.filter((i) => {
          const end = dateMs(i.facts.contractEndDate)
          if (end === null) return false
          const from = end - RENEWAL_WINDOW_DAYS * DAY_MS
          return !renewals.some((r) => r.itemDate.getTime() >= from && r.itemDate.getTime() <= input.now.getTime())
        }),
      )
    }

    case "distinct_postponements_without_new_date": {
      // Same decision = the deal's own topics; current cycle = after the last
      // item on a deal topic that agreed a date + next step.
      const onDeal = candidates.filter((i) => dealTopicIds.has(i.topicId))
      const agreedAt = Math.max(
        0,
        ...input.items.filter((it) => dealTopicIds.has(it.topicId) && hasDateAndNextStep(it.facts)).map((it) => it.date.getTime()),
      )
      const inCycle = onDeal.filter((i) => i.itemDate.getTime() > agreedAt)
      const distinct = distinctPostponements(inCycle)
      return { triggers: distinct, occurrences: distinct.length, minOccurrences: min }
    }

    case "deal_contact_lost_without_handover": {
      const deal = new Set(input.deal.contactIds)
      const ok = candidates.filter((i) => {
        const later = input.items.filter(
          (it) => dealTopicIds.has(it.topicId) && it.date.getTime() > i.itemDate.getTime() && !isOurs(it.direction),
        )
        if (i.code === "CONTACT_LEAVING") {
          if (!i.authorContactId || !deal.has(i.authorContactId)) return false
          // Handover: another contact of the client wrote on a deal topic later.
          return !later.some((it) => it.authorContactId && it.authorContactId !== i.authorContactId)
        }
        if (i.code === "CONTACT_NEW_DECISION_MAKER") {
          if (!REPLACEMENT_CUE.test(i.evidence)) return false
          // The new person has not written on the deal yet (no later inbound item from another contact).
          return !later.some((it) => it.authorContactId && it.authorContactId !== i.authorContactId)
        }
        return false
      })
      return plain(ok)
    }

    case "deal_type_listing_or_supply":
      return plain(input.deal.dealTypeCode && LISTING_DEAL_TYPES.has(input.deal.dealTypeCode) ? candidates : [])

    case "deal_sku_out_of_stock": {
      const dealProducts = [...dealTopicIds].flatMap((id) => topicOf(id)?.products ?? [])
      if (dealProducts.length === 0) return plain([])
      return plain(
        candidates.filter((i) => {
          if (!productsMatch(i.products, dealProducts)) return false
          if (i.code === "SUPPLIER_DELIVERY_DELAY") return true
          if (i.outOfStockCue) return true
          // Our reply on the same topic after the request says «нет в наличии».
          return input.items.some(
            (it) => it.topicId === i.topicId && it.outOfStockCue && it.date.getTime() >= i.itemDate.getTime(),
          )
        }),
      )
    }

    case "terms_above_policy": {
      const { maxDeferralDays, maxCreditLimitRub } = input.settings
      return plain(
        candidates.filter((i) => {
          const d = i.facts.paymentTermsDays
          const c = i.facts.creditLimitRequested
          return (d !== null && maxDeferralDays !== null && d > maxDeferralDays) ||
            (c !== null && maxCreditLimitRub !== null && c > maxCreditLimitRub)
        }),
      )
    }

    case "complaints_2_in_30d_or_escalated": {
      const since = input.now.getTime() - COMPLAINT_WINDOW_DAYS * DAY_MS
      const escalated = candidates.filter(
        (i) => i.code === "COMPLAINT_ESCALATED" && LIVE_TOPIC.has(topicOf(i.topicId)?.status ?? ""),
      )
      if (escalated.length > 0) return { triggers: escalated, occurrences: Math.max(min, escalated.length), minOccurrences: min }
      const recent = candidates.filter((i) => i.itemDate.getTime() >= since)
      const topics = new Set(recent.map((i) => i.topicId))
      return { triggers: recent, occurrences: topics.size, minOccurrences: min }
    }

    default:
      // Unknown named condition → cannot be checked → false (spec §5.6).
      return plain([])
  }
}

/** Per-condition clearing check of an ACTIVE risk (beyond clear codes). */
function conditionClear(
  type: RiskTypeDef,
  risk: ExistingRisk,
  input: RiskDealInput,
  dealTopicIds: ReadonlySet<string>,
  scopeInstances: RiskInstance[],
): { reason: string; itemId: string | null } | null {
  const triggerSet = new Set(risk.triggerInstanceIds)
  const triggers = input.instances.filter((i) => triggerSet.has(i.id))
  const newest = Math.max(risk.detectedAt.getTime(), ...triggers.map((i) => i.itemDate.getTime()))
  switch (type.condition) {
    case "distinct_postponements_without_new_date": {
      const agreed = input.items
        .filter((it) => dealTopicIds.has(it.topicId) && it.date.getTime() > newest && hasDateAndNextStep(it.facts))
        .sort((a, b) => a.date.getTime() - b.date.getTime())[0]
      return agreed ? { reason: "Согласованы дата и следующий шаг", itemId: agreed.itemId } : null
    }
    case "deal_contact_lost_without_handover": {
      const authors = new Set(triggers.map((i) => i.authorContactId).filter(Boolean))
      const handover = input.items
        .filter(
          (it) =>
            dealTopicIds.has(it.topicId) &&
            it.date.getTime() > newest &&
            !isOurs(it.direction) &&
            it.authorContactId &&
            !authors.has(it.authorContactId),
        )
        .sort((a, b) => a.date.getTime() - b.date.getTime())[0]
      return handover ? { reason: "Новый контакт клиента вступил в переписку по сделке", itemId: handover.itemId } : null
    }
    case "no_other_overdue_open": {
      const liveOverdue = scopeInstances.some(
        (i) => type.triggerCodes.includes(i.code) && LIVE_TOPIC.has(input.topics.get(i.topicId)?.status ?? ""),
      )
      return liveOverdue ? null : { reason: "Открытых тем о просроченной оплате не осталось", itemId: null }
    }
    case "complaints_2_in_30d_or_escalated": {
      const topicIds = new Set(triggers.map((i) => i.topicId))
      if (topicIds.size === 0) return null
      const allResolved = [...topicIds].every((id) => input.topics.get(id)?.status === "resolved")
      return allResolved ? { reason: "Все темы жалоб решены", itemId: null } : null
    }
    default:
      return null
  }
}

/** Clearing blocked while the condition still holds (debt: another overdue topic; complaints: unresolved). */
function clearCodeBlocked(type: RiskTypeDef, risk: ExistingRisk, input: RiskDealInput, scopeInstances: RiskInstance[]): boolean {
  if (type.condition === "no_other_overdue_open") {
    // INVOICE_PAID clears only when no other overdue topic of the client stays open.
    const clearTopics = new Set(scopeInstances.filter((i) => type.clearCodes.includes(i.code)).map((i) => i.topicId))
    return scopeInstances.some(
      (i) =>
        type.triggerCodes.includes(i.code) &&
        !clearTopics.has(i.topicId) &&
        LIVE_TOPIC.has(input.topics.get(i.topicId)?.status ?? ""),
    )
  }
  if (type.condition === "complaints_2_in_30d_or_escalated") {
    const triggerSet = new Set(risk.triggerInstanceIds)
    const topics = new Set(input.instances.filter((i) => triggerSet.has(i.id)).map((i) => i.topicId))
    return [...topics].some((id) => input.topics.get(id)?.status !== "resolved")
  }
  return false
}

/** Topic ids in a type's scope for this deal. */
function scopeTopicIds(scope: RiskScope, input: RiskDealInput): Set<string> {
  const out = new Set<string>()
  for (const t of input.topics.values()) {
    if (scope === "deal" && t.dealId === input.deal.id) out.add(t.id)
    else if (scope === "client" && (t.dealId === input.deal.id || (t.clientId && t.clientId === input.deal.clientId))) out.add(t.id)
    else if (scope === "org_sku") out.add(t.id)
  }
  return out
}

/** Decide activations / updates / clears for ONE deal. Idempotent for unchanged inputs. */
export function evaluateDealRisks(input: RiskDealInput): RiskAction[] {
  const actions: RiskAction[] = []
  const active = input.existing.filter((r) => r.status === "active")
  const activeByType = new Map(active.map((r) => [r.riskType, r]))

  if (input.deal.closed) {
    for (const r of active) {
      actions.push({
        kind: "clear",
        riskId: r.id,
        riskType: r.riskType,
        by: "outcome",
        reason: input.deal.closedReason ?? "Сделка закрыта",
        clearInstanceId: null,
        clearItemId: null,
      })
    }
    return actions
  }

  const dealTopicIds = new Set([...input.topics.values()].filter((t) => t.dealId === input.deal.id).map((t) => t.id))
  const lookback = input.now.getTime() - RISK_LOOKBACK_DAYS * DAY_MS

  for (const type of input.types) {
    const existing = activeByType.get(type.code)
    const scope = riskScope(type)
    const topicIds = scopeTopicIds(scope, input)
    const scopeInstances = input.instances.filter((i) => topicIds.has(i.topicId))
    const typeOn = type.enabled && guardAllows(input.guards.get(type.code), input.deal.stageId)
    const lastCleared = input.existing
      .filter((r) => r.riskType === type.code && r.status === "cleared" && r.clearedAt)
      .reduce((m, r) => Math.max(m, r.clearedAt!.getTime()), 0)

    // ── Clearing of an active risk ──
    if (existing) {
      const triggerSet = new Set(existing.triggerInstanceIds)
      const triggers = input.instances.filter((i) => triggerSet.has(i.id))
      const newest = Math.max(existing.detectedAt.getTime() - 1, ...triggers.map((i) => i.itemDate.getTime()))
      const clearHit = scopeInstances
        .filter(
          (i) =>
            type.clearCodes.includes(i.code) &&
            i.confidence !== "low" &&
            i.itemDate.getTime() > newest &&
            // DECISION_MAKER_CHANGE: the clear code counts only from another person.
            (type.condition !== "deal_contact_lost_without_handover" ||
              !triggers.some((t) => t.authorContactId && t.authorContactId === i.authorContactId)),
        )
        .sort((a, b) => a.itemDate.getTime() - b.itemDate.getTime())[0]
      if (clearHit && !clearCodeBlocked(type, existing, input, scopeInstances)) {
        actions.push({
          kind: "clear",
          riskId: existing.id,
          riskType: type.code,
          by: "signal",
          reason: `Сигнал ${clearHit.code}: ${clearHit.evidence.slice(0, 200)}`,
          clearInstanceId: clearHit.id,
          clearItemId: clearHit.itemId,
        })
        continue
      }
      const cond = conditionClear(type, existing, input, dealTopicIds, scopeInstances)
      if (cond) {
        actions.push({
          kind: "clear",
          riskId: existing.id,
          riskType: type.code,
          by: "condition",
          reason: cond.reason,
          clearInstanceId: null,
          clearItemId: cond.itemId,
        })
        continue
      }
    }

    if (!typeOn) continue // guard / disabled: no new activation (an active row stays until cleared)

    const candidates = scopeInstances.filter(
      (i) =>
        type.triggerCodes.includes(i.code) &&
        input.activeCodes.has(i.code) &&
        i.counted &&
        i.confidence !== "low" &&
        !isOurs(i.direction) &&
        i.itemDate.getTime() >= lookback &&
        i.itemDate.getTime() > lastCleared,
    )
    if (candidates.length === 0) continue
    const ev = evaluateCondition(type, candidates, input, scopeInstances, dealTopicIds)
    if (ev.triggers.length === 0 || ev.occurrences < ev.minOccurrences) continue
    const sorted = [...ev.triggers].sort((a, b) => a.itemDate.getTime() - b.itemDate.getTime() || a.id.localeCompare(b.id))
    const newest = sorted[sorted.length - 1]!
    const triggerIds = sorted.map((i) => i.id)
    const itemIds = [...new Set(sorted.map((i) => i.itemId).filter((x): x is string => !!x))]
    if (existing) {
      const same =
        existing.occurrences === ev.occurrences &&
        existing.topicId === newest.topicId &&
        existing.triggerInstanceIds.length === triggerIds.length &&
        triggerIds.every((id) => existing.triggerInstanceIds.includes(id))
      if (!same) {
        actions.push({
          kind: "update",
          riskId: existing.id,
          riskType: type.code,
          occurrences: ev.occurrences,
          topicId: newest.topicId,
          triggerInstanceIds: triggerIds,
          sourceItemIds: itemIds,
        })
      }
      continue
    }
    actions.push({
      kind: "activate",
      riskType: type.code,
      severity: type.severity,
      occurrences: ev.occurrences,
      topicId: newest.topicId,
      triggerInstanceIds: triggerIds,
      sourceItemIds: itemIds,
      evidence: newest.evidence,
      triggerScore: Math.max(0, ...sorted.map((i) => i.scoreContrib)),
    })
  }
  return actions
}

/** «Most critical» order (§9.4): severity × trigger score desc, then the newest. */
export function compareRiskCriticality(
  a: { severity: number; triggerScore: number; detectedAt: Date | string },
  b: { severity: number; triggerScore: number; detectedAt: Date | string },
): number {
  const ka = a.severity * Math.max(1, a.triggerScore)
  const kb = b.severity * Math.max(1, b.triggerScore)
  if (ka !== kb) return kb - ka
  return new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime()
}

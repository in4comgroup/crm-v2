// Deal bridge rules (topics plan phase 5, spec topics/01 §9.2). PURE: no
// DB, no clock, no I/O — the phase (./phase.ts) loads the inputs, calls
// `evaluateTopicDeals` and executes the decisions. Unit-tested in
// ./rules.test.ts.
//
// Input: one topic, its NEW (not yet decided) signal instances, the org's
// stage rules (org rows of `signal_stage_rule`), the org's funnel, the
// linked deal and the client's open deals. Output: one decision per (instance
// × matching rule), in order. Later instances see the effect of earlier ones
// (a deal created by instance 1 can be moved by instance 2).
//
// Fixed rules for every org (spec §9.2, Q26, Q34, v2):
// - `ORDER_*` codes never create or move deals (orders ≠ deals).
// - Low-confidence instances never act.
// - Author-only: an instance from our own outbound / internal item never
//   creates, moves or closes a deal (only `in_stage` context is kept).
// - Moves are forward only (skip allowed); backward / terminal moves only by
//   outcome rules. The pre-pipeline stage («Контакт до запроса», area 0) is
//   never a target: area 0 never creates a deal.
// - `PROSPECT_NEED_EXPRESSED` acts only with the «concrete task» fact.
// - Deal risks (phase 5a) never move stages; a code acts only through its
//   own stage rule.
// - One confidence level below the rule's minimum (medium for a «high»
//   rule) → ask a person (`deal_proposal` / `stage_confirmation`).

import type { StageRuleGuards } from "@/lib/signals/types"

export type Confidence = "low" | "medium" | "high"
const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 }

export type RuleLite = {
  id: string
  code: string
  effect: string
  targetStageId: string | null
  dealTypes: string[]
  guards: StageRuleGuards
  enabled: boolean
  sort: number
  noteRu: string | null
}

export type StageLite = {
  id: string
  sortOrder: number
  isPrePipeline: boolean
  /** won = «Closed», lost = «Rejected», null = working stage. */
  terminal: "won" | "lost" | null
}

export type InstanceLite = {
  id: string
  code: string
  itemId: string | null
  confidence: Confidence
  evidence: string
  /** Direction of the instance's item (null = unknown → treated as inbound). */
  direction: "inbound" | "outbound" | "internal" | null
}

export type DealLite = {
  id: string
  stageId: string
  status: "active" | "paused" | "cancelled" | "deleted"
  dealTypeCode: string | null
}

export type ClientFacts = { isNew: boolean; type: string | null }

export type DealBridgeParamsLite = {
  autoCreateEnabled: boolean
  autoCreateMinScore: number
  autoCreateMinConfidence: Confidence
  proposalMinScore: number
}

export type TopicDealInput = {
  topic: {
    id: string
    score: number
    clientId: string | null
    contactId: string | null
    /** Concrete need: products, references, amounts or deadlines on the topic. */
    hasConcreteTask: boolean
  }
  /** Deal linked to the topic (`topic.deal_id`), null when none. */
  deal: DealLite | null
  /** Open deals (active / paused) of the topic's client. */
  openClientDeals: DealLite[]
  clientFacts: ClientFacts | null
  stages: StageLite[]
  /** Deal type codes that exist for the org. */
  dealTypeCodes: ReadonlySet<string>
  params: DealBridgeParamsLite
  /** Enabled org rules (any order; sorted here by `sort`). */
  rules: RuleLite[]
  /** New instances of the topic, oldest first. */
  instances: InstanceLite[]
  /** Kinds of the topic's open engine cards (one open card per topic and kind). */
  openCardKinds: ReadonlySet<"deal_proposal" | "stage_confirmation">
}

export type DealAction =
  | "create" // auto-create a deal (agent)
  | "link" // link the topic to the client's existing open deal of this type
  | "propose" // `deal_proposal` card
  | "move" // forward move (agent)
  | "confirm" // `stage_confirmation` card
  | "outcome" // won / lost (agent)
  | "pause"
  | "resume"
  | "context" // in_stage: topic_event note only
  | "skip"

/** Effect a `confirm` card asks for (what «Подтвердить» does). */
export type ConfirmEffect = "move" | "outcome_won" | "outcome_lost" | "pause" | "resume"

export type DealDecision = {
  instanceId: string
  code: string
  ruleId: string
  effect: string
  action: DealAction
  /** Machine reason (why this action / why skipped), see DEAL_REASON_LABELS_RU. */
  reason: string
  /** Deal acted on ("__new__" = the deal created earlier in this evaluation). */
  dealId: string | null
  dealTypeCode: string | null
  /** Target stage (create / move / outcome / confirm). */
  stageId: string | null
  fromStageId: string | null
  outcome: "won" | "lost" | null
  confirmEffect: ConfirmEffect | null
  sourceItemId: string | null
  evidence: string
  confidence: Confidence
}

export const NEW_DEAL_ID = "__new__"
export const PROSPECT_NEED_CODE = "PROSPECT_NEED_EXPRESSED"
export const CONCRETE_TASK_FACT = "concrete_task"

/** Russian labels of the decision reasons (debug view, card text). */
export const DEAL_REASON_LABELS_RU: Record<string, string> = {
  auto: "условия автосоздания выполнены",
  auto_off: "автосоздание выключено для организации",
  medium_confidence: "уверенность ниже порога автосоздания",
  score_below_auto: "оценка темы ниже порога автосоздания",
  no_client: "тема без компании (только контакт)",
  client_guard_unknown: "условие правила по клиенту нужно проверить человеку",
  requires_confirmation: "правило требует подтверждения",
  one_level_below: "уверенность на уровень ниже правила",
  below_proposal: "оценка темы ниже порога предложения",
  no_counterparty: "у темы нет ни компании, ни контакта",
  same_signal: "сделка только что создана этим же сигналом",
  existing_deal: "у клиента уже есть открытая сделка этого типа",
  topic_has_deal: "тема уже привязана к сделке",
  proposal_open: "предложение по теме уже открыто",
  confirmation_open: "подтверждение по теме уже открыто",
  order_code: "коды заказов не создают и не двигают сделки",
  low_confidence: "низкая уверенность",
  own_item: "наше собственное сообщение не двигает сделку",
  rule_min_confidence: "уверенность ниже минимума правила",
  rule_min_score: "оценка темы ниже минимума правила",
  requires_fact: "нет факта «конкретная задача»",
  client_guard: "клиент не проходит условие правила",
  no_target_stage: "целевая стадия правила не задана",
  area0: "«Контакт до запроса» (область 0) не создаёт и не двигает сделку",
  deal_type_missing: "тип сделки правила не существует в организации",
  no_deal: "у темы нет сделки",
  deal_paused: "сделка на паузе",
  deal_closed: "сделка закрыта",
  deal_type: "тип сделки не подходит правилу",
  from_stage: "текущая стадия не подходит правилу",
  not_forward: "сделка уже на этой стадии или дальше",
  terminal_target: "финальная стадия ставится только итогом",
  already_active: "сделка не на паузе",
  context: "контекст для сделки (стадия не меняется)",
  move: "перевод вперёд по правилу",
  outcome: "итог сделки по правилу",
  pause: "пауза по правилу",
  resume: "снятие паузы по правилу",
  unknown_effect: "неизвестный эффект правила",
}

const STAGE_EFFECTS = new Set(["create_deal", "move_stage", "outcome_won", "outcome_lost", "pause", "resume"])

/**
 * `guards.clientGuard` is free text in the templates (e.g.
 * «client_type = Розница», «client_is_new only (draft…)»). Known forms are
 * checked; anything else is `unknown` → a person decides (proposal).
 */
export function evalClientGuard(text: string | undefined, facts: ClientFacts | null): "pass" | "fail" | "unknown" {
  const t = (text ?? "").trim()
  if (!t) return "pass"
  if (!facts) return "unknown"
  const low = t.toLowerCase()
  if (low.includes("client_is_new")) return facts.isNew ? "pass" : "fail"
  const m = /client_type\s*=\s*([^;()]+)/i.exec(t)
  if (m) {
    const want = m[1].trim().toLowerCase()
    return facts.type && facts.type.trim().toLowerCase() === want ? "pass" : "fail"
  }
  return "unknown"
}

function requiredFact(rule: RuleLite): string | null {
  if (rule.guards.requiresFact) return rule.guards.requiresFact
  // Area 0 rule (spec §2, Q34): a prospect's need acts only as a concrete task.
  if (rule.code === PROSPECT_NEED_CODE) return CONCRETE_TASK_FACT
  return null
}

function factHolds(fact: string, input: TopicDealInput): boolean {
  const f = fact.toLowerCase()
  if (f.includes("concrete")) return input.topic.hasConcreteTask
  return false // unknown fact → not proven
}

export function evaluateTopicDeals(input: TopicDealInput): DealDecision[] {
  const out: DealDecision[] = []
  const stageById = new Map(input.stages.map((s) => [s.id, s]))
  const terminalStage = (o: "won" | "lost") => input.stages.find((s) => s.terminal === o) ?? null
  const rules = [...input.rules].filter((r) => r.enabled).sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id))
  const byCode = new Map<string, RuleLite[]>()
  for (const r of rules) byCode.set(r.code, [...(byCode.get(r.code) ?? []), r])

  // Mutable state: later instances see the effect of earlier decisions.
  let deal: DealLite | null = input.deal ? { ...input.deal } : null
  // A deal created by an instance is not also moved by the same instance
  // (the create rule already set the entry stage).
  let createdByInstance: string | null = null
  const openCards = new Set(input.openCardKinds)
  const score = input.topic.score
  const p = input.params

  for (const inst of input.instances) {
    for (const rule of byCode.get(inst.code) ?? []) {
      const base = {
        instanceId: inst.id,
        code: inst.code,
        ruleId: rule.id,
        effect: rule.effect,
        dealId: deal?.id ?? null,
        dealTypeCode: null as string | null,
        stageId: null as string | null,
        fromStageId: deal?.stageId ?? null,
        outcome: null as "won" | "lost" | null,
        confirmEffect: null as ConfirmEffect | null,
        sourceItemId: inst.itemId,
        evidence: inst.evidence,
        confidence: inst.confidence,
      }
      const emit = (action: DealAction, reason: string, extra: Partial<DealDecision> = {}) =>
        out.push({ ...base, action, reason, ...extra })
      const skip = (reason: string) => emit("skip", reason)

      if (/^ORDER_/.test(inst.code)) {
        skip("order_code")
        continue
      }
      if (inst.confidence === "low") {
        skip("low_confidence")
        continue
      }
      const own = inst.direction === "outbound" || inst.direction === "internal"
      if (own && STAGE_EFFECTS.has(rule.effect)) {
        skip("own_item")
        continue
      }
      // Rule minimum confidence: one level below → ask a person.
      const ruleMin: Confidence = rule.guards.minConfidence ?? "medium"
      let ask = false
      if (RANK[inst.confidence] < RANK[ruleMin]) {
        if (STAGE_EFFECTS.has(rule.effect) && RANK[ruleMin] - RANK[inst.confidence] === 1) ask = true
        else {
          skip("rule_min_confidence")
          continue
        }
      }
      if (typeof rule.guards.minScore === "number" && score < rule.guards.minScore) {
        skip("rule_min_score")
        continue
      }
      const fact = requiredFact(rule)
      if (fact && !factHolds(fact, input)) {
        skip("requires_fact")
        continue
      }
      const needsConfirm = rule.guards.requiresConfirmation === true

      // Guards on the current deal (move / outcome / pause / in_stage).
      const dealGuards = (): string | null => {
        if (!deal) return "no_deal"
        if (createdByInstance === inst.id && rule.effect !== "in_stage") return "same_signal"
        if (rule.dealTypes.length > 0 && (!deal.dealTypeCode || !rule.dealTypes.includes(deal.dealTypeCode))) {
          return "deal_type"
        }
        const from = rule.guards.fromStageIds ?? []
        if (from.length > 0 && !from.includes(deal.stageId)) return "from_stage"
        return null
      }

      switch (rule.effect) {
        case "create_deal": {
          if (deal) {
            skip("topic_has_deal")
            continue
          }
          const target = rule.targetStageId ? stageById.get(rule.targetStageId) : undefined
          if (!target) {
            skip("no_target_stage")
            continue
          }
          if (target.isPrePipeline) {
            skip("area0")
            continue
          }
          if (target.terminal) {
            skip("terminal_target")
            continue
          }
          const typeCode = rule.dealTypes[0] ?? null
          if (typeCode && !input.dealTypeCodes.has(typeCode)) {
            skip("deal_type_missing")
            continue
          }
          const extra = { dealTypeCode: typeCode, stageId: target.id, dealId: null, fromStageId: null }
          // Dedupe (spec §9.2): org + client + type + status active / paused.
          if (input.topic.clientId) {
            const existing = input.openClientDeals.find((d) => (d.dealTypeCode ?? null) === typeCode)
            if (existing) {
              deal = { ...existing }
              emit("link", "existing_deal", { ...extra, dealId: existing.id, stageId: existing.stageId })
              continue
            }
          }
          const guard = input.topic.clientId ? evalClientGuard(rule.guards.clientGuard, input.clientFacts) : "unknown"
          if (guard === "fail") {
            skip("client_guard")
            continue
          }
          const autoBlock = !p.autoCreateEnabled
            ? "auto_off"
            : needsConfirm
              ? "requires_confirmation"
              : ask
                ? "one_level_below"
                : RANK[inst.confidence] < RANK[p.autoCreateMinConfidence]
                  ? "medium_confidence"
                  : score < p.autoCreateMinScore
                    ? "score_below_auto"
                    : !input.topic.clientId
                      ? "no_client"
                      : guard === "unknown"
                        ? "client_guard_unknown"
                        : null
          if (!autoBlock) {
            deal = { id: NEW_DEAL_ID, stageId: target.id, status: "active", dealTypeCode: typeCode }
            createdByInstance = inst.id
            emit("create", "auto", extra)
            continue
          }
          if (score < p.proposalMinScore) {
            skip("below_proposal")
            continue
          }
          if (!input.topic.clientId && !input.topic.contactId) {
            skip("no_counterparty")
            continue
          }
          if (openCards.has("deal_proposal")) {
            skip("proposal_open")
            continue
          }
          openCards.add("deal_proposal")
          emit("propose", autoBlock, extra)
          continue
        }

        case "move_stage": {
          const g = dealGuards()
          if (g) {
            skip(g)
            continue
          }
          const d = deal!
          if (d.status === "paused") {
            skip("deal_paused")
            continue
          }
          if (d.status !== "active") {
            skip("deal_closed")
            continue
          }
          const cur = stageById.get(d.stageId)
          if (cur?.terminal) {
            skip("deal_closed")
            continue
          }
          const target = rule.targetStageId ? stageById.get(rule.targetStageId) : undefined
          if (!target) {
            skip("no_target_stage")
            continue
          }
          if (target.isPrePipeline) {
            skip("area0")
            continue
          }
          if (target.terminal) {
            skip("terminal_target")
            continue
          }
          // Forward only, always (spec §9.2: backward only by outcome codes).
          if (cur && target.sortOrder <= cur.sortOrder) {
            skip("not_forward")
            continue
          }
          const extra = { dealId: d.id, stageId: target.id, fromStageId: d.stageId, dealTypeCode: d.dealTypeCode }
          if (needsConfirm || ask) {
            if (openCards.has("stage_confirmation")) {
              skip("confirmation_open")
              continue
            }
            openCards.add("stage_confirmation")
            emit("confirm", needsConfirm ? "requires_confirmation" : "one_level_below", { ...extra, confirmEffect: "move" })
            continue
          }
          deal = { ...d, stageId: target.id }
          emit("move", "move", extra)
          continue
        }

        case "outcome_won":
        case "outcome_lost": {
          const outcome: "won" | "lost" = rule.effect === "outcome_won" ? "won" : "lost"
          const g = dealGuards()
          if (g) {
            skip(g)
            continue
          }
          const d = deal!
          if (d.status !== "active" && d.status !== "paused") {
            skip("deal_closed")
            continue
          }
          if (stageById.get(d.stageId)?.terminal) {
            skip("deal_closed")
            continue
          }
          const target = (rule.targetStageId ? stageById.get(rule.targetStageId) : undefined) ?? terminalStage(outcome)
          if (!target) {
            skip("no_target_stage")
            continue
          }
          const extra = { dealId: d.id, stageId: target.id, fromStageId: d.stageId, outcome, dealTypeCode: d.dealTypeCode }
          if (needsConfirm || ask) {
            if (openCards.has("stage_confirmation")) {
              skip("confirmation_open")
              continue
            }
            openCards.add("stage_confirmation")
            emit("confirm", needsConfirm ? "requires_confirmation" : "one_level_below", {
              ...extra,
              confirmEffect: rule.effect as ConfirmEffect,
            })
            continue
          }
          deal = { ...d, stageId: target.id, status: "active" }
          emit("outcome", "outcome", extra)
          continue
        }

        case "pause":
        case "resume": {
          const g = dealGuards()
          if (g) {
            skip(g)
            continue
          }
          const d = deal!
          if (rule.effect === "pause" ? d.status !== "active" : d.status !== "paused") {
            skip(rule.effect === "pause" ? (d.status === "paused" ? "deal_paused" : "deal_closed") : "already_active")
            continue
          }
          const extra = { dealId: d.id, stageId: d.stageId, fromStageId: d.stageId, dealTypeCode: d.dealTypeCode }
          if (needsConfirm || ask) {
            if (openCards.has("stage_confirmation")) {
              skip("confirmation_open")
              continue
            }
            openCards.add("stage_confirmation")
            emit("confirm", needsConfirm ? "requires_confirmation" : "one_level_below", {
              ...extra,
              confirmEffect: rule.effect as ConfirmEffect,
            })
            continue
          }
          deal = { ...d, status: rule.effect === "pause" ? "paused" : "active" }
          emit(rule.effect, rule.effect, extra)
          continue
        }

        case "in_stage": {
          const g = dealGuards()
          if (g) {
            skip(g)
            continue
          }
          emit("context", "context", { dealId: deal!.id, stageId: deal!.stageId, dealTypeCode: deal!.dealTypeCode })
          continue
        }

        default:
          skip("unknown_effect")
      }
    }
  }
  return out
}

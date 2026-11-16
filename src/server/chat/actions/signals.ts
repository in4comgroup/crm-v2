import "server-only"

import { stageDisplayLabel } from "@/lib/deal-funnel"
import { listOpenClientDeals, loadClientGuardFacts } from "@/server/deal-engine"
import { SignalsNotEnabledError } from "@/server/topics/prompt/extraction"
import { runExtraction } from "@/server/topics/prompt/run-extraction"
import { loadOrgDealContext } from "@/server/topics/deals/phase"
import { evaluateTopicDeals, type DealDecision, type DealLite, type InstanceLite } from "@/server/topics/deals/rules"
import { loadSignalBatchContext } from "@/server/topics/signals/extract-item"
import { postprocessExtraction } from "@/server/topics/signals/postprocess"
import { loadCodeBook } from "@/server/topics/topic-store"

// Signals in the chat turn (docs/specs/ai-chat-tools §11, Q6): the org's
// signal extractor reads the user's message + files as a relayed note (the
// CH6 envelope), and the PURE deal-rule evaluator of the deal bridge says
// what the org's funnel rules would do. Nothing is stored — the topics
// engine still gets the chat later through the CH6 ingest. One extraction
// call (process `topics.signal_extraction`).

export type TurnSignalSuggestion = {
  action: "create" | "link" | "move" | "outcome"
  dealTypeId: string | null
  dealTypeName: string
  stageId: string | null
  stageName: string
  dealId: string | null
  /** «по правилу воронки: Запрос КП → «Подготовка предложения»». */
  ruleNote: string
  code: string
}

export type TurnSignals = {
  codes: { code: string; label: string; evidence: string; counted: boolean; confidence: string }[]
  amounts: string[]
  deadlines: string[]
  score: number
  suggestion: TurnSignalSuggestion | null
  /** Why there is no suggestion (no rules, no deal signal, …). */
  note: string | null
}

const SUGGEST: Partial<Record<DealDecision["action"], TurnSignalSuggestion["action"]>> = {
  create: "create",
  propose: "create",
  link: "link",
  move: "move",
  confirm: "move",
  outcome: "outcome",
}

export async function readTurnSignals(args: {
  orgId: string
  userId: string
  userName: string
  text: string
  clientId: string | null
  now: Date
}): Promise<TurnSignals | { error: string }> {
  let batch
  try {
    batch = await loadSignalBatchContext(args.orgId)
  } catch (e) {
    if (e instanceof SignalsNotEnabledError) return { error: "Сигналы для организации не включены — продолжай без них." }
    throw e
  }
  const run = await runExtraction({
    orgId: args.orgId,
    text: args.text,
    envelope: {
      provider: "aichat",
      kind: "chat_note",
      date: args.now.toISOString(),
      orgName: batch.orgName,
      relayedNote: true,
      forwardedBy: args.userName,
      originalAuthor: "не указан",
    },
    promptSet: batch.promptSet,
    successors: batch.scoring.successors,
    ref: { chatTurn: true },
    // The user waits for this answer: not stopped by the daily budget of background AI.
    interactive: true,
  })
  const empty: TurnSignals = { codes: [], amounts: [], deadlines: [], score: 0, suggestion: null, note: "Сигналов нет." }
  if (!run.output) return empty
  const pp = postprocessExtraction(run.output, batch.scoring, {
    text: args.text,
    ownText: args.text,
    date: args.now,
    // A relayed note: the direction comes from the model (like a forward).
    orgAttribution: "unknown",
    allInternal: false,
  })
  const book = await loadCodeBook(args.orgId)
  const out: TurnSignals = {
    codes: pp.instances.map((i) => ({
      code: i.code,
      label: book.get(i.code)?.labelRu ?? i.code,
      evidence: i.evidence,
      counted: i.counted,
      confidence: i.confidence,
    })),
    amounts: pp.facts.amounts.map((a) => a.evidence || `${a.value} ${a.currency}`).slice(0, 5),
    deadlines: pp.facts.deadlines.map((d) => `${d.what ? `${d.what}: ` : ""}${d.date}${d.evidence ? ` («${d.evidence}»)` : ""}`).slice(0, 5),
    score: pp.score,
    suggestion: null,
    note: null,
  }
  if (!out.codes.length) {
    return { ...out, note: "Сигналов нет — это нормально для прямой просьбы. Если пользователь просил сделку, подготовь её сейчас (draftDeal) с тем, что есть; стадия и название — по умолчанию." }
  }

  // The org's funnel rules (the person confirms → no auto-create threshold, no go / no-go gate).
  const octx = await loadOrgDealContext(args.orgId, args.userId, true)
  if (!octx) return { ...out, note: "В организации нет правил воронки — стадию и тип выбирай по умолчанию." }
  const [open, facts] = args.clientId
    ? await Promise.all([listOpenClientDeals(args.orgId, args.clientId), loadClientGuardFacts(args.orgId, args.clientId)])
    : [[], null]
  const instances: InstanceLite[] = pp.instances
    .filter((i) => i.confidence !== "low")
    .map((i, n) => ({ id: `i${n}`, code: i.code, itemId: null, confidence: i.confidence, evidence: i.evidence, direction: pp.direction }))
  const decisions = evaluateTopicDeals({
    topic: {
      id: "chat-turn",
      score: pp.score,
      // A placeholder client lets «create» rules act for a company that is new in this answer.
      clientId: args.clientId ?? "__chat_new_client__",
      contactId: null,
      hasConcreteTask: pp.facts.amounts.length > 0 || pp.facts.deadlines.length > 0,
    },
    deal: null,
    openClientDeals: open.map((d) => ({ id: d.id, stageId: d.funnelStageId, status: d.status as DealLite["status"], dealTypeCode: d.dealTypeCode })),
    clientFacts: facts,
    stages: octx.stageLites,
    dealTypeCodes: new Set(octx.typeByCode.keys()),
    params: { ...octx.params, autoCreateEnabled: true, autoCreateMinScore: 0, proposalMinScore: 0, entryGate: "none" },
    rules: octx.rules,
    instances,
    openCardKinds: new Set(),
  })
  const d = decisions.find((x) => SUGGEST[x.action])
  if (!d) return { ...out, note: "Правила воронки для этих сигналов ничего не предлагают." }
  const stage = d.stageId ? octx.stages.find((s) => s.id === d.stageId) : undefined
  const type = d.dealTypeCode ? octx.typeByCode.get(d.dealTypeCode) : undefined
  const rule = octx.rules.find((r) => r.id === d.ruleId)
  const stageName = stage ? stageDisplayLabel(stage.name, stage.displayName) : ""
  const codeLabel = book.get(d.code)?.labelRu ?? d.code
  out.suggestion = {
    action: SUGGEST[d.action]!,
    dealTypeId: type?.id ?? null,
    dealTypeName: type?.labelRu ?? "",
    stageId: stage?.id ?? null,
    stageName,
    dealId: d.dealId && d.dealId !== "__new__" ? d.dealId : null,
    ruleNote: `по правилу воронки: ${codeLabel}${stageName ? ` → «${stageName}»` : ""}${rule?.noteRu ? ` (${rule.noteRu})` : ""}`,
    code: d.code,
  }
  return out
}

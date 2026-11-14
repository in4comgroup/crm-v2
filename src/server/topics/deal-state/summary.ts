import "server-only"

import { randomUUID } from "node:crypto"
import { Output } from "ai"
import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import {
  aiUsageEvent,
  client,
  deal,
  dealFunnelStage,
  dealRisk,
  dealStateVersion,
  dealType,
  signalInstance,
  sourceItem,
  topic,
  topicEvent,
  topicItem,
} from "@/db/schema"
import { stageDisplayLabel } from "@/lib/deal-funnel"
import type { SignalItemFacts } from "@/lib/signals/extraction-types"
import type { DealStateDecision } from "@/lib/topics/deal-state"
import { TOPIC_STATUS_LABELS_RU, TOPIC_SUB_STATE_LABELS_RU, isTopicStatus, type TopicSubState } from "@/lib/topics/types"
import { aiCallInfo, aiGenerateText } from "@/server/ai/runtime"
import { getOrgFunnel, outcomeStage } from "@/server/deal-engine"
import { messageContent } from "@/server/topics/signals/evidence"
import { itemMarkdown } from "@/server/topics/signals/item-input"
import { loadCodeBook } from "@/server/topics/topic-store"
import { clearRisk, loadRiskTypes } from "./risk-store"
import {
  buildDealStatePrompt,
  checkClearProposals,
  checkRiskExplanations,
  DEAL_STATE_PROCESS,
  DEAL_STATE_SYSTEM,
  dealStateSchema,
  decideStateOutput,
  fixedStateText,
  STATE_MAX_ITEMS,
  type DealStateInput,
  type DealStateOutput,
} from "./state-text"

// «Текущее состояние» runner (spec topics/01 §9.3, plan phase 5a): one deal →
// fixed text (no topic / won / lost / withdrawn, no LLM) or ONE
// `deals.state_summary` call (`ref: { dealId }`) → server checks → stored
// text + one `deal_state_version` row per run (UPDATE / NOOP / FIXED /
// REJECTED). A rejected text keeps the old one. The same run explains the
// active risks (R17) and may propose clearing one (accepted only with a cited
// input item, §9.4). `state_updated_at` = the run START, so new information
// that arrives during the run keeps the deal dirty.

export type DealStateModel = (args: {
  orgId: string
  dealId: string
  input: DealStateInput
}) => Promise<{ output: DealStateOutput; model: string | null; usageEventId: string | null }>

const ITEM_EXCERPT_CHARS = 1200
const EVENT_LABELS_RU: Record<string, string> = {
  created: "Тема создана",
  item_attached: "Добавлено сообщение",
  item_detached: "Сообщение отвязано",
  reopened: "Тема открыта снова",
  resolved: "Тема решена",
  dormant: "Тема затихла",
  expired: "Тема истекла",
  done: "Отмечено «Готово»",
  dismissed: "Отмечено «Не относится»",
  merged_from: "Объединена с другой темой",
  deal_context: "Событие по сделке",
  deal_risk: "Риск по сделке",
}
const SKIP_EVENTS = ["attention_changed", "deal_decision", "relinked"]

/** Production model: one `deals.state_summary` call. */
export function createLlmDealStateModel(): DealStateModel {
  return async ({ orgId, dealId, input }) => {
    const result = await aiGenerateText({
      process: DEAL_STATE_PROCESS,
      orgId,
      userId: null,
      ref: { dealId },
      output: Output.object({ schema: dealStateSchema }),
      system: DEAL_STATE_SYSTEM,
      prompt: buildDealStatePrompt(input),
      temperature: 0.2,
    })
    const info = aiCallInfo(result)
    let usageEventId: string | null = null
    if (info?.responseId) {
      const [ev] = await db
        .select({ id: aiUsageEvent.id })
        .from(aiUsageEvent)
        .where(and(eq(aiUsageEvent.responseId, info.responseId), eq(aiUsageEvent.processKey, DEAL_STATE_PROCESS)))
        .orderBy(desc(aiUsageEvent.createdAt))
        .limit(1)
      usageEventId = ev?.id ?? null
    }
    return { output: result.output, model: info?.responseModel ?? null, usageEventId }
  }
}

function itemText(meta: unknown, markdown: string | null): string {
  const m = (meta ?? {}) as Record<string, unknown>
  for (const k of ["rawText", "text"]) {
    const v = m[k]
    if (typeof v === "string" && v.trim()) return v.trim()
  }
  return markdown ? messageContent(markdown) : ""
}

function fromOf(meta: unknown): string | null {
  const m = (meta ?? {}) as Record<string, unknown>
  const f = Array.isArray(m.from) ? (m.from[0] as { name?: string; email?: string } | undefined) : undefined
  if (f) return f.name || f.email || null
  const tg = (m.telegram as { from?: { firstName?: string; lastName?: string } } | undefined)?.from
  if (tg) return [tg.firstName, tg.lastName].filter(Boolean).join(" ") || null
  return null
}

const DIRECTION_RU: Record<string, string> = { inbound: "от клиента", outbound: "от нас", internal: "внутреннее" }
const STATUS_RU: Record<string, string> = { active: "активна", paused: "на паузе", cancelled: "закрыта", deleted: "удалена" }
const isoDay = (d: Date) => d.toISOString().slice(0, 10)

export type LoadedDealState = {
  deal: {
    id: string
    status: string
    stageLabel: string
    stateText: string | null
    outcome: "won" | "lost" | "withdrawn" | null
    outcomeReason: string | null
  }
  topicIds: string[]
  input: DealStateInput
  riskIds: string[]
}

/** Input of one run (null for a deleted deal / a deal of another org). */
export async function loadDealStateInput(orgId: string, dealId: string, now: Date = new Date()): Promise<LoadedDealState | null> {
  const [d] = await db
    .select({
      id: deal.id,
      name: deal.name,
      status: deal.status,
      stageId: deal.funnelStageId,
      stageName: dealFunnelStage.name,
      stageDisplayName: dealFunnelStage.displayName,
      clientName: client.name,
      typeLabel: dealType.labelRu,
      value: deal.value,
      currency: deal.currency,
      pausedUntil: deal.pausedUntil,
      outcomeReason: deal.outcomeReason,
      stateText: deal.stateText,
    })
    .from(deal)
    .leftJoin(dealFunnelStage, eq(dealFunnelStage.id, deal.funnelStageId))
    .leftJoin(client, eq(client.id, deal.clientId))
    .leftJoin(dealType, eq(dealType.id, deal.dealTypeId))
    .where(and(eq(deal.organizationId, orgId), eq(deal.id, dealId)))
  if (!d || d.status === "deleted") return null
  const stages = await getOrgFunnel(orgId)
  const outcome: LoadedDealState["deal"]["outcome"] =
    d.stageId === outcomeStage(stages, "won")?.id
      ? "won"
      : d.stageId === outcomeStage(stages, "lost")?.id
        ? "lost"
        : d.status === "cancelled"
          ? "withdrawn"
          : null
  const stageLabel = d.stageName ? stageDisplayLabel(d.stageName, d.stageDisplayName) : "—"

  const topics = await db
    .select()
    .from(topic)
    .where(and(eq(topic.organizationId, orgId), eq(topic.dealId, dealId), notInArray(topic.status, ["merged"])))
    .orderBy(desc(topic.lastActivityAt))
  const topicIds = topics.map((t) => t.id)
  const [book, links, events, risks, types] = await Promise.all([
    loadCodeBook(orgId),
    topicIds.length
      ? db
          .select({
            topicId: topicItem.topicId,
            itemId: topicItem.sourceItemId,
            date: sql<Date>`coalesce(${sourceItem.sourceCreatedAt}, ${sourceItem.createdAt})`.mapWith(sourceItem.createdAt),
            signalFacts: sourceItem.signalFacts,
          })
          .from(topicItem)
          .innerJoin(sourceItem, eq(sourceItem.id, topicItem.sourceItemId))
          .where(and(eq(topicItem.organizationId, orgId), inArray(topicItem.topicId, topicIds)))
      : Promise.resolve([]),
    topicIds.length
      ? db
          .select({ topicId: topicEvent.topicId, type: topicEvent.type, payload: topicEvent.payload, createdAt: topicEvent.createdAt })
          .from(topicEvent)
          .where(
            and(
              eq(topicEvent.organizationId, orgId),
              inArray(topicEvent.topicId, topicIds),
              notInArray(topicEvent.type, SKIP_EVENTS),
            ),
          )
          .orderBy(desc(topicEvent.createdAt))
          .limit(60)
      : Promise.resolve([]),
    db
      .select()
      .from(dealRisk)
      .where(and(eq(dealRisk.organizationId, orgId), eq(dealRisk.dealId, dealId), eq(dealRisk.status, "active")))
      .orderBy(asc(dealRisk.detectedAt)),
    loadRiskTypes(),
  ])

  // Topic facts from the items.
  const factsByTopic = new Map<string, { amounts: string[]; deadlines: string[] }>()
  for (const l of links) {
    const f = (l.signalFacts ?? null) as Partial<SignalItemFacts> | null
    const acc = factsByTopic.get(l.topicId) ?? { amounts: [], deadlines: [] }
    for (const a of f?.facts?.amounts ?? []) acc.amounts.push(`${a.value} ${a.currency || ""}`.trim())
    for (const dl of f?.facts?.deadlines ?? []) {
      acc.deadlines.push(`${dl.date} — ${dl.what || "срок"} (${dl.owner === "us" ? "за нами" : dl.owner === "them" ? "за клиентом" : "кто — неясно"})`)
    }
    if (f?.facts?.proposedMeetingDate) acc.deadlines.push(`${f.facts.proposedMeetingDate} — предложена встреча`)
    factsByTopic.set(l.topicId, acc)
  }

  // Last ≤ 8 items of the deal's topics (any role).
  const latest = new Map<string, { itemId: string; topicId: string; date: Date }>()
  for (const l of links) {
    const prev = latest.get(l.itemId)
    if (!prev || prev.date < l.date) latest.set(l.itemId, { itemId: l.itemId, topicId: l.topicId, date: l.date })
  }
  const recent = [...latest.values()].sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, STATE_MAX_ITEMS)
  const itemRows = recent.length
    ? await db
        .select({
          id: sourceItem.id,
          metadataJson: sourceItem.metadataJson,
          parsedMarkdown: sourceItem.parsedMarkdown,
          markdownR2Key: sourceItem.markdownR2Key,
          signalFacts: sourceItem.signalFacts,
        })
        .from(sourceItem)
        .where(and(eq(sourceItem.organizationId, orgId), inArray(sourceItem.id, recent.map((r) => r.itemId))))
    : []
  const rowById = new Map(itemRows.map((r) => [r.id, r]))
  const titleOf = new Map(topics.map((t) => [t.id, t.title]))
  const items = (
    await Promise.all(
      recent.map(async (r) => {
        const row = rowById.get(r.itemId)
        if (!row) return null
        const text = itemText(row.metadataJson, await itemMarkdown(row))
        const m = (row.metadataJson ?? {}) as Record<string, unknown>
        const dir = ((row.signalFacts ?? {}) as { direction?: string }).direction ?? ""
        return {
          id: r.itemId,
          date: r.date.toISOString().slice(0, 16).replace("T", " "),
          directionRu: DIRECTION_RU[dir] ?? "направление неизвестно",
          topicTitle: titleOf.get(r.topicId) ?? "",
          from: fromOf(row.metadataJson),
          subject: typeof m.subject === "string" ? m.subject : null,
          excerpt: text.length > ITEM_EXCERPT_CHARS ? `${text.slice(0, ITEM_EXCERPT_CHARS)}…` : text || "(текста нет)",
          sortDate: r.date,
        }
      }),
    )
  )
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => a.sortDate.getTime() - b.sortDate.getTime())
    .map((x) => ({
      id: x.id,
      date: x.date,
      directionRu: x.directionRu,
      topicTitle: x.topicTitle,
      from: x.from,
      subject: x.subject,
      excerpt: x.excerpt,
    }))

  // Risk evidence quotes.
  const trigIds = [...new Set(risks.flatMap((r) => r.triggerInstanceIds))]
  const trig = trigIds.length
    ? await db
        .select({ id: signalInstance.id, evidence: signalInstance.evidence })
        .from(signalInstance)
        .where(and(eq(signalInstance.organizationId, orgId), inArray(signalInstance.id, trigIds)))
    : []
  const evidenceById = new Map(trig.map((t) => [t.id, t.evidence]))
  const typeBy = new Map(types.map((t) => [t.code, t]))

  const input: DealStateInput = {
    dealId,
    dealName: d.name,
    clientName: d.clientName ?? "—",
    stageName: stageLabel,
    statusRu: STATUS_RU[d.status] ?? d.status,
    dealTypeLabel: d.typeLabel ?? null,
    amount: d.value ? `${Number(d.value).toLocaleString("ru-RU")} ${d.currency}` : null,
    pausedUntil: d.pausedUntil ? isoDay(d.pausedUntil) : null,
    topics: topics.map((t) => {
      const facts = factsByTopic.get(t.id) ?? { amounts: [], deadlines: [] }
      const st = isTopicStatus(t.status) ? t.status : "open"
      return {
        id: t.id,
        title: t.title,
        statusRu: TOPIC_STATUS_LABELS_RU[st],
        waitingRu:
          t.subState === "waiting_on_us"
            ? "ждут нас"
            : t.subState === "waiting_on_them"
              ? "ждём клиента"
              : `ожидание: ${TOPIC_SUB_STATE_LABELS_RU[(t.subState as TopicSubState) ?? "none"] ?? "—"}`,
        leadCodeLabel: t.leadCode ? (book.get(t.leadCode)?.labelRu ?? t.leadCode) : null,
        references: ((t.references ?? []) as { kind: string; value: string }[]).map((r) => `${r.kind} ${r.value}`),
        products: t.products ?? [],
        amounts: [...new Set(facts.amounts)].slice(0, 6),
        deadlines: [...new Set(facts.deadlines)].slice(0, 6),
        lastEvents: events
          .filter((e) => e.topicId === t.id)
          .slice(0, 3)
          .map((e) => {
            const label = EVENT_LABELS_RU[e.type] ?? e.type
            const p = e.payload as Record<string, unknown>
            const extra = typeof p.labelRu === "string" ? `: ${p.labelRu}` : ""
            return `${isoDay(e.createdAt)} ${label}${extra}`
          }),
      }
    }),
    items,
    risks: risks.map((r) => {
      const t = typeBy.get(r.riskType)
      return {
        id: r.id,
        labelRu: t?.labelRu ?? r.riskType,
        descriptionRu: t?.descriptionRu ?? "",
        severity: r.severity,
        evidence: r.triggerInstanceIds.map((id) => evidenceById.get(id)).filter((x): x is string => !!x).slice(0, 4),
        sourceItemIds: r.sourceItemIds,
      }
    }),
    previousText: d.stateText,
    today: isoDay(now),
  }
  return {
    deal: { id: d.id, status: d.status, stageLabel, stateText: d.stateText, outcome, outcomeReason: d.outcomeReason },
    topicIds,
    input,
    riskIds: risks.map((r) => r.id),
  }
}

export type DealStateRunResult = {
  dealId: string
  decision: DealStateDecision | "SKIPPED"
  text: string | null
  reasons?: string[]
  versionId: string | null
  aiCalled: boolean
  explanations: number
  clearedRiskIds: string[]
}

/**
 * Run the state summary for ONE deal now (phase, «Обновить», admin). Throws
 * AiBudgetExceededError (the phase stops the org; the deal stays dirty).
 */
export async function runDealStateForDeal(
  orgId: string,
  dealId: string,
  opts: { model?: DealStateModel; now?: Date; actorUserId?: string | null } = {},
): Promise<DealStateRunResult> {
  const startedAt = opts.now ?? new Date()
  const loaded = await loadDealStateInput(orgId, dealId, startedAt)
  if (!loaded) {
    return { dealId, decision: "SKIPPED", text: null, versionId: null, aiCalled: false, explanations: 0, clearedRiskIds: [] }
  }
  const { input, topicIds } = loaded
  const keepUpdated = sql`${deal.updatedAt}`
  const writeVersion = async (
    v: {
      decision: DealStateDecision
      text: string | null
      reason: string | null
      sourceItemIds: string[]
      model?: string | null
      usageEventId?: string | null
    },
    dealSet: Record<string, unknown>,
  ) => {
    const id = randomUUID()
    await db.batch([
      db.insert(dealStateVersion).values({
        id,
        organizationId: orgId,
        dealId,
        decision: v.decision,
        text: v.text,
        reason: v.reason,
        sourceItemIds: v.sourceItemIds,
        topicIds,
        actor: "agent",
        actorUserId: opts.actorUserId ?? null,
        model: v.model ?? null,
        aiUsageEventId: v.usageEventId ?? null,
      }),
      db
        .update(deal)
        .set({ ...dealSet, stateUpdatedAt: startedAt, updatedAt: keepUpdated })
        .where(and(eq(deal.organizationId, orgId), eq(deal.id, dealId))),
    ])
    return id
  }

  // ── Fixed texts (no LLM) ──
  const fixed = fixedStateText({
    outcome: loaded.deal.outcome,
    outcomeReason: loaded.deal.outcomeReason,
    hasTopics: topicIds.length > 0,
  })
  if (fixed) {
    const versionId = await writeVersion(
      {
        decision: "FIXED",
        text: fixed,
        reason: loaded.deal.outcome ? `Итог сделки: ${loaded.deal.outcome}` : "Нет связанных тем",
        sourceItemIds: [],
      },
      { stateText: fixed, stateSourceItemIds: [] },
    )
    return { dealId, decision: "FIXED", text: fixed, versionId, aiCalled: false, explanations: 0, clearedRiskIds: [] }
  }

  // ── Model ──
  const model = opts.model ?? createLlmDealStateModel()
  const { output, model: modelId, usageEventId } = await model({ orgId, dealId, input })
  const itemIds = new Set(input.items.map((i) => i.id))
  const decision = decideStateOutput(output, {
    previousText: input.previousText,
    stageName: loaded.deal.stageLabel,
    itemIds,
  })

  // Risk explanations (R17) + clear proposals (§9.4).
  const riskIds = new Set(loaded.riskIds)
  const { accepted } = checkRiskExplanations(output.riskExplanations, { riskIds, itemIds })
  const proposals = checkClearProposals(output.riskClearProposals, { riskIds, itemIds })
  if (accepted.length) {
    await db.batch(
      accepted.map((x) =>
        db
          .update(dealRisk)
          .set({ explanationRu: x.text, explanationSourceItemIds: x.sourceItemIds })
          .where(and(eq(dealRisk.organizationId, orgId), eq(dealRisk.id, x.riskId), eq(dealRisk.status, "active"))),
      ) as unknown as Parameters<typeof db.batch>[0],
    )
  }
  const clearedRiskIds: string[] = []
  for (const p of proposals) {
    try {
      const ok = await clearRisk(orgId, dealId, p.riskId, {
        by: "state_summary",
        reason: p.reason,
        actor: { kind: "agent", userId: opts.actorUserId ?? null },
        userId: null,
        sourceItemId: p.sourceItemId,
      })
      if (ok) clearedRiskIds.push(p.riskId)
    } catch (e) {
      console.error(`[topics:dealState] clear proposal ${p.riskId}:`, e)
    }
  }

  let versionId: string
  if (decision.decision === "UPDATE") {
    versionId = await writeVersion(
      { decision: "UPDATE", text: decision.text, reason: null, sourceItemIds: decision.sourceItemIds, model: modelId, usageEventId },
      { stateText: decision.text, stateSourceItemIds: decision.sourceItemIds },
    )
    return { dealId, decision: "UPDATE", text: decision.text, versionId, aiCalled: true, explanations: accepted.length, clearedRiskIds }
  }
  if (decision.decision === "NOOP") {
    versionId = await writeVersion(
      { decision: "NOOP", text: null, reason: "Ситуация не изменилась", sourceItemIds: [], model: modelId, usageEventId },
      {},
    )
    return { dealId, decision: "NOOP", text: input.previousText, versionId, aiCalled: true, explanations: accepted.length, clearedRiskIds }
  }
  versionId = await writeVersion(
    {
      decision: "REJECTED",
      text: decision.text,
      reason: decision.reasons.join("; "),
      sourceItemIds: output.sourceItemIds.slice(0, 20),
      model: modelId,
      usageEventId,
    },
    {},
  )
  return {
    dealId,
    decision: "REJECTED",
    text: input.previousText,
    reasons: decision.reasons,
    versionId,
    aiCalled: true,
    explanations: accepted.length,
    clearedRiskIds,
  }
}

/**
 * Dirty deals due for a run (R16): `state_dirty_at` older than the debounce
 * and newer than `state_updated_at` (or never run), not deleted. Oldest
 * change first.
 */
export async function selectDueStateDeals(
  orgId: string,
  now: Date,
  debounceMinutes: number,
  limit: number,
): Promise<string[]> {
  const cutoff = new Date(now.getTime() - debounceMinutes * 60_000)
  const rows = await db
    .select({ id: deal.id })
    .from(deal)
    .where(
      and(
        eq(deal.organizationId, orgId),
        notInArray(deal.status, ["deleted"]),
        sql`${deal.stateDirtyAt} is not null`,
        sql`${deal.stateDirtyAt} <= ${cutoff}`,
        sql`(${deal.stateUpdatedAt} is null or ${deal.stateDirtyAt} > ${deal.stateUpdatedAt})`,
      ),
    )
    .orderBy(asc(deal.stateDirtyAt))
    .limit(limit)
  return rows.map((r) => r.id)
}

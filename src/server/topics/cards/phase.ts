import "server-only"

import { AiBudgetExceededError, getOrgBudgetStatus } from "@/server/ai/budget"
import type { TopicAttention } from "@/lib/topics/attention-types"
import type { TopicCardMeta } from "@/lib/topics/cards"
import type { TopicsPhaseContext, TopicsPhaseResult } from "@/server/topics/phases"
import { loadCodeBook } from "@/server/topics/topic-store"
import type { CodeBook } from "@/server/topics/model"
import { cardPlacement, cycleKey, resolveCardAction } from "./logic"
import {
  attentionOf,
  buildCardInput,
  closeOrphanTopicCards,
  closeTopicCard,
  expireTopicCards,
  insertTopicCard,
  loadCardCandidates,
  loadCardTopic,
  loadTopicCards,
  metaOf,
  stampTopicCard,
  updateTopicCard,
  type CardTopicRow,
  type TopicCardRow,
} from "./store"
import { createLlmCardWriter, type CardWriter } from "./writer"

// Phase «cards» of the hourly run (topics plan phase 4; spec topics/01
// §9.1, 06 §7, §9). Runs after «attention». Per org in `shadow` / `on`:
//   1. open topic cards past `expires_at` → `expired`; orphan cards → `closed`;
//   2. every open topic with an attention result + every topic with an open
//      card: the placement decides (logic.ts cardPlacement):
//      - topic closed / band none / S0 → the open card closes;
//      - placed → ONE open `topic` card: written on first placement, and
//        again (writer NEW / UPDATE / NOOP) only when a NEW display cycle
//        started (card.message.topicCard.cycle ≠ the topic's cycle) or an
//        UPDATE was forced (R17 / admin). Unchanged cycles cost no AI call.
// Cards are stored in shadow too; the UI hides them unless the org mode is
// `on` (src/server/topics/cards/visibility.ts). A budget stop ends the org's
// pass; the remaining topics are retried on the next run (idempotent: the
// cycle stamp is the progress marker).

/** Max writer calls per org per run (cost guard). */
export const MAX_CARD_WRITES_PER_RUN = 40

export type CardOutcome =
  | "created"
  | "updated"
  | "superseded"
  | "noop"
  | "unchanged"
  | "closed"
  | "kept"
  | "invalid"
  | "skipped"

export type TopicCardResult = { outcome: CardOutcome; cardId: string | null; writerCalled: boolean }

export class TopicCardError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TopicCardError"
  }
}

type ProcessOpts = {
  orgId: string
  row: CardTopicRow
  cards: TopicCardRow[]
  writer: CardWriter
  now: Date
  book?: CodeBook
  /** Admin «Переписать карточку»: run the writer even in an unchanged cycle. */
  rewrite?: boolean
  /** Override of `topic.attention` (tests / live checks only). */
  attention?: TopicAttention | null
  /** Writer calls left in this run (undefined = no limit). */
  canCall?: () => boolean
}

/** Decide and write the `topic` card of ONE topic. Throws AiBudgetExceededError. */
export async function processTopicCard(o: ProcessOpts): Promise<TopicCardResult> {
  const { orgId, row, cards, now } = o
  const attention = o.attention !== undefined ? o.attention : attentionOf(row.attention)
  const open = cards.find((c) => c.status === "open") ?? null
  const latest = cards[0] ?? null

  const placement = cardPlacement(row.status, attention)
  if (placement === "close") {
    if (open) {
      await closeTopicCard(orgId, open.id)
      return { outcome: "closed", cardId: open.id, writerCalled: false }
    }
    return { outcome: "unchanged", cardId: null, writerCalled: false }
  }
  if (placement === "keep" || !attention) return { outcome: "kept", cardId: open?.id ?? null, writerCalled: false }

  const current = open ?? latest
  const meta = metaOf(current)
  const cycle = cycleKey({ attention, cycleStartedAt: row.cycleStartedAt, firstSeenAt: row.firstSeenAt })
  const force = meta?.force?.reason ?? null
  const needWrite = !current || meta?.cycle !== cycle || !!force || !!o.rewrite
  if (!needWrite) return { outcome: "unchanged", cardId: open?.id ?? null, writerCalled: false }
  if (o.canCall && !o.canCall()) return { outcome: "skipped", cardId: open?.id ?? null, writerCalled: false }

  const build = await buildCardInput({ orgId, row, attention, current, force, now, book: o.book })
  if (!build) return { outcome: "skipped", cardId: null, writerCalled: false }
  const out = await o.writer(build.input)
  const action = resolveCardAction({
    open: open ? { id: open.id, status: "open" } : null,
    latest: latest ? { id: latest.id, status: latest.status ?? "" } : null,
    decision: out.decision,
    copiedCardId: out.cardId,
    text: out.text,
    forced: !!force || !!o.rewrite,
    forceReason: force,
  })
  const writtenAt = now.toISOString()

  if (action.kind === "noop" || action.kind === "invalid") {
    // Invalid output with no card yet: write nothing, retry next run.
    if (!current) return { outcome: "invalid", cardId: null, writerCalled: true }
    if (action.kind === "invalid") console.warn("[topics/cards] unusable writer output", row.id, action.reason)
    await stampTopicCard(orgId, current, { cycle, decision: "NOOP", force: null }, attention.cardExpiresAt)
    return { outcome: action.kind === "noop" ? "noop" : "invalid", cardId: current.id, writerCalled: true }
  }

  const metaNext: TopicCardMeta = {
    ...out.text,
    cycle,
    decision: action.kind === "update" ? "UPDATE" : action.decision,
    writtenAt,
    force: null,
  }
  const write = { orgId, row, attention, build, text: out.text, sinceLast: action.sinceLast, meta: metaNext }
  if (action.kind === "update") {
    await updateTopicCard(write, action.cardId)
    return { outcome: "updated", cardId: action.cardId, writerCalled: true }
  }
  const id = await insertTopicCard(write, action.supersedeId)
  return { outcome: action.supersedeId ? "superseded" : "created", cardId: id, writerCalled: true }
}

export type CardsRunCounts = {
  candidates: number
  expired: number
  closed: number
  created: number
  updated: number
  superseded: number
  noop: number
  invalid: number
  unchanged: number
  kept: number
  writerCalls: number
  notStarted: number
  failed: number
  budgetStop: number
}

/** The cards pass for one org (engine entry; also used by live checks). */
export async function runCardsForOrg(
  orgId: string,
  opts: { writer?: CardWriter; now?: Date; maxWrites?: number } = {},
): Promise<CardsRunCounts> {
  const now = opts.now ?? new Date()
  const counts: CardsRunCounts = {
    candidates: 0,
    expired: 0,
    closed: 0,
    created: 0,
    updated: 0,
    superseded: 0,
    noop: 0,
    invalid: 0,
    unchanged: 0,
    kept: 0,
    writerCalls: 0,
    notStarted: 0,
    failed: 0,
    budgetStop: 0,
  }
  counts.expired = await expireTopicCards(orgId, now)
  counts.closed += await closeOrphanTopicCards(orgId)

  const rows = await loadCardCandidates(orgId)
  counts.candidates = rows.length
  if (rows.length === 0) return counts
  const [cardsByTopic, book, budget] = await Promise.all([
    loadTopicCards(orgId, rows.map((r) => r.id)),
    loadCodeBook(orgId),
    getOrgBudgetStatus(orgId),
  ])
  const writer = opts.writer ?? createLlmCardWriter(orgId)
  const maxWrites = opts.maxWrites ?? MAX_CARD_WRITES_PER_RUN
  let stop = budget.exceeded
  // Highest attention first, so a write cap / budget stop hits the least urgent.
  const ordered = [...rows].sort((a, b) => (attentionOf(b.attention)?.score ?? -1) - (attentionOf(a.attention)?.score ?? -1))

  for (const row of ordered) {
    try {
      const r = await processTopicCard({
        orgId,
        row,
        cards: cardsByTopic.get(row.id) ?? [],
        writer,
        now,
        book,
        canCall: () => !stop && counts.writerCalls < maxWrites,
      })
      if (r.writerCalled) counts.writerCalls++
      switch (r.outcome) {
        case "created":
          counts.created++
          break
        case "updated":
          counts.updated++
          break
        case "superseded":
          counts.superseded++
          break
        case "noop":
          counts.noop++
          break
        case "invalid":
          counts.invalid++
          break
        case "closed":
          counts.closed++
          break
        case "kept":
          counts.kept++
          break
        case "skipped":
          counts.notStarted++
          break
        default:
          counts.unchanged++
      }
    } catch (e) {
      if (e instanceof AiBudgetExceededError) {
        stop = true
        counts.budgetStop = 1
        counts.notStarted++
        continue
      }
      counts.failed++
      console.error("[topics/cards] topic failed", row.id, e)
    }
  }
  return counts
}

export async function runCardsPhase(ctx: TopicsPhaseContext): Promise<TopicsPhaseResult> {
  return runCardsForOrg(ctx.organizationId)
}

// ── Hooks ─────────────────────────────────────────────────────────────────

/**
 * R17 hook (phase 5a, deal risks): force an UPDATE of the topic's card. Marks
 * the latest `topic` card so the next run calls the writer even if the cycle
 * did not change (a NOOP answer is treated as UPDATE); `runNow` runs it at
 * once. Returns false when the topic has no card yet (the first placement
 * writes one anyway).
 */
export async function forceTopicCardUpdate(
  orgId: string,
  topicId: string,
  reason: string,
  opts: { runNow?: boolean; writer?: CardWriter } = {},
): Promise<{ marked: boolean; result?: TopicCardResult }> {
  const cards = (await loadTopicCards(orgId, [topicId])).get(topicId) ?? []
  const target = cards.find((c) => c.status === "open") ?? cards[0]
  if (!target) return { marked: false }
  await stampTopicCard(orgId, target, { force: { reason: reason.slice(0, 300), at: new Date().toISOString() } })
  if (!opts.runNow) return { marked: true }
  const row = await loadCardTopic(orgId, topicId)
  if (!row) return { marked: true }
  const fresh = (await loadTopicCards(orgId, [topicId])).get(topicId) ?? []
  const result = await processTopicCard({
    orgId,
    row,
    cards: fresh,
    writer: opts.writer ?? createLlmCardWriter(orgId),
    now: new Date(),
  })
  return { marked: true, result }
}

/**
 * Admin «Переписать карточку» (debug block): run the writer once for one
 * topic now, whatever the org mode. Needs a placement (attention result with
 * a card). Throws TopicCardError (Russian message) / AiBudgetExceededError.
 */
export async function rewriteTopicCard(
  orgId: string,
  topicId: string,
  opts: { writer?: CardWriter; attention?: TopicAttention | null } = {},
): Promise<TopicCardResult> {
  const row = await loadCardTopic(orgId, topicId)
  if (!row) throw new TopicCardError("Тема не найдена")
  const attention = opts.attention !== undefined ? opts.attention : attentionOf(row.attention)
  const placement = cardPlacement(row.status, attention)
  if (placement !== "card") {
    throw new TopicCardError(
      !attention
        ? "Внимание для темы ещё не рассчитано — карточки нет."
        : "У темы нет места в списках (закрыта, без сигнала или S0) — карточка не нужна.",
    )
  }
  const cards = (await loadTopicCards(orgId, [topicId])).get(topicId) ?? []
  return processTopicCard({
    orgId,
    row,
    cards,
    writer: opts.writer ?? createLlmCardWriter(orgId),
    now: new Date(),
    attention,
    rewrite: true,
  })
}

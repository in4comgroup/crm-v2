import "server-only"

import { randomUUID } from "node:crypto"
import { eq, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { organization, signalInstance, sourceItem, sourceItemSubject } from "@/db/schema"
import type { AnalysisExclusionEntry } from "@/lib/analysis-exclusion-match"
import { splitQuotedHistory } from "@/lib/ru-mail"
import {
  type SignalBand,
  type SignalFacts,
  type SignalItemFacts,
  type SignalItemStatus,
  type SignalSkipReason,
  type SignalSubject,
} from "@/lib/signals/extraction-types"
import { computeAllInternal } from "@/lib/identity/own-org-sets"
import { AiBudgetExceededError } from "@/server/ai/budget"
import { getOwnOrgContext } from "@/server/identity/own-org"
import { loadAnalysisExclusions } from "@/server/analysis-exclusions"
import { loadOrgBlocklist } from "@/server/blocklist"
import { getCurrentVersion, getEffectiveSignals, getRegistry } from "@/server/signals/registry"
import { loadPromptCodes, type PromptCodeSet } from "@/server/topics/prompt/extraction"
import { EXTRACTION_PROCESS, runExtraction } from "@/server/topics/prompt/run-extraction"
import { counterpartyLineForItem, loadExtractionCounterparties, type ExtractionCounterparties } from "./counterparty-line"
import { messageContent } from "./evidence"
import { runGates, type BlocklistGuard } from "./gates"
import {
  envelopeFromItem,
  itemHeaders,
  itemMarkdown,
  loadSignalItemRows,
  senderEmail,
  senderName,
  storedAllInternal,
  type SignalItemRow,
} from "./item-input"
import {
  buildScoringContext,
  postprocessExtraction,
  type InstanceDraft,
  type ScoringContext,
} from "./postprocess"

// Signal extraction of ONE source item (spec topics/01 §5; plan phase 2
// tasks 5–7): gates → `topics.signal_extraction` → post-processing →
// storage. Org-explicit, session-free (cron-safe); the caller checks access.
//
// Storage is one `db.batch` (neon-http has no interactive transactions):
// delete the item's old instances + subjects, insert the new ones, stamp the
// item. Re-running an item therefore replaces its result (idempotent).
// A stored score is never re-scored when weights change; only a re-run
// (manual action, reparse) computes it again (spec §5.4 rule 7).

/** Failed attempts after which the hourly runner stops retrying an item. */
export const MAX_SIGNAL_ATTEMPTS = 3

/** Everything a batch of items of one org shares (load once per run). */
export type SignalBatchContext = {
  orgId: string
  orgName: string | null
  scoring: ScoringContext
  promptSet: PromptCodeSet
  exclusions: AnalysisExclusionEntry[]
  blocklist: BlocklistGuard
  /**
   * Identity I4: client index for the envelope line «Контрагент: …»; null
   * when the org profile is not in the prompt (`promptSet.promptContext`).
   */
  counterparties: ExtractionCounterparties | null
}

/**
 * Throws SignalsNotEnabledError when the org has no active code.
 * `promptContext` forces the org profile in / out of the prompt (eval runs);
 * omitted = the org setting `identity.promptContext`.
 */
export async function loadSignalBatchContext(
  orgId: string,
  opts: { promptContext?: boolean } = {},
): Promise<SignalBatchContext> {
  const promptSet = await loadPromptCodes(orgId, "live", opts)
  const [registry, effective, version, exclusions, blocklist, org, counterparties] = await Promise.all([
    getRegistry(),
    getEffectiveSignals(orgId),
    getCurrentVersion(),
    loadAnalysisExclusions(orgId),
    loadOrgBlocklist(orgId),
    db.select({ name: organization.name }).from(organization).where(eq(organization.id, orgId)),
    promptSet.promptContext ? loadExtractionCounterparties(orgId) : Promise.resolve(null),
  ])
  return {
    orgId,
    orgName: org[0]?.name ?? null,
    scoring: buildScoringContext({
      taxonomyVersion: Math.max(version, promptSet.taxonomyVersion),
      categories: registry.categories,
      effective,
      blocks: registry.blocks,
      relations: registry.relations,
      attributes: registry.attributes,
    }),
    promptSet,
    exclusions,
    blocklist,
    counterparties,
  }
}

export type ExtractItemResult = {
  itemId: string
  status: SignalItemStatus
  reason: string | null
  score: number | null
  band: SignalBand | null
  instances: number
  counted: number
  dropped: number
  /** True when the AI budget stopped the call — the runner stops the org. */
  budgetExceeded?: boolean
}

const EMPTY_FACTS: SignalFacts = {
  amounts: [],
  deadlines: [],
  contractEndDate: null,
  proposedMeetingDate: null,
  paymentTermsDays: null,
  creditLimitRequested: null,
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Replace the item's result: instances + subjects + item columns. */
async function storeResult(args: {
  orgId: string
  itemId: string
  status: SignalItemStatus
  reason: string | null
  score: number
  band: SignalBand
  taxonomyVersion: number
  facts: SignalItemFacts | null
  instances: InstanceDraft[]
  subjects: SignalSubject[]
  processKey: string
}) {
  const now = new Date()
  const instanceRows = args.instances.map((i) => ({
    id: randomUUID(),
    organizationId: args.orgId,
    code: i.code,
    origin: "communication",
    sourceItemId: args.itemId,
    processKey: args.processKey,
    evidence: i.evidence,
    evidenceFound: true,
    confidence: i.confidence,
    subjectIndex: i.subjectIndex,
    counted: i.counted,
    notCountedReason: i.notCountedReason,
    scoreContrib: i.scoreContrib,
    taxonomyVersion: args.taxonomyVersion,
    createdAt: now,
  }))
  const subjectRows = args.subjects.map((s) => ({
    id: randomUUID(),
    organizationId: args.orgId,
    sourceItemId: args.itemId,
    subjectIndex: s.index,
    counterparty: s.counterparty,
    onBehalfOf: s.onBehalfOf,
    matter: s.matter,
    references: s.references,
    products: s.products,
  }))
  const ops = [
    db.delete(signalInstance).where(eq(signalInstance.sourceItemId, args.itemId)),
    db.delete(sourceItemSubject).where(eq(sourceItemSubject.sourceItemId, args.itemId)),
    ...(instanceRows.length ? [db.insert(signalInstance).values(instanceRows)] : []),
    ...(subjectRows.length ? [db.insert(sourceItemSubject).values(subjectRows)] : []),
    db
      .update(sourceItem)
      .set({
        signalStatus: args.status,
        signalReason: args.reason,
        signalScore: args.score,
        signalBand: args.band,
        signalFacts: args.facts as Record<string, unknown> | null,
        signalScannedAt: now,
        signalAttempts: 0,
        signalTaxonomyVersion: args.taxonomyVersion,
      })
      .where(eq(sourceItem.id, args.itemId)),
  ] as const
  await db.batch(ops as unknown as Parameters<typeof db.batch>[0])
}

async function markStatus(itemId: string, status: "deferred" | "failed", reason: string) {
  await db
    .update(sourceItem)
    .set({
      signalStatus: status,
      signalReason: reason.slice(0, 1000),
      // "Last considered" — keeps deferred / failed items in the review list.
      signalScannedAt: new Date(),
      ...(status === "failed" ? { signalAttempts: sql`${sourceItem.signalAttempts} + 1` } : {}),
    })
    .where(eq(sourceItem.id, itemId))
}

function skipLabel(reason: SignalSkipReason, detail: string | null): string {
  return detail ? `${reason}: ${detail}` : reason
}

/**
 * Extract signals of one item. Never throws for item-level problems: the
 * outcome is stored on the item and returned. Throws only for DB failures.
 */
export async function extractSignalsForItem(
  batch: SignalBatchContext,
  row: SignalItemRow,
): Promise<ExtractItemResult> {
  const base = { itemId: row.id, instances: 0, counted: 0, dropped: 0 }
  const version = batch.scoring.taxonomyVersion
  const skip = async (reason: SignalSkipReason, detail: string | null = null): Promise<ExtractItemResult> => {
    const label = skipLabel(reason, detail)
    await storeResult({
      orgId: batch.orgId,
      itemId: row.id,
      status: "skipped",
      reason: label,
      score: 0,
      band: "none",
      taxonomyVersion: version,
      facts: null,
      instances: [],
      subjects: [],
      processKey: "gate",
    })
    return { ...base, status: "skipped", reason: label, score: 0, band: "none" }
  }

  // Gate 1 (also enforced by the runner query; the manual action relies on it here).
  if (row.parentSourceItemId) return skip("not_root")
  if (row.parseStatus !== "complete") return skip("not_parsed", row.parseStatus)

  const markdown = await itemMarkdown(row)
  const text = markdown ? messageContent(markdown) : ""
  if (!text.trim()) return skip("no_text")

  const itemDate = row.sourceCreatedAt ?? row.createdAt
  const envelope = envelopeFromItem(row, text)
  envelope.orgName = batch.orgName
  // Identity spec Q9: items parsed before the parse-time fact existed get it
  // computed now from the stored addresses and the current «us» sets.
  if (
    storedAllInternal(row.metadataJson) === null &&
    row.orgAttribution === "own_org" &&
    !envelope.forwardedBy &&
    !envelope.originalAuthor
  ) {
    const own = await getOwnOrgContext(batch.orgId)
    envelope.allInternal = computeAllInternal(
      row.metadataJson,
      (e) => own.matchEmail(e) !== null,
    )
  }
  const fromEmail = senderEmail(row.metadataJson)

  // Gates 3–7.
  const gate = runGates(
    {
      provider: row.provider,
      metadataJson: row.metadataJson,
      threadExternalId: row.threadExternalId,
      externalId: row.externalId,
      orgAttribution: row.orgAttribution,
      subject: envelope.subject ?? null,
      from: envelope.from ?? null,
      fromEmail,
      fromName: senderName(row.metadataJson),
      headers: itemHeaders(row.metadataJson),
      text,
      date: itemDate,
    },
    { ctx: batch.scoring, exclusions: batch.exclusions, blocklist: batch.blocklist },
  )
  if (gate.kind === "skip") return skip(gate.reason, gate.detail)
  if (gate.kind === "deterministic") {
    const facts: SignalItemFacts = {
      facts: { ...EMPTY_FACTS, ...gate.facts },
      direction: "inbound",
      modelDirection: null,
      attributes: [],
      attrAdj: 0,
      dominantCode: gate.dominantCode,
      dropped: [],
      producer: { kind: "gate", model: null, process: null, gate: gate.gate },
    }
    await storeResult({
      orgId: batch.orgId,
      itemId: row.id,
      status: "done",
      reason: `gate: ${gate.gate}`,
      score: gate.score,
      band: gate.band,
      taxonomyVersion: version,
      facts,
      instances: gate.instances,
      subjects: [],
      processKey: `gate.${gate.gate}`,
    })
    return {
      ...base,
      status: "done",
      reason: `gate: ${gate.gate}`,
      score: gate.score,
      band: gate.band,
      instances: gate.instances.length,
      counted: gate.instances.filter((i) => i.counted).length,
    }
  }

  // Identity I4: «Контрагент: …» of the item's known client (gated).
  envelope.counterpartyLine = await counterpartyLineForItem(batch.counterparties, row, envelope)

  // The LLM call (gate 8 = the AI budget, checked by the runtime).
  let run: Awaited<ReturnType<typeof runExtraction>>
  try {
    run = await runExtraction({
      orgId: batch.orgId,
      text,
      envelope,
      promptSet: batch.promptSet,
      successors: batch.scoring.successors,
      ref: { sourceItemId: row.id },
    })
  } catch (e) {
    if (e instanceof AiBudgetExceededError) {
      await markStatus(row.id, "deferred", "budget")
      return { ...base, status: "deferred", reason: "budget", score: null, band: null, budgetExceeded: true }
    }
    const msg = message(e)
    await markStatus(row.id, "failed", msg)
    return { ...base, status: "failed", reason: msg, score: null, band: null }
  }
  if (!run.output) {
    // two_pass with no block chosen: a valid empty result.
    return skip("no_text", "no block")
  }

  const split = splitQuotedHistory(text)
  const pp = postprocessExtraction(run.output, batch.scoring, {
    text,
    ownText: split.own.trim() ? split.own : null,
    date: itemDate,
    orgAttribution: row.orgAttribution,
    allInternal: envelope.allInternal === true,
  })
  const facts: SignalItemFacts = {
    facts: pp.facts,
    direction: pp.direction,
    modelDirection: run.output.direction ?? null,
    attributes: pp.attributes,
    attrAdj: pp.attrAdj,
    dominantCode: pp.dominantCode,
    dropped: pp.dropped,
    producer: { kind: "llm", model: run.model, process: EXTRACTION_PROCESS },
    forward:
      envelope.forwardedBy || envelope.originalAuthor
        ? { forwardedBy: envelope.forwardedBy ?? null, originalAuthor: envelope.originalAuthor ?? null }
        : null,
    durationMs: run.durationMs,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
  }
  await storeResult({
    orgId: batch.orgId,
    itemId: row.id,
    status: "done",
    reason: null,
    score: pp.score,
    band: pp.band,
    taxonomyVersion: run.taxonomyVersion,
    facts,
    instances: pp.instances,
    subjects: pp.subjects,
    processKey: EXTRACTION_PROCESS,
  })
  // Contact ↔ company links (docs/specs/clients-contacts/04 §4 P1): a
  // CONTACT_LEAVING the parse-time rules may have missed. Never throws.
  if (pp.instances.some((i) => i.code === "CONTACT_LEAVING")) {
    const { scanItemForContactLinks } = await import("@/server/contact-links")
    await scanItemForContactLinks(batch.orgId, row.id, { signalCodes: ["CONTACT_LEAVING"] })
  }
  return {
    ...base,
    status: "done",
    reason: null,
    score: pp.score,
    band: pp.band,
    instances: pp.instances.length,
    counted: pp.instances.filter((i) => i.counted).length,
    dropped: pp.dropped.length,
  }
}

export class SignalItemNotFoundError extends Error {
  constructor(public itemId: string) {
    super(`Сообщение не найдено: ${itemId}`)
    this.name = "SignalItemNotFoundError"
  }
}

/**
 * Manual action on one item (plan phase 2 task 7). Runs regardless of the
 * org's `topics.enabled` mode — the admin's intent overrides the schedule;
 * every other gate applies. Throws SignalsNotEnabledError /
 * SignalItemNotFoundError.
 */
export async function runSignalExtractionForItem(orgId: string, itemId: string): Promise<ExtractItemResult> {
  const [row] = await loadSignalItemRows(orgId, [itemId])
  if (!row) throw new SignalItemNotFoundError(itemId)
  const batch = await loadSignalBatchContext(orgId)
  return extractSignalsForItem(batch, row)
}


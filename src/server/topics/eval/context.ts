import "server-only"
import { splitQuotedHistory } from "@/lib/ru-mail"
import type { EffectiveSignal, SignalCategoryRecord } from "@/lib/signals/types"
import { getEffectiveSignals, getRegistry } from "@/server/signals/registry"
import type { NormalizedExtraction, PromptCodeSet } from "@/server/topics/prompt/extraction"
import { buildScoringContext, postprocessExtraction, type ScoringContext } from "@/server/topics/signals/postprocess"
import type { CodeInfo, EvalPostStored } from "./metrics"

// Registry context of one eval batch (plan phase 2 task 8).
//
// Scoring uses the SAME taxonomy version as the prompt set of the batch.
// Review-only codes (R6) are inactive for the org (stage onHold), so the
// engine's post-processing would drop them as `not_active`. In an eval with
// the `review` code set they are scored AS IF switched on — the question the
// eval answers is "what would the engine keep if the admin turned this code
// on". Live codes are scored exactly as the hourly engine scores them.

export type EvalRegistryContext = {
  scoring: ScoringContext
  info: (code: string) => CodeInfo
}

export async function loadEvalContext(orgId: string, promptSet: PromptCodeSet): Promise<EvalRegistryContext> {
  const [registry, effective] = await Promise.all([getRegistry(), getEffectiveSignals(orgId)])
  const reviewInPrompt = new Set(promptSet.codes.filter((c) => c.reviewOnly).map((c) => c.code))
  const scoring = buildScoringContext({
    taxonomyVersion: promptSet.taxonomyVersion,
    categories: registry.categories,
    effective: effective.map((e) => (reviewInPrompt.has(e.code) ? { ...e, active: true } : e)),
    blocks: registry.blocks,
    relations: registry.relations,
    attributes: registry.attributes,
  })
  return { scoring, info: codeInfoFrom(registry.categories, effective) }
}

/** Registry info only (reports of stored runs). */
export async function loadCodeInfo(orgId: string): Promise<(code: string) => CodeInfo> {
  const [registry, effective] = await Promise.all([getRegistry(), getEffectiveSignals(orgId)])
  return codeInfoFrom(registry.categories, effective)
}

function codeInfoFrom(
  categories: readonly SignalCategoryRecord[],
  effective: readonly EffectiveSignal[],
): (code: string) => CodeInfo {
  const category = new Map(categories.map((c) => [c.code, c]))
  const eff = new Map(effective.map((e) => [e.code, e]))
  return (code: string): CodeInfo => {
    const c = category.get(code)
    const e = eff.get(code)
    return {
      labelRu: c?.labelRu ?? code,
      status: e ? (e.reviewOnly ? "review" : e.inPrompt ? "on" : "off") : null,
      weight: e?.weight ?? c?.weight ?? null,
      profile: e?.displayProfile ?? c?.displayProfile ?? null,
    }
  }
}

const EVIDENCE_MAX = 300

/** Post-processing of one extraction, in the stored shape (spec §5.4). */
export function postprocessForEval(
  output: NormalizedExtraction | null,
  ctx: ScoringContext,
  item: {
    text: string
    /**
     * The author's own text (message without quoted history + attachment
     * blocks, `buildSignalItemText`). Omitted = computed from `text` (an
     * item without attachments).
     */
    ownText?: string | null
    date: Date | null
    orgAttribution: string | null
  },
): EvalPostStored {
  if (!output) {
    // two_pass with no block chosen: a valid empty result.
    return {
      taxonomyVersion: ctx.taxonomyVersion,
      direction: item.orgAttribution === "own_org" ? "outbound" : "inbound",
      score: 0,
      band: "none",
      dominantCode: null,
      attrAdj: 0,
      instances: [],
      dropped: [],
    }
  }
  let ownText = item.ownText
  if (ownText === undefined) {
    const split = splitQuotedHistory(item.text)
    ownText = split.own.trim() ? split.own : null
  }
  const pp = postprocessExtraction(output, ctx, {
    text: item.text,
    ownText,
    date: item.date,
    orgAttribution: item.orgAttribution,
  })
  return {
    taxonomyVersion: ctx.taxonomyVersion,
    direction: pp.direction,
    score: pp.score,
    band: pp.band,
    dominantCode: pp.dominantCode,
    attrAdj: pp.attrAdj,
    instances: pp.instances.map((i) => ({ ...i, evidence: i.evidence.slice(0, EVIDENCE_MAX) })),
    dropped: pp.dropped.map((d) => ({ ...d, evidence: d.evidence.slice(0, EVIDENCE_MAX) })),
  }
}

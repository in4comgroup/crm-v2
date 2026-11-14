// Deterministic gates before the LLM (spec topics/01 §5.2), zero cost. PURE:
// the caller loads the exclusions, the blocklist guard and the scoring
// context. Gate 1 (root, parsed, org mode) and gate 2 (junk = parse
// `skipped`) are applied by the item query; gate 8 (AI budget) by the
// runner.
//
// Order here: 3a exclusions → 3 blocklist → 5 bounce → 6 out-of-office →
// 7 calendar reply → 4 automated sender. Bounce and out-of-office replies
// come from automated senders by nature, so they are checked BEFORE the
// automated-sender skip — otherwise they could never emit their codes.
// Gates 4–7 apply to mail providers only (nylas, imap).

import type { AnalysisExclusionEntry } from "@/lib/analysis-exclusion-match"
import { exclusionProbeFromItem, matchAnalysisExclusion } from "@/lib/analysis-exclusion-match"
import {
  detectBounce,
  detectCalendarReply,
  detectOutOfOffice,
  isAutomatedSender,
  splitQuotedHistory,
} from "@/lib/ru-mail"
import { scoreToBand, type SignalBand, type SignalFacts, type SignalSkipReason } from "@/lib/signals/extraction-types"
import { INHERITED_FALLBACK_WEIGHT, type InstanceDraft, type ScoringContext } from "./postprocess"

export const MAIL_PROVIDERS = new Set(["nylas", "imap"])

/** Codes the deterministic gates emit (spec §5.2 gates 5, 6). */
export const GATE_CODES = { bounce: "MAILERDEMON_RECEIVED", outOfOffice: "CONTACT_OOO" } as const

export type GateInput = {
  provider: string | null
  metadataJson: unknown
  threadExternalId: string | null
  externalId?: string | null
  orgAttribution: string | null
  subject: string | null
  /** Sender line ("Name <a@b>") and address. */
  from: string | null
  fromEmail: string | null
  fromName: string | null
  headers: Record<string, string> | null
  /** Message content (no frontmatter / summary). */
  text: string
  date: Date | null
}

export type BlocklistGuard = {
  isBlockedEmail: (email: string) => boolean
  isBlockedDomain: (domain: string) => boolean
}

export type GateOutcome =
  | { kind: "skip"; reason: SignalSkipReason; detail: string | null }
  | {
      kind: "deterministic"
      gate: "bounce" | "out_of_office" | "calendar_reply"
      instances: InstanceDraft[]
      facts: Partial<SignalFacts>
      score: number
      band: SignalBand
      dominantCode: string | null
    }
  | { kind: "llm" }

function gateInstance(
  ctx: ScoringContext,
  code: string,
  evidence: string,
): InstanceDraft | null {
  const eff = ctx.effective.get(code)
  const cat = ctx.categories.get(code)
  if (!eff?.active || !cat) return null
  const w = eff.weight
  const score = cat.scoreRule === "inherited" && w <= 0 ? INHERITED_FALLBACK_WEIGHT : w
  const isState = cat.scoreRule === "state" || cat.kind === "state"
  return {
    code,
    evidence: evidence.slice(0, 500),
    confidence: "high",
    subjectIndex: -1,
    counted: !isState,
    notCountedReason: isState ? "state" : null,
    scoreContrib: isState ? 0 : score,
  }
}

function deterministic(
  gate: "bounce" | "out_of_office",
  instance: InstanceDraft,
  facts: Partial<SignalFacts>,
): GateOutcome {
  const score = instance.counted ? instance.scoreContrib : 0
  return {
    kind: "deterministic",
    gate,
    instances: [instance],
    facts,
    score,
    band: scoreToBand(score),
    dominantCode: instance.counted ? instance.code : null,
  }
}

export function runGates(
  input: GateInput,
  deps: {
    ctx: ScoringContext
    exclusions: readonly AnalysisExclusionEntry[]
    blocklist: BlocklistGuard | null
  },
): GateOutcome {
  // 3a. Exclusions from analysis (R18): any address / chat on the item.
  const excluded = matchAnalysisExclusion(
    deps.exclusions,
    exclusionProbeFromItem({
      provider: input.provider,
      metadataJson: input.metadataJson,
      threadExternalId: input.threadExternalId,
      externalId: input.externalId ?? null,
    }),
  )
  if (excluded) return { kind: "skip", reason: "excluded", detail: `${excluded.kind}: ${excluded.value}` }

  // 3. Discovery blocklist: an external author on the org's blocklist.
  if (deps.blocklist && input.fromEmail && input.orgAttribution !== "own_org") {
    const domain = input.fromEmail.split("@")[1] ?? ""
    if (deps.blocklist.isBlockedEmail(input.fromEmail) || (domain && deps.blocklist.isBlockedDomain(domain))) {
      return { kind: "skip", reason: "blocklist", detail: input.fromEmail }
    }
  }

  if (!MAIL_PROVIDERS.has(input.provider ?? "")) return { kind: "llm" }

  const probe = {
    subject: input.subject,
    from: input.from,
    body: input.text,
    headers: input.headers,
    date: input.date?.toISOString() ?? null,
  }

  // 5. Bounce → MAILERDEMON_RECEIVED with the bounced message ids, no LLM.
  const bounce = detectBounce(probe)
  if (bounce.isBounce) {
    const facts: Partial<SignalFacts> = { bouncedMessageIds: bounce.bouncedMessageIds }
    const inst = gateInstance(deps.ctx, GATE_CODES.bounce, bounce.reason ?? input.subject ?? "Недоставленное письмо")
    return inst ? deterministic("bounce", inst, facts) : { kind: "skip", reason: "bounce", detail: bounce.reason }
  }

  // 6. Out-of-office → CONTACT_OOO with return date and deputy, no LLM.
  const ooo = detectOutOfOffice(probe)
  if (ooo.isOoo) {
    const facts: Partial<SignalFacts> = { oooReturnDate: ooo.returnDate, oooDeputy: ooo.deputy }
    const inst = gateInstance(deps.ctx, GATE_CODES.outOfOffice, ooo.evidence ?? input.subject ?? "Автоответ")
    return inst
      ? deterministic("out_of_office", inst, facts)
      : { kind: "skip", reason: "out_of_office", detail: ooo.returnDate }
  }

  // 7. Calendar reply without .ics → meeting fact only (no code, no LLM).
  const cal = detectCalendarReply(probe)
  if (cal.isReply) {
    // A reply with a real note from the author goes to the LLM instead.
    const own = splitQuotedHistory(input.text).own.trim()
    if (own.length < 200) {
      return {
        kind: "deterministic",
        gate: "calendar_reply",
        instances: [],
        facts: { meetingReply: { response: cal.response, meetingTitle: cal.meetingTitle } },
        score: 0,
        band: "none",
        dominantCode: null,
      }
    }
  }

  // 4. Automated sender (token-anywhere match on the address + headers).
  if (
    input.orgAttribution !== "own_org" &&
    isAutomatedSender({ email: input.fromEmail, name: input.fromName, headers: input.headers })
  ) {
    return { kind: "skip", reason: "automated", detail: input.fromEmail }
  }

  return { kind: "llm" }
}

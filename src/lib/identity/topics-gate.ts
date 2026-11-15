// Gate before the topics engine (identity spec I3, §3.3, decision Q4). PURE,
// client-safe: the decision of a topics mode change from the profile
// completeness. Used by PUT /api/admin/topics and the unit tests.

import {
  COMPLETENESS_LABELS_RU,
  type Completeness,
  type CompletenessItem,
} from "@/lib/identity/org-profile"

export type GateTopicsMode = "off" | "shadow" | "on"

/** Minimum length of the platform-admin override reason. */
export const TOPICS_GATE_OVERRIDE_MIN_REASON = 10

export type TopicsModeGateDecision =
  | { ok: true; overridden: boolean; reason: string | null }
  | { ok: false; status: 400 | 409; error: string; missing: CompletenessItem[] }

/** Russian 409 message with the missing items of the mandatory minimum. */
export function topicsGateMessage(missing: readonly CompletenessItem[]): string {
  const items = missing.map((m) => COMPLETENESS_LABELS_RU[m])
  return `Профиль организации не заполнен — темы нельзя включить. Не хватает: ${items.join("; ")}.`
}

/**
 * PURE. May the org's topics mode change `from` → `to`?
 * - `off`, or no change (same mode) → always allowed: running orgs are never stopped.
 * - `shadow` / `on` → allowed when the profile minimum is complete;
 *   otherwise refused (409 + the missing items) unless an override with a
 *   reason of ≥ 10 characters is given (platform admin; 400 when too short).
 */
export function decideTopicsModeChange(input: {
  from: GateTopicsMode
  to: GateTopicsMode
  completeness: Completeness
  override?: { reason?: unknown } | null
}): TopicsModeGateDecision {
  const { from, to, completeness } = input
  if (to === "off" || to === from || completeness.complete) {
    return { ok: true, overridden: false, reason: null }
  }
  if (input.override) {
    const reason = typeof input.override.reason === "string" ? input.override.reason.trim() : ""
    if (reason.length < TOPICS_GATE_OVERRIDE_MIN_REASON) {
      return {
        ok: false,
        status: 400,
        error: `Укажите причину включения без профиля — не короче ${TOPICS_GATE_OVERRIDE_MIN_REASON} символов.`,
        missing: completeness.missing,
      }
    }
    return { ok: true, overridden: true, reason }
  }
  return { ok: false, status: 409, error: topicsGateMessage(completeness.missing), missing: completeness.missing }
}

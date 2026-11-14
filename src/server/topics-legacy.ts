import "server-only"

import { getTopicsMode } from "@/server/topics/mode"

// Old card / deal logic vs the topics engine (spec topics/01 §9.1, §9.2,
// R7; plan phase 6 task 4). While an org's topics mode is `on`, the engine
// owns cards and deals, so the old paths are refused for that org:
//   - Custom-rule card generation (`/api/cards/generate`, Explore / Magic
//     buttons). This also switches off the «Cards pop-up rule — Telegram
//     orders» rule (R7): the `ORDER_REQUESTED` topic card replaces it.
//   - name-based deal discovery (`/api/deals/discover`): the deal bridge
//     replaces it.
// Orgs in `off` / `shadow` keep the old logic unchanged. Removed for all
// orgs in plan phase 12. Org-explicit, no session.

export const LEGACY_CARDS_OFF_MESSAGE =
  "Карточки создаёт движок тем. Поиск карточек по правилам для этой организации отключён."
export const LEGACY_DEALS_OFF_MESSAGE =
  "Сделки создаёт и ведёт движок тем. Поиск сделок в источниках для этой организации отключён."

export type LegacyLogicKind = "cards" | "deals"

export class LegacyLogicOffError extends Error {
  readonly kind: LegacyLogicKind
  constructor(kind: LegacyLogicKind) {
    super(kind === "cards" ? LEGACY_CARDS_OFF_MESSAGE : LEGACY_DEALS_OFF_MESSAGE)
    this.name = "LegacyLogicOffError"
    this.kind = kind
  }
}

export type LegacyLogicStatus = { enabled: boolean; message: string | null }

/** True when the org may still use the old logic (topics mode off / shadow). */
export async function legacyLogicAllowed(orgId: string): Promise<boolean> {
  return (await getTopicsMode(orgId)) !== "on"
}

/** `{ enabled, message }` for the UI (hide the buttons when not enabled). */
export async function legacyLogicStatus(orgId: string, kind: LegacyLogicKind): Promise<LegacyLogicStatus> {
  if (await legacyLogicAllowed(orgId)) return { enabled: true, message: null }
  return { enabled: false, message: new LegacyLogicOffError(kind).message }
}

/** Throws LegacyLogicOffError when the org is in topics mode `on`. */
export async function assertLegacyLogicAllowed(orgId: string, kind: LegacyLogicKind): Promise<void> {
  if (!(await legacyLogicAllowed(orgId))) throw new LegacyLogicOffError(kind)
}

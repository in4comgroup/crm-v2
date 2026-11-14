import "server-only"

import { and, eq, gt, isNull, or, inArray, type SQL } from "drizzle-orm"
import { card } from "@/db/schema"
import { getTopicsMode } from "@/server/topics/mode"

// Who sees engine cards (spec topics/01 §9.1, §14): cards are stored in
// `shadow` too, but users see `topic` / `deal_proposal` / `stage_confirmation`
// cards ONLY while the org's `topics.enabled` is `on`. Old Custom-rule cards
// (`card.kind` IS NULL) are never affected. Every user-facing card query
// (feed, single card, global search, notifications, client activity) adds
// `userCardFilter(orgId)`.

/** True when the org's users may see engine cards (mode `on`). */
export async function topicCardsVisible(orgId: string): Promise<boolean> {
  return (await getTopicsMode(orgId)) === "on"
}

/**
 * Card filter for user-facing lists: old cards always; engine cards only in
 * mode `on`, and then only the ones a person still acts on or decided
 * (open and not expired at read time, accepted, rejected) — superseded /
 * expired / closed cards are history for the debug view only.
 */
export async function userCardFilter(orgId: string, now: Date = new Date()): Promise<SQL> {
  if (!(await topicCardsVisible(orgId))) return isNull(card.kind)
  return or(
    isNull(card.kind),
    and(eq(card.status, "open"), or(isNull(card.expiresAt), gt(card.expiresAt, now))),
    inArray(card.status, ["accepted", "rejected"]),
  )!
}

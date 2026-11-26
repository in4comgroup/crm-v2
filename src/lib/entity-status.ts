// Status of a company / contact after a PERSON saved it (2026-11-26, tester
// request): «Новая» / «Новый» (`initial`) = created automatically (discovery
// from sources) and not checked by a person yet. A person who saves the card
// confirms it, so `initial` becomes `active` without a manual status change.
// A status the person chose explicitly (another value than the current one)
// always wins. Pure, client-safe.

import type { EntityStatus } from "@/db/schema"

/**
 * PURE. The status to write when a person saves a record whose stored status
 * is `current`. `requested` = the status in the save (undefined = not sent).
 * Returns undefined when the status column must not be written.
 */
export function statusAfterPersonSave(
  current: EntityStatus,
  requested: EntityStatus | undefined,
): EntityStatus | undefined {
  if (requested !== undefined && requested !== current) return requested
  if (current === "initial") return "active"
  return requested
}

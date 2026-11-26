import "server-only"

// «Новая» → «Активная» when a person saves a company / contact through a
// part of the card that has its own endpoint («Поля», «Профиль компании»).
// The main forms do the same inside `updateClient` / `updateContact`
// (`statusAfterPersonSave`, src/lib/entity-status.ts). Never call it from
// automatic processes (discovery, enrichment, parsing).

import { and, eq } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { client, contact } from "@/db/schema"

/** `initial` → `active` for ONE record of the org; true when it changed. */
export async function activateInitialRecord(
  orgId: string,
  entity: "client" | "contact",
  id: string,
): Promise<boolean> {
  const t = entity === "client" ? client : contact
  const rows = await db
    .update(t)
    .set({ status: "active" })
    .where(and(eq(t.organizationId, orgId), eq(t.id, id), eq(t.status, "initial")))
    .returning({ id: t.id })
  return rows.length > 0
}

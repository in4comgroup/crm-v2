import "server-only"

// DB side of the CONTACT checks (group `contacts`): org-explicit, READ-ONLY
// loader + the evaluators (`CONTACT_CHECKS`). The logic is PURE in
// ./contacts.ts.

import { and, eq, isNotNull, isNull, notInArray } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { client, contact } from "@/db/schema"
import { checkContactBirthday, type BirthdayContact } from "./contacts"
import type { CheckEvaluators } from "./types"

/** Live contacts of the org with a birthday (not deleted / blocked / merged). */
async function loadBirthdayContacts(orgId: string): Promise<BirthdayContact[]> {
  const rows = await db
    .select({
      contactId: contact.id,
      nameNative: contact.nameNative,
      name: contact.name,
      birthday: contact.birthday,
      clientId: contact.clientId,
      clientName: client.name,
    })
    .from(contact)
    .leftJoin(client, and(eq(client.id, contact.clientId), eq(client.organizationId, orgId)))
    .where(
      and(
        eq(contact.organizationId, orgId),
        isNotNull(contact.birthday),
        isNull(contact.mergedIntoContactId),
        notInArray(contact.status, ["deleted", "blocked"]),
      ),
    )
  return rows.map((r) => ({
    contactId: r.contactId,
    name: r.nameNative?.trim() || r.name,
    birthday: r.birthday!,
    clientId: r.clientName ? r.clientId : null,
    clientName: r.clientName,
  }))
}

export const CONTACT_CHECKS: CheckEvaluators = {
  contact_birthday: async (ctx) =>
    checkContactBirthday(await loadBirthdayContacts(ctx.orgId), {
      today: ctx.calendar.localDay(ctx.now),
      existing: ctx.existing,
    }),
}

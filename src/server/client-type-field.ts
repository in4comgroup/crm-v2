import "server-only"

// The org's «Тип клиента» custom field — the `select` field of entity
// `client` with `config.systemKey = "client_type"` (spec
// docs/specs/clients-contacts/01-custom-fields.md, decision Q12; converted
// from the old `client.custom_fields.type`). Read by the analytics
// «Тип клиента» slices and the stage-rule guard `client_type = X`.
// Values live in `client.custom_values[<fieldId>]` (the option id).

import { and, asc, eq, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { client, customField } from "@/db/schema"
import type { CustomFieldConfig } from "@/lib/custom-fields"

export type ClientTypeField = {
  fieldId: string
  /** Option id → label (archived options included, so old values keep a label). */
  labels: Record<string, string>
}

/**
 * The org's client-type field, or null when the org has none. A live field
 * wins over an archived one; the oldest wins among equals.
 */
export async function loadClientTypeField(orgId: string): Promise<ClientTypeField | null> {
  const [row] = await db
    .select({ id: customField.id, config: customField.config })
    .from(customField)
    .where(
      and(
        eq(customField.organizationId, orgId),
        eq(customField.entity, "client"),
        sql`${customField.config} ->> 'systemKey' = 'client_type'`,
      ),
    )
    .orderBy(sql`${customField.archivedAt} is not null`, asc(customField.createdAt))
    .limit(1)
  if (!row) return null
  const options = ((row.config ?? {}) as CustomFieldConfig).options ?? []
  return { fieldId: row.id, labels: Object.fromEntries(options.map((o) => [o.id, o.label])) }
}

/** The client's type: option id + label (both null when unset / no field). */
export async function loadClientTypeValue(
  orgId: string,
  clientId: string,
): Promise<{ type: string | null; typeLabel: string | null }> {
  const field = await loadClientTypeField(orgId)
  if (!field) return { type: null, typeLabel: null }
  const [r] = await db
    .select({ values: client.customValues })
    .from(client)
    .where(and(eq(client.id, clientId), eq(client.organizationId, orgId)))
  const raw = (r?.values ?? {})[field.fieldId]
  const type = typeof raw === "string" && raw.trim() ? raw.trim() : null
  return { type, typeLabel: type ? (field.labels[type] ?? null) : null }
}

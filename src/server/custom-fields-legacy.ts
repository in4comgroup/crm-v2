import "server-only"

// One-time, idempotent conversion of the old keys of the system bag
// `client.custom_fields` into org custom fields (spec
// docs/specs/clients-contacts/01-custom-fields.md, decision Q12):
//   • `type`   → a `select` field «Тип клиента» with `config.systemKey =
//                "client_type"` (option id = the old value, so values copy
//                1:1); read by analytics and the stage-rule guard.
//   • `tax_ID` → a `text` field «ИНН».
// Each value moves into `client.custom_values[<fieldId>]` and the old key is
// removed. `discount` / `companyKind` stay. A system data move: no value-log
// rows. A second run finds no old keys and changes nothing. Not a migration —
// tenant data never goes into one; an admin runs this once per org.

import { randomUUID } from "node:crypto"
import { and, eq, isNull, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { client, customField } from "@/db/schema"
import type { CustomFieldConfig, CustomFieldOption } from "@/lib/custom-fields"
import { loadClientTypeField } from "@/server/client-type-field"

/** Labels of the old hard-coded `type` values — used only by this mapping. */
const LEGACY_TYPE_LABELS: Record<string, string> = {
  on_trade: "On-trade",
  off_trade: "Off-trade",
  own_needs: "Own needs",
  internet_shop: "Internet shop",
}

const TYPE_LABEL = "Тип клиента"
const TAX_LABEL = "ИНН"

export type LegacyKeyResult = {
  fieldId: string
  fieldCreated: boolean
  /** Options added to an existing field (type only). */
  optionsAdded: number
  /** Companies whose value moved into `custom_values`. */
  valuesMoved: number
  /** Companies that had the key (moved + empty / already set). */
  keysRemoved: number
}

export type LegacyConversionResult = {
  orgId: string
  type: LegacyKeyResult | null
  taxId: LegacyKeyResult | null
}

type BatchOps = Parameters<typeof db.batch>[0]

async function nextPosition(orgId: string): Promise<number> {
  const [r] = await db
    .select({ max: sql<number | null>`max(${customField.position})` })
    .from(customField)
    .where(and(eq(customField.organizationId, orgId), eq(customField.entity, "client")))
  return r?.max == null ? 0 : Number(r.max) + 1
}

/** A live client field with this label (case-insensitive), if any. */
async function findLiveFieldByLabel(orgId: string, label: string) {
  const [r] = await db
    .select({ id: customField.id, type: customField.type, config: customField.config })
    .from(customField)
    .where(
      and(
        eq(customField.organizationId, orgId),
        eq(customField.entity, "client"),
        isNull(customField.archivedAt),
        sql`lower(${customField.label}) = ${label.toLowerCase()}`,
      ),
    )
    .limit(1)
  return r ?? null
}

/** Rows of the org that still carry `custom_fields -> key`, with the text value. */
async function legacyRows(orgId: string, key: string) {
  return db
    .select({ id: client.id, value: sql<string | null>`${client.customFields} ->> ${key}::text` })
    .from(client)
    .where(and(eq(client.organizationId, orgId), sql`${client.customFields} ? ${key}::text`))
}

/**
 * Move `custom_fields -> key` into `custom_values -> fieldId` for every row
 * of the org that has the key: a non-empty value is copied unless the row
 * already has a value for the field (the newer value wins); the old key is
 * always removed. `updated_at` is kept.
 */
function moveOp(orgId: string, key: string, fieldId: string) {
  return db
    .update(client)
    .set({
      customValues: sql`case
        when nullif(btrim(${client.customFields} ->> ${key}::text), '') is not null
          and not (${client.customValues} ? ${fieldId}::text)
        then ${client.customValues} || jsonb_build_object(${fieldId}::text, btrim(${client.customFields} ->> ${key}::text))
        else ${client.customValues}
      end`,
      customFields: sql`${client.customFields} - ${key}::text`,
      updatedAt: sql`${client.updatedAt}`,
    })
    .where(and(eq(client.organizationId, orgId), sql`${client.customFields} ? ${key}::text`))
}

async function convertType(orgId: string, userId: string | null): Promise<LegacyKeyResult | null> {
  const rows = await legacyRows(orgId, "type")
  if (rows.length === 0) return null
  const values = [...new Set(rows.map((r) => (r.value ?? "").trim()).filter(Boolean))].sort()
  const moved = rows.filter((r) => (r.value ?? "").trim()).length

  const existing = await loadClientTypeField(orgId)
  const ops: unknown[] = []
  let fieldId: string
  let optionsAdded = 0
  let fieldCreated = false
  if (existing) {
    fieldId = existing.fieldId
    // Reuse: add any stored value that is not an option yet.
    const missing = values.filter((v) => !(v in existing.labels))
    if (missing.length) {
      const [cur] = await db.select({ config: customField.config }).from(customField).where(eq(customField.id, fieldId))
      const config = (cur?.config ?? {}) as CustomFieldConfig
      const options: CustomFieldOption[] = [
        ...(config.options ?? []),
        ...missing.map((v) => ({ id: v, label: LEGACY_TYPE_LABELS[v] ?? v })),
      ]
      optionsAdded = missing.length
      ops.push(
        db
          .update(customField)
          .set({ config: { ...config, options }, updatedByUserId: userId })
          .where(and(eq(customField.organizationId, orgId), eq(customField.id, fieldId))),
      )
    }
  } else {
    fieldId = randomUUID()
    fieldCreated = true
    // A label clash with an owner field keeps both apart.
    const clash = await findLiveFieldByLabel(orgId, TYPE_LABEL)
    const config: CustomFieldConfig = {
      options: values.map((v) => ({ id: v, label: LEGACY_TYPE_LABELS[v] ?? v })),
      systemKey: "client_type",
    }
    ops.push(
      db.insert(customField).values({
        id: fieldId,
        organizationId: orgId,
        entity: "client",
        label: clash ? `${TYPE_LABEL} (система)` : TYPE_LABEL,
        type: "select",
        config,
        isShown: true,
        position: await nextPosition(orgId),
        createdByUserId: userId,
        updatedByUserId: userId,
      }),
    )
  }
  ops.push(moveOp(orgId, "type", fieldId))
  await db.batch(ops as unknown as BatchOps)
  return { fieldId, fieldCreated, optionsAdded, valuesMoved: moved, keysRemoved: rows.length }
}

async function convertTaxId(orgId: string, userId: string | null): Promise<LegacyKeyResult | null> {
  const rows = await legacyRows(orgId, "tax_ID")
  if (rows.length === 0) return null
  const moved = rows.filter((r) => (r.value ?? "").trim()).length

  const ops: unknown[] = []
  const existing = await findLiveFieldByLabel(orgId, TAX_LABEL)
  let fieldId: string
  let fieldCreated = false
  if (existing && existing.type === "text") {
    fieldId = existing.id
  } else {
    fieldId = randomUUID()
    fieldCreated = true
    ops.push(
      db.insert(customField).values({
        id: fieldId,
        organizationId: orgId,
        entity: "client",
        label: existing ? `${TAX_LABEL} (из старых данных)` : TAX_LABEL,
        type: "text",
        config: { multiline: false },
        isShown: true,
        position: await nextPosition(orgId),
        createdByUserId: userId,
        updatedByUserId: userId,
      }),
    )
  }
  ops.push(moveOp(orgId, "tax_ID", fieldId))
  await db.batch(ops as unknown as BatchOps)
  return { fieldId, fieldCreated, optionsAdded: 0, valuesMoved: moved, keysRemoved: rows.length }
}

/**
 * Convert the old `type` / `tax_ID` keys of one org's companies (Q12).
 * Idempotent: fields are reused (type by `systemKey`, ИНН by label) and the
 * moved keys are gone, so a second run returns `{ type: null, taxId: null }`.
 * `userId` = who runs it (stamped on new fields), null for a system run.
 */
export async function convertLegacyClientCustomFields(
  orgId: string,
  userId: string | null,
): Promise<LegacyConversionResult> {
  const type = await convertType(orgId, userId)
  const taxId = await convertTaxId(orgId, userId)
  return { orgId, type, taxId }
}

/** Orgs whose companies still carry an old `type` / `tax_ID` key. */
export async function listOrgsWithLegacyClientCustomFields(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ orgId: client.organizationId })
    .from(client)
    .where(sql`${client.customFields} ?| array['type', 'tax_ID']`)
  return rows.map((r) => r.orgId).filter((x): x is string => !!x)
}

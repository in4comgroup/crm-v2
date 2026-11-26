import "server-only"

// Org custom fields of companies and contacts
// (docs/specs/clients-contacts/01-custom-fields.md). Org-explicit core
// functions (the routes pass the active org from the session) + the
// session gate `customFieldsSession()`. Definitions: org OWNER only; values:
// every member. Values live in `client.custom_values` / `contact.custom_values`
// keyed by the field id; every changed value writes one log row (Q9).

import { randomUUID } from "node:crypto"
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { client, contact, customField, customFieldValueLog, user } from "@/db/schema"
import { getServerSession } from "@/lib/get-session"
import {
  convertValueForType,
  customFieldInputSchema,
  customValuesText,
  CUSTOM_FIELD_LIMITS,
  isAllowedTypeChange,
  validateCustomValue,
  type CustomFieldConfig,
  type CustomFieldDef,
  type CustomFieldEntity,
  type CustomFieldFilter,
  type CustomFieldOption,
  type CustomFieldType,
} from "@/lib/custom-fields"
import {
  CLIENT_STANDARD_FIELDS,
  CONTACT_STANDARD_FIELDS,
  validateStandardPatch,
  type StandardValues,
} from "@/lib/standard-fields"
import { getActiveOrgRole } from "@/server/sources"

export class CustomFieldError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 403 | 404 | 409 = 400,
  ) {
    super(message)
    this.name = "CustomFieldError"
  }
}

type BatchOps = Parameters<typeof db.batch>[0]
const asBatch = (ops: unknown[]) => ops as unknown as BatchOps

const iso = (d: Date | null) => (d ? d.toISOString() : null)

function rowToDef(r: typeof customField.$inferSelect): CustomFieldDef {
  return {
    id: r.id,
    entity: r.entity as CustomFieldEntity,
    label: r.label,
    type: r.type as CustomFieldType,
    config: (r.config ?? {}) as CustomFieldConfig,
    helpText: r.helpText,
    section: r.section,
    isShown: r.isShown,
    showInList: r.showInList,
    position: r.position,
    archivedAt: iso(r.archivedAt),
  }
}

const entityTable = (e: CustomFieldEntity) => (e === "client" ? client : contact)

// ── Session gate ──────────────────────────────────────────────────────────

/** Active org + the caller's role; throws 401 without a session / org. */
export async function customFieldsSession(): Promise<{ orgId: string; userId: string; isOwner: boolean }> {
  const session = await getServerSession()
  if (!session?.user) throw new CustomFieldError("Unauthorized", 401)
  const role = await getActiveOrgRole()
  if (!role) throw new CustomFieldError("Нет активной организации", 401)
  return { orgId: role.organizationId, userId: session.user.id, isOwner: role.role === "owner" }
}

// ── Definitions ───────────────────────────────────────────────────────────

export async function listCustomFields(
  orgId: string,
  entity: CustomFieldEntity,
  opts: { includeArchived?: boolean } = {},
): Promise<CustomFieldDef[]> {
  const rows = await db
    .select()
    .from(customField)
    .where(
      and(
        eq(customField.organizationId, orgId),
        eq(customField.entity, entity),
        ...(opts.includeArchived ? [] : [isNull(customField.archivedAt)]),
      ),
    )
    .orderBy(asc(customField.position), asc(customField.createdAt))
  return rows.map(rowToDef)
}

async function loadField(orgId: string, id: string) {
  const [r] = await db
    .select()
    .from(customField)
    .where(and(eq(customField.organizationId, orgId), eq(customField.id, id)))
  if (!r) throw new CustomFieldError("Поле не найдено", 404)
  return r
}

function parseInput(raw: unknown) {
  const parsed = customFieldInputSchema.safeParse(raw)
  if (!parsed.success) throw new CustomFieldError(parsed.error.issues[0]?.message ?? "Неверные данные поля")
  const v = parsed.data
  const config: CustomFieldConfig = {}
  if (v.type === "select" || v.type === "multiselect") config.options = v.config.options ?? []
  if (v.type === "currency") config.currency = v.config.currency ?? "RUB"
  if (v.type === "number" || v.type === "currency") config.decimals = v.config.decimals ?? 2
  if (v.type === "text") config.multiline = !!v.config.multiline
  return { ...v, config, helpText: v.helpText || null, section: v.section || null }
}

async function assertUniqueLabel(orgId: string, entity: CustomFieldEntity, label: string, exceptId?: string) {
  const rows = await db
    .select({ id: customField.id })
    .from(customField)
    .where(
      and(
        eq(customField.organizationId, orgId),
        eq(customField.entity, entity),
        isNull(customField.archivedAt),
        sql`lower(${customField.label}) = ${label.trim().toLowerCase()}`,
      ),
    )
  if (rows.some((r) => r.id !== exceptId)) throw new CustomFieldError(`Поле «${label}» уже есть`, 409)
}

export async function createCustomField(orgId: string, userId: string, raw: unknown): Promise<CustomFieldDef> {
  const v = parseInput(raw)
  const existing = await listCustomFields(orgId, v.entity)
  if (existing.length >= CUSTOM_FIELD_LIMITS.fieldsPerEntity) {
    throw new CustomFieldError(`Не больше ${CUSTOM_FIELD_LIMITS.fieldsPerEntity} полей`, 409)
  }
  await assertUniqueLabel(orgId, v.entity, v.label)
  const [row] = await db
    .insert(customField)
    .values({
      id: randomUUID(),
      organizationId: orgId,
      entity: v.entity,
      label: v.label,
      type: v.type,
      config: v.config,
      helpText: v.helpText,
      section: v.section,
      isShown: v.isShown,
      showInList: v.showInList,
      position: existing.length ? Math.max(...existing.map((f) => f.position)) + 1 : 0,
      createdByUserId: userId,
      updatedByUserId: userId,
    })
    .returning()
  return rowToDef(row)
}

/**
 * Change a field (§3.4). The entity never changes; a type change only when
 * `isAllowedTypeChange` (else 409) — select → multiselect converts stored
 * values. Options dropped from the input but known before stay as ARCHIVED
 * options, so stored values keep their label.
 */
export async function updateCustomField(orgId: string, userId: string, id: string, raw: unknown): Promise<CustomFieldDef> {
  const cur = await loadField(orgId, id)
  const v = parseInput({ ...(raw as object), entity: cur.entity })
  const from = cur.type as CustomFieldType
  if (!isAllowedTypeChange(from, v.type)) {
    throw new CustomFieldError("Тип поля с данными менять нельзя — создайте новое поле", 409)
  }
  await assertUniqueLabel(orgId, cur.entity as CustomFieldEntity, v.label, id)
  // A system role is set by code only; an owner edit keeps it.
  const sysKey = ((cur.config ?? {}) as CustomFieldConfig).systemKey
  if (sysKey) v.config.systemKey = sysKey
  if (sysKey && v.type !== from) throw new CustomFieldError("Тип этого поля менять нельзя — его читает аналитика", 409)
  if (v.config.options) {
    const before = ((cur.config ?? {}) as CustomFieldConfig).options ?? []
    const keep = new Set(v.config.options.map((o) => o.id))
    const dropped: CustomFieldOption[] = before.filter((o) => !keep.has(o.id)).map((o) => ({ ...o, archived: true }))
    v.config.options = [...v.config.options, ...dropped]
  }
  const ops: unknown[] = [
    db
      .update(customField)
      .set({
        label: v.label,
        type: v.type,
        config: v.config,
        helpText: v.helpText,
        section: v.section,
        isShown: v.isShown,
        showInList: v.showInList,
        updatedByUserId: userId,
      })
      .where(and(eq(customField.organizationId, orgId), eq(customField.id, id))),
  ]
  if (from !== v.type && convertValueForType("x", from, v.type) !== "x") {
    const t = entityTable(cur.entity as CustomFieldEntity)
    // select → multiselect: "id" → ["id"] in every row of the org.
    ops.push(
      db
        .update(t)
        .set({
          customValues: sql`jsonb_set(${t.customValues}, ARRAY[${id}]::text[], jsonb_build_array(${t.customValues} -> ${id}))`,
          updatedAt: sql`${t.updatedAt}`,
        })
        .where(and(eq(t.organizationId, orgId), sql`jsonb_typeof(${t.customValues} -> ${id}) = 'string'`)),
    )
  }
  await db.batch(asBatch(ops))
  return rowToDef(await loadField(orgId, id))
}

/** New order of the entity's fields (ids not listed keep their place after). */
export async function reorderCustomFields(orgId: string, userId: string, entity: CustomFieldEntity, ids: string[]): Promise<void> {
  const all = await listCustomFields(orgId, entity, { includeArchived: true })
  const known = new Set(all.map((f) => f.id))
  const order = [...ids.filter((x) => known.has(x)), ...all.map((f) => f.id).filter((x) => !ids.includes(x))]
  await db.batch(
    asBatch(
      order.map((fid, i) =>
        db
          .update(customField)
          .set({ position: i, updatedByUserId: userId })
          .where(and(eq(customField.organizationId, orgId), eq(customField.id, fid))),
      ),
    ),
  )
}

/** «Удалить» = archive; «Восстановить» = back (Q6). Values are kept. */
export async function setCustomFieldArchived(orgId: string, userId: string, id: string, archived: boolean): Promise<CustomFieldDef> {
  const cur = await loadField(orgId, id)
  if (!archived) {
    await assertUniqueLabel(orgId, cur.entity as CustomFieldEntity, cur.label, id)
    const active = await listCustomFields(orgId, cur.entity as CustomFieldEntity)
    if (active.length >= CUSTOM_FIELD_LIMITS.fieldsPerEntity) {
      throw new CustomFieldError(`Не больше ${CUSTOM_FIELD_LIMITS.fieldsPerEntity} полей`, 409)
    }
  }
  await db
    .update(customField)
    .set({ archivedAt: archived ? new Date() : null, updatedByUserId: userId })
    .where(and(eq(customField.organizationId, orgId), eq(customField.id, id)))
  return rowToDef(await loadField(orgId, id))
}

/**
 * «Удалить навсегда» (Q6): only an ARCHIVED field, with the typed label as
 * confirmation. Removes the values from every row and the definition (its
 * value log goes by cascade).
 */
export async function deleteCustomFieldForever(orgId: string, id: string, confirmLabel: string): Promise<void> {
  const cur = await loadField(orgId, id)
  if (!cur.archivedAt) throw new CustomFieldError("Сначала удалите поле в архив", 409)
  if (confirmLabel.trim() !== cur.label.trim()) throw new CustomFieldError("Название поля введено неверно")
  const t = entityTable(cur.entity as CustomFieldEntity)
  await db.batch(
    asBatch([
      db
        .update(t)
        .set({ customValues: sql`${t.customValues} - ${id}`, updatedAt: sql`${t.updatedAt}` })
        .where(and(eq(t.organizationId, orgId), sql`${t.customValues} ? ${id}`)),
      db.delete(customField).where(and(eq(customField.organizationId, orgId), eq(customField.id, id))),
    ]),
  )
}

// ── Values ────────────────────────────────────────────────────────────────

async function loadRowValues(orgId: string, entity: CustomFieldEntity, entityId: string): Promise<Record<string, unknown>> {
  const t = entityTable(entity)
  const [r] = await db
    .select({ values: t.customValues })
    .from(t)
    .where(and(eq(t.organizationId, orgId), eq(t.id, entityId)))
  if (!r) throw new CustomFieldError(entity === "client" ? "Компания не найдена" : "Контакт не найден", 404)
  return (r.values ?? {}) as Record<string, unknown>
}

export type CustomValuesView = {
  /** Non-archived fields in order (hidden ones too, flagged — the tab shows `isShown` only). */
  fields: CustomFieldDef[]
  values: Record<string, unknown>
  /** Standard fields (real columns, src/lib/standard-fields.ts): key → value. */
  standard: StandardValues
  canManage: boolean
}

export async function getCustomValues(
  orgId: string,
  entity: CustomFieldEntity,
  entityId: string,
  canManage: boolean,
): Promise<CustomValuesView> {
  const [fields, values, standard] = await Promise.all([
    listCustomFields(orgId, entity),
    loadRowValues(orgId, entity, entityId),
    loadStandardValues(orgId, entity, entityId),
  ])
  return { fields, values, standard, canManage }
}

// ── Standard fields (columns; docs/specs/clients-contacts/10-standard-fields.md)

const clientStandardCols = {
  legalName: client.legalName,
  legalAddress: client.legalAddress,
  inn: client.inn,
  kpp: client.kpp,
  ogrn: client.ogrn,
  bankAccount: client.bankAccount,
  bankName: client.bankName,
  bankBik: client.bankBik,
  bankCorrAccount: client.bankCorrAccount,
} satisfies Record<(typeof CLIENT_STANDARD_FIELDS)[number]["key"], unknown>

const contactStandardCols = {
  birthday: contact.birthday,
} satisfies Record<(typeof CONTACT_STANDARD_FIELDS)[number]["key"], unknown>

async function loadStandardValues(orgId: string, entity: CustomFieldEntity, entityId: string): Promise<StandardValues> {
  if (entity === "client") {
    const [r] = await db
      .select(clientStandardCols)
      .from(client)
      .where(and(eq(client.organizationId, orgId), eq(client.id, entityId)))
    if (!r) throw new CustomFieldError("Компания не найдена", 404)
    return r
  }
  const [r] = await db
    .select(contactStandardCols)
    .from(contact)
    .where(and(eq(contact.organizationId, orgId), eq(contact.id, entityId)))
  if (!r) throw new CustomFieldError("Контакт не найден", 404)
  return r
}

/**
 * Save standard fields of ONE company / contact (any member). `input` =
 * { key: value | null }; every value validated + normalised by
 * `validateStandardPatch`; only changed columns are written.
 */
export async function saveStandardValues(
  orgId: string,
  entity: CustomFieldEntity,
  entityId: string,
  input: Record<string, unknown>,
): Promise<{ standard: StandardValues; changed: number }> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new CustomFieldError("Неверные данные")
  const check = validateStandardPatch(entity, input)
  if (!check.ok) throw new CustomFieldError(Object.values(check.errors)[0] ?? "Неверные данные")
  const current = await loadStandardValues(orgId, entity, entityId)
  const patch: StandardValues = {}
  for (const [key, value] of Object.entries(check.values)) {
    if ((current[key] ?? null) !== value) patch[key] = value
  }
  const changed = Object.keys(patch).length
  if (changed === 0) return { standard: current, changed: 0 }
  const t = entityTable(entity)
  await db
    .update(t)
    .set(patch)
    .where(and(eq(t.organizationId, orgId), eq(t.id, entityId)))
  return { standard: { ...current, ...patch }, changed }
}

/**
 * Save values of ONE company / contact (any member). `input` = { fieldId:
 * value | null }; only fields that are shown and not archived; every value
 * validated by its type; only CHANGED values are written, each with one log
 * row. One `db.batch`.
 */
export async function saveCustomValues(
  orgId: string,
  userId: string,
  entity: CustomFieldEntity,
  entityId: string,
  input: Record<string, unknown>,
): Promise<{ values: Record<string, unknown>; changed: number }> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new CustomFieldError("Неверные данные")
  const [fields, current] = await Promise.all([listCustomFields(orgId, entity), loadRowValues(orgId, entity, entityId)])
  const byId = new Map(fields.map((f) => [f.id, f]))
  const next: Record<string, unknown> = { ...current }
  const logs: unknown[] = []
  for (const [fid, raw] of Object.entries(input)) {
    const def = byId.get(fid)
    if (!def || !def.isShown) throw new CustomFieldError("Поле скрыто или удалено — обновите страницу", 409)
    const check = validateCustomValue(def, raw, current[fid])
    if (!check.ok) throw new CustomFieldError(check.message)
    const before = current[fid] ?? null
    const after = check.value
    if (JSON.stringify(before) === JSON.stringify(after)) continue
    if (after === null) delete next[fid]
    else next[fid] = after
    logs.push(
      db.insert(customFieldValueLog).values({
        id: randomUUID(),
        organizationId: orgId,
        entity,
        entityId,
        fieldId: fid,
        before,
        after,
        changedByUserId: userId,
      }),
    )
  }
  if (logs.length === 0) return { values: current, changed: 0 }
  const t = entityTable(entity)
  await db.batch(
    asBatch([
      db
        .update(t)
        .set({ customValues: next })
        .where(and(eq(t.organizationId, orgId), eq(t.id, entityId))),
      ...logs,
    ]),
  )
  return { values: next, changed: logs.length }
}

export type CustomValueHistoryRow = {
  id: string
  fieldId: string
  before: unknown
  after: unknown
  changedBy: string | null
  createdAt: string
}

/** Last 50 changes of one company / contact (one field when `fieldId`). */
export async function listCustomValueHistory(
  orgId: string,
  entity: CustomFieldEntity,
  entityId: string,
  fieldId?: string | null,
): Promise<CustomValueHistoryRow[]> {
  await loadRowValues(orgId, entity, entityId) // tenant check
  const rows = await db
    .select({ l: customFieldValueLog, name: user.name })
    .from(customFieldValueLog)
    .leftJoin(user, eq(user.id, customFieldValueLog.changedByUserId))
    .where(
      and(
        eq(customFieldValueLog.organizationId, orgId),
        eq(customFieldValueLog.entity, entity),
        eq(customFieldValueLog.entityId, entityId),
        ...(fieldId ? [eq(customFieldValueLog.fieldId, fieldId)] : []),
      ),
    )
    .orderBy(desc(customFieldValueLog.createdAt))
    .limit(50)
  return rows.map(({ l, name }) => ({
    id: l.id,
    fieldId: l.fieldId,
    before: l.before,
    after: l.after,
    changedBy: name ?? null,
    createdAt: l.createdAt.toISOString(),
  }))
}

// ── AI text (Q11) ─────────────────────────────────────────────────────────

/**
 * «Название: значение» lines of the SHOWN fields per company / contact id
 * (spec §4, Q11) — for the AI chat and the topics prompts. Hidden and
 * archived fields never reach the AI. Ids of another org are ignored.
 */
export async function loadCustomValuesText(
  orgId: string,
  entity: CustomFieldEntity,
  ids: readonly string[],
  maxChars = 400,
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const uniq = [...new Set(ids.filter(Boolean))]
  if (uniq.length === 0) return out
  const fields = (await listCustomFields(orgId, entity)).filter((f) => f.isShown)
  if (fields.length === 0) return out
  const t = entityTable(entity)
  const rows = await db
    .select({ id: t.id, values: t.customValues })
    .from(t)
    .where(and(eq(t.organizationId, orgId), inArray(t.id, uniq)))
  for (const r of rows) {
    const text = customValuesText(fields, (r.values ?? {}) as Record<string, unknown>, maxChars)
    if (text) out.set(r.id, text)
  }
  return out
}

// ── List filters (spec §3.5) ──────────────────────────────────────────────

/**
 * SQL conditions of parsed list filters (`parseCustomFilters`) on
 * `<table>.custom_values` — the same semantics as the PURE
 * `matchesCustomFilters`. Field ids and values are bound parameters.
 */
export function customFilterConditions(
  entity: CustomFieldEntity,
  filters: readonly CustomFieldFilter[],
  defs: readonly Pick<CustomFieldDef, "id" | "type">[],
): SQL[] {
  const t = entityTable(entity)
  const col = t.customValues
  const typeOf = new Map(defs.map((d) => [d.id, d.type]))
  const out: SQL[] = []
  for (const f of filters) {
    const id = f.fieldId
    const filled = sql`(${col} ? ${id} and ${col} -> ${id} not in ('null'::jsonb, '""'::jsonb, '[]'::jsonb))`
    switch (f.op) {
      case "filled":
        out.push(filled)
        break
      case "empty":
        out.push(sql`not ${filled}`)
        break
      case "contains":
        out.push(sql`(${col} ->> ${id}) ilike ${"%" + f.value.replace(/[\\%_]/g, (c) => "\\" + c) + "%"}`)
        break
      case "in":
        out.push(sql`(${col} ->> ${id}) in (${sql.join(f.value.map((v) => sql`${v}`), sql`, `)})`)
        break
      case "any":
        out.push(
          sql`(jsonb_typeof(${col} -> ${id}) = 'array' and (${col} -> ${id}) ?| array[${sql.join(f.value.map((v) => sql`${v}`), sql`, `)}]::text[])`,
        )
        break
      case "is":
        out.push(sql`(${col} -> ${id}) = ${f.value ? sql`'true'::jsonb` : sql`'false'::jsonb`}`)
        break
      case "range": {
        const type = typeOf.get(id)
        if (type === "date") {
          const x = sql`(${col} ->> ${id})`
          const conds: SQL[] = [sql`jsonb_typeof(${col} -> ${id}) = 'string'`]
          if (f.value.from) conds.push(sql`${x} >= ${String(f.value.from)}`)
          if (f.value.to) conds.push(sql`${x} <= ${String(f.value.to)}`)
          out.push(sql`(${sql.join(conds, sql` and `)})`)
        } else {
          const node = type === "currency" ? sql`(${col} -> ${id} -> 'amount')` : sql`(${col} -> ${id})`
          const x = sql`(${node})::numeric`
          const conds: SQL[] = [sql`jsonb_typeof(${node}) = 'number'`]
          if (typeof f.value.from === "number") conds.push(sql`${x} >= ${f.value.from}`)
          if (typeof f.value.to === "number") conds.push(sql`${x} <= ${f.value.to}`)
          out.push(sql`(${sql.join(conds, sql` and `)})`)
        }
        break
      }
    }
  }
  return out
}


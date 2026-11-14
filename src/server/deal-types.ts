import "server-only"

import { randomUUID } from "node:crypto"
import { and, asc, eq, inArray } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { dealType } from "@/db/schema"

// Per-org deal types (spec topics/01 §9.2, R13, R22). Tenant data: the
// generic defaults are created per org on first use (`ensureDefaultDealTypes`),
// never by a migration. Stage rules (`signal_stage_rule.deal_types`) and the
// auto-create dedupe name a type by `code`. Org-explicit, `server-only`:
// callers (routes, the topics engine) check the session / role themselves.

export type DealTypeRow = {
  id: string
  code: string
  labelRu: string
  sort: number
  isHidden: boolean
}

/** Generic types used by the stage-rule templates (R22). */
export const DEFAULT_DEAL_TYPES: readonly { code: string; labelRu: string }[] = [
  { code: "new_location", labelRu: "Новый клиент / новая точка" },
  { code: "listing", labelRu: "Ввод в ассортимент / листинг" },
  { code: "tender", labelRu: "Тендер" },
  { code: "supply_agreement", labelRu: "Годовой договор поставки" },
  { code: "renewal", labelRu: "Продление" },
]

const CODE_RE = /^[a-z][a-z0-9_]{1,47}$/

export class DealTypeValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "DealTypeValidationError"
  }
}

/** A non-owner tried to change the org's type list (route → 403). */
export class DealTypeForbiddenError extends Error {
  constructor(message = "Типы сделок может менять только владелец организации") {
    super(message)
    this.name = "DealTypeForbiddenError"
  }
}

/** A non-owner tried to change «Настройки стадий» (route → 403). Lives here, not in the "use server" deals.ts, which may export only async functions. */
export class FunnelStageForbiddenError extends Error {
  constructor(message = "Настройки стадий может менять только владелец организации") {
    super(message)
    this.name = "FunnelStageForbiddenError"
  }
}

const cols = {
  id: dealType.id,
  code: dealType.code,
  labelRu: dealType.labelRu,
  sort: dealType.sort,
  isHidden: dealType.isHidden,
}

/** Creates the generic types an org does not have yet (idempotent). Returns all types. */
export async function ensureDefaultDealTypes(organizationId: string): Promise<DealTypeRow[]> {
  const existing = await db.select(cols).from(dealType).where(eq(dealType.organizationId, organizationId))
  const have = new Set(existing.map((t) => t.code))
  const missing = DEFAULT_DEAL_TYPES.filter((t) => !have.has(t.code))
  if (missing.length > 0) {
    const base = existing.reduce((m, t) => Math.max(m, t.sort), -1) + 1
    await db
      .insert(dealType)
      .values(
        missing.map((t, i) => ({
          id: randomUUID(),
          organizationId,
          code: t.code,
          labelRu: t.labelRu,
          sort: base + i,
        })),
      )
      .onConflictDoNothing()
  }
  return listDealTypes(organizationId, { includeHidden: true })
}

export async function listDealTypes(
  organizationId: string,
  opts: { includeHidden?: boolean } = {},
): Promise<DealTypeRow[]> {
  const where = opts.includeHidden
    ? eq(dealType.organizationId, organizationId)
    : and(eq(dealType.organizationId, organizationId), eq(dealType.isHidden, false))
  return db.select(cols).from(dealType).where(where).orderBy(asc(dealType.sort), asc(dealType.labelRu))
}

/** Type ids by code for one org (only codes that exist). */
export async function dealTypeIdsByCode(
  organizationId: string,
  codes: readonly string[],
): Promise<Map<string, string>> {
  if (codes.length === 0) return new Map()
  const rows = await db
    .select({ id: dealType.id, code: dealType.code })
    .from(dealType)
    .where(and(eq(dealType.organizationId, organizationId), inArray(dealType.code, [...codes])))
  return new Map(rows.map((r) => [r.code, r.id]))
}

export type DealTypeInput = { id?: string; code?: string; labelRu: string; sort: number; isHidden: boolean }

/**
 * Saves the org's type list (owner edits next to «Настройки стадий»):
 * existing rows by id (label, sort, hidden — the code never changes), new
 * rows with a new code. Types are never deleted (deals and rules point to
 * them); hide instead.
 */
export async function saveDealTypes(organizationId: string, rows: readonly DealTypeInput[]): Promise<DealTypeRow[]> {
  const existing = await listDealTypes(organizationId, { includeHidden: true })
  const byId = new Map(existing.map((t) => [t.id, t]))
  const codes = new Set(existing.map((t) => t.code))
  const ops = []
  for (const r of rows) {
    const label = r.labelRu.trim()
    if (!label) throw new DealTypeValidationError("Название типа сделки не может быть пустым")
    if (label.length > 80) throw new DealTypeValidationError("Название типа сделки — не длиннее 80 символов")
    if (r.id) {
      if (!byId.has(r.id)) throw new DealTypeValidationError("Тип сделки не найден")
      ops.push(
        db
          .update(dealType)
          .set({ labelRu: label, sort: r.sort, isHidden: r.isHidden })
          .where(and(eq(dealType.id, r.id), eq(dealType.organizationId, organizationId))),
      )
    } else {
      const code = (r.code ?? "").trim()
      if (!CODE_RE.test(code)) {
        throw new DealTypeValidationError("Код типа: латиница в нижнем регистре, цифры и «_», 2–48 символов")
      }
      if (codes.has(code)) throw new DealTypeValidationError(`Тип с кодом ${code} уже есть`)
      codes.add(code)
      ops.push(
        db.insert(dealType).values({
          id: randomUUID(),
          organizationId,
          code,
          labelRu: label,
          sort: r.sort,
          isHidden: r.isHidden,
        }),
      )
    }
  }
  if (ops.length > 0) await db.batch(ops as unknown as Parameters<typeof db.batch>[0])
  return listDealTypes(organizationId, { includeHidden: true })
}

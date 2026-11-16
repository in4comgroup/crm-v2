import "server-only"

import { z } from "zod"
import {
  RECORD_TYPES,
  RECORD_TYPE_LABELS,
  TOPICS_ONLY_TYPES,
  type RecordDetail,
  type RecordListResult,
  type RecordSearchResult,
  type RecordType,
} from "@/lib/chat/records"
import { ATTENTION_DEFAULTS } from "@/lib/topics/attention-params"
import { textQuery } from "@/server/search/normalise"
import { loadAttentionParams } from "@/server/topics/attention/store"
import { topicCardsVisible } from "@/server/topics/cards/visibility"
import { cardsModule } from "./cards"
import { clientsModule } from "./clients"
import { contactsModule } from "./contacts"
import { dealsModule } from "./deals"
import { ordersModule } from "./orders"
import { productsModule } from "./products"
import { parseDay } from "./shared"
import { sourceItemsModule } from "./source-items"
import { tasksModule } from "./tasks"
import { topicsModule } from "./topics"
import { RecordsInputError, type RecordModule, type RecordsContext } from "./types"

// Records engine of the AI chat (docs/specs/ai-chat/01-specification.md §6):
// ONE read-only search / list / detail API over the org's CRM records. The
// chat tools (CH4) and `GET /api/chat/records` (CH3) call only this file.
// Every function takes a RecordsContext built from the SESSION (org + user);
// nothing here trusts a model-supplied org.

export { RecordsInputError, type RecordsContext } from "./types"

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous filter types, validated per module
const MODULES: Record<RecordType, RecordModule<any>> = {
  client: clientsModule,
  contact: contactsModule,
  deal: dealsModule,
  order: ordersModule,
  product: productsModule,
  task: tasksModule,
  topic: topicsModule,
  card: cardsModule,
  source_item: sourceItemsModule,
}

export const SEARCH_LIMIT_DEFAULT = 10
export const SEARCH_LIMIT_MAX = 25
export const LIST_LIMIT_DEFAULT = 20
export const LIST_LIMIT_MAX = 50

/** Context for one request: org + user from the session, topics gate, org time zone. */
export async function loadRecordsContext(orgId: string, userId: string, now: Date = new Date()): Promise<RecordsContext> {
  const [topicsVisible, timeZone] = await Promise.all([
    topicCardsVisible(orgId).catch(() => false),
    loadAttentionParams(orgId)
      .then((p) => p.timeZone)
      .catch(() => ATTENTION_DEFAULTS.timeZone),
  ])
  return { orgId, userId, topicsVisible, now, timeZone }
}

/** Types the user can see: topics / cards only in topics mode `on`. */
export function visibleRecordTypes(ctx: RecordsContext): RecordType[] {
  return RECORD_TYPES.filter((t) => ctx.topicsVisible || !TOPICS_ONLY_TYPES.includes(t))
}

function clampLimit(v: number | undefined, def: number, max: number): number {
  if (v == null || !Number.isFinite(v)) return def
  return Math.min(Math.max(Math.trunc(v), 1), max)
}

/**
 * Free-text search across record types (spec §6.3 `searchRecords`). Types
 * run in parallel; one failing type is logged and reported in `failed`, the
 * others still answer. A query shorter than 2 characters returns nothing.
 */
export async function searchRecords(
  ctx: RecordsContext,
  input: { query: string; types?: RecordType[]; dateFrom?: string; dateTo?: string; limitPerType?: number },
): Promise<RecordSearchResult> {
  const visible = visibleRecordTypes(ctx)
  const types = input.types?.length ? visible.filter((t) => input.types!.includes(t)) : visible
  const tq = textQuery(input.query)
  const empty: RecordSearchResult = { query: input.query.trim(), types, counts: {}, hits: {}, failed: [] }
  if (!tq || types.length === 0) return empty

  const opts = {
    dateFrom: parseDay(input.dateFrom, false, ctx.timeZone),
    dateTo: parseDay(input.dateTo, true, ctx.timeZone),
    limit: clampLimit(input.limitPerType, SEARCH_LIMIT_DEFAULT, SEARCH_LIMIT_MAX),
  }
  const settled = await Promise.allSettled(types.map((t) => MODULES[t].search(ctx, tq, opts)))
  const out: RecordSearchResult = { ...empty, query: tq.q }
  settled.forEach((r, i) => {
    const t = types[i]
    if (r.status === "fulfilled") {
      out.counts[t] = { total: r.value.total, capped: r.value.capped }
      out.hits[t] = r.value.hits
    } else {
      console.error(`[chat-records] search ${t} failed (org ${ctx.orgId})`, r.reason)
      out.failed.push(t)
    }
  })
  return out
}

/** Structured list of one type (spec §6.3 `listRecords`). Throws RecordsInputError on bad input. */
export async function listRecords(
  ctx: RecordsContext,
  input: { type: RecordType; filters?: unknown; sort?: string; limit?: number },
): Promise<RecordListResult> {
  if (!visibleRecordTypes(ctx).includes(input.type)) {
    throw new RecordsInputError(`Тип «${RECORD_TYPE_LABELS[input.type]?.many ?? input.type}» недоступен`)
  }
  const mod = MODULES[input.type]
  const parsed = mod.filterSchema.safeParse(input.filters ?? {})
  if (!parsed.success) {
    throw new RecordsInputError(
      `Неверные фильтры для «${RECORD_TYPE_LABELS[input.type].many}»: ${z.prettifyError(parsed.error)}`,
    )
  }
  const sort = input.sort ?? mod.sortKeys[0]
  if (!mod.sortKeys.includes(sort)) {
    throw new RecordsInputError(`Неверная сортировка «${sort}»; допустимо: ${mod.sortKeys.join(", ")}`)
  }
  const limit = clampLimit(input.limit, LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX)
  const r = await mod.list(ctx, parsed.data, sort, limit)
  return { type: input.type, total: r.total, capped: r.capped, rows: r.rows, applied: r.applied }
}

/** Detail of one record (spec §7.2); null = not found / another org / not visible. */
export async function getRecord(ctx: RecordsContext, type: RecordType, id: string): Promise<RecordDetail | null> {
  if (!visibleRecordTypes(ctx).includes(type) || !id) return null
  return MODULES[type].get(ctx, id)
}

/** Filter schema + sort keys per type, for the chat tool input schema (CH4). */
export function recordListSpec(type: RecordType): { filterSchema: z.ZodType; sortKeys: readonly string[] } {
  return { filterSchema: MODULES[type].filterSchema, sortKeys: MODULES[type].sortKeys }
}

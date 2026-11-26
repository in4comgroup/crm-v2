import "server-only"

import type { z } from "zod"
import type {
  AppliedFilter,
  RecordDetail,
  RecordHit,
  RecordType,
} from "@/lib/chat/records"
import type { TextQuery } from "@/server/search/normalise"

// Records engine of the AI chat (docs/specs/ai-chat/01-specification.md §6).
// One module per record type, all org-explicit (AGENTS.md rules 4–5): the
// org id comes from the caller's session and is bound into the context —
// it is never a model input.

export type RecordsContext = {
  orgId: string
  /** The signed-in user ("me" in filters). */
  userId: string
  /** Topics mode `on` → topics and topic cards exist for users (spec §6.1). */
  topicsVisible: boolean
  now: Date
  /** Org time zone (IANA) for dates shown to the user. */
  timeZone: string
  /** «Срок задачи по умолчанию» (HH:MM, org time) for task deadlines without a time. */
  defaultDueTime: string
}

export type SearchOptions = {
  /** Inclusive range on the type's own date (mail date, order date, …); ignored by types without one. */
  dateFrom: Date | null
  dateTo: Date | null
  /** Max hits returned (the total is counted separately, capped at RECORD_COUNT_CAP). */
  limit: number
}

export type SearchOutcome = { hits: RecordHit[]; total: number; capped: boolean }

export type ListOutcome = {
  rows: RecordHit[]
  total: number
  capped: boolean
  /** The filters as the user should read them (chips above the rows). */
  applied: AppliedFilter[]
}

/**
 * One record type. `filterSchema` validates the structured filters of
 * `listRecords` (values from whitelists; "me" = the signed-in user) and is
 * reused for the chat tool's input schema (CH4).
 */
export interface RecordModule<F extends Record<string, unknown> = Record<string, unknown>> {
  type: RecordType
  filterSchema: z.ZodType<F>
  /** Allowed sort keys; the first one is the default. */
  sortKeys: readonly [string, ...string[]]
  search(ctx: RecordsContext, tq: TextQuery, opts: SearchOptions): Promise<SearchOutcome>
  list(ctx: RecordsContext, filters: F, sort: string, limit: number): Promise<ListOutcome>
  /** null = not found, another org's, or not visible to users. */
  get(ctx: RecordsContext, id: string): Promise<RecordDetail | null>
}

/** Invalid structured input (filters / sort / type); message is Russian, safe to show the model. */
export class RecordsInputError extends Error {}

/**
 * Output guard (spec §11): drop any row whose org is not the context org.
 * Every query already filters by org — this catches a bug in a join, it
 * never decides access. Logs loudly when it fires.
 */
export function keepOwnOrg<T extends { organizationId: string | null }>(
  ctx: RecordsContext,
  type: RecordType,
  rows: T[],
): T[] {
  const own = rows.filter((r) => r.organizationId === ctx.orgId)
  if (own.length !== rows.length) {
    console.error(
      `[chat-records] ${type}: dropped ${rows.length - own.length} row(s) of another org (org ${ctx.orgId})`,
    )
  }
  return own
}

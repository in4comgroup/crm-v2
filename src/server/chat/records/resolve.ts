import "server-only"

import { and, desc, eq, isNull, ne, notInArray, sql, type AnyColumn, type SQL } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { client, contact, deal } from "@/db/schema"
import {
  containsQuery,
  norm,
  relevanceOf,
  textQuery,
} from "@/server/search/normalise"
import { nameList } from "./format"
import type { RecordsContext } from "./types"

// Name filters of `listRecords` («Компания», «Контакт», «Сделка») → record ids.
// ONE resolver for every module, because a wrong match here silently filters
// on the wrong company. Order:
//   1. exact id;
//   2. literal: the whole normalised value is a substring of a name field;
//   3. strict fuzzy: best word_similarity ≥ NAME_FILTER_FUZZY_MIN (0.5).
// Step 3 is stricter than search (0.3) on purpose: at 0.3 a multi-word value
// matched any name sharing ONE common word — «Несуществующая компания» became
// «AST – Российская Алкогольная Компания». Search may be generous (the user
// sees a ranked list); a filter must not be.

export const NAME_FILTER_FUZZY_MIN = 0.5
/** Fuzzy matches more than this below the best one are dropped. */
export const NAME_FILTER_NEAR_BEST = 0.1

export type NamedMatch = { id: string; name: string }

type Spec = {
  idCol: AnyColumn
  nameCol: AnyColumn
  /** Normalised name fields (fuzzy + literal). */
  fields: SQL[]
  /** Extra literal-only fields (e-mail). */
  literalOnly?: SQL[]
  /** Org + visibility condition. */
  scope: SQL
  from: typeof client | typeof contact | typeof deal
}

async function resolveNamed(spec: Spec, value: string, limit: number): Promise<NamedMatch[]> {
  const v = value.trim()
  if (!v) return []
  const run = (match: SQL | undefined, order?: SQL) =>
    db
      .select({ id: sql<string>`${spec.idCol}`, name: sql<string>`${spec.nameCol}` })
      .from(spec.from)
      .where(and(spec.scope, match))
      .orderBy(order ?? sql`${spec.nameCol}`)
      .limit(limit)

  const byId = await run(eq(spec.idCol, v))
  if (byId.length) return byId.slice(0, 1)

  const tq = textQuery(v)
  if (!tq) return []
  const relevance = relevanceOf(tq, spec.fields)
  const literal = await run(
    sql`(${sql.join(
      [...spec.fields, ...(spec.literalOnly ?? [])].map((f) => containsQuery(tq, f)),
      sql` or `,
    )})`,
    desc(relevance),
  )
  if (literal.length || !tq.fuzzy) return literal
  const fuzzy = await db
    .select({ id: sql<string>`${spec.idCol}`, name: sql<string>`${spec.nameCol}`, score: sql<number>`${relevance}` })
    .from(spec.from)
    .where(and(spec.scope, sql`${relevance} >= ${NAME_FILTER_FUZZY_MIN}`))
    .orderBy(desc(relevance))
    .limit(limit)
  // Keep only the matches close to the best one: «Alfa Market» → «Альфа-Маркет»,
  // not also «MarketLine Group» (one shared word, clearly weaker).
  const best = fuzzy[0]?.score ?? 0
  return fuzzy.filter((r) => r.score >= best - NAME_FILTER_NEAR_BEST).map(({ id, name }) => ({ id, name }))
}

/** Companies of the org (not deleted / blocked) for a «Компания» filter value. */
export function resolveCompanyFilter(ctx: RecordsContext, value: string, limit = 5): Promise<NamedMatch[]> {
  return resolveNamed(
    {
      idCol: client.id,
      nameCol: client.name,
      fields: [norm(client.name), norm(client.namePhys)],
      scope: and(eq(client.organizationId, ctx.orgId), notInArray(client.status, ["deleted", "blocked"]))!,
      from: client,
    },
    value,
    limit,
  )
}

/** Contacts of the org (not deleted / blocked / merged) for a «Контакт» filter value. */
export function resolveContactFilter(ctx: RecordsContext, value: string, limit = 5): Promise<NamedMatch[]> {
  return resolveNamed(
    {
      idCol: contact.id,
      nameCol: contact.name,
      fields: [norm(contact.name), norm(contact.nameNative)],
      literalOnly: [norm(contact.email)],
      scope: and(
        eq(contact.organizationId, ctx.orgId),
        notInArray(contact.status, ["deleted", "blocked"]),
        isNull(contact.mergedIntoContactId),
      )!,
      from: contact,
    },
    value,
    limit,
  )
}

/** Deals of the org (not deleted) for a «Сделка» filter value. */
export function resolveDealFilter(ctx: RecordsContext, value: string, limit = 5): Promise<NamedMatch[]> {
  return resolveNamed(
    {
      idCol: deal.id,
      nameCol: deal.name,
      fields: [norm(deal.name)],
      scope: and(eq(deal.organizationId, ctx.orgId), ne(deal.status, "deleted"))!,
      from: deal,
    },
    value,
    limit,
  )
}

/** Chip text: the names actually used, or «<value> (не найдено)». */
export function matchedLabel(value: string, matches: NamedMatch[]): string {
  return matches.length ? nameList(matches.map((m) => m.name)) : `${value.trim()} (не найдено)`
}

/** Condition `col IN (ids)`, or false when nothing matched (the honest empty answer). */
export function inIds(col: AnyColumn, matches: NamedMatch[]): SQL {
  return matches.length
    ? sql`${col} in (${sql.join(
        matches.map((m) => sql`${m.id}`),
        sql`, `,
      )})`
    : sql`false`
}

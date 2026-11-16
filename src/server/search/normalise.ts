import "server-only"

import { sql, type AnyColumn, type SQL } from "drizzle-orm"

// ── Search V2 matching, shared ───────────────────────────────────────
//
// ONE definition of "matches" for every SQL text search over CRM records:
// the header search (src/server/search.ts) and the AI chat records engine
// (src/server/chat/records/). Both sides go through the SQL functions the
// Search V2 foundation installed for the product catalog
// (refs/search-v2-plan.md, migrations/0002):
//   lower(immutable_unaccent(translit_cyr_lat(x)))
// plus a pg_trgm `word_similarity >= 0.3` arm, so «Норлекс» finds «Norleks»
// and an em-dash query finds an en-dash name. The JS twin for in-memory
// lists is src/lib/entity-search.ts — keep the two in step (same
// normalisation, same 0.3 gate). The product catalog keeps its own
// FTS + trigram engine in src/server/products.ts.

export const FUZZY_THRESHOLD = 0.3

/** Shorter queries return nothing (no DB hit). */
export const MIN_QUERY_LENGTH = 2

/**
 * Fuzzy matching only from 3 characters up: `word_similarity` against a
 * 2-character query scores high on far too much text. The exact (substring)
 * arm still runs from MIN_QUERY_LENGTH, so short queries stay literal.
 */
export const MIN_FUZZY_QUERY_LENGTH = 3

export type TextQuery = {
  /** The trimmed raw query. */
  q: string
  /** The query, normalised by the SAME SQL functions as the columns. */
  qNorm: SQL
  fuzzy: boolean
}

/** null when the query is too short to search. */
export function textQuery(raw: string): TextQuery | null {
  const q = raw.trim()
  if (q.length < MIN_QUERY_LENGTH) return null
  return {
    q,
    // Normalised in SQL, never in JS, so the two sides can never drift.
    qNorm: sql`lower(immutable_unaccent(translit_cyr_lat(${q})))`,
    fuzzy: q.length >= MIN_FUZZY_QUERY_LENGTH,
  }
}

/** A text column or expression, normalised. NULL collapses to '' (never matches). */
export function norm(col: AnyColumn | SQL): SQL {
  return sql`lower(immutable_unaccent(translit_cyr_lat(coalesce(${col}, ''))))`
}

/**
 * A `text[]` column, normalised. Joined with spaces rather than cast to text
 * so the array's own `{`, `}` and `,` punctuation can't wedge itself between
 * a query and the alias it should match.
 */
export function normArray(col: AnyColumn | SQL): SQL {
  return sql`lower(immutable_unaccent(translit_cyr_lat(coalesce(array_to_string(${col}, ' '), ''))))`
}

/** A jsonb column (or json path expression), cast to text, normalised. */
export function normJsonText(col: AnyColumn | SQL): SQL {
  return sql`lower(immutable_unaccent(translit_cyr_lat(coalesce(${col}::text, ''))))`
}

/** Exact (substring) arm + fuzzy arm for one normalised expression. */
export function matchesQuery(tq: TextQuery, expr: SQL): SQL {
  return tq.fuzzy
    ? sql`(${expr} LIKE '%' || ${tq.qNorm} || '%' OR word_similarity(${tq.qNorm}, ${expr}) >= ${FUZZY_THRESHOLD})`
    : sql`(${expr} LIKE '%' || ${tq.qNorm} || '%')`
}

/**
 * Literal substring match on a normalised expression, no fuzzy arm. For
 * e-mail addresses and phone numbers: already ASCII, and a fuzzy address
 * match is noise.
 */
export function containsQuery(tq: TextQuery, expr: SQL): SQL {
  return sql`(${expr} LIKE '%' || ${tq.qNorm} || '%')`
}

/**
 * Relevance for ordering: the best fuzzy score across the record's
 * identifying fields. The fuzzy arm widens the candidate set, so the best
 * match has to lead rather than merely be present.
 */
export function relevanceOf(tq: TextQuery, exprs: SQL[]): SQL {
  if (exprs.length === 1) return sql`word_similarity(${tq.qNorm}, ${exprs[0]})`
  return sql`greatest(${sql.join(
    exprs.map((e) => sql`word_similarity(${tq.qNorm}, ${e})`),
    sql`, `,
  )})`
}

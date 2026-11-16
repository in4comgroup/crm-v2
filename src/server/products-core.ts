import "server-only"

import { db } from "@/db/drizzle"
import type { EntityStatus } from "@/db/schema"
import { sql, type SQL } from "drizzle-orm"

// Org-explicit core of the product catalog search (Search V2,
// refs/search-v2-plan.md). `listProducts` in src/server/products.ts (the
// session-bound "use server" entry of the Products page) and the AI chat
// records engine (src/server/chat/records/products.ts) both call
// `listProductsForOrg` — ONE product matcher. Lives outside the
// "use server" module because it takes the org id as a parameter
// (AGENTS.md rule 5).

// Lightweight shape for the table listing — ONLY the columns the table
// renders. The heavy JSON groups (accounting / additional / stock
// metadata) are deliberately NOT included here so the list payload stays
// small even at large page sizes; the detail dialog fetches them on
// demand via `getProduct` (see `ProductDetail`).
export type ProductRow = {
  id: string
  name: string
  category: string | null
  webPageUrl: string | null
  // numeric(14,2) comes back from drizzle as a string; the API converts
  // to number for the client.
  price: number | null
  imageUrl: string | null
  totalStock: number | null
  status: EntityStatus
  // Relevance score from the bilingual `terms` search, when terms were
  // supplied. `terms` RANKS (orders) rather than filters, so a zero score
  // means the row is filler shown only because nothing matched — the UI uses
  // this to suppress a misleading "Best match" badge. Undefined when no terms.
  score?: number
}

export type ProductInStock = "in" | "out"

export type ListProductsParams = {
  q?: string
  // Bilingual ranked search: products score +1 per term that hits, and the
  // listing is filtered to score > 0 and ordered by score desc. Used by the
  // order-from-request wizard to match mixed RU/EN catalog names without
  // depending on a single transliteration or word order. Combinable with the
  // structured filters below (filters narrow; terms rank within).
  terms?: string[]
  category?: string
  // Exact-match filters over enumerable additional_metadata attributes.
  type?: string
  color?: string
  sugar?: string
  year?: string
  aging?: string
  bottleVolume?: string
  countryName?: string
  appelacion?: string
  rating?: string
  // Multi-select variants of the export-relevant attributes (country / region /
  // color). The Products page sends these as arrays; each becomes an IN (...)
  // gate. Region has no single-value form (it's a multi-select only). Kept
  // separate from the single `color`/`countryName` above for back-compat.
  colors?: string[]
  countryNames?: string[]
  regions?: string[]
  // Free-text "contains" filter over the long, composite awards string.
  awards?: string
  // Price range over the numeric price column.
  priceMin?: number
  priceMax?: number
  // Stock presence derived from total_stock (in = >0, out = null/≤0).
  inStock?: ProductInStock
  // ── Search V2 soft hints (the wizard's LLM-guessed attributes) ──
  // These BOOST matching products in the ranking but never gate, so a wrong
  // guess can't zero the result (replaces the deleted snapToVocab/relax logic).
  // The manual catalog dropdowns above (category/type/color/…) stay HARD filters
  // — an explicit operator choice should still narrow.
  catHint?: string
  colorHint?: string
  sugarHint?: string
  countryHint?: string
  regionHint?: string
  wantGift?: boolean
  // ── Search V2 gates ──
  // Explicit bottle volume in ml (gate, only when a line named a volume).
  volumeMl?: number
  // Include non-drink merch (glasses/water/syrups/gift-wrap). Default false →
  // merch hidden from drink searches.
  includeMerch?: boolean
  limit?: number
  offset?: number
}

// The enumerable attributes exposed as filter dropdowns, mapped to their
// additional_metadata JSON key. Order drives nothing here — it's the UI's
// concern — but keeping the map in the server module keeps the JSON-key
// spelling in one place for both the WHERE builder and the options query.
export const ATTR_FILTER_KEYS = {
  type: "type",
  color: "color",
  sugar: "sugar",
  year: "year",
  aging: "aging",
  bottleVolume: "bottle_volume",
  countryName: "country_name",
  appelacion: "appelacion",
  rating: "rating",
} as const

// ── Search V2 — hybrid retrieval tunables (see refs/search-v2-plan.md) ──
//
// The bespoke weighted scorer (termWeight / FIELD_W / KIND_WORDS / FUZZY_* /
// MIN_SCORE_RATIO) is gone. Ranking is now: normalize the query (cross-script
// translit + alias expansion, all in SQL) → two retrievers over the gated set
// (FTS-OR on the weighted tsvector, trigram on name_norm) → fuse by Reciprocal
// Rank Fusion. The full DDL + the eval harness that tuned these live in
// scripts/search-v2/ + scripts/eval/.

// RRF constant: rrf(d) = Σ 1/(RRF_K + rank_i(d)). ~60 is the standard default;
// larger flattens the contribution of top ranks, smaller sharpens it.
const RRF_K = 60
// Per-retriever candidate cap before fusion. 200 is plenty at 16.8k rows and
// keeps the fusion set small; raise only if recall@k on the eval set demands it.
const RETRIEVER_LIMIT = 200
// Trigram floor for the fuzzy retriever. word_similarity (NOT the GUC-bound `%`
// operator) ≥ 0.3 admits cross-script near-misses (deskomb≈descombe) while
// dropping noise. Tuned on the golden set.
const TRGM_MIN = 0.3
// Additive soft-boost per matching hint, applied in ORDER BY on top of the RRF
// score. Comparable to one RRF rank step (1/61 ≈ 0.0164), so a hint nudges
// ties without overriding a strong retrieval signal.
const HINT_BOOST = 0.015

export type ListProductsResult = {
  rows: ProductRow[]
  total: number
}

// Raw row shape returned by the hybrid-search SQL (aliased to camelCase).
type RawProductRow = {
  id: string
  name: string
  category: string | null
  webPageUrl: string | null
  price: string | number | null
  imageUrl: string | null
  totalStock: number | string | null
  status: EntityStatus
  score: string | number | null
  total: string | number | null
}

function mapRawRows(rows: RawProductRow[]): ListProductsResult {
  return {
    rows: rows.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      webPageUrl: r.webPageUrl,
      price: r.price == null ? null : Number(r.price),
      imageUrl: r.imageUrl,
      totalStock: r.totalStock == null ? null : Number(r.totalStock),
      status: r.status,
      score: r.score == null ? undefined : Number(r.score),
    })),
    total: rows.length > 0 ? Number(rows[0].total ?? 0) : 0,
  }
}

// neon-http's db.execute resolves to `{ rows }`; normalise either shape.
async function execRows(query: SQL): Promise<RawProductRow[]> {
  const res = (await db.execute(query)) as unknown as
    | { rows?: RawProductRow[] }
    | RawProductRow[]
  return (Array.isArray(res) ? res : (res.rows ?? [])) as RawProductRow[]
}

/**
 * Extra knobs for non-page callers (the AI chat). The defaults are exactly
 * the Products page behaviour.
 */
export type ListProductsOptions = {
  /**
   * A query that matches nothing falls back to the plain gated listing
   * (default true — the order wizard must never show an empty table). The
   * chat passes false: an unrelated product is not a search result.
   */
  fallbackToPlain?: boolean
  /** Order of the plain (no query) listing; default "name". */
  plainOrder?: "name" | "price_asc" | "price_desc" | "stock_desc"
  /**
   * Floor of the trigram (name) retriever; default TRGM_MIN (0.3). The AI
   * chat passes a stricter value: its search runs across all record types,
   * and at 0.3 a short word («счёт», «zz») pulls in hundreds of wine names
   * that merely share a trigram. The catalog pages keep the generous floor.
   */
  trigramMin?: number
}

const PLAIN_ORDER: Record<NonNullable<ListProductsOptions["plainOrder"]>, SQL> = {
  name: sql`p.name ASC, p.id ASC`,
  price_asc: sql`p.price ASC NULLS LAST, p.name ASC, p.id ASC`,
  price_desc: sql`p.price DESC NULLS LAST, p.name ASC, p.id ASC`,
  stock_desc: sql`p.total_stock DESC NULLS LAST, p.name ASC, p.id ASC`,
}

// Server-side paginated + searched product listing. The catalog is large
// (~16.8k rows), so the page never pulls the full set — every fetch is one page
// with the current gates + ranking applied in SQL.
//
// Search V2 (refs/search-v2-plan.md): the query text (manual `q` OR the wizard's
// `terms`, joined) is normalised in SQL — Cyrillic→Latin transliteration +
// brand-alias expansion — then two retrievers run over the GATED set (FTS-OR on
// the weighted tsvector; trigram on name_norm) and are fused by Reciprocal Rank
// Fusion. HARD gates (org/status/junk/is_drink/price/in-stock/volume + the
// manual filter dropdowns) narrow; SOFT hints (the wizard's LLM-guessed
// attributes) only boost in ORDER BY so a wrong guess can never zero the result.
export async function listProductsForOrg(
  activeOrgId: string,
  params: ListProductsParams = {},
  opts: ListProductsOptions = {},
): Promise<ListProductsResult> {

  const limit = Math.min(Math.max(params.limit ?? 25, 1), 100)
  const offset = Math.max(params.offset ?? 0, 0)

  // The wizard's bilingual `terms` take precedence over the manual box `q`; both
  // feed ONE normalised ranking path. Empty → plain (browse/filter) listing.
  const rawQuery =
    params.terms && params.terms.length > 0
      ? params.terms.join(" ").trim()
      : (params.q?.trim() ?? "")

  // ── HARD gates (AND) — applied identically in every retriever + the plain
  // path. Unqualified column names resolve to the single product table in scope.
  const gateParts: SQL[] = [
    sql`organization_id = ${activeOrgId}`,
    sql`status = 'active'`,
    // Junk header row from the spreadsheet ingest (spec §1.4).
    sql`name <> 'Название товара'`,
  ]
  if (!params.includeMerch) gateParts.push(sql`is_drink`)
  const hardAttr = (jsonKey: string, val?: string) => {
    const v = val?.trim()
    if (v) gateParts.push(sql`additional_metadata ->> ${jsonKey} = ${v}`)
  }
  // Multi-value gate: matches any of the supplied values (single + array forms
  // merged, deduped). Used by the export-relevant country / region / color
  // filters, which are multi-select on the page.
  const hardAttrMulti = (jsonKey: string, single?: string, multi?: string[]) => {
    const vals = [
      ...(single?.trim() ? [single.trim()] : []),
      ...(multi ?? []).map((v) => v.trim()).filter(Boolean),
    ]
    const uniq = [...new Set(vals)]
    if (uniq.length === 0) return
    gateParts.push(
      sql`additional_metadata ->> ${jsonKey} IN (${sql.join(
        uniq.map((v) => sql`${v}`),
        sql`, `,
      )})`,
    )
  }
  const category = params.category?.trim()
  if (category) gateParts.push(sql`category = ${category}`)
  hardAttr(ATTR_FILTER_KEYS.type, params.type)
  hardAttrMulti(ATTR_FILTER_KEYS.color, params.color, params.colors)
  hardAttr(ATTR_FILTER_KEYS.sugar, params.sugar)
  hardAttr(ATTR_FILTER_KEYS.year, params.year)
  hardAttr(ATTR_FILTER_KEYS.aging, params.aging)
  hardAttr(ATTR_FILTER_KEYS.bottleVolume, params.bottleVolume)
  hardAttrMulti(ATTR_FILTER_KEYS.countryName, params.countryName, params.countryNames)
  hardAttrMulti("region", undefined, params.regions)
  hardAttr(ATTR_FILTER_KEYS.appelacion, params.appelacion)
  hardAttr(ATTR_FILTER_KEYS.rating, params.rating)
  const awards = params.awards?.trim()
  if (awards) gateParts.push(sql`additional_metadata ->> 'awards' ILIKE ${`%${awards}%`}`)
  if (params.priceMin != null && Number.isFinite(params.priceMin))
    gateParts.push(sql`price >= ${params.priceMin}`)
  if (params.priceMax != null && Number.isFinite(params.priceMax))
    gateParts.push(sql`price <= ${params.priceMax}`)
  if (params.inStock === "in") gateParts.push(sql`total_stock > 0`)
  else if (params.inStock === "out")
    gateParts.push(sql`(total_stock IS NULL OR total_stock <= 0)`)
  if (params.volumeMl != null && Number.isFinite(params.volumeMl))
    gateParts.push(sql`additional_metadata ->> 'bottle_volume' = ${String(params.volumeMl)}`)
  const gates = sql.join(gateParts, sql` AND `)

  // Plain (no query): filtered listing ordered by name. Also the never-blank
  // fallback when a ranked search matches nothing.
  const plainCols = sql`
    p.id AS "id", p.name AS "name", p.category AS "category",
    p.web_page_url AS "webPageUrl", p.price AS "price", p.image_url AS "imageUrl",
    p.total_stock AS "totalStock", p.status AS "status",
    NULL::float8 AS "score", count(*) OVER () AS "total"`
  const runPlain = () =>
    execRows(sql`
      SELECT ${plainCols}
      FROM product p
      WHERE ${gates}
      ORDER BY ${PLAIN_ORDER[opts.plainOrder ?? "name"]}
      LIMIT ${limit} OFFSET ${offset}`)

  if (!rawQuery) return mapRawRows(await runPlain())

  // ── SOFT hint boosts (additive, in ORDER BY). COALESCE so a NULL attribute
  // contributes 0 instead of poisoning the sum.
  const boostParts: SQL[] = []
  const hint = (cond: SQL) =>
    boostParts.push(sql`${HINT_BOOST} * COALESCE((${cond})::int, 0)`)
  if (params.catHint?.trim()) hint(sql`p.category = ${params.catHint.trim()}`)
  if (params.colorHint?.trim()) hint(sql`p.additional_metadata ->> 'color' = ${params.colorHint.trim()}`)
  if (params.sugarHint?.trim()) hint(sql`p.additional_metadata ->> 'sugar' = ${params.sugarHint.trim()}`)
  if (params.countryHint?.trim()) hint(sql`p.additional_metadata ->> 'country_name' = ${params.countryHint.trim()}`)
  if (params.regionHint?.trim())
    hint(sql`p.region_norm ILIKE ('%' || lower(immutable_unaccent(translit_cyr_lat(${params.regionHint.trim()}))) || '%')`)
  if (params.wantGift) hint(sql`p.is_gift`)
  const boost = boostParts.length > 0 ? sql` + ${sql.join(boostParts, sql` + `)}` : sql``

  // Normalised query (translit + unaccent) reused in qexp + the alias lookup.
  const qNorm = sql`lower(immutable_unaccent(translit_cyr_lat(${rawQuery})))`

  const ranked = await execRows(sql`
    WITH qx AS (
      SELECT trim(
        ${qNorm} || ' ' || coalesce((
          SELECT string_agg(DISTINCT a.canonical, ' ')
          FROM product_alias a
          WHERE a.organization_id = ${activeOrgId}
            AND a.kind <> 'house'
            AND position(a.alias_norm in ${qNorm}) > 0
        ), '')
      ) AS qexp
    ),
    fts AS (
      SELECT p.id, row_number() OVER (
        ORDER BY ts_rank_cd(p.search_vector, to_or_tsquery((SELECT qexp FROM qx))) DESC) AS r
      FROM product p
      WHERE ${gates}
        AND p.search_vector @@ to_or_tsquery((SELECT qexp FROM qx))
      LIMIT ${RETRIEVER_LIMIT}
    ),
    trg AS (
      SELECT p.id, row_number() OVER (
        ORDER BY word_similarity((SELECT qexp FROM qx), p.name_norm) DESC) AS r
      FROM product p
      WHERE ${gates}
        AND word_similarity((SELECT qexp FROM qx), p.name_norm) >= ${opts.trigramMin ?? TRGM_MIN}
      LIMIT ${RETRIEVER_LIMIT}
    ),
    ids AS (SELECT id FROM fts UNION SELECT id FROM trg),
    fused AS (
      SELECT i.id,
             COALESCE(1.0/(${RRF_K} + f.r), 0) + COALESCE(1.0/(${RRF_K} + t.r), 0) AS rrf
      FROM ids i
      LEFT JOIN fts f USING (id)
      LEFT JOIN trg t USING (id)
    )
    SELECT
      p.id AS "id", p.name AS "name", p.category AS "category",
      p.web_page_url AS "webPageUrl", p.price AS "price", p.image_url AS "imageUrl",
      p.total_stock AS "totalStock", p.status AS "status",
      fused.rrf AS "score", count(*) OVER () AS "total"
    FROM fused
    JOIN product p USING (id)
    ORDER BY (fused.rrf${boost}) DESC, char_length(p.name) ASC, p.name ASC, p.id ASC
    LIMIT ${limit} OFFSET ${offset}`)

  // Never-blank: a query that matched nothing (rare post-normalisation) falls
  // back to the gated catalog so a wizard step never shows an empty table. Score
  // stays null → the page suppresses the "Best match" badge (nothing matched).
  if (ranked.length === 0 && opts.fallbackToPlain !== false) return mapRawRows(await runPlain())
  return mapRawRows(ranked)
}


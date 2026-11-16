import "server-only"

import { and, eq, inArray, sql, type SQL } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db/drizzle"
import { product } from "@/db/schema"
import { recordHref, type RecordDetail, type RecordDetailSection, type RecordHit } from "@/lib/chat/records"
import { listProductsForOrg, type ListProductsOptions, type ListProductsParams } from "@/server/products-core"
import type { TextQuery } from "@/server/search/normalise"
import { allFacts, facts, formatMoney } from "./format"
import { capTotal } from "./shared"
import { keepOwnOrg, type RecordModule, type RecordsContext, type SearchOptions } from "./types"

// «Товар» (product) of the records engine (spec §6.1, §7.2). Visible: active
// products of the org (merch included — the chat answers about the whole
// catalog). Text search is the catalog's OWN Search V2 engine
// (`listProductsForOrg`, src/server/products-core.ts: FTS + trigram + brand
// aliases), never a second matcher. A product has no page of its own (Q8)
// → the catalog filtered by its name. Prices are in RUB (the catalog has no
// currency column; the Products page shows ₽ too).

export const productFilterSchema = z
  .object({
    query: z.string().min(2).optional().describe("Text in the product name / attributes (catalog search, ranked)"),
    category: z.string().min(1).optional().describe("Catalog category in Russian (e.g. «Красное», «Виски», «Водка»), case-insensitive"),
    country: z.string().min(1).optional().describe("Country of origin in Russian (e.g. «Франция»), case-insensitive"),
    region: z.string().min(1).optional().describe("Region in Russian (e.g. «Бордо»), case-insensitive"),
    color: z.string().min(1).optional().describe("Wine colour in Russian: «красный», «белый», «розовый»"),
    inStock: z.boolean().optional().describe("true = stock > 0, false = no stock"),
    priceMin: z.number().nonnegative().optional().describe("Price ≥ this amount, RUB"),
    priceMax: z.number().nonnegative().optional().describe("Price ≤ this amount, RUB"),
  })
  .strict()
export type ProductFilters = z.infer<typeof productFilterSchema>

// With `query` the rows are always by relevance (the catalog ranking);
// without it "relevance" falls back to name.
const SORT_KEYS = ["name", "price_asc", "price_desc", "stock", "relevance"] as const
const PLAIN_ORDER: Record<string, ListProductsOptions["plainOrder"]> = {
  name: "name",
  relevance: "name",
  price_asc: "price_asc",
  price_desc: "price_desc",
  stock: "stock_desc",
}

// additional_metadata keys (checked on the test DB) → Russian labels.
const META_FACTS: [key: string, label: string][] = [
  ["type", "Тип"],
  ["color", "Цвет"],
  ["sugar", "Сахар"],
  ["year", "Год"],
  ["aging", "Выдержка"],
  ["bottle_volume", "Объём, мл"],
  ["alcohol", "Крепость, %"],
  ["appelacion", "Апелласьон"],
  ["vine_category", "Категория вина"],
  ["rating", "Рейтинг"],
  ["awards", "Награды"],
  ["gift_packaging", "Подарочная упаковка"],
  ["serve_temperature", "Температура подачи"],
  ["price_range", "Ценовой диапазон"],
]
const META_TEXTS: [key: string, label: string][] = [
  ["description", "Описание"],
  ["taste", "Вкус"],
  ["flavour", "Аромат"],
  ["color_details", "Цвет"],
  ["gastronomy", "Гастрономия"],
]

type ProductLite = {
  id: string
  organizationId: string
  name: string
  category: string | null
  price: string | null
  totalStock: number | null
  meta: unknown
}

function metaOf(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function str(v: unknown): string {
  if (typeof v === "string") return v.trim()
  if (typeof v === "number" && Number.isFinite(v)) return String(v)
  return ""
}

/** «ФРАНЦИЯ» → «Франция» (the catalog stores countries in capitals). */
function country(meta: Record<string, unknown>): string {
  const c = str(meta.country_name)
  return c && c === c.toUpperCase() ? c.charAt(0) + c.slice(1).toLowerCase() : c
}

function stockText(n: number | null): string {
  if (n == null) return ""
  return n > 0 ? `${n} шт.` : "нет"
}

function toHit(r: ProductLite): RecordHit {
  const meta = metaOf(r.meta)
  return {
    type: "product",
    id: r.id,
    title: r.name,
    subtitle: [r.category, country(meta)].filter(Boolean).join(" · ") || null,
    facts: facts([
      { label: "Цена", value: formatMoney(r.price) },
      { label: "Остаток", value: stockText(r.totalStock) },
    ]),
    badge: r.totalStock != null && r.totalStock <= 0 ? { label: "Нет в наличии", tone: "warn" } : null,
    date: null,
    href: recordHref("product", r.id, r.name),
  }
}

const liteCols = {
  id: product.id,
  organizationId: product.organizationId,
  name: product.name,
  category: product.category,
  price: product.price,
  totalStock: product.totalStock,
  meta: product.additionalMetadata,
}

/**
 * Ids from the catalog engine → hits in the same order. One extra query
 * loads the attributes the hit shows (country) and the org id for the
 * output guard; the engine's own row shape stays the Products page's.
 */
async function hitsFor(ctx: RecordsContext, ids: string[]): Promise<RecordHit[]> {
  if (ids.length === 0) return []
  const rows = await db
    .select(liteCols)
    .from(product)
    .where(and(eq(product.organizationId, ctx.orgId), eq(product.status, "active"), inArray(product.id, ids)))
  const byId = new Map(keepOwnOrg(ctx, "product", rows).map((r) => [r.id, r]))
  return ids.flatMap((id) => {
    const r = byId.get(id)
    return r ? [toHit(r)] : []
  })
}

/** Trigram floor of the catalog engine when the chat searches products. */
const CHAT_TRIGRAM_MIN = 0.5

async function search(ctx: RecordsContext, tq: TextQuery, opts: SearchOptions) {
  // Products have no date of their own → the date range is ignored.
  const res = await listProductsForOrg(
    ctx.orgId,
    { q: tq.q, includeMerch: true, limit: opts.limit },
    // Strict name floor (spec §6.2: chat search spans all types); no fuzzy
    // arm for 1–2 character queries, same rule as src/server/search/normalise.ts.
    { fallbackToPlain: false, trigramMin: tq.fuzzy ? CHAT_TRIGRAM_MIN : 1.01 },
  )
  return { hits: await hitsFor(ctx, res.rows.map((r) => r.id)), ...capTotal(res.total) }
}

/** Case / space-insensitive key of a catalog value («Краснодарский край» = «КРАСНОДАРСКИЙКРАЙ»). */
function valueKey(expr: SQL | string): SQL {
  return sql`regexp_replace(lower(${expr}), '[[:space:]]+', '', 'g')`
}

/**
 * A filter value as the user / model wrote it («Франция») → the catalog's
 * own spelling(s) («ФРАНЦИЯ»): the catalog gates compare exactly. No match →
 * the raw value (the filter then matches nothing, which is the honest answer).
 */
async function catalogValues(ctx: RecordsContext, expr: SQL, value: string): Promise<{ values: string[]; found: boolean }> {
  const rows = await db
    .selectDistinct({ v: sql<string>`${expr}` })
    .from(product)
    .where(
      and(
        eq(product.organizationId, ctx.orgId),
        eq(product.status, "active"),
        sql`${valueKey(expr)} = ${valueKey(value.trim())}`,
      ),
    )
    .limit(10)
  const values = rows.map((r) => r.v).filter(Boolean)
  return values.length ? { values, found: true } : { values: [value.trim()], found: false }
}

async function list(ctx: RecordsContext, filters: ProductFilters, sort: string, limit: number) {
  const applied: { label: string; value: string }[] = []
  const params: ListProductsParams = { includeMerch: true, limit }
  const chip = (label: string, raw: string, r: { values: string[]; found: boolean }) =>
    applied.push({ label, value: r.found ? r.values.join(", ") : `${raw} (не найдено)` })
  if (filters.query) {
    params.q = filters.query
    applied.push({ label: "Поиск", value: filters.query })
  }
  const attr = (key: string) => sql`${product.additionalMetadata} ->> ${key}`
  const [category, countryV, region, color] = await Promise.all([
    filters.category ? catalogValues(ctx, sql`${product.category}`, filters.category) : null,
    filters.country ? catalogValues(ctx, attr("country_name"), filters.country) : null,
    filters.region ? catalogValues(ctx, attr("region"), filters.region) : null,
    filters.color ? catalogValues(ctx, attr("color"), filters.color) : null,
  ])
  if (category && filters.category) {
    // The catalog gate takes one category; a case-insensitive match is unique in practice.
    params.category = category.values[0]
    chip("Категория", filters.category, { ...category, values: category.values.slice(0, 1) })
  }
  if (countryV && filters.country) {
    params.countryNames = countryV.values
    chip("Страна", filters.country, countryV)
  }
  if (region && filters.region) {
    params.regions = region.values
    chip("Регион", filters.region, region)
  }
  if (color && filters.color) {
    params.colors = color.values
    chip("Цвет", filters.color, color)
  }
  if (filters.inStock != null) {
    params.inStock = filters.inStock ? "in" : "out"
    applied.push({ label: "Наличие", value: filters.inStock ? "в наличии" : "нет в наличии" })
  }
  if (filters.priceMin != null) params.priceMin = filters.priceMin
  if (filters.priceMax != null) params.priceMax = filters.priceMax
  if (filters.priceMin != null || filters.priceMax != null) {
    applied.push({
      label: "Цена",
      value: [
        filters.priceMin != null && `от ${formatMoney(filters.priceMin)}`,
        filters.priceMax != null && `до ${formatMoney(filters.priceMax)}`,
      ]
        .filter(Boolean)
        .join(" "),
    })
  }
  const res = await listProductsForOrg(ctx.orgId, params, {
    fallbackToPlain: false,
    plainOrder: PLAIN_ORDER[sort] ?? "name",
  })
  return { rows: await hitsFor(ctx, res.rows.map((r) => r.id)), ...capTotal(res.total), applied }
}

async function get(ctx: RecordsContext, id: string): Promise<RecordDetail | null> {
  const [row] = await db
    .select({ ...liteCols, accounting: product.accountingMetadata, stock: product.stockMetadata, webPageUrl: product.webPageUrl })
    .from(product)
    .where(and(eq(product.id, id), eq(product.organizationId, ctx.orgId), eq(product.status, "active")))
    .limit(1)
  if (!row || keepOwnOrg(ctx, "product", [row]).length === 0) return null

  const meta = metaOf(row.meta)
  const accounting = metaOf(row.accounting)
  const sections: RecordDetailSection[] = []

  const main = allFacts([
    { label: "Категория", value: row.category ?? "" },
    { label: "Цена", value: formatMoney(row.price) },
    { label: "Остаток", value: stockText(row.totalStock) },
    { label: "Страна", value: country(meta) },
    { label: "Регион", value: str(meta.region) },
    { label: "Производитель", value: str(meta.vendor) },
    ...META_FACTS.map(([key, label]) => ({ label, value: str(meta[key]) })),
    { label: "Код", value: str(accounting.code) },
    { label: "Штрихкод", value: str(accounting.barCode) },
  ])
  const withLink = row.webPageUrl
    ? [...main, { label: "Страница на сайте", value: row.webPageUrl, href: row.webPageUrl }]
    : main
  if (withLink.length) sections.push({ kind: "facts", title: "Сведения", items: withLink })

  const stock = Array.isArray(row.stock)
    ? (row.stock as { label?: unknown; count?: unknown }[]).filter((s) => typeof s.count === "number" && s.count > 0)
    : []
  if (stock.length) {
    sections.push({
      kind: "table",
      title: "Остатки по складам",
      columns: ["Склад", "Остаток"],
      rows: stock.map((s) => [str(s.label).replace(/^Остатки\s*\((.*)\)$/, "$1") || "—", String(s.count)]),
    })
  }

  const texts = META_TEXTS.map(([key, label]) => ({ label, value: str(meta[key]) })).filter((t) => t.value)
  if (texts.length) {
    sections.push({
      kind: "text",
      title: "Описание",
      markdown: texts.map((t) => (texts.length === 1 && t.label === "Описание" ? t.value : `**${t.label}.** ${t.value}`)).join("\n\n"),
    })
  }

  return {
    type: "product",
    id,
    title: row.name,
    subtitle: [row.category, country(meta)].filter(Boolean).join(" · ") || null,
    badges: row.totalStock != null && row.totalStock <= 0 ? [{ label: "Нет в наличии", tone: "warn" }] : [],
    sections,
    href: recordHref("product", id, row.name),
  }
}

export const productsModule: RecordModule<ProductFilters> = {
  type: "product",
  filterSchema: productFilterSchema,
  sortKeys: SORT_KEYS,
  search,
  list,
  get,
}

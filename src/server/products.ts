"use server"

import { db } from "@/db/drizzle"
import { product, type EntityStatus } from "@/db/schema"
import { and, asc, eq, sql } from "drizzle-orm"
import { getServerSession } from "@/lib/get-session"
import {
  ATTR_FILTER_KEYS,
  listProductsForOrg,
  type ListProductsParams,
  type ListProductsResult,
} from "@/server/products-core"

// One per-location stock entry (spreadsheet cols AB-AP).
export type ProductStockLocation = {
  key: string
  label: string
  count: number | null
}

// The listing types live in the org-explicit core (src/server/products-core.ts);
// re-exported so existing importers keep `@/server/products`.
export type {
  ListProductsParams,
  ListProductsResult,
  ProductInStock,
  ProductRow,
} from "@/server/products-core"

// Full product shape for the detail dialog — the main columns plus the
// three JSON metadata groups. Fetched one row at a time, only when the
// preview pop-up opens.
export type ProductDetail = {
  id: string
  name: string
  category: string | null
  webPageUrl: string | null
  price: number | null
  imageUrl: string | null
  totalStock: number | null
  accountingMetadata: Record<string, unknown>
  additionalMetadata: Record<string, unknown>
  stockMetadata: ProductStockLocation[]
  status: EntityStatus
  createdAt: string
  updatedAt: string
}

async function requireOrgContext() {
  const session = await getServerSession()
  if (!session) throw new Error("Unauthorized")
  const activeOrgId = session.session.activeOrganizationId
  if (!activeOrgId) throw new Error("No active organization")
  return { session, activeOrgId }
}

// Server-side paginated + searched product listing of the ACTIVE org (the
// Products page, the order wizard). The search itself — gates, Search V2
// ranking, never-blank fallback — is `listProductsForOrg` in products-core.
export async function listProducts(
  params: ListProductsParams = {},
): Promise<ListProductsResult> {
  const { activeOrgId } = await requireOrgContext()
  return listProductsForOrg(activeOrgId, params)
}

// Full single-product fetch for the detail pop-up — org-scoped. Returns
// null when the id doesn't exist or belongs to another org (the route
// translates that to 404). Loaded lazily, one row at a time, only when
// the preview dialog opens.
export async function getProduct(id: string): Promise<ProductDetail | null> {
  const { activeOrgId } = await requireOrgContext()

  const rows = await db
    .select()
    .from(product)
    .where(and(eq(product.id, id), eq(product.organizationId, activeOrgId)))
    .limit(1)

  const r = rows[0]
  if (!r) return null

  return {
    id: r.id,
    name: r.name,
    category: r.category,
    webPageUrl: r.webPageUrl,
    price: r.price === null ? null : Number(r.price),
    imageUrl: r.imageUrl,
    totalStock: r.totalStock,
    accountingMetadata:
      (r.accountingMetadata as Record<string, unknown> | null) ?? {},
    additionalMetadata:
      (r.additionalMetadata as Record<string, unknown> | null) ?? {},
    stockMetadata: Array.isArray(r.stockMetadata)
      ? (r.stockMetadata as ProductStockLocation[])
      : [],
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }
}

// Distinct non-null categories for the active org's active products,
// alphabetically sorted — powers the category filter dropdown. Small
// cardinality (catalog sections), so a plain DISTINCT is fine.
export async function listProductCategories(): Promise<string[]> {
  const { activeOrgId } = await requireOrgContext()

  const rows = await db
    .selectDistinct({ category: product.category })
    .from(product)
    .where(
      and(
        eq(product.organizationId, activeOrgId),
        eq(product.status, "active"),
      ),
    )
    .orderBy(asc(product.category))

  return rows
    .map((r) => r.category)
    .filter((c): c is string => c !== null && c.trim().length > 0)
}

// Distinct dropdown options for each enumerable additional_metadata
// attribute, scoped to the org's active products. Numeric-valued keys sort
// numerically (year/rating high→low, aging/volume low→high); the rest sort
// alphabetically (RU locale). `awards` is intentionally NOT here — its
// values are long composite strings, so the UI exposes it as a free-text
// "contains" input rather than a dropdown. Fetched once on mount; a handful
// of distinct scans over an indexed org/status slice is cheap.
export type ProductFilterOptions = {
  type: string[]
  color: string[]
  sugar: string[]
  year: string[]
  aging: string[]
  bottleVolume: string[]
  countryName: string[]
  appelacion: string[]
  rating: string[]
  // `region` is a multi-select on the page; `regionsByCountry` lets the UI
  // narrow the region choices to the currently-selected countries (region is a
  // sub-level of country in the price-list hierarchy).
  region: string[]
  regionsByCountry: Record<string, string[]>
}

export async function listProductFilterOptions(): Promise<ProductFilterOptions> {
  const { activeOrgId } = await requireOrgContext()

  const distinct = async (jsonKey: string): Promise<string[]> => {
    const rows = await db
      .selectDistinct({
        v: sql<string>`${product.additionalMetadata} ->> ${jsonKey}`,
      })
      .from(product)
      .where(
        and(
          eq(product.organizationId, activeOrgId),
          eq(product.status, "active"),
          sql`COALESCE(TRIM(${product.additionalMetadata} ->> ${jsonKey}), '') <> ''`,
        ),
      )
    return rows.map((r) => r.v)
  }

  const numAsc = (a: string, b: string) => Number(a) - Number(b)
  const numDesc = (a: string, b: string) => Number(b) - Number(a)
  const alpha = (a: string, b: string) => a.localeCompare(b, "ru")

  const [
    type,
    color,
    sugar,
    year,
    aging,
    bottleVolume,
    countryName,
    appelacion,
    rating,
  ] = await Promise.all([
    distinct(ATTR_FILTER_KEYS.type),
    distinct(ATTR_FILTER_KEYS.color),
    distinct(ATTR_FILTER_KEYS.sugar),
    distinct(ATTR_FILTER_KEYS.year),
    distinct(ATTR_FILTER_KEYS.aging),
    distinct(ATTR_FILTER_KEYS.bottleVolume),
    distinct(ATTR_FILTER_KEYS.countryName),
    distinct(ATTR_FILTER_KEYS.appelacion),
    distinct(ATTR_FILTER_KEYS.rating),
  ])

  // Distinct (country, region) pairs → the flat region list + the per-country
  // region map, so the UI can scope region choices to the selected countries.
  const regionPairs = await db
    .selectDistinct({
      country: sql<string | null>`${product.additionalMetadata} ->> 'country_name'`,
      region: sql<string>`${product.additionalMetadata} ->> 'region'`,
    })
    .from(product)
    .where(
      and(
        eq(product.organizationId, activeOrgId),
        eq(product.status, "active"),
        sql`COALESCE(TRIM(${product.additionalMetadata} ->> 'region'), '') <> ''`,
      ),
    )

  const regionSet = new Set<string>()
  const regionsByCountry: Record<string, string[]> = {}
  for (const { country, region } of regionPairs) {
    regionSet.add(region)
    const c = (country ?? "").trim()
    if (!c) continue
    ;(regionsByCountry[c] ??= []).push(region)
  }
  for (const c of Object.keys(regionsByCountry)) {
    regionsByCountry[c] = [...new Set(regionsByCountry[c])].sort(alpha)
  }

  return {
    type: type.sort(alpha),
    color: color.sort(alpha),
    sugar: sugar.sort(alpha),
    year: year.sort(numDesc),
    aging: aging.sort(numAsc),
    bottleVolume: bottleVolume.sort(numAsc),
    countryName: countryName.sort(alpha),
    appelacion: appelacion.sort(alpha),
    rating: rating.sort(numDesc),
    region: [...regionSet].sort(alpha),
    regionsByCountry,
  }
}

// Seller description for the «order from request» split prompt (identity spec
// I4, §3.6 «order_request split», acceptance check §7.5). PURE, client-safe.
//
// The split prompt used to hard-code one industry. It now describes the org
// from its own profile — market roles + product / service names — and falls
// back to a neutral, industry-free text when the profile is empty, so the
// flow works for any org.

import { MARKET_ROLE_LABELS_RU, type MarketRole } from "@/lib/identity/org-profile"

/** Max product / service names named in the prompt. */
export const ORDER_INTAKE_MAX_PRODUCTS = 15

/** Neutral seller text when the org profile has no role and no products. */
export const NEUTRAL_SELLER = "a company that sells products or services to business clients"

export type OrderIntakeSellerInput = {
  name?: string | null
  marketRoles: readonly MarketRole[]
  products: readonly { name: string }[]
}

/**
 * One English sentence fragment naming the seller, e.g.
 * `"Пример" (market role: Производитель, Дистрибьютор / оптовик; products / services: A, B)`.
 * Deterministic. Role «Другое» carries no meaning and is left out.
 */
export function describeOrderIntakeSeller(input: OrderIntakeSellerInput | null): string {
  if (!input) return NEUTRAL_SELLER
  const roles = [...new Set(input.marketRoles)]
    .filter((r) => r !== "other")
    .map((r) => MARKET_ROLE_LABELS_RU[r])
    .filter(Boolean)
  const seen = new Set<string>()
  const products: string[] = []
  for (const p of input.products) {
    const name = (p?.name ?? "").trim()
    const key = name.toLowerCase()
    if (!name || seen.has(key)) continue
    seen.add(key)
    products.push(name)
  }
  const shown = products.slice(0, ORDER_INTAKE_MAX_PRODUCTS)
  const more = products.length - shown.length
  if (roles.length === 0 && shown.length === 0) return NEUTRAL_SELLER

  const details: string[] = []
  if (roles.length > 0) details.push(`market role: ${roles.join(", ")}`)
  if (shown.length > 0) {
    details.push(
      `products / services: ${shown.join(", ")}${more > 0 ? ` and ${more} more` : ""}`,
    )
  }
  const name = (input.name ?? "").trim()
  return `${name ? `"${name}", ` : ""}a company that sells to business clients (${details.join("; ")})`
}

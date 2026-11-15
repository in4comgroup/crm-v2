// Short org lines for AI prompts (identity spec I4, §3.6): the one-line
// «Наша компания: <name> — <roles>» and the product names line. PURE and
// deterministic (same input → same text). The full «О нашей компании» block
// is src/lib/identity/prompt-card.ts; these lines are for prompts that need
// only the name + role (topic matcher, deal state) or name + role + products
// (card writer, order split).

import { MARKET_ROLE_LABELS_RU, type MarketRole, type OrgProfileInput } from "@/lib/identity/org-profile"

export const ORG_PRODUCTS_LINE_MAX = 15

export type OrgPromptFacts = {
  name: string
  /** Russian role labels («Дистрибьютор» …), deduplicated. */
  roles: string[]
  /** Our product / service names, deduplicated, as entered. */
  products: string[]
}

function clean(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim()
}

function uniq(items: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of items) {
    const v = clean(raw)
    const k = v.toLowerCase()
    if (!v || seen.has(k)) continue
    seen.add(k)
    out.push(v)
  }
  return out
}

/** PURE. Name + role labels + product names from the org profile. */
export function orgPromptFacts(
  name: string | null | undefined,
  profile: Pick<OrgProfileInput, "marketRoles" | "products"> | null | undefined,
): OrgPromptFacts {
  return {
    name: clean(name),
    // «Другое» carries no meaning in a prompt.
    roles: uniq(
      (profile?.marketRoles ?? []).filter((r) => r !== "other").map((r) => MARKET_ROLE_LABELS_RU[r as MarketRole] ?? r),
    ),
    products: uniq((profile?.products ?? []).map((p) => p.name)),
  }
}

/** PURE. «Наша компания: <name> — <роли>.»; "" when there is neither a name nor a role. */
export function orgRoleLine(f: OrgPromptFacts): string {
  const roles = f.roles.map((r) => r.toLowerCase()).join(", ")
  if (!f.name && !roles) return ""
  if (!roles) return `Наша компания: ${f.name}.`
  return `Наша компания: ${f.name || "без названия"} — ${roles}.`
}

/** PURE. «Наши продукты и услуги: a; b; и ещё N.»; "" when the list is empty. */
export function orgProductsLine(f: OrgPromptFacts, max = ORG_PRODUCTS_LINE_MAX): string {
  if (f.products.length === 0) return ""
  const shown = f.products.slice(0, Math.max(1, max))
  const rest = f.products.length - shown.length
  return `Наши продукты и услуги: ${shown.join("; ")}${rest > 0 ? `; и ещё ${rest}` : ""}.`
}

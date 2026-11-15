// «О нашей компании» — the Russian org block for AI prompts (identity spec
// §3.5 / §3.6). PURE and deterministic: the same profile always gives the
// same text, so it can sit in a cached prompt prefix. ≤ 1,500 characters.
// Empty parts are left out. Used by I4 (prompts); built by the «us» resolver.

import {
  MARKET_ROLE_LABELS_RU,
  type MarketRole,
  type OrgProfileInput,
} from "@/lib/identity/org-profile"

export const PROMPT_CARD_MAX_CHARS = 1500

export type PromptCardInput = {
  name: string | null
  /** Other names (registry `name` entries), as entered; the org name is skipped. */
  otherNames: readonly string[]
  industryLabel: string | null
  profile: Pick<
    OrgProfileInput,
    "description" | "industryNote" | "marketRoles" | "products" | "targetCustomers" | "supplierTypes" | "glossary"
  >
}

// First caps per list; the length loop shrinks further when needed.
const CAPS = { otherNames: 5, products: 15, customers: 10, suppliers: 10, glossary: 10 } as const
const MEANING_MAX = 100

function clean(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim()
}

function sentence(s: string): string {
  const t = clean(s)
  if (!t) return ""
  return /[.!?…]$/.test(t) ? t : `${t}.`
}

function cut(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s
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

type ListPart = { label: string; items: string[]; shown: number }

function listLine(p: ListPart): string {
  if (p.items.length === 0 || p.shown <= 0) return ""
  const shown = p.items.slice(0, p.shown)
  const rest = p.items.length - shown.length
  return `${p.label}: ${shown.join("; ")}${rest > 0 ? `; и ещё ${rest}` : ""}.`
}

/** PURE. The «О нашей компании» block; "" when there is nothing to say. */
export function buildPromptCard(input: PromptCardInput): string {
  const name = clean(input.name)
  const p = input.profile
  const nameKey = name.toLowerCase()

  const other: ListPart = {
    label: "",
    items: uniq(input.otherNames).filter((n) => n.toLowerCase() !== nameKey),
    shown: CAPS.otherNames,
  }
  const roles = uniq(
    (p.marketRoles ?? []).map((r) => MARKET_ROLE_LABELS_RU[r as MarketRole] ?? r),
  )
  const industry = clean(input.industryLabel)
  const note = clean(p.industryNote)
  let description = sentence(p.description ?? "")

  const products: ListPart = {
    label: "Продукты и услуги",
    items: uniq((p.products ?? []).map((x) => x.name)),
    shown: CAPS.products,
  }
  const customers: ListPart = {
    label: "Наши клиенты",
    items: uniq((p.targetCustomers ?? []).map((x) => x.name)),
    shown: CAPS.customers,
  }
  const suppliers: ListPart = {
    label: "Кто продаёт нам",
    items: uniq((p.supplierTypes ?? []).map((x) => x.name)),
    shown: CAPS.suppliers,
  }
  const glossary: ListPart = {
    label: "Термины",
    items: uniq(
      (p.glossary ?? [])
        .filter((g) => clean(g.term) && clean(g.meaning))
        .map((g) => `${clean(g.term)} — ${cut(clean(g.meaning), MEANING_MAX)}`),
    ),
    shown: CAPS.glossary,
  }

  const render = (): string => {
    const lines: string[] = []
    if (name) {
      const shownOther = other.items.slice(0, other.shown)
      const rest = other.items.length - shownOther.length
      const aka = shownOther.length
        ? ` (${shownOther.join(", ")}${rest > 0 ? ` и ещё ${rest}` : ""})`
        : ""
      lines.push(`О нашей компании: ${name}${aka}.`)
    } else {
      lines.push("О нашей компании:")
    }
    if (roles.length) lines.push(`Роль: ${roles.join(", ")}.`)
    if (industry || note) {
      lines.push(`Отрасль: ${industry && note ? `${industry} (${note})` : industry || note}.`)
    }
    if (description) lines.push(`Чем занимаемся: ${description}`)
    for (const part of [products, customers, suppliers, glossary]) {
      const l = listLine(part)
      if (l) lines.push(l)
    }
    return lines.join("\n")
  }

  // Nothing beyond the header → no card.
  const hasBody =
    !!name || roles.length > 0 || !!industry || !!note || !!description ||
    products.items.length + customers.items.length + suppliers.items.length + glossary.items.length > 0
  if (!hasBody) return ""

  // Shrink deterministically until it fits: glossary, products, suppliers,
  // customers, other names (one item at a time, keeping ≥ 3 / 1), then the
  // description, then a hard cut.
  const order: [ListPart, number][] = [
    [glossary, 0],
    [products, 3],
    [suppliers, 1],
    [customers, 3],
    [other, 1],
    [products, 1],
    [customers, 1],
  ]
  let text = render()
  for (const [part, floor] of order) {
    while (text.length > PROMPT_CARD_MAX_CHARS && Math.min(part.shown, part.items.length) > floor) {
      part.shown = Math.min(part.shown, part.items.length) - 1
      text = render()
    }
  }
  if (text.length > PROMPT_CARD_MAX_CHARS && description) {
    const over = text.length - PROMPT_CARD_MAX_CHARS
    description = cut(description, Math.max(40, description.length - over - 1))
    text = render()
  }
  return cut(text, PROMPT_CARD_MAX_CHARS)
}

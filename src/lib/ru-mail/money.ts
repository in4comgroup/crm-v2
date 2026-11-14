// Russian-style money amount parsing.

export type MoneyAmount = {
  value: number
  currency: "RUB" | "USD" | "EUR" | "CNY" | ""
  vat: "incl" | "excl" | "unknown"
  raw: string
}

const NUM = String.raw`(?:\d{1,3}(?:[   ]\d{3})+(?:,\d{1,2})?|\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)`
const MULT = String.raw`(?:тыс\.?|т\.\s?р\.?|млн\.?|млрд\.?)`
const CUR = String.raw`(?:₽|руб(?:лей|ля|\.|(?![\p{L}]))|р\.|RUB|рублей|USD|\$|долл(?:аров|\.)?|€|EUR|евро|¥|CNY|юан(?:ей|я|ь)?)`

// Alt A: prefix symbol ($1,500). Alt B: number [multiplier|к] [currency].
const RE = new RegExp(
  String.raw`(?<![\d.,])(?:(?<pc>[$€¥₽]|USD|EUR|CNY|RUB)\s?(?<pn>${NUM})(?:\s?(?<pm>${MULT}))?|(?<n>${NUM})(?:(?<k>к)|\s?(?<m>${MULT}))?(?:\s?(?<c>${CUR}))?)`,
  "giu",
)

function currencyOf(s: string | undefined): MoneyAmount["currency"] {
  if (!s) return ""
  const x = s.toLowerCase().replace(/\s/g, "")
  if (x === "₽" || x.startsWith("руб") || x === "р." || x === "rub") return "RUB"
  if (x === "$" || x === "usd" || x.startsWith("долл")) return "USD"
  if (x === "€" || x === "eur" || x === "евро") return "EUR"
  if (x === "¥" || x === "cny" || x.startsWith("юан")) return "CNY"
  return ""
}

function numberOf(s: string): number {
  let t = s.replace(/[   ]/g, "")
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(t)) t = t.replace(/\./g, "")
  return parseFloat(t.replace(",", "."))
}

function multiplier(m: string | undefined, k: string | undefined): number {
  if (k) return 1e3
  if (!m) return 1
  const x = m.toLowerCase().replace(/\s/g, "")
  if (x.startsWith("млрд")) return 1e9
  if (x.startsWith("млн")) return 1e6
  return 1e3 // тыс, т.р.
}

function vatAfter(text: string, end: number): MoneyAmount["vat"] {
  const win = text.slice(end, end + 40).replace(/\d[\d\s.,]*(?:руб|₽).*/i, "")
  if (/без\s+(?:учета\s+|учёта\s+)?НДС|НДС\s+не\s+облагается|excl\.?\s*VAT/i.test(win)) return "excl"
  if (/в\s*т\.?\s*ч\.?\s*НДС|включая\s+НДС|с\s+НДС|вкл\.?\s*НДС|НДС\s+включ|incl(?:uding|\.)?\s*VAT/i.test(win)) return "incl"
  return "unknown"
}

/** Extract money amounts in text order. A bare number (no currency, no multiplier) is not money. */
export function parseMoneyRu(text: string): MoneyAmount[] {
  const out: MoneyAmount[] = []
  for (const m of text.matchAll(RE)) {
    const g = m.groups!
    const hasPrefix = g.pn !== undefined
    const numStr = hasPrefix ? g.pn : g.n
    const mult = hasPrefix ? g.pm : g.m
    const kk = hasPrefix ? undefined : g.k
    const curRaw = hasPrefix ? g.pc : g.c
    let currency = currencyOf(curRaw)
    if (!currency && mult && /^т\.\s?р/i.test(mult)) currency = "RUB"
    if (!hasPrefix && !curRaw && !mult && !kk) continue
    const value = numberOf(numStr) * multiplier(mult, kk)
    if (!Number.isFinite(value)) continue
    out.push({ value: Math.round(value * 100) / 100, currency, vat: vatAfter(text, m.index! + m[0].length), raw: m[0].trim() })
  }
  return out
}

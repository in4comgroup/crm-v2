// Privacy check of AI chat web-search queries (docs/specs/ai-chat/01 §5, Q3).
// PURE, client-safe. A web query may name companies, public persons, products
// and places; it must not carry a person's contact data out of the CRM to a
// search provider. Code check before the call: an e-mail address or a phone
// number → the search is refused.
//
// Phone heuristic (false positives cost more than they save, so it is narrow):
// a run of digits with phone punctuation, 9–15 digits in total, that starts
// with "+" or uses phone separators (space, dash, brackets) — or 11 plain
// digits starting with 7 / 8 (a Russian number). A plain 10 / 12-digit run is
// NOT a phone: that is the shape of a company tax number (ИНН), which is
// public and a legitimate web lookup. Years and dates (2019–2020, 16.11.2026)
// never reach 9 digits in one run.

export type WebQueryPrivacyIssue = "email" | "phone"

const EMAIL = /[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[a-z]{2,}/i
const PHONE_RUN = /\+?\(?\d[\d\s().-]{6,}\d/g

export function webQueryPrivacyIssue(query: string): WebQueryPrivacyIssue | null {
  if (EMAIL.test(query)) return "email"
  for (const m of query.matchAll(PHONE_RUN)) {
    const run = m[0].trim()
    const digits = run.replace(/\D/g, "")
    if (digits.length < 9 || digits.length > 15) continue
    const plus = run.startsWith("+")
    const separated = /\d[\s().-]+\d/.test(run) || run.startsWith("(")
    const ruPlain = !separated && digits.length === 11 && /^[78]/.test(digits)
    if (plus || separated || ruPlain) return "phone"
  }
  return null
}

/** Russian text the model gets instead of search results. */
export function webQueryPrivacyMessage(issue: WebQueryPrivacyIssue): string {
  const what = issue === "email" ? "адрес электронной почты" : "номер телефона"
  return `Поиск в интернете не выполнен: запрос содержит контактные данные (${what}). Контактные данные из CRM не передаются в поиск. Повторите поиск по названию компании, имени публичного человека, товару или месту — без контактных данных.`
}

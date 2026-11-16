// Relationship of a company with us — the five tabs of «Компании» (Companies)
// and the «Отношения» fact of the AI chat. ONE rule (pure, client-safe):
// a manual «Поставщик» / «Партнёр» tag (`client.custom_fields.companyKind`)
// wins; otherwise a won deal → «Клиент», an open deal → «Потенциальный»,
// neither → «Не определено». Deal stages count by ROLE (docs/specs/funnel
// §3.1): won = role `won`; open = role `area0` / `active` with deal status
// active / paused.

export const CLIENT_RELATIONS = ["customers", "potential", "supplier", "partner", "unclassified"] as const
export type ClientRelation = (typeof CLIENT_RELATIONS)[number]

export const CLIENT_RELATION_LABELS: Record<ClientRelation, string> = {
  customers: "Клиент",
  potential: "Потенциальный",
  supplier: "Поставщик",
  partner: "Партнёр",
  unclassified: "Не определено",
}

export function clientRelation(input: {
  companyKind: unknown
  hasWonDeal: boolean
  hasOpenDeal: boolean
}): ClientRelation {
  if (input.companyKind === "supplier") return "supplier"
  if (input.companyKind === "partner") return "partner"
  if (input.hasWonDeal) return "customers"
  if (input.hasOpenDeal) return "potential"
  return "unclassified"
}

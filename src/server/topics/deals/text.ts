// Russian text of the deal cards (spec topics/01 §9.1): fixed phrases by
// code and stage, no LLM. PURE (unit-tested in ./text.test.ts).

import type { DealCardProposal } from "@/lib/topics/cards"

export type DealCardText = { headline: string; analysis: string; recommendation: string; taskTitle: string }

function quote(s: string, max = 240): string {
  const t = s.replace(/\s+/g, " ").trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

export function dealCardText(kind: "deal_proposal" | "stage_confirmation" | "deal_link", p: DealCardProposal): DealCardText {
  const who = p.clientName || p.contactName || "Клиент"
  let headline: string
  let recommendation: string
  if (kind === "deal_link") {
    // Spec topics/10 §3: the client has 2+ open deals — a person picks one.
    const n = p.dealOptions?.length ?? 0
    headline = `${who} — к какой сделке относится тема?`
    recommendation = [
      `Тема «${p.dealName}» не связана со сделкой, а у компании ${n} открытых сделок.`,
      "Выберите сделку и нажмите «Связать» — её состояние будет обновляться по этой теме.",
      "Если тема не относится ни к одной сделке — нажмите «Ни к одной».",
    ].join("\n")
    const why = p.evidence ? `${p.codeLabelRu}: «${quote(p.evidence)}»` : p.codeLabelRu
    const analysis = [headline, `Почему: ${why}`, `Решает человек: ${p.reasonRu}`].join("\n\n")
    return { headline, analysis, recommendation, taskTitle: "Связать тему со сделкой" }
  }
  if (kind === "deal_proposal") {
    headline = p.dealTypeLabelRu ? `${who} — новая возможность: ${p.dealTypeLabelRu}` : `${who} — новая возможность`
    recommendation = [
      `Создать сделку «${p.dealName}»${p.dealTypeLabelRu ? ` (${p.dealTypeLabelRu})` : ""}${
        p.stageLabelRu ? ` на стадии «${p.stageLabelRu}»` : ""
      }.`,
      "Если это не сделка — нажмите «Не сделка» и укажите причину.",
    ].join("\n")
  } else {
    const to = p.stageLabelRu ?? "следующую стадию"
    switch (p.action) {
      case "outcome_won":
        headline = `${who} — сделка выиграна?`
        break
      case "outcome_lost":
        headline = `${who} — сделка проиграна?`
        break
      case "pause":
        headline = `${who} — поставить сделку на паузу?`
        break
      case "resume":
        headline = `${who} — снять сделку с паузы?`
        break
      default:
        headline = `${who} — перевести сделку в «${to}»?`
    }
    recommendation =
      p.action === "pause" || p.action === "resume"
        ? "Подтвердите или отклоните."
        : `Подтвердите перевод${p.fromStageLabelRu ? ` «${p.fromStageLabelRu}» →` : ""} «${to}» или отклоните.`
  }
  const why = p.evidence ? `${p.codeLabelRu}: «${quote(p.evidence)}»` : p.codeLabelRu
  const analysis = [headline, `Почему: ${why}`, `Решает человек: ${p.reasonRu}`].join("\n\n")
  const taskTitle = kind === "deal_proposal" ? "Проверить возможность" : "Проверить стадию сделки"
  return { headline, analysis, recommendation, taskTitle }
}

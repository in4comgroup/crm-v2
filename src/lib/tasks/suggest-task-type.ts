/**
 * Task type from the meaning of a text — ONE rule set for every place that
 * guesses it: the cards' «Создать задачу» (bug list 2026-11-21, item 24) and
 * the AI chat task drafts (`taskTypeFromTitle`, src/lib/chat/actions.ts).
 * Pure, client-safe.
 *
 * `suggestTaskType` order of checks:
 *  1. the task title (the action itself), then the card headline + steps —
 *     keyword rules in `RULES` order: channel actions (call, meeting) win over
 *     subjects (complaint, documents, offer), a generic «написать / ответить»
 *     (email) is the weakest;
 *  2. the topic family (signal_category.family of the lead code);
 *  3. the old card category «support»;
 *  4. "other".
 */

import type { TaskType } from "@/db/schema"

type Rule = { type: TaskType; stems: string[]; exact?: string[] }

// Stems are matched at the START of a word (Cyrillic-aware), so «кп» does not
// match inside «купить» and «акт» does not match «контакт».
const RULES: Rule[] = [
  { type: "call", stems: ["позвон", "перезвон", "звонок", "звонк", "созвон", "набрать"] },
  { type: "meet", stems: ["встреч", "встрет", "визит", "переговор", "демонстрац", "презентац"], exact: ["демо"] },
  { type: "support", stems: ["жалоб", "претенз", "рекламац", "поддержк", "неисправн"] },
  { type: "docs", stems: ["договор", "контракт", "счёт", "счет", "документ", "акт", "приложени", "спецификац", "доверенност", "подпис"] },
  { type: "offer", stems: ["кп", "коммерческ", "предложени", "прайс", "смет", "расчёт", "расчет", "услови"] },
  { type: "email", stems: ["письм", "email", "e-mail", "почт", "написать", "ответить", "напомнить"] },
]

const FAMILY_TYPE: Record<string, TaskType> = {
  meeting: "meet",
  contact: "call",
  complaint: "support",
  contract: "docs",
  invoice: "docs",
  offer: "offer",
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-zа-яё0-9-]+/i)
    .filter(Boolean)
}

/** The type a text points to, or null when no rule matches. */
export function taskTypeFromText(text: string): TaskType | null {
  const ws = words(text)
  if (ws.length === 0) return null
  for (const rule of RULES) {
    if (ws.some((w) => rule.stems.some((s) => w.startsWith(s)) || rule.exact?.includes(w))) return rule.type
  }
  return null
}

export function suggestTaskType(input: {
  taskTitle?: string | null
  headline?: string | null
  steps?: readonly string[] | null
  family?: string | null
  category?: string | null
}): TaskType {
  return (
    taskTypeFromText(input.taskTitle ?? "") ??
    taskTypeFromText([input.headline ?? "", ...(input.steps ?? [])].join(" ")) ??
    (input.family ? FAMILY_TYPE[input.family] : undefined) ??
    (input.category === "support" ? "support" : null) ??
    "other"
  )
}

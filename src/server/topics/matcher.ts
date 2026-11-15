import "server-only"

import { Output } from "ai"
import { z } from "zod"
import { aiGenerateText } from "@/server/ai/runtime"
import { getTopicsOrgPrompt } from "@/server/identity/prompt-context"
import type { MatcherDecision, MatcherInput, TopicMatcher } from "./resolver"

// LLM topic matcher (spec topics/01 §6.2 step 5; AI process
// `topics.topic_match`). Gets one subject and ≤ 10 candidate topics and
// returns `{ topicId | "NEW", confidence, reason }`. The id must be COPIED
// from the list — the resolver treats any other value as NEW, and applies
// the R15 bias when the confidence is not `high`. Prompt in Russian (Q6).
// The model never sees scores.

export const TOPIC_MATCH_PROCESS = "topics.topic_match" as const

export const topicMatchSchema = z.object({
  topicId: z.string().describe('id темы из списка, скопированный точно, или "NEW"'),
  confidence: z.enum(["high", "medium", "low"]),
  reason: z.string().describe("коротко, по-русски, до 30 слов"),
})

const SYSTEM = `Ты сопоставляешь деловой вопрос из нового сообщения с открытыми темами CRM.
Тема — ОДИН конкретный деловой вопрос между нашей компанией и клиентом или поставщиком: один запрос, одна проблема, один счёт, один заказ, одна претензия.

Правила:
1. Объединяй только в рамках ОДНОГО делового вопроса. Общий клиент или общая переписка — не причина объединять.
2. Два разных счёта, два разных заказа, претензия и не связанный с ней запрос цены — разные темы.
3. Один вопрос в разных каналах (почта, Telegram, встреча) — одна тема.
4. Тот же номер документа (счёт, заказ, КП, договор, УПД) у того же контрагента — та же тема.
5. Напоминание о своём же запросе («Ну что, когда будет КП?») и эскалация претензии — та же тема.
6. Закрывающий факт («счёт оплатили», «замену получили», «КП отправили») относится к теме, которую он закрывает.
7. Если ни одна тема не подходит — верни "NEW".

Ответ: topicId — id темы, скопированный из списка символ в символ, или "NEW"; confidence — high только если уверен; reason — коротко по-русски.`

/**
 * Identity I4: the system prompt with the line «Наша компания: <name> —
 * <роли>» («our» vs «their» side of a question). No line (switch
 * `identity.promptContext` off, or nothing known) → the pre-I4 text.
 */
export function buildTopicMatchSystem(orgRoleLine?: string | null): string {
  const line = (orgRoleLine ?? "").trim()
  return line ? `${SYSTEM}\n\n${line}` : SYSTEM
}

function refs(list: { kind: string; value: string }[]): string {
  return list.length ? list.map((r) => `${r.kind} ${r.value}`).join("; ") : "—"
}

export function buildTopicMatchPrompt(input: MatcherInput): string {
  const s = input.subject
  const lines: string[] = []
  lines.push("НОВОЕ СООБЩЕНИЕ")
  lines.push(`Дата: ${input.itemDate.toISOString().slice(0, 10)}; направление: ${input.direction}`)
  lines.push(`Контрагент: ${s.counterparty || "неизвестен"}`)
  lines.push(`Вопрос: ${s.matter || "—"}`)
  lines.push(`Номера документов: ${refs(s.references)}`)
  lines.push(`Товары: ${s.products.length ? s.products.join(", ") : "—"}`)
  if (s.amounts.length) lines.push(`Суммы: ${s.amounts.join(", ")}`)
  lines.push("Сигналы:")
  for (const c of s.codes) lines.push(`- ${c.code} (${c.labelRu}): «${c.evidence.slice(0, 300)}»`)
  lines.push("")
  lines.push("ТЕМЫ-КАНДИДАТЫ")
  for (const t of input.candidates) {
    lines.push(`id: ${t.id}`)
    lines.push(`  Название: ${t.title}`)
    lines.push(`  Вопрос: ${t.matter || "—"}; семейство: ${t.family ?? "—"}; ведущий код: ${t.leadCode ?? "—"}; статус: ${t.status}`)
    lines.push(`  Номера: ${refs(t.references)}; товары: ${t.products.length ? t.products.slice(0, 10).join(", ") : "—"}`)
    for (const e of t.lastEvents) lines.push(`  · ${e}`)
  }
  return lines.join("\n")
}

/** The production matcher: one `topics.topic_match` call per subject. */
export function createLlmTopicMatcher(orgId: string): TopicMatcher {
  // Loaded once per matcher (= per org run), on the first call.
  let system: Promise<string> | null = null
  return async (input: MatcherInput): Promise<MatcherDecision> => {
    system ??= getTopicsOrgPrompt(orgId)
      .then((p) => buildTopicMatchSystem(p?.roleLine))
      .catch((e) => {
        console.error("[topics/matcher] org prompt failed", orgId, e)
        return SYSTEM
      })
    const result = await aiGenerateText({
      process: TOPIC_MATCH_PROCESS,
      orgId,
      userId: null,
      ref: { sourceItemId: input.itemId },
      output: Output.object({ schema: topicMatchSchema }),
      system: await system,
      prompt: buildTopicMatchPrompt(input),
      temperature: 0,
    })
    const out = result.output
    return { topicId: out.topicId.trim(), confidence: out.confidence, reason: out.reason.slice(0, 500) }
  }
}

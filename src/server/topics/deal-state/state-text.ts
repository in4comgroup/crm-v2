// Deal state text («Текущее состояние», spec topics/01 §9.3): prompt, output
// schema and the deterministic server checks. PURE: no DB, no I/O — the
// summary runner (summary.ts) loads the input and calls the model.

import { z } from "zod"
import { clientFieldsBlock } from "@/lib/topics/client-fields-block"
import { DEAL_STATE_NO_DATA_TEXT } from "@/lib/topics/deal-state"

export const DEAL_STATE_PROCESS = "deals.state_summary" as const

export const STATE_MAX_SENTENCES = 3
export const STATE_MAX_WORDS = 50
export const RISK_EXPLANATION_MAX_SENTENCES = 2
export const RISK_EXPLANATION_MAX_WORDS = 40
export const STATE_MAX_ITEMS = 8

// ── Input ─────────────────────────────────────────────────────────────────

export type DealStateItemInput = {
  /** Source item id — the only ids the model may cite. */
  id: string
  date: string
  /** «от клиента» / «от нас» / «внутреннее» */
  directionRu: string
  topicTitle: string
  from: string | null
  subject: string | null
  excerpt: string
}

export type DealStateTopicInput = {
  id: string
  title: string
  statusRu: string
  waitingRu: string
  leadCodeLabel: string | null
  references: string[]
  products: string[]
  amounts: string[]
  deadlines: string[]
  /** Last journal events in Russian («Сообщение добавлено», «Тема решена» …). */
  lastEvents: string[]
}

export type DealStateRiskInput = {
  id: string
  labelRu: string
  descriptionRu: string
  severity: number
  evidence: string[]
  sourceItemIds: string[]
}

export type DealStateInput = {
  dealId: string
  dealName: string
  clientName: string
  stageName: string
  statusRu: string
  dealTypeLabel: string | null
  amount: string | null
  pausedUntil: string | null
  topics: DealStateTopicInput[]
  items: DealStateItemInput[]
  risks: DealStateRiskInput[]
  previousText: string | null
  today: string
  /**
   * Identity I4 (only with `identity.promptContext`): «Наша компания: <name>
   * — <роли>». Absent / "" → the prompt is the pre-I4 text.
   */
  orgRoleLine?: string | null
  /** Identity I4: «Профиль клиента «…»: …» of the deal's client ("" / null = none). */
  clientProfile?: string | null
  /**
   * Custom fields (spec clients-contacts Q11, only with `identity.promptContext`):
   * «Название: значение» lines of the client's SHOWN fields ("" / null = none).
   */
  clientFields?: string | null
}

// ── Output ────────────────────────────────────────────────────────────────

export const dealStateSchema = z.object({
  decision: z.enum(["UPDATE", "NOOP"]),
  text: z.string(),
  sourceItemIds: z.array(z.string()),
  riskExplanations: z.array(
    z.object({ riskId: z.string(), text: z.string(), sourceItemIds: z.array(z.string()) }),
  ),
  riskClearProposals: z.array(z.object({ riskId: z.string(), sourceItemId: z.string(), reason: z.string() })),
})
export type DealStateOutput = z.infer<typeof dealStateSchema>

export const DEAL_STATE_SYSTEM = `Ты пишешь блок «Текущее состояние» сделки в CRM. Человек, который не знает сделку, читает один короткий текст и понимает: где мы сейчас, чего ждём, что мешает, какой следующий шаг.

Правила текста:
- Не больше 3 коротких предложений и не больше 50 слов. Связный текст, не поля и не список.
- Не повторяй название стадии воронки — она и так видна.
- Только факты из источников. Не придумывай намерений, сроков и причин, которых в источниках нет.
- Опирайся на всю историю сделки, а не только на последнее сообщение.
- Показывай изменения: новые даты, новые требования, отменённые договорённости.
- Всегда называй следующий шаг. Если он не определён — так и напиши: «следующий шаг не определён».
- Ясно укажи, кто должен действовать: клиент или мы.
- Никогда не выдумывай причину задержки. Молчание клиента — не отказ.
- Без общих фраз вроде «работа со сделкой продолжается», «клиент заинтересован», «ведутся переговоры».
- Пиши по-русски, без имён сотрудников и без оценок вероятности.

Решение:
- UPDATE — ситуация изменилась (или прежнего текста нет): дай новый текст.
- NOOP — по сути ничего не изменилось и прежний текст верен («переформулировать не требуется»). Тогда text — прежний текст.

Источники:
- sourceItemIds — id сообщений из списка «Сообщения», на которых основан текст. Копируй id точно. Другие id запрещены.

Риски (если есть активные риски):
- riskExplanations — для каждого активного риска 1–2 предложения (до 40 слов): в чём риск и на чём основана оценка, со ссылкой на сообщения (sourceItemIds из списка).
- riskClearProposals — только если в сообщениях ЯВНО видно, что ситуация риска изменилась (например, согласована дата и следующий шаг): id риска, id сообщения-доказательства из списка и причина одной фразой. Если сомневаешься — пустой список.`

function lines(xs: readonly string[], prefix = "  - "): string {
  return xs.length ? xs.map((x) => `${prefix}${x}`).join("\n") : `${prefix}—`
}

export function buildDealStatePrompt(input: DealStateInput): string {
  const parts: string[] = []
  parts.push(`Сегодня: ${input.today}`)
  const orgLine = (input.orgRoleLine ?? "").trim()
  if (orgLine) {
    parts.push(
      [
        "## Наша компания",
        orgLine,
        "«Мы» в тексте — эта компания. Не придумывай наших предложений, продуктов и обещаний, которых нет в источниках.",
      ].join("\n"),
    )
  }
  const clientProfile = (input.clientProfile ?? "").trim()
  parts.push(
    [
      "## Сделка",
      `Название: ${input.dealName}`,
      `Клиент: ${input.clientName}`,
      clientProfile || null,
      clientFieldsBlock(input.clientFields) || null,
      `Стадия: ${input.stageName}`,
      `Статус: ${input.statusRu}${input.pausedUntil ? ` (пауза до ${input.pausedUntil})` : ""}`,
      input.dealTypeLabel ? `Тип: ${input.dealTypeLabel}` : null,
      input.amount ? `Сумма: ${input.amount}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
  )
  parts.push(
    [
      "## Темы сделки",
      ...input.topics.map((t) =>
        [
          `### ${t.title}`,
          `Статус: ${t.statusRu}; ${t.waitingRu}`,
          t.leadCodeLabel ? `Главный сигнал: ${t.leadCodeLabel}` : null,
          t.references.length ? `Номера: ${t.references.join(", ")}` : null,
          t.products.length ? `Товары: ${t.products.join(", ")}` : null,
          t.amounts.length ? `Суммы: ${t.amounts.join(", ")}` : null,
          t.deadlines.length ? `Сроки:\n${lines(t.deadlines)}` : null,
          t.lastEvents.length ? `Последние события:\n${lines(t.lastEvents)}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
      ),
    ].join("\n\n"),
  )
  parts.push(
    [
      "## Сообщения (от старых к новым)",
      ...input.items.map((i) =>
        [
          `### id: ${i.id}`,
          `Дата: ${i.date}; ${i.directionRu}; тема: ${i.topicTitle}${i.from ? `; автор: ${i.from}` : ""}`,
          i.subject ? `Тема письма: ${i.subject}` : null,
          i.excerpt,
        ]
          .filter(Boolean)
          .join("\n"),
      ),
    ].join("\n\n"),
  )
  if (input.risks.length) {
    parts.push(
      [
        "## Активные риски",
        ...input.risks.map((r) =>
          [
            `### riskId: ${r.id}`,
            `${r.labelRu} (важность ${r.severity}/9)`,
            `Описание: ${r.descriptionRu}`,
            r.evidence.length ? `Цитаты:\n${lines(r.evidence.map((e) => `«${e}»`))}` : null,
            r.sourceItemIds.length ? `Сообщения: ${r.sourceItemIds.join(", ")}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        ),
      ].join("\n\n"),
    )
  }
  parts.push(`## Прежний текст «Текущее состояние»\n${input.previousText?.trim() || "— (ещё нет)"}`)
  parts.push("Верни decision, text, sourceItemIds, riskExplanations, riskClearProposals.")
  return parts.join("\n\n")
}

// ── Server checks (§9.3, R16) ─────────────────────────────────────────────

/** Generic phrases that say nothing (v2 stop list). Lower-case, «ё» → «е». */
export const STATE_STOP_PHRASES = [
  "работа со сделкой продолжается",
  "работа по сделке продолжается",
  "работа продолжается",
  "клиент заинтересован",
  "ведутся переговоры",
  "идут переговоры",
  "переговоры продолжаются",
  "сделка в процессе",
  "сделка находится в работе",
  "ситуация стабильная",
  "все идет по плану",
  "все под контролем",
  "ожидается положительное решение",
  "есть хорошие перспективы",
] as const

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim()

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length
}

/** Sentences: split at . ! ? … followed by a space / end; dates «20.11» and «т.е.» are not ends. */
export function countSentences(text: string): number {
  const t = text.trim()
  if (!t) return 0
  const parts = t.split(/(?<=[.!?…])\s+(?=[«"(]?[A-ZА-ЯЁ0-9])/u).filter((p) => /[\p{L}\p{N}]/u.test(p))
  return parts.length
}

export type StateCheck = { ok: true } | { ok: false; reasons: string[] }

/** Checks of the state text (and, with other limits, of a risk explanation). */
export function checkStateText(
  text: string,
  opts: {
    stageName?: string | null
    maxSentences?: number
    maxWords?: number
  } = {},
): StateCheck {
  const reasons: string[] = []
  const t = text.trim()
  const maxS = opts.maxSentences ?? STATE_MAX_SENTENCES
  const maxW = opts.maxWords ?? STATE_MAX_WORDS
  if (!t) return { ok: false, reasons: ["пустой текст"] }
  const words = countWords(t)
  if (words > maxW) reasons.push(`слов ${words} > ${maxW}`)
  const sentences = countSentences(t)
  if (sentences > maxS) reasons.push(`предложений ${sentences} > ${maxS}`)
  const n = norm(t)
  const hit = STATE_STOP_PHRASES.find((p) => n.includes(p))
  if (hit) reasons.push(`общая фраза «${hit}»`)
  if (opts.stageName) {
    const stage = norm(opts.stageName)
    const rest = norm(n.replace(stage, " ").replace(/(стадия|этап|сделка|находится|на|в)/g, " ").replace(/[^\p{L}\p{N}]+/gu, " "))
    if (n.includes(stage) && countWords(rest) < 3) reasons.push("текст повторяет только стадию")
  }
  return reasons.length ? { ok: false, reasons } : { ok: true }
}

/** Every cited id must be in the input; returns the unknown ones. */
export function unknownIds(ids: readonly string[], allowed: ReadonlySet<string>): string[] {
  return ids.filter((id) => !allowed.has(id.trim()))
}

export type StateDecision =
  | { decision: "UPDATE"; text: string; sourceItemIds: string[] }
  | { decision: "NOOP" }
  | { decision: "REJECTED"; text: string; reasons: string[] }

/**
 * Server decision on the model output (§9.3): UPDATE needs a text that passes
 * the checks and cites ≥ 1 input item (when the input has items) and no
 * unknown id; NOOP keeps the old text. NOOP with no previous text = treated as
 * UPDATE (there is nothing to keep).
 */
export function decideStateOutput(
  out: Pick<DealStateOutput, "decision" | "text" | "sourceItemIds">,
  ctx: { previousText: string | null; stageName: string | null; itemIds: ReadonlySet<string> },
): StateDecision {
  const prev = ctx.previousText?.trim() || null
  if (out.decision === "NOOP" && prev) return { decision: "NOOP" }
  const text = out.text.trim().replace(/\s+/g, " ")
  if (prev && norm(text) === norm(prev)) return { decision: "NOOP" }
  const reasons: string[] = []
  const check = checkStateText(text, { stageName: ctx.stageName })
  if (!check.ok) reasons.push(...check.reasons)
  const ids = [...new Set(out.sourceItemIds.map((s) => s.trim()).filter(Boolean))]
  const bad = unknownIds(ids, ctx.itemIds)
  if (bad.length) reasons.push(`неизвестные источники: ${bad.join(", ")}`)
  if (ctx.itemIds.size > 0 && ids.length === 0) reasons.push("нет ссылок на источники")
  if (reasons.length) return { decision: "REJECTED", text, reasons }
  return { decision: "UPDATE", text, sourceItemIds: ids }
}

export type CheckedRiskExplanation = { riskId: string; text: string; sourceItemIds: string[] }
export type CheckedClearProposal = { riskId: string; sourceItemId: string; reason: string }

/** Risk explanations that pass the §9.3 checks (others fall back to description_ru, R17). */
export function checkRiskExplanations(
  xs: DealStateOutput["riskExplanations"],
  ctx: { riskIds: ReadonlySet<string>; itemIds: ReadonlySet<string> },
): { accepted: CheckedRiskExplanation[]; rejected: { riskId: string; reasons: string[] }[] } {
  const accepted: CheckedRiskExplanation[] = []
  const rejected: { riskId: string; reasons: string[] }[] = []
  const seen = new Set<string>()
  for (const x of xs) {
    const riskId = x.riskId.trim()
    if (!ctx.riskIds.has(riskId) || seen.has(riskId)) continue
    const text = x.text.trim().replace(/\s+/g, " ")
    const ids = [...new Set(x.sourceItemIds.map((s) => s.trim()).filter(Boolean))]
    const reasons: string[] = []
    const c = checkStateText(text, { maxSentences: RISK_EXPLANATION_MAX_SENTENCES, maxWords: RISK_EXPLANATION_MAX_WORDS })
    if (!c.ok) reasons.push(...c.reasons)
    const bad = unknownIds(ids, ctx.itemIds)
    if (bad.length) reasons.push(`неизвестные источники: ${bad.join(", ")}`)
    if (ids.length === 0) reasons.push("нет ссылок на источники")
    if (reasons.length) {
      rejected.push({ riskId, reasons })
      continue
    }
    seen.add(riskId)
    accepted.push({ riskId, text, sourceItemIds: ids })
  }
  return { accepted, rejected }
}

/** Clear proposals: accepted only with a cited input item (§9.4). */
export function checkClearProposals(
  xs: DealStateOutput["riskClearProposals"],
  ctx: { riskIds: ReadonlySet<string>; itemIds: ReadonlySet<string> },
): CheckedClearProposal[] {
  const out: CheckedClearProposal[] = []
  const seen = new Set<string>()
  for (const x of xs) {
    const riskId = x.riskId.trim()
    const itemId = x.sourceItemId.trim()
    if (!ctx.riskIds.has(riskId) || seen.has(riskId) || !ctx.itemIds.has(itemId)) continue
    const reason = x.reason.trim().replace(/\s+/g, " ").slice(0, 300)
    if (!reason) continue
    seen.add(riskId)
    out.push({ riskId, sourceItemId: itemId, reason })
  }
  return out
}

// ── Fixed texts (§9.3 special cases) ──────────────────────────────────────

function trimWords(s: string, max: number): string {
  const w = s.trim().replace(/\s+/g, " ").split(" ")
  return w.length <= max ? w.join(" ") : `${w.slice(0, max).join(" ")}…`
}

function clause(s: string | null, max: number): string | null {
  const t = (s ?? "").trim().replace(/[.!…\s]+$/u, "")
  return t ? trimWords(t, max).replace(/[.!…\s]+$/u, "") : null
}

/**
 * Fixed text for a deal that needs no model call: no linked topic → «нет
 * данных»; won → short result; lost → the established reason, or none;
 * cancelled (we withdrew) → the reason, or none. Returns null when the model runs.
 */
export function fixedStateText(args: {
  outcome: "won" | "lost" | "withdrawn" | null
  outcomeReason: string | null
  hasTopics: boolean
}): string | null {
  const reason = clause(args.outcomeReason, 35)
  if (args.outcome === "won") return reason ? `Сделка выиграна: ${reason}.` : "Сделка выиграна."
  if (args.outcome === "lost") return reason ? `Сделка проиграна: ${reason}.` : "Сделка проиграна, причина не установлена."
  if (args.outcome === "withdrawn") return reason ? `Сделка закрыта по нашему решению: ${reason}.` : "Сделка закрыта по нашему решению."
  if (!args.hasTopics) return DEAL_STATE_NO_DATA_TEXT
  return null
}

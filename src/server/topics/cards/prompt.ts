// Card writer prompt + output schema (spec topics/01 §9.1; AI process
// `topics.card_writer`). PURE (no server imports) so tests can check that
// the prompt never carries the score / band / profile. The AI call lives in
// writer.ts.

import { z } from "zod"
import { CARD_TEXT_LIMITS, type CardWriterDecision, type TopicCardText } from "@/lib/topics/cards"

export const CARD_WRITER_PROCESS = "topics.card_writer" as const

const L = CARD_TEXT_LIMITS

export const cardWriterSchema = z.object({
  decision: z.enum(["NEW", "UPDATE", "NOOP"]),
  cardId: z.string().describe('id текущей карточки, скопированный точно (для UPDATE), иначе ""'),
  headline: z.string().describe(`до ${L.headlineWords} слов: «<Компания> — <наше действие>, <цель>»`),
  whyNow: z.string().describe(`«Почему сейчас», до ${L.whyNowWords} слов`),
  whatChanged: z.string().describe(`«Что изменилось», до ${L.whatChangedWords} слов, или "" если ничего`),
  steps: z.array(z.string()).describe(`1–${L.maxSteps} шага, каждый до ${L.stepWords} слов`),
  taskTitle: z.string().describe(`название задачи, до ${L.taskTitleWords} слов`),
})

export type CardWriterOutput = {
  decision: CardWriterDecision
  cardId: string
  text: TopicCardText
}

export type CardWriterInput = {
  topicId: string
  /** Item the card refers to (newest item of the topic), for `ref`. */
  sourceItemId: string | null
  today: string // YYYY-MM-DD
  topic: {
    title: string
    matter: string
    counterparty: string
    /** Contact name — NOT shown to the model (roles, not names, §9.1). */
    contact: string | null
    status: string
    waiting: "waiting_on_us" | "waiting_on_them" | "none"
    family: string | null
    leadCode: string | null
    leadLabelRu: string | null
    /** Writing guidance of the lead code (`card_note_ru`). */
    leadNoteRu: string | null
    class: "risk" | "chance" | "fyi" | null
    references: string[]
    products: string[]
  }
  /** Detected signals with verbatim quotes, oldest first. */
  signals: { code: string; labelRu: string; date: string; evidence: string; isNew: boolean }[]
  /** Recent items, oldest first (compact). */
  items: { date: string; direction: string; from: string | null; subject: string | null; text: string; isNew: boolean }[]
  deadlines: string[]
  overdue: boolean
  /** Open card (UPDATE candidate) or the last decided card (context only). */
  current: {
    id: string
    status: string
    headline: string
    whyNow: string
    whatChanged: string
    steps: string[]
  } | null
  /** R17 / admin: the card must be rewritten (UPDATE), with this reason. */
  force: string | null
}

export type CardWriter = (input: CardWriterInput) => Promise<CardWriterOutput>

const CLASS_RU = { risk: "риск", chance: "возможность", fyi: "к сведению" } as const
const WAITING_RU = { waiting_on_us: "ждут нашего действия", waiting_on_them: "ждём ответа клиента", none: "—" } as const

export const CARD_WRITER_SYSTEM = `Ты пишешь карточку для менеджера CRM по ОДНОЙ теме — одному деловому вопросу между нашей компанией и клиентом или поставщиком.
Пиши по-русски, коротко, деловым языком.

Поля карточки:
- headline — до ${L.headlineWords} слов, строго в форме «<Компания> — <наше действие>, <цель>». Например: «Ромашка — отправить КП на корпоратив, чтобы не потерять заказ».
- whyNow — «Почему сейчас», до ${L.whyNowWords} слов: что произошло и почему нужно действовать.
- whatChanged — «Что изменилось» с прошлой версии карточки, до ${L.whatChangedWords} слов. Пустая строка, если карточки ещё не было или по делу ничего не изменилось.
- steps — от 1 до ${L.maxSteps} шагов, каждый до ${L.stepWords} слов, в повелительном наклонении («Отправить…», «Позвонить…»). Без нумерации в тексте.
- taskTitle — название задачи до ${L.taskTitleWords} слов («Отправить КП Ромашке»).

Правила:
1. Только факты из входных данных. Не придумывай даты, суммы, номера, имена, сроки. Если даты нет — не пиши её.
2. Роли, а не имена: НИКОГДА не пиши имена и фамилии людей (ни наших, ни клиента) — только роли: «менеджер», «новый ЛПР клиента», «закупщик клиента», «бухгалтерия», «склад». Название компании писать можно.
3. Без поздравлений, без восклицаний, без оценок вроде «отлично».
4. Компания — название клиента из данных; если его нет — контакт; если нет и его — «Клиент».

Решение decision:
- Карточки ещё нет → NEW, cardId = "".
- Есть ТЕКУЩАЯ ОТКРЫТАЯ карточка:
  - UPDATE — тот же деловой вопрос, но есть новый факт (напоминание, срок, новые условия, эскалация). Перепиши все поля и заполни whatChanged. cardId — id текущей карточки, скопированный символ в символ.
  - NOOP — новых фактов нет («Спасибо, получили», подтверждение прочтения, повтор без нового). Поля можно оставить пустыми.
  - NEW — главный вопрос темы сменился (редко).
- Есть только ПРОШЛАЯ (решённая) карточка → NEW или UPDATE с полным текстом, если есть новый факт; иначе NOOP.
- Если во входных данных стоит «ОБЯЗАТЕЛЬНОЕ ОБНОВЛЕНИЕ» — верни UPDATE с полным текстом и укажи причину в whatChanged.`

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/** The user prompt (Russian). PURE — exported for tests and the debug view. */
export function buildCardWriterPrompt(input: CardWriterInput): string {
  const t = input.topic
  const lines: string[] = []
  lines.push(`Сегодня: ${input.today}`)
  lines.push("")
  lines.push("ТЕМА")
  lines.push(`Название: ${t.title}`)
  lines.push(`Вопрос: ${t.matter || "—"}`)
  lines.push(`Компания: ${t.counterparty || "—"}`)
  lines.push(`Статус: ${WAITING_RU[t.waiting]}`)
  if (t.leadCode) lines.push(`Главный сигнал: ${t.leadLabelRu ?? t.leadCode}${t.class ? ` (${CLASS_RU[t.class]})` : ""}`)
  if (t.leadNoteRu) lines.push(`Подсказка к карточке: ${t.leadNoteRu}`)
  if (t.references.length) lines.push(`Номера документов: ${t.references.join("; ")}`)
  if (t.products.length) lines.push(`Товары: ${t.products.slice(0, 12).join(", ")}`)
  lines.push(`Сроки: ${input.deadlines.length ? input.deadlines.join(", ") : "нет"}${input.overdue ? " (срок просрочен)" : ""}`)
  lines.push("")
  lines.push("СИГНАЛЫ (цитаты из сообщений)")
  for (const s of input.signals) {
    lines.push(`- ${s.date} ${s.labelRu}${s.isNew ? " [НОВОЕ]" : ""}: «${clip(s.evidence, 300)}»`)
  }
  if (input.signals.length === 0) lines.push("- нет")
  lines.push("")
  lines.push("ПОСЛЕДНИЕ СООБЩЕНИЯ")
  for (const i of input.items) {
    const head = [i.date, i.direction === "outbound" ? "от нас" : i.direction === "inbound" ? "от клиента" : i.direction, i.from, i.subject]
      .filter(Boolean)
      .join(" · ")
    lines.push(`- ${head}${i.isNew ? " [НОВОЕ]" : ""}`)
    if (i.text) lines.push(`  ${clip(i.text, 600)}`)
  }
  if (input.items.length === 0) lines.push("- нет")
  lines.push("")
  const c = input.current
  if (c && c.status === "open") {
    lines.push("ТЕКУЩАЯ ОТКРЫТАЯ КАРТОЧКА")
    lines.push(`id: ${c.id}`)
  } else if (c) {
    lines.push(`ПРОШЛАЯ КАРТОЧКА (статус: ${c.status}; UPDATE к ней не применяется — нужна новая)`)
  } else {
    lines.push("КАРТОЧКИ ЕЩЁ НЕТ")
  }
  if (c) {
    lines.push(`Заголовок: ${c.headline}`)
    lines.push(`Почему сейчас: ${c.whyNow}`)
    if (c.whatChanged) lines.push(`Что изменилось: ${c.whatChanged}`)
    c.steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`))
  }
  if (input.force) {
    lines.push("")
    lines.push(`ОБЯЗАТЕЛЬНОЕ ОБНОВЛЕНИЕ: ${input.force}`)
  }
  return lines.join("\n")
}

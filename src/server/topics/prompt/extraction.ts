import "server-only"
import { z } from "zod"
import {
  SIGNAL_ATTRIBUTES_V0,
  SIGNAL_CATALOG_V0,
  type SignalCatalogEntry,
} from "@/server/topics/catalog/catalog-v0"

// Signal-extraction prompt (spec 01 §5.3, registry 05 §6).
//
// The system prompt is built only from the catalog, never from the item, so
// it is a stable prefix that the gateway / provider can cache. The item
// (envelope + text) is the user message and always comes last.
//
// Code sets (decision R6):
//   live   = IN4COM "on" codes — the live prompt;
//   review = "on" + "review" codes — the offline eval batch only.
// Variants (Q5):
//   single   = one call with the full code block;
//   two_pass = (1) block classifier (labels + 3 cues per code), (2) full
//              entries of the chosen blocks only.
//
// v0 reads the committed catalog file; phase 2 reads the org's effective
// registry (phase-1 DB tables) instead — same output schema.

export type ExtractionVariant = "single" | "two_pass"
export type ExtractionCodeSet = "live" | "review"

export const EXTRACTION_VARIANTS: ExtractionVariant[] = ["single", "two_pass"]
export const EXTRACTION_CODE_SETS: ExtractionCodeSet[] = ["live", "review"]

/** Technical caps (spec §5.3). Enforced on the server, described in the prompt. */
export const EXTRACTION_LIMITS = {
  signals: 12,
  subjects: 6,
  amounts: 5,
  deadlines: 5,
  /** Item text sent to the model (characters). */
  itemChars: 24_000,
} as const

/** Prompt-eligible codes of a code set, in catalog order. */
export function codesForSet(codeSet: ExtractionCodeSet): SignalCatalogEntry[] {
  return SIGNAL_CATALOG_V0.filter(
    (c) => c.promptEligible && (codeSet === "review" || c.in4com === "on"),
  )
}

type BlockGroup = { block: string; labelRu: string; codes: SignalCatalogEntry[] }

/**
 * Codes grouped by block; blocks ordered by their code count (desc), then by
 * block code — deterministic, so the prompt prefix is stable (05 §6).
 */
export function groupByBlock(codes: readonly SignalCatalogEntry[]): BlockGroup[] {
  const map = new Map<string, BlockGroup>()
  for (const c of codes) {
    const key = `${c.pack}:${c.block}`
    let g = map.get(key)
    if (!g) {
      g = { block: c.block, labelRu: c.blockLabelRu, codes: [] }
      map.set(key, g)
    }
    g.codes.push(c)
  }
  return [...map.values()].sort(
    (a, b) => b.codes.length - a.codes.length || a.block.localeCompare(b.block),
  )
}

function antiCueLine(c: SignalCatalogEntry): string {
  if (c.antiCuesRu.length === 0) return ""
  const parts = c.antiCuesRu.map((a) => `${a.text} → ${a.code ?? "нет сигнала"}`)
  return ` Похоже, но не это: ${parts.join("; ")}.`
}

/** One code entry in the 05 §6 format. */
function codeEntry(c: SignalCatalogEntry): string {
  const lines = [`${c.code} — ${c.labelRu}`]
  lines.push(`  Определение: ${c.definitionRu}`)
  lines.push(`  Не считается: ${c.boundaryRu}${antiCueLine(c)}`)
  if (c.cuesPromptRu.length > 0) {
    lines.push(`  Признаки: ${c.cuesPromptRu.map((q) => `«${q}»`).join(", ")}`)
  }
  if (c.kind === "state") {
    lines.push(`  (Код состояния: ставится и на наших собственных сообщениях.)`)
  }
  return lines.join("\n")
}

/** The code block: all entries grouped by block. */
export function buildCodeBlock(codes: readonly SignalCatalogEntry[]): string {
  if (codes.length === 0) return "(нет активных кодов — signals всегда пустой)"
  return groupByBlock(codes)
    .map((g) => `### Блок ${g.block} · ${g.labelRu}\n\n${g.codes.map(codeEntry).join("\n\n")}`)
    .join("\n\n")
}

function attributeBlock(): string {
  return SIGNAL_ATTRIBUTES_V0.filter((a) => a.stage === "active" && !a.defaultOff)
    .map(
      (a) =>
        `${a.code} (группа ${a.group}) — ${a.labelRu}. Признаки: ${a.cuesRu
          .map((q) => `«${q}»`)
          .join(", ")}. Не считается: ${a.antiCuesRu}`,
    )
    .join("\n")
}

const INSTRUCTIONS = `Ты — аналитик деловой переписки CRM. «Мы» — компания-пользователь CRM (указана в конверте как «Наша компания»); блоки DS — отраслевые коды дистрибьютора вина и крепкого алкоголя. Ты получаешь ОДНО сообщение (письмо, сообщение в чате, документ) и находишь в нём сигналы из списка кодов ниже.

ПРАВИЛА
1. Доказательство или ничего. Каждый код подтверждается дословной цитатой (evidence) из текста ЭТОГО сообщения. Нет цитаты — нет кода. Пустой результат — норма: в большинстве сообщений сигналов нет.
2. Оцениваешь только это сообщение. Цитируемая история переписки (ниже «От:», «-----Исходное сообщение-----», «… написал(а):», «… пишет:», строки с «>», «On … wrote:») — только контекст: из неё не берутся ни коды, ни evidence.
3. Код описывает то, что делает АВТОР сообщения. Наша собственная инициатива (наши письма, наши предложения) никогда не является сигналом клиента; на наших сообщениях ставятся только коды состояния, помеченные «Код состояния».
4. Пересланное сообщение: автор — исходный отправитель (заголовок «Пересылаемое сообщение», forwarded from), а не сотрудник, который его переслал.
5. Когда автор продаёт НАМ (поставщик, производитель, сервис), мы — покупатель: клиентские коды не ставятся, только коды поставщиков. Рекламная рассылка нам — никогда не спрос.
6. Используй только коды из списка. Не придумывай новых кодов. Если подходит несколько кодов — ставь все различные подтверждённые события, самый сильный первым (не более ${EXTRACTION_LIMITS.signals}).
7. Относительные даты («к пятнице», «на следующей неделе», «до конца месяца») вычисляй от даты сообщения из конверта, никогда не от сегодняшнего дня. Формат дат — YYYY-MM-DD.
8. Номера документов и названия товаров копируй точно, как в тексте.
9. Сообщение может быть на любом языке (русский, английский, французский, итальянский …). Признаки в списке — подсказки, а не языковой фильтр. Evidence копируй на языке оригинала; matter и what пиши по-русски.
10. confidence: high — событие названо прямо; medium — ясно из контекста; low — возможно, но неоднозначно.

ПОЛЯ ОТВЕТА
- signals[]: code, evidence (дословная цитата), confidence, subjectIndex (индекс в subjects[]; -1 = относится ко всем).
- attributes[]: не более одного атрибута на группу (emotion, tone, brevity); code и evidence. Ставь атрибут только при явном маркере.
- subjects[] (не более ${EXTRACTION_LIMITS.subjects}, один на пару «контрагент × вопрос»): counterparty — компания, с которой вопрос ("" = внутренний вопрос); onBehalfOf — настоящий владелец, если контрагент — агент, логистика, IT ("" если нет); matter — 3–8 слов по-русски в именительном падеже («счёт 124 за октябрь»); references[] — {kind, value}; products[] — названия товаров, как в тексте.
  Виды ссылок (kind): заказ №, заявка № → order; счёт №, УПД №, счёт-фактура, ТОРГ-12 → invoice; ТТН ЕГАИС, накладная ЕГАИС → other (value с префиксом «ТТН»); акт расхождений, ТОРГ-2, претензия, рекламация → claim; договор поставки, доп. соглашение, спецификация → contract; КП №, тендер / закупка № → offer.
- facts: amounts[] (не более ${EXTRACTION_LIMITS.amounts}: value — число; currency — RUB, USD, EUR, CNY или ""; scope — total | per_unit | per_month | per_year; vat — incl | excl | unknown; evidence; subjectIndex); deadlines[] (не более ${EXTRACTION_LIMITS.deadlines}: date YYYY-MM-DD; precision — exact (дата названа) | resolved (вычислена из относительной); what — что к сроку, по-русски; owner — us | them | unknown; evidence; subjectIndex); contractEndDate, proposedMeetingDate, licenseEndDate — YYYY-MM-DD или ""; licenseStatus — active | expiring | suspended | revoked | ""; paymentTermsDays — целое число дней отсрочки или -1; creditLimitRequested — сумма или -1.
- direction: inbound (автор — внешний контрагент, пишет нам), outbound (автор — мы), internal (переписка внутри нашей компании). Подсказка «авторство» в конверте — результат автоматической проверки, она может ошибаться.
- Если поле неизвестно — пустая строка "", -1 или пустой список. Не выдумывай значения.`

export type ExtractionPrompt = {
  system: string
  codes: string[]
  /** Size of the code block (characters) — the part that scales with the registry. */
  codeBlockChars: number
  systemChars: number
}

/** Full system prompt for one pass over the given codes. */
export function buildExtractionSystemPrompt(codes: readonly SignalCatalogEntry[]): ExtractionPrompt {
  const codeBlock = buildCodeBlock(codes)
  const system = `${INSTRUCTIONS}

АТРИБУТЫ (модификаторы тона и эмоции)
${attributeBlock()}

КОДЫ СИГНАЛОВ
${codeBlock}`
  return {
    system,
    codes: codes.map((c) => c.code),
    codeBlockChars: codeBlock.length,
    systemChars: system.length,
  }
}

/** Two-pass, pass 1: block labels + 3 cues per code. */
export function buildBlockClassifierPrompt(codes: readonly SignalCatalogEntry[]): {
  system: string
  blocks: string[]
  chars: number
} {
  const groups = groupByBlock(codes)
  const lines = groups.map(
    (g) =>
      `${g.block} — ${g.labelRu}: ` +
      g.codes
        .map((c) => `${c.labelRu} (${c.cuesPromptRu.slice(0, 3).map((q) => `«${q}»`).join(", ")})`)
        .join("; "),
  )
  const system = `Ты — классификатор деловой переписки CRM дистрибьютора вина. Определи, какие блоки сигналов могут встретиться в сообщении. Сообщение может быть на любом языке. Оценивай только текст автора, не цитируемую историю. Выбирай блок, если в сообщении есть хотя бы намёк на событие из этого блока; лучше выбрать лишний блок, чем пропустить нужный. Если сигналов нет — пустой список.

БЛОКИ
${lines.join("\n")}`
  return { system, blocks: groups.map((g) => g.block), chars: system.length }
}

export const blockClassifierSchema = z.object({
  blocks: z.array(z.string()).describe("Коды выбранных блоков из списка, например DS1, A"),
})

// ── Envelope + item ────────────────────────────────────────────────────────

export type ExtractionEnvelope = {
  provider?: string | null
  kind?: string | null
  /** Item date (ISO). Relative dates are resolved against it. */
  date?: string | null
  subject?: string | null
  from?: string | null
  to?: string | null
  cc?: string | null
  /** Parse-time authorship verdict: own_org | external | unknown. */
  orgAttribution?: string | null
  /** Our organisation's name. */
  orgName?: string | null
  forwardedBy?: string | null
  originalAuthor?: string | null
  synthetic?: boolean
}

export function buildItemPrompt(envelope: ExtractionEnvelope, text: string): string {
  const env: string[] = []
  const add = (label: string, v: string | null | undefined) => {
    if (v && v.trim()) env.push(`${label}: ${v.trim()}`)
  }
  add("Наша компания", envelope.orgName)
  add("Канал", [envelope.provider, envelope.kind].filter(Boolean).join(" / "))
  add("Дата сообщения", envelope.date)
  add("Тема", envelope.subject)
  add("От", envelope.from)
  add("Кому", envelope.to)
  add("Копия", envelope.cc)
  add("Переслал (наш сотрудник)", envelope.forwardedBy)
  add("Исходный автор", envelope.originalAuthor)
  add("Авторство (автопроверка)", envelope.orgAttribution)
  if (envelope.synthetic) env.push("Тестовое сообщение: да")
  let body = text
  if (body.length > EXTRACTION_LIMITS.itemChars) {
    body = `${body.slice(0, EXTRACTION_LIMITS.itemChars)}\n\n[… текст обрезан]`
  }
  return `КОНВЕРТ\n${env.join("\n") || "(нет данных)"}\n\nТЕКСТ СООБЩЕНИЯ\n<<<\n${body}\n>>>`
}

// ── Output schema (spec §5.3: flat, sentinel values) ──────────────────────
// No enums with an empty value and no maxItems: some gateway models reject
// them. Caps and the "" / -1 sentinels are enforced by normalizeExtraction.

const referenceSchema = z.object({
  kind: z.enum(["invoice", "order", "offer", "contract", "claim", "other"]),
  value: z.string(),
})

export const extractionOutputSchema = z.object({
  signals: z.array(
    z.object({
      code: z.string().describe("Код из списка КОДЫ СИГНАЛОВ"),
      evidence: z.string().describe("Дословная цитата из текста этого сообщения"),
      confidence: z.enum(["high", "medium", "low"]),
      subjectIndex: z.number().int().describe("Индекс в subjects[]; -1 = все"),
    }),
  ),
  attributes: z.array(z.object({ code: z.string(), evidence: z.string() })),
  subjects: z.array(
    z.object({
      counterparty: z.string(),
      onBehalfOf: z.string(),
      matter: z.string(),
      references: z.array(referenceSchema),
      products: z.array(z.string()),
    }),
  ),
  facts: z.object({
    amounts: z.array(
      z.object({
        value: z.number(),
        currency: z.string().describe('RUB | USD | EUR | CNY | ""'),
        scope: z.enum(["total", "per_unit", "per_month", "per_year"]),
        vat: z.enum(["incl", "excl", "unknown"]),
        evidence: z.string(),
        subjectIndex: z.number().int(),
      }),
    ),
    deadlines: z.array(
      z.object({
        date: z.string().describe("YYYY-MM-DD"),
        precision: z.enum(["exact", "resolved"]),
        what: z.string(),
        owner: z.enum(["us", "them", "unknown"]),
        evidence: z.string(),
        subjectIndex: z.number().int(),
      }),
    ),
    contractEndDate: z.string().describe('YYYY-MM-DD или ""'),
    proposedMeetingDate: z.string().describe('YYYY-MM-DD или ""'),
    licenseEndDate: z.string().describe('YYYY-MM-DD или ""'),
    licenseStatus: z.string().describe('active | expiring | suspended | revoked | ""'),
    paymentTermsDays: z.number().int().describe("-1 = неизвестно"),
    creditLimitRequested: z.number().describe("-1 = неизвестно"),
  }),
  direction: z.enum(["inbound", "outbound", "internal"]),
})

export type ExtractionOutput = z.infer<typeof extractionOutputSchema>

// ── Light server normalisation (the spike subset of spec §5.4) ────────────
// Full post-processing (direction / date gates, outranks, scoring) is phase 2.

export type NormalizedSignal = ExtractionOutput["signals"][number] & {
  /** Evidence found in the item text (whitespace / case-insensitive). */
  evidenceFound: boolean
}

export type NormalizedExtraction = Omit<ExtractionOutput, "signals"> & {
  signals: NormalizedSignal[]
  /** Codes the model returned that were not in the prompt. */
  unknownCodes: string[]
}

const squash = (s: string) =>
  s
    .toLowerCase()
    .replace(/[«»"“”„'’]/g, "")
    .replace(/\s+/g, " ")
    .trim()

export function evidenceInText(evidence: string, text: string): boolean {
  const e = squash(evidence).replace(/^[.…\s]+|[.…\s]+$/g, "")
  if (!e) return false
  const t = squash(text)
  if (t.includes(e)) return true
  // Ellipsis-joined quotes: every fragment must be present.
  const parts = e.split(/…|\.\.\./).map((p) => p.trim()).filter((p) => p.length > 3)
  return parts.length > 1 && parts.every((p) => t.includes(p))
}

export function normalizeExtraction(
  output: ExtractionOutput,
  opts: { allowedCodes: readonly string[]; text: string },
): NormalizedExtraction {
  const allowed = new Set(opts.allowedCodes)
  const unknownCodes: string[] = []
  const signals: NormalizedSignal[] = []
  const seen = new Set<string>()
  for (const s of output.signals) {
    const code = s.code.trim().toUpperCase()
    if (!allowed.has(code)) {
      unknownCodes.push(code)
      continue
    }
    if (!s.evidence.trim()) continue
    // Same code + same subject → keep the first (strongest) one (§5.4 5a).
    const key = `${code}:${s.subjectIndex}`
    if (seen.has(key)) continue
    seen.add(key)
    signals.push({ ...s, code, evidenceFound: evidenceInText(s.evidence, opts.text) })
    if (signals.length >= EXTRACTION_LIMITS.signals) break
  }
  const groups = new Set<string>()
  const attributes = output.attributes.filter((a) => {
    const attr = SIGNAL_ATTRIBUTES_V0.find((x) => x.code === a.code)
    if (!attr || groups.has(attr.group)) return false
    groups.add(attr.group)
    return true
  })
  return {
    ...output,
    signals,
    attributes,
    subjects: output.subjects.slice(0, EXTRACTION_LIMITS.subjects),
    facts: {
      ...output.facts,
      amounts: output.facts.amounts.slice(0, EXTRACTION_LIMITS.amounts),
      deadlines: output.facts.deadlines.slice(0, EXTRACTION_LIMITS.deadlines),
    },
    unknownCodes,
  }
}

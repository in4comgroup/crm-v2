import "server-only"
import { z } from "zod"
import type { AntiCue } from "@/lib/signals/types"
import { getCurrentVersion, getEffectiveSignals, getRegistry } from "@/server/signals/registry"

// Signal-extraction prompt (spec 01 §5.3, registry 05 §6).
//
// The code block is built from the org's EFFECTIVE registry (DB, 05 §5),
// never from the item, so the system prompt is a stable prefix that the
// gateway / provider can cache. The item (envelope + text) is the user
// message and always comes last.
//
// Code sets (decision R6):
//   live   = effective `inPrompt` codes (active, not review-only, not process);
//   review = live + the org's review-only codes that the parser may emit —
//            the offline eval batch only.
// Variants (Q5):
//   single   = one call with the full code block;
//   two_pass = (1) block classifier (labels + 3 cues per code), (2) full
//              entries of the chosen blocks only.

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

/** One code as the prompt needs it (registry row + effective values). */
export type PromptCode = {
  code: string
  packCode: string
  blockCode: string
  blockLabelRu: string
  labelRu: string
  definitionRu: string
  boundaryRu: string
  cuesPromptRu: string[]
  antiCuesRu: AntiCue[]
  kind: string
  /** Effective weight for the org. */
  weight: number
  /** True for codes added only by the `review` code set. */
  reviewOnly: boolean
}

export type PromptAttribute = {
  code: string
  groupCode: string
  labelRu: string
  cuesRu: string[]
  antiCuesRu: string[]
}

/** Everything one extraction needs from the registry, loaded once per batch. */
export type PromptCodeSet = {
  orgId: string
  codeSet: ExtractionCodeSet
  /** Taxonomy version the codes were read at (stored with every result). */
  taxonomyVersion: number
  codes: PromptCode[]
  attributes: PromptAttribute[]
  /** Non-retired registry codes (for validation of human answers). */
  knownCodes: string[]
}

/** The org has no active signal code (no activation applied in «Сигналы»). */
export class SignalsNotEnabledError extends Error {
  constructor(public orgId: string) {
    super(
      "Для организации не включены сигналы. Примените шаблон в «Сигналы» (например, «Пилот дистрибуции (IN4COM)») и повторите.",
    )
    this.name = "SignalsNotEnabledError"
  }
}

/**
 * Prompt codes of one org from the effective registry. Throws
 * SignalsNotEnabledError when the org has no `inPrompt` code.
 */
export async function loadPromptCodes(orgId: string, codeSet: ExtractionCodeSet): Promise<PromptCodeSet> {
  const [registry, effective, taxonomyVersion] = await Promise.all([
    getRegistry(),
    getEffectiveSignals(orgId),
    getCurrentVersion(),
  ])
  const blockLabel = new Map(registry.blocks.map((b) => [b.code, b.labelRu]))
  const eff = new Map(effective.map((e) => [e.code, e]))
  const codes: PromptCode[] = []
  // Registry order (pack → block → weight → code) inside each block.
  for (const c of registry.categories) {
    const e = eff.get(c.code)
    if (!e || c.retiredAt) continue
    const live = e.inPrompt
    const review = codeSet === "review" && !live && e.reviewOnly && c.emittedBy !== "process"
    if (!live && !review) continue
    codes.push({
      code: c.code,
      packCode: c.packCode,
      blockCode: c.blockCode,
      blockLabelRu: blockLabel.get(c.blockCode) ?? c.blockCode,
      labelRu: c.labelRu,
      definitionRu: c.definitionRu,
      boundaryRu: c.boundaryRu,
      cuesPromptRu: c.cuesPromptRu,
      antiCuesRu: c.antiCuesRu,
      kind: c.kind,
      weight: e.weight,
      reviewOnly: !live,
    })
  }
  if (!codes.some((c) => !c.reviewOnly)) throw new SignalsNotEnabledError(orgId)
  const attributes = registry.attributes
    .filter((a) => a.scope === "message" && a.stage === "active" && !a.defaultOff)
    .map((a) => ({
      code: a.code,
      groupCode: a.groupCode ?? a.code,
      labelRu: a.labelRu,
      cuesRu: a.cuesRu,
      antiCuesRu: a.antiCuesRu,
    }))
  return {
    orgId,
    codeSet,
    taxonomyVersion,
    codes,
    attributes,
    knownCodes: registry.categories.filter((c) => !c.retiredAt).map((c) => c.code),
  }
}

type BlockGroup = { block: string; labelRu: string; codes: PromptCode[] }

/**
 * Codes grouped by block; blocks ordered by their code count (desc), then by
 * block code — deterministic, so the prompt prefix is stable (05 §6).
 */
export function groupByBlock(codes: readonly PromptCode[]): BlockGroup[] {
  const map = new Map<string, BlockGroup>()
  for (const c of codes) {
    let g = map.get(c.blockCode)
    if (!g) {
      g = { block: c.blockCode, labelRu: c.blockLabelRu, codes: [] }
      map.set(c.blockCode, g)
    }
    g.codes.push(c)
  }
  return [...map.values()].sort(
    (a, b) => b.codes.length - a.codes.length || a.block.localeCompare(b.block),
  )
}

function antiCueLine(c: PromptCode): string {
  if (c.antiCuesRu.length === 0) return ""
  const parts = c.antiCuesRu.map((a) => `${a.text} → ${a.code ?? "нет сигнала"}`)
  return ` Похоже, но не это: ${parts.join("; ")}.`
}

/** One code entry in the 05 §6 format. */
function codeEntry(c: PromptCode): string {
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
export function buildCodeBlock(codes: readonly PromptCode[]): string {
  if (codes.length === 0) return "(нет активных кодов — signals всегда пустой)"
  return groupByBlock(codes)
    .map((g) => `### Блок ${g.block} · ${g.labelRu}\n\n${g.codes.map(codeEntry).join("\n\n")}`)
    .join("\n\n")
}

function attributeBlock(attributes: readonly PromptAttribute[]): string {
  return attributes
    .map(
      (a) =>
        `${a.code} (группа ${a.groupCode}) — ${a.labelRu}. Признаки: ${a.cuesRu
          .map((q) => `«${q}»`)
          .join(", ")}. Не считается: ${a.antiCuesRu.join("; ")}`,
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
  taxonomyVersion: number
}

/**
 * Full system prompt for one pass. `codes` defaults to every code of the
 * set; two_pass passes the codes of the chosen blocks.
 */
export function buildExtractionSystemPrompt(
  set: PromptCodeSet,
  codes: readonly PromptCode[] = set.codes,
): ExtractionPrompt {
  const codeBlock = buildCodeBlock(codes)
  const system = `${INSTRUCTIONS}

АТРИБУТЫ (модификаторы тона и эмоции)
${attributeBlock(set.attributes)}

КОДЫ СИГНАЛОВ
${codeBlock}`
  return {
    system,
    codes: codes.map((c) => c.code),
    codeBlockChars: codeBlock.length,
    systemChars: system.length,
    taxonomyVersion: set.taxonomyVersion,
  }
}

/** Two-pass, pass 1: block labels + 3 cues per code. */
export function buildBlockClassifierPrompt(codes: readonly PromptCode[]): {
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
  /** Attribute codes the model returned that are not registry message attributes. */
  unknownAttributes: string[]
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
  opts: { allowedCodes: readonly string[]; attributes: readonly PromptAttribute[]; text: string },
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
  const unknownAttributes: string[] = []
  const attrByCode = new Map(opts.attributes.map((a) => [a.code, a]))
  const attributes = output.attributes.filter((a) => {
    const attr = attrByCode.get(a.code.trim().toUpperCase())
    if (!attr) {
      unknownAttributes.push(a.code)
      return false
    }
    // One attribute per exclusive group.
    if (groups.has(attr.groupCode)) return false
    groups.add(attr.groupCode)
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
    unknownAttributes,
  }
}

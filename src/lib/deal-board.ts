import type { DealRow, DealFunnelStageOption } from "@/server/deals"
import { isOpenDealStatus, isTerminalStageRole, stageRoleOf } from "@/lib/deal-funnel"

// Terminal (outcome) stages = role `won` / `lost` (docs/specs/funnel §3.1) —
// the board puts them into the «Закрытие» column. Decided by ROLE, never by
// the stage name: an org names its stages freely.

/** Something that carries a stage role: a stage option (`role`) or a deal row (`funnelStageRole`). */
export type StageRoleCarrier = { role?: string | null } | { funnelStageRole?: string | null }

function roleOfCarrier(x: StageRoleCarrier): string | null | undefined {
  return "role" in x ? x.role : "funnelStageRole" in x ? x.funnelStageRole : undefined
}

/**
 * @deprecated Legacy name list of the SYSTEM funnel; only the string form of
 * `isTerminalStage` reads it. Pass a stage / deal object instead.
 */
export const TERMINAL_STAGE_NAMES = ["Closed", "Rejected"] as const

/**
 * Terminal stage (won / lost). Pass the stage option or the deal row (by
 * role). The string form (a stage NAME) is a deprecated fallback kept only
 * until every caller passes an object — it is wrong for custom funnels.
 */
export function isTerminalStage(stage: string | StageRoleCarrier): boolean {
  if (typeof stage === "string") return (TERMINAL_STAGE_NAMES as readonly string[]).includes(stage)
  return isTerminalStageRole(roleOfCarrier(stage))
}

/** Won outcome stage (role `won`) — stage option or deal row. */
export function isWonStage(stage: StageRoleCarrier): boolean {
  return stageRoleOf(roleOfCarrier(stage)) === "won"
}

/** Lost outcome stage (role `lost`) — stage option or deal row. */
export function isLostStage(stage: StageRoleCarrier): boolean {
  return stageRoleOf(roleOfCarrier(stage)) === "lost"
}

/** «Контакт до запроса» (role `area0`) — stage option or deal row. */
export function isArea0Stage(stage: StageRoleCarrier): boolean {
  return stageRoleOf(roleOfCarrier(stage)) === "area0"
}

/** The org's won / lost stage among the stage options (by role). */
export function outcomeStageOf(
  stages: readonly DealFunnelStageOption[],
  outcome: "won" | "lost",
): DealFunnelStageOption | null {
  return stages.find((s) => s.role === outcome) ?? null
}

export const CURRENCY_SYMBOL: Record<string, string> = {
  RUB: "₽",
  USD: "$",
  EUR: "€",
  GBP: "£",
  CNY: "¥",
  JPY: "¥",
  CHF: "CHF ",
  CAD: "CA$",
  AUD: "A$",
}

// Цвета стадий — по английскому имени стадии. Кастомные стадии орги падают
// в нейтральный default. (Перенесено из deal-card.tsx, чтобы не дублировать.)
// Шкала стадий — «драгоценные тона»: сплошные НАСЫЩЕННЫЕ средние тона
// (пастель читалась «карандашным наброском»), прогрессия по hue к «горячему»:
// teal → синий → фиолет → жжёный оранжевый. Оранжевый вместо красного
// НАМЕРЕННО: красный #C1121F зарезервирован за primary-кнопками и не должен
// бороться с заголовком стадии за внимание. Одни и те же цвета в обеих
// темах, все пары текст/фон ≥4.5:1 (AA). Квалификация — насыщенный
// нейтральный, Закрыта/Проиграна — сочные зелёная/тёмно-красная.
export const STAGE_COLOR: Record<string, string> = {
  Qualification: "bg-[#5D7183] text-white",
  Discovery: "bg-[#0E7490] text-white",
  Pilot: "bg-[#2F6BBF] text-white",
  Proposal: "bg-[#6D49B8] text-white",
  Negotiations: "bg-[#C2410C] text-white",
  // Воронка агентства (Масловы, «Структура воронки агентства») — те же тона
  // по порядку стадий 1–5, чтобы прогрессия читалась так же.
  "Новая возможность": "bg-[#5D7183] text-white",
  "Запрошены материалы или решение": "bg-[#0E7490] text-white",
  "Финальный выбор": "bg-[#2F6BBF] text-white",
  "Выбраны": "bg-[#6D49B8] text-white",
  "Заказ подтверждён": "bg-[#C2410C] text-white",
  Closed: "bg-[#1F7A4D] text-white",
  // Графит вместо красного: «проиграна» — нейтральный факт, а не тревога;
  // красный семейства primary тут только спорил бы за внимание. В тёмной
  // теме тон чуть приподнят, иначе сливается с ink-фоном.
  Rejected: "bg-[#242424] text-[#E7E5E4] dark:bg-[#3B3B40] dark:text-[#D6D6DA]",
}
export const STAGE_DEFAULT = "bg-[#5D7183] text-white"

// Role colours (docs/specs/funnel §3.1): the outcome stages of ANY funnel
// get the won / lost tones, whatever their names.
export const STAGE_ROLE_COLOR = {
  won: "bg-[#1F7A4D] text-white",
  lost: "bg-[#242424] text-[#E7E5E4] dark:bg-[#3B3B40] dark:text-[#D6D6DA]",
} as const

// Progression of the active stages by position (custom stages with no
// name entry): neutral → teal → blue → violet → burnt orange, then repeat.
export const STAGE_PROGRESSION = [
  "bg-[#5D7183] text-white",
  "bg-[#0E7490] text-white",
  "bg-[#2F6BBF] text-white",
  "bg-[#6D49B8] text-white",
  "bg-[#C2410C] text-white",
] as const

// «Область 0» до воронки (isPrePipeline) — намеренно бледная, с пунктиром:
// это преддверие воронки, а не её стадия (звонок 26.10: «эти все яркие, а
// там совершенно не ярко-бледный»).
export const PRE_PIPELINE_STAGE_COLOR =
  "border-dashed border-[#5D7183]/45 bg-[#5D7183]/8 text-foreground dark:bg-[#5D7183]/15"

/**
 * Column colour. Role first (area0 → pale, won / lost → outcome tones), then
 * the name map of known stages, then — for any custom stage — the
 * progression by `activeIndex` (0-based position among the active stages),
 * else the neutral default.
 */
export function stageColorClass(stage: {
  name: string
  isPrePipeline?: boolean
  role?: string | null
  activeIndex?: number
}): string {
  const role = stage.role ? stageRoleOf(stage.role) : null
  if (role === "area0" || stage.isPrePipeline) return PRE_PIPELINE_STAGE_COLOR
  if (role === "won" || role === "lost") return STAGE_ROLE_COLOR[role]
  const byName = STAGE_COLOR[stage.name]
  if (byName) return byName
  if (typeof stage.activeIndex === "number" && stage.activeIndex >= 0) {
    return STAGE_PROGRESSION[stage.activeIndex % STAGE_PROGRESSION.length]
  }
  return STAGE_DEFAULT
}

export function formatAmount(
  value: string | null,
  currency: string,
): string | null {
  if (value === null) return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  const symbol = CURRENCY_SYMBOL[currency.toUpperCase()] ?? `${currency} `
  const formatted = n.toLocaleString(undefined, {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  })
  return `${symbol}${formatted}`
}

// Числовое значение сделки для агрегатов (0, если пусто/некорректно).
export function dealAmount(value: string | null): number {
  if (value === null) return 0
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

// Форматирование агрегата (прогноз, сумма колонки) — единая валюта ₽.
export function formatAggregate(n: number): string {
  return `${Math.round(n).toLocaleString("ru-RU")} ₽`
}

// Склонение «сделка/сделки/сделок» по числу (шапка колонки — иначе цифра
// перед суммой нигде не расшифровывается, что это количество сделок).
export function pluralizeDeals(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 14) return "сделок"
  if (mod10 === 1) return "сделка"
  if (mod10 >= 2 && mod10 <= 4) return "сделки"
  return "сделок"
}

// Компактное число для тесных мест (шапка колонки, UX №1): тысячи → «к»,
// миллионы → «м», меньше 1000 — как есть. Один знак после запятой, дробную
// «,0» убираем (3 700 → «3,7к», 3 000 000 → «3м», 850 → «850»).
export function formatCompactNumber(n: number): string {
  const abs = Math.abs(n)
  const fmt = (v: number, suffix: string) => {
    const s = v.toFixed(1).replace(/\.0$/, "").replace(".", ",")
    return `${s}${suffix}`
  }
  if (abs >= 1_000_000) return fmt(n / 1_000_000, "м")
  if (abs >= 1_000) return fmt(n / 1_000, "к")
  return Math.round(n).toLocaleString("ru-RU")
}

// Компактный агрегат по валютам (для шапки колонки): "3,7к ₽ · 30к $".
export function aggregateByCurrencyCompact(
  entries: { amount: number; currency: string }[],
): string {
  const byCur = new Map<string, number>()
  for (const e of entries) {
    byCur.set(e.currency, (byCur.get(e.currency) ?? 0) + e.amount)
  }
  const parts = Array.from(byCur.entries())
    .filter(([, n]) => n !== 0)
    .map(([cur, n]) => {
      const symbol = (CURRENCY_SYMBOL[cur.toUpperCase()] ?? cur).trim()
      return `${formatCompactNumber(n)} ${symbol}`
    })
  return parts.length ? parts.join(" · ") : "0 ₽"
}

// Группировка сумм по валютам → строка вида "1 200 000 ₽ · 30 000 $".
export function aggregateByCurrency(
  entries: { amount: number; currency: string }[],
): string {
  const byCur = new Map<string, number>()
  for (const e of entries) {
    byCur.set(e.currency, (byCur.get(e.currency) ?? 0) + e.amount)
  }
  const parts = Array.from(byCur.entries())
    .filter(([, n]) => n !== 0)
    .map(([cur, n]) => {
      const symbol = (CURRENCY_SYMBOL[cur.toUpperCase()] ?? cur).trim()
      return `${Math.round(n).toLocaleString("ru-RU")} ${symbol}`
    })
  return parts.length ? parts.join(" · ") : "0 ₽"
}

// Взвешенный прогноз (legacy): Σ value × вероятность стадии по открытым
// (active + paused) НЕтерминальным сделкам. closureProbability — доля 0..1.
// The custom-funnel forecast (W5: «В прогнозе», expert probability, «Без
// оценки») is `computeForecast` in src/lib/funnel/forecast.ts.
export function weightedForecast(
  deals: DealRow[],
  stages: DealFunnelStageOption[],
): number {
  const probByStageId = new Map(stages.map((s) => [s.id, s.closureProbability]))
  let total = 0
  for (const d of deals) {
    if (!isOpenDealStatus(d.status)) continue
    if (isTerminalStageRole(d.funnelStageRole)) continue
    const prob = probByStageId.get(d.funnelStageId) ?? d.funnelStageProbability
    total += dealAmount(d.value) * prob
  }
  return total
}

export type OwnerFilter = "all" | "mine"

export function filterByOwner(
  deals: DealRow[],
  filter: OwnerFilter,
  currentUserId: string,
): DealRow[] {
  if (filter === "all") return deals
  return deals.filter((d) => d.userId === currentUserId)
}

export type MoveDirection = "fwd" | "back"

// Направление перевода по sortOrder стадий. Равный/больший порядок — вперёд.
export function moveDirection(
  fromSortOrder: number,
  toSortOrder: number,
): MoveDirection {
  return toSortOrder >= fromSortOrder ? "fwd" : "back"
}

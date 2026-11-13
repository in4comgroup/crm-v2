// ============================================================================
// МОК-СЛОЙ доски сделок (перенос фич прототипа deal-kanban_1.html).
//
// TODO(backend): ВЕСЬ ЭТОТ МОДУЛЬ — временная заглушка. Здесь должны быть
// настоящие ручки/данные:
//   1. Предложения агента — УДАЛЕНЫ 2026-11-13 (topics plan R9): мок двигал
//      каждую 3-ю сделку при загрузке доски. Настоящие журналируемые переводы
//      даст deal bridge движка тем (docs/specs/topics, фаза 5).
//   2. Лента решений (seedFeed + in-memory store) — должна быть таблица журнала
//      событий (audit log) + ручка листинга. Сейчас — сид из реальных deal.changes
//      + мок-события агента + аппенды в памяти процесса (теряются при рестарте).
//   3. Нормы стадий и остывание (STAGE_NORM_BY_NAME) — норма «дней на стадию»
//      должна конфигурироваться в настройках воронки орги. Сейчас — хардкод-мапа,
//      а «дни без активности» считаются из deal.updatedAt (проксирует настоящую
//      «последнюю активность», которую надо брать из задач/писем/звонков).
//   4. Коммитменты стадий (STAGE_COMMITMENTS_BY_NAME) — чек-лист «что подтвердил
//      клиент» должен жить в конфиге стадии воронки. Сейчас — хардкод-мапа.
//   5. Провенанс: источник-ссылка и confidence, бейджи-таксономия (из TG/письма,
//      ИИ перевёл, авто-задача) и lock-поля (сумма/стадия вручную) — на сделке
//      должны быть структурированные origin/source/confidence/locks. Сейчас —
//      детерминированный мок по dealId.
//
// Все типы ниже — контракт для UI. При реализации реального бэкенда СОХРАНИТЬ
// форму ответов, тогда фронт менять не придётся.
// ============================================================================

import { getServerSession } from "@/lib/get-session"
import { listDeals, type DealRow, type DealFunnelStageOption } from "@/server/deals"

// ---------------------------------------------------------------------------
// Типы-контракты
// ---------------------------------------------------------------------------

export type Confidence = "low" | "medium" | "high"

export type DealProposal = {
  id: string
  dealId: string
  dealName: string
  fromStageId: string
  toStageId: string
  fromLabel: string
  toLabel: string
  direction: "fwd" | "back"
  why: string
  source: string
  confidence: Confidence
}

// FeedEvent переехал в src/server/deals.ts (listRecentDealActivity) — реальный
// журнал, а не мок-контракт.

export type IntelBadge = {
  kind: "source" | "ai" | "auto" | "lock"
  // Имя lucide-иконки в kebab-case (UI мапит на компонент), напр. "send", "mail".
  icon: string
  text: string
}

export type DealIntel = {
  staleDays: number
  norm: number
  isStale: boolean
  badges: IntelBadge[]
  provenanceSource: string | null
  confidence: Confidence | null
  locks: ("amount" | "stage")[]
}

export type StageCommitments = Record<string /* stageId */, string[]>

export type BoardIntelResponse = {
  intel: Record<string /* dealId */, DealIntel>
  commitments: StageCommitments
}

// ---------------------------------------------------------------------------
// Конфиг: нормы и коммитменты по РЕАЛЬНЫМ именам стадий приложения.
// (Не по англ. id прототипа — маппинг на Qualification/Discovery/Pilot/…)
// TODO(backend): вынести в конфиг воронки орги.
// ---------------------------------------------------------------------------

export const STAGE_NORM_BY_NAME: Record<string, number> = {
  Qualification: 7,
  Discovery: 12,
  Pilot: 21,
  Proposal: 10,
  Negotiations: 14,
}
const DEFAULT_NORM = 14

export const STAGE_COMMITMENTS_BY_NAME: Record<string, string[]> = {
  Qualification: [
    "Подтвердил, что проблема в приоритете (не «интересно посмотреть»)",
    "Согласился на discovery-звонок, слот в календаре",
    "Дал вводные: роль, компания, «почему сейчас»",
  ],
  Discovery: [
    "Откровенно рассказал про процесс и боль",
    "Согласовал черновик критериев успеха",
    "Назвал участников решения",
    "Закоммитил демо по своему сценарию",
  ],
  Pilot: [
    "Дал доступы, данные, людей",
    "Согласовал жёсткие критерии успеха и срок",
    "Назначил владельца пилота",
    "Дата итогового ревью стоит",
  ],
  Proposal: [
    "Принял конкретное КП: пакет, объём, срок",
    "Подтвердил бюджетный путь",
    "Дал схему согласования и approvers",
    "Дедлайн обратной связи зафиксирован",
  ],
  Negotiations: [
    "Дал конкретные правки / redlines",
    "Назначил юриста или безопасника и сроки",
    "Подтвердил целевую дату подписания",
  ],
}

export function commitmentsForStages(
  stages: DealFunnelStageOption[],
): StageCommitments {
  const out: StageCommitments = {}
  for (const s of stages) {
    const list = STAGE_COMMITMENTS_BY_NAME[s.name]
    if (list && list.length) out[s.id] = list
  }
  return out
}

// ---------------------------------------------------------------------------
// Детерминизм: стабильный hash от строки (FNV-1a 32-bit) → seed для выборов.
// ---------------------------------------------------------------------------

function hash(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function pick<T>(arr: readonly T[], seed: number): T {
  // Нормализуем индекс: seed может прийти отрицательным (знаковые сдвиги >>),
  // тогда прямой seed % len дал бы отрицательный индекс и arr[i] === undefined.
  const i = ((Math.trunc(seed) % arr.length) + arr.length) % arr.length
  return arr[i]
}

const CONFIDENCES: Confidence[] = ["low", "medium", "high"]

// ---------------------------------------------------------------------------
// Остывание: дни без активности. Источник даты — loadDealLastActivity
// (src/server/client-activity.ts: письма/карточки, задачи, заказы, контакты
// компании); deal.updatedAt — только запасной вариант, если карту не передали.
// ---------------------------------------------------------------------------

function staleDaysFrom(updatedAtIso: string): number {
  const then = new Date(updatedAtIso).getTime()
  if (!Number.isFinite(then)) return 0
  const days = Math.floor((Date.now() - then) / 86_400_000)
  return days < 0 ? 0 : days
}

// ---------------------------------------------------------------------------
// Интел по сделке: остывание, бейджи, источник, confidence, локи. Всё — мок,
// стабильно по dealId.
// ---------------------------------------------------------------------------

const SOURCE_BADGES: IntelBadge[] = [
  { kind: "source", icon: "send", text: "создано из TG" },
  { kind: "source", icon: "mail", text: "создано из письма" },
]
const SOURCE_LABELS = [
  "TG · голосовое · 09.06",
  "Письмо · 10.06",
  "Звонок · 11.06",
  "Ручной ввод · 05.06",
]

function dealIntel(deal: DealRow, lastActivityAt?: Date): DealIntel {
  const seed = hash(deal.id)
  const norm = STAGE_NORM_BY_NAME[deal.funnelStageName] ?? DEFAULT_NORM
  const staleDays = staleDaysFrom(
    lastActivityAt ? lastActivityAt.toISOString() : deal.updatedAt,
  )

  const badges: IntelBadge[] = []
  const locks: DealIntel["locks"] = []

  // origin-бейдж источника — примерно у 2/3 сделок.
  if (seed % 3 !== 0) {
    badges.push(pick(SOURCE_BADGES, seed))
  }
  // сделка, «переведённая ИИ» — если в реальном changes есть стрелка перехода.
  if (deal.changes && deal.changes.includes("→")) {
    badges.push({ kind: "ai", icon: "sparkles", text: "ИИ перевёл" })
  }
  // авто-задача по правилу — у части сделок в Proposal/Negotiations.
  if (
    (deal.funnelStageName === "Proposal" || deal.funnelStageName === "Negotiations") &&
    seed % 2 === 0
  ) {
    badges.push({ kind: "auto", icon: "repeat", text: "авто-задача по правилу" })
  }
  // lock-поля — у части сделок. Бейджи «сумма/стадия — вручную» пользователю
  // НЕ показываем (важна сумма, а не её происхождение) — locks остаются под
  // капотом как контракт для будущей защиты полей от перезаписи агентом.
  if (seed % 4 === 0 && deal.value) {
    locks.push("amount")
  }
  if (seed % 5 === 0) {
    locks.push("stage")
  }

  // источник/confidence провенанса — мок; показываем, если есть реальный
  // reasoning/changes (иначе провенанс-попап всё равно пуст).
  const hasProvenance = Boolean(deal.reasoning || deal.changes)
  const provenanceSource = hasProvenance ? pick(SOURCE_LABELS, seed) : null
  const confidence = hasProvenance ? pick(CONFIDENCES, seed >> 3) : null

  return {
    staleDays,
    norm,
    isStale: staleDays > norm,
    badges,
    provenanceSource,
    confidence,
    locks,
  }
}

export function buildIntel(
  deals: DealRow[],
  stages: DealFunnelStageOption[],
  lastActivity?: Map<string, Date>,
): BoardIntelResponse {
  const intel: Record<string, DealIntel> = {}
  for (const d of deals) intel[d.id] = dealIntel(d, lastActivity?.get(d.id))
  return { intel, commitments: commitmentsForStages(stages) }
}


// The proposal generator and its in-memory stores (a fake "agent" that moved
// about every 3rd deal when the board loaded) were REMOVED on 2026-11-13
// (topics plan, decision R9). Real, journaled agent moves come from the
// topics deal bridge (docs/specs/topics/03-development-plan.md, phase 5).

// Лента решений больше не мок — реальный журнал deal_activity, см.
// listRecentDealActivity в src/server/deals.ts (и moveDealStage/createDeal,
// которые в него пишут). buildFeed/appendFeedEvent/appendedFeed удалены —
// каждый вызов moveDealStage (включая агентские авто-переводы в
// /api/deals/proposals) теперь сам пишет строку в deal_activity, отдельный
// in-memory аппенд стал не нужен.

// ---------------------------------------------------------------------------
// Общий auth-контекст для роутов (реюз паттерна из server/deals.ts).
// ---------------------------------------------------------------------------

export async function requireMockOrg() {
  const session = await getServerSession()
  if (!session) throw new Error("Unauthorized")
  const orgId = session.session.activeOrganizationId
  if (!orgId) throw new Error("No active organization")
  return {
    orgId,
    userName: session.user.name ?? "Вы",
  }
}

// Удобная обёртка: свежий список активных сделок орги (для роутов).
export async function loadBoardDeals(): Promise<DealRow[]> {
  return listDeals()
}

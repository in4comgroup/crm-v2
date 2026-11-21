// Client-safe contract of the user topics UI (topics plan phase 6, spec
// topics/01 §8.1, §9.1, §14; 06-attention-engine.md §7.2, §11): the shapes
// `GET /api/topics` returns, and PURE helpers for the dashboard lists
// («Мои» filter, «Сводка» / «Неделя» sections, «Новое» / «Обновлено»
// marker) and the drawer journal (topic_event → plain Russian). No DB, no
// server imports; unit-tested in topic-ui.test.ts.

import type { DealCardProposal, TopicCardEvent } from "./cards"
import type { TopicList } from "./attention-types"

// ── Tabs ──────────────────────────────────────────────────────────────────

/** Dashboard tabs: the three attention lists + «Все темы». */
export const TOPIC_TABS = ["now", "digest", "week", "all"] as const
export type TopicTab = (typeof TOPIC_TABS)[number]

export const TOPIC_TAB_LABELS_RU: Record<TopicTab, string> = {
  now: "Сейчас",
  digest: "Сводка",
  week: "Неделя",
  all: "Все темы",
}

export function isTopicTab(v: unknown): v is TopicTab {
  return typeof v === "string" && (TOPIC_TABS as readonly string[]).includes(v)
}

/**
 * Default of `cards.digestVisibleItems` (06 §7.2, §13): «Сводка» shows 5,
 * the rest under «Ещё». The live value is the delivery parameter
 * `digestVisibleItems` (settings ladder), sent as `TopicListResponse.digestVisibleItems`.
 */
export const DIGEST_VISIBLE_ITEMS = 5

/** Hours after the cycle start in which an entry carries «Новое» / «Обновлено». */
export const CYCLE_MARKER_HOURS = 24

import type { CardKind } from "@/lib/topics/cards"

// ── API shapes ────────────────────────────────────────────────────────────

/** One card of a topic as the UI shows it (topic card or deal card). */
export type TopicCardView = {
  id: string
  kind: CardKind
  /** Effective status (an open card past `expiresAt` reads as `expired`). */
  status: string | null
  headline: string
  whyNow: string
  whatChanged: string
  steps: string[]
  taskTitle: string | null
  /** Old columns the existing flows read (category `new_order` = order handoff). */
  category: string
  priority: "normal" | "high"
  /** Verbatim client message for «Создать заказ» (ORDER_REQUESTED). */
  orderRequest: string | null
  leadCode: string | null
  events: TopicCardEvent[]
  proposal: DealCardProposal | null
  dealId: string | null
  rejectReasonCode: string | null
  rejectionReason: string | null
  decidedAt: string | null
  resultTaskId: string | null
  resultOrderId: string | null
  expiresAt: string | null
  createdAt: string
  updatedAt: string
}

/** Read-time attention of an entry (subset of `TopicAttention`). */
export type TopicEntryAttention = {
  list: TopicList
  profile: string | null
  band: string
  class: string | null
  score: number
  deadline: string | null
  overdue: boolean
  escalations: string[]
  section: "expired" | "dormant" | null
  hiddenReason: string | null
  /** «Почему в этом списке» (06 §11). */
  explanation: string[]
  cycleStartedAt: string | null
  cycleReason: string | null
  cardExpiresAt: string | null
  /** P6 daily limit (phase 7): moved from «Сейчас» to «Сводка» for the viewer. */
  limited?: boolean
}

export type CycleMarker = "new" | "updated"

export const CYCLE_MARKER_LABELS_RU: Record<CycleMarker, string> = {
  new: "Новое",
  updated: "Обновлено",
}

/** One topic in a dashboard list. */
export type TopicEntry = {
  topicId: string
  title: string
  matter: string
  status: string
  subState: string
  clientId: string | null
  clientName: string | null
  contactId: string | null
  contactName: string | null
  /**
   * Contact for a task made from the card («Создать задачу»): the topic's
   * contact, else the newest contact named on the topic's items
   * (`source_item_subject.contact_id`), else null.
   */
  taskContactId: string | null
  /** Matter family (signal_category.family of the lead code) — task type hint. */
  family: string | null
  dealId: string | null
  dealName: string | null
  dealOwnerUserId: string | null
  ownerUserId: string | null
  ownerName: string | null
  leadCode: string | null
  leadLabelRu: string | null
  lastActivityAt: string
  snoozedUntil: string | null
  attention: TopicEntryAttention | null
  /** Newest `topic` card (any status; actions only while `open`). */
  card: TopicCardView | null
  /** Open deal cards of the topic (`deal_proposal` / `stage_confirmation`). */
  dealCards: TopicCardView[]
  marker: CycleMarker | null
  /** In-app evening reminder (phase 7): «Напоминание N из max» of this cycle, last 24 h. */
  reminder: { count: number; at: string } | null
  /**
   * «Сводка» / «Неделя» only (frozen lists, src/lib/topics/list-snapshot.ts):
   * "snapshot" = in the last snapshot of the list; "held" = in the snapshot
   * but left the list after it (kept until the next snapshot); "since" =
   * joined after it («Новое с утра» / «Новое после обзора»). Absent elsewhere.
   */
  snapshot?: "snapshot" | "held" | "since" | null
}

export type TopicListResponse = {
  tab: TopicTab
  entries: TopicEntry[]
  /** «Сейчас»: open deal cards (all topics), shown as «Решения по сделкам». */
  dealCards: (TopicCardView & { topicId: string; topicTitle: string; clientName: string | null })[]
  /** Last «Сводка» snapshot moment (morning, org time), ISO. */
  digestSnapshotAt: string
  /** Last «Неделя» snapshot moment (weekly review), ISO. */
  weeklySnapshotAt: string
  /** `cards.digestVisibleItems` (delivery params ladder): «Сводка» entries shown before «Ещё». */
  digestVisibleItems: number
  now: string
}

export type TopicCountPair = { all: number; mine: number }
export type TopicCounts = Record<TopicTab, TopicCountPair>

/** Filter options of «Все темы». */
export type TopicAllFilters = {
  /** `live` (open + dormant, default) | `all` | one topic status. */
  status?: string | null
  /** `any` (default) | one list. */
  list?: string | null
  clientId?: string | null
}

export type TopicItemView = {
  sourceItemId: string
  subjectIndex: number
  role: string
  date: string
  provider: string | null
  externalType: string
  subject: string | null
  from: string | null
  direction: string | null
}

export type TopicSignalView = {
  id: string
  code: string
  labelRu: string | null
  sourceItemId: string | null
  confidence: string
  counted: boolean
  notCountedReason: string | null
  evidence: string
  createdAt: string
  /** communication | system_of_record | external (phase 8: process signals). */
  origin: string
  processKey: string | null
  /** B5: the condition of a process signal is no longer true. */
  clearedAt: string | null
  clearedReason: string | null
}

export type TopicEventView = {
  id: string
  type: string
  actor: string
  userName: string | null
  sourceItemId: string | null
  /** Plain Russian line of the journal. */
  text: string
  createdAt: string
}

export type TopicDetailView = TopicEntry & {
  references: { kind: string; value: string; key: string }[]
  products: string[]
  firstSeenAt: string
  closedAt: string | null
  closedReason: string | null
  mergedIntoTopicId: string | null
  deal: { id: string; name: string; status: string; stageLabel: string | null } | null
  items: TopicItemView[]
  signals: TopicSignalView[]
  events: TopicEventView[]
  /** Every topic card, newest first (history). */
  cards: TopicCardView[]
  /** Every deal card of the topic, newest first. */
  allDealCards: TopicCardView[]
  /** Orders linked to the topic (phase 10), newest first. */
  orders: TopicOrderView[]
}

/** An order linked to a topic (phase 10). `total` = discounted total. */
export type TopicOrderView = {
  id: string
  label: string
  status: string
  total: number
  currency: string
  orderDate: string
}
/** «Привязать заказ»: an order of the topic's company; `otherTopicTitle` = it is on another topic now. */
export type TopicOrderOption = TopicOrderView & { otherTopicTitle: string | null }

export type TopicMergeOption = { id: string; title: string; status: string; lastActivityAt: string }
export type TopicDealOption = { id: string; name: string; status: string; stageLabel: string | null }
export type TopicOwnerOption = { id: string; name: string; email: string }

/** POST /api/topics body. */
export type TopicActionInput =
  | { action: "done"; topicId: string; note?: string }
  | { action: "dismiss"; topicId: string; reason?: string }
  /** `until` = YYYY-MM-DD (start of the working day, org time) or an ISO datetime. */
  | { action: "snooze"; topicId: string; until: string }
  | { action: "unsnooze"; topicId: string }
  /** Merge `otherTopicId` INTO `topicId` (the topic in view stays). */
  | { action: "merge"; topicId: string; otherTopicId: string }
  | { action: "detach"; topicId: string; sourceItemId: string }
  /** `dealId` null = unlink. */
  | { action: "link_deal"; topicId: string; dealId: string | null }
  /** `userId` null = no assignee (the deal owner is used again). */
  | { action: "set_owner"; topicId: string; userId: string | null }
  /** Recompute attention now (after a card decision). */
  | { action: "recompute"; topicId: string }
  /** Phase 10: link an order of the topic's company / unlink it. */
  | { action: "link_order"; topicId: string; orderId: string }
  | { action: "unlink_order"; topicId: string; orderId: string }

export const TOPIC_ACTIONS = [
  "done",
  "dismiss",
  "snooze",
  "unsnooze",
  "merge",
  "detach",
  "link_deal",
  "set_owner",
  "recompute",
  "link_order",
  "unlink_order",
] as const

// ── Pure helpers ──────────────────────────────────────────────────────────

/** «Мои» (spec §8.1): the topic's assignee is me OR the linked deal's owner is me. */
export function isMine(e: Pick<TopicEntry, "ownerUserId" | "dealOwnerUserId">, userId: string): boolean {
  return !!userId && (e.ownerUserId === userId || e.dealOwnerUserId === userId)
}

export function filterMine<T extends Pick<TopicEntry, "ownerUserId" | "dealOwnerUserId">>(
  entries: readonly T[],
  userId: string,
  mine: boolean,
): T[] {
  return mine ? entries.filter((e) => isMine(e, userId)) : [...entries]
}

/**
 * «Новое» / «Обновлено» (06 §7.1): a cycle started in the last
 * `CYCLE_MARKER_HOURS`. The first cycle of a topic (`created`) is «Новое»,
 * any later material change is «Обновлено».
 */
export function cycleMarker(
  a: Pick<TopicEntryAttention, "cycleStartedAt" | "cycleReason"> | null,
  now: Date,
  hours = CYCLE_MARKER_HOURS,
): CycleMarker | null {
  if (!a?.cycleStartedAt) return null
  const at = new Date(a.cycleStartedAt).getTime()
  if (!Number.isFinite(at) || at > now.getTime() || now.getTime() - at > hours * 3600_000) return null
  return a.cycleReason === "created" ? "new" : "updated"
}

/**
 * «Сводка» (06 §7.2): the frozen morning snapshot (`snapshot` ≠ "since";
 * `visible` entries shown, the rest under «Ещё»), then «Новое с утра»
 * (`snapshot` = "since"). Order inside each part is kept (the server sorts).
 */
export function splitDigest<T extends { snapshot?: "snapshot" | "held" | "since" | null }>(
  entries: readonly T[],
  visible = DIGEST_VISIBLE_ITEMS,
): { shown: T[]; more: T[]; sinceMorning: T[] } {
  const snap: T[] = []
  const sinceMorning: T[] = []
  for (const e of entries) (e.snapshot === "since" ? sinceMorning : snap).push(e)
  const n = Math.max(1, visible)
  return { shown: snap.slice(0, n), more: snap.slice(n), sinceMorning }
}

/**
 * «Неделя» (06 §7.2, §7.4): the frozen weekly snapshot — main list, then
 * «Истекло», then «Тема затихла» — and «Новое после обзора» (`snapshot` =
 * "since", any section).
 */
export function splitWeek<T extends { attention: Pick<TopicEntryAttention, "section"> | null; snapshot?: "snapshot" | "held" | "since" | null }>(
  entries: readonly T[],
): { main: T[]; expired: T[]; dormant: T[]; since: T[] } {
  const out = { main: [] as T[], expired: [] as T[], dormant: [] as T[], since: [] as T[] }
  for (const e of entries) {
    const s = e.attention?.section ?? null
    if (e.snapshot === "since") out.since.push(e)
    else if (s === "expired") out.expired.push(e)
    else if (s === "dormant") out.dormant.push(e)
    else out.main.push(e)
  }
  return out
}

/** Count per tab (all + «Мои») from already placed entries. */
export function countEntries(
  entries: readonly Pick<TopicEntry, "ownerUserId" | "dealOwnerUserId">[],
  userId: string,
): TopicCountPair {
  return { all: entries.length, mine: entries.filter((e) => isMine(e, userId)).length }
}

// ── Journal (topic_event → Russian) ───────────────────────────────────────

const LIST_RU: Record<string, string> = { now: "Сейчас", digest: "Сводка", week: "Неделя", none: "Все темы" }

const STATUS_RU: Record<string, string> = {
  open: "Открыта",
  dormant: "Затихла",
  resolved: "Решена",
  done: "Готово",
  dismissed: "Не относится",
  merged: "Объединена",
  expired: "Истекла",
  archived: "В архиве",
}

const DETACH_REASON_RU: Record<string, string> = {
  user: "вручную",
  reparse: "сообщение разобрано заново",
  teardown: "источник очищен",
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null
}

function quote(v: unknown): string {
  const s = str(v)
  return s ? ` «${s}»` : ""
}

function dateRu(v: unknown): string | null {
  const s = str(v)
  if (!s) return null
  const d = new Date(s)
  if (!Number.isFinite(d.getTime())) return s
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })
}

/**
 * One journal line in plain Russian. `labelOf` maps a signal code to its
 * Russian label; unknown types fall back to a neutral line (never the raw
 * type alone).
 */
export function describeTopicEvent(
  e: { type: string; actor: string; payload: Record<string, unknown> | null },
  labelOf: (code: string) => string | null = () => null,
): string {
  const p = e.payload ?? {}
  const code = str(p.code)
  const codeLabel = code ? (labelOf(code) ?? str(p.labelRu) ?? code) : null
  switch (e.type) {
    case "created":
      return codeLabel && p.process ? `Тема создана проверкой: ${codeLabel}` : "Тема создана"
    case "item_attached":
      return `Добавлено сообщение${str(p.role) === "closing" ? " (закрывает вопрос)" : ""}`
    case "item_detached": {
      const why = DETACH_REASON_RU[str(p.reason) ?? ""] ?? null
      return `Сообщение отвязано от темы${why ? ` (${why})` : ""}`
    }
    case "reopened":
      return codeLabel && p.process ? `Тема открыта снова: ${codeLabel}` : "Тема открыта снова: пришло новое сообщение"
    case "resolved":
      if (codeLabel && p.conditionCleared) return `Тема решена: условие «${codeLabel}» больше не выполняется`
      return codeLabel ? `Тема решена: ${codeLabel}` : "Тема решена"
    case "process_signal": {
      const what = codeLabel ?? "сигнал проверки"
      if (str(p.action) === "cleared") return `Условие снято: ${what}${str(p.reason) ? ` — ${str(p.reason)}` : ""}`
      return `Проверка данных: ${what}${str(p.evidence) ? ` — ${str(p.evidence)}` : ""}`
    }
    case "dormant":
      return "Тема затихла: долго нет активности"
    case "expired":
      return "Тема истекла: нет активности 60 дней"
    case "archived":
      return "Тема перенесена в архив"
    case "done":
      return `Отмечено «Готово»${str(p.note) ? `: ${str(p.note)}` : ""}`
    case "dismissed":
      return `Отмечено «Не относится»${str(p.reason) ? `: ${str(p.reason)}` : ""}`
    case "merged_into":
      return `Тема объединена с темой${quote(p.title)}`
    case "merged_from":
      return `К теме присоединена тема${quote(p.title)}`
    case "relinked":
      return "Тема привязана к компании или контакту"
    case "attention_changed": {
      const from = LIST_RU[str(p.from) ?? ""] ?? str(p.from)
      const to = LIST_RU[str(p.to) ?? ""] ?? str(p.to)
      return from && to ? `Список: «${from}» → «${to}»` : "Изменился список"
    }
    case "snoozed": {
      const until = dateRu(p.until)
      return until ? `Отложено до ${until}` : "Тема отложена"
    }
    case "unsnoozed":
      return "Откладывание снято"
    case "owner_changed":
      return str(p.toName) ? `Ответственный: ${str(p.toName)}` : "Ответственный снят"
    case "deal_linked":
      return `Тема привязана к сделке${quote(p.dealName)}`
    case "deal_unlinked":
      return `Тема отвязана от сделки${quote(p.dealName)}`
    case "deal_undone":
      return "Сделка агента отменена, тема отвязана"
    case "deal_context":
      return codeLabel ? `Событие по сделке: ${codeLabel}` : "Событие по сделке"
    case "deal_decision":
      return codeLabel ? `Проверка правил сделки: ${codeLabel}` : "Проверка правил сделки"
    case "deal_proposal_accepted":
      return "Предложение сделки принято"
    case "deal_proposal_rejected":
      return "Предложение сделки отклонено: «Не сделка»"
    case "deal_no_go": {
      // Entry gate «No-go» (docs/specs/funnel §3.2).
      const label = str(p.reasonLabel)
      const text = str(p.text)
      return `Отказ от участия${label ? `: ${label}` : ""}${text ? ` — ${text}` : ""}`
    }
    case "stage_confirmed":
      return "Стадия сделки подтверждена"
    case "stage_confirmation_rejected":
      return "Перевод стадии отклонён"
    case "order_linked": {
      const label = str(p.orderLabel)
      return `К теме привязан заказ${label ? ` ${label}` : ""}${str(p.via) === "card" ? " (создан из карточки)" : ""}`
    }
    case "order_unlinked": {
      const label = str(p.orderLabel)
      return `Заказ${label ? ` ${label}` : ""} отвязан от темы${str(p.reason) ? ` — ${str(p.reason)}` : ""}`
    }
    default:
      return e.actor === "user" ? "Действие пользователя" : "Событие системы"
  }
}

/** Russian status label of a topic. */
export function topicStatusRu(status: string): string {
  return STATUS_RU[status] ?? status
}

// Client-safe contract of topics plan phase 8: CRM checks and watchdogs
// (spec topics/01 §5.6, 05 §3.6, 06 §4.2 B5; Q22, Q24-6, Q24-11).
// A CHECK is a deterministic process (no LLM) that finds conditions in the
// org's data and writes PROCESS signal instances (`signal_instance` with
// `condition_key`, `facts`, `checked_at`, `cleared_at`). Shared by the pure
// check code (src/server/topics/checks/), the store, the admin API / UI.
// No DB, no server imports.

import { z } from "zod"

// ── Checks ────────────────────────────────────────────────────────────────

/** One check = one code (or a pair of codes for the YoY trend). */
export const CHECK_KEYS = [
  // Order data (origin system_of_record).
  "account_dormant",
  "product_stopped",
  "product_new",
  "new_followup",
  "revenue_yoy",
  "revenue_stagnation",
  "reactivation_due",
  // CRM data without orders (phase 8 follow-up, origin system_of_record).
  "meeting_overdue",
  "price_change",
  "product_status",
  // Watchdogs over communication topics (origin communication).
  "offer_no_response",
  "price_no_response",
  "material_no_response",
  "order_confirmation_open",
  "report_open",
  "contract_not_renewed",
  // Contact data (2026-11-26, origin system_of_record).
  "contact_birthday",
] as const
export type CheckKey = (typeof CHECK_KEYS)[number]

export type CheckGroup = "orders" | "watchdogs" | "contacts"
/** daily / weekly (Monday) / monthly (day 3) at `runTime` org time; `hourly` = every run. */
export type CheckSchedule = "hourly" | "daily" | "weekly" | "monthly"

export type CheckDef = {
  key: CheckKey
  group: CheckGroup
  codes: readonly string[]
  schedule: CheckSchedule
  labelRu: string
}

export const CHECKS: readonly CheckDef[] = [
  { key: "account_dormant", group: "orders", codes: ["ACCOUNT_DORMANT"], schedule: "daily", labelRu: "Клиент перестал покупать" },
  { key: "product_stopped", group: "orders", codes: ["ACCOUNT_PRODUCT_STOPPED"], schedule: "monthly", labelRu: "Клиент перестал покупать позицию" },
  { key: "product_new", group: "orders", codes: ["ACCOUNT_PRODUCT_NEW"], schedule: "daily", labelRu: "Клиент впервые купил позицию" },
  { key: "new_followup", group: "orders", codes: ["ACCOUNT_NEW_FOLLOWUP"], schedule: "daily", labelRu: "Пора обсудить первый заказ" },
  {
    key: "revenue_yoy",
    group: "orders",
    codes: ["ACCOUNT_REVENUE_DECLINE_YOY", "ACCOUNT_REVENUE_GROWTH_YOY"],
    schedule: "monthly",
    labelRu: "Выручка год к году",
  },
  { key: "revenue_stagnation", group: "orders", codes: ["ACCOUNT_REVENUE_STAGNATION"], schedule: "monthly", labelRu: "Стагнация выручки" },
  { key: "reactivation_due", group: "orders", codes: ["ACCOUNT_REACTIVATION_DUE"], schedule: "weekly", labelRu: "Пора возобновить контакт" },
  { key: "meeting_overdue", group: "orders", codes: ["ACCOUNT_MEETING_OVERDUE"], schedule: "weekly", labelRu: "Давно не было встречи" },
  { key: "price_change", group: "orders", codes: ["INTERNAL_PRICE_CHANGE"], schedule: "daily", labelRu: "Изменились наши цены" },
  { key: "product_status", group: "orders", codes: ["INTERNAL_PRODUCT_STATUS_UPDATE"], schedule: "daily", labelRu: "Изменился статус позиции" },
  { key: "offer_no_response", group: "watchdogs", codes: ["SALES_OFFER_NO_RESPONSE"], schedule: "hourly", labelRu: "Нет ответа на КП" },
  { key: "price_no_response", group: "watchdogs", codes: ["SALES_PRICE_NO_RESPONSE"], schedule: "hourly", labelRu: "Нет реакции на цены" },
  { key: "material_no_response", group: "watchdogs", codes: ["SALES_MATERIAL_NO_RESPONSE"], schedule: "hourly", labelRu: "Нет реакции на материалы" },
  {
    key: "order_confirmation_open",
    group: "watchdogs",
    codes: ["SALES_ORDER_CONFIRMATION_OPEN"],
    schedule: "hourly",
    labelRu: "Подтверждение заказа не отправлено",
  },
  { key: "report_open", group: "watchdogs", codes: ["DELIVERY_REPORT_OPEN"], schedule: "hourly", labelRu: "Отчёт не предоставлен" },
  { key: "contract_not_renewed", group: "watchdogs", codes: ["CONTRACT_NOT_RENEWED"], schedule: "daily", labelRu: "Договор истёк и не продлён" },
  // «Сейчас» on the contact's birthday (weight 8 = P8), cleared the next day.
  { key: "contact_birthday", group: "contacts", codes: ["CONTACT_BIRTHDAY"], schedule: "daily", labelRu: "День рождения контакта" },
]

export const CHECK_BY_KEY: ReadonlyMap<CheckKey, CheckDef> = new Map(CHECKS.map((c) => [c.key, c]))

export function isCheckKey(v: unknown): v is CheckKey {
  return typeof v === "string" && (CHECK_KEYS as readonly string[]).includes(v)
}

export const CHECK_SCHEDULE_LABELS_RU: Record<CheckSchedule, string> = {
  hourly: "Каждый запуск",
  daily: "Ежедневно",
  weekly: "По понедельникам",
  monthly: "Ежемесячно, 3-го числа",
}

/** Process codes that phase 8 does NOT emit, with the reason (shown on the admin block). */
export const CHECKS_NOT_BUILT: readonly { code: string; reasonRu: string }[] = [
  { code: "SIGNAL_SPEND_UP", reasonRu: "Внешние данные о расходах — этап 11" },
  { code: "SIGNAL_SPEND_DOWN", reasonRu: "Внешние данные о расходах — этап 11" },
  { code: "SIGNAL_NEW_TOP_SPENDER", reasonRu: "Внешний рейтинг — этап 11" },
  { code: "SIGNAL_TRACKING_GAP", reasonRu: "Сканирование сайтов — этап 11" },
]

// ── Org switch (org_setting `topics.checks`) ──────────────────────────────
// orders / watchdogs default off; `contacts` (birthdays, 2026-11-26) default
// ON — a stored value without the key reads as on.

export type ChecksSwitch = { orders: boolean; watchdogs: boolean; contacts: boolean }
export const CHECKS_SWITCH_DEFAULT: ChecksSwitch = { orders: false, watchdogs: false, contacts: true }
export const checksSwitchSchema = z.object({
  orders: z.boolean(),
  watchdogs: z.boolean(),
  contacts: z.boolean().default(true),
})

export const CHECK_GROUPS: readonly CheckGroup[] = ["orders", "watchdogs", "contacts"]

/** PURE. Is the group of a check switched on? */
export function checkGroupOn(sw: ChecksSwitch, group: CheckGroup): boolean {
  return sw[group] === true
}

// ── Parameters (settings ladder: org `checks.params` → platform → defaults) ──

export type ChecksParams = {
  /** Local time of scheduled checks (daily / weekly / monthly). */
  runTime: string
  /** Day of month of monthly checks. */
  monthlyDay: number
  /** ISO weekday of weekly checks (1 = Monday). */
  weeklyWeekday: number
  /** New instances per check per org per run (flood guard; the rest waits for the next run). */
  maxNewPerCheckPerRun: number
  // ACCOUNT_DORMANT
  dormantRhythmFloorDays: number
  dormantMinBestYearRub: number
  // ACCOUNT_PRODUCT_STOPPED
  productMinOrders: number
  productStoppedMinDays: number
  productLookbackMonths: number
  // ACCOUNT_PRODUCT_NEW
  productNewMinHistoryDays: number
  productNewLookbackDays: number
  // ACCOUNT_NEW_FOLLOWUP
  newClientFollowupDays: number
  // ACCOUNT_REVENUE_* (trends)
  revenueTrendMinRub: number
  revenueDeclineThresholdPct: number
  revenueDeclineMinRub: number
  revenueGrowthThresholdPct: number
  revenueGrowthMinRub: number
  revenueStagnationThresholdPct: number
  /** Cooldown per client + code (`cards.trendCooldownDays`). */
  trendCooldownDays: number
  // ACCOUNT_REACTIVATION_DUE
  reactivationIntervalDays: number
  formerClientMonths: number
  // ACCOUNT_MEETING_OVERDUE — client segment derived from 12-month revenue
  // (no stored field): A = clients making the top `segmentAPct` % of org
  // revenue, B = the next `segmentBPct` %, C = the rest.
  segmentAPct: number
  segmentBPct: number
  meetingFrequencyADays: number
  meetingFrequencyBDays: number
  meetingFrequencyCDays: number
  // INTERNAL_PRICE_CHANGE / INTERNAL_PRODUCT_STATUS_UPDATE (catalogue history, `product_watch_state`)
  priceChangeThresholdPct: number
  /** Cooldown per SKU and event (calendar days). */
  internalCooldownDays: number
  /** «Clients who bought the SKU» look-back (months). */
  buyerLookbackMonths: number
  /** Stock-out matters only for SKUs ordered in the last N days. */
  stockOutRecentOrderDays: number
  // Watchdogs (Q24-11)
  /** Default reply window after our sending (`cards.noResponseDefaultDays`, calendar days). */
  noResponseDefaultDays: number
  /** Org reply window for our promised confirmation / report without a date (working days). */
  orgReplyWorkingDays: number
  /** Watchdogs look at sendings / requests not older than this (calendar days). */
  watchdogLookbackDays: number
}

export const CHECKS_DEFAULTS: ChecksParams = {
  runTime: "07:00",
  monthlyDay: 3,
  weeklyWeekday: 1,
  maxNewPerCheckPerRun: 30,
  dormantRhythmFloorDays: 90,
  dormantMinBestYearRub: 300_000,
  productMinOrders: 4,
  productStoppedMinDays: 90,
  productLookbackMonths: 24,
  productNewMinHistoryDays: 183,
  productNewLookbackDays: 2,
  newClientFollowupDays: 14,
  revenueTrendMinRub: 100_000,
  revenueDeclineThresholdPct: 15,
  revenueDeclineMinRub: 100_000,
  revenueGrowthThresholdPct: 10,
  revenueGrowthMinRub: 100_000,
  revenueStagnationThresholdPct: 5,
  trendCooldownDays: 90,
  reactivationIntervalDays: 180,
  formerClientMonths: 12,
  segmentAPct: 20,
  segmentBPct: 30,
  meetingFrequencyADays: 30,
  meetingFrequencyBDays: 90,
  meetingFrequencyCDays: 180,
  priceChangeThresholdPct: 5,
  internalCooldownDays: 30,
  buyerLookbackMonths: 12,
  stockOutRecentOrderDays: 90,
  noResponseDefaultDays: 7,
  orgReplyWorkingDays: 2,
  watchdogLookbackDays: 60,
}

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const nonneg = z.number().min(0)
const days = z.number().int().min(0).max(3650)

/** A partial override (org or platform level). Unknown keys are dropped. */
export const checksParamsOverrideSchema = z
  .object({
    runTime: hhmm,
    monthlyDay: z.number().int().min(1).max(28),
    weeklyWeekday: z.number().int().min(1).max(7),
    maxNewPerCheckPerRun: z.number().int().min(1).max(500),
    dormantRhythmFloorDays: days,
    dormantMinBestYearRub: nonneg,
    productMinOrders: z.number().int().min(2).max(100),
    productStoppedMinDays: days,
    productLookbackMonths: z.number().int().min(6).max(60),
    productNewMinHistoryDays: days,
    productNewLookbackDays: z.number().int().min(1).max(60),
    newClientFollowupDays: days,
    revenueTrendMinRub: nonneg,
    revenueDeclineThresholdPct: z.number().min(0).max(100),
    revenueDeclineMinRub: nonneg,
    revenueGrowthThresholdPct: z.number().min(0).max(1000),
    revenueGrowthMinRub: nonneg,
    revenueStagnationThresholdPct: z.number().min(0).max(100),
    trendCooldownDays: days,
    reactivationIntervalDays: days,
    formerClientMonths: z.number().int().min(1).max(120),
    segmentAPct: z.number().min(1).max(100),
    segmentBPct: z.number().min(0).max(100),
    meetingFrequencyADays: days,
    meetingFrequencyBDays: days,
    meetingFrequencyCDays: days,
    priceChangeThresholdPct: z.number().min(0).max(100),
    internalCooldownDays: days,
    buyerLookbackMonths: z.number().int().min(1).max(60),
    stockOutRecentOrderDays: days,
    noResponseDefaultDays: z.number().int().min(1).max(90),
    orgReplyWorkingDays: z.number().int().min(0).max(30),
    watchdogLookbackDays: z.number().int().min(7).max(365),
  })
  .partial()

export type ChecksParamsOverride = z.infer<typeof checksParamsOverrideSchema>

/** Defaults ← platform override ← org override (later wins). */
export function mergeChecksParams(...overrides: (ChecksParamsOverride | null | undefined)[]): ChecksParams {
  let p: ChecksParams = { ...CHECKS_DEFAULTS }
  for (const o of overrides) if (o) p = { ...p, ...o }
  return p
}

// ── Results of one check (pure functions return these) ─────────────────

/** A condition that is true now. The store dedupes by (code, conditionKey). */
export type CheckFinding = {
  code: string
  /** Stable key of the condition, e.g. `client:<id>:last_order:<orderId>`. */
  conditionKey: string
  /** Topic to attach to (watchdogs: the originating topic). null = the store opens a new topic. */
  topicId: string | null
  clientId: string | null
  contactId: string | null
  /** Display name of the client / contact (title of a new topic). */
  companyName: string | null
  /** Topic matter of a new topic, Russian nominative («Клиент перестал покупать»). */
  matterRu: string
  /** The data fact in Russian («последний заказ № 1188 от 31.07.2026; обычный ритм 90 дней»). */
  evidenceRu: string
  /** Instance score; null = the code's effective weight. */
  score: number | null
  /** Numbers / dates / ids of the check (stored in `signal_instance.facts`). */
  facts: Record<string, unknown>
}

/** An open (not cleared) process instance whose condition is no longer true. */
export type CheckClear = { instanceId: string; reasonRu: string }

export type CheckResult = {
  findings: CheckFinding[]
  clears: CheckClear[]
  /** Data volume (clients / topics looked at). */
  evaluated: number
  /** Skips by reason («мало данных», «уже есть тема», …) — counted, not stored. */
  skipped: Record<string, number>
}

/** An existing process instance of the check's codes, given to the pure check. */
export type OpenProcessInstance = {
  id: string
  code: string
  conditionKey: string
  topicId: string | null
  clientId: string | null
  facts: Record<string, unknown>
  createdAt: Date
  /** null = still active (B5). */
  clearedAt: Date | null
}

// ── Admin view ────────────────────────────────────────────────────────────

export type CheckRunView = {
  id: string
  checkKey: CheckKey
  periodKey: string
  trigger: "schedule" | "manual" | "preview"
  status: "running" | "ok" | "failed" | "skipped"
  counts: Record<string, number>
  error: string | null
  startedAt: string
  finishedAt: string | null
}

export type CheckPreviewRow = {
  code: string
  conditionKey: string
  companyName: string | null
  matterRu: string
  evidenceRu: string
  score: number
  topicId: string | null
  /** true = an instance with this key exists already (no new topic). */
  exists: boolean
}

export type ChecksOrgView = {
  organizationId: string
  switch: ChecksSwitch
  params: ChecksParams
  checks: (CheckDef & { lastRun: CheckRunView | null; openInstances: number })[]
  notBuilt: typeof CHECKS_NOT_BUILT
  runs: CheckRunView[]
}

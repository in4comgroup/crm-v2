// Notification condition checks (docs/specs/notifications §3.2, §4; Q3, Q7).
// PURE, client-safe: the timing / threshold rules and the Russian texts of
// the hourly checks. The DB side (load READ ONLY → rule → notify / resolve)
// is src/server/notifications/checks.ts. Unit tests: rules.test.ts.

import { aiLimitStep, type AiLimitStep } from "@/lib/ai-budget"
import { addCalendarDays, isoWeekday } from "@/lib/topics/attention-calendar"

/** The calendar surface the rules need (implemented by `WorkCalendar`). */
export type RuleCalendar = {
  readonly timeZone: string
  localDay(d: Date): string
  localMinutes(d: Date): number
  at(day: string, time: number | string): Date
  isWorkingDay(day: string): boolean
}

/** Local time of the morning notices (Q7: 09:00 org time). */
export const MORNING_TIME = "09:00"
const MORNING_MIN = 9 * 60
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

// ── Tasks (Q7) ─────────────────────────────────────────────────────────────

export type TaskReminderKind = "task.due_tomorrow" | "task.due_today" | "task.overdue"

export const OPEN_TASK_STATUSES = ["todo", "in_progress"] as const

export type TaskReminderInput = {
  taskId: string
  dueAt: Date
  status: string
  createdAt: Date
}

export type TaskReminder = {
  kind: TaskReminderKind
  /** Local due day "YYYY-MM-DD" (part of the key: a moved date notifies again). */
  dueDay: string
  dedupeKey: string
  /** The moment the notice became due. */
  fireAt: Date
}

/** Keys of one task for one due day (the hook resolves them on a date move). */
export function taskReminderKeys(taskId: string, dueDay: string): string[] {
  return (["task.due_tomorrow", "task.due_today", "task.overdue"] as const).map((k) => `${k}:${taskId}:${dueDay}`)
}

/** Prefixes of every notice of a task (any due day). */
export function taskReminderPrefixes(taskId: string): string[] {
  return (["task.due_tomorrow", "task.due_today", "task.overdue"] as const).map((k) => `${k}:${taskId}:`)
}

/** An overdue notice is sent only this long after it became due (no flood of old tasks). */
export const OVERDUE_SEND_WINDOW_DAYS = 3
/** Scan limit for the working day before / after (holiday runs are shorter). */
const MAX_SCAN_DAYS = 30

function previousWorkingDay(cal: RuleCalendar, day: string): string | null {
  for (let i = 1; i <= MAX_SCAN_DAYS; i++) {
    const d = addCalendarDays(day, -i)
    if (cal.isWorkingDay(d)) return d
  }
  return null
}

function nextWorkingDay(cal: RuleCalendar, day: string): string | null {
  for (let i = 1; i <= MAX_SCAN_DAYS; i++) {
    const d = addCalendarDays(day, i)
    if (cal.isWorkingDay(d)) return d
  }
  return null
}

/** Does the due moment carry a time of day (not 00:00 local)? */
export function taskHasTime(cal: RuleCalendar, dueAt: Date): boolean {
  return cal.localMinutes(dueAt) !== 0
}

/**
 * PURE. Which task notices are due at `now` (Q7):
 * - `task.due_tomorrow` (info): at / after 09:00 on the WORKING day before the
 *   due day (Friday for a Monday task), until the due day starts; none when
 *   the task was created after that moment.
 * - `task.due_today` (important): at / after 09:00 on the due day — or, for a
 *   task with a time of day, at / after min(09:00, due − 2 h); a task created
 *   later than that moment on its due day → at once. Until the due day ends.
 * - `task.overdue` (important, once): at / after 09:00 on the first working
 *   day after the due day, within `OVERDUE_SEND_WINDOW_DAYS`.
 * Only open tasks (`todo` / `in_progress`). The dedupe keys carry the due day.
 */
export function dueTaskReminders(input: TaskReminderInput, cal: RuleCalendar, now: Date): TaskReminder[] {
  if (!(OPEN_TASK_STATUSES as readonly string[]).includes(input.status)) return []
  const dueDay = cal.localDay(input.dueAt)
  const dayStart = cal.at(dueDay, 0)
  const dayEnd = cal.at(addCalendarDays(dueDay, 1), 0)
  const out: TaskReminder[] = []
  const key = (kind: TaskReminderKind) => `${kind}:${input.taskId}:${dueDay}`

  // «Завтра»
  const before = previousWorkingDay(cal, dueDay)
  if (before) {
    const fireAt = cal.at(before, MORNING_TIME)
    if (now >= fireAt && now < dayStart && input.createdAt <= fireAt) {
      out.push({ kind: "task.due_tomorrow", dueDay, dedupeKey: key("task.due_tomorrow"), fireAt })
    }
  }

  // «Сегодня»
  let todayAt = cal.at(dueDay, MORNING_TIME)
  if (taskHasTime(cal, input.dueAt)) {
    const early = new Date(input.dueAt.getTime() - 2 * HOUR_MS)
    if (early < todayAt) todayAt = early < dayStart ? dayStart : early
  }
  if (now >= todayAt && now < dayEnd) {
    out.push({ kind: "task.due_today", dueDay, dedupeKey: key("task.due_today"), fireAt: todayAt })
  }

  // «Просрочена»
  const after = nextWorkingDay(cal, dueDay)
  if (after) {
    const fireAt = cal.at(after, MORNING_TIME)
    if (now >= fireAt && now.getTime() < fireAt.getTime() + OVERDUE_SEND_WINDOW_DAYS * DAY_MS) {
      out.push({ kind: "task.overdue", dueDay, dedupeKey: key("task.overdue"), fireAt })
    }
  }
  return out
}

function fmtDate(cal: RuleCalendar, d: Date, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: cal.timeZone, ...opts }).format(d)
}

function fmtTime(cal: RuleCalendar, d: Date): string {
  return fmtDate(cal, d, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
}

/** PURE. Russian title + body of a task notice. */
export function taskReminderText(
  kind: TaskReminderKind,
  task: { name: string; dueAt: Date },
  cal: RuleCalendar,
): { title: string; body: string } {
  const name = task.name.trim() || "Без названия"
  const timePart = taskHasTime(cal, task.dueAt) ? ` в ${fmtTime(cal, task.dueAt)}` : ""
  const dayPart = fmtDate(cal, task.dueAt, { weekday: "short", day: "numeric", month: "long" })
  if (kind === "task.due_tomorrow") return { title: `Срок задачи завтра: ${name}`, body: `Срок: ${dayPart}${timePart}.` }
  if (kind === "task.due_today") return { title: `Срок задачи сегодня: ${name}`, body: `Срок: сегодня${timePart}.` }
  return {
    title: `Задача просрочена: ${name}`,
    body: `Срок был ${fmtDate(cal, task.dueAt, { day: "numeric", month: "long" })}${timePart}. Задача ещё не выполнена.`,
  }
}

// ── AI usage (Q3) ──────────────────────────────────────────────────────────

/** Step of the monthly AI limit — ONE rule everywhere (src/lib/ai-budget.ts, Q3). */
export const monthlyLimitStep = aiLimitStep

/** UTC month key "YYYY-MM" of a moment. */
export function utcMonthKey(d: Date): string {
  return d.toISOString().slice(0, 7)
}

/** UTC month key of the month before `d`. */
export function previousUtcMonthKey(d: Date): string {
  return utcMonthKey(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)))
}

/** UTC day key "YYYY-MM-DD". */
export function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function aiMonthKey(month: string, step: Exclude<AiLimitStep, 0>): string {
  return `ai.limit.month:${month}:${step}`
}

const MONTHS_PREP_RU = [
  "январе", "феврале", "марте", "апреле", "мае", "июне",
  "июле", "августе", "сентябре", "октябре", "ноябре", "декабре",
]
const MONTHS_GEN_RU = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
]

/** «14,40» / «20» — US dollars, up to 2 decimals, Russian separators. */
export function fmtUsd(n: number): string {
  const v = Math.max(0, n)
  const decimals = Number.isInteger(v) ? 0 : 2
  return new Intl.NumberFormat("ru-RU", { minimumFractionDigits: decimals, maximumFractionDigits: 2 })
    .format(v)
    .replace(/ /g, " ")
}

/** PURE. Text of the monthly-limit notice (END-USER cost only — never the gateway cost). */
export function aiMonthlyLimitText(
  step: Exclude<AiLimitStep, 0>,
  spentUsd: number,
  limitUsd: number,
  now: Date,
): { title: string; body: string } {
  const pct = limitUsd > 0 ? Math.floor((spentUsd / limitUsd) * 100) : 100
  const amounts = `${fmtUsd(spentUsd)} из ${fmtUsd(limitUsd)} $`
  const month = MONTHS_PREP_RU[now.getUTCMonth()]
  if (step === 100) {
    const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
    return {
      title: `Месячный лимит ИИ исчерпан (${amounts})`,
      body: `Фоновые процессы ИИ остановлены до ${reset.getUTCDate()} ${MONTHS_GEN_RU[reset.getUTCMonth()]}. Интерактивные функции работают.`,
    }
  }
  return {
    title: `Использовано ${pct} % месячного лимита ИИ (${amounts})`,
    body:
      step === 90
        ? `Расход в ${month} близок к лимиту. При 100 % фоновые процессы ИИ остановятся до конца месяца.`
        : `Расход ИИ в ${month}. При 100 % фоновые процессы ИИ остановятся до конца месяца.`,
  }
}

// ── Org profile (Q4) ───────────────────────────────────────────────────────

/** ISO week key "YYYY-Www" of a local day "YYYY-MM-DD". */
export function isoWeekKey(day: string): string {
  // The ISO week belongs to the year of its Thursday.
  const thursday = addCalendarDays(day, 4 - isoWeekday(day))
  const year = Number(thursday.slice(0, 4))
  const jan1 = `${year}-01-01`
  const firstThursday = addCalendarDays(jan1, (4 - isoWeekday(jan1) + 7) % 7)
  const [y1, m1, d1] = firstThursday.split("-").map(Number)
  const [y2, m2, d2] = thursday.split("-").map(Number)
  const week = Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / (7 * DAY_MS)) + 1
  return `${year}-W${String(week).padStart(2, "0")}`
}

/**
 * PURE. Period key of the org-profile reminder: the ISO week of the latest
 * Monday 09:00 (org time) at or before `now`. One notice per period: the
 * first one is sent at once (no notice in the current period yet), then a
 * new period starts every Monday at 09:00 → weekly.
 */
export function orgProfilePeriodKey(cal: RuleCalendar, now: Date): string {
  const today = cal.localDay(now)
  let monday = addCalendarDays(today, 1 - isoWeekday(today))
  if (now < cal.at(monday, MORNING_TIME)) monday = addCalendarDays(monday, -7)
  return `profile.org.incomplete:${isoWeekKey(monday)}`
}

// ── Client profile proposals ───────────────────────────────────────────────

/** PURE. The daily digest key, or null before 09:00 org time. */
export function clientProposalsKey(cal: RuleCalendar, now: Date): string | null {
  if (cal.localMinutes(now) < MORNING_MIN) return null
  return `profile.client.proposals:${cal.localDay(now)}`
}

/** «Есть предложения для профилей N компаний» with the right Russian form. */
export function companiesWord(n: number): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return "компании"
  return "компаний"
}

// ── Sources ────────────────────────────────────────────────────────────────

/** Grace after a failed daily sync before notifying (a retry may recover it). */
export const SOURCE_FAILING_GRACE_HOURS = 3

export type SourceHealthInput = {
  /** `source.last_synced_at` (stamped on every successful sync). */
  lastSyncedAt: Date | null
  /** The latest finished daily pipeline run (null = none yet). */
  latestRun: { id: string; startedAt: Date } | null
  /** Sync error of THIS source in the latest run (null = none / not attempted). */
  latestError: string | null
  /** Finished daily runs in a row (newest first) with a sync error of this source. */
  failedRunsInRow: number
}

/**
 * PURE. A source is failing when the latest finished daily run recorded a
 * sync error for it, no successful sync happened since that run started
 * (hourly topics intake, a manual sync) and the failure is at least
 * `SOURCE_FAILING_GRACE_HOURS` old — or it failed 3 runs in a row.
 */
export function sourceIsFailing(input: SourceHealthInput, now: Date): boolean {
  if (!input.latestRun || !input.latestError) return false
  if (input.lastSyncedAt && input.lastSyncedAt >= input.latestRun.startedAt) return false
  if (input.failedRunsInRow >= 3) return true
  return now.getTime() - input.latestRun.startedAt.getTime() >= SOURCE_FAILING_GRACE_HOURS * HOUR_MS
}

/** PURE. Is the sync error about credentials (missing / rejected)? */
export function isCredentialsError(message: string): boolean {
  return /no credentials configured|credential|unauthori[sz]ed|invalid_grant|authenticat|\b401\b|\b403\b|AUTHENTICATIONFAILED/i.test(
    message,
  )
}

/** PURE. Russian text of the source notice (never the raw technical message as the title). */
export function sourceFailingText(
  sourceName: string,
  input: { error: string; failedRunsInRow: number },
): { title: string; body: string } {
  const why = isCredentialsError(input.error)
    ? "Проверьте учётные данные источника (они не настроены или больше не действуют)."
    : "Проверьте настройки источника."
  const runs =
    input.failedRunsInRow > 1 ? ` Ошибка ${input.failedRunsInRow} запуска подряд.` : ""
  const detail = input.error.length > 300 ? `${input.error.slice(0, 300)}…` : input.error
  return {
    title: `Источник «${sourceName}» не синхронизируется`,
    body: `${why}${runs} Ошибка: ${detail}`,
  }
}

// ── Runs ───────────────────────────────────────────────────────────────────

export const TOPICS_PHASE_LABELS_RU: Record<string, string> = {
  intake: "приём сообщений",
  signals: "сигналы",
  topics: "темы",
  checks: "проверки CRM",
  attention: "внимание",
  cards: "карточки",
  deals: "сделки",
  dealState: "состояние сделок",
  delivery: "рассылка",
}

export type RunOrgOutcomeLite = {
  error?: string
  phases?: Record<string, unknown>
}

/** PURE. Phases (and the org step) of one org that ended with an error. */
export function failedRunParts(outcome: RunOrgOutcomeLite): string[] {
  const out: string[] = []
  if (outcome.error) out.push("org")
  for (const [name, v] of Object.entries(outcome.phases ?? {})) {
    if (v && typeof v === "object" && typeof (v as { error?: unknown }).error === "string") out.push(name)
  }
  return out
}

/** PURE. Text of `process.run_failed` for a topics run. */
export function runFailedText(parts: string[]): { title: string; body: string } {
  const labels = parts.map((p) => (p === "org" ? "подготовка организации" : (TOPICS_PHASE_LABELS_RU[p] ?? p)))
  return {
    title: "Ошибка фоновой обработки тем",
    body: `Шаги с ошибкой: ${labels.join(", ")}. Остальные шаги выполнены; следующий запуск — через час.`,
  }
}

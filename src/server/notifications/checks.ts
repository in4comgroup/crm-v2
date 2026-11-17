import "server-only"

import { and, desc, eq, gte, inArray, isNotNull, lte, ne, notInArray } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { client, clientProfileProposal, organization, pipelineRun, source, task, topicsRun } from "@/db/schema"
import { COMPLETENESS_LABELS_RU } from "@/lib/identity/org-profile"
import {
  OPEN_TASK_STATUSES,
  aiMonthKey,
  aiMonthlyLimitText,
  clientProposalsKey,
  companiesWord,
  dueTaskReminders,
  failedRunParts,
  monthlyLimitStep,
  orgProfilePeriodKey,
  previousUtcMonthKey,
  runFailedText,
  sourceFailingText,
  sourceIsFailing,
  taskReminderKeys,
  taskReminderPrefixes,
  taskReminderText,
  utcDayKey,
  utcMonthKey,
  type RunOrgOutcomeLite,
} from "@/lib/notifications/rules"
import { syncableProviders } from "@/lib/sources/providers"
import { WorkCalendar } from "@/lib/topics/attention-calendar"
import { getOrgBudgetStatus } from "@/server/ai/budget"
import { getOrgCompleteness } from "@/server/identity/own-org"
import { loadAttentionParams, loadCalendarDays } from "@/server/topics/attention/store"
import { getTopicsMode } from "@/server/topics/mode"
import { notify, purgeExpiredNotifications, resolveNotifications } from "./engine"

// Hourly notification condition checks for EVERY org (docs/specs/notifications
// §3.2, §4; plan NF3). Each check loads its data READ ONLY, applies a PURE
// rule (src/lib/notifications/rules.ts) and calls `notify` / `resolve`
// (src/server/notifications/engine.ts — the only write path). Every check is
// isolated: an error is logged and counted, the other checks still run.
// Org time zone + working hours = `attention.params` (org → platform →
// default Europe/Vienna), working days = `work_calendar_day`.

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

/** Tasks due in [now − 14 d, now + 14 d] are evaluated (holiday runs fit). */
const TASK_WINDOW_DAYS = 14
/** Safety net for closed tasks (the hook `onTaskChanged` resolves at once). */
const CLOSED_TASK_LOOKBACK_HOURS = 3
/** `topics_run` rows finished in this window are checked for failures. */
const RUN_LOOKBACK_HOURS = 26
/** Finished daily runs read for the «N runs in a row» count. */
const SOURCE_RUNS_READ = 5

export type CheckName = "tasks" | "aiUsage" | "orgProfile" | "clientProposals" | "sources" | "runs"

export type CheckCounts = { notified: number; resolved: number; error?: string }

export type NotificationChecksResult = Partial<Record<CheckName, CheckCounts>>

/** Data shared by all orgs of one cron run (loaded once). */
export type SharedCheckData = {
  /** Finished daily pipeline runs, newest first. */
  pipelineRuns: { id: string; startedAt: Date; syncErrors: Map<string, string> }[]
  /** Finished topics runs of the last `RUN_LOOKBACK_HOURS`, newest first. */
  topicsRuns: { id: string; finishedAt: Date; orgs: (RunOrgOutcomeLite & { orgId?: string })[] }[]
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export async function loadSharedCheckData(now: Date = new Date()): Promise<SharedCheckData> {
  const [pipe, topics] = await Promise.all([
    db
      .select({ id: pipelineRun.id, startedAt: pipelineRun.startedAt, errors: pipelineRun.errorsJson })
      .from(pipelineRun)
      .where(ne(pipelineRun.status, "running"))
      .orderBy(desc(pipelineRun.startedAt))
      .limit(SOURCE_RUNS_READ),
    db
      .select({ id: topicsRun.id, finishedAt: topicsRun.finishedAt, orgs: topicsRun.orgs })
      .from(topicsRun)
      .where(and(ne(topicsRun.status, "running"), isNotNull(topicsRun.finishedAt), gte(topicsRun.finishedAt, new Date(now.getTime() - RUN_LOOKBACK_HOURS * HOUR_MS))))
      .orderBy(desc(topicsRun.finishedAt)),
  ])
  return {
    pipelineRuns: pipe.map((r) => {
      const syncErrors = new Map<string, string>()
      for (const e of (Array.isArray(r.errors) ? r.errors : []) as { phase?: string; sourceId?: string; message?: string }[]) {
        if (e?.phase === "sync" && e.sourceId && !syncErrors.has(e.sourceId)) syncErrors.set(e.sourceId, String(e.message ?? ""))
      }
      return { id: r.id, startedAt: r.startedAt, syncErrors }
    }),
    topicsRuns: topics.map((r) => ({
      id: r.id,
      finishedAt: r.finishedAt as Date,
      orgs: (r.orgs ?? []) as (RunOrgOutcomeLite & { orgId?: string })[],
    })),
  }
}

async function loadOrgCalendar(orgId: string): Promise<WorkCalendar> {
  const [params, days] = await Promise.all([loadAttentionParams(orgId), loadCalendarDays()])
  return new WorkCalendar(days, { timeZone: params.timeZone, workStart: params.workStart, workEnd: params.workEnd })
}

// ── Tasks (Q7) ─────────────────────────────────────────────────────────────

type TaskRow = {
  id: string
  name: string
  status: string
  dueDate: Date
  createdAt: Date
  assigneeId: string
  userId: string
}

async function notifyTaskReminders(orgId: string, t: TaskRow, cal: WorkCalendar, now: Date): Promise<number> {
  let n = 0
  for (const r of dueTaskReminders({ taskId: t.id, dueAt: t.dueDate, status: t.status, createdAt: t.createdAt }, cal, now)) {
    const text = taskReminderText(r.kind, { name: t.name, dueAt: t.dueDate }, cal)
    n += await notify(orgId, {
      kind: r.kind,
      userIds: r.kind === "task.overdue" ? [t.assigneeId, t.userId] : [t.assigneeId],
      title: text.title,
      body: text.body,
      href: `/tasks?openTask=${encodeURIComponent(t.id)}`,
      entity: { type: "task", id: t.id },
      dedupeKey: r.dedupeKey,
      payload: { taskId: t.id, dueDay: r.dueDay },
      at: now,
    })
  }
  return n
}

async function resolveAllTaskNotices(orgId: string, taskId: string): Promise<number> {
  let n = 0
  for (const p of taskReminderPrefixes(taskId)) n += await resolveNotifications(orgId, p, { prefix: true })
  return n
}

async function checkTasks(orgId: string, now: Date, cal: WorkCalendar): Promise<CheckCounts> {
  const cols = {
    id: task.id,
    name: task.name,
    status: task.status,
    dueDate: task.dueDate,
    createdAt: task.createdAt,
    assigneeId: task.assigneeId,
    userId: task.userId,
  }
  const [open, closed] = await Promise.all([
    db
      .select(cols)
      .from(task)
      .where(
        and(
          eq(task.organizationId, orgId),
          inArray(task.status, [...OPEN_TASK_STATUSES]),
          gte(task.dueDate, new Date(now.getTime() - TASK_WINDOW_DAYS * DAY_MS)),
          lte(task.dueDate, new Date(now.getTime() + TASK_WINDOW_DAYS * DAY_MS)),
        ),
      ),
    db
      .select({ id: task.id })
      .from(task)
      .where(
        and(
          eq(task.organizationId, orgId),
          notInArray(task.status, [...OPEN_TASK_STATUSES]),
          gte(task.updatedAt, new Date(now.getTime() - CLOSED_TASK_LOOKBACK_HOURS * HOUR_MS)),
          gte(task.dueDate, new Date(now.getTime() - (TASK_WINDOW_DAYS + 3) * DAY_MS)),
        ),
      ),
  ])
  let notified = 0
  let resolved = 0
  for (const t of open) notified += await notifyTaskReminders(orgId, t, cal, now)
  for (const t of closed) resolved += await resolveAllTaskNotices(orgId, t.id)
  return { notified, resolved }
}

/**
 * Hook for the task server code: call after a task was created or changed
 * (status, due date, assignee). A closed / deleted task resolves all its
 * notices; a moved due date resolves the notices of the OLD due day (pass
 * `previousDueDate`); then the rule runs at once for an open task (e.g. a
 * task created on its due day after 09:00 notifies now). Never throws.
 */
export async function onTaskChanged(
  orgId: string,
  taskId: string,
  opts: { previousDueDate?: Date | string | null } = {},
): Promise<void> {
  try {
    const now = new Date()
    const [t] = await db
      .select({
        id: task.id,
        name: task.name,
        status: task.status,
        dueDate: task.dueDate,
        createdAt: task.createdAt,
        assigneeId: task.assigneeId,
        userId: task.userId,
      })
      .from(task)
      .where(and(eq(task.id, taskId), eq(task.organizationId, orgId)))
      .limit(1)
    if (!t || !(OPEN_TASK_STATUSES as readonly string[]).includes(t.status)) {
      await resolveAllTaskNotices(orgId, taskId)
      return
    }
    const cal = await loadOrgCalendar(orgId)
    if (opts.previousDueDate) {
      const prev = new Date(opts.previousDueDate)
      if (!Number.isNaN(prev.getTime())) {
        const oldDay = cal.localDay(prev)
        if (oldDay !== cal.localDay(t.dueDate)) {
          for (const k of taskReminderKeys(taskId, oldDay)) await resolveNotifications(orgId, k)
        }
      }
    }
    await notifyTaskReminders(orgId, t, cal, now)
  } catch (err) {
    console.error("[notifications] onTaskChanged failed", orgId, taskId, err)
  }
}

// ── AI usage (Q3) ──────────────────────────────────────────────────────────

const AI_HREF = "/account?tab=ai-usage"

async function checkAiUsage(orgId: string, now: Date): Promise<CheckCounts> {
  let notified = 0
  let resolved = 0
  const month = utcMonthKey(now)
  // A new month: last month's steps are no longer current.
  resolved += await resolveNotifications(orgId, `ai.limit.month:${previousUtcMonthKey(now)}:`, { prefix: true })
  resolved += await resolveNotifications(orgId, `ai.budget.day:${utcDayKey(new Date(now.getTime() - DAY_MS))}`)

  const status = await getOrgBudgetStatus(orgId)
  const step = monthlyLimitStep(status.monthly.share)
  // Limit raised / back below a step within the month → the higher steps are not current.
  for (const s of [70, 90, 100] as const) {
    if (s > step) resolved += await resolveNotifications(orgId, aiMonthKey(month, s))
  }
  if (step !== 0) {
    // Only the highest step: 95 % at once sends 90, not 70 too. A step
    // already sent (any state) is never sent again in this month.
    const text = aiMonthlyLimitText(step, status.monthly.spentUsd, status.monthly.budgetUsd, now)
    notified += await notify(orgId, {
      kind: `ai.limit.month.${step}`,
      title: text.title,
      body: text.body,
      href: AI_HREF,
      dedupeKey: aiMonthKey(month, step),
      payload: { month, step, spentUsd: status.monthly.spentUsd, limitUsd: status.monthly.budgetUsd, share: status.monthly.share },
      at: now,
    })
  }
  if (status.dailyExceeded) {
    // The daily budget is GATEWAY cost — owners never see that number.
    notified += await notify(orgId, {
      kind: "ai.budget.day",
      title: "Дневной бюджет ИИ исчерпан",
      body: "Фоновые процессы ИИ приостановлены до 00:00 UTC. Интерактивные функции работают.",
      href: AI_HREF,
      dedupeKey: `ai.budget.day:${utcDayKey(now)}`,
      at: now,
    })
  }
  return { notified, resolved }
}

// ── Org profile (Q4) ───────────────────────────────────────────────────────

const ORG_PROFILE_HREF = "/account?tab=org-profile"

async function checkOrgProfile(orgId: string, now: Date, cal: WorkCalendar): Promise<CheckCounts> {
  const completeness = await getOrgCompleteness(orgId)
  if (completeness.complete) {
    return { notified: 0, resolved: await resolveNotifications(orgId, "profile.org.incomplete:", { prefix: true }) }
  }
  const mode = await getTopicsMode(orgId)
  const severe = mode === "shadow" || mode === "on"
  const missing = completeness.missing.map((m) => COMPLETENESS_LABELS_RU[m])
  const notified = await notify(orgId, {
    kind: "profile.org.incomplete",
    priority: severe ? "important" : "info",
    title: `Профиль организации заполнен на ${completeness.done} из ${completeness.total}`,
    body: `${severe ? "Без профиля ИИ не отличает внутреннюю переписку от внешней. " : ""}Не хватает: ${missing.join(", ")}.`,
    href: ORG_PROFILE_HREF,
    dedupeKey: orgProfilePeriodKey(cal, now),
    payload: { done: completeness.done, total: completeness.total, missing: completeness.missing },
    at: now,
  })
  return { notified, resolved: 0 }
}

// ── Client profile proposals ───────────────────────────────────────────────

async function checkClientProposals(orgId: string, now: Date, cal: WorkCalendar): Promise<CheckCounts> {
  const rows = await db
    .selectDistinct({ clientId: clientProfileProposal.clientId })
    .from(clientProfileProposal)
    .innerJoin(client, eq(client.id, clientProfileProposal.clientId))
    .where(
      and(
        eq(clientProfileProposal.organizationId, orgId),
        eq(clientProfileProposal.status, "pending"),
        notInArray(client.status, ["deleted", "blocked"]),
      ),
    )
  if (rows.length === 0) {
    return { notified: 0, resolved: await resolveNotifications(orgId, "profile.client.proposals:", { prefix: true }) }
  }
  const key = clientProposalsKey(cal, now)
  if (!key) return { notified: 0, resolved: 0 }
  const n = rows.length
  const notified = await notify(orgId, {
    kind: "profile.client.proposals",
    title: `Есть предложения для профилей ${n} ${companiesWord(n)}`,
    body: "Данные из интернета ждут проверки в «Профиле компании»: примите или отклоните их.",
    href: n === 1 ? `/clients?openClient=${encodeURIComponent(rows[0].clientId)}` : "/clients",
    dedupeKey: key,
    payload: { companies: n },
    at: now,
  })
  return { notified, resolved: 0 }
}

// ── Sources ────────────────────────────────────────────────────────────────

async function checkSources(orgId: string, now: Date, shared: SharedCheckData): Promise<CheckCounts> {
  const sources = await db
    .select({ id: source.id, name: source.name, lastSyncedAt: source.lastSyncedAt })
    .from(source)
    .where(
      and(
        eq(source.ownerOrganizationId, orgId),
        eq(source.status, "active"),
        eq(source.automatedParsingIsAllowed, true),
        inArray(source.provider, syncableProviders()),
      ),
    )
  const latest = shared.pipelineRuns[0] ?? null
  let notified = 0
  let resolved = 0
  for (const s of sources) {
    const latestError = latest?.syncErrors.get(s.id) ?? null
    let inRow = 0
    for (const r of shared.pipelineRuns) {
      if (!r.syncErrors.has(s.id)) break
      inRow++
    }
    const input = {
      lastSyncedAt: s.lastSyncedAt,
      latestRun: latest ? { id: latest.id, startedAt: latest.startedAt } : null,
      latestError,
      failedRunsInRow: inRow,
    }
    if (latest && latestError && sourceIsFailing(input, now)) {
      const text = sourceFailingText(s.name, { error: latestError, failedRunsInRow: inRow })
      notified += await notify(orgId, {
        kind: "source.sync_failing",
        title: text.title,
        body: text.body,
        href: "/sources",
        entity: { type: "source", id: s.id },
        dedupeKey: `source.sync_failing:${s.id}:${utcDayKey(latest.startedAt)}`,
        payload: { sourceId: s.id, runId: latest.id, failedRunsInRow: inRow },
        at: now,
      })
    } else if (!latestError || (s.lastSyncedAt && latest && s.lastSyncedAt >= latest.startedAt)) {
      // Recovered (a later successful sync, or the latest run had no error).
      resolved += await resolveNotifications(orgId, `source.sync_failing:${s.id}:`, { prefix: true })
    }
  }
  return { notified, resolved }
}

// ── Runs ───────────────────────────────────────────────────────────────────

async function checkRuns(orgId: string, now: Date, shared: SharedCheckData): Promise<CheckCounts> {
  let notified = 0
  let resolved = 0
  let newestSeen = false
  for (const run of shared.topicsRuns) {
    const outcome = run.orgs.find((o) => o.orgId === orgId)
    if (!outcome) continue
    const parts = failedRunParts(outcome)
    if (!newestSeen) {
      newestSeen = true
      // The org's newest finished run was clean → earlier failures are not current.
      if (parts.length === 0) resolved += await resolveNotifications(orgId, "process.run_failed:", { prefix: true })
    }
    if (parts.length === 0) continue
    const text = runFailedText(parts)
    notified += await notify(orgId, {
      kind: "process.run_failed",
      title: text.title,
      body: text.body,
      dedupeKey: `process.run_failed:${run.id}`,
      payload: { runId: run.id, parts },
      at: now,
    })
  }
  return { notified, resolved }
}

// ── Entry points ───────────────────────────────────────────────────────────

/**
 * All condition checks of one org. Each check is isolated (its error is
 * returned in its counts). `shared` = data of the cron run (loaded once for
 * all orgs); omitted → loaded here.
 */
export async function runNotificationChecks(
  orgId: string,
  now: Date = new Date(),
  shared?: SharedCheckData,
): Promise<NotificationChecksResult> {
  const out: NotificationChecksResult = {}
  let cal: WorkCalendar | null = null
  let data: SharedCheckData | null = shared ?? null
  const steps: [CheckName, () => Promise<CheckCounts>][] = [
    ["tasks", async () => checkTasks(orgId, now, (cal ??= await loadOrgCalendar(orgId)))],
    ["aiUsage", () => checkAiUsage(orgId, now)],
    ["orgProfile", async () => checkOrgProfile(orgId, now, (cal ??= await loadOrgCalendar(orgId)))],
    ["clientProposals", async () => checkClientProposals(orgId, now, (cal ??= await loadOrgCalendar(orgId)))],
    ["sources", async () => checkSources(orgId, now, (data ??= await loadSharedCheckData(now)))],
    ["runs", async () => checkRuns(orgId, now, (data ??= await loadSharedCheckData(now)))],
  ]
  for (const [name, run] of steps) {
    try {
      out[name] = await run()
    } catch (err) {
      console.error(`[notifications] check ${name} failed`, orgId, err)
      out[name] = { notified: 0, resolved: 0, error: message(err) }
    }
  }
  return out
}

export type NotificationCronResult = {
  orgs: number
  failedOrgs: number
  notified: number
  resolved: number
  checkErrors: number
  /** Telegram copies of important notifications sent by this run. */
  telegramSent: number
  purged: number | null
  durationMs: number
}

/**
 * The hourly job (/api/cron/notifications): every organization, one after
 * another, each isolated; then the retention purge (cheap, every run).
 */
export async function runAllNotificationChecks(now: Date = new Date()): Promise<NotificationCronResult> {
  const t0 = Date.now()
  const result: NotificationCronResult = { orgs: 0, failedOrgs: 0, notified: 0, resolved: 0, checkErrors: 0, telegramSent: 0, purged: null, durationMs: 0 }
  const orgs = await db.select({ id: organization.id }).from(organization)
  let shared: SharedCheckData | undefined
  try {
    shared = await loadSharedCheckData(now)
  } catch (err) {
    console.error("[notifications] shared check data failed", err)
  }
  for (const o of orgs) {
    result.orgs++
    try {
      const r = await runNotificationChecks(o.id, now, shared)
      for (const c of Object.values(r)) {
        if (!c) continue
        result.notified += c.notified
        result.resolved += c.resolved
        if (c.error) result.checkErrors++
      }
    } catch (err) {
      result.failedOrgs++
      console.error("[notifications] org checks failed", o.id, err)
    }
  }
  // Telegram copies of important notifications made outside working hours
  // (docs/specs/telegram/04 Q21): sent now when the org is working.
  try {
    const { deliverNotificationsToTelegram, orgsWithPendingTelegramCopies } = await import("@/server/telegram/delivery")
    for (const orgId of await orgsWithPendingTelegramCopies(now)) result.telegramSent += await deliverNotificationsToTelegram(orgId, { now })
  } catch (err) {
    console.error("[notifications] telegram copies failed", err)
  }
  try {
    result.purged = await purgeExpiredNotifications(now)
  } catch (err) {
    console.error("[notifications] purge failed", err)
  }
  result.durationMs = Date.now() - t0
  return result
}

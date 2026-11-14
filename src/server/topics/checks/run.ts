import "server-only"

import { randomUUID } from "node:crypto"
import { and, desc, eq } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { topicCheckRun } from "@/db/schema"
import { WorkCalendar } from "@/lib/topics/attention-calendar"
import {
  CHECKS,
  CHECKS_NOT_BUILT,
  type CheckDef,
  type CheckKey,
  type CheckPreviewRow,
  type CheckRunView,
  type ChecksOrgView,
  type ChecksParams,
  type ChecksSwitch,
  mergeChecksParams,
} from "@/lib/topics/checks"
import { getOrgSetting, setOrgSetting } from "@/server/org-settings"
import { getPlatformSetting } from "@/server/platform-settings"
import { getEffectiveSignals } from "@/server/signals/registry"
import { loadAttentionParams, loadCalendarDays } from "../attention/store"
import { getTopicsMode, listOrgTopicsModes, type TopicsMode } from "../mode"
import { reconcileOrderTopics } from "../orders-link"
import { ensureSystemActor } from "../system-actor"
import { heldProductIds, priceChangeHeld } from "./crm-data"
import { CRM_DATA_CHECKS, refreshProductWatchState } from "./crm-data-loaders"
import { ORDER_CHECKS } from "./orders-data"
import { applyCheckResult, countOpenProcessInstances, loadExistingInstances, loadStoreContext, type StoreContext } from "./store"
import { duePeriodKey } from "./schedule"
import type { CheckContext, CheckEvaluator } from "./types"
import { WATCHDOG_CHECKS } from "./watchdogs-data"

// Runner of topics plan phase 8 (CRM checks + watchdogs): schedule, run log
// (`topic_check_run`), the hourly phase, the admin preview (dry run) and the
// manual run. The pure checks live in ./orders.ts, ./crm-data.ts and
// ./watchdogs.ts, their loaders in ./orders-data.ts / ./crm-data-loaders.ts /
// ./watchdogs-data.ts, the writes in ./store.ts (+ `refreshProductWatchState`
// after a catalogue check).

const EVALUATORS: Partial<Record<CheckKey, CheckEvaluator>> = { ...ORDER_CHECKS, ...CRM_DATA_CHECKS, ...WATCHDOG_CHECKS }

/** Catalogue checks: after the store applied one, its part of `product_watch_state` is refreshed. */
const WATCH_STATE_PART: Partial<Record<CheckKey, "price" | "status">> = { price_change: "price", product_status: "status" }

// ── Parameters + calendar ─────────────────────────────────────────────────

export async function loadChecksParams(orgId: string): Promise<ChecksParams> {
  const [platform, org] = await Promise.all([getPlatformSetting("checks.params"), getOrgSetting(orgId, "checks.params")])
  return mergeChecksParams(platform, org)
}

async function loadOrgCalendar(orgId: string): Promise<WorkCalendar> {
  const [ap, days] = await Promise.all([loadAttentionParams(orgId), loadCalendarDays()])
  return new WorkCalendar(days, { timeZone: ap.timeZone, workStart: ap.workStart, workEnd: ap.workEnd })
}

// ── One check ─────────────────────────────────────────────────────────────

export type CheckRunOutcome = {
  key: CheckKey
  status: "ok" | "failed" | "skipped"
  counts: Record<string, number>
  error: string | null
}

async function buildCheckContext(orgId: string, def: CheckDef, now: Date, params: ChecksParams, calendar: WorkCalendar): Promise<CheckContext> {
  return { orgId, now, params, calendar, existing: await loadExistingInstances(orgId, def.codes, now) }
}

/** Evaluate + write one check, logged in `topic_check_run` (row already claimed). */
async function runOneCheck(
  sc: StoreContext,
  def: CheckDef,
  params: ChecksParams,
  calendar: WorkCalendar,
  runRowId: string,
): Promise<CheckRunOutcome & { topicIds: string[] }> {
  const evaluator = EVALUATORS[def.key]
  const finish = async (status: CheckRunOutcome["status"], counts: Record<string, number>, error: string | null) => {
    await db
      .update(topicCheckRun)
      .set({ status, counts, error, finishedAt: new Date() })
      .where(eq(topicCheckRun.id, runRowId))
  }
  if (!evaluator) {
    await finish("skipped", {}, "no evaluator")
    return { key: def.key, status: "skipped", counts: {}, error: "no evaluator", topicIds: [] }
  }
  try {
    const ctx = await buildCheckContext(sc.orgId, def, sc.now, params, calendar)
    const result = await evaluator(ctx)
    const out = await applyCheckResult(sc, def, result, ctx.existing, params.maxNewPerCheckPerRun)
    const counts: Record<string, number> = { evaluated: result.evaluated, ...out.counts }
    for (const [k, v] of Object.entries(result.skipped)) counts[`skip_${k}`] = v
    for (const [k, v] of Object.entries(out.skipped)) counts[`skip_${k}`] = (counts[`skip_${k}`] ?? 0) + (v ?? 0)
    const error = out.errors.length ? out.errors.slice(0, 5).join("; ") : null
    const status = out.counts.failed > 0 && out.counts.created + out.counts.attached + out.counts.cleared === 0 ? "failed" : "ok"
    const part = WATCH_STATE_PART[def.key]
    if (part && status === "ok") {
      // Findings the store did not write (deferred / failed) keep their old state → found again next run.
      const w =
        part === "price"
          ? priceChangeHeld(out.pending)
            ? null
            : await refreshProductWatchState(sc.orgId, sc.now, { price: true })
          : await refreshProductWatchState(sc.orgId, sc.now, { status: true, hold: heldProductIds(out.pending) })
      if (!w) counts.watch_price_held = 1
      for (const [k, v] of Object.entries(w ?? {})) if (v) counts[`watch_${k}`] = v
    }
    await finish(status, counts, error)
    return { key: def.key, status, counts, error, topicIds: out.topicIds }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[topics/checks]", sc.orgId, def.key, e)
    await finish("failed", {}, msg.slice(0, 1000))
    return { key: def.key, status: "failed", counts: {}, error: msg, topicIds: [] }
  }
}

/** Claim a run row. A scheduled period already claimed (not failed) → null. */
async function claimRun(orgId: string, key: CheckKey, periodKey: string, trigger: "schedule" | "manual"): Promise<string | null> {
  const id = randomUUID()
  const rows = await db
    .insert(topicCheckRun)
    .values({ id, organizationId: orgId, checkKey: key, periodKey, trigger, status: "running" })
    .onConflictDoNothing()
    .returning({ id: topicCheckRun.id })
  return rows.length ? id : null
}

// ── Hourly phase ──────────────────────────────────────────────────────────

/**
 * The checks of one org that are due now, in the groups switched on by
 * `topics.checks`. Runs each one, returns summed counts.
 */
export async function runDueChecks(
  orgId: string,
  opts: { runId: string; actorUserId: string; now?: Date },
): Promise<Record<string, number> | { skipped: string }> {
  // Topics phase 10: orders ↔ ORDER_CONFIRMED safety net, independent of `topics.checks`.
  const ol = await reconcileOrderTopics(orgId, { now: opts.now, actorUserId: opts.actorUserId }).catch((e) => {
    console.error("[topics/checks] orders link reconcile failed", orgId, e)
    return { checked: 0, written: 0, cleared: 0, failed: 1 }
  })
  const olCounts = { ordersLinked: ol.written, ordersLinkedCleared: ol.cleared, ordersLinkedFailed: ol.failed }
  const sw = await getOrgSetting(orgId, "topics.checks")
  if (!sw.orders && !sw.watchdogs) {
    return ol.written + ol.cleared + ol.failed > 0 ? { checksOff: 1, ...olCounts } : { skipped: "checks off (topics.checks)" }
  }
  const now = opts.now ?? new Date()
  const [params, calendar, sc] = await Promise.all([
    loadChecksParams(orgId),
    loadOrgCalendar(orgId),
    loadStoreContext(orgId, now, opts.actorUserId),
  ])
  const totals: Record<string, number> = { checks: 0, failed: 0, ...olCounts }
  for (const def of CHECKS) {
    if (def.group === "orders" ? !sw.orders : !sw.watchdogs) continue
    const period = duePeriodKey(def.schedule, now, calendar, params, opts.runId)
    if (!period) continue
    const rowId = await claimRun(orgId, def.key, period, "schedule")
    if (!rowId) continue
    const r = await runOneCheck(sc, def, params, calendar, rowId)
    totals.checks++
    if (r.status === "failed") totals.failed++
    for (const k of ["created", "attached", "reopened", "refreshed", "cleared", "deferred"]) {
      totals[k] = (totals[k] ?? 0) + (r.counts[k] ?? 0)
    }
  }
  return totals
}

// ── Manual run + preview (admin) ──────────────────────────────────────────

export class ChecksRunError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ChecksRunError"
  }
}

function pick(keys?: readonly CheckKey[]): CheckDef[] {
  return keys?.length ? CHECKS.filter((c) => keys.includes(c.key)) : [...CHECKS]
}

/**
 * Manual run («Запустить сейчас»): runs the chosen checks NOW and writes the
 * result, also when the org switch is off (operator intent). Refused when the
 * topics mode is `off`. Attention of the touched topics is recomputed at once;
 * cards follow in the next hourly run.
 */
export async function runChecksNow(orgId: string, keys: CheckKey[] | undefined, requestedByUserId: string): Promise<CheckRunOutcome[]> {
  const mode = await getTopicsMode(orgId)
  if (mode === "off") throw new ChecksRunError("Движок тем выключен для организации — проверки не запускаются")
  console.info("[topics/checks] manual run", orgId, keys ?? "all", "by", requestedByUserId)
  const now = new Date()
  const actor = await ensureSystemActor(orgId)
  const [params, calendar, sc] = await Promise.all([loadChecksParams(orgId), loadOrgCalendar(orgId), loadStoreContext(orgId, now, actor)])
  const out: CheckRunOutcome[] = []
  const touched = new Set<string>()
  for (const def of pick(keys)) {
    const rowId = await claimRun(orgId, def.key, `manual:${now.toISOString()}`, "manual")
    if (!rowId) continue
    const r = await runOneCheck(sc, def, params, calendar, rowId)
    r.topicIds.forEach((id) => touched.add(id))
    out.push({ key: r.key, status: r.status, counts: r.counts, error: r.error })
  }
  if (touched.size) {
    try {
      const { recomputeTopicsAttention } = await import("../attention/store")
      await recomputeTopicsAttention(orgId, [...touched], now)
    } catch (e) {
      console.error("[topics/checks] attention after manual run failed", e)
    }
  }
  return out
}

export type CheckPreview = {
  key: CheckKey
  rows: CheckPreviewRow[]
  evaluated: number
  skipped: Record<string, number>
  clears: { instanceId: string; reasonRu: string }[]
  error: string | null
}

/** Dry run («Проверить без записи»): the evaluators only, nothing is written. */
export async function previewChecks(orgId: string, keys?: CheckKey[]): Promise<CheckPreview[]> {
  const now = new Date()
  const [params, calendar, effective] = await Promise.all([loadChecksParams(orgId), loadOrgCalendar(orgId), getEffectiveSignals(orgId)])
  const weights = new Map(effective.filter((e) => e.active).map((e) => [e.code, e.weight]))
  const out: CheckPreview[] = []
  for (const def of pick(keys)) {
    const evaluator = EVALUATORS[def.key]
    if (!evaluator) {
      out.push({ key: def.key, rows: [], evaluated: 0, skipped: {}, clears: [], error: "no evaluator" })
      continue
    }
    try {
      const ctx = await buildCheckContext(orgId, def, now, params, calendar)
      const r = await evaluator(ctx)
      const keysSeen = new Set(ctx.existing.map((e) => `${e.code}\u0000${e.conditionKey}`))
      const skipped = { ...r.skipped }
      const rows: CheckPreviewRow[] = []
      for (const f of r.findings) {
        const w = weights.get(f.code)
        if (w === undefined) {
          skipped.code_inactive = (skipped.code_inactive ?? 0) + 1
          continue
        }
        rows.push({
          code: f.code,
          conditionKey: f.conditionKey,
          companyName: f.companyName,
          matterRu: f.matterRu,
          evidenceRu: f.evidenceRu,
          score: Math.max(0, f.score ?? w),
          topicId: f.topicId,
          exists: keysSeen.has(`${f.code}\u0000${f.conditionKey}`),
        })
      }
      out.push({ key: def.key, rows, evaluated: r.evaluated, skipped, clears: r.clears, error: null })
    } catch (e) {
      out.push({ key: def.key, rows: [], evaluated: 0, skipped: {}, clears: [], error: e instanceof Error ? e.message : String(e) })
    }
  }
  return out
}

// ── Admin view ────────────────────────────────────────────────────────────

function runView(r: typeof topicCheckRun.$inferSelect): CheckRunView {
  return {
    id: r.id,
    checkKey: r.checkKey as CheckKey,
    periodKey: r.periodKey,
    trigger: r.trigger as CheckRunView["trigger"],
    status: r.status as CheckRunView["status"],
    counts: r.counts ?? {},
    error: r.error,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
  }
}

export async function listChecksOrgs(): Promise<{ organizationId: string; name: string; mode: TopicsMode; switch: ChecksSwitch }[]> {
  const orgs = await listOrgTopicsModes()
  return Promise.all(
    orgs.map(async (o) => ({
      organizationId: o.organizationId,
      name: o.name,
      mode: o.mode,
      switch: await getOrgSetting(o.organizationId, "topics.checks"),
    })),
  )
}

export async function getChecksView(orgId: string): Promise<ChecksOrgView> {
  const [sw, params, runs, open] = await Promise.all([
    getOrgSetting(orgId, "topics.checks"),
    loadChecksParams(orgId),
    db
      .select()
      .from(topicCheckRun)
      .where(eq(topicCheckRun.organizationId, orgId))
      .orderBy(desc(topicCheckRun.startedAt))
      .limit(200),
    countOpenProcessInstances(orgId),
  ])
  const views = runs.map(runView)
  return {
    organizationId: orgId,
    switch: sw,
    params,
    checks: CHECKS.map((c) => ({
      ...c,
      lastRun: views.find((v) => v.checkKey === c.key) ?? null,
      openInstances: c.codes.reduce((n, code) => n + (open.get(code) ?? 0), 0),
    })),
    notBuilt: CHECKS_NOT_BUILT,
    runs: views.slice(0, 20),
  }
}

export async function setChecksSwitch(orgId: string, value: ChecksSwitch, userId: string): Promise<ChecksSwitch> {
  return setOrgSetting(orgId, "topics.checks", value, userId)
}

/** Last runs of one check (debug / tests). */
export async function listCheckRuns(orgId: string, key: CheckKey, limit = 10): Promise<CheckRunView[]> {
  const rows = await db
    .select()
    .from(topicCheckRun)
    .where(and(eq(topicCheckRun.organizationId, orgId), eq(topicCheckRun.checkKey, key)))
    .orderBy(desc(topicCheckRun.startedAt))
    .limit(limit)
  return rows.map(runView)
}

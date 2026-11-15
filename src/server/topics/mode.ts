import "server-only"

import { randomUUID } from "node:crypto"
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { organization, orgSetting, orgSettingLog } from "@/db/schema"
import type { Completeness, CompletenessItem } from "@/lib/identity/org-profile"
import { decideTopicsModeChange, type TopicsModeGateDecision } from "@/lib/identity/topics-gate"
import { getOrgCompleteness } from "@/server/identity/own-org"
import {
  getOrgSetting,
  listOrgSettingLog,
  listOrgsWithSetting,
  setOrgSetting,
  type OrgSettingValue,
} from "@/server/org-settings"

// Topics engine mode per org (spec 01 §12): the `topics.enabled` key of
// `org_setting`. off = nothing runs; shadow = the engine runs and stores
// data, the UI hides it; on = visible to the org. Org-explicit, cron-safe.

export type TopicsMode = OrgSettingValue<"topics.enabled">

export const TOPICS_MODES: readonly TopicsMode[] = ["off", "shadow", "on"]

export function isTopicsMode(v: unknown): v is TopicsMode {
  return typeof v === "string" && (TOPICS_MODES as readonly string[]).includes(v)
}

/** Current mode of one org (default `off`; cached ≤ 60 s by org-settings). */
export async function getTopicsMode(organizationId: string): Promise<TopicsMode> {
  return getOrgSetting(organizationId, "topics.enabled")
}

export type TopicsEnabledOrg = {
  organizationId: string
  name: string
  mode: Exclude<TopicsMode, "off">
}

/** Orgs the hourly pipeline must process: mode `shadow` or `on`, by name. */
export async function listTopicsEnabledOrgs(): Promise<TopicsEnabledOrg[]> {
  const rows = (await listOrgsWithSetting("topics.enabled")).filter(
    (r): r is { organizationId: string; value: Exclude<TopicsMode, "off"> } =>
      r.value !== "off",
  )
  if (rows.length === 0) return []
  const orgs = await db
    .select({ id: organization.id, name: organization.name })
    .from(organization)
    .where(inArray(organization.id, rows.map((r) => r.organizationId)))
  const names = new Map(orgs.map((o) => [o.id, o.name]))
  return rows
    // org_setting cascades on org delete; the guard only covers a race.
    .filter((r) => names.has(r.organizationId))
    .map((r) => ({
      organizationId: r.organizationId,
      name: names.get(r.organizationId) ?? r.organizationId,
      mode: r.value,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"))
}

export type TopicsModeChange = {
  at: Date
  by: string | null
  from: TopicsMode | null
  to: TopicsMode | null
}

export type OrgTopicsModeRow = {
  organizationId: string
  name: string
  slug: string | null
  mode: TopicsMode
  lastChange: TopicsModeChange | null
  /** Identity profile minimum (identity spec §3.3): «N из 6» + missing items. */
  profile: { done: number; total: number; complete: boolean; missing: CompletenessItem[] }
  /** Identity I4 «Профиль в промптах» (`identity.promptContext`, default off). */
  promptContext: boolean
}

function asMode(v: unknown): TopicsMode | null {
  return isTopicsMode(v) ? v : null
}

/** Every org with its topics mode and the last change (admin «Темы» tab). */
export async function listOrgTopicsModes(): Promise<OrgTopicsModeRow[]> {
  const [orgs, stored, promptStored] = await Promise.all([
    db
      .select({ id: organization.id, name: organization.name, slug: organization.slug })
      .from(organization)
      .orderBy(asc(organization.name)),
    listOrgsWithSetting("topics.enabled"),
    listOrgsWithSetting("identity.promptContext"),
  ])
  const modes = new Map(stored.map((s) => [s.organizationId, s.value]))
  const promptContext = new Map(promptStored.map((s) => [s.organizationId, s.value]))
  return Promise.all(
    orgs.map(async (o) => {
      const [[last], completeness] = await Promise.all([
        listOrgSettingLog(o.id, "topics.enabled", 1),
        getOrgCompleteness(o.id),
      ])
      return {
        organizationId: o.id,
        name: o.name,
        slug: o.slug ?? null,
        mode: modes.get(o.id) ?? "off",
        lastChange: last
          ? {
              at: last.changedAt,
              by: last.changedBy ?? null,
              from: asMode(last.oldValue),
              to: asMode(last.newValue),
            }
          : null,
        profile: profileSummary(completeness),
        promptContext: promptContext.get(o.id) ?? false,
      }
    }),
  )
}

/**
 * Identity I4 «Профиль в промптах»: put the org profile into the topics
 * prompts of one org (platform admin; logged in `org_setting_log` like every
 * org setting). Switch on only after the golden-set eval shows no drop.
 */
export async function setOrgPromptContext(organizationId: string, enabled: boolean, userId: string): Promise<boolean> {
  return setOrgSetting(organizationId, "identity.promptContext", enabled, userId)
}

function profileSummary(c: Completeness): OrgTopicsModeRow["profile"] {
  return { done: c.done, total: c.total, complete: c.complete, missing: c.missing }
}

// ── Gate (identity spec I3, §3.3, decision Q4) ────────────────────────────

/** Key of the override rows in `org_setting_log` (next to `topics.enabled`). */
export const TOPICS_MODE_OVERRIDE_LOG_KEY = "topics.enabled.override"

export type SetTopicsModeResult =
  | { ok: true; mode: TopicsMode; overridden: boolean }
  | Extract<TopicsModeGateDecision, { ok: false }>

/**
 * Change an org's topics mode through the identity gate: `shadow` / `on`
 * need the profile minimum, unless a platform admin gives an override reason
 * (≥ 10 chars). An override is logged in `org_setting_log` under
 * `topics.enabled.override` ({ from, to, reason, missing }) next to the mode
 * change row. Switching to `off` and re-saving the same mode always pass.
 * The CALLER checks that the user is a platform admin.
 */
export async function setTopicsModeGated(
  organizationId: string,
  mode: TopicsMode,
  userId: string,
  override?: { reason?: unknown } | null,
): Promise<SetTopicsModeResult> {
  // Fresh read (not the 60 s settings cache): «same mode» skips the gate.
  const [stored] = await db
    .select({ value: orgSetting.value })
    .from(orgSetting)
    .where(and(eq(orgSetting.organizationId, organizationId), eq(orgSetting.key, "topics.enabled")))
  const from: TopicsMode = asMode(stored?.value) ?? "off"
  const needsProfile = mode !== "off" && mode !== from
  const completeness = needsProfile
    ? await getOrgCompleteness(organizationId)
    : { done: 0, total: 0, complete: true, missing: [] }
  const decision = decideTopicsModeChange({ from, to: mode, completeness, override })
  if (!decision.ok) return decision
  const saved = await setOrgSetting(organizationId, "topics.enabled", mode, userId)
  if (decision.overridden) {
    await db.insert(orgSettingLog).values({
      id: randomUUID(),
      organizationId,
      key: TOPICS_MODE_OVERRIDE_LOG_KEY,
      oldValue: from,
      newValue: { from, to: mode, reason: decision.reason, missing: completeness.missing },
      changedByUserId: userId,
    })
  }
  return { ok: true, mode: saved, overridden: decision.overridden }
}

/** Last change of one org's mode (for the PUT response). */
export async function getLastTopicsModeChange(
  organizationId: string,
): Promise<TopicsModeChange | null> {
  const [last] = await listOrgSettingLog(organizationId, "topics.enabled", 1)
  if (!last) return null
  return {
    at: last.changedAt,
    by: last.changedBy ?? null,
    from: asMode(last.oldValue),
    to: asMode(last.newValue),
  }
}

/** True when the org exists (PUT validation). */
export async function organizationExists(organizationId: string): Promise<boolean> {
  const rows = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1)
  return rows.length > 0
}

/**
 * Start of the org's CURRENT enabled period: the latest switch of
 * `topics.enabled` from off (or unset) to shadow / on in the change log;
 * shadow ↔ on keeps the period. Fallback: the stored setting's update time.
 * Null when the org is off. The engine processes items from 7 days before
 * this moment (spec §13 Q16); a re-enable after `off` starts a new window.
 */
export async function getTopicsStartedAt(organizationId: string): Promise<Date | null> {
  const [last] = await db
    .select({ at: orgSettingLog.changedAt })
    .from(orgSettingLog)
    .where(
      and(
        eq(orgSettingLog.organizationId, organizationId),
        eq(orgSettingLog.key, "topics.enabled"),
        sql`${orgSettingLog.newValue} #>> '{}' in ('shadow', 'on')`,
        sql`coalesce(${orgSettingLog.oldValue} #>> '{}', 'off') not in ('shadow', 'on')`,
      ),
    )
    .orderBy(desc(orgSettingLog.changedAt))
    .limit(1)
  const [row] = await db
    .select({ at: orgSetting.updatedAt, value: orgSetting.value })
    .from(orgSetting)
    .where(and(eq(orgSetting.organizationId, organizationId), eq(orgSetting.key, "topics.enabled")))
  if (!row || (row.value !== "shadow" && row.value !== "on")) return null
  return last?.at ?? row.at
}

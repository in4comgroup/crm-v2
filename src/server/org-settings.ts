import "server-only"

import { randomUUID } from "node:crypto"
import { and, desc, eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db/drizzle"
import { orgSetting, orgSettingLog, user } from "@/db/schema"

// Per-organization settings (table `org_setting`), the per-org twin of
// src/server/platform-settings.ts. Every key is declared here with a zod
// schema and a default; a missing row = the default. No session logic:
// callers check access (platform admin routes, or engine code that already
// knows the org). Spec: docs/specs/topics/03-development-plan.md § Phase 0.

export const ORG_SETTINGS = {
  // Topics engine mode (spec 01 §12): off = nothing runs; shadow = the
  // engine writes data, users see nothing; on = visible to the org.
  "topics.enabled": {
    schema: z.enum(["off", "shadow", "on"]),
    default: "off" as "off" | "shadow" | "on",
  },
  // Per-org override of the daily AI budget in USD (null = platform
  // default `ai.budget.daily_usd`). docs/specs/models/07-budget.md.
  "ai.budget.daily_usd": {
    schema: z.number().min(0).max(100_000).nullable(),
    default: null as number | null,
  },
} as const

export type OrgSettingKey = keyof typeof ORG_SETTINGS
export type OrgSettingValue<K extends OrgSettingKey> = z.infer<(typeof ORG_SETTINGS)[K]["schema"]>

const CACHE_TTL_MS = 60_000
const cache = new Map<string, { at: number; values: Map<string, unknown> }>()

async function loadOrg(orgId: string): Promise<Map<string, unknown>> {
  const hit = cache.get(orgId)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.values
  const rows = await db
    .select({ key: orgSetting.key, value: orgSetting.value })
    .from(orgSetting)
    .where(eq(orgSetting.organizationId, orgId))
  const values = new Map(rows.map((r) => [r.key, r.value]))
  cache.set(orgId, { at: Date.now(), values })
  return values
}

/** Current value for one org (cached up to 60 s per server instance). */
export async function getOrgSetting<K extends OrgSettingKey>(
  orgId: string,
  key: K,
): Promise<OrgSettingValue<K>> {
  const def = ORG_SETTINGS[key]
  const raw = (await loadOrg(orgId)).get(key)
  if (raw === undefined) return def.default as OrgSettingValue<K>
  const parsed = def.schema.safeParse(raw)
  return (parsed.success ? parsed.data : def.default) as OrgSettingValue<K>
}

/** Every org that has a stored value for `key` (e.g. topics.enabled ≠ default). */
export async function listOrgsWithSetting<K extends OrgSettingKey>(
  key: K,
): Promise<{ organizationId: string; value: OrgSettingValue<K> }[]> {
  const rows = await db
    .select({ organizationId: orgSetting.organizationId, value: orgSetting.value })
    .from(orgSetting)
    .where(eq(orgSetting.key, key))
  const out: { organizationId: string; value: OrgSettingValue<K> }[] = []
  for (const r of rows) {
    const parsed = ORG_SETTINGS[key].schema.safeParse(r.value)
    if (parsed.success) out.push({ organizationId: r.organizationId, value: parsed.data as OrgSettingValue<K> })
  }
  return out
}

export class OrgSettingValidationError extends Error {}

export async function setOrgSetting<K extends OrgSettingKey>(
  orgId: string,
  key: K,
  value: unknown,
  userId: string,
): Promise<OrgSettingValue<K>> {
  const parsed = ORG_SETTINGS[key].schema.safeParse(value)
  if (!parsed.success) {
    throw new OrgSettingValidationError(`${key}: ${parsed.error.issues[0]?.message ?? "invalid value"}`)
  }
  const where = and(eq(orgSetting.organizationId, orgId), eq(orgSetting.key, key))
  const [before] = await db.select({ value: orgSetting.value }).from(orgSetting).where(where)
  if (before && JSON.stringify(before.value) === JSON.stringify(parsed.data)) {
    return parsed.data as OrgSettingValue<K>
  }
  await db
    .insert(orgSetting)
    .values({ organizationId: orgId, key, value: parsed.data, updatedByUserId: userId })
    .onConflictDoUpdate({
      target: [orgSetting.organizationId, orgSetting.key],
      set: { value: parsed.data, updatedByUserId: userId, updatedAt: new Date() },
    })
  await db.insert(orgSettingLog).values({
    id: randomUUID(),
    organizationId: orgId,
    key,
    oldValue: before?.value ?? null,
    newValue: parsed.data,
    changedByUserId: userId,
  })
  cache.delete(orgId)
  return parsed.data as OrgSettingValue<K>
}

/** Recent changes of one key for one org, newest first, with the changer's name. */
export async function listOrgSettingLog(orgId: string, key: OrgSettingKey, limit = 10) {
  return db
    .select({
      id: orgSettingLog.id,
      oldValue: orgSettingLog.oldValue,
      newValue: orgSettingLog.newValue,
      changedAt: orgSettingLog.changedAt,
      changedBy: user.name,
    })
    .from(orgSettingLog)
    .leftJoin(user, eq(user.id, orgSettingLog.changedByUserId))
    .where(and(eq(orgSettingLog.organizationId, orgId), eq(orgSettingLog.key, key)))
    .orderBy(desc(orgSettingLog.changedAt))
    .limit(limit)
}

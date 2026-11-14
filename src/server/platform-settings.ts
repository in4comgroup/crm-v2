import "server-only"

import { randomUUID } from "node:crypto"
import { desc, eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db/drizzle"
import { platformSetting, platformSettingLog, user } from "@/db/schema"
import { attentionParamsOverrideSchema, type AttentionParamsOverride } from "@/lib/topics/attention-params"

// Platform-wide settings (table `platform_setting`). Every key is declared
// here with a zod schema and a default; a missing row means the default.
// No session logic: callers (admin routes) check access.
// Spec: docs/specs/models/05-markup-and-end-user-cost.md §2.

export const PLATFORM_SETTINGS = {
  // Default daily AI budget per organization, USD of gateway cost per UTC
  // day (docs/specs/models/07-daily-budget.md). Per-org override:
  // org_setting `ai.budget.daily_usd`.
  "ai.budget.daily_usd": {
    schema: z.number().min(0).max(100_000),
    default: 5,
  },
  // Markup % on top of AI gateway cost, shown to end users (05 §3).
  "ai.markup_percent": {
    schema: z.number().min(0).max(1000),
    default: 0,
  },
  // AI model policy (03 §7): route only to zero-data-retention providers.
  "ai.policy.zdr_only": { schema: z.boolean(), default: false },
  // AI model policy: route only to providers that do not train on prompts.
  "ai.policy.no_training_only": { schema: z.boolean(), default: false },
  // AI model policy: allowed model vendors; empty = all.
  "ai.policy.allowed_vendors": {
    schema: z.array(z.string().min(1)).max(100),
    default: [] as string[],
  },
  // Topics attention engine parameters (docs/specs/topics/06 §13): a PARTIAL
  // override of the code defaults in src/lib/topics/attention-params.ts
  // (null = defaults). Per-org override: org_setting `attention.params`.
  "attention.params": {
    schema: attentionParamsOverrideSchema.nullable(),
    default: null as AttentionParamsOverride | null,
  },
} as const

export type PlatformSettingKey = keyof typeof PLATFORM_SETTINGS
export type PlatformSettingValue<K extends PlatformSettingKey> = z.infer<
  (typeof PLATFORM_SETTINGS)[K]["schema"]
>

const CACHE_TTL_MS = 60_000
let cache: { at: number; values: Map<string, unknown> } | null = null

async function loadAll(): Promise<Map<string, unknown>> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.values
  const rows = await db.select({ key: platformSetting.key, value: platformSetting.value }).from(platformSetting)
  cache = { at: Date.now(), values: new Map(rows.map((r) => [r.key, r.value])) }
  return cache.values
}

/**
 * Current value (cached up to 60 s per server instance). A stored value that
 * no longer passes its schema falls back to the default.
 */
export async function getPlatformSetting<K extends PlatformSettingKey>(
  key: K,
): Promise<PlatformSettingValue<K>> {
  const def = PLATFORM_SETTINGS[key]
  const raw = (await loadAll()).get(key)
  if (raw === undefined) return def.default as PlatformSettingValue<K>
  const parsed = def.schema.safeParse(raw)
  return (parsed.success ? parsed.data : def.default) as PlatformSettingValue<K>
}

export class PlatformSettingValidationError extends Error {}

export async function setPlatformSetting<K extends PlatformSettingKey>(
  key: K,
  value: unknown,
  userId: string,
): Promise<PlatformSettingValue<K>> {
  const parsed = PLATFORM_SETTINGS[key].schema.safeParse(value)
  if (!parsed.success) {
    throw new PlatformSettingValidationError(`${key}: ${parsed.error.issues[0]?.message ?? "invalid value"}`)
  }
  const [before] = await db
    .select({ value: platformSetting.value })
    .from(platformSetting)
    .where(eq(platformSetting.key, key))
  if (before && JSON.stringify(before.value) === JSON.stringify(parsed.data)) {
    return parsed.data as PlatformSettingValue<K>
  }
  await db
    .insert(platformSetting)
    .values({ key, value: parsed.data, updatedByUserId: userId })
    .onConflictDoUpdate({
      target: platformSetting.key,
      set: { value: parsed.data, updatedByUserId: userId, updatedAt: new Date() },
    })
  await db.insert(platformSettingLog).values({
    id: randomUUID(),
    key,
    oldValue: before?.value ?? null,
    newValue: parsed.data,
    changedByUserId: userId,
  })
  cache = null
  return parsed.data as PlatformSettingValue<K>
}

/** Recent changes of one key, newest first, with the changer's name. */
export async function listPlatformSettingLog(key: PlatformSettingKey, limit = 10) {
  return db
    .select({
      id: platformSettingLog.id,
      oldValue: platformSettingLog.oldValue,
      newValue: platformSettingLog.newValue,
      changedAt: platformSettingLog.changedAt,
      changedBy: user.name,
    })
    .from(platformSettingLog)
    .leftJoin(user, eq(user.id, platformSettingLog.changedByUserId))
    .where(eq(platformSettingLog.key, key))
    .orderBy(desc(platformSettingLog.changedAt))
    .limit(limit)
}

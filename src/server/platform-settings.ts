import "server-only"

import { randomUUID } from "node:crypto"
import { desc, eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db/drizzle"
import { platformSetting, platformSettingLog, user } from "@/db/schema"
import { attentionParamsOverrideSchema, type AttentionParamsOverride } from "@/lib/topics/attention-params"
import { deliveryParamsOverrideSchema, type DeliveryParamsOverride } from "@/lib/topics/delivery-params"
import { checksParamsOverrideSchema, type ChecksParamsOverride } from "@/lib/topics/checks"

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
  // Default MONTHLY AI limit per organization, USD of END-USER cost (with
  // markup) per calendar month, UTC (docs/specs/models/08-monthly-limit.md).
  // Per-org override: org_setting `ai.budget.monthly_usd`.
  "ai.budget.monthly_usd": {
    schema: z.number().min(0).max(1_000_000),
    default: 20,
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
  // Topics delivery parameters (phase 7, 06 §13): a PARTIAL override of the
  // code defaults in src/lib/topics/delivery-params.ts (null = defaults).
  // Per-org override: org_setting `delivery.params`.
  "delivery.params": {
    schema: deliveryParamsOverrideSchema.nullable(),
    default: null as DeliveryParamsOverride | null,
  },
  // CRM checks + watchdogs (topics phase 8): a PARTIAL override of the code
  // defaults in src/lib/topics/checks.ts (null = defaults). Per-org
  // override: org_setting `checks.params`.
  "checks.params": {
    schema: checksParamsOverrideSchema.nullable(),
    default: null as ChecksParamsOverride | null,
  },
  // Deal bridge (topics phase 5, spec 01 §9.2, Q27). Per-org override:
  // org_setting with the same key (null there = this value).
  "deals.autoCreateEnabled": { schema: z.boolean(), default: true },
  "deals.autoCreateMinScore": { schema: z.number().int().min(0).max(20), default: 7 },
  "deals.autoCreateMinConfidence": {
    schema: z.enum(["low", "medium", "high"]),
    default: "high" as "low" | "medium" | "high",
  },
  "deals.proposalMinScore": { schema: z.number().int().min(0).max(20), default: 5 },
  // Deal state + risks (topics phase 5a, spec 01 §9.3 / §9.4, 06 §6 I5).
  // Debounce of the «Текущее состояние» run per deal (R16).
  "deals.stateDebounceMinutes": { schema: z.number().int().min(0).max(1440), default: 10 },
  // A deal risk with severity ≥ this raises its trigger topic to «Сейчас» (I5, R17).
  "deals.riskImmediateMinSeverity": { schema: z.number().int().min(0).max(10), default: 7 },
  // Payment policy for the risk PAYMENT_TERMS_ABOVE_POLICY (null = not set → no risk).
  "deals.maxDeferralDays": { schema: z.number().int().min(0).max(3650).nullable(), default: null as number | null },
  "deals.maxCreditLimitRub": { schema: z.number().min(0).nullable(), default: null as number | null },
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

import "server-only"

import { and, asc, eq } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { source } from "@/db/schema"
import { getTelegramCredentials } from "@/server/providers/credentials"

// The org's Telegram bot = its active telegram source (one bot per org,
// docs/specs/telegram/04 §9.2). Org-explicit.

export type OrgTelegramBot = {
  sourceId: string
  organizationId: string
  botToken: string
  /** @username without «@» (getMe result, else the typed value); null = unknown. */
  botUsername: string | null
  /** «ИИ-чат в Telegram» (docs/specs/ai-chat-telegram Q1): owner switch, default off. */
  aiChatEnabled: boolean
}

type SourceRow = { id: string; organizationId: string | null; providerConfig: unknown; credentialsRef: string | null }

export function botFromRow(row: SourceRow): OrgTelegramBot | null {
  if (!row.organizationId) return null
  let botToken: string
  try {
    botToken = getTelegramCredentials(row.id, row.credentialsRef).botToken
  } catch {
    return null
  }
  const cfg = (row.providerConfig ?? {}) as Record<string, unknown>
  const me = (cfg.telegramBot ?? null) as { username?: string | null } | null
  const typed = typeof cfg.botUsername === "string" && cfg.botUsername.trim() ? cfg.botUsername.trim().replace(/^@/, "") : null
  return {
    sourceId: row.id,
    organizationId: row.organizationId,
    botToken,
    botUsername: me?.username || typed,
    aiChatEnabled: cfg.aiChatEnabled === true,
  }
}

/** The org's first active, configured Telegram source (null = none). */
export async function loadOrgTelegramBot(orgId: string): Promise<OrgTelegramBot | null> {
  const rows = await db
    .select({ id: source.id, organizationId: source.ownerOrganizationId, providerConfig: source.providerConfig, credentialsRef: source.credentialsRef })
    .from(source)
    .where(and(eq(source.ownerOrganizationId, orgId), eq(source.provider, "telegram"), eq(source.status, "active")))
    .orderBy(asc(source.createdAt))
  for (const r of rows) {
    const bot = botFromRow(r)
    if (bot) return bot
  }
  return null
}

/** One Telegram source by id (any org — the caller checks the org). */
export async function loadTelegramBotBySource(sourceId: string): Promise<OrgTelegramBot | null> {
  const [r] = await db
    .select({ id: source.id, organizationId: source.ownerOrganizationId, providerConfig: source.providerConfig, credentialsRef: source.credentialsRef, provider: source.provider, status: source.status })
    .from(source)
    .where(eq(source.id, sourceId))
    .limit(1)
  if (!r || r.provider !== "telegram" || r.status !== "active") return null
  return botFromRow(r)
}

/** Owner switch «ИИ-чат в Telegram» (server-managed key `provider_config.aiChatEnabled`). */
export async function setTelegramAiChatEnabled(sourceId: string, enabled: boolean): Promise<void> {
  const [r] = await db.select({ providerConfig: source.providerConfig }).from(source).where(eq(source.id, sourceId))
  const cfg = (r?.providerConfig ?? {}) as Record<string, unknown>
  await db
    .update(source)
    .set({ providerConfig: { ...cfg, aiChatEnabled: enabled }, updatedAt: new Date() })
    .where(eq(source.id, sourceId))
}

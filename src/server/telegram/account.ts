import "server-only"

import { and, eq } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { member, source } from "@/db/schema"
import {
  createTelegramBindLink,
  getMemberTelegramBinding,
  listSourceTelegramBindings,
  unbindTelegram,
} from "@/server/telegram/bindings"
import { loadOrgTelegramBot, loadTelegramBotBySource, setTelegramAiChatEnabled } from "@/server/telegram/source"

// Telegram for people in the CRM (docs/specs/telegram/04 §5.2,
// docs/specs/ai-chat-telegram §13): the member's own binding on /profile and
// the owner's settings of the org bot (AI chat switch, bound members).
// Org-explicit; the API routes pass the org + user from the session.

export class TelegramAccountError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
  }
}

export type MyTelegramView = {
  /** The org has an active, configured bot with a known @username. */
  available: boolean
  botUsername: string | null
  aiChatEnabled: boolean
  binding: { status: "active" | "blocked"; tgUsername: string | null; tgName: string | null; boundAt: string; lastSeenAt: string | null } | null
}

export async function getMyTelegramView(orgId: string, userId: string): Promise<MyTelegramView> {
  const [bot, b] = await Promise.all([loadOrgTelegramBot(orgId), getMemberTelegramBinding(orgId, userId)])
  return {
    available: !!bot?.botUsername,
    botUsername: bot?.botUsername ?? null,
    aiChatEnabled: !!bot?.aiChatEnabled,
    binding: b
      ? {
          status: b.status === "blocked" ? "blocked" : "active",
          tgUsername: b.tgUsername,
          tgName: b.tgName,
          boundAt: b.boundAt.toISOString(),
          lastSeenAt: b.lastSeenAt?.toISOString() ?? null,
        }
      : null,
  }
}

export async function linkMyTelegram(orgId: string, userId: string) {
  return createTelegramBindLink(orgId, userId)
}

export async function unlinkMyTelegram(orgId: string, userId: string): Promise<void> {
  await unbindTelegram(orgId, userId, "member")
}

async function memberRole(orgId: string, userId: string): Promise<string | null> {
  const [m] = await db.select({ role: member.role }).from(member).where(and(eq(member.organizationId, orgId), eq(member.userId, userId))).limit(1)
  return m?.role ?? null
}

async function assertTelegramSourceInOrg(orgId: string, sourceId: string): Promise<void> {
  const [s] = await db.select({ org: source.ownerOrganizationId, provider: source.provider }).from(source).where(eq(source.id, sourceId)).limit(1)
  if (!s || s.org !== orgId || s.provider !== "telegram") throw new TelegramAccountError("Источник не найден", 404)
}

export type TelegramSourceSettings = {
  aiChatEnabled: boolean
  canManage: boolean
  botUsername: string | null
  bindings: Awaited<ReturnType<typeof listSourceTelegramBindings>>
}

/** Owner view of the bot (any member reads the switch; only owners see the bound members). */
export async function getTelegramSourceSettings(orgId: string, userId: string, sourceId: string): Promise<TelegramSourceSettings> {
  await assertTelegramSourceInOrg(orgId, sourceId)
  const role = await memberRole(orgId, userId)
  if (!role) throw new TelegramAccountError("Нет доступа", 403)
  const bot = await loadTelegramBotBySource(sourceId)
  const canManage = role === "owner"
  return {
    aiChatEnabled: !!bot?.aiChatEnabled,
    canManage,
    botUsername: bot?.botUsername ?? null,
    bindings: canManage ? await listSourceTelegramBindings(sourceId) : [],
  }
}

/** «ИИ-чат в Telegram» (Q1): org owner only. */
export async function setTelegramAiChat(orgId: string, userId: string, sourceId: string, enabled: boolean): Promise<void> {
  await assertTelegramSourceInOrg(orgId, sourceId)
  if ((await memberRole(orgId, userId)) !== "owner") throw new TelegramAccountError("Только владелец организации может это менять", 403)
  await setTelegramAiChatEnabled(sourceId, enabled)
}

/** The owner unbinds any member (ai-chat-telegram §11). */
export async function ownerUnbindTelegram(orgId: string, ownerId: string, sourceId: string, targetUserId: string): Promise<void> {
  await assertTelegramSourceInOrg(orgId, sourceId)
  if ((await memberRole(orgId, ownerId)) !== "owner") throw new TelegramAccountError("Только владелец организации может это менять", 403)
  await unbindTelegram(orgId, targetUserId, "owner")
}

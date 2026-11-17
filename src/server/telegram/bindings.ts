import "server-only"

import { createHash, randomBytes, randomUUID } from "node:crypto"
import { and, desc, eq, gt, inArray, isNull, ne, or } from "drizzle-orm"
import type { User as TgUser } from "grammy/types"
import { db } from "@/db/drizzle"
import { member, telegramBindCode, telegramBinding, user } from "@/db/schema"
import { notify } from "@/server/notifications/engine"
import { loadOrgTelegramBot } from "@/server/telegram/source"

// Staff ↔ Telegram binding (docs/specs/telegram/04-identity-and-chats.md §5):
// a VERIFIED link made by the member through the org bot — a one-time deep
// link `t.me/<bot>?start=<code>` (≥ 128 bits, stored hashed, 15 minutes,
// single use). Gives the inbound identity and the outbound address. Org-
// explicit; the session wrappers live in src/server/telegram/account.ts.

export const BIND_CODE_TTL_MS = 15 * 60_000

export type TelegramBindingRow = typeof telegramBinding.$inferSelect

export class TelegramBindingError extends Error {
  constructor(
    public readonly code: "no_bot" | "no_username" | "not_member",
    message: string,
  ) {
    super(message)
  }
}

const hashCode = (code: string) => createHash("sha256").update(code).digest("hex")

function displayName(from: TgUser): string {
  return [from.first_name, from.last_name].filter(Boolean).join(" ").trim() || from.username || String(from.id)
}

/** A human, not banned member of the org? */
export async function isActiveOrgMember(orgId: string, userId: string): Promise<boolean> {
  const [r] = await db
    .select({ id: member.id, banned: user.banned, role: user.role })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)))
    .limit(1)
  return !!r && !r.banned && r.role !== "agent"
}

/** Step 1 (/account or /profile): a new one-time link for the member. Older open codes stop working. */
export async function createTelegramBindLink(orgId: string, userId: string): Promise<{ deepLink: string; expiresAt: string; botUsername: string }> {
  const bot = await loadOrgTelegramBot(orgId)
  if (!bot) throw new TelegramBindingError("no_bot", "В организации не подключён Telegram-бот")
  if (!bot.botUsername) throw new TelegramBindingError("no_username", "Имя бота неизвестно — владелец должен сохранить учётные данные бота ещё раз")
  if (!(await isActiveOrgMember(orgId, userId))) throw new TelegramBindingError("not_member", "Вы не участник этой организации")
  const code = randomBytes(18).toString("base64url") // 24 chars, [A-Za-z0-9_-] — valid /start payload
  const now = new Date()
  const expiresAt = new Date(now.getTime() + BIND_CODE_TTL_MS)
  await db.batch([
    db
      .update(telegramBindCode)
      .set({ usedAt: now })
      .where(and(eq(telegramBindCode.sourceId, bot.sourceId), eq(telegramBindCode.userId, userId), isNull(telegramBindCode.usedAt))),
    db.insert(telegramBindCode).values({ id: randomUUID(), organizationId: orgId, sourceId: bot.sourceId, userId, codeHash: hashCode(code), expiresAt }),
  ])
  return { deepLink: `https://t.me/${bot.botUsername}?start=${code}`, expiresAt: expiresAt.toISOString(), botUsername: bot.botUsername }
}

export type RedeemResult =
  | { status: "bound"; binding: TelegramBindingRow; rebound: boolean }
  | { status: "invalid" }
  | { status: "not_member" }
  | { status: "taken" }

/**
 * Step 2 (webhook, `/start <code>`): bind the Telegram account that sent the
 * command. The code must belong to THIS bot (source), be unused and fresh.
 * The same Telegram account bound to another member of the org → refused.
 */
export async function redeemTelegramBindCode(sourceId: string, from: TgUser, chatId: number, code: string): Promise<RedeemResult> {
  const now = new Date()
  const [row] = await db
    .select()
    .from(telegramBindCode)
    .where(and(eq(telegramBindCode.codeHash, hashCode(code)), eq(telegramBindCode.sourceId, sourceId), isNull(telegramBindCode.usedAt), gt(telegramBindCode.expiresAt, now)))
    .limit(1)
  if (!row) return { status: "invalid" }
  // Single use: claim the code first (a second press of the same link fails).
  const claimed = await db
    .update(telegramBindCode)
    .set({ usedAt: now })
    .where(and(eq(telegramBindCode.id, row.id), isNull(telegramBindCode.usedAt)))
    .returning({ id: telegramBindCode.id })
  if (!claimed.length) return { status: "invalid" }
  if (!(await isActiveOrgMember(row.organizationId, row.userId))) return { status: "not_member" }

  const tgUserId = String(from.id)
  const current = await db
    .select()
    .from(telegramBinding)
    .where(and(eq(telegramBinding.sourceId, sourceId), ne(telegramBinding.status, "unbound"), or(eq(telegramBinding.tgUserId, tgUserId), eq(telegramBinding.userId, row.userId))))
  if (current.some((b) => b.tgUserId === tgUserId && b.userId !== row.userId)) return { status: "taken" }

  const same = current.find((b) => b.tgUserId === tgUserId && b.userId === row.userId)
  const values = { tgUsername: from.username ?? null, tgName: displayName(from), chatId: String(chatId), lastSeenAt: now, updatedAt: now }
  if (same) {
    const [b] = await db.update(telegramBinding).set({ ...values, status: "active" }).where(eq(telegramBinding.id, same.id)).returning()
    return { status: "bound", binding: b, rebound: true }
  }
  // The member's earlier Telegram account (if any) is unbound — one account per member and bot.
  const old = current.filter((b) => b.userId === row.userId).map((b) => b.id)
  const id = randomUUID()
  const insert = db
    .insert(telegramBinding)
    .values({ id, organizationId: row.organizationId, sourceId, userId: row.userId, tgUserId, ...values, status: "active", boundAt: now })
  if (old.length) {
    await db.batch([
      db.update(telegramBinding).set({ status: "unbound", unboundAt: now, unboundReason: "rebind", updatedAt: now }).where(inArray(telegramBinding.id, old)),
      insert,
    ])
  } else {
    await insert
  }
  const [b] = await db.select().from(telegramBinding).where(eq(telegramBinding.id, id))

  // Notices to our people (telegram/04 §7.6, Q23) — never to clients.
  const who = from.username ? `@${from.username}` : displayName(from)
  const [u] = await db.select({ name: user.name }).from(user).where(eq(user.id, row.userId))
  await notify(row.organizationId, {
    kind: "telegram.bound",
    userIds: [row.userId],
    title: `Telegram ${who} привязан к CRM`,
    body: "Личные сообщения боту сохраняются в CRM. Здесь же приходят ответы ИИ-чата, когда владелец его включил.",
    href: "/profile",
    dedupeKey: `telegram.bound:${id}`,
  })
  await notify(row.organizationId, {
    kind: "telegram.bound_owner",
    title: `${u?.name ?? "Сотрудник"} привязал(а) Telegram ${who}`,
    body: "Личные сообщения этого сотрудника боту сохраняются в CRM.",
    href: "/sources",
    dedupeKey: `telegram.bound_owner:${id}`,
  })
  return { status: "bound", binding: b, rebound: false }
}

/** The binding of a Telegram account on this bot (active or blocked); null = unknown person. */
export async function findTelegramBinding(sourceId: string, tgUserId: number | string): Promise<TelegramBindingRow | null> {
  const [b] = await db
    .select()
    .from(telegramBinding)
    .where(and(eq(telegramBinding.sourceId, sourceId), eq(telegramBinding.tgUserId, String(tgUserId)), ne(telegramBinding.status, "unbound")))
    .limit(1)
  return b ?? null
}

/** A message from the member: username / name are refreshed; a blocked binding becomes active (the user wrote again). */
export async function touchTelegramBinding(b: TelegramBindingRow, from: TgUser): Promise<TelegramBindingRow> {
  const now = new Date()
  const patch = { tgUsername: from.username ?? null, tgName: displayName(from), lastSeenAt: now, updatedAt: now, status: "active" }
  await db.update(telegramBinding).set(patch).where(eq(telegramBinding.id, b.id)).catch((e) => console.warn("[telegram] touch binding failed", e))
  return { ...b, ...patch }
}

/** Unbind (member action, owner action, `/stop`, member left the org). */
export async function unbindTelegram(orgId: string, userId: string, reason: string): Promise<number> {
  const now = new Date()
  const r = await db
    .update(telegramBinding)
    .set({ status: "unbound", unboundAt: now, unboundReason: reason.slice(0, 60), updatedAt: now })
    .where(and(eq(telegramBinding.organizationId, orgId), eq(telegramBinding.userId, userId), ne(telegramBinding.status, "unbound")))
    .returning({ id: telegramBinding.id })
  return r.length
}

/** The member's current binding in the org (any bot), newest first. */
export async function getMemberTelegramBinding(orgId: string, userId: string): Promise<TelegramBindingRow | null> {
  const [b] = await db
    .select()
    .from(telegramBinding)
    .where(and(eq(telegramBinding.organizationId, orgId), eq(telegramBinding.userId, userId), ne(telegramBinding.status, "unbound")))
    .orderBy(desc(telegramBinding.boundAt))
    .limit(1)
  return b ?? null
}

/** Bound members of a bot (owner view in the source settings). */
export async function listSourceTelegramBindings(sourceId: string): Promise<
  { userId: string; name: string; email: string; tgUsername: string | null; tgName: string | null; status: string; boundAt: string; lastSeenAt: string | null }[]
> {
  const rows = await db
    .select({
      userId: telegramBinding.userId,
      name: user.name,
      email: user.email,
      tgUsername: telegramBinding.tgUsername,
      tgName: telegramBinding.tgName,
      status: telegramBinding.status,
      boundAt: telegramBinding.boundAt,
      lastSeenAt: telegramBinding.lastSeenAt,
    })
    .from(telegramBinding)
    .innerJoin(user, eq(user.id, telegramBinding.userId))
    .where(and(eq(telegramBinding.sourceId, sourceId), ne(telegramBinding.status, "unbound")))
    .orderBy(user.name)
  return rows.map((r) => ({ ...r, boundAt: r.boundAt.toISOString(), lastSeenAt: r.lastSeenAt?.toISOString() ?? null }))
}

import "server-only"

import { randomUUID } from "node:crypto"
import { and, desc, eq, gte, inArray, isNull, ne, notInArray, sql } from "drizzle-orm"
import type { ChatMemberUpdated, Message } from "grammy/types"
import { db } from "@/db/drizzle"
import {
  client,
  contact,
  member,
  sourceItem,
  telegramChat,
  telegramChatClient,
  telegramChatLog,
  telegramChatSuggestion,
  telegramContactProposal,
} from "@/db/schema"
import { companyMatchKey } from "@/lib/translit-ru"
import { readTelegramResolved, type TelegramResolved } from "@/lib/telegram/resolve"
import { loadAnalysisExclusions } from "@/server/analysis-exclusions"
import { exclusionProbeFromItem, matchAnalysisExclusion } from "@/lib/analysis-exclusion-match"
import { notify } from "@/server/notifications/engine"

// Telegram chats ↔ companies (docs/specs/telegram/04 §7, TI4): the chats the
// bot sees (groups) and companies' own accounts, their binding (mode auto |
// clients | internal + companies, one primary), the change log, binding
// suggestions (§7.3, never automatic) and «Новый контакт в <Компания>?»
// proposals (Q25). Who may bind (Q24): the org owner, or the «Ответственный»
// of EVERY company the change touches; mode internal = owner only.
// Org-explicit; the API routes pass the org + user from the session.

export class TelegramChatError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
  }
}

const GROUP_TYPES = new Set(["group", "supergroup"])
const AUTHOR_WINDOW_MS = 90 * 86_400_000

function cleanUsername(raw: string | null | undefined): string | null {
  const m = (raw ?? "").trim().replace(/^https?:\/\/t\.me\//i, "").replace(/^@/, "").split(/[/?#]/)[0].toLowerCase()
  return /^[a-z0-9_]{4,32}$/.test(m) ? m : null
}

async function log(orgId: string, chatRowId: string, userId: string | null, action: string, before: unknown, after: unknown): Promise<void> {
  await db.insert(telegramChatLog).values({ id: randomUUID(), organizationId: orgId, chatRowId, userId, action, before: before ?? null, after: after ?? null })
}

// ── Recording the chats the bot sees ─────────────────────────────────────

/**
 * The bot joined / left a group (`my_chat_member`): the row + a notice to owners on join (§7.6).
 * A CHANNEL is out of scope (Q32 = a, docs/specs/telegram/05 F1): no row (its posts never
 * arrive — `channel_post` is not asked for), only a notice to the owners that it is not supported.
 */
export async function recordTelegramChatMembership(sourceId: string, orgId: string, m: ChatMemberUpdated): Promise<void> {
  const title = "title" in m.chat && typeof m.chat.title === "string" ? m.chat.title : null
  if (m.chat.type === "channel") {
    const isIn = (s: string) => s === "member" || s === "administrator"
    if (isIn(m.new_chat_member.status) && !isIn(m.old_chat_member.status)) {
      await notify(orgId, {
        kind: "telegram.channel_unsupported",
        title: `Бот добавлен в канал «${title ?? m.chat.id}»`,
        body: "Каналы не поддерживаются: посты канала не сохраняются в CRM. Бота можно удалить из канала.",
        href: "/sources",
        dedupeKey: `telegram.channel_unsupported:${m.chat.id}:${m.date}`,
      })
    }
    return
  }
  if (!GROUP_TYPES.has(m.chat.type)) return
  const chatId = String(m.chat.id)
  const username = "username" in m.chat ? cleanUsername((m.chat as { username?: string }).username) : null
  const status = m.new_chat_member.status
  const at = new Date(m.date * 1000)
  const row = await upsertChat(sourceId, orgId, { chatId, type: m.chat.type, title, username, botStatus: status, at })
  const joined = (status === "member" || status === "administrator") && !["member", "administrator"].includes(m.old_chat_member.status)
  if (joined && row) {
    await notify(orgId, {
      kind: "telegram.chat_added",
      title: `Бот добавлен в «${title ?? chatId}»`,
      body: "Сообщения этого чата сохраняются в CRM и анализируются. Привяжите чат к компании в настройках Telegram-источника («Группы») или в карточке компании.",
      href: "/sources",
      dedupeKey: `telegram.chat_added:${row.id}:${m.date}`,
    })
    if (title && row.mode === "auto") await suggestByTitle(orgId, row.id, title)
  }
}

type ChatRow = typeof telegramChat.$inferSelect

/** Create / refresh the row of a group the bot sees. A row typed by @name earlier gets its chat id. */
async function upsertChat(
  sourceId: string,
  orgId: string,
  v: { chatId: string; type: string; title: string | null; username: string | null; botStatus?: string; at: Date },
): Promise<ChatRow | null> {
  const [byId] = await db.select().from(telegramChat).where(and(eq(telegramChat.sourceId, sourceId), eq(telegramChat.chatId, v.chatId))).limit(1)
  if (byId) {
    const [r] = await db
      .update(telegramChat)
      .set({ title: v.title ?? byId.title, username: v.username ?? byId.username, type: v.type, ...(v.botStatus ? { botStatus: v.botStatus } : {}), lastMessageAt: v.botStatus ? byId.lastMessageAt : v.at, updatedAt: new Date() })
      .where(eq(telegramChat.id, byId.id))
      .returning()
    return r
  }
  if (v.username) {
    const [pending] = await db
      .select()
      .from(telegramChat)
      .where(and(eq(telegramChat.sourceId, sourceId), eq(telegramChat.username, v.username), isNull(telegramChat.chatId)))
      .limit(1)
    if (pending) {
      const [r] = await db
        .update(telegramChat)
        .set({ chatId: v.chatId, type: v.type, title: v.title, firstSeenAt: v.at, lastMessageAt: v.botStatus ? null : v.at, ...(v.botStatus ? { botStatus: v.botStatus } : {}), updatedAt: new Date() })
        .where(eq(telegramChat.id, pending.id))
        .returning()
      await log(orgId, pending.id, null, "first_message", { chatId: null }, { chatId: v.chatId })
      return r
    }
  }
  const [r] = await db
    .insert(telegramChat)
    .values({ id: randomUUID(), organizationId: orgId, sourceId, chatId: v.chatId, type: v.type, title: v.title, username: v.username, botStatus: v.botStatus ?? "member", firstSeenAt: v.at, lastMessageAt: v.botStatus ? null : v.at })
    .onConflictDoNothing()
    .returning()
  return r ?? null
}

/**
 * Every message the bot gets (router, before routing): a group refreshes its
 * row; a private message from a company account typed by @name fills its id.
 */
export async function touchTelegramChat(sourceId: string, orgId: string, message: Message): Promise<void> {
  try {
    const at = new Date(message.date * 1000)
    if (GROUP_TYPES.has(message.chat.type)) {
      const title = "title" in message.chat && typeof message.chat.title === "string" ? message.chat.title : null
      const username = "username" in message.chat ? cleanUsername((message.chat as { username?: string }).username) : null
      await upsertChat(sourceId, orgId, { chatId: String(message.chat.id), type: message.chat.type, title, username, at })
      return
    }
    if (message.chat.type === "private" && message.from?.username) {
      const u = cleanUsername(message.from.username)
      if (!u) return
      await db
        .update(telegramChat)
        .set({ chatId: String(message.from.id), type: "private", title: [message.from.first_name, message.from.last_name].filter(Boolean).join(" ") || null, firstSeenAt: at, lastMessageAt: at, updatedAt: new Date() })
        .where(and(eq(telegramChat.sourceId, sourceId), eq(telegramChat.username, u), isNull(telegramChat.chatId)))
    }
  } catch (e) {
    console.warn("[telegram/chats] touch failed", sourceId, e)
  }
}

/** A group became a supergroup (new chat id): the row (and its binding) follows. */
export async function migrateTelegramChat(sourceId: string, orgId: string, oldChatId: number, newChatId: number): Promise<void> {
  const [row] = await db.select().from(telegramChat).where(and(eq(telegramChat.sourceId, sourceId), eq(telegramChat.chatId, String(oldChatId)))).limit(1)
  if (!row) return
  const [taken] = await db.select({ id: telegramChat.id }).from(telegramChat).where(and(eq(telegramChat.sourceId, sourceId), eq(telegramChat.chatId, String(newChatId)))).limit(1)
  if (taken) await db.delete(telegramChat).where(and(eq(telegramChat.id, taken.id), eq(telegramChat.mode, "auto")))
  await db.update(telegramChat).set({ chatId: String(newChatId), migratedFromChatId: String(oldChatId), type: "supergroup", updatedAt: new Date() }).where(eq(telegramChat.id, row.id))
  await log(orgId, row.id, null, "migrated", { chatId: String(oldChatId) }, { chatId: String(newChatId) })
}

// ── Suggestions (§7.3) ────────────────────────────────────────────────────

async function liveClients(orgId: string): Promise<{ id: string; name: string; aliases: string[] | null }[]> {
  return db
    .select({ id: client.id, name: client.name, aliases: client.aliases })
    .from(client)
    .where(and(eq(client.organizationId, orgId), notInArray(client.status, ["deleted", "blocked"])))
}

/** Company keys of every 1–3-word run of a title («Альфа / Мы» → alfa, my, alfa my …). */
export function titleKeys(title: string): Set<string> {
  const words = title.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  const out = new Set<string>()
  for (let i = 0; i < words.length; i++) {
    for (let n = 1; n <= 3 && i + n <= words.length; n++) {
      const k = companyMatchKey(words.slice(i, i + n).join(" "))
      if (k.length >= 3) out.add(k)
    }
  }
  return out
}

async function upsertSuggestion(orgId: string, chatRowId: string, clientId: string, reason: "title" | "authors", chatTitle: string | null): Promise<void> {
  const r = await db
    .insert(telegramChatSuggestion)
    .values({ id: randomUUID(), organizationId: orgId, chatRowId, clientId, reason })
    .onConflictDoNothing()
    .returning({ id: telegramChatSuggestion.id })
  if (!r.length) return
  const [c] = await db.select({ name: client.name }).from(client).where(eq(client.id, clientId))
  await notify(orgId, {
    kind: "telegram.chat_suggestion",
    title: `Чат «${chatTitle ?? "Telegram"}» — это компания «${c?.name ?? "?"}»?`,
    body: reason === "title" ? "Название чата совпадает с названием компании." : "Почти все известные авторы чата — контакты этой компании.",
    href: `/clients/${clientId}`,
    entity: { type: "client", id: clientId },
    dedupeKey: `telegram.chat_suggestion:${chatRowId}:${clientId}`,
  })
}

/** The chat title names ONE live company. */
async function suggestByTitle(orgId: string, chatRowId: string, title: string): Promise<void> {
  const keys = titleKeys(title)
  if (!keys.size) return
  const hits = (await liveClients(orgId)).filter((c) => [c.name, ...(c.aliases ?? [])].some((n) => keys.has(companyMatchKey(n))))
  if (hits.length === 1) await upsertSuggestion(orgId, chatRowId, hits[0].id, "title", title)
}

/** ≥ 2 known non-staff authors in 90 days and ≥ 80 % of them belong to one company. */
async function suggestByAuthors(orgId: string, row: ChatRow): Promise<void> {
  if (!row.chatId) return
  const rows = await db
    .select({ meta: sourceItem.metadataJson })
    .from(sourceItem)
    .where(
      and(
        eq(sourceItem.organizationId, orgId),
        eq(sourceItem.sourceId, row.sourceId),
        eq(sourceItem.threadExternalId, row.chatId),
        isNull(sourceItem.parentSourceItemId),
        gte(sourceItem.sourceCreatedAt, new Date(Date.now() - AUTHOR_WINDOW_MS)),
      ),
    )
    .orderBy(desc(sourceItem.sourceCreatedAt))
    .limit(300)
  const byContact = new Map<string, string | null>()
  for (const r of rows) {
    const res = readTelegramResolved(r.meta)
    if (res?.author.kind === "contact" && res.author.contactId && !res.forward) byContact.set(res.author.contactId, res.author.clientId ?? null)
  }
  if (byContact.size < 2) return
  const counts = new Map<string, number>()
  for (const c of byContact.values()) if (c) counts.set(c, (counts.get(c) ?? 0) + 1)
  for (const [clientId, n] of counts) if (n / byContact.size >= 0.8) await upsertSuggestion(orgId, row.id, clientId, "authors", row.title)
}

// ── After a message's resolution (from `stampTelegramResolved`) ─────────────

export async function afterTelegramResolution(orgId: string, itemId: string, resolved: TelegramResolved, chatId: string | null): Promise<void> {
  // Q25: an unknown author in a chat bound to a company → «Новый контакт в <Компания>?».
  if (resolved.proposeContactFor && resolved.author.tgUserId) {
    const a = resolved.author
    const now = new Date()
    const r = await db
      .insert(telegramContactProposal)
      .values({ id: randomUUID(), organizationId: orgId, chatRowId: resolved.chat?.rowId ?? null, clientId: resolved.proposeContactFor, tgUserId: a.tgUserId!, username: a.username, name: a.name, firstItemId: itemId, lastMessageAt: now })
      .onConflictDoUpdate({
        target: [telegramContactProposal.organizationId, telegramContactProposal.clientId, telegramContactProposal.tgUserId],
        set: { messageCount: sql`${telegramContactProposal.messageCount} + 1`, lastMessageAt: now, username: a.username, name: a.name },
      })
      .returning({ id: telegramContactProposal.id, status: telegramContactProposal.status, count: telegramContactProposal.messageCount })
    if (r[0]?.status === "open" && r[0].count === 1) {
      const [c] = await db.select({ name: client.name, responsible: client.responsibleUserId }).from(client).where(eq(client.id, resolved.proposeContactFor))
      if (c?.responsible) {
        await notify(orgId, {
          kind: "telegram.contact_proposal",
          userIds: [c.responsible],
          title: `Новый контакт в «${c.name}»?`,
          body: `${a.name ?? "Неизвестный участник"}${a.username ? ` (@${a.username})` : ""} пишет в Telegram-чате компании.`,
          href: `/clients/${resolved.proposeContactFor}`,
          entity: { type: "client", id: resolved.proposeContactFor },
          dedupeKey: `telegram.contact_proposal:${r[0].id}`,
        })
      }
    }
  }
  // §7.3: an unbound group → a suggestion by its authors.
  if (chatId && !resolved.chat && resolved.author.kind === "contact") {
    const [row] = await db.select().from(telegramChat).where(and(eq(telegramChat.organizationId, orgId), eq(telegramChat.chatId, chatId), eq(telegramChat.mode, "auto"))).limit(1)
    if (row && GROUP_TYPES.has(row.type)) await suggestByAuthors(orgId, row)
  }
}

// ── Permissions (Q24) ─────────────────────────────────────────────────────

async function isOwner(orgId: string, userId: string): Promise<boolean> {
  const [m] = await db.select({ role: member.role }).from(member).where(and(eq(member.organizationId, orgId), eq(member.userId, userId))).limit(1)
  if (!m) throw new TelegramChatError("Нет доступа", 403)
  return m.role === "owner"
}

/** Owner, or the «Ответственный» of every one of these companies. */
async function assertCanBind(orgId: string, userId: string, clientIds: string[]): Promise<void> {
  if (await isOwner(orgId, userId)) return
  if (!clientIds.length) throw new TelegramChatError("Это меняет только владелец организации", 403)
  const rows = await db
    .select({ id: client.id, responsible: client.responsibleUserId })
    .from(client)
    .where(and(eq(client.organizationId, orgId), inArray(client.id, clientIds)))
  if (rows.length !== new Set(clientIds).size || rows.some((r) => r.responsible !== userId)) {
    throw new TelegramChatError("Привязать или отвязать компанию может владелец организации или ответственный за компанию", 403)
  }
}

// ── Views + binding ───────────────────────────────────────────────────────

export type TelegramChatView = {
  id: string
  chatId: string | null
  type: string
  title: string | null
  username: string | null
  botStatus: string | null
  mode: "auto" | "clients" | "internal"
  clients: { id: string; name: string; isPrimary: boolean }[]
  /** «Не анализировать» = a chat exclusion (owner, `/api/sources/exclusions`). */
  excluded: boolean
  waitingFirstMessage: boolean
  lastMessageAt: string | null
  suggestions: { id: string; clientId: string; clientName: string; reason: string }[]
}

async function viewsOf(orgId: string, rows: ChatRow[]): Promise<TelegramChatView[]> {
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const [links, sugg, exclusions] = await Promise.all([
    db
      .select({ chatRowId: telegramChatClient.chatRowId, clientId: telegramChatClient.clientId, isPrimary: telegramChatClient.isPrimary, name: client.name })
      .from(telegramChatClient)
      .innerJoin(client, eq(client.id, telegramChatClient.clientId))
      .where(inArray(telegramChatClient.chatRowId, ids)),
    db
      .select({ id: telegramChatSuggestion.id, chatRowId: telegramChatSuggestion.chatRowId, clientId: telegramChatSuggestion.clientId, reason: telegramChatSuggestion.reason, name: client.name })
      .from(telegramChatSuggestion)
      .innerJoin(client, eq(client.id, telegramChatSuggestion.clientId))
      .where(and(inArray(telegramChatSuggestion.chatRowId, ids), eq(telegramChatSuggestion.status, "open"))),
    loadAnalysisExclusions(orgId),
  ])
  return rows.map((r) => ({
    id: r.id,
    chatId: r.chatId,
    type: r.type,
    title: r.title,
    username: r.username,
    botStatus: r.botStatus,
    mode: r.mode === "clients" || r.mode === "internal" ? r.mode : "auto",
    clients: links
      .filter((l) => l.chatRowId === r.id)
      .map((l) => ({ id: l.clientId, name: l.name, isPrimary: l.isPrimary }))
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)),
    excluded:
      !!r.chatId &&
      exclusions.length > 0 &&
      !!matchAnalysisExclusion(exclusions, exclusionProbeFromItem({ provider: "telegram", metadataJson: { telegram: { chatId: Number(r.chatId) } }, threadExternalId: r.chatId })),
    waitingFirstMessage: !r.chatId,
    lastMessageAt: r.lastMessageAt?.toISOString() ?? null,
    suggestions: sugg.filter((x) => x.chatRowId === r.id).map((x) => ({ id: x.id, clientId: x.clientId, clientName: x.name, reason: x.reason })),
  }))
}

/** «Группы» of a bot (source settings): every chat row of the source, channels left out (Q32 = a). */
export async function listTelegramChats(orgId: string, sourceId: string): Promise<TelegramChatView[]> {
  const rows = await db
    .select()
    .from(telegramChat)
    .where(and(eq(telegramChat.organizationId, orgId), eq(telegramChat.sourceId, sourceId), ne(telegramChat.type, "channel")))
    .orderBy(desc(telegramChat.lastMessageAt), telegramChat.title)
  return viewsOf(orgId, rows)
}

async function loadRow(orgId: string, rowId: string): Promise<ChatRow> {
  const [row] = await db.select().from(telegramChat).where(and(eq(telegramChat.id, rowId), eq(telegramChat.organizationId, orgId))).limit(1)
  if (!row) throw new TelegramChatError("Чат не найден", 404)
  return row
}

async function currentClients(rowId: string): Promise<{ clientId: string; isPrimary: boolean }[]> {
  return db.select({ clientId: telegramChatClient.clientId, isPrimary: telegramChatClient.isPrimary }).from(telegramChatClient).where(eq(telegramChatClient.chatRowId, rowId))
}

/**
 * Set a chat's binding (§7.2): mode + companies (the first or the flagged one
 * = primary). New messages only (Q29 = a). Logged.
 */
export async function setTelegramChatBinding(
  orgId: string,
  userId: string,
  rowId: string,
  input: { mode: "auto" | "clients" | "internal"; clients?: { clientId: string; isPrimary?: boolean }[] },
): Promise<TelegramChatView> {
  const row = await loadRow(orgId, rowId)
  const before = await currentClients(rowId)
  const wanted = input.mode === "clients" ? [...new Map((input.clients ?? []).map((c) => [c.clientId, c])).values()] : []
  if (input.mode === "clients" && !wanted.length) throw new TelegramChatError("Выберите хотя бы одну компанию", 400)
  if (input.mode === "internal" && !(await isOwner(orgId, userId))) throw new TelegramChatError("Внутренним чат отмечает владелец организации", 403)
  const touched = [...new Set([...before.map((b) => b.clientId).filter((id) => !wanted.some((w) => w.clientId === id)), ...wanted.map((w) => w.clientId).filter((id) => !before.some((b) => b.clientId === id))])]
  if (input.mode !== "internal" && (touched.length || row.mode !== input.mode)) await assertCanBind(orgId, userId, touched.length ? touched : before.map((b) => b.clientId))
  if (wanted.length) {
    const ok = await db.select({ id: client.id }).from(client).where(and(eq(client.organizationId, orgId), inArray(client.id, wanted.map((w) => w.clientId)), ne(client.status, "deleted")))
    if (ok.length !== wanted.length) throw new TelegramChatError("Компания не найдена", 404)
  }
  const primary = wanted.find((w) => w.isPrimary)?.clientId ?? wanted[0]?.clientId ?? null
  const now = new Date()
  await db.batch([
    db.delete(telegramChatClient).where(eq(telegramChatClient.chatRowId, rowId)),
    db.update(telegramChat).set({ mode: input.mode, boundByUserId: userId, boundAt: now, updatedAt: now }).where(eq(telegramChat.id, rowId)),
    ...(wanted.length ? [db.insert(telegramChatClient).values(wanted.map((w) => ({ chatRowId: rowId, clientId: w.clientId, isPrimary: w.clientId === primary })))] : []),
  ] as unknown as Parameters<typeof db.batch>[0])
  // A bound company closes its open suggestions for this chat.
  if (wanted.length) {
    await db
      .update(telegramChatSuggestion)
      .set({ status: "accepted", decidedByUserId: userId, decidedAt: now })
      .where(and(eq(telegramChatSuggestion.chatRowId, rowId), eq(telegramChatSuggestion.status, "open"), inArray(telegramChatSuggestion.clientId, wanted.map((w) => w.clientId))))
  }
  await log(orgId, rowId, userId, "binding", { mode: row.mode, clients: before }, { mode: input.mode, clients: wanted.map((w) => ({ clientId: w.clientId, isPrimary: w.clientId === primary })) })
  return (await viewsOf(orgId, [await loadRow(orgId, rowId)]))[0]
}

/** Accept (= bind the company, added to the chat's companies) or reject a suggestion. */
export async function decideTelegramChatSuggestion(orgId: string, userId: string, suggestionId: string, accept: boolean): Promise<TelegramChatView> {
  const [s] = await db.select().from(telegramChatSuggestion).where(and(eq(telegramChatSuggestion.id, suggestionId), eq(telegramChatSuggestion.organizationId, orgId))).limit(1)
  if (!s) throw new TelegramChatError("Предложение не найдено", 404)
  if (!accept) {
    await assertCanBind(orgId, userId, [s.clientId])
    await db.update(telegramChatSuggestion).set({ status: "rejected", decidedByUserId: userId, decidedAt: new Date() }).where(eq(telegramChatSuggestion.id, s.id))
    await log(orgId, s.chatRowId, userId, "suggestion_rejected", null, { clientId: s.clientId })
    return (await viewsOf(orgId, [await loadRow(orgId, s.chatRowId)]))[0]
  }
  const row = await loadRow(orgId, s.chatRowId)
  const cur = row.mode === "clients" ? await currentClients(row.id) : []
  return setTelegramChatBinding(orgId, userId, row.id, { mode: "clients", clients: [...cur, ...(cur.some((c) => c.clientId === s.clientId) ? [] : [{ clientId: s.clientId, isPrimary: cur.length === 0 }])] })
}

/**
 * Company card «Telegram» → «Добавить» by @name (§7.1): a company's group or
 * own account the bot has not seen yet («ждём первое сообщение»), or an
 * existing row of that username. Bound to the company at once.
 */
export async function addTelegramChatForClient(orgId: string, userId: string, sourceId: string, clientId: string, usernameOrRowId: { username?: string; rowId?: string }): Promise<TelegramChatView> {
  await assertCanBind(orgId, userId, [clientId])
  let row: ChatRow | undefined
  if (usernameOrRowId.rowId) row = await loadRow(orgId, usernameOrRowId.rowId)
  else {
    const u = cleanUsername(usernameOrRowId.username)
    if (!u) throw new TelegramChatError("Укажите имя в Telegram: @name или ссылку t.me/name", 400)
    ;[row] = await db.select().from(telegramChat).where(and(eq(telegramChat.sourceId, sourceId), eq(telegramChat.username, u))).limit(1)
    if (!row) {
      ;[row] = await db.insert(telegramChat).values({ id: randomUUID(), organizationId: orgId, sourceId, username: u, type: "unknown", mode: "auto" }).returning()
      await log(orgId, row.id, userId, "created", null, { username: u })
    }
  }
  if (row.mode === "internal") throw new TelegramChatError("Это внутренний чат организации", 409)
  const cur = row.mode === "clients" ? await currentClients(row.id) : []
  if (cur.some((c) => c.clientId === clientId)) return (await viewsOf(orgId, [row]))[0]
  return setTelegramChatBinding(orgId, userId, row.id, { mode: "clients", clients: [...cur, { clientId, isPrimary: cur.length === 0 }] })
}

/** Company card «Telegram» → «Отвязать»: the company leaves the chat (the last one → auto). */
export async function removeTelegramChatClient(orgId: string, userId: string, rowId: string, clientId: string): Promise<void> {
  const row = await loadRow(orgId, rowId)
  const cur = await currentClients(rowId)
  const rest = cur.filter((c) => c.clientId !== clientId)
  if (rest.length === cur.length) return
  await assertCanBind(orgId, userId, [clientId])
  if (!rest.length && !row.chatId) {
    await db.delete(telegramChat).where(eq(telegramChat.id, rowId))
    return
  }
  await setTelegramChatBinding(orgId, userId, rowId, rest.length ? { mode: "clients", clients: rest.map((c, i) => ({ clientId: c.clientId, isPrimary: c.isPrimary || (i === 0 && !rest.some((x) => x.isPrimary)) })) } : { mode: "auto" })
}

// ── Company card block «Telegram» ─────────────────────────────────────────

export type ClientTelegramView = {
  available: boolean
  sourceId: string | null
  canEdit: boolean
  chats: TelegramChatView[]
  /** Groups the bot sees that are not bound to this company («Добавить» from the list). */
  otherChats: { id: string; title: string | null; username: string | null; type: string }[]
  proposals: { id: string; tgUserId: string; username: string | null; name: string | null; messageCount: number; lastMessageAt: string | null; chatTitle: string | null }[]
}

export async function getClientTelegramView(orgId: string, userId: string, clientId: string): Promise<ClientTelegramView> {
  const [c] = await db.select({ id: client.id, responsible: client.responsibleUserId }).from(client).where(and(eq(client.id, clientId), eq(client.organizationId, orgId))).limit(1)
  if (!c) throw new TelegramChatError("Компания не найдена", 404)
  const { loadOrgTelegramBot } = await import("@/server/telegram/source")
  const bot = await loadOrgTelegramBot(orgId)
  const canEdit = (await isOwner(orgId, userId)) || c.responsible === userId
  if (!bot) return { available: false, sourceId: null, canEdit, chats: [], otherChats: [], proposals: [] }
  const boundIds = (await db.select({ id: telegramChatClient.chatRowId }).from(telegramChatClient).where(eq(telegramChatClient.clientId, clientId))).map((r) => r.id)
  const all = await db
    .select()
    .from(telegramChat)
    .where(and(eq(telegramChat.organizationId, orgId), eq(telegramChat.sourceId, bot.sourceId), ne(telegramChat.type, "channel")))
  const proposals = await db
    .select({ p: telegramContactProposal, chatTitle: telegramChat.title })
    .from(telegramContactProposal)
    .leftJoin(telegramChat, eq(telegramChat.id, telegramContactProposal.chatRowId))
    .where(and(eq(telegramContactProposal.organizationId, orgId), eq(telegramContactProposal.clientId, clientId), eq(telegramContactProposal.status, "open")))
    .orderBy(desc(telegramContactProposal.lastMessageAt))
  return {
    available: true,
    sourceId: bot.sourceId,
    canEdit,
    chats: await viewsOf(orgId, all.filter((r) => boundIds.includes(r.id))),
    otherChats: all.filter((r) => !boundIds.includes(r.id) && GROUP_TYPES.has(r.type) && r.mode !== "internal").map((r) => ({ id: r.id, title: r.title, username: r.username, type: r.type })),
    proposals: proposals.map(({ p, chatTitle }) => ({ id: p.id, tgUserId: p.tgUserId, username: p.username, name: p.name, messageCount: p.messageCount, lastMessageAt: p.lastMessageAt?.toISOString() ?? null, chatTitle })),
  }
}

/**
 * «Новый контакт в <Компания>?» (Q25): `create` = a new contact of the company
 * with this Telegram (name from Telegram unless given); `link` = an existing
 * contact gets this Telegram; `reject` = not a contact (not proposed again).
 * Create / link run as the signed-in user (session-bound `createContact`).
 */
export async function decideTelegramContactProposal(
  orgId: string,
  userId: string,
  proposalId: string,
  input: { action: "create" | "link" | "reject"; contactId?: string; name?: string },
): Promise<{ contactId: string | null }> {
  const [p] = await db.select().from(telegramContactProposal).where(and(eq(telegramContactProposal.id, proposalId), eq(telegramContactProposal.organizationId, orgId))).limit(1)
  if (!p || p.status !== "open") throw new TelegramChatError("Предложение не найдено или уже решено", 404)
  await assertCanBind(orgId, userId, [p.clientId])
  const { setContactTelegramId } = await import("@/server/telegram/directory")
  let contactId: string | null = null
  if (input.action === "create") {
    const { createContact } = await import("@/server/contacts")
    const name = (input.name ?? "").trim() || p.name || (p.username ? `@${p.username}` : "Контакт из Telegram")
    contactId = (await createContact({ name, clientId: p.clientId })).id
  } else if (input.action === "link") {
    const [c] = input.contactId ? await db.select({ id: contact.id }).from(contact).where(and(eq(contact.id, input.contactId), eq(contact.organizationId, orgId))).limit(1) : []
    if (!c) throw new TelegramChatError("Контакт не найден", 404)
    contactId = c.id
  }
  if (contactId) await setContactTelegramId(orgId, contactId, { tgUserId: p.tgUserId, username: p.username }, "manual")
  await db
    .update(telegramContactProposal)
    .set({ status: input.action === "create" ? "created" : input.action === "link" ? "linked" : "rejected", contactId, decidedByUserId: userId, decidedAt: new Date() })
    .where(eq(telegramContactProposal.id, p.id))
  return { contactId }
}

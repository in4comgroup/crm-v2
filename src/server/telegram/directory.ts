import "server-only"

import { randomUUID } from "node:crypto"
import { and, eq, inArray, isNull, ne, notInArray, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { contact, contactAddress, contactCompanyLink, orgIdentityEntry, sourceItem, telegramBinding, telegramChat, telegramChatClient } from "@/db/schema"
import {
  handleKey,
  isTelegramIdOnlyValue,
  resolveTelegramMessage,
  telegramIdValue,
  type ChatBinding,
  type CompanyAccount,
  type ContactTgAddress,
  type ResolveInput,
  type TelegramDirectory,
  type TelegramLearn,
  type TelegramResolved,
  type TgPerson,
} from "@/lib/telegram/resolve"
import { contactDisplaySql } from "@/server/contact-display"

// DB side of the ONE rule per Telegram message (docs/specs/telegram/04 §8 /
// §6, TI1 + TI5): the directory of the org (bindings, staff handles, contact
// Telegram addresses with ids, contact companies), the learned ids written
// back (§6.2), the manual «Связать с контактом», contact cards (F2) and the
// «Дубли Telegram» list. Org-explicit; callers check access.

/** Every Telegram identity the resolver needs, for one org. */
export async function loadTelegramDirectory(orgId: string): Promise<TelegramDirectory> {
  const [bindings, staff, addrRows, aliasRows, links, chatRows] = await Promise.all([
    db
      .select({ tg: telegramBinding.tgUserId, userId: telegramBinding.userId })
      .from(telegramBinding)
      .where(and(eq(telegramBinding.organizationId, orgId), ne(telegramBinding.status, "unbound"))),
    db
      .select({ key: orgIdentityEntry.matchKey, userId: orgIdentityEntry.userId })
      .from(orgIdentityEntry)
      .where(and(eq(orgIdentityEntry.organizationId, orgId), eq(orgIdentityEntry.kind, "person"), eq(orgIdentityEntry.channel, "telegram"))),
    db
      .select({ id: contactAddress.id, contactId: contactAddress.contactId, value: contactAddress.value, externalId: contactAddress.externalId, status: contactAddress.status })
      .from(contactAddress)
      .innerJoin(contact, eq(contact.id, contactAddress.contactId))
      .where(and(eq(contactAddress.organizationId, orgId), eq(contactAddress.kind, "telegram"), notInArray(contact.status, ["deleted", "blocked"]))),
    db
      .select({ id: contact.id, aliases: contact.aliases, clientId: contact.clientId })
      .from(contact)
      .where(and(eq(contact.organizationId, orgId), notInArray(contact.status, ["deleted", "blocked"]))),
    db
      .select({ contactId: contactCompanyLink.contactId, clientId: contactCompanyLink.clientId, isPrimary: contactCompanyLink.isPrimary })
      .from(contactCompanyLink)
      .where(and(eq(contactCompanyLink.organizationId, orgId), eq(contactCompanyLink.status, "current"))),
    // Chat bindings + companies' own accounts (TI4).
    db
      .select({ rowId: telegramChat.id, chatId: telegramChat.chatId, type: telegramChat.type, username: telegramChat.username, mode: telegramChat.mode, clientId: telegramChatClient.clientId, isPrimary: telegramChatClient.isPrimary })
      .from(telegramChat)
      .leftJoin(telegramChatClient, eq(telegramChatClient.chatRowId, telegramChat.id))
      .where(and(eq(telegramChat.organizationId, orgId), ne(telegramChat.mode, "auto"))),
  ])
  const addresses: ContactTgAddress[] = addrRows.map((a) => ({
    addressId: a.id,
    contactId: a.contactId,
    handle: isTelegramIdOnlyValue(a.value) ? null : handleKey(a.value),
    externalId: a.externalId,
    status: a.status === "old" ? "old" : "active",
  }))
  // Legacy aliases «@name» (no address row): matched by name, learned into «Адреса».
  for (const c of aliasRows) {
    for (const al of c.aliases ?? []) {
      if (!al.trim().startsWith("@")) continue
      const h = handleKey(al)
      if (h && !addresses.some((a) => a.contactId === c.id && a.handle === h)) addresses.push({ addressId: null, contactId: c.id, handle: h, externalId: null, status: "active" })
    }
  }
  const contactClients = new Map<string, string[]>()
  for (const c of aliasRows) if (c.clientId) contactClients.set(c.id, [c.clientId])
  for (const l of links) {
    const list = contactClients.get(l.contactId) ?? []
    if (!list.includes(l.clientId)) {
      if (l.isPrimary) list.unshift(l.clientId)
      else list.push(l.clientId)
    }
    contactClients.set(l.contactId, list)
  }
  const chats = new Map<string, ChatBinding>()
  const accounts = new Map<string, CompanyAccount>()
  for (const r of chatRows) {
    if (r.type === "private" || r.type === "unknown") {
      // A company's own account (bound by @name or by its private chat).
      if (r.mode !== "clients") continue
      const a = accounts.get(r.rowId) ?? { tgUserId: r.type === "private" ? r.chatId : null, handle: r.username ?? null, clientIds: [] }
      if (r.clientId && !a.clientIds.includes(r.clientId)) {
        if (r.isPrimary) a.clientIds.unshift(r.clientId)
        else a.clientIds.push(r.clientId)
      }
      accounts.set(r.rowId, a)
      continue
    }
    if (!r.chatId) continue
    const b = chats.get(r.chatId) ?? { rowId: r.rowId, mode: r.mode === "internal" ? "internal" : "clients", clientIds: [] }
    if (r.clientId && !b.clientIds.includes(r.clientId)) {
      if (r.isPrimary) b.clientIds.unshift(r.clientId)
      else b.clientIds.push(r.clientId)
    }
    chats.set(r.chatId, b)
  }
  return {
    chats,
    companyAccounts: [...accounts.values()],
    staffById: new Map(bindings.map((b) => [b.tg, b.userId])),
    staffByHandle: new Map(staff.filter((s) => s.userId).map((s) => [s.key, s.userId!])),
    addresses,
    contactClients,
  }
}

/** Write back what a resolution learned (§6.2). Best effort; never throws. */
export async function applyTelegramLearning(orgId: string, learn: readonly TelegramLearn[]): Promise<void> {
  for (const l of learn) {
    try {
      // Never give an id to a second contact.
      const [holder] = await db
        .select({ contactId: contactAddress.contactId })
        .from(contactAddress)
        .where(and(eq(contactAddress.organizationId, orgId), eq(contactAddress.kind, "telegram"), eq(contactAddress.externalId, l.tgUserId), ne(contactAddress.contactId, l.contactId)))
        .limit(1)
      if (holder) continue
      const now = new Date()
      if (l.kind === "learn_id") {
        if (l.addressId) {
          await db
            .update(contactAddress)
            .set({ externalId: l.tgUserId, lastSeenAt: now })
            .where(and(eq(contactAddress.id, l.addressId), isNull(contactAddress.externalId)))
        } else {
          await db
            .insert(contactAddress)
            .values({ id: randomUUID(), organizationId: orgId, contactId: l.contactId, kind: "telegram", value: l.handle, status: "active", source: "learned", externalId: l.tgUserId, firstSeenAt: now, lastSeenAt: now })
            .onConflictDoUpdate({
              target: [contactAddress.contactId, contactAddress.kind, contactAddress.value],
              set: { externalId: sql`coalesce(${contactAddress.externalId}, ${l.tgUserId})`, lastSeenAt: now },
            })
        }
      } else {
        // A renamed account: the new username = active (with the id), the old one = «old».
        if (l.oldAddressId) {
          await db.update(contactAddress).set({ status: "old", externalId: null, lastSeenAt: now }).where(eq(contactAddress.id, l.oldAddressId))
        }
        await db
          .insert(contactAddress)
          .values({ id: randomUUID(), organizationId: orgId, contactId: l.contactId, kind: "telegram", value: l.newHandle, status: "active", source: "learned", externalId: l.tgUserId, firstSeenAt: now, lastSeenAt: now })
          .onConflictDoUpdate({
            target: [contactAddress.contactId, contactAddress.kind, contactAddress.value],
            set: { status: "active", externalId: l.tgUserId, lastSeenAt: now },
          })
      }
    } catch (e) {
      console.warn("[telegram/directory] learning failed", orgId, l, e)
    }
  }
}

/** The resolver input of a stored Telegram item. */
export function resolveInputOf(meta: unknown, groupPeer?: TgPerson | null): ResolveInput {
  const tg = (((meta ?? {}) as Record<string, unknown>).telegram ?? {}) as Record<string, unknown>
  const f = (tg.from ?? null) as { id?: number | string; username?: string | null; firstName?: string | null; lastName?: string | null } | null
  const from: TgPerson | null = f
    ? { id: f.id != null ? String(f.id) : null, username: f.username ?? null, name: [f.firstName, f.lastName].filter(Boolean).join(" ") || null }
    : null
  const gp = groupPeer ?? personOf(tg.groupPeer)
  const chatId = typeof tg.chatId === "number" || typeof tg.chatId === "string" ? String(tg.chatId) : null
  return { from, forwardOrigin: (tg.forwardOrigin ?? null) as ResolveInput["forwardOrigin"], chatType: typeof tg.chatType === "string" ? tg.chatType : null, chatId, groupPeer: gp }
}

function personOf(v: unknown): TgPerson | null {
  const p = (v ?? null) as { id?: number | string; username?: string | null; firstName?: string | null; lastName?: string | null } | null
  if (!p) return null
  return { id: p.id != null ? String(p.id) : null, username: p.username ?? null, name: [p.firstName, p.lastName].filter(Boolean).join(" ") || null }
}

/** Resolve one item, store `metadata_json.telegram.resolved`, apply the learning. */
export async function stampTelegramResolved(orgId: string, itemId: string, meta: unknown, dir?: TelegramDirectory, groupPeer?: TgPerson | null): Promise<TelegramResolved> {
  const d = dir ?? (await loadTelegramDirectory(orgId))
  const { resolved, learn } = resolveTelegramMessage(resolveInputOf(meta, groupPeer), d)
  await db
    .update(sourceItem)
    .set({ metadataJson: sql`jsonb_set(coalesce(${sourceItem.metadataJson}, '{}'::jsonb), '{telegram,resolved}', ${JSON.stringify(resolved)}::jsonb, true)` })
    .where(and(eq(sourceItem.id, itemId), eq(sourceItem.organizationId, orgId)))
  if (learn.length) await applyTelegramLearning(orgId, learn)
  // TI4: «Новый контакт в …?» (Q25) and binding suggestions by authors (§7.3). Best effort.
  try {
    const { afterTelegramResolution } = await import("@/server/telegram/chats")
    await afterTelegramResolution(orgId, itemId, resolved, resolveInputOf(meta).chatId ?? null)
  } catch (e) {
    console.warn("[telegram/directory] chat follow-ups failed", itemId, e)
  }
  return resolved
}

// ── TI5: «Связать с контактом», contact cards, duplicates ────────────────

export class TelegramContactError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
  }
}

/**
 * Give a Telegram id (+ username) to a contact, verified (manual or a contact
 * card). The id moves away from any other contact (the person decided).
 */
export async function setContactTelegramId(
  orgId: string,
  contactId: string,
  person: { tgUserId: string; username: string | null },
  source: "manual" | "contact_card",
): Promise<void> {
  const now = new Date()
  const value = handleKey(person.username) ?? telegramIdValue(person.tgUserId)
  await db
    .update(contactAddress)
    .set({ externalId: null, status: "old", lastSeenAt: now })
    .where(and(eq(contactAddress.organizationId, orgId), eq(contactAddress.kind, "telegram"), eq(contactAddress.externalId, person.tgUserId), ne(contactAddress.contactId, contactId)))
  // The contact's older id-only row is replaced by the username row.
  if (!isTelegramIdOnlyValue(value)) {
    await db
      .delete(contactAddress)
      .where(and(eq(contactAddress.contactId, contactId), eq(contactAddress.kind, "telegram"), eq(contactAddress.value, telegramIdValue(person.tgUserId))))
  }
  await db
    .insert(contactAddress)
    .values({ id: randomUUID(), organizationId: orgId, contactId, kind: "telegram", value, status: "active", source, externalId: person.tgUserId, verifiedAt: now, firstSeenAt: now, lastSeenAt: now })
    .onConflictDoUpdate({
      target: [contactAddress.contactId, contactAddress.kind, contactAddress.value],
      set: { status: "active", externalId: person.tgUserId, verifiedAt: now, lastSeenAt: now },
    })
}

/**
 * «Связать с контактом» (§6.2): the author of a Telegram item (for a forward
 * the original author) becomes `contactId`'s Telegram; the item's
 * `resolved` is updated (other stored items keep theirs, Q29 = a).
 */
export async function linkTelegramAuthorToContact(orgId: string, itemId: string, contactId: string): Promise<TelegramResolved> {
  const [item] = await db
    .select({ meta: sourceItem.metadataJson })
    .from(sourceItem)
    .where(and(eq(sourceItem.id, itemId), eq(sourceItem.organizationId, orgId)))
    .limit(1)
  const [c] = await db.select({ id: contact.id, status: contact.status }).from(contact).where(and(eq(contact.id, contactId), eq(contact.organizationId, orgId))).limit(1)
  if (!item || !c || c.status === "deleted") throw new TelegramContactError("Сообщение или контакт не найдены", 404)
  const input = resolveInputOf(item.meta)
  if (!input.from && !input.forwardOrigin) throw new TelegramContactError("Это не сообщение Telegram", 400)
  const o = input.forwardOrigin
  const person: TgPerson | null = o ? (o.type === "user" && o.user ? { id: o.user.id != null ? String(o.user.id) : null, username: o.user.username ?? null, name: null } : null) : input.from
  if (!person?.id) throw new TelegramContactError("Автор скрыл свой Telegram — связать нельзя", 400)
  const dir = await loadTelegramDirectory(orgId)
  if (dir.staffById.has(person.id) || (person.username && dir.staffByHandle.has(handleKey(person.username) ?? ""))) {
    throw new TelegramContactError("Это сотрудник организации, а не контакт", 409)
  }
  await setContactTelegramId(orgId, contactId, { tgUserId: person.id, username: person.username }, "manual")
  return stampTelegramResolved(orgId, itemId, item.meta)
}

const phoneKey = (raw: string | null | undefined) => {
  const d = (raw ?? "").replace(/\D/g, "")
  return d.length === 11 && d.startsWith("8") ? `7${d.slice(1)}` : d
}

/**
 * A Telegram contact card (F2: `message.contact` with `user_id` + phone): the
 * phone matches ONE live contact (its phone or an extra phone) → that contact
 * gets the Telegram id. Returns the contact id or null.
 */
export async function learnFromTelegramContactCard(orgId: string, card: { userId: number | null | undefined; phone: string | null | undefined }): Promise<string | null> {
  try {
    const key = phoneKey(card.phone)
    if (!card.userId || key.length < 10) return null
    const [byMain, byExtra] = await Promise.all([
      db
        .select({ id: contact.id })
        .from(contact)
        .where(and(eq(contact.organizationId, orgId), notInArray(contact.status, ["deleted", "blocked"]), sql`regexp_replace(coalesce(${contact.phone}, ''), '\\D', '', 'g') in (${key}, ${"8" + key.slice(1)})`)),
      db
        .select({ id: contactAddress.contactId })
        .from(contactAddress)
        .innerJoin(contact, eq(contact.id, contactAddress.contactId))
        .where(and(eq(contactAddress.organizationId, orgId), eq(contactAddress.kind, "phone"), notInArray(contact.status, ["deleted", "blocked"]), sql`regexp_replace(${contactAddress.value}, '\\D', '', 'g') in (${key}, ${"8" + key.slice(1)})`)),
    ])
    const ids = [...new Set([...byMain, ...byExtra].map((r) => r.id))]
    if (ids.length !== 1) return null
    const dir = await loadTelegramDirectory(orgId)
    if (dir.staffById.has(String(card.userId))) return null
    await setContactTelegramId(orgId, ids[0], { tgUserId: String(card.userId), username: null }, "contact_card")
    return ids[0]
  } catch (e) {
    console.warn("[telegram/directory] contact card learning failed", orgId, e)
    return null
  }
}

/** «Дубли Telegram» (§6.3): live contacts sharing one Telegram id or username. */
export async function listTelegramDuplicates(orgId: string): Promise<{ key: string; label: string; contacts: { id: string; name: string; clientId: string | null }[] }[]> {
  const { telegramDuplicateGroups } = await import("@/lib/telegram/resolve")
  const dir = await loadTelegramDirectory(orgId)
  const groups = telegramDuplicateGroups(dir.addresses)
  const ids = [...new Set(groups.flatMap((g) => g.contactIds))]
  if (!ids.length) return []
  const rows = await db.select({ id: contact.id, name: contactDisplaySql(), clientId: contact.clientId }).from(contact).where(inArray(contact.id, ids))
  const byId = new Map(rows.map((r) => [r.id, r]))
  return groups.map((g) => ({ key: g.key, label: g.label, contacts: g.contactIds.map((id) => byId.get(id)).filter((x): x is { id: string; name: string; clientId: string | null } => !!x) }))
}

export type TelegramItemAuthorView = {
  /** The item is a Telegram message (a root item). */
  telegram: boolean
  kind: "member" | "contact" | "company_account" | "unknown" | null
  name: string | null
  username: string | null
  /** The author has a Telegram id (can be linked). */
  hasId: boolean
  contactId: string | null
  contactName: string | null
  via: string | null
}

/** Who wrote a Telegram item, for «Связать с контактом» (resolved now, nothing stored). */
export async function getTelegramItemAuthor(orgId: string, itemId: string): Promise<TelegramItemAuthorView> {
  const [item] = await db
    .select({ meta: sourceItem.metadataJson })
    .from(sourceItem)
    .where(and(eq(sourceItem.id, itemId), eq(sourceItem.organizationId, orgId)))
    .limit(1)
  const empty: TelegramItemAuthorView = { telegram: false, kind: null, name: null, username: null, hasId: false, contactId: null, contactName: null, via: null }
  if (!item) throw new TelegramContactError("Сообщение не найдено", 404)
  const input = resolveInputOf(item.meta)
  if (!input.from && !input.forwardOrigin) return empty
  const { resolved } = resolveTelegramMessage(input, await loadTelegramDirectory(orgId))
  const a = resolved.author
  const [c] = a.contactId ? await db.select({ name: contactDisplaySql() }).from(contact).where(eq(contact.id, a.contactId)).limit(1) : []
  return { telegram: true, kind: a.kind, name: a.name, username: a.username, hasId: !!a.tgUserId, contactId: a.contactId ?? null, contactName: c?.name ?? null, via: a.via }
}

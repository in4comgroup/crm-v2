// The ONE rule per Telegram message (docs/specs/telegram/04-identity-and-chats.md
// §8, TI1): who wrote it and which company it is about. PURE (no DB): the
// server loads the directory (src/server/telegram/directory.ts) and stores the
// result as `metadata_json.telegram.resolved`; attribution, the topics
// counterparty, document links and company activity read it.
//
// Author steps (§8.1; unique hits only):
//   1 tg user id = an active staff binding                → member  `staff_binding`
//   2 username   = a staff handle («us» registry person)  → member  `staff_handle`
//   3 tg user id = a contact's Telegram address id         → contact `contact_id`
//   4 username   = a contact's Telegram address / alias    → contact `contact_handle` (+ learn the id, §6.2)
//   5 tg user id / username = a company's own account (a private chat bound
//     to a company, TI4)                                  → company_account
//   6 nothing                                               → unknown
// A forward: the ORIGINAL author (hidden user / chat → unknown).
// Counterparty (§8.2 / §7.4): a chat bound to companies (mode clients) decides
// the COMPANY (Q19): the author contact's company when it is in the set, else
// the primary; mode internal → none (internal); else (auto) the author
// contact's / company account's companies, or for OUR message in a group the
// group peer's (the `groupPeer` guess).

/** «tg:<id>» = a Telegram address of a person with no username. */
export const TG_ID_PREFIX = "tg:"

export function telegramIdValue(tgUserId: string): string {
  return `${TG_ID_PREFIX}${tgUserId}`
}

export function isTelegramIdOnlyValue(value: string): boolean {
  return value.startsWith(TG_ID_PREFIX)
}

/** Russian label of a stored Telegram address value: «@name» or «Telegram id 123». */
export function telegramAddressLabel(value: string): string {
  return isTelegramIdOnlyValue(value) ? `Telegram id ${value.slice(TG_ID_PREFIX.length)}` : `@${value}`
}

/** A username as a match key: no «@», lower-case. */
export function handleKey(raw: string | null | undefined): string | null {
  const h = (raw ?? "").trim().replace(/^@/, "").toLowerCase()
  return /^[a-z0-9_]{3,}$/.test(h) ? h : null
}

export type TgPerson = { id: string | null; username: string | null; name: string | null }

/** One Telegram address of a contact (or a legacy alias «@name», `addressId` null). */
export type ContactTgAddress = { addressId: string | null; contactId: string; handle: string | null; externalId: string | null; status: "active" | "old" }

/** A chat bound by a person (§7.1): mode + companies (primary first). */
export type ChatBinding = { rowId: string; mode: "auto" | "clients" | "internal"; clientIds: string[] }

/** A company's own Telegram account (a private chat bound to a company, author step 5). */
export type CompanyAccount = { tgUserId: string | null; handle: string | null; clientIds: string[] }

export type TelegramDirectory = {
  /** tg user id → member user id (active / blocked bindings). */
  staffById: Map<string, string>
  /** username → member user id (registry `person` / telegram). */
  staffByHandle: Map<string, string>
  /** Telegram addresses of live contacts. */
  addresses: ContactTgAddress[]
  /** contact id → its current companies (primary first). */
  contactClients: Map<string, string[]>
  /** Telegram chat id → its binding (groups; TI4). Absent = auto. */
  chats?: Map<string, ChatBinding>
  /** Companies' own accounts (TI4). */
  companyAccounts?: CompanyAccount[]
}

export type AuthorVia = "staff_binding" | "staff_handle" | "contact_id" | "contact_handle" | "company_account" | "unknown" | "hidden_forward" | "chat_forward" | "no_author"

export type ResolvedAuthor = {
  kind: "member" | "contact" | "company_account" | "unknown"
  userId?: string
  contactId?: string
  /** Contact: its own main company; company account: its company. */
  clientId?: string
  tgUserId: string | null
  username: string | null
  name: string | null
  via: AuthorVia
}

export type TelegramResolved = {
  v: 1
  author: ResolvedAuthor
  /** Companies the message is about, main first. */
  counterpartyClientIds: string[]
  /** The contact on the other side (the author contact, or the group peer of our message). */
  counterpartyContactId: string | null
  /** The author was matched by id (binding / contact id), not by a username. */
  verified: boolean
  forward: boolean
  /** The chat's binding when it is not auto (TI4). */
  chat?: ChatBinding | null
  /** Chat mode internal: our people only (direction internal). */
  internal?: boolean
  /** Data-quality notes, e.g. `non_member_in_internal_chat` (Q28). */
  warnings?: string[]
  /** Q25: an unknown author with an id in a chat bound to a company → «Новый контакт в …?». */
  proposeContactFor?: string | null
}

/** What the server should write after a resolution (§6.2). */
export type TelegramLearn =
  | { kind: "learn_id"; contactId: string; addressId: string | null; handle: string; tgUserId: string }
  | { kind: "rename"; contactId: string; tgUserId: string; newHandle: string; oldAddressId: string | null }

export type ResolveInput = {
  from: TgPerson | null
  forwardOrigin: { type: string; user?: { id?: number | string | null; username?: string | null; firstName?: string | null; lastName?: string | null }; senderUserName?: string; chat?: { title?: string | null } } | null
  chatType: string | null
  /** Telegram chat id of the message (its binding, TI4). */
  chatId?: string | null
  /** Our message in a group: the latest client author of the chat (stamped at parse). */
  groupPeer?: TgPerson | null
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)]
}

function contactsWhere(dir: TelegramDirectory, pred: (a: ContactTgAddress) => boolean): string[] {
  return uniq(dir.addresses.filter(pred).map((a) => a.contactId))
}

/** Author steps 1–4, 6 for one person; `learn` = what to write back. */
export function resolveTelegramPerson(p: TgPerson, dir: TelegramDirectory): { author: ResolvedAuthor; learn: TelegramLearn[] } {
  const id = p.id ? String(p.id) : null
  const handle = handleKey(p.username)
  const base = { tgUserId: id, username: p.username ? p.username.replace(/^@/, "") : null, name: p.name }
  const learn: TelegramLearn[] = []

  if (id && dir.staffById.has(id)) return { author: { kind: "member", userId: dir.staffById.get(id)!, ...base, via: "staff_binding" }, learn }
  if (handle && dir.staffByHandle.has(handle)) return { author: { kind: "member", userId: dir.staffByHandle.get(handle)!, ...base, via: "staff_handle" }, learn }

  const byId = id ? contactsWhere(dir, (a) => a.externalId === id) : []
  if (byId.length === 1) {
    const contactId = byId[0]
    // A new username for a known id → the new one becomes active, the old one «old» (§6.2).
    if (handle) {
      const mine = dir.addresses.filter((a) => a.contactId === contactId)
      const current = mine.find((a) => a.externalId === id)
      if (!mine.some((a) => a.handle === handle && a.status === "active")) {
        learn.push({ kind: "rename", contactId, tgUserId: id!, newHandle: handle, oldAddressId: current?.addressId ?? null })
      }
    }
    return { author: { kind: "contact", contactId, clientId: dir.contactClients.get(contactId)?.[0], ...base, via: "contact_id" }, learn }
  }

  if (handle) {
    const byHandle = contactsWhere(dir, (a) => a.handle === handle && a.status === "active")
    if (byHandle.length === 1) {
      const contactId = byHandle[0]
      // Learn the id once: only when no contact holds it yet (else duplicates grow).
      if (id && byId.length === 0) {
        const addr = dir.addresses.find((a) => a.contactId === contactId && a.handle === handle && a.addressId) ?? null
        if (!addr || !addr.externalId) learn.push({ kind: "learn_id", contactId, addressId: addr?.addressId ?? null, handle, tgUserId: id })
      }
      return { author: { kind: "contact", contactId, clientId: dir.contactClients.get(contactId)?.[0], ...base, via: "contact_handle" }, learn }
    }
  }
  // 5. A company's own account (TI4): unique hit by id, else by username.
  const accounts = dir.companyAccounts ?? []
  const accById = id ? accounts.filter((a) => a.tgUserId === id) : []
  const acc = accById.length === 1 ? accById[0] : handle ? (accounts.filter((a) => a.handle === handle).length === 1 ? accounts.find((a) => a.handle === handle) : undefined) : undefined
  if (acc && acc.clientIds.length) return { author: { kind: "company_account", clientId: acc.clientIds[0], ...base, via: "company_account" }, learn }
  return { author: { kind: "unknown", ...base, via: "unknown" }, learn }
}

function originPerson(o: NonNullable<ResolveInput["forwardOrigin"]>): TgPerson | null {
  if (o.type !== "user" || !o.user) return null
  const name = [o.user.firstName, o.user.lastName].filter(Boolean).join(" ") || null
  return { id: o.user.id != null ? String(o.user.id) : null, username: o.user.username ?? null, name }
}

export function resolveTelegramMessage(input: ResolveInput, dir: TelegramDirectory): { resolved: TelegramResolved; learn: TelegramLearn[] } {
  const forward = !!input.forwardOrigin
  let author: ResolvedAuthor
  let learn: TelegramLearn[] = []
  if (input.forwardOrigin) {
    const p = originPerson(input.forwardOrigin)
    if (p) ({ author, learn } = resolveTelegramPerson(p, dir))
    else {
      const o = input.forwardOrigin
      const name = o.type === "hidden_user" ? (o.senderUserName ?? null) : (o.chat?.title ?? null)
      author = { kind: "unknown", tgUserId: null, username: null, name, via: o.type === "hidden_user" ? "hidden_forward" : "chat_forward" }
    }
  } else if (input.from) {
    ;({ author, learn } = resolveTelegramPerson(input.from, dir))
  } else {
    author = { kind: "unknown", tgUserId: null, username: null, name: null, via: "no_author" }
  }

  let counterpartyContactId: string | null = null
  let counterpartyClientIds: string[] = []
  const chat = input.chatId ? (dir.chats?.get(String(input.chatId)) ?? null) : null
  const warnings: string[] = []
  let proposeContactFor: string | null = null
  const authorClients = author.kind === "contact" && author.contactId ? (dir.contactClients.get(author.contactId) ?? []) : author.kind === "company_account" && author.clientId ? [author.clientId] : []

  if (chat?.mode === "internal") {
    // Our people only: no company; a non-member is a data-quality note (Q28).
    if (author.kind !== "member") warnings.push("non_member_in_internal_chat")
  } else if (chat?.mode === "clients" && chat.clientIds.length) {
    // The binding decides the COMPANY (Q19); the author decides the PERSON.
    const own = authorClients.find((c) => chat.clientIds.includes(c)) ?? null
    const main = own ?? chat.clientIds[0]
    counterpartyClientIds = [main, ...chat.clientIds.filter((c) => c !== main)]
    if (author.kind === "contact" && own) counterpartyContactId = author.contactId ?? null
    if (author.kind === "unknown" && author.tgUserId && !forward) proposeContactFor = chat.clientIds[0]
  } else if (author.kind === "contact" && author.contactId) {
    counterpartyContactId = author.contactId
    counterpartyClientIds = authorClients
  } else if (author.kind === "company_account") {
    counterpartyClientIds = authorClients
  } else if (author.kind === "member" && !forward && (input.chatType === "group" || input.chatType === "supergroup") && input.groupPeer) {
    const peer = resolveTelegramPerson(input.groupPeer, dir).author
    if (peer.kind === "contact" && peer.contactId) {
      counterpartyContactId = peer.contactId
      counterpartyClientIds = dir.contactClients.get(peer.contactId) ?? []
    } else if (peer.kind === "company_account" && peer.clientId) {
      counterpartyClientIds = [peer.clientId]
    }
  }
  return {
    resolved: {
      v: 1,
      author,
      counterpartyClientIds,
      counterpartyContactId,
      verified: author.via === "staff_binding" || author.via === "contact_id",
      forward,
      ...(chat && chat.mode !== "auto" ? { chat } : {}),
      ...(chat?.mode === "internal" ? { internal: true } : {}),
      ...(warnings.length ? { warnings } : {}),
      ...(proposeContactFor ? { proposeContactFor } : {}),
    },
    learn,
  }
}

/** The stored result, tolerant (old rows have none). */
export function readTelegramResolved(meta: unknown): TelegramResolved | null {
  const tg = ((meta ?? {}) as Record<string, unknown>).telegram as Record<string, unknown> | undefined
  const r = tg?.resolved as TelegramResolved | undefined
  return r && r.v === 1 && r.author ? r : null
}

/** Groups of live contacts that share one Telegram id or username («Дубли Telegram», §6.3). */
export function telegramDuplicateGroups(addresses: readonly ContactTgAddress[]): { key: string; label: string; contactIds: string[] }[] {
  const groups = new Map<string, Set<string>>()
  const add = (k: string, c: string) => {
    if (!groups.has(k)) groups.set(k, new Set())
    groups.get(k)!.add(c)
  }
  for (const a of addresses) {
    if (a.status !== "active") continue
    if (a.externalId) add(`id:${a.externalId}`, a.contactId)
    if (a.handle) add(`h:${a.handle}`, a.contactId)
  }
  const out: { key: string; label: string; contactIds: string[] }[] = []
  const seen = new Set<string>()
  for (const [k, set] of groups) {
    if (set.size < 2) continue
    const ids = [...set].sort()
    const sig = ids.join(",")
    if (seen.has(sig)) continue
    seen.add(sig)
    out.push({ key: k, label: k.startsWith("id:") ? `Telegram id ${k.slice(3)}` : `@${k.slice(2)}`, contactIds: ids })
  }
  return out
}

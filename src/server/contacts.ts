"use server"

import {
  manualContactNames,
  namesFromManualEdit,
  sourceContactNames,
  type NameNativeSource,
} from "@/lib/contact-names"
import { contactDisplaySql } from "@/server/contact-display"
import { db } from "@/db/drizzle"
import { contact, client, member, user, type EntityStatus } from "@/db/schema"
import { and, asc, eq, desc, ilike, inArray, isNotNull, isNull, or } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { getServerSession } from "@/lib/get-session"
import { randomUUID } from "crypto"
import { onEntityStatusChanged } from "@/server/topics/integration"
import { parseCustomFilters } from "@/lib/custom-fields"
import { customFilterConditions, listCustomFields } from "@/server/custom-fields"
import {
  contactManagedAtInputSchema,
  managedAtColumns,
  readManagedAt,
  sameManagedAt,
  type ContactManagedAt,
  type ContactManagedAtInput,
} from "@/lib/contact-managed-at"
import { listResponsibleMembers } from "@/server/client-responsible"
import {
  contactLinkedToClientCondition,
  onContactClientEdited,
  otherCurrentCompanies,
  resolveMergedContactId,
} from "@/server/contact-links"

export type ContactRow = {
  id: string
  name: string
  nameNative: string | null
  aliases: string[] | null
  phone: string | null
  email: string | null
  position: string | null
  clientId: string | null
  clientName: string | null
  status: EntityStatus
  userId: string
  userName: string | null
  organizationId: string
  createdAt: string
  updatedAt: string
  /**
   * «Ведётся на уровне» (docs/specs/clients-contacts/07): a member or a person
   * of our org. Set on rows of this module; undefined on contact rows built
   * elsewhere (e.g. `ClientRow.contacts`) — the edit form then loads it.
   */
  managedAt?: ContactManagedAt | null
  /** Custom field values («Поля») — only on `listContactsPaged` rows (list columns). */
  customValues?: Record<string, unknown>
  /** Other CURRENT companies (link rows; primary = clientId) — only on `listContactsPaged` rows. */
  otherCompanies?: { clientId: string; clientName: string; relation: string }[]
}

async function requireOrgContext() {
  const session = await getServerSession()
  if (!session) throw new Error("Unauthorized")
  const activeOrgId = session.session.activeOrganizationId
  if (!activeOrgId) throw new Error("No active organization")
  return { session, activeOrgId }
}

async function assertContactInOrg(contactId: string, organizationId: string) {
  const existing = await db
    .select()
    .from(contact)
    .where(eq(contact.id, contactId))
    .limit(1)
  const current = existing[0]
  if (!current) throw new Error("Contact not found")
  if (current.organizationId !== organizationId) {
    throw new Error("Unauthorized")
  }
  return current
}

async function assertClientIfProvided(
  clientId: string | null | undefined,
  organizationId: string,
) {
  if (!clientId) return
  const existing = await db
    .select()
    .from(client)
    .where(eq(client.id, clientId))
    .limit(1)
  const current = existing[0]
  if (!current || current.organizationId !== organizationId) {
    throw new Error("Invalid client")
  }
}

// «Ведётся на уровне»: the referenced member's name + whether they are still
// a member of the contact's org.
const managedUser = alias(user, "contact_managed_user")
const managedMember = alias(member, "contact_managed_member")

const contactSelect = {
  contact,
  userName: user.name,
  clientName: client.name,
  managedUserName: managedUser.name,
  managedMemberId: managedMember.id,
}

type ContactSelectRow = {
  contact: typeof contact.$inferSelect
  userName: string | null
  clientName: string | null
  managedUserName: string | null
  managedMemberId: string | null
}

function contactFrom() {
  return db
    .select(contactSelect)
    .from(contact)
    .leftJoin(user, eq(contact.userId, user.id))
    .leftJoin(client, eq(contact.clientId, client.id))
    .leftJoin(managedUser, eq(managedUser.id, contact.managedAtUserId))
    .leftJoin(
      managedMember,
      and(eq(managedMember.userId, contact.managedAtUserId), eq(managedMember.organizationId, contact.organizationId)),
    )
}

function toContactRow(r: ContactSelectRow): ContactRow {
  return {
    id: r.contact.id,
    name: r.contact.name,
    nameNative: r.contact.nameNative,
    aliases: r.contact.aliases,
    phone: r.contact.phone,
    email: r.contact.email,
    position: r.contact.position,
    clientId: r.contact.clientId,
    clientName: r.clientName,
    status: r.contact.status,
    userId: r.contact.userId,
    userName: r.userName,
    organizationId: r.contact.organizationId,
    createdAt: r.contact.createdAt.toISOString(),
    updatedAt: r.contact.updatedAt.toISOString(),
    managedAt: readManagedAt(r.contact, r.contact.managedAtUserId
      ? { name: r.managedUserName, isMember: !!r.managedMemberId }
      : null),
  }
}

/** Validates «Ведётся на уровне»: a member must be a human member of the org. */
async function resolveManagedAtInput(organizationId: string, raw: ContactManagedAtInput | null) {
  const parsed = contactManagedAtInputSchema.safeParse(raw)
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid managedAt")
  const value = parsed.data
  if (value?.kind === "member") {
    const members = await listResponsibleMembers(organizationId)
    if (!members.some((m) => m.userId === value.userId)) {
      throw new Error("Сотрудник не найден в организации")
    }
  }
  return managedAtColumns(value)
}

export type ManagedAtOptions = {
  /** Human members of the active org (never «Агент», banned left out). */
  members: { userId: string; name: string }[]
  /** People of our org already used on contacts (not users) — for the autocomplete. */
  people: { name: string; position: string | null }[]
}

/** Options of the «Ведётся на уровне» control (any member of the active org). */
export async function listManagedAtOptions(): Promise<ManagedAtOptions> {
  const { activeOrgId } = await requireOrgContext()
  const [members, people] = await Promise.all([
    listResponsibleMembers(activeOrgId),
    db
      .selectDistinct({ name: contact.managedAtPersonName, position: contact.managedAtPersonPosition })
      .from(contact)
      .where(and(eq(contact.organizationId, activeOrgId), isNotNull(contact.managedAtPersonName)))
      .orderBy(contact.managedAtPersonName)
      .limit(200),
  ])
  return {
    members: members.filter((m) => !m.banned).map((m) => ({ userId: m.userId, name: m.name })),
    people: people.map((p) => ({ name: p.name ?? "", position: p.position })).filter((p) => p.name),
  }
}

export async function listContacts(): Promise<ContactRow[]> {
  const { activeOrgId } = await requireOrgContext()

  const rows = await contactFrom()
    .where(eq(contact.organizationId, activeOrgId))
    .orderBy(desc(contact.updatedAt))

  return rows.map(toContactRow)
}

export async function getContact(contactId: string): Promise<ContactRow | null> {
  const { activeOrgId } = await requireOrgContext()
  // A merged record resolves to the kept contact (docs/specs/clients-contacts/04 §3.3).
  contactId = await resolveMergedContactId(activeOrgId, contactId)

  const rows = await contactFrom()
    .where(and(eq(contact.id, contactId), eq(contact.organizationId, activeOrgId)))
    .limit(1)

  const r = rows[0]
  return r ? toContactRow(r) : null
}

// Standalone «Контакты» page: server-paginated, alphabetical (the one list
// in the app that does NOT default to updatedAt desc — the task explicitly
// asked for a plain alphabetical directory). `listContacts()` above stays
// untouched — discovery and `ClientRow.contacts` assembly still use it.
export async function listContactsPaged(params: {
  q?: string
  status?: EntityStatus | "all"
  clientId?: string | "none" | "all"
  /** Company filter also matches FORMER links («Включая бывших»). */
  includeFormer?: boolean
  /** Custom field filters, `?cf=` JSON (docs/specs/clients-contacts §3.5). */
  customFilters?: string | null
  limit?: number
  offset?: number
}): Promise<{ rows: ContactRow[]; total: number }> {
  const { activeOrgId } = await requireOrgContext()
  const limit = Math.min(Math.max(params.limit ?? 25, 1), 100)
  const offset = Math.max(params.offset ?? 0, 0)

  const conditions = [eq(contact.organizationId, activeOrgId)]
  if (params.status && params.status !== "all") {
    conditions.push(eq(contact.status, params.status))
  } else {
    // Default (no explicit status picked): hide deleted/blocked, same
    // convention as the Companies feed.
    conditions.push(inArray(contact.status, ["active", "initial", "suspended"]))
  }
  const q = params.q?.trim()
  if (q) {
    conditions.push(
      or(
        ilike(contact.name, `%${q}%`),
        ilike(contact.nameNative, `%${q}%`),
        ilike(contact.email, `%${q}%`),
      )!,
    )
  }
  if (params.clientId === "none") {
    conditions.push(isNull(contact.clientId))
  } else if (params.clientId && params.clientId !== "all") {
    // Every CURRENT link (docs/specs/clients-contacts/04 §6, Q11), plus former
    // ones with «Включая бывших».
    conditions.push(contactLinkedToClientCondition(params.clientId, !!params.includeFormer))
  }

  if (params.customFilters) {
    const defs = await listCustomFields(activeOrgId, "contact")
    conditions.push(...customFilterConditions("contact", parseCustomFilters(params.customFilters, defs), defs))
  }

  const where = and(...conditions)

  const [rows, totalRows] = await Promise.all([
    contactFrom()
      .where(where)
      // Alphabetical by the SHOWN name («Имя на родном языке», 2026-11-22).
      .orderBy(asc(contactDisplaySql()))
      .limit(limit)
      .offset(offset),
    db.select({ id: contact.id }).from(contact).where(where),
  ])

  const others = await otherCurrentCompanies(
    activeOrgId,
    rows.map((r) => ({ id: r.contact.id, clientId: r.contact.clientId })),
  )

  return {
    total: totalRows.length,
    rows: rows.map((r) => ({
      ...toContactRow(r),
      customValues: (r.contact.customValues ?? {}) as Record<string, unknown>,
      otherCompanies: others.get(r.contact.id) ?? [],
    })),
  }
}

export type ClientOption = { id: string; name: string }

export async function listClientOptions(): Promise<ClientOption[]> {
  const { activeOrgId } = await requireOrgContext()
  const rows = await db
    .select({ id: client.id, name: client.name })
    .from(client)
    .where(
      and(
        eq(client.organizationId, activeOrgId),
        // Include `initial` (New) clients, not just `active` — otherwise a
        // contact linked to a freshly-discovered New company has no matching
        // <SelectItem> in the edit dialog, so the selector renders empty and
        // the existing link looks absent. Matches the `["active","initial"]`
        // convention used by deals/orders/tasks selectors.
        inArray(client.status, ["active", "initial"]),
      ),
    )
    .orderBy(client.name)
  return rows
}

/** Trim, drop empties + dups; return null for an empty list. */
function cleanAliases(raw: string[] | null | undefined): string[] | null {
  if (!Array.isArray(raw)) return null
  const out: string[] = []
  const seen = new Set<string>()
  for (const a of raw) {
    const t = (typeof a === "string" ? a : "").trim()
    if (!t) continue
    const lower = t.toLowerCase()
    if (seen.has(lower)) continue
    seen.add(lower)
    out.push(t)
  }
  return out.length > 0 ? out : null
}

export async function createContact(data: {
  /** «Системное имя». Optional for a person: the copy of `nameNative`. */
  name?: string | null
  /** «Имя на родном языке» = the shown name (required for a person). */
  nameNative?: string | null
  /**
   * Who gives the names (src/lib/contact-names.ts): `manual` (default) = a
   * person — the native name is theirs; `source` = a source (Telegram
   * profile, a business card in the AI chat) — `name` is the account name,
   * `nameNative` the name found in the content (else the same value).
   */
  namesFrom?: NameNativeSource
  aliases?: string[] | null
  phone?: string | null
  email?: string | null
  position?: string | null
  clientId?: string | null
  status?: EntityStatus
  managedAt?: ContactManagedAtInput | null
}) {
  const { session, activeOrgId } = await requireOrgContext()
  if (!data.name?.trim() && !data.nameNative?.trim()) throw new Error("Name is required")
  const names =
    data.namesFrom === "source"
      ? sourceContactNames({ displayName: data.name, signatureName: data.nameNative, email: data.email })
      : manualContactNames(data.nameNative?.trim() || data.name?.trim() || "", data.name)

  await assertClientIfProvided(data.clientId, activeOrgId)
  const managed = data.managedAt ? await resolveManagedAtInput(activeOrgId, data.managedAt) : null

  const id = randomUUID()
  const now = new Date()
  await db.insert(contact).values({
    id,
    // «Имя на родном языке» = the shown name; «Системное имя» = its copy for
    // a person, the account name for a source (2026-11-22).
    name: names.name,
    nameNative: names.nameNative,
    nameNativeSource: names.nameNativeSource,
    aliases: cleanAliases(data.aliases),
    phone: data.phone?.trim() || null,
    email: data.email?.trim() || null,
    position: data.position?.trim() || null,
    clientId: data.clientId || null,
    status: data.status ?? "active",
    userId: session.user.id,
    ...(managed ? { ...managed, managedAtSetByUserId: session.user.id, managedAtSetAt: now } : {}),
    organizationId: activeOrgId,
    createdAt: now,
    updatedAt: now,
  })
  return { id }
}

/**
 * The names on an update (2026-11-22, src/lib/contact-names.ts):
 * - a new «Имя на родном языке» (a person in the form, an AI chat card the
 *   person confirmed) → `manual`; «Системное имя» follows it while it was the
 *   copy of the old native name. Empty = unchanged.
 * - only `name` («Системное имя», code paths) → set it; a native name that is
 *   empty or the copy of the old name follows it.
 */
function namesPatch(
  current: { name: string; nameNative: string | null },
  data: { name?: string; nameNative?: string | null },
): { name?: string; nameNative?: string; nameNativeSource?: NameNativeSource } {
  const native = data.nameNative?.trim() ?? ""
  if (native) {
    const edit = namesFromManualEdit(current, native)
    return data.name?.trim() ? { ...edit, name: data.name.trim() } : edit
  }
  if (data.name !== undefined) {
    const nextName = data.name.trim()
    const stored = (current.nameNative ?? "").trim()
    return !stored || stored === current.name ? { name: nextName, nameNative: nextName } : { name: nextName }
  }
  return {}
}

export async function updateContact(
  contactId: string,
  data: {
    name?: string
    nameNative?: string | null
    aliases?: string[] | null
    phone?: string | null
    email?: string | null
    position?: string | null
    clientId?: string | null
    status?: EntityStatus
    /** undefined = unchanged, null = clear. */
    managedAt?: ContactManagedAtInput | null
  },
) {
  const { session, activeOrgId } = await requireOrgContext()
  const current = await assertContactInOrg(contactId, activeOrgId)

  // «Ведётся на уровне»: who / when is stamped only when the value changes.
  let managedPatch: Record<string, unknown> = {}
  if (data.managedAt !== undefined) {
    const next = await resolveManagedAtInput(activeOrgId, data.managedAt)
    if (!sameManagedAt(current, next)) {
      const cleared = !next.managedAtUserId && !next.managedAtPersonName
      managedPatch = {
        ...next,
        managedAtSetByUserId: cleared ? null : session.user.id,
        managedAtSetAt: cleared ? null : new Date(),
      }
    }
  }

  if (data.name !== undefined && !data.name.trim()) {
    throw new Error("Name is required")
  }
  if (data.clientId !== undefined) {
    await assertClientIfProvided(data.clientId, activeOrgId)
    // Keep `contact_company_link` in step: with link rows, a form change of
    // the company corrects the primary link (moves go through «Компании»).
    await onContactClientEdited(activeOrgId, contactId, data.clientId || null)
  }

  await db
    .update(contact)
    .set({
      ...namesPatch(current, data),
      ...(data.aliases !== undefined
        ? { aliases: cleanAliases(data.aliases) }
        : {}),
      ...(data.phone !== undefined
        ? { phone: data.phone?.trim() || null }
        : {}),
      ...(data.email !== undefined
        ? { email: data.email?.trim() || null }
        : {}),
      ...(data.position !== undefined
        ? { position: data.position?.trim() || null }
        : {}),
      ...(data.clientId !== undefined
        ? { clientId: data.clientId || null }
        : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...managedPatch,
    })
    .where(eq(contact.id, contactId))

  // Topics engine: a deleted / blocked contact leaves its topics.
  await onEntityStatusChanged(activeOrgId, { contactIds: [contactId] }, data.status, session.user.id)
}

import "server-only"

import { and, asc, count, eq, inArray, isNotNull, ne, or, isNull } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { member, organization, source, user } from "@/db/schema"
import { defaultDiscoveryApplyInput } from "@/lib/discovery-default-pick"
import { applyDiscoveryForOrg, previewDiscoveryForOrg } from "@/server/discovery-core"
import { notify } from "@/server/notifications/engine"
import { getOrgSetting, listOrgsWithSetting, setOrgSetting } from "@/server/org-settings"
import { ensureSystemActor } from "@/server/topics/system-actor"

// Automatic «Найти в источниках» (product owner, 2026-11-24): when the org
// setting `discovery.autoApply` is on, every daily pipeline run (after parse,
// all orgs) and every hourly topics intake (after parse, orgs in topics mode
// `shadow` / `on`) scans the parsed items not scanned yet and applies the
// DEFAULT choice of the dialog (`src/lib/discovery-default-pick.ts`: high /
// medium confidence, no possible duplicate / move). Creator = «Агент» (the
// org's system actor), «Ответственный» of new companies = the org owner.
// New rows get status `initial`, like a manual run. The scanned items are
// stamped like «Применить» in the dialog: low-confidence candidates stay
// reachable through the dialog's «Повторно просканировать».
// One summary notification `discovery.new_records` to the owner.

export type AutoDiscoveryOrgResult =
  | { skipped: string }
  | {
      scanned: number
      clientsCreated: number
      clientsRevived: number
      contactsCreated: number
      contactsRevived: number
      linksApplied: number
      /** Candidates left for a person (low confidence / possible duplicate). */
      leftForReview: number
    }

/** The org's owner who becomes «Ответственный» (oldest human owner). */
async function orgOwnerId(orgId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: member.userId })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(
      and(
        eq(member.organizationId, orgId),
        eq(member.role, "owner"),
        ne(user.role, "agent"),
        or(isNull(user.banned), eq(user.banned, false)),
      ),
    )
    .orderBy(asc(member.createdAt))
    .limit(1)
  return row?.id ?? null
}

/** One org. Checks the setting unless `force` (admin «Запустить сейчас»). */
export async function runAutoDiscoveryForOrg(
  orgId: string,
  opts: { force?: boolean } = {},
): Promise<AutoDiscoveryOrgResult> {
  if (!opts.force && !(await getOrgSetting(orgId, "discovery.autoApply"))) return { skipped: "off" }
  const preview = await previewDiscoveryForOrg(orgId, { period: "all" })
  if (preview.scannedRowCount === 0) return { skipped: "nothing new" }

  const ownerId = await orgOwnerId(orgId)
  const agentId = await ensureSystemActor(orgId)
  const input = defaultDiscoveryApplyInput(preview)
  const r = await applyDiscoveryForOrg(orgId, { userId: agentId, responsibleUserId: ownerId ?? agentId }, input)
  const leftForReview =
    preview.clientCandidates.length -
    input.selectedClientKeys.length +
    (preview.contactCandidates.length - input.selectedContactEmails.length)

  const companies = r.clientsCreated + r.clientsRevived
  const contacts = r.contactsCreated + r.contactsRevived
  if (ownerId && companies + contacts > 0) {
    const parts = [
      companies > 0 ? `компаний: ${companies}` : null,
      contacts > 0 ? `контактов: ${contacts}` : null,
    ].filter(Boolean)
    await notify(orgId, {
      kind: "discovery.new_records",
      userIds: [ownerId],
      title: "Из источников созданы компании и контакты",
      body:
        `Автоматически создано ${parts.join(", ")}` +
        (r.linksApplied > 0 ? `, связей контакт — компания: ${r.linksApplied}` : "") +
        (leftForReview > 0 ? `. Ещё ${leftForReview} ждут проверки в «Найти в источниках».` : "."),
      href: "/clients",
      dedupeKey: `discovery.new_records:${new Date().toISOString().slice(0, 13)}`,
      payload: { companies, contacts, links: r.linksApplied, leftForReview },
    })
  }
  return {
    scanned: preview.scannedRowCount,
    clientsCreated: r.clientsCreated,
    clientsRevived: r.clientsRevived,
    contactsCreated: r.contactsCreated,
    contactsRevived: r.contactsRevived,
    linksApplied: r.linksApplied,
    leftForReview,
  }
}

/** Every org with the setting on (daily pipeline). One failure never stops the others. */
export async function runAutoDiscoveryAllOrgs(): Promise<{
  orgs: number
  created: number
  failed: { orgId: string; message: string }[]
}> {
  const orgIds = (await listOrgsWithSetting("discovery.autoApply")).filter((r) => r.value).map((r) => r.organizationId)
  let created = 0
  const failed: { orgId: string; message: string }[] = []
  for (const orgId of orgIds) {
    try {
      const r = await runAutoDiscoveryForOrg(orgId)
      if (!("skipped" in r)) created += r.clientsCreated + r.contactsCreated + r.clientsRevived + r.contactsRevived
    } catch (e) {
      failed.push({ orgId, message: e instanceof Error ? e.message : String(e) })
    }
  }
  return { orgs: orgIds.length, created, failed }
}

// ── Settings: owner (Sources → «Управление») + platform admin (/settings) ──

export class AutoDiscoveryError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

async function isOrgOwner(orgId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)))
    .limit(1)
  return row?.role === "owner"
}

export type AutoDiscoverySetting = { value: boolean; canManage: boolean }

export async function getAutoDiscoverySetting(
  orgId: string,
  userId: string,
  isPlatformAdmin: boolean,
): Promise<AutoDiscoverySetting> {
  const [value, owner] = await Promise.all([
    getOrgSetting(orgId, "discovery.autoApply"),
    isPlatformAdmin ? Promise.resolve(true) : isOrgOwner(orgId, userId),
  ])
  return { value, canManage: owner }
}

export async function setAutoDiscoverySetting(
  orgId: string,
  userId: string,
  isPlatformAdmin: boolean,
  value: unknown,
): Promise<AutoDiscoverySetting> {
  if (!isPlatformAdmin && !(await isOrgOwner(orgId, userId))) {
    throw new AutoDiscoveryError(403, "Настройку может менять только владелец организации")
  }
  if (typeof value !== "boolean") throw new AutoDiscoveryError(400, "Некорректное значение")
  const saved = await setOrgSetting(orgId, "discovery.autoApply", value, userId)
  return { value: saved, canManage: true }
}

export type AutoProcessingOrgRow = {
  organizationId: string
  name: string
  /** Active sources of the org / of them with automatic processing on. */
  sourcesActive: number
  sourcesAutomated: number
  autoDiscovery: boolean
}

/** Platform admin overview: every org, its automated sources and the switch. */
export async function listAutoProcessingOrgs(): Promise<AutoProcessingOrgRow[]> {
  const [orgs, settings, src] = await Promise.all([
    db.select({ id: organization.id, name: organization.name }).from(organization).orderBy(asc(organization.name)),
    listOrgsWithSetting("discovery.autoApply"),
    db
      .select({
        orgId: source.ownerOrganizationId,
        automated: source.automatedParsingIsAllowed,
        n: count(),
      })
      .from(source)
      .where(and(isNotNull(source.ownerOrganizationId), eq(source.status, "active")))
      .groupBy(source.ownerOrganizationId, source.automatedParsingIsAllowed),
  ])
  const on = new Set(settings.filter((s) => s.value).map((s) => s.organizationId))
  const counts = new Map<string, { active: number; automated: number }>()
  for (const r of src) {
    if (!r.orgId) continue
    const c = counts.get(r.orgId) ?? { active: 0, automated: 0 }
    c.active += Number(r.n)
    if (r.automated) c.automated += Number(r.n)
    counts.set(r.orgId, c)
  }
  return orgs.map((o) => ({
    organizationId: o.id,
    name: o.name,
    sourcesActive: counts.get(o.id)?.active ?? 0,
    sourcesAutomated: counts.get(o.id)?.automated ?? 0,
    autoDiscovery: on.has(o.id),
  }))
}

/** Org ids that exist (admin PUT validation). */
export async function organizationExists(orgId: string): Promise<boolean> {
  const rows = await db.select({ id: organization.id }).from(organization).where(inArray(organization.id, [orgId])).limit(1)
  return rows.length > 0
}

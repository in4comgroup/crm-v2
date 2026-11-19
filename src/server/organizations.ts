import "server-only"

import { db } from "@/db/drizzle"
import { member, organization } from "@/db/schema"
import { and, eq } from "drizzle-orm"
import { sortOrgOptions, type OrgOption } from "@/lib/org-switcher"

// Internal (NOT a server action): the first organization a user belongs to.
// Used by the session-create hook in src/lib/auth.ts and by
// GET /api/organization (which only ever passes the signed-in user's id).
// The session's ACTIVE organization when the user is a member of it (org
// switcher, 2026-11-19); else the user's first membership (old behaviour).
export async function getActiveOrganization(userId: string, activeOrganizationId?: string | null) {
  const memberUser =
    (activeOrganizationId
      ? await db.query.member.findFirst({
          where: and(eq(member.userId, userId), eq(member.organizationId, activeOrganizationId)),
        })
      : undefined) ??
    (await db.query.member.findFirst({
      where: eq(member.userId, userId),
    }))

  if (!memberUser) {
    return null
  }

  const activeOrganization = await db.query.organization.findFirst({
    where: eq(organization.id, memberUser.organizationId),
  })

  return activeOrganization
}

// The org logo for the sidebar. Loaded by (protected)/layout.tsx, never put
// on the session: it is a large base64 data URL and would overflow the
// session cookie (431 Request Header Fields Too Large). See src/lib/auth.ts.
export async function getOrganizationLogo(organizationId: string): Promise<string | null> {
  const rows = await db
    .select({ logo: organization.logo })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1)
  return rows[0]?.logo ?? null
}

// Organization switcher (platform admins, sidebar footer): the organizations
// the user is a member of — id + name, sorted by name. Takes the signed-in
// user's id only (callers: (protected)/layout.tsx, /api/account/active-organization).
export async function listUserOrganizations(userId: string): Promise<OrgOption[]> {
  const rows = await db
    .select({ id: organization.id, name: organization.name })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId))
  return sortOrgOptions(rows)
}

// The organization the user may switch to: the org row when the user is a
// member, else null. Checked BEFORE better-auth's setActive, which clears the
// session's active org when the target is not a membership.
export async function findUserOrganization(
  userId: string,
  organizationId: string,
): Promise<OrgOption | null> {
  const rows = await db
    .select({ id: organization.id, name: organization.name })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
    .limit(1)
  return rows[0] ?? null
}

// Name + slug of one organization for the session-update hook in
// src/lib/auth.ts (keeps activeOrganizationName / Slug in step with the id).
export async function getOrganizationSessionInfo(
  organizationId: string,
): Promise<{ name: string; slug: string | null } | null> {
  const rows = await db
    .select({ name: organization.name, slug: organization.slug })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1)
  return rows[0] ?? null
}

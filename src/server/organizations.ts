import "server-only"

import { db } from "@/db/drizzle"
import { member, organization } from "@/db/schema"
import { eq } from "drizzle-orm"

// Internal (NOT a server action): the first organization a user belongs to.
// Used by the session-create hook in src/lib/auth.ts and by
// GET /api/organization (which only ever passes the signed-in user's id).
export async function getActiveOrganization(userId: string) {
  const memberUser = await db.query.member.findFirst({
    where: eq(member.userId, userId),
  })

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

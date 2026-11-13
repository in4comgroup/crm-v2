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

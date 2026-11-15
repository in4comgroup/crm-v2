import { NextResponse } from "next/server"
import { getServerSession } from "@/lib/get-session"
import { ContactLinkError } from "@/server/contact-links"

// Shared by the contact ↔ company link routes (docs/specs/clients-contacts/04
// §8): any member of the ACTIVE org (Q5); the org comes from the session.
export async function linkSession(): Promise<{ orgId: string; userId: string } | NextResponse> {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const orgId = session.session.activeOrganizationId
  if (!orgId) return NextResponse.json({ error: "No active organization" }, { status: 403 })
  return { orgId, userId: session.user.id }
}

export function linkError(e: unknown, where: string) {
  if (e instanceof ContactLinkError) {
    return NextResponse.json({ error: e.message }, { status: e.code === "not_found" ? 404 : 400 })
  }
  console.error(`[${where}]`, e)
  return NextResponse.json({ error: "Не удалось выполнить действие" }, { status: 500 })
}

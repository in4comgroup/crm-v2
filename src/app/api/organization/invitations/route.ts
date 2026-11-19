import { NextResponse } from "next/server"
import { getServerSession } from "@/lib/get-session"
import { listPendingInvitations } from "@/server/org-invitations"

// Pending invitations of the caller's ACTIVE organization (org owner only).
// Org from the session. Resend / cancel go through better-auth's
// organization client (inviteMember with resend: true / cancelInvitation).
export async function GET() {
  const session = await getServerSession()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const result = await listPendingInvitations()
    if (!result.ok) {
      return result.reason === "unauthorized"
        ? NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        : NextResponse.json(
            { error: "Только владелец организации видит приглашения" },
            { status: 403 },
          )
    }
    return NextResponse.json({
      organizationId: result.organizationId,
      invitations: result.invitations,
    })
  } catch (error) {
    console.error("Error listing invitations:", error)
    return NextResponse.json(
      { error: "Не удалось загрузить приглашения" },
      { status: 500 },
    )
  }
}

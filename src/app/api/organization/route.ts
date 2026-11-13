import { NextResponse } from "next/server"
import { getServerSession } from "@/lib/get-session"
import { getActiveOrganization } from "@/server/organizations"

// The signed-in user's organization. The user always comes from the session;
// a `?userId=` parameter (used by older clients) is ignored, so nobody can
// read another user's organization.
export async function GET() {
  const session = await getServerSession()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const organization = await getActiveOrganization(session.user.id)
    return NextResponse.json({ organization })
  } catch (error) {
    console.error("Error fetching active organization:", error)
    return NextResponse.json(
      { error: "Failed to fetch organization" },
      { status: 500 }
    )
  }
}

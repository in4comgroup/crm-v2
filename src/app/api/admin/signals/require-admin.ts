import { NextResponse } from "next/server"
import { getServerSession } from "@/lib/get-session"

// Shared gate for /api/admin/signals/* — platform admins only
// (session.user.role === "admin"): no session → 401, other roles → 403.
export async function requireSignalsAdmin(): Promise<{ userId: string; error?: undefined } | { error: NextResponse }> {
  const session = await getServerSession()
  if (!session?.user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  if (session.user.role !== "admin") return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  return { userId: session.user.id }
}

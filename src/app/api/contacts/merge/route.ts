import { NextResponse } from "next/server"
import { mergeContacts } from "@/server/contact-links"
import { linkError, linkSession } from "../_link-session"

// «Объединить с…» (docs/specs/clients-contacts/04 §3.3): POST { keepId, mergeId }
// → { ok }. Both contacts must belong to the active org (404 otherwise).
export async function POST(req: Request) {
  const s = await linkSession()
  if (s instanceof NextResponse) return s
  try {
    const body = (await req.json().catch(() => null)) as { keepId?: unknown; mergeId?: unknown } | null
    if (typeof body?.keepId !== "string" || typeof body?.mergeId !== "string") {
      return NextResponse.json({ error: "Неверный запрос" }, { status: 400 })
    }
    await mergeContacts(s.orgId, body.keepId, body.mergeId, s.userId)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return linkError(e, "api/contacts/merge")
  }
}

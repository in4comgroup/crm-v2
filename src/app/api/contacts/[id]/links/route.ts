import { NextResponse } from "next/server"
import type { ContactLinkAction } from "@/lib/contact-links"
import { applyLinkAction, getContactLinksView } from "@/server/contact-links"
import { linkError, linkSession } from "../../_link-session"

// «Компании» of a contact (docs/specs/clients-contacts/04 §8).
//   GET                      → ContactLinksResponse
//   POST ContactLinkAction   → ContactLinksResponse (after the change)

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await linkSession()
  if (s instanceof NextResponse) return s
  try {
    const { id } = await params
    return NextResponse.json(await getContactLinksView(s.orgId, id))
  } catch (e) {
    return linkError(e, "api/contacts/[id]/links GET")
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await linkSession()
  if (s instanceof NextResponse) return s
  try {
    const { id } = await params
    const body = (await req.json().catch(() => null)) as ContactLinkAction | null
    if (!body || typeof body !== "object" || typeof body.action !== "string") {
      return NextResponse.json({ error: "Неверный запрос" }, { status: 400 })
    }
    await applyLinkAction(s.orgId, id, body, s.userId)
    return NextResponse.json(await getContactLinksView(s.orgId, id))
  } catch (e) {
    return linkError(e, "api/contacts/[id]/links POST")
  }
}

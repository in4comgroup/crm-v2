import { NextResponse } from "next/server"
import { getClientContactLinks } from "@/server/contact-links"
import { linkError, linkSession } from "../../../contacts/_link-session"

// Company drawer «Контакты»: current / «Бывшие» / pending proposals
// (docs/specs/clients-contacts/04 §6). GET → ClientContactLinksResponse.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await linkSession()
  if (s instanceof NextResponse) return s
  try {
    const { id } = await params
    return NextResponse.json(await getClientContactLinks(s.orgId, id))
  } catch (e) {
    return linkError(e, "api/clients/[id]/contact-links")
  }
}

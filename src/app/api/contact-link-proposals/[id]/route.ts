import { NextResponse } from "next/server"
import { PROPOSAL_DECISIONS, type ProposalDecisionBody } from "@/lib/contact-links"
import { decideProposal } from "@/server/contact-links"
import { linkError, linkSession } from "../../contacts/_link-session"

// Decision on «Контакт сменил компанию?» (docs/specs/clients-contacts/04 §5).
// POST ProposalDecisionBody → { ok, contactId }. Any member of the org (Q5).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await linkSession()
  if (s instanceof NextResponse) return s
  try {
    const { id } = await params
    const body = (await req.json().catch(() => null)) as ProposalDecisionBody | null
    if (!body || !(PROPOSAL_DECISIONS as readonly string[]).includes(body.decision)) {
      return NextResponse.json({ error: "Неверное решение" }, { status: 400 })
    }
    const out = await decideProposal(s.orgId, id, body, s.userId)
    return NextResponse.json({ ok: true, contactId: out.contactId })
  } catch (e) {
    return linkError(e, "api/contact-link-proposals/[id]")
  }
}

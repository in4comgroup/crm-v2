import { NextResponse, type NextRequest } from "next/server"
import { confirmDocumentLink, documentsSession, removeDocumentLink } from "@/server/documents"
import { documentErrorResponse } from "../../../_shared"

// One link (any member): DELETE → «Отвязать» (kept as removed, never re-added
// automatically); PUT { confirm: true } → «Подтвердить» an automatic link.
type Ctx = { params: Promise<{ itemId: string; linkId: string }> }

export async function DELETE(_request: NextRequest, ctx: Ctx) {
  try {
    const s = await documentsSession()
    const { linkId } = await ctx.params
    await removeDocumentLink(s.orgId, s.userId, linkId)
    return NextResponse.json({ success: true })
  } catch (e) {
    return documentErrorResponse(e, "documents link DELETE")
  }
}

export async function PUT(request: NextRequest, ctx: Ctx) {
  try {
    const s = await documentsSession()
    const { linkId } = await ctx.params
    const body = (await request.json().catch(() => null)) as { confirm?: unknown } | null
    if (body?.confirm !== true) return NextResponse.json({ error: "confirm: true is required" }, { status: 400 })
    await confirmDocumentLink(s.orgId, linkId)
    return NextResponse.json({ success: true })
  } catch (e) {
    return documentErrorResponse(e, "documents link PUT")
  }
}

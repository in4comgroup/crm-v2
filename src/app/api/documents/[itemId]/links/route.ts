import { NextResponse, type NextRequest } from "next/server"
import { addDocumentLink, documentsSession } from "@/server/documents"
import { isDocumentEntityType } from "@/lib/documents"
import { documentErrorResponse } from "../../_shared"

// POST { entityType, entityId } → «Привязать ещё» (any member).
type Ctx = { params: Promise<{ itemId: string }> }

export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    const s = await documentsSession()
    const { itemId } = await ctx.params
    const body = (await request.json().catch(() => null)) as { entityType?: unknown; entityId?: unknown } | null
    if (!isDocumentEntityType(body?.entityType) || typeof body?.entityId !== "string") {
      return NextResponse.json({ error: "entityType and entityId are required" }, { status: 400 })
    }
    await addDocumentLink(s.orgId, s.userId, itemId, body.entityType, body.entityId)
    return NextResponse.json({ success: true })
  } catch (e) {
    return documentErrorResponse(e, "documents link POST")
  }
}

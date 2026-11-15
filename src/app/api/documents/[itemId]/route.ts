import { NextResponse, type NextRequest } from "next/server"
import { deleteDocument, documentsSession } from "@/server/documents"
import { documentErrorResponse } from "../_shared"

// DELETE → «Удалить файл»: uploads only; the uploader or the org owner (Q8).
type Ctx = { params: Promise<{ itemId: string }> }

export async function DELETE(_request: NextRequest, ctx: Ctx) {
  try {
    const s = await documentsSession()
    const { itemId } = await ctx.params
    await deleteDocument(s.orgId, s.userId, s.isOwner, itemId)
    return NextResponse.json({ success: true })
  } catch (e) {
    return documentErrorResponse(e, "documents DELETE")
  }
}

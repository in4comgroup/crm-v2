import { NextResponse, type NextRequest } from "next/server"
import { documentsSession, listDocuments } from "@/server/documents"
import { DOCUMENT_TYPE_BUCKETS, isDocumentEntityType, type DocumentsListResponse, type DocumentTypeBucket } from "@/lib/documents"
import { documentErrorResponse } from "./_shared"

// Documents of ONE entity (docs/specs/attachments §6–§7), any member of the org.
//   GET ?entityType=client|contact|deal|task|order&entityId=[&related=0|1][&type=pdf|…][&source=<provider>][&q=][&limit=][&offset=]
//   `related` (default 1): include the documents of related entities — company: contacts + deals (Q11);
//   contact: deals + tasks; deal: contacts + tasks; task: its deal; order: its company (2026-11-21).

export async function GET(request: NextRequest) {
  try {
    const s = await documentsSession()
    const sp = request.nextUrl.searchParams
    const entityType = sp.get("entityType")
    const entityId = sp.get("entityId")
    if (!isDocumentEntityType(entityType) || !entityId) {
      return NextResponse.json({ error: "entityType and entityId are required" }, { status: 400 })
    }
    const type = sp.get("type")
    const res = await listDocuments(s.orgId, { userId: s.userId, isOwner: s.isOwner }, entityType, entityId, {
      includeRelated: sp.get("related") !== "0",
      type: (DOCUMENT_TYPE_BUCKETS as readonly string[]).includes(type ?? "") ? (type as DocumentTypeBucket) : null,
      provider: sp.get("source") || null,
      q: sp.get("q"),
      limit: sp.get("limit") ? Number(sp.get("limit")) : undefined,
      offset: sp.get("offset") ? Number(sp.get("offset")) : undefined,
    })
    return NextResponse.json(res satisfies DocumentsListResponse)
  } catch (e) {
    return documentErrorResponse(e, "documents GET")
  }
}

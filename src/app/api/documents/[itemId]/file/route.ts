import { NextResponse, type NextRequest } from "next/server"
import { documentsSession, readDocumentFile } from "@/server/documents"
import { documentErrorResponse } from "../../_shared"

// GET ?disposition=inline|attachment → the original file (any member of the
// item's org; no public URLs). «Открыть» = inline in a new browser tab (the
// browser / OS shows PDF, images, audio, video), «Скачать» = attachment (Q7).
export const maxDuration = 60
type Ctx = { params: Promise<{ itemId: string }> }

export async function GET(request: NextRequest, ctx: Ctx) {
  try {
    const s = await documentsSession()
    const { itemId } = await ctx.params
    const disposition = request.nextUrl.searchParams.get("disposition") === "inline" ? "inline" : "attachment"
    const f = await readDocumentFile(s.orgId, itemId, disposition)
    const headers: Record<string, string> = {
      "Content-Type": f.contentType,
      "Content-Disposition": f.contentDisposition,
      "Content-Length": String(f.bytes.byteLength),
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    }
    // Stored user files: no script, even if a type slips through. Not for PDF:
    // Chrome refuses to render a PDF under a CSP sandbox.
    if (!f.contentType.toLowerCase().startsWith("application/pdf")) {
      headers["Content-Security-Policy"] = "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'"
    }
    return new NextResponse(f.bytes as unknown as BodyInit, { headers })
  } catch (e) {
    return documentErrorResponse(e, "documents file")
  }
}

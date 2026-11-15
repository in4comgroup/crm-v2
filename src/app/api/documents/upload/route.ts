import { NextResponse, type NextRequest } from "next/server"
import { documentsSession, uploadDocuments, type UploadFile } from "@/server/documents"
import { DOCUMENT_MAX_BYTES, DOCUMENT_UPLOAD_MAX_FILES, isDocumentEntityType } from "@/lib/documents"
import { documentErrorResponse } from "../_shared"

// POST multipart: files[] (≤ 10, each ≤ 50 MB), entityType, entityId → { results }.
// Any member. The file is stored + linked at once; parsing and the automatic
// links run after the response (docs/specs/attachments §5).
export const maxDuration = 300

export async function POST(request: NextRequest) {
  try {
    const s = await documentsSession()
    const form = await request.formData()
    const entityType = form.get("entityType")
    const entityId = form.get("entityId")
    if (!isDocumentEntityType(entityType) || typeof entityId !== "string" || !entityId) {
      return NextResponse.json({ error: "entityType and entityId are required" }, { status: 400 })
    }
    const raw = form.getAll("files").filter((f): f is File => f instanceof File)
    if (raw.length > DOCUMENT_UPLOAD_MAX_FILES) {
      return NextResponse.json({ error: `Не больше ${DOCUMENT_UPLOAD_MAX_FILES} файлов за раз` }, { status: 400 })
    }
    const files: UploadFile[] = []
    const tooBig: string[] = []
    for (const f of raw) {
      if (f.size > DOCUMENT_MAX_BYTES) {
        tooBig.push(f.name)
        continue
      }
      files.push({ name: f.name, mime: f.type, bytes: new Uint8Array(await f.arrayBuffer()) })
    }
    const results = files.length ? await uploadDocuments(s.orgId, s.userId, entityType, entityId, files) : []
    return NextResponse.json({
      results: [...results, ...tooBig.map((name) => ({ name, ok: false, error: "Файл больше 50 МБ" }))],
    })
  } catch (e) {
    return documentErrorResponse(e, "documents upload")
  }
}

import { putChatUploadPart } from "@/server/chat/files"
import { chatFileErrorResponse, chatFileSession } from "../../../_shared"

// PUT /api/chat/files/<id>/parts/<n> — raw bytes of part n (1-based, ≤ 4 MB).
export const maxDuration = 60

export async function PUT(req: Request, { params }: { params: Promise<{ id: string; n: string }> }) {
  const s = await chatFileSession()
  if (s instanceof Response) return s
  const { id, n } = await params
  try {
    const bytes = new Uint8Array(await req.arrayBuffer())
    await putChatUploadPart(s.orgId, s.userId, id, Number(n), bytes)
    return Response.json({ ok: true })
  } catch (e) {
    return chatFileErrorResponse(e, "part")
  }
}

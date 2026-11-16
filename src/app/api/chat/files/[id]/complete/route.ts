import { completeChatUpload } from "@/server/chat/files"
import { chatFileErrorResponse, chatFileSession } from "../../_shared"

// POST /api/chat/files/<id>/complete → { itemId, url } — joins the parts and
// stores the original. The url goes into the message's file part.
export const maxDuration = 60

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await chatFileSession()
  if (s instanceof Response) return s
  const { id } = await params
  try {
    return Response.json(await completeChatUpload(s.orgId, s.userId, id))
  } catch (e) {
    return chatFileErrorResponse(e, "complete")
  }
}

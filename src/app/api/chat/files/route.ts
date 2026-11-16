import { createChatUpload } from "@/server/chat/files"
import { chatFileErrorResponse, chatFileSession } from "./_shared"

// POST /api/chat/files { name, mediaType, size } → { itemId, parts, chunkBytes }
// Step 1 of a chat file upload (docs/specs/ai-chat-tools §5.1): checks type
// and size, creates the «AI Chat» source item. Then PUT …/parts/<n> (≤ 4 MB
// each) and POST …/complete.
export async function POST(req: Request) {
  const s = await chatFileSession()
  if (s instanceof Response) return s
  const body = (await req.json().catch(() => null)) as { name?: unknown; mediaType?: unknown; size?: unknown } | null
  if (typeof body?.name !== "string" || typeof body.mediaType !== "string" || typeof body.size !== "number") {
    return Response.json({ error: "Bad request" }, { status: 400 })
  }
  try {
    return Response.json(await createChatUpload(s.orgId, s.userId, { name: body.name, mediaType: body.mediaType, size: body.size }))
  } catch (e) {
    return chatFileErrorResponse(e, "create")
  }
}

import { getServerSession } from "@/lib/get-session"
import { confirmActionSchema } from "@/lib/chat/actions"
import { ChatActionError, cancelChatAction, confirmChatAction, getChatAction } from "@/server/chat/actions/confirm"

// Chat actions (docs/specs/ai-chat-tools §7.4): the draft cards of the AI chat.
//   GET   ?id=<actionId>                 → { action }  (current state of the card)
//   POST  { actionId, attachFile, items } → { action }  (create — the user's click)
//   PATCH { actionId, action: "cancel" } → { action }
// The draft must be the caller's own in the active org (else 404). Records are
// created as the signed-in user through the normal server functions.

// 120 s: «Заказ из запроса» runs the order-request split (one model call) on confirm.
export const maxDuration = 120

async function session() {
  const s = await getServerSession()
  if (!s?.user) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const orgId = s.session.activeOrganizationId ?? null
  if (!orgId) return Response.json({ error: "No active organization" }, { status: 403 })
  return { orgId, userId: s.user.id }
}

function errorResponse(e: unknown, where: string) {
  if (e instanceof ChatActionError) {
    return Response.json(
      e.code === "duplicate" || e.action ? { error: e.code === "duplicate" ? "duplicate" : e.message, message: e.message, action: e.action } : { error: e.message },
      { status: e.status },
    )
  }
  console.error(`[chat/actions] ${where} failed`, e)
  return Response.json({ error: "Не удалось выполнить действие" }, { status: 500 })
}

export async function GET(req: Request) {
  const s = await session()
  if (s instanceof Response) return s
  const id = new URL(req.url).searchParams.get("id")
  if (!id) return Response.json({ error: "Bad request" }, { status: 400 })
  try {
    return Response.json({ action: await getChatAction(s.orgId, s.userId, id) })
  } catch (e) {
    return errorResponse(e, "get")
  }
}

export async function POST(req: Request) {
  const s = await session()
  if (s instanceof Response) return s
  const parsed = confirmActionSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: "Неверный запрос" }, { status: 400 })
  try {
    return Response.json({ action: await confirmChatAction(s.orgId, s.userId, parsed.data) })
  } catch (e) {
    return errorResponse(e, "confirm")
  }
}

export async function PATCH(req: Request) {
  const s = await session()
  if (s instanceof Response) return s
  const body = (await req.json().catch(() => null)) as { actionId?: unknown; action?: unknown } | null
  if (typeof body?.actionId !== "string" || body.action !== "cancel") return Response.json({ error: "Bad request" }, { status: 400 })
  try {
    return Response.json({ action: await cancelChatAction(s.orgId, s.userId, body.actionId) })
  } catch (e) {
    return errorResponse(e, "cancel")
  }
}

import { NextResponse, type NextRequest } from "next/server"
import { getServerSession } from "@/lib/get-session"
import { assertSourceItemInScope, SourceItemScopeError } from "@/server/source-items"
import { TelegramContactError, getTelegramItemAuthor, linkTelegramAuthorToContact } from "@/server/telegram/directory"

// «Связать с контактом» of a Telegram message (docs/specs/telegram/04 §6.2,
// TI5): GET → { author } (who wrote it by the ONE rule, whether it can be
// linked); POST { contactId } → the author's Telegram id (+ username) becomes
// the contact's verified Telegram; the item's resolution is updated → { author }.
// Any member of the active org.

async function ctx(params: Promise<{ id: string }>) {
  const session = await getServerSession()
  const orgId = session?.session.activeOrganizationId
  if (!session || !orgId) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  const { id } = await params
  try {
    await assertSourceItemInScope(id, orgId)
  } catch (e) {
    if (e instanceof SourceItemScopeError) return { error: NextResponse.json({ error: "Сообщение не найдено" }, { status: e.reason === "forbidden" ? 403 : 404 }) }
    throw e
  }
  return { orgId, id }
}

function fail(e: unknown) {
  if (e instanceof TelegramContactError) return NextResponse.json({ error: e.message }, { status: e.status })
  console.error("[api/sources/items/telegram-contact] failed", e)
  return NextResponse.json({ error: "Не удалось выполнить действие" }, { status: 500 })
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx(params)
  if ("error" in c) return c.error
  try {
    return NextResponse.json({ author: await getTelegramItemAuthor(c.orgId, c.id) })
  } catch (e) {
    return fail(e)
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx(params)
  if ("error" in c) return c.error
  const body = (await req.json().catch(() => null)) as { contactId?: unknown } | null
  if (typeof body?.contactId !== "string" || !body.contactId) return NextResponse.json({ error: "Неверный запрос" }, { status: 400 })
  try {
    await linkTelegramAuthorToContact(c.orgId, c.id, body.contactId)
    return NextResponse.json({ author: await getTelegramItemAuthor(c.orgId, c.id) })
  } catch (e) {
    return fail(e)
  }
}

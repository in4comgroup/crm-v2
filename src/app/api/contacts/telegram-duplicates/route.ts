import { NextResponse } from "next/server"
import { getServerSession } from "@/lib/get-session"
import { listTelegramDuplicates } from "@/server/telegram/directory"

// «Дубли Telegram» (docs/specs/telegram/04 §6.3, TI5): live contacts that share
// one Telegram id or username → GET { groups: [{ key, label, contacts: [{ id,
// name, clientId }] }] }. A person merges them with POST /api/contacts/merge.
// Any member of the active org.
export async function GET() {
  const session = await getServerSession()
  const orgId = session?.session.activeOrganizationId
  if (!session || !orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  try {
    return NextResponse.json({ groups: await listTelegramDuplicates(orgId) })
  } catch (e) {
    console.error("[api/contacts/telegram-duplicates] failed", e)
    return NextResponse.json({ error: "Не удалось загрузить список" }, { status: 500 })
  }
}

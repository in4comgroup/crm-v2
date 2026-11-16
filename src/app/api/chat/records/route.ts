import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "@/lib/get-session"
import { isRecordType, type RecordDetail } from "@/lib/chat/records"
import { getRecord, loadRecordsContext } from "@/server/chat/records"

export type { RecordDetail } from "@/lib/chat/records"

// GET /api/chat/records?type=<RecordType>&id=<id> → { detail: RecordDetail }
// — the detail view of one record in the AI chat side panel
// (docs/specs/ai-chat/01-specification.md §7.2). Any member of the active
// org; the org comes from the session, never from the query. Not found,
// another org's record or a type the user can't see (topics / cards outside
// topics mode `on`) → 404. Internal errors are logged, never echoed (§9).
export async function GET(request: NextRequest) {
  const session = await getServerSession()
  if (!session?.user) {
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 })
  }
  const orgId = session.session.activeOrganizationId
  if (!orgId) {
    return NextResponse.json({ error: "Нет активной организации" }, { status: 403 })
  }

  const params = new URL(request.url).searchParams
  const type = params.get("type")
  const id = params.get("id")?.trim() ?? ""
  if (!isRecordType(type) || !id || id.length > 200) {
    return NextResponse.json({ error: "Неверный запрос" }, { status: 400 })
  }

  try {
    const ctx = await loadRecordsContext(orgId, session.user.id)
    const detail: RecordDetail | null = await getRecord(ctx, type, id)
    if (!detail) {
      return NextResponse.json({ error: "Запись не найдена или недоступна" }, { status: 404 })
    }
    return NextResponse.json({ detail })
  } catch (error) {
    console.error(`[chat/records] get ${type} failed (org ${orgId})`, error)
    return NextResponse.json({ error: "Не удалось загрузить запись" }, { status: 500 })
  }
}

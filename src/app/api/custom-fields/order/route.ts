import { NextResponse, type NextRequest } from "next/server"
import { CustomFieldError, customFieldsSession, reorderCustomFields } from "@/server/custom-fields"
import { customFieldErrorResponse, parseEntity } from "../_shared"

// PUT { entity, ids[] } → new order of the entity's fields (org owner).
export async function PUT(request: NextRequest) {
  try {
    const s = await customFieldsSession()
    if (!s.isOwner) throw new CustomFieldError("Поля настраивает только владелец организации", 403)
    const body = (await request.json().catch(() => null)) as { entity?: unknown; ids?: unknown } | null
    const entity = parseEntity(body?.entity)
    const ids = Array.isArray(body?.ids) ? body.ids.filter((x): x is string => typeof x === "string") : null
    if (!entity || !ids) return NextResponse.json({ error: "entity and ids are required" }, { status: 400 })
    await reorderCustomFields(s.orgId, s.userId, entity, ids)
    return NextResponse.json({ success: true })
  } catch (e) {
    return customFieldErrorResponse(e, "custom-fields order")
  }
}

import { NextResponse, type NextRequest } from "next/server"
import {
  CustomFieldError,
  customFieldsSession,
  deleteCustomFieldForever,
  setCustomFieldArchived,
  updateCustomField,
} from "@/server/custom-fields"
import { customFieldErrorResponse } from "../_shared"

// One custom field definition (org owner only).
//   PUT { field }                      → change (409 for a forbidden type change)
//   PUT { action: "archive" | "restore" } → «Удалить» / «Восстановить»
//   DELETE { confirmLabel }            → «Удалить навсегда» (archived fields only)

type Ctx = { params: Promise<{ id: string }> }

async function owner() {
  const s = await customFieldsSession()
  if (!s.isOwner) throw new CustomFieldError("Поля настраивает только владелец организации", 403)
  return s
}

export async function PUT(request: NextRequest, ctx: Ctx) {
  try {
    const s = await owner()
    const { id } = await ctx.params
    const body = (await request.json().catch(() => null)) as { field?: unknown; action?: unknown } | null
    if (body?.action === "archive" || body?.action === "restore") {
      const field = await setCustomFieldArchived(s.orgId, s.userId, id, body.action === "archive")
      return NextResponse.json({ field })
    }
    const field = await updateCustomField(s.orgId, s.userId, id, body?.field)
    return NextResponse.json({ field })
  } catch (e) {
    return customFieldErrorResponse(e, "custom-fields PUT")
  }
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  try {
    const s = await owner()
    const { id } = await ctx.params
    const body = (await request.json().catch(() => null)) as { confirmLabel?: unknown } | null
    await deleteCustomFieldForever(s.orgId, id, typeof body?.confirmLabel === "string" ? body.confirmLabel : "")
    return NextResponse.json({ success: true })
  } catch (e) {
    return customFieldErrorResponse(e, "custom-fields DELETE")
  }
}

import { NextResponse, type NextRequest } from "next/server"
import { createCustomField, customFieldsSession, listCustomFields, CustomFieldError } from "@/server/custom-fields"
import type { CustomFieldDef } from "@/lib/custom-fields"
import { customFieldErrorResponse, parseEntity } from "./_shared"

// Custom field DEFINITIONS of the active org (docs/specs/clients-contacts).
//   GET ?entity=client|contact[&archived=1] → { fields, canManage } (any member)
//   POST { field: CustomFieldInput } → { field } (org owner)

export type CustomFieldsListResponse = { fields: CustomFieldDef[]; canManage: boolean }

export async function GET(request: NextRequest) {
  try {
    const s = await customFieldsSession()
    const entity = parseEntity(request.nextUrl.searchParams.get("entity"))
    if (!entity) return NextResponse.json({ error: "entity is required" }, { status: 400 })
    const fields = await listCustomFields(s.orgId, entity, {
      includeArchived: request.nextUrl.searchParams.get("archived") === "1" && s.isOwner,
    })
    return NextResponse.json({ fields, canManage: s.isOwner } satisfies CustomFieldsListResponse)
  } catch (e) {
    return customFieldErrorResponse(e, "custom-fields GET")
  }
}

export async function POST(request: NextRequest) {
  try {
    const s = await customFieldsSession()
    if (!s.isOwner) throw new CustomFieldError("Поля настраивает только владелец организации", 403)
    const body = (await request.json().catch(() => null)) as { field?: unknown } | null
    const field = await createCustomField(s.orgId, s.userId, body?.field)
    return NextResponse.json({ field })
  } catch (e) {
    return customFieldErrorResponse(e, "custom-fields POST")
  }
}

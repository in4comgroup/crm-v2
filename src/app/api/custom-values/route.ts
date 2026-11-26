import { NextResponse, type NextRequest } from "next/server"
import {
  customFieldsSession,
  getCustomValues,
  listCustomValueHistory,
  saveCustomValues,
  saveStandardValues,
  type CustomValueHistoryRow,
  type CustomValuesView,
} from "@/server/custom-fields"
import { activateInitialRecord } from "@/server/entity-status"
import { customFieldErrorResponse, parseEntity } from "../custom-fields/_shared"

// Custom field VALUES of one company / contact (any member of the org; the
// row is checked against the active org). docs/specs/clients-contacts.
//   GET ?entity=client|contact&id=          → CustomValuesView
//   GET ?entity=&id=&history=1[&fieldId=]   → { history } (last 50 changes)
//   PUT { entity, id, values?: { fieldId: value | null },
//         standard?: { key: value | null } } → { values, standard, changed }
//   (`standard` = the standard fields in real columns, src/lib/standard-fields.ts;
//   saved first, so a bad custom value never leaves them half-written)

export type CustomValuesResponse = CustomValuesView
export type CustomValuesHistoryResponse = { history: CustomValueHistoryRow[] }

export async function GET(request: NextRequest) {
  try {
    const s = await customFieldsSession()
    const sp = request.nextUrl.searchParams
    const entity = parseEntity(sp.get("entity"))
    const id = sp.get("id")
    if (!entity || !id) return NextResponse.json({ error: "entity and id are required" }, { status: 400 })
    if (sp.get("history") === "1") {
      const history = await listCustomValueHistory(s.orgId, entity, id, sp.get("fieldId"))
      return NextResponse.json({ history } satisfies CustomValuesHistoryResponse)
    }
    return NextResponse.json((await getCustomValues(s.orgId, entity, id, s.isOwner)) satisfies CustomValuesResponse)
  } catch (e) {
    return customFieldErrorResponse(e, "custom-values GET")
  }
}

export async function PUT(request: NextRequest) {
  try {
    const s = await customFieldsSession()
    const body = (await request.json().catch(() => null)) as
      | { entity?: unknown; id?: unknown; values?: unknown; standard?: unknown }
      | null
    const entity = parseEntity(body?.entity)
    if (!entity || typeof body?.id !== "string") {
      return NextResponse.json({ error: "entity and id are required" }, { status: 400 })
    }
    const std = await saveStandardValues(s.orgId, entity, body.id, (body.standard ?? {}) as Record<string, unknown>)
    const res = await saveCustomValues(s.orgId, s.userId, entity, body.id, (body.values ?? {}) as Record<string, unknown>)
    const changed = res.changed + std.changed
    // A person saved «Поля» → an automatic «Новая» record is confirmed (2026-11-26).
    if (changed > 0) await activateInitialRecord(s.orgId, entity, body.id)
    return NextResponse.json({ ...res, standard: std.standard, changed })
  } catch (e) {
    return customFieldErrorResponse(e, "custom-values PUT")
  }
}

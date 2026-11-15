import { NextResponse } from "next/server"
import {
  ClientProfileError,
  requireClientProfileSession,
} from "@/server/identity/client-profile"
import {
  getEnrichOnCreateSetting,
  setEnrichOnCreateSetting,
} from "@/server/identity/client-enrichment"

export type { EnrichOnCreateSetting } from "@/server/identity/client-enrichment"

// Org setting `clients.enrichOnCreate` «Заполнять профиль новых компаний из
// интернета» (identity I6, Q6) of the ACTIVE org. GET → { value, canManage }
// (any member); PUT { value: boolean } → org owner or platform admin, else 403.

function errorResponse(e: unknown) {
  if (e instanceof ClientProfileError) {
    return NextResponse.json({ error: e.message }, { status: e.status })
  }
  console.error("[api/clients/enrich/settings]", e)
  return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 })
}

export async function GET() {
  try {
    const { orgId, userId, isPlatformAdmin } = await requireClientProfileSession()
    return NextResponse.json(await getEnrichOnCreateSetting(orgId, userId, isPlatformAdmin))
  } catch (e) {
    return errorResponse(e)
  }
}

export async function PUT(request: Request) {
  try {
    const { orgId, userId, isPlatformAdmin } = await requireClientProfileSession()
    const body = (await request.json().catch(() => null)) as { value?: unknown } | null
    return NextResponse.json(await setEnrichOnCreateSetting(orgId, userId, isPlatformAdmin, body?.value))
  } catch (e) {
    return errorResponse(e)
  }
}

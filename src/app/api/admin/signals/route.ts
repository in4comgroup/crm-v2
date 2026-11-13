import { NextResponse, type NextRequest } from "next/server"
import type { SignalsSaveRequest } from "@/lib/signals/types"
import {
  getHistory,
  getOrgRegistry,
  getRegistry,
  listOrgsForSignals,
  SignalsOrgNotFoundError,
} from "@/server/signals/registry"
import { saveRegistryEntity } from "@/server/signals/save"
import { requireSignalsAdmin } from "./require-admin"

// Signals registry admin API (spec topics/05; contract src/lib/signals/types.ts).
// Platform admins only.
//   GET ?view=registry              → SignalsRegistryResponse
//   GET ?view=org&orgId=…           → SignalsOrgResponse (404 unknown org)
//   GET ?view=orgs                  → SignalsOrgsResponse
//   GET ?view=history&limit=…       → SignalsHistoryResponse
//   PUT SignalsSaveRequest          → 200 { version, warnings? } | 400 { errors }

export async function GET(request: NextRequest) {
  const auth = await requireSignalsAdmin()
  if (auth.error) return auth.error
  const params = request.nextUrl.searchParams
  const view = params.get("view") ?? "registry"
  try {
    switch (view) {
      case "registry":
        return NextResponse.json(await getRegistry())
      case "org": {
        const orgId = params.get("orgId")
        if (!orgId) return NextResponse.json({ error: "orgId is required" }, { status: 400 })
        return NextResponse.json(await getOrgRegistry(orgId))
      }
      case "orgs":
        return NextResponse.json(await listOrgsForSignals())
      case "history":
        return NextResponse.json(await getHistory(Number(params.get("limit") ?? 20)))
      default:
        return NextResponse.json({ error: "view must be registry | org | orgs | history" }, { status: 400 })
    }
  } catch (error) {
    if (error instanceof SignalsOrgNotFoundError) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 })
    }
    console.error("[admin/signals] GET error:", error)
    return NextResponse.json({ error: "Failed to load the signals registry" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireSignalsAdmin()
  if (auth.error) return auth.error
  const body = (await request.json().catch(() => null)) as SignalsSaveRequest | null
  if (!body || typeof body !== "object") {
    return NextResponse.json({ errors: [{ field: "body", message: "Пустой или неверный запрос" }] }, { status: 400 })
  }
  try {
    const result = await saveRegistryEntity(body, auth.userId)
    return NextResponse.json(result, { status: "errors" in result ? 400 : 200 })
  } catch (error) {
    console.error("[admin/signals] PUT error:", error)
    return NextResponse.json({ error: "Failed to save the signals registry" }, { status: 500 })
  }
}

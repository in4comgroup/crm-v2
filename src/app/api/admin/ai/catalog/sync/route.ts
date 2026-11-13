import { NextResponse, type NextRequest } from "next/server"
import { getServerSession } from "@/lib/get-session"
import {
  syncAllModelCatalogs,
  syncModelCatalog,
} from "@/server/ai/catalog/sync"

// «Синхронизировать» (Sync) button on the «Модели» tab. Platform admins only.
//   POST { gatewayId? } → { results: CatalogSyncResult[] }
// Without gatewayId, syncs every enabled gateway.
// Spec: docs/specs/models/02-model-registry.md §5.

export const maxDuration = 120

export async function POST(request: NextRequest) {
  const session = await getServerSession()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = (await request.json().catch(() => ({}))) as {
    gatewayId?: unknown
  }
  const gatewayId = typeof body.gatewayId === "string" ? body.gatewayId : null

  const results = gatewayId
    ? [await syncModelCatalog(gatewayId)]
    : await syncAllModelCatalogs()
  const failed = results.some((r) => !r.ok)
  return NextResponse.json({ results }, { status: failed ? 502 : 200 })
}

import { NextResponse, type NextRequest } from "next/server"
import { getServerSession } from "@/lib/get-session"
import type { SignalReviewItem } from "@/lib/signals/extraction-types"
import { SignalsNotEnabledError } from "@/server/topics/prompt/extraction"
import {
  runSignalExtractionForItem,
  SignalItemNotFoundError,
  type ExtractItemResult,
} from "@/server/topics/signals/extract-item"
import {
  getSignalReviewItem,
  getSignalStats,
  listSignalReviewItems,
  type SignalStats,
} from "@/server/topics/signals/review"

export type { SignalStats } from "@/server/topics/signals/review"

// Shadow review of the topics signal extraction (plan phase 2, spec
// topics/01 §13). Platform admins only.
//   GET ?orgId=&status=&band=&code=&limit=&offset=  → { rows, total }
//   GET ?orgId=&stats=1                             → { stats }
//   POST { orgId?, itemId }                         → { result, item }
//        manual extraction of one item (runs regardless of the org's topics
//        mode). orgId defaults to the session's active org (Sources page).
//        400 + Russian message when the org has no active signal code,
//        404 when the item is not in the org.

export const maxDuration = 60

export type AdminSignalsListResponse = { rows: SignalReviewItem[]; total: number }
export type AdminSignalsStatsResponse = { stats: SignalStats }
export type AdminSignalsExtractResponse = { result: ExtractItemResult; item: SignalReviewItem | null }

async function requireAdmin() {
  const session = await getServerSession()
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }
  if (session.user.role !== "admin") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }
  return { activeOrgId: session.session.activeOrganizationId ?? null }
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  const sp = request.nextUrl.searchParams
  const orgId = sp.get("orgId")
  if (!orgId) return NextResponse.json({ error: "orgId is required" }, { status: 400 })
  try {
    if (sp.get("stats")) {
      const body: AdminSignalsStatsResponse = { stats: await getSignalStats(orgId) }
      return NextResponse.json(body)
    }
    const body: AdminSignalsListResponse = await listSignalReviewItems(orgId, {
      status: sp.get("status"),
      band: sp.get("band"),
      code: sp.get("code"),
      limit: Number(sp.get("limit") ?? 50) || 50,
      offset: Number(sp.get("offset") ?? 0) || 0,
    })
    return NextResponse.json(body)
  } catch (error) {
    console.error("[admin/topics/signals] GET error:", error)
    return NextResponse.json({ error: "Failed to load signals" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const itemId = typeof body?.itemId === "string" ? body.itemId.trim() : ""
  const orgId = typeof body?.orgId === "string" && body.orgId ? body.orgId : auth.activeOrgId
  if (!itemId) return NextResponse.json({ error: "Укажите ID сообщения" }, { status: 400 })
  if (!orgId) return NextResponse.json({ error: "Не выбрана организация" }, { status: 400 })
  try {
    const result = await runSignalExtractionForItem(orgId, itemId)
    const res: AdminSignalsExtractResponse = { result, item: await getSignalReviewItem(orgId, itemId) }
    return NextResponse.json(res)
  } catch (error) {
    if (error instanceof SignalsNotEnabledError) {
      return NextResponse.json({ error: error.message, code: "signals_not_enabled" }, { status: 400 })
    }
    if (error instanceof SignalItemNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    console.error("[admin/topics/signals] POST error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось извлечь сигналы" },
      { status: 500 },
    )
  }
}

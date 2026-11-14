import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "@/lib/get-session"
import {
  addAnalysisExclusion,
  AnalysisExclusionError,
  getOrgMemberRole,
  listAnalysisExclusions,
  type AnalysisExclusionKind,
} from "@/server/analysis-exclusions"
import { ANALYSIS_EXCLUSION_KINDS } from "@/lib/analysis-exclusion-match"

export type { AnalysisExclusionRow } from "@/server/analysis-exclusions"

// «Исключения из анализа» — per-org deny-list (spec topics/01 §5.2 gate 3a).
// GET: any org member reads the list (+ `canManage` = org owner).
// POST: org owner adds `{ kind, value, note? }`; idempotent on duplicates.

function errorResponse(error: unknown) {
  if (error instanceof AnalysisExclusionError) {
    const status =
      error.reason === "forbidden" ? 403 : error.reason === "not_found" ? 404 : 400
    return NextResponse.json({ error: error.message }, { status })
  }
  console.error("[sources/exclusions] Error:", error)
  return NextResponse.json({ error: "Не удалось выполнить запрос" }, { status: 500 })
}

export async function GET() {
  const session = await getServerSession()
  const orgId = session?.session.activeOrganizationId
  if (!session || !orgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const role = await getOrgMemberRole(orgId, session.user.id)
    if (!role) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    const entries = await listAnalysisExclusions(orgId)
    return NextResponse.json({ entries, canManage: role === "owner" })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession()
  const orgId = session?.session.activeOrganizationId
  if (!session || !orgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const role = await getOrgMemberRole(orgId, session.user.id)
    if (role !== "owner") {
      return NextResponse.json(
        { error: "Только владелец организации может управлять исключениями" },
        { status: 403 },
      )
    }
    const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>
    const kind = typeof body.kind === "string" ? body.kind : ""
    const value = typeof body.value === "string" ? body.value : ""
    if (!(ANALYSIS_EXCLUSION_KINDS as readonly string[]).includes(kind) || !value.trim()) {
      return NextResponse.json({ error: "Укажите тип и значение" }, { status: 400 })
    }
    const result = await addAnalysisExclusion({
      orgId,
      userId: session.user.id,
      kind: kind as AnalysisExclusionKind,
      value,
      note: typeof body.note === "string" ? body.note : null,
    })
    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error)
  }
}

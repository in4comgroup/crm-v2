import { NextResponse } from "next/server"
import { getServerSession } from "@/lib/get-session"
import {
  AnalysisExclusionError,
  getOrgMemberRole,
  removeAnalysisExclusion,
} from "@/server/analysis-exclusions"

// DELETE one «Исключения из анализа» entry (org owner only). Items skipped
// while the entry existed stay skipped; re-parse them to analyse them.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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
    const { id } = await params
    await removeAnalysisExclusion(orgId, id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof AnalysisExclusionError) {
      const status = error.reason === "not_found" ? 404 : error.reason === "forbidden" ? 403 : 400
      return NextResponse.json({ error: error.message }, { status })
    }
    console.error("[sources/exclusions/[id]] Error:", error)
    return NextResponse.json({ error: "Не удалось удалить" }, { status: 500 })
  }
}

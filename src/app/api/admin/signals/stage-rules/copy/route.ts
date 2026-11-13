import { NextResponse, type NextRequest } from "next/server"
import type { SignalsCopyStageRulesRequest } from "@/lib/signals/types"
import { copyStageRuleTemplates } from "@/server/signals/save"
import { requireSignalsAdmin } from "../../require-admin"

// POST { organizationId, packCode, stageMap } → 200 { version, created, skipped }
//                                             | 400 { errors }
// Copies a pack's stage-rule templates to the org (05 §5). Platform admins only.
export async function POST(request: NextRequest) {
  const auth = await requireSignalsAdmin()
  if (auth.error) return auth.error
  const body = (await request.json().catch(() => null)) as Partial<SignalsCopyStageRulesRequest> | null
  const organizationId = typeof body?.organizationId === "string" ? body.organizationId : ""
  const packCode = typeof body?.packCode === "string" ? body.packCode : ""
  const stageMap = body?.stageMap
  if (!organizationId || !packCode || !stageMap || typeof stageMap !== "object" || Array.isArray(stageMap)) {
    return NextResponse.json(
      { errors: [{ field: "body", message: "Нужны organizationId, packCode и stageMap" }] },
      { status: 400 },
    )
  }
  try {
    const result = await copyStageRuleTemplates(organizationId, packCode, stageMap, auth.userId)
    return NextResponse.json(result, { status: "errors" in result ? 400 : 200 })
  } catch (error) {
    console.error("[admin/signals/stage-rules/copy] POST error:", error)
    return NextResponse.json({ error: "Failed to copy stage rules" }, { status: 500 })
  }
}

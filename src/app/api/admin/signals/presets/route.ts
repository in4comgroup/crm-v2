import { NextResponse, type NextRequest } from "next/server"
import type { SignalsApplyPresetRequest } from "@/lib/signals/types"
import { applyPreset } from "@/server/signals/save"
import { requireSignalsAdmin } from "../require-admin"

// POST { organizationId, preset } → 200 { version, changed, skipped, warnings? }
//                                 | 400 { errors }
// Applies an activation preset (05 §5.1, R6) to one org. Platform admins only.
export async function POST(request: NextRequest) {
  const auth = await requireSignalsAdmin()
  if (auth.error) return auth.error
  const body = (await request.json().catch(() => null)) as Partial<SignalsApplyPresetRequest> | null
  const organizationId = typeof body?.organizationId === "string" ? body.organizationId : ""
  const preset = typeof body?.preset === "string" ? body.preset : ""
  if (!organizationId || !preset) {
    return NextResponse.json(
      { errors: [{ field: "body", message: "Нужны organizationId и preset" }] },
      { status: 400 },
    )
  }
  try {
    const result = await applyPreset(organizationId, preset, auth.userId)
    return NextResponse.json(result, { status: "errors" in result ? 400 : 200 })
  } catch (error) {
    console.error("[admin/signals/presets] POST error:", error)
    return NextResponse.json({ error: "Failed to apply the preset" }, { status: 500 })
  }
}

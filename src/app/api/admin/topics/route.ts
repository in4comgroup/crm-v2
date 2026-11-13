import { NextResponse, type NextRequest } from "next/server"
import { getServerSession } from "@/lib/get-session"
import { OrgSettingValidationError, setOrgSetting } from "@/server/org-settings"
import {
  getLastTopicsModeChange,
  isTopicsMode,
  listOrgTopicsModes,
  organizationExists,
  type OrgTopicsModeRow,
  type TopicsMode,
  type TopicsModeChange,
} from "@/server/topics/mode"

// Topics engine mode per organization (spec topics/01 §12, plan phase 0
// task 3). Platform admins only.
//   GET → { orgs: OrgTopicsModeRow[] }   every org, its mode, last change
//   PUT { organizationId, mode: off|shadow|on }
//       → { organizationId, mode, lastChange }
// Runs live in ./runs (GET list, POST run now).

async function requireAdmin() {
  const session = await getServerSession()
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }
  if (session.user.role !== "admin") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }
  return { userId: session.user.id }
}

export type AdminTopicsOrgsResponse = { orgs: OrgTopicsModeRow[] }

export type AdminTopicsModeUpdateResponse = {
  organizationId: string
  mode: TopicsMode
  lastChange: TopicsModeChange | null
}

export async function GET() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  try {
    const body: AdminTopicsOrgsResponse = { orgs: await listOrgTopicsModes() }
    return NextResponse.json(body)
  } catch (error) {
    console.error("[admin/topics] GET error:", error)
    return NextResponse.json({ error: "Failed to load organizations" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const organizationId = typeof body?.organizationId === "string" ? body.organizationId : ""
  const mode = body?.mode
  if (!organizationId || !isTopicsMode(mode)) {
    return NextResponse.json(
      { error: "organizationId and mode (off | shadow | on) are required" },
      { status: 400 },
    )
  }
  try {
    if (!(await organizationExists(organizationId))) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 })
    }
    const saved = await setOrgSetting(organizationId, "topics.enabled", mode, auth.userId)
    const res: AdminTopicsModeUpdateResponse = {
      organizationId,
      mode: saved,
      lastChange: await getLastTopicsModeChange(organizationId),
    }
    return NextResponse.json(res)
  } catch (error) {
    if (error instanceof OrgSettingValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error("[admin/topics] PUT error:", error)
    return NextResponse.json({ error: "Failed to save mode" }, { status: 500 })
  }
}

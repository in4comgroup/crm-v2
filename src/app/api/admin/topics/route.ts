import { NextResponse, type NextRequest } from "next/server"
import { getServerSession } from "@/lib/get-session"
import type { CompletenessItem } from "@/lib/identity/org-profile"
import { OrgSettingValidationError } from "@/server/org-settings"
import {
  getLastTopicsModeChange,
  isTopicsMode,
  listOrgTopicsModes,
  organizationExists,
  setOrgPromptContext,
  setOrgChatSignals,
  setTopicsModeGated,
  type OrgTopicsModeRow,
  type TopicsMode,
  type TopicsModeChange,
} from "@/server/topics/mode"

// Topics engine mode per organization (spec topics/01 §12, plan phase 0
// task 3). Platform admins only.
//   GET → { orgs: OrgTopicsModeRow[] }   every org, its mode, last change
//   PUT { organizationId, mode: off|shadow|on, override?: { reason } }
//       → { organizationId, mode, lastChange, overridden }
//       409 { error, missing: CompletenessItem[] } — identity gate (identity
//       spec I3): `shadow` / `on` need the org profile minimum; `override`
//       with a reason ≥ 10 chars switches anyway (logged in org_setting_log
//       as `topics.enabled.override`). 400 when the reason is too short.
//   PUT { organizationId, chatSignals: boolean } (no `mode`) → «Чат в
//       сигналах» (`topics.chatSignals`, docs/specs/ai-chat Q22).
//   PUT { organizationId, promptContext: boolean } (no `mode`)
//       → { organizationId, promptContext } — identity I4 «Профиль в
//       промптах» (`identity.promptContext`, logged in org_setting_log).
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
  /** True when the identity gate was overridden with a reason. */
  overridden: boolean
}

export type AdminTopicsPromptContextResponse = { organizationId: string; promptContext: boolean }
export type AdminTopicsChatSignalsResponse = { organizationId: string; chatSignals: boolean }

/** 409 / 400 body of the identity gate. */
export type AdminTopicsModeGateError = { error: string; missing: CompletenessItem[] }

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
  // Identity I4: the «Профиль в промптах» switch (no mode in the body).
  if (organizationId && mode === undefined && typeof body?.promptContext === "boolean") {
    try {
      if (!(await organizationExists(organizationId))) {
        return NextResponse.json({ error: "Organization not found" }, { status: 404 })
      }
      const res: AdminTopicsPromptContextResponse = {
        organizationId,
        promptContext: await setOrgPromptContext(organizationId, body.promptContext, auth.userId),
      }
      return NextResponse.json(res)
    } catch (error) {
      console.error("[admin/topics] PUT promptContext error:", error)
      return NextResponse.json({ error: "Failed to save the setting" }, { status: 500 })
    }
  }
  // docs/specs/ai-chat Q22: the «Чат в сигналах» switch (no mode in the body).
  if (organizationId && mode === undefined && typeof body?.chatSignals === "boolean") {
    try {
      if (!(await organizationExists(organizationId))) {
        return NextResponse.json({ error: "Organization not found" }, { status: 404 })
      }
      const res: AdminTopicsChatSignalsResponse = {
        organizationId,
        chatSignals: await setOrgChatSignals(organizationId, body.chatSignals, auth.userId),
      }
      return NextResponse.json(res)
    } catch (error) {
      console.error("[admin/topics] PUT chatSignals error:", error)
      return NextResponse.json({ error: "Failed to save the setting" }, { status: 500 })
    }
  }
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
    const override =
      body?.override && typeof body.override === "object"
        ? (body.override as { reason?: unknown })
        : null
    const result = await setTopicsModeGated(organizationId, mode, auth.userId, override)
    if (!result.ok) {
      const err: AdminTopicsModeGateError = { error: result.error, missing: result.missing }
      return NextResponse.json(err, { status: result.status })
    }
    const res: AdminTopicsModeUpdateResponse = {
      organizationId,
      mode: result.mode,
      lastChange: await getLastTopicsModeChange(organizationId),
      overridden: result.overridden,
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

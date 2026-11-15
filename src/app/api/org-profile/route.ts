// «Профиль организации» (identity spec I1, src/app/AGENTS.md § "Own organization
// profile (identity I1)"). GET → the tab view (any member); GET ?banner=1 →
// the incomplete-profile banner state (owner only shows); PUT → save (org
// owner only, 403 otherwise). All rules live in src/server/identity/org-profile.ts.
import { NextResponse } from "next/server"
import {
  getOrgProfileBannerForSession,
  getOrgProfileViewForSession,
  OrgProfileError,
  saveOrgProfileForSession,
} from "@/server/identity/org-profile"

export type { OrgProfileView, OrgProfileBanner, OrgProfileMember, OrgProfileHistoryRow } from "@/server/identity/org-profile"

function errorResponse(error: unknown) {
  if (error instanceof OrgProfileError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  console.error("[org-profile] Error:", error)
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Request failed" },
    { status: 500 },
  )
}

export async function GET(request: Request) {
  try {
    if (new URL(request.url).searchParams.get("banner") === "1") {
      return NextResponse.json(await getOrgProfileBannerForSession())
    }
    return NextResponse.json(await getOrgProfileViewForSession())
  } catch (error) {
    return errorResponse(error)
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const result = await saveOrgProfileForSession(body?.profile ?? body)
    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error)
  }
}

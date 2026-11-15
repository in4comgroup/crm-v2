import { NextResponse } from "next/server"
import {
  removeOrgIdentityEntry,
  OrgIdentityError,
  orgIdentityErrorStatus,
} from "@/server/org-identity-registry"

function errorResponse(error: unknown) {
  if (error instanceof OrgIdentityError) {
    return NextResponse.json({ error: error.message }, { status: orgIdentityErrorStatus(error) })
  }
  console.error("[org-identity/[id]] Error:", error)
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Request failed" },
    { status: 500 },
  )
}

// Remove a registry entry: org-level kinds by the owner; a `person` entry by
// its member or the owner. Rows previously created under this identity are
// NOT touched — the UI reports them and the owner decides.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    await removeOrgIdentityEntry(id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return errorResponse(error)
  }
}

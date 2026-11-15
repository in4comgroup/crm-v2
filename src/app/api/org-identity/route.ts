// Own-organisation identity registry (see src/app/AGENTS.md § "Own-organisation
// identity registry"). Read by any member. Writes: org-level kinds (name /
// website / email_domain / mailbox / address) by the org owner; `person`
// (a staff member's extra email / Telegram / phone) by the member for
// themselves or by the owner for anyone. All gates live in
// `src/server/org-identity-registry.ts`, never here (rule 4).
import { NextResponse } from "next/server"
import {
  addOrgIdentityEntry,
  canManageOrgIdentity,
  listMyWorkAddresses,
  listOrgIdentityEntries,
  OrgIdentityError,
  orgIdentityErrorStatus,
} from "@/server/org-identity-registry"
import { isIdentityKind } from "@/lib/identity/registry"

export type {
  OrgIdentityEntryView,
  IdentityMatch,
  IdentityMatches,
  AddOrgIdentityResult,
} from "@/server/org-identity-registry"

function errorResponse(error: unknown) {
  if (error instanceof OrgIdentityError) {
    return NextResponse.json({ error: error.message }, { status: orgIdentityErrorStatus(error) })
  }
  console.error("[org-identity] Error:", error)
  const message = error instanceof Error ? error.message : "Unknown error"
  return NextResponse.json({ error: message }, { status: 500 })
}

// GET → { entries, canManage }; GET ?mine=1 → { entries, signInEmail } (the
// caller's own `person` entries, for /profile «Мои адреса для работы»).
export async function GET(request: Request) {
  try {
    if (new URL(request.url).searchParams.get("mine") === "1") {
      const { entries, signInEmail } = await listMyWorkAddresses()
      return NextResponse.json({ entries, signInEmail })
    }
    const [entries, canManage] = await Promise.all([
      listOrgIdentityEntries(),
      canManageOrgIdentity(),
    ])
    return NextResponse.json({ entries, canManage })
  } catch (error) {
    return errorResponse(error)
  }
}

// POST { kind, value, note?, userId?, channel? } → { added, entry, matches }.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const kind = body?.kind
    if (!isIdentityKind(kind)) {
      return NextResponse.json({ error: "Некорректный тип" }, { status: 400 })
    }
    const result = await addOrgIdentityEntry({
      kind,
      value: String(body?.value ?? ""),
      note: typeof body?.note === "string" ? body.note : null,
      userId: typeof body?.userId === "string" ? body.userId : null,
      channel: typeof body?.channel === "string" ? body.channel : null,
    })
    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error)
  }
}

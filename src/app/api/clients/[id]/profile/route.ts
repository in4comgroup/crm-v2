import { NextResponse } from "next/server"
import {
  ClientProfileError,
  confirmClientProfileFieldForSession,
  decideClientProfileProposalForSession,
  getClientProfileViewForSession,
  requireClientProfileSession,
  saveClientProfileForSession,
} from "@/server/identity/client-profile"
import { fillClientProfileFromWeb } from "@/server/identity/client-enrichment"

export type {
  ClientProfileView,
  ClientProfileProposalView,
  FieldMetaView,
} from "@/server/identity/client-profile"
export type { FillProfileResult } from "@/server/identity/client-enrichment"

// «Профиль компании» (identity I5 / I6). Every handler checks the session
// (401) itself; the server module checks the tenant (404) and the edit right
// (responsible member or org owner → else 403).
//   GET                                   → { view }
//   PUT  { profile }                      → { changed, view }
//   POST { action: "confirm", field }     → { view }
//   POST { action: "acceptProposal" | "rejectProposal", proposalId } → { view }
//   POST { action: "enrich" }             → { result, view }  («Заполнить из интернета»)

// «Заполнить из интернета» = two AI calls with web search (8–30 s typical).
export const maxDuration = 60

function errorResponse(e: unknown) {
  if (e instanceof ClientProfileError) {
    return NextResponse.json({ error: e.message }, { status: e.status })
  }
  const message = e instanceof Error ? e.message : "Unknown error"
  // Messages of the shared web lookup (src/server/identity/client-enrichment.ts).
  if (message === "Client not found" || message === "Unauthorized") {
    return NextResponse.json({ error: "Компания не найдена" }, { status: 404 })
  }
  console.error("[api/clients/[id]/profile]", e)
  return NextResponse.json({ error: message }, { status: 500 })
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    return NextResponse.json({ view: await getClientProfileViewForSession(id) })
  } catch (e) {
    return errorResponse(e)
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await requireClientProfileSession()
    const body = (await request.json().catch(() => null)) as { profile?: unknown } | null
    if (!body || typeof body !== "object" || !("profile" in body)) {
      return NextResponse.json({ error: "Нет данных профиля" }, { status: 400 })
    }
    const result = await saveClientProfileForSession(id, body.profile)
    return NextResponse.json({ ...result, view: await getClientProfileViewForSession(id) })
  } catch (e) {
    return errorResponse(e)
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { orgId, userId } = await requireClientProfileSession()
    const body = (await request.json().catch(() => null)) as {
      action?: unknown
      field?: unknown
      proposalId?: unknown
    } | null
    switch (body?.action) {
      case "confirm":
        await confirmClientProfileFieldForSession(id, body.field)
        return NextResponse.json({ view: await getClientProfileViewForSession(id) })
      case "acceptProposal":
      case "rejectProposal":
        await decideClientProfileProposalForSession(id, body.proposalId, body.action === "acceptProposal")
        return NextResponse.json({ view: await getClientProfileViewForSession(id) })
      case "enrich": {
        const result = await fillClientProfileFromWeb(orgId, userId, id)
        return NextResponse.json({ result, view: await getClientProfileViewForSession(id) })
      }
      default:
        return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 })
    }
  } catch (e) {
    return errorResponse(e)
  }
}

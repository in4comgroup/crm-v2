import { NextRequest, NextResponse } from "next/server"
import { applyDiscovery, type ApplyDiscoveryInput } from "@/server/discovery"

export type { ApplyDiscoveryResult } from "@/server/discovery"

// Identity I6: with «Заполнять профиль новых компаний из интернета» on, the
// new clients are web-enriched in `after()` (≤ 20, 240 s deadline) — that
// work runs inside this function's duration.
export const maxDuration = 300

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error"
  const status =
    message === "Unauthorized" || message === "No active organization"
      ? 403
      : 400
  return NextResponse.json({ error: message }, { status })
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<ApplyDiscoveryInput>

    if (
      !Array.isArray(body.selectedClientKeys) ||
      !Array.isArray(body.selectedContactEmails) ||
      !Array.isArray(body.selectedLinks) ||
      !Array.isArray(body.scannedRowIds) ||
      !body.candidates ||
      !Array.isArray(body.candidates.clients) ||
      !Array.isArray(body.candidates.contacts)
    ) {
      return NextResponse.json(
        {
          error:
            "selectedClientKeys, selectedContactEmails, selectedLinks, scannedRowIds and candidates are required",
        },
        { status: 400 },
      )
    }

    const result = await applyDiscovery({
      selectedClientKeys: body.selectedClientKeys,
      selectedContactEmails: body.selectedContactEmails,
      contactNameOverrides: body.contactNameOverrides ?? {},
      selectedLinks: body.selectedLinks,
      scannedRowIds: body.scannedRowIds,
      candidates: body.candidates,
      clientEnrichments: body.clientEnrichments ?? [],
      nativeNames: body.nativeNames ?? [],
      phones: body.phones ?? [],
      positions: body.positions ?? [],
    })
    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error)
  }
}

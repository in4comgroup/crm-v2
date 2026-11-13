import { NextResponse, type NextRequest } from "next/server"
import { exportRegistryMarkdown } from "@/server/signals/export-markdown"
import { SignalsOrgNotFoundError } from "@/server/signals/registry"
import { requireSignalsAdmin } from "../require-admin"

// GET ?orgId= → the registry as Markdown (attachment
// signals-v<version>[-<org>].md). Platform admins only.
export async function GET(request: NextRequest) {
  const auth = await requireSignalsAdmin()
  if (auth.error) return auth.error
  const orgId = request.nextUrl.searchParams.get("orgId") || null
  try {
    const { markdown, fileName } = await exportRegistryMarkdown(orgId)
    return new NextResponse(markdown, {
      status: 200,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    if (error instanceof SignalsOrgNotFoundError) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 })
    }
    console.error("[admin/signals/export] GET error:", error)
    return NextResponse.json({ error: "Failed to export the signals registry" }, { status: 500 })
  }
}

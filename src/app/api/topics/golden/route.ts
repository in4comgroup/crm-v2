import { NextResponse, type NextRequest } from "next/server"
import { GoldenSetError } from "@/server/topics/golden-set"
import {
  GoldenReviewAccessError,
  reviewerCodeOptions,
  reviewerEngineTopics,
  reviewerGetGoldenItem,
  reviewerGroupLabels,
  reviewerListGoldenItems,
  reviewerNextUnreviewed,
  reviewerSaveGoldenItem,
  requireGoldenReviewer,
} from "@/server/topics/golden-review"

// Golden-set REVIEW for the active org («Проверка эталона», /review).
// Caller = org owner / admin of the ACTIVE org (session); the org id is never
// read from the request, every row is tenant-checked. Review actions only.
//   GET ?id=                                 → { item }
//   GET ?codeOptions=1                       → { codes }
//   GET ?groupLabels=1                       → { labels }
//   GET ?engineTopics=<goldenId>             → { topics }   («Взять из движка»)
//   GET ?next=1&after=<goldenId>             → { id | null } (next unreviewed)
//   GET ?status=&synthetic=real|synthetic&suggestions=1|0&limit=&offset=
//                                            → { rows, total, counts }
//   PUT { id, expected?, status?: reviewed|excluded } → { item }

function errorResponse(error: unknown) {
  if (error instanceof GoldenReviewAccessError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.reason === "unauthorized" ? 401 : 403 },
    )
  }
  if (error instanceof GoldenSetError) {
    return NextResponse.json({ error: error.message }, { status: error.reason === "not_found" ? 404 : 400 })
  }
  console.error("[topics/golden] Error:", error)
  return NextResponse.json({ error: "Request failed" }, { status: 500 })
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  try {
    await requireGoldenReviewer()
    const id = sp.get("id")
    if (id) return NextResponse.json({ item: await reviewerGetGoldenItem(id) })
    if (sp.get("codeOptions")) return NextResponse.json({ codes: await reviewerCodeOptions() })
    if (sp.get("groupLabels")) return NextResponse.json({ labels: await reviewerGroupLabels() })
    const engine = sp.get("engineTopics")
    if (engine) return NextResponse.json({ topics: await reviewerEngineTopics(engine) })
    if (sp.get("next")) return NextResponse.json({ id: await reviewerNextUnreviewed(sp.get("after") || null) })
    const synthetic = sp.get("synthetic")
    const suggestions = sp.get("suggestions")
    return NextResponse.json(
      await reviewerListGoldenItems({
        status: sp.get("status") || null,
        synthetic: synthetic === "real" || synthetic === "synthetic" ? synthetic : null,
        suggestions: suggestions === "1" ? true : suggestions === "0" ? false : null,
        limit: Number(sp.get("limit") ?? 200) || 200,
        offset: Number(sp.get("offset") ?? 0) || 0,
      }),
    )
  } catch (error) {
    return errorResponse(error)
  }
}

export async function PUT(request: NextRequest) {
  try {
    await requireGoldenReviewer()
  } catch (error) {
    return errorResponse(error)
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const id = typeof body?.id === "string" ? body.id : null
  if (!body || !id) return NextResponse.json({ error: "id is required" }, { status: 400 })
  try {
    const item = await reviewerSaveGoldenItem(id, {
      ...("expected" in body ? { expected: body.expected } : {}),
      ...(typeof body.status === "string" ? { status: body.status } : {}),
    })
    return NextResponse.json({ item })
  } catch (error) {
    return errorResponse(error)
  }
}

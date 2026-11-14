import { NextResponse, type NextRequest } from "next/server"
import { getServerSession } from "@/lib/get-session"
import { SignalsNotEnabledError } from "@/server/topics/prompt/extraction"
import {
  addSyntheticItem,
  getGoldenItem,
  goldenCodeOptions,
  goldenEngineTopics,
  goldenGroupLabels,
  GoldenSetError,
  listGoldenItems,
  nextUnreviewedGoldenId,
  listGoldenOrgOptions,
  preAnnotate,
  sampleGoldenItems,
  updateGoldenItem,
} from "@/server/topics/golden-set"

export {
  type GoldenListRow,
  type GoldenItemDetail,
  type GoldenCodeOption,
  type GoldenDirection,
} from "@/server/topics/golden-set"

// Topics golden set (plan phase 0 task 7). Platform admins only.
//   GET ?orgOptions=1                                  → { orgs }
//   GET ?id=                                           → { item }
//   GET ?codeOptions=1&orgId=                          → { codes }   (code picker)
//   GET ?groupLabels=1&orgId=                          → { labels }  (topic-group autocomplete)
//   GET ?engineTopics=<goldenId>                       → { topics }  («Взять из движка»)
//   GET ?next=1&after=<goldenId>[&orgId=]              → { id | null } (next unreviewed)
//   GET ?orgId=&status=&synthetic=real|synthetic&suggestions=1|0&limit=&offset=
//                                                      → { rows, total, counts }
//   POST { action: "sample", orgId, count, days }      → { added, candidates, byProvider }
//   POST { action: "synthetic", orgId, text, note? }   → { id }
//   POST { action: "preannotate", orgId, ids[≤10] }    → { results: [{ id, ok, codes?, error? }] }
//   PUT  { id, expected?, status?, note? }             → { item } (an answer alone keeps the status)
// The same editor serves reviewers on /review through /api/topics/golden.

export const maxDuration = 300

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

function errorResponse(error: unknown) {
  // The org has no active signal code: a setup problem the admin fixes in «Сигналы».
  if (error instanceof SignalsNotEnabledError) {
    return NextResponse.json({ error: error.message, code: "signals_not_enabled" }, { status: 400 })
  }
  if (error instanceof GoldenSetError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.reason === "not_found" ? 404 : 400 },
    )
  }
  console.error("[admin/topics/golden] Error:", error)
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Request failed" },
    { status: 500 },
  )
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  const sp = request.nextUrl.searchParams
  try {
    if (sp.get("orgOptions")) {
      return NextResponse.json({ orgs: await listGoldenOrgOptions() })
    }
    const id = sp.get("id")
    if (id) return NextResponse.json({ item: await getGoldenItem(id) })
    const engine = sp.get("engineTopics")
    if (engine) {
      const item = await getGoldenItem(engine)
      return NextResponse.json({ topics: await goldenEngineTopics(item.organizationId, engine) })
    }
    if (sp.get("next")) {
      const after = sp.get("after") || null
      const nextOrg = sp.get("orgId") || (after ? (await getGoldenItem(after)).organizationId : null)
      if (!nextOrg) return NextResponse.json({ error: "orgId is required" }, { status: 400 })
      return NextResponse.json({ id: await nextUnreviewedGoldenId(nextOrg, after) })
    }
    const orgId = sp.get("orgId")
    if (!orgId) return NextResponse.json({ error: "orgId is required" }, { status: 400 })
    if (sp.get("codeOptions")) return NextResponse.json({ codes: await goldenCodeOptions(orgId) })
    if (sp.get("groupLabels")) return NextResponse.json({ labels: await goldenGroupLabels(orgId) })
    const synthetic = sp.get("synthetic")
    const suggestions = sp.get("suggestions")
    const result = await listGoldenItems(orgId, {
      status: sp.get("status") || null,
      synthetic: synthetic === "real" || synthetic === "synthetic" ? synthetic : null,
      suggestions: suggestions === "1" ? true : suggestions === "0" ? false : null,
      limit: Number(sp.get("limit") ?? 200) || 200,
      offset: Number(sp.get("offset") ?? 0) || 0,
    })
    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const orgId = typeof body?.orgId === "string" ? body.orgId : null
  if (!body || !orgId) return NextResponse.json({ error: "orgId is required" }, { status: 400 })
  try {
    switch (body.action) {
      case "sample": {
        const count = Number(body.count)
        const days = Number(body.days)
        if (!Number.isFinite(count) || !Number.isFinite(days)) {
          return NextResponse.json({ error: "count and days are required" }, { status: 400 })
        }
        return NextResponse.json(await sampleGoldenItems(orgId, { count, days }))
      }
      case "synthetic": {
        if (typeof body.text !== "string") {
          return NextResponse.json({ error: "text is required" }, { status: 400 })
        }
        const note = typeof body.note === "string" ? body.note : null
        return NextResponse.json(await addSyntheticItem(orgId, { text: body.text, note }))
      }
      case "preannotate": {
        const ids = Array.isArray(body.ids)
          ? body.ids.filter((x): x is string => typeof x === "string")
          : []
        if (ids.length === 0) return NextResponse.json({ error: "ids are required" }, { status: 400 })
        if (ids.length > 10) return NextResponse.json({ error: "at most 10 ids per call" }, { status: 400 })
        return NextResponse.json({ results: await preAnnotate(orgId, ids) })
      }
      default:
        return NextResponse.json({ error: "unknown action" }, { status: 400 })
    }
  } catch (error) {
    return errorResponse(error)
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const id = typeof body?.id === "string" ? body.id : null
  if (!body || !id) return NextResponse.json({ error: "id is required" }, { status: 400 })
  try {
    const item = await updateGoldenItem(
      id,
      {
        ...("expected" in body ? { expected: body.expected } : {}),
        ...(typeof body.status === "string" ? { status: body.status } : {}),
        ...("note" in body ? { note: typeof body.note === "string" ? body.note : null } : {}),
      },
      auth.userId,
    )
    return NextResponse.json({ item })
  } catch (error) {
    return errorResponse(error)
  }
}

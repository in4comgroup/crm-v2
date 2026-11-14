import { NextResponse, type NextRequest } from "next/server"
import { getServerSession } from "@/lib/get-session"
import { organizationExists } from "@/server/topics/mode"
import { getSourceItemMarkdown } from "@/server/source-items"
import {
  getTopicDebugDetail,
  listTopicsForDebug,
  type TopicDebugDetail,
  type TopicDebugList,
} from "@/server/topics/debug"
import { runTopicResolutionForItem, type ResolveItemOutcome } from "@/server/topics/resolve-phase"
import {
  detachItemFromTopic,
  dismissTopic,
  markTopicDone,
  mergeTopics,
  TopicActionError,
  TopicNotFoundError,
} from "@/server/topics/topic-store"

export type {
  TopicDebugDetail,
  TopicDebugEvent,
  TopicDebugInstance,
  TopicDebugItem,
  TopicDebugList,
  TopicDebugRow,
} from "@/server/topics/debug"

// Topics debug block «Темы (отладка)» (plan phase 3 task 8, spec topics/01
// §6–§7). Platform admins only; any org (organizationId is explicit).
//   GET ?organizationId=&status=&limit=&offset=   → TopicDebugList
//       (status = one or more topic statuses, comma-separated)
//   GET ?organizationId=&id=                      → { detail }  (404 if none)
//   GET ?organizationId=&markdownItemId=          → { markdown } of one source
//       item of THAT org (any org, unlike /api/sources/items/[id]/markdown,
//       which reads the admin's active org only)
//   POST { organizationId, topicId, action, targetTopicId?, sourceItemId?, note? }
//       action: done | dismiss | merge | detachItem | resolveItem
//       → { detail, outcome? }  detail = the topic after the action (null when
//         it was deleted); outcome = resolver result for resolveItem.
//       400 TopicActionError / bad input, 404 TopicNotFoundError.

export const maxDuration = 60

const ACTIONS = ["done", "dismiss", "merge", "detachItem", "resolveItem"] as const
type Action = (typeof ACTIONS)[number]

export type AdminTopicsListResponse = TopicDebugList
export type AdminTopicDetailResponse = { detail: TopicDebugDetail }
export type AdminTopicActionResponse = { detail: TopicDebugDetail | null; outcome?: ResolveItemOutcome }

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

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "")

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  const sp = request.nextUrl.searchParams
  const orgId = sp.get("organizationId")
  if (!orgId) return NextResponse.json({ error: "organizationId is required" }, { status: 400 })
  try {
    const markdownItemId = sp.get("markdownItemId")
    if (markdownItemId) {
      const markdown = await getSourceItemMarkdown(markdownItemId, { requireOrganizationId: orgId })
      if (markdown === null) return NextResponse.json({ error: "Документ не найден" }, { status: 404 })
      return NextResponse.json({ markdown })
    }
    const id = sp.get("id")
    if (id) {
      const detail = await getTopicDebugDetail(orgId, id)
      if (!detail) return NextResponse.json({ error: "Тема не найдена" }, { status: 404 })
      const body: AdminTopicDetailResponse = { detail }
      return NextResponse.json(body)
    }
    const body: AdminTopicsListResponse = await listTopicsForDebug(orgId, {
      status: sp.get("status"),
      limit: Number(sp.get("limit") ?? 50) || 50,
      offset: Number(sp.get("offset") ?? 0) || 0,
    })
    return NextResponse.json(body)
  } catch (error) {
    console.error("[admin/topics/topics] GET error:", error)
    return NextResponse.json({ error: "Не удалось загрузить темы" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const orgId = str(body?.organizationId)
  const topicId = str(body?.topicId)
  const action = str(body?.action) as Action
  const note = str(body?.note) || undefined
  if (!orgId) return NextResponse.json({ error: "Не выбрана организация" }, { status: 400 })
  if (!ACTIONS.includes(action)) return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 })
  if (!topicId && action !== "resolveItem") {
    return NextResponse.json({ error: "Не указана тема" }, { status: 400 })
  }
  if (!(await organizationExists(orgId))) {
    return NextResponse.json({ error: "Организация не найдена" }, { status: 404 })
  }
  const userId = auth.userId
  try {
    let outcome: ResolveItemOutcome | undefined
    switch (action) {
      case "done":
        await markTopicDone(orgId, topicId, userId, note)
        break
      case "dismiss":
        await dismissTopic(orgId, topicId, userId, note)
        break
      case "merge": {
        const target = str(body?.targetTopicId)
        if (!target) return NextResponse.json({ error: "Не выбрана тема для объединения" }, { status: 400 })
        await mergeTopics(orgId, topicId, target, userId)
        break
      }
      case "detachItem": {
        const itemId = str(body?.sourceItemId)
        if (!itemId) return NextResponse.json({ error: "Не указано сообщение" }, { status: 400 })
        await detachItemFromTopic(orgId, topicId, itemId, userId)
        break
      }
      case "resolveItem": {
        const itemId = str(body?.sourceItemId)
        if (!itemId) return NextResponse.json({ error: "Не указано сообщение" }, { status: 400 })
        outcome = await runTopicResolutionForItem(orgId, itemId, { actorUserId: userId })
        break
      }
    }
    const detail = topicId ? await getTopicDebugDetail(orgId, topicId) : null
    const res: AdminTopicActionResponse = { detail, ...(outcome ? { outcome } : {}) }
    return NextResponse.json(res)
  } catch (error) {
    if (error instanceof TopicNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    if (error instanceof TopicActionError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error("[admin/topics/topics] POST error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось выполнить действие" },
      { status: 500 },
    )
  }
}

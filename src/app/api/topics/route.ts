import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "@/lib/get-session"
import { isTopicTab, TOPIC_ACTIONS, type TopicActionInput } from "@/lib/topics/topic-ui"
import {
  getTopicView,
  listDealOptions,
  listMergeOptions,
  listOwnerOptions,
  listTopicClients,
  readTopicCounts,
  readTopicTab,
  requireTopicsOn,
  runTopicAction,
  topicsUiVisible,
  TopicsUserError,
} from "@/server/topics-user"
import { TopicActionError, TopicNotFoundError } from "@/server/topics/topic-store"

// User topics UI (topics plan phase 6, spec topics/01 §14). Session + active
// org required; everything except `?state=1` also requires the org's topics
// mode `on` (409 otherwise — in `off` / `shadow` users see no topics).
//
// GET  ?state=1                         → { visible }  (any mode)
// GET  ?counts=1                        → { counts }   (per tab, all + «Мои»)
// GET  ?tab=now|digest|week|all&mine=1  → TopicListResponse
//        «Все темы» filters: &status=live|all|<status> &list=now|digest|week|none &clientId=
// GET  ?clients=1                       → { clients }  (filter «Компания»)
// GET  ?id=<topicId>                    → { topic: TopicDetailView }
// GET  ?options=merge|deals&id=<topicId> / ?options=owners → { options }
// POST { action, topicId, … }           → { ok, topicId, deleted? } (TopicActionInput)

export type {
  TopicCardView,
  TopicCounts,
  TopicDetailView,
  TopicEntry,
  TopicListResponse,
} from "@/lib/topics/topic-ui"

async function sessionOrg() {
  const session = await getServerSession()
  const orgId = session?.session.activeOrganizationId
  if (!session || !orgId) return null
  return { userId: session.user.id, orgId }
}

function errorResponse(error: unknown) {
  if (error instanceof TopicsUserError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  if (error instanceof TopicNotFoundError) {
    return NextResponse.json({ error: "Тема не найдена" }, { status: 404 })
  }
  if (error instanceof TopicActionError) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  if (error instanceof Error && error.name === "DealEngineError") {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  console.error("[api/topics] Error:", error)
  return NextResponse.json({ error: "Не удалось выполнить запрос" }, { status: 500 })
}

const unauthorized = () => NextResponse.json({ error: "Требуется вход" }, { status: 401 })

export async function GET(request: NextRequest) {
  const ctx = await sessionOrg()
  if (!ctx) return unauthorized()
  const q = request.nextUrl.searchParams
  try {
    if (q.get("state") === "1") {
      return NextResponse.json({ visible: await topicsUiVisible(ctx.orgId) })
    }
    await requireTopicsOn(ctx.orgId)
    if (q.get("counts") === "1") {
      return NextResponse.json({ counts: await readTopicCounts(ctx.orgId, ctx.userId) })
    }
    if (q.get("clients") === "1") {
      return NextResponse.json({ clients: await listTopicClients(ctx.orgId) })
    }
    const options = q.get("options")
    if (options === "owners") {
      return NextResponse.json({ options: await listOwnerOptions(ctx.orgId) })
    }
    const id = q.get("id")
    if (options && id) {
      if (options === "merge") return NextResponse.json({ options: await listMergeOptions(ctx.orgId, id) })
      if (options === "deals") return NextResponse.json({ options: await listDealOptions(ctx.orgId, id) })
      return NextResponse.json({ error: "Неизвестный список" }, { status: 400 })
    }
    if (id) {
      const topic = await getTopicView(ctx.orgId, id)
      if (!topic) return NextResponse.json({ error: "Тема не найдена" }, { status: 404 })
      return NextResponse.json({ topic })
    }
    const tab = q.get("tab") ?? "now"
    if (!isTopicTab(tab)) return NextResponse.json({ error: "Неизвестный список" }, { status: 400 })
    const result = await readTopicTab(ctx.orgId, ctx.userId, tab, {
      mine: q.get("mine") === "1",
      filters: { status: q.get("status"), list: q.get("list"), clientId: q.get("clientId") },
    })
    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error)
  }
}

function parseAction(body: Record<string, unknown>): TopicActionInput | string {
  const action = body.action
  const topicId = typeof body.topicId === "string" ? body.topicId.trim() : ""
  if (typeof action !== "string" || !(TOPIC_ACTIONS as readonly string[]).includes(action)) return "Неизвестное действие"
  if (!topicId) return "Не указана тема"
  const s = (k: string) => (typeof body[k] === "string" ? (body[k] as string).trim() : "")
  const nullable = (k: string) => (body[k] === null ? null : s(k) || null)
  switch (action) {
    case "done":
      return { action, topicId, note: s("note") || undefined }
    case "dismiss":
      return { action, topicId, reason: s("reason") || undefined }
    case "snooze":
      return s("until") ? { action, topicId, until: s("until") } : "Укажите дату"
    case "unsnooze":
    case "recompute":
      return { action, topicId }
    case "merge":
      return s("otherTopicId") ? { action, topicId, otherTopicId: s("otherTopicId") } : "Выберите тему для объединения"
    case "detach":
      return s("sourceItemId") ? { action, topicId, sourceItemId: s("sourceItemId") } : "Не указано сообщение"
    case "link_deal":
      return { action, topicId, dealId: nullable("dealId") }
    case "set_owner":
      return { action, topicId, userId: nullable("userId") }
  }
  return "Неизвестное действие"
}

export async function POST(request: NextRequest) {
  const ctx = await sessionOrg()
  if (!ctx) return unauthorized()
  try {
    await requireTopicsOn(ctx.orgId)
    const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>
    const input = parseAction(body)
    if (typeof input === "string") return NextResponse.json({ error: input }, { status: 400 })
    const result = await runTopicAction(ctx.orgId, ctx.userId, input)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return errorResponse(error)
  }
}

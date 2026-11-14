import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "@/lib/get-session"
import {
  listTopicsForClient,
  listTopicsForContact,
  listTopicsForDeal,
  RelatedTopicsScopeError,
} from "@/server/topics-related"

export type { RelatedTopicRow, RelatedTopicsResult } from "@/server/topics-related"

// «Темы» tab of the company page / drawer, the contact drawer and the deal
// drawer (spec topics/01 §14). GET with exactly one of `clientId`,
// `contactId`, `dealId`. Org = the session's active org. While the org's
// topics mode is not `on`, the answer is `{ visible: false }` with empty
// lists (the UI then hides the tab).

export async function GET(request: NextRequest) {
  const session = await getServerSession()
  const orgId = session?.session.activeOrganizationId
  if (!session || !orgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const params = new URL(request.url).searchParams
  const clientId = params.get("clientId")?.trim() || null
  const contactId = params.get("contactId")?.trim() || null
  const dealId = params.get("dealId")?.trim() || null
  const given = [clientId, contactId, dealId].filter(Boolean).length
  if (given !== 1) {
    return NextResponse.json(
      { error: "Укажите ровно один параметр: clientId, contactId или dealId" },
      { status: 400 },
    )
  }
  try {
    const result = clientId
      ? await listTopicsForClient(orgId, clientId)
      : contactId
        ? await listTopicsForContact(orgId, contactId)
        : await listTopicsForDeal(orgId, dealId!)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof RelatedTopicsScopeError) {
      return NextResponse.json({ error: "Не найдено" }, { status: 404 })
    }
    console.error("[topics/related] Error:", error)
    return NextResponse.json({ error: "Не удалось загрузить темы" }, { status: 500 })
  }
}

import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  toUIMessageStream,
  type UIMessage,
} from "ai"
import { getServerSession } from "@/lib/get-session"
import { computeAnalyticsBounds } from "@/server/analytics-query"
import {
  buildAnalyticsSystemPrompt,
  buildAnalyticsTools,
} from "@/server/analytics-assistant"
import { aiStreamText } from "@/server/ai/runtime"

export const maxDuration = 60

// Session gate + streaming for the analytics assistant. The prompt and the
// single `queryAnalytics` tool live in `src/server/analytics-assistant.ts`.
//
// The org id is bound into the tool from the SESSION — it is never a model
// input, so no prompt injection can widen the scope to another tenant.
//
// Model: AI process «ИИ ассистент аналитики» (`analytics.assistant`).

export async function POST(req: Request) {
  try {
    const { messages }: { messages: UIMessage[] } = await req.json()

    const session = await getServerSession()
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }
    const organizationId = session.session.activeOrganizationId
    if (!organizationId) {
      return Response.json({ error: "No active organization" }, { status: 403 })
    }

    // Default window = the org's real data span, so «за период» means something
    // even when the dataset doesn't straddle today.
    const bounds = await computeAnalyticsBounds(organizationId)
    const from = bounds.first
      ? new Date(`${bounds.first}T00:00:00.000Z`)
      : new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1))
    const to = bounds.last
      ? new Date(new Date(`${bounds.last}T00:00:00.000Z`).getTime() + 86_400_000)
      : new Date()

    const tools = buildAnalyticsTools(organizationId, { from, to })
    const result = await aiStreamText({
      process: "analytics.assistant",
      orgId: organizationId,
      userId: session.user.id,
      instructions: buildAnalyticsSystemPrompt({
        from: bounds.first ?? "—",
        to: bounds.last ?? "—",
      }),
      messages: await convertToModelMessages(messages),
      tools,
      // One query + one answer is the intended shape; a couple of extra steps
      // give room for a genuinely two-part question.
      stopWhen: isStepCount(5),
    })

    // AI SDK 7: stateless helpers (result.toUIMessageStreamResponse() is deprecated).
    return createUIMessageStreamResponse({
      stream: toUIMessageStream({ stream: result.stream, tools }),
    })
  } catch (error) {
    console.error("[analytics-assistant] Error:", error)
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}

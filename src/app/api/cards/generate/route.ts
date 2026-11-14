import { NextRequest, NextResponse } from "next/server"
import { LegacyLogicOffError } from "@/server/topics-legacy"
import {
  cardGenerationStatus,
  generateCards,
  previewCardGenerationCandidates,
  type GenerateCardsInput,
} from "@/server/cards-generation"

// Per-item LLM call (3-10s) × concurrency 3 × cap 50 → comfortably under 300s
// even for the worst-case run. Bump if the cap rises.
export const maxDuration = 300

function errorResponse(error: unknown) {
  // Topics mode `on` (spec topics/01 §9.1, §9.2): the old logic is refused
  // with a Russian message; `code` lets the UI tell it from other errors.
  if (error instanceof LegacyLogicOffError) {
    return NextResponse.json(
      { error: error.message, code: "topics_engine_on" },
      { status: 409 },
    )
  }
  const message = error instanceof Error ? error.message : "Unknown error"
  const status =
    message === "Unauthorized" || message === "No active organization"
      ? 403
      : message.endsWith("not found")
        ? 404
        : 400
  return NextResponse.json({ error: message }, { status })
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url)
    // `?status=1` → `{ enabled, message }`: may the org use this old path
    // (topics mode off / shadow)? The UI hides the button when not.
    if (url.searchParams.get("status") === "1") {
      return NextResponse.json(await cardGenerationStatus())
    }
    const sourceIdsRaw = url.searchParams.get("sourceIds")
    const sourceIds = sourceIdsRaw
      ? sourceIdsRaw.split(",").filter(Boolean)
      : null
    const preview = await previewCardGenerationCandidates({
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
      sourceIds,
      includeAlreadyAnalyzed:
        url.searchParams.get("includeAlreadyAnalyzed") === "1",
    })
    return NextResponse.json(preview)
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    // `modelId` (optional) = the user's model pick, a full model id from
    // GET /api/ai/models?process=cards.generation. Omitted → process default.
    const body = (await request.json()) as Partial<
      Omit<GenerateCardsInput, "requestedModelId">
    > & { modelId?: unknown }
    if (!body.ruleId) {
      return NextResponse.json(
        { error: "ruleId is required" },
        { status: 400 },
      )
    }
    const result = await generateCards({
      from: body.from ?? null,
      to: body.to ?? null,
      sourceIds: body.sourceIds ?? null,
      ruleId: body.ruleId,
      requestedModelId:
        typeof body.modelId === "string" && body.modelId ? body.modelId : null,
      includeAlreadyAnalyzed: body.includeAlreadyAnalyzed === true,
    })
    return NextResponse.json({ success: true, result })
  } catch (error) {
    return errorResponse(error)
  }
}

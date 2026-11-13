import { NextResponse, type NextRequest } from "next/server"
import { getServerSession } from "@/lib/get-session"
import { listUserSelectableModels } from "@/server/ai/registry/assignments"
import { getAiModelNames } from "@/server/ai/registry/models"

// Model picker data for a user-selectable AI process (AI chat, «Найти в
// источниках» for cards / deals). Any signed-in user.
//   GET ?process=chat.assistant → { defaultModelId, models: [{ id, name, vendor }] }
// Only admin-allowed, compatible, available models are returned
// (docs/specs/models/03-processes-and-model-selection.md §4, Q4).

export type AiPickerModel = { id: string; name: string; vendor: string | null }
export type AiPickerResponse = { defaultModelId: string; models: AiPickerModel[] }

export async function GET(request: NextRequest) {
  const session = await getServerSession()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const processKey = request.nextUrl.searchParams.get("process") ?? ""
  try {
    const list = await listUserSelectableModels(processKey)
    if (!list) {
      return NextResponse.json({ error: "Not a user-selectable process" }, { status: 400 })
    }
    const names = list.gatewayId
      ? await getAiModelNames(list.gatewayId, list.modelIds)
      : new Map()
    const body: AiPickerResponse = {
      defaultModelId: list.defaultModelId,
      models: list.modelIds.map((id) => ({
        id,
        name: names.get(id)?.name ?? id,
        vendor: names.get(id)?.vendor ?? id.split("/")[0] ?? null,
      })),
    }
    return NextResponse.json(body)
  } catch (error) {
    console.error("[ai/models] Error:", error)
    return NextResponse.json({ error: "Failed to load models" }, { status: 500 })
  }
}

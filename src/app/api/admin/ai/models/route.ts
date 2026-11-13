import { NextResponse, type NextRequest } from "next/server"
import { getServerSession } from "@/lib/get-session"
import { AI_CAPABILITIES, type AiCapability } from "@/lib/ai-capabilities"
import {
  getAiModel,
  listAiGateways,
  listAiModelFacets,
  listAiModels,
  type AiModelSort,
} from "@/server/ai/registry/models"
import { modelUsageLast30d } from "@/server/ai/usage-stats"

// Model registry for the «Модели» tab on /settings. Platform admins only.
//   GET ?gateways=1                       → { gateways }
//   GET ?facets=1&gatewayId=&type=        → { types, vendors }
//   GET ?gatewayId=&modelId=              → { model, priceHistory, usage30d }
//   GET ?gatewayId=&type=&vendor=…&cap=…&q=&available=1&sort=&dir=&limit=&offset=
//                                         → { rows, total }
// Spec: docs/specs/models/02-model-registry.md §6.

export type {
  AiModelListRow,
} from "@/server/ai/registry/models"
export type AiGatewayRow = Awaited<ReturnType<typeof listAiGateways>>[number]
export type AiModelDetail = NonNullable<Awaited<ReturnType<typeof getAiModel>>> & {
  usage30d: Awaited<ReturnType<typeof modelUsageLast30d>>
}

const SORTS: AiModelSort[] = ["name", "vendor", "cost_input", "cost_output", "context"]

export async function GET(request: NextRequest) {
  const session = await getServerSession()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const sp = request.nextUrl.searchParams
  try {
    if (sp.get("gateways") === "1") {
      return NextResponse.json({ gateways: await listAiGateways() })
    }

    const gatewayId = sp.get("gatewayId")
    if (!gatewayId) {
      return NextResponse.json({ error: "gatewayId is required" }, { status: 400 })
    }

    if (sp.get("facets") === "1") {
      return NextResponse.json(await listAiModelFacets(gatewayId, sp.get("type")))
    }

    const modelId = sp.get("modelId")
    if (modelId) {
      const [detail, usage30d] = await Promise.all([
        getAiModel(gatewayId, modelId),
        modelUsageLast30d(modelId),
      ])
      if (!detail) {
        return NextResponse.json({ error: "Not found" }, { status: 404 })
      }
      return NextResponse.json({ ...detail, usage30d } satisfies AiModelDetail)
    }

    const sort = sp.get("sort") as AiModelSort | null
    const caps = sp
      .getAll("cap")
      .filter((c): c is AiCapability =>
        (AI_CAPABILITIES as readonly string[]).includes(c),
      )
    const result = await listAiModels({
      gatewayId,
      type: sp.get("type"),
      vendors: sp.getAll("vendor").filter(Boolean),
      capabilities: caps,
      q: sp.get("q") ?? undefined,
      availableOnly: sp.get("available") === "1",
      sort: sort && SORTS.includes(sort) ? sort : "name",
      dir: sp.get("dir") === "desc" ? "desc" : "asc",
      limit: Number(sp.get("limit")) || 50,
      offset: Number(sp.get("offset")) || 0,
    })
    return NextResponse.json(result)
  } catch (error) {
    console.error("[admin/ai/models] Error:", error)
    return NextResponse.json({ error: "Failed to load models" }, { status: 500 })
  }
}

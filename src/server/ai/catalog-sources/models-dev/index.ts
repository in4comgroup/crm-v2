import "server-only"

import type { CatalogSource, NormalizedModel } from "@/server/ai/types"

// models.dev — open-source model database (https://github.com/sst/models.dev).
// Our ai_model record uses its field names and units, so the mapping is
// nearly 1:1. Used as an enrichment / fallback source: the provider is
// ai_gateway.models_dev_provider_id (e.g. "vercel", "openrouter").

const API_URL = "https://models.dev/api.json"

type ModelsDevModel = {
  id: string
  name?: string
  description?: string
  family?: string
  type?: string
  attachment?: boolean
  reasoning?: boolean
  tool_call?: boolean
  structured_output?: boolean
  temperature?: boolean
  open_weights?: boolean
  knowledge?: string
  release_date?: string
  last_updated?: string
  status?: string
  modalities?: { input?: string[]; output?: string[] }
  limit?: { context?: number; output?: number }
  cost?: {
    input?: number
    output?: number
    cache_read?: number
    cache_write?: number
    [k: string]: unknown
  }
  canonical_model_id?: string
}

function union(a?: string[] | null, b?: string[] | null): string[] | null {
  const out = [...new Set([...(a ?? []), ...(b ?? [])])]
  return out.length ? out : null
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null)
const bool = (v: unknown) => (typeof v === "boolean" ? v : null)
const str = (v: unknown) => (typeof v === "string" && v ? v : null)

export function mapModelsDevModel(m: ModelsDevModel): NormalizedModel {
  const canonical = str(m.canonical_model_id)
  return {
    modelId: m.id,
    vendor: (canonical ?? m.id).split("/")[0] || null,
    name: str(m.name),
    family: str(m.family),
    description: str(m.description),
    type: str(m.type),
    canonicalModelId: canonical,
    attachment: bool(m.attachment),
    reasoning: bool(m.reasoning),
    toolCall: bool(m.tool_call),
    structuredOutput: bool(m.structured_output),
    temperature: bool(m.temperature),
    openWeights: bool(m.open_weights),
    inputModalities: m.modalities?.input ?? null,
    outputModalities: m.modalities?.output ?? null,
    limitContext: num(m.limit?.context),
    limitOutput: num(m.limit?.output),
    costInput: num(m.cost?.input),
    costOutput: num(m.cost?.output),
    costCacheRead: num(m.cost?.cache_read),
    costCacheWrite: num(m.cost?.cache_write),
    costRaw: m.cost ?? null,
    knowledge: str(m.knowledge),
    releaseDate: str(m.release_date),
    lastUpdated: str(m.last_updated),
    status: str(m.status),
    raw: m,
  }
}

export const modelsDevSource: CatalogSource = {
  key: "models-dev",
  async listModels(gw) {
    const provider = gw.modelsDevProviderId
    if (!provider) return []
    // ~6 MB: too big for the Next.js data cache, so no-store.
    const res = await fetch(API_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) throw new Error(`models.dev: HTTP ${res.status}`)
    const body = (await res.json()) as Record<
      string,
      { models?: Record<string, ModelsDevModel> }
    >
    const models = body[provider]?.models
    if (!models) throw new Error(`models.dev: unknown provider "${provider}"`)
    return Object.values(models)
      .filter((m) => typeof m?.id === "string")
      .map((m) => {
        const record = mapModelsDevModel(m)
        // A gateway's entry can under-report what the model accepts (e.g.
        // Vercel lists no audio/video for Gemini 2.5 Flash). The model
        // maker's own entry in models.dev (found by canonical id
        // "<vendor>/<model>") is added, as a union.
        const [vendor, ...rest] = (m.canonical_model_id ?? "").split("/")
        const own = vendor && rest.length ? body[vendor]?.models?.[rest.join("/")] : undefined
        if (own && vendor !== provider) {
          record.inputModalities = union(record.inputModalities, own.modalities?.input)
          record.outputModalities = union(record.outputModalities, own.modalities?.output)
        }
        return record
      })
  },
}

import "server-only"

import {
  configString,
  type GatewayConfig,
  type NormalizedModel,
} from "@/server/ai/types"

// Vercel AI Gateway catalog: GET <baseUrl>/models (public, no key needed).
// Maps the Vercel record to the vendor-neutral NormalizedModel. Vercel
// prices are USD per token (strings) → converted to USD per 1M tokens.

const DEFAULT_BASE_URL = "https://ai-gateway.vercel.sh/v1"

type VercelModel = {
  id: string
  owned_by?: string
  name?: string
  description?: string
  type?: string
  released?: number
  context_window?: number
  max_tokens?: number
  tags?: string[]
  modalities?: { input?: string[]; output?: string[] }
  temperature?: boolean
  knowledge?: string
  zdr?: string
  no_training?: string
  regions?: string[]
  deprecated_at?: number | string | null
  pricing?: Record<string, unknown>
}

// "0.0000003" (USD / token) → 0.3 (USD / 1M tokens). Rounded to the
// 6 decimals of the numeric(14,6) columns to drop float noise.
function perMillion(v: unknown): number | null {
  if (typeof v !== "string" && typeof v !== "number") return null
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 1e6 * 1e6) / 1e6
}

function plainNumber(v: unknown): number | null {
  if (typeof v !== "string" && typeof v !== "number") return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function toDate(v: unknown): Date | null {
  if (typeof v === "number") return new Date(v < 1e12 ? v * 1000 : v)
  if (typeof v === "string" && v) {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

function inputModalities(m: VercelModel, tags: Set<string>): string[] | null {
  if (m.modalities?.input?.length) return m.modalities.input
  if (!m.tags) return null
  // No explicit modalities: derive from capability tags.
  const out = ["text"]
  if (tags.has("vision")) out.push("image")
  if (tags.has("file-input")) out.push("pdf")
  if (tags.has("audio-input")) out.push("audio")
  if (tags.has("video-input")) out.push("video")
  return out
}

export function mapVercelModel(m: VercelModel): NormalizedModel {
  const tags = new Set(m.tags ?? [])
  const hasTags = Array.isArray(m.tags)
  // A tag list is authoritative for the gateway: absent tag = not supported.
  const tag = (t: string) => (hasTags ? tags.has(t) : null)
  const p = m.pricing ?? {}
  const deprecatedAt = toDate(m.deprecated_at)
  return {
    modelId: m.id,
    vendor: m.owned_by ?? m.id.split("/")[0] ?? null,
    name: m.name ?? m.id,
    description: m.description ?? null,
    type: m.type ?? null,
    attachment: tag("file-input"),
    reasoning: tag("reasoning"),
    toolCall: tag("tool-use"),
    structuredOutput: tag("structured-output"),
    temperature: typeof m.temperature === "boolean" ? m.temperature : null,
    openWeights: tag("open-weights"),
    webSearch: tag("web-search"),
    inputModalities: inputModalities(m, tags),
    outputModalities: m.modalities?.output ?? null,
    limitContext: m.context_window ?? null,
    limitOutput: m.max_tokens ?? null,
    costInput: perMillion(p.input),
    costOutput: perMillion(p.output),
    costCacheRead: perMillion(p.input_cache_read),
    costCacheWrite: perMillion(p.input_cache_write),
    // Vercel gives web search as USD per 1,000 searches already.
    costWebSearch: plainNumber(p.web_search),
    costRaw: m.pricing ?? null,
    knowledge: m.knowledge ?? null,
    releaseDate: m.released
      ? new Date(m.released * 1000).toISOString().slice(0, 10)
      : null,
    status:
      deprecatedAt && deprecatedAt.getTime() <= Date.now() ? "deprecated" : null,
    zdr: m.zdr ?? null,
    noTraining: m.no_training ?? null,
    regions: m.regions ?? null,
    deprecatedAt,
    raw: m,
  }
}

export async function listVercelCatalog(
  gw: GatewayConfig,
): Promise<NormalizedModel[]> {
  const base = (configString(gw, "baseUrl") ?? DEFAULT_BASE_URL).replace(/\/+$/, "")
  const res = await fetch(`${base}/models`, {
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) {
    throw new Error(`Vercel AI Gateway /models: HTTP ${res.status}`)
  }
  const body = (await res.json()) as { data?: VercelModel[] }
  if (!Array.isArray(body.data)) {
    throw new Error("Vercel AI Gateway /models: no data array")
  }
  return body.data.filter((m) => typeof m?.id === "string").map(mapVercelModel)
}

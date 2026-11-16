import "server-only"

import { createGateway, type LanguageModel } from "ai"
import { google } from "@ai-sdk/google"
import {
  configString,
  type AiGatewayAdapter,
  type GatewayConfig,
} from "@/server/ai/types"
import { listVercelCatalog } from "./catalog"

// Vercel AI Gateway adapter (docs/specs/models/01-gateway-providers.md §4).
// All Vercel- and vendor-specific code of the AI layer lives in this folder.

// One provider instance per gateway row + key (stateless otherwise).
const providers = new Map<string, ReturnType<typeof createGateway>>()

function provider(gw: GatewayConfig) {
  const apiKey = gw.credentialsEnv ? process.env[gw.credentialsEnv] : undefined
  // config.baseUrl is the OpenAI-compatible /v1 base (catalog). The AI SDK
  // provider uses its own API path; override it only via config.sdkBaseUrl.
  const baseURL = configString(gw, "sdkBaseUrl") ?? undefined
  const cacheKey = `${gw.id}|${baseURL ?? ""}|${apiKey ?? ""}`
  let p = providers.get(cacheKey)
  if (!p) {
    // No apiKey → the SDK's own default (AI_GATEWAY_API_KEY / Vercel OIDC).
    p = createGateway({ ...(apiKey ? { apiKey } : {}), ...(baseURL ? { baseURL } : {}) })
    providers.set(cacheKey, p)
  }
  return p
}

function obj(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : undefined
}

export const vercelAiGatewayAdapter: AiGatewayAdapter = {
  key: "vercel-ai-gateway",
  listCatalog: listVercelCatalog,
  fallbackModelsSupported: true,
  privacyRouting: true,

  languageModel(modelId, gw): LanguageModel {
    return provider(gw)(modelId)
  },

  callOptions({ process, orgId, userId, fallbackModelIds, privacy }) {
    // Tags show up in the gateway's own spend reports.
    const tags = [`process:${process}`, ...(orgId ? [`org:${orgId}`] : [])]
    return {
      gateway: {
        ...(fallbackModelIds.length ? { models: fallbackModelIds } : {}),
        tags,
        ...(userId ? { user: userId } : {}),
        // Model policy: the gateway routes only to compliant providers.
        ...(privacy.zeroDataRetention ? { zeroDataRetention: true } : {}),
        ...(privacy.noPromptTraining ? { disallowPromptTraining: true } : {}),
      },
    }
  },

  readResult(result) {
    const str = (v: unknown) => (typeof v === "string" && v ? v : undefined)
    // AI SDK 7: last-step data lives on `finalStep` (the top-level fields
    // are deprecated aliases; aborted streams pass a plain step).
    const last = result.finalStep ?? result
    const meta = obj(last.providerMetadata)
    const gw = obj(meta?.gateway)
    const routing = obj(gw?.routing)
    // The model that actually answered (after a gateway model fallback) is
    // the successful entry of routing.modelAttempts.
    const attempts = Array.isArray(routing?.modelAttempts) ? routing.modelAttempts : []
    const served = attempts.map(obj).find((a) => a?.success === true)

    // Per step: generation id, inline cost, grounding. A multi-step call
    // (tools) is several gateway generations.
    const steps = result.steps?.length ? result.steps : [{ providerMetadata: last.providerMetadata, response: last.response }]
    const responseIds: string[] = []
    let costUsd: number | undefined = 0
    let webSearchCount = 0
    for (const step of steps) {
      const sm = obj(step.providerMetadata)
      const sgw = obj(sm?.gateway)
      const id = str(sgw?.generationId)
      if (id) responseIds.push(id)
      const cost = Number(sgw?.cost)
      if (costUsd !== undefined && sgw?.cost != null && Number.isFinite(cost)) costUsd += cost
      else costUsd = undefined
      // Google grounding metadata sits under the UPSTREAM provider's key
      // ("vertex" or "google"), so look under every key but "gateway".
      const grounded = Object.entries(sm ?? {}).some(
        ([k, v]) => k !== "gateway" && obj(v)?.groundingMetadata != null,
      )
      if (grounded) webSearchCount++
    }

    return {
      responseId: responseIds.at(-1) ?? str(gw?.generationId) ?? str(last.response?.id),
      responseIds,
      responseModel: str(served?.canonicalSlug) ?? str(last.response?.modelId),
      providerName: str(routing?.finalProvider) ?? str(routing?.resolvedProvider),
      webSearchGrounded: (result.sources?.length ?? 0) > 0 || webSearchCount > 0,
      webSearchCount,
      costUsd,
    }
  },

  async lookupCost(responseId, gw) {
    const info = await provider(gw).getGenerationInfo({ id: responseId })
    return Number.isFinite(info.totalCost) ? info.totalCost : null
  },

  capabilityTools(cap, model) {
    if (cap !== "web_search") return null
    // Google grounding works only on Google models. Other vendors' native
    // search tools can be added here later (03 §6).
    const vendor = model.vendor ?? model.modelId.split("/")[0]
    if (vendor === "google") {
      return { google_search: google.tools.googleSearch({}) }
    }
    return null
  },
}

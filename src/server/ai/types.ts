import "server-only"

import type { generateText, LanguageModel, ToolSet } from "ai"
import type { AiGateway } from "@/db/schema"

// Shared types of the vendor-neutral AI layer
// (docs/specs/models/01-gateway-providers.md §4).

// The `ai_gateway` row. Adapters and catalog sources are stateless: all
// config comes from this row + the env var it names.
export type GatewayConfig = AiGateway

// One model as a catalog source reports it, in the models.dev-aligned shape
// of `ai_model` (02 §3). Costs are USD per 1M tokens (web search: USD per
// 1,000 searches). Every field except `modelId` is optional: a source sets
// only what it knows; null / undefined = unknown.
export type NormalizedModel = {
  modelId: string
  vendor?: string | null
  name?: string | null
  family?: string | null
  description?: string | null
  type?: string | null
  canonicalModelId?: string | null
  attachment?: boolean | null
  reasoning?: boolean | null
  toolCall?: boolean | null
  structuredOutput?: boolean | null
  temperature?: boolean | null
  openWeights?: boolean | null
  webSearch?: boolean | null
  inputModalities?: string[] | null
  outputModalities?: string[] | null
  limitContext?: number | null
  limitOutput?: number | null
  costInput?: number | null
  costOutput?: number | null
  costCacheRead?: number | null
  costCacheWrite?: number | null
  costWebSearch?: number | null
  costRaw?: Record<string, unknown> | null
  knowledge?: string | null
  releaseDate?: string | null
  lastUpdated?: string | null
  status?: string | null
  zdr?: string | null
  noTraining?: string | null
  regions?: string[] | null
  deprecatedAt?: Date | null
  // The source's original record, stored in ai_model.raw[<source key>].
  raw: unknown
}

// The fields of NormalizedModel that the merge copies into ai_model.
export const NORMALIZED_FIELDS = [
  "vendor",
  "name",
  "family",
  "description",
  "type",
  "canonicalModelId",
  "attachment",
  "reasoning",
  "toolCall",
  "structuredOutput",
  "temperature",
  "openWeights",
  "webSearch",
  "inputModalities",
  "outputModalities",
  "limitContext",
  "limitOutput",
  "costInput",
  "costOutput",
  "costCacheRead",
  "costCacheWrite",
  "costWebSearch",
  "costRaw",
  "knowledge",
  "releaseDate",
  "lastUpdated",
  "status",
  "zdr",
  "noTraining",
  "regions",
  "deprecatedAt",
] as const satisfies readonly Exclude<keyof NormalizedModel, "modelId" | "raw">[]

export type NormalizedField = (typeof NORMALIZED_FIELDS)[number]

// A pluggable catalog source (02 §5). Listed by key in
// ai_gateway.catalog_sources; the first one is authoritative.
export interface CatalogSource {
  key: string
  listModels(gw: GatewayConfig): Promise<NormalizedModel[]>
}

// AI SDK provider options (vendor-keyed bag, e.g. { gateway: {...} }).
export type AiProviderOptions = NonNullable<
  Parameters<typeof generateText>[0]["providerOptions"]
>

// What the runtime tells an adapter about a call.
export type AiCallOptionsInput = {
  process: string
  orgId: string | null
  userId: string | null
  // Ordered fallback model ids (after the primary).
  fallbackModelIds: string[]
  // Admin model policy (03 §7): route only to providers that keep no data /
  // do not train on prompts. Only sent when the adapter has privacyRouting.
  privacy: { zeroDataRetention: boolean; noPromptTraining: boolean }
}

// What an adapter reads back from a result, in OpenTelemetry GenAI terms.
export type AiResultInfo = {
  responseId?: string // gen_ai.response.id (gateway generation id)
  responseModel?: string // gen_ai.response.model (after fallback)
  providerName?: string // gen_ai.provider.name of the upstream provider
  // For web-search calls: real search results backed the answer.
  webSearchGrounded?: boolean
  // Every step's generation id (multi-step calls), oldest first.
  responseIds?: string[]
  // Exact cost reported inline by the gateway, summed over all steps.
  // Undefined when any step lacks it (then reconcile via lookupCost).
  costUsd?: number
  // Billed web-search requests (grounded steps), for the cost estimate.
  webSearchCount?: number
}

// The subset of an AI SDK result an adapter may read.
export type AiResultLike = {
  providerMetadata?: unknown
  response?: { id?: string; modelId?: string }
  sources?: unknown[]
  steps?: { providerMetadata?: unknown; response?: { id?: string } }[]
}

// Capabilities that need a vendor tool (02 §4, 03 §6).
export type AiToolCapability = "web_search"

// Gateway adapter (01 §4): the ONLY place with gateway / vendor specifics.
export interface AiGatewayAdapter {
  key: string
  // The gateway's own model catalog, normalized. Used by the "gateway-api"
  // catalog source. Absent = the gateway has no catalog endpoint.
  listCatalog?(gw: GatewayConfig): Promise<NormalizedModel[]>
  // Standard AI SDK model handle for a model id of this gateway.
  languageModel(modelId: string, gw: GatewayConfig): LanguageModel
  // Per-call provider options: fallbacks, attribution, user.
  callOptions(input: AiCallOptionsInput, gw: GatewayConfig): AiProviderOptions
  readResult(result: AiResultLike, gw: GatewayConfig): AiResultInfo
  // True = the gateway tries fallback models itself (from callOptions);
  // false = the runtime retries the fallback list.
  fallbackModelsSupported: boolean
  // True = the gateway can restrict ONE call to zero-data-retention /
  // no-training providers, so a model whose providers are only partly
  // compliant ("some") is usable under that policy. False = only models
  // marked "all" qualify.
  privacyRouting: boolean
  // Vendor tools for a capability, for this model. null = this gateway
  // cannot give the capability to this model (03 §3 rule 4).
  capabilityTools(
    cap: AiToolCapability,
    model: { modelId: string; vendor: string | null },
  ): ToolSet | null
  // Exact cost of a finished call, USD (P3 reconcile). Absent = unsupported.
  lookupCost?(responseId: string, gw: GatewayConfig): Promise<number | null>
}

// Reads a non-secret string from ai_gateway.config.
export function configString(gw: GatewayConfig, key: string): string | null {
  const v = (gw.config ?? {})[key]
  return typeof v === "string" && v.length > 0 ? v : null
}

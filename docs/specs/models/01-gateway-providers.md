# Architecture, standards and gateway providers (R1)

## 1. Goal

Business code knows **processes**, never gateways, vendors or model ids. All
gateway- and vendor-specific code lives in one isolated layer, so a new
gateway (OpenRouter, LiteLLM, Cloudflare AI Gateway, a direct provider API)
is added with config or one adapter file — no change to business code.

Where an open standard exists, we use it instead of inventing our own format.

## 2. Standards we reuse

| Concern | Standard | How we use it |
| --- | --- | --- |
| Calling a model | **AI SDK Language Model Specification** (open, Apache-2.0; the interface every AI SDK provider implements — Vercel AI Gateway lists it as `supported_specifications: v2, v3, v4`) | Every adapter returns a standard `LanguageModel`. Business code uses only AI SDK core primitives (`Output`, `tool`, `stepCountIs`, message types) through our layer |
| Talking to a gateway | **OpenAI-compatible HTTP API** (`/v1/chat/completions`, `/v1/models`) — the de facto common protocol of Vercel AI Gateway, OpenRouter, LiteLLM, Cloudflare AI Gateway and most providers | A generic adapter (`openai-compatible`, built on `@ai-sdk/openai-compatible`) covers any such gateway with **config only**: base URL + key env var |
| Model metadata | **models.dev schema** (open-source model database by the SST/opencode team; ids match AI SDK ids; covers 236 providers incl. `vercel` and `openrouter`) | Our normalized model record uses its field names and units (02 §3). models.dev is also a **fallback catalog source** for gateways whose own API returns only ids |
| Usage / telemetry | **OpenTelemetry GenAI semantic conventions** (`gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.response.id`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.operation.name`) | Usage-ledger columns map 1:1 to these names (04 §2), so the same data can later be exported as OTel spans (AI SDK telemetry) without remapping |

Notes:
- The OTel GenAI conventions are still "Development" status; names may change.
  We keep a mapping table, not hard dependencies.
- models.dev data is community-maintained; the gateway's own catalog stays the
  authority for availability and the gateway's price.

## 3. Layers and boundaries

```
business code (routes, server functions, parsers)
   │  imports ONLY  @/server/ai   (aiGenerateText, aiStreamText, process keys, types)
   ▼
src/server/ai/                      ← vendor-neutral core
   runtime     resolve process → model, call AI SDK core, record usage
   processes   process catalog (code)
   registry    ai_gateway / ai_model access, compatibility rules
   usage       usage ledger, cost, statistics
   catalog     catalog sync orchestration (sources are pluggable)
   tools       capability tools (e.g. webSearch) — asks the adapter for the vendor tool
   ▼
src/server/ai/gateways/<adapter>/   ← the ONLY place with gateway/vendor specifics
   vercel-ai-gateway   @ai-sdk/gateway, /v1/models, generation lookup
   openai-compatible   @ai-sdk/openai-compatible + config (future gateways)
src/server/ai/catalog-sources/<source>/
   gateway-api         the adapter's own catalog endpoint
   models-dev          https://models.dev/api.json (fallback / enrichment)
```

Rules (enforced by ESLint `no-restricted-imports`, added to the repo):

1. Outside `src/server/ai/**`: importing `generateText`, `streamText`,
   `generateObject`, `streamObject` from `ai`, or any `@ai-sdk/*` provider
   package, is a lint **error**. Type-only and spec-level imports from `ai`
   (`Output`, `tool`, `stepCountIs`, `ModelMessage`, …) are allowed.
2. Outside `src/server/ai/gateways/**` and `src/server/ai/catalog-sources/**`:
   importing `@ai-sdk/gateway`, `@ai-sdk/google`, `@ai-sdk/openai`,
   `@ai-sdk/openai-compatible`, … is an **error** — even inside the core.
3. No model id, vendor name or gateway URL literal in business code. Model ids
   exist only in the process catalog defaults and in the DB.
4. DB columns are vendor-neutral. Gateway-specific data goes into `raw` /
   `pricing_raw` jsonb only.

## 4. Adapter interface

```ts
interface AiGatewayAdapter {
  key: string                                     // "vercel-ai-gateway", "openai-compatible"
  // Standard AI SDK model handle
  languageModel(modelId: string, gw: GatewayConfig): LanguageModel
  // Per-call options: fallbacks, attribution tags, user, privacy
  callOptions(input: CallOptionsInput, gw: GatewayConfig): ProviderOptions
  // Normalize what happened, in OTel GenAI terms
  readResult(result, gw: GatewayConfig): {
    responseId?: string                           // gen_ai.response.id (gateway generation id)
    responseModel?: string                        // gen_ai.response.model (after fallback)
    providerName?: string                         // gen_ai.provider.name of the upstream
  }
  // Optional capabilities — absent = not supported by this gateway
  listCatalog?(gw: GatewayConfig): Promise<NormalizedModel[]>   // the gateway's own catalog, read by the "gateway-api" source
  lookupCost?(responseId: string, gw: GatewayConfig): Promise<number | null>   // USD
  fallbackModelsSupported: boolean                // gateway-side model fallback
  // Vendor tools for a capability, for the served model's vendor
  capabilityTool?(cap: "web_search", model: AiModelRecord): Tool | null
}

interface CatalogSource {
  key: string                                     // "gateway-api", "models-dev"
  listModels(gw: GatewayConfig): Promise<NormalizedModel[]>   // models.dev-shaped (02 §3)
}
```

`GatewayConfig` is the `ai_gateway` row (§5). Adapters are stateless; all
config comes from the row + the env var it names.

Vercel adapter:

| Method | Vercel AI Gateway |
| --- | --- |
| `listCatalog` | `GET <config.baseUrl>/models` (public); USD/token → USD/1M; tags → capability booleans (**built in P1**) |
| `languageModel` | `gateway(modelId)` (`@ai-sdk/gateway`) |
| `callOptions` | `providerOptions.gateway = { models: fallbacks, tags, user, zeroDataRetention }` |
| `readResult` | `providerMetadata.gateway.generationId`, routing attempts |
| `lookupCost` | `getGenerationInfo({ id })` → `totalCost` |
| `capabilityTool('web_search')` | Google models: `google.tools.googleSearch({})`; other vendors: their native search tool when the gateway supports it, else `null` |

Generic `openai-compatible` adapter (future gateways): `createOpenAICompatible
({ baseURL: config.baseUrl, apiKey: env[credentials_env] })`; no cost lookup,
no gateway fallbacks (the runtime retries the fallback list itself); catalog
from `/v1/models` + models.dev enrichment.

## 5. Table `ai_gateway`

| Column | Type | Note |
| --- | --- | --- |
| `id` | text PK | `vercel` |
| `name` | text | «Vercel AI Gateway» |
| `adapter` | text | `vercel-ai-gateway` / `openai-compatible` |
| `catalog_sources` | text[] | Ordered, e.g. `{gateway-api,models-dev}` — first source is authoritative, later ones only fill empty fields |
| `models_dev_provider_id` | text | Provider id in models.dev (e.g. `vercel`, `openrouter`) for the fallback source |
| `is_enabled` | boolean | |
| `is_default` | boolean | Exactly one (partial unique index) |
| `config` | jsonb | Non-secret, e.g. `{ "baseUrl": "…" }` |
| `credentials_env` | text | Env var name with the key (`AI_GATEWAY_API_KEY`); secrets never in the DB |
| `last_synced_at`, `last_sync_error` | | Catalog sync status |
| `created_at`, `updated_at` | timestamp | |

Seed: one row `vercel` (`adapter = vercel-ai-gateway`,
`catalog_sources = {gateway-api,models-dev}`, `models_dev_provider_id =
vercel`) in a custom migration.

**Adding a gateway later:**
- OpenAI-compatible (OpenRouter, LiteLLM, …): insert a row with
  `adapter = openai-compatible`, set the env var — no code.
- Anything else: one new adapter folder under `gateways/`, register it,
  insert the row. Business code, processes and statistics are unchanged.

## 6. Runtime entry points

All 21 call sites move to:

```ts
aiGenerateText({ process: "parsing.email", orgId, userId, ...sdkParams })
aiStreamText({ process: "chat.assistant", orgId, userId, ...sdkParams })
```

`orgId` and `userId` are **required** in the type (null only for explicitly
system-level calls, which must pass `system: true`). Steps per call:

1. Resolve the process assignment (03) → gateway + primary model + fallbacks.
2. Adapter builds the `LanguageModel` and `providerOptions`; capability tools
   (e.g. `webSearch`) are attached via `capabilityTool`.
3. Call AI SDK core with the caller's params.
4. If the gateway does not do fallbacks itself, the runtime retries the next
   fallback model on a retryable error.
5. On finish (streams: `onFinish`; errors: `onError` / catch) write one usage
   event (04). Recording failures are logged and never break the call.
6. Return the SDK result unchanged.

Hard-coded model lists (`MODELS`, `PARSER_CONFIG.*.model`,
`WEB_SEARCH_MODEL`, `PARSER_MODEL`) are removed. `source_item.parser_model` is
stamped from `gen_ai.response.model`.

## 7. Out of scope now

- Building a second adapter (only `vercel-ai-gateway`; `openai-compatible` is
  designed, built when a second gateway is needed).
- Per-organization BYOK.
- OTel export (the ledger is OTel-shaped, so this is a later add-on).

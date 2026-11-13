# Model registry (R2, R3)

## 1. Goal

A DB copy of every model each enabled gateway offers, with prices and
capabilities, refreshed automatically. The registry is the only source for
model pickers and for cost calculation.

## 2. What Vercel AI Gateway returns (measured 2026-11-13)

`GET /v1/models` (public, no key needed) returned **511 models from 54
vendors**:

| Type | Count | Type | Count |
| --- | --- | --- | --- |
| language | 326 | speech | 24 |
| image | 41 | evaluation | 21 |
| video | 36 | transcription | 16 |
| embedding | 28 | realtime | 10 |
| | | reranking | 9 |

Fields per model: `id`, `name`, `description`, `owned_by` (vendor), `type`,
`created`, `released`, `context_window`, `max_tokens`, `tags`, `modalities`
(input/output), `supported_parameters`, `reasoning_options`, `knowledge`,
`zdr`, `no_training`, `regions`, `deprecated_at`, `pricing`.

Capability tags seen: `tool-use` (309), `structured-output` (285),
`reasoning` (273), `vision` (265), `implicit-caching` (231), `file-input` (183),
`web-search` (101), `explicit-caching` (77), `video-input` (30),
`audio-input` (8), `image-generation`, `fast`, `open-weights`, `free`, …

Pricing (USD, strings): per token `input`, `output`, `input_cache_read`,
`input_cache_write`; plus context-length tiers (`input_tiers`, …),
`service_tiers` (priority / flex), `regional`, `web_search`, `image`, speech /
transcription per second, and `varies_by_provider`.

## 3. Table `ai_model` — normalized record (models.dev-aligned)

Field names and units follow the **models.dev schema** (01 §2) wherever it has
a field; our extensions are marked *ext*. Costs are **USD per 1M tokens**, as
in models.dev (the Vercel API gives USD per token; the source converts).

| Column | Type | models.dev field | Note |
| --- | --- | --- | --- |
| `gateway_id` | text FK → `ai_gateway` | — | PK part 1 |
| `model_id` | text | `id` | PK part 2, e.g. `google/gemini-2.5-flash` (same id as the AI SDK) |
| `vendor` | text | provider of `canonical_model_id` / `owned_by` | google, openai, anthropic, … |
| `name` | text | `name` | |
| `family` | text | `family` | e.g. `gemini-flash` |
| `description` | text | `description` | |
| `type` | text | `type` | language, embedding, image, … (default language) |
| `canonical_model_id` | text | `canonical_model_id` | Same model across gateways |
| `attachment` | boolean | `attachment` | Accepts file input |
| `reasoning` | boolean | `reasoning` | |
| `tool_call` | boolean | `tool_call` | |
| `structured_output` | boolean | `structured_output` | |
| `temperature` | boolean | `temperature` | Supports temperature |
| `open_weights` | boolean | `open_weights` | |
| `web_search` | boolean | *ext* | Native web search (Vercel tag `web-search`) |
| `input_modalities` | text[] | `modalities.input` | text, image, pdf, audio, video |
| `output_modalities` | text[] | `modalities.output` | |
| `limit_context` | integer | `limit.context` | |
| `limit_output` | integer | `limit.output` | |
| `cost_input` | numeric(14,6) | `cost.input` | USD / 1M tokens |
| `cost_output` | numeric(14,6) | `cost.output` | |
| `cost_cache_read` | numeric(14,6) | `cost.cache_read` | nullable |
| `cost_cache_write` | numeric(14,6) | `cost.cache_write` | nullable |
| `cost_web_search` | numeric(14,6) | *ext* | nullable; USD per 1,000 searches (unit to verify against the invoice) |
| `cost_raw` | jsonb | *ext* | Full source price object (tiers, service tiers, regional, media) |
| `knowledge` | text | `knowledge` | Knowledge cutoff |
| `release_date` | date | `release_date` | |
| `last_updated` | date | `last_updated` | |
| `status` | text | `status` | e.g. deprecated / beta, from the source |
| `zdr` | text | *ext* | Zero data retention: all / some / none |
| `no_training` | text | *ext* | all / some / none |
| `regions` | text[] | *ext* | |
| `deprecated_at` | timestamp | *ext* | |
| `is_available` | boolean | — | false when the model disappears from the authoritative source |
| `field_sources` | jsonb | — | Which source filled which field, e.g. `{ "cost_input": "gateway-api", "family": "models-dev" }` |
| `raw` | jsonb | — | Original records per source, keyed by source |
| `first_seen_at`, `last_seen_at`, `updated_at` | timestamp | — | |

Indexes: `(gateway_id, type)`, `(vendor)`, `(canonical_model_id)`, trigram on
`model_id || ' ' || name || ' ' || vendor` for search.

## 4. Capabilities used by the UI and compatibility rules

Derived from the record, one fixed list (vendor-neutral):

| Capability | From |
| --- | --- |
| `tools` | `tool_call` |
| `structured_output` | `structured_output` |
| `web_search` | `web_search` |
| `reasoning` | `reasoning` |
| `image_input` | `image` in `input_modalities` |
| `pdf_input` | `pdf` in `input_modalities` |
| `audio_input` | `audio` in `input_modalities` |
| `video_input` | `video` in `input_modalities` |

Each catalog source maps its own data to the record (e.g. Vercel tag
`tool-use` → `tool_call = true`, `vision` → `image` modality).

## 5. Sync

- `syncModelCatalog(gatewayId)` (`src/server/ai/catalog/`): for each source in
  `ai_gateway.catalog_sources`, in order: `source.listModels()` → merge.
  - The **first** source is authoritative: it decides which models exist
    (`is_available`) and its non-null values win.
  - Later sources (models.dev) only **fill empty fields** (e.g. `family`,
    `knowledge`, a missing capability or price). `field_sources` records
    where each value came from.
  - Matching across sources by `model_id`, then by `canonical_model_id`.
- Models missing from the authoritative source get `is_available = false`
  (never deleted: usage events reference them).
- Runs daily (added to the existing daily cron) and on demand with the
  «Синхронизировать» (Sync) button.
- Price history: table `ai_model_price_history` (`gateway_id`, `model_id`,
  `valid_from`, the 5 `cost_*` columns, `cost_raw`). A row is written only
  when a price changes. Usage events store their own computed cost, so history
  is for reporting only.
- After each sync, if a model used by a process became unavailable or
  deprecated, the «Процессы ИИ» tab shows a warning on that process (03 §5).

Measured 2026-11-13: models.dev lists **420** models for `vercel`, the Vercel
API **511** (incl. non-language types). The Vercel API is therefore primary;
models.dev enriches.

## 6. Admin UI: tab «Модели» (Models) on `/settings`

Platform admins only (same gate as the rest of `/settings`).

Toolbar (white toolbar convention):

- «Провайдер шлюза» (Gateway provider) select — today one value, «Vercel AI Gateway»
- «Тип» (Type) select — default «Языковые» (language)
- «Разработчик» (Vendor) multi-select — google, openai, anthropic, …
- «Возможности» (Capabilities) multi-select chips — tools, web search, images, PDF, audio, video, structured output, reasoning
- Search box — matches model id, name and vendor
- «Только доступные» (Available only) checkbox — default on
- Right side: «Синхронизировать» button + «Обновлено: <time>» + last error, if any

Table columns: Model (name + id), Vendor, Type, Context, Input $/1M,
Output $/1M, Capabilities (icons), ZDR, «Используется в» (used by N
processes). The drawer also shows `field_sources` («источник данных») per field. Sortable by name, vendor, price, context. Server-paginated.

Row click → side drawer: all fields, full pricing (tiers, service tiers,
regional, media prices), description, processes that use the model, link to
usage statistics for the model.

The registry is read-only in the UI; it mirrors the gateway.

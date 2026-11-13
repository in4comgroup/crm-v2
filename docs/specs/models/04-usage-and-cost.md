# Usage and cost (R5, part 1)

## 1. Goal

Record every model call with tokens and cost, attributed to organization,
user and process, and show statistics to platform admins.

## 2. Table `ai_usage_event`

One row per model call (one `aiGenerateText` / `aiStreamText` call; a
multi-step agent call is one row with the totals of all steps).

Columns follow the **OpenTelemetry GenAI semantic conventions** (01 §2) where
a matching attribute exists, so the ledger can be exported as OTel data later.

| Column | Type | OTel GenAI attribute | Note |
| --- | --- | --- | --- |
| `id` | text PK | — | |
| `created_at` | timestamp | span start | Start of the call |
| `organization_id` | text FK, nullable | — | Null only for `system: true` calls |
| `user_id` | text FK, nullable | — | Null for background calls (cron, webhooks) |
| `process_key` | text | — | From the catalog |
| `operation_name` | text | `gen_ai.operation.name` | `chat` / `generate_content` / `execute_tool` |
| `gateway_id` | text | — | Our gateway row |
| `provider_name` | text | `gen_ai.provider.name` | Upstream that served the call (e.g. `vertex`, `anthropic`) |
| `request_model` | text | `gen_ai.request.model` | Primary model of the assignment |
| `response_model` | text | `gen_ai.response.model` | Model that really answered (after fallback) |
| `response_id` | text | `gen_ai.response.id` | Gateway generation id (join key to gateway logs) |
| `status` | text | `error.type` (when failed) | `ok` / `error` / `aborted` |
| `error_type` | text | `error.type` | nullable |
| `input_tokens` | integer | `gen_ai.usage.input_tokens` | |
| `output_tokens` | integer | `gen_ai.usage.output_tokens` | incl. reasoning tokens |
| `reasoning_tokens` | integer | — | nullable |
| `cache_read_tokens` | integer | — | nullable |
| `cache_write_tokens` | integer | — | nullable |
| `web_search_count` | integer | — | nullable |
| `steps` | integer | — | Agent steps |
| `duration_ms` | integer | span duration | |
| `cost_estimate_usd` | numeric(14,8) | — | From registry prices at the end of the call (§3) |
| `cost_actual_usd` | numeric(14,8) | — | nullable; exact cost from the gateway (§4) |
| `markup_percent` | numeric(6,2) | — | Markup in force at the time of the call (snapshot, 05) |
| `ref` | jsonb | — | Optional business reference, e.g. `{ "sourceItemId": "…" }` |

Indexes: `(organization_id, created_at)`, `(process_key, created_at)`,
`(response_model, created_at)`, `(response_id)`.

Volume: one row per call. Today's batch work is in the thousands of calls per
day at most, so a plain table is enough. Aggregation is done with SQL on the
fly; a daily rollup table is added only if the queries get slow.

## 3. Cost estimate (immediate)

```
cost = input_tokens        × cost_input       / 1e6
     + output_tokens       × cost_output      / 1e6
     + cache_read_tokens   × cost_cache_read  / 1e6
     + cache_write_tokens  × cost_cache_write / 1e6
     + web_search_count    × cost_web_search  / 1000   (unit to verify)
```

Uses the prices of `response_model` at the time of the call. Tiered prices
(by context length) and service tiers are ignored in the estimate; that is why
§4 exists.

Known gap: grounded web search is billed per request, not per token. If the
web-search count cannot be read from the result, the estimate is too low for
`chat.web_search` and `clients.enrichment_research`.

## 4. Exact cost (reconcile)

- Background job every 15 minutes: events with `cost_actual_usd IS NULL`,
  `response_id` present, older than 2 minutes → `adapter.lookupCost(id)`
  (Vercel: `getGenerationInfo` → `totalCost`; gateways without `lookupCost` keep the estimate) → store.
- Batches of up to 200 per run, with a short delay between lookups. After 3
  failed attempts the event keeps only the estimate.
- Statistics use `coalesce(cost_actual_usd, cost_estimate_usd)` and show how
  many events are still estimates.

## 5. Statistics (admin)

Server functions in `src/server/ai/usage.ts`, all `requireAdmin()`:

| View | Group by | Metrics |
| --- | --- | --- |
| Total | day (chart) | calls, errors, input / output tokens, cost, cost with markup |
| Per organization | organization | same + share of total |
| Per process | process | same + average tokens and cost per call |
| Per model | response model | same + fallback rate (`response_model ≠ request_model`) |
| Drill-down | org × process, process × model | same |

Filters: period (presets 7 d / 30 d / this month / last month / custom),
organization, process, model, status.

Export: CSV of the current view.

## 6. Admin UI: tab «Использование ИИ» (AI usage) on `/settings`

- Toolbar: period, organization, process, model filters.
- KPI row: «Вызовы», «Токены», «Себестоимость» (gateway cost), «С наценкой»
  (with markup), «Ошибки».
- Chart: cost per day (stacked by process or by model, toggle).
- Tabs or segmented control: «Организации» / «Процессы» / «Модели», each a
  sortable table with the metrics in §5; row click filters the page.
- «Наценка» (Markup) block — see 05.
- Note under the KPIs: «N вызовов ещё со сметной стоимостью» (N calls still
  estimated) when reconcile is behind.

## 7. Org and user attribution — code changes

Required to fill `organization_id` / `user_id` (see 00 §3):

- Parsers (#9–#18) and the org-attribution judge get `{ orgId }` from
  `parseSourceItem` / upload routes / `saveChatSession`, plus `userId` where a
  user triggered the action (manual parse, upload, Save Chat).
- `searchWeb` gets `{ orgId, userId }` from the chat route.
- Cards, deals, enrichment, order split: read the user id from the session
  they already hold.
- The AI chat route requires sign-in (decided, Q5) — every chat call has an
  org and a user. See [../auth/api-access.md](../auth/api-access.md).

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

## 8. Implementation notes (P3, 2026-11-13)

Built: `ai_usage_event` (migration `0008_ai_usage_event`), recording in
`src/server/ai/runtime.ts` → `src/server/ai/usage.ts`, statistics in
`src/server/ai/usage-stats.ts`, API `api/admin/ai/usage`, tab
`src/components/blocks/admin-ai-usage.tsx`, plus the cost columns of
«Процессы ИИ» (03 §5) and the 30-day usage block in the «Модели» drawer.

Differences from §2–§4, found while building:

- **Exact cost is recorded at call time.** Vercel AI Gateway returns the
  billed cost of every generation in `providerMetadata.gateway.cost`
  (measured: it matches `getGenerationInfo.totalCost`). The adapter sums it
  over all steps into `cost_actual_usd`. Reconcile only fills gaps (a step
  without cost metadata), so it runs **daily** (phase 0 of the daily
  pipeline) plus the «Уточнить» button on the tab — not a 15-minute cron
  (a sub-daily Vercel cron also needs a paid plan). The gateway's lookup
  answers 404 for ~20 s after a call; reconcile only takes events older than
  2 minutes.
- Extra columns: `response_ids` (every step's generation id — a multi-step
  call is several generations) and `cost_reconcile_attempts` (stops after 3).
- No foreign keys on `organization_id` / `user_id`: the ledger must outlive
  deleted orgs and users, and an insert must never fail on a constraint.
- `operation_name` is always `chat` (all calls are chat-completion style).
- Web search: the grounding metadata sits under the UPSTREAM provider key
  (`vertex`), so the adapter checks every key. With `web_search_count` the
  estimate now includes the per-search fee (measured: estimate = exact cost,
  $0.01425 for one grounded call).
- An aborted stream records `status = aborted` with the usage of finished
  steps only; if it is aborted before the first step ends, tokens and cost
  are empty (the gateway may still bill a partial generation).
- `markup_percent` stays null until P4. (P4: filled on every event.)
- Manual sync (added on request): «Синхронизировать цены и стоимость» on
  «Использование ИИ» runs exactly what the daily cron runs (price sync of
  every enabled gateway + reconcile), for when the cron did not run (local
  dev, a failed run). Both admin tabs warn when the last price sync is older
  than 26 h.

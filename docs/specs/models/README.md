# AI models specs

Model registry, per-process model selection, usage statistics and markup for
everything the system sends to an AI gateway.

Status: **P1–P4 implemented** (2026-11-13): registry, catalog sync,
«Модели» tab; process catalog, per-process model choice, runtime layer, all
call sites migrated, ESLint boundaries, «Процессы ИИ» tab; usage ledger with
exact gateway cost, «Использование ИИ» tab, manual price + cost sync; global
markup, owner usage tab on `/account`, model policy (ZDR / no training /
vendors). Follow-ups: [06 §4](06-rollout-and-questions.md). All questions
(Q1–Q8) decided by the product owner on 2026-11-13 (see
[06-rollout-and-questions.md](06-rollout-and-questions.md)).

## Requirements (from the product owner)

| # | Requirement | Spec |
| --- | --- | --- |
| R1 | Support other AI gateway providers in future, not only Vercel AI Gateway | [01-gateway-providers.md](01-gateway-providers.md) |
| R2 | A DB registry of all models the gateway offers, with their parameters (costs, tools, …) | [02-model-registry.md](02-model-registry.md) |
| R3 | Admin `/settings` tab «Модели» (Models): filter by gateway provider, search by vendor and name | [02-model-registry.md](02-model-registry.md) §6 |
| R4 | A list of system processes that call the gateway; the admin selects the model per process by preference, cost and tool availability | [03-processes-and-model-selection.md](03-processes-and-model-selection.md) |
| R5 | Admin tab with usage statistics: total, per organization, per process; a global markup % on top of model cost, shown to end users | [04-usage-and-cost.md](04-usage-and-cost.md), [05-markup-and-end-user-cost.md](05-markup-and-end-user-cost.md) |

## Documents

| File | Content |
| --- | --- |
| [00-current-state.md](00-current-state.md) | How the code calls AI today: all 21 calls, model sources, what is missing |
| [01-gateway-providers.md](01-gateway-providers.md) | Architecture: open standards reused, layers and lint-enforced boundaries, adapter + catalog-source interfaces, the `ai_gateway` table, runtime entry points |
| [02-model-registry.md](02-model-registry.md) | `ai_model` table (models.dev-aligned), multi-source catalog sync, capabilities, the «Модели» tab |
| [03-processes-and-model-selection.md](03-processes-and-model-selection.md) | Process catalog, per-process assignment with fallbacks, compatibility rules, the «Процессы ИИ» tab |
| [04-usage-and-cost.md](04-usage-and-cost.md) | Usage ledger (OTel GenAI field names), cost estimate and exact cost, statistics, the «Использование ИИ» tab |
| [05-markup-and-end-user-cost.md](05-markup-and-end-user-cost.md) | Global markup %, how end-user prices are computed and shown |
| [06-rollout-and-questions.md](06-rollout-and-questions.md) | Phases, migrations, testing, risks, open questions |

## Terms

| Term | Meaning |
| --- | --- |
| Gateway provider | A service that routes model calls: today Vercel AI Gateway (`vercel`); later e.g. OpenRouter, LiteLLM, Cloudflare AI Gateway, or a direct provider API |
| Model | One model offered by a gateway, id `vendor/model` (e.g. `google/gemini-2.5-flash`) |
| Vendor | The company that made the model (`owned_by`: google, openai, anthropic, …) |
| Process | One place where the system calls a model for one purpose (e.g. «Разбор писем» — email parsing) |
| Assignment | The admin's choice of primary model + fallback models for one process |
| Usage event | One recorded model call: who, which process, which model, tokens, cost |
| Markup | Global % added to the gateway cost to get the end-user price |

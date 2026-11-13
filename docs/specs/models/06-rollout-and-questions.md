# Rollout, testing and open questions

## 1. Phases

Each phase ships on its own and leaves the app working.

| Phase | Content | Visible result |
| --- | --- | --- |
| P1 ✅ (2026-11-13) | Tables `ai_gateway` (+ seed `vercel`), `ai_model`, `ai_model_price_history`; catalog sources `gateway-api` (Vercel) + `models-dev`; catalog sync (daily + button); tab «Модели» | Admin sees all gateway models with prices and capabilities |
| P2 ✅ (2026-11-13) | ESLint boundary rules (01 §3); process catalog in code; `ai_process_assignment` (+ log); runtime layer `aiGenerateText` / `aiStreamText`; all 21 call sites migrated; org/user threaded through; hard-coded model lists removed; chat picker reads allowed models | No behaviour change (defaults = today's models); admin can switch models per process in «Процессы ИИ» |
| P3 ✅ (2026-11-13) | `ai_usage_event`; recording in the runtime layer; reconcile job; tab «Использование ИИ» with statistics | Admin sees cost per org / process / model |
| P4 ✅ (2026-11-13) | `platform_setting` (+ log); markup block; end-user view (per answers to Q1–Q3); model policy (ZDR / vendors) | Markup set; end users see their AI cost |

DB changes go through Drizzle migrations only (root `AGENTS.md` → Working
rules → 3). Seeds (`vercel` gateway row) go into a custom migration.

## 2. Testing

- Catalog sync: fixture of the real `/v1/models` response; mapping of tags,
  modalities and prices; unavailable / deprecated handling; idempotent re-run.
- Compatibility rule: each process × a set of models with known capabilities.
- Resolution: missing assignment, unavailable primary, fallback, default.
- Runtime layer: usage event written for ok, error and aborted streams;
  recording failure does not fail the business call.
- Cost: estimate formula against hand-computed values; reconcile against the
  gateway on a few real calls.
- Regression after P2: every process runs once on the same input as before the
  migration (same model) — same output shape, usage event written.
- Admin-only access for all new tabs and APIs.

## 3. Risks

| Risk | Mitigation |
| --- | --- |
| Admin picks a weaker model and quality drops silently | Assignment log; cost and error rate per process visible; reset-to-default button |
| Model removed from the gateway | Sync marks it unavailable; runtime uses fallbacks / default; warning on the process |
| Estimated cost differs from the invoice | Reconcile with the gateway's exact cost; show "still estimated" count |
| Usage table grows | One row per call is small; add a monthly rollup + retention later if needed |
| Web-search processes locked to Google | Explicit vendor rule (03 §6); separate task to move to a neutral search tool |

## 4. Follow-ups (not in this spec)

- More vendor search tools in the adapter (or a provider-neutral one), so search processes can use any vendor.
- The generic `openai-compatible` adapter (designed in 01, built with the second gateway).
- OTel export of the usage ledger.
- ~~Per-organization budgets / limits on AI spend.~~ Done: [07-daily-budget.md](07-daily-budget.md).
- A second gateway adapter.
- Billing / invoicing based on the end-user cost.

## 5. Decisions and open questions

| # | Question | Answer |
| --- | --- | --- |
| Q1 | Who sees AI cost with markup, and where? | **Decided:** org owners, new tab «Использование ИИ» on `/account` |
| Q2 | Model choice only global per process, or also per organization? | **Decided:** global only |
| Q3 | Currency for end users? | **Decided:** USD |
| Q4 | AI chat model picker for users? | **Decided:** keep it, limited to the admin-approved list (`allowed_model_ids`) |
| Q5 | Keep anonymous access to `/api/chat`? | **Decided:** no. Nothing works without sign-in — fixed for the whole app, see [../auth/api-access.md](../auth/api-access.md) |
| Q6 | Exact cost via gateway lookup per call (reconcile job)? | **Decided:** yes |
| Q7 | Store all model types (511) or only language models (326)? | **Decided:** all; the UI defaults to language |
| Q8 | Maximum separation of gateway/vendor specifics; reuse open standards | **Decided:** layers + lint-enforced boundaries + AI SDK model spec, OpenAI-compatible protocol, models.dev schema, OTel GenAI names — see [01-gateway-providers.md](01-gateway-providers.md) |

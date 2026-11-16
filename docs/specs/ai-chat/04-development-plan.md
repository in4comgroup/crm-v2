# 04 — Development plan

Phases in order. Each phase ends with `pnpm lint`, `pnpm test`, `pnpm build` and a check on the test DB. Estimates are working days for one developer with an AI agent. Decisions: [03-open-questions.md](03-open-questions.md) §1.

| Phase | What | Depends on | Days |
|---|---|---|---|
| **CH0** ✅ built 2026-11-16 (02 §8) | Preparation — library upgrade ([02-libraries.md](02-libraries.md) §7): AI SDK 7 + `@ai-sdk/react` 4 + `@ai-sdk/google` 4 (codemod, runtime, usage ledger, adapter `readResult`), json-render 0.23, streamdown 2.7.1 + plugins, Recharts 3.10, TanStack Table 9 if safe (Q18). Verify usage rows (tokens, cost) for one call of each process kind | — | 2.5 |
| **CH1** ✅ built 2026-11-16 (§ CH1 result) | Records engine `src/server/chat/records/` (9 types: search / list / get / toHit / toDetail, org-explicit, `server-only`); shared Search V2 helpers `src/server/search/normalise.ts`, header search moved onto them; topics / cards gate; unit tests for pure parts (filter → SQL plan, hit mapping) | CH0 | 4 |
| **CH2** ✅ built 2026-11-16 (§ CH2 result) | Web search: keep Google grounding (Q2); query privacy check (Q3); sources into the evidence block. Monthly limit stops the chat (Q15): process flag `stopAtMonthlyLimit`, route pre-check, Russian message, input disabled | CH0 | 1 |
| **CH3** | Statistics: `src/lib/chat/stats-semantic.ts` + `src/server/chat/stats/` — all 7 subjects (Q19; orders via `runAnalyticsQuery`), `StatsBlock` UI on the analytics charts (chart, table toggle, filter chips, CSV). Records UI: results block, typed `RecordDetailView`, `GET /api/chat/records`, deep links `/tasks?openTask=`, `/sources?item=`, `/products?q=`. Reduced json-render catalog (Q6) | CH1 | 5.5 |
| **CH4** | Chat v2 route + UI, replacing v1 (Q20): new tools, `toModelOutput` compact views, data parts (`data-status`, `data-records`, `data-stats`, `data-evidence`), status line, «CRM · интернет · N с», nothing technical for users (server-side strip), admin block «Ход рассуждений» + «Отладка» tab (Q5, Q11), Russian error classes + «Повторить», page context (Q12), model picker rule (Q1), new system prompt | CH1–CH3 | 3 |
| **CH5** | Chat history (Q16): migration `ai_chat_thread` / `ai_chat_message`, save in the route, chat list + «Новый чат» + rename, thumbs up / down (Q14), 90-day retention in the daily pipeline | CH4 | 2 |
| **CH6** | Chat as a source (Q16, Q21–Q24): segment ingest in the topics «intake» phase (+ daily pipeline for orgs without topics), markdown with AI answers as quoted text, `chat.session_analysis` gate `hasNewBusinessInfo` / `facts`, relayed-note envelope for the signal extractor, per-thread switch, «Передать в источники сейчас»; golden-set cases for chat notes before topics mode `on` uses them | CH5 | 3 |
| **CH7** | Eval: golden question set (≈ 40), `pnpm chat:eval` (deterministic checks + LLM judge), first run, fix prompt / tools until the gate passes; remove unused ai-elements files | CH4 (CH5–CH6 in parallel) | 2.5 |
| **CH8** | Docs: `src/lib/AGENTS.md` § "AI Chat" + "Structured AI Rendering", `src/app/AGENTS.md` § "Global AI chat panel" + Sources (aichat ingest), root `AGENTS.md` (API list, schema tables), models spec 08 (chat stops at the monthly limit), topics spec note on chat items, this folder's README status; delete v1 code | CH7 | 0.5 |

**Total ≈ 24 days.** CH0–CH4 + CH7 (the new chat itself) ≈ 18.5; CH5–CH6 (history + chat as a source) ≈ 5.

## Acceptance (whole spec)

1. The chat runs on the model set for «ИИ чат» on «Процессы ИИ»; with one allowed model there is no picker (R1).
2. A web question gets an answer with ≥ 1 web source link, for a chat model of any vendor (search sub-call on Google); a query with an e-mail or phone is refused (R2, Q3).
3. «Норлекс», «мои просроченные задачи», «заказы Globex за октябрь», «товары из Италии в наличии», «открытые темы по клиенту X», «письма от Петрова на прошлой неделе» each return the right records of the active org only; topics / cards only in topics mode `on` (R3).
4. Found records show as a grouped list with counts; a click opens a typed detail view; «Открыть в CRM» opens the record's page (R4).
5. A question for each of the 7 stats subjects shows a chart + table whose numbers equal a direct SQL run; CSV downloads (R5).
6. During a request a non-admin user sees only Russian status lines; no tool name, JSON, id, reasoning or raw error reaches a non-admin browser; a platform admin sees the collapsed «Ход рассуждений» (R6).
7. All packages of 02 §1 marked "Yes" are on the latest version; build, lint, tests pass (R7).
8. At 100 % of the org monthly AI limit the chat refuses with the Russian message and makes no model call.
9. A chat survives a page reload; the user's chat list shows it; another user of the org cannot open it.
10. A chat segment where the user states a client fact becomes a source item of the «AI Chat» source within the next hourly run, and its signals come only from the user's text (no signal from an AI answer); a segment of pure questions is `skipped` with `no_new_info`.
11. Eval gate of spec §12 passes.

## CH1 result (built 2026-11-16)

- Built: contract `src/lib/chat/records.ts`; engine `src/server/chat/records/` (`index.ts` API, 9 type modules, `resolve.ts` name filters, `shared.ts`, `format.ts` + tests); shared SQL matching `src/server/search/normalise.ts` (header search moved onto it); `src/lib/client-relation.ts` (the «Компании» tabs use it too); `src/server/products-core.ts` (`listProductsForOrg`, extracted from `products.ts`, page behaviour unchanged); `FAMILY_LABELS_RU` moved to `src/lib/signals/types.ts`. Notes: `src/lib/AGENTS.md` § "AI chat records engine".
- Checks: `tsc` 0, `pnpm test` 748 / 748, lint 0 errors, `pnpm build` OK; 13 live checks on the test DB (org IN4COM): every type's search / filters / sorts / detail, «me», another org's id → null, topics + cards hidden unless topics mode `on`, name filters (a missing company → nothing, not a wrong one), cross-type search ≈ 0.4–0.5 s, list ≈ 0.4–1 s per type.
- Deviations from spec §6.1: no order-number search (`order` has no number); no «Заказы» in the deal detail (orders are not linked to deals); no «нет исполнителя» task filter (`task.assignee_id` is NOT NULL); card status `expired` not filterable (`userCardFilter` hides expired cards).
- **Open issue → CH7 eval:** product search inherits the catalog engine (`products-core.ts`): «Шато Марго» ranks other «Шато …» first, «счёт» still returns «Schmidt …» (3-trigram prefix overlap passes `word_similarity` 0.5), totals use OR semantics («Chateau Margaux» = 343). A fix belongs to the catalog engine (e.g. a `similarity()`-based gate or alias rows), not to the chat; measure it in the eval first.

## CH2 result (built 2026-11-16)

- Web search stays on Google grounding (Q2). **Privacy (Q3):** `webQueryPrivacyIssue` (`src/lib/web-query-privacy.ts`, unit-tested) refuses a query with an e-mail or a phone number before any model call; `searchWeb` returns `grounded: false` + a Russian reason the model can act on. Narrow phone rule (a `+`, phone separators, or 11 digits starting 7 / 8); plain 10 / 12-digit tax numbers (ИНН), years, dates and prices pass. A number of 9+ digits written with spaces (e.g. «1 200 000 000») is treated as a phone — rare in a web query, the model can retry without it.
- **Monthly limit (Q15):** process flag `stopAtMonthlyLimit` (`chat.assistant`, `chat.web_search`); the runtime refuses them at 100 % of the monthly limit (usage event `blocked` / `monthly_limit_exceeded`); the daily budget keeps the interactive rule. `src/server/chat/limit.ts` (`getChatLimitState`), route pre-check → 402 `{ error: "monthly_limit", message }` (no model call), `GET /api/chat/status`, chat panel: the Russian message «Месячный лимит ИИ вашей организации исчерпан. Чат снова будет доступен с 01.12.2026 …» replaces the input (checked when the panel opens and on a refused request). `searchWeb` answers «месячный лимит ИИ организации исчерпан» instead of an English error. Owners keep the existing `ai.limit.month.*` notifications. Models spec 08 + root `AGENTS.md` updated.
- Evidence block for web sources: the tool already returns `sources`; rendering is CH4 (UI).
- Checks: `tsc` 0, `pnpm test` 752 / 752, lint 0 errors, build OK; live (test DB, budget status mocked to «exceeded», session mocked): privacy refusals make no `chat.web_search` call; status endpoint open / blocked; route 200 stream when open, 402 + Russian message and no `chat.assistant` call when blocked; runtime writes a `blocked` row for `chat.assistant`; `analytics.assistant` (no flag) still runs.


# 00 — Current state of the AI chat (2026-11-16)

> **Historical** — the state of chat v1 BEFORE this spec was built. v1 (`searchEverything`, `<SearchResultsCard>`, «Сохранить чат», tool blocks in the UI) was replaced by v2 in CH4–CH8 on 2026-11-16; the current state is in `src/lib/AGENTS.md` § "AI Chat" and [04-development-plan.md](04-development-plan.md).

What existed before v2, and the gap against each of the 7 requirements of this spec.

## 1. What exists

| Part | Where | What it does |
|---|---|---|
| Header button «ИИ чат» (AI chat) | `src/components/blocks/global-ai-chat.tsx` → `<AiChatTrigger/>`, used by `<PageHeaderActions/>` | Opens the slide-over panel on every page |
| Slide-over panel | `<AiChatPanel/>`, mounted once in `(protected)/layout.tsx` | Chat column (520 px) + optional detail panel (split to 70–85 vw). Always in the DOM (CSS transform), so the conversation survives page changes. Lost on page reload. |
| Chat component | `src/components/blocks/ai-chat.tsx` (725 lines) | `useChat` (`@ai-sdk/react` 3), model picker, file upload (images + text, 10 MB), speech input, suggestions, «Сохранить чат» (save chat as a source item) |
| API route | `src/app/api/chat/route.ts` (465 lines) | Session + active org required. `aiStreamText({ process: "chat.assistant" })`, `stopWhen: stepCountIs(10)`, `maxDuration = 120`. Output piped through `pipeJsonRender()` |
| System prompt | `src/lib/chat-prompt.ts` | Base prompt + json-render catalog prompt + org card («О нашей компании») + internal-search / web-search / "which tool" sections |
| Tool `searchEverything` | inline in the route | Loads ALL clients / contacts / deals of the org into memory, ranks them with `entitySearchScore` (JS twin of Search V2), adds source items (`listClientContent` + `listSourceItems`), profiles, custom fields, documents. Caps 12 entities / 15 sources |
| Tool `getSourceItemContent` | inline in the route | Full parsed markdown of one source item (tenant-checked) |
| Tool `searchWeb` | `src/server/web-search.ts` | A separate model call (process `chat.web_search`, capability `web_search`) that returns `{ findings, sources, grounded }` |
| Web-search capability | `src/server/ai/gateways/vercel-ai-gateway/index.ts` → `capabilityTools` | Only `google.tools.googleSearch` → only Google models are compatible with `chat.web_search` |
| Result cards | `src/components/blocks/search-results-card.tsx` | Count header + sections Клиенты / Контакты / Сделки / Источники; «Открыть» builds Markdown on the client and opens the detail panel |
| Structured output | `src/lib/catalog.ts` + `src/lib/registry.tsx` (json-render 0.16) | Model writes JSONL patches inline (Grid, KeyValue, Metric, DataTable, Bar/Line/Area/Pie/Scatter/Radar charts, Markdown, …). Detail panel has tabs «Rendered» / «Source» (raw JSON) |
| Analytics assistant (separate) | `/analytics` → «ИИ ассистент», `src/server/analytics-assistant.ts`, `analytics-semantic.ts` | One tool `queryAnalytics` over a whitelisted semantic layer (8 measures, 17 dimensions) on ORDERS only; the app renders the chart (`<AnalyticsAnswerCard>`), the model writes only prose. Not wired into the global chat |
| AI processes | `src/server/ai/processes.ts` | `chat.assistant` (interactive, `tools` + `image_input`, user-selectable, default Gemini 3.1 Flash Lite), `chat.web_search` (`web_search`), `chat.session_analysis` |

## 2. Gap against the requirements

| # | Requirement | Today | Gap |
|---|---|---|---|
| R1 | Use the LLM the admin selected for this process | Done: `chat.assistant` via `aiStreamText`; admin default + allowed list on «Процессы ИИ» (AI processes); user picker in the chat | Small: decide if the user picker stays (Q1). The web-search sub-call uses another process (`chat.web_search`) — the admin must know there are two settings |
| R2 | The LLM supports internet search | Works for any chat model, because search is a sub-call. But the sub-call itself can only run on Google models (only Google grounding is wired) | Add more search back-ends (gateway search tools, OpenAI / Anthropic native search) so `chat.web_search` is not Google-only (see 01 §5) |
| R3 | Internal search over all system-of-record data | Clients, contacts, deals, source items only. JS in-memory scan of ALL org rows on every call | Missing: products, tasks, orders, topics, cards. No structured filters ("my overdue tasks", "deals in stage X"). In-memory scan does not scale |
| R4 | Structured presentation: list of found things + details of each item | Cards for 4 types; details = Markdown built in the browser from 3 different APIs | Need one record model for all 9 types, a typed detail view per type, links to the real page of the record |
| R5 | Statistics as tables and charts | Model writes json-render chart specs with numbers it typed itself (transcription risk). Order statistics exist only on `/analytics` | Need a deterministic statistics tool (semantic layer over orders + deals, tasks, clients, sources, topics); app renders table + chart |
| R6 | Hide internal steps; show only status | Generic `<Tool>` block shows tool names, raw input and JSON output for every tool except the two search tools; reasoning text is shown; detail panel has a raw JSON «Source» tab; route returns the raw error message | Replace with one status line in Russian; hide tool parts, reasoning, JSON, ids, model errors |
| R7 | Libraries up to date | `ai` 6.0.146, `@ai-sdk/react` 3.0.148, json-render 0.16.0, streamdown 2.5.0 | Major versions behind: AI SDK 7, json-render 0.23, `@streamdown/code` 2. See [02-libraries.md](02-libraries.md) |

## 3. Other weak points found

- **Scale.** `searchEverything` calls `listClients()` / `listContacts()` / `listDeals()` — every row of the org, every request. The SQL engine `src/server/search.ts` (`searchAcrossEntities`, Search V2 normalisation + pg_trgm) already exists for the header search and is not used by the chat.
- **Session-bound helpers.** Most list functions (`listTasks`, `listProducts`, `listOrders`, `listCards`) are `"use server"` and read the org from the session. Chat tools must call org-explicit `server-only` functions (AGENTS.md rule 5) with the org id bound from the session in the route.
- **Topics / cards visibility.** Users see topics and topic cards only in topics mode `on` (`topicsUiVisible`, `userCardFilter`). The chat must apply the same gate.
- **No conversation history.** A reload loses the chat; only «Сохранить чат» stores it (as a source item for analysis, not as a chat to continue).
- **Prompt injection surface.** Source items (mail, chats) are untrusted text that goes into the model context. Today all tools are read-only, so the risk is limited to a wrong answer and to data leaving in a `searchWeb` query.
- **Error text.** The route returns `error.message` to the browser (can contain gateway / model details).
- **Model-written charts.** Numbers in json-render charts are typed by the model. The analytics assistant already proved the safer pattern: SQL → React, the model writes only prose.

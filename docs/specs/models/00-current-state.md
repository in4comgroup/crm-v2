# Current state (2026-11-13)

## 1. How calls are made

- AI SDK `ai@6.0.146`, `@ai-sdk/gateway@3.0.88`. Every call passes a plain
  `"vendor/model"` string; the SDK's default provider sends it to Vercel AI
  Gateway. Auth: `AI_GATEWAY_API_KEY` (read by the SDK, not by our code).
- No `createGateway`, no provider instances, no `providerOptions.gateway`
  (no fallbacks, no tags, no user id).
- `@ai-sdk/google` is used only for the tool `google.tools.googleSearch({})`
  (web search grounding). **This tool works only with Google models.**

## 2. Model id sources

| Source | Content | Used by |
| --- | --- | --- |
| `src/lib/llm-models.ts` → `MODELS` | 3 keys: `gemini-3.1-flash-lite`, `gpt-5-mini`, `claude-sonnet-4-6`; default `gemini-3.1-flash-lite`; `WEB_SEARCH_MODEL` | Chat, analytics assistant, web search, enrichment, cards, deals, order split, chat-session analysis |
| `src/lib/parser-config.ts` → `PARSER_CONFIG.*.model` | `google/gemini-2.5-flash` for text, pdf, image, audio, video, office | All parsers, org-attribution judge |
| `PARSER_MODEL` literal (3 files) | `google/gemini-2.5-flash` | Only stamped into `source_item.parser_model`, never sent to a model |

User-selectable today: the AI chat picker (`ai-chat.tsx`), «Найти в источниках»
for cards (`explore-sources-dialog.tsx`) and deal discovery
(`discover-deals-dialog.tsx`). All three list the hard-coded `MODELS`.

## 3. Inventory of calls

| # | Process | Code | Kind | Structured output | Tools / input | Org / user at call |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | AI chat | `api/chat/route.ts` (`streamText`, ≤10 steps) | interactive, streaming | — | tools `searchWeb`, `searchEverything`, `getSourceItemContent`; images + text files | org nullable (route allows anonymous), user available but unused |
| 2 | Analytics assistant | `api/analytics/assistant/route.ts` (`streamText`, ≤5 steps) | interactive, streaming | — | tool `queryAnalytics` | yes / yes |
| 3 | Chat web search | `server/web-search.ts` `searchWeb` | nested in #1 | — | `google_search` | no / no |
| 4a | Client web enrichment — research | `server/clients.ts` `lookupClientOnWeb` | interactive + browser-driven batch | — | `google_search` | yes / yes (unused) |
| 4b | Client web enrichment — extract | same | same | yes | — | same |
| 5 | Card generation | `server/cards-generation.ts` | batch, per source item | yes | — | yes / yes (unused) |
| 6 | Deal discovery | `server/deals-discovery.ts` | batch, per source item | yes | — | yes / yes (unused) |
| 7 | Order-from-request split | `server/order-requests.ts` | interactive | yes | — | yes / yes |
| 8 | Chat session analysis (Save Chat) | `server/save-chat-session.ts` | interactive | yes | — | caller has both |
| 9 | Email parsing (Nylas + IMAP) | `parsers/text.ts` `analyzeAndAssembleEmail` | background (cron) + manual | yes | — | caller has org, user only on manual paths |
| 10 | Google Chat parsing | `parsers/chat.ts` | background | yes | — | same |
| 11 | Telegram parsing | `parsers/telegram.ts` | background / webhook | yes | — | org yes, user no |
| 12 | WhatsApp group parsing | `parsers/whatsapp.ts` | background | yes | — | same as #9 |
| 13 | PDF parsing | `parsers/pdf.ts` | background + upload | yes | PDF file part | caller has org; user on uploads |
| 14 | Image parsing | `parsers/image.ts` | same | yes | image file part | same |
| 15 | Audio transcription | `parsers/audio.ts` | same | yes | audio file part | same |
| 16 | Video parsing | `parsers/video.ts` | same | yes | video file part | same |
| 17 | Office document parsing | `parsers/office.ts` | same | yes | text (extracted locally) | same |
| 18 | Drive Docs/Sheets metadata | `parsers/drive.ts` | background | yes | — | same as #9 |
| 19 | Org-attribution judge | `parsers/org-attribution.ts` | background | yes | — | org yes, user no |

## 4. Gaps this spec closes

1. Model ids are hard-coded in two config files and literals; a model swap
   needs a deploy.
2. Nothing records tokens or cost. There is no per-organization or
   per-process view of AI spend.
3. Org id and user id are not passed down to most call sites (parsers, web
   search, chat-session analysis).
4. No fallback model: if a model is down or removed, the call fails.
5. Web search is tied to Google models via a provider-specific tool.
6. `source_item.parser_model` is stamped from a separate literal and can be
   wrong (e.g. Save Chat files).

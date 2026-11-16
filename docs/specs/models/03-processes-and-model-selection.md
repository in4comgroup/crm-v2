# Processes and model selection (R4)

## 1. Goal

Every place that calls a model is a named **process** with known needs. The
admin picks a model for each process from the models that meet those needs,
seeing price and capabilities, and sets fallbacks. A change takes effect
without a deploy.

## 2. Process catalog

Defined **in code** (`src/server/ai/processes.ts`), because each process is
tied to code: its prompt, its schema, its tools. The DB stores only the
admin's choices (§4). A process that is removed from code disappears from the
UI; its usage history stays.

Per process:

| Field | Meaning |
| --- | --- |
| `key` | Stable id, e.g. `parsing.email` |
| `label` | Russian UI name, e.g. «Разбор писем» |
| `group` | UI group: «Чат и ассистенты», «Разбор источников», «Карточки и сделки», «Клиенты», «Заказы» |
| `description` | One sentence, Russian |
| `kind` | `interactive` (a user waits) or `background` (batch / cron) |
| `requires` | Capabilities the model must have (02 §4) |
| `defaultModelId` | Used when the admin has made no choice, or as last resort |
| `userSelectable` | Users choose among admin-allowed models: the AI chat (Q4), and the two dialogs that already had a model picker — cards («Найти в источниках») and deal discovery |

Initial catalog (from the inventory in 00):

| Key | «Label» | Kind | Requires | Default |
| --- | --- | --- | --- | --- |
| `chat.assistant` | «ИИ чат» | interactive | tools, image_input | `google/gemini-3.1-flash-lite` |
| `chat.web_search` | «Поиск в интернете (чат)» | interactive | web_search (vendor tool, §6) | `google/gemini-3.1-flash-lite` |
| `chat.session_analysis` | «Сохранение чата» | interactive | structured_output | `google/gemini-3.1-flash-lite` |
| `analytics.assistant` | «ИИ ассистент аналитики» | interactive | tools | `google/gemini-3.1-flash-lite` |
| `clients.enrichment_research` | «Обогащение компаний: поиск» | interactive | web_search (vendor tool, §6) | `google/gemini-3.1-flash-lite` |
| `clients.enrichment_extract` | «Обогащение компаний: извлечение» | interactive | structured_output | `google/gemini-3.1-flash-lite` |
| `cards.generation` | «Генерация карточек» | background | structured_output | `google/gemini-3.1-flash-lite` (user-selectable) |
| `deals.discovery` | «Поиск сделок» | background | structured_output | `google/gemini-3.1-flash-lite` (user-selectable) |
| `orders.request_split` | «Заказ из запроса» | interactive | structured_output | `google/gemini-3.1-flash-lite` |
| `parsing.email` | «Разбор писем» | background | structured_output | `google/gemini-2.5-flash` |
| `parsing.chat_message` | «Разбор сообщений (Google Chat, Telegram, WhatsApp)» | background | structured_output | `google/gemini-2.5-flash` |
| `parsing.document_metadata` | «Разбор Google Docs/Sheets» | background | structured_output | `google/gemini-2.5-flash` |
| `parsing.office` | «Разбор Word/PowerPoint» | background | structured_output | `google/gemini-2.5-flash` |
| `parsing.pdf` | «Разбор PDF» | background | structured_output, pdf_input | `google/gemini-2.5-flash` |
| `parsing.image` | «Разбор изображений» | background | structured_output, image_input | `google/gemini-2.5-flash` |
| `parsing.audio` | «Расшифровка аудио» | background | structured_output, audio_input | `google/gemini-2.5-flash` |
| `parsing.video` | «Разбор видео» | background | structured_output, video_input | `google/gemini-2.5-flash` |
| `parsing.org_attribution` | «Определение авторства документа» | background | structured_output | `google/gemini-2.5-flash` |

Defaults = today's models, so the switch to the new layer changes nothing
until the admin changes an assignment.

**Catalog today (2026-11-16, 22 processes; the code `src/server/ai/processes.ts` is the source of truth).** Changes since the initial catalog:
- `chat.assistant` requires `tools` only (no `image_input`): files reach the chat as parsed text only (ai-chat-tools Q22). Default stays `google/gemini-3.1-flash-lite` (ai-chat-tools Q24). `chat.assistant` + `chat.web_search` stop at the monthly limit (`stopAtMonthlyLimit`, [08](08-monthly-limit.md)).
- `chat.session_analysis` = «ИИ чат → источники», kind `background` (ai-chat CH6: the gate before signal extraction of chat segments).
- New: `chat.eval_judge` «Оценка ИИ чата (eval)», background, default `anthropic/claude-haiku-4.5` (ai-chat CH7); the group «Темы и сигналы» — `topics.signal_extraction`, `topics.signal_block_classifier`, `topics.topic_match`, `topics.card_writer`, `deals.state_summary` (topics spec).
- Removed: `cards.generation`, `deals.discovery` (topics phase 12; old usage rows keep the raw key).
- A background process called with `interactive: true` while a user waits (a chat file parsed at send, the chat's `readSignals`) passes the daily budget like an interactive one ([07](07-daily-budget.md)).

## 3. Compatibility rule

A model is **compatible** with a process when:

1. its gateway is enabled and the model `is_available`;
2. `type = 'language'`;
3. its capabilities include every item in `requires`;
4. for each capability that needs a vendor tool (today `web_search`), the
   gateway adapter can supply that tool for this model
   (`adapter.capabilityTool(cap, model) !== null`, 01 §4);
5. (optional admin policy, §7) it meets the privacy filter, e.g. ZDR.

Only compatible models can be saved as primary or fallback. The UI may show
incompatible models greyed out with the reason («нет ввода аудио» — no audio
input).

## 4. Table `ai_process_assignment`

| Column | Type | Note |
| --- | --- | --- |
| `process_key` | text PK | From the code catalog |
| `gateway_id` | text FK | |
| `primary_model_id` | text | FK (`gateway_id`, `model_id`) → `ai_model` |
| `fallback_model_ids` | text[] | Ordered; tried by the gateway if the primary fails (`providerOptions.gateway.models`) |
| `allowed_model_ids` | text[] | Only for `userSelectable` processes (AI chat): the list users can pick from |
| `settings` | jsonb | Optional per-process call settings: `maxOutputTokens`, `temperature`, `reasoningEffort` |
| `updated_by_user_id` | text FK → user | |
| `updated_at` | timestamp | |

Changes are logged in `ai_process_assignment_log` (who, when, old → new) so a
cost jump can be traced to a model change.

Runtime resolution (`resolveProcess(key)`), cached in memory for 60 s:
assignment row → if missing or the primary is unavailable, use the first
available fallback → else `defaultModelId`. Every fallback-by-resolution is
logged as a warning.

## 5. Admin UI: tab «Процессы ИИ» (AI processes) on `/settings`

Table grouped by `group`:

| Column | Content |
| --- | --- |
| Process | Label + description + kind badge («фоновый» / «интерактивный») |
| Requires | Capability icons |
| Model | Current primary (name, vendor), «по умолчанию» badge when no choice was made |
| Fallbacks | Count + names on hover |
| Cost estimate | «≈ $X за 1 000 вызовов» (≈ $X per 1,000 calls), from the average tokens per call of this process over the last 30 days (04) × the model's prices. «нет данных» when there is no usage yet |
| Usage (30 d) | Calls, total cost |
| Status | Warning if the model is deprecated / unavailable / incompatible |

«Изменить» (Edit) opens a dialog:

- Model picker showing **only compatible models**, with filters (vendor,
  search) and columns: name, vendor, input / output price, context, «≈ $ за
  1 000 вызовов» for this process, capability icons, ZDR.
- Sort by estimated cost (default), price, name.
- «Резервные модели» (Fallbacks): ordered list, max 3, same picker.
- For the AI chat: «Доступны пользователям» (Allowed for users) multi-select.
- «Сбросить на модель по умолчанию» (Reset to default).
- Preview line: «Было ≈ $A → станет ≈ $B за 1 000 вызовов».

## 6. Vendor tools (web search)

`chat.web_search` and `clients.enrichment_research` need web search. Business
code asks only for the capability; the gateway adapter returns the vendor's
native tool for the selected model (01 §4). Today the Vercel adapter supplies
`google.tools.googleSearch()` for Google models only, so rule 4 of §3 makes
only Google models compatible for these two processes. When the adapter learns
another vendor's search tool (or a provider-neutral one), more models become
compatible — with no change to business code.

## 7. Admin preferences (policy)

One settings block on the «Процессы ИИ» tab, applied to the compatibility
filter for all processes:

- «Только модели с нулевым хранением данных (ZDR)» — only `zdr = all`
- «Только модели без обучения на данных» — only `no_training = all`
- «Разрешённые разработчики» (Allowed vendors) — e.g. only google, openai, anthropic

Stored in `platform_setting` (05 §2). Default: all off (no restriction).

## 8. Implementation notes (P2, 2026-11-13)

- Code: `src/server/ai/processes.ts` (catalog), `src/server/ai/registry/assignments.ts`
  (resolution, compatibility, save / reset / log), `src/server/ai/runtime.ts`,
  `api/admin/ai/processes`, `api/ai/models` (picker data, any signed-in user),
  `src/components/blocks/admin-ai-processes.tsx`. Migration
  `0007_ai_process_assignment`.
- While the admin has not saved an allowed list, a user-selectable process
  offers its `defaultAllowedModelIds` (= the three models of the old
  hard-coded picker), so users see no change.
- Built in P3: the «≈ $ за 1 000 вызовов» column (process average tokens,
  last 30 days, × model prices; «нет данных» before the first call), the
  «За 30 дней» column, the same estimate per model in the edit dialog (sorted
  by it) and the «Было ≈ $A → станет ≈ $B» line.
- Built in P4: the policy block (§7, `admin-ai-policy.tsx`, keys
  `ai.policy.*` in `platform_setting`). It is compatibility rule 5:
  - ZDR / no-training: the gateway can restrict one call to compliant
    providers (`zeroDataRetention`, `disallowPromptTraining` in the Vercel
    provider options; adapter flag `privacyRouting`), so a model marked
    `some` qualifies and the runtime sends the flag on every call. Without
    privacy routing only `all` qualifies.
  - Allowed vendors: by `ai_model.vendor`.
  - Strict: a save that leaves any process with no compliant model
    (primary, fallbacks, code default) is refused with the list of those
    processes (HTTP 409). At runtime a process with no compliant model
    fails with `AiPolicyError` instead of silently using a non-compliant
    default. `settings` (temperature / max
  output tokens) is stored and applied by the runtime, but has no UI yet.

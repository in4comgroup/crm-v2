# Modules

[Back to index](./README.md)

One section per feature module. Paths are relative to the repository root.
"Org-scoped" means: the server reads the active org from the session and every
read and write is limited to it (see [architecture.md](./architecture.md#multi-tenancy)).
Unless stated otherwise, all org roles have the same rights inside a module.

Contents: [Sources & parsing](#sources--parsing-pipeline) ·
[Discovery](#discovery-blocklist-and-own-org-identity) ·
[Cards & rules](#cards-and-rules) ·
[Companies & contacts](#companies-and-contacts) · [Deals](#deals) ·
[Products](#products-catalog-and-price-list-export) · [Orders](#orders) ·
[Tasks](#tasks) · [Analytics](#analytics) · [Global search](#global-search) ·
[AI chat](#ai-chat-panel) · [Notifications](#notifications) ·
[Admin tools](#admin-tools-settings) · [Profile & organization](#profile-and-organization-pages)

## Sources & parsing pipeline

**Purpose.** Bring raw communication into `source_item` rows, convert each to
standard Markdown with an LLM, and store the Markdown in R2.

**Page.** `/sources` «Источники данных» (Data sources). Tabs:
«Источники организации» (Organization sources — everyone), «Сохранённые материалы»
(Stored materials — admins and org owners), «Статистика обработки» (Processing
statistics — platform admins), «Управление источниками организации» (Manage
organization sources — org owners). The main tab has the action bar
(«Синхронизировать и обработать» = sync then process per source, Drop Off
upload, «Загрузить архив WhatsApp», Telegram fetch, a processing date range)
and one table «Материалы источников» with a «Разбор» (parse) badge, a
«Загрузка» (upload) badge and one «Обработать» (Process) action per row, plus
«Обработать все» (Process all, max 500 per click).

**Providers.**

| Provider | Ingestion | Credentials (`credentials_ref`) | In daily pipeline |
| --- | --- | --- | --- |
| `nylas` (email) | Remote sync | `{ grantId, apiKey?, apiUri? }`; env fallback for grant and app | Yes |
| `imap` (email) | Remote sync, envelope only; body fetched at parse | `{ host, port, secure, user, password }`; no env fallback | Yes |
| `gchat` | Remote sync | service-account JSON + impersonated user; no fallback | Yes |
| `gdrive` (Drive, Meet recordings) | Remote sync | service-account JSON; no fallback | Yes |
| `telegram` | Webhook push; manual `getUpdates` fetch (dev) | `{ botToken, webhookSecret }`; env fallback | Parse/upload only |
| `dropoff` | Browser upload, parsed at upload time | none | No |
| `whatsapp` | Browser folder upload of a chat export | none | No |
| `aichat` | "Save chat" from the AI chat panel | none | No |

Adding a provider = enum value + metadata entry in `src/lib/sources/providers.ts`
(client-safe, capability flags) + handler in `src/server/providers/handlers.ts`
(sync function, "item missing" check, zod credentials schema).

**Parsing.** `parseSourceItem(id)` in `src/server/parse-source-item.ts`
dispatches by provider to `src/server/parsers/*` (text/email, imap, chat, drive,
pdf, image, audio, video, office, whatsapp, telegram, dropoff). Attachments
become child rows; a video yields an extra `derived_audio` child. Email
calendar invites (.ics) are folded into the parent email. Decorative inline
images (logos, tracking pixels) are skipped. Each parse also writes
**own-org attribution** (`own_org` / `external` / `unknown`), using sender
identity first and an LLM judge only for unclear documents.
`processSourceItem` = parse if needed, then upload, then upload new children.
Upload (`src/server/upload-source-item.ts`) writes R2 and clears
`parsed_markdown`.

**Main API.** `api/sources/sync`, `api/sources/items` (list with
`view=needs_work|done|errors|all`), `api/sources/items/[id]/{parse,process,reparse,markdown}`,
`api/sources/items/{process-ids,pending-parse-ids}`, `api/sources/r2/{save,pending-ids}`,
`api/sources/{dropoff,whatsapp}/upload`, `api/sources/aichat/save`,
`api/sources/telegram/fetch`, `api/sources/{options,stored}`,
`api/sources/org` (+ `/config`, `/credentials`, `/identity`, `/instantiate`) for
owners, `api/webhooks/telegram/[sourceId]`.

**Server modules.** `sources.ts`, `source-items.ts`, `templates.ts`,
`parse-source-item.ts`, `process-source-item.ts`, `parsers/*`, `sync/*`,
`providers/*`, `ingest/telegram.ts`, `r2/upload-source-item.ts`,
`orchestration/*`, `pipeline-runs.ts`, `save-chat-session.ts`.

**Key rules.**
- Credentials are write-only: encrypted on save, never sent back to the browser
  (only a "configured" boolean).
- Sync merges `metadata_json`; it never resets parse or upload status.
- Re-parse deletes child rows and clears the analysis stamps. Drop-off and AI
  chat items cannot be re-parsed (raw bytes are not kept).
- A provider 404/410 marks the item `skipped`, not `failed`. A per-item error
  never stops a batch.
- New orgs get sources from `is_default` templates (Files Drop Off, AI Chat);
  owners add other sources with «Добавить источник» (Add source) from visible templates.

## Discovery, blocklist and own-org identity

**Purpose.** Turn parsed items into company and contact records without
duplicates, without the org itself, and without irrelevant entities.

**Page.** Dialog «Найти в источниках» on `/clients` (also a one-click "Magic"
icon button). Period selector (default: last day), «Re-scan already-reviewed
items» option, three sections (Companies / Contacts / Links), Apply or
«Mark all reviewed».

**Main API.** `POST /api/discovery/preview` (read-only scan),
`POST /api/discovery/apply`; `api/blocklist`, `api/blocklist/[id]`,
`api/blocklist/from-entity`; `api/org-identity`, `api/org-identity/[id]`.

**Server modules.** `discovery.ts`, `blocklist.ts`, `org-identity.ts`
(`loadOwnOrgIdentity` for discovery, `getOrgIdentity` for parse-time
attribution), `org-identity-registry.ts`; pure helpers in
`src/lib/translit-ru.ts`, `src/lib/company-canonical.ts`, `src/lib/address-match.ts`.

**Key rules.**
- Contacts de-duplicate by email. Companies de-duplicate by a cross-script
  match key (Cyrillic transliterated, legal forms stripped) and by aliases and
  shared website domain. Near matches are shown pre-unchecked with a warning.
- Every candidate and link has a confidence (`high` / `medium` / `low`); low is
  pre-unchecked.
- Apply order: create companies → enrich existing (fill blanks only) → create
  contacts → links → stamp `discovery_scanned_at` on all scanned items.
- A soft-`deleted` company/contact found again is **revived** (same id), not
  duplicated. A `blocked` one is never revived.
- The org's own names, domains and addresses (profile + «Своя организация»
  registry on `/account`) are never proposed as clients or contacts.
- Blocklist («Список блокировки»): owner-only edits; adding an entry also
  flips matching existing rows to `blocked`. Identity registry entries only
  report matching rows; nothing is changed automatically.

## Cards and rules

**Purpose.** Produce short decision signals from parsed items, using an
editable prompt rule, and convert accepted signals into tasks or orders.

**Pages.** `/dashboard` «Домашняя» (Home): card grid with filters (priority,
category, date range, period, «Отклонённые» = show rejected), «Найти в
источниках» (opens the Explore Sources dialog: period, sources, rule, model,
re-analyze) and a "Magic" one-click run. `/rules` «Правила»: System rules
(platform admins edit) and Custom rules (per org). `/cards/[id]`: card detail
(reached from global search). `/cards` is an empty placeholder.

**Main API.** `api/cards` (GET list or `?id=`, POST, PUT with `action:
accept|reject` or partial update, DELETE), `api/cards/generate` (GET preview
count, POST run, max 300 s), `api/rules`.

**Server modules.** `cards.ts`, `cards-generation.ts`, `rules.ts`.

**Key rules.**
- Eligible items: parsed and uploaded to R2, not yet analysed (or re-parsed
  since). Max 50 items per run, concurrency 3. Auto-apply: a relevant result
  inserts a card at once.
- The LLM output is a flat object with sentinel values (Gemini structured
  output cannot use nullable/union fields). Category names from the LLM are
  normalised to the enum.
- Companies and users are matched by name against the org roster; the external
  contact is matched deterministically by sender email.
- «Принять» (Accept) opens a prefilled new-task dialog; the card is accepted
  only when the task is saved (`resultTaskId` stored). A `support` card creates
  a «Поддержка» task. A `new_order` card shows «Создать заказ» (Create order)
  instead and starts the order-from-request flow (`resultOrderId` stored).
  «Отклонить» (Reject) needs a reason.
- Which categories a rule can emit depends on the rule text, not on the code.

## Companies and contacts

**Purpose.** Company and person records with an account-management view.

**Pages.** `/clients` «Компании»: toolbar with «Новая компания», company-type
filter («Все компании», «Клиенты», «Потенциальные», «Поставщики», «Партнёры»,
«Не определено»), status filter, sort «Сначала новые / Сначала критичные»,
discovery, «Обогатить» (enrich), blocklist, Magic, card/table toggle. Clicking a
company opens the company drawer (tabs «Общая информация», «Задачи»,
«Контакты», «Материалы»). `/clients/[id]` is an older full company page, still
reached from global search. `/contacts` «Контакты»: alphabetical,
server-paginated (25 per page), card/table views, contact drawer.

**Main API.** `api/clients` (GET feed / `?id=`, POST, PUT),
`api/clients/[id]/content` (company materials), `api/clients/[id]/lookup`
(web lookup, 60 s), `api/clients/enrich/{pending,review}`,
`api/clients/[id]/enrich` and `/enrich/resolve`; `api/contacts`.

**Server modules.** `clients.ts` (incl. `lookupClientOnWeb`,
`enrichClientFromWeb`, `resolveEnrichment`), `contacts.ts`, `client-content.ts`,
`client-activity.ts`, `web-search.ts`.

**Key rules.**
- Tab classification: «Клиенты» = has an active deal on a stage with
  probability 1; «Потенциальные» = active deal on an open or pre-pipeline stage;
  «Поставщики»/«Партнёры» = manual `customFields.companyKind` (wins over deals).
- The feed loads up to 500 companies per tab and sorts in the browser.
- Web lookup: two LLM passes (grounded Google search, then structured
  extraction) plus a fetch of the company's own website; the operator reviews
  before anything is saved. Batch enrichment runs one company at a time from
  the browser, auto-applies only a single high-confidence match, fills blank
  fields only, and parks the rest for review.
- "Company materials" match source items by the company's name, address,
  website and contacts against `metadata_json` text (R2-uploaded items only).
- Per-client discount lives in `customFields.discount` and is used by orders.

## Deals

**Purpose.** Sales funnel per org with weighted forecast and an audit journal.

**Page.** `/deals` «Сделки»: kanban board (dnd-kit). Header shows weighted
forecast (Σ value × stage probability over active non-terminal deals). Filter
row: «Все/Мои», text search, company combobox, «Перевёл агент» (agent-moved),
«Не состоялись» (lost), «Найти в источниках» (deal discovery), «Лента решений»
(decision feed), «Новая сделка», collapse-all, «Настройки стадий» (stage
settings). Final column «Закрытие» merges Closed (won) and Rejected (lost).
Clicking a card opens the deal drawer (the only edit surface).

**Main API.** `api/deals` (GET with many query modes, POST, PUT with `move`,
`moveOnly`, `statusOnly`, `stageSettings` branches), `api/deals/[id]/contacts`,
`api/deals/feed`, `api/deals/intel`, `api/deals/discover`
(max 300 s).

**Server modules.** `deals.ts`, `deals-discovery.ts`, `deals-mock.ts`;
helpers `src/lib/deal-board.ts`, `deal-funnel.ts`, `kanban-move.ts`.

**Key rules.**
- Every creation and stage move writes a `deal_activity` row. Moving back
  needs a reason; dropping on «Закрытие» asks won/lost.
- Manual order inside a column uses a fractional index (`deal.position`).
- Stage settings: an org can rename and hide stages and add a pre-pipeline
  stage; the first save copies the system stages into org-owned rows.
- LLM deal discovery: CREATE / UPDATE_STAGE / SKIP per item, max 50 items,
  dry-run mode for testing rules, de-duplication by client + name.
- **No mock agent moves any more** (removed 2026-11-13, topics plan R9). Agent
  moves come only from LLM deal discovery, which now writes the deal journal
  (`deal_activity`) for every stage change. Risk badges and some "state" texts
  are still mock (`TODO(backend)`) until the topics deal bridge (phase 5).

## Products (catalog) and price-list export

**Purpose.** Org product catalog for building orders. Read-only in the app;
data is loaded by an offline loader (not in this repository).

**Page.** `/products` «Заказы & продукты», tab «Каталог товаров». Server
pagination (25 per page), debounced search, attribute filters; «Страна /
Регион / Цвет» are multi-selects and are the only filters the export uses;
«Экспорт прайс-листа» downloads an XLSX.

**Main API.** `api/products` (list, `?categories=1`, `?filterOptions=1`),
`api/products/[id]`, `api/products/export` (XLSX, one sheet per country,
max 120 s).

**Server modules.** `products.ts`, `products-export.ts`.

**Key rules.**
- Search V2: query normalised in SQL (transliteration + unaccent), expanded with
  `product_alias`, then full-text and trigram results fused by rank (RRF).
  Merchandise hidden unless asked. Depends on DDL not declared in `schema.ts`.
- Multi-value filters are repeated query params (values can contain commas).
  Selecting all values of an attribute sends no filter, so blank values stay.

## Orders

**Purpose.** Draft, send, confirm and finalize client orders.

**Page.** `/products` tab «Заказы» (list) + the order builder panel on the
catalog tab. «Новый заказ» opens one dialog: empty request text → manual
builder; pasted client text → LLM "order from request" wizard.

**Main API.** `api/orders` (GET list / `?id=` / `?clientOptions=1`, POST draft,
PUT content of a draft or confirmed order), `api/orders/[id]/link`
(`send | resend | reopen | pullback | cancel | finalize`), `api/order-requests`
(POST split, GET, PUT progress, max 120 s). Guest page `/o/[token]` uses server
actions.

**Server modules.** `orders.ts`, `order-links.ts` (the only code that mints or
revokes links), `order-requests.ts`; `src/lib/order-link-token.ts`,
`src/lib/orders-format.ts`, `src/lib/order-request.ts`.

**Key rules.**
- Status flow: `draft` → `awaiting_client` (link sent, client owns it) →
  `confirmed` (client confirmed; editable again) → `finalized`; `cancelled`
  from any open state. Editable states: `draft`, `confirmed`.
- Guest link: 32-byte random token, only its sha256 is stored, valid 14 days,
  one active link per order. Guest can change quantities, remove lines, and
  confirm; never add items. No rate limiting yet.
- Discount: the client's percent is copied to the order on every internal
  save; amounts are computed on read.
- Order from request: one LLM call splits the text into items with bilingual
  search terms; the wizard pre-filters the catalog per item; the rep adds
  products manually. Only price limits from the LLM are used as filters.
- An optional "stock only" check in the builder blocks out-of-stock adds (UI
  only, no reservation).

## Tasks

**Purpose.** Follow-up work linked to companies, contacts and deals.

**Page.** `/tasks` «Задачи»: «Новая задача», seven filters (status, type,
priority, assignee, company, contact, deal), card/table view, and a Gantt-style
timeline below. Deep link `?openTask=<id>`.

**Main API.** `api/tasks` (GET with option lists, POST, PUT incl.
`statusOnly`). **Server module.** `tasks.ts`.

**Key rules.** Assignee must be an org member; contact must belong to the chosen
company; `dueDate` is required (defaults to creation time); `closed` = archive.

## Analytics

**Purpose.** Sales reporting over the order book.

**Page.** `/analytics` «Аналитика»: tabs «Обзор», «Время», «Продавцы»,
«Клиенты», «Заказы», «Товары», and «ИИ ассистент» (AI assistant).

**Main API.** `api/analytics` (`?bounds=1`, `?from=&to=`),
`api/analytics/assistant` (streaming, 60 s).

**Server modules.** `analytics-query.ts` (pure SQL, org id as argument),
`analytics.ts` (session gate), `analytics-semantic.ts`, `analytics-assistant.ts`;
`src/lib/analytics-semantic.ts`, `src/lib/analytics-format.ts`.

**Key rules.** Revenue counts only booked orders (`confirmed` + `finalized`) and
is net of discount. The assistant never writes SQL: it picks a measure,
dimension and filters from whitelists; the org id is bound from the session.

## Global search

`<GlobalSearch/>` in every page header. `GET /api/search?q=` →
`src/server/search.ts`. Minimum 2 characters; up to 8 results each for
companies, contacts, active deals, orders (by description or company name) and
cards. Uses the same normalisation as product search plus trigram similarity
(3+ characters). Results deep-link to `/clients/[id]`, `/contacts?openContact=`,
`/deals?openDeal=`, `/products?openOrder=`, `/cards/[id]`.

## AI chat panel

Header button «ИИ чат» on every page; the panel is mounted once in
`(protected)/layout.tsx`, so the conversation survives navigation.
`POST /api/chat` (`src/app/api/chat/route.ts`, max 120 s) streams with the Vercel
AI SDK. Tools: `searchWeb` (own grounded Google search sub-call, always on),
`searchEverything` and `getSourceItemContent` (org-scoped CRM + source search,
when a session with an active org exists). Model picker: Gemini 3.1 Flash Lite
(default), GPT-5 Mini, Claude Sonnet 4.6. Structured output rendered with
json-render (`src/lib/catalog.ts`, `src/lib/registry.tsx`). «Сохранить чат» (Save chat) stores
the conversation as an `aichat` source item.

## Notifications

Bell in the header (`<NotificationsDrawer/>`). `GET /api/notifications` lists
recent events of type client, contact, deal, card for the org;
`POST` marks them seen (`notification_read_state`). Server: `notifications.ts`.

## Admin tools (`/settings`)

Visible only to platform admins (`user.role === 'admin'`). Tabs:

| Tab | What it does | API / server |
| --- | --- | --- |
| «Пользователи» (Users) | List users, role, ban, edit memberships in any org (reconcile, last-owner guard) | `api/admin/user-organizations`; better-auth admin plugin; `admin-organizations.ts` |
| «Организации» (Organizations) | Edit any org | `api/admin/organizations` |
| «Шаблоны» (Templates) | CRUD of source templates | `api/admin/templates`, `templates.ts` |
| «Источники» (Sources) | Create/edit any source, credentials, config, auto-parse | `api/admin/sources` (+ `/config`, `/credentials`), `admin-sources.ts` |
| «Сброс источника» (Source reset) | Teardown: hard delete selected threads of a source plus the cards, companies, contacts, deals, tasks and orders that only they produced; typed confirmation; audited in `teardown_log` | `api/admin/teardown/{sources,preview,execute}`, `teardown.ts` |
| «Модели» (Models) | Read-only AI model registry: every model of each AI gateway with prices and capabilities; filters (gateway, type, vendor, capabilities, search, available only), sortable, detail drawer (full pricing, price history, data source per field); «Синхронизировать» (Sync) button. Spec: `docs/specs/models/02-model-registry.md` | `api/admin/ai/models`, `api/admin/ai/catalog/sync`; `src/server/ai/{registry,catalog}` |
| «Процессы ИИ» (AI processes) | The model of every place that calls AI (18 processes, grouped): primary + up to 3 fallbacks, picked only from compatible models (capabilities, vendor web-search tool), cheapest first; for the AI chat, cards and deal discovery also the list users may pick from; reset to default; warnings when a chosen model became unavailable; «≈ $ / 1 000 вызовов» and 30-day usage per process; «Правила выбора моделей» (ZDR only, no training only, allowed vendors — a save that would leave a process without a compliant model is refused). Changes apply within a minute, no deploy. Spec: `docs/specs/models/03-processes-and-model-selection.md` | `api/admin/ai/processes`; `src/server/ai/registry/assignments.ts` |
| «Использование ИИ» (AI usage) | AI spend from the usage ledger: filters (period, organization, process, model, status), KPIs (calls, tokens, gateway cost, errors), cost per day stacked by process or model, breakdown tables by organization / process / model (row click filters the page), CSV export, «Уточнить» to fetch exact cost for still-estimated calls, «Синхронизировать цены и стоимость» (what the daily cron does; warning when it has not run for >26 h), «С наценкой» KPI/column and the «Наценка» block (global markup %, example, history). Spec: `docs/specs/models/04-usage-and-cost.md` | `api/admin/ai/usage`; `src/server/ai/usage.ts`, `usage-stats.ts` |
| «Темы» (Topics) | Topics mode per org (off / shadow / on), hourly run history + «Запустить сейчас», golden set, model spike. Spec `docs/specs/topics/` | `api/admin/topics*`; `src/server/topics/` |
| «Сигналы» (Signals) | Signals registry: table with filters, full code editor (all fields, validated, versioned), per-org activation / presets / overrides / stage rules / risk guards, attributes, relations, risk types, rule templates, history, Markdown export | `api/admin/signals*`; `src/server/signals/` |
| «Настройки» (Settings) | Placeholder ("no platform settings yet") | — |

Also admin-only: `POST /api/admin/pipeline/run`, `GET /api/admin/pipeline/stats`.
The model catalog also refreshes daily, as phase 0 of the daily pipeline.
Teardown keeps a company/contact if any item outside the selected threads also
"produced" it (shared-safe rule), and resets the sync cursor only on a full
source reset.

## Profile and organization pages

- `/profile`: name, photo (cropped to 256 px WebP in the browser, stored in R2
  via `POST /api/profile/avatar`, served by `GET /api/avatars/[userId]`).
  Platform admins can change their own email; it becomes verified at the next
  OTP sign-in.
- `/account` (title = org name): tab «Информация об организации» (owner edits
  profile fields, logo, «Своя организация» identity registry), tab
  «Участники» (Members — owners only: roles, remove, invite) and tab
  «Использование ИИ» (AI usage — owners only: calls and cost WITH the platform
  markup per function and per user; never the gateway cost, markup % or model
  ids; `api/account/ai-usage`, spec `docs/specs/models/05-markup-and-end-user-cost.md`).
- Invitations: owner invites by email → email with
  `/accept-invitation/<id>` → invitee signs in with an OTP sent to the invited
  address → accepts → active org is set. `/sign-up` blocks self sign-up when the
  email already has a pending invite.
- Server: `organizations.ts`, `invitations.ts`, `user-avatar.ts`,
  `api-keys.ts` (member management goes through the better-auth organization
  plugin); API: `api/organization`, `api/auth/keys`, `api/invitations/*`,
  `api/account/ai-usage`.

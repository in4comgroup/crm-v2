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
| `telegram` | Webhook push (private chats and groups: text, voice notes, files ≤ 20 MB); manual `getUpdates` fetch (dev) | `{ botToken, webhookSecret }`; env fallback | Parse/upload only |
| `dropoff` | Browser upload, parsed at upload time | none | No |
| `whatsapp` | Browser folder upload of a chat export | none | No |
| `aichat` | Automatic: segments of AI chat conversations (user messages; AI answers quoted, never evidence), hourly for topics orgs, daily for all | none | No |

Adding a provider = enum value + metadata entry in `src/lib/sources/providers.ts`
(client-safe, capability flags) + handler in `src/server/providers/handlers.ts`
(sync function, "item missing" check, zod credentials schema).

**Parsing.** `parseSourceItem(id)` in `src/server/parse-source-item.ts`
dispatches by provider to `src/server/parsers/*` (text/email, imap, chat, drive,
pdf, image, audio, video, office, whatsapp, telegram, dropoff). Attachments
become child rows (also Telegram files: downloaded by `file_id` and parsed by
the same attachment path; spec `docs/specs/telegram/`); a video yields an
extra `derived_audio` child. A message is marked complete only after its
attachments are parsed, because attachment text feeds signal extraction for
every source. Email
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
`api/sources/{dropoff,whatsapp}/upload`,
`api/sources/telegram/fetch`, `api/sources/{options,stored}`,
`api/sources/org` (+ `/config`, `/credentials`, `/identity`, `/instantiate`) for
owners, `api/webhooks/telegram/[sourceId]`.

**Server modules.** `sources.ts`, `source-items.ts`, `templates.ts`,
`parse-source-item.ts`, `process-source-item.ts`, `parsers/*`, `sync/*`,
`providers/*`, `ingest/telegram.ts`, `r2/upload-source-item.ts`,
`orchestration/*`, `pipeline-runs.ts`, `chat/ingest.ts` (AI chat segments).

**Key rules.**
- Credentials are write-only: encrypted on save, never sent back to the browser
  (only a "configured" boolean).
- Sync merges `metadata_json`; it never resets parse or upload status.
- Re-parse deletes child rows and clears the analysis stamps. Drop-off and AI
  chat items cannot be re-parsed (raw bytes are not kept).
- A provider 404/410 marks the item `skipped`, not `failed`. A per-item error
  never stops a batch.
- Telegram: the bot replies (Russian) only in private chats, never in groups;
  in groups it needs privacy mode off (BotFather `/setprivacy`), shown in the
  source settings «Группы». Group messages of our staff take the group's
  client as counterparty.
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
(sync views of the one «us» resolver `getOwnOrgContext` in
`identity/own-org.ts`: discovery + parse-time company stripping, and
parse-time attribution), `org-identity-registry.ts`; pure helpers in
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

**Purpose.** Show topic cards (decision signals from the topics engine) and convert
accepted cards into tasks or orders. Custom-rule card generation and the
`/rules` page were removed (topics plan phase 12, 2026-11-14, every org).

**Pages.** `/dashboard` «Домашняя» (Home): in topics mode `on` = topic lists plus
the tab «История карточек» (old Custom-rule cards, read-only); in `off` /
`shadow` = only the read-only history of old cards, no generation. Card kinds:
topic, `deal_proposal`, `stage_confirmation`, `deal_link` («К какой сделке
относится тема?» — the topic's company has 2+ open deals; spec topics/10). `/cards/[id]`: card detail
(reached from global search). `/cards` is an empty placeholder.

**Main API.** `api/cards`: GET list or `?id=`, PUT `action:
accept|reject|deal_execute` (`deal_link`: + `dealId`), DELETE. No manual create, no generic update.

**Server modules.** `cards.ts`; topic cards in `src/server/topics/cards/`.

**Key rules.**
- Removed: `api/cards/generate`, `cards-generation.ts`, `generateCards`, the AI
  process `cards.generation`, the Explore Sources dialog, the "Magic" cards
  button, `/rules` «Правила», `api/rules`, `rules.ts`. The `rule` table stays as
  a data record (old cards reference it through `card.rule_id`).
- «Принять» (Accept) opens a prefilled new-task dialog; the card is accepted
  only when the task is saved (`resultTaskId` stored). A `support` card creates
  a «Поддержка» task. A topic card with `category = new_order` (ORDER_REQUESTED)
  shows «Создать заказ» (Create order) instead and starts the order-from-request
  flow (`resultOrderId` stored). «Отклонить» (Reject) needs a reason.

## Companies and contacts

**Purpose.** Company and person records with an account-management view.

**Pages.** `/clients` «Компании»: toolbar with «Новая компания», company-type
filter («Все компании», «Клиенты», «Потенциальные», «Поставщики», «Партнёры»,
«Не определено»), status filter, «Ответственный» filter (all / «Мои» / «Ждут
решения владельца» / each member), sort «Сначала новые / Сначала критичные»,
discovery, «Обогатить» (enrich), blocklist, Magic, card/table toggle, profile
filters «Отрасль» / «Роль» / «Размер», «Фильтр по полям» (custom fields) and,
for the owner, «Настроить поля». Clicking a company opens the company drawer
(tabs «Общая информация» (form, «Профиль компании», «Ответственный»), «Поля»,
«Документы», «Задачи», «Контакты», «Материалы компании», «Темы» in topics mode
`on`). `/clients/[id]` is an older full company page (cards incl. «Поля» and
«Документы»), still reached from global search. `/contacts` «Контакты»:
alphabetical, server-paginated (25 per page), card/table views (custom field
columns + «Фильтр по полям»; owner: «Настроить поля»), contact drawer (tabs
«Общая информация» (with the block «Компании»), «Поля», «Документы», «Темы»).

**Main API.** `api/clients` (GET feed / `?id=` / `?responsibleOptions=1`, POST,
PUT), `api/clients/[id]/responsible` (PUT: owner assigns / handover to owner),
`api/clients/[id]/content` (company materials), `api/clients/[id]/lookup`
(web lookup, 60 s), `api/clients/enrich/{pending,review}`,
`api/clients/[id]/enrich` and `/enrich/resolve`; `api/clients/[id]/profile`
(«Профиль компании»: view / save / confirm / proposals / «Заполнить из
интернета»); `api/contacts`; `api/custom-fields*` + `api/custom-values`
(custom fields; feed filters `?cf=` on `api/clients` / `api/contacts`);
`api/documents*` (documents of every entity, see "Documents" below);
`api/contacts/[id]/links`, `api/clients/[id]/contact-links`,
`api/contact-link-proposals/[id]`, `api/contacts/merge` (contact ↔ company
links over time).

**Server modules.** `clients.ts` (incl. `lookupClientOnWeb`,
`enrichClientFromWeb`, `resolveEnrichment`), `contacts.ts`, `client-content.ts`,
`client-activity.ts`, `client-responsible.ts`, `web-search.ts`,
`identity/client-profile.ts` + `identity/client-enrichment.ts` (client
profiles, spec identity I5 / I6), `custom-fields.ts` (+ `client-type-field.ts`,
the converted «Тип клиента» read by analytics and a stage-rule guard),
`documents.ts` / `documents-ingest.ts`, `contact-links.ts` (contact ↔ company
links, proposals, merge).

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
  `client.custom_fields` keeps only system keys (`discount`, `companyKind`);
  org-defined fields live in `custom_values` (definitions in `custom_field`,
  owner manages, every member edits; spec `docs/specs/clients-contacts/`).
- «Профиль компании» (what the client does): edited by the responsible member
  and the owner; web enrichment fills EMPTY fields as «Из интернета —
  проверьте» and turns a different value into a proposal; never overwrites a
  manual value.
- «Ответственный» (Responsible): one human member per company, default = the
  creator. Only an org owner sets it (any human, not banned member). The
  responsible member who is not an owner can only «Передать владельцу»; the
  owner then decides (badge «Ждёт решения владельца», bell notification for
  that owner). Everybody else reads it. The generic `PUT api/clients` refuses
  it. Topics use it as the fallback deal owner and topic assignee.
- Contact ↔ company links over time (spec `docs/specs/clients-contacts/04`):
  a contact has current and former companies (relation «Сотрудник» /
  «Консультант / подрядчик» / «Партнёр / представитель» / «Другое»);
  `contact.client_id` = the primary current one. No backfill: an old contact
  shows its `client_id` as one implicit link. After each parse the system may
  PROPOSE «Контакт сменил компанию?» (farewell / new address / same name at
  another client's domain / two companies in 60 days / discovery); a person
  decides «Перешёл», «Работает с обеими», «Это другой человек» or «Не сейчас».
  Company X then lists the person under «Бывшие» («теперь в Y»); open deals of
  X get a journal line and «Заменить в сделках». «Объединить с…» merges two
  records of one person.

## Deals

**Purpose.** Sales funnel per org with weighted forecast and an audit journal.

**Page.** `/deals` «Сделки»: kanban board (dnd-kit). Header shows «Прогноз» (Σ
amount × probability over deals of stages marked «В прогнозе»; stage
probability, or the deal's EXPERT probability when the stage says so — a deal
without amount / expert probability is counted in «Без оценки: N»), and
«Выиграно» apart (`computeForecast`, `src/lib/funnel/forecast.ts`). Filter
row: «Все/Мои», text search, company combobox, «Перевёл агент» (agent-moved),
«Не состоялись» (lost), «Лента решений» (decision feed), «Новая сделка»,
collapse-all, «Типы сделок», «Настройки воронки». Final column = the org's
`won` + `lost` stages (by ROLE, never by name). Clicking a card opens the deal drawer (the only edit surface).

**Main API.** `api/deals` (GET with many query modes, POST, PUT with `move`,
`moveOnly`, `statusOnly`, `stageSettings` branches), `api/deals/[id]/contacts`,
`api/deals/feed`. The board loads only `/api/deals/feed` + `/api/tasks`.

**Server modules.** `deals.ts`, `deal-engine.ts`;
helpers `src/lib/deal-board.ts`, `deal-funnel.ts`, `kanban-move.ts`.

**Custom funnel** (`docs/specs/funnel/`): every org's funnel is DATA the owner
edits in «Настройки воронки» — stages (role `area0` / `active` / `won` /
`lost`, code, description, entry condition, signals hint, forecast settings),
deal types, outcome reasons (lost / no-go / withdrawn), the entry gate
(go / no-go before the pipeline) and the stage RULES (signal → create / move /
won / lost / pause / in-stage), with validation on save, a preview on the last
30 days and platform templates («Продажи B2B (стандарт)», «Тендеры и конкурсы
(5 стадий)»). The engine reads only this data — no code per org. API
`api/deals/funnel`, admin `api/admin/funnel`; server `funnel-config.ts`.
IN4COM GmbH runs «Тендеры и конкурсы» with the go / no-go gate.

**Key rules.**
- Every creation and stage move writes a `deal_activity` row. Moving back
  needs a reason; dropping on «Закрытие» asks won/lost.
- Manual order inside a column uses a fractional index (`deal.position`).
- The first save of an org on the system funnel copies the system stages into
  org-owned rows. A stage with deals cannot be removed. Deal fields «Экспертная
  вероятность, %» and «Бюджет из брифа» (never in the forecast); outcomes carry
  a reason code from the org lists.
- «Текущее состояние» (`deal.state_text`) is written only from topics linked
  to the deal. Business topics of a company are linked automatically to its
  ONLY open deal; with 2+ open deals a `deal_link` card asks the user (spec
  `docs/specs/topics/10-deal-status-from-topics.md`). A deal with no linked
  topic says so and offers «Связать тему»; the old discovery text is never
  shown as the status. Deal drawer tabs include «Документы».
- Deals are created and moved by the topics deal bridge (deal proposals and
  stage confirmations; every write is journaled in `deal_activity`). Removed in
  phase 12: name-based LLM deal discovery (`deals-discovery.ts`, `generateDeals`,
  `api/deals/discover`, AI process `deals.discovery`, «Найти в источниках» on
  «Сделки»), the mock kanban "board intel" (`deals-mock.ts`, `api/deals/intel`,
  mock badges, stale-days / stage norms «остывание», stage commitments) and
  `topics-legacy.ts`. Old `deal.reasoning` / `deal.changes` stay as history.

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
- A saved order has a «Документы» section in the builder panel.

## Tasks

**Purpose.** Follow-up work linked to companies, contacts and deals.

**Page.** `/tasks` «Задачи»: «Новая задача», seven filters (status, type,
priority, assignee, company, contact, deal), card/table view, and a Gantt-style
timeline below. Deep link `?openTask=<id>`.

**Main API.** `api/tasks` (GET with option lists, POST, PUT incl.
`statusOnly`). **Server module.** `tasks.ts`.

**Key rules.** Assignee must be an org member; contact must belong to the chosen
company; `dueDate` is required (defaults to creation time); `closed` = archive.
The task drawer has tabs «Задача» / «Документы».

## Documents (attachments)

**Purpose.** Files (PDF, images, audio, video, Office, …) of companies,
contacts, deals, tasks and orders (spec `docs/specs/attachments/`).

**UI.** «Документы» tab / section in every entity view: upload (≤ 10 files ×
50 MB), list with summary and link chips («авто» + reason), «Открыть» (new
browser tab, safe types only), «Скачать», «Текст», «Привязать ещё»,
«Отвязать», «Подтвердить», «Удалить файл» (uploads; uploader or owner).

**Main API.** `api/documents` (list), `api/documents/upload`,
`api/documents/[itemId]` (DELETE), `/links`, `/links/[linkId]`, `/file`.

**Server modules.** `documents.ts`, `documents-ingest.ts`, `documents-chat.ts`;
contract `src/lib/documents.ts`.

**Key rules.**
- A document is a file `source_item` (attachment, Drive file, drop-off file,
  derived audio); decorative inline images are not documents.
- The original is stored (≤ 50 MB) at parse / upload; WhatsApp files are not.
- `document_link` is many-to-many. Automatic links (no AI): message
  participants → contact + company; the message's topic → company / contact /
  deal; exact company names in the file → company; the company's only open deal
  → deal. A person's «Отвязать» is final for that link.

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
AI SDK (chat v2, spec `docs/specs/ai-chat/`). The model = AI process «ИИ чат»
(`chat.assistant`); the model picker shows only when the admin allowed more than
one model. Read-only tools: `searchRecords`, `listRecords`, `getRecord`,
`readSource` (records engine `src/server/chat/records/` — companies, contacts,
deals, orders, products, tasks, source items; topics and cards in topics mode
`on`), `queryStats` (statistics engine `src/server/chat/stats/`, orders = the
/analytics engine) and `searchWeb` (own grounded Google search sub-call, ≤ 3 per
answer, no e-mails / phones in queries), plus two draft tools (below). The model writes only prose; the app
shows the found records (`<RecordsBlock>`, detail in the side panel), charts +
tables (`<StatsBlock>`), «Источники ответа» and «CRM · интернет · N с». Users see
one status line («Ищу в CRM…») and never tool calls, ids, JSON or reasoning — the
route strips them on the server; platform admins get a collapsed «Ход
рассуждений» and «Отладка» tabs. The page the user is on is context for the
answer («эта компания»). The chat stops at 100 % of the org monthly AI limit.
Chat history (CH5): each user has a list of own chats in the panel header
(«Новый чат», rename, «Удалить чат»); the server stores the messages
(`ai_chat_thread` / `ai_chat_message`) and loads the history itself — the browser
sends only the new message; a chat continues after a reload; thumbs up / down on
answers; chats with no message for 90 days are deleted by the daily pipeline.
The chat is a source of the org (CH6): after 30 quiet minutes the new messages
of a chat become one source item of the «AI Chat» source (user messages first,
AI answers quoted — never evidence; a gate model skips parts with no new
business information); menu «…» → «Передать в источники сейчас» / «Не
передавать в источники». In topics mode `on`, chat notes get signals only after
the platform admin switch «Чат в сигналах».
Files (ai-chat-tools T0): photos (also the phone camera), PDF, DOCX, PPTX, audio,
video, text and recorded voice messages are uploaded in parts of ≤ 4 MB
(`/api/chat/files`), stored as «AI Chat» source items and read by the parser of
their type when the message is sent; the chat model gets only their text.
Draft cards (ai-chat-tools T1, T2): from a message, a business card, a voice
note or meeting notes the chat prepares NEW companies, contacts, deals and tasks
(one task or a checklist) as an editable card in the answer (`draftCompany` /
`draftContact` / `draftDeal` / `draftTask` / `draftTasks`); before a deal the
chat reads the message's signals and the org's funnel rules (`readSignals`) to
pick the deal type and stage; an open deal of the same company and type is
offered instead of a duplicate; it can also add missing data to an existing
company / contact («Дополнить» — empty fields and new addresses only, never an
overwrite), link a contact to a company or a deal, record a past meeting / call,
and asks a short question with buttons when something required is missing; task deadlines come from the
user's own words («до пятницы») and are computed in the org time zone — no
words, no date (the card asks); assignee by a colleague's name; code removes every value that is not in the
user's own text or files, shows existing records with the same e-mail / phone /
domain («Использовать существующий» / «Всё равно создать новый»), refuses our
own organisation, staff and blocklisted entries; nothing is created until the
user clicks «Создать» (`/api/chat/actions`, the normal create functions as the
user; audit in `ai_chat_action`; the card photo becomes a document of the
contact).

## Notifications

Bell in the header (`<NotificationsDrawer/>`), spec `docs/specs/notifications/`.
Stored notifications per user (`notification`): categories («Задачи», «Сделки и
темы», «Компании и контакты», «ИИ и лимиты», «Процессы и источники»,
«Организация», «Оплата», «Платформа»), two priorities (important / info), read
/ hide per item, «уже не актуально» when the condition is gone; info is hidden
after 3 days, important after 5. Badge = unread count (red with an unread
important); toasts for new important only. Sources: events (handover, contact
changed company, new deal risk, topic in «Сейчас», order confirmed by the
client, member joined, task assigned) and an hourly check for every org (task
due tomorrow / today / overdue, AI limit 70 / 90 / 100 % and daily budget, org
profile incomplete, client-profile proposals, failing sources, failed runs).
AI usage, company profile and process notices go to org owners only. Settings
per category: /account → «Уведомления». API `api/notifications`,
`api/account/notification-prefs`, cron `api/cron/notifications`. Server:
`src/server/notifications/`.

## Admin tools (`/settings`)

Visible only to platform admins (`user.role === 'admin'`). Tabs:

| Tab | What it does | API / server |
| --- | --- | --- |
| «Пользователи» (Users) | List users, role, ban, edit memberships in any org (reconcile, last-owner guard) | `api/admin/user-organizations`; better-auth admin plugin; `admin-organizations.ts` |
| «Организации» (Organizations) | Edit any org; column «Профиль» (org profile completeness «N из 6») | `api/admin/organizations` |
| «Источники» (Sources) | One tab, three blocks. «Шаблоны источников» (Source templates): CRUD of source templates (`api/admin/templates`, `templates.ts`). «Источники» (Sources): create/edit any source, credentials, config, auto-parse; filter by organization («Системные» = no owner org) (`api/admin/sources` (+ `/config`, `/credentials`), `admin-sources.ts`). «Сброс источника» (Source reset, bottom): teardown: hard delete selected threads of a source plus the cards, companies, contacts, deals, tasks and orders that only they produced; typed confirmation; audited in `teardown_log`. All admin tables on `/settings` use the shared pager `table-pager.tsx` (10 / 25 / 50, default 10) | `api/admin/templates`, `api/admin/sources`, `api/admin/teardown/{sources,preview,execute}`, `templates.ts`, `admin-sources.ts`, `teardown.ts` |
| «Модели» (Models) | Read-only AI model registry: every model of each AI gateway with prices and capabilities; filters (gateway, type, vendor, capabilities, search, available only), sortable, server-paginated with the shared pager `table-pager.tsx` (10 / 25 / 50, default 10), detail drawer (full pricing, price history, data source per field); «Синхронизировать» (Sync) button. Spec: `docs/specs/models/02-model-registry.md` | `api/admin/ai/models`, `api/admin/ai/catalog/sync`; `src/server/ai/{registry,catalog}` |
| «Процессы ИИ» (AI processes) | The model of every place that calls AI (22 processes, grouped; old `ai_usage_event` rows keep the raw key of removed processes and the usage page shows it when the label is unknown): primary + up to 3 fallbacks, picked only from compatible models (capabilities, vendor web-search tool), cheapest first; for the AI chat also the list users may pick from; reset to default; warnings when a chosen model became unavailable; «≈ $ / 1 000 вызовов» and 30-day usage per process; «Правила выбора моделей» (ZDR only, no training only, allowed vendors — a save that would leave a process without a compliant model is refused). Changes apply within a minute, no deploy. Spec: `docs/specs/models/03-processes-and-model-selection.md` | `api/admin/ai/processes`; `src/server/ai/registry/assignments.ts` |
| «Использование ИИ» (AI usage) | AI spend from the usage ledger: filters (period, organization, process, model, status), KPIs (calls, tokens, gateway cost, errors), cost chart stacked by process or model with its own scale («По дням» / «По месяцам» / «По годам») and range «с … по …» (the range replaces only the page period; the other filters apply), breakdown tables by organization / process / model (row click filters the page), CSV export, «Уточнить» to fetch exact cost for still-estimated calls, «Синхронизировать цены и стоимость» (what the daily cron does; warning when it has not run for >26 h), «С наценкой» KPI/column and the «Наценка» block (global markup %, example, history), block «Лимиты ИИ по организациям» (daily budget in gateway cost + MONTHLY limit in end-user cost, default $20; defaults + per-org overrides, spend today / this month). Specs: `docs/specs/models/04-usage-and-cost.md`, `07-daily-budget.md`, `08-monthly-limit.md` | `api/admin/ai/usage`; `src/server/ai/usage.ts`, `usage-stats.ts` |
| «Темы» (Topics) | Operations of the topics engine: topics mode per org (off / shadow / on; switching to shadow / on is refused until the org profile minimum is complete — admin override with a reason; columns «Профиль» and «Профиль в промптах» = `identity.promptContext`), hourly run history + «Запустить сейчас», «Проверки CRM» (CRM checks + watchdogs, preview, switches), «Рассылка» (email digests). Spec `docs/specs/topics/` | `api/admin/topics*`; `src/server/topics/` (signal extraction: `src/server/topics/signals/`) |
| «Сигналы» (Signals) | Signals registry: table with filters, full code editor (all fields, validated, versioned), per-org pack activation / overrides / stage rules / risk guards (preset mechanism kept, no presets defined — one generic set for every org, R22), attributes, relations, risk types, rule templates, history, Markdown export | `api/admin/signals*`; `src/server/signals/` |
| «Тесты и отладка» (Tests and debugging) | Quality checks and debugging of the topics engine, apart from operations («Темы») and the registry («Сигналы»): «Сигналы сообщений» (signal review of scanned items + «Извлечь заново»), «Темы (отладка)» (topic debug + actions), «Эталонный набор» (golden set), «Оценка извлечения (eval)» (eval / model spike with the option «С профилем организации», stored metrics, quality gate; grouping eval). Component `admin-topics-testing.tsx` | `api/admin/topics/{signals,topics,golden,spike}` |

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
  the org record and logo), tab «Профиль организации» (who «we» are and what we
  do — identity registry, business profile, completeness «N из 6»; owner edits,
  members read; spec `docs/specs/identity/`), tab «Участники» (Members — owners
  only: roles, remove, invite), tab «Использование ИИ» (AI usage — owners only:
  the admin views for the org — period, filters, KPIs, cost chart, by function /
  model / user — always cost WITH the platform markup, never the gateway cost or
  markup %; the card «Месячный лимит ИИ»; `api/account/ai-usage`, specs
  `docs/specs/models/05-…` §7 and `08-monthly-limit.md`) and tab «Уведомления»
  (notification categories; topics email choices in mode `on`) and, for owners /
  admins, «Проверка эталона» (golden-set review, was the page `/review`). The
  page remembers its open tab; every page with tabs / views does (per browser),
  and the sidebar remembers open / closed (cookie). Owner banners on `/account`: incomplete org profile,
  AI monthly limit ≥ 70 % (info) / ≥ 90 % / used up, daily AI budget used up.
- Invitations: owner invites by email → email with
  `/accept-invitation/<id>` → invitee signs in with an OTP sent to the invited
  address → accepts → active org is set. `/sign-up` blocks self sign-up when the
  email already has a pending invite.
- Server: `organizations.ts`, `invitations.ts`, `user-avatar.ts`,
  `api-keys.ts` (member management goes through the better-auth organization
  plugin); API: `api/organization`, `api/auth/keys`, `api/invitations/*`,
  `api/account/ai-usage`.

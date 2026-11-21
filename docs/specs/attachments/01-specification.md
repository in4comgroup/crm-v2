# Attachments — specification

Status: **decided 2026-11-15** (Q1–Q13, see [02-open-questions.md](02-open-questions.md) § Decisions); **built 2026-11-15** (D1–D4, see [03-development-plan.md](03-development-plan.md) § Status). Questions: [02-open-questions.md](02-open-questions.md). Plan: [03-development-plan.md](03-development-plan.md).

## 1. Goal (product owner, 2026-11-15)

| # | Requirement |
|---|---|
| R1 | Users add documents (PDF, audio, video, MS Office, images, …) to companies, contacts, deals, tasks and orders |
| R2 | Attachments from sources are attributed correctly to the entities |
| R3 | Files dropped as files (drop-off) are analysed and attributed the same way |
| R4 | Multiple attribution: one file can belong to a company AND a deal (and more) at the same time |
| R5 | Each entity's detail view lists its documents, with preview and download |

## 2. What exists today (check of 2026-11-15)

| Area | Today | Gap vs R1–R5 |
|---|---|---|
| **Files as source items** | Every file is a `source_item`: `attachment` (child of a mail / chat / AI-chat item, `parent_source_item_id`), `drive_file`, `dropoff_file`, `inline_image`, `derived_audio` (audio track of a video). The parser writes markdown + `metadata_json` (summary, companies, mentions, products, language); decorative inline images are `skipped`. Test DB: 8 parsed + 39 skipped mail attachments | Good base: files are already analysed |
| **Original bytes** | NOT stored. Storage keeps only the parsed markdown (`markdown_r2_key`). Drop-off and WhatsApp bytes are discarded after parsing. Mail / Google Chat / Drive bytes can be fetched again from the provider through download proxies (`/api/emails/attachments`, `/api/chats/attachments`, `/api/drive/download`) — but NO UI uses them; IMAP has no proxy; Telegram files are not ingested yet | **R5 download / preview impossible** for most files; a provider-side delete loses the file |
| **Attribution to entities** | No stored link from a file to a company / contact / deal / task / order. «Материалы компании» (`ClientContentTable`, company views only) is a READ-TIME text match: `metadata_json::text ILIKE` any of company name, address, website host, contact names / emails — every message type, not only files. `listContactContent` / `listDealContent` exist but only the AI chat uses them; a deal's list = its company's list + the deal name (no real deal-level attribution). Topics (phase 3+) link items to topics, and topics to a company / contact / deal — a precise path, not used for documents | **R2–R4 not met**: no persistent, explainable, many-to-many links; false positives of the substring match (a short company name matches unrelated text); no links to tasks / orders |
| **Upload in an entity view** | None. Drop-off (`/sources`) is org-level: files + one description, then discovery may attribute companies / contacts from the metadata | **R1 not met** |
| **Lists in entity views** | Company: «Материалы компании» (all messages + files, markdown preview only). Contact, deal, task, order: none | **R5 not met** for 4 of 5 entities; no download |

## 3. Document model

### 3.1 What is a «document»

A `source_item` that is a FILE: `attachment`, `drive_file`, `dropoff_file`, `derived_audio` (shown under its video), and the new user uploads (§5). Not documents: mail bodies, chat messages, AI-chat sessions, decorative / skipped inline images (Q2). Messages stay in «Материалы» / topics (Q10).

### 3.2 Original file in storage

New columns on `source_item` (documents only): `file_key` (object key `org_<orgId>/files/<itemId>/<safe name>`), `file_size_bytes`, `file_mime`, `file_sha256`, `file_stored_at`, `file_status` (`stored` / `not_stored` / `too_large` / `failed`). Bytes are written through `@/server/storage` (`putObject`) when the item is parsed or uploaded (Q1; WhatsApp unchanged — its files are listed without bytes, Q13); the parser keeps its own size caps — a file above a parser cap is STORED (up to the storage cap, Q9) but not analysed (`parse_status = skipped`, reason «too large»). `sha256` dedupes uploads of the same file in an org (offer «уже есть — привязать?»).

### 3.3 Link table (many-to-many, R4)

`document_link`: `id`, `organization_id`, `source_item_id` (FK, cascade), `entity_type` (`client` / `contact` / `deal` / `task` / `order`), `entity_id`, `origin` (`manual` / `upload` / `auto_participant` / `auto_topic` / `auto_content` / `auto_parent`), `confidence` (`high` / `medium`), `reason` (Russian, short: «отправитель письма», «тема сделки», «упомянута компания в документе»), `created_by_user_id` (null = system), `created_at`, `removed_at`, `removed_by_user_id`. Unique `(source_item_id, entity_type, entity_id)`. A person's removal is kept (`removed_at`), so the automatic step never adds the same link again (Q3).

Entity rows deleted / soft-deleted: links stay (history); lists show only links of live entities. Source teardown / reparse: the item's links go with the item (cascade) — a reparse recomputes the automatic links (manual links of a reparsed item are kept by `source_item_id`, which does not change).

## 4. Automatic attribution (R2, R3)

A deterministic step after parsing (no extra AI call; uses the parser's metadata), and again when the item's topic links change. Each rule writes links with its origin, confidence and reason; it never overrides a person's removal.

| # | Rule | Links | Confidence |
|---|---|---|---|
| A1 | **Parent message participants**: the attachment's parent mail / chat item — sender + recipients (to / cc) matched EXACTLY to contacts of the org (email — the contact's own or any extra address in `contact_address`, then the company of that address, see clients-contacts/04; Telegram name — alias «@name» or «Адреса» → Telegram, the original author of a forward, never our members; see telegram/ §4.3) — never our own staff (the «us» resolver). **Who of them (2026-11-21, bug list item 16, `messageParticipants` in `src/lib/documents.ts`)**: the sender always; recipients only of OUR outgoing message (they are the counterparties); on an INBOUND message a recipient / copy only when from the sender's company (same company record as a sender contact, or the same non-free-mail domain as a sender address) — anyone else in copy is not linked. **A1b (2026-11-21)**: when the sender is not a contact, the sender's company by mail domain — a non-free-mail sender domain equal to the website host or e-mail domain of exactly one company (`clientsBySenderDomain`), medium, «компания отправителя (по домену почты)» | each chosen contact + the contact's company | high (an inbound copy from the sender's company: medium, «в копии, из компании отправителя») |
| A2 | **Topic of the parent item** (or of the file itself): every topic the item is linked to (`topic_item`) → the topic's company, contact and deal | company, contact, deal | high |
| A3 | **File content**: the parser's `metadata_json.companies` / people matched to companies / contacts by the EXACT match keys already used by discovery (`companyMatchKey`, `personMatchKey`, unique hits only; own org excluded) | company / contact | medium |
| A4 | **Drop-off with a description or an upload context**: the upload's entity (§5) is a manual link; for org-level drop-off files A3 applies (+ A2 once topics resolve them) | — | — |
| A5 | **Deal by the company's only open deal** (Q4): a company link from A1 / A3 + the company has exactly one open deal → deal link (same rule as topics/10) | deal | medium |

Not automatic: tasks and orders (Q5) — only manual / from the entity view.
Shown in the UI with a badge «авто» + the reason; a person may remove («Отвязать») or confirm (turns `confidence` to high, origin unchanged).

## 5. Manual: upload, link, unlink (R1, R4)

- **Upload** in any entity view (button «Добавить файл» + drag and drop, several files): the file is stored (§3.2), a `source_item` of kind `dropoff_file` is created in the org's «Files Drop Off» source (Q6) with `metadata_json.uploadedFor = { entityType, entityId }`, a `document_link` origin `upload` to that entity is written at once, then the normal parse pipeline analyses it (summary, markdown, metadata) and the automatic step (§4) may add more links (e.g. the deal's company).
- **Link more** («Привязать ещё»): from a document row, choose entities (search over companies, contacts, deals, tasks, orders of the org) → `manual` links.
- **Unlink** («Отвязать»): removes the link only (`removed_at`), never the file.
- **Delete file** («Удалить файл», Q8): removes the stored object, the item (cascade: links, markdown) — uploads only; files from sources cannot be deleted here (they belong to the source; teardown does that).

## 6. Lists, preview, download (R5)

- New tab / card **«Документы»** in: company drawer + `/clients/[id]`, contact drawer, deal drawer, task drawer / dialog, order detail. Columns: name (icon by type), size, date, source («Письмо от …», «Загружен …», «Google Drive»), linked entities (chips, e.g. «Компания · Сделка»), origin badge («авто» + reason tooltip). Actions: «Просмотр», «Скачать», «Привязать ещё», «Отвязать», «Удалить файл» (uploads, Q8). Filters: type (PDF / изображения / аудио / видео / Office / другое), source, text search (name + summary). Sorted newest first, pager 10 / 25 / 50.
- **Deal view** also lists the documents of its linked topics' items (A2 makes them links anyway). **Company view** shows its own links + optionally the links of its contacts / deals (switch «Включая контакты и сделки», Q11). **Since 2026-11-21 (bug list item 19) every view has the switch (default on)**: contact + its deals (`deal_contact`) and tasks («Включая сделки и задачи»); deal + its contacts and tasks («Включая контакты и задачи»); task + its deal («Включая файлы сделки»); order + its company's OWN links («Включая файлы компании» — an order has no deal in the data model). Rule: `viewRefs` in `src/server/documents.ts`.
- **Open / download** (Q7, no preview code or libraries): «Открыть» opens the file route with `disposition=inline` in a NEW browser tab — the browser / OS shows PDF, images, audio and video itself; «Скачать» = `disposition=attachment`. «Текст» opens the parsed text in the existing `ParsedMarkdownDialog` when the file was analysed. The parser's summary shows in the row (tooltip / second line).
- **Download / view route**: `GET /api/documents/[itemId]/file?disposition=inline|attachment` — session + org check of the item, then streams from storage (`getObject`), right `Content-Type`, `Content-Disposition` with the original name (RFC 5987). No public URLs. **Inline only for safe types** (`isInlineSafeMime`: PDF, PNG / JPEG / GIF / WebP / BMP, audio, video, plain text); HTML, SVG, XML and every other type are always served as a download (stored user files must never run script from our origin). Headers: `X-Content-Type-Options: nosniff`, `Cache-Control: private`, and a CSP `sandbox` for every type except PDF (Chrome does not render a PDF under a CSP sandbox). When the bytes are not stored (old items, Q12): fetch from the provider through the existing helpers when possible and store them, else «Файл недоступен — оригинал не сохранён».

## 7. API (proposal)

| Route | Who | What |
|---|---|---|
| `GET /api/documents?entityType=&entityId=&type=&q=&limit=&offset=` | any member | documents of one entity (links not removed) |
| `POST /api/documents/upload` (multipart: `files[]`, `entityType`, `entityId`) | any member | store + create item + link + start parse |
| `POST /api/documents/[itemId]/links { entityType, entityId }` / `DELETE …/links/[linkId]` / `PUT …/links/[linkId] { confirm: true }` | any member | link more / unlink / confirm |
| `GET /api/documents/[itemId]/file?disposition=` | any member | view / download |
| `DELETE /api/documents/[itemId]` | uploader or org owner (Q8) | delete an uploaded file |

Server: `src/server/documents.ts` (org-explicit + session gate), pure attribution rules `src/lib/documents/attribution.ts` (unit-tested). Tenant check on every item and every entity id.

## 8. Limits (Q9)

Storage cap per file **50 MB** (Q9; uploads and source attachments); parser caps unchanged (PDF / Office 20 MB, video 50 MB, audio 10 MB, image 5 MB) — above them a file is stored but not analysed. Upload: ≤ 10 files per request; a chunked upload for big files (as WhatsApp archive does). Per-org storage total shown to the owner later.

## 9. AI use

The AI chat: for a company / contact / deal it can list the entity's documents with their summaries and read one (existing `getSourceItemContent`). No change to the topics prompts.

*Changed 2026-11-16* ([ai-chat](../ai-chat/README.md) v2 + [ai-chat-tools](../ai-chat-tools/README.md)):
- The v1 tool `getSourceItemContent` is gone: the record detail of a company / contact / deal (`getRecord`) lists ≤ 5 documents, and `readSource` reads one.
- **Files attached in the AI chat are documents' source items too**: each file is a source item of the org's «AI Chat» source (`external_type = attachment`, `metadata_json.chatUpload`), uploaded in parts of ≤ 4 MB (`POST /api/chat/files`), the original stored through `storeDocumentOriginal` (`file_key` as in §3.2), parsed when the message is sent; the chat ingest makes it a child of the chat segment item. Limits are the chat's own (ai-chat-tools §5: images 5 MB, PDF / Office 20 MB, audio 10 MB, video 50 MB, text 2 MB, ≤ 5 files per message).
- When the user confirms a chat draft card, the file becomes a document of the created / chosen record (business card → the contact, meeting notes → each created task, a voice note or file → the deal; `addDocumentLink`, origin `manual`, created by the user); the card's «Прикрепить файл к записи» checkbox turns this off. A deal's creation row also carries the file (`deal_activity.source_item_id`). Document lists show the source «ИИ чат».

## 10. Acceptance checks

1. A mail with a PDF from a known contact: after parsing the PDF is linked to the contact and the company (A1), with the reason; it shows in both views; preview and download work.
2. The same mail's topic is linked to a deal: the PDF also shows in the deal (A2).
3. An org-level drop-off file whose text names a known company (exact key) is linked to that company with «авто · упомянута компания» (A3); an unknown name links nothing.
4. Upload in a deal view: the file is stored, linked to the deal at once, parsed, then linked to the deal's company automatically.
5. «Привязать ещё» to a task and an order: the file shows in all linked entities; «Отвязать» in one view removes only that link; the automatic step never re-adds a removed link.
6. A user of another org gets 404 on the file route and on any link action.
7. A file above the parser cap is stored and downloadable but shows «не проанализирован (слишком большой)».
8. Source teardown removes the items, their stored files and links.

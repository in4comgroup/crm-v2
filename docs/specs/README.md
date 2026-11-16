# Specs

Specifications of changes to the system, one topic per sub-folder.

## Rules

- One sub-folder per topic, kebab-case name. A folder holds **only** specs for
  its topic (`auth/` is only for authentication). Unrelated work gets its own
  folder, even when it ships in the same change set; link between folders
  instead of mixing them.
- Every topic folder has a `README.md`: summary, status, date, index of files.
- Add a row to the table below when you create a topic folder.
- Language: English. Quote Russian UI labels exactly, with an English gloss on
  first use, e.g. «Компании» (Companies).
- General system documentation (not change specs) lives in [../docs/](../docs/README.md).

The same rules are in the root `AGENTS.md` → "Working rules".

## Topics

| Folder | Topic | Status |
| --- | --- | --- |
| [auth/](auth/README.md) | Authentication: email OTP only, invitation flow | Implemented 2026-11-13, not yet deployed |
| [billing/](billing/README.md) | Billing / payments: Polar removal | Implemented 2026-11-13, not yet deployed |
| [db-migrations/](db-migrations/README.md) | Database change process: Drizzle migrations baseline + reference (seed) data | Implemented and applied to the DB 2026-11-13 |
| [topics/](topics/README.md) | Topics («Темы»): business questions extracted from source items, scored by signals and an attention engine, shown as cards; drives the sales funnel. Pilot IN4COM; one generic signal set for every org (R22) | Final plan 2026-11-13 (R1–R25); MVP built (phases 0–6: foundations, signals registry, signal extraction, topic engine, attention + cards, deal bridge, deal state + risks, user UI), not deployed; IN4COM `on` (pilot, R25); phase 7 (email delivery), phase 8 (CRM checks + watchdogs), phase 10 (orders link) and phase 12 (old card / discovery logic removed) built; deal status from topics (spec 10: auto-link of topics to the client's deal, card «К какой сделке относится тема?») built 2026-11-15; phase 9 (agency pack) open; phase 11 (external signals) and Telegram in `docs/todo/` |
| [s3-r2/](s3-r2/README.md) | Object storage: generic S3-compatible core + provider registry (Cloudflare R2 today) | Phase 1 implemented 2026-11-13; Phase 2 (rename legacy `r2` columns/routes) planned |
| [models/](models/README.md) | AI models: gateway providers, model registry, per-process model selection, usage statistics, markup | Implemented P1–P4 (registry, per-process models, runtime layer, usage ledger, markup, owner usage view, model policy) 2026-11-13; 2026-11-15: owner tab = the admin views for one org (cost with markup) and the monthly AI limit per org (spec 08, default $20, warnings from 80 %); not yet deployed |
| [identity/](identity/README.md) | Own organization profile (who «we» are: names, domains, mailboxes, staff addresses; what we do: description, business domain, role, products / services, target customers, suppliers — mandatory minimum, gate before topics `shadow` / `on`, one «us» resolver, use in every AI prompt) and client business profiles (manual by the responsible KAM, web enrichment with provenance) | Decided 2026-11-14 (Q1–Q12); I1–I6 built 2026-11-14 / 15 (org profile, «us» resolver, gate, profile in prompts — topics prompts gated by «Профиль в промптах» until a golden-set eval —, client profiles, web enrichment), not deployed; I7 later |
| [clients-contacts/](clients-contacts/README.md) | Companies and contacts: org-scoped custom fields («Доп. поля») — owner-defined fields of 10 types, show / hide and order, «Поля» tab in the company / contact views, every member edits values | Custom fields built 2026-11-15 (definitions, values, old data, AI use, list columns + filters), not deployed; C5 open. Contact ↔ company links over time (04–06): built 2026-11-15 (migration `0039`, test DB, no backfill) |
| [attachments/](attachments/README.md) | Documents (files) of companies, contacts, deals, tasks, orders: original files in storage, many-to-many links with automatic attribution of source attachments and drop-off files, upload / link / unlink, «Документы» lists with preview and download | Built 2026-11-15 (D1–D4: stored originals ≤ 50 MB, `document_link` + automatic attribution, «Документы» in company / contact / deal / task / order views, backfill), not deployed |
| [funnel/](funnel/README.md) | Custom deal funnel per org: stage meaning / definitions / forecast rules, entry gate go / no-go, outcome reasons, meaning-based stage rules; first org: IN4COM GmbH (agency funnel of the requirements document) | Built 2026-11-15 (F1–F4: roles, owner funnel editor incl. rules, templates, gate, forecast, reasons, 7 generic codes; IN4COM on «Тендеры и конкурсы»), not deployed; F5 eval open |
| [telegram/](telegram/README.md) | Telegram bot source: files sent to the bot (PDF, office, photos, video, audio) parsed as attachments with the existing parsers and document handling; group chats; attachment text in signal extraction (all sources) | Built 2026-11-15 (not deployed) |
| [ai-chat/](ai-chat/README.md) | Global AI chat panel v2: admin-selected model, web search (Google grounding sub-call) for any chat model, read-only search over all CRM records, app-rendered lists / details / statistics, status line instead of internal steps, chat history, the chat as a source for topics and deals, library upgrade (AI SDK 7, json-render 0.23, Streamdown 2.7, TanStack Table 9) | Spec 2026-11-16: all questions decided (Q1–Q24); CH0 library upgrade, CH1 records engine, CH2 web-search privacy + monthly limit stop, CH3 statistics + records / stats views, CH4 chat v2 route + UI (replaces v1), CH5 chat history, CH6 chat as a source, CH7 eval (gate passed) built 2026-11-16, CH8 open |
| [notifications/](notifications/README.md) | In-app notifications (bell «Уведомления»): stored per user, categories, priorities important / info, one engine for event producers and hourly checks (AI limits, profile reminders, processes, task reminders) | Built 2026-11-15 (not deployed) |

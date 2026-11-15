# Attachments — development plan

Status: **D1–D4 built 2026-11-15**. One developer with AI assistance, working days.

| Phase | Name | Days | Output |
|---|---|---|---|
| D1 | Storage of originals | 1.5 | migration (`source_item.file_*`); store bytes at parse (mail / IMAP / Chat / Drive / drop-off / WhatsApp) through `@/server/storage`; file route `/api/documents/[itemId]/file` (inline / attachment, tenant check); size caps |
| D2 | Links + automatic attribution | 2 | migration (`document_link`); pure rules A1–A5 (unit-tested); step after parse + on topic link changes; teardown / reparse integration |
| D3 | Upload + link UI | 2 | upload API, «Документы» tab / card in company, contact, deal, task, order views; «Открыть» in a new tab / «Скачать» / «Текст» (Q7: no preview code); «Привязать ещё» picker; unlink / confirm / delete |
| D4 | Backfill + AI | 0.5 | (Q12) one-time links + bytes for existing documents; AI chat lists an entity's documents |

Total ≈ 6 days. Migrations: D1 + D2 (`pnpm db:generate`), applied with `pnpm db:migrate`.

## Status

| Phase | Status (2026-11-15) | Notes |
|---|---|---|
| D1 | **Done** | Migration `0036_documents` (applied). Bytes stored at parse: Nylas / IMAP / Google Chat attachments (incl. «too large» / «unsupported type» children; never decorative inline images), Drive files (Docs → Markdown, Sheets → CSV, Slides → .pptx), org-level drop-off, entity-view uploads. WhatsApp NOT stored (Q13 changed). Lazy re-fetch from the provider (`storeOriginalForItem`). Drop-off rows with a stored original parse / re-parse through `parseSourceItem`. File route `/api/documents/[itemId]/file` |
| D2 | **Done** | `document_link` + pure planner `planAutoLinks` (A1–A3, A5; unit-tested in `src/lib/documents.test.ts`). Runs after parse, after the drop-off upload, when the topics engine links an item to a topic or re-links a topic, and when a topic gets a deal. Teardown deletes stored files; reparse deletes the children's objects and carries a person's links over to the new children |
| D3 | Done | `documents-panel.tsx` («Документы»: upload by button / drag and drop, filters type / source / text, company switch «Включая контакты и сделки», link chips with «авто» + reason, «Подтвердить» / «Отвязать» per link, «Открыть» / «Скачать» / «Текст» / «Привязать ещё» / «Удалить файл», pager, refresh while analysing) + `document-link-picker.tsx`; mounted in the company drawer + `/clients/[id]`, contact drawer, deal drawer, task drawer (new tabs «Задача» / «Документы»), order detail (`order-builder.tsx`, saved orders). Re-parse in «Источники» also for drop-off rows with a stored file. List rows carry `skipReason` («слишком большой» / «формат не поддерживается» / «ошибка анализа») and the list returns `providers` for the source filter (`?source=`). Downloads add a missing extension by mime (Drive Docs / Sheets exports `.md` / `.csv`). Discovery apply recomputes the org's document links after the response (A1 / A3 need the new contacts / companies) |
| D4 | **Done** | `backfillDocuments` ran once on the test DB: 14 documents (2 orgs) → 11 stored, 3 not stored (gone at the provider), 0 failed; 8 automatic links (6 participant, 2 topic). AI chat: `searchEverything` returns `documents` (≤ 5) per matched company / contact / deal |

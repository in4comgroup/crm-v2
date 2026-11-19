# Attachments (documents of companies, contacts, deals, tasks, orders)

Files (PDF, images, audio, video, Office documents, …) linked to CRM entities: from sources (mail / chat attachments, Drive files, drop-off files) and uploaded by users in the entity views; one file can belong to several entities; list, preview and download in every entity view.

Status: **built 2026-11-15** (Q1–Q13 decided; D1–D4). Not deployed; migration `0036_documents` applied on the test DB. 2026-11-16: files attached in the AI chat are stored the same way and linked as documents of the records the chat creates ([ai-chat-tools](../ai-chat-tools/README.md); 01 §9). 2026-11-19: `.xlsx` / `.csv` files are read (tables as the document text) — before, they were stored but «тип не поддерживается» ([03](03-development-plan.md) § «Excel and CSV files»).

| File | Content |
|---|---|
| [01-specification.md](01-specification.md) | Goal, inventory of today (what works, the gaps), the document model (link table, original files in storage), automatic attribution of source attachments and drop-off files, manual upload / link / unlink in the entity views, preview + download, permissions, limits, AI use, acceptance checks |
| [02-open-questions.md](02-open-questions.md) | Q1–Q13 with recommendations; decisions log |
| [03-development-plan.md](03-development-plan.md) | Phases, estimates, migrations |

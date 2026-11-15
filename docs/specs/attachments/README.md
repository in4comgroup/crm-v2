# Attachments (documents of companies, contacts, deals, tasks, orders)

Files (PDF, images, audio, video, Office documents, …) linked to CRM entities: from sources (mail / chat attachments, Drive files, drop-off files) and uploaded by users in the entity views; one file can belong to several entities; list, preview and download in every entity view.

Status: **built 2026-11-15** (Q1–Q13 decided; D1–D4). Not deployed; migration `0036_documents` applied on the test DB.

| File | Content |
|---|---|
| [01-specification.md](01-specification.md) | Goal, inventory of today (what works, the gaps), the document model (link table, original files in storage), automatic attribution of source attachments and drop-off files, manual upload / link / unlink in the entity views, preview + download, permissions, limits, AI use, acceptance checks |
| [02-open-questions.md](02-open-questions.md) | Q1–Q13 with recommendations; decisions log |
| [03-development-plan.md](03-development-plan.md) | Phases, estimates, migrations |

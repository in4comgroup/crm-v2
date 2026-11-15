# Clients and contacts

Specs for companies («Компании», table `client`) and contacts («Контакты», table `contact`). Contact ↔ company links over time (04–06): **built 2026-11-15** (migration `0039`, test DB; no backfill — Q12).

Status: **built 2026-11-15** (Q1–Q12 decided): C1 definitions, C2 values + «Поля» tab, C3 old data converted, AI use (Q11). Not deployed; migration `0034_custom_fields` applied on the test DB. C4 list columns + filters built the same day (migration `0035`). Open (C5): deals / orders, import / export.

| File | Content |
|---|---|
| [01-custom-fields.md](01-custom-fields.md) | Org-scoped custom fields of companies and contacts: field definitions (owner), field types, display (show / hide, order), the «Поля» tab in the company and contact views (every member edits values), data model, API, permissions, limits, acceptance checks |
| [02-open-questions.md](02-open-questions.md) | Q1–Q12 with recommendations; decisions log |
| [03-development-plan.md](03-development-plan.md) | Phases, estimates, migrations (custom fields) |
| [04-contact-company-links.md](04-contact-company-links.md) | Contact ↔ company links over time: history (current / former), a person working with two companies, recognition of a move from the sources (proposals), the person's decision «Перешёл» / «Работает с обеими» / «Другой человек», addresses of one person, contact merge, display on both companies |
| [05-contact-company-links-questions.md](05-contact-company-links-questions.md) | Q1–Q12 with recommendations; decisions log |
| [06-contact-company-links-plan.md](06-contact-company-links-plan.md) | Phases L1–L5, estimates |

# Clients and contacts

Specs for companies («Компании», table `client`) and contacts («Контакты», table `contact`).

Status: **built 2026-11-15** (Q1–Q12 decided): C1 definitions, C2 values + «Поля» tab, C3 old data converted, AI use (Q11). Not deployed; migration `0034_custom_fields` applied on the test DB. C4 list columns + filters built the same day (migration `0035`). Open (C5): deals / orders, import / export.

| File | Content |
|---|---|
| [01-custom-fields.md](01-custom-fields.md) | Org-scoped custom fields of companies and contacts: field definitions (owner), field types, display (show / hide, order), the «Поля» tab in the company and contact views (every member edits values), data model, API, permissions, limits, acceptance checks |
| [02-open-questions.md](02-open-questions.md) | Q1–Q12 with recommendations; decisions log |
| [03-development-plan.md](03-development-plan.md) | Phases, estimates, migrations |

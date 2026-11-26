# Clients and contacts

Specs for companies («Компании», table `client`) and contacts («Контакты», table `contact`). Contact ↔ company links over time (04–06): **built 2026-11-15** (migration `0039`, test DB; no backfill — Q12). Contact field «Ведётся на уровне» (07): **built 2026-11-19** (migration `0048`). Several responsible members of a company (08): **built 2026-11-19** (migration `0049`).

Later changes (2026-11-21, bug list round — [bugfixing/](../bugfixing/README.md)): contact «Имя на родном языке» is required, default = the name (migration `0050`, apply after the code); company «Этап воронки» = the stages of the company's deals (read only; manual `client.funnel_phase` no longer shown); the company name is edited in the drawer header with its own «Сохранить» / «Отмена».

Status: **built 2026-11-15** (Q1–Q12 decided): C1 definitions, C2 values + «Поля» tab, C3 old data converted, AI use (Q11). Not deployed; migration `0034_custom_fields` applied on the test DB. C4 list columns + filters built the same day (migration `0035`). Open (C5): deals / orders, import / export.

| File | Content |
|---|---|
| [01-custom-fields.md](01-custom-fields.md) | Org-scoped custom fields of companies and contacts: field definitions (owner), field types, display (show / hide, order), the «Поля» tab in the company and contact views (every member edits values), data model, API, permissions, limits, acceptance checks |
| [02-open-questions.md](02-open-questions.md) | Q1–Q12 with recommendations; decisions log |
| [03-development-plan.md](03-development-plan.md) | Phases, estimates, migrations (custom fields) |
| [04-contact-company-links.md](04-contact-company-links.md) | Contact ↔ company links over time: history (current / former), a person working with two companies, recognition of a move from the sources (proposals), the person's decision «Перешёл» / «Работает с обеими» / «Другой человек», addresses of one person, contact merge, display on both companies |
| [05-contact-company-links-questions.md](05-contact-company-links-questions.md) | Q1–Q12 with recommendations; decisions log |
| [06-contact-company-links-plan.md](06-contact-company-links-plan.md) | Phases L1–L5, estimates |
| [07-contact-managed-at.md](07-contact-managed-at.md) | Contact field «Ведётся на уровне» (built 2026-11-19, migration `0048`): the person in our organization at whose level a contact is managed — a member or a person who is not a user (name + position); static, no logic reads it |
| [09-contact-names.md](09-contact-names.md) | Contact names (built 2026-11-22, migration `0051`): «Имя на родном языке» is the one shown name everywhere, `name` = «Системное имя» (read-only); rules for sources / persons, `name_native_source` = manual / source, rollout order |
| [10-standard-fields.md](10-standard-fields.md) | Standard fields every org has (built 2026-11-26, migrations `0052` + `0053`): company requisites («Юридическое название», «Юридический адрес», ИНН, КПП, ОГРН, bank details) and the contact birthday — real columns, validation rules, shown at the top of «Поля»; the old «ИНН» custom field moved into `client.inn` |
| [08-co-responsible.md](08-co-responsible.md) | Several responsible members of a company (built 2026-11-19, migration `0049`): the main «Ответственный» + additional members «Также отвечают» — who changes them, where each one counts, API, UI |

Related: the AI chat creates companies / contacts, fills empty fields («Дополнить») and links contacts to companies through these rules after the user confirms a draft card — [ai-chat-tools/](../ai-chat-tools/README.md) (built 2026-11-16; 04 §6 «AI chat»).

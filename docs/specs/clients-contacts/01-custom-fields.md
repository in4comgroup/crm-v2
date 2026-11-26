# Custom fields of companies and contacts

Status: **built 2026-11-15** (Q1–Q12, see [02-open-questions.md](02-open-questions.md) § Decisions): C1–C3 + AI use + list columns / filters (§3.3, §3.5). Questions: [02-open-questions.md](02-open-questions.md). Plan: [03-development-plan.md](03-development-plan.md).

## 1. Goal

Each organization defines its OWN extra fields for companies and for contacts («Доп. поля»), for example «ИНН», «Дата договора», «Канал продаж», «Годовой бюджет». The platform does not know these fields in advance.

| # | Requirement (product owner, 2026-11-15) |
|---|---|
| R1 | Create and edit fields, per organization |
| R2 | Choose the format of a field: text, date, currency, list of options, … |
| R3 | Edit the display: at least show / hide and the order |
| R4 | A tab in the company and contact detail views where the fields are seen and edited |
| R5 | The org **owner** creates / changes / removes fields; **every member** edits the values |

Non-goals (separate work): formulas, files as field values, relations to other entities, per-field permissions, fields on deals / orders / tasks (see Q10), import / export.

## 2. What exists today (2026-11-15)

| Area | Today | Gap |
|---|---|---|
| `client.custom_fields` (jsonb) | System keys read by code: `discount` (order discount, all orgs), `companyKind` (supplier / partner tab, all orgs), `type` (only ONE org, hard-coded org id `CLIENT_TYPE_ORG_ID` and fixed values on_trade / off_trade / own_needs / internet_shop in `src/lib/client-custom-fields.ts` — old content). Data: `type` on 24 companies, `tax_ID` on 6 companies (no code reads it), `discount` on 3 | No way for an org to add its own field; `type` is a hard-coded per-org special case |
| `contact` | No custom fields | — |
| Company views | Drawer (`client-detail-drawer.tsx`, tabs «Информация» / «Задачи» / «Контакты» / «Материалы» / «Темы») and page `/clients/[id]` (`client-detail-shell.tsx`, cards, no tabs) | No place for extra fields |
| Contact views | Drawer (`contact-detail-drawer.tsx`, tabs «Информация» / «Темы») | — |

## 3. Field definitions (owner)

### 3.1 Data

A field definition belongs to ONE org and ONE entity (`client` or `contact`).

| Property | UI label | Notes |
|---|---|---|
| Label | «Название поля» | ≤ 60 chars, unique per org + entity (case-insensitive) |
| Type | «Тип» | §3.2. Fixed after values exist, except the safe changes in §3.4 |
| Help text | «Подсказка» | optional, ≤ 200 chars, shown as a hint (`AnchorTooltip`) |
| Options | «Варианты» | select types only: ≤ 100 options, each `{ id, label ≤ 60, archived }`; order = drag |
| Type settings | — | currency: currency code (§3.2); number: decimals 0–4; text: single line / multi-line |
| Shown | «Показывать» | hidden fields are not shown in the tab; their values are kept (R3) |
| Position | — | order in the tab (drag, R3) |
| Section | «Раздел» | optional group heading (Q5) |
| Archived | — | «Удалить» archives the field (values kept, not shown, can be restored — Q6) |
| Meta | — | created / updated by, at; key = stable id (renaming never touches values) |

### 3.2 Types (MVP — Q2)

| Type | UI label | Value stored | Input | Display |
|---|---|---|---|---|
| `text` | «Текст» | string ≤ 1,000 | input (or textarea when «многострочный») | as is |
| `number` | «Число» | number | numeric input, decimals from settings | `toLocaleString("ru-RU")` |
| `currency` | «Сумма» | `{ amount: number, currency: string }` | amount + currency select (default = the field's currency) | `12 500,00 ₽` / `$1,200.00` |
| `date` | «Дата» | `YYYY-MM-DD` | date picker | «15 нояб. 2026» |
| `select` | «Список (один вариант)» | option id | select | option label |
| `multiselect` | «Список (несколько)» | option id[] | multi-select chips | chips |
| `boolean` | «Да / нет» | true / false | switch | «Да» / «Нет» |
| `url` | «Ссылка» | string (http / https) | input | link, opens in a new tab |
| `email` | «Email» | string | input | `mailto:` link |
| `phone` | «Телефон» | string | input | `tel:` link |

Empty value = the key is absent (never `""`). Validation of every value by the field type (zod, `src/lib/custom-fields.ts`, client-safe) — the same function in the UI and the server.

### 3.3 Display (R3)

- The «Поля» tab lists the shown fields in position order, grouped by section (Q5).
- The owner manages definitions in a dialog per entity (Q1: `/clients` → company fields, `/contacts` → contact fields): a list with drag to reorder, the «Показывать» switch, «Изменить», «Удалить» (archive), «Восстановить», and a preview of the tab.
- «Показывать в списке» (`show_in_list`, owner, per field; only for a shown field): the field is a column of the list — the companies table view on `/clients` and the contacts table on `/contacts` (plus a short «Название: значение» line, ≤ 3 fields, on the company and contact cards views). Saving values in the «Поля» tab refreshes the list. Hiding a field also turns «Показывать в списке» off. Showing it again does not turn it back on, so the owner turns it on again. Built 2026-11-15 (Q7 moved forward by the product owner).

### 3.5 List filters (built 2026-11-15)

Every SHOWN, non-archived field can filter the list (`/clients` → company fields, `/contacts` → contact fields) — not only the list columns. Button «Фильтр по полям» in the top bar (count badge), a popover to add conditions, active conditions as removable chips. Conditions are AND-combined, and AND with the page's other filters (tab, status, «Ответственный», profile).

| Type | Conditions |
|---|---|
| every type | «заполнено» (`filled`), «не заполнено» (`empty`) |
| text, url, email, phone | «содержит» (`contains`, case-insensitive substring) |
| select | «один из» (`in`, option ids) |
| multiselect | «есть любой из» (`any`, option ids) |
| boolean | «да» / «нет» (`is`) |
| number, currency (amount, any currency), date | «с … по …» (`range`, inclusive; either bound may be empty) |

Transport: `?cf=<JSON array of CustomFieldFilter>` on `GET /api/clients` (feed) and `GET /api/contacts` (paged list), ≤ 10 conditions. The server parses with the PURE `parseCustomFilters` (`src/lib/custom-fields.ts`): unknown / hidden / archived fields, wrong ops and empty values are DROPPED, so a stale URL never breaks the list. Companies: the feed already loads the org's companies and filters in JS → PURE `matchesCustomFilters`. Contacts (SQL-paginated): `customFilterConditions` (`src/server/custom-fields.ts`) builds SQL on `contact.custom_values` with bound parameters (`ilike` with `%` / `_` escaped, `?|` for multiselect, numeric / text comparison for ranges) — the same semantics, checked against the pure matcher on live data (10 cases). GIN indexes on `client.custom_values` and `contact.custom_values` (migration `0035`). Rows of both lists carry `customValues`.

### 3.4 Changing a field that has values

| Change | Allowed | Effect on values |
|---|---|---|
| Label, help text, section, shown, position | yes | none |
| Add / rename / reorder an option | yes | none (values keep the option id) |
| Remove an option | yes = archive the option | values keep it, shown as «<label> (удалён)»; the option is not offered any more |
| `text` single line ↔ multi-line | yes | none |
| `select` → `multiselect` | yes | value → one-element list |
| Currency of a `currency` field | yes | only the default for NEW values; stored values keep their currency |
| Any other type change | no (create a new field) | — |
| Archive («Удалить») | yes | values kept, hidden everywhere; «Восстановить» brings them back |
| Delete for good | Q6 | values removed |

## 4. Values (all members)

- Stored per company / contact, keyed by the field id (§5). Every member of the org reads and edits values of every shown field (R5). Hidden / archived fields are not editable in the tab.
- Edit model (Q8): the tab is a form with «Сохранить» (only changed fields are written) and the unsaved-changes guard, like the other forms. Since 2026-11-26 the button is disabled only while saving; with nothing changed a click says «Изменений нет — всё уже сохранено» (a field created in «Настроить поля» is saved at once).
- Since 2026-11-26 the tab first shows the **standard fields** every org has (real columns, not custom fields — company requisites, contact birthday; [10-standard-fields.md](10-standard-fields.md)), then the custom fields under «Дополнительные поля»; one «Сохранить» for both (`PUT /api/custom-values { values, standard }`). A save with a change also turns an automatic «Новая» record into «Активная».
- Value history (Q9): one log row per changed field (who, when, before, after), shown under the field («История»).
- Writers: only people through the tab (and the owner bulk actions later). Discovery, enrichment, topics and AI never write custom values in this release.
- Read by (Q11): the tab; the AI chat (shown fields of the companies / contacts it finds, as «Название: значение» lines); the topics prompts card writer and deal state (shown fields of the topic's / deal's company, ≤ 400 chars, after the client profile summary; gated by `identity.promptContext`). Hidden and archived fields never reach the AI.

## 5. Data model

| Change | Kind |
|---|---|
| `custom_field` — `id`, `organization_id`, `entity` (`client` / `contact`), `label`, `type`, `config` jsonb (options, currency, decimals, multiline, systemKey), `help_text`, `section`, `is_shown`, `show_in_list` (migration `0035`), `position`, `archived_at`, `created_by_user_id`, `updated_by_user_id`, timestamps; index `(organization_id, entity, position)` | new table (schema migration) |
| `client.custom_values` jsonb (default `{}`) and `contact.custom_values` jsonb (default `{}`) — `{ "<fieldId>": value }` | new columns. The existing `client.custom_fields` stays for SYSTEM keys (`discount`, `companyKind`) read by code; org fields never mix with them |
| `custom_field_value_log` — `id`, `organization_id`, `entity`, `entity_id`, `field_id`, `before`, `after`, `changed_by_user_id`, `created_at` (if Q9 = yes) | new table |
| GIN indexes `client_custom_values_gin`, `contact_custom_values_gin` (list filters, §3.5) | migration `0035_custom_fields_list` |

Value lists (`entity`, `type`) are text validated in code (as in topics). Tenant data never goes into migrations: converting the existing `type` / `tax_ID` keys (Q12) is a one-time owner / admin action, not a migration.

## 6. API and permissions

| Route | Who | What |
|---|---|---|
| `GET /api/custom-fields?entity=client\|contact[&archived=1]` | any member (archived: owner) | `{ fields, canManage }` |
| `POST /api/custom-fields { field }` | org owner | create |
| `PUT /api/custom-fields/[id] { field }` | org owner | change (§3.4 rules; 409 for a forbidden type change; options dropped from the input stay as archived options) |
| `PUT /api/custom-fields/[id] { action: archive \| restore }` | org owner | «Удалить» / «Восстановить» |
| `DELETE /api/custom-fields/[id] { confirmLabel }` | org owner | «Удалить навсегда» — archived fields only, typed label; values removed from every row |
| `PUT /api/custom-fields/order { entity, ids }` | org owner | new order |
| `GET /api/custom-values?entity=&id=` | any member (tenant check of the row) | `{ fields, values, canManage }` |
| `GET /api/custom-values?entity=&id=&history=1[&fieldId=]` | any member | last 50 value changes |
| `PUT /api/custom-values { entity, id, values: { fieldId: value \| null } }` | any member | save changed values (shown, non-archived fields only; one log row per changed value) |

Server: `src/server/custom-fields.ts` (`server-only`, org-explicit core + the session gate `customFieldsSession`). Contract (client-safe, unit-tested): `src/lib/custom-fields.ts`. A field may carry a code-only role `config.systemKey` (`client_type` = the converted company type read by analytics and the stage-rule guard, Q12); its type cannot change and an owner edit keeps the role. Platform admins: Q3.

## 7. Limits

≤ 50 active fields per org and entity; label ≤ 60; help ≤ 200; text ≤ 1,000 (multi-line ≤ 10,000); ≤ 100 options per field; number / amount within ±1e12.

## 8. UI

- Definitions (Q1): the owner sees an icon button «Настроить поля» (`AnchorTooltip`) in the top bar of `/clients` (company fields) and `/contacts` (contact fields), next to the view switch and the blocklist button; it opens a dialog with the field list of that entity (§3.3). Dialog «Новое поле» / «Изменить поле»: label, type (cards with an example), type settings, options editor (add, rename, drag, archive), help text, section, «Показывать».
- Company drawer + `/clients/[id]` + contact drawer: tab **«Поля»** (Q4 for the page). Empty state: «Поля не настроены» + for the owner a link to the definitions.
- Russian UI; no example values from any real company in placeholders.

## 9. Acceptance checks

1. The owner creates a field of every type for companies and for contacts; a member gets 403 on create / change / reorder / archive.
2. A member edits values of every type in the tab; invalid values (bad date, text too long, unknown option, bad URL) → 400 with a Russian message.
3. Hide / show and reorder change the tab at once for every member; values of a hidden field are kept and come back when it is shown again.
4. Renaming a field or an option never changes stored values; an archived option still shows on old values as «… (удалён)».
5. A forbidden type change → 409; `select` → `multiselect` converts values.
6. Another org never sees the fields or values (tenant check on every route).
7. (Q9 yes) every value change has one log row with before / after.
8. A field with «Показывать в списке» is a column on `/clients` (table view) / `/contacts`; turning it off removes the column for everyone.
9. Every filter condition of §3.5 narrows the list correctly, together with the other page filters; a stale `cf` (deleted field, removed option) is ignored, not an error.

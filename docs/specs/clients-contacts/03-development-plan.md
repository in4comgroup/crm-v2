# Custom fields — development plan

Status: **C1–C3 + AI use + list columns / filters built 2026-11-15**; answers in [02-open-questions.md](02-open-questions.md). One developer with AI assistance, working days.

| Phase | Name | Days | Output |
|---|---|---|---|
| C1 | Definitions | 1.5 | migration (`custom_field`, `client.custom_values`, `contact.custom_values`, `custom_field_value_log`); `src/lib/custom-fields.ts` (types, zod per type, display formatting — unit-tested); `src/server/custom-fields.ts`; API; owner UI (Q1) with drag order, show / hide, options editor, archive / restore |
| C2 | Values | 1.5 | «Поля» tab in the company drawer, the contact drawer, card on `/clients/[id]` (Q4); values API with tenant checks; value log + «История» (Q9); empty state |
| C3 | Existing data | 0.5 | (Q12) one-time conversion of `type` / `tax_ID`; remove `CLIENT_TYPE_ORG_ID` and the special `type` selector — **done 2026-11-15** (see «Status» below) |
| C4 | List columns + filters | 1 | «Показывать в списке» + columns on `/clients` / `/contacts`, filters by every shown field (spec §3.5) — **done 2026-11-15** (Q7 moved forward). AI use (Q11) moved forward — **done 2026-11-15** |
| C5 | Later | — | deals / orders (Q10), import / export, sorting the contacts list by a custom field |

Total C1–C3 ≈ 3.5 days. Migrations: one in C1 (`pnpm db:generate --name custom_fields`), applied with `pnpm db:migrate`.

## Status

- **C3 — existing data (Q12), done 2026-11-15.** One-time admin conversion (NOT a migration; the converter code was deleted 2026-11-16 after it ran; idempotent — the type field is found by `config.systemKey = "client_type"`, «ИНН» by label; a second run changes nothing): `custom_fields.type` → `select` field «Тип клиента» (option id = the old value, `systemKey = "client_type"`), `custom_fields.tax_ID` → `text` field «ИНН»; values copied into `custom_values[<fieldId>]`, old keys removed, `discount` / `companyKind` untouched, no value-log rows. Run once on the test DB: 1 org, 24 type values + 6 ИНН values moved. The hard code is gone (`CLIENT_TYPE_ORG_ID`, `CLIENT_TYPE_VALUES`, `CLIENT_TYPE_LABELS`, the «Тип» selector of the edit form). Readers of the type now use the field: analytics slices + the «ИИ ассистент» dimension `clientType` (`src/server/client-type-field.ts` → `clientTypeKeySql`, option id = key, option label = label, no field = «Без типа»), the stage-rule guard `client_type = X` (option id OR label, case-insensitive; `loadClientGuardFacts`).
- **AI use (Q11), done 2026-11-15.** AI chat `searchEverything`: matched companies and contacts carry `fields` (≤ 400 chars, shown fields only). Topics prompts `topics.card_writer` and `deals.state_summary`: the block «Поля компании:» after the client profile, only with `identity.promptContext` (off = byte-identical prompts).
- **C4 — list columns + filters, done 2026-11-15.** Migration `0035_custom_fields_list` (applied on the test DB): `custom_field.show_in_list` + GIN indexes on both `custom_values`. Contract: `CustomFieldFilter`, `filterOpsFor`, `encodeCustomFilters`, `parseCustomFilters`, `matchesCustomFilters` (`src/lib/custom-fields.ts`, unit-tested); SQL builder `customFilterConditions` (`src/server/custom-fields.ts`). `listClientsFeed` (JS) and `listContactsPaged` (SQL) take `customFilters` (`?cf=`), rows carry `customValues`. UI: «Показывать в списке» in the owner dialog, columns, «Фильтр по полям» + chips on both pages.


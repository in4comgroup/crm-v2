# Standard fields of companies and contacts

Status: **built 2026-11-26** (tester request: «Дефолтно только поле ИНН — как сделать дефолтные поля?»; the product owner gave the list). Migrations `0052_client_requisites_contact_birthday` (columns) + `0053_inn_custom_field_to_column` (data); both applied on the test DB.

## 1. What

Every org has these fields, without any set-up by the owner. They are real columns, not org custom fields (`custom_field`), so the values can be validated by their own rules and later used by code (documents, search, export).

| Entity | Section | Field (UI) | Column | Rule |
|---|---|---|---|---|
| Company | «Реквизиты» | «Юридическое название» | `client.legal_name` | text, ≤ 500 |
| Company | «Реквизиты» | «Юридический адрес» | `client.legal_address` | multi-line text, ≤ 1,000 |
| Company | «Реквизиты» | «ИНН» | `client.inn` | 10 or 12 digits |
| Company | «Реквизиты» | «КПП» | `client.kpp` | 9 characters: digits; positions 5–6 may be Latin capitals A–Z |
| Company | «Реквизиты» | «ОГРН» | `client.ogrn` | 13 or 15 digits |
| Company | «Банковские реквизиты» | «Расчётный счёт» | `client.bank_account` | 20 digits; the input accepts groups of 4 with spaces |
| Company | «Банковские реквизиты» | «Наименование банка» | `client.bank_name` | text, ≤ 300 |
| Company | «Банковские реквизиты» | «БИК» | `client.bank_bik` | 9 digits |
| Company | «Банковские реквизиты» | «Корр. счёт банка» | `client.bank_corr_account` | 20 digits; groups of 4 allowed |
| Contact | «Основное» | «День рождения» | `contact.birthday` (date) | a valid date, 1900-01-01 … today |

Numbers are stored as TEXT (leading zeros stay) and normalised on save: spaces and dashes removed, КПП in upper case. Accounts are shown in groups of 4 («4070 2810 9000 0000 1234»), the birthday as DD.MM.YYYY. No checksum test of ИНН / ОГРН / accounts (only the length rule above) — a test value with a wrong check digit is accepted on purpose.

## 2. Where

- Contract (pure, unit-tested): `src/lib/standard-fields.ts` — `CLIENT_STANDARD_FIELDS`, `CONTACT_STANDARD_FIELDS`, `validateStandardValue`, `validateStandardPatch`, `formatStandardValue`. A new standard field = one line there + a column + a migration + one line in `clientStandardCols` / `contactStandardCols` (`src/server/custom-fields.ts`).
- UI: the top of the «Поля» panel (`custom-fields-tab.tsx`) — company drawer tab «Поля», card «Поля» on `/clients/[id]`, contact drawer tab «Поля». The org custom fields follow under «Дополнительные поля». ONE «Сохранить» for both; the same unsaved-changes guard; errors under the input. No «История» for standard fields (the value log `custom_field_value_log` refers to `custom_field`).
- API: `GET /api/custom-values?entity=&id=` also returns `standard: { key: value | null }`; `PUT /api/custom-values { entity, id, values?, standard? }` saves the standard fields first (`saveStandardValues`, only changed columns), then the custom values. Any member of the org.
- Contact merge (`mergeContacts`): the kept contact's birthday, else the merged one's.

## 3. Old «ИНН» custom field

The one-time conversion of 2026-11-15 (Q12) had made ИНН an org custom field «ИНН» (text). Migration `0053` copies each valid value (10 / 12 digits) into `client.inn` when it is empty, then archives the custom field only when every non-empty value now equals `client.inn` (the owner can restore it; the values stay in `custom_values`). Test DB: 6 values copied, the field archived.

## 4. Not done

- Not in the company / contact create forms, the lists, the filters, the global search or the AI chat record details — only in the «Поля» panel.
- No automatic fill (web enrichment, parsing of documents / signatures).

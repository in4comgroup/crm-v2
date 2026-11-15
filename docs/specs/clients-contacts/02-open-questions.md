# Custom fields — open questions

Status: **answered 2026-11-15** (product owner; Q7 changed later the same day — built). Decisions go to § Decisions and into [01-custom-fields.md](01-custom-fields.md).

| # | Question | Options | Recommendation |
|---|---|---|---|
| Q1 | Where does the owner manage field definitions? | (a) `/account` → new tab «Поля компаний и контактов» (two sub-lists: Компании / Контакты); (b) a settings dialog on the `/clients` and `/contacts` pages; (c) both | **(a)** — one place next to «Профиль организации»; members see it read-only; plus a link «Настроить поля» from the empty «Поля» tab |
| Q2 | Field types in the first release | (a) the 10 types of §3.2; (b) only text, number, currency, date, select; (c) more (member / user, file, formula) | **(a)** — url / email / phone / yes-no / multi-select are cheap and common; member, file and formula later |
| Q3 | Platform admins | (a) same rights as the org owner (support); (b) none | **(b)** for now, like the org profile (identity I1) — admins act as owner only when they are the org owner |
| Q4 | The page `/clients/[id]` has cards, no tabs | (a) add a card «Поля» on the page + the tab in the drawer; (b) convert the page to tabs | **(a)** — same content, less change |
| Q5 | Sections (group headings) in the tab | (a) optional text «Раздел» per field; (b) no sections | **(a)** — free text, fields with the same section are grouped; no section = top group |
| Q6 | «Удалить» a field | (a) archive only (values kept, restore possible); (b) archive + «Удалить навсегда» for the owner with a typed confirmation; (c) hard delete only | **(b)** — archive by default, hard delete only on purpose |
| Q7 | Companies / contacts list | (a) not in this release; (b) «Показывать в списке» = a column + a filter on `/clients` / `/contacts` | **(a)** now, (b) next phase — filtering jsonb by type needs its own indexes |
| Q8 | Edit model in the tab | (a) one form + «Сохранить» (unsaved-changes guard); (b) save each field on blur | **(a)** — same as every other form in the product |
| Q9 | Value history | (a) log every change (who, when, before, after) + «История» per field; (b) no history | **(a)** — several people edit; cheap table |
| Q10 | Entities | (a) companies + contacts; (b) + deals / orders later with the same engine | **(a)** now; the model has `entity`, so (b) is a later extension |
| Q11 | AI use of custom values | (a) not now; (b) AI chat + card writer / deal state see shown values | **(a)** now; (b) after the fields are used (cost / prompt size) |
| Q12 | Existing data: `client.custom_fields.type` (one org, hard-coded values on_trade / off_trade / own_needs / internet_shop — old content) and `tax_ID` (6 companies, no code reads it) | (a) convert: `type` → a `select` field of that org with the same values, `tax_ID` → a `text` field «ИНН»; remove the hard-coded org id and the special `type` selector from the code; (b) leave them as they are; (c) delete them | **(a)** — the org keeps its data as normal custom fields; the per-org hard code goes away (one-time admin action, not a migration) |

## Decisions

| # | Decision (2026-11-15) |
|---|---|
| Q1 | **Changed:** the owner manages fields from a button + dialog in the top bar of `/clients` (company fields) and `/contacts` (contact fields), next to the view switch / blocklist buttons; visible to the owner only |
| Q2 | (a) the 10 types of §3.2 |
| Q3 | (b) no rights for platform admins |
| Q4 | (a) card «Поля» on `/clients/[id]` + tab «Поля» in the drawers |
| Q5 | (a) optional «Раздел» per field |
| Q6 | (b) archive + «Удалить навсегда» with a typed confirmation |
| Q7 | (a) no list columns / filters now → **changed 2026-11-15:** (b) built — «Показывать в списке» = a column; every shown field can be a filter (spec §3.3, §3.5) |
| Q8 | (a) one form + «Сохранить» |
| Q9 | (a) value history |
| Q10 | (a) companies + contacts |
| Q11 | **(b) YES:** AI chat sees the shown values of companies / contacts; the topics prompts (card writer, deal state) get the company's shown values next to the client profile summary (gated by `identity.promptContext` like every topics prompt change) |
| Q12 | (a) convert `type` → `select` field, `tax_ID` → `text` field «ИНН»; remove the hard code |

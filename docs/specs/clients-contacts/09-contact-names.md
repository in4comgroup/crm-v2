# Contact names: shown name and system name

Status: **built 2026-11-22**, not deployed. Migration `0051_contact_name_native_source` (not applied yet — see «Rollout»).

## Decision (product owner, 2026-11-22)

A contact has two names:

| Field | UI label | Role |
|---|---|---|
| `contact.name_native` | «Имя на родном языке» | The ONE name people see: every list, card, picker, topic, notification, Telegram message, email and AI chat answer |
| `contact.name` | «Системное имя» | The name the sources use (e-mail display name, Telegram profile name, business card). Used for matching. Shown read-only in the contact form only when it differs |
| `contact.name_native_source` | — | Who set the native name: `manual` (a person — a source never replaces it) or `source` (a source / the system — a signature name found later may replace it) |

Answers to the questions of 2026-11-22: native name everywhere (1), a person's native name is never replaced by a source (2), a source replaces the system name only while it is the copy, with the most frequent display name (3), an address without a display name fills both names (4), the system name is read-only «Системное имя» (5), one rule for all sources (6).

## Rules (`src/lib/contact-names.ts`, unit-tested)

1. **Contact from a source** (`sourceContactNames`): system name = the account / display name (else the address); native name = the signature name when found, else the same value; `source`.
2. **Contact a person creates** (`manualContactNames`): the form asks only «Имя на родном языке» (+ e-mail etc.); system name = its copy; `manual`.
3. **Source sees an existing contact** (by e-mail; `namesFromSource`, discovery apply): system name ← the most frequent display name (never an address) while the system name is the copy of the native name or a placeholder; native name ← the signature name only when `source`; a `source` native name that is the copy follows the new system name.
4. **A person edits the native name** (`namesFromManualEdit`): `manual`; the system name follows while it was the copy. The form sends the native name only when it changed.
5. **Shown name** = `contactDisplayName` (UI) / `contactDisplaySql` (`src/server/contact-display.ts`, SQL `coalesce(nullif(trim(name_native), ''), name)`). Matching, dedupe and search keep reading both names.

Where: discovery (`src/server/discovery.ts`: display-name votes `pickDisplayName`, native-name votes `pickNativeName`, preview `displayNames[]`, apply), `createContact` / `updateContact` (`namesFrom: manual | source`), Telegram «Создать контакт» (`source`), AI chat cards (`source`), the contact form, every display query and component. Sorting of contact lists = by the shown name.

## Rollout

1. The code of the bug-list round (2026-11-21) must be live (it writes `name_native`).
2. `pnpm db:migrate` — applies `0050` (native name NOT NULL) and `0051` (column `name_native_source`, default `source`; rows whose native name differs from the system name → `manual`).
3. Deploy this code (it reads `name_native_source`; it fails without `0051`).

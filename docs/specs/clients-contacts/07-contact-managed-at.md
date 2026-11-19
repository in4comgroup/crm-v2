# Contact field «Ведётся на уровне» (managed at the level of)

Status: **built 2026-11-19** (migration `0048_contact_managed_at`, applied on the test DB). Product owner request, 2026-11-19. No open questions: the decisions in §6 are the defaults taken.

## 1. Need

Some contacts must be handled at a specific level of OUR organization. Example: the client's owner talks only to our general manager or CEO, not to the sales rep. The CRM must keep this fact on the contact as a reference to that person.

- The person can be a **user of the system** (an org member) or a **person of our organization who is not a user** (e.g. the CEO, who never signs in).
- The field is **static**: it is information for people. **No logic reads it now**: no routing, rights, notifications, topics, AI prompts, analytics, filters.

**Today (before this change):**

| Field | Meaning |
|---|---|
| `contact.user_id` («Кто создал») | Who created the contact. Not an owner, not a KAM |
| `client.responsible_user_id` («Ответственный») | The member responsible for the COMPANY. A contact has no own responsible person |

The new field does not replace or change either of them.

## 2. Field

- **Label:** «Ведётся на уровне» (managed at the level of).
- **Hint under the control:** «Кто в нашей компании ведёт этот контакт на своём уровне — например, генеральный директор. Только для информации.»
- **Value, one of:**
  - not set («Не указано»);
  - **a member** of the active org (human members only, never «Агент»; banned users are not offered);
  - **another person of our organization** (not a user): «Имя» (required, ≤ 120 characters) + «Должность» (optional, ≤ 120).
- **Display:** «Иван Петров, генеральный директор» / «Анна Смирнова». A member who later left the org stays on the contact as «Анна Смирнова (не в организации)». That value is shown and kept, but not offered for other contacts.

## 3. Data model

Columns on `contact` (migration `0048`, generated from `src/db/schema.ts`):

| Column | Type | Notes |
|---|---|---|
| `managed_at_user_id` | text null, FK `user` on delete set null | The member |
| `managed_at_person_name` | text null | A person who is not a user |
| `managed_at_person_position` | text null | Their position |
| `managed_at_set_by_user_id` | text null, FK `user` on delete set null | Who set the current value |
| `managed_at_set_at` | timestamp null | When |

- CHECK `contact_managed_at_one_kind`: a member **or** a person, never both.
- «Who / when» is stamped only when the value changes, and cleared together with the value. There is no history table. Product decision: the field is static, so the last setter is enough (§6 D4).
- Contact merge (`mergeContacts`): the kept contact keeps its value. When it has none, it takes the merged contact's value (with its «who / when»).
- Discovery, the AI chat and teardown are not changed. New contacts from them have no value.

## 4. API and server

- `GET /api/contacts?managedAtOptions=1` → `{ members: [{ userId, name }], people: [{ name, position }] }`. `people` = distinct named persons already used on contacts of the org (≤ 200), for the autocomplete. Any member of the active org.
- `POST /api/contacts` and `PUT /api/contacts` accept `managedAt`:
  - `{ kind: "member", userId }`: the user must be a human member of the active org, else 400 «Сотрудник не найден в организации»;
  - `{ kind: "person", name, position? }`: trimmed; an empty name → 400;
  - `null`: clear the value;
  - absent: no change.
- Every contact row of `src/server/contacts.ts` (`getContact`, `listContacts`, `listContactsPaged`) carries `managedAt` = `{ kind: "member", userId, name, isMember } | { kind: "person", name, position } | null`. Contact rows built elsewhere (`ClientRow.contacts`) do not carry it (undefined).
- Who edits: any org member, the same as every other contact field.
- Contract (client-safe, unit-tested): `src/lib/contact-managed-at.ts`. It holds the zod input schema, the column mapping, `sameManagedAt`, `readManagedAt` and `managedAtLabel`.

## 5. UI

- **Contact edit form** (`form-contact-edit.tsx`: the contact drawer «Общая информация» and the create / edit dialog), under «Должность»:
  - a select «Ведётся на уровне» with «Не указано», then the group «Сотрудники в системе», then «Другой человек нашей компании…»;
  - for «Другой человек»: two inputs «Имя *» (autocomplete from the names already used; a picked name fills an empty «Должность») and «Должность».
- The form sends `managedAt` **only when the user changed it**. A contact opened from a company card has no loaded value, so the form loads the contact first. It never clears a value by mistake.
- **Contact card** (`contact-card.tsx`, `/contacts`): one line «Ведётся на уровне: …» when set.
- Not in this change: list column, filter, company page, AI chat record detail (§7).

## 6. Decisions (defaults taken, 2026-11-19)

| # | Decision | Why |
|---|---|---|
| D1 | A **built-in** contact field, not a custom field type | It is a product field for every org. Custom fields (01) have no «member / person» type; adding one would be a bigger change for one field |
| D2 | A person who is not a user = **free text** (name + position) with autocomplete, **no new directory table** | Static field, no logic. A directory of «our people» can come later (§7) and take these values over |
| D3 | Edit rights = **any member** | Same as the other contact fields |
| D4 | Only «who / when set» for the current value, **no change log** | Static information field. The custom-field log is for org fields |
| D5 | A member who left the org **stays** on the contact, marked «(не в организации)» | The information stays true for the history. A user deleted from the platform clears the value (FK set null) |

## 7. Later (not planned)

- Show it on the company page (contacts block) and as a list column / filter on `/contacts`.
- AI chat record detail of a contact (read only).
- A directory of our people who are not users (shared with the identity registry), if more fields need it.
- Logic that uses it (routing of topics / cards to that person, notifications): only with a new decision.

## 8. Checks

- Unit tests `src/lib/contact-managed-at.test.ts` (5): input validation, trim, column mapping, comparison, labels.
- DB (test DB, 2026-11-19): the 5 columns exist. Setting a member and a person at once is refused by the check.
- `tsc` 0 errors, `pnpm test` 975 / 975, `pnpm lint` 0 errors.

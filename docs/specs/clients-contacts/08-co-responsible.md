# Several responsible members of a company («Также отвечают»)

Status: **built 2026-11-19** (migration `0049_client_co_responsible`, applied on the test DB). Product owner: «a client can have several responsible persons from the user list, not just one».

## 1. Before

A company had exactly one «Ответственный» (`client.responsible_user_id`, migration `0029`). The org owner set it; the responsible member who is not an owner could only «Передать владельцу». About 20 places read that one column.

## 2. Decision

- **Main responsible** stays: `client.responsible_user_id`, with all its current rules (owner assigns, handover to the owner).
- **Additional responsible members** («Также отвечают»): any number of human, not banned members of the org, in a new table `client_co_responsible` (org, client, user, `added_by_user_id`, `created_at`; one row per company + member; deleted with the company or the user).
- **Who changes them:** the org owner adds and removes anyone. An additional member can remove themselves. The main responsible member cannot be an additional one. When the owner makes an additional member the main one, that member leaves the additional list.

## 3. Where they count

| Place | Main | Additional |
|---|---|---|
| Companies filter «Мои» / by member (`/clients`) | ✓ | ✓ |
| Edit «Профиль компании» (`client-profile.ts`) | ✓ | ✓ |
| Bind / unbind Telegram chats of the company (`telegram/chats.ts`) | ✓ | ✓ |
| AI chat: filter «ответственный» + record detail («Также отвечают») | ✓ | ✓ |
| «Передать владельцу» (handover) | ✓ | — |
| Deal owner (`resolveDealOwner`), topic owner (attention), notifications (handover, contact / Telegram proposals), statistics dimension | ✓ | — |

Why main only in the last rows: these need exactly ONE person (one owner, one recipient). Changing that is a later decision.

## 4. API and UI

- `PUT /api/clients/[id]/responsible` `{ action: "addCoResponsible" | "removeCoResponsible", userId }` (the other actions unchanged). Errors in Russian: 403 not owner / not themselves, 400 the main one / already added / not a member.
- Company rows (`ClientRow`, `ClientDetail`) carry `coResponsible: [{ userId, name }]`.
- `<ClientResponsibleField>` (drawer and company page): row «Также отвечают: Анна ×, Пётр × [+ Добавить]» — the owner sees ✕ and «+ Добавить»; an additional member sees ✕ only on their own chip («Снять с себя»); others see the names. Company card and table: «Ответственный: X · также Y, Z».

## 5. Checks

- Unit tests `src/lib/client-responsible.test.ts` (rules, modes, filters) — 17 / 17.
- Live round trip on the test DB (2026-11-19): add → read with names → second add refused → assign as main removes the extra row; test data removed.
- `tsc` 0, `pnpm test` 988 / 988, lint 0.

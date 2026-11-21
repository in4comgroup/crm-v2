# Bug fixing — tester feedback round 2026-11-21

Feedback of the IN4COM pilot tester (sheet [TODO.xlsx](TODO.xlsx), tab «Баги»), fixed item by item with the product owner, plus the product owner's changes of the same day. Column K «Комментарий разработчика» of the sheet holds the answer to the tester for items 7, 9, 13, 14, 16, 19, 21, 23.

Status: **built 2026-11-21, not deployed.** Tester items committed (commits `b2a83df` … `43a1e04`); the product owner changes below are not committed yet at the time of writing. All unit tests pass (1015), types + lint clean. One migration: `0050_contact_name_native_required` — **apply AFTER the code is deployed** (`docs/todo/README.md` D9). Test DB data changes: 2 wrong automatic document links deleted (#16), 2 automatic links added by the normal rules (#19).

## Tester items

| # | Area | Problem | Decision / change | Where |
|---|---|---|---|---|
| 1, 10 | Home, card | «Принять» unclear | Button renamed «Создать задачу»; one toast «Задача создана»; badge «Принята» stays | `topic-card.tsx`, `dashboard-card.tsx`, `card-detail-shell.tsx` |
| 24 | Card → task | Contact, deal, type, assignee empty | Prefill: company, contact (topic's, else newest on its items — `TopicEntry.taskContactId`), the topic's deal, type by meaning (`suggestTaskType`, shared with the AI chat's `taskTypeFromTitle`), assignee = the creator (`GET /api/tasks?members=1` → `currentUserId`); contact options also by `contact_company_link` | `src/lib/tasks/suggest-task-type.ts`, `src/lib/cards/task-prefill.ts`, `form-task-edit.tsx`, `src/server/tasks.ts` |
| 3 | Home, «Мои» | maslov cards not hidden | Server filter correct (verified as both Margarita accounts); the list kept old cards for seconds — a list loaded for other filters is never shown now (loader). Data note: Margarita has two accounts (old gmail = 43 companies); product owner: keep as is | `topic-lists-section.tsx` |
| 4 | Home | «Темы / История карточек» | Switch + history removed in topics mode `on`; old cards stay reachable from search (`/cards/[id]`) and the AI chat; in `off` / `shadow` the old feed stays | `dashboard/page.tsx` |
| 7 | Home, status filter | «Не относится» — topic or card status? | Topic status. Decision A: «Отклонить» with the reason «Не относится к работе» also closes the topic as «Не относится» (hint in the dialog); other reasons change only the card. Status table in `docs/docs/modules.md` | `closesTopicOnReject` (`src/lib/topics/cards.ts`), `rejectCard` |
| 9 | Home, status filter | «Открытые» vs «Открыта» | One value «Открытые» (= open + dormant); «Открыта» alone removed | `topic-lists-section.tsx` |
| 13 | Company drawer | «Этап воронки» wrong stages | It was a legacy manual field with a fixed list, not the funnel. Decision A: read-only stages of the company's deals (`listClientDealStages`, `GET /api/deals?clientStages=`); manual field removed from the UI (column kept) | `client-funnel-stages.tsx`, drawer, `/clients/[id]`, edit form |
| 14 | Companies toolbar | «Обогатить» = slow, costly, uncontrolled | Button removed; «На проверке (N)» stays; batch API stays without UI | `client-enrich-control.tsx` |
| 16 | Company «Документы» | Wrong contact (person in copy) | Rule A1: sender always; recipients only of our outgoing mail; on inbound mail a copy only from the sender's company / mail domain (medium) — `messageParticipants`. 2 wrong links deleted. The real sender was not a contact | `src/lib/documents.ts`, `src/server/documents.ts` |
| 19 | «Документы» | «Включая сделки и контакты» → everywhere | Switch on every entity (contact: deals + tasks; deal: contacts + tasks; task: its deal; order: its company). Plus A1b: the sender's company by mail domain (medium, `clientsBySenderDomain`). Fixed: the list always looked «loading» | `viewRefs`, `documents-panel.tsx` |
| 21 | «Поиск в интернете» | English warning, wrong company | Note + «почему подходит» in Russian; note shown as neutral «Примечание поиска»; a name-only match is at most «medium» (never auto-applied). The ОРИКС messages come from `orexc.ru` — the tester's result was right | `client-enrichment.ts`, `client-lookup-dialog.tsx` |
| 22 | — | Empty row | Skipped (no text) | — |
| 23 | Topics | «Готово» never archived | «Готово» → «В архиве» 14 days after closing, like «Решена»; checks never reopen an archived «Готово» topic (`closedByUser`) | `lifecycle.ts`, `topic-store.ts`, `checks/store.ts` |

## Product owner changes (same day)

| Change | Where |
|---|---|
| Company name edited in the drawer header: pencil + border on hover / focus, «Сохранить» / «Отмена» next to a changed name | `client-detail-drawer.tsx` |
| «Поиск в интернете» result: per-field undo «Было: … · вернуть», «Найдено: … · применить» for any field that differs | `client-lookup-dialog.tsx` |
| «Профиль компании»: «Убрать» an unconfirmed automatic value; `field_meta.removedKey` stops the next web fill from writing the same value | `client-profile.ts` (`removeClientProfileField`), `POST api/clients/[id]/profile { action: "remove" }`, `client-profile-block.tsx` |
| Contact «Имя на родном языке» required, default = the name (form copies the name; server on create / update / discovery; migration `0050` backfill + NOT NULL) | `form-contact-edit.tsx`, `contacts.ts`, `discovery.ts`, `schema.ts` |
| Topic cards show «Источники»: the newest ≤ 3 messages, click opens the message, «ещё N» opens the topic panel | `topics-user.ts` (`loadEntrySources`), `topic-card.tsx` |

## Open

- The web lookup does not use the mail domains of the company's message senders as a hint (would find `orexc.ru` for ОРИКС by name only) — offered, not decided.
- The deal drawer name has the same «invisible input» look as the company name had — offered, not decided.

| File | Content |
|---|---|
| [TODO.xlsx](TODO.xlsx) | The tester's sheet with the developer comments (column K) |

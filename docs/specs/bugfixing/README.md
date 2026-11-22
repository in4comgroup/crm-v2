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

## Follow-up 2026-11-22 — item 3 again («Мои» hides ОРИКС)

Tester: with «Мои» on Home, maslov.agency (Boris) hides — correct — but ООО «ОРИКС» (hers) hides too, «with both accounts».

- «Мои» on Home filters TOPICS: assignee (`topic.owner_user_id`) or the linked deal's owner — not the company list. The ОРИКС topic «ОРИКС — новый контакт» is assigned to the OLD account `amalitskaya@…gmail` (the company's «Ответственный» is that account too: on 2026-11-21 the new account picked «Маргарита Амалицкая» in the list, which shows both accounts under the same name). Checked with the real query: the gmail account sees ОРИКС under «Мои» («Все темы»); the in4comgroup account does not. The gmail account has no sign-in since 2026-09-04, so the «both accounts» test was in fact one account.
- The topic is «Затихла» → only on «Все темы», never on «Сейчас» / «Сводка» / «Неделя», with or without «Мои».
- Code gap found and fixed: a company «Ответственный» change did not move its topics (the assignee is filled once). Now `reassignClientTopicsOwner` moves the topics assigned to the previous responsible / to nobody (`client-responsible.ts`, `topic-store.ts`; journal line «(сменился ответственный за компанию)»).
- Member pickers («Ответственный», «Также отвечают», «Передать владельцу», the Companies filter) show the email when two members share a name (`memberLabel`).
- Data not changed: ОРИКС stays on the gmail account. For the tester to see it under «Мои», the owner sets ОРИКС «Ответственный» = the in4comgroup account (the topic follows now), or the two accounts are merged (product owner decision, open).

## Follow-up 2026-11-22 — item 24 again («Исполнителя не подставляет»)

Reproduced in the local app (Home → topic card → «Создать задачу»): «Исполнитель» stayed empty. Cause: the form sets the default (the creator) in the SAME render as the member list arrives; Radix Select's hidden native `<select>` then fires a change with "" (the option is not there yet), and that cleared the value. Fix: the «Исполнитель» Select mounts again when the members arrive (`key`), so it starts with the value and sends no change (`form-task-edit.tsx`). Checked: the dialog now shows the creator. Same form for every «Создать задачу» (topic card, card page, old card feed, company / deal / tasks pages).

## Follow-up 2026-11-22 — item 16: Кондрашева and Чехомова not created as contacts

Tester: the document came in a mail from Евгения Кондрашева (corporate address), Анна Чехомова in copy — why are they not contacts of maslov.agency?

- By design, contacts from mail are created ONLY by «Найти в источниках» (Companies → preview → «Применить»), never at sync / parse. In IN4COM none of the 10 mails of this thread was ever scanned (`discovery_scanned_at` empty); maslov.agency has 0 contacts. Discovery finds both people (high confidence, 10 and 9 mails).
- But the preview would have linked BOTH to a junk new company «Google Calendar» (from a calendar invite) instead of the existing maslov.agency — three defects in `src/server/discovery.ts`, fixed with `src/lib/discovery-pick.ts` (tests): link tie-break was alphabetical (now an existing company wins); the weak website rule gave «Google Calendar» the domain maslov.agency (now never a domain an existing company owns); the native name took the longest spelling (now Cyrillic first, then the most frequent).
- Checked with the read-only preview on the test DB: both now → existing «maslov.agency» (high, not ambiguous), Кондрашева native «Евгения Кондрашева»; «Google Calendar» = low, no website (unticked). Nothing was applied — the tester runs «Найти в источниках» after the deploy.

## Follow-up 2026-11-22 — item 16 for ОРИКС: files linked to «Павел Подкорытов»

Tester: in the ОРИКС drawer → «Документы» both files (uploaded by her) are linked to the contact Павел Подкорытов; there must be no contact link.

- Cause: rule A3 linked a contact NAMED in the file content («авто · упомянут в документе», medium). Both files name him among many people: `image.png` (AI chat — a staff table, 12 names) and «Орикс_интервью с Кристиной.docx» (14 names). He was the only one of them who was a contact when the links were made; with more contacts each file would link to all of them.
- Change: A3 now links only COMPANIES named in a file; people named in a file are never linked (`planAutoLinks` in `src/lib/documents.ts`, `computeAutoLinks` in `src/server/documents.ts`, spec `docs/specs/attachments/01-specification.md` A3). A contact gets a file as a sender / recipient (A1) or through a topic (A2), or by hand.
- Test DB: the 2 links deleted (the only contact links of this rule in the DB). The upload link of the docx to ОРИКС stays.

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

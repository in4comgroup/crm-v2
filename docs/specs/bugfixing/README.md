# Bug fixing — tester feedback rounds 2026-11-21 … 2026-11-26

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

## Product owner change 2026-11-24 — status filter of «Все темы» (replaces item 9)

| Change | Where |
|---|---|
| New filter values, in this order: «Открыты» (`open`, default), «Затихли», «Истекли», «Все» (not merged), «Закрыты» (resolved + done), «В архиве», «Ошибочные» (dismissed + topics whose LATEST topic card is rejected, any reason). Old / unknown value → «Открыты». «Ошибочные» overlaps the status values (a rejected-card topic stays e.g. «Открыты») | `TOPIC_STATUS_FILTERS` (`src/lib/topics/topic-ui.ts`), `allStatusCondition` (`src/server/topics-user.ts`), `topic-lists-section.tsx` |

## Product owner change 2026-11-24 — automatic processing of sources (tester: «Найти в источниках» only by button)

Before: sync + parse ran automatically per source («Авторазбор», owner on Sources → «Управление», admin on /settings → «Источники»); companies / contacts were created ONLY by the button. Now (the button stays):

| Change | Where |
|---|---|
| Org setting `discovery.autoApply` «Создавать компании и контакты автоматически» (default off). After the daily parse and the hourly topics intake parse, the dialog's default choice is applied as «Агент», «Ответственный» = org owner, one notification to the owner | `src/server/discovery-auto.ts`, `discovery-core.ts` (org-explicit split of `discovery.ts`), `src/lib/discovery-default-pick.ts` (shared with the dialog), `daily-pipeline.ts`, `topics/intake.ts` |
| Owner: card «Автоматическая обработка» on Sources → «Управление» | `auto-discovery-switch.tsx`, `api/sources/auto-discovery` |
| Platform admin: block «Автоматическая обработка» on /settings → «Источники» (per org: «Авторазбор» N of M sources, the switch, «Запустить сейчас») | `admin-auto-processing.tsx`, `api/admin/sources/auto-processing` |

Dry run on the test DB (2026-11-24, preview only, nothing written): the first automatic run would create in IN4COM 10 of 26 company candidates, 9 contacts, 9 links; in salesdaily 28 of 49, 25, 19. The switch is off in both orgs.

## Tester item 2026-11-24 — «Компании» → company panel: no way to edit the name

Already built 2026-11-21 (product owner change above, commit `74111d0`, not deployed at that time): the name in the panel header is a field — hover shows a border, a pencil and the hint «Нажмите, чтобы изменить название»; a changed name gets «Сохранить» / «Отмена» next to it (`client-detail-drawer.tsx`). Every company panel (Companies, contact panel, task panel) is this one drawer. No code change; the tester needs a deployment with `74111d0` or later.

## Product owner change 2026-11-24 — reject reasons of a topic card (Home → card → «Отклонить»)

| Change | Where |
|---|---|
| New list, in this order: «Ошибка в фактах карточки», «Неправильно определены клиент или контакт» (was «Не тот клиент или контакт»), «Неверная важность», «Полностью нерелевантно» (was «Не относится к работе» — same code `not_relevant`, still closes the topic as «Не относится»), «Дубликат» (was «Дубликат другой карточки»), «Другое». «Уже сделано» and «Не сейчас» removed for topic cards (the server refuses them; stored cards keep their labels; deal cards keep «Не сейчас»). Renamed labels apply to every card kind | `src/lib/topics/cards.ts`, `rejectCard` (`src/server/cards.ts`) |

## Tester round 2026-11-26

Commits `2289012` («bugfixing 42-47») and `dd72b91` («bugfixing 48-73»), the last fix after them. Migrations `0052`–`0055`, all applied on the test DB (deploy: `docs/todo/README.md` D10). Unit tests 1062 pass; types (2 older errors in other files) and lint clean; no browser check (the browser extension was not connected).

| Area | Problem (tester) | Decision / change | Where |
|---|---|---|---|
| Company → «Профиль компании» | «Заполнить из интернета» filled the profile, not the website / contacts; «Сохранить» disabled although the data was saved | The one match (not `low`) also fills EMPTY website / e-mail / phone / address (never overwrites); the drawer re-reads the company; toast «Данные из интернета сохранены» with the filled fields | `client-enrichment.ts` (`contactFilled`), `client-profile-block.tsx` (`onClientChanged`) |
| Company / deal / «Поля» | «Сохранить» disabled after the data saved itself | Disabled only while saving; with nothing changed a click says «Изменений нет — всё уже сохранено» | `client-detail-drawer.tsx`, `deal-detail-drawer.tsx`, `custom-fields-tab.tsx` |
| Company, «Тип компании» | Company with a deal «До воронки» kept «Не определено (по сделкам)», label unclear | The derived relation was already right (tab «Потенциальные»); the option is now «Автоматически по сделкам» and shows the value: «Автоматически по сделкам: Потенциальный» (`relationFromDealStages`, one request with «Этап воронки»). The manual tag is never written automatically | `client-funnel-stages.tsx`, drawer, `form-client-edit.tsx` |
| «Поля» | Only «ИНН» by default — how to get default fields? | Standard fields as COLUMNS for every org: company «Реквизиты» + «Банковские реквизиты» with format checks, contact «День рождения»; top of «Поля», one «Сохранить»; the old «ИНН» custom field → `client.inn` (6 values) and archived | [clients-contacts/10](../clients-contacts/10-standard-fields.md), `0052`, `0053` |
| Companies / contacts, «Статус» | How does «Новая» become «Активная»? | A person's save with a change confirms it: `initial` → `active` (main form, «Поля», «Профиль компании»); an explicit other status wins; automatic processes never | `src/lib/entity-status.ts`, `src/server/entity-status.ts` |
| Tasks, create | «Просрочена» from 03:00; no time for the deadline; default 23:59, settable per client org | Date + time in the form; org setting «Срок задачи по умолчанию» (23:59) in «Рабочий контекст»; deadlines entered and shown in the ORG time zone everywhere; old date-only tasks → 23:59 org time | [organization/01](../organization/01-switcher-invitations-working-context.md) §3.1, `src/lib/org-time.ts`, `0054` |
| Home, cards | Card «Сейчас» on a contact's birthday | Topics CRM check `contact_birthday` → process code `CONTACT_BIRTHDAY` (weight 8 = P8 = «Сейчас», no daily limit), check group «Контакты» on by default; the topic closes the next day | [topics/03](../topics/03-development-plan.md) phase 8, [topics/05a](../topics/05a-signals-base-a-g.md) block G, `0055` |
| Company card | Renamed «AST – …» to «AST», saved — not saved | Caused by the «Сохранить» change of this round: react-hook-form updates `isDirty` only when it is read during render; the button no longer read it, so the save handler saw «no changes» and sent nothing. Both drawers now read `isDirty` (deal: also `dirtyFields`) during render. The tester renames again after the deploy | `client-detail-drawer.tsx`, `deal-detail-drawer.tsx`; rule in `src/app/AGENTS.md` |

## Tester item 2026-11-27 — «Найти в источниках»: maslov.agency people created without the company

- Евгения Кондрашева and Anna Chekhomova (`@maslov.agency`) were created at 08:42 UTC with no company; a person linked them by hand at 08:57. The company profile is not the cause (discovery never reads it).
- Cause: the existing company `maslov.agency` had NO website at the scan. The domain rule found only the new candidate «maslov:agency» (website from the mails) and linked the people to it. The candidate was a possible duplicate of `maslov.agency`, so it was unticked and not created (apply only folded its spellings + website into the existing company), and apply dropped the links to it with no message.
- Fix (`src/server/discovery-core.ts`, pure `duplicateLinkTarget` in `src/lib/discovery-pick.ts`, tests): in the preview a candidate flagged `possibleDuplicate` of a live company stands for THAT company in the link proposals (its website still counts); on apply a link to a candidate that was not created but is such a duplicate goes to the existing company (safety net for an older preview). `rankDomainMatches` counts one company once (its own website + the duplicate's website). An operator who ticks the duplicate candidate (creates a separate company) still gets the link to the existing company — change it by hand.

## Deal drawer — title editing

Company and deal drawers share the same inline title editor. A pencil next to the title indicates the editable field. Changing the title shows the save and cancel icons in the header.

## Open

- The web lookup does not use the mail domains of the company's message senders as a hint (would find `orexc.ru` for ОРИКС by name only) — offered, not decided.
- Other dates (order dates, change history, documents, «создано») are still shown in the browser's time zone, not the org's — offered 2026-11-26, not decided.
- Test org salesdaily (`Fv60…`) has no `base` signal pack switched on, so no signals / topics (also no birthday cards) there.

| File | Content |
|---|---|
| [TODO.xlsx](TODO.xlsx) | The tester's sheet with the developer comments (column K) |

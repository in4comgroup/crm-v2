# Topics — signals: agency pack (N1 PITCH, N2 PROSPECT, N3 Аккаунт, N4 Риски)

Status: draft for review · 2026-11-11 · seed data for the registry (spec §4)

## Sources

This file is the seed for the `agency` pack (second pilot, the Maslov communications / marketing agency, Q29). Inputs: `Сигналы_Маслов_каталог_и_правила.docx` (Maslov catalog, version 2026-11-02: §1 catalog, §2 definitions, §3 funnel, §4 risks, §5 card rules, appendices); [02-open-questions-answers.md](02-open-questions-answers.md) Q24; [01-specification.md](01-specification.md) §2, §4.2, §4.3, §5.6, §7.3, §8.1, §9.2, §9.4; [Описание требований - v2.md](Описание%20требований%20-%20v2.md) (roles, scenarios, risk texts); [02-open-questions.md](02-open-questions.md) Q28, Q29, Q34; the Truffalo v204 export in `truffalo-logic-2026-11-10-10-05/` for base-code kinds and statuses. Conflict rule: **Q24 wins over Maslov** (Q28). Each entry that follows Q24 instead of Maslov says so. Applied Q24 rules: N7 profile removed; `PROSPECT_CONTENT_INTEREST` = 3 · W1, `PROSPECT_NEED_EXPRESSED` = 7 · P6 · `new_biz` (Q24-1); `PROSPECT_CONTACT_MOVED` = chance 5 · D4 (Q24-2); «Затягивание решения» from the 2nd distinct postponement (Q24-3); W1 expiry and P6 repeat cap are engine parameters (Q24-4, Q24-5, spec §8); trend list with D4 ceiling (Q24-6); **no go / no-go and no senior-team routing anywhere** (Q24-7, Q28) — every Maslov «go/no-go» action is rewritten as «решение об условиях дальнейшего участия», and the agency's own stop is the deal outcome `withdrawn`, set only by a user; blocks H and J parked for this pack (Q24-8); forecast uses the opportunity owner's win estimate (Q24-9); renewal = stage 4 only under the three Q24-10 conditions; no-response rules from Q24-11; no limit on codes per message (Q24-12). Area 0 «Контакт до запроса» is not a deal stage: the engine never creates a deal there (Q34). Maslov weights of the 19 PITCH codes are provisional (Maslov §1 note); weights of the other 43 new codes are Maslov proposals. Process thresholds that no source gives are proposed here and listed in Open points.

**Count check:** N1 PITCH = **19** codes, N2 PROSPECT = **10**, N3 Аккаунт = **15**, N4 Риски = **18** → **62** new codes, all with a full entry. Deal-risk types: **26**. Base overrides: 85 codes listed one by one + 46 codes of blocks H (40) and J (6) as parked groups = all 131 v195 codes, plus 3 v204-only codes.

Conventions used in this file:
- Agency funnel stages (org configuration, Q21): **S1** «Новая возможность», **S2** «Запрошены материалы или решение», **S3** «Финальный выбор», **S4** «Выбраны», **S5** «Заказ подтверждён». Area 0 is a relationship area (topics on the client or contact, no deal).
- Deal types used by the stage rules: `new_business`, `incremental`, `re_pitch`, `renewal` (Maslov §3: «новая продажа, incremental или re-pitch» + the renewal opportunity of §3.3).
- Stage (pack default) = `active` for all 62 new codes. IN4COM = `n/a`: the agency pack is off for IN4COM (spec §4.3).
- Maslov flags: «Прямой запрос / Запрос от клиента» → asks us = yes; «Сумма при наличии» → amount = yes. Effort: Быстрая → quick, Средняя → medium, Сложная → complex.
- Recipient roles: Питч → `opportunity`, Связь → `relationship`, Аккаунт → `account`, Финансы → `finance`, New biz → `new_biz`, Команда → `team`. Routing by role is a separate task (Q33); the field is stored now.

## N1 · PITCH

Pitch and choice of the agency for one concrete opportunity (Maslov §2.1). All codes act only on a topic of a concrete selection or project; general interest without a task stays in area 0.

| Code | Название (RU) | W | Class | Kind | Score rule | Effort | Asks us | Inbound only | Amount | Stage (pack) | IN4COM | Profile | Recipient | Family |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `PITCH_CREDENTIALS_REQUESTED` | Запрошены квалификационные материалы | 4 | chance | event | fixed | medium | yes | yes | no | active | n/a | D4 | opportunity | pitch |
| `PITCH_QUALIFIED` | Агентство прошло квалификацию | 5 | chance | event | fixed | quick | no | yes | no | active | n/a | D4 | opportunity | pitch |
| `PITCH_SOLUTION_REQUESTED` | Запрошено индивидуальное решение | 6 | chance | event | fixed | complex | yes | yes | yes | active | n/a | P6 | opportunity | pitch |
| `PITCH_SHORTLISTED` | Агентство вошло в шорт-лист | 7 | chance | event | fixed | quick | no | yes | no | active | n/a | P6 | opportunity | pitch |
| `PITCH_FINAL_TERMS_DISCUSSION` | Обсуждаются актуальные объём и цена | 7 | chance | event | fixed | medium | yes | yes | yes | active | n/a | P6 | opportunity | pitch |
| `PITCH_VERBAL_SELECTION` | Клиент устно выбрал агентство | 8 | chance | event | fixed | medium | no | yes | no | active | n/a | P8 | opportunity | pitch |
| `PITCH_OFFICIAL_AWARD` | Получено официальное уведомление о победе | 9 | chance | event | fixed | medium | no | yes | yes | active | n/a | P8 | opportunity | pitch |
| `PITCH_BRIEFING_ACCEPTED` | Клиент согласовал содержательный брифинг | 4 | chance | event | fixed | quick | yes | yes | no | active | n/a | D4 | opportunity | pitch |
| `PITCH_BUYER_ACCESS_GRANTED` | Предоставлен доступ к участнику решения | 5 | chance | event | fixed | quick | no | yes | no | active | n/a | D4 | opportunity | pitch |
| `PITCH_BUYER_ACCESS_DECLINED` | Клиент отказал в доступе к заказчику | 6 | risk | event | fixed | medium | no | yes | no | active | n/a | P6 | opportunity | pitch |
| `PITCH_TEAM_INTRO_REQUESTED` | Клиент запросил знакомство с командой | 4 | chance | event | fixed | medium | yes | yes | no | active | n/a | D4 | opportunity | pitch |
| `PITCH_DEFENSE_INVITED` | Клиент пригласил на защиту решения | 5 | chance | event | fixed | complex | yes | yes | no | active | n/a | D4 | opportunity | pitch |
| `PITCH_REVISION_REQUESTED` | Запрошена существенная доработка | 5 | chance | event | fixed | complex | yes | yes | yes | active | n/a | D4 | opportunity | pitch |
| `PITCH_REQUIREMENTS_CHANGED` | Изменились требования или процедура отбора | 6 | risk | event | fixed | medium | yes | yes | yes | active | n/a | P6 | opportunity | pitch |
| `PITCH_SELECTION_CRITERIA_DISCLOSED` | Клиент раскрыл критерии выбора | 4 | fyi | event | fixed | quick | no | yes | no | active | n/a | D4 | opportunity | pitch |
| `PITCH_DECISION_DELAYED_BY_CLIENT` | Клиент перенёс дату решения | 5 | risk | event | fixed | quick | no | yes | no | active | n/a | D4 | opportunity | pitch |
| `PITCH_EXCLUDED` | Агентство исключено или проиграло | 7 | risk | event | fixed | quick | no | yes | no | active | n/a | P6 (once) | opportunity | pitch |
| `PITCH_CANCELLED_BY_CLIENT` | Клиент отменил отбор или проект | 6 | risk | event | fixed | quick | no | yes | no | active | n/a | P6 (once) | opportunity | pitch |
| `PITCH_PAUSED_BY_CLIENT` | Клиент явно приостановил возможность | 4 | risk | event | fixed | quick | no | yes | no | active | n/a | D4 (snoozed) | opportunity | pitch |

### `PITCH_CREDENTIALS_REQUESTED` — Запрошены квалификационные материалы

| Field | Value |
|---|---|
| Pack · block · family | agency · N1 · pitch |
| Weight · class · kind · score rule | 4 · chance · event · fixed |
| Effort · asks us · inbound only · amount | medium · yes · yes · no |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (D4) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: `SALES_OFFER_SENT` (наши материалы отправлены) |
| Relations | outranks `SALES_CATALOG_REQUESTED` and `SALES_MATERIAL_REQUESTED` when it is the same request for a concrete selection (Maslov §3: the PITCH code is more precise) |
| Date gate | — (the due date of the materials goes to facts.deadlines) |
| Relevance window | default |
| Deal effect | create_deal at S2 «Запрошены материалы или решение» when the request names a concrete selection or project and the client has no open deal (proposal card, see the stage-rule template); enter_stage S2 from S1 |

**Определение:** Клиент в рамках конкретного отбора или проекта просит прислать кейсы, портфолио, креденшиалс, анкету участника, квалификационные документы или ответить на RFI. Запрос привязан к конкретной задаче или закупке.

**Граница (не считается):** Общая просьба «пришлите информацию об агентстве» без конкретной задачи или отбора остаётся в области 0 (→ `SALES_CATALOG_REQUESTED` или нет сигнала). Запрос концепции или решения по брифу — `PITCH_SOLUTION_REQUESTED`. Запрос цены — `SALES_PRICE_REQUEST`.

**Признаки для промпта (≤ 8):** «пришлите кейсы для отбора», «креденшиалс», «заполните анкету участника», «RFI», «предквалификация», «портфолио по похожим проектам», «квалификационные документы», «для участия в тендере нужны»

**Синонимы и выражения (полный список):**
- Деловая переписка: «просим направить кейсы по аналогичным проектам», «просим предоставить портфолио агентства для участия в отборе», «необходимо заполнить анкету участника конкурса», «направляем запрос информации (RFI)», «для прохождения предквалификации просим предоставить», «просим приложить рекомендательные письма от клиентов», «требуется справка об опыте выполнения аналогичных работ», «просим направить презентацию агентства с релевантными кейсами в срок до»
- Чаты / мессенджеры (разговорный стиль): «скиньте кейсы под наш тендер», «киньте креды, покажу руководству», «есть что-то похожее по автомобильной категории?», «нужна ваша презентация с кейсами, у нас отбор», «пришлите портфолио до пятницы, плиз», «заполните анкетку для закупок»
- Сокращения и термины: «RFI», «креды», «креденшиалс», «credentials», «кейсбук», «анкета участника», «предквал», «лонг-лист», «тендерная документация»
- Устойчивые конструкции / маркеры: «пришлите / направьте / предоставьте» + «кейсы / портфолио / креденшиалс / анкету»; «для участия в отборе / тендере / конкурсе нужны»; «по нашему проекту» + «кейсы»

**Похоже, но не это (анти-признаки):** «пришлите презентацию агентства, познакомимся» без проекта → `SALES_CATALOG_REQUESTED` или нет сигнала; «подготовьте концепцию по брифу» → `PITCH_SOLUTION_REQUESTED`; «пришлите прайс на услуги» → `SALES_PRICE_REQUEST`; «вы прошли предквалификацию» → `PITCH_QUALIFIED`; «у нас есть сомнения, был ли у вас такой опыт» → `PITCH_EXPERTISE_DOUBTED`.

**Пример (evidence):** «Добрый день! Мы запускаем отбор PR-агентства на 2027 год. Пришлите, пожалуйста, до 20 ноября кейсы по FMCG и заполненную анкету участника из вложения.»
**Контрпример:** «Познакомились с вами на конференции, пришлите при случае презентацию агентства» → нет конкретного отбора или задачи, это область 0 (`SALES_CATALOG_REQUESTED` или нет сигнала).

**Заметка для карточки:** Pitch lead подбирает релевантные кейсы под задачу отбора и подтверждает клиенту срок отправки материалов.

### `PITCH_QUALIFIED` — Агентство прошло квалификацию

| Field | Value |
|---|---|
| Pack · block · family | agency · N1 · pitch |
| Weight · class · kind · score rule | 5 · chance · event · fixed |
| Effort · asks us · inbound only · amount | quick · no · yes · no |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (D4) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: next step agreed (`PITCH_SOLUTION_REQUESTED`, `PITCH_BRIEFING_ACCEPTED`, `PITCH_SHORTLISTED`) or an outcome |
| Relations | both with `PITCH_CREDENTIALS_REQUESTED` (context of the same selection) |
| Date gate | — |
| Relevance window | default |
| Deal effect | in_stage S2 (qualification inside S2; no automatic move to S3) |

**Определение:** Клиент прямо подтверждает, что агентство прошло квалификационный допуск отбора: допущено ко второму этапу, включено в лонг-лист, прошло предквалификацию. Факт сообщает клиент или тендерная площадка от его имени.

**Граница (не считается):** Наше собственное мнение, что мы соответствуем требованиям, не считается. Прохождение квалификации не равно шорт-листу или финалу (→ `PITCH_SHORTLISTED`). Получение подтверждения, что документы приняты к рассмотрению, — нет сигнала.

**Признаки для промпта (≤ 8):** «прошли предквалификацию», «допущены ко второму этапу», «вошли в лонг-лист», «ваша заявка допущена», «прошли квалификационный отбор», «приглашаем на следующий этап», «соответствуете требованиям отбора»

**Синонимы и выражения (полный список):**
- Деловая переписка: «по итогам квалификационного отбора ваша компания допущена к участию», «уведомляем о прохождении предквалификации», «ваша заявка признана соответствующей требованиям», «агентство включено в список допущенных участников», «по результатам рассмотрения документов вы допущены ко второму этапу», «приглашаем вас принять участие в следующем этапе отбора»
- Чаты / мессенджеры (разговорный стиль): «вы прошли первый этап», «вас допустили, ждите бриф», «вы в лонг-листе», «закупки вас пропустили дальше», «квалификацию прошли, поздравляю», «по документам всё ок, вы дальше»
- Сокращения и термины: «предквал», «лонг-лист», «long list», «квалификационный этап», «допуск», «второй тур», «протокол рассмотрения заявок»
- Устойчивые конструкции / маркеры: «допущены / прошли / включены» + «к этапу / в лонг-лист / в список участников»; «по итогам рассмотрения заявок»

**Похоже, но не это (анти-признаки):** «вы в шорт-листе», «вы в финале» → `PITCH_SHORTLISTED`; «документы получили, рассматриваем» → нет сигнала; «пришлите анкету для предквалификации» → `PITCH_CREDENTIALS_REQUESTED`; «по итогам отбора вы не прошли» → `PITCH_EXCLUDED`.

**Пример (evidence):** «Коллеги, по итогам рассмотрения заявок ваше агентство допущено ко второму этапу отбора. Бриф направим до конца недели.»
**Контрпример:** «Спасибо, ваши материалы получили, передали в закупки на рассмотрение» → это подтверждение получения, а не допуск; нет сигнала.

**Заметка для карточки:** Pitch lead уточняет у клиента следующий шаг и условия следующего этапа отбора.

### `PITCH_SOLUTION_REQUESTED` — Запрошено индивидуальное решение

| Field | Value |
|---|---|
| Pack · block · family | agency · N1 · pitch |
| Weight · class · kind · score rule | 6 · chance · event · fixed |
| Effort · asks us · inbound only · amount | complex · yes · yes · yes |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (P6) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: `SALES_OFFER_SENT` (решение представлено) |
| Relations | leads over `SALES_MATERIAL_REQUESTED` (Maslov §5.5: one card, the PITCH code leads); both with `SALES_TENDER_INVITATION`; outranks `SALES_OFFER_REQUESTED` for the same request |
| Date gate | — (the date of the presentation goes to facts.deadlines) |
| Relevance window | default |
| Deal effect | create_deal at S2 «Запрошены материалы или решение» (concrete task, no open deal); enter_stage S2 from S1 |

**Определение:** Клиент передаёт конкретную задачу (бриф) и просит подготовить индивидуальное решение: креативную концепцию, стратегию, коммуникационную платформу, подход, механику или тестовое задание. Решение готовится под эту задачу, а не берётся готовым.

**Граница (не считается):** Стандартный прайс (→ `SALES_PRICE_REQUEST`), готовая презентация агентства или кейсы (→ `PITCH_CREDENTIALS_REQUESTED`), наша собственная инициатива подготовить идеи без запроса — не этот код. Доработка уже представленного решения — `PITCH_REVISION_REQUESTED`.

**Признаки для промпта (≤ 8):** «направляем бриф», «подготовьте креативную концепцию», «ждём стратегию», «тестовое задание», «предложите подход», «коммуникационная платформа», «механика кампании», «презентация решения до»

**Синонимы и выражения (полный список):**
- Деловая переписка: «направляем бриф на разработку коммуникационной стратегии», «просим подготовить креативную концепцию и предварительную смету», «просим представить предложение по подходу к задаче», «в рамках конкурса участникам необходимо выполнить творческое задание», «ждём от вас концепцию запуска к указанной дате», «просим предложить механику промо-кампании», «необходимо разработать коммуникационную платформу бренда»
- Чаты / мессенджеры (разговорный стиль): «скинула бриф, посмотрите», «нужна большая идея под запуск», «накидайте креатив до четверга», «сделаете тестовое?», «ждём от вас подход и примерную смету», «нужна стратегия на год, бриф во вложении», «покажете идеи на следующей неделе?»
- Сокращения и термины: «бриф», «креатив», «big idea», «КП с концепцией», «тестовое задание», «творческое задание», «стратегия», «механика», «KV», «tone of voice», «коммуникационная платформа»
- Устойчивые конструкции / маркеры: «подготовьте / разработайте / предложите» + «концепцию / стратегию / подход / механику / креатив»; «по брифу» + «ждём»; «в рамках тендера» + «творческое задание»

**Похоже, но не это (анти-признаки):** «пришлите кейсы и анкету» → `PITCH_CREDENTIALS_REQUESTED`; «пришлите прайс на ведение соцсетей» → `SALES_PRICE_REQUEST`; «переделайте концепцию, уберите второй вариант» → `PITCH_REVISION_REQUESTED`; «приглашаем к участию в тендере» без задания → `SALES_TENDER_INVITATION`; «пришлите КП на стандартный пакет» → `SALES_OFFER_REQUESTED`.

**Пример (evidence):** «Направляем бриф на запуск нового вкуса. Просим подготовить креативную концепцию и предварительную смету, защита 3 декабря.»
**Контрпример:** «Пришлите, пожалуйста, вашу стандартную презентацию услуг и прайс» → готовые материалы без задачи; `SALES_CATALOG_REQUESTED` или `SALES_PRICE_REQUEST`.

**Заметка для карточки:** Pitch lead согласует с клиентом бриф, объём подготовки, команду и срок представления решения.

### `PITCH_SHORTLISTED` — Агентство вошло в шорт-лист

| Field | Value |
|---|---|
| Pack · block · family | agency · N1 · pitch |
| Weight · class · kind · score rule | 7 · chance · event · fixed |
| Effort · asks us · inbound only · amount | quick · no · yes · no |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (P6) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: terms of the next round recorded (`PITCH_DEFENSE_INVITED`, `PITCH_SELECTION_CRITERIA_DISCLOSED`) or an outcome |
| Relations | both with `PITCH_FINAL_TERMS_DISCUSSION` (one P6 card, Maslov §5.6) |
| Date gate | — |
| Relevance window | default |
| Deal effect | enter_stage S3 «Финальный выбор» from S1–S2 |

**Определение:** Клиент прямо подтверждает, что агентство вошло в шорт-лист, финал или следующий отборочный тур после рассмотрения предложений. Сообщение исходит от клиента или от его закупок.

**Граница (не считается):** Получение нашего предложения и фразы «мы рассматриваем», «изучаем ваши материалы» продвижение не подтверждают — нет сигнала. Допуск после предквалификации — `PITCH_QUALIFIED`. Устный выбор агентства — `PITCH_VERBAL_SELECTION`.

**Признаки для промпта (≤ 8):** «вы в шорт-листе», «вы в финале», «прошли в финальный тур», «остались два агентства», «вы среди финалистов», «приглашаем на финальную защиту», «следующий этап отбора с вами»

**Синонимы и выражения (полный список):**
- Деловая переписка: «по итогам первого этапа ваше предложение включено в шорт-лист», «уведомляем о прохождении в финальный этап конкурса», «ваше агентство вошло в число финалистов», «приглашаем к участию во втором туре», «в финальный этап прошли три агентства, в том числе ваше»
- Чаты / мессенджеры (разговорный стиль): «вы в финале!», «вы в шорте», «остались вы и ещё одно агентство», «вас оставили в финальной тройке», «прошли дальше, готовьтесь к защите», «вы в топ-3»
- Сокращения и термины: «шорт-лист», «шорт», «short list», «финал», «финальный тур», «второй тур», «финалисты»
- Устойчивые конструкции / маркеры: «вошли / прошли / включены» + «в шорт-лист / в финал / во второй тур»; «остались» + «вы и»

**Похоже, но не это (анти-признаки):** «материалы получили, рассматриваем» → нет сигнала; «вы допущены ко второму этапу по документам» → `PITCH_QUALIFIED`; «мы выбрали вас» → `PITCH_VERBAL_SELECTION`; «приглашаем защитить концепцию» без слов о шорт-листе → `PITCH_DEFENSE_INVITED`.

**Пример (evidence):** «Добрый день! Рады сообщить, что вы в финале: остались два агентства. Защита пройдёт 10 декабря.»
**Контрпример:** «Спасибо за концепцию, мы её рассматриваем вместе с другими предложениями» → это ещё не продвижение; нет сигнала.

**Заметка для карточки:** Pitch lead уточняет у клиента условия финального выбора и согласует следующий шаг.

### `PITCH_FINAL_TERMS_DISCUSSION` — Обсуждаются актуальные объём и цена

| Field | Value |
|---|---|
| Pack · block · family | agency · N1 · pitch |
| Weight · class · kind · score rule | 7 · chance · event · fixed |
| Effort · asks us · inbound only · amount | medium · yes · yes · yes |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (P6) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: `SALES_OFFER_SENT` (обновлённая смета отправлена), `PITCH_VERBAL_SELECTION` or an outcome |
| Relations | both with `PITCH_SHORTLISTED`; outranks `SALES_BUDGET_MENTIONED` and `SALES_PRICE_REQUEST` on the same deal |
| Date gate | — |
| Relevance window | default |
| Deal effect | enter_stage S3 «Финальный выбор» from S1–S2. The amount is stored, never added to the forecast automatically. Q24-9 replaces the Maslov action «new biz и финансы: проверить допуск суммы в прогноз»: the card asks the opportunity owner to update the win estimate (`deal.win_estimate`) |

**Определение:** После рассмотрения решения клиент обсуждает с агентством актуальную смету, состав работ, цену или условия закупки по этой возможности. Клиент просит обновить смету, сократить или изменить состав под окончательное решение.

**Граница (не считается):** Ранний бюджет из брифа (→ `SALES_BUDGET_MENTIONED`), запрос прайса (→ `SALES_PRICE_REQUEST`) и цена в первом предложении сами по себе не подходят. Обсуждение цены уже действующего договора — `SALES_RENEGOTIATION`. Расширение объёма при прежней цене — `PITCH_SCOPE_WITHOUT_ADJUSTMENT`.

**Признаки для промпта (≤ 8):** «обсудим обновлённую смету», «пришлите финальную смету», «давайте согласуем состав работ», «можете ли снизить стоимость», «скорректируйте смету под бюджет», «условия договора и оплаты», «финальное коммерческое предложение»

**Синонимы и выражения (полный список):**
- Деловая переписка: «просим направить актуализированную смету с учётом обсуждения», «предлагаем обсудить финальный состав работ и стоимость», «просим пересчитать смету без пункта по продакшну», «комиссия просит предоставить окончательное ценовое предложение», «готовы обсудить условия договора и график оплаты», «просим уточнить стоимость с учётом сокращённого объёма»
- Чаты / мессенджеры (разговорный стиль): «давайте добьём смету», «можете ужаться по цене?», «пересчитайте без видео», «скиньте финальную цифру», «нужен финальный расчёт до пятницы», «финансы хотят понять итоговую сумму»
- Сокращения и термины: «смета», «финальная смета», «BAFO», «переторжка», «итоговое КП», «состав работ», «условия закупки»
- Устойчивые конструкции / маркеры: «обсудим / согласуем / пересчитайте» + «смету / стоимость / состав работ»; «финальное / окончательное» + «предложение / смета / цена»

**Похоже, но не это (анти-признаки):** «бюджет на проект около 5 млн» в брифе → `SALES_BUDGET_MENTIONED`; «пришлите расценки на SMM» → `SALES_PRICE_REQUEST`; «добавьте ещё два направления, бюджет прежний» → `PITCH_SCOPE_WITHOUT_ADJUSTMENT`; «ваша смета выше нашего бюджета вдвое» → `PITCH_BUDGET_MISMATCH`; «хотим пересмотреть ставки по действующему договору» → `SALES_RENEGOTIATION`.

**Пример (evidence):** «Вы в финале, обсудим обновлённую смету: нужен вариант без наружной рекламы и с оплатой в два этапа.»
**Контрпример:** «В брифе ориентир по бюджету — до 3 млн рублей, подготовьте концепцию» → это ранний бюджет на старте отбора; `SALES_BUDGET_MENTIONED` вместе с `PITCH_SOLUTION_REQUESTED`.

**Заметка для карточки:** Ответственный за возможность согласует с клиентом версию сметы и состава работ и обновляет свою оценку шансов сделки.

### `PITCH_VERBAL_SELECTION` — Клиент устно выбрал агентство

| Field | Value |
|---|---|
| Pack · block · family | agency · N1 · pitch |
| Weight · class · kind · score rule | 8 · chance · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · yes · no |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (P8) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: `SALES_BOOKING_RECEIVED`, `PITCH_CANCELLED_BY_CLIENT`, `PITCH_EXCLUDED` |
| Relations | leads over `PITCH_SHORTLISTED` in the same item; a verbal win never closes order formalisation (spec §2.1 rule 7) |
| Date gate | — |
| Relevance window | default |
| Deal effect | enter_stage S4 «Выбраны» from S1–S3 |

**Определение:** Уполномоченный представитель клиента явно сообщает, что выбрал агентство, до официального уведомления и до оформления договора или заказа. Решение названо прямо, а не предполагается.

**Граница (не считается):** Похвала («концепция всем понравилась»), предположение рядового сотрудника, статус «вы в числе фаворитов» выбором не являются. Официальное письмо или протокол о победе — `PITCH_OFFICIAL_AWARD`. Подписанный договор или обязательный заказ — `SALES_BOOKING_RECEIVED`.

**Признаки для промпта (≤ 8):** «мы выбрали вас», «решили работать с вами», «вы победили», «решение в вашу пользу», «идём с вами», «договор оформим позже», «руководство утвердило ваше агентство»

**Синонимы и выражения (полный список):**
- Деловая переписка: «сообщаем, что по итогам обсуждения выбор сделан в пользу вашего агентства», «принято решение продолжить работу с вами», «руководство согласовало ваше агентство в качестве подрядчика», «официальное уведомление направим после завершения процедур», «приступаем к подготовке договора с вашей компанией»
- Чаты / мессенджеры (разговорный стиль): «вы выиграли!», «мы с вами, поздравляю», «решили идти с вами», «выбрали вас, теперь бумажки», «CMO сказал — берём вас», «всё, вы наши, юристы скоро пришлют договор», «готовьтесь стартовать»
- Сокращения и термины: «выбор подрядчика», «победитель», «утвердили подрядчика», «решение комиссии» (неофициально, до протокола)
- Устойчивые конструкции / маркеры: «выбрали / утвердили / решили работать с» + «вами / вашим агентством»; «решение в вашу пользу»; «договор / документы» + «оформим позже»

**Похоже, но не это (анти-признаки):** «вы в финале» → `PITCH_SHORTLISTED`; «концепция очень понравилась команде» → `FEEDBACK_QUALITY_PRAISE` или нет сигнала; «направляем официальное уведомление о победе» → `PITCH_OFFICIAL_AWARD`; «договор подписан, ждём счёт на аванс» → `SALES_BOOKING_RECEIVED`; «мне кажется, вы фавориты» от рядового сотрудника → нет сигнала.

**Пример (evidence):** «Коллеги, мы выбрали вас! Договор оформим в течение двух недель, юристы пришлют проект.»
**Контрпример:** «По секрету: вы пока лидируете, но решение ещё не принято» → это не явный выбор; нет сигнала.

**Заметка для карточки:** Ответственный за возможность согласует с клиентом оформление договора и дату подтверждения заказа, не считая выбор заказом.

### `PITCH_OFFICIAL_AWARD` — Получено официальное уведомление о победе

| Field | Value |
|---|---|
| Pack · block · family | agency · N1 · pitch |
| Weight · class · kind · score rule | 9 · chance · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · yes · yes |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (P8) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: `SALES_BOOKING_RECEIVED` or another explicit outcome |
| Relations | leads over `PITCH_VERBAL_SELECTION` |
| Date gate | — |
| Relevance window | default |
| Deal effect | enter_stage S4 «Выбраны» from S1–S3; at S4 = in_stage (adds confirmation inside the same stage) |

**Определение:** Клиент официально называет агентство победителем отбора: письмом, протоколом тендерной комиссии, уведомлением на закупочной площадке. Это формальное подтверждение выбора, а ещё не обязательный заказ.

**Граница (не считается):** Устное сообщение о выборе без официального документа — `PITCH_VERBAL_SELECTION`. Подписанный договор, заказ или гарантийное письмо с обязательством оплатить — `SALES_BOOKING_RECEIVED`. Уведомление о победе другого агентства — `PITCH_EXCLUDED`.

**Признаки для промпта (≤ 8):** «уведомление о победе», «признано победителем», «протокол подведения итогов», «по итогам тендера победителем стало», «решение тендерной комиссии», «итоги конкурса», «направляем официальное письмо»

**Синонимы и выражения (полный список):**
- Деловая переписка: «уведомляем, что ваше агентство признано победителем конкурса», «направляем протокол заседания тендерной комиссии», «по итогам закупочной процедуры победителем определено», «просим подтвердить готовность к заключению договора», «итоговый протокол размещён на площадке», «направляем письмо о результатах отбора»
- Чаты / мессенджеры (разговорный стиль): «протокол подписали, вы победители официально», «на площадке опубликовали итоги, вы первые», «письмо о победе отправили на почту», «официалка ушла, ждите договор»
- Сокращения и термины: «протокол», «итоговый протокол», «протокол ТК», «тендерная комиссия», «уведомление о результатах», «ЭТП», «B2B-Center», «Сбербанк-АСТ», «победитель закупки»
- Устойчивые конструкции / маркеры: «признано / определено» + «победителем»; «протокол» + «подведения итогов / заседания комиссии»; «официально» + «уведомляем / сообщаем»

**Похоже, но не это (анти-признаки):** «мы выбрали вас, официальное письмо позже» → `PITCH_VERBAL_SELECTION`; «договор подписан с обеих сторон» → `SALES_BOOKING_RECEIVED`; «по итогам тендера выбран другой участник» → `PITCH_EXCLUDED`; «итоги конкурса переносятся» → `PITCH_DECISION_DELAYED_BY_CLIENT`.

**Пример (evidence):** «Направляем протокол заседания тендерной комиссии: ваше агентство признано победителем конкурса на PR-сопровождение 2027 года.»
**Контрпример:** «Итоги подведём официально на следующей неделе, но мы склоняемся к вам» → нет ни официального уведомления, ни явного выбора; нет сигнала.

**Заметка для карточки:** Ответственный за возможность согласует с клиентом договор или обязательный заказ и срок их подписания.

### `PITCH_BRIEFING_ACCEPTED` — Клиент согласовал содержательный брифинг

| Field | Value |
|---|---|
| Pack · block · family | agency · N1 · pitch |
| Weight · class · kind · score rule | 4 · chance · event · fixed |
| Effort · asks us · inbound only · amount | quick · yes · yes · no |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (D4) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: briefing held and results saved (`DELIVERY_PROTOCOL` with the briefing results, or user «Готово») |
| Relations | both with `PITCH_SELECTION_CRITERIA_DISCLOSED` |
| Date gate | — (briefing date goes to facts) |
| Relevance window | default |
| Deal effect | in_stage (S1–S3) |

**Определение:** Клиент согласовывает разговор по задаче (брифинг, Q&A-сессию) либо письменно даёт содержательные ответы на наши вопросы о задаче, участниках и процедуре выбора. У разговора есть понятная цель — уточнить задачу.

**Граница (не считается):** Формальное принятие календарного приглашения без понятной цели — нет сигнала. Ознакомительный разговор без конкретной задачи в области 0 — `PROSPECT_CONVERSATION_ACCEPTED`. Раскрытие только критериев и состава комиссии — `PITCH_SELECTION_CRITERIA_DISCLOSED`.

**Признаки для промпта (≤ 8):** «давайте проведём брифинг», «готовы ответить на вопросы по брифу», «Q&A-сессия для участников», «ответы на ваши вопросы во вложении», «созвонимся по задаче», «обсудим бриф», «уточним задачу на встрече»

**Синонимы и выражения (полный список):**
- Деловая переписка: «предлагаем провести брифинг по задаче во вторник», «направляем ответы на вопросы участников отбора», «готовы организовать встречу для уточнения брифа», «приглашаем участников на установочную встречу», «вопросы по техническому заданию принимаются до», «по вашим вопросам: целевая аудитория, сроки и KPI ниже»
- Чаты / мессенджеры (разговорный стиль): «давайте созвонимся, расскажу подробнее про задачу», «скиньте вопросы, ответим», «собираю бренд-команду на брифинг», «завтра в 11 устроит обсудить бриф?», «ответила на ваши вопросы в документе»
- Сокращения и термины: «брифинг», «дебриф», «Q&A», «установочная встреча», «kick-off» (до заказа), «вопросы участников», «разъяснения к ТЗ»
- Устойчивые конструкции / маркеры: «провести / согласовать / назначить» + «брифинг / встречу по задаче»; «ответы на вопросы» + «по брифу / участников»

**Похоже, но не это (анти-признаки):** «принял приглашение: Встреча» без цели → нет сигнала; «давайте просто познакомимся» без задачи → `PROSPECT_CONVERSATION_ACCEPTED`; «оценивать будем по креативу 50 %, цене 30 %» → `PITCH_SELECTION_CRITERIA_DISCLOSED`; «бриф пока не готов, делайте как видите» → `PITCH_BRIEF_INCOMPLETE`; «хотим познакомиться с командой проекта» → `PITCH_TEAM_INTRO_REQUESTED`.

**Пример (evidence):** «Давайте проведём брифинг в четверг в 15:00: расскажем про аудиторию запуска, сроки и кто будет принимать решение.»
**Контрпример:** «Принято: Встреча (четверг, 15:00)» без текста → только календарное подтверждение; нет сигнала.

**Заметка для карточки:** Pitch lead проводит брифинг и фиксирует задачу, участников решения и условия отбора.

### `PITCH_BUYER_ACCESS_GRANTED` — Предоставлен доступ к участнику решения

| Field | Value |
|---|---|
| Pack · block · family | agency · N1 · pitch |
| Weight · class · kind · score rule | 5 · chance · event · fixed |
| Effort · asks us · inbound only · amount | quick · no · yes · no |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (D4) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: contact happened or next step agreed |
| Relations | both with `MEETING_NEW_STAKEHOLDER`; outranks `CONTACT_NEW_KNOWN_ORG` for the same person |
| Date gate | — |
| Relevance window | default |
| Deal effect | in_stage; clears risks `RISK_NO_BUYER_ACCESS`, `RISK_SINGLE_CONTACT`, `RISK_KEY_CONTACT_LOSS` |

**Определение:** Клиент знакомит агентство с бизнес-заказчиком, ЛПР, руководителем направления или закупками либо согласует с ним предметный контакт по этой возможности. Роль нового человека в решении названа.

**Граница (не считается):** Новый адрес в копии без понятной роли не равен предоставленному доступу (→ нет сигнала или `CONTACT_NEW_KNOWN_ORG`). Знакомство в области 0 без открытой возможности — `PROSPECT_INTRODUCTION_OFFERED`.

**Признаки для промпта (≤ 8):** «познакомлю вас с директором по маркетингу», «подключаю бренд-менеджера», «ставлю в копию руководителя, он принимает решение», «организуем встречу с CMO», «можете напрямую связаться с», «закупки ждут вашего звонка»

**Синонимы и выражения (полный список):**
- Деловая переписка: «знакомлю вас с руководителем направления, который принимает решение по проекту», «предлагаю провести встречу с директором по маркетингу», «добавляю в переписку коллегу из закупок, он ведёт процедуру», «генеральный директор готов встретиться с вами на следующей неделе», «по коммерческим вопросам можете обращаться напрямую к»
- Чаты / мессенджеры (разговорный стиль): «подключила нашего CMO в чат», «вот контакт бренд-лида, напишите ей», «шеф готов созвониться», «скинула ваш контакт директору, он позвонит», «зову в чат человека из закупок»
- Сокращения и термины: «ЛПР», «CMO», «бренд-менеджер», «бизнес-заказчик», «закупки», «спонсор проекта», «владелец бюджета»
- Устойчивые конструкции / маркеры: «познакомлю / подключаю / добавляю» + «руководителя / директора / ЛПР»; «он / она принимает решение»; «можете напрямую» + «связаться / написать»

**Похоже, но не это (анти-признаки):** новый адрес в копии без объяснения роли → нет сигнала или `CONTACT_NEW_KNOWN_ORG`; «на встрече был новый человек из финансов» → `MEETING_NEW_STAKEHOLDER`; «у нас новый директор по маркетингу» → `CONTACT_NEW_DECISION_MAKER`; «могу познакомить вас с коллегой из другой компании» без открытой возможности → `PROSPECT_INTRODUCTION_OFFERED`.

**Пример (evidence):** «Добавляю в переписку Ольгу, директора по маркетингу, — финальное решение по агентству за ней. Предлагаю созвониться втроём в среду.»
**Контрпример:** «В копии коллега, для информации» → роль в решении не названа; нет сигнала.

**Заметка для карточки:** Ответственный за возможность устанавливает контакт с новым участником решения и уточняет его роль в выборе.

### `PITCH_BUYER_ACCESS_DECLINED` — Клиент отказал в доступе к заказчику

| Field | Value |
|---|---|
| Pack · block · family | agency · N1 · pitch |
| Weight · class · kind · score rule | 6 · risk · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · yes · no |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (P6) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: `PITCH_BUYER_ACCESS_GRANTED` |
| Relations | — ; Q24-7: go/no-go removed — the Maslov action «пересмотреть go/no-go» becomes «пересмотреть шансы и формат участия»; the agency's own stop is the user outcome `withdrawn` |
| Date gate | — |
| Relevance window | default |
| Deal effect | in_stage; risk trigger `RISK_NO_BUYER_ACCESS` |

**Определение:** Клиент прямо отказывает в доступе к бизнес-заказчику или ЛПР либо требует вести обсуждение только через закупки, тендерную площадку или формальные письменные запросы. Отказ высказан явно.

**Граница (не считается):** Единичная задержка ответа, несостоявшаяся или ещё не назначенная встреча отказом не являются (→ нет сигнала). Обычное правило тендера «вопросы через площадку», если доступ к заказчику не запрашивался, — нет сигнала. Неясность, кто принимает решение, — `PITCH_DECISION_MAKER_UNCLEAR`.

**Признаки для промпта (≤ 8):** «все вопросы только через закупки», «напрямую с маркетингом не получится», «общение только через площадку», «встреча с заказчиком не предусмотрена», «руководство не участвует в обсуждении», «контакты с бизнесом процедурой не допускаются»

**Синонимы и выражения (полный список):**
- Деловая переписка: «в соответствии с регламентом закупки взаимодействие с участниками осуществляется только через закупочную комиссию», «организация встречи с функциональным заказчиком не предусмотрена», «просим направлять все вопросы исключительно через электронную площадку», «прямые контакты с бизнес-подразделением на этапе отбора не допускаются», «руководитель направления не будет участвовать в обсуждении»
- Чаты / мессенджеры (разговорный стиль): «с бренд-командой вас не сведу, всё через меня», «директор не будет созваниваться, пишите мне», «закупки запретили напрямую общаться», «маркетинг в это не включается, только тендерный отдел», «не надо писать CMO, это против правил»
- Сокращения и термины: «регламент закупки», «закупочная комиссия», «ЭТП», «запрос разъяснений», «функциональный заказчик», «тендерный отдел»
- Устойчивые конструкции / маркеры: «только через» + «закупки / площадку / меня»; «напрямую» + «не получится / нельзя / не допускается»; «встреча с» + «заказчиком / руководством» + «не предусмотрена»

**Похоже, но не это (анти-признаки):** «встречу пока не назначили, вернёмся позже» → нет сигнала; «пока сами не знаем, кто решает» → `PITCH_DECISION_MAKER_UNCLEAR`; «все вопросы через меня» как устойчивая модель на всей сделке без явного отказа → `PITCH_SINGLE_CONTACT_DEPENDENCY`; «вопросы по ТЗ направляйте через площадку до 15.11» без нашего запроса о встрече → нет сигнала.

**Пример (evidence):** «К сожалению, встреча с бренд-командой процедурой не предусмотрена, все вопросы — только через закупки и площадку.»
**Контрпример:** «Директор по маркетингу в отпуске, встречу проведём после 20-го» → это задержка, а не отказ в доступе; нет сигнала.

**Заметка для карточки:** Ответственный за возможность оценивает шансы и формат дальнейшего участия без доступа к бизнес-заказчику и предлагает клиенту другой путь к ЛПР.

### `PITCH_TEAM_INTRO_REQUESTED` — Клиент запросил знакомство с командой

| Field | Value |
|---|---|
| Pack · block · family | agency · N1 · pitch |
| Weight · class · kind · score rule | 4 · chance · event · fixed |
| Effort · asks us · inbound only · amount | medium · yes · yes · no |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (D4) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: meeting held (`DELIVERY_PROTOCOL`) or the client withdraws the request |
| Relations | both with `MEETING_URGENT` |
| Date gate | — (the meeting date goes to facts) |
| Relevance window | default |
| Deal effect | in_stage (create preparation and a meeting; no stage move) |

**Определение:** Клиент просит познакомить его с предлагаемой командой проекта или с руководителями, которые будут вести работу: встреча, звонок или презентация состава команды в рамках конкретной возможности.

**Граница (не считается):** Наша собственная инициатива представить команду — нет сигнала. Приглашение представить и защитить решение — `PITCH_DEFENSE_INVITED`. Знакомство с участником решения со стороны клиента — `PITCH_BUYER_ACCESS_GRANTED`. Сомнение в квалификации команды — `PITCH_EXPERTISE_DOUBTED`.

**Признаки для промпта (≤ 8):** «хотим познакомиться с командой», «познакомьте нас с командой проекта», «кто будет вести наш проект», «покажите, кто будет в команде», «встреча с аккаунт-директором», «пусть придёт креативный директор», «чемистри-встреча», «представьте ключевых людей»

**Синонимы и выражения (полный список):**
- Деловая переписка: «просим организовать встречу с командой, которая будет работать над проектом», «хотели бы познакомиться с предлагаемой командой», «просим представить состав проектной команды», «необходима встреча с руководителем проекта со стороны агентства», «хотели бы увидеть креативного директора и стратега», «просим включить в презентацию ключевых членов команды»
- Чаты / мессенджеры (разговорный стиль): «давайте созвонимся с вашей командой», «а кто у вас будет на проекте? хотим увидеть людей», «приведите на встречу тех, кто реально будет делать», «можно познакомиться с креативщиками?», «давайте чемистри устроим»
- Сокращения и термины: «chemistry meeting», «чемистри-сессия», «знакомство с командой», «team intro», «аккаунт», «КД (креативный директор)»
- Устойчивые конструкции / маркеры: «хотим познакомиться с» + команда / руководитель / креативный директор; «кто будет вести» + проект / бренд / аккаунт; «просим представить» + состав команды

**Похоже, но не это (анти-признаки):** «ждём вас на защите концепции 14-го» → `PITCH_DEFENSE_INVITED`; «познакомлю вас с нашим директором по маркетингу» → `PITCH_BUYER_ACCESS_GRANTED`; «сомневаемся, что у команды есть опыт в фарме» → `PITCH_EXPERTISE_DOUBTED`; «давайте мы покажем вам нашу команду» (наше письмо) → нет сигнала.

**Пример (evidence):** «Перед финальным решением хотим познакомиться с командой, которая будет вести бренд, — сможете собрать аккаунт-директора и креативного директора на следующей неделе?»
**Контрпример:** «Спасибо за знакомство с командой, было полезно» → встреча уже состоялась, нового запроса нет; это закрытие, а не новый сигнал.

**Заметка для карточки:** Ответственному за возможность согласовать с клиентом состав, цель и дату встречи с командой и подготовить участников.

### `PITCH_DEFENSE_INVITED` — Клиент пригласил на защиту решения

| Field | Value |
|---|---|
| Pack · block · family | agency · N1 · pitch |
| Weight · class · kind · score rule | 5 · chance · event · fixed |
| Effort · asks us · inbound only · amount | complex · yes · yes · no |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (D4) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: defence held (`DELIVERY_PROTOCOL`); the later choice is recorded separately |
| Relations | — ; a defence invitation does NOT prove a shortlist |
| Date gate | — (the defence date goes to facts.deadlines) |
| Relevance window | default |
| Deal effect | in_stage (no move to S3) |

**Определение:** Клиент приглашает агентство очно или онлайн представить, объяснить или защитить подготовленное решение (концепцию, стратегию, смету) перед своей командой, тендерной комиссией или руководством.

**Граница (не считается):** Наша внутренняя репетиция и наша инициатива провести презентацию — нет сигнала. Само приглашение на защиту не подтверждает шорт-лист: шорт-лист фиксирует только `PITCH_SHORTLISTED`. Просьба познакомиться с командой без представления решения — `PITCH_TEAM_INTRO_REQUESTED`.

**Признаки для промпта (≤ 8):** «приглашаем на защиту», «защита концепции», «презентация перед тендерной комиссией», «слот для презентации», «представить решение руководству», «питч-сессия», «выступление 20 минут плюс вопросы», «очная защита»

**Синонимы и выражения (полный список):**
- Деловая переписка: «приглашаем вас на защиту креативной концепции», «просим представить предложение тендерной комиссии», «защита состоится 14.11 в 11:00, регламент — 20 минут и 10 минут вопросы», «просим подтвердить участие в очной презентации», «будем рады видеть вас на презентации стратегии перед бренд-командой», «вам выделен слот на питч-дне»
- Чаты / мессенджеры (разговорный стиль): «приходите защищать», «покажете концепцию нашему CMO?», «давайте вы презентуете вживую», «зум с комиссией в четверг, успеете?», «ждём вас с презой в пятницу»
- Сокращения и термины: «защита», «питч», «питч-день», «презентация концепции», «тендерная комиссия», «Q&A», «преза», «слот»
- Устойчивые конструкции / маркеры: «приглашаем на» + защиту / презентацию / питч; «просим представить» + концепцию / стратегию / решение; «выделен слот» + дата

**Похоже, но не это (анти-признаки):** «вы в шорт-листе, защита в пятницу» → `PITCH_SHORTLISTED` ведёт, защита — контекст в той же карточке; «хотим познакомиться с вашей командой» → `PITCH_TEAM_INTRO_REQUESTED`; «пришлите концепцию до 10-го» → `PITCH_SOLUTION_REQUESTED`; «защита переносится на декабрь, решение тоже» → `PITCH_DECISION_DELAYED_BY_CLIENT`.

**Пример (evidence):** «Приглашаем вас на защиту концепции перед тендерной комиссией 18 ноября в 15:00, на выступление — 20 минут, затем вопросы».
**Контрпример:** «Мы бы хотели прийти и показать вам наш подход» (письмо агентства) → инициатива наша, не клиента.

**Заметка для карточки:** Ответственному за возможность подтвердить участие, состав выступающих и подготовить защиту к названной дате.

### `PITCH_REVISION_REQUESTED` — Запрошена существенная доработка

| Field | Value |
|---|---|
| Pack · block · family | agency · N1 · pitch |
| Weight · class · kind · score rule | 5 · chance · event · fixed |
| Effort · asks us · inbound only · amount | complex · yes · yes · yes |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (D4) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: `SALES_OFFER_SENT` (доработка передана) or the request is withdrawn |
| Relations | `PITCH_UNPAID_WORK_EXPANDING` and `PITCH_REVISIONS_WITHOUT_DECISION` lead over it (Maslov §5.5: one card, the risk leads, the revision request is context) |
| Date gate | — |
| Relevance window | default |
| Deal effect | in_stage; never moves the deal back. Each instance is counted by the process rule of `PITCH_REVISIONS_WITHOUT_DECISION` |

**Определение:** После знакомства с нашим решением клиент просит существенно изменить концепцию, объём, состав команды или смету до выбора агентства. Это новый цикл подготовки без отката стадии.

**Граница (не считается):** Исправление опечаток, оформления, логотипа на слайде — нет сигнала. Третья и следующая доработка без критериев решения — `PITCH_REVISIONS_WITHOUT_DECISION`. Запрос дополнительных концепций без продвижения к выбору — `PITCH_UNPAID_WORK_EXPANDING`. Изменение объёма при прежней цене и сроке — `PITCH_SCOPE_WITHOUT_ADJUSTMENT`. Правки к результату после заказа — `DELIVERY_ACCEPTANCE_WITHHELD` или `DELIVERY_CHANGE_REQUESTED`.

**Признаки для промпта (≤ 8):** «доработайте концепцию», «нужна вторая итерация», «переработайте смету», «пересоберите предложение», «поменяйте механику», «усильте креатив», «скорректируйте состав команды», «пришлите обновлённую версию»

**Синонимы и выражения (полный список):**
- Деловая переписка: «просим доработать концепцию с учётом комментариев», «по итогам рассмотрения просим скорректировать смету», «просим пересмотреть состав команды в сторону уменьшения», «просим подготовить обновлённую версию предложения к 20.11», «комиссия просит переработать креативную идею», «необходимо адаптировать стратегию под новый сегмент»
- Чаты / мессенджеры (разговорный стиль): «идея нравится, но надо докрутить», «можете переделать смету под 5 млн?», «давайте вторую итерацию», «механику бы поменять», «перепакуйте, пожалуйста», «нужен другой ключевой визуал»
- Сокращения и термины: «итерация», «v2», «доработка», «правки», «КВ (ключевой визуал)», «смета», «бриф на доработку», «фидбэк комиссии»
- Устойчивые конструкции / маркеры: «просим доработать / переработать / скорректировать» + концепцию / смету / стратегию; «нужна новая версия» + предложения; «с учётом комментариев» + срок

**Похоже, но не это (анти-признаки):** «поправьте опечатку на 5 слайде» → нет сигнала; «это уже четвёртая версия, давайте ещё одну, а там посмотрим» → `PITCH_REVISIONS_WITHOUT_DECISION`; «сделайте ещё две альтернативные концепции, потом решим» → `PITCH_UNPAID_WORK_EXPANDING`; «добавьте ещё два направления, бюджет прежний» → `PITCH_SCOPE_WITHOUT_ADJUSTMENT`; «акт не подпишем, пока не переделаете ролик» → `DELIVERY_ACCEPTANCE_WITHHELD`.

**Пример (evidence):** «Концепция комиссии понравилась, но просим доработать механику под digital и пересчитать смету без наружной рекламы — новую версию ждём до 25 ноября».
**Контрпример:** «Поменяйте, пожалуйста, шрифт на титульном слайде и пришлите PDF» → правка оформления, не существенная доработка.

**Заметка для карточки:** Ответственному за возможность согласовать с клиентом содержание доработки, срок и, при необходимости, стоимость проработки.

### `PITCH_REQUIREMENTS_CHANGED` — Изменились требования или процедура отбора

| Field | Value |
|---|---|
| Pack · block · family | agency · N1 · pitch |
| Weight · class · kind · score rule | 6 · risk · event · fixed |
| Effort · asks us · inbound only · amount | medium · yes · yes · yes |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (P6) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: new version of requirements agreed (`PITCH_BRIEFING_ACCEPTED`, `PITCH_SELECTION_CRITERIA_DISCLOSED`) |
| Relations | `PITCH_SCOPE_WITHOUT_ADJUSTMENT` leads over it (Maslov §5.5: one card with the concrete scope change). Q24-7: Maslov action «пересмотреть go/no-go» removed |
| Date gate | — |
| Relevance window | default |
| Deal effect | in_stage (update terms, amount context); risk trigger RISK_REQUIREMENTS_CHANGED; also part of the RISK_LEADERSHIP_CHANGE condition |

**Определение:** Клиент существенно меняет бриф, критерии оценки, закупочные правила, сроки этапов или обязательный объём работ по ходу отбора.

**Граница (не считается):** Уточнение уже известных требований или ответ на наш вопрос — не изменение (`PITCH_BRIEFING_ACCEPTED` или нет сигнала). Расширение объёма при прежней цене и сроке ведёт как `PITCH_SCOPE_WITHOUT_ADJUSTMENT` (одна карточка). Первичное раскрытие критериев — `PITCH_SELECTION_CRITERIA_DISCLOSED`. Перенос только даты решения — `PITCH_DECISION_DELAYED_BY_CLIENT`.

**Признаки для промпта (≤ 8):** «обновлённый бриф», «изменились требования», «поменяли критерии оценки», «новая процедура закупки», «теперь тендер через площадку», «добавился обязательный этап», «изменили техническое задание», «новые условия участия»

**Синонимы и выражения (полный список):**
- Деловая переписка: «направляем обновлённую версию брифа, просим учесть изменения», «в связи с изменением внутренней политики закупка проводится через электронную площадку», «изменены веса критериев оценки», «в ТЗ добавлен блок по SMM», «требование о наличии аккредитации стало обязательным», «изменён формат подачи: теперь двухконвертная система», «срок подачи сокращён до 1 декабря»
- Чаты / мессенджеры (разговорный стиль): «бриф поменялся, сейчас пришлю новый», «закупки всё переиграли», «теперь не только креатив, ещё и медиа надо», «у нас поменялись вводные», «руководство решило по-другому, вот новые требования»
- Сокращения и термины: «ТЗ», «бриф v2», «RFP», «закупочная процедура», «ЭТП», «223-ФЗ», «аккредитация», «тендерная документация», «критерии оценки»
- Устойчивые конструкции / маркеры: «изменились / поменялись» + требования / вводные / критерии / сроки; «в новой редакции» + бриф / ТЗ; «теперь обязательно» + условие

**Похоже, но не это (анти-признаки):** «добавьте ещё два направления, бюджет и дата прежние» → `PITCH_SCOPE_WITHOUT_ADJUSTMENT` ведёт, этот код — контекст; «уточняем: в брифе имелась в виду только Москва» → нет сигнала (уточнение); «оценивать будем по цене 60 %, креатив 40 %» (первое раскрытие) → `PITCH_SELECTION_CRITERIA_DISCLOSED`; «решение переносится на январь» → `PITCH_DECISION_DELAYED_BY_CLIENT`.

**Пример (evidence):** «Коллеги, направляем обновлённый бриф: к креативной концепции добавился медиаплан, а подача теперь только через электронную площадку до 1 декабря».
**Контрпример:** «Уточняю по брифу: целевая аудитория та же, 25–45, как и было указано» → требования не изменились.

**Заметка для карточки:** Ответственному за возможность оценить последствия новых требований для решения, сметы и сроков и согласовать с клиентом условия дальнейшего участия.

### `PITCH_SELECTION_CRITERIA_DISCLOSED` — Клиент раскрыл критерии выбора

| Field | Value |
|---|---|
| Pack · block · family | agency · N1 · pitch |
| Weight · class · kind · score rule | 4 · fyi · event · fixed |
| Effort · asks us · inbound only · amount | quick · no · yes · no |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (D4) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: — (information; the card closes after it is read / saved) |
| Relations | `PITCH_PRICE_ONLY_SELECTION` leads over it (Maslov §5.5: one price-selection risk card); both with `PITCH_BRIEFING_ACCEPTED` |
| Date gate | — |
| Relevance window | default |
| Deal effect | in_stage (save criteria and roles of choice); clears RISK_DECISION_MAKER_UNCLEAR, RISK_SELECTION_CRITERIA_UNCLEAR, RISK_STAKEHOLDER_CONFLICT (see risks) |

**Определение:** Клиент объясняет, кто принимает решение о выборе агентства и как сравниваются предложения: критерии, их веса, состав комиссии, порядок голосования или этапы оценки.

**Граница (не считается):** Наше собственное предположение о критериях — нет сигнала. Если раскрытые критерии сводятся к одной цене — ведёт `PITCH_PRICE_ONLY_SELECTION`. Изменение уже раскрытых критериев — `PITCH_REQUIREMENTS_CHANGED`. Отказ объяснить критерии — `PITCH_SELECTION_CRITERIA_UNCLEAR`.

**Признаки для промпта (≤ 8):** «критерии оценки», «веса критериев», «оценивать будем по», «балльная система», «состав тендерной комиссии», «решение принимает», «голосуют», «финальное слово за»

**Синонимы и выражения (полный список):**
- Деловая переписка: «оценка предложений проводится по следующим критериям: креатив — 40 %, стратегия — 30 %, стоимость — 30 %», «в состав комиссии входят директор по маркетингу, бренд-менеджер и представитель закупок», «решение принимает коммерческий директор по рекомендации бренд-команды», «итоговая оценка — сумма баллов членов комиссии», «прилагаем методику оценки заявок»
- Чаты / мессенджеры (разговорный стиль): «смотреть будем в первую очередь на креатив, цена вторична», «решать будет CMO, я только собираю», «голосуем всей командой, потом согласуем с генеральным», «главное для нас — опыт в FMCG и скорость»
- Сокращения и термины: «критерии оценки», «методика оценки», «скоринг», «балльная оценка», «ЛПР», «тендерная комиссия», «закупочный комитет», «CMO»
- Устойчивые конструкции / маркеры: «оценивать будем по» + критерии; «решение принимает / за» + роль; «в комиссию входят» + роли; «вес критерия» + процент

**Похоже, но не это (анти-признаки):** «выбираем того, кто дешевле, остальное не важно» → `PITCH_PRICE_ONLY_SELECTION`; «по каким критериям — пока сказать не можем» → `PITCH_SELECTION_CRITERIA_UNCLEAR`; «мы поменяли веса: теперь цена 50 %» → `PITCH_REQUIREMENTS_CHANGED`; «думаю, им важна цена» (наш коллега) → нет сигнала.

**Пример (evidence):** «Решение будет принимать директор по маркетингу, оценка по трём критериям: креативная идея — 40 %, стратегия — 30 %, стоимость — 30 %».
**Контрпример:** «Мы считаем, что у них главный критерий — сроки» (внутреннее письмо агентства) → предположение, не раскрытие клиентом.

**Заметка для карточки:** Ответственному за возможность сохранить критерии и роли выбора в карточке сделки и учесть их в плане подготовки.

### `PITCH_DECISION_DELAYED_BY_CLIENT` — Клиент перенёс дату решения

| Field | Value |
|---|---|
| Pack · block · family | agency · N1 · pitch |
| Weight · class · kind · score rule | 5 · risk · event · fixed |
| Effort · asks us · inbound only · amount | quick · no · yes · no |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (D4) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: new date + next step agreed, or an outcome |
| Relations | — ; Q24-3: each distinct postponement of the same decision is a separate instance |
| Date gate | — (the new decision date goes to facts) |
| Relevance window | default |
| Deal effect | in_stage (decision date updated); risk trigger RISK_DECISION_DRAG with min_occurrences 2 (Q24-3) |

**Определение:** Клиент прямо сообщает, что выбор агентства или решение по проекту переносится, с новой датой или без неё. Каждый отдельный перенос того же решения фиксируется отдельно (Q24-3).

**Граница (не считается):** Повторное упоминание уже известного переноса — не новый перенос. Перенос встречи, не связанной с решением, — нет сигнала (или `MEETING_CANCEL`). Перенос не равен паузе (`PITCH_PAUSED_BY_CLIENT`), проигрышу (`PITCH_EXCLUDED`) или отмене (`PITCH_CANCELLED_BY_CLIENT`). Молчание без сообщения о переносе — не этот код.

**Признаки для промпта (≤ 8):** «перенесём решение», «решение откладывается», «итоги объявим позже», «комиссия переносится», «не успеваем принять решение», «вернёмся с решением после праздников», «сроки выбора сдвигаются», «определимся в январе»

**Синонимы и выражения (полный список):**
- Деловая переписка: «сообщаем, что подведение итогов тендера переносится на 15 декабря», «решение по выбору агентства откладывается в связи с отпуском директора», «заседание тендерной комиссии перенесено», «просим учесть, что сроки выбора подрядчика сдвигаются на две недели», «окончательное решение будет принято после утверждения бюджета»
- Чаты / мессенджеры (разговорный стиль): «пока не решили, давайте после праздников», «решение сдвигается, CMO в командировке», «не раньше января теперь», «вернёмся к вам позже с ответом», «пока подвисло, итоги не скоро», «нам нужно ещё недели две подумать»
- Сокращения и термины: «подведение итогов», «тендерная комиссия», «закупочный комитет», «бюджетный комитет», «шорт-лист», «финал»
- Устойчивые конструкции / маркеры: «переносится / откладывается / сдвигается» + решение / итоги / выбор; «решим / определимся» + после события / к дате; «не успеваем» + принять решение

**Похоже, но не это (анти-признаки):** «как я писал, решение перенесли на декабрь» (повтор) → не новый экземпляр; «давайте перенесём созвон по отчёту на четверг» → нет сигнала; «проект ставим на паузу до весны» → `PITCH_PAUSED_BY_CLIENT`; «выбрали другое агентство» → `PITCH_EXCLUDED`; «комментариев по вашей концепции пока нет» → `PITCH_FEEDBACK_MISSING`.

**Пример (evidence):** «Коллеги, решение по выбору агентства переносим на после новогодних праздников — комиссия соберётся не раньше 15 января».
**Контрпример:** «Напоминаю, решение, как и договаривались, 20 ноября» → дата не изменилась, переноса нет.

**Заметка для карточки:** Ответственному за возможность уточнить у клиента причину переноса и согласовать новую дату решения и следующий шаг.

### `PITCH_EXCLUDED` — Агентство исключено или проиграло

| Field | Value |
|---|---|
| Pack · block · family | agency · N1 · pitch |
| Weight · class · kind · score rule | 7 · risk · event · fixed |
| Effort · asks us · inbound only · amount | quick · no · yes · no |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (P6); shown once, stops earlier reminders (Maslov §5.4) |
| Recipient role | opportunity |
| Closes / closed by | closes: all open instances on the topic (the outcome closes the topic, spec §7.3) · closed by: — |
| Relations | leads over `SALES_OFFER_DECLINED` when it is one decision on one opportunity (Maslov §5.5: one outcome card) |
| Date gate | — |
| Relevance window | default |
| Deal effect | outcome `lost` |

**Определение:** Клиент подтверждает, что агентство не прошло отбор на одном из этапов или что выбран другой поставщик по этой возможности.

**Граница (не считается):** Молчание клиента — не проигрыш. Отказ от одного варианта предложения при открытой возможности — `SALES_OFFER_DECLINED` без исхода. Отмена всего отбора клиентом — `PITCH_CANCELLED_BY_CLIENT`. Пауза — `PITCH_PAUSED_BY_CLIENT`. Собственное решение агентства прекратить участие ставит пользователь как исход `withdrawn`, это не сигнал.

**Признаки для промпта (≤ 8):** «вы не прошли», «выбрали другое агентство», «к сожалению, ваше предложение не выбрано», «победило другое агентство», «не вошли в шорт-лист», «по итогам тендера победителем признан», «решили работать с другим подрядчиком», «не прошли во второй этап»

**Синонимы и выражения (полный список):**
- Деловая переписка: «благодарим за участие, однако по итогам рассмотрения ваше предложение не выбрано», «победителем тендера признано агентство», «ваша заявка не допущена ко второму этапу», «комиссия приняла решение в пользу другого участника», «к сожалению, вы не прошли в финал», «заявка отклонена по формальным основаниям»
- Чаты / мессенджеры (разговорный стиль): «увы, выбрали не вас», «пошли с другим агентством», «вы не прошли, извините», «решили с другими работать», «победили конкуренты, но концепция была сильная», «в этот раз не получилось»
- Сокращения и термины: «итоги тендера», «протокол подведения итогов», «победитель», «отклонение заявки», «не допущены», «шорт-лист», «второй этап»
- Устойчивые конструкции / маркеры: «не прошли / не вошли» + в шорт-лист / финал / этап; «выбрали / выбор сделан в пользу» + другое агентство; «победителем признан» + название

**Похоже, но не это (анти-признаки):** «этот вариант сметы не подходит, пришлите другой» → `SALES_OFFER_DECLINED` без исхода или `PITCH_BUDGET_MISMATCH`; «тендер отменён, проект не будет реализован» → `PITCH_CANCELLED_BY_CLIENT`; «пока ставим выбор на паузу» → `PITCH_PAUSED_BY_CLIENT`; «расторгаем действующий договор» → `CONTRACT_TERMINATED`; «мы решили не участвовать» (наше письмо) → нет сигнала, исход `withdrawn` ставит пользователь.

**Пример (evidence):** «Спасибо за участие в тендере. По итогам заседания комиссии победителем признано другое агентство; ваша концепция заняла второе место».
**Контрпример:** «Вариант с наружной рекламой нам не подходит, остальное обсуждаем дальше» → отказ от одного варианта, возможность открыта.

**Заметка для карточки:** Ответственному за возможность зафиксировать исход, причину проигрыша и выбранного поставщика, если он известен, и наметить дальнейший план отношений с клиентом.

### `PITCH_CANCELLED_BY_CLIENT` — Клиент отменил отбор или проект

| Field | Value |
|---|---|
| Pack · block · family | agency · N1 · pitch |
| Weight · class · kind · score rule | 6 · risk · event · fixed |
| Effort · asks us · inbound only · amount | quick · no · yes · no |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (P6); shown once, stops earlier reminders |
| Recipient role | opportunity |
| Closes / closed by | closes: all open instances on the topic (spec §7.3) · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | outcome `cancelled` |

**Определение:** Клиент явно отменяет закупку, отбор или сам проект до размещения заказа, независимо от участников; победителя нет.

**Граница (не считается):** Расторжение уже действующего договора — `CONTRACT_TERMINATED`. Выбор другого агентства — `PITCH_EXCLUDED` (отмену не записывать как победу конкурента). Временная остановка с условием возврата — `PITCH_PAUSED_BY_CLIENT`. Перенос даты решения — `PITCH_DECISION_DELAYED_BY_CLIENT`. Отмена заказа после подтверждения — `SALES_BOOKING_CANCELLED`.

**Признаки для промпта (≤ 8):** «тендер отменён», «проект отменяется», «закупка не состоится», «решили не делать кампанию», «отбор прекращён», «бюджет сняли, проекта не будет», «конкурс признан несостоявшимся», «отказываемся от проекта»

**Синонимы и выражения (полный список):**
- Деловая переписка: «сообщаем об отмене закупочной процедуры», «конкурс признан несостоявшимся, повторное проведение не планируется», «руководством принято решение отказаться от реализации проекта», «в связи с изменением стратегии кампания в этом году проводиться не будет», «процедура выбора подрядчика прекращена», «бюджет на проект не утверждён, отбор закрываем»
- Чаты / мессенджеры (разговорный стиль): «всё, проект отменили», «кампании не будет, сорри», «тендер слили, бюджет забрали», «наверху решили не запускать», «отбой, проект закрыли»
- Сокращения и термины: «отмена закупки», «тендер отменён», «процедура прекращена», «признан несостоявшимся», «бюджет не утверждён», «запуск отменён»
- Устойчивые конструкции / маркеры: «отменяем / отменён» + тендер / проект / отбор / кампания; «решили не» + запускать / проводить / делать; «проекта не будет»

**Похоже, но не это (анти-признаки):** «расторгаем договор с 1 декабря» → `CONTRACT_TERMINATED`; «выбрали другое агентство» → `PITCH_EXCLUDED`; «замораживаем проект до весны, потом вернёмся» → `PITCH_PAUSED_BY_CLIENT`; «бюджет урезали вдвое, но проект делаем» → `SALES_BUDGET_CUT`; «останавливаем текущие работы по ретейнеру» → `ACCOUNT_WORK_PAUSED_BY_CLIENT`.

**Пример (evidence):** «К сожалению, руководство приняло решение отказаться от запуска кампании в этом году, поэтому тендер мы отменяем. Спасибо за проделанную работу».
**Контрпример:** «Проект откладываем до второго квартала, тогда вернёмся к выбору» → это пауза, а не отмена.

**Заметка для карточки:** Ответственному за возможность закрыть возможность как отменённую клиентом, сохранить причину и уточнить у клиента дальнейшие планы.

### `PITCH_PAUSED_BY_CLIENT` — Клиент явно приостановил возможность

| Field | Value |
|---|---|
| Pack · block · family | agency · N1 · pitch |
| Weight · class · kind · score rule | 4 · risk · event · fixed |
| Effort · asks us · inbound only · amount | quick · no · yes · no |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (D4); no repeats until the agreed return date (Maslov §5.4) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: work resumed (any later enter_stage / in_stage client event on the deal) or a final outcome |
| Relations | — |
| Date gate | { fact: returnDate (or returnCondition text), test: within, setting: `cards.deadlineLeadDays` (quick = 2 working days) } — the card returns before the date |
| Relevance window | until the return date |
| Deal effect | outcome `paused` (deal status paused, stage kept, topic snoozed_until = return date, spec §7.3 / §9.2) |

**Определение:** Клиент прямо сообщает, что отбор или проект до заказа приостановлен, обычно с датой или условием возвращения. Последняя подтверждённая стадия сохраняется.

**Граница (не считается):** Молчание — никогда не пауза. Остановка уже идущей работы по договору — `ACCOUNT_WORK_PAUSED_BY_CLIENT`. Перенос только даты решения при продолжающемся отборе — `PITCH_DECISION_DELAYED_BY_CLIENT`. Окончательный отказ от проекта — `PITCH_CANCELLED_BY_CLIENT`. Не придумывать дату возврата, если клиент назвал только условие.

**Признаки для промпта (≤ 8):** «ставим на паузу», «проект заморозили», «приостанавливаем отбор», «вернёмся после утверждения бюджета», «пока на холде», «возобновим во втором квартале», «замораживаем до», «временно останавливаем тендер»

**Синонимы и выражения (полный список):**
- Деловая переписка: «процедура выбора агентства временно приостановлена», «проект поставлен на паузу до утверждения бюджета на следующий год», «просим приостановить подготовку предложения до нашего сигнала», «возобновим обсуждение во втором квартале», «работа по тендеру приостановлена в связи с реорганизацией»
- Чаты / мессенджеры (разговорный стиль): «пока на холде», «заморозили до весны», «давайте притормозим, вернёмся в феврале», «стоп пока, ждём решения сверху», «проект подвис, как разморозят — напишу»
- Сокращения и термины: «пауза», «on hold», «холд», «заморозка», «до утверждения бюджета», «реорганизация», «Q2»
- Устойчивые конструкции / маркеры: «ставим на паузу / на холд» + проект / отбор; «приостанавливаем» + до даты / до события; «вернёмся / возобновим» + после / в срок

**Похоже, но не это (анти-признаки):** «приостанавливаем работы по текущему договору» → `ACCOUNT_WORK_PAUSED_BY_CLIENT`; «решение переносим на неделю, отбор идёт» → `PITCH_DECISION_DELAYED_BY_CLIENT`; «проект закрыт, не будем делать» → `PITCH_CANCELLED_BY_CLIENT`; «вернёмся к разговору после бюджетного комитета» без открытой сделки → `PROSPECT_FOLLOWUP_AGREED`.

**Пример (evidence):** «Коллеги, тендер ставим на паузу до утверждения маркетингового бюджета — ориентировочно вернёмся к выбору в начале марта».
**Контрпример:** «Мы пока не ответили, потому что CMO в отпуске» → задержка ответа, явной паузы нет.

**Заметка для карточки:** Ответственному за возможность сохранить стадию, причину паузы и условие возвращения и вернуться к клиенту в согласованный момент.

## N2 · PROSPECT

Contact before a request — area 0 (Maslov §2.2). These codes make topics on the client or the contact; they never create a deal (Q34). Only `PROSPECT_NEED_EXPRESSED` with a concrete task opens an opportunity at S1 (Q24-1).

| Code | Название (RU) | W | Class | Kind | Score rule | Effort | Asks us | Inbound only | Amount | Stage (pack) | IN4COM | Profile | Recipient | Family |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `PROSPECT_RELATIONSHIP_ESTABLISHED` | Установлены отношения с контактом | 3 | chance | event | fixed | quick | no | yes | no | active | n/a | W1 | relationship | contact |
| `PROSPECT_INTRODUCTION_OFFERED` | Предложено знакомство с нужным человеком | 5 | chance | event | fixed | quick | yes | yes | no | active | n/a | D4 | relationship | contact |
| `PROSPECT_CONTACT_MOVED` | Знакомый человек перешёл в другую компанию | 5 | chance | event | fixed | quick | no | yes | no | active | n/a | D4 | relationship | contact |
| `PROSPECT_CONVERSATION_ACCEPTED` | Согласован ознакомительный разговор | 4 | chance | event | fixed | quick | yes | yes | no | active | n/a | D4 | relationship | contact |
| `PROSPECT_EVENT_RESPONSE` | Получен ответ на приглашение | 2 | fyi | event | fixed | quick | no | yes | no | active | n/a | W1 | relationship | contact |
| `PROSPECT_EVENT_ATTENDED` | Подтверждено участие в мероприятии | 2 | fyi | event | fixed | quick | no | no | no | active | n/a | W1 | relationship | contact |
| `PROSPECT_CONTENT_INTEREST` | Контакт проявил интерес к теме или материалу | 3 | chance | event | fixed | quick | no | yes | no | active | n/a | W1 (Q24-1) | relationship | contact |
| `PROSPECT_NEED_EXPRESSED` | Потенциальный клиент описал потребность | 7 | chance | event | fixed | medium | no | yes | yes | active | n/a | P6 (Q24-1; N7 removed) | new_biz | pitch |
| `PROSPECT_FOLLOWUP_AGREED` | Согласовано возвращение к разговору | 4 | chance | event | fixed | quick | yes | yes | no | active | n/a | D4 (at agreed time) | relationship | contact |
| `PROSPECT_CONTACT_MENTIONED` | Получен релевантный повод о знакомом контакте | 2 | fyi | event | fixed | quick | no | no | no | active | n/a | W1 | relationship | contact |

### `PROSPECT_RELATIONSHIP_ESTABLISHED` — Установлены отношения с контактом

| Field | Value |
|---|---|
| Pack · block · family | agency · N2 · contact |
| Weight · class · kind · score rule | 3 · chance · event · fixed |
| Effort · asks us · inbound only · amount | quick · no · yes · no |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (W1) |
| Recipient role | relationship |
| Closes / closed by | closes: — · closed by: context and relationship owner recorded (user) |
| Relations | outranked by `PROSPECT_CONVERSATION_ACCEPTED` and `PROSPECT_INTRODUCTION_OFFERED` in the same item |
| Date gate | — |
| Relevance window | default |
| Deal effect | none (area 0, Q34: the engine never creates a deal in area 0) |

**Определение:** Между контактом и агентством состоялось содержательное знакомство или двусторонний обмен сообщениями; известен контекст связи (где познакомились, по какой теме, кто из агентства знает человека). Контакт сам ответил по существу, а не только получил наше письмо.

**Граница (не считается):** Импорт контакта в базу, визитка без переписки, наше письмо без ответа, автоответ — не знакомство (нет сигнала). Если контакт сразу согласовал разговор — `PROSPECT_CONVERSATION_ACCEPTED`; если предложил познакомить с другим человеком — `PROSPECT_INTRODUCTION_OFFERED`; если описал свою задачу — `PROSPECT_NEED_EXPRESSED`.

**Признаки для промпта (≤ 8):** «рад(а) знакомству», «приятно было познакомиться», «спасибо за встречу на конференции», «мы с вами общались на», «нас познакомил(а)», «давайте будем на связи», «добавил(а) вас в контакты», «сохранил(а) ваш номер»

**Синонимы и выражения (полный список):**
- Деловая переписка: «рад(а) знакомству», «приятно было познакомиться лично», «благодарю за содержательный разговор на форуме», «мы с вами общались на конференции», «пишу по рекомендации», «нас представил(а) общий знакомый», «буду рад(а) поддерживать контакт», «оставлю ваши контакты у себя»
- Чаты / мессенджеры (разговорный стиль): «привет, это я с вчерашнего нетворкинга», «рад(а) был(а) увидеться», «добавил(а) вас в телегу», «сохранил(а) номер», «на связи!», «спасибо за беседу, было интересно», «давайте не теряться»
- Сокращения и термины: «нетворкинг», «PR-завтрак», «бизнес-завтрак», «питч-сессия» (как место знакомства)
- Устойчивые конструкции / маркеры: «мы познакомились на» + событие; «по рекомендации» + имя; «будем на связи» + ответ по существу; «как договорились при встрече» без конкретного следующего шага

**Похоже, но не это (анти-признаки):** «давайте созвонимся во вторник» → `PROSPECT_CONVERSATION_ACCEPTED`; «познакомлю вас с нашим директором по маркетингу» → `PROSPECT_INTRODUCTION_OFFERED`; «нам нужно агентство под запуск» → `PROSPECT_NEED_EXPRESSED`; рассылка без ответа, «письмо доставлено» → «нет сигнала»; новый сотрудник у действующего клиента → `CONTACT_NEW_KNOWN_ORG`.

**Пример (evidence):** «Анна, рада была познакомиться на конференции по корпоративным коммуникациям, спасибо за интересный разговор про внутренние медиа — будем на связи».
**Контрпример:** «Добавили вас в рассылку нашего пресс-центра» → односторонняя рассылка, нет двустороннего содержательного обмена, сигнала нет.

**Заметка для карточки:** Попросить владельца связи сохранить, где и о чём познакомились, и записать уместный следующий повод для контакта.

### `PROSPECT_INTRODUCTION_OFFERED` — Предложено знакомство с нужным человеком

| Field | Value |
|---|---|
| Pack · block · family | agency · N2 · contact |
| Weight · class · kind · score rule | 5 · chance · event · fixed |
| Effort · asks us · inbound only · amount | quick · yes · yes · no |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (D4) |
| Recipient role | relationship |
| Closes / closed by | closes: — · closed by: the introduction happened (`PROSPECT_RELATIONSHIP_ESTABLISHED` / `PROSPECT_CONVERSATION_ACCEPTED` with the new person) or the offer is withdrawn |
| Relations | leads over `PROSPECT_RELATIONSHIP_ESTABLISHED` |
| Date gate | — |
| Relevance window | default |
| Deal effect | none (area 0); inside an open deal the same act toward a decision maker is `PITCH_BUYER_ACCESS_GRANTED` |

**Определение:** Контакт прямо предлагает представить агентство конкретному человеку или роли в целевой компании (руководителю маркетинга, PR, внутренних коммуникаций, закупкам). Нужен ответ от нас: согласиться и подготовить контекст для интро.

**Граница (не считается):** Предложенное знакомство ещё не состоявшееся: когда интро прошло и новый человек ответил, это `PROSPECT_RELATIONSHIP_ESTABLISHED` или `PROSPECT_CONVERSATION_ACCEPTED`. Если по открытой сделке клиент даёт доступ к ЛПР или бизнес-заказчику — `PITCH_BUYER_ACCESS_GRANTED`. Общее «спросите у коллег» без конкретного человека или роли — нет сигнала.

**Признаки для промпта (≤ 8):** «познакомлю вас с», «могу представить вас», «сведу вас с», «давайте сделаю интро», «перешлю ваши контакты», «поговорите с нашим директором по маркетингу», «скину вам её контакт», «напишите ему от моего имени»

**Синонимы и выражения (полный список):**
- Деловая переписка: «готов(а) познакомить вас с», «могу представить вас руководителю», «рекомендую обратиться к», «передам ваши контакты коллеге из», «предлагаю организовать встречу с нашим CMO», «поставлю вас в копию письма коллеге», «можете сослаться на меня»
- Чаты / мессенджеры (разговорный стиль): «сведу вас», «закину вас в общий чат с», «скину контакт», «давай интро сделаю», «напиши ей, скажи, что от меня», «кину ваш номер нашему пиарщику», «перекину на нужного человека»
- Сокращения и термины: «интро», «CMO», «PR-директор», «HR BP», «директор по внутренним коммуникациям», «бренд-менеджер», «закупки»
- Устойчивые конструкции / маркеры: «познакомлю / сведу / представлю вас с» + имя или роль; «скажите, что от» + имя; «поставлю в копию» + роль

**Похоже, но не это (анти-признаки):** «вот контакт нашего бизнес-заказчика по тендеру, он ждёт звонка» при открытой сделке → `PITCH_BUYER_ACCESS_GRANTED`; «познакомились с Ириной, договорились созвониться» → `PROSPECT_CONVERSATION_ACCEPTED`; «у нас новый директор по маркетингу» → `CONTACT_NEW_DECISION_MAKER`; «спросите кого-нибудь в маркетинге» → «нет сигнала».

**Пример (evidence):** «Могу познакомить вас с Мариной, она теперь отвечает за бренд в "Северстали", — скиньте пару слов об агентстве, перешлю ей».
**Контрпример:** «Марина, это Олег из агентства, о котором я говорил, — общайтесь» → интро уже состоялось, это `PROSPECT_RELATIONSHIP_ESTABLISHED` при ответе Марины.

**Заметка для карточки:** Попросить владельца связи принять предложение интро и отправить контакту короткий контекст об агентстве для пересылки.

### `PROSPECT_CONTACT_MOVED` — Знакомый человек перешёл в другую компанию

| Field | Value |
|---|---|
| Pack · block · family | agency · N2 · contact |
| Weight · class · kind · score rule | 5 · chance · event · fixed |
| Effort · asks us · inbound only · amount | quick · no · yes · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (D4) — Q24-2 confirms chance 5 · D4 |
| Recipient role | relationship |
| Closes / closed by | closes: — · closed by: new role and next step recorded |
| Relations | both with `CONTACT_LEAVING` (old-company view, evaluated separately, Q24-2) |
| Date gate | — |
| Relevance window | 60 days (a job move stays a good reason to talk for about two months) |
| Deal effect | none for the new company (no automatic deal); for an open deal of the old company: trigger of `RISK_KEY_CONTACT_LOSS` only under the Q24-2 condition (the person supported this deal and no handover is confirmed) |

**Определение:** Известный агентству контакт сменил работодателя или роль, и новая принадлежность подтверждена (сам сообщил, новая подпись, новый корпоративный адрес). Для агентства это повод развивать отношения в новой компании или в новой роли. Q24-2: код остаётся возможностью (5, D4); переход сам по себе не запускает риск потери ключевого контакта.

**Граница (не считается):** Сообщение «ухожу из компании» без новой подтверждённой принадлежности — `CONTACT_LEAVING`. Новый сотрудник у действующего клиента — `CONTACT_NEW_KNOWN_ORG`. Слух или упоминание третьим лицом без подтверждения — `PROSPECT_CONTACT_MENTIONED`. История с прежней компанией сохраняется; переход не создаёт сделку автоматически.

**Правило процесса (trigger rule):** известный контакт (то же ФИО + телефон или личный адрес) пишет с домена другой организации с новой подписью; обе организации распознаны → экземпляр, доказательство — старая и новая подпись. EN: a known contact — same full name plus phone or personal address — writes from a new organisation domain with a new signature, both organisations resolved → instance with evidence = old and new signature.

**Признаки для промпта (≤ 8):** «я теперь в», «перешёл / перешла в», «с понедельника работаю в», «новое место работы», «мой новый адрес», «сменил(а) работу», «теперь отвечаю за маркетинг в», «пишу уже с новой почты»

**Синонимы и выражения (полный список):**
- Деловая переписка: «сообщаю, что с 1 ноября я работаю в», «перешёл / перешла на позицию директора по коммуникациям в», «прошу использовать мой новый адрес», «теперь представляю компанию», «назначен(а) руководителем PR-службы в», «моя новая должность»
- Чаты / мессенджеры (разговорный стиль): «я теперь в», «я ушла в», «сменил работу, теперь в», «новая работа, новая почта», «перебрался в», «теперь я по ту сторону, в бренде», «пиши сюда, старую почту больше не читаю»
- Сокращения и термины: «CMO», «CCO», «head of PR», «директор по маркетингу», «бренд-директор», новая подпись, новый домен почты
- Устойчивые конструкции / маркеры: «теперь в / работаю в / перешёл в» + название компании; «мой новый адрес / номер» + контакт; подпись с другой компанией у известного человека

**Похоже, но не это (анти-признаки):** «я ухожу из компании, дела передам коллеге» без нового места → `CONTACT_LEAVING`; «у нас в отделе новый сотрудник» → `CONTACT_NEW_KNOWN_ORG`; «слышал, Иван ушёл в Сбер» от третьего лица → `PROSPECT_CONTACT_MENTIONED`; «я больше не веду ваш проект» → `ACCOUNT_SPONSOR_SUPPORT_LOST`.

**Пример (evidence):** «Друзья, с понедельника я директор по коммуникациям в «Ромашка Ритейл», пишите на новую почту — будет интересно обсудить, что можно сделать вместе».
**Контрпример:** «Коллеги, это моё последнее письмо в компании, по всем вопросам — к Елене» → нет подтверждённой новой принадлежности, это `CONTACT_LEAVING`.

**Заметка для карточки:** Попросить владельца связи поздравить контакт с новой ролью, обновить карточку контакта и предложить уместный разговор на новом месте.

### `PROSPECT_CONVERSATION_ACCEPTED` — Согласован ознакомительный разговор

| Field | Value |
|---|---|
| Pack · block · family | agency · N2 · contact |
| Weight · class · kind · score rule | 4 · chance · event · fixed |
| Effort · asks us · inbound only · amount | quick · yes · yes · no |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (D4) |
| Recipient role | relationship |
| Closes / closed by | closes: — · closed by: conversation held (`DELIVERY_PROTOCOL`) or cancelled (`MEETING_CANCEL`) |
| Relations | outranks `PROSPECT_RELATIONSHIP_ESTABLISHED`; Q24-7: Maslov boundary «после go» removed |
| Date gate | — (date → facts) |
| Relevance window | default |
| Deal effect | none (area 0) |

**Определение:** Контакт согласился на знакомственный разговор или встречу с агентством без обязательства по конкретному проекту: обсудить рынок, задачи компании, возможности сотрудничества. Нужно подтвердить тему и время.

**Граница (не считается):** Если контакт в разговоре называет свою конкретную задачу или закупку, это `PROSPECT_NEED_EXPRESSED` или код блока A (`SALES_*`); у Маслова это граница «после go» — по Q24-7 go не требуется. Наше приглашение без согласия контакта — нет сигнала. Брифинг по уже открытой сделке — `PITCH_BRIEFING_ACCEPTED`.

**Признаки для промпта (≤ 8):** «давайте созвонимся», «можем встретиться на следующей неделе», «готов(а) выпить кофе», «удобно в четверг в 15:00», «пришлите приглашение в календарь», «давайте познакомимся поближе», «расскажете, чем занимаетесь», «зум в среду подойдёт»

**Синонимы и выражения (полный список):**
- Деловая переписка: «готовы провести ознакомительную встречу», «предлагаю созвониться, чтобы познакомиться», «будем рады услышать о вашем агентстве», «подтверждаю встречу», «согласен(на) на звонок в», «давайте обсудим возможные форматы сотрудничества»
- Чаты / мессенджеры (разговорный стиль): «давай созвонимся», «го на кофе», «можно в зуме», «давай в четверг», «закинь слот», «ок, во вторник норм», «приходите к нам в офис, поболтаем»
- Сокращения и термины: «зум», «телемост», «Яндекс Телемост», «слот», «кофе-встреча», «интро-колл», «ВКС»
- Устойчивые конструкции / маркеры: «давайте / можем / готов(а)» + «созвониться / встретиться / познакомиться»; «удобно» + день / время; «пришлите приглашение» + календарь

**Похоже, но не это (анти-признаки):** «созвонимся, хотим обсудить запуск нового продукта и нужно агентство» → `PROSPECT_NEED_EXPRESSED`; «давайте встретимся по брифу тендера» при открытой сделке → `PITCH_BRIEFING_ACCEPTED`; «вернёмся к разговору в январе» → `PROSPECT_FOLLOWUP_AGREED`; «встречу придётся отменить» → `MEETING_CANCEL`.

**Пример (evidence):** «Да, давайте познакомимся — удобно в четверг в 16:00 в Телемосте, расскажете, какие проекты вы делали для ритейла».
**Контрпример:** «Спасибо за предложение, но пока не до встреч» → отказ, разговор не согласован, сигнала нет.

**Заметка для карточки:** Попросить владельца связи подтвердить тему и время разговора и подготовить короткий рассказ об агентстве под интересы контакта.

### `PROSPECT_EVENT_RESPONSE` — Получен ответ на приглашение

| Field | Value |
|---|---|
| Pack · block · family | agency · N2 · contact |
| Weight · class · kind · score rule | 2 · fyi · event · fixed |
| Effort · asks us · inbound only · amount | quick · no · yes · no |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (W1) |
| Recipient role | relationship (Maslov «Связь»; colleagues in the spec role `events`, §8.3, are named in the card note) |
| Closes / closed by | closes: — · closed by: `PROSPECT_EVENT_ATTENDED` or the event date has passed |
| Relations | outranked by `PROSPECT_EVENT_ATTENDED` |
| Date gate | — |
| Relevance window | until the event date + 7 days |
| Deal effect | none (area 0) |

**Определение:** Контакт принял или отклонил приглашение агентства на конкретное мероприятие (завтрак, конференцию, презентацию исследования, вечер для клиентов). Если в ответе есть вопрос о мероприятии, на него нужно ответить.

**Граница (не считается):** Ответ о намерении прийти не подтверждает фактическое участие — участие фиксирует `PROSPECT_EVENT_ATTENDED`. Наша рассылка приглашений без ответа — нет сигнала. Приглашение от клиента на его собственное событие — не этот код (`SIGNAL_EVENT_UPCOMING`, блок H припаркован).

**Признаки для промпта (≤ 8):** «спасибо за приглашение, буду», «с удовольствием приду», «к сожалению, не смогу», «зарегистрировался / зарегистрировалась», «можно прийти с коллегой», «подтверждаю участие», «в этот раз не получится», «во сколько начало»

**Синонимы и выражения (полный список):**
- Деловая переписка: «благодарю за приглашение, планирую быть», «подтверждаю своё участие», «к сожалению, в эти даты буду в командировке», «вынужден(а) отказаться», «прошу включить в список гостей коллегу», «уточните, пожалуйста, программу»
- Чаты / мессенджеры (разговорный стиль): «буду!», «приду», «я в деле», «не смогу, сорри», «запиши меня», «а можно +1», «ссылку на трансляцию скинете?»
- Сокращения и термины: «RSVP», «регистрация», «вебинар», «PR-завтрак», «гостевой список», «+1»
- Устойчивые конструкции / маркеры: «спасибо за приглашение» + «буду / не смогу»; «подтверждаю / отменяю участие»; вопрос о времени, месте, программе события

**Похоже, но не это (анти-признаки):** «спасибо за вчерашний завтрак, было полезно» → `PROSPECT_EVENT_ATTENDED`; «давайте после конференции созвонимся» → `PROSPECT_CONVERSATION_ACCEPTED`; «приглашаем вас на наш форум» от клиента → «нет сигнала» (блок H припаркован); автоответ «я в отпуске» → `CONTACT_OOO`.

**Пример (evidence):** «Спасибо за приглашение на презентацию исследования медиапотребления, буду, и можно я возьму с собой руководителя digital?»
**Контрпример:** «Получили ваше приглашение» без ответа да или нет → нет решения о приходе, сигнала нет.

**Заметка для карточки:** Попросить владельца связи вместе с коллегами по мероприятиям отметить ответ в списке гостей и ответить на вопрос контакта, если он есть.

### `PROSPECT_EVENT_ATTENDED` — Подтверждено участие в мероприятии

| Field | Value |
|---|---|
| Pack · block · family | agency · N2 · contact |
| Weight · class · kind · score rule | 2 · fyi · event · fixed |
| Effort · asks us · inbound only · amount | quick · no · no · no |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (W1) |
| Recipient role | relationship |
| Closes / closed by | closes: `PROSPECT_EVENT_RESPONSE` (same event, same person) · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | 30 days |
| Deal effect | none (area 0) |

**Определение:** Контакт действительно участвовал в мероприятии, и факт участия подтверждён: сам контакт пишет о прошедшем событии, коллега агентства оставил заметку о разговоре на месте или организатор отметил присутствие. Inbound only = no: подтверждение может прийти из заметки нашего сотрудника или списка организатора.

**Граница (не считается):** Приглашение и обещание прийти не равны участию — это `PROSPECT_EVENT_RESPONSE`. Регистрация без отметки о присутствии — нет сигнала. Если на мероприятии контакт описал свою задачу — дополнительно `PROSPECT_NEED_EXPRESSED`.

**Признаки для промпта (≤ 8):** «спасибо за вчерашний завтрак», «было приятно увидеться на», «отличное мероприятие», «поговорили с ней на конференции», «был(а) на вашей презентации», «пришёл / пришла, отметили в списке», «спасибо за организацию», «унёс(ла) много идей с вашего события»

**Синонимы и выражения (полный список):**
- Деловая переписка: «благодарю за прекрасно организованное мероприятие», «рад(а) был(а) присутствовать на презентации», «спасибо за возможность послушать спикеров», «по итогам вчерашней встречи на форуме», «пообщались на стенде»
- Чаты / мессенджеры (разговорный стиль): «спасибо за вечер!», «было огонь», «классный завтрак был», «видел тебя на конфе», «зашёл на ваш ивент», «поболтали с ним на афтепати»
- Сокращения и термины: «ивент», «конфа», «афтепати», «стенд», «список присутствующих», «бейдж», «чек-ин»
- Устойчивые конструкции / маркеры: «спасибо за» + прошедшее событие; «был(а) / присутствовал(а) на» + событие; заметка коллеги «говорил(а) с» + имя + «на» + событие; отметка организатора «пришёл / пришла»

**Похоже, но не это (анти-признаки):** «буду на завтраке в четверг» → `PROSPECT_EVENT_RESPONSE`; «зарегистрировалась на вебинар» без отметки о присутствии → «нет сигнала»; «на конференции познакомились, договорились созвониться» → `PROSPECT_CONVERSATION_ACCEPTED`; «на форуме Ольга рассказала, что ищут агентство под ребрендинг» → `PROSPECT_NEED_EXPRESSED`.

**Пример (evidence):** «Спасибо за вчерашний PR-завтрак, было полезно послушать про кризисные коммуникации, коллеги тоже оценили».
**Контрпример:** «Спасибо, обязательно приду на завтрак» → только намерение прийти, это `PROSPECT_EVENT_RESPONSE`.

**Заметка для карточки:** Попросить владельца связи сохранить, о чём говорили с контактом на мероприятии, как повод для следующего разговора.

### `PROSPECT_CONTENT_INTEREST` — Контакт проявил интерес к теме или материалу

| Field | Value |
|---|---|
| Pack · block · family | agency · N2 · contact |
| Weight · class · kind · score rule | 3 · chance · event · fixed |
| Effort · asks us · inbound only · amount | quick · no · yes · no |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (W1) — Q24-1 |
| Recipient role | relationship |
| Closes / closed by | closes: — · closed by: our reply / next conversation agreed (`PROSPECT_CONVERSATION_ACCEPTED`) |
| Relations | outranked by `PROSPECT_NEED_EXPRESSED` |
| Date gate | — |
| Relevance window | default |
| Deal effect | none (area 0) |

**Определение:** Контакт содержательно отреагировал на тему или материал агентства (исследование, статью, кейс, подборку): обсудил его, задал вопрос, попросил продолжение. Q24-1 (важнее Маслова): это интерес к теме или материалу без собственной потребности контакта; вес 3, W1. Общий интерес остаётся в области 0.

**Граница (не считается):** Доставка или открытие рассылки, «лайк», «спасибо, получил» — не интерес (нет сигнала). Если контакт говорит о своей задаче, проблеме или планах компании («нам как раз нужно») — это `PROSPECT_NEED_EXPRESSED`. Просьба прислать общую презентацию услуг — `SALES_CATALOG_REQUESTED`.

**Признаки для промпта (≤ 8):** «интересная статья, можно подробнее», «пришлите полную версию исследования», «а есть данные по нашей отрасли», «поделитесь кейсом», «интересно, как вы это делали», «переслал(а) коллегам», «хочу почитать подробнее», «есть ли запись вебинара»

**Синонимы и выражения (полный список):**
- Деловая переписка: «с интересом прочитал(а) ваш обзор», «можно ли получить полную версию отчёта», «интересует методология исследования», «есть ли аналогичные данные по фармрынку», «поделитесь, пожалуйста, презентацией с вебинара», «хотелось бы обсудить выводы»
- Чаты / мессенджеры (разговорный стиль): «прикольная статья, а есть подробнее?», «скинь запись», «а по нашей нише есть цифры?», «интересно, как вы это сделали», «переслал своим», «зацепило про антикризис»
- Сокращения и термины: «кейс», «исследование», «вайтпейпер», «дайджест», «запись вебинара», «медиаобзор», «тренд-репорт»
- Устойчивые конструкции / маркеры: «интересно / любопытно» + материал + «можно подробнее»; «пришлите / поделитесь» + материал агентства; вопрос по содержанию материала без упоминания своей задачи

**Похоже, но не это (анти-признаки):** «интересно, у нас как раз запуск бренда весной, нужна поддержка» → `PROSPECT_NEED_EXPRESSED`; «пришлите презентацию агентства и прайс» → `SALES_CATALOG_REQUESTED` / `SALES_PRICE_REQUEST`; «давайте созвонимся и обсудим» → `PROSPECT_CONVERSATION_ACCEPTED`; «получил рассылку, спасибо» → «нет сигнала»; общий интерес по открытой сделке без конкретной задачи → `PITCH_NEED_UNCONFIRMED`.

**Пример (evidence):** «Прочитала ваш обзор про внутренние коммуникации в ритейле, очень любопытно — а есть полная версия с цифрами по регионам?»
**Контрпример:** «Спасибо за рассылку» → нет содержательной реакции на тему, сигнала нет.

**Заметка для карточки:** Попросить владельца связи ответить по теме материала и, если уместно, предложить короткий разговор, не предполагая намерения покупать.

### `PROSPECT_NEED_EXPRESSED` — Потенциальный клиент описал потребность

| Field | Value |
|---|---|
| Pack · block · family | agency · N2 · pitch (the topic becomes an opportunity) |
| Weight · class · kind · score rule | 7 · chance · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · yes · yes |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | P6 — Q24-1 replaces Maslov N7 (the N7 profile is removed) |
| Recipient role | new_biz (Q24-1) |
| Closes / closed by | closes: `PROSPECT_CONTENT_INTEREST` (same contact, same theme) · closed by: next step agreed (`PITCH_BRIEFING_ACCEPTED`, `PITCH_SOLUTION_REQUESTED`, `PITCH_CREDENTIALS_REQUESTED`) |
| Relations | outranks `PROSPECT_CONTENT_INTEREST`; both with `SALES_BUDGET_MENTIONED`; Q24-7: go / no-go removed |
| Date gate | — |
| Relevance window | default |
| Deal effect | create_deal at S1 «Новая возможность» (deal_type new_business) when the task is concrete — no internal approval (Q24-1, Q24-7); a vague task stays in area 0 and is clarified there (no deal, Q34) |

**Определение:** Потенциальный клиент сам называет релевантную для агентства собственную задачу, проблему или инициативу своей компании (запуск, ребрендинг, кризис, нужна PR-поддержка, ищут агентство). Q24-1: вес 7, P6, получатель new biz; профиль N7 Маслова отменён. Конкретный проект открывает возможность без внутреннего согласования (go не нужен, Q24-7); если задача ещё размыта, её уточняют в области 0.

**Граница (не считается):** Интерес к теме или материалу без своей задачи — `PROSPECT_CONTENT_INTEREST`. Гипотеза агентства о том, что клиенту «наверняка нужно», — нет сигнала. Официальное приглашение в тендер — `SALES_TENDER_INVITATION`; запрос кейсов для отбора — `PITCH_CREDENTIALS_REQUESTED`; новая задача действующего клиента — `SALES_NEW_DEMAND`.

**Признаки для промпта (≤ 8):** «нам нужно», «ищем агентство», «планируем запуск», «хотим перезапустить бренд», «нужна поддержка по PR», «думаем о ребрендинге», «у нас задача», «не справляемся своими силами с»

**Синонимы и выражения (полный список):**
- Деловая переписка: «рассматриваем привлечение агентства для», «в следующем году планируем вывод нового продукта», «перед нами стоит задача повысить узнаваемость», «нам требуется поддержка в кризисной ситуации», «готовим IPO и нужен IR и PR», «хотим выстроить внутренние коммуникации», «ищем подрядчика на SMM», «бюджет на продвижение заложен»
- Чаты / мессенджеры (разговорный стиль): «нам бы агентство», «есть задачка по пиару», «хотим бренд освежить», «горим с запуском, нужна помощь», «нужен кто-то на соцсети», «не вывозим своими силами», «можете взяться?»
- Сокращения и термины: «PR», «SMM», «GR», «IR», «ребрендинг», «запуск», «вывод на рынок», «антикризис», «внутренние коммуникации», «employer brand», «ATL / BTL», «спецпроект»
- Устойчивые конструкции / маркеры: «нам нужно / нам требуется / ищем» + услуга агентства; «планируем / готовим» + инициатива + «нужна поддержка»; «у нас задача» + цель коммуникаций

**Похоже, но не это (анти-признаки):** «интересная статья про ребрендинг, можно подробнее» → `PROSPECT_CONTENT_INTEREST`; «приглашаем принять участие в тендере» → `SALES_TENDER_INVITATION`; «пришлите кейсы для отбора» → `PITCH_CREDENTIALS_REQUESTED`; действующий клиент: «нужен ещё спецпроект к лету» → `SALES_NEW_DEMAND`; по открытой сделке клиент только «присматривается» → `PITCH_NEED_UNCONFIRMED`.

**Пример (evidence):** «Весной запускаем новую линейку и ищем агентство, которое возьмёт на себя PR и работу с блогерами — сможете предложить подход?»
**Контрпример:** «Наверное, когда-нибудь займёмся брендом, но пока не до этого» → нет конкретной задачи, общий интерес остаётся в области 0, сделка не создаётся.

**Заметка для карточки:** Попросить new biz уточнить предмет задачи, сроки и участников и при конкретном проекте открыть возможность без внутреннего согласования.

### `PROSPECT_FOLLOWUP_AGREED` — Согласовано возвращение к разговору

| Field | Value |
|---|---|
| Pack · block · family | agency · N2 · contact |
| Weight · class · kind · score rule | 4 · chance · event · fixed |
| Effort · asks us · inbound only · amount | quick · yes · yes · no |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (D4); shown at the agreed time, record saved at once (Maslov §5.4) |
| Recipient role | relationship |
| Closes / closed by | closes: — · closed by: contact resumed or the agreement changed |
| Relations | — |
| Date gate | { fact: followUpDate (or followUpCondition text when no date), test: within, setting: `cards.deadlineLeadDays` (quick = 2 working days) } |
| Relevance window | until the agreed date + 10 working days |
| Deal effect | none (area 0); when an open deal exists, a postponed decision on it is `PITCH_DECISION_DELAYED_BY_CLIENT` instead |

**Определение:** Контакт согласовал возвращение к разговору в конкретное время или после определённого события («в январе», «после бюджетного комитета», «когда утвердят стратегию»). Запись сохраняется сразу, напоминание показывается к согласованному моменту.

**Граница (не считается):** Не придумывать точную дату, если клиент назвал только условие — сохранить условие текстом. Вежливое «будем на связи» без момента — нет сигнала или `PROSPECT_RELATIONSHIP_ESTABLISHED`. Перенос решения по открытой сделке — `PITCH_DECISION_DELAYED_BY_CLIENT`; явная приостановка открытой возможности — `PITCH_PAUSED_BY_CLIENT`.

**Признаки для промпта (≤ 8):** «вернёмся после бюджетного комитета», «напишите в январе», «давайте вернёмся к разговору после», «наберите после праздников», «когда утвердим стратегию, свяжемся», «давайте в следующем квартале», «напомните о себе в», «сейчас не время, но осенью — да»

**Синонимы и выражения (полный список):**
- Деловая переписка: «предлагаю вернуться к обсуждению в начале года», «будем готовы обсудить после утверждения бюджета», «просим связаться с нами после 15 января», «вернёмся к вопросу по итогам планирования», «давайте запланируем повторный разговор на март», «после смены руководства будем готовы обсудить»
- Чаты / мессенджеры (разговорный стиль): «напиши после НГ», «стукни мне в феврале», «давай ближе к осени», «после отпуска вернёмся», «сейчас завал, давай через месяц», «пингани в январе»
- Сокращения и термины: «бюджетный комитет», «бюджетирование», «Q1 / первый квартал», «после НГ», «стратсессия», «планирование на год»
- Устойчивые конструкции / маркеры: «вернёмся / свяжемся / напишите» + дата или событие; «после» + событие (комитет, праздники, утверждение); «в» + месяц / квартал

**Похоже, но не это (анти-признаки):** «решение по выбору агентства переносим на декабрь» при открытой сделке → `PITCH_DECISION_DELAYED_BY_CLIENT`; «проект ставим на паузу до весны» → `PITCH_PAUSED_BY_CLIENT`; «давайте созвонимся в четверг» → `PROSPECT_CONVERSATION_ACCEPTED`; «будем на связи» без момента → «нет сигнала».

**Пример (evidence):** «Сейчас бюджет на следующий год ещё не утверждён — давайте вернёмся к разговору после бюджетного комитета в середине декабря».
**Контрпример:** «Спасибо, будем иметь вас в виду» → нет согласованного момента или условия возвращения, сигнала нет.

**Заметка для карточки:** Попросить владельца связи вернуться к контакту в согласованный момент или после названного условия, используя сохранённый контекст разговора.

### `PROSPECT_CONTACT_MENTIONED` — Получен релевантный повод о знакомом контакте

| Field | Value |
|---|---|
| Pack · block · family | agency · N2 · contact |
| Weight · class · kind · score rule | 2 · fyi · event · fixed |
| Effort · asks us · inbound only · amount | quick · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (W1) |
| Recipient role | relationship |
| Closes / closed by | closes: — · closed by: — (reason recorded or expired) |
| Relations | outranked by `PROSPECT_CONTACT_MOVED` for the same person |
| Date gate | — |
| Relevance window | 30 days |
| Deal effect | none (area 0) |

**Определение:** Подтверждено содержательное упоминание знакомого агентству человека, полезное для поддержания связи: интервью, выступление, награда, повышение, новость компании с его участием, рассказ коллеги или клиента. Код ставит парсер (заметка коллеги, слова клиента), позже — внешний источник (пресса, spec §5.6). Упоминание не доказывает намерения что-либо купить.

**Граница (не считается):** Подтверждённый переход человека в другую компанию — `PROSPECT_CONTACT_MOVED`. Новость о компании без связи с конкретным знакомым человеком — блок H (припаркован), нет сигнала. Слух без источника — нет сигнала.

**Признаки для промпта (≤ 8):** «видел(а) интервью с», «выступал(а) на», «получил(а) премию», «её повысили», «он теперь руководит направлением», «в новостях про», «коллега рассказал(а), что», «отличная колонка у»

**Синонимы и выражения (полный список):**
- Деловая переписка: «обратил(а) внимание на интервью вашего директора», «поздравляем с назначением на должность», «в отраслевом издании вышла колонка», «стал(а) спикером конференции», «вошёл / вошла в рейтинг», «компания объявила о назначении»
- Чаты / мессенджеры (разговорный стиль): «видела Ольгу в подкасте», «он на РБК сегодня», «её повысили, кстати», «Сергей выиграл премию», «читал его пост, огонь», «слышал, они с ней запускают новое направление»
- Сокращения и термины: «колонка», «подкаст», «рейтинг», «премия», «назначение», «спикер», «пост в канале»
- Устойчивые конструкции / маркеры: «видел(а) / читал(а)» + материал + «с» + знакомый человек; «поздравляем с» + повод; «коллега рассказал(а), что» + знакомый человек + событие

**Похоже, но не это (анти-признаки):** «я теперь работаю в другой компании» → `PROSPECT_CONTACT_MOVED`; «уходит из компании в конце месяца» → `CONTACT_LEAVING`; «у компании новый директор по маркетингу» без знакомого человека → `CONTACT_NEW_DECISION_MAKER` или «нет сигнала» (блок H); «он упомянул, что ищут агентство» → `PROSPECT_NEED_EXPRESSED`.

**Пример (evidence):** «Кстати, видел интервью Алексея из "Росатома" на РБК про коммуникации в атомной отрасли — хороший повод ему написать».
**Контрпример:** «Алексей перешёл в "Ростех" директором по коммуникациям» → подтверждённый переход, это `PROSPECT_CONTACT_MOVED`.

**Заметка для карточки:** Попросить владельца связи сохранить повод и, если уместно, использовать его для короткого личного сообщения без коммерческого предложения.

## N3 · Аккаунт

Delivery and development of a running account (Maslov §2.3, §3.3). These codes change the state of the running contract or work. They never rewrite the history of a won sale. Only `CONTRACT_RETENDER_ANNOUNCED` opens an opportunity (re-pitch), and `CONTRACT_CONTINUATION_CONFIRMED` / `CONTRACT_RENEWAL_DECLINED` act on an open renewal opportunity.

| Code | Название (RU) | W | Class | Kind | Score rule | Effort | Asks us | Inbound only | Amount | Stage (pack) | IN4COM | Profile | Recipient | Family |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `DELIVERY_ACCEPTANCE_GRANTED` | Клиент принял результат | 3 | fyi | event | fixed | quick | no | yes | no | active | n/a | S1 | account | delivery |
| `DELIVERY_ACCEPTANCE_WITHHELD` | Клиент отказал в приёмке результата | 7 | risk | event | fixed | medium | yes | yes | no | active | n/a | P6 | account | delivery |
| `DELIVERY_CHANGE_REQUESTED` | Изменились задачи внутри оплаченного объёма | 5 | chance | event | fixed | medium | yes | yes | no | active | n/a | D4 | account | delivery |
| `DELIVERY_CLIENT_DEPENDENCY_DELAYED` | Клиент задержал необходимый для работы шаг | 6 | risk | event | fixed | medium | yes | yes | no | active | n/a | P6 | account | delivery |
| `COMPLAINT_RESOLUTION_CONFIRMED` | Клиент подтвердил устранение проблемы | 3 | fyi | event | fixed | quick | no | yes | no | active | n/a | S1 | account | complaint |
| `ACCOUNT_SPONSOR_SUPPORT_LOST` | Ключевой сторонник перестал поддерживать работу | 7 | risk | event | fixed | medium | no | yes | no | active | n/a | P6 | account | account |
| `ACCOUNT_SERVICE_REVIEW_REQUESTED` | Клиент инициировал пересмотр обслуживания | 6 | risk | event | fixed | medium | yes | yes | no | active | n/a | P6 | account | account |
| `INVOICE_DISPUTE_RAISED` | Клиент оспорил счёт | 7 | risk | event | fixed | medium | yes | yes | yes | active | n/a | P6 | finance | invoice |
| `INVOICE_DISPUTE_RESOLVED` | Спор по счёту урегулирован | 3 | fyi | event | fixed | quick | no | yes | yes | active | n/a | S1 | finance | invoice |
| `ACCOUNT_INCREMENTAL_WORK_SLOWDOWN` | Сокращаются дополнительные проекты | 5 | risk | trend | fixed | medium | no | yes | yes | active | n/a | D4 (trend ceiling, Q24-6) | account | account |
| `CONTRACT_CONTINUATION_CONFIRMED` | Клиент подтвердил намерение продолжать работу | 7 | chance | event | fixed | medium | no | yes | yes | active | n/a | P6 | account | contract |
| `CONTRACT_RENEWAL_DECLINED` | Клиент отказался от следующего периода | 8 | risk | event | fixed | medium | no | yes | yes | active | n/a | P8 | account | contract |
| `CONTRACT_RETENDER_ANNOUNCED` | Объявлен повторный конкурс за текущий договор | 7 | risk | event | fixed | complex | yes | yes | yes | active | n/a | P6 | account | contract |
| `ACCOUNT_WORK_PAUSED_BY_CLIENT` | Клиент приостановил действующую работу | 7 | risk | event | fixed | medium | no | yes | yes | active | n/a | P6 | account | account |
| `ACCOUNT_PRIORITIES_CHANGED` | Клиент сообщил о новых приоритетах | 4 | chance | event | fixed | medium | no | yes | no | active | n/a | D4 | account | account |

### `DELIVERY_ACCEPTANCE_GRANTED` — Клиент принял результат

| Field | Value |
|---|---|
| Pack · block · family | agency · N3 · delivery |
| Weight · class · kind · score rule | 3 · fyi · event · fixed |
| Effort · asks us · inbound only · amount | quick · no · yes · no |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | S1 — fixed by Maslov §5.4: a closing fact. It updates the linked card and its history. If no linked question exists, it is shown as W1 information. |
| Recipient role | account |
| Closes / closed by | closes: `DELIVERY_ACCEPTANCE_WITHHELD` of the same result only · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | none |

**Определение:** Клиент явно принял конкретный результат или этап работы: согласовал финальную версию, подписал акт, закрыл этап. Факт приёмки относится к названному результату.

**Граница (не считается):** Похвала без приёмки не закрывает обязательство по результату (→ `FEEDBACK_QUALITY_PRAISE`). Приёмка одного результата не закрывает другие жалобы и отказы по другим результатам. Подтверждение оплаты — это `INVOICE_PAID`.

**Признаки для промпта (≤ 8):** «принимаем», «финальную версию согласовали», «акт подписали», «этап закрыт», «вопросов по материалам больше нет», «утверждаем, можно публиковать», «отчёт приняли», «работу приняли без замечаний»

**Синонимы и выражения (полный список):**
- Деловая переписка: «результат принят», «принимаем работы по этапу», «акт сдачи-приёмки подписан», «подписанный акт направляем во вложении», «отчёт за квартал принят», «финальная версия утверждена», «замечаний к материалам нет», «этап считаем завершённым», «согласовали итоговый вариант»
- Чаты / мессенджеры (разговорный стиль): «всё ок, принимаем», «утвердили, запускайте», «финалка согласована», «акт подписала, скан скинула», «можно выкладывать», «приняли, спасибо», «закрываем этап»
- Сокращения и термины: «акт», «УПД», «КС» (в смысле «закрывающие»), «финальный макет», «ключевой визуал утверждён», «пресс-релиз согласован»
- Устойчивые конструкции / маркеры: «принимаем» + результат; «согласовали / утвердили» + «финальную версию / итоговый вариант»; «акт» + «подписан / подписали»

**Похоже, но не это (анти-признаки):** «Отличная работа, всем понравилось» без приёмки → `FEEDBACK_QUALITY_PRAISE`; «Исправление приняли, вопрос закрыт» по ранее заявленной жалобе → `COMPLAINT_RESOLUTION_CONFIRMED`; «Оплату провели» → `INVOICE_PAID`; «Получили, посмотрим» → «нет сигнала».

**Пример (evidence):** «Финальную версию презентации для дилеров согласовали, акт по второму этапу подписали — скан во вложении.»
**Контрпример:** «Спасибо, получили макеты, вернёмся с комментариями до среды» → это подтверждение получения, приёмки нет.

**Заметка для карточки:** Отметить приёмку названного результата и закрыть связанный отказ в приёмке; новое действие директору аккаунта не ставить.

### `DELIVERY_ACCEPTANCE_WITHHELD` — Клиент отказал в приёмке результата

| Field | Value |
|---|---|
| Pack · block · family | agency · N3 · delivery |
| Weight · class · kind · score rule | 7 · risk · event · fixed |
| Effort · asks us · inbound only · amount | medium · yes · yes · no |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (P6) |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: `DELIVERY_ACCEPTANCE_GRANTED` (same result) |
| Relations | both with `COMPLAINT_QUALITY` / `COMPLAINT_QUANTITY` (one incident card) |
| Date gate | — |
| Relevance window | default |
| Deal effect | none |

**Определение:** Клиент явно не принял результат или этап работы либо поставил существенные условия приёмки: не подписывает акт, возвращает работу с условием «примем после исправления».

**Граница (не считается):** Обычные комментарии и правки без отказа в приёмке не являются непринятым результатом (→ «нет сигнала»). Запрос существенной доработки до получения заказа, в рамках отбора — это `PITCH_REVISION_REQUESTED`. Жалоба без связи с приёмкой — соответствующий `COMPLAINT_*`.

**Признаки для промпта (≤ 8):** «акт не подпишем», «не принимаем», «в таком виде принять не можем», «примем только после исправления», «акт возвращаем», «результат не соответствует ТЗ», «этап не закрываем», «отчёт не принят»

**Синонимы и выражения (полный список):**
- Деловая переписка: «акт сдачи-приёмки подписать не можем», «направляем мотивированный отказ от приёмки», «работы не приняты», «результат не соответствует техническому заданию», «отчёт не принят, требуется доработка», «приёмку этапа откладываем до устранения замечаний», «подпишем акт после исправления замечаний»
- Чаты / мессенджеры (разговорный стиль): «так не примем», «акт пока не подписываю», «это не то, что заказывали», «переделайте, тогда закроем этап», «финалку не утверждаем», «в таком виде не пропущу»
- Сокращения и термины: «акт», «мотивированный отказ», «ТЗ», «приёмка», «замечания к акту», «протокол разногласий»
- Устойчивые конструкции / маркеры: «не можем / не будем» + «принять / подписать акт»; «примем после» + условие; «возвращаем» + акт / отчёт

**Похоже, но не это (анти-признаки):** «Пара правок по тексту и можно публиковать» → «нет сигнала»; «Не нравится концепция, сделайте ещё вариант» до заказа → `PITCH_REVISION_REQUESTED`; «Ролик вышел с опозданием на неделю» без отказа в приёмке → `COMPLAINT_TIMING`; «Публикаций меньше, чем в плане» → `COMPLAINT_QUANTITY` (вместе с этим кодом, если акт не подписывают).

**Пример (evidence):** «Отчёт по охватам за октябрь принять не можем: нет данных по двум площадкам. Акт подпишем после доработки.»
**Контрпример:** «Посмотрели отчёт, в целом хорошо, добавьте, пожалуйста, слайд с выводами» → обычная правка, приёмка не отклонена.

**Заметка для карточки:** Директору аккаунта согласовать с клиентом исправления, ответственного и срок, чтобы результат был принят.

### `DELIVERY_CHANGE_REQUESTED` — Изменились задачи внутри оплаченного объёма

| Field | Value |
|---|---|
| Pack · block · family | agency · N3 · delivery |
| Weight · class · kind · score rule | 5 · chance · event · fixed |
| Effort · asks us · inbound only · amount | medium · yes · yes · no |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (D4) |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: the updated plan is agreed and the request is done |
| Relations | boundary vs `SALES_NEW_DEMAND` (extra paid work) and `PITCH_SCOPE_WITHOUT_ADJUSTMENT` (scope grows, price and date kept, before the order) |
| Date gate | — |
| Relevance window | default |
| Deal effect | none (no sale is created, Maslov §3.3) |

**Определение:** Клиент меняет задачи, приоритеты или состав работ в пределах уже согласованного и оплачиваемого объёма (ретейнер, абонентские часы, утверждённый план). Общий объём и бюджет не меняются.

**Граница (не считается):** Дополнительная оплачиваемая работа сверх объёма — `SALES_NEW_DEMAND`. Расширение объёма при прежних цене и сроке до получения заказа — `PITCH_SCOPE_WITHOUT_ADJUSTMENT`. Новые цели без конкретной задачи — `ACCOUNT_PRIORITIES_CHANGED`.

**Признаки для промпта (≤ 8):** «в рамках ретейнера», «поменяем приоритеты», «вместо этого сделайте», «перенесём часы на», «замените пост на», «в счёт текущего пакета», «сдвинем задачу на следующий месяц», «переставим очерёдность»

**Синонимы и выражения (полный список):**
- Деловая переписка: «просим перераспределить часы в рамках текущего договора», «предлагаем заменить запланированную активность», «в пределах согласованного бюджета», «прошу скорректировать контент-план на ноябрь», «приоритет смещается на запуск», «в счёт абонентского обслуживания», «без изменения общей стоимости»
- Чаты / мессенджеры (разговорный стиль): «давайте вместо поста сторис», «рассылку пока не делаем, лучше подготовьте Q&A», «часы с дизайна перекиньте на тексты», «спецпроект сдвигаем, сначала релиз», «этот пункт выкидываем, вместо него интервью»
- Сокращения и термины: «ретейнер», «абонентка», «контент-план», «медиаплан», «пакет часов», «SOW», «ТЗ в рамках договора»
- Устойчивые конструкции / маркеры: «вместо» + задача; «в рамках / в пределах» + «ретейнера / договора / бюджета»; «перенести / перераспределить» + часы / задачи

**Похоже, но не это (анти-признаки):** «Нужен ещё отдельный спецпроект к Новому году, пришлите смету» → `SALES_NEW_DEMAND`; «Добавьте ещё два направления, бюджет и сроки прежние» в отборе → `PITCH_SCOPE_WITHOUT_ADJUSTMENT`; «В следующем году фокус на HR-бренде» без задачи → `ACCOUNT_PRIORITIES_CHANGED`.

**Пример (evidence):** «В рамках ретейнера давайте в ноябре вместо двух постов сделаем серию сторис к запуску, общий объём тот же.»
**Контрпример:** «Кроме ретейнера нужна отдельная кампания к запуску, сколько будет стоить?» → это дополнительная оплачиваемая работа, `SALES_NEW_DEMAND`.

**Заметка для карточки:** Директору аккаунта согласовать с клиентом новые приоритеты, результат и сроки внутри текущего объёма.

### `DELIVERY_CLIENT_DEPENDENCY_DELAYED` — Клиент задержал необходимый для работы шаг

| Field | Value |
|---|---|
| Pack · block · family | agency · N3 · delivery |
| Weight · class · kind · score rule | 6 · risk · event · fixed |
| Effort · asks us · inbound only · amount | medium · yes · yes · no |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (P6) |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: materials or decision received, plan updated |
| Relations | boundary vs `PITCH_CLIENT_COMMITMENT_BROKEN` (the same type of delay before the order) |
| Date gate | — |
| Relevance window | default |
| Deal effect | none |

**Определение:** Клиент подтвердил задержку материалов, согласования, доступа или решения, без которых агентство не может продолжать исполнение по действующему проекту.

**Граница (не считается):** Задержка ответа в отборе до получения заказа — `PITCH_CLIENT_COMMITMENT_BROKEN`. Задержка по вине агентства — это жалоба `COMPLAINT_TIMING`. Перенос встречи без блокировки работы — «нет сигнала» или `MEETING_DELAYED`.

**Признаки для промпта (≤ 8):** «согласование затягивается», «юристы ещё смотрят», «исходники пришлём позже», «спикер пока не подтвердил», «доступы ещё не выдали», «бриф задерживается», «пока не можем дать комментарий», «ждём одобрения руководства»

**Синонимы и выражения (полный список):**
- Деловая переписка: «согласование со стороны компании задерживается», «материалы будут предоставлены позднее», «юридическая служба ещё не завершила проверку», «решение по макетам пока не принято», «комплаенс ещё не дал заключение», «предоставить данные к оговорённому сроку не получится», «руководство пока не утвердило»
- Чаты / мессенджеры (разговорный стиль): «юристы ещё смотрят, не дёргайте пока», «фотки с производства будут на следующей неделе», «спикер в отпуске, комментарий позже», «логотипы в векторе пока не нашли», «доступ в кабинет дадим, но не сегодня», «шеф ещё не посмотрел»
- Сокращения и термины: «исходники», «доступы», «комплаенс», «юр. отдел», «пресс-служба», «визирование», «одобрение HQ», «глобальное согласование»
- Устойчивые конструкции / маркеры: «пока не» + «согласовали / прислали / подтвердили»; «задерживается / затягивается» + согласование / материалы; «будет позже / на следующей неделе» + материалы

**Похоже, но не это (анти-признаки):** «Бриф для тендера обещали до пятницы, но не успеваем» до заказа → `PITCH_CLIENT_COMMITMENT_BROKEN`; «Вы сорвали сроки публикации» → `COMPLAINT_TIMING`; «Ставим проект на паузу до весны» → `ACCOUNT_WORK_PAUSED_BY_CLIENT`; «Перенесём статус на четверг» → «нет сигнала».

**Пример (evidence):** «Пресс-релиз пока на согласовании у юристов глобального офиса, раньше следующей среды визу не получим, рассылку придётся сдвинуть.»
**Контрпример:** «Пресс-релиз согласовали, можно отправлять» → задержки нет; это обычное движение работы.

**Заметка для карточки:** Директору аккаунта согласовать с клиентом недостающий шаг, новый срок и последствия для графика работ.

### `COMPLAINT_RESOLUTION_CONFIRMED` — Клиент подтвердил устранение проблемы

| Field | Value |
|---|---|
| Pack · block · family | agency · N3 · complaint |
| Weight · class · kind · score rule | 3 · fyi · event · fixed |
| Effort · asks us · inbound only · amount | quick · no · yes · no |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | S1 — fixed by Maslov §5.4: a closing fact. It closes the linked complaint card and stops its repeats; if nothing is linked, W1 information. |
| Recipient role | account |
| Closes / closed by | closes: `COMPLAINT_QUALITY`, `COMPLAINT_QUANTITY`, `COMPLAINT_TIMING`, `COMPLAINT_COMM`, `COMPLAINT_PRICE`, `COMPLAINT_ESCALATED` — only the named complaint on the same topic · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | none |

**Определение:** Клиент явно подтвердил, что конкретная ранее заявленная проблема исправлена и вопрос закрыт. Подтверждение относится к названной жалобе и её эскалации.

**Граница (не считается):** Общая похвала не закрывает жалобу (→ `FEEDBACK_QUALITY_PRAISE` / `FEEDBACK_COMM_PRAISE`, spec §2.1 правило 7). Подтверждение по одной жалобе не закрывает другие жалобы того же клиента. Наше сообщение «мы всё исправили» без ответа клиента — «нет сигнала».

**Признаки для промпта (≤ 8):** «исправление приняли», «вопрос закрыт», «проблема решена», «теперь всё корректно», «претензий больше нет», «инцидент считаем закрытым», «замечание снято», «спасибо, что оперативно поправили»

**Синонимы и выражения (полный список):**
- Деловая переписка: «подтверждаем устранение замечания», «претензию снимаем», «инцидент считаем урегулированным», «исправленная версия принята», «вопрос по публикации закрыт», «ошибка в материалах устранена, спасибо», «к данному вопросу больше не возвращаемся»
- Чаты / мессенджеры (разговорный стиль): «всё, теперь ок», «вопрос закрыт, спасибо», «поправили, вижу, норм», «претензий нет», «закрываем тему», «спасибо, что быстро разрулили»
- Сокращения и термины: «претензия», «инцидент», «замечание», «опровержение вышло», «правка в СМИ опубликована»
- Устойчивые конструкции / маркеры: «вопрос / тема / инцидент» + «закрыт(а)»; «претензию / замечание» + «снимаем / снято»; «исправление» + «приняли / видим»

**Похоже, но не это (анти-признаки):** «Вы молодцы, кампания отличная» без ссылки на жалобу → `FEEDBACK_QUALITY_PRAISE`; «Финальную версию согласовали, акт подписали» → `DELIVERY_ACCEPTANCE_GRANTED`; «Спор по счёту урегулировали» → `INVOICE_DISPUTE_RESOLVED`; «Мы всё исправили» (от нас) → «нет сигнала».

**Пример (evidence):** «Исправленную версию интервью в издании видим, ошибку в должности поправили. Вопрос закрыт, спасибо.»
**Контрпример:** «Спасибо за оперативность, а по срокам отчёта что?» → жалоба на сроки остаётся открытой, закрывающего подтверждения нет.

**Заметка для карточки:** Закрыть названную жалобу и её эскалацию, сохранить подтверждение клиента в истории; другие жалобы не трогать.

### `ACCOUNT_SPONSOR_SUPPORT_LOST` — Ключевой сторонник перестал поддерживать работу

| Field | Value |
|---|---|
| Pack · block · family | agency · N3 · account |
| Weight · class · kind · score rule | 7 · risk · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · yes · no |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (P6) |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: support restored or a new decision route agreed (`PITCH_BUYER_ACCESS_GRANTED`, `CONTACT_NEW_DECISION_MAKER` with a confirmed role) |
| Relations | both with `CONTACT_LEAVING` |
| Date gate | — |
| Relevance window | default |
| Deal effect | trigger of RISK_KEY_CONTACT_LOSS (condition per Q24-2: the person supported this deal and no handover / working access is confirmed) |

**Определение:** Ключевой человек у клиента, который поддерживал работу с агентством, прямо отказался от поддержки, больше не отвечает за решение или передал вопрос другому сотруднику.

**Граница (не считается):** Новый человек в переписке сам по себе не доказывает потерю поддержки (→ `CONTACT_NEW_KNOWN_ORG` или «нет сигнала»). Уход сотрудника из компании — `CONTACT_LEAVING` (может идти вместе с этим кодом). Временное отсутствие с заместителем — `CONTACT_OOO`.

**Признаки для промпта (≤ 8):** «я больше не веду этот проект», «вопрос передан коллеге», «у нас новый CMO, он пока не в теме», «решения теперь принимает», «меня сняли с направления», «я больше не могу вас продвигать», «бюджет теперь не у меня», «дальше без меня»

**Синонимы и выражения (полный список):**
- Деловая переписка: «с понедельника направление курирует другой руководитель», «я больше не отвечаю за маркетинговые коммуникации», «решение по подрядчикам перешло к новому директору», «к сожалению, я не смогу дальше поддерживать ваше предложение», «вопрос передан в зону ответственности коллеги», «меня перевели в другое подразделение»
- Чаты / мессенджеры (разговорный стиль): «я тут больше ничего не решаю», «меня от бренда отодвинули», «теперь всё через нового CMO», «я за вас топила, но дальше не могу», «передала вас коллеге, пишите ей», «я уже не в этой истории»
- Сокращения и термины: «CMO», «бренд-директор», «ЛПР», «спонсор проекта», «куратор», «оргструктура поменялась»
- Устойчивые конструкции / маркеры: «больше не» + «веду / отвечаю / курирую»; «передан(а) / перешло» + «коллеге / новому руководителю»; «не смогу» + «поддержать / продвигать»

**Похоже, но не это (анти-признаки):** «Я ухожу из компании в конце месяца» → `CONTACT_LEAVING`; «В отпуске до 20.11, по срочным вопросам — коллега» → `CONTACT_OOO`; «Знакомьтесь, наш новый руководитель digital» без отказа прежнего спонсора → `CONTACT_NEW_DECISION_MAKER`; «В копии новый коллега из закупок» → `CONTACT_NEW_KNOWN_ORG`.

**Пример (evidence):** «Коллеги, с декабря коммуникации передают новому директору по маркетингу, я больше не принимаю решения по агентствам.»
**Контрпример:** «Подключаю к переписке коллегу из PR, она поможет с релизом» → новый участник, прежний сторонник остаётся.

**Заметка для карточки:** Директору аккаунта определить нового владельца решения у клиента и согласовать план сохранения отношений.

### `ACCOUNT_SERVICE_REVIEW_REQUESTED` — Клиент инициировал пересмотр обслуживания

| Field | Value |
|---|---|
| Pack · block · family | agency · N3 · account |
| Weight · class · kind · score rule | 6 · risk · event · fixed |
| Effort · asks us · inbound only · amount | medium · yes · yes · no |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (P6) |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: review results confirmed by the client (`CONTRACT_CONTINUATION_CONFIRMED` or user) |
| Relations | both with `COMPLAINT_*` of the same account |
| Date gate | — |
| Relevance window | default |
| Deal effect | trigger of RISK_ACCOUNT_REVIEW |

**Определение:** Клиент запросил содержательный пересмотр качества, состава команды, формата или порядка обслуживания по действующей работе: аудит агентства, оценку подрядчика, разговор о том, что нужно менять.

**Граница (не считается):** Плановая статус-встреча или ежемесячный отчёт без намерения пересматривать работу — «нет сигнала» или `DELIVERY_REPORT_REQUESTED`. Объявленный повторный конкурс за договор — `CONTRACT_RETENDER_ANNOUNCED`. Отдельная жалоба без запроса пересмотра — соответствующий `COMPLAINT_*`.

**Признаки для промпта (≤ 8):** «проведём аудит подрядчиков», «пересмотреть формат сотрудничества», «оценка агентства по итогам года», «нас не устраивает, как выстроена работа», «давайте обсудим, что менять», «хотим пересобрать команду на проекте», «встреча по итогам работы с вами», «есть вопросы к качеству обслуживания»

**Синонимы и выражения (полный список):**
- Деловая переписка: «инициируем пересмотр условий обслуживания», «по итогам года проводим оценку подрядчиков», «предлагаем встречу для обсуждения качества работы агентства», «просим представить план улучшений», «рассматриваем изменение модели сотрудничества», «требуется пересмотр состава проектной команды»
- Чаты / мессенджеры (разговорный стиль): «нам надо серьёзно поговорить про формат работы», «руководство спрашивает, что мы получаем за ретейнер», «давайте разберём, что не так», «аккаунт меняйте, не тянет», «будем решать, как дальше работаем»
- Сокращения и термины: «аудит агентства», «agency review», «оценка подрядчика», «KPI агентства», «scorecard», «QBR», «SLA»
- Устойчивые конструкции / маркеры: «пересмотреть / пересобрать» + «формат / команду / модель»; «аудит / оценка» + «агентства / подрядчиков»; «что менять» + в работе

**Похоже, но не это (анти-признаки):** «Пришлите отчёт за квартал к пятнице» → `DELIVERY_REPORT_REQUESTED`; «В следующем году объявляем конкурс на коммуникации» → `CONTRACT_RETENDER_ANNOUNCED`; «Опять сорвали сроки» без запроса пересмотра → `COMPLAINT_TIMING`; «Плановый статус в четверг в силе?» → «нет сигнала».

**Пример (evidence):** «По итогам года проводим оценку всех агентств. Хотим отдельно встретиться и обсудить, что нужно менять в команде и формате отчётности.»
**Контрпример:** «Давайте в четверг обычный статус по проектам» → плановая встреча без намерения пересматривать работу.

**Заметка для карточки:** Директору аккаунта выяснить причины пересмотра и согласовать с клиентом план изменений и дальнейшие условия работы.

### `INVOICE_DISPUTE_RAISED` — Клиент оспорил счёт

| Field | Value |
|---|---|
| Pack · block · family | agency · N3 · invoice |
| Weight · class · kind · score rule | 7 · risk · event · fixed |
| Effort · asks us · inbound only · amount | medium · yes · yes · yes |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (P6) |
| Recipient role | finance |
| Closes / closed by | closes: — · closed by: `INVOICE_DISPUTE_RESOLVED` (same invoice) |
| Relations | both with `INVOICE_OVERDUE` (Maslov §5.5: one card per invoice, two facts; the dispute does not replace the overdue) |
| Date gate | — |
| Relevance window | default |
| Deal effect | none |

**Определение:** Клиент оспорил сумму, основание или состав конкретного счёта или акта, в том числе до наступления даты оплаты. Номер счёта и сумма спора сохраняются в фактах.

**Граница (не считается):** Просрочка оплаты без спора — `INVOICE_OVERDUE`. Недовольство общим уровнем цен без спора по счёту — `COMPLAINT_PRICE`. Просьба прислать счёт или исправить реквизиты без спора по сумме — «нет сигнала».

**Признаки для промпта (≤ 8):** «не согласны с суммой счёта», «в счёте лишние часы», «нет основания для выставления», «эти работы не заказывали», «счёт к оплате не принимаем», «сумма не соответствует договору», «просим скорректировать счёт», «по акту есть разногласия»

**Синонимы и выражения (полный список):**
- Деловая переписка: «оспариваем счёт № 124», «выставленная сумма превышает согласованную смету», «работы по пункту 3 не согласовывались», «счёт не может быть принят к оплате в текущем виде», «направляем протокол разногласий», «просим обосновать количество часов», «стоимость не соответствует приложению к договору»
- Чаты / мессенджеры (разговорный стиль): «в счёте лишние часы, откуда они?», «мы это не заказывали», «финансы счёт не пропустят», «сумма какая-то не та», «за продакшн же договаривались дешевле», «откуда допрасходы?»
- Сокращения и термины: «счёт», «акт», «УПД», «протокол разногласий», «смета», «тайм-шит», «перерасход», «ПКО»
- Устойчивые конструкции / маркеры: «не согласны / оспариваем» + «счёт / сумму / акт»; «не заказывали / не согласовывали» + работы; «просим скорректировать / пересчитать» + счёт

**Похоже, но не это (анти-признаки):** «Счёт 124 до сих пор не оплачен» с нашей стороны / напоминание → `INVOICE_OVERDUE`; «Ваши ставки слишком высокие» без конкретного счёта → `COMPLAINT_PRICE`; «Перевыставьте счёт на новое юрлицо» → «нет сигнала»; «Спор по счёту закрыли, оплатим» → `INVOICE_DISPUTE_RESOLVED`.

**Пример (evidence):** «По счёту № 318 не согласны с суммой: в нём 40 часов дизайна сверх сметы, которые мы не согласовывали. Оплатить в таком виде не можем.»
**Контрпример:** «Счёт получили, передали в оплату, срок по договору 30 дней» → подтверждение получения, спора нет.

**Заметка для карточки:** Финансам вместе с директором аккаунта согласовать с клиентом основание, сумму и порядок урегулирования по названному счёту.

### `INVOICE_DISPUTE_RESOLVED` — Спор по счёту урегулирован

| Field | Value |
|---|---|
| Pack · block · family | agency · N3 · invoice |
| Weight · class · kind · score rule | 3 · fyi · event · fixed |
| Effort · asks us · inbound only · amount | quick · no · yes · yes |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | S1 — fixed by Maslov §5.4: a closing fact. It closes the dispute on the linked invoice card; if nothing is linked, W1 information. |
| Recipient role | finance |
| Closes / closed by | closes: `INVOICE_DISPUTE_RAISED` (same invoice); does NOT close `INVOICE_OVERDUE` · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | none |

**Определение:** Клиент подтвердил решение конкретного спора по счёту: согласился с суммой, принял скорректированный счёт или подписал акт после разногласий.

**Граница (не считается):** Урегулирование не подтверждает оплату (→ `INVOICE_PAID`). Неоплаченный остаток учитывается отдельно как `INVOICE_OVERDUE`. Наше предложение скорректировать счёт без согласия клиента — «нет сигнала».

**Признаки для промпта (≤ 8):** «с суммой согласны», «скорректированный счёт принимаем», «разногласия сняты», «вопрос по счёту закрыт», «акт подписали после правок», «принимаем к оплате», «пересчёт устраивает», «спор урегулирован»

**Синонимы и выражения (полный список):**
- Деловая переписка: «скорректированный счёт принят к оплате», «разногласия по акту урегулированы», «протокол разногласий согласован», «с обоснованием часов согласны», «претензий к сумме счёта больше нет», «подтверждаем итоговую сумму»
- Чаты / мессенджеры (разговорный стиль): «окей, по счёту договорились», «новый счёт норм, отдаю в оплату», «с часами разобрались, всё ок», «финансы согласовали», «закрыли вопрос по счёту»
- Сокращения и термины: «счёт», «акт», «корректировочный счёт», «КСФ», «протокол разногласий», «в оплату»
- Устойчивые конструкции / маркеры: «согласны / договорились» + «по сумме / по счёту»; «принимаем к оплате» + скорректированный счёт; «разногласия» + «сняты / урегулированы»

**Похоже, но не это (анти-признаки):** «Оплату по счёту 318 провели» → `INVOICE_PAID`; «Пришлём ответ по счёту на следующей неделе» → «нет сигнала»; «Жалобу на сроки снимаем» → `COMPLAINT_RESOLUTION_CONFIRMED`.

**Пример (evidence):** «Скорректированный счёт № 318 без дополнительных часов дизайна получили, с суммой согласны, передали в оплату.»
**Контрпример:** «Деньги по счёту 318 ушли сегодня» → это факт оплаты, `INVOICE_PAID`.

**Заметка для карточки:** Закрыть спор по названному счёту и оставить открытым вопрос оплаты, если остаток ещё не поступил.

### `ACCOUNT_INCREMENTAL_WORK_SLOWDOWN` — Сокращаются дополнительные проекты

| Field | Value |
|---|---|
| Pack · block · family | agency · N3 · account |
| Weight · class · kind · score rule | 5 · risk · trend · fixed |
| Effort · asks us · inbound only · amount | medium · no · yes · yes |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (D4); trend ceiling D4 even when attributes raise the score (Q24-6) |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: causes and plan agreed; a return of volume is confirmed separately |
| Relations | `SALES_BUDGET_CUT` leads over it |
| Date gate | — |
| Relevance window | 90 days (trend cooldown per client) |
| Deal effect | none |

**Определение:** Подтверждено сокращение дополнительных проектов клиента при продолжающемся основном договоре (ретейнере): клиент сам говорит, что допработ будет меньше, или это видно по данным за период.

**Граница (не считается):** Прекращение всей работы — `ACCOUNT_WORK_PAUSED_BY_CLIENT` или `CONTRACT_TERMINATED`. Сокращение общего бюджета — `SALES_BUDGET_CUT`. Один отказ от одного допзаказа — `SALES_OFFER_DECLINED`. Снижение выручки по основному договору этим кодом не доказывается.

**Признаки для промпта (≤ 8):** «допов в этом году не будет», «только ретейнер», «спецпроекты пока не планируем», «внеплановых задач будет меньше», «дополнительные проекты заморозили», «сверх договора ничего не заказываем», «разовые проекты свернули», «бюджет на допработы не выделили»

**Синонимы и выражения (полный список):**
- Деловая переписка: «в следующем периоде дополнительные проекты не планируются», «работаем только в рамках основного договора», «бюджет на внеплановые активности сокращён», «спецпроекты переносим на неопределённый срок», «разовые заказы будут существенно реже», «дополнительные соглашения в этом году не заключаем»
- Чаты / мессенджеры (разговорный стиль): «допов не будет, только ретейнер», «спецпроекты пока стоп», «на разовые задачи денег нет», «сверху ничего не берём», «ивенты в этом году без вас, бюджета нет», «новых задач пока не ждите»
- Сокращения и термины: «допы», «допработы», «спецпроекты», «разовые проекты», «ДС» (дополнительное соглашение), «ретейнер», «внеплановые задачи»
- Устойчивые конструкции / маркеры: «не будет / не планируем / не заказываем» + «допов / спецпроектов / разовых проектов»; «только» + «ретейнер / основной договор»

**Похоже, но не это (анти-признаки):** «Бюджет на коммуникации урезали на 30 %» → `SALES_BUDGET_CUT`; «Ставим ретейнер на паузу» → `ACCOUNT_WORK_PAUSED_BY_CLIENT`; «Этот спецпроект не согласовали» (один отказ) → `SALES_OFFER_DECLINED`; «Договор расторгаем» → `CONTRACT_TERMINATED`.

**Правило процесса (trigger rule):** RU: по клиенту с действующим основным договором сравниваются выигранные дополнительные сделки (deal_type incremental) за последние 6 месяцев и за предыдущие 6 месяцев; база — не меньше 3 сделок; падение по количеству или сумме не меньше 50 %. Мало данных — сигнала нет; повтор не раньше чем через 90 дней. EN: client with an active main contract; incremental deals won in the last 6 months vs the previous 6 months; baseline ≥ 3 deals; drop ≥ 50 % in count or amount. Settings `trend.incrementalWindowMonths` = 6, `trend.incrementalMinBaseline` = 3, `trend.incrementalDropPct` = 50. Too little data → no instance; cooldown 90 days per client. The parser arm uses the cues above.

**Пример (evidence):** «В 2027 году работаем только по ретейнеру: спецпроекты и ивенты бюджетом не предусмотрены.»
**Контрпример:** «Ивент к юбилею в этом году не делаем, но к запуску продукта нужна кампания, пришлите смету» → один отказ и новый запрос, сокращения потока допработ не видно.

**Заметка для карточки:** Директору аккаунта обсудить с клиентом причины сокращения дополнительных проектов и его планы на новые задачи.

### `CONTRACT_CONTINUATION_CONFIRMED` — Клиент подтвердил намерение продолжать работу

| Field | Value |
|---|---|
| Pack · block · family | agency · N3 · contract |
| Weight · class · kind · score rule | 7 · chance · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · yes · yes |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (P6) |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: `SALES_BOOKING_RECEIVED` or the decision explicitly changed |
| Relations | leads over `CONTRACT_RENEWAL_INTENT` and `CONTRACT_FRAME_EXPIRY` |
| Date gate | — |
| Relevance window | default |
| Deal effect | enter_stage S4 on the linked renewal deal ONLY when Q24-10 holds (contract / service identifiable + next period or scope defined + explicit confirmation of the choice of the agency); otherwise none |

**Определение:** Клиент явно решил продолжить работу с агентством по действующему договору или услуге на следующий период, до оформления обязательного заказа или договора.

**Граница (не считается):** Q24-10: код ставится, только когда понятен продлеваемый договор или услуга, определён следующий период или объём и клиент явно подтверждает выбор агентства. «Продлеваем ваш сервис на следующий год, готовим документы» — да; «надеемся продолжить сотрудничество» — нет. Обсуждение продления без решения — `CONTRACT_RENEWAL_INTENT`. Подписанный договор или обязательный заказ — `SALES_BOOKING_RECEIVED`.

**Признаки для промпта (≤ 8):** «продлеваем на 2027», «остаёмся с вами на следующий год», «решили продолжить ретейнер», «готовим допсоглашение на продление», «бюджет на следующий год под вас заложили», «продолжаем в том же объёме», «продление согласовано руководством», «работаем дальше, пришлите договор»

**Синонимы и выражения (полный список):**
- Деловая переписка: «принято решение о продлении сотрудничества на 2027 год», «продлеваем договор на абонентское обслуживание на следующий период», «руководство согласовало продолжение работы с агентством», «готовим дополнительное соглашение о пролонгации», «бюджет на следующий год согласован в прежнем объёме», «просим направить проект договора на новый период»
- Чаты / мессенджеры (разговорный стиль): «всё, продлеваемся», «на следующий год остаёмся с вами», «ретейнер на 2027 одобрили», «шеф сказал работаем дальше», «юристы готовят допник на продление», «в том же формате, только с января»
- Сокращения и термины: «пролонгация», «ДС», «допник», «ретейнер», «годовой договор», «рамка», «PO на следующий год»
- Устойчивые конструкции / маркеры: «продлеваем / продлеваемся» + период; «решили / согласовали» + «продолжить / продление»; «на следующий год / на 2027» + «с вами / в том же объёме»

**Похоже, но не это (анти-признаки):** «Надеемся продолжить сотрудничество» → «нет сигнала» (Q24-10); «Давайте обсудим продление в декабре» → `CONTRACT_RENEWAL_INTENT`; «Подписали допсоглашение на 2027, оригиналы курьером» → `SALES_BOOKING_RECEIVED`; «Договор истекает 31.12» → `CONTRACT_FRAME_EXPIRY`; «На следующий год объявляем конкурс» → `CONTRACT_RETENDER_ANNOUNCED`.

**Пример (evidence):** «Руководство согласовало: продлеваем ретейнер по PR на 2027 год в том же объёме, юристы готовят допсоглашение.»
**Контрпример:** «Спасибо за год, надеемся продолжить работу и в следующем» → нет конкретного периода, объёма и явного решения.

**Заметка для карточки:** Директору аккаунта согласовать с клиентом оформление следующего периода: договор или допсоглашение и сроки подписания.

### `CONTRACT_RENEWAL_DECLINED` — Клиент отказался от следующего периода

| Field | Value |
|---|---|
| Pack · block · family | agency · N3 · contract |
| Weight · class · kind · score rule | 8 · risk · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · yes · yes |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (P8) |
| Recipient role | account |
| Closes / closed by | closes: `CONTRACT_RENEWAL_INTENT`, `CONTRACT_CONTINUATION_CONFIRMED` on the same contract topic · closed by: — (a reversal needs a new confirmation) |
| Relations | leads over `CONTRACT_NOT_RENEWED` and `CONTRACT_FRAME_EXPIRY` |
| Date gate | — |
| Relevance window | default |
| Deal effect | outcome `lost` on the open renewal deal of that contract; never rewrites the history of the won sale (Maslov §3.3) |

**Определение:** Клиент прямо отказался продлевать действующий договор или услугу на следующий период: решил завершить работу по окончании срока или уйти к другому подрядчику.

**Граница (не считается):** Истечение срока и отсутствие ответа не являются отказом (→ `CONTRACT_FRAME_EXPIRY`, `CONTRACT_NOT_RENEWED`). Досрочное расторжение действующего договора — `CONTRACT_TERMINATED`. Объявление повторного конкурса — `CONTRACT_RETENDER_ANNOUNCED`, а не отказ.

**Признаки для промпта (≤ 8):** «продлевать не будем», «по окончании договора завершаем сотрудничество», «на следующий год выбрали другое агентство», «ретейнер на 2027 не продлеваем», «дорабатываем до конца года и всё», «пролонгации не будет», «решили не продолжать», «уходим in-house»

**Синонимы и выражения (полный список):**
- Деловая переписка: «уведомляем об отказе от пролонгации договора», «по истечении срока действия договор продлеваться не будет», «принято решение не продолжать сотрудничество в 2027 году», «на следующий период выбран другой подрядчик», «функцию переводим во внутреннюю команду», «просим подготовить закрывающие документы по окончании срока»
- Чаты / мессенджеры (разговорный стиль): «продлевать не будем, увы», «с января работаем с другими», «до декабря доделываем и прощаемся», «бюджет на агентство на след год не дали», «забираем PR внутрь», «всё, дальше без вас»
- Сокращения и термины: «пролонгация», «уведомление о непродлении», «in-house», «закрывающие документы», «годовой договор», «ретейнер»
- Устойчивые конструкции / маркеры: «не будем / не планируем» + «продлевать / продолжать»; «по окончании / по истечении» + «срока / договора» + «завершаем»; «выбрали» + «другое агентство / другого подрядчика»

**Похоже, но не это (анти-признаки):** «Договор заканчивается 31.12» → `CONTRACT_FRAME_EXPIRY`; «Расторгаем договор с 1-го числа» → `CONTRACT_TERMINATED`; «Продление будем разыгрывать в конкурсе» → `CONTRACT_RETENDER_ANNOUNCED`; «Ставим работу на паузу» → `ACCOUNT_WORK_PAUSED_BY_CLIENT`.

**Пример (evidence):** «Коллеги, сообщаем: договор на PR-сопровождение по окончании срока продлевать не будем, с 2027 года функцию забираем во внутреннюю команду.»
**Контрпример:** «Договор истекает в декабре, по продлению пока решения нет» → нет отказа, только срок.

**Заметка для карточки:** Директору аккаунта выяснить причину отказа и согласовать с клиентом порядок завершения работы и дальнейшие отношения.

### `CONTRACT_RETENDER_ANNOUNCED` — Объявлен повторный конкурс за текущий договор

| Field | Value |
|---|---|
| Pack · block · family | agency · N3 · contract |
| Weight · class · kind · score rule | 7 · risk · event · fixed |
| Effort · asks us · inbound only · amount | complex · yes · yes · yes |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (P6) |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: the outcome of the re-pitch |
| Relations | leads over `SALES_TENDER_INVITATION` (Maslov §5.5: one re-pitch card linked to the current contract) |
| Date gate | — |
| Relevance window | default |
| Deal effect | create_deal at S1, deal_type re_pitch, linked to the current contract (no internal approval, Q24-7: go/no-go removed); trigger of RISK_ACCOUNT_REVIEW |

**Определение:** Клиент сообщил, что текущий договор агентства будет заново разыгран в отборе, тендере или конкурсе на следующий период. Q24-7: повторный питч открывается как отдельная возможность сразу, без отдельного внутреннего согласования.

**Граница (не считается):** Обычное обсуждение продления — `CONTRACT_RENEWAL_INTENT`. Тендер на отдельный дополнительный проект, а не на текущий договор, — `SALES_TENDER_INVITATION`. Внутренний аудит агентства без конкурса — `ACCOUNT_SERVICE_REVIEW_REQUESTED`.

**Признаки для промпта (≤ 8):** «объявляем конкурс на следующий год», «по процедуре обязаны провести тендер», «пригласим вас и ещё несколько агентств», «пересмотр пула агентств», «перетендер», «конкурс на PR-сопровождение 2027», «закупка будет на площадке», «вы, конечно, можете участвовать»

**Синонимы и выражения (полный список):**
- Деловая переписка: «по истечении договора будет проведена конкурсная процедура», «в соответствии с политикой закупок договор подлежит повторному тендеру», «приглашаем принять участие в отборе агентства на 2027 год», «планируем пересмотр пула подрядчиков по коммуникациям», «закупочная процедура будет объявлена на электронной площадке», «текущий договор продлению без конкурса не подлежит»
- Чаты / мессенджеры (разговорный стиль): «закупки требуют тендер, без вариантов», «будем перетендеривать, вас позовём», «раз в три года обязательный конкурс», «в этот раз продлить без тендера не дадут», «на следующий год пул пересобираем»
- Сокращения и термины: «перетендер», «re-pitch», «пул агентств», «закупочная процедура», «ЭТП», «223-ФЗ», «RFP», «agency review»
- Устойчивые конструкции / маркеры: «конкурс / тендер / отбор» + «на следующий год / на 2027 / на текущий объём»; «обязаны / по процедуре» + «провести тендер»; «пересмотр» + «пула агентств»

**Похоже, но не это (анти-признаки):** «Давайте обсудим продление в декабре» → `CONTRACT_RENEWAL_INTENT`; «Объявили тендер на отдельный ивент, присылайте заявку» → `SALES_TENDER_INVITATION`; «Хотим провести аудит вашей работы» → `ACCOUNT_SERVICE_REVIEW_REQUESTED`; «На следующий год выбрали другое агентство» → `CONTRACT_RENEWAL_DECLINED`.

**Пример (evidence):** «Коллеги, по политике закупок договор на PR-сопровождение нельзя продлить без конкурса. В январе объявим тендер на 2027 год, вас обязательно пригласим.»
**Контрпример:** «Объявляем тендер на организацию дилерской конференции, присылайте заявку» → отдельный проект, текущий договор не разыгрывается.

**Заметка для карточки:** Директору аккаунта вместе с new biz открыть связанную возможность повторного питча и уточнить у клиента сроки, процедуру и критерии конкурса.

### `ACCOUNT_WORK_PAUSED_BY_CLIENT` — Клиент приостановил действующую работу

| Field | Value |
|---|---|
| Pack · block · family | agency · N3 · account |
| Weight · class · kind · score rule | 7 · risk · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · yes · yes |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (P6) |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: the client confirms resumption or a final end (`CONTRACT_TERMINATED`) |
| Relations | boundary vs `PITCH_PAUSED_BY_CLIENT` (pause before an order) |
| Date gate | { fact: returnDate, test: within, setting: `cards.deadlineLeadDays` (medium = 3 working days) } — the card returns before the return date |
| Relevance window | until the return date |
| Deal effect | none (state of the running work, not of an opportunity, Maslov §3.3) |

**Определение:** Клиент прямо приостановил исполнение по действующему проекту или договору: заморозил ретейнер, остановил кампанию, попросил прекратить работы до определённой даты или условия.

**Граница (не считается):** Пауза в отборе до получения заказа — `PITCH_PAUSED_BY_CLIENT`. Окончательное прекращение договора — `CONTRACT_TERMINATED`. Задержка одного шага со стороны клиента без остановки работ — `DELIVERY_CLIENT_DEPENDENCY_DELAYED`. Молчание не означает паузу.

**Признаки для промпта (≤ 8):** «ставим проект на паузу», «заморозим ретейнер», «приостановите работы до», «стопаем кампанию», «пока ничего не делаем», «возобновим после бюджетного комитета», «на время реорганизации работы останавливаем», «замораживаем до нового года»

**Синонимы и выражения (полный список):**
- Деловая переписка: «просим приостановить оказание услуг с 1 декабря», «работы по договору временно приостанавливаются», «действие ретейнера замораживается до утверждения бюджета», «кампанию останавливаем до особого распоряжения», «возобновление работ обсудим в феврале», «в связи с реорганизацией просим не начинать новые задачи»
- Чаты / мессенджеры (разговорный стиль): «на паузу пока», «стопаем всё до января», «ретейнер замораживаем», «ничего не публикуйте пока», «тормозим, сверху сказали ждать», «как разморозят бюджет — вернёмся»
- Сокращения и термины: «пауза», «заморозка», «стоп-лист», «ретейнер», «стоп кампании», «до особого распоряжения»
- Устойчивые конструкции / маркеры: «ставим / поставим» + «на паузу»; «приостановить / заморозить» + «работы / ретейнер / кампанию»; «до» + дата или условие возобновления

**Похоже, но не это (анти-признаки):** «Решение по выбору агентства пока откладываем, отбор на паузе» → `PITCH_PAUSED_BY_CLIENT`; «Расторгаем договор» → `CONTRACT_TERMINATED`; «Материалы задерживаются на неделю» → `DELIVERY_CLIENT_DEPENDENCY_DELAYED`; «Допов в этом году не будет» → `ACCOUNT_INCREMENTAL_WORK_SLOWDOWN`.

**Пример (evidence):** «Из-за реорганизации ставим ретейнер на паузу с 1 декабря, возобновить планируем после утверждения бюджета в феврале.»
**Контрпример:** «Выбор агентства на запуск переносим, пока ставим отбор на паузу» → пауза до заказа, это `PITCH_PAUSED_BY_CLIENT`.

**Заметка для карточки:** Директору аккаунта согласовать с клиентом границы остановки, текущие обязательства и условие или дату возобновления.

### `ACCOUNT_PRIORITIES_CHANGED` — Клиент сообщил о новых приоритетах

| Field | Value |
|---|---|
| Pack · block · family | agency · N3 · account |
| Weight · class · kind · score rule | 4 · chance · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · yes · no |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (D4) |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: priorities and next step recorded |
| Relations | outranked by `SALES_NEW_DEMAND` |
| Date gate | — |
| Relevance window | default |
| Deal effect | none |

**Определение:** Действующий клиент назвал новые цели, фокус или приоритеты бизнеса и коммуникаций, но ещё не заказал под них дополнительную работу. Это контекст для развития аккаунта.

**Граница (не считается):** Конкретный новый запрос на работу — `SALES_NEW_DEMAND`. Перестановка задач внутри оплаченного объёма — `DELIVERY_CHANGE_REQUESTED`. Новость о стратегии компании из прессы — блок H (`SIGNAL_STRATEGY_ANNOUNCEMENT`, для пакета agency припаркован).

**Признаки для промпта (≤ 8):** «в следующем году фокус на», «главный приоритет теперь», «стратегия поменялась», «упор будем делать на», «для нас сейчас важнее», «цели на 2027», «выходим в регионы», «делаем ставку на HR-бренд»

**Синонимы и выражения (полный список):**
- Деловая переписка: «приоритеты компании на 2027 год смещаются в сторону», «ключевой задачей становится», «стратегия коммуникаций пересмотрена», «акцент переносится с B2C на B2B», «планируем усилить направление», «в фокусе следующего года — запуск новой линейки»
- Чаты / мессенджеры (разговорный стиль): «у нас теперь всё про digital», «шеф хочет больше про ESG», «в след году упор на регионы», «бренд работодателя теперь топ-приоритет», «маркетплейсы важнее всего сейчас»
- Сокращения и термины: «стратегия», «фокус», «приоритеты», «OKR», «ESG», «HR-бренд», «B2B / B2C», «go-to-market»
- Устойчивые конструкции / маркеры: «фокус / упор / акцент» + «на»; «приоритет(ы)» + «смещаются / теперь»; «в следующем году / в 2027» + цель

**Похоже, но не это (анти-признаки):** «Под запуск линейки нужна кампания, пришлите предложение» → `SALES_NEW_DEMAND`; «Вместо поста сделайте сторис в рамках ретейнера» → `DELIVERY_CHANGE_REQUESTED`; «Хотим пересмотреть формат работы с вами» → `ACCOUNT_SERVICE_REVIEW_REQUESTED`.

**Пример (evidence):** «В 2027 году главный приоритет — бренд работодателя и выход в регионы, прежний упор на продуктовый PR уменьшится.»
**Контрпример:** «Под выход в регионы нужна PR-кампания, пришлите смету до пятницы» → конкретный запрос на работу, `SALES_NEW_DEMAND`.

**Заметка для карточки:** Директору аккаунта уточнить, как новые приоритеты клиента влияют на текущие задачи, и предложить следующий разговор о развитии.

## N4 · Риски

Additional risk codes of an open opportunity (Maslov §2.4). They act only on a topic linked to an open deal. They trigger deal risks (§ «Deal-risk types» below) and update one common risk incident per deal and matter (Maslov §5.4: «обновить общий инцидент; не дублировать родственный сигнал»). They never move a stage. Codes with kind `derived` / `watchdog` have a process arm (trigger rule in the entry) and a parser arm (cues).

| Code | Название (RU) | W | Class | Kind | Score rule | Effort | Asks us | Inbound only | Amount | Stage (pack) | IN4COM | Profile | Recipient | Family |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `PITCH_DECISION_MAKER_UNCLEAR` | Не определён принимающий решение | 6 | risk | event | fixed | medium | no | yes | no | active | n/a | P6 | opportunity | pitch |
| `PITCH_SINGLE_CONTACT_DEPENDENCY` | Сделка зависит от одного контакта | 6 | risk | derived | fixed | medium | no | — | no | active | n/a | P6 | opportunity | pitch |
| `PITCH_STAKEHOLDER_CONFLICT` | Участники клиента противоречат друг другу | 7 | risk | event | fixed | medium | yes | yes | no | active | n/a | P6 | opportunity | pitch |
| `PITCH_NEED_UNCONFIRMED` | Предметная потребность не подтверждена | 5 | risk | event | fixed | quick | no | yes | no | active | n/a | D4 | opportunity | pitch |
| `PITCH_BRIEF_INCOMPLETE` | Для предложения не хватает существенного брифа | 6 | risk | event | fixed | medium | yes | yes | no | active | n/a | P6 | opportunity | pitch |
| `PITCH_BUDGET_UNDISCLOSED` | Финансовые рамки не раскрыты | 6 | risk | event | fixed | medium | no | yes | yes | active | n/a | P6 | opportunity | pitch |
| `PITCH_BUDGET_MISMATCH` | Предложение не укладывается в бюджет | 7 | risk | event | fixed | medium | yes | yes | yes | active | n/a | P6 | opportunity | pitch |
| `PITCH_PRICE_ONLY_SELECTION` | Клиент выбирает только по цене | 6 | risk | event | fixed | medium | no | yes | yes | active | n/a | P6 | opportunity | pitch |
| `PITCH_SELECTION_CRITERIA_UNCLEAR` | Критерии выбора остаются непрозрачными | 6 | risk | event | fixed | medium | no | yes | no | active | n/a | P6 | opportunity | pitch |
| `PITCH_SCOPE_WITHOUT_ADJUSTMENT` | Объём изменён без изменения цены и срока | 7 | risk | event | fixed | medium | yes | yes | yes | active | n/a | P6 | opportunity | pitch |
| `PITCH_UNPAID_WORK_EXPANDING` | Растёт бесплатная проработка | 6 | risk | event | fixed | complex | yes | yes | yes | active | n/a | P6 | opportunity | pitch |
| `PITCH_REVISIONS_WITHOUT_DECISION` | Доработки повторяются без условий решения | 6 | risk | derived | fixed | complex | yes | — | no | active | n/a | P6 | opportunity | pitch |
| `PITCH_EXPERTISE_DOUBTED` | Клиент сомневается в экспертизе команды | 7 | risk | event | fixed | medium | yes | yes | no | active | n/a | P6 | opportunity | pitch |
| `PITCH_CLIENT_COMMITMENT_BROKEN` | Клиент не выполнил договорённость по сделке | 6 | risk | watchdog | fixed | medium | yes | yes | no | active | n/a | P6 | opportunity | pitch |
| `PITCH_FEEDBACK_MISSING` | Нет содержательной обратной связи по решению | 5 | risk | watchdog | fixed | quick | no | yes | no | active | n/a | D4 | opportunity | pitch |
| `PITCH_ORDER_FORMALIZATION_DELAYED` | После выбора затягивается оформление заказа | 7 | risk | event | fixed | medium | yes | yes | yes | active | n/a | P6 | opportunity | pitch |
| `PITCH_PAYMENT_TERMS_UNFAVORABLE` | Клиент требует невыгодные условия оплаты | 7 | risk | event | fixed | medium | yes | yes | yes | active | n/a | P6 | opportunity | pitch |
| `PITCH_REPEAT_UNPRODUCTIVE_TENDER` | Повторяется прежний безрезультатный отбор | 6 | risk | derived | fixed | medium | no | — | no | active | n/a | P6 | opportunity | pitch |

### `PITCH_DECISION_MAKER_UNCLEAR` — Не определён принимающий решение

| Field | Value |
|---|---|
| Pack · block · family | agency · N4 · pitch |
| Weight · class · kind · score rule | 6 · risk · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · yes · no |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (P6) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: `PITCH_SELECTION_CRITERIA_DISCLOSED` (client names the roles for choice, budget and signature) |
| Relations | one common risk incident with `PITCH_SINGLE_CONTACT_DEPENDENCY` and `PITCH_STAKEHOLDER_CONFLICT` (Maslov §5.4: update the common incident, do not make a duplicate card) |
| Date gate | — |
| Relevance window | default |
| Deal effect | risk trigger RISK_DECISION_MAKER_UNCLEAR; no stage change |

**Определение:** В обсуждении конкретной возможности подтверждено, что представители клиента не могут назвать или согласовать, кто выбирает агентство, утверждает бюджет и подписывает договор. Клиент сам говорит, что владелец решения не определён или неизвестен.

**Граница (не считается):** Только на топике, связанном с открытой сделкой; без сделки это контекст области 0, а не риск. Наш собственный вопрос «кто принимает решение?» без ответа клиента — не этот код. Название должности без реальной роли в решении вопрос не снимает. Если клиент назвал роли и порядок решения — это `PITCH_SELECTION_CRITERIA_DISCLOSED`.

**Признаки для промпта (≤ 8):** «пока не можем сказать, кто будет утверждать», «кто финально решает — пока не определились», «решение будет принимать кто-то из руководства, точно не знаю», «не знаю, кто подпишет», «кто утверждает бюджет — уточняем», «у нас пока нет ответственного за этот проект», «решать будет комитет, состав пока не утверждён», «это решение выше меня, кто именно — не скажу»

**Синонимы и выражения (полный список):**
- Деловая переписка: «на текущий момент владелец решения не определён», «вопрос о том, кто будет утверждать подрядчика, пока открыт», «состав лиц, принимающих решение, будет определён позднее», «ответственный за выбор агентства ещё не назначен», «кто согласует бюджет, станет понятно после реорганизации», «финальное утверждение пока не закреплено ни за кем», «порядок принятия решения уточняется внутри компании»
- Чаты / мессенджеры (разговорный стиль): «честно, сам не знаю, кто у нас будет решать», «кто подписывает — без понятия пока», «это уже не мне решать, а кому — непонятно», «наверху разберутся, кто будет утверждать», «пока никто не взял на себя этот проект», «спрошу, кто у нас за это отвечает, но не обещаю»
- Сокращения и термины: «ЛПР не определён», «ЛПР пока неизвестен», «владелец бюджета не назначен», «тендерная комиссия не сформирована», «согласующий не определён»
- Устойчивые конструкции / маркеры: «пока не (можем сказать / определились / знаем)» + «кто (решает / утверждает / подписывает)»; «решение (будет принимать / примет)» + «кто-то из» + неопределённое лицо

**Похоже, но не это (анти-признаки):** «Решение принимает директор по маркетингу, бюджет утверждает финдиректор» → `PITCH_SELECTION_CRITERIA_DISCLOSED`; «У нас новый CMO, теперь решает он» → `CONTACT_NEW_DECISION_MAKER`; «маркетинг хочет одно, бренд — другое» → `PITCH_STAKEHOLDER_CONFLICT`; «все вопросы только через меня» → `PITCH_SINGLE_CONTACT_DEPENDENCY`; «с маркетингом напрямую нельзя, только через закупки» → `PITCH_BUYER_ACCESS_DECLINED`; «как будете выбирать, не расскажем» → `PITCH_SELECTION_CRITERIA_UNCLEAR`.

**Пример (evidence):** «Коллеги, концепцию посмотрели, но кто у нас финально утверждает подрядчика, пока не можем сказать — после реорганизации это ещё не закрепили».
**Контрпример:** «Финальное решение примет Ирина, директор по маркетингу, бюджет согласует финансовый директор» → роли названы, это `PITCH_SELECTION_CRITERIA_DISCLOSED`, риск не возникает.

**Заметка для карточки:** Ответственному за возможность предложить уточнить у контакта роли выбора, утверждения бюджета и подписания, не продолжая крупную подготовку вслепую.

### `PITCH_SINGLE_CONTACT_DEPENDENCY` — Сделка зависит от одного контакта

| Field | Value |
|---|---|
| Pack · block · family | agency · N4 · pitch |
| Weight · class · kind · score rule | 6 · risk · derived · fixed |
| Effort · asks us · inbound only · amount | medium · no · — · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (P6) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: `PITCH_BUYER_ACCESS_GRANTED`, `MEETING_NEW_STAKEHOLDER` |
| Relations | common risk incident with `PITCH_DECISION_MAKER_UNCLEAR` (Maslov §5.4) |
| Date gate | — |
| Relevance window | default |
| Deal effect | risk trigger RISK_SINGLE_CONTACT; no stage change |

**Определение:** Продвижение сделки держится на одном человеке клиента, а рабочих связей с другими участниками решения нет. Либо клиент сам прямо говорит, что всё идёт только через него, либо процесс видит это по данным сделки.

**Граница (не считается):** Только на топике, связанном с открытой сделкой. Один адрес в одном письме зависимость не доказывает. Клиент, который прямо запрещает доступ к бизнес-заказчику или требует общаться только через закупки, — это `PITCH_BUYER_ACCESS_DECLINED`. Если контакт просто не знает, кто решает, — `PITCH_DECISION_MAKER_UNCLEAR`.

**Правило процесса (trigger rule):** RU: сделка на стадиях S2–S4; с входа в воронку прошло не меньше 21 календарного дня; по топикам сделки не меньше 5 входящих сообщений, и все они от одного человека клиента; в `deal_contact` не больше одного контакта клиента; на сделке нет `PITCH_BUYER_ACCESS_GRANTED` и `MEETING_NEW_STAKEHOLDER`. Мало данных — экземпляр не создаётся. EN: deal in S2–S4; ≥ 21 calendar days since deal entry; ≥ 5 inbound items on the deal's topics, all from one client person; `deal_contact` holds ≤ 1 client contact; no `PITCH_BUYER_ACCESS_GRANTED` / `MEETING_NEW_STAKEHOLDER` on the deal. Settings `risk.singleContactMinDays` = 21, `risk.singleContactMinItems` = 5. Too little data → no instance.

**Признаки для промпта (≤ 8):** «все вопросы только через меня», «руководство подключать не нужно», «я сам всё донесу до руководства», «с остальными коллегами общаться не надо», «презентовать будете мне, дальше я сам», «в копию никого ставить не нужно», «я единственный, кто ведёт этот проект», «напрямую с другими не связывайтесь»

**Синонимы и выражения (полный список):**
- Деловая переписка: «просим вести всю коммуникацию исключительно через меня», «встреча с руководством не предусмотрена, я передам материалы сам», «прошу не подключать других сотрудников к переписке», «я буду единственным контактным лицом на всех этапах», «дальнейшее согласование внутри компании беру на себя», «другим участникам материалы направлять не нужно»
- Чаты / мессенджеры (разговорный стиль): «пишите только мне, я всё порешаю», «шефу сам покажу», «не надо никого дёргать, я в курсе», «остальным не пишите, запутаете», «я тут один на этом проекте, так что ко мне», «я сам перескажу, им некогда»
- Сокращения и термины: «единая точка входа», «единственный контакт», «SPOC», «я ваш единственный контакт по проекту»
- Устойчивые конструкции / маркеры: «только через (меня / мой отдел)»; «(руководство / коллег / других) подключать не (нужно / надо)»; «я сам (передам / донесу / покажу)» + решающим лицам

**Похоже, но не это (анти-признаки):** «с маркетингом напрямую не получится, только через закупки» → `PITCH_BUYER_ACCESS_DECLINED`; «познакомлю вас с бренд-директором» → `PITCH_BUYER_ACCESS_GRANTED`; «на встрече будет ещё наш коммерческий директор» → `MEETING_NEW_STAKEHOLDER`; «кто решает — пока не знаю» → `PITCH_DECISION_MAKER_UNCLEAR`; «я буду вашим контактом по текущим задачам» на действующем аккаунте без сделки → нет сигнала.

**Пример (evidence):** «Не нужно ставить в копию нашего директора, все вопросы по тендеру ведите только через меня, концепцию руководству я покажу сам».
**Контрпример:** «Отправьте, пожалуйста, мне, я перешлю директору по маркетингу и бренд-менеджеру, они подключатся к встрече» → другие участники подключаются, зависимости нет.

**Заметка для карточки:** Ответственному за возможность предложить договориться с контактом о знакомстве с другими участниками решения, объяснив пользу для самого контакта.

### `PITCH_STAKEHOLDER_CONFLICT` — Участники клиента противоречат друг другу

| Field | Value |
|---|---|
| Pack · block · family | agency · N4 · pitch |
| Weight · class · kind · score rule | 7 · risk · event · fixed |
| Effort · asks us · inbound only · amount | medium · yes · yes · no |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (P6) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: `PITCH_SELECTION_CRITERIA_DISCLOSED` or `PITCH_BRIEFING_ACCEPTED` with one agreed brief |
| Relations | common risk incident with `PITCH_DECISION_MAKER_UNCLEAR` (Maslov §5.4) |
| Date gate | — |
| Relevance window | default |
| Deal effect | risk trigger RISK_STAKEHOLDER_CONFLICT; no stage change |

**Определение:** Представители клиента дают несовместимые требования к одному решению или по-разному определяют цель и задачу. Противоречие видно в переписке или клиент сам о нём сообщает.

**Граница (не считается):** Только на топике, связанном с открытой сделкой. Разные функции участников (маркетинг отвечает за креатив, закупки — за договор) — не конфликт. Последовательное изменение брифа одним и тем же заказчиком — `PITCH_REQUIREMENTS_CHANGED`. Неясность, кто вообще решает, — `PITCH_DECISION_MAKER_UNCLEAR`.

**Признаки для промпта (≤ 8):** «маркетинг хочет одно, бренд-менеджер другое», «у нас внутри разные мнения по задаче», «коммерческий директор видит это иначе», «прошлое письмо от коллеги не учитывайте, задача другая», «продажи просят акцент на скидках, бренд — на имидже», «пока внутри не договорились, чего хотим», «у отделов разное понимание цели», «руководитель с брифом не согласен»

**Синонимы и выражения (полный список):**
- Деловая переписка: «позиции маркетинга и отдела продаж по задаче расходятся», «руководство не поддерживает подход, согласованный с брендом», «прошу не ориентироваться на требования, направленные коллегой ранее», «внутри компании нет единого понимания целей кампании», «бизнес-заказчик и закупки предъявляют разные требования», «у нас две разные версии брифа от разных подразделений»
- Чаты / мессенджеры (разговорный стиль): «у нас тут спор, PR против маркетинга», «не слушайте Олю, у неё своё видение», «гендир сказал всё наоборот», «мы сами между собой не договорились», «одни хотят digital, другие наружку, жесть», «бренд-команда против, а продажи за»
- Сокращения и термины: «расхождение в брифе», «разные KPI у отделов», «конфликт требований», «PR vs маркетинг», «бизнес против закупок»
- Устойчивые конструкции / маркеры: «(отдел / коллега) А хочет X, а (отдел / коллега) Б — Y»; «(не учитывайте / забудьте) то, что писал(а)» + коллега; «внутри (не договорились / разные мнения / нет единой позиции)»

**Похоже, но не это (анти-признаки):** «мы поменяли бриф: теперь цель — продажи, а не охват» (один заказчик меняет решение) → `PITCH_REQUIREMENTS_CHANGED`; «кто решает — не знаем» → `PITCH_DECISION_MAKER_UNCLEAR`; «маркетинг отвечает за креатив, закупки — за договор» → нет сигнала; «финальные критерии и ответственный согласованы» → `PITCH_SELECTION_CRITERIA_DISCLOSED`.

**Пример (evidence):** «Коллеги, письмо от нашего бренд-менеджера про имиджевую кампанию пока отложите — коммерческий директор хочет акцию на скидки, внутри ещё спорим, что нам нужно».
**Контрпример:** «Креатив согласует маркетинг, а договор и смету — отдел закупок» → разделение функций, не противоречие.

**Заметка для карточки:** Ответственному за возможность предложить организовать с клиентом согласование единого брифа и критериев, не готовя два противоречащих решения.

### `PITCH_NEED_UNCONFIRMED` — Предметная потребность не подтверждена

| Field | Value |
|---|---|
| Pack · block · family | agency · N4 · pitch |
| Weight · class · kind · score rule | 5 · risk · event · fixed |
| Effort · asks us · inbound only · amount | quick · no · yes · no |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (D4) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: `PROSPECT_NEED_EXPRESSED`, `PITCH_SOLUTION_REQUESTED` |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | risk trigger RISK_NEED_UNCONFIRMED (only on a topic linked to an open deal); no stage change |

**Определение:** По открытой сделке клиент подтверждает только общий интерес и прямо говорит, что конкретной задачи, проекта или сроков пока нет. Сделка ведётся как активная возможность, а потребность не подтверждена.

**Граница (не считается):** Только на топике, связанном с открытой сделкой; без открытой сделки тот же текст — обычная область 0 (нет сигнала или `PROSPECT_CONTENT_INTEREST`). Это не отказ и не проигрыш. Если клиент назвал свою задачу — `PROSPECT_NEED_EXPRESSED`; если запросил решение — `PITCH_SOLUTION_REQUESTED`.

**Признаки для промпта (≤ 8):** «пока просто изучаем рынок», «конкретной задачи пока нет», «хотели посмотреть, что вы умеете в целом», «проекта как такового пока нет», «бюджета и сроков пока нет, просто присматриваемся», «это на перспективу, без конкретики», «собираем предложения для общего понимания», «пока не знаем, будем ли что-то запускать»

**Синонимы и выражения (полный список):**
- Деловая переписка: «на данном этапе мы проводим исследование рынка агентств», «конкретный проект пока не сформирован», «запрос носит ознакомительный характер», «решение о запуске проекта ещё не принято», «мы рассматриваем возможность работы в будущем, без привязки к задаче», «информация нужна для внутреннего планирования на следующий год»
- Чаты / мессенджеры (разговорный стиль): «да мы пока так, приценяемся», «просто интересно, что предложите», «пока без конкретики, честно», «может, что-то и сделаем, но не факт», «это скорее на будущее», «шеф попросил собрать варианты, а зачем — сам не знаю»
- Сокращения и термины: «запрос информации без ТЗ», «RFI без проекта», «мониторинг рынка», «бенчмаркинг агентств», «без бюджета и сроков»
- Устойчивые конструкции / маркеры: «пока (просто / только) (изучаем / смотрим / присматриваемся / приценяемся)»; «(конкретной задачи / проекта / бюджета) пока нет»; «на (перспективу / будущее)»

**Похоже, но не это (анти-признаки):** «нам нужно перезапустить бренд к весне» → `PROSPECT_NEED_EXPRESSED`; «интересна ваша статья про коллаборации, расскажите подробнее» без сделки → `PROSPECT_CONTENT_INTEREST`; «пришлите концепцию по брифу» → `PITCH_SOLUTION_REQUESTED`; «проект отменили» → `PITCH_CANCELLED_BY_CLIENT`; «пока ставим на паузу» → `PITCH_PAUSED_BY_CLIENT`.

**Пример (evidence):** «Спасибо за смету, но, честно говоря, конкретного проекта пока нет — мы просто изучаем рынок агентств и собираем варианты на следующий год».
**Контрпример:** «Мы пока просто изучаем рынок» в первом письме нового контакта, сделки нет → область 0, этот код не ставится.

**Заметка для карточки:** Ответственному за возможность с участием new biz предложить уточнить у клиента задачу и решить, вести ли дальше сделку или вернуть работу в область 0.

### `PITCH_BRIEF_INCOMPLETE` — Для предложения не хватает существенного брифа

| Field | Value |
|---|---|
| Pack · block · family | agency · N4 · pitch |
| Weight · class · kind · score rule | 6 · risk · event · fixed |
| Effort · asks us · inbound only · amount | medium · yes · yes · no |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (P6) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: `PITCH_BRIEFING_ACCEPTED` (sufficient brief received) |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | risk trigger RISK_BRIEF_INCOMPLETE; no stage change |

**Определение:** Клиент требует содержательного предложения (концепции, стратегии, сметы), но не даёт существенных целей, ограничений или исходных данных и не отвечает на ключевые вопросы по брифу.

**Граница (не считается):** Только на топике, связанном с открытой сделкой. Небольшое уточнение («какой формат файла прислать?») — не недостаточный бриф. Просьба дать решение при полном брифе — `PITCH_SOLUTION_REQUESTED` без риска. Согласованный брифинг или полученные ответы — `PITCH_BRIEFING_ACCEPTED`.

**Признаки для промпта (≤ 8):** «бриф дадим позже, пока сделайте что-нибудь», «брифа нет, придумайте сами», «цели и KPI пока не определены, но концепцию ждём к пятнице», «ЦА и бюджет пока не скажем, сделайте на ваше усмотрение», «отвечать на вопросы по брифу не будем, всё в ТЗ», «нам нужно предложение, детали потом», «исходных данных пока нет», «предложите что-то креативное, без рамок»

**Синонимы и выражения (полный список):**
- Деловая переписка: «бриф будет направлен позднее, просим подготовить предварительную концепцию», «дополнительные вопросы по заданию не принимаются», «целевые показатели кампании находятся в стадии формирования», «исследования и данные о целевой аудитории предоставить не можем», «ограничения по бренду уточним после получения концепции», «просим исходить из собственного понимания задачи»
- Чаты / мессенджеры (разговорный стиль): «да брифа как такового нет, накидайте идей», «сделайте как видите», «ТЗ нет, но очень ждём», «цели? ну, чтобы было круто», «на вопросы пока ответить не можем, начинайте», «давайте вы сначала покажете, а потом поймём, что нужно»
- Сокращения и термины: «нет брифа», «ТЗ без KPI», «без ЦА», «без брендбука», «гайдлайны пришлём потом», «без вводных»
- Устойчивые конструкции / маркеры: «(бриф / ТЗ / вводные / данные) (дадим / пришлём) (позже / потом)»; «сделайте (на ваше усмотрение / как видите / что-нибудь)» + срок сдачи; «(вопросы / уточнения) не (принимаются / будем отвечать)»

**Похоже, но не это (анти-признаки):** «пришлите концепцию по приложенному брифу» → `PITCH_SOLUTION_REQUESTED`; «давайте созвонимся, расскажем задачу подробно» → `PITCH_BRIEFING_ACCEPTED`; «бюджет не раскрываем» (остальной бриф полный) → `PITCH_BUDGET_UNDISCLOSED`; «маркетинг хочет одно, продажи другое» → `PITCH_STAKEHOLDER_CONFLICT`; «бриф поменялся» → `PITCH_REQUIREMENTS_CHANGED`.

**Пример (evidence):** «Бриф пока не готов, цели и аудиторию уточним позже, но креативную концепцию ждём к понедельнику — сделайте на ваше усмотрение».
**Контрпример:** «В брифе опечатка в названии продукта, исправьте, пожалуйста, при подготовке» → незначительное уточнение, риска нет.

**Заметка для карточки:** Ответственному за возможность предложить согласовать с клиентом обязательные вводные или ограниченный формат участия до дальнейшей проработки.

### `PITCH_BUDGET_UNDISCLOSED` — Финансовые рамки не раскрыты

| Field | Value |
|---|---|
| Pack · block · family | agency · N4 · pitch |
| Weight · class · kind · score rule | 6 · risk · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · yes · yes |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (P6) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: `SALES_BUDGET_MENTIONED` |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | risk trigger RISK_BUDGET_UNKNOWN (stage guard S2–S4); no stage change |

**Определение:** Клиент после наших уточнений прямо отказывается назвать бюджет или диапазон, хотя подготовка предложения уже требует существенных затрат агентства.

**Граница (не считается):** Только на топике, связанном с открытой сделкой. Ранняя беседа без бюджета — не риск сама по себе (стадийный фильтр риска S2–S4). Названная сумма или вилка — `SALES_BUDGET_MENTIONED`. Сумма названа, но она ниже стоимости — `PITCH_BUDGET_MISMATCH`.

**Признаки для промпта (≤ 8):** «бюджет пока не озвучиваем», «бюджет раскрывать не будем», «предложите, а мы посмотрим, укладывается ли», «вилку назвать не можем», «бюджет будет определён по итогам тендера», «сколько стоит — это вы нам скажите», «финансовые рамки конфиденциальны», «бюджета пока нет, считайте по максимуму»

**Синонимы и выражения (полный список):**
- Деловая переписка: «информация о бюджете проекта не раскрывается участникам отбора», «бюджет будет сформирован на основании полученных предложений», «просим предложить оптимальную стоимость без ориентира», «финансовые параметры являются коммерческой тайной», «ориентировочный бюджет сообщить не можем», «размер бюджета будет утверждён после выбора подрядчика»
- Чаты / мессенджеры (разговорный стиль): «бюджет не скажу, сорри», «посчитайте, а там видно будет», «ну сколько не жалко», «цифру пока не дают сверху», «давайте без бюджета, просто предложите», «по деньгам пока тишина»
- Сокращения и термины: «бюджет не раскрывается», «без вилки», «без ориентира по стоимости», «НМЦ не указана», «бюджет TBC у клиента»
- Устойчивые конструкции / маркеры: «бюджет (не озвучиваем / не раскрываем / не можем назвать / конфиденциален)»; «(предложите / посчитайте) — (посмотрим / решим)» без суммы; «(вилку / диапазон / ориентир) (назвать / дать) не можем»

**Похоже, но не это (анти-признаки):** «бюджет около 3 млн на квартал» → `SALES_BUDGET_MENTIONED`; «наш бюджет в два раза меньше вашей сметы» → `PITCH_BUDGET_MISMATCH`; «бюджет урезали на 30 %» → `SALES_BUDGET_CUT`; «давайте обсудим финальную смету» → `PITCH_FINAL_TERMS_DISCUSSION`; «выбираем по минимальной цене» → `PITCH_PRICE_ONLY_SELECTION`.

**Пример (evidence):** «Бюджет мы пока не озвучиваем — подготовьте, пожалуйста, концепцию и полную смету по трём каналам, а мы посмотрим, укладывается ли».
**Контрпример:** «Бюджет обсудим позже, сначала расскажите об агентстве» в первом знакомстве → ранняя стадия, риска нет.

**Заметка для карточки:** Ответственному за возможность с участием new biz предложить обсудить с клиентом допустимый диапазон и предел затрат агентства на участие.

### `PITCH_BUDGET_MISMATCH` — Предложение не укладывается в бюджет

| Field | Value |
|---|---|
| Pack · block · family | agency · N4 · pitch |
| Weight · class · kind · score rule | 7 · risk · event · fixed |
| Effort · asks us · inbound only · amount | medium · yes · yes · yes |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (P6) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: `SALES_BUDGET_INCREASE`, `PITCH_VERBAL_SELECTION` |
| Relations | both with `SALES_BUDGET_MENTIONED` (amount context) |
| Date gate | — |
| Relevance window | default |
| Deal effect | risk trigger RISK_BUDGET_MISMATCH; no stage change |

**Определение:** Клиент подтверждает, что его бюджет существенно ниже стоимости обсуждаемого объёма работ, и просит снизить цену или изменить объём.

**Граница (не считается):** Только на топике, связанном с открытой сделкой. Сравниваются только суммы одного состава работ и одного периода. Сокращение уже утверждённого бюджета — `SALES_BUDGET_CUT`. Обычный торг о скидке без расхождения с бюджетом — `SALES_RENEGOTIATION` или `PITCH_FINAL_TERMS_DISCUSSION`. Отказ назвать бюджет — `PITCH_BUDGET_UNDISCLOSED`.

**Признаки для промпта (≤ 8):** «наш бюджет в два раза меньше», «в бюджет не укладываемся», «это сильно выше наших возможностей», «на такой объём у нас денег нет», «смета превышает выделенный бюджет», «можете уложиться в 1,5 млн?», «дорого, у нас заложено намного меньше», «давайте ужмём объём под наш бюджет»

**Синонимы и выражения (полный список):**
- Деловая переписка: «предложенная стоимость существенно превышает утверждённый бюджет», «просим пересмотреть смету с учётом бюджета в размере», «в рамках выделенных средств реализовать предложенный объём невозможно», «стоимость выходит за пределы бюджета проекта», «прошу предложить вариант в пределах указанной суммы», «бюджет на данный проект ограничен суммой»
- Чаты / мессенджеры (разговорный стиль): «ребят, это космос по деньгам», «у нас вдвое меньше», «не потянем такую смету», «можно как-то подешевле раза в два?», «денег столько нет, режьте», «бюджет не тот, увы»
- Сокращения и термины: «превышение бюджета», «смета выше бюджета», «не проходим по бюджету», «вне бюджета», «оверпрайс»
- Устойчивые конструкции / маркеры: «(бюджет / заложено / выделено) (меньше / ниже) + (в N раз / на N %)»; «(не укладыва(емся / ется) / не проходит) в бюджет»; «(уложитесь / ужмите) в» + сумма

**Похоже, но не это (анти-признаки):** «бюджет на кампанию — 5 млн» без сравнения → `SALES_BUDGET_MENTIONED`; «бюджет урезали на треть» → `SALES_BUDGET_CUT`; «бюджет не раскрываем» → `PITCH_BUDGET_UNDISCLOSED`; «дайте скидку 10 %, и подписываем» → `PITCH_FINAL_TERMS_DISCUSSION`; «выберем самого дешёвого» → `PITCH_PRICE_ONLY_SELECTION`; «бюджет увеличили, смета подходит» → `SALES_BUDGET_INCREASE`.

**Пример (evidence):** «Концепция понравилась, но смета на 12 млн, а у нас на весь год заложено 6 — можете предложить вариант под наш бюджет?»
**Контрпример:** «Бюджет на кампанию около 6 млн, ждём ваше предложение» до получения сметы → только `SALES_BUDGET_MENTIONED`, сравнивать не с чем.

**Заметка для карточки:** Ответственному за возможность предложить согласовать с клиентом изменение объёма, бюджета или условий участия, назвав обе суммы.

### `PITCH_PRICE_ONLY_SELECTION` — Клиент выбирает только по цене

| Field | Value |
|---|---|
| Pack · block · family | agency · N4 · pitch |
| Weight · class · kind · score rule | 6 · risk · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · yes · yes |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (P6) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: comparable criteria agreed (a later `PITCH_SELECTION_CRITERIA_DISCLOSED` that is not itself price-only) |
| Relations | leads over `PITCH_SELECTION_CRITERIA_DISCLOSED` (Maslov §5.5: one price-selection risk card with the disclosed criteria); Q24-7: Maslov closing «принято решение go/no-go» → «принято решение об условиях участия» |
| Date gate | — |
| Relevance window | default |
| Deal effect | risk trigger RISK_PRICE_ONLY; no stage change |

**Определение:** Клиент или его закупки прямо сравнивают агентства только по цене, не учитывая существенных различий в составе, качестве и экономике предложений.

**Граница (не считается):** Только на топике, связанном с открытой сделкой. Цена как один из нескольких критериев (например, 40 % из 100) — не выбор только по цене; это `PITCH_SELECTION_CRITERIA_DISCLOSED`. Просьба о скидке — `PITCH_FINAL_TERMS_DISCUSSION` или `SALES_RENEGOTIATION`. Расхождение со своим бюджетом — `PITCH_BUDGET_MISMATCH`.

**Признаки для промпта (≤ 8):** «выбираем по минимальной цене», «победит тот, кто даст меньшую стоимость», «единственный критерий — цена», «креатив у всех примерно одинаковый, решает цена», «закупки смотрят только на итоговую сумму», «аукцион на понижение», «другое агентство дешевле, сравниваем только стоимость», «качество не оцениваем, только ставки»

**Синонимы и выражения (полный список):**
- Деловая переписка: «оценка заявок осуществляется по критерию наименьшей цены», «победителем признаётся участник, предложивший минимальную стоимость», «содержательная часть предложений оцениваться не будет», «решение будет принято на основании сравнения итоговых смет», «просим снизить стоимость до уровня наиболее выгодного предложения», «закупка проводится в форме редукциона»
- Чаты / мессенджеры (разговорный стиль): «короче, кто дешевле, тот и выиграл», «по креативу вы все норм, вопрос в деньгах», «у конкурентов на 30 % дешевле, сможете так же?», «закупщики смотрят только на цифру», «качество им не важно, только цена», «давайте самую низкую цену, и вы в деле»
- Сокращения и термины: «минимальная цена», «редукцион», «аукцион на понижение», «конкурс по цене», «единственный критерий — стоимость», «тендер по НМЦ»
- Устойчивые конструкции / маркеры: «(выбираем / решаем / оцениваем) (только / исключительно) по (цене / стоимости)»; «(победит / выиграет) (кто дешевле / минимальная цена)»; «(креатив / качество) (не оцениваем / у всех одинаковый)»

**Похоже, но не это (анти-признаки):** «критерии: креатив 50 %, команда 20 %, цена 30 %» → `PITCH_SELECTION_CRITERIA_DISCLOSED`; «можете дать скидку?» → `PITCH_FINAL_TERMS_DISCUSSION`; «наш бюджет меньше» → `PITCH_BUDGET_MISMATCH`; «критерии раскрывать не будем» → `PITCH_SELECTION_CRITERIA_UNCLEAR`; «выбрали другое агентство, у них дешевле» → `PITCH_EXCLUDED`.

**Пример (evidence):** «По креативу все участники примерно равны, поэтому закупки будут выбирать агентство исключительно по итоговой стоимости — пришлите финальную цену до среды».
**Контрпример:** «Оцениваем по трём критериям: идея, опыт команды и стоимость, вес цены — 30 %» → цена лишь один из критериев, это `PITCH_SELECTION_CRITERIA_DISCLOSED`.

**Заметка для карточки:** Ответственному за возможность с участием new biz предложить проверить сопоставимость предложений и решить вопрос об условиях дальнейшего участия.

### `PITCH_SELECTION_CRITERIA_UNCLEAR` — Критерии выбора остаются непрозрачными

| Field | Value |
|---|---|
| Pack · block · family | agency · N4 · pitch |
| Weight · class · kind · score rule | 6 · risk · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · yes · no |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (P6) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: `PITCH_SELECTION_CRITERIA_DISCLOSED` |
| Relations | common risk incident with `PITCH_DECISION_MAKER_UNCLEAR` (Maslov §5.4) |
| Date gate | — |
| Relevance window | default |
| Deal effect | risk trigger RISK_SELECTION_CRITERIA_UNCLEAR; no stage change |

**Определение:** Клиент прямо отказывается или не может объяснить, как оцениваются предложения, кто участвует в выборе и что нужно для победы, хотя агентство об этом спрашивало.

**Граница (не считается):** Только на топике, связанном с открытой сделкой. Отсутствие критерия в одном сообщении не доказывает непрозрачность всего отбора. Если клиент объяснил процедуру и критерии — `PITCH_SELECTION_CRITERIA_DISCLOSED`. Если неизвестен только владелец решения — `PITCH_DECISION_MAKER_UNCLEAR`.

**Признаки для промпта (≤ 8):** «критерии раскрывать не будем», «как будем выбирать — внутренняя информация», «оценим комплексно», «по каким параметрам сравниваем — сказать не можем», «посмотрим, что понравится», «сколько участников — не раскрываем», «порядок выбора пока не определён», «решим по совокупности, без формальных критериев»

**Синонимы и выражения (полный список):**
- Деловая переписка: «критерии оценки предложений не подлежат раскрытию», «методика оценки является внутренним документом компании», «выбор будет осуществлён на основании комплексной оценки», «информация о других участниках отбора не предоставляется», «порядок проведения отбора будет определён позднее», «на вопросы о критериях выбора ответить не можем»
- Чаты / мессенджеры (разговорный стиль): «да как пойдёт, так и выберем», «критериев как таковых нет, по ощущениям», «это кухня закупок, не знаю», «покажите лучшее, а там решим», «не могу сказать, что важнее», «сами пока не понимаем, как будем сравнивать»
- Сокращения и термины: «закрытые критерии», «непрозрачный отбор», «методика оценки не раскрывается», «без матрицы оценки», «без скоринга»
- Устойчивые конструкции / маркеры: «критерии (не раскрываем / не можем назвать / конфиденциальны)»; «(оценим / выберем / решим) (комплексно / по совокупности / по ощущениям)»; «(порядок / процедура) выбора (не определён(а) / уточняется)»

**Похоже, но не это (анти-признаки):** «оценка: креатив 50 %, опыт 30 %, цена 20 %» → `PITCH_SELECTION_CRITERIA_DISCLOSED`; «кто финально решает — не знаем» → `PITCH_DECISION_MAKER_UNCLEAR`; «решающий критерий — минимальная цена» → `PITCH_PRICE_ONLY_SELECTION`; «критерии поменялись» → `PITCH_REQUIREMENTS_CHANGED`; «бриф дадим позже» → `PITCH_BRIEF_INCOMPLETE`.

**Пример (evidence):** «По критериям оценки, к сожалению, подсказать не можем — методика внутренняя, решение примем комплексно после всех презентаций».
**Контрпример:** «В этом письме критерии не указаны, вышлем таблицу оценки завтра вместе с брифом» → одно сообщение без критериев, раскрытие обещано, риска нет.

**Заметка для карточки:** Ответственному за возможность предложить запросить у клиента критерии, участников и условия победы либо решить вопрос об участии с этим ограничением.

### `PITCH_SCOPE_WITHOUT_ADJUSTMENT` — Объём изменён без изменения цены и срока

| Field | Value |
|---|---|
| Pack · block · family | agency · N4 · pitch |
| Weight · class · kind · score rule | 7 · risk · event · fixed |
| Effort · asks us · inbound only · amount | medium · yes · yes · yes |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (P6) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: a confirmed new version of scope + price + date (`SALES_BUDGET_INCREASE`, `SALES_BOOKING_RECEIVED` on the new version) |
| Relations | leads over `PITCH_REQUIREMENTS_CHANGED` (Maslov §5.5 and §5.6 example: one P6 card with the concrete scope change and the need to re-agree terms) |
| Date gate | — |
| Relevance window | default |
| Deal effect | risk trigger `RISK_SCOPE_WITHOUT_ADJUSTMENT`; no stage change |

**Определение:** Клиент по открытой возможности расширил или изменил объём работ (новые направления, каналы, форматы, рынки, этапы), но прямо сохранил прежние ожидания по цене и/или сроку. Сигнал фиксирует разрыв между новым объёмом и старыми коммерческими условиями.

**Граница (не считается):** Перераспределение задач внутри уже оплаченного объёма по действующему договору — `DELIVERY_CHANGE_REQUESTED`. Изменение брифа или процедуры отбора без указания, что цена и срок остаются прежними, — `PITCH_REQUIREMENTS_CHANGED`. Клиент сам предлагает увеличить бюджет под новый объём — `SALES_BUDGET_INCREASE`. Сигнал имеет смысл только на теме, связанной с открытой сделкой (до заказа); без сделки — нет сигнала.

**Признаки для промпта (≤ 8):** «добавьте ещё два направления, бюджет прежний», «сроки и бюджет те же», «в рамках той же суммы», «без увеличения стоимости», «уложитесь в ту же смету», «дедлайн не двигается», «расширяем задачу, но бюджет не меняется», «плюс ещё один рынок за те же деньги»

**Синонимы и выражения (полный список):**
- Деловая переписка: «просим добавить в предложение ещё два направления, бюджет и сроки остаются прежними», «прошу учесть дополнительный канал в рамках согласованной суммы», «объём расширяется, однако бюджет проекта пересматриваться не будет», «дата запуска остаётся прежней», «включите, пожалуйста, digital-поддержку без изменения стоимости», «необходимо дополнительно охватить регионы в пределах текущей сметы», «коммерческие условия просим сохранить»
- Чаты / мессенджеры (разговорный стиль): «докиньте ещё соцсети, бюджет тот же», «надо ещё и SMM, но денег больше не будет», «плюсом сделайте спецпроект, по деньгам так же», «добавим ещё два города, сроки не сдвигаем», «давайте ещё ивент впишем, смета та же», «ну и видео нужно, но в ту же сумму уложитесь же?»
- Сокращения и термины: «смета», «бюджет», «скоуп», «объём работ», «тайминг», «дедлайн», «KPI», «медиамикс», «доп. каналы»
- Устойчивые конструкции / маркеры: «добавьте / включите / расширьте» + объект + «бюджет / сроки / стоимость прежние»; «в рамках той же суммы»; «без изменения стоимости / сроков»; «за те же деньги»

**Похоже, но не это (анти-признаки):** «поменяем приоритеты внутри ретейнера» → `DELIVERY_CHANGE_REQUESTED`; «мы изменили бриф, критерии теперь другие» → `PITCH_REQUIREMENTS_CHANGED`; «добавим объём и увеличим бюджет на 2 млн» → `SALES_BUDGET_INCREASE`; «давайте пересмотрим уже согласованную цену» → `SALES_RENEGOTIATION`; «бюджет урезали» → `SALES_BUDGET_CUT`.

**Пример (evidence):** «Коллеги, добавьте, пожалуйста, в концепцию ещё два направления — HR-бренд и внутренние коммуникации. Бюджет и дата защиты остаются прежними.»
**Контрпример:** «Вместо двух постов в неделю давайте делать один пост и одну сторис, в рамках текущего ретейнера.» → это перераспределение внутри оплаченного объёма по действующей работе (`DELIVERY_CHANGE_REQUESTED`), а не расширение объёма до заказа.

**Заметка для карточки:** Ответственному за возможность — назвать, что добавил клиент, и предложить пересогласовать границы работ, цену и срок до продолжения подготовки.

### `PITCH_UNPAID_WORK_EXPANDING` — Растёт бесплатная проработка

| Field | Value |
|---|---|
| Pack · block · family | agency · N4 · pitch |
| Weight · class · kind · score rule | 6 · risk · event · fixed |
| Effort · asks us · inbound only · amount | complex · yes · yes · yes |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (P6) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: limits and result of the next stage agreed (`PITCH_SHORTLISTED`, `PITCH_VERBAL_SELECTION`) or the user sets outcome `withdrawn` |
| Relations | leads over `PITCH_REVISION_REQUESTED` (Maslov §5.5: one card, the risk leads, the revision request is context); Q24-7: Maslov «принято no-go» → user outcome `withdrawn` |
| Date gate | — |
| Relevance window | default |
| Deal effect | risk trigger `RISK_UNPAID_WORK` |

**Определение:** Клиент по открытой возможности просит дополнительные концепции, расчёты, медиапланы, макеты или почти готовые решения сверх согласованного этапа подготовки, не подтверждая продвижения к выбору (шорт-лист, критерии, дата решения) и не предлагая оплату.

**Граница (не считается):** Один согласованный этап подготовки (концепция по брифу) — не риск, это `PITCH_SOLUTION_REQUESTED`. Одна существенная доработка уже представленной работы — `PITCH_REVISION_REQUESTED`. Оплачиваемый пилот или платная стратегическая сессия — не этот код. Сигнал имеет смысл только на теме, связанной с открытой сделкой.

**Признаки для промпта (≤ 8):** «сделайте ещё пару концепций, посмотрим», «пришлите ещё варианты», «нужен детальный медиаплан до выбора», «распишите полностью механику и тайминг», «покажите готовые макеты», «а можно ещё вариант для другого продукта», «до решения хотим увидеть больше», «оплатить проработку не можем»

**Синонимы и выражения (полный список):**
- Деловая переписка: «просим подготовить ещё две альтернативные концепции», «для принятия решения нам необходим детальный медиаплан и расчёт», «просим проработать креатив до уровня готовых макетов», «дополнительно подготовьте, пожалуйста, стратегию на второй год», «оплата подготовительных материалов не предусмотрена», «участие в конкурсе осуществляется на безвозмездной основе»
- Чаты / мессенджеры (разговорный стиль): «сделайте ещё пару концепций, посмотрим», «можете ещё накидать варианты?», «а давайте ещё под второй бренд прикинете», «нам бы ещё сценарий ролика, чтобы понять», «пришлите прямо готовые посты на месяц, оценим», «ну и смету подробно по каждой позиции, плиз»
- Сокращения и термины: «концепция», «креатив», «КВ» (ключевой визуал), «медиаплан», «сценарий», «раскадровка», «механика», «пилот», «спек-работа»
- Устойчивые конструкции / маркеры: «ещё (пару / несколько) вариантов / концепций»; «до решения / до выбора» + «хотим увидеть / нужно»; «подготовьте дополнительно»; «на безвозмездной основе / без оплаты»

**Похоже, но не это (анти-признаки):** «поправьте, пожалуйста, слоган и цвета в KV» → `PITCH_REVISION_REQUESTED`; «пришлите кейсы по ритейлу» → `PITCH_CREDENTIALS_REQUESTED`; «доработайте концепцию третий раз, критериев пока нет» → `PITCH_REVISIONS_WITHOUT_DECISION`; «добавьте направления, бюджет прежний» → `PITCH_SCOPE_WITHOUT_ADJUSTMENT`; «готовы оплатить пилотный месяц» → нет сигнала (или `SALES_NEW_DEMAND`).

**Пример (evidence):** «Концепция интересная, но до решения хотим увидеть ещё два альтернативных креатива и полный медиаплан на год. Оплатить подготовку на этом этапе, к сожалению, не можем.»
**Контрпример:** «Спасибо за концепцию, поправьте, пожалуйста, слоган и цвет в ключевом визуале к пятнице.» → одна точечная доработка (`PITCH_REVISION_REQUESTED`), рост бесплатной проработки не подтверждён.

**Заметка для карточки:** Ответственному за возможность вместе с new biz — предложить клиенту ограничить следующий этап, согласовать его оплату или условия решения, а при отказе решить об участии.

### `PITCH_REVISIONS_WITHOUT_DECISION` — Доработки повторяются без условий решения

| Field | Value |
|---|---|
| Pack · block · family | agency · N4 · pitch |
| Weight · class · kind · score rule | 6 · risk · derived · fixed |
| Effort · asks us · inbound only · amount | complex · yes · — · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (P6) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: `PITCH_SELECTION_CRITERIA_DISCLOSED` (final criteria and decision order confirmed), `PITCH_VERBAL_SELECTION` |
| Relations | leads over `PITCH_REVISION_REQUESTED` (Maslov §5.5: one card, the risk leads) |
| Date gate | — |
| Relevance window | default |
| Deal effect | risk trigger `RISK_REVISIONS_NO_DECISION` |

**Определение:** После нескольких содержательных версий предложения клиент продолжает просить изменения и не называет, какие условия выбора остались, кто и когда примет решение. Доработки идут по кругу без движения к выбору.

**Граница (не считается):** Один запрос доработки — `PITCH_REVISION_REQUESTED`. Новые дополнительные концепции сверх этапа — `PITCH_UNPAID_WORK_EXPANDING`. Доработка после ясно названных финальных критериев и даты решения — не риск. Сигнал имеет смысл только на теме, связанной с открытой сделкой в текущем цикле отбора.

**Правило процесса (trigger rule):** RU: процесс создаёт сигнал, когда по одной сделке в текущем цикле отбора накоплено не менее 3 экземпляров `PITCH_REVISION_REQUESTED` (настройка `risk.revisionCount` = 3) и после первого из них не было `PITCH_SELECTION_CRITERIA_DISCLOSED`, перехода стадии или исхода. Повторное упоминание того же запроса не считается новым экземпляром. Недостаточно данных — сигнал не создаётся. EN: the process emits the code when one deal has ≥ 3 `PITCH_REVISION_REQUESTED` instances in the current selection cycle (setting `risk.revisionCount` = 3) and no `PITCH_SELECTION_CRITERIA_DISCLOSED`, stage move or outcome followed the first of them. A repeated mention of one request is not a new instance. Insufficient data → no instance. Parser arm: the client's own text shows another round without criteria.

**Признаки для промпта (≤ 8):** «давайте ещё одну итерацию», «ещё один вариант, пока сами не понимаем, что хотим», «опять не то, переделайте», «ещё круг правок», «решение примем, когда увидим финальную версию», «пока не можем сказать, чего не хватает», «покажите ещё раз в другом ключе», «это уже третья версия, но давайте ещё»

**Синонимы и выражения (полный список):**
- Деловая переписка: «просим подготовить ещё одну версию предложения», «по итогам обсуждения требуется очередная доработка», «критерии финальной версии пока не определены», «окончательное решение будет принято после следующей итерации», «руководство просит ещё раз пересмотреть подход», «к сожалению, пока сформулировать замечания конкретнее не можем»
- Чаты / мессенджеры (разговорный стиль): «давайте ещё одну итерацию», «ну опять не то, попробуйте ещё», «ещё разок переделаем?», «сами пока не понимаем, что хотим, покажите ещё», «шеф снова завернул, нужна новая версия», «ещё круг и, может, решим»
- Сокращения и термины: «итерация», «версия», «круг правок», «v3 / v4», «фидбэк», «финальная версия», «доработка»
- Устойчивые конструкции / маркеры: «ещё (одну) итерацию / версию / круг»; «опять / снова» + «переделать / доработать»; «пока не понимаем / не можем сказать» + «что хотим / чего не хватает»

**Похоже, но не это (анти-признаки):** «поправьте, пожалуйста, смету и состав команды» (первый запрос) → `PITCH_REVISION_REQUESTED`; «сделайте ещё две новые концепции, посмотрим» → `PITCH_UNPAID_WORK_EXPANDING`; «финальная правка, решение комиссии 20.11» → `PITCH_REVISION_REQUESTED` (критерии и дата известны); «мы изменили бриф» → `PITCH_REQUIREMENTS_CHANGED`; «решение переносим на декабрь» → `PITCH_DECISION_DELAYED_BY_CLIENT`.

**Пример (evidence):** «Спасибо за третью версию. Руководство снова просит переделать подход — пока сами не можем сформулировать, чего не хватает. Давайте ещё одну итерацию.»
**Контрпример:** «Последняя правка: уберите второй вариант слогана. Решение комиссия примет 20 ноября по трём критериям, которые мы прислали.» → критерии и дата решения названы; это обычная доработка (`PITCH_REVISION_REQUESTED`).

**Заметка для карточки:** Ответственному за возможность — договориться с клиентом о критериях финальной версии, порядке решения и пределе числа итераций, прежде чем начинать следующую доработку.

### `PITCH_EXPERTISE_DOUBTED` — Клиент сомневается в экспертизе команды

| Field | Value |
|---|---|
| Pack · block · family | agency · N4 · pitch |
| Weight · class · kind · score rule | 7 · risk · event · fixed |
| Effort · asks us · inbound only · amount | medium · yes · yes · no |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (P6) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: `PITCH_SHORTLISTED`, `PITCH_QUALIFIED` after the doubt, or the client confirms the team |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | risk trigger `RISK_EXPERTISE_DOUBTED` |

**Определение:** Клиент прямо ставит под сомнение опыт, отраслевые компетенции, масштаб или способность предложенной команды выполнить задачу (нет кейсов в отрасли, слишком маленькая команда, нет нужного специалиста).

**Граница (не считается):** Нейтральная просьба прислать релевантные кейсы без выраженного сомнения — `PITCH_CREDENTIALS_REQUESTED`. Жалоба на качество уже выполненной работы по действующему договору — `COMPLAINT_QUALITY`. Сомнение в цене, а не в компетенции, — `PITCH_BUDGET_MISMATCH` или `SALES_RENEGOTIATION`. Сигнал имеет смысл только на теме, связанной с открытой сделкой.

**Признаки для промпта (≤ 8):** «не уверены, что у вас есть опыт в фарме», «у вас нет кейсов в нашей отрасли», «справитесь ли вы с таким объёмом», «команда выглядит слабой / маленькой», «нет сеньора по digital», «опасаемся, что не потянете», «боимся, что не хватит экспертизы», «конкуренты сильнее по опыту»

**Синонимы и выражения (полный список):**
- Деловая переписка: «у нас есть сомнения в наличии у агентства релевантного опыта», «не видим в портфолио проектов сопоставимого масштаба», «опасаемся, что предложенная команда не обладает достаточной экспертизой в B2B», «просим обосновать компетенции команды в регулируемых отраслях», «комиссия отметила недостаточный опыт в федеральных кампаниях», «не уверены, что команда справится с параллельным запуском в регионах»
- Чаты / мессенджеры (разговорный стиль): «честно, не уверены, что вы вытянете», «у вас же не было фармы?», «команда какая-то маленькая для нас», «а кто у вас реально делал кризисный PR?», «боимся, что опыта в финтехе мало», «шеф сомневается, что вы потянете федеральный масштаб»
- Сокращения и термины: «экспертиза», «компетенции», «релевантный опыт», «кейсы», «портфолио», «сеньор», «аккаунт-команда», «отраслевая специфика»
- Устойчивые конструкции / маркеры: «не уверены / сомневаемся / опасаемся» + «что справитесь / в опыте / в экспертизе»; «у вас нет / не было» + «опыта / кейсов в» + отрасль; «потянете ли»

**Похоже, но не это (анти-признаки):** «пришлите, пожалуйста, кейсы по фарме для анкеты» → `PITCH_CREDENTIALS_REQUESTED`; «хотим познакомиться с командой проекта» → `PITCH_TEAM_INTRO_REQUESTED`; «результат кампании нас не устроил» → `COMPLAINT_QUALITY`; «у вас дорого» → `PITCH_BUDGET_MISMATCH` или `COMPLAINT_PRICE`.

**Пример (evidence):** «Подход нам нравится, но, честно говоря, не уверены, что у вас есть опыт в фарме — в портфолио не увидели ни одного проекта с рецептурными препаратами.»
**Контрпример:** «Для анкеты участника пришлите, пожалуйста, три кейса по фармацевтике.» → нейтральный запрос материалов без сомнения (`PITCH_CREDENTIALS_REQUESTED`).

**Заметка для карточки:** Ответственному за возможность — уточнить, в чём именно сомневается клиент, и подтвердить компетенцию релевантными кейсами, экспертами или составом команды.

### `PITCH_CLIENT_COMMITMENT_BROKEN` — Клиент не выполнил договорённость по сделке

| Field | Value |
|---|---|
| Pack · block · family | agency · N4 · pitch |
| Weight · class · kind · score rule | 6 · risk · watchdog · fixed |
| Effort · asks us · inbound only · amount | medium · yes · yes · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (P6) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: the promised item received, or the client agreed changed terms (new date) |
| Relations | boundary vs `DELIVERY_CLIENT_DEPENDENCY_DELAYED` (the same type of delay after the order) |
| Date gate | { fact: clientPromiseDate, test: beyond, setting: `noResponseDefaultDays` (7) when the promise had no date } |
| Relevance window | default |
| Deal effect | risk trigger `RISK_CLIENT_COMMITMENT_BROKEN` |

**Определение:** Клиент по открытой возможности (до заказа) обещал ответ, бриф, материалы, доступ, согласование или встречу к сроку, срок прошёл, обещанное не поступило, и это блокирует следующий шаг продажи. Подтверждается признанием клиента или процессной проверкой.

**Граница (не считается):** Задержка материалов или согласований при исполнении уже полученного заказа — `DELIVERY_CLIENT_DEPENDENCY_DELAYED`. Перенос даты выбора поставщика — `PITCH_DECISION_DELAYED_BY_CLIENT`. Отсутствие обратной связи по уже представленному решению — `PITCH_FEEDBACK_MISSING`. Обещание без срока, по которому не прошло окно по умолчанию, — нет сигнала. Сигнал имеет смысл только на теме, связанной с открытой сделкой в стадиях S1–S4.

**Правило процесса (trigger rule):** RU (Q24-11): есть исходная договорённость — обещание клиента на теме сделки (facts.deadlines, владелец = клиент) в стадиях S1–S4; срок прошёл (согласованная дата, иначе 7 календарных дней по `noResponseDefaultDays`); проверены все подключённые каналы; с тех пор нет входящего сообщения, которое выполняет обещание или согласует новый срок. Недостаточно данных — сигнал не создаётся. EN (Q24-11): an originating client-owned promise on a deal topic (facts.deadlines owner = client) in S1–S4; the agreed date (else 7 calendar days, `noResponseDefaultDays`) has passed; all connected channels checked; no qualifying inbound item that delivers the promise or agrees a new date. Insufficient data → no instance. Parser arm: the client admits the miss.

**Признаки для промпта (≤ 8):** «бриф обещали до пятницы, но не успеваем», «материалы пока не готовы», «согласование ещё не получили», «доступы пришлём позже», «извините, не успели собрать ответы», «с цифрами задерживаемся», «встречу с маркетингом пока не организовали», «вернёмся с вводными чуть позже»

**Синонимы и выражения (полный список):**
- Деловая переписка: «к сожалению, не успеваем предоставить бриф к оговорённому сроку», «ответы на ваши вопросы направим позднее», «исходные данные по продажам пока не согласованы внутри», «доступ к аналитике предоставить пока не можем», «встреча с бизнес-заказчиком откладывается», «приносим извинения за задержку с вводными»
- Чаты / мессенджеры (разговорный стиль): «бриф обещали до пятницы, но не успеваем», «блин, цифры ещё не собрали», «доступы чуть позже скину», «пока не получилось вытащить маркетинг на созвон», «ответы будут, но не на этой неделе», «вводные задерживаются, сорри»
- Сокращения и термины: «бриф», «вводные», «исходники», «доступы», «данные», «согласование», «NDA на подписи у нас»
- Устойчивые конструкции / маркеры: «обещали / договорились» + «до» + дата + «но не успеваем»; «пока не (готово / собрали / согласовали)» + объект для продажи; «пришлём / вернёмся позже»

**Похоже, но не это (анти-признаки):** «исходники для макетов по проекту пришлём на следующей неделе» (идёт исполнение заказа) → `DELIVERY_CLIENT_DEPENDENCY_DELAYED`; «решение по агентству переносим на январь» → `PITCH_DECISION_DELAYED_BY_CLIENT`; «комиссия пока не собиралась, комментариев нет» → `PITCH_FEEDBACK_MISSING`; «договор пока у юристов» (после выбора) → `PITCH_ORDER_FORMALIZATION_DELAYED`.

**Пример (evidence):** «Коллеги, бриф обещали прислать до пятницы, но не успеваем — маркетинг ещё не согласовал вводные. Постараемся на следующей неделе.»
**Контрпример:** «Исходники для макетов кампании пришлём в среду, задерживаемся с фотосессией.» → это шаг исполнения действующего проекта (`DELIVERY_CLIENT_DEPENDENCY_DELAYED`), а не договорённость по сделке.

**Заметка для карточки:** Ответственному за возможность — напомнить клиенту об обещанном, согласовать новый срок и оценить влияние задержки на план подготовки.

### `PITCH_FEEDBACK_MISSING` — Нет содержательной обратной связи по решению

| Field | Value |
|---|---|
| Pack · block · family | agency · N4 · pitch |
| Weight · class · kind · score rule | 5 · risk · watchdog · fixed |
| Effort · asks us · inbound only · amount | quick · no · yes · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (D4) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: substantive feedback (`PITCH_REVISION_REQUESTED`, `PITCH_SELECTION_CRITERIA_DISCLOSED`, `PITCH_SHORTLISTED`) or an explicit outcome |
| Relations | — |
| Date gate | { fact: feedbackDueDate, test: beyond, setting: — (no default: Q24-11 requires an agreed date) } |
| Relevance window | default |
| Deal effect | risk trigger `RISK_FEEDBACK_MISSING` |

**Определение:** После отправленного предложения или проведённой защиты клиент не обсуждает решение и не объясняет, что мешает следующему шагу: согласованный срок обратной связи прошёл без содержательного ответа, либо клиент прямо подтверждает, что обратной связи пока нет.

**Граница (не считается):** Формальный ответ «получили, спасибо» не является обратной связью, но и сам по себе не создаёт сигнал без прошедшего согласованного срока. Перенос даты выбора — `PITCH_DECISION_DELAYED_BY_CLIENT`. Невыполненное обещание прислать материалы для подготовки — `PITCH_CLIENT_COMMITMENT_BROKEN`. Без согласованного срока процесс сигнал не создаёт (Q24-11). Сигнал имеет смысл только на теме, связанной с открытой сделкой.

**Правило процесса (trigger rule):** RU (Q24-11): есть исходное событие — `SALES_OFFER_SENT` или проведённая защита по сделке; есть согласованная дата обратной связи (facts.feedbackDueDate); дата прошла; проверены все подключённые каналы; содержательного ответа клиента нет. Значения по умолчанию нет: без согласованной даты считается только подтверждение от клиента (ветка парсера). Недостаточно данных — сигнал не создаётся. EN (Q24-11): an originating event (`SALES_OFFER_SENT` or a held defence on the deal), an agreed feedback date that has passed, all connected channels checked, no substantive client reply → instance. No default window: without an agreed date only the parser arm (direct confirmation) counts. Insufficient data → no instance.

**Признаки для промпта (≤ 8):** «комиссия пока не собиралась, комментариев нет», «обратной связи пока нет», «руководство ещё не смотрело», «пока нечего сказать по вашему предложению», «фидбэка не будет до», «мы ещё не обсуждали внутри», «по итогам защиты пока тишина», «комментариев от бизнеса пока не получили»

**Синонимы и выражения (полный список):**
- Деловая переписка: «обратную связь по вашему предложению пока предоставить не можем», «предложение ещё не рассматривалось комиссией», «комментарии бизнес-заказчика пока не получены», «обсуждение итогов защиты внутри компании ещё не состоялось», «по существу предложения вернуться пока не готовы», «сроки предоставления обратной связи уточним позже»
- Чаты / мессенджеры (разговорный стиль): «пока фидбэка нет, сорри», «комиссия ещё не собиралась», «шеф не смотрел пока», «пока тишина от маркетинга», «нечего пока сказать, ждём руководство», «по защите пока ничего не обсуждали»
- Сокращения и термины: «фидбэк», «обратная связь», «комиссия», «тендерный комитет», «защита», «питч», «итоги рассмотрения»
- Устойчивые конструкции / маркеры: «обратной связи / комментариев / фидбэка» + «пока нет / не будет»; «(комиссия / руководство) ещё не (собиралась / смотрело / обсуждало)»

**Похоже, но не это (анти-признаки):** «получили, спасибо» → нет сигнала (формальный ответ, нужна прошедшая согласованная дата); «решение перенесли на после праздников» → `PITCH_DECISION_DELAYED_BY_CLIENT`; «бриф не успеваем прислать» → `PITCH_CLIENT_COMMITMENT_BROKEN`; «поправьте смету по итогам защиты» → `PITCH_REVISION_REQUESTED` (это и есть обратная связь).

**Пример (evidence):** «Добрый день! Комиссия пока не собиралась, комментариев по вашей защите у нас нет — когда будут, не знаю.»
**Контрпример:** «Получили презентацию, спасибо. Обсудим на комиссии 18-го и вернёмся с комментариями до 20-го.» → формальное подтверждение получения с будущей датой; срок не прошёл, риска нет.

**Заметка для карточки:** Ответственному за возможность — договориться с клиентом о разборе решения: что понравилось, что мешает следующему шагу и когда будет решение.

### `PITCH_ORDER_FORMALIZATION_DELAYED` — После выбора затягивается оформление заказа

| Field | Value |
|---|---|
| Pack · block · family | agency · N4 · pitch |
| Weight · class · kind · score rule | 7 · risk · event · fixed |
| Effort · asks us · inbound only · amount | medium · yes · yes · yes |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (P6) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: `SALES_BOOKING_RECEIVED` or an explicit change of the decision |
| Relations | — ; a verbal win never closes formalisation (spec §2.1 rule 7) |
| Date gate | { fact: formalizationDate, test: beyond, setting: `noResponseDefaultDays` (7) } for the process arm |
| Relevance window | default |
| Deal effect | risk trigger `RISK_VERBAL_NOT_ORDER` (stage guard S4); no stage change, never an automatic loss |

**Определение:** После подтверждённого выбора агентства (устно или официально) клиент задерживает оформление договора или заказа либо снова открывает уже согласованные условия (цену, объём, оплату, сроки).

**Граница (не считается):** Сигнал не превращает стадию 4 в заказ и не означает проигрыш. До выбора агентства задержки — `PITCH_DECISION_DELAYED_BY_CLIENT` или `PITCH_CLIENT_COMMITMENT_BROKEN`. Пересмотр условий уже действующего договора — `SALES_RENEGOTIATION`. Подписанный договор или заказ — `SALES_BOOKING_RECEIVED`. Сигнал имеет смысл только на теме сделки в стадии S4.

**Правило процесса (trigger rule):** RU (Q24-11): сделка на стадии S4; есть согласованная дата оформления договора или заказа (facts.formalizationDate), иначе 7 календарных дней от выбора (`noResponseDefaultDays`); срок прошёл; проверены все подключённые каналы; `SALES_BOOKING_RECEIVED` нет. Недостаточно данных — сигнал не создаётся. EN (Q24-11): deal at S4; agreed formalisation date (else 7 calendar days from the selection, `noResponseDefaultDays`) has passed; all connected channels checked; no `SALES_BOOKING_RECEIVED`. Insufficient data → no instance. Parser arm: the client's text shows the delay or reopens agreed terms.

**Признаки для промпта (≤ 8):** «договор пока у юристов», «давайте ещё раз обсудим условия», «подписание откладывается», «закупки ещё не завели заявку», «бюджет на проект пока не утвердили», «договор оформим позже», «нужно ещё согласовать с финдиректором цену», «пока не можем подписать»

**Синонимы и выражения (полный список):**
- Деловая переписка: «договор находится на согласовании в юридическом департаменте», «подписание договора переносится», «просим вернуться к обсуждению стоимости перед подписанием», «закупочная процедура для оформления ещё не завершена», «финансовая служба просит пересмотреть условия оплаты до заключения договора», «заявка на закупку пока не согласована», «оформление заказа задерживается по внутренним причинам»
- Чаты / мессенджеры (разговорный стиль): «договор пока у юристов, ждём», «с подписанием затык», «финдир хочет ещё скидку, давайте обсудим», «закупки тормозят, ещё не завели», «оформим чуть позже, не волнуйтесь», «давайте ещё раз по цене пройдёмся перед договором»
- Сокращения и термины: «договор», «ДС» (допсоглашение), «заказ», «ТЗ к договору», «закупки», «тендерный протокол», «ЭДО», «СЭД», «финдир»
- Устойчивые конструкции / маркеры: «договор / подписание / оформление» + «пока / откладывается / задерживается»; «давайте ещё раз (обсудим / пройдёмся)» + «условия / цену» после выбора; «на согласовании у» + юристов / финансов / закупок

**Похоже, но не это (анти-признаки):** «мы выбрали вас, договор пришлём на следующей неделе» → `PITCH_VERBAL_SELECTION` (обычный следующий шаг, не задержка); «договор подписан, начинаем» → `SALES_BOOKING_RECEIVED`; «решение по агентству перенесли» (выбора ещё нет) → `PITCH_DECISION_DELAYED_BY_CLIENT`; «хотим пересмотреть цену действующего ретейнера» → `SALES_RENEGOTIATION`; «оплата через 120 дней» → `PITCH_PAYMENT_TERMS_UNFAVORABLE`.

**Пример (evidence):** «Решение в вашу пользу в силе, но договор пока у юристов, а финдиректор просит ещё раз обсудить стоимость второго этапа перед подписанием.»
**Контрпример:** «Поздравляем, вы выиграли! Проект договора пришлём до конца недели.» → это выбор агентства (`PITCH_VERBAL_SELECTION`), задержки ещё нет.

**Заметка для карточки:** Ответственному за возможность — выяснить, что блокирует оформление, и согласовать с клиентом план и дату подписания договора или заказа.

### `PITCH_PAYMENT_TERMS_UNFAVORABLE` — Клиент требует невыгодные условия оплаты

| Field | Value |
|---|---|
| Pack · block · family | agency · N4 · pitch |
| Weight · class · kind · score rule | 7 · risk · event · fixed |
| Effort · asks us · inbound only · amount | medium · yes · yes · yes |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (P6) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: terms approved by finance and agreed with the client (user action) or the user sets outcome `withdrawn` |
| Relations | — ; Q24-7: Maslov «принято no-go» → user outcome `withdrawn` |
| Date gate | — |
| Relevance window | default |
| Deal effect | risk trigger `RISK_PAYMENT_TERMS` |

**Определение:** Клиент по открытой возможности предлагает или требует условия оплаты, при которых агентство существенно финансирует работы за свой счёт: длинная постоплата, оплата только после выхода кампании или результата, отказ от аванса при крупных закупках у подрядчиков.

**Граница (не считается):** Обычная отсрочка в пределах согласованной политики агентства — нет сигнала. Неоплаченный выставленный счёт — `INVOICE_OVERDUE`. Спор по сумме счёта — `INVOICE_DISPUTE_RAISED`. Пересмотр цены уже согласованного договора — `SALES_RENEGOTIATION`. Сигнал имеет смысл только на теме, связанной с открытой сделкой (до заказа или при его оформлении).

**Признаки для промпта (≤ 8):** «оплата через 120 дней после акта», «постоплата 90 дней», «без аванса», «оплата по факту выхода кампании», «предоплату не делаем», «оплата после достижения KPI», «отсрочка платежа 180 дней», «медиабюджет оплачиваете вы, мы компенсируем»

**Синонимы и выражения (полный список):**
- Деловая переписка: «оплата производится в течение 120 календарных дней после подписания акта», «авансирование работ нашей политикой не предусмотрено», «оплата осуществляется по факту выхода всех материалов», «закупка медиа производится за счёт агентства с последующей компенсацией», «оплата вознаграждения агентства — после достижения целевых показателей», «стандартная отсрочка платежа для подрядчиков — 90 рабочих дней»
- Чаты / мессенджеры (разговорный стиль): «у нас постоплата 120, без вариантов», «аванс не дадим, сорри, политика», «заплатим, когда кампания выйдет», «производство оплатите сами, потом закроем», «отсрочка полгода, это стандарт у нас», «деньги только после акта и по факту KPI»
- Сокращения и термины: «постоплата», «отсрочка», «аванс», «предоплата», «акт», «КС / акт выполненных работ», «оплата по KPI», «success fee», «медиабюджет»
- Устойчивые конструкции / маркеры: «оплата (через / в течение) N дней» с длинным сроком; «без аванса / предоплаты»; «оплата (по факту / после)» + выхода / результата / KPI; «за счёт агентства»

**Похоже, но не это (анти-признаки):** «счёт №124 до сих пор не оплачен» → `INVOICE_OVERDUE`; «не согласны с суммой в счёте» → `INVOICE_DISPUTE_RAISED`; «давайте снизим ставку на 10 %» → `SALES_RENEGOTIATION`; «оплата 50 % аванс, 50 % после акта» (в пределах политики) → нет сигнала; «бюджет урезали» → `SALES_BUDGET_CUT`.

**Пример (evidence):** «По условиям: аванс мы не платим, оплата за производство и медиа — через 120 дней после подписания акта, так у нас со всеми подрядчиками.»
**Контрпример:** «Оплата стандартная: 50 % предоплата, остальное в течение 10 дней после акта.» → обычные условия в пределах политики, риска нет.

**Заметка для карточки:** Ответственному за возможность вместе с финансами — оценить нагрузку на финансирование и согласовать с клиентом допустимые условия оплаты, а при отказе решить об участии.

### `PITCH_REPEAT_UNPRODUCTIVE_TENDER` — Повторяется прежний безрезультатный отбор

| Field | Value |
|---|---|
| Pack · block · family | agency · N4 · pitch |
| Weight · class · kind · score rule | 6 · risk · derived · fixed |
| Effort · asks us · inbound only · amount | medium · no · — · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · n/a |
| Display profile | from weight (P6) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: confirmed material changes (`CONTACT_NEW_DECISION_MAKER`, `PITCH_BUYER_ACCESS_GRANTED`, `PITCH_SELECTION_CRITERIA_DISCLOSED` with new criteria) or the user decides on participation |
| Relations | — ; Q24-7: Maslov «повторно принять go/no-go» → «решить об условиях участия» |
| Date gate | — |
| Relevance window | default |
| Deal effect | risk trigger `RISK_REPEAT_TENDER` |

**Определение:** Клиент снова приглашает агентство в отбор после прежних конкурсов, которые закончились без результата (отменены или проиграны), и нет подтверждённых изменений в доступе к заказчику, процедуре, критериях или бюджете.

**Граница (не считается):** Новое приглашение в тендер само по себе — `SALES_TENDER_INVITATION`, не этот код. Повторный конкурс за текущий договор действующего клиента — `CONTRACT_RETENDER_ANNOUNCED`. Если клиент подтвердил существенные изменения (новый ЛПР, новый бриф, доступ к бизнес-заказчику), риска нет. Сигнал имеет смысл только на теме, связанной с открытой сделкой.

**Правило процесса (trigger rule):** RU: при создании сделки процесс проверяет клиента: не менее 2 прежних возможностей за 24 месяца закрыты с исходом `cancelled` или `lost` (настройки `risk.repeatTenderLookbackMonths` = 24, `risk.repeatTenderMinPrior` = 2), и на новой сделке нет подтверждённого изменения (новый принимающий решение, доступ к заказчику, новые критерии). Нет истории сделок — сигнал не создаётся. EN: at deal creation the process checks the client: ≥ 2 earlier opportunities closed `cancelled` or `lost` within 24 months (settings `risk.repeatTenderLookbackMonths` = 24, `risk.repeatTenderMinPrior` = 2) and no confirmed change on the new deal (new decision maker, buyer access, new criteria). No deal history → no instance. Parser arm: the client says the conditions are the same as before.

**Признаки для промпта (≤ 8):** «конкурс на тех же условиях, что и в прошлом году», «процедура прежняя», «снова объявляем отбор», «бриф тот же, что и в прошлый раз», «состав комиссии не менялся», «как и в прошлом тендере», «повторно приглашаем к участию», «прошлый конкурс отменили, проводим заново»

**Синонимы и выражения (полный список):**
- Деловая переписка: «приглашаем принять участие в повторном конкурсе на прежних условиях», «техническое задание осталось без изменений», «процедура отбора аналогична прошлогодней», «в связи с отменой предыдущей процедуры объявляем новый отбор», «критерии оценки сохраняются», «бюджет закупки остаётся на уровне прошлого года»
- Чаты / мессенджеры (разговорный стиль): «опять тендер, всё как в прошлый раз», «бриф тот же, просто перезапускаем», «прошлый конкурс слился, делаем заново», «условия не менялись, участвуете?», «снова питч, комиссия та же», «как и весной, только сроки новые»
- Сокращения и термины: «тендер», «повторный конкурс», «перетендер», «ТЗ», «закупочная процедура», «тендерная комиссия», «223-ФЗ», «ЭТП»
- Устойчивые конструкции / маркеры: «(снова / повторно / заново)» + «конкурс / тендер / отбор»; «(на тех же / на прежних) условиях»; «как (и) в прошлый раз / в прошлом году»; «без изменений»

**Похоже, но не это (анти-признаки):** «приглашаем вас в тендер на SMM» (без истории неудач) → `SALES_TENDER_INVITATION`; «в следующем году разыграем ваш текущий договор на конкурсе» → `CONTRACT_RETENDER_ANNOUNCED`; «мы изменили бриф и критерии» → `PITCH_REQUIREMENTS_CHANGED`; «у нас новый CMO, хотим перезапустить отбор» → `CONTACT_NEW_DECISION_MAKER` (изменение подтверждено, риска нет).

**Пример (evidence):** «Приглашаем снова поучаствовать в конкурсе на PR-сопровождение. Бриф и процедура те же, что и в прошлом году, комиссия в прежнем составе.»
**Контрпример:** «Объявляем новый отбор: у нас новый директор по маркетингу, бриф полностью переписан, финал будет с участием бизнес-заказчика.» → изменения подтверждены (новый ЛПР, новый бриф, доступ к заказчику), это обычный `SALES_TENDER_INVITATION`.

**Заметка для карточки:** Ответственному за возможность вместе с new biz — выяснить у клиента, что изменилось с прошлых отборов, и решить об условиях участия.

## Agency overrides of base codes

Values for the `organization_signal_setting` of the agency org (spec §4.1: org override → pack default). Source: Maslov §1 tables (profile «Показ», recipient «Кому», status by v195). Rules applied:
- **Stage** = the v195 status that Maslov keeps («Активен» → `active`, «Отложен» → `onHold`, «Припаркован» → `parked`, «Закрыт допуском» → `gated`), except **blocks H and J → `parked`** for this pack (Q24-8). The base pack itself imports H, J, K, L, M as `onHold` (spec §4.3); this table switches the v195-active K and L codes back to `active` for the agency.
- **Profile** = Maslov value. Weights are not changed. An inactive stage wins over the profile: the profile applies only after the code is switched on (Maslov §1 note).
- **Recipient** = Maslov «Кому», mapped to the role enum.
- **Note** = the agency funnel effect (see the stage-rule template below), a closing / merge rule (Maslov §5.5) or a Q24 rule.

### A · Продажи

| Code | Profile | Recipient | Stage | Note |
|---|---|---|---|---|
| `SALES_TENDER_INVITATION` | P8 | opportunity | active | Deal entry: `create_deal` at S1 (`new_business`). With `CONTRACT_RETENDER_ANNOUNCED` on the same topic → one re-pitch card, the re-pitch leads (Maslov §5.5). No go (Q24-7). |
| `CONTRACT_TERMINATED` | P8 | account | active | Changes the running contract; never rewrites the won sale (Maslov §3.3). On an open renewal deal of that contract: outcome `lost` as a proposal only. Not `PITCH_CANCELLED_BY_CLIENT`. |
| `SALES_BOOKING_RECEIVED` | P8 | opportunity | active | `enter_stage` S5 (skip allowed). Closes the formalisation question of the selected opportunity (Maslov §5.5) and clears «Устный выбор не превращается в заказ». NDA, our outgoing documents and payment are separate facts. |
| `CONTRACT_FRAME_EXPIRY` | P8 | account | active | No deal effect. `CONTRACT_RENEWAL_INTENT` and `CONTRACT_CONTINUATION_CONFIRMED` lead over it. |
| `SALES_BUDGET_CUT` | P8 | opportunity | active | `in_stage` (budget context). Trigger of risk «Сокращение бюджета». Never changes the stage or the amount. |
| `CONTRACT_NOT_RENEWED` | P8 | account | onHold | Watchdog. When switched on: Q24-11 rules. `CONTRACT_RENEWAL_DECLINED` leads over it. |
| `SALES_OFFER_SENT` | S0 | opportunity | active | Closes `SALES_OFFER_REQUESTED` and, for this pack, the agency requests answered by our material: `PITCH_CREDENTIALS_REQUESTED`, `PITCH_SOLUTION_REQUESTED`, `PITCH_REVISION_REQUESTED`, `PITCH_FINAL_TERMS_DISCUSSION` on the same topic (see Open point 1). Our own act never moves a stage. |
| `SALES_OFFER_NO_RESPONSE` | P6 | opportunity | onHold | When switched on: originating offer + elapsed reply window (agreed date, else 7 calendar days) + all channels checked + no qualifying reply (Q24-11). |
| `SALES_OFFER_REQUESTED` | P6 | opportunity | active | S2 code: `create_deal` at S2 (concrete task, no open deal) or `enter_stage` S2 from S1. Outranked by `PITCH_SOLUTION_REQUESTED` for the same request. |
| `SALES_BOOKING_CANCELLED` | P6 | opportunity | active | On a deal at S5: outcome `cancelled` as a proposal. Leads over `SALES_BUDGET_CUT` (v204). |
| `SALES_RENEGOTIATION` | P6 | opportunity | active | `in_stage`. At S4 it is evidence for `PITCH_ORDER_FORMALIZATION_DELAYED` (terms reopened after the choice). |
| `SALES_NEW_DEMAND` | P6 | opportunity | active | Deal entry: `create_deal` at S1 (`incremental`) for a separate extra order of an existing client. In-scope task changes are `DELIVERY_CHANGE_REQUESTED`. No go (Q24-7). |
| `SALES_BUDGET_INCREASE` | P6 | opportunity | active | `in_stage`. Clears «Сокращение бюджета», «Предложение не укладывается в бюджет», «Изменение задачи без пересмотра условий». |
| `CONTRACT_RENEWAL_INTENT` | P6 | account | active | `create_deal` at S1 (`renewal`) as a proposal card «Новая возможность: продление?» (Open point 3). |
| `SALES_PRICE_REQUEST` | P6 | opportunity | active | `in_stage` on an open deal; in area 0 a topic only. Outranked by `PITCH_FINAL_TERMS_DISCUSSION` on the same deal. |
| `SALES_MATERIAL_REQUESTED` | P6 | opportunity | active | S2 code only when no more precise PITCH code is on the same item; `PITCH_SOLUTION_REQUESTED` leads (Maslov §5.5). |
| `SALES_ORDER_CONFIRMATION_REQUESTED` | P6 | opportunity | active | `in_stage`. Not a stage-5 code (Maslov §3 names only `SALES_BOOKING_RECEIVED`). |
| `SALES_OFFER_DECLINED` | P6 | opportunity | active | Outcome `lost` only when the refusal covers the whole opportunity; a refusal of one variant stays `in_stage` (Maslov §3.2). With `PITCH_EXCLUDED` → one outcome card. |
| `SALES_ORDER_CONFIRMATION_OPEN` | D4 | opportunity | onHold | Watchdog; Q24-11 rules when switched on. |
| `SALES_ORDER_CONFIRMATION_SENT` | S0 | opportunity | active | Closes `SALES_ORDER_CONFIRMATION_REQUESTED` / `SALES_ORDER_CONFIRMATION_OPEN`. |
| `SALES_MATERIAL_NO_RESPONSE` | D4 | opportunity | onHold | Watchdog; Q24-11 rules when switched on. |
| `SALES_PRICE_NO_RESPONSE` | D4 | opportunity | onHold | Watchdog; Q24-11 rules when switched on. |
| `SALES_CATALOG_REQUESTED` | D4 | opportunity | active | General overview of services without a concrete task → area 0, never a deal. Outranked by `PITCH_CREDENTIALS_REQUESTED` when a concrete selection is named. |
| `SALES_BUDGET_MENTIONED` | D4 | opportunity | active | `in_stage` budget context. Clears «Бюджет остаётся неизвестным». A brief budget never enters the forecast (Maslov §3.4, Q24-9). |

### B · Договоры и право

| Code | Profile | Recipient | Stage | Note |
|---|---|---|---|---|
| `CONTRACT_DPA` | D4 | account | active | No deal effect. |
| `CONTRACT_NDA` | W1 | account | active | No deal effect. An NDA is not an order and not stage 5 (Maslov §3). |
| `CONTRACT_COMPLIANCE_DECLARATION` | — | account | onHold | v204 only, not in the Maslov catalog. Proposed `onHold` for the agency (Open point 6). |

### C · Исполнение и отчётность

| Code | Profile | Recipient | Stage | Note |
|---|---|---|---|---|
| `DELIVERY_REPORT_REQUESTED` | P6 | account | active | No deal effect. |
| `DELIVERY_REPORT_OPEN` | D4 | account | onHold | Watchdog; Q24-11 rules when switched on. |
| `DELIVERY_PROTOCOL` | W1 | account | active | Closes the agency meeting asks that it records: `PITCH_BRIEFING_ACCEPTED`, `PITCH_TEAM_INTRO_REQUESTED`, `PITCH_DEFENSE_INVITED`, `PROSPECT_CONVERSATION_ACCEPTED` on the same topic (Open point 1). |
| `THREAD_DEADLINE_NEAR` | D4 | account | parked | — |

### D · Счета

| Code | Profile | Recipient | Stage | Note |
|---|---|---|---|---|
| `INVOICE_OVERDUE` | P6 | finance | active | With `INVOICE_DISPUTE_RAISED` on the same invoice → one card, two facts; the dispute does not replace the overdue (Maslov §5.5). |
| `INVOICE_PAID` | S0 | finance | active | Closes `INVOICE_OVERDUE` of the same invoice. Does not close a dispute. |

### E · Обратная связь

| Code | Profile | Recipient | Stage | Note |
|---|---|---|---|---|
| `COMPLAINT_PRICE` | P8 | account | active | Closed by `COMPLAINT_RESOLUTION_CONFIRMED` (same complaint). |
| `COMPLAINT_ESCALATED` | P8 | account | active | One incident with the complaint under it (Maslov §5.5). Closed together with it by `COMPLAINT_RESOLUTION_CONFIRMED`. |
| `COMPLAINT_TIMING` | P6 | account | active | Closed by `COMPLAINT_RESOLUTION_CONFIRMED`. |
| `COMPLAINT_COMM` | P6 | account | active | Closed by `COMPLAINT_RESOLUTION_CONFIRMED`. |
| `COMPLAINT_QUANTITY` | P6 | account | active | Closed by `COMPLAINT_RESOLUTION_CONFIRMED`. One incident with `DELIVERY_ACCEPTANCE_WITHHELD` of the same result. |
| `COMPLAINT_QUALITY` | P6 | account | active | Closed by `COMPLAINT_RESOLUTION_CONFIRMED`. One incident with `DELIVERY_ACCEPTANCE_WITHHELD` of the same result. |
| `FEEDBACK_REFERRAL` | D4 | account | active | A referral to a new company is area 0 for that company (no deal). |
| `FEEDBACK_QUALITY_PRAISE` | W1 | account | active | Praise never closes a complaint or an acceptance refusal (spec §2.1 rule 7). |
| `FEEDBACK_COMM_PRAISE` | W1 | account | active | Same as above. |
| `FEEDBACK_PRICE_PRAISE` | W1 | account | active | Same as above. |
| `THREAD_UNANSWERED_FOLLOWUP` | W1 | account | parked | — |

### F · Встречи

| Code | Profile | Recipient | Stage | Note |
|---|---|---|---|---|
| `MEETING_CANCEL` | P6 | account | active | Trigger of risk «Снижение вовлечённости» only from the 2nd cancellation without a new date (one cancellation ≠ loss of interest, Maslov §4 risk 21). |
| `MEETING_URGENT` | P6 | account | active | — |
| `MEETING_URGENT_ISSUE` | P6 | account | active | — |
| `MEETING_NEW_STAKEHOLDER` | D4 | account | active | `in_stage` (people of the decision). Clears «Зависимость от одного контакта», «Потеря ключевого контакта». |
| `MEETING_DELAYED` | D4 | account | active | Date gate as in v204. |
| `MEETING_SLOW` | D4 | account | parked | — |
| `MEETING_KEY_MISSING` | D4 | account | parked | — |

### G · Контакты

| Code | Profile | Recipient | Stage | Note |
|---|---|---|---|---|
| `CONTACT_LEAVING` | P6 | account | active | `in_stage`. Trigger of risk «Потеря ключевого контакта» only under the Q24-2 condition. |
| `CONTACT_NEW_DECISION_MAKER` | P6 | account | active | `in_stage`. Trigger of «Смена руководства клиента» only with a confirmed review of need / criteria / agreements; clears «Потеря ключевого контакта» when the new person takes over the deal. |
| `CONTACT_NEW_KNOWN_ORG` | D4 | account | active | Outranked by `PITCH_BUYER_ACCESS_GRANTED` for the same person. |
| `CONTACT_OOO` | D4 | account | active | — |

### H · События компаний и рынка — all 40 codes `parked` (Q24-8)

No processing, cards, notifications, deal effects or risk triggers. Profile and recipient are kept for the day the block is switched on.

| Codes | Profile | Recipient | Stage | Note |
|---|---|---|---|---|
| `SIGNAL_INSOLVENCY` | P8 | relationship | parked | Q24-8 |
| `SIGNAL_DOWNSIZING`, `SIGNAL_AGENCY_CHANGE`, `SIGNAL_NEGATIVE_PRESS` | P6 | relationship | parked | Q24-8. `SIGNAL_AGENCY_CHANGE` is a listed trigger of risk 26 and is ignored while parked. |
| `SIGNAL_NEW_MARKETING_LEAD`, `SIGNAL_MERGER`, `SIGNAL_COMPETITOR`, `SIGNAL_SPEND_UP`, `SIGNAL_SPEND_DOWN`, `SIGNAL_NEW_TOP_SPENDER`, `SIGNAL_PRODUCT_NEWS`, `SIGNAL_ANNIVERSARY`, `SIGNAL_ACCOUNT_WIN`, `SIGNAL_TRACKING_VENDOR_CHANGE`, `SIGNAL_CAMPAIGN_PLANNED` | D4 | relationship | parked | Q24-8. `SIGNAL_NEW_MARKETING_LEAD` is a listed trigger of risk 5 (ignored while parked). `SIGNAL_SPEND_UP` / `SIGNAL_SPEND_DOWN` are on the Q24-6 trend list (D4 ceiling) when switched on (v195 status `onHold`). |
| `SIGNAL_EXPANSION`, `SIGNAL_FUNDING`, `SIGNAL_C_LEVEL_CHANGE`, `SIGNAL_REBRANDING`, `SIGNAL_STRATEGY_ANNOUNCEMENT`, `SIGNAL_CHANNEL_SHIFT`, `SIGNAL_PRODUCT_DISCONTINUED`, `SIGNAL_AD_ACTIVITY`, `SIGNAL_TRACKING_GAP` | D4 | relationship | parked | Q24-8. `SIGNAL_C_LEVEL_CHANGE` is a listed trigger of risk 5 (ignored while parked). |
| `SIGNAL_NEW_COMPANY`, `SIGNAL_TRADEMARK`, `SIGNAL_JOB_POSTING`, `SIGNAL_EVENT`, `SIGNAL_IPO`, `SIGNAL_SPONSORING`, `SIGNAL_CONTACT_QUIET`, `SIGNAL_INDUSTRY_TREND`, `SIGNAL_RESULTS_POSITIVE`, `SIGNAL_RESULTS_NEGATIVE`, `SIGNAL_AWARD`, `SIGNAL_PARTNERSHIP`, `SIGNAL_OPERATIONS_INVESTMENT`, `SIGNAL_STRATEGY_CONTEXT`, `SIGNAL_ANNIVERSARY_PLAIN`, `SIGNAL_EVENT_UPCOMING` | W1 | relationship | parked | Q24-8. `SIGNAL_CONTACT_QUIET` is on the Q24-6 trend list and a listed trigger of risk 21 (ignored while parked). |

### I · Доставка писем

| Code | Profile | Recipient | Stage | Note |
|---|---|---|---|---|
| `MAILERDEMON_RECEIVED` | D4 | account | active | Score rule `inherited`: takes the score of the linked question; 5 is the fallback weight (Maslov §5.1). |

### J · Команда — all 6 codes `parked` (Q24-8)

| Codes | Profile | Recipient | Stage | Note |
|---|---|---|---|---|
| `TEAM_HANDOVER`, `TEAM_ESCALATION` | P6 | team | parked | v195 status `gated`; Q24-8 parks the whole block. No processing, cards or risk effects. |
| `TEAM_INSIDER`, `TEAM_DEAL_LOST`, `TEAM_CAPACITY` | D4 | team | parked | Same. |
| `TEAM_DEAL_WON` | W1 | team | parked | Same. |

### K · Состояние аккаунта

Process codes (system-of-record origin, spec §5.6). The agency has no `order` rows; see Open point 5 for the data source.

| Code | Profile | Recipient | Stage | Note |
|---|---|---|---|---|
| `ACCOUNT_REVENUE_STAGNATION` | D4 | account | onHold | Q24-6 trend (D4 ceiling). |
| `ACCOUNT_REVENUE_DECLINE_YOY` | D4 | account | active | Q24-6 trend (D4 ceiling). Needs window, baseline, minimum data and threshold; too little data → no instance. |
| `ACCOUNT_DORMANT` | D4 | account | active | Not a trend (Q24-6). Needs a configured no-purchase threshold based on the client's usual rhythm (Q24-11). |
| `ACCOUNT_PRODUCT_NEW` | D4 | account | onHold | — |
| `ACCOUNT_PRODUCT_STOPPED` | D4 | account | active | v204 kind `trend`, not on the Q24-6 list; D4 by weight in any case (Open point 7). |
| `ACCOUNT_REVENUE_GROWTH_YOY` | D4 | account | active | Q24-6 trend (D4 ceiling). |
| `ACCOUNT_CROSS_SELL_GAP` | D4 | account | parked | — |
| `ACCOUNT_MEETING_OVERDUE` | D4 | account | onHold | — |
| `ACCOUNT_SEGMENT_UPGRADED` | D4 | account | parked | — |
| `ACCOUNT_SEGMENT_DOWNGRADED` | D4 | account | parked | — |
| `ACCOUNT_NEW_FOLLOWUP` | D4 | account | onHold | — |
| `ACCOUNT_REACTIVATION_DUE` | D4 | account | active | A former client: the topic sits on the client (area 0 behaviour, no deal) until a concrete task arrives. |

### L · Конкуренты и партнёры

| Code | Profile | Recipient | Stage | Note |
|---|---|---|---|---|
| `COMPETITOR_NEW_CLIENT` | W1 | new_biz | active | No buying intent is assumed (Maslov §5.3). |
| `COMPETITOR_LOST_CLIENT` | D4 | new_biz | active | A reason to contact the company in area 0; never a deal by itself. |
| `COMPETITOR_PRODUCT_NEW`, `COMPETITOR_RATE_CHANGE`, `COMPETITOR_FUNDING`, `COMPETITOR_EXPANSION`, `COMPETITOR_NEGATIVE_PRESS` | W1 | new_biz | onHold | — |
| `COMPETITOR_PERSONNEL`, `COMPETITOR_AWARD` | W1 | new_biz | onHold | — |
| `PARTNER_NEW_CLIENT`, `PARTNER_PRODUCT_NEW`, `PARTNER_FUNDING`, `PARTNER_EXPANSION`, `PARTNER_PERSONNEL`, `PARTNER_AWARD` | W1 | new_biz | onHold | — |
| `PARTNER_NEGATIVE_PRESS` | D4 | new_biz | onHold | — |

### M · Наши цены и услуги

| Code | Profile | Recipient | Stage | Note |
|---|---|---|---|---|
| `INTERNAL_PRICE_CHANGE` | W1 | team | onHold | — |
| `INTERNAL_PRODUCT_STATUS_UPDATE` | W1 | team | onHold | — |

### N · Поставщики (v204 only)

| Code | Profile | Recipient | Stage | Note |
|---|---|---|---|---|
| `SUPPLIER_DELIVERY_DELAY` | — | account | onHold | Not in the Maslov catalog. Proposed `onHold` for the agency (Open point 6). |
| `SUPPLIER_PRICE_CHANGE` | — | account | onHold | Same. |

## Funnel stage-rule template (agency, stages 0–5)

Template rows for `signal_stage_rule` (spec §9.2). The platform admin copies them to the agency org and maps S1–S5 to the org's own `deal_funnel_stage` ids. Source: Maslov §3, §3.1–§3.4, adjusted by Q24 and Q34.

Changes against Maslov §3:
- **No go / no-go** (Q24-1, Q24-7, Q28). Maslov stage 1 «Обязателен go» is removed. A confirmed client event with a concrete task creates the opportunity. `requires_confirmation` below is the org's caution setting for weak or late evidence, not an internal approval.
- **Area 0 is not a deal stage** (Q34). Area-0 codes have effect `none`: they make topics on the client or contact. The pre-pipeline stage «Контакт до запроса» stays for manual use and is hidden for the agency org.
- **Renewal** = S4 only under the three Q24-10 conditions (row R16).
- **Outcome `withdrawn`** (the agency stops) is set only by a user, with a reason. No signal sets it.
- Rules for all rows: forward only (except outcomes); skip allowed; risks never move stages; amounts never enter the forecast automatically; the weighted forecast uses only the owner's win estimate (Q24-9, spec §9.5); every move is journaled with rule id, topic and evidence; our own acts (offer sent, internal tasks) never move a stage.

Default guards, unless a row says otherwise:
- `create_deal`: confidence `high` AND topic score ≥ `deals.autoCreateMinScore` (7) AND counterparty resolved → automatic create; confidence `medium` or score 5–6 → proposal card «Новая возможность?»; lower → nothing (spec §9.2, Q27). A row with `requires_confirmation = true` always gives a proposal card.
- `enter_stage` / `outcome`: confidence `high` → automatic; confidence `medium` → proposal card; `low` → nothing.

### Area 0 — «Контакт до запроса» (no deal)

| # | Code(s) | Effect | Target / outcome | Note |
|---|---|---|---|---|
| R0 | `PROSPECT_RELATIONSHIP_ESTABLISHED`, `PROSPECT_INTRODUCTION_OFFERED`, `PROSPECT_CONTACT_MOVED`, `PROSPECT_CONVERSATION_ACCEPTED`, `PROSPECT_EVENT_RESPONSE`, `PROSPECT_EVENT_ATTENDED`, `PROSPECT_CONTENT_INTEREST`, `PROSPECT_FOLLOWUP_AGREED`, `PROSPECT_CONTACT_MENTIONED`, `SALES_CATALOG_REQUESTED` (no concrete task), `FEEDBACK_REFERRAL`, `COMPETITOR_LOST_CLIENT`, `ACCOUNT_REACTIVATION_DUE` | `none` | — | Update the relationship, the relationship owner and the next step. No amount, no forecast (Maslov §3 stage 0). `PROSPECT_NEED_EXPRESSED` with a vague task also stays here (Q24-1). |

### Deal entry and forward moves

| # | Code | Effect | Target | from_stages | forward_only | min_confidence | min_score | requires_confirmation | deal_type | Condition / note |
|---|---|---|---|---|---|---|---|---|---|---|
| R1 | `PROSPECT_NEED_EXPRESSED` | `create_deal` | S1 | — (no open deal of this client and type) | true | high | 7 | false | `new_business` | The subject names a concrete own task / project (Q24-1). A vague task → R0, clarify in area 0. |
| R2 | `SALES_TENDER_INVITATION` | `create_deal` | S1 | — | true | high | 7 | false | `new_business` | With `CONTRACT_RETENDER_ANNOUNCED` on the same topic → R4 wins (one re-pitch deal). If the same item already holds an S2 code, R6–R10 set S2 at once (skip). |
| R3 | `SALES_NEW_DEMAND` | `create_deal` | S1 | — | true | high | 7 | false | `incremental` | Existing client, a separate extra order beyond the running scope (Maslov §3.3). In-scope changes (`DELIVERY_CHANGE_REQUESTED`) → no rule. |
| R4 | `CONTRACT_RETENDER_ANNOUNCED` | `create_deal` | S1 | — | true | high | 7 | false | `re_pitch` | Link the deal to the current contract / client. No go (Q24-7). |
| R5 | `CONTRACT_RENEWAL_INTENT` | `create_deal` | S1 | — | true | medium | 6 | **true** | `renewal` | Proposal card «Новая возможность: продление?». Only when the org tracks renewals as deals (Open point 3). |
| R6 | `PITCH_CREDENTIALS_REQUESTED` | `create_deal` | S2 | — | true | high | 4 | **true** | `new_business` | The request names a concrete selection / project (Maslov §5.6: «Пришлите кейсы для отбора по нашему проекту»). General «расскажите об агентстве» → R0. Per-rule `min_score` 4 because the global threshold would drop it (Open point 2). |
| R7 | `PITCH_CREDENTIALS_REQUESTED` | `enter_stage` | S2 | S1 | true | high | — | false | any | — |
| R8 | `PITCH_SOLUTION_REQUESTED` | `create_deal` | S2 | — | true | high | 6 | **true** (auto when topic score ≥ 7) | `new_business` | Concrete task + request for concept / strategy / test solution. |
| R9 | `PITCH_SOLUTION_REQUESTED` | `enter_stage` | S2 | S1 | true | high | — | false | any | — |
| R10 | `SALES_OFFER_REQUESTED` | `create_deal` / `enter_stage` | S2 | — / S1 | true | high | 7 / — | false | `new_business` (create) / any (move) | Outranked by `PITCH_SOLUTION_REQUESTED` for the same request. |
| R11 | `SALES_MATERIAL_REQUESTED` | `enter_stage` | S2 | S1 | true | high | — | false | any | Only when no more precise PITCH code of S2 is on the same item (Maslov §3 stage 2). Never creates a deal alone. |
| R12 | `PITCH_SHORTLISTED` | `enter_stage` | S3 | S1, S2 | true | high | — | false | any | Shortlist confirms S3 but does not let the amount into the forecast (Maslov §3). |
| R13 | `PITCH_FINAL_TERMS_DISCUSSION` | `enter_stage` | S3 | S1, S2 | true | high | — | false | any | The card asks the owner to set or update the win estimate (Q24-9). |
| R14 | `PITCH_VERBAL_SELECTION` | `enter_stage` | S4 | S1, S2, S3 | true | high | — | false | any | Authorised person only. Not an order. |
| R15 | `PITCH_OFFICIAL_AWARD` | `enter_stage` | S4 | S1, S2, S3 | true | high | — | false | any | At S4 → `in_stage` (adds the official confirmation inside S4, Maslov §3). |
| R16 | `CONTRACT_CONTINUATION_CONFIRMED` | `enter_stage` | S4 | S1, S2, S3 | true | high | — | false | `renewal` | **Q24-10:** all three must hold — (1) the contract or service being continued is identifiable; (2) the next period or scope is defined; (3) the client explicitly confirms the choice of the agency. «Продлеваем ваш сервис на следующий год, готовим документы» → yes. «Надеемся продолжить сотрудничество» → no rule. No open renewal deal → `create_deal` at S4 (`renewal`) with `requires_confirmation = true`. |
| R17 | `SALES_BOOKING_RECEIVED` | `enter_stage` | S5 | S1, S2, S3, S4 | true | high | — | false | any | Binding commitment to order the work. S5 is the won stage of the agency funnel (Open point 4). Win notice, NDA, our documents and payment are separate facts. |
| R18 | `PITCH_SHORTLISTED`, `PITCH_FINAL_TERMS_DISCUSSION`, `PITCH_VERBAL_SELECTION`, `PITCH_OFFICIAL_AWARD`, `SALES_BOOKING_RECEIVED` | `create_deal` | the code's stage (S3 / S4 / S5) | — (no open deal) | true | high | 7 | **true** | `new_business` | Late first sight of an opportunity usually means the deal lives outside the CRM (pipeline not yet imported). A proposal avoids duplicates. |

### In-stage context (no move)

| # | Code(s) | Effect | from_stages | What is updated (via `topic_event`) |
|---|---|---|---|---|
| R19 | `PITCH_QUALIFIED` | `in_stage` | S2 (S1 allowed, no move) | Qualification passed inside S2; the next round needs its own confirmation. |
| R20 | `PITCH_BRIEFING_ACCEPTED` | `in_stage` | S1–S3 | Task, participants, terms of participation. |
| R21 | `PITCH_BUYER_ACCESS_GRANTED`, `PITCH_BUYER_ACCESS_DECLINED` | `in_stage` | S1–S4 | Decision map. A refusal triggers risk 1; the decision on further participation is the owner's (no go / no-go). |
| R22 | `PITCH_TEAM_INTRO_REQUESTED`, `PITCH_DEFENSE_INVITED` | `in_stage` | S1–S4 | Preparation and meeting. A defence does not mean a shortlist. |
| R23 | `PITCH_REVISION_REQUESTED` | `in_stage` | S2–S4 | New preparation cycle. Rework never moves the deal back. |
| R24 | `PITCH_REQUIREMENTS_CHANGED` | `in_stage` | S1–S4 | Terms and amount context. |
| R25 | `PITCH_SELECTION_CRITERIA_DISCLOSED` | `in_stage` | S1–S4 | Criteria and roles of the choice. |
| R26 | `PITCH_DECISION_DELAYED_BY_CLIENT` | `in_stage` | S1–S4 | Decision date and next step. Counts toward risk 19 (Q24-3). |
| R27 | `SALES_BUDGET_MENTIONED`, `SALES_BUDGET_CUT`, `SALES_BUDGET_INCREASE`, `SALES_PRICE_REQUEST`, `SALES_RENEGOTIATION`, `SALES_ORDER_CONFIRMATION_REQUESTED` | `in_stage` | S1–S5 | Budget / terms context. Never a stage change by an amount. |
| R28 | `CONTACT_NEW_DECISION_MAKER`, `MEETING_NEW_STAKEHOLDER`, `CONTACT_LEAVING` | `in_stage` | S1–S5 | People and responsibility; check that agreements still hold. |
| R29 | All 18 N4 codes, `ACCOUNT_SPONSOR_SUPPORT_LOST`, `ACCOUNT_SERVICE_REVIEW_REQUESTED`, `MEETING_CANCEL` | `none` | — | Risk triggers only (Deal-risk types below). A risk never sets the stage. |

### Outcomes and pause

| # | Code | Effect | Outcome | from_stages | min_confidence | requires_confirmation | deal_type | Condition / note |
|---|---|---|---|---|---|---|---|---|
| R30 | `PITCH_EXCLUDED` | `outcome` | `lost` | S1–S4 | high | false | any | Keep the reason, the chosen supplier if named, the relationship plan (Maslov §3.2). Closes the topic and stops reminders (spec §7.3). |
| R31 | `SALES_OFFER_DECLINED` | `outcome` | `lost` | S1–S4 | high | false | any | Only when the refusal covers the whole opportunity; a refusal of one variant → `in_stage`. Unclear scope → proposal card. With `PITCH_EXCLUDED` → one outcome. |
| R32 | `PITCH_CANCELLED_BY_CLIENT` | `outcome` | `cancelled` | S1–S4 | high | false | any | Keep the reason; never record as a competitor win. Closes the topic. |
| R33 | `PITCH_PAUSED_BY_CLIENT` | `outcome` | `paused` | S1–S4 | high | false | any | Deal status `paused`, stage kept, return date / condition and reason stored; topic `snoozed_until` = return date; no reminders until then. Silence is never a pause. |
| R34 | `CONTRACT_RENEWAL_DECLINED` | `outcome` | `lost` | S1–S4 | high | false | `renewal` | The open renewal deal of that contract. The won sale of the current contract is not touched (Maslov §3.3). |
| R35 | `CONTRACT_TERMINATED` | `outcome` | `lost` | S1–S4 | high | **true** | `renewal` | Only for an open renewal deal of the terminated contract. The contract state changes in any case; history of the won sale stays. |
| R36 | `SALES_BOOKING_CANCELLED` | `outcome` | `cancelled` | S5 | high | **true** | any | A placed order is withdrawn by the client. |
| R37 | any `enter_stage` code (R7–R17) or `PITCH_BRIEFING_ACCEPTED`, `PITCH_TEAM_INTRO_REQUESTED`, `PITCH_DEFENSE_INVITED`, `PITCH_FINAL_TERMS_DISCUSSION` on a `paused` deal | resume | status `paused` → `active` | paused deals | high | false | any | Client resumes the selection («возвращаемся к проекту»). The enum has no `resume` effect yet (Open point 4). |
| — | user action | `outcome` | `withdrawn` | any | — | — | any | The agency decided to stop. Only a user sets it, with a reason (Q24-7). Never attributed to the client. |

### Account codes without deal effect

`DELIVERY_ACCEPTANCE_GRANTED`, `DELIVERY_ACCEPTANCE_WITHHELD`, `DELIVERY_CHANGE_REQUESTED`, `DELIVERY_CLIENT_DEPENDENCY_DELAYED`, `COMPLAINT_RESOLUTION_CONFIRMED`, `INVOICE_DISPUTE_RAISED`, `INVOICE_DISPUTE_RESOLVED`, `ACCOUNT_INCREMENTAL_WORK_SLOWDOWN`, `ACCOUNT_WORK_PAUSED_BY_CLIENT`, `ACCOUNT_PRIORITIES_CHANGED` → effect `none`. They change the state of the running contract or work, not an opportunity (Maslov §3.3). `ACCOUNT_WORK_PAUSED_BY_CLIENT` is not `PITCH_PAUSED_BY_CLIENT`: no deal status changes.

## Deal-risk types (26)

Seed rows for `deal_risk_type`, pack `agency` (spec §9.4). Source: Maslov §4 (the 26 risks, their signals, «Реакция» and «Снятие предупреждения»), requirements v2 risk texts, Q24-2, Q24-3, Q24-7, Q24-8.

Rules for all 26:
- A risk becomes active on a deal when a trigger code is counted on a topic linked to that deal, the stage guard allows it, `min_occurrences` is reached and the condition is true. It clears by a clear code on a topic of the deal, by any deal outcome (`lost`, `cancelled`, `withdrawn`, S5 for pre-order risks), or by the user action «Риск снят» with a reason. Card expiry or «Готово» never clears a risk.
- A risk never moves the stage and never changes the amount (Maslov §4: «Воронка: без автоматического изменения»).
- **No go / no-go** (Q24-7): every Maslov reaction «пересмотреть / принять go/no-go» is rewritten as «решить об условиях дальнейшего участия». A decision to stop is the user outcome `withdrawn`, which clears the risk.
- **Parked triggers** (Q24-8): trigger codes from blocks H and J never fire for this pack. Three risks list such codes (5, 21, 26). **None of the 26 risks depends only on parked codes**, so every risk can trigger; the parked codes are marked "(parked — ignored)".
- `severity` (1–9) is proposed here: the weight of the strongest trigger code, +1 where the risk needs repeated evidence (19, 21). `stage_guard` uses the agency stages S1–S5. `stage` = `active` for all 26.
- `reaction_role` is one enum value (the primary role). A second role from Maslov is named in `reaction_ru`.

| # | Code | label_ru | Trigger codes | Clear codes | Sev. | Min occ. | Stage guard | Condition | Reaction role |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `RISK_NO_BUYER_ACCESS` | Нет доступа к бизнес-заказчику | `PITCH_BUYER_ACCESS_DECLINED` | `PITCH_BUYER_ACCESS_GRANTED` | 6 | 1 | S1–S4 | — | opportunity |
| 2 | `RISK_DECISION_MAKER_UNCLEAR` | Неясно, кто принимает решение | `PITCH_DECISION_MAKER_UNCLEAR` | `PITCH_SELECTION_CRITERIA_DISCLOSED` | 6 | 1 | S1–S4 | — | opportunity |
| 3 | `RISK_SINGLE_CONTACT` | Зависимость от одного контакта | `PITCH_SINGLE_CONTACT_DEPENDENCY` | `PITCH_BUYER_ACCESS_GRANTED`, `MEETING_NEW_STAKEHOLDER` | 6 | 1 | S2–S4 | — | opportunity |
| 4 | `RISK_KEY_CONTACT_LOSS` | Потеря ключевого контакта | `CONTACT_LEAVING`, `PROSPECT_CONTACT_MOVED`, `ACCOUNT_SPONSOR_SUPPORT_LOST` | `PITCH_BUYER_ACCESS_GRANTED`, `MEETING_NEW_STAKEHOLDER`, `CONTACT_NEW_DECISION_MAKER` | 7 | 1 | S1–S5 | `key_contact_supported_deal` (Q24-2) | relationship |
| 5 | `RISK_LEADERSHIP_CHANGE` | Смена руководства клиента | `CONTACT_NEW_DECISION_MAKER`, `PITCH_REQUIREMENTS_CHANGED`, `SIGNAL_NEW_MARKETING_LEAD` (parked — ignored), `SIGNAL_C_LEVEL_CHANGE` (parked — ignored) | `PITCH_SELECTION_CRITERIA_DISCLOSED`, `PITCH_BRIEFING_ACCEPTED` | 6 | 1 | S1–S4 | `leadership_change_reviews_terms` | opportunity |
| 6 | `RISK_STAKEHOLDER_CONFLICT` | Противоречия между участниками | `PITCH_STAKEHOLDER_CONFLICT` | `PITCH_SELECTION_CRITERIA_DISCLOSED`, `PITCH_BRIEFING_ACCEPTED` | 7 | 1 | S1–S4 | — | opportunity |
| 7 | `RISK_NEED_UNCONFIRMED` | Неподтверждённая потребность | `PITCH_NEED_UNCONFIRMED` | `PROSPECT_NEED_EXPRESSED`, `PITCH_SOLUTION_REQUESTED` | 5 | 1 | S1–S3 | — | new_biz |
| 8 | `RISK_BRIEF_INCOMPLETE` | Недостаточный бриф | `PITCH_BRIEF_INCOMPLETE` | `PITCH_BRIEFING_ACCEPTED` | 6 | 1 | S1–S3 | — | opportunity |
| 9 | `RISK_BUDGET_UNKNOWN` | Бюджет остаётся неизвестным | `PITCH_BUDGET_UNDISCLOSED` | `SALES_BUDGET_MENTIONED`, `PITCH_FINAL_TERMS_DISCUSSION` | 6 | 1 | S2–S4 | — | new_biz |
| 10 | `RISK_BUDGET_MISMATCH` | Предложение не укладывается в бюджет | `PITCH_BUDGET_MISMATCH` | `SALES_BUDGET_INCREASE`, `PITCH_VERBAL_SELECTION`, `SALES_BOOKING_RECEIVED` | 7 | 1 | S2–S4 | — | opportunity |
| 11 | `RISK_BUDGET_CUT` | Сокращение бюджета | `SALES_BUDGET_CUT` | `SALES_BUDGET_INCREASE`, `PITCH_VERBAL_SELECTION`, `SALES_BOOKING_RECEIVED` | 8 | 1 | S1–S5 | — | opportunity |
| 12 | `RISK_PRICE_ONLY` | Выбор только по цене | `PITCH_PRICE_ONLY_SELECTION` | `PITCH_SELECTION_CRITERIA_DISCLOSED` | 6 | 1 | S1–S4 | `clear_not_price_only` | new_biz |
| 13 | `RISK_SELECTION_CRITERIA_UNCLEAR` | Непрозрачные критерии выбора | `PITCH_SELECTION_CRITERIA_UNCLEAR` | `PITCH_SELECTION_CRITERIA_DISCLOSED` | 6 | 1 | S1–S4 | — | opportunity |
| 14 | `RISK_REQUIREMENTS_CHANGED` | Изменение условий отбора | `PITCH_REQUIREMENTS_CHANGED` | `PITCH_BRIEFING_ACCEPTED`, `PITCH_SELECTION_CRITERIA_DISCLOSED` | 6 | 1 | S1–S4 | — | opportunity |
| 15 | `RISK_SCOPE_WITHOUT_ADJUSTMENT` | Изменение задачи без пересмотра условий | `PITCH_SCOPE_WITHOUT_ADJUSTMENT` | `SALES_BUDGET_INCREASE`, `SALES_BOOKING_RECEIVED` | 7 | 1 | S1–S4 | — | opportunity |
| 16 | `RISK_UNPAID_WORK` | Рост бесплатной проработки | `PITCH_UNPAID_WORK_EXPANDING` | `PITCH_SHORTLISTED`, `PITCH_VERBAL_SELECTION`, `PITCH_OFFICIAL_AWARD` | 6 | 1 | S1–S3 | — | new_biz |
| 17 | `RISK_REVISIONS_NO_DECISION` | Повторяющиеся доработки без решения | `PITCH_REVISIONS_WITHOUT_DECISION` | `PITCH_SELECTION_CRITERIA_DISCLOSED`, `PITCH_VERBAL_SELECTION` | 6 | 1 | S2–S4 | — | opportunity |
| 18 | `RISK_EXPERTISE_DOUBTED` | Сомнения в экспертизе | `PITCH_EXPERTISE_DOUBTED` | `PITCH_SHORTLISTED`, `PITCH_QUALIFIED`, `PITCH_VERBAL_SELECTION` | 7 | 1 | S1–S4 | `clear_after_trigger` | opportunity |
| 19 | `RISK_DECISION_DRAG` | Затягивание решения | `PITCH_DECISION_DELAYED_BY_CLIENT` | `PITCH_DEFENSE_INVITED`, `PITCH_SHORTLISTED`, `PITCH_VERBAL_SELECTION`, `PITCH_OFFICIAL_AWARD` | 6 | **2** (Q24-3) | S1–S4 | `same_decision_no_next_step` (Q24-3) | opportunity |
| 20 | `RISK_CLIENT_COMMITMENT_BROKEN` | Невыполнение договорённостей клиентом | `PITCH_CLIENT_COMMITMENT_BROKEN` | `PITCH_BRIEFING_ACCEPTED` | 6 | 1 | S1–S4 | `promise_still_open` | opportunity |
| 21 | `RISK_ENGAGEMENT_DROP` | Снижение вовлечённости | `MEETING_CANCEL`, `SIGNAL_CONTACT_QUIET` (parked — ignored) | `PITCH_BRIEFING_ACCEPTED`, `PITCH_DEFENSE_INVITED`, `PITCH_TEAM_INTRO_REQUESTED`, `MEETING_URGENT` | 7 | **2** | S1–S4 | `cancels_without_new_date` | opportunity |
| 22 | `RISK_FEEDBACK_MISSING` | Нет содержательной обратной связи | `PITCH_FEEDBACK_MISSING` | `PITCH_REVISION_REQUESTED`, `PITCH_SELECTION_CRITERIA_DISCLOSED`, `PITCH_SHORTLISTED`, `PITCH_VERBAL_SELECTION` | 5 | 1 | S2–S4 | — | opportunity |
| 23 | `RISK_VERBAL_NOT_ORDER` | Устный выбор не превращается в заказ | `PITCH_ORDER_FORMALIZATION_DELAYED` | `SALES_BOOKING_RECEIVED` | 7 | 1 | S4 | — | opportunity |
| 24 | `RISK_PAYMENT_TERMS` | Невыгодные условия оплаты | `PITCH_PAYMENT_TERMS_UNFAVORABLE` | — (user «Риск снят» after finance approval, or outcome) | 7 | 1 | S2–S5 | — | finance |
| 25 | `RISK_REPEAT_TENDER` | Повторение неудачного отбора | `PITCH_REPEAT_UNPRODUCTIVE_TENDER` | `CONTACT_NEW_DECISION_MAKER`, `PITCH_BUYER_ACCESS_GRANTED`, `PITCH_SELECTION_CRITERIA_DISCLOSED` | 6 | 1 | S1–S3 | — | new_biz |
| 26 | `RISK_ACCOUNT_REVIEW` | Пересмотр отношений с действующим клиентом | `ACCOUNT_SERVICE_REVIEW_REQUESTED`, `CONTRACT_RETENDER_ANNOUNCED`, `SIGNAL_AGENCY_CHANGE` (parked — ignored) | `CONTRACT_CONTINUATION_CONFIRMED`, `PITCH_OFFICIAL_AWARD`, `SALES_BOOKING_RECEIVED` | 7 | 1 | S1–S5 | `existing_client_deal` | account |

### 1 · `RISK_NO_BUYER_ACCESS` — Нет доступа к бизнес-заказчику

| Field | Value |
|---|---|
| code | `RISK_NO_BUYER_ACCESS` |
| label_ru | Нет доступа к бизнес-заказчику |
| description_ru | Клиент ограничивает общение закупками или формальными ответами и не даёт обсудить задачу с её владельцем. |
| trigger_codes | `PITCH_BUYER_ACCESS_DECLINED` |
| clear_codes | `PITCH_BUYER_ACCESS_GRANTED` |
| clear_rule_ru («Снятие предупреждения») | Доступ к бизнес-заказчику предоставлен либо ответственный за возможность принял решение об условиях дальнейшего участия. |
| severity | 6 |
| min_occurrences | 1 |
| stage_guard | S1–S4 |
| condition | — |
| reaction_role | opportunity |
| reaction_ru | Ответственный за возможность вместе с new biz: пересмотреть шансы и формат участия. |
| stage | active |
| Note | Q24-7: Maslov «пересмотреть go/no-go» removed. |

### 2 · `RISK_DECISION_MAKER_UNCLEAR` — Неясно, кто принимает решение

| Field | Value |
|---|---|
| code | `RISK_DECISION_MAKER_UNCLEAR` |
| label_ru | Неясно, кто принимает решение |
| description_ru | После уточняющих вопросов остаётся непонятно, кто выбирает подрядчика и утверждает бюджет. |
| trigger_codes | `PITCH_DECISION_MAKER_UNCLEAR` |
| clear_codes | `PITCH_SELECTION_CRITERIA_DISCLOSED` (роли выбора, бюджета и подписания названы) |
| clear_rule_ru | Клиент подтвердил ответственных и порядок принятия решения. Название должности без реальной роли риск не снимает. |
| severity | 6 |
| min_occurrences | 1 |
| stage_guard | S1–S4 |
| condition | — |
| reaction_role | opportunity |
| reaction_ru | Pitch lead: уточнить, кто выбирает агентство, кто утверждает бюджет и кто подписывает. |
| stage | active |
| Note | One common incident with risks 3 and 6 on the card (Maslov §5.4). |

### 3 · `RISK_SINGLE_CONTACT` — Зависимость от одного контакта

| Field | Value |
|---|---|
| code | `RISK_SINGLE_CONTACT` |
| label_ru | Зависимость от одного контакта |
| description_ru | Всё взаимодействие по сделке держится на одном человеке, связи с другими участниками решения не установлены. |
| trigger_codes | `PITCH_SINGLE_CONTACT_DEPENDENCY` |
| clear_codes | `PITCH_BUYER_ACCESS_GRANTED`, `MEETING_NEW_STAKEHOLDER` |
| clear_rule_ru | Установлены подтверждённые рабочие связи с нужными ролями у клиента. |
| severity | 6 |
| min_occurrences | 1 |
| stage_guard | S2–S4 (at S1 one contact is normal) |
| condition | — (the trigger code is derived and already carries the process rule) |
| reaction_role | opportunity |
| reaction_ru | Ответственный за возможность: договориться о знакомстве с другими участниками решения. |
| stage | active |

### 4 · `RISK_KEY_CONTACT_LOSS` — Потеря ключевого контакта

| Field | Value |
|---|---|
| code | `RISK_KEY_CONTACT_LOSS` |
| label_ru | Потеря ключевого контакта |
| description_ru | Человек, который поддерживал сделку, уходит, меняет роль или передаёт вопрос другому сотруднику, а передача отношений не подтверждена. |
| trigger_codes | `CONTACT_LEAVING`, `PROSPECT_CONTACT_MOVED`, `ACCOUNT_SPONSOR_SUPPORT_LOST` |
| clear_codes | `PITCH_BUYER_ACCESS_GRANTED`, `MEETING_NEW_STAKEHOLDER`, `CONTACT_NEW_DECISION_MAKER` (the new person takes over this deal) |
| clear_rule_ru | Восстановлен рабочий доступ к участнику решения и определён новый ответственный со стороны клиента. |
| severity | 7 |
| min_occurrences | 1 |
| stage_guard | S1–S5 |
| condition | `key_contact_supported_deal` (Q24-2): the person in the trigger is linked to this deal (`deal_contact`) AND no handover / working access to the relevant stakeholder is confirmed on the deal after the trigger. A job move alone (`PROSPECT_CONTACT_MOVED` without the deal link) does not trigger. |
| reaction_role | relationship |
| reaction_ru | Владелец связи вместе с pitch lead: согласовать передачу отношений и нового участника решения. |
| stage | active |
| Note | `PROSPECT_CONTACT_MOVED` stays a chance signal for the new company (Q24-2); here only its old-company effect counts. |

### 5 · `RISK_LEADERSHIP_CHANGE` — Смена руководства клиента

| Field | Value |
|---|---|
| code | `RISK_LEADERSHIP_CHANGE` |
| label_ru | Смена руководства клиента |
| description_ru | Новый руководитель у клиента пересматривает потребность, критерии выбора или ранее достигнутые договорённости. |
| trigger_codes | `CONTACT_NEW_DECISION_MAKER`, `PITCH_REQUIREMENTS_CHANGED`, `SIGNAL_NEW_MARKETING_LEAD` (parked — ignored), `SIGNAL_C_LEVEL_CHANGE` (parked — ignored) |
| clear_codes | `PITCH_SELECTION_CRITERIA_DISCLOSED`, `PITCH_BRIEFING_ACCEPTED` |
| clear_rule_ru | Клиент подтвердил актуальные требования и порядок принятия решения. |
| severity | 6 |
| min_occurrences | 1 |
| stage_guard | S1–S4 |
| condition | `leadership_change_reviews_terms`: a person-change trigger (`CONTACT_NEW_DECISION_MAKER`) counts only when, on the same deal within 60 days, there is also `PITCH_REQUIREMENTS_CHANGED` or `SALES_RENEGOTIATION`, or its own evidence says the new person reviews the need, criteria or agreements. `PITCH_REQUIREMENTS_CHANGED` counts here only within 60 days of a person-change trigger (otherwise it is risk 14 only). Maslov: «Смена должности сама по себе не доказывает риск». |
| reaction_role | opportunity |
| reaction_ru | Pitch lead: выяснить, какие требования и договорённости пересматривает новый руководитель. |
| stage | active |
| Note | Q24-8: the two H triggers never fire for this pack; the risk still triggers through `CONTACT_NEW_DECISION_MAKER` + the condition. |

### 6 · `RISK_STAKEHOLDER_CONFLICT` — Противоречия между участниками

| Field | Value |
|---|---|
| code | `RISK_STAKEHOLDER_CONFLICT` |
| label_ru | Противоречия между участниками |
| description_ru | Представители клиента дают несовместимые требования или по-разному описывают цель закупки. |
| trigger_codes | `PITCH_STAKEHOLDER_CONFLICT` |
| clear_codes | `PITCH_SELECTION_CRITERIA_DISCLOSED`, `PITCH_BRIEFING_ACCEPTED` (one agreed brief) |
| clear_rule_ru | Клиент подтвердил согласованные требования и владельца решения. |
| severity | 7 |
| min_occurrences | 1 |
| stage_guard | S1–S4 |
| condition | — |
| reaction_role | opportunity |
| reaction_ru | Pitch lead: организовать согласование единого брифа и критериев у клиента. |
| stage | active |

### 7 · `RISK_NEED_UNCONFIRMED` — Неподтверждённая потребность

| Field | Value |
|---|---|
| code | `RISK_NEED_UNCONFIRMED` |
| label_ru | Неподтверждённая потребность |
| description_ru | Работа ведётся как активная сделка, хотя клиент выражает только общий интерес и не называет конкретную задачу. |
| trigger_codes | `PITCH_NEED_UNCONFIRMED` |
| clear_codes | `PROSPECT_NEED_EXPRESSED`, `PITCH_SOLUTION_REQUESTED` |
| clear_rule_ru | Подтверждён конкретный запрос клиента либо пользователь вернул работу в область 0 (сделка удалена или закрыта как `withdrawn`). |
| severity | 5 |
| min_occurrences | 1 |
| stage_guard | S1–S3 |
| condition | — |
| reaction_role | new_biz |
| reaction_ru | New biz: уточнить задачу и пересмотреть квалификацию возможности. |
| stage | active |

### 8 · `RISK_BRIEF_INCOMPLETE` — Недостаточный бриф

| Field | Value |
|---|---|
| code | `RISK_BRIEF_INCOMPLETE` |
| label_ru | Недостаточный бриф |
| description_ru | Клиент ждёт содержательного предложения, но не раскрывает существенные цели, ограничения или исходные данные. |
| trigger_codes | `PITCH_BRIEF_INCOMPLETE` |
| clear_codes | `PITCH_BRIEFING_ACCEPTED` |
| clear_rule_ru | Получен достаточный бриф либо согласован ограниченный формат участия. |
| severity | 6 |
| min_occurrences | 1 |
| stage_guard | S1–S3 |
| condition | — |
| reaction_role | opportunity |
| reaction_ru | Pitch lead: согласовать обязательные вводные до дальнейшей проработки. |
| stage | active |

### 9 · `RISK_BUDGET_UNKNOWN` — Бюджет остаётся неизвестным

| Field | Value |
|---|---|
| code | `RISK_BUDGET_UNKNOWN` |
| label_ru | Бюджет остаётся неизвестным |
| description_ru | Клиент не обозначает финансовые рамки после уточнений, а подготовка уже требует существенных затрат агентства. |
| trigger_codes | `PITCH_BUDGET_UNDISCLOSED` |
| clear_codes | `SALES_BUDGET_MENTIONED`, `PITCH_FINAL_TERMS_DISCUSSION` |
| clear_rule_ru | Диапазон бюджета подтверждён либо согласованы условия участия без него. |
| severity | 6 |
| min_occurrences | 1 |
| stage_guard | S2–S4 (v2: no budget at an early stage is not necessarily a risk) |
| condition | — |
| reaction_role | new_biz |
| reaction_ru | New biz: обсудить допустимый диапазон бюджета и предел затрат на участие. |
| stage | active |

### 10 · `RISK_BUDGET_MISMATCH` — Предложение не укладывается в бюджет

| Field | Value |
|---|---|
| code | `RISK_BUDGET_MISMATCH` |
| label_ru | Предложение не укладывается в бюджет |
| description_ru | Названный клиентом бюджет заметно ниже стоимости обсуждаемого объёма работ за тот же период. |
| trigger_codes | `PITCH_BUDGET_MISMATCH` |
| clear_codes | `SALES_BUDGET_INCREASE`, `PITCH_VERBAL_SELECTION`, `SALES_BOOKING_RECEIVED` |
| clear_rule_ru | Клиент согласовал реалистичное сочетание объёма и цены либо получен исход. |
| severity | 7 |
| min_occurrences | 1 |
| stage_guard | S2–S4 |
| condition | — |
| reaction_role | opportunity |
| reaction_ru | Pitch lead: согласовать изменение объёма или бюджета либо решить об условиях дальнейшего участия. |
| stage | active |

### 11 · `RISK_BUDGET_CUT` — Сокращение бюджета

| Field | Value |
|---|---|
| code | `RISK_BUDGET_CUT` |
| label_ru | Сокращение бюджета |
| description_ru | Клиент сообщает об уменьшении финансирования или о существенном сокращении первоначального объёма. |
| trigger_codes | `SALES_BUDGET_CUT` |
| clear_codes | `SALES_BUDGET_INCREASE`, `PITCH_VERBAL_SELECTION`, `SALES_BOOKING_RECEIVED` (on the new scope) |
| clear_rule_ru | Новый объём и цена согласованы либо получен исход. |
| severity | 8 |
| min_occurrences | 1 |
| stage_guard | S1–S5 |
| condition | — |
| reaction_role | opportunity |
| reaction_ru | Pitch lead: согласовать реалистичные объём, бюджет и дальнейшее участие. |
| stage | active |

### 12 · `RISK_PRICE_ONLY` — Выбор только по цене

| Field | Value |
|---|---|
| code | `RISK_PRICE_ONLY` |
| label_ru | Выбор только по цене |
| description_ru | Закупки сравнивают только цену и не учитывают существенные различия в составе, качестве и экономике предложений. |
| trigger_codes | `PITCH_PRICE_ONLY_SELECTION` |
| clear_codes | `PITCH_SELECTION_CRITERIA_DISCLOSED` |
| clear_rule_ru | Согласованы сопоставимые критерии оценки либо ответственный принял решение об условиях участия. |
| severity | 6 |
| min_occurrences | 1 |
| stage_guard | S1–S4 |
| condition | `clear_not_price_only`: the clearing `PITCH_SELECTION_CRITERIA_DISCLOSED` must be later than the trigger and must not be co-detected with `PITCH_PRICE_ONLY_SELECTION` in the same item (Maslov §5.5 merges those two into one risk card). |
| reaction_role | new_biz |
| reaction_ru | New biz вместе с pitch lead: проверить сопоставимость предложений и целесообразность участия. |
| stage | active |
| Note | Q24-7: Maslov «принято решение go/no-go» removed. |

### 13 · `RISK_SELECTION_CRITERIA_UNCLEAR` — Непрозрачные критерии выбора

| Field | Value |
|---|---|
| code | `RISK_SELECTION_CRITERIA_UNCLEAR` |
| label_ru | Непрозрачные критерии выбора |
| description_ru | Клиент не объясняет, как оценивает предложения и что нужно для победы. |
| trigger_codes | `PITCH_SELECTION_CRITERIA_UNCLEAR` |
| clear_codes | `PITCH_SELECTION_CRITERIA_DISCLOSED` |
| clear_rule_ru | Критерии раскрыты либо ответственный решил участвовать с этим ограничением. |
| severity | 6 |
| min_occurrences | 1 |
| stage_guard | S1–S4 |
| condition | — |
| reaction_role | opportunity |
| reaction_ru | Pitch lead: запросить критерии оценки, участников выбора и условия победы. |
| stage | active |

### 14 · `RISK_REQUIREMENTS_CHANGED` — Изменение условий отбора

| Field | Value |
|---|---|
| code | `RISK_REQUIREMENTS_CHANGED` |
| label_ru | Изменение условий отбора |
| description_ru | Клиент по ходу сделки меняет критерии, закупочную процедуру или обязательные требования. |
| trigger_codes | `PITCH_REQUIREMENTS_CHANGED` |
| clear_codes | `PITCH_BRIEFING_ACCEPTED`, `PITCH_SELECTION_CRITERIA_DISCLOSED` (new version agreed) |
| clear_rule_ru | Новая версия требований и условия участия согласованы с клиентом. |
| severity | 6 |
| min_occurrences | 1 |
| stage_guard | S1–S4 |
| condition | — |
| reaction_role | opportunity |
| reaction_ru | Pitch lead вместе с new biz: оценить последствия изменений и решить об условиях дальнейшего участия. |
| stage | active |
| Note | Q24-7: «пересмотреть go/no-go» removed. With `PITCH_SCOPE_WITHOUT_ADJUSTMENT` on the same item → one card, risk 15 leads. |

### 15 · `RISK_SCOPE_WITHOUT_ADJUSTMENT` — Изменение задачи без пересмотра условий

| Field | Value |
|---|---|
| code | `RISK_SCOPE_WITHOUT_ADJUSTMENT` |
| label_ru | Изменение задачи без пересмотра условий |
| description_ru | Клиент расширяет или меняет объём работ, но сохраняет прежние ожидания по цене и срокам. |
| trigger_codes | `PITCH_SCOPE_WITHOUT_ADJUSTMENT` |
| clear_codes | `SALES_BUDGET_INCREASE`, `SALES_BOOKING_RECEIVED` (on the new version) |
| clear_rule_ru | Новая версия объёма, цены и срока подтверждена клиентом. |
| severity | 7 |
| min_occurrences | 1 |
| stage_guard | S1–S4 |
| condition | — |
| reaction_role | opportunity |
| reaction_ru | Pitch lead: согласовать новую границу работ и коммерческие условия. |
| stage | active |

### 16 · `RISK_UNPAID_WORK` — Рост бесплатной проработки

| Field | Value |
|---|---|
| code | `RISK_UNPAID_WORK` |
| label_ru | Рост бесплатной проработки |
| description_ru | Клиент запрашивает дополнительные концепции, расчёты или готовые решения без подтверждённого продвижения к выбору. |
| trigger_codes | `PITCH_UNPAID_WORK_EXPANDING` |
| clear_codes | `PITCH_SHORTLISTED`, `PITCH_VERBAL_SELECTION`, `PITCH_OFFICIAL_AWARD` |
| clear_rule_ru | Согласованы пределы и результат следующего этапа либо пользователь закрыл сделку как `withdrawn`. |
| severity | 6 |
| min_occurrences | 1 |
| stage_guard | S1–S3 |
| condition | — |
| reaction_role | new_biz |
| reaction_ru | New biz вместе с pitch lead: ограничить следующий этап, согласовать оплату проработки или условия решения. |
| stage | active |
| Note | Q24-7: Maslov «принято no-go» → user outcome `withdrawn`. |

### 17 · `RISK_REVISIONS_NO_DECISION` — Повторяющиеся доработки без решения

| Field | Value |
|---|---|
| code | `RISK_REVISIONS_NO_DECISION` |
| label_ru | Повторяющиеся доработки без решения |
| description_ru | После нескольких версий предложения клиент продолжает просить изменения и не называет оставшихся условий выбора. |
| trigger_codes | `PITCH_REVISIONS_WITHOUT_DECISION` |
| clear_codes | `PITCH_SELECTION_CRITERIA_DISCLOSED`, `PITCH_VERBAL_SELECTION` |
| clear_rule_ru | Клиент подтвердил критерии финальной версии и порядок решения. |
| severity | 6 |
| min_occurrences | 1 (the trigger code itself counts the revisions, `risk.revisionCount` = 3) |
| stage_guard | S2–S4 |
| condition | — |
| reaction_role | opportunity |
| reaction_ru | Pitch lead: согласовать конечные критерии и предел числа итераций. |
| stage | active |

### 18 · `RISK_EXPERTISE_DOUBTED` — Сомнения в экспертизе

| Field | Value |
|---|---|
| code | `RISK_EXPERTISE_DOUBTED` |
| label_ru | Сомнения в экспертизе |
| description_ru | Клиент прямо сомневается в опыте, компетенциях или способности предложенной команды выполнить задачу. |
| trigger_codes | `PITCH_EXPERTISE_DOUBTED` |
| clear_codes | `PITCH_SHORTLISTED`, `PITCH_QUALIFIED`, `PITCH_VERBAL_SELECTION` |
| clear_rule_ru | Клиент подтвердил достаточность команды или согласован её состав. |
| severity | 7 |
| min_occurrences | 1 |
| stage_guard | S1–S4 |
| condition | `clear_after_trigger`: a clear code counts only when it is later than the trigger (an earlier qualification does not answer a new doubt). |
| reaction_role | opportunity |
| reaction_ru | Pitch lead: выяснить суть сомнения и подтвердить компетенцию релевантными кейсами и составом команды. |
| stage | active |

### 19 · `RISK_DECISION_DRAG` — Затягивание решения

| Field | Value |
|---|---|
| code | `RISK_DECISION_DRAG` |
| label_ru | Затягивание решения |
| description_ru | Клиент неоднократно переносит выбор подрядчика и не подтверждает новую реалистичную дату. |
| trigger_codes | `PITCH_DECISION_DELAYED_BY_CLIENT` |
| clear_codes | `PITCH_DEFENSE_INVITED`, `PITCH_SHORTLISTED`, `PITCH_VERBAL_SELECTION`, `PITCH_OFFICIAL_AWARD`; plus the condition-based clear below |
| clear_rule_ru | Согласованы новая дата решения и конкретный следующий шаг либо получен исход. История переносов сохраняется. |
| severity | 6 |
| min_occurrences | **2** (Q24-3) |
| stage_guard | S1–S4 |
| condition | `same_decision_no_next_step` (Q24-3): count only distinct postponements of the **same decision** in the **current selection cycle**; a repeated mention of an existing postponement and a postponed unrelated meeting do not count; active only while no new date + concrete next step was agreed after the last postponement. Clear also when a later item on the deal holds a decision date (facts.deadlines) together with a concrete next step (spec §2.1 example «Давайте встречу 20.11 с финдиректором, после неё решим»). Setting `riskPostponementCount` = 2. |
| reaction_role | opportunity |
| reaction_ru | Ответственный за возможность: уточнить причину переносов и согласовать дату и следующий шаг. |
| stage | active |

### 20 · `RISK_CLIENT_COMMITMENT_BROKEN` — Невыполнение договорённостей клиентом

| Field | Value |
|---|---|
| code | `RISK_CLIENT_COMMITMENT_BROKEN` |
| label_ru | Невыполнение договорённостей клиентом |
| description_ru | Обещанные клиентом ответы, материалы или согласования не поступили к сроку и блокируют следующий шаг по сделке. |
| trigger_codes | `PITCH_CLIENT_COMMITMENT_BROKEN` |
| clear_codes | `PITCH_BRIEFING_ACCEPTED` (the promised input arrived); plus the condition-based clear below |
| clear_rule_ru | Обещанное получено либо клиент согласовал изменённые условия и новый срок. |
| severity | 6 |
| min_occurrences | 1 |
| stage_guard | S1–S4 |
| condition | `promise_still_open`: clear when a later inbound item on the deal delivers the promised item (same matter as the trigger's fact) or sets a new agreed date. After the order the same situation is `DELIVERY_CLIENT_DEPENDENCY_DELAYED` (no deal risk). |
| reaction_role | opportunity |
| reaction_ru | Ответственный за возможность: согласовать обязательство клиента, новый срок и влияние на план. |
| stage | active |

### 21 · `RISK_ENGAGEMENT_DROP` — Снижение вовлечённости

| Field | Value |
|---|---|
| code | `RISK_ENGAGEMENT_DROP` |
| label_ru | Снижение вовлечённости |
| description_ru | Клиент заметно реже отвечает, отменяет встречи и не предлагает новые даты. |
| trigger_codes | `MEETING_CANCEL`, `SIGNAL_CONTACT_QUIET` (parked — ignored) |
| clear_codes | `PITCH_BRIEFING_ACCEPTED`, `PITCH_DEFENSE_INVITED`, `PITCH_TEAM_INTRO_REQUESTED`, `MEETING_URGENT` |
| clear_rule_ru | Клиент подтвердил дальнейшее взаимодействие: назначил встречу или согласовал следующий шаг. |
| severity | 7 |
| min_occurrences | **2** |
| stage_guard | S1–S4 |
| condition | `cancels_without_new_date`: ≥ 2 `MEETING_CANCEL` on topics of the deal within 30 days, none followed by an agreed new date (setting `risk.engagementCancelWindowDays` = 30). Maslov: «Единичная отмена встречи не равна потере интереса». When `SIGNAL_CONTACT_QUIET` is switched on later: 1 cancel + 1 quiet trend also meets the condition. |
| reaction_role | opportunity |
| reaction_ru | Ответственный за возможность: договориться о содержательном контакте и следующем шаге. |
| stage | active |
| Note | Q24-8: the H trigger never fires; the risk still triggers through `MEETING_CANCEL` (block F, active). |

### 22 · `RISK_FEEDBACK_MISSING` — Нет содержательной обратной связи

| Field | Value |
|---|---|
| code | `RISK_FEEDBACK_MISSING` |
| label_ru | Нет содержательной обратной связи |
| description_ru | После предложения или защиты клиент не обсуждает решение и не объясняет, что мешает следующему шагу. |
| trigger_codes | `PITCH_FEEDBACK_MISSING` |
| clear_codes | `PITCH_REVISION_REQUESTED`, `PITCH_SELECTION_CRITERIA_DISCLOSED`, `PITCH_SHORTLISTED`, `PITCH_VERBAL_SELECTION` |
| clear_rule_ru | Получена содержательная обратная связь или явный исход. |
| severity | 5 |
| min_occurrences | 1 |
| stage_guard | S2–S4 |
| condition | — (the trigger code carries the Q24-11 rule: agreed feedback deadline or direct confirmation) |
| reaction_role | opportunity |
| reaction_ru | Pitch lead: договориться о разборе решения и препятствий со стороны клиента. |
| stage | active |

### 23 · `RISK_VERBAL_NOT_ORDER` — Устный выбор не превращается в заказ

| Field | Value |
|---|---|
| code | `RISK_VERBAL_NOT_ORDER` |
| label_ru | Устный выбор не превращается в заказ |
| description_ru | После сообщения о победе клиент затягивает оформление или снова открывает обсуждение уже согласованных условий. |
| trigger_codes | `PITCH_ORDER_FORMALIZATION_DELAYED` |
| clear_codes | `SALES_BOOKING_RECEIVED` |
| clear_rule_ru | Получен обязательный заказ либо клиент явно изменил решение. |
| severity | 7 |
| min_occurrences | 1 |
| stage_guard | S4 |
| condition | — |
| reaction_role | opportunity |
| reaction_ru | Ответственный за возможность: согласовать блокирующий вопрос и план оформления договора или заказа. |
| stage | active |
| Note | A verbal win never closes formalisation (spec §2.1 rule 7); the risk is not an automatic loss. |

### 24 · `RISK_PAYMENT_TERMS` — Невыгодные условия оплаты

| Field | Value |
|---|---|
| code | `RISK_PAYMENT_TERMS` |
| label_ru | Невыгодные условия оплаты |
| description_ru | Клиент требует длительную постоплату или другие условия, при которых агентство существенно финансирует работы за свой счёт. |
| trigger_codes | `PITCH_PAYMENT_TERMS_UNFAVORABLE` |
| clear_codes | — (no client signal proves the internal finance approval) |
| clear_rule_ru | Условия одобрены финансами и согласованы с клиентом (действие пользователя «Риск снят» с причиной) либо пользователь закрыл сделку как `withdrawn`. |
| severity | 7 |
| min_occurrences | 1 |
| stage_guard | S2–S5 |
| condition | — |
| reaction_role | finance |
| reaction_ru | Финансы вместе с pitch lead: оценить нагрузку на оборотные средства и согласовать допустимые условия оплаты. |
| stage | active |
| Note | Q24-7: Maslov «принято no-go» → user outcome `withdrawn`. |

### 25 · `RISK_REPEAT_TENDER` — Повторение неудачного отбора

| Field | Value |
|---|---|
| code | `RISK_REPEAT_TENDER` |
| label_ru | Повторение неудачного отбора |
| description_ru | Клиент снова приглашает участвовать после прежних безрезультатных конкурсов, а существенных изменений в доступе, процедуре или условиях не видно. |
| trigger_codes | `PITCH_REPEAT_UNPRODUCTIVE_TENDER` |
| clear_codes | `CONTACT_NEW_DECISION_MAKER`, `PITCH_BUYER_ACCESS_GRANTED`, `PITCH_SELECTION_CRITERIA_DISCLOSED` (with new criteria) |
| clear_rule_ru | Подтверждены существенные изменения либо ответственный принял решение об условиях участия. |
| severity | 6 |
| min_occurrences | 1 |
| stage_guard | S1–S3 |
| condition | — |
| reaction_role | new_biz |
| reaction_ru | New biz: выяснить, что изменилось с прошлых конкурсов, и решить об условиях участия. |
| stage | active |
| Note | Q24-7: Maslov «повторно принять go/no-go» removed. |

### 26 · `RISK_ACCOUNT_REVIEW` — Пересмотр отношений с действующим клиентом

| Field | Value |
|---|---|
| code | `RISK_ACCOUNT_REVIEW` |
| label_ru | Пересмотр отношений с действующим клиентом |
| description_ru | При обсуждении нового заказа или продления клиент сообщает о поиске другого подрядчика, обязательном конкурсе или недовольстве текущей работой. |
| trigger_codes | `ACCOUNT_SERVICE_REVIEW_REQUESTED`, `CONTRACT_RETENDER_ANNOUNCED`, `SIGNAL_AGENCY_CHANGE` (parked — ignored) |
| clear_codes | `CONTRACT_CONTINUATION_CONFIRMED`, `PITCH_OFFICIAL_AWARD`, `SALES_BOOKING_RECEIVED` |
| clear_rule_ru | Подтверждён итог пересмотра или повторного конкурса либо дальнейшие условия работы. |
| severity | 7 |
| min_occurrences | 1 |
| stage_guard | S1–S5 |
| condition | `existing_client_deal`: the deal is of type `renewal`, `incremental` or `re_pitch`, or the client has a running contract with the agency. The trigger is counted on account topics of the same client (not only deal topics), because review and re-tender arrive on the contract topic. |
| reaction_role | account |
| reaction_ru | Директор аккаунта: выяснить основания пересмотра и договориться о сохранении работы; при повторном конкурсе вести re-pitch как отдельную возможность. |
| stage | active |
| Note | Q24-7: Maslov «при re-pitch — принять go/no-go» removed (R4 opens the re-pitch directly). |

## Open points

1. **Base closing codes must close agency codes.** `SALES_OFFER_SENT` (S0) and `DELIVERY_PROTOCOL` are base codes. The agency needs them to close `PITCH_CREDENTIALS_REQUESTED`, `PITCH_SOLUTION_REQUESTED`, `PITCH_REVISION_REQUESTED`, `PITCH_FINAL_TERMS_DISCUSSION`, `PITCH_BRIEFING_ACCEPTED`, `PITCH_TEAM_INTRO_REQUESTED`, `PITCH_DEFENSE_INVITED`, `PROSPECT_CONVERSATION_ACCEPTED`. `closes_codes` is a field of the base code, and per-org overrides (spec §4.1) do not cover it. **Recommendation:** store these as pack-owned relation rows (`signal_relation` kind `closes`, owner pack `agency`), merged with the base `closes_codes` when the pack is active. Do not edit the base rows.
2. **Global auto-create threshold drops low-weight entry codes.** Spec §9.2 / Q27: auto at score ≥ 7, proposal at 5–6, nothing below. `PITCH_CREDENTIALS_REQUESTED` (4) alone would never open a deal, but Maslov §5.6 expects S2 for «Пришлите кейсы для отбора по нашему проекту». **Recommendation:** allow a per-rule `min_score` on `create_deal` rules (R6 = 4, R8 = 6) and always give a proposal card below 7, as the template does.
3. **Who opens the renewal opportunity is not defined.** Maslov §3.3 says a renewal can be a separate opportunity, and Q24-10 says when it is at S4, but no source says which signal creates it. **Recommendation:** `CONTRACT_RENEWAL_INTENT` → proposal card «Новая возможность: продление?» (R5); `CONTRACT_CONTINUATION_CONFIRMED` without a renewal deal → proposal to create it at S4 (R16).
4. **Engine gaps in the `signal_stage_rule` enum.** (a) There is no effect to resume a `paused` deal; Maslov closes the pause with «Работа возобновлена». (b) The enum has outcome `won`, but Maslov's win is S5 «Заказ подтверждён». **Recommendation:** (a) add effect `resume` (R37: an enter-stage code or a client-initiated meeting code on a paused deal sets status `active`; the snooze ends); (b) treat entry into the org's last open stage with `closure_probability` 1.0 (S5) as won; no separate won code.
5. **Block K needs a data source for the agency.** `ACCOUNT_DORMANT`, `ACCOUNT_REVENUE_DECLINE_YOY`, `ACCOUNT_REVENUE_GROWTH_YOY`, `ACCOUNT_PRODUCT_STOPPED`, `ACCOUNT_REACTIVATION_DUE` are `active` in v195, but spec §5.6 computes them from `order` / `order_item`, and the agency has no orders in the CRM (payments live in 1С, v2 «Бухгалтерия»). The trend rule of `ACCOUNT_INCREMENTAL_WORK_SLOWDOWN` likewise needs won `incremental` deals. **Recommendation:** keep the v195 statuses (as the task requires); they produce nothing until data exists, because insufficient data never makes an instance (Q24-11). Plan a 1С or pipeline import before the agency pilot if these signals are wanted.
6. **v204 codes that are not in the Maslov catalog.** `CONTRACT_COMPLIANCE_DECLARATION`, `SUPPLIER_DELIVERY_DELAY`, `SUPPLIER_PRICE_CHANGE` (v204 is newer than Maslov's v195, Q2). **Recommendation:** `onHold` for the agency until the agency asks for them (contractors and production houses are vendors, but no source names a need).
7. **v204 kind `trend` vs the Q24-6 list.** v204 marks `ACCOUNT_PRODUCT_STOPPED`, `ACCOUNT_CROSS_SELL_GAP`, `ACCOUNT_MEETING_OVERDUE` as `trend`; Q24-6 does not list them. **Recommendation:** apply the D4 ceiling only to the Q24-6 list. In practice there is no difference now: all three have weight 4–5 (D4) and two are not active.
8. **Risk 26 counts triggers outside deal topics.** Spec §9.4 counts a trigger only on a topic linked to the deal. `ACCOUNT_SERVICE_REVIEW_REQUESTED` and `CONTRACT_RETENDER_ANNOUNCED` usually arrive on the contract / account topic, not on the renewal or incremental deal. **Recommendation:** allow condition `existing_client_deal` to read account topics of the same client for this one risk; otherwise risk 26 almost never fires.
9. **Values proposed here that no source gives** (start values; tune in the pilot): `risk.singleContactMinDays` 21 and `risk.singleContactMinItems` 5; `risk.revisionCount` 3; `risk.repeatTenderLookbackMonths` 24 and `risk.repeatTenderMinPrior` 2; `trend.incrementalWindowMonths` 6, `trend.incrementalMinBaseline` 3, `trend.incrementalDropPct` 50; `risk.engagementCancelWindowDays` 30 with 2 cancellations; the 60-day window of the risk-5 condition; relevance windows of 30 / 60 days for `PROSPECT_EVENT_ATTENDED`, `PROSPECT_CONTACT_MENTIONED`, `PROSPECT_CONTACT_MOVED`; all 26 risk severities. **Recommendation:** accept as seed values; review after the first pilot month.
10. **Maslov action roles differ from the recipient column.** For several codes Maslov's action names New biz or Финансы (`PITCH_EXCLUDED`, `PITCH_CANCELLED_BY_CLIENT`, `PITCH_NEED_UNCONFIRMED`, `PITCH_BUDGET_UNDISCLOSED`, `PITCH_PRICE_ONLY_SELECTION`, `PITCH_REPEAT_UNPRODUCTIVE_TENDER`, `PITCH_PAYMENT_TERMS_UNFAVORABLE`), while the recipient column says «Питч». **Recommendation:** keep the Maslov recipient (`opportunity`) and name the second role in the card note; decide multi-role routing in the separate roles task (Q33).

# Topics — signals: base pack, blocks H–N, attributes, relations

> **Historical seed source — not updated (R22, 2026-11-14).** This file was the source of the registry seed (migration `0012`). After the seed **the DB is the master**; change signals in Settings → «Сигналы». Decision R22 (migration `0016_signals_generic_registry`) made the registry one generic set: it cleaned the DB texts of wine / alcohol / HoReCa examples and «IN4COM: …» notes, deleted 7 alcohol-only codes and dropped the IN4COM column / presets. This file still shows the old texts and the old «IN4COM» column; it is not updated. `04-distribution-pack-draft.md` and `05c-signals-distribution.md` are deleted (git history keeps them).

Status: draft for review · 2026-11-11 · seed data for the registry (spec §4)

**Sources.** Truffalo taxonomy v204 (`truffalo-logic-2026-11-10-10-05/signals-taxonomy.md`, plus the per-code card notes in `card-processing-rules.md`, the `press` profile in `parser-rules.md` and the CRM settings in `delivery-push-logic.md`); Maslov catalog v195 (§1 tables H–M, §5.1–5.5, appendix A); `01-specification.md` §4.2, §5.4–5.6, §10.3; `04-distribution-pack-draft.md` §2 (IN4COM column); `02-open-questions-answers.md` Q24-6, Q24-8, Q24-11. Conflict rule: weight, class, kind, score rule, stage, emitted by, amount and asks us come from v204 (v204 wins over Maslov v195 and over spec §4.3). Maslov gives the Russian label, the display profile, the recipient and the effort («Средняя*» = medium). The agency override (Q24-8: H and J parked) is NOT applied here; it belongs to the `agency` pack. v204 gives only counts for `inbound only` (38) and `classByRelation` (19), not the per-code flags; the values in this file are derived from the v204 card notes and are proposals (see Open points). All Russian cue text is written for Russian email, Telegram / WhatsApp and Russian news / registers, not translated from German.

**Code count (79):** H · 40 · I · 1 · J · 6 · K · 12 · L · 16 · M · 2 · N · 2. Plus 26 attributes and 22 relations.

**Conventions in this file.**
- Class «(rel.)» = `class_by_relation = true`: the card writer sets the final class from our relation to the company (active client / dormant client / prospect). The stored class is the v204 default.
- Profile «from weight (Px)» = default from the weight. Trend codes (spec §5.6 trend list) have a D4 ceiling.
- Process codes (`emitted_by = process`, and every `watchdog` / `trend` code) are never in the extraction prompt. Their entry has a **Правило срабатывания (trigger rule)** in Russian and English instead of prompt cues.
- Block H origins: (1) communication now — a client or a colleague writes about the event in email or chat; (2) `external` origin in phase 11 — Yandex web search per client and watch list, then the same extraction prompt in the `press` profile (spec §5.6). Block H is not first-party-only, so the `press` profile offers it. In the `press` profile `SIGNAL_DOWNSIZING`, `SIGNAL_COMPETITOR` and `SIGNAL_PRODUCT_DISCONTINUED` count only when the company is our client (v204 `press` rule).
- Block H recipient = relationship (Maslov «Связь»). IN4COM (wine / spirits distributor) draft §2: «most of block H off». This file sets IN4COM = on only for `SIGNAL_INSOLVENCY`, and review for the H codes that matter to a distributor's HoReCa / retail clients.
- Examples use invented companies («Северный ветер», «Винотека 24», «Гастроном Плюс»). No real company names.

## H · Рыночные события (события компаний и рынка)

| Code | Название (RU) | W | Class | Kind | Score rule | Effort | Asks us | Inbound only | Amount | Stage (pack) | IN4COM | Profile | Recipient | Family |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `SIGNAL_INSOLVENCY` | Кризис или неплатёжеспособность компании | 9 | risk | event | fixed | medium | no | no | no | active | on | P8 | relationship | market |
| `SIGNAL_DOWNSIZING` | Закрытие площадок или сокращение штата | 6 | risk | event | fixed | medium | no | no | no | active | review | P6 | relationship | market |
| `SIGNAL_AGENCY_CHANGE` | Смена рекламного или PR-агентства | 6 | risk (rel.) | event | fixed | medium | no | no | no | active | off | P6 | relationship | market |
| `SIGNAL_NEGATIVE_PRESS` | Репутационный кризис компании | 6 | chance | event | fixed | medium | no | no | no | active | off | P6 | relationship | market |
| `SIGNAL_NEW_MARKETING_LEAD` | Новый руководитель маркетинга или бренда | 5 | chance (rel.) | event | fixed | medium | no | no | no | active | off | D4 | relationship | market |
| `SIGNAL_MERGER` | Приобретение или слияние компаний | 5 | risk (rel.) | event | fixed | medium | no | no | no | active | review | D4 | relationship | market |
| `SIGNAL_COMPETITOR` | Активность конкурента у клиента | 5 | risk | event | fixed | medium | no | no | no | active | review | D4 | relationship | competitor |
| `SIGNAL_SPEND_UP` | Рост релевантных расходов | 5 | chance | event | fixed | medium | no | no | no | onHold | off | D4 (trend ceiling) | relationship | market |
| `SIGNAL_SPEND_DOWN` | Снижение релевантных расходов | 5 | risk | event | fixed | medium | no | no | no | onHold | off | D4 (trend ceiling) | relationship | market |
| `SIGNAL_NEW_TOP_SPENDER` | Появился новый крупный рекламодатель | 5 | chance | event | fixed | medium | no | no | no | onHold | off | D4 | relationship | market |
| `SIGNAL_PRODUCT_NEWS` | Запуск или обновление продукта | 5 | chance | event | fixed | medium | no | no | no | active | off | D4 | relationship | market |
| `SIGNAL_EXPANSION` | Расширение бизнеса или новая площадка | 4 | chance | event | fixed | medium | no | no | no | active | review | D4 | relationship | market |
| `SIGNAL_FUNDING` | Компания привлекла финансирование | 4 | chance | event | fixed | medium | no | no | no | active | off | D4 | relationship | market |
| `SIGNAL_C_LEVEL_CHANGE` | Смена высшего руководства | 4 | fyi (rel.) | event | fixed | medium | no | no | no | active | off | D4 | relationship | market |
| `SIGNAL_REBRANDING` | Ребрендинг или смена названия | 4 | chance | event | fixed | medium | no | no | no | active | off | D4 | relationship | market |
| `SIGNAL_STRATEGY_ANNOUNCEMENT` | Объявлена новая стратегия | 4 | chance (rel.) | event | fixed | medium | no | no | no | active | off | D4 | relationship | market |
| `SIGNAL_CHANNEL_SHIFT` | Перераспределение бюджета между каналами | 4 | chance (rel.) | event | fixed | medium | no | no | no | active | off | D4 | relationship | market |
| `SIGNAL_PRODUCT_DISCONTINUED` | Продукт снят с рынка | 4 | risk | event | fixed | medium | no | no | no | active | off | D4 | relationship | market |
| `SIGNAL_NEW_COMPANY` | Создана новая компания | 3 | chance | event | fixed | medium | no | no | no | active | review | W1 | relationship | market |
| `SIGNAL_TRADEMARK` | Зарегистрирован бренд или домен | 3 | chance | event | fixed | medium | no | no | no | active | off | W1 | relationship | market |
| `SIGNAL_JOB_POSTING` | Открыта релевантная вакансия | 3 | chance (rel.) | event | fixed | medium | no | no | no | active | off | W1 | relationship | market |
| `SIGNAL_EVENT` | Компания участвовала в отраслевом событии | 3 | fyi | event | fixed | medium | no | no | no | active | off | W1 | relationship | market |
| `SIGNAL_IPO` | Выход компании на биржу | 3 | chance | event | fixed | medium | no | no | no | active | off | W1 | relationship | market |
| `SIGNAL_ANNIVERSARY` | Юбилей с коммуникационной активностью | 5 | chance | event | fixed | medium | no | no | no | active | off | D4 | relationship | market |
| `SIGNAL_SPONSORING` | Спонсорский проект | 3 | fyi | event | fixed | medium | no | no | no | active | off | W1 | relationship | market |
| `SIGNAL_CONTACT_QUIET` | Снижается интенсивность общения | 3 | fyi | trend | fixed | medium | no | no | no | parked | off | W1 (trend ceiling D4) | relationship | account |
| `SIGNAL_INDUSTRY_TREND` | Отраслевая тенденция или регулирование | 2 | fyi | event | fixed | medium | no | no | no | active | review | W1 | relationship | market |
| `SIGNAL_RESULTS_POSITIVE` | Положительные результаты компании | 3 | fyi | event | fixed | medium | no | no | no | active | off | W1 | relationship | market |
| `SIGNAL_RESULTS_NEGATIVE` | Отрицательные результаты компании | 3 | fyi | event | fixed | medium | no | no | no | active | off | W1 | relationship | market |
| `SIGNAL_AWARD` | Компания получила награду | 2 | fyi | event | fixed | medium | no | no | no | active | off | W1 | relationship | market |
| `SIGNAL_PARTNERSHIP` | Объявлено партнёрство | 3 | chance | event | fixed | medium | no | no | no | active | off | W1 | relationship | market |
| `SIGNAL_AD_ACTIVITY` | Кампания идёт или завершается | 4 | chance | event | fixed | medium | no | no | no | active | off | D4 | relationship | market |
| `SIGNAL_ACCOUNT_WIN` | Агентство выиграло нового клиента | 5 | chance | event | fixed | medium | no | no | yes | active | off | D4 | relationship | market |
| `SIGNAL_OPERATIONS_INVESTMENT` | Инвестиции во внутреннюю деятельность | 2 | fyi | event | fixed | medium | no | no | no | active | off | W1 | relationship | market |
| `SIGNAL_STRATEGY_CONTEXT` | Контекст стратегии для будущего разговора | 2 | fyi | event | fixed | medium | no | no | no | active | off | W1 | relationship | market |
| `SIGNAL_TRACKING_VENDOR_CHANGE` | Смена поставщика аналитики или трекинга | 5 | chance (rel.) | event | fixed | medium | no | no | no | active | off | D4 | relationship | market |
| `SIGNAL_TRACKING_GAP` | Пробел в аналитике сайта | 4 | chance | event | fixed | medium | no | no | no | active | off | D4 | relationship | market |
| `SIGNAL_CAMPAIGN_PLANNED` | Запланирована кампания | 5 | chance | event | fixed | medium | no | no | no | active | off | D4 | relationship | market |
| `SIGNAL_ANNIVERSARY_PLAIN` | Юбилей без коммуникационной активности | 2 | fyi | event | fixed | medium | no | no | no | active | off | W1 | relationship | market |
| `SIGNAL_EVENT_UPCOMING` | Предстоит участие компании в событии | 3 | chance | event | fixed | medium | no | no | no | active | off | W1 | relationship | market |

### `SIGNAL_INSOLVENCY` — Кризис или неплатёжеспособность компании

| Field | Value |
|---|---|
| Pack · block · family | base · H · market |
| Weight · class · kind · score rule | 9 · risk · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both (parser on mail / chat; `press` profile on web search, phase 11) |
| Stage (pack default) · IN4COM | active · on |
| Display profile | from weight (P8) |
| Recipient role | relationship (Maslov «Связь»); IN4COM proposal: add finance — see Open points |
| Closes / closed by | closes: — · closed by: — |
| Relations | leads over `SIGNAL_NEGATIVE_PRESS`; outranked by `SIGNAL_MERGER` (a rescue or takeover out of the insolvency) |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual: risk trigger «Клиент в процедуре банкротства / ликвидации» on every open deal of this client (no stage move) |

**Определение:** В отношении компании начата процедура банкротства (наблюдение, конкурсное производство, внешнее управление, реструктуризация долгов), принято решение о её ликвидации, или компания сама сообщает о прекращении платежей, блокировке счетов, неспособности рассчитаться с поставщиками. Сюда же относится опубликованное на Федресурсе уведомление кредитора о намерении подать заявление о банкротстве этой компании.

**Граница (не считается):** Негативная публикация без признаков неплатёжеспособности → `SIGNAL_NEGATIVE_PRESS`. Просрочка одного счёта или обещание оплатить позже → `INVOICE_OVERDUE` / `PAYMENT_PROMISE`. Просьба об отсрочке или рассрочке → `PAYMENT_TERMS_REQUEST` (distribution). Новость о том, что покупатель выкупает или спасает бизнес банкрота → `SIGNAL_MERGER` для покупателя, банкротство — только контекст. Реорганизация в форме присоединения или слияния → `SIGNAL_MERGER`. Закрытие отдельных точек без признаков неплатёжеспособности → `SIGNAL_DOWNSIZING`. Банкротство компании, которая не наш клиент и не связана с ним, — нет сигнала.

**Признаки для промпта (≤ 8):** «введена процедура наблюдения», «признан(а) банкротом», «открыто конкурсное производство», «заявление о признании банкротом», «находится в стадии ликвидации», «приостановлены операции по счетам», «временно прекращаем платежи», «реструктуризация задолженности»

**Синонимы и выражения (полный список):**
- Деловая переписка: «вынуждены временно приостановить расчёты с поставщиками», «наши расчётные счета заблокированы», «в отношении общества введена процедура наблюдения», «назначен временный управляющий, все вопросы по оплате направляйте ему», «компания находится в процедуре банкротства», «принято решение о добровольной ликвидации общества», «требования кредиторов принимаются в порядке, установленном законом о банкротстве», «не имеем возможности погасить задолженность в полном объёме»
- Новости и реестры (Федресурс, ЕГРЮЛ, картотека арбитражных дел): «арбитражный суд ввёл процедуру наблюдения», «признано несостоятельным (банкротом)», «открыто конкурсное производство сроком на шесть месяцев», «введено внешнее управление», «утверждён конкурсный управляющий», «опубликовано уведомление о намерении обратиться в суд с заявлением о банкротстве», «юридическое лицо находится в процессе ликвидации», «ФНС приостановила операции по счетам компании», «кредиторы подали иск о банкротстве», «сеть объявила о реструктуризации долга перед банками»
- Чаты / мессенджеры (разговорный стиль): «у них блок по счетам», «они банкротятся», «слышал, «Северный ветер» подали на банкротство», «там уже конкурсный управляющий сидит», «денег нет, платить не будут», «контора ликвидируется»
- Сокращения и термины: «127-ФЗ», «Федресурс», «ЕФРСБ», «КАД», «ВУ» (временный управляющий), «КУ» (конкурсный управляющий), «РТК» (реестр требований кредиторов), «мораторий», «санация», «субсидиарка»
- Устойчивые конструкции / маркеры: «в отношении [компании] введена / открыта [процедура]», «[компания] признана банкротом», «подано заявление о банкротстве [компании]», «[компания] находится в стадии ликвидации»

**Похоже, но не это (анти-признаки):** «группа выкупила рестораны у конкурсного управляющего и сохранит их» → `SIGNAL_MERGER`; «оплатим на следующей неделе, задержка с платежом» → `INVOICE_OVERDUE` / `PAYMENT_PROMISE`; «просим отсрочку 60 дней» → `PAYMENT_TERMS_REQUEST`; «закрываем две точки в ТЦ» → `SIGNAL_DOWNSIZING`; «реорганизация в форме присоединения к АО» → `SIGNAL_MERGER`; «в ЕГРЮЛ запись о недостоверности адреса» → нет сигнала; «выручка упала на 20 %» → `SIGNAL_RESULTS_NEGATIVE`

**Пример (evidence):** «Сообщаем, что определением Арбитражного суда г. Москвы от 05.11.2026 в отношении ООО «Северный ветер» введена процедура наблюдения, временным управляющим утверждён Иванов И. И.»
**Контрпример:** «Ресторанная группа «Гастроном Плюс» выкупила бизнес «Северного ветра» у конкурсного управляющего и сохранит все рестораны» → это `SIGNAL_MERGER` для покупателя; банкротство здесь контекст.

**Заметка для карточки:** Пишите от роли: ответственному за клиента вместе с финансовой службой — остановить отгрузки с отсрочкой, сверить дебиторскую задолженность и решить, заявлять ли требование кредитора; новых условий клиенту не обещать.

### `SIGNAL_DOWNSIZING` — Закрытие площадок или сокращение штата

| Field | Value |
|---|---|
| Pack · block · family | base · H · market |
| Weight · class · kind · score rule | 6 · risk · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both; in the `press` profile only when the company is our client |
| Stage (pack default) · IN4COM | active · review |
| Display profile | from weight (P6) |
| Recipient role | relationship |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual: risk trigger on open deals tied to the closed venues / sites (no stage move) |

**Определение:** Компания закрывает свои точки, магазины, рестораны, филиалы или производство, уходит из региона или сокращает персонал. Речь о действующей компании, которая сжимает бизнес.

**Граница (не считается):** Процедура банкротства или ликвидации → `SIGNAL_INSOLVENCY`. Клиент убирает наши позиции из меню или ассортимента → `DELISTING_RISK` (distribution). Временное закрытие на ремонт, санитарный день или сезонная пауза с датой открытия — нет сигнала. Закрытие за рубежом, вне регионов из профиля организации, — нет сигнала. Перевод точки по новому адресу → `SIGNAL_EXPANSION` только если открывается новая площадка; иначе нет сигнала.

**Признаки для промпта (≤ 8):** «закрывает рестораны», «закрытие точки», «сокращение штата», «оптимизация персонала», «уходит из региона», «сворачивает сеть», «закрываемся с 1-го числа», «массовые увольнения»

**Синонимы и выражения (полный список):**
- Деловая переписка: «с 01.12 ресторан на Тверской прекращает работу», «мы закрываем два магазина из пяти», «в связи с оптимизацией сети точка закрывается», «просим не планировать поставки на адрес Покровка, 12 после 30.11», «у нас сокращение, отдел закупок урезали вдвое», «прекращаем деятельность в Санкт-Петербурге»
- Новости: «сеть закроет 15 магазинов до конца года», «ресторанная группа сократит 300 сотрудников», «компания уходит из регионов», «оптимизирует розничную сеть», «закрыла завод в Калужской области», «сокращает штат на 10 %»
- Чаты / мессенджеры (разговорный стиль): «мы закрываемся», «бар закрываем, аренду не потянули», «точку на Белорусской закрыли», «у них всех закупщиков сократили», «сворачиваются потихоньку»
- Сокращения и термины: «оптимизация», «реструктуризация сети», «закрытие ТТ» (торговой точки), «сокращение ФОТ»
- Устойчивые конструкции / маркеры: «[компания] закрывает / закроет [N точек]», «прекращает работу [точка / регион]», «сокращает [N сотрудников / %]»

**Похоже, но не это (анти-признаки):** «закрыты на ремонт до 15.01» → нет сигнала; «вводим процедуру банкротства» → `SIGNAL_INSOLVENCY`; «убираем ваше вино из карты» → `DELISTING_RISK`; «переезжаем в новое помещение, откроемся 01.02» → нет сигнала (или `SIGNAL_EXPANSION`, если площадка новая); «закрываем магазины в Казахстане» → нет сигнала (вне наших регионов)

**Пример (evidence):** «Коллеги, с 1 декабря закрываем ресторан на Покровке, поставки туда больше не планируйте.»
**Контрпример:** «Ресторан закрыт на санитарный день, принять поставку не сможем, перенесите на завтра» → это не сокращение бизнеса.

**Заметка для карточки:** Назовите, что закрывается и с какой даты; шаг — связаться с закупщиком клиента, узнать, какие точки продолжают работу и что будет с текущими заказами и долгом.

### `SIGNAL_AGENCY_CHANGE` — Смена рекламного или PR-агентства

| Field | Value |
|---|---|
| Pack · block · family | base · H · market |
| Weight · class · kind · score rule | 6 · risk (class by relation: yes) · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · off |
| Display profile | from weight (P6) |
| Recipient role | relationship |
| Closes / closed by | closes: — · closed by: — |
| Relations | leads over `SIGNAL_AD_ACTIVITY`; both with `SIGNAL_ACCOUNT_WIN`; when the losing agency is our competitor and the advertiser is not our client → `COMPETITOR_LOST_CLIENT` instead |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual: none (agency pack: risk trigger when the advertiser is our client) |

**Определение:** Рекламодатель пересматривает или переводит свой рекламный, медийный или PR-бюджет: объявляет тендер на агентство, расстаётся с текущим агентством или называет новое агентство по итогам тендера. Если в тексте названо агентство-победитель, дополнительно ставится `SIGNAL_ACCOUNT_WIN`.

**Граница (не считается):** Новая кампания того же агентства → `SIGNAL_CAMPAIGN_PLANNED` / `SIGNAL_AD_ACTIVITY`. Первое назначение агентства без тендера и без прежнего агентства → только `SIGNAL_ACCOUNT_WIN`. Агентство-конкурент потеряло рекламодателя, который не наш клиент → `COMPETITOR_LOST_CLIENT`. Смена агентства по трекингу или веб-аналитике → `SIGNAL_TRACKING_VENDOR_CHANGE`. Клиент меняет поставщика товаров (вина, напитков) — это не агентство: `SIGNAL_COMPETITOR` или нет сигнала.

**Признаки для промпта (≤ 8):** «объявил тендер на креативное обслуживание», «тендер на медиаобслуживание», «ищет новое агентство», «прекращает сотрудничество с агентством», «сменил агентство», «по итогам тендера выбрал», «бюджет переходит к», «пересматривает пул агентств»

**Синонимы и выражения (полный список):**
- Деловая переписка: «мы объявляем тендер на рекламное обслуживание на 2027 год», «с текущим агентством контракт не продлеваем», «приглашаем к участию в тендере на SMM», «пересматриваем пул подрядчиков по коммуникациям», «агентство «Альфа Медиа» больше не ведёт наш бренд»
- Новости (отраслевые СМИ о рекламе): «бренд объявил креативный тендер», «тендер на медийное обслуживание выиграло агентство», «бюджет бренда перешёл к агентству», «компания провела тендер и сменила PR-агентство», «бренд расстался с агентством после пяти лет сотрудничества», «рекламодатель пересматривает пул агентств»
- Чаты / мессенджеры (разговорный стиль): «они агентство меняют», «у них тендер на креатив», «старое агентство слили», «ищут новое агентство под digital»
- Сокращения и термины: «тендер», «пул агентств», «AOR» (agency of record), «медиабюджет», «креатив», «SMM», «PR-подрядчик», «RFP»
- Устойчивые конструкции / маркеры: «[бренд] объявил тендер на [вид обслуживания]», «[бренд] сменил [агентство X] на [агентство Y]», «[агентство] больше не обслуживает [бренд]»

**Похоже, но не это (анти-признаки):** «агентство «Альфа Медиа» запускает новую кампанию бренда» → `SIGNAL_CAMPAIGN_PLANNED`; «бренд впервые выбрал агентство» → `SIGNAL_ACCOUNT_WIN`; «сменили подрядчика по Яндекс Метрике и тегам» → `SIGNAL_TRACKING_VENDOR_CHANGE`; «будем брать вино у другого дистрибьютора» → `SIGNAL_COMPETITOR`

**Пример (evidence):** «Бренд «Гастроном Плюс» объявил тендер на креативное и медийное обслуживание: контракт с агентством «Альфа Медиа» заканчивается в декабре.»
**Контрпример:** «Агентство «Альфа Медиа» представило новую сезонную кампанию бренда «Гастроном Плюс»» → это кампания действующего агентства, не смена.

**Заметка для карточки:** Пишите для той стороны, которая наш клиент: рекламодателю — узнать у контакта по маркетингу, меняет ли смена агентства наш план; агентству-клиенту — что смена значит для нашего сотрудничества; действие всегда наше, не шаг рекламодателя из статьи.

### `SIGNAL_NEGATIVE_PRESS` — Репутационный кризис компании

| Field | Value |
|---|---|
| Pack · block · family | base · H · market |
| Weight · class · kind · score rule | 6 · chance · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · off |
| Display profile | from weight (P6) |
| Recipient role | relationship |
| Closes / closed by | closes: — · closed by: — |
| Relations | `SIGNAL_INSOLVENCY` leads over it |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual: none |

**Определение:** О компании выходят критические публикации, волна негатива в соцсетях, сообщения об отзыве продукции или о предупреждении надзорного органа. Компания при этом продолжает работать.

**Граница (не считается):** Банкротство, ликвидация, блокировка счетов → `SIGNAL_INSOLVENCY`. Опубликованные финансовые потери с цифрой и периодом → `SIGNAL_RESULTS_NEGATIVE`. Закрытие точек → `SIGNAL_DOWNSIZING`. Жалоба клиента на наш товар или сервис → блок E (`COMPLAINT_*`). Негатив о конкуренте → `COMPETITOR_NEGATIVE_PRESS`, о партнёре → `PARTNER_NEGATIVE_PRESS`.

**Признаки для промпта (≤ 8):** «скандал», «волна негатива», «отзыв партии», «Роспотребнадзор выявил нарушения», «проверка выявила», «бойкот», «обвиняют в», «предписание надзорного органа»

**Синонимы и выражения (полный список):**
- Деловая переписка: «у нас сейчас непростая ситуация в соцсетях», «по сети пошла волна отзывов после отравления», «мы получили предписание Роспотребнадзора», «партия отозвана из продажи по решению надзора»
- Новости: «ресторан оказался в центре скандала», «Роспотребнадзор приостановил работу заведения», «сеть обвинили в продаже контрафакта», «покупатели объявили бойкот», «бренд отзывает партию продукции», «в сети разгорелся скандал после поста посетителя», «прокуратура начала проверку»
- Чаты / мессенджеры (разговорный стиль): «у них жесть в отзывах», «их сейчас в телеге полощут», «хайп из-за отравления», «Роспотреб к ним пришёл»
- Сокращения и термины: «Роспотребнадзор», «РАР» (Росалкогольтабакконтроль), «предписание», «отзыв продукции», «контрафакт», «фальсификат», «административное дело»
- Устойчивые конструкции / маркеры: «[компания] оказалась в центре [скандала]», «[надзор] выявил нарушения у [компании]», «[компания] отзывает [продукцию]»

**Похоже, но не это (анти-признаки):** «введено конкурсное производство» → `SIGNAL_INSOLVENCY`; «убыток за 9 месяцев вырос на 30 %» → `SIGNAL_RESULTS_NEGATIVE`; «гость пожаловался, что ваше вино с пробкой» → `COMPLAINT_QUALITY`; «конкурент попал в скандал» → `COMPETITOR_NEGATIVE_PRESS`

**Пример (evidence):** «Роспотребнадзор приостановил работу бара «Винотека 24» на Арбате на 30 суток после проверки.»
**Контрпример:** «Бар «Винотека 24» закрывается, аренду не продлили» → это `SIGNAL_DOWNSIZING`, не репутационный кризис.

**Заметка для карточки:** Без использования кризиса в продажах: предложить ответственному за клиента связаться с контактом клиента по роли, узнать, как кризис влияет на закупки и что клиент планирует, и только потом обсуждать поставки.

### `SIGNAL_NEW_MARKETING_LEAD` — Новый руководитель маркетинга или бренда

| Field | Value |
|---|---|
| Pack · block · family | base · H · market |
| Weight · class · kind · score rule | 5 · chance (class by relation: yes — active client: risk by default) · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · off |
| Display profile | from weight (D4) |
| Recipient role | relationship |
| Closes / closed by | closes: — · closed by: — |
| Relations | leads over `SIGNAL_C_LEVEL_CHANGE` (for a marketing-head change) |
| Date gate | — (prompt rule: the change took effect no more than 6 months before the item date; a vague date counts as 3–6 months; no date = new) |
| Relevance window | default |
| Deal effect | per org rule; usual: none |

**Определение:** В компании новый руководитель маркетинга, бренда или коммуникаций — человек, который решает о бюджете в нашей области. Для дистрибьютора к этой роли относятся также руководитель категории напитков, бренд-шеф бара или главный сомелье сети, если в тексте он решает о закупках.

**Граница (не считается):** Новый генеральный, финансовый, коммерческий директор → `SIGNAL_C_LEVEL_CHANGE`. Новый человек пишет нам сам как контакт → `CONTACT_NEW_DECISION_MAKER` (блок G). Назначение больше 6 месяцев назад («работает с ноября прошлого года») — нет сигнала. Уход руководителя маркетинга без названного преемника, который пишет нам сам → `CONTACT_LEAVING`.

**Признаки для промпта (≤ 8):** «назначен директором по маркетингу», «новый CMO», «возглавил маркетинг», «новый бренд-директор», «назначена руководителем направления коммуникаций», «пришёл новый маркетолог», «новый шеф-сомелье сети», «перешёл на позицию директора по маркетингу»

**Синонимы и выражения (полный список):**
- Деловая переписка: «сообщаем, что с 01.11 директором по маркетингу назначена Анна Смирнова», «теперь маркетинг курирует новый руководитель», «по вопросам продвижения обращайтесь к новому бренд-менеджеру»
- Новости: «директором по маркетингу компании назначен», «новым CMO сети стала», «возглавила департамент маркетинга и коммуникаций», «на позицию бренд-директора пришёл», «ресторанная группа назначила нового директора по маркетингу», «главным сомелье группы стал»
- Чаты / мессенджеры (разговорный стиль): «у них новый маркетолог», «маркетинг теперь ведёт новая девушка», «пришёл новый CMO, всё пересматривает», «поменялся шеф-сомелье»
- Сокращения и термины: «CMO», «бренд-директор», «директор по маркетингу», «руководитель PR», «шеф-сомелье», «бренд-шеф бара»
- Устойчивые конструкции / маркеры: «[ФИО] назначен(а) [директором по маркетингу]», «на должность [CMO] пришёл / пришла», «[ФИО] возглавил(а) [маркетинг]»

**Похоже, но не это (анти-признаки):** «назначен новый генеральный директор» → `SIGNAL_C_LEVEL_CHANGE`; «я новый закупщик, теперь заказы через меня» → `CONTACT_NEW_DECISION_MAKER`; «руководит маркетингом с 2024 года» → нет сигнала (старое); «уважаемые партнёры, я покидаю компанию» → `CONTACT_LEAVING`

**Пример (evidence):** «Директором по маркетингу ресторанной группы «Северный ветер» назначена Анна Смирнова, ранее работавшая в сети «Винотека 24».»
**Контрпример:** «Анна Смирнова, директор по маркетингу «Северного ветра» с 2023 года, рассказала о планах на сезон» → назначение старое, сигнала нет.

**Заметка для карточки:** Называйте роль, не имя («новый директор по маркетингу клиента»); для активного клиента — риск: договориться о ранней встрече и узнать планы; для неклиента — шанс представиться до выбора партнёров.

### `SIGNAL_MERGER` — Приобретение или слияние компаний

| Field | Value |
|---|---|
| Pack · block · family | base · H · market |
| Weight · class · kind · score rule | 5 · risk (class by relation: yes — our client buys: chance; our client is bought: risk; not a client: chance) · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · review |
| Display profile | from weight (D4) |
| Recipient role | relationship |
| Closes / closed by | closes: — · closed by: — |
| Relations | outranks `SIGNAL_INSOLVENCY`; leads over `SIGNAL_PARTNERSHIP`; leads over `SIGNAL_FUNDING` |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual: risk trigger «Смена собственника клиента» on open deals when our client is bought |

**Определение:** Меняется контроль над компанией: покупка, слияние, присоединение, переход контрольного пакета или доли больше 50 %. Сюда же — выкуп бренда или бизнеса из банкротства (спасение): код ставится покупателю, банкротство остаётся контекстом.

**Граница (не считается):** Доля без смены контроля, инвестиционный раунд → `SIGNAL_FUNDING`. Совместный проект, дистрибуторское соглашение без смены владельца → `SIGNAL_PARTNERSHIP`. Собственное банкротство компании, где покупатель только упомянут как возможный → `SIGNAL_INSOLVENCY`. Покупка оборудования, складов, транспорта → `SIGNAL_OPERATIONS_INVESTMENT`.

**Признаки для промпта (≤ 8):** «приобрела», «выкупила», «закрыла сделку по покупке», «слияние», «присоединение», «контрольный пакет», «стала владельцем», «ФАС одобрила сделку»

**Синонимы и выражения (полный список):**
- Деловая переписка: «сообщаем, что с 01.12 общество вошло в состав группы «Гастроном Плюс»», «у нас сменился собственник», «в связи с реорганизацией в форме присоединения просим перезаключить договор», «все договоры переходят к новому юрлицу»
- Новости и реестры: «группа приобрела сеть ресторанов», «выкупила 100 % долей», «получила контроль над», «ФАС одобрила ходатайство о покупке», «компании объявили о слиянии», «реорганизация в форме присоединения», «новым владельцем стал», «выкупила бренд у конкурсного управляющего», «сделка по спасению сети закрыта»
- Чаты / мессенджеры (разговорный стиль): «их купили», «теперь они под «Гастроном Плюс»», «собственник поменялся», «их поглотили»
- Сокращения и термины: «M&A», «ФАС», «контрольный пакет», «мажоритарий», «присоединение», «правопреемник», «новое юрлицо»
- Устойчивые конструкции / маркеры: «[покупатель] приобрёл / выкупил [компанию / долю N %]», «[компания] вошла в состав [группы]», «сделка по покупке [компании] закрыта»

**Похоже, но не это (анти-признаки):** «фонд вложил 500 млн за миноритарную долю» → `SIGNAL_FUNDING`; «подписали соглашение о совместном продвижении» → `SIGNAL_PARTNERSHIP`; «введена процедура наблюдения, ищем инвестора» → `SIGNAL_INSOLVENCY`; «купили новый склад в Подольске» → `SIGNAL_OPERATIONS_INVESTMENT`

**Пример (evidence):** «Холдинг «Гастроном Плюс» закрыл сделку по покупке 100 % сети винных баров «Винотека 24».»
**Контрпример:** «Холдинг «Гастроном Плюс» и «Винотека 24» запускают совместную программу лояльности» → это партнёрство, контроль не меняется.

**Заметка для карточки:** Пишите со стороны нашего клиента и назовите другую сторону; клиента купили — узнать у контакта, меняются ли закупки, поставщики и договор; клиент купил — шанс зайти в новый бизнес; один материал о покупателе и купленном — одна карточка.

### `SIGNAL_COMPETITOR` — Активность конкурента у клиента

| Field | Value |
|---|---|
| Pack · block · family | base · H · competitor |
| Weight · class · kind · score rule | 5 · risk · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both; in the `press` profile only when the company is our client |
| Stage (pack default) · IN4COM | active · review |
| Display profile | from weight (D4) |
| Recipient role | relationship |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual: risk trigger «Конкурент у клиента» on an open deal of this client |

**Определение:** У нашего клиента появляется конкурент: клиент говорит, что работает или начинает работать с другим поставщиком, рассматривает его продукцию, конкурент проводит у клиента дегустацию или презентацию. Без связи с конкретным клиентом это не сигнал.

**Граница (не считается):** Жалоба на цену со ссылкой на более дешёвое предложение → `COMPLAINT_PRICE`. Клиент выводит наши позиции → `DELISTING_RISK` (distribution). Новость о конкуренте без связи с нашим клиентом → блок L (`COMPETITOR_*`). Отказ от нашего предложения с выбором другого поставщика → `SALES_OFFER_DECLINED` (если отказ явный, этот код можно поставить вторым).

**Признаки для промпта (≤ 8):** «работаем с другим поставщиком», «нам предложил другой дистрибьютор», «взяли у другого поставщика», «рассматриваем предложение конкурента», «у нас была дегустация от», «перешли на другого импортёра», «часть позиций берём у», «к нам приходил представитель»

**Синонимы и выражения (полный список):**
- Деловая переписка: «по Бургундии мы теперь работаем с другим поставщиком», «нам поступило предложение от другого дистрибьютора, рассматриваем», «часть позиций переводим к другому импортёру», «на следующей неделе у нас дегустация от «Винного Альянса»», «сравниваем ваше портфолио с альтернативным»
- Чаты / мессенджеры (разговорный стиль): «нам «Винный Альянс» тоже предлагал», «игристое теперь берём у других», «к нам ихний торговый приходил», «конкуренты зашли с дегустацией»
- Сокращения и термины: «другой дистрибьютор», «импортёр», «альтернативное предложение», «торговый представитель», «дегустация», «портфолио»
- Устойчивые конструкции / маркеры: «работаем / начали работать с [другим поставщиком]», «[конкурент] предложил нам [позиции / условия]», «переводим [позиции] к [конкуренту]»

**Похоже, но не это (анти-признаки):** «у другого поставщика на 15 % дешевле, дайте скидку» → `COMPLAINT_PRICE`; «убираем ваши вина из карты» → `DELISTING_RISK`; ««Винный Альянс» открыл склад в Казани» (без связи с клиентом) → `COMPETITOR_EXPANSION`; «спасибо, выбрали другого поставщика» → `SALES_OFFER_DECLINED`

**Пример (evidence):** «Белые вина Луары с января будем брать у «Винного Альянса», они дали лучшую логистику.»
**Контрпример:** ««Винный Альянс» стал официальным импортёром нового бренда» → новость о конкуренте без связи с нашим клиентом, это блок L.

**Заметка для карточки:** Пишите о клиенте, у которого появился конкурент, а не о самом конкуренте; шаг — узнать у закупщика, какие позиции и почему уходят, и что мы можем предложить до следующей закупки.

### `SIGNAL_SPEND_UP` — Рост релевантных расходов

| Field | Value |
|---|---|
| Pack · block · family | base · H · market |
| Weight · class · kind · score rule | 5 · chance · event (on the spec §5.6 trend list) · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | process |
| Stage (pack default) · IN4COM | onHold · off |
| Display profile | from weight (D4); trend ceiling D4 |
| Recipient role | relationship |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — (trend rule below) |
| Relevance window | trend cooldown 90 days per client + code (`cards.trendCooldownDays`); a change of direction makes a new card at once |
| Deal effect | per org rule; usual: none |

**Определение:** Расходы клиента в категории, важной для нас, заметно растут — независимо от его бюджета у нас (агентство: рекламные расходы по данным мониторинга; дистрибьютор: закупки категории, если есть внешний источник).

**Граница (не считается):** Рост закупок у нас → `ACCOUNT_REVENUE_GROWTH_YOY`. Клиент сам объявляет об увеличении бюджета у нас → `SALES_BUDGET_INCREASE`. Перераспределение между каналами при прежней сумме → `SIGNAL_CHANNEL_SHIFT`. Одна крупная кампания → `SIGNAL_AD_ACTIVITY`.

**Признаки для промпта:** — (not in the extraction prompt; emitted by process)

**Правило срабатывания (trigger rule):**
- RU: Данные — внешний поток расходов клиента по категории (агентство: рекламный мониторинг; дистрибьютор: источника пока нет). Окно — последний полный квартал. База — тот же квартал прошлого года. Минимум данных — 4 квартала истории и сумма базы не ниже порога организации. Порог — рост ≥ 20 %. Запуск — ежемесячно. Повтор — не раньше 90 дней на клиента и код; смена направления сразу даёт новую карточку. Мало данных — сигнала нет.
- EN: Data — an external feed of the client's spend per category (agency: ad monitoring; distributor: no source yet). Window — last full quarter. Baseline — same quarter one year earlier. Minimum data — 4 quarters of history and a baseline above the org minimum. Threshold — growth ≥ 20 %. Run — monthly. Cooldown — 90 days per client + code; a change of direction makes a new card at once. Too little data — no instance.

**Пример (evidence):** «Рекламные расходы «Гастроном Плюс» в III квартале 2026: 48 млн ₽ против 35 млн ₽ годом ранее (+37 %).»
**Контрпример:** «Клиент купил у нас на 30 % больше, чем в прошлом году» → это `ACCOUNT_REVENUE_GROWTH_YOY`.

**Заметка для карточки:** Назовите категорию и рост в процентах; шаг — узнать у контакта клиента, что стоит за ростом и есть ли место для нас.

### `SIGNAL_SPEND_DOWN` — Снижение релевантных расходов

| Field | Value |
|---|---|
| Pack · block · family | base · H · market |
| Weight · class · kind · score rule | 5 · risk · event (on the spec §5.6 trend list) · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | process |
| Stage (pack default) · IN4COM | onHold · off |
| Display profile | from weight (D4); trend ceiling D4 |
| Recipient role | relationship |
| Closes / closed by | closes: — · closed by: — |
| Relations | `SIGNAL_CHANNEL_SHIFT` leads over it (when the total stays the same) |
| Date gate | — (trend rule below) |
| Relevance window | trend cooldown 90 days per client + code; a change of direction makes a new card at once |
| Deal effect | per org rule; usual: none |

**Определение:** Расходы клиента в категории, важной для нас, заметно падают — независимо от его бюджета у нас.

**Граница (не считается):** Снижение закупок у нас → `ACCOUNT_REVENUE_DECLINE_YOY`. Клиент сам объявляет о сокращении бюджета у нас → `SALES_BUDGET_CUT`. Перенос бюджета между каналами при прежней сумме → `SIGNAL_CHANNEL_SHIFT`.

**Признаки для промпта:** — (not in the extraction prompt; emitted by process)

**Правило срабатывания (trigger rule):**
- RU: Те же данные, окно и база, что у `SIGNAL_SPEND_UP`. Порог — снижение ≥ 20 %. Минимум данных — 4 квартала истории. Запуск — ежемесячно. Повтор — не раньше 90 дней на клиента и код. Если в том же периоде у клиента сработал `SIGNAL_CHANNEL_SHIFT`, ведёт он.
- EN: Same data, window and baseline as `SIGNAL_SPEND_UP`. Threshold — decline ≥ 20 %. Minimum data — 4 quarters. Run — monthly. Cooldown — 90 days per client + code. When `SIGNAL_CHANNEL_SHIFT` fires for the same client and period, it leads.

**Пример (evidence):** «Рекламные расходы «Винотека 24» в III квартале 2026: 6 млн ₽ против 11 млн ₽ годом ранее (−45 %).»
**Контрпример:** «Клиент перенёс бюджет с наружной рекламы в digital, общая сумма та же» → это `SIGNAL_CHANNEL_SHIFT`.

**Заметка для карточки:** Назовите категорию и падение в процентах; шаг — до следующего плана узнать у контакта клиента причину снижения.

### `SIGNAL_NEW_TOP_SPENDER` — Появился новый крупный рекламодатель

| Field | Value |
|---|---|
| Pack · block · family | base · H · market |
| Weight · class · kind · score rule | 5 · chance · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | process |
| Stage (pack default) · IN4COM | onHold · off |
| Display profile | from weight (D4) |
| Recipient role | relationship (agency pack may route to new_biz) |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | cooldown 90 days per company + code |
| Deal effect | per org rule; usual: none (a prospect, not a deal) |

**Определение:** На рынке появляется компания с большими расходами в нашей категории, которая ещё не наш клиент.

**Граница (не считается):** Уже наш клиент → `SIGNAL_SPEND_UP`. Новое юрлицо без данных о расходах → `SIGNAL_NEW_COMPANY`. Разовая заметная кампания без данных о расходах → `SIGNAL_AD_ACTIVITY`.

**Признаки для промпта:** — (not in the extraction prompt; emitted by process)

**Правило срабатывания (trigger rule):**
- RU: Данные — внешний рейтинг расходов по категории. Условие — компания впервые входит в топ-N категории (N — настройка организации, предложение 50) и её нет в CRM как клиента. Минимум данных — 2 периода рейтинга. Запуск — ежемесячно. Повтор — не раньше 90 дней на компанию.
- EN: Data — an external spend ranking per category. Condition — the company enters the category top-N for the first time (N is an org setting, proposal 50) and is not a client in the CRM. Minimum data — 2 ranking periods. Run — monthly. Cooldown — 90 days per company.

**Пример (evidence):** «Сеть «Гастроном Плюс» впервые вошла в топ-50 рекламодателей категории «Продукты и напитки» (12 млн ₽ за октябрь 2026).»
**Контрпример:** «Наш клиент «Винотека 24» поднялся с 40-го на 20-е место» → клиент уже наш, это `SIGNAL_SPEND_UP`.

**Заметка для карточки:** Карточка о новом потенциальном клиенте: назовите категорию и объём; шаг — первый контакт через роль по маркетингу или закупкам.

### `SIGNAL_PRODUCT_NEWS` — Запуск или обновление продукта

| Field | Value |
|---|---|
| Pack · block · family | base · H · market |
| Weight · class · kind · score rule | 5 · chance · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · off |
| Display profile | from weight (D4) |
| Recipient role | relationship |
| Closes / closed by | closes: — · closed by: — |
| Relations | `SIGNAL_REBRANDING` leads over it (when the brand is what changed); with `SIGNAL_CAMPAIGN_PLANNED` both when the launch campaign is named |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual: none |

**Определение:** Компания выводит на рынок новый продукт, услугу, линейку, обновлённую версию или переиздание того, что она ПРОДАЁТ. Для HoReCa — новое меню, новая винная карта или новый формат заведения как продукт для гостей.

**Граница (не считается):** Компания покупает что-то для своей работы (оборудование, транспорт, ИТ) → `SIGNAL_OPERATIONS_INVESTMENT`. Спецификация, паспорт продукта, сертификат, прайс или каталог, присланные с заказом или запросом, — нет сигнала. Новая позиция в НАШЕМ каталоге → `INTERNAL_PRODUCT_STATUS_UPDATE`. Новая позиция у поставщика, который предлагает её нам → `SUPPLIER_PRICE_CHANGE` или нет сигнала. Клиент обновляет винную карту и рассматривает наши позиции → `LISTING_OPPORTUNITY` (distribution).

**Признаки для промпта (≤ 8):** «запускает новую линейку», «представила новый продукт», «вывела на рынок», «новинка», «обновлённое меню», «новый формат», «перезапуск», «расширение ассортимента»

**Синонимы и выражения (полный список):**
- Деловая переписка: «в декабре запускаем новое сезонное меню», «открываем направление кейтеринга для корпоративных клиентов», «выводим собственную марку игристого», «перезапускаем бренд кофеен в новом формате»
- Новости: «компания представила новую линейку», «бренд выпустил лимитированную серию», «сеть запустила собственную торговую марку», «ресторан обновил меню», «компания вывела на рынок новинку», «стартовали продажи новой модели», «расширила ассортимент»
- Чаты / мессенджеры (разговорный стиль): «у них новинка вышла», «запускают СТМ», «меню полностью переделали», «новую линейку выкатили»
- Сокращения и термины: «СТМ» (собственная торговая марка), «линейка», «лимитка», «релонч», «новинка», «сезонное меню»
- Устойчивые конструкции / маркеры: «[компания] запускает / представила [продукт]», «в продаже появится [продукт] с [даты]», «расширяет линейку [чем]»

**Похоже, но не это (анти-признаки):** «закупили новые кофемашины» → `SIGNAL_OPERATIONS_INVESTMENT`; «во вложении спецификация и сертификат» → нет сигнала; «обновляем винную карту, пришлите предложения» → `LISTING_OPPORTUNITY`; «сменили логотип и название» → `SIGNAL_REBRANDING`

**Пример (evidence):** «Сеть «Винотека 24» с 1 декабря запускает собственную марку игристого вина в 40 магазинах.»
**Контрпример:** «Направляем паспорт качества и декларацию соответствия к поставке» → документы к существующему товару, не новинка.

**Заметка для карточки:** Назовите продукт и дату запуска; шаг — связаться с контактом клиента по роли и узнать, что нужно к запуску (ассортимент, объёмы, сроки), и только потом предлагать.

### `SIGNAL_EXPANSION` — Расширение бизнеса или новая площадка

| Field | Value |
|---|---|
| Pack · block · family | base · H · market |
| Weight · class · kind · score rule | 4 · chance · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · review |
| Display profile | from weight (D4) |
| Recipient role | relationship |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — (place check: only regions of the org profile) |
| Relevance window | default |
| Deal effect | per org rule; usual: none (the distribution code `NEW_VENUE_OPENING` is the deal entry when the client confirms it) |

**Определение:** Компания открывает новую точку, ресторан, магазин, филиал, склад для клиентов или выходит на новый рынок в регионах из профиля организации, либо набирает персонал под новую площадку. Источник — новости, реестры или упоминание третьей стороной.

**Граница (не считается):** Клиент сам пишет нам, что открывает новую точку → `NEW_VENUE_OPENING` (distribution); этот код тогда не ставится. Расширение за рубежом или вне регионов профиля — нет сигнала. Общие слова о росте без названной площадки («планируем расти») → `SIGNAL_STRATEGY_CONTEXT`. Новый склад или цех только для своей работы → `SIGNAL_OPERATIONS_INVESTMENT`. Слияние или покупка сети → `SIGNAL_MERGER`.

**Признаки для промпта (≤ 8):** «открытие нового ресторана», «открывает магазин», «новая точка», «новый филиал», «выходит в регион», «открылся по адресу», «расширяет сеть», «набирает персонал в новый»

**Синонимы и выражения (полный список):**
- Новости: «ресторанная группа откроет пять заведений в 2027 году», «сеть вышла в Санкт-Петербург», «в ТЦ открылся новый магазин сети», «на Патриарших открылся винный бар», «компания открыла филиал в Казани», «сеть расширилась до 30 магазинов», «открытие запланировано на март»
- Деловая переписка от третьих лиц: «слышали, что «Северный ветер» открывает второй ресторан на Белорусской», «у «Винотеки 24» новый магазин в Химках»
- Чаты / мессенджеры (разговорный стиль): «они ещё точку открывают», «новый бар у них на Покровке», «заходят в Питер», «набирают команду на открытие»
- Сокращения и термины: «новая ТТ» (торговая точка), «открытие», «софт-опенинг», «гранд-опенинг», «франшиза», «выход в регион»
- Устойчивые конструкции / маркеры: «[компания] открывает / откроет [точку] в [месте]», «выходит на рынок [региона]», «расширяет сеть до [N]»

**Похоже, но не это (анти-признаки):** «мы открываем второй ресторан, нужна поставка» (пишет сам клиент) → `NEW_VENUE_OPENING`; «открываем магазины в Казахстане» → нет сигнала (вне регионов); «хотим расти в следующем году» → `SIGNAL_STRATEGY_CONTEXT`; «построили новый распределительный центр» → `SIGNAL_OPERATIONS_INVESTMENT`

**Пример (evidence):** «Ресторанная группа «Северный ветер» в феврале откроет винный бар на Патриарших прудах.»
**Контрпример:** «Ресторанная группа «Северный ветер» открывает ресторан в Дубае» → площадка вне регионов профиля, сигнала нет.

**Заметка для карточки:** Назовите площадку и дату открытия; шаг — узнать у закупщика или управляющего клиента, кто формирует винную карту новой точки и когда, и предложить подборку после этого.

### `SIGNAL_FUNDING` — Компания привлекла финансирование

| Field | Value |
|---|---|
| Pack · block · family | base · H · market |
| Weight · class · kind · score rule | 4 · chance · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · off |
| Display profile | from weight (D4) |
| Recipient role | relationship |
| Closes / closed by | closes: — · closed by: — |
| Relations | `SIGNAL_MERGER` leads over it (when control changes) |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual: none |

**Определение:** Компания получает инвестиции, новый раунд, кредитную линию на развитие или нового миноритарного инвестора без смены контроля.

**Граница (не считается):** Переход контроля (больше 50 %, покупка) → `SIGNAL_MERGER`. Размещение акций на бирже → `SIGNAL_IPO`. Реструктуризация долга в кризисе → `SIGNAL_INSOLVENCY`. Господдержка или кредит на оборудование для своей работы → `SIGNAL_OPERATIONS_INVESTMENT`.

**Признаки для промпта (≤ 8):** «привлекла инвестиции», «раунд финансирования», «инвестор получил долю», «вложил в компанию», «закрыла раунд», «получила кредитную линию на развитие», «миноритарная доля», «выпустила облигации»

**Синонимы и выражения (полный список):**
- Новости: «сеть привлекла 300 млн ₽ на развитие», «фонд вошёл в капитал компании с долей 20 %», «стартап закрыл раунд A», «банк открыл кредитную линию на открытие новых точек», «компания разместила облигации на 1 млрд ₽»
- Деловая переписка: «у нас вошёл новый инвестор, планируем расширяться», «получили финансирование на развитие сети»
- Чаты / мессенджеры (разговорный стиль): «им денег дали», «зашёл инвестор», «подняли раунд»
- Сокращения и термины: «раунд», «pre-seed», «seed», «раунд A», «миноритарий», «облигации», «ВДО», «кредитная линия»
- Устойчивые конструкции / маркеры: «[компания] привлекла [сумму] от [инвестора]», «[инвестор] получил [долю N %]», «закрыла раунд [название]»

**Похоже, но не это (анти-признаки):** «холдинг купил 100 % сети» → `SIGNAL_MERGER`; «компания провела IPO» → `SIGNAL_IPO`; «банк согласовал реструктуризацию долга» → `SIGNAL_INSOLVENCY`; «взяли лизинг на автопарк» → `SIGNAL_OPERATIONS_INVESTMENT`

**Пример (evidence):** «Сеть винных баров «Винотека 24» привлекла 250 млн ₽ от частного фонда за 25 % на открытие новых заведений.»
**Контрпример:** «Холдинг «Гастроном Плюс» выкупил 75 % «Винотеки 24»» → смена контроля, это `SIGNAL_MERGER`.

**Заметка для карточки:** Не предполагайте, что деньги пойдут на закупки у нас; шаг — узнать у контакта клиента, какие планы стоят за финансированием, пока они не распределены.

### `SIGNAL_C_LEVEL_CHANGE` — Смена высшего руководства

| Field | Value |
|---|---|
| Pack · block · family | base · H · market |
| Weight · class · kind · score rule | 4 · fyi (class by relation: yes — top client: risk) · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · off |
| Display profile | from weight (D4) |
| Recipient role | relationship |
| Closes / closed by | closes: — · closed by: — |
| Relations | `SIGNAL_NEW_MARKETING_LEAD` leads over it (for a marketing-head change) |
| Date gate | — (prompt rule: the change took effect no more than 6 months before the item date) |
| Relevance window | default |
| Deal effect | per org rule; usual: none |

**Определение:** Меняется руководство вне маркетинга: генеральный директор, финансовый, операционный, коммерческий, технический директор, директор по персоналу, руководитель продаж, управляющий направлением (например, ресторанным), члены совета директоров или правления.

**Граница (не считается):** Новый руководитель маркетинга, бренда, коммуникаций → `SIGNAL_NEW_MARKETING_LEAD`. Новый закупщик или сомелье, который пишет нам сам → `CONTACT_NEW_DECISION_MAKER`. Смена произошла больше 6 месяцев назад — нет сигнала. Смена директора у нашего поставщика → `PARTNER_PERSONNEL` или нет сигнала; у конкурента → `COMPETITOR_PERSONNEL`.

**Признаки для промпта (≤ 8):** «назначен генеральным директором», «новый генеральный директор», «покинул пост», «сменился руководитель», «назначен финансовым директором», «возглавил компанию», «новый состав совета директоров», «управляющим партнёром стал»

**Синонимы и выражения (полный список):**
- Новости и реестры: «генеральным директором компании назначен», «в ЕГРЮЛ внесены сведения о новом руководителе», «покинул пост генерального директора», «новым коммерческим директором стал», «совет директоров избрал председателем», «операционным директором ресторанной группы назначен»
- Деловая переписка: «сообщаем о смене генерального директора, документы во вложении», «с 01.12 договоры подписывает новый генеральный директор», «доверенность выдана новым руководителем»
- Чаты / мессенджеры (разговорный стиль): «у них гендир поменялся», «новый коммерческий пришёл», «финдиректора сменили, теперь всё через него»
- Сокращения и термины: «гендир», «ГД», «CEO», «CFO», «COO», «коммерческий директор», «совет директоров», «ЕГРЮЛ»
- Устойчивые конструкции / маркеры: «[ФИО] назначен(а) [должность]», «[ФИО] покинул(а) пост [должность]», «смена [генерального директора] в [компании]»

**Похоже, но не это (анти-признаки):** «новый директор по маркетингу» → `SIGNAL_NEW_MARKETING_LEAD`; «я новый закупщик» → `CONTACT_NEW_DECISION_MAKER`; «генеральный директор с 2022 года» → нет сигнала; «у «Винного Альянса» новый гендир» → `COMPETITOR_PERSONNEL`

**Пример (evidence):** «Генеральным директором ООО «Северный ветер» с 15 октября назначен Петров П. П., сведения внесены в ЕГРЮЛ.»
**Контрпример:** «Генеральный директор «Северного ветра» Петров П. П., который руководит компанией с 2021 года, дал интервью» → старое назначение, сигнала нет.

**Заметка для карточки:** Информационная карточка: заголовок — только факт («клиент — новый генеральный директор»), без контакта с новым человеком; шаг — держать к следующему разговору и тогда спросить, меняет ли это наше сотрудничество.

### `SIGNAL_REBRANDING` — Ребрендинг или смена названия

| Field | Value |
|---|---|
| Pack · block · family | base · H · market |
| Weight · class · kind · score rule | 4 · chance · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · off |
| Display profile | from weight (D4) |
| Recipient role | relationship |
| Closes / closed by | closes: — · closed by: — |
| Relations | leads over `SIGNAL_PRODUCT_NEWS` (when the brand is what changed) |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual: none |

**Определение:** Компания меняет название, логотип, фирменный стиль или концепцию бренда, либо запускает новый или полностью обновлённый сайт (в том числе переезд на новую платформу), о чём ей нужно сообщить клиентам.

**Граница (не считается):** Смена юрлица или реквизитов без нового бренда (новый ИНН, новый банк) — нет сигнала, это работа бухгалтерии. Новый продукт под тем же брендом → `SIGNAL_PRODUCT_NEWS`. Смена названия после покупки другой компанией → `SIGNAL_MERGER` (ребрендинг — контекст). Мелкая правка сайта или новый раздел — нет сигнала.

**Признаки для промпта (≤ 8):** «ребрендинг», «новое название», «новый логотип», «обновлённый фирменный стиль», «сменила вывеску», «запустила новый сайт», «перезапуск бренда», «теперь называется»

**Синонимы и выражения (полный список):**
- Деловая переписка: «сообщаем, что с 01.12 ресторан работает под новым названием», «прошу обновить наименование в документах и в карточке клиента», «у нас обновился логотип, пришлём новые макеты для меню», «мы запустили новый сайт с онлайн-бронированием»
- Новости: «сеть провела ребрендинг», «бренд представил новый логотип», «компания сменила название на», «заведение откроется после ребрендинга под новой вывеской», «обновили айдентику», «перезапустили сайт на новой платформе»
- Чаты / мессенджеры (разговорный стиль): «они переименовались», «новую вывеску повесили», «логотип поменяли», «сайт переделали»
- Сокращения и термины: «ребрендинг», «рестайлинг», «айдентика», «фирменный стиль», «брендбук», «новый сайт», «редизайн»
- Устойчивые конструкции / маркеры: «[компания] теперь называется [название]», «[бренд] представил новый [логотип / стиль]», «работает под новым названием с [даты]»

**Похоже, но не это (анти-признаки):** «поменялись реквизиты, новый расчётный счёт» → нет сигнала; «выпустили новую линейку» → `SIGNAL_PRODUCT_NEWS`; «после покупки сеть будет работать под брендом покупателя» → `SIGNAL_MERGER`; «добавили на сайт раздел с вакансиями» → нет сигнала

**Пример (evidence):** «С 1 декабря винный бар «Винотека 24» на Арбате будет работать под новым названием «Терруар» и с новой концепцией.»
**Контрпример:** «Просим учесть новые банковские реквизиты ООО «Винотека 24» в счетах» → смена реквизитов, не ребрендинг.

**Заметка для карточки:** Назовите конкретное изменение (название, логотип, сайт); шаг — до запуска узнать у контакта клиента, что меняется в концепции и меню, и обновить карточку клиента.

### `SIGNAL_STRATEGY_ANNOUNCEMENT` — Объявлена новая стратегия

| Field | Value |
|---|---|
| Pack · block · family | base · H · market |
| Weight · class · kind · score rule | 4 · chance (class by relation: yes — active client with a budget cut or partner review: risk) · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · off |
| Display profile | from weight (D4) |
| Recipient role | relationship |
| Closes / closed by | closes: — · closed by: — |
| Relations | catch-all: fires only when no more specific H code applies |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual: none |

**Определение:** Компания объявляет стратегическое решение с названным последствием для маркетинга, коммуникаций, рекламы или бюджета (для дистрибьютора — для закупок и ассортимента): новая стратегия бренда, перепозиционирование, рост или сокращение маркетингового бюджета, пересмотр всех поставщиков. Конкретного действия ещё нет.

**Граница (не считается):** Заявление о стратегии без названного последствия (производство, структура, интервью о рынке) → `SIGNAL_STRATEGY_CONTEXT`. Перенос бюджета между каналами при той же сумме → `SIGNAL_CHANNEL_SHIFT`. Клиент сокращает бюджет у нас → `SALES_BUDGET_CUT`. Конкретное событие, для которого есть свой H-код (новая точка, новый продукт, ребрендинг), → этот код.

**Признаки для промпта (≤ 8):** «новая стратегия бренда», «перепозиционирование», «увеличивает маркетинговый бюджет», «сокращает рекламный бюджет», «пересматривает пул поставщиков», «делает ставку на премиальный сегмент», «меняет ассортиментную политику», «стратегия до 2030 года»

**Синонимы и выражения (полный список):**
- Новости: «компания утвердила новую стратегию развития бренда», «сеть объявила о перепозиционировании в премиум», «маркетинговый бюджет вырастет на 30 %», «ретейлер пересмотрит ассортиментную матрицу», «сеть объявила о сокращении числа поставщиков», «компания делает ставку на собственные торговые марки»
- Деловая переписка: «в следующем году мы меняем ассортиментную политику», «будем пересматривать всех поставщиков в категории вина», «руководство решило уйти в премиальный сегмент»
- Чаты / мессенджеры (разговорный стиль): «они уходят в премиум», «будут чистить поставщиков», «режут маркетинг», «новая стратегия, всё переигрывают»
- Сокращения и термины: «стратегия», «перепозиционирование», «ассортиментная матрица», «пул поставщиков», «СТМ», «маркетинговый бюджет»
- Устойчивые конструкции / маркеры: «[компания] объявила / утвердила [стратегию]», «делает ставку на [что]», «пересматривает [бюджет / поставщиков / матрицу]»

**Похоже, но не это (анти-признаки):** «гендиректор рассказал о планах развития производства» → `SIGNAL_STRATEGY_CONTEXT`; «переносим бюджет из ТВ в digital» → `SIGNAL_CHANNEL_SHIFT`; «на следующий год сокращаем закупки у вас на треть» → `SALES_BUDGET_CUT`; «открываем пять новых магазинов» → `SIGNAL_EXPANSION`

**Пример (evidence):** «Сеть «Гастроном Плюс» объявила новую стратегию: доля премиальных вин в ассортименте вырастет до 40 %, поставщиков в категории станет меньше.»
**Контрпример:** «Генеральный директор «Гастроном Плюс» в интервью рассказал о логистике и планах по складам» → без последствия для ассортимента или маркетинга, это `SIGNAL_STRATEGY_CONTEXT`.

**Заметка для карточки:** Назовите последствие, которое указано в материале; если план открывается (новая стратегия, рост бюджета) — шанс войти в него рано; если у активного клиента сокращение или пересмотр поставщиков — риск, закрепить нашу долю до решения.

### `SIGNAL_CHANNEL_SHIFT` — Перераспределение бюджета между каналами

| Field | Value |
|---|---|
| Pack · block · family | base · H · market |
| Weight · class · kind · score rule | 4 · chance (class by relation: yes — active client moving away from our channel: risk) · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · off |
| Display profile | from weight (D4) |
| Recipient role | relationship |
| Closes / closed by | closes: — · closed by: — |
| Relations | leads over `SIGNAL_SPEND_DOWN` (when the total stays the same) |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual: none |

**Определение:** Компания переносит бюджет между каналами рекламы, маркетинга или сбыта при примерно той же общей сумме: из печати в digital, из ТВ в соцсети; для дистрибьютора — из офлайн-розницы в онлайн-продажи или из сети магазинов в HoReCa.

**Граница (не считается):** Общий бюджет растёт или падает → `SIGNAL_STRATEGY_ANNOUNCEMENT` или `SIGNAL_SPEND_UP` / `SIGNAL_SPEND_DOWN`. Клиент сокращает закупки у нас → `SALES_BUDGET_CUT`. Запуск одной кампании в новом канале → `SIGNAL_CAMPAIGN_PLANNED`.

**Признаки для промпта (≤ 8):** «перераспределяет бюджет», «уходит из ТВ в digital», «переносит бюджет в онлайн», «сокращает наружку в пользу», «основной канал теперь», «делаем упор на маркетплейсы», «смещает акцент на», «из офлайна в онлайн»

**Синонимы и выражения (полный список):**
- Новости: «бренд переносит половину бюджета из ТВ в digital», «ретейлер переориентирует продажи на онлайн-канал», «компания отказывается от печатной рекламы в пользу соцсетей», «доля e-commerce в продажах сети выросла, офлайн-точки сокращают»
- Деловая переписка: «в следующем году часть бюджета переводим в Telegram и блогеров», «основной упор будет на доставку, а не на зал»
- Чаты / мессенджеры (разговорный стиль): «они всё в онлайн уводят», «ТВ режут, идут в блогеров», «теперь всё через маркетплейсы»
- Сокращения и термины: «медиамикс», «digital», «ТВ», «наружка», «OOH», «маркетплейсы», «e-com», «офлайн»
- Устойчивые конструкции / маркеры: «переносит бюджет из [канала] в [канал]», «отказывается от [канала] в пользу [канала]», «упор на [канал]»

**Похоже, но не это (анти-признаки):** «маркетинговый бюджет вырастет на 30 %» → `SIGNAL_STRATEGY_ANNOUNCEMENT`; «закупки у вас сократим» → `SALES_BUDGET_CUT`; «в марте запускаем кампанию у блогеров» → `SIGNAL_CAMPAIGN_PLANNED`

**Пример (evidence):** «В 2027 году «Винотека 24» переносит треть рекламного бюджета из наружной рекламы в Telegram-каналы и блогеров при прежнем общем объёме.»
**Контрпример:** «В 2027 году «Винотека 24» удвоит рекламный бюджет» → меняется общая сумма, это `SIGNAL_STRATEGY_ANNOUNCEMENT`.

**Заметка для карточки:** Скажите, куда уходит бюджет; если в наш канал — шанс узнать новый микс; если у активного клиента из нашего канала — риск, поговорить до утверждения следующего плана.

### `SIGNAL_PRODUCT_DISCONTINUED` — Продукт снят с рынка

| Field | Value |
|---|---|
| Pack · block · family | base · H · market |
| Weight · class · kind · score rule | 4 · risk · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both; in the `press` profile only when the company is our client |
| Stage (pack default) · IN4COM | active · off |
| Display profile | from weight (D4) |
| Recipient role | relationship |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual: none |

**Определение:** Клиент снимает свой продукт, услугу, формат или бренд с рынка; бюджет и закупки под него исчезают.

**Граница (не считается):** Клиент убирает НАШИ позиции из меню или ассортимента → `DELISTING_RISK` (distribution). Мы выводим свою позицию → `INTERNAL_PRODUCT_STATUS_UPDATE`. Поставщик прекращает выпуск товара, который мы закупаем → `SUPPLIER_DELIVERY_DELAY` («больше не производится»). Отзыв партии по решению надзора → `SIGNAL_NEGATIVE_PRESS`. Закрытие точки → `SIGNAL_DOWNSIZING`.

**Признаки для промпта (≤ 8):** «снимает с производства», «прекращает выпуск», «выводит из линейки», «закрывает направление», «больше не будет продавать», «уходит из категории», «последняя партия», «закрывает формат»

**Синонимы и выражения (полный список):**
- Новости: «компания прекращает выпуск бренда», «сеть закрывает направление кулинарии», «бренд уходит из категории игристых», «ретейлер выводит из продажи линейку СТМ», «ресторанная группа отказывается от формата фудкортов»
- Деловая переписка: «мы закрываем направление кейтеринга с января», «линейку баров при отелях сворачиваем», «формат доставки прекращаем»
- Чаты / мессенджеры (разговорный стиль): «они эту линейку закрыли», «кейтеринг больше не делают», «бренд свернули»
- Сокращения и термины: «вывод из линейки», «снятие с производства», «делистинг», «закрытие направления», «СТМ»
- Устойчивые конструкции / маркеры: «[компания] прекращает [выпуск / продажу] [продукта]», «закрывает направление [что]», «уходит из [категории]»

**Похоже, но не это (анти-признаки):** «убираем ваше вино из карты» → `DELISTING_RISK`; «производитель больше не выпускает этот кюве» → `SUPPLIER_DELIVERY_DELAY`; «партию отозвали по предписанию» → `SIGNAL_NEGATIVE_PRESS`; «закрываем ресторан» → `SIGNAL_DOWNSIZING`

**Пример (evidence):** «Ресторанная группа «Северный ветер» с 1 января закрывает направление выездного кейтеринга.»
**Контрпример:** «Мы больше не берём у вас Шабли, выводим из карты» → это наши позиции у клиента, `DELISTING_RISK`.

**Заметка для карточки:** Назовите, что снимается и с какой даты; шаг — оценить, какие наши поставки шли под это направление, и обсудить с закупщиком, что остаётся.

### `SIGNAL_NEW_COMPANY` — Создана новая компания

| Field | Value |
|---|---|
| Pack · block · family | base · H · market |
| Weight · class · kind · score rule | 3 · chance · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · review |
| Display profile | from weight (W1) |
| Recipient role | relationship (a prospect; agency pack may route to new_biz) |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual: none (a prospect, not a deal) |

**Определение:** Зарегистрирована новая компания или открыт новый бизнес, у которого ещё нет партнёров. Для дистрибьютора важны новые рестораны, бары, винотеки, магазины, кейтеринговые компании, получившие или подающие заявку на алкогольную лицензию.

**Граница (не считается):** Новая точка действующей компании → `SIGNAL_EXPANSION`. Новое юрлицо после реорганизации или покупки → `SIGNAL_MERGER`. Регистрация товарного знака или домена без компании → `SIGNAL_TRADEMARK`. Новое юрлицо нашего же клиента для расчётов (смена ИНН) — нет сигнала.

**Признаки для промпта (≤ 8):** «зарегистрирована новая компания», «открылся новый ресторан», «новый проект ресторатора», «получила лицензию на розничную продажу алкоголя», «создано ООО», «стартап», «новое заведение от команды», «запуск нового бизнеса»

**Синонимы и выражения (полный список):**
- Новости и реестры: «в ЕГРЮЛ зарегистрировано ООО с видом деятельности «деятельность ресторанов»», «ресторатор открывает новый проект», «команда бара запускает собственное заведение», «выдана лицензия на розничную продажу алкогольной продукции при оказании услуг общепита», «на рынок вышел новый игрок»
- Деловая переписка: «мы новая компания, открываемся в марте, ищем поставщика вина», «знакомые открывают винный бар, им нужен поставщик»
- Чаты / мессенджеры (разговорный стиль): «ребята новый бар открывают», «у шефа свой проект стартует», «новая контора, только зарегались»
- Сокращения и термины: «ЕГРЮЛ», «ОКВЭД 56.10», «лицензия РАР», «ФСРАР», «новое ООО», «ИП»
- Устойчивые конструкции / маркеры: «зарегистрировано [ООО] с [видом деятельности]», «[команда / ресторатор] открывает новый проект [название]», «получена лицензия [на продажу алкоголя]»

**Похоже, но не это (анти-признаки):** «сеть открыла шестой магазин» → `SIGNAL_EXPANSION`; «после присоединения создано новое юрлицо» → `SIGNAL_MERGER`; «зарегистрировали товарный знак» → `SIGNAL_TRADEMARK`; «у нас новое ООО для расчётов, вот реквизиты» → нет сигнала

**Пример (evidence):** «Шеф-повар ресторана «Северный ветер» открывает собственный винный бар «Лоза» на Малой Бронной, запуск в марте.»
**Контрпример:** «Сеть «Винотека 24» открыла новый магазин в Химках» → это новая точка действующей сети, `SIGNAL_EXPANSION`.

**Заметка для карточки:** Это всегда потенциальный клиент: шаг — первый контакт с владельцем или управляющим до выбора поставщиков, чтобы стать первым партнёром.

### `SIGNAL_TRADEMARK` — Зарегистрирован бренд или домен

| Field | Value |
|---|---|
| Pack · block · family | base · H · market |
| Weight · class · kind · score rule | 3 · chance · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · off |
| Display profile | from weight (W1) |
| Recipient role | relationship |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual: none |

**Определение:** Компания регистрирует или подаёт заявку на товарный знак или новый домен. Это ранний признак нового бренда до запуска.

**Граница (не считается):** Бренд уже запущен на рынке → `SIGNAL_PRODUCT_NEWS` или `SIGNAL_REBRANDING`. Новая компания → `SIGNAL_NEW_COMPANY`. Продление существующего знака или домена — нет сигнала. Спор о товарном знаке → `SIGNAL_NEGATIVE_PRESS` или нет сигнала.

**Признаки для промпта (≤ 8):** «подала заявку на товарный знак», «зарегистрировала товарный знак», «Роспатент зарегистрировал», «новый домен», «заявка на регистрацию бренда», «зарегистрировала знак обслуживания», «права на название», «свидетельство на товарный знак»

**Синонимы и выражения (полный список):**
- Новости и реестры: «компания подала в Роспатент заявку на товарный знак», «Роспатент зарегистрировал товарный знак», «ресторатор зарегистрировал бренд для нового проекта», «зарегистрирован домен под новый проект», «знак обслуживания по 43-му классу МКТУ»
- Деловая переписка: «мы зарегистрировали название нового бара, скоро анонс», «под новую марку уже купили домен»
- Чаты / мессенджеры (разговорный стиль): «они бренд зарегали», «знак подали, видимо, новый проект», «домен уже купили»
- Сокращения и термины: «Роспатент», «ФИПС», «МКТУ», «товарный знак», «ТЗ», «знак обслуживания», «домен .ru / .рф»
- Устойчивые конструкции / маркеры: «[компания] подала заявку на [товарный знак]», «зарегистрирован [знак / домен] [название]»

**Похоже, но не это (анти-признаки):** «новый бренд уже в продаже» → `SIGNAL_PRODUCT_NEWS`; «продлили регистрацию знака» → нет сигнала; «суд запретил использовать название» → `SIGNAL_NEGATIVE_PRESS`

**Пример (evidence):** «ООО «Северный ветер» подало в Роспатент заявку на товарный знак «Лоза» по 33-му и 43-му классам МКТУ.»
**Контрпример:** «Свидетельство на товарный знак «Северный ветер» продлено ещё на 10 лет» → продление, нового бренда нет.

**Заметка для карточки:** Обычно это новый бренд до запуска: шаг — первый контакт, чтобы стать первым поставщиком нового проекта.

### `SIGNAL_JOB_POSTING` — Открыта релевантная вакансия

| Field | Value |
|---|---|
| Pack · block · family | base · H · market |
| Weight · class · kind · score rule | 3 · chance (class by relation: yes — our client after the previous person left: risk) · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · off |
| Display profile | from weight (W1) |
| Recipient role | relationship |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual: none |

**Определение:** Компания ищет человека на роль, важную для нас: маркетинг, бренд, закупки, категорийный менеджмент; для дистрибьютора — закупщик, сомелье, бар-менеджер, категорийный менеджер по алкоголю.

**Граница (не считается):** Вакансии без связи с нашей областью (повар, курьер, бухгалтер) — нет сигнала. Набор команды под открытие новой точки → `SIGNAL_EXPANSION`. Человек уже назначен → `SIGNAL_NEW_MARKETING_LEAD` / `SIGNAL_C_LEVEL_CHANGE` / `CONTACT_NEW_DECISION_MAKER`. Вакансия у нас самих — нет сигнала.

**Признаки для промпта (≤ 8):** «ищем сомелье», «вакансия закупщика», «требуется бренд-менеджер», «открыта вакансия категорийного менеджера», «ищем бар-менеджера», «в команду маркетинга требуется», «вакансия на hh.ru», «нанимаем руководителя закупок»

**Синонимы и выражения (полный список):**
- Новости и объявления: «сеть ищет категорийного менеджера по вину и крепкому алкоголю», «ресторанная группа открыла вакансию шеф-сомелье», «требуется менеджер по закупкам алкогольной продукции», «в отдел маркетинга требуется бренд-менеджер»
- Деловая переписка: «наш закупщик ушёл, сейчас ищем нового», «пока ищем сомелье, заказы делает управляющий»
- Чаты / мессенджеры (разговорный стиль): «они сомелье ищут», «вакансия висит на хэдхантере», «закупщика нет, ищут»
- Сокращения и термины: «hh.ru», «вакансия», «КМ» (категорийный менеджер), «бар-менеджер», «шеф-сомелье», «байер»
- Устойчивые конструкции / маркеры: «ищем / требуется [роль]», «открыта вакансия [роль]», «в команду [отдела] нужен [роль]»

**Похоже, но не это (анти-признаки):** «ищем поваров и официантов» → нет сигнала; «набираем команду на открытие нового ресторана» → `SIGNAL_EXPANSION`; «я новый сомелье, давайте знакомиться» → `CONTACT_NEW_DECISION_MAKER`; «я ухожу из компании» → `CONTACT_LEAVING`

**Пример (evidence):** «Ресторанная группа «Северный ветер» ищет шеф-сомелье с опытом формирования винных карт для четырёх ресторанов.»
**Контрпример:** «Ресторанная группа «Северный ветер» набирает официантов и барменов на сезон» → роли вне нашей области.

**Заметка для карточки:** У нашего клиента — узнать, кто сейчас решает о закупках и что меняется (если прежний человек ушёл — риск); у неклиента — шанс выйти на нового человека первым.

### `SIGNAL_EVENT` — Компания участвовала в отраслевом событии

| Field | Value |
|---|---|
| Pack · block · family | base · H · market |
| Weight · class · kind · score rule | 3 · fyi · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · off |
| Display profile | from weight (W1) |
| Recipient role | relationship |
| Closes / closed by | closes: — · closed by: — |
| Relations | split by date with `SIGNAL_EVENT_UPCOMING` |
| Date gate | — (prompt rule: the event is over or has no date relative to the item date; an event after the item date is `SIGNAL_EVENT_UPCOMING`) |
| Relevance window | default |
| Deal effect | per org rule; usual: none |

**Определение:** Компания участвовала в выставке, конференции, фестивале или отраслевом событии как участник, спикер или партнёр, и событие уже прошло (или дата не указана).

**Граница (не считается):** Событие ещё впереди → `SIGNAL_EVENT_UPCOMING`. Компания выступает спонсором → `SIGNAL_SPONSORING`. Наше собственное участие — нет сигнала. Дегустация или встреча у клиента с нами → блок F или distribution `TASTING_REQUESTED`.

**Признаки для промпта (≤ 8):** «представила на выставке», «приняла участие в», «выступил на конференции», «стенд компании на», «по итогам выставки», «участвовала в фестивале», «показали на форуме», «вернулись с выставки»

**Синонимы и выражения (полный список):**
- Новости: «компания представила новинки на выставке», «ресторанная группа приняла участие в гастрономическом фестивале», «генеральный директор выступил на отраслевом форуме», «по итогам выставки сеть подписала соглашения», «бар вошёл в число участников фестиваля»
- Деловая переписка: «мы только вернулись с выставки, было много контактов», «на прошлой неделе были на форуме ретейла»
- Чаты / мессенджеры (разговорный стиль): «они на выставке стояли», «видел их на фестивале», «были на форуме, выступали»
- Сокращения и термины: «выставка», «стенд», «форум», «фестиваль», «конференция», «спикер», «экспонент»
- Устойчивые конструкции / маркеры: «[компания] представила [что] на [событии]», «приняла участие в [событии]», «по итогам [события]»

**Похоже, но не это (анти-признаки):** «в феврале будем на выставке, приходите» → `SIGNAL_EVENT_UPCOMING`; «выступили генеральным спонсором фестиваля» → `SIGNAL_SPONSORING`; «мы (наша компания) провели дегустацию» → нет сигнала

**Пример (evidence):** «Сеть «Винотека 24» представила на прошедшей выставке свою новую марку игристого и подписала два соглашения с поставщиками.»
**Контрпример:** «Сеть «Винотека 24» примет участие в выставке в феврале 2027 года» → событие впереди, это `SIGNAL_EVENT_UPCOMING`.

**Заметка для карточки:** Информационная карточка: скажите, что компания показала или объявила на событии; шаг — держать к следующему разговору, без контакта и предложения.

### `SIGNAL_IPO` — Выход компании на биржу

| Field | Value |
|---|---|
| Pack · block · family | base · H · market |
| Weight · class · kind · score rule | 3 · chance · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · off |
| Display profile | from weight (W1) |
| Recipient role | relationship |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual: none |

**Определение:** Компания проводит или объявляет первичное публичное размещение акций (IPO) или прямой листинг на бирже.

**Граница (не считается):** Частный раунд, облигации, кредит → `SIGNAL_FUNDING`. Смена контроля → `SIGNAL_MERGER`. Публикация отчётности публичной компании → `SIGNAL_RESULTS_POSITIVE` / `SIGNAL_RESULTS_NEGATIVE`.

**Признаки для промпта (≤ 8):** «IPO», «первичное размещение акций», «выходит на биржу», «объявила о намерении провести IPO», «начало торгов акциями», «прямой листинг», «Мосбиржа», «SPO»

**Синонимы и выражения (полный список):**
- Новости: «компания объявила о намерении провести IPO на Московской бирже», «акции сети начали торговаться на бирже», «книга заявок закрыта», «ретейлер разместил акции», «компания провела SPO»
- Чаты / мессенджеры (разговорный стиль): «они на биржу выходят», «айпио у них», «акции разместили»
- Сокращения и термины: «IPO», «SPO», «Мосбиржа», «СПБ Биржа», «free float», «книга заявок», «листинг»
- Устойчивые конструкции / маркеры: «[компания] объявила о [IPO]», «акции [компании] начали торговаться», «разместила [N %] акций»

**Похоже, но не это (анти-признаки):** «выпустила облигации на 1 млрд ₽» → `SIGNAL_FUNDING`; «отчёт за III квартал» → `SIGNAL_RESULTS_*`; «фонд купил 60 % компании» → `SIGNAL_MERGER`

**Пример (evidence):** «Холдинг «Гастроном Плюс» объявил о намерении провести IPO на Московской бирже в первом квартале 2027 года.»
**Контрпример:** «Холдинг «Гастроном Плюс» разместил облигации на 2 млрд ₽» → долговое финансирование, `SIGNAL_FUNDING`.

**Заметка для карточки:** Информационно с шансом: публичная компания будет больше думать о росте; шаг — держать к разговору и спросить о планах развития сети.

### `SIGNAL_ANNIVERSARY` — Юбилей с коммуникационной активностью

| Field | Value |
|---|---|
| Pack · block · family | base · H · market |
| Weight · class · kind · score rule | 5 · chance · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · off |
| Display profile | from weight (D4) |
| Recipient role | relationship |
| Closes / closed by | closes: — · closed by: — |
| Relations | split with `SIGNAL_ANNIVERSARY_PLAIN` (no communication named) |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual: none |

**Определение:** Компания отмечает юбилей и в материале названа активность вокруг него: кампания, специальные продукты или издания, праздничное событие, акции, реклама. Для HoReCa — юбилейный вечер, праздничное меню, винный ужин.

**Граница (не считается):** Юбилей просто упомянут, активность не названа → `SIGNAL_ANNIVERSARY_PLAIN`. Обычная сезонная акция без юбилея → `SIGNAL_CAMPAIGN_PLANNED` / `SIGNAL_AD_ACTIVITY`. Клиент просит нас провести дегустацию к юбилею → `TASTING_REQUESTED` (distribution).

**Признаки для промпта (≤ 8):** «к юбилею запускает», «юбилейная коллекция», «юбилейное меню», «в честь 10-летия», «праздничный вечер к юбилею», «юбилейная акция», «ограниченная серия к годовщине», «отметит юбилей»

**Синонимы и выражения (полный список):**
- Новости: «в честь 20-летия сеть запускает юбилейную акцию», «к юбилею ресторан подготовил специальное меню и винный ужин», «бренд выпустил юбилейную серию», «компания отметит 25-летие большим фестивалем», «юбилейная кампания стартует в декабре»
- Деловая переписка: «в марте нам 10 лет, планируем вечер для гостей и спецпредложение», «к юбилею хотим сделать винную карту с особыми позициями»
- Чаты / мессенджеры (разговорный стиль): «у них юбилей, будет большая вечеринка», «к десятилетию делают акцию», «юбилейное меню готовят»
- Сокращения и термины: «юбилей», «годовщина», «юбилейная серия», «лимитка», «винный ужин», «гала-вечер»
- Устойчивые конструкции / маркеры: «в честь [N-летия] [компания] [запускает / проводит] [что]», «к юбилею [что]»

**Похоже, но не это (анти-признаки):** «компании исполнилось 30 лет» (без активности) → `SIGNAL_ANNIVERSARY_PLAIN`; «новогодняя акция в магазинах» → `SIGNAL_CAMPAIGN_PLANNED`; «к юбилею просим провести дегустацию для гостей» → `TASTING_REQUESTED`

**Пример (evidence):** «К 15-летию ресторан «Северный ветер» 20 марта проводит гала-ужин и запускает юбилейную винную карту.»
**Контрпример:** «Ресторану «Северный ветер» в марте исполняется 15 лет» → активность не названа, это `SIGNAL_ANNIVERSARY_PLAIN`.

**Заметка для карточки:** Это повод с датой и бюджетом: шаг — заранее узнать у контакта клиента, что планируется (меню, вечер, акция), и потом предложить подборку; без поздравлений как действия.

### `SIGNAL_SPONSORING` — Спонсорский проект

| Field | Value |
|---|---|
| Pack · block · family | base · H · market |
| Weight · class · kind · score rule | 3 · fyi · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · off |
| Display profile | from weight (W1) |
| Recipient role | relationship |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual: none |

**Определение:** Компания выступает спонсором или партнёром мероприятия, команды, фестиваля, премии, благотворительного проекта.

**Граница (не считается):** Просто участие как экспонент или спикер → `SIGNAL_EVENT` / `SIGNAL_EVENT_UPCOMING`. Совместный коммерческий проект с другой компанией → `SIGNAL_PARTNERSHIP`. Клиент просит НАС быть спонсором или дать продукцию на событие → `PROMO_SUPPORT_REQUESTED` (distribution).

**Признаки для промпта (≤ 8):** «генеральный спонсор», «официальный партнёр фестиваля», «выступила спонсором», «при поддержке», «спонсорский контракт», «партнёр турнира», «благотворительный проект», «титульный спонсор»

**Синонимы и выражения (полный список):**
- Новости: «сеть стала генеральным спонсором гастрономического фестиваля», «компания — официальный партнёр городского марафона», «бренд подписал спонсорский контракт с клубом», «ресторан выступил партнёром благотворительного вечера»
- Деловая переписка: «в этом году мы спонсоры фестиваля, будет наш бар на площадке»
- Чаты / мессенджеры (разговорный стиль): «они спонсируют фестиваль», «их бар будет на марафоне как партнёр»
- Сокращения и термины: «спонсор», «генеральный партнёр», «титульный спонсор», «при поддержке», «благотворительность»
- Устойчивые конструкции / маркеры: «[компания] стала [генеральным / официальным] [спонсором / партнёром] [события]», «при поддержке [компании]»

**Похоже, но не это (анти-признаки):** «будем стоять на выставке» → `SIGNAL_EVENT_UPCOMING`; «запустили совместный продукт с пивоварней» → `SIGNAL_PARTNERSHIP`; «поддержите наш фестиваль вином, нужны бутылки» → `PROMO_SUPPORT_REQUESTED`

**Пример (evidence):** «Ресторанная группа «Северный ветер» стала официальным партнёром фестиваля уличной еды в Парке Горького.»
**Контрпример:** «Ресторанная группа «Северный ветер» будет участником фестиваля уличной еды» → участие без спонсорства, `SIGNAL_EVENT_UPCOMING`.

**Заметка для карточки:** Не предполагайте коммуникацию вокруг спонсорства; шаг — спросить контакт клиента, будут ли под проект закупки или бар на площадке, и только тогда предлагать.

### `SIGNAL_CONTACT_QUIET` — Снижается интенсивность общения

| Field | Value |
|---|---|
| Pack · block · family | base · H · account |
| Weight · class · kind · score rule | 3 · fyi · trend · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both (v204); in this design only the process emits it — see Open points |
| Stage (pack default) · IN4COM | parked · off |
| Display profile | from weight (W1); trend ceiling D4 |
| Recipient role | relationship |
| Closes / closed by | closes: — · closed by: — (any qualifying contact restarts the window) |
| Relations | — |
| Date gate | — (trend rule below) |
| Relevance window | trend cooldown 90 days per client + code (`cards.trendCooldownDays`) |
| Deal effect | per org rule; usual: none (agency pack: input to the risk «Клиент затих») |

**Определение:** Общение с клиентом заметно затихает: клиент пишет и отвечает реже, чем обычно, при этом явного отказа или конфликта нет.

**Граница (не считается):** Клиент перестал покупать в своём ритме → `ACCOUNT_DORMANT`. Нет ответа на конкретное наше предложение → `SALES_OFFER_NO_RESPONSE`. Автоответ об отпуске → `CONTACT_OOO`. Праздничный период (январские, майские праздники) и известный отпуск контакта — нет сигнала. Полное отсутствие контакта у бывшего клиента → `ACCOUNT_REACTIVATION_DUE`.

**Признаки для промпта:** — (not in the extraction prompt; emitted by process)

**Правило срабатывания (trigger rule):**
- RU: Данные — входящие сообщения от контактов клиента во всех подключённых каналах (почта, Telegram, WhatsApp), привязанные к клиенту; учитываются только сообщения, прошедшие гейты (без автоответов и рассылок). Окно — последние 30 дней. База — среднее за 30 дней по предыдущим 90 дням. Минимум данных — не меньше 8 входящих сообщений за базовые 90 дней и не меньше 60 дней истории общения. Порог — входящих в окне меньше 40 % от базы, и наших исходящих за окно не меньше 2 (мы пишем, клиент молчит). Исключения — открытый `CONTACT_OOO` контакта, производственный календарь (праздничные недели не входят в окно). Запуск — еженедельно, понедельник. Повтор — не раньше 90 дней на клиента и код. Мало данных — сигнала нет.
- EN: Data — inbound messages from the client's contacts in all connected channels (email, Telegram, WhatsApp) linked to the client; only items that passed the gates (no auto-replies, no newsletters). Window — last 30 days. Baseline — 30-day average over the previous 90 days. Minimum data — at least 8 inbound messages in the 90-day baseline and at least 60 days of history. Threshold — inbound in the window below 40 % of the baseline, and at least 2 outbound messages from us in the window. Exclusions — an open `CONTACT_OOO` of the contact; holiday weeks of the Russian production calendar are not counted. Run — weekly, Monday. Cooldown — 90 days per client + code. Too little data — no instance.

**Пример (evidence):** «За 30 дней от клиента 2 входящих сообщения при обычных 9 в месяц; от нас за это время 5 писем.»
**Контрпример:** «Контакт клиента в отпуске до 20.11, по срочным вопросам — к заместителю» → это `CONTACT_OOO`, затихания нет.

**Заметка для карточки:** Информационно: скажите, с какого времени и насколько упало общение; шаг — короткий личный вопрос контакту клиента по роли, без давления и без предложения.

### `SIGNAL_INDUSTRY_TREND` — Отраслевая тенденция или регулирование

| Field | Value |
|---|---|
| Pack · block · family | base · H · market |
| Weight · class · kind · score rule | 2 · fyi · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · review |
| Display profile | from weight (W1) |
| Recipient role | relationship |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual: none |

**Определение:** Новое регулирование или отраслевое изменение с понятным последствием для клиентов: для алкогольного рынка — изменение акцизов, минимальных розничных цен, пошлин на импорт, правил ЕГАИС и маркировки, лицензирования, ограничений продажи; общее изменение спроса в отрасли.

**Граница (не считается):** Событие одной компании → другой H-код. Конкретная проблема клиента в ЕГАИС или с марками → `EGAIS_ISSUE` / `MARKING_ISSUE` (distribution). Изменение цен нашего поставщика → `SUPPLIER_PRICE_CHANGE`. Общая аналитика без последствия для клиентов — нет сигнала.

**Признаки для промпта (≤ 8):** «с 1 января вырастут акцизы», «минимальная розничная цена», «повышение ввозных пошлин», «изменения в ЕГАИС», «новые требования к маркировке», «закон о продаже алкоголя», «ограничение продажи алкоголя», «рынок вина сократился»

**Синонимы и выражения (полный список):**
- Новости и нормативные акты: «Минфин повысил минимальные розничные цены на вино», «с 2027 года акциз на игристые вина вырастет», «правительство повысило пошлины на вина из недружественных стран», «Росалкогольтабакконтроль меняет порядок фиксации в ЕГАИС», «регион ввёл запрет на продажу алкоголя в ночные часы», «рынок импортного вина за 9 месяцев сократился на 12 %»
- Деловая переписка: «в связи с ростом пошлин с 01.01 цены на импорт изменятся», «у нас в области ограничили часы продажи, закупки сократим»
- Чаты / мессенджеры (разговорный стиль): «акцизы опять подняли», «пошлины на европейское вино задрали», «в ЕГАИС опять всё поменяли», «МРЦ на вино подняли»
- Сокращения и термины: «акциз», «МРЦ», «пошлина», «ЕГАИС», «РАР», «ФСМ», «Честный знак», «171-ФЗ», «468-ФЗ (о виноградарстве и виноделии)»
- Устойчивые конструкции / маркеры: «с [даты] [изменится / вводится] [норма]», «[ведомство] повысило / утвердило [что]», «рынок [категории] [вырос / сократился] на [N %]»

**Похоже, но не это (анти-признаки):** «не можем подтвердить ТТН в ЕГАИС» → `EGAIS_ISSUE`; «производитель поднимает цены с 01.12» → `SUPPLIER_PRICE_CHANGE`; «сеть закрывает магазины из-за ограничений» → `SIGNAL_DOWNSIZING`

**Пример (evidence):** «С 1 января 2027 года минимальная розничная цена на бутылку игристого вина 0,75 л повышается, сообщил Минфин.»
**Контрпример:** «У нас ТТН висит в ЕГАИС третий день, не можем принять» → проблема одного клиента, `EGAIS_ISSUE`.

**Заметка для карточки:** Заголовок называет отрасль или изменение, а не одного клиента; шаг — проверить, каких наших клиентов это касается, без предложения отдельному клиенту.

### `SIGNAL_RESULTS_POSITIVE` — Положительные результаты компании

| Field | Value |
|---|---|
| Pack · block · family | base · H · market |
| Weight · class · kind · score rule | 3 · fyi · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · off |
| Display profile | from weight (W1) |
| Recipient role | relationship |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual: none |

**Определение:** Компания публикует результаты с ростом: выручка, прибыль, продажи, трафик, число гостей. Нужны число и период сравнения.

**Граница (не считается):** Рост закупок у нас → `ACCOUNT_REVENUE_GROWTH_YOY`. Слова «год был удачным» без цифры и периода — нет сигнала. Прогноз или план без факта → `SIGNAL_STRATEGY_CONTEXT`. Маркетинговый бюджет в отчёте не является кампанией → не `SIGNAL_AD_ACTIVITY`.

**Признаки для промпта (≤ 8):** «выручка выросла на», «рост продаж на», «чистая прибыль увеличилась», «по итогам квартала», «LFL-продажи выросли», «трафик вырос на», «год к году», «по МСФО»

**Синонимы и выражения (полный список):**
- Новости и отчётность: «выручка сети за 9 месяцев выросла на 18 % год к году», «чистая прибыль по МСФО увеличилась вдвое», «сопоставимые продажи (LFL) выросли на 7 %», «ресторанная группа отчиталась о росте выручки», «средний чек вырос на 12 %»
- Деловая переписка: «по итогам года выручка у нас +20 %, расширяем винную карту»
- Чаты / мессенджеры (разговорный стиль): «у них выручка прёт», «плюс 20 % за год», «отчитались хорошо»
- Сокращения и термины: «выручка», «EBITDA», «МСФО», «РСБУ», «LFL», «г/г», «кв/кв», «средний чек»
- Устойчивые конструкции / маркеры: «[показатель] вырос на [N %] [к периоду]», «по итогам [периода] [показатель] составил [сумма], [+N %]»

**Похоже, но не это (анти-признаки):** «клиент купил у нас на 30 % больше» → `ACCOUNT_REVENUE_GROWTH_YOY`; «год был отличный» → нет сигнала; «планируем рост на 20 %» → `SIGNAL_STRATEGY_CONTEXT`

**Пример (evidence):** «Выручка сети «Винотека 24» за январь–сентябрь 2026 года выросла на 18 % год к году, до 2,4 млрд ₽.»
**Контрпример:** «Сеть «Винотека 24» рассчитывает на рост выручки в следующем году» → прогноз без факта.

**Заметка для карточки:** Информационно: назовите показатель, цифру и период; шаг — держать к следующему разговору.

### `SIGNAL_RESULTS_NEGATIVE` — Отрицательные результаты компании

| Field | Value |
|---|---|
| Pack · block · family | base · H · market |
| Weight · class · kind · score rule | 3 · fyi · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · off |
| Display profile | from weight (W1) |
| Recipient role | relationship |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual: none |

**Определение:** Компания публикует результаты со снижением: выручка, прибыль, продажи, трафик, рост убытка. Нужны число и период сравнения.

**Граница (не считается):** Снижение закупок у нас → `ACCOUNT_REVENUE_DECLINE_YOY`. Банкротство, блокировка счетов → `SIGNAL_INSOLVENCY`. Закрытие точек → `SIGNAL_DOWNSIZING`. Слова «год был тяжёлым» без цифры — нет сигнала.

**Признаки для промпта (≤ 8):** «выручка снизилась на», «падение продаж на», «убыток вырос», «чистая прибыль сократилась», «LFL-продажи упали», «трафик снизился», «год к году», «по итогам полугодия»

**Синонимы и выражения (полный список):**
- Новости и отчётность: «выручка ресторанной группы за полугодие снизилась на 9 %», «чистый убыток по РСБУ вырос в 1,5 раза», «сопоставимые продажи упали на 4 %», «трафик в заведениях сократился на 11 % год к году»
- Деловая переписка: «у нас выручка минус 15 % к прошлому году, поэтому закупки скромнее»
- Чаты / мессенджеры (разговорный стиль): «у них выручка просела», «минус 10 % за год», «отчитались в убыток»
- Сокращения и термины: «выручка», «убыток», «МСФО», «РСБУ», «LFL», «г/г», «трафик»
- Устойчивые конструкции / маркеры: «[показатель] снизился / упал на [N %] [к периоду]», «убыток составил [сумма]»

**Похоже, но не это (анти-признаки):** «клиент купил у нас меньше, чем в прошлом году» → `ACCOUNT_REVENUE_DECLINE_YOY`; «введена процедура наблюдения» → `SIGNAL_INSOLVENCY`; «закроем пять ресторанов» → `SIGNAL_DOWNSIZING`; «сейчас тяжело» → нет сигнала

**Пример (evidence):** «Выручка ресторанной группы «Северный ветер» за первое полугодие 2026 года снизилась на 9 % год к году.»
**Контрпример:** «Ресторанная группа «Северный ветер» закрывает два ресторана» → это `SIGNAL_DOWNSIZING`.

**Заметка для карточки:** Информационно: назовите показатель, цифру и период; шаг — держать к разговору и при следующем контакте спросить, как это влияет на закупки.

### `SIGNAL_AWARD` — Компания получила награду

| Field | Value |
|---|---|
| Pack · block · family | base · H · market |
| Weight · class · kind · score rule | 2 · fyi · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · off |
| Display profile | from weight (W1) |
| Recipient role | relationship |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual: none |

**Определение:** Компания, её заведение, продукт или сотрудник получает премию, награду, звание или место в рейтинге (для HoReCa — ресторанные премии, гиды, рейтинги баров; для вина — медали конкурсов).

**Граница (не считается):** Награда конкуренту → `COMPETITOR_AWARD`, партнёру → `PARTNER_AWARD`. Медаль у вина, которое мы закупаем, в письме поставщика → нет сигнала (или `SUPPLIER_PRICE_CHANGE`, если пришёл новый прайс). Компания сама вручает премию или спонсирует её → `SIGNAL_SPONSORING`. Наша собственная награда — нет сигнала.

**Признаки для промпта (≤ 8):** «получил премию», «вошёл в рейтинг», «стал лауреатом», «звезда гида», «лучший винный бар», «золотая медаль», «победитель конкурса», «отмечен в гиде»

**Синонимы и выражения (полный список):**
- Новости: «ресторан вошёл в топ-50 ресторанного рейтинга», «бар получил премию «Лучший винный бар года»», «заведение отмечено в гастрономическом гиде», «сомелье ресторана стал победителем национального конкурса», «сеть признана лучшим винным ретейлером года»
- Деловая переписка: «нас включили в гид, спасибо за помощь с картой», «наш сомелье выиграл конкурс»
- Чаты / мессенджеры (разговорный стиль): «им звезду дали», «попали в топ», «взяли премию»
- Сокращения и термины: «премия», «рейтинг», «гид», «лауреат», «номинация», «медаль», «конкурс сомелье»
- Устойчивые конструкции / маркеры: «[компания] получила [премию / награду]», «вошла в [рейтинг / гид]», «стала лауреатом [премии]»

**Похоже, но не это (анти-признаки):** ««Винный Альянс» стал дистрибьютором года» → `COMPETITOR_AWARD`; «ресторан учредил премию для молодых шефов» → `SIGNAL_SPONSORING`; «вино получило 95 баллов, новый прайс во вложении» → нет сигнала для клиента

**Пример (evidence):** «Винный бар «Терруар» получил премию «Лучшая винная карта года» в номинации «Москва».»
**Контрпример:** ««Винный Альянс» признан лучшим импортёром года» → награда конкуренту, `COMPETITOR_AWARD`.

**Заметка для карточки:** Информационно: держать к следующему разговору, без контакта, поздравления как задачи и предложения; если компания использует награду в рекламе — отметить это.

### `SIGNAL_PARTNERSHIP` — Объявлено партнёрство

| Field | Value |
|---|---|
| Pack · block · family | base · H · market |
| Weight · class · kind · score rule | 3 · chance · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · off |
| Display profile | from weight (W1) |
| Recipient role | relationship |
| Closes / closed by | closes: — · closed by: — |
| Relations | `SIGNAL_MERGER` leads over it (when control changes) |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual: none |

**Определение:** Клиент начинает сотрудничество с третьей стороной без смены контроля: совместная кампания или продукт, совместное предприятие, дистрибуторское или франчайзинговое соглашение, коллаборация.

**Граница (не считается):** Переход контроля → `SIGNAL_MERGER`. Клиент начинает работать с другим поставщиком того, что продаём мы → `SIGNAL_COMPETITOR`. Партнёрство нашего партнёра или поставщика → блок L (`PARTNER_*`). Спонсорство события → `SIGNAL_SPONSORING`. Наше собственное партнёрство с клиентом — нет сигнала.

**Признаки для промпта (≤ 8):** «подписали соглашение о сотрудничестве», «совместный проект», «коллаборация», «стратегическое партнёрство», «совместное предприятие», «эксклюзивный дистрибьютор», «франчайзинговое соглашение», «запускают вместе»

**Синонимы и выражения (полный список):**
- Новости: «сеть и сервис доставки подписали соглашение о стратегическом партнёрстве», «ресторан и винодельня запускают коллаборацию», «компании создали совместное предприятие», «бренд выходит в регионы по франшизе через партнёра», «банк и ресторанная группа запустили совместную программу лояльности»
- Деловая переписка: «мы начинаем проект с сервисом доставки, объёмы вырастут», «делаем совместный ужин с винодельней»
- Чаты / мессенджеры (разговорный стиль): «у них колаба с винодельней», «вместе с доставкой что-то запускают», «зашли в партнёрство»
- Сокращения и термины: «коллаборация», «колаба», «СП», «соглашение о сотрудничестве», «франшиза», «кобрендинг»
- Устойчивые конструкции / маркеры: «[компания] и [компания] подписали [соглашение]», «запускают совместный [проект / продукт]», «стали партнёрами в [области]»

**Похоже, но не это (анти-признаки):** «холдинг купил 60 % компании» → `SIGNAL_MERGER`; «вино теперь берём у «Винного Альянса»» → `SIGNAL_COMPETITOR`; «стали генеральным спонсором фестиваля» → `SIGNAL_SPONSORING`

**Пример (evidence):** «Сеть «Винотека 24» и сервис доставки «Быстро» подписали соглашение: с декабря вино сети будет доступно в приложении.»
**Контрпример:** «Холдинг «Гастроном Плюс» получил контроль над сервисом «Быстро»» → смена контроля, `SIGNAL_MERGER`.

**Заметка для карточки:** Пишите для нашего клиента, не для партнёра; не предполагайте коммуникацию или объёмы — шаг: спросить контакт клиента, что партнёрство значит для закупок; если ничего — держать к разговору.

### `SIGNAL_AD_ACTIVITY` — Кампания идёт или завершается

| Field | Value |
|---|---|
| Pack · block · family | base · H · market |
| Weight · class · kind · score rule | 4 · chance · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · off |
| Display profile | from weight (D4) |
| Recipient role | relationship |
| Closes / closed by | closes: — · closed by: — |
| Relations | `SIGNAL_AGENCY_CHANGE` leads over it; split by date with `SIGNAL_CAMPAIGN_PLANNED` |
| Date gate | — (prompt rule: running now or ending soon relative to the item date; a start after the item date is `SIGNAL_CAMPAIGN_PLANNED`) |
| Relevance window | default |
| Deal effect | per org rule; usual: none |

**Определение:** Компания сейчас ведёт платную рекламу или акцию, либо кампания скоро заканчивается: реклама замечена в медиа или библиотеке объявлений, ролик в эфире, действующая промоакция или партнёрская программа. Это признак маркетингового бюджета, а не измеренный расход.

**Граница (не считается):** Кампания объявлена, но ещё не стартовала → `SIGNAL_CAMPAIGN_PLANNED`. Годовой маркетинговый бюджет в отчётности → часть `SIGNAL_RESULTS_*`, не этот код. Конкурент у клиента → `SIGNAL_COMPETITOR`. Клиент просит у нас промоподдержку → `PROMO_SUPPORT_REQUESTED` (distribution). Наша собственная акция — нет сигнала.

**Признаки для промпта (≤ 8):** «стартовала кампания», «идёт акция», «в эфире ролик», «действует до», «акция продлится до», «реклама в метро», «запустила промо», «последняя неделя акции»

**Синонимы и выражения (полный список):**
- Новости: «сеть запустила рекламную кампанию с участием», «в эфире федеральных каналов вышел ролик бренда», «в магазинах сети действует акция «Второе вино за полцены» до 30 ноября», «реклама бренда появилась на билбордах», «сеть продолжает кампанию в Telegram-каналах»
- Деловая переписка: «у нас сейчас идёт акция на игристое, до конца месяца», «кампания заканчивается 15-го, потом будем думать дальше»
- Чаты / мессенджеры (разговорный стиль): «у них сейчас реклама везде», «акция идёт до конца месяца», «ролик крутят по ТВ»
- Сокращения и термины: «РК» (рекламная кампания), «промо», «акция», «ролик», «наружка», «таргет», «посевы», «библиотека объявлений»
- Устойчивые конструкции / маркеры: «[компания] запустила / ведёт [кампанию]», «акция действует до [даты]», «[ролик / реклама] вышел в [медиа]»

**Похоже, но не это (анти-признаки):** «в марте запускаем новогоднюю кампанию» → `SIGNAL_CAMPAIGN_PLANNED`; «маркетинговые расходы за год — 3 млрд ₽» → `SIGNAL_RESULTS_*`; «поддержите акцию бонусом за объём» → `PROMO_SUPPORT_REQUESTED`

**Пример (evidence):** «В магазинах «Винотеки 24» до 30 ноября действует акция на вина Португалии, реклама идёт в Telegram-каналах.»
**Контрпример:** «С 1 декабря «Винотека 24» запустит новогоднюю кампанию» → старт после даты материала, `SIGNAL_CAMPAIGN_PLANNED`.

**Заметка для карточки:** Назовите, о чём кампания; для этой кампании, возможно, поздно, но это повод для контакта: спросить о следующих активностях и закупках под них; без предложения под текущую.

### `SIGNAL_ACCOUNT_WIN` — Агентство выиграло нового клиента

| Field | Value |
|---|---|
| Pack · block · family | base · H · market |
| Weight · class · kind · score rule | 5 · chance · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · yes |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · off |
| Display profile | from weight (D4) |
| Recipient role | relationship |
| Closes / closed by | closes: — · closed by: — |
| Relations | both with `SIGNAL_AGENCY_CHANGE`; when the winner is our competitor → `COMPETITOR_NEW_CLIENT` instead |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual: none |

**Определение:** Агентство (рекламное, медийное, PR) выигрывает бюджет или тендер рекламодателя, и в тексте названо агентство-победитель. Код ставится и агентству, и рекламодателю — это одно событие с двух сторон. Если победа заменяет прежнее агентство или завершает тендер, дополнительно ставится `SIGNAL_AGENCY_CHANGE`.

**Граница (не считается):** Победитель — наш конкурент → `COMPETITOR_NEW_CLIENT`. Заказ, размещённый у нас → `SALES_BOOKING_RECEIVED` / `ORDER_REQUESTED`. Своя кампания рекламодателя → `SIGNAL_CAMPAIGN_PLANNED` / `SIGNAL_AD_ACTIVITY`. Дистрибьютор получил новую сеть или контракт на поставку (это не агентство) → `COMPETITOR_NEW_CLIENT`, `PARTNER_NEW_CLIENT` или нет сигнала.

**Признаки для промпта (≤ 8):** «выиграло тендер на обслуживание», «бюджет бренда достался», «будет вести бренд», «новый клиент агентства», «по итогам тендера выбран», «стало ведущим агентством», «получило бюджет», «займётся продвижением бренда»

**Синонимы и выражения (полный список):**
- Новости (отраслевые СМИ о рекламе): «агентство выиграло креативный тендер бренда», «медийный бюджет сети достался агентству», «агентство будет вести коммуникации бренда в 2027 году», «бренд выбрал агентство по итогам тендера», «агентство пополнило клиентский портфель»
- Деловая переписка: «мы выиграли тендер «Гастроном Плюс», с января ведём их digital», «сообщаем, что наше агентство теперь отвечает за продвижение бренда»
- Чаты / мессенджеры (разговорный стиль): «они взяли бюджет «Гастроном Плюс»», «тендер выиграли», «теперь ведут этот бренд»
- Сокращения и термины: «тендер», «бюджет», «AOR», «лид-агентство», «медиабаинг», «креатив», «PR»
- Устойчивые конструкции / маркеры: «[агентство] выиграло [тендер / бюджет] [бренда]», «[бренд] выбрал [агентство]», «[агентство] будет вести [бренд] с [даты]»

**Похоже, но не это (анти-признаки):** «бюджет бренда выиграл «Альфа Медиа» (наш конкурент)» → `COMPETITOR_NEW_CLIENT`; «бренд запускает кампанию» → `SIGNAL_CAMPAIGN_PLANNED`; «сеть подписала с нами договор поставки» → `SALES_BOOKING_RECEIVED`

**Пример (evidence):** «Агентство «Бета Коммуникации» выиграло тендер и с января 2027 года будет вести digital-продвижение сети «Гастроном Плюс»; бюджет — 60 млн ₽ в год.»
**Контрпример:** «Сеть «Гастроном Плюс» запускает новогоднюю кампанию с агентством «Бета Коммуникации», которое ведёт её третий год» → кампания действующего агентства.

**Заметка для карточки:** Пишите для стороны, которая наш клиент, и назовите вторую; агентство-клиент — узнать планы выигранного бюджета; рекламодатель-клиент — спросить, меняет ли новое агентство что-то для нас.

### `SIGNAL_OPERATIONS_INVESTMENT` — Инвестиции во внутреннюю деятельность

| Field | Value |
|---|---|
| Pack · block · family | base · H · market |
| Weight · class · kind · score rule | 2 · fyi · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · off |
| Display profile | from weight (W1) |
| Recipient role | relationship |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual: none |

**Определение:** Компания покупает товары или услуги для своей работы — транспорт, склады, оборудование, ИТ, здания, энергию — без нового продукта, новой площадки для клиентов и без маркетингового бюджета. Одно событие с двух сторон: покупатель инвестирует, поставщик получает заказ; код ставится любой стороне, которая наш клиент.

**Граница (не считается):** Новый продукт или ассортимент → `SIGNAL_PRODUCT_NEWS`. Новая точка для клиентов → `SIGNAL_EXPANSION`. Партнёрство → `SIGNAL_PARTNERSHIP`. Покупка у НАС → заказ (`ORDER_REQUESTED`, `SALES_BOOKING_RECEIVED`). Инвестиции в связи с покупкой компании → `SIGNAL_MERGER`.

**Признаки для промпта (≤ 8):** «инвестирует в», «закупила оборудование», «построит распределительный центр», «обновила автопарк», «модернизирует», «внедряет систему», «новый склад», «получила крупный заказ на поставку»

**Синонимы и выражения (полный список):**
- Новости: «сеть построит распределительный центр в Подмосковье», «компания обновила автопарк рефрижераторов», «ресторанная группа внедряет новую кассовую систему», «ретейлер инвестирует 2 млрд ₽ в логистику», «поставщик оборудования получил крупный заказ от сети»
- Деловая переписка: «мы переезжаем на новый склад, с декабря новый адрес приёмки», «ставим новую систему учёта, возможны задержки в подтверждении заказов»
- Чаты / мессенджеры (разговорный стиль): «склад новый строят», «машины обновили», «кассы меняют»
- Сокращения и термины: «РЦ» (распределительный центр), «автопарк», «ERP», «WMS», «капекс», «модернизация»
- Устойчивые конструкции / маркеры: «[компания] инвестирует [сумму] в [что]», «запускает / построит [объект]», «получила заказ на поставку [чего] для [компании]»

**Похоже, но не это (анти-признаки):** «запускаем собственную марку вина» → `SIGNAL_PRODUCT_NEWS`; «открываем новый магазин» → `SIGNAL_EXPANSION`; «закажите нам 50 коробок» → `ORDER_REQUESTED`

**Пример (evidence):** «Сеть «Гастроном Плюс» вложит 1,5 млрд ₽ в новый распределительный центр в Домодедове, запуск в 2027 году.»
**Контрпример:** «Сеть «Гастроном Плюс» открывает три новых магазина в Подмосковье» → площадки для покупателей, `SIGNAL_EXPANSION`.

**Заметка для карточки:** Информационно для каждой стороны-клиента: одна строка — покупателю об инвестиции, поставщику о заказе; шаг — держать к разговору (например, спросить, меняется ли адрес и порядок приёмки).

### `SIGNAL_STRATEGY_CONTEXT` — Контекст стратегии для будущего разговора

| Field | Value |
|---|---|
| Pack · block · family | base · H · market |
| Weight · class · kind · score rule | 2 · fyi · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · off |
| Display profile | from weight (W1) |
| Recipient role | relationship |
| Closes / closed by | closes: — · closed by: — |
| Relations | split with `SIGNAL_STRATEGY_ANNOUNCEMENT` (a named marketing / budget consequence) |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual: none |

**Определение:** Компания делает стратегическое заявление, делится планом или участвует в обсуждении без названного последствия для маркетинга, бюджета или закупок: производство, площадки, организация, прогноз рынка, интервью о бизнесе. Полезно для следующего разговора, не повод для продажи.

**Граница (не считается):** Названо последствие для маркетинга, бюджета, ассортимента или поставщиков → `SIGNAL_STRATEGY_ANNOUNCEMENT` (или `SIGNAL_CHANNEL_SHIFT`). Спецификация, тендерная документация, КП — не заявление о стратегии. Конкретное событие со своим H-кодом → этот код.

**Признаки для промпта (≤ 8):** «в интервью рассказал», «планы на ближайшие годы», «видит будущее рынка», «рассматривает варианты», «стратегия развития», «прогноз на следующий год», «обсуждает перенос производства», «оптимизирует структуру без сокращений»

**Синонимы и выражения (полный список):**
- Новости: «основатель ресторанной группы в интервью рассказал о планах», «генеральный директор сети ожидает замедления рынка», «компания рассматривает перенос производства», «ретейлер обсуждает новую организационную структуру», «прогноз компании на 2027 год»
- Деловая переписка: «в следующем году думаем о новых форматах, пока ничего конкретного», «руководство обсуждает развитие, решения позже»
- Чаты / мессенджеры (разговорный стиль): «гендир в подкасте рассказывал про планы», «думают, куда расти», «пока присматриваются»
- Сокращения и термины: «интервью», «стратегия», «прогноз», «оргструктура», «планы развития»
- Устойчивые конструкции / маркеры: «[руководитель] рассказал о [планах]», «[компания] рассматривает [вариант]», «ожидает [тенденцию] в [периоде]»

**Похоже, но не это (анти-признаки):** «в следующем году сокращаем число поставщиков вина» → `SIGNAL_STRATEGY_ANNOUNCEMENT`; «переносим бюджет в digital» → `SIGNAL_CHANNEL_SHIFT`; «во вложении тендерная документация» → `SALES_TENDER_INVITATION`

**Пример (evidence):** «Основатель «Северного ветра» в интервью рассказал, что группа рассматривает выход в загородный формат, но решение примут не раньше весны.»
**Контрпример:** «Основатель «Северного ветра»: в 2027 году мы сократим число винных поставщиков с восьми до трёх» → названо последствие для закупок, `SIGNAL_STRATEGY_ANNOUNCEMENT`.

**Заметка для карточки:** Повод для разговора: одна строка — что сказано и почему это может быть важно; шаг — при следующем контакте спросить, что это значит для их закупок; без предложения.

### `SIGNAL_TRACKING_VENDOR_CHANGE` — Смена поставщика аналитики или трекинга

| Field | Value |
|---|---|
| Pack · block · family | base · H · market |
| Weight · class · kind · score rule | 5 · chance (class by relation: yes — active client: risk) · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both (text or website scan) |
| Stage (pack default) · IN4COM | active · off |
| Display profile | from weight (D4) |
| Recipient role | relationship |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual: none |

**Определение:** Компания меняет агентство, которое ведёт её веб-аналитику и трекинг кампаний, или заменяет один внешний инструмент трекинга другим того же типа: менеджер тегов, веб-аналитика, сервис согласия на cookie, пиксели, коллтрекинг или сквозная аналитика (например, Google Tag Manager → другой менеджер тегов, Google Analytics → Яндекс Метрика, Calltouch → CoMagic). Сканирование сайта, где один инструмент исчез и появился другой, тоже считается.

**Граница (не считается):** Смена рекламного, медийного или PR-агентства → `SIGNAL_AGENCY_CHANGE`. Инструмент добавлен рядом со старым — нет сигнала. Полностью новый сайт → `SIGNAL_REBRANDING`. Аналитики нет совсем → `SIGNAL_TRACKING_GAP`.

**Признаки для промпта (≤ 8):** «сменили подрядчика по аналитике», «перешли на Яндекс Метрику», «внедрили сквозную аналитику», «новый коллтрекинг», «новое агентство по performance», «перенастроили теги», «серверный трекинг», «новая плашка согласия на cookie»

**Синонимы и выражения (полный список):**
- Деловая переписка: «с декабря аналитику ведёт новое агентство», «отказались от Google Analytics, теперь только Метрика», «перешли с Calltouch на CoMagic», «поменяли сервис согласий на cookie по 152-ФЗ»
- Новости: «бренд сменил performance-агентство», «ретейлер внедрил сквозную аналитику Roistat», «компания перешла на серверный трекинг»
- Чаты / мессенджеры (разговорный стиль): «аналитику другим отдали», «Метрику перенастраивают», «коллтрекинг сменили»
- Сокращения и термины: «GTM», «Яндекс Метрика», «VK Пиксель», «Top.Mail.ru», «Roistat», «Calltouch», «CoMagic», «сквозная аналитика», «cookie-плашка», «152-ФЗ»
- Устойчивые конструкции / маркеры: «перешли с [инструмента] на [инструмент]», «[агентство] теперь ведёт [аналитику / трекинг]»

**Похоже, но не это (анти-признаки):** «сменили рекламное агентство» → `SIGNAL_AGENCY_CHANGE`; «добавили VK Пиксель к Метрике» → нет сигнала; «запустили новый сайт» → `SIGNAL_REBRANDING`; «на сайте нет никакой аналитики» → `SIGNAL_TRACKING_GAP`

**Пример (evidence):** «С ноября сквозную аналитику «Винотеки 24» ведёт новое агентство, коллтрекинг переведён с Calltouch на CoMagic.»
**Контрпример:** «На сайт «Винотеки 24» дополнительно поставили VK Пиксель» → инструмент добавлен, замены нет.

**Заметка для карточки:** Называйте инструменты, если они названы, иначе — категорию; сканирование может ошибаться, не утверждайте смену как факт; неклиент — шанс предложить аудит, активный клиент — риск, узнать причину смены.

### `SIGNAL_TRACKING_GAP` — Пробел в аналитике сайта

| Field | Value |
|---|---|
| Pack · block · family | base · H · market |
| Weight · class · kind · score rule | 4 · chance · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | process (deterministic website scan; never read from text) |
| Stage (pack default) · IN4COM | active · off |
| Display profile | from weight (D4) |
| Recipient role | relationship |
| Closes / closed by | closes: — · closed by: — (a later scan that finds the tools stops repeats) |
| Relations | — |
| Date gate | — |
| Relevance window | one instance per company and gap; cooldown 90 days per company + code |
| Deal effect | per org rule; usual: none |

**Определение:** На сайте компании нет веб-аналитики (ни Яндекс Метрики, ни другой системы) и / или нет инструмента согласия на обработку cookie и персональных данных; это видно на двух сканированиях подряд. Повод предложить настройку аналитики.

**Граница (не считается):** Один инструмент заменён другим → `SIGNAL_TRACKING_VENDOR_CHANGE`. Сайт недоступен или в разработке — нет сигнала. Одно сканирование без повтора — нет сигнала. Сообщение в тексте письма о том, что аналитики нет, — этот код из текста не ставится.

**Признаки для промпта:** — (not in the extraction prompt; emitted by process)

**Правило срабатывания (trigger rule):**
- RU: Данные — автоматическое сканирование главной страницы и одной внутренней страницы сайта компании из карточки клиента. Условие — на двух сканированиях подряд с интервалом не меньше 7 дней не найдено ни одной системы веб-аналитики (Яндекс Метрика, Google Analytics, Top.Mail.ru / VK Пиксель, Matomo) и / или нет плашки согласия на cookie. Минимум данных — сайт отвечает кодом 200 на обоих сканированиях. Запуск — еженедельно. Повтор — не раньше 90 дней на компанию и код. Сайт с аналитикой, которая грузится только после согласия, сканер может пропустить — карточка просит проверить вручную.
- EN: Data — an automatic scan of the home page and one inner page of the company website from the client card. Condition — two scans in a row at least 7 days apart find no web-analytics system (Yandex Metrica, Google Analytics, Top.Mail.ru / VK Pixel, Matomo) and / or no cookie-consent banner. Minimum data — the site returns HTTP 200 on both scans. Run — weekly. Cooldown — 90 days per company + code. Analytics that loads only after consent can be missed; the card asks for a manual check.

**Пример (evidence):** «Сканирование сайта vinoteka24.example 03.11 и 10.11: систем веб-аналитики не найдено, плашки согласия на cookie нет.»
**Контрпример:** «Сканирование 10.11: Google Analytics не найден, найдена Яндекс Метрика» → инструмент заменён, это `SIGNAL_TRACKING_VENDOR_CHANGE`.

**Заметка для карточки:** Назовите, чего не нашло сканирование; шаг — сначала проверить сайт самому, потом узнать у контакта клиента, как они измеряют результаты; без упрёка.

### `SIGNAL_CAMPAIGN_PLANNED` — Запланирована кампания

| Field | Value |
|---|---|
| Pack · block · family | base · H · market |
| Weight · class · kind · score rule | 5 · chance · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · off |
| Display profile | from weight (D4) |
| Recipient role | relationship |
| Closes / closed by | closes: — · closed by: — |
| Relations | split by date with `SIGNAL_AD_ACTIVITY`; both with `SIGNAL_PRODUCT_NEWS` when the launch campaign is named |
| Date gate | — (prompt rule: the start is after the item date, or the campaign is in production / about to start) |
| Relevance window | default |
| Deal effect | per org rule; usual: none |

**Определение:** Компания объявляет или планирует кампанию, промоакцию, запуск с продвижением или медиаплан, которые ещё не начались: дата старта позже даты материала, кампания в производстве, тендер на кампанию. Бюджет ещё не размещён. Для HoReCa и розницы — сезонная винная акция, новогодняя или праздничная промо, винный фестиваль в сети.

**Граница (не считается):** Кампания уже идёт или заканчивается → `SIGNAL_AD_ACTIVITY`. Только новый продукт без кампании → `SIGNAL_PRODUCT_NEWS`. Клиент просит нас поддержать акцию (бонус, POS, промо) → `PROMO_SUPPORT_REQUESTED` (distribution). Конкурент у клиента → `SIGNAL_COMPETITOR`.

**Признаки для промпта (≤ 8):** «планирует кампанию», «стартует в декабре», «готовим акцию к», «с 1 марта запустим», «скоро стартует», «в производстве ролик», «медиаплан на», «тендер на кампанию»

**Синонимы и выражения (полный список):**
- Новости: «сеть с 1 декабря запустит новогоднюю кампанию», «бренд готовит масштабную кампанию к запуску», «ретейлер объявил тендер на проведение весенней кампании», «ролик уже снимают, выход в феврале»
- Деловая переписка: «в декабре у нас будет большая акция на игристое, планируем объёмы», «готовим весенний винный фестиваль во всех магазинах, старт 1 апреля», «к 8 Марта делаем промо»
- Чаты / мессенджеры (разговорный стиль): «к Новому году готовят акцию», «скоро запуск кампании», «съёмки ролика на следующей неделе»
- Сокращения и термины: «РК», «медиаплан», «промо», «запуск», «старт», «сезонная акция», «ко дню»
- Устойчивые конструкции / маркеры: «[компания] запустит [кампанию] с [даты]», «готовим [акцию] к [поводу]», «старт [кампании] запланирован на [дату]»

**Похоже, но не это (анти-признаки):** «акция идёт до конца месяца» → `SIGNAL_AD_ACTIVITY`; «выпускаем новую марку» (без кампании) → `SIGNAL_PRODUCT_NEWS`; «под акцию нужен ретро-бонус от вас» → `PROMO_SUPPORT_REQUESTED`

**Пример (evidence):** «С 1 декабря во всех 40 магазинах «Винотеки 24» стартует новогодняя акция на шампанское и игристые вина.»
**Контрпример:** «В магазинах «Винотеки 24» сейчас идёт акция на игристое, последняя неделя» → кампания уже идёт, `SIGNAL_AD_ACTIVITY`.

**Заметка для карточки:** Бюджет ещё не размещён: шаг — связаться с контактом клиента, узнать сроки, объёмы и позиции под кампанию, и только потом предложить подборку; назовите кампанию и дату старта.

### `SIGNAL_ANNIVERSARY_PLAIN` — Юбилей без коммуникационной активности

| Field | Value |
|---|---|
| Pack · block · family | base · H · market |
| Weight · class · kind · score rule | 2 · fyi · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · off |
| Display profile | from weight (W1) |
| Recipient role | relationship |
| Closes / closed by | closes: — · closed by: — |
| Relations | split with `SIGNAL_ANNIVERSARY` (communication named) |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual: none |

**Определение:** Материал только сообщает о юбилее компании или заведения; кампания, специальные продукты, событие или акция к юбилею не названы.

**Граница (не считается):** Названа активность к юбилею (вечер, меню, акция, серия) → `SIGNAL_ANNIVERSARY`. Дата основания в справке о компании без повода — нет сигнала. Юбилей сотрудника — нет сигнала.

**Признаки для промпта (≤ 8):** «исполнилось 10 лет», «отмечает юбилей», «празднует годовщину», «работает с 2006 года», «20 лет на рынке», «юбилей компании», «годовщина открытия», «десятилетие»

**Синонимы и выражения (полный список):**
- Новости: «ресторану «Северный ветер» исполнилось 15 лет», «сеть отмечает 20-летие», «компании четверть века», «бар празднует пятую годовщину»
- Деловая переписка: «в этом месяце нам 10 лет», «у нас юбилей, спасибо, что вы с нами»
- Чаты / мессенджеры (разговорный стиль): «им десятка», «у них юбилей», «пятнадцать лет уже»
- Сокращения и термины: «юбилей», «годовщина», «N лет на рынке»
- Устойчивые конструкции / маркеры: «[компании] исполнилось [N лет]», «[компания] отмечает [N-летие]»

**Похоже, но не это (анти-признаки):** «к юбилею готовим гала-ужин и спецкарту» → `SIGNAL_ANNIVERSARY`; «компания основана в 2006 году» (справка) → нет сигнала; «у нашего сомелье 10 лет в профессии» → нет сигнала

**Пример (evidence):** «В ноябре ресторану «Северный ветер» исполняется 15 лет.»
**Контрпример:** «В ноябре ресторану «Северный ветер» исполняется 15 лет, к дате готовят юбилейное меню и винный вечер» → активность названа, `SIGNAL_ANNIVERSARY`.

**Заметка для карточки:** Информационно: держать к следующему разговору и тогда спросить, планируется ли что-то к дате; без контакта, поздравления как задачи и предложения.

### `SIGNAL_EVENT_UPCOMING` — Предстоит участие компании в событии

| Field | Value |
|---|---|
| Pack · block · family | base · H · market |
| Weight · class · kind · score rule | 3 · chance · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · off |
| Display profile | from weight (W1) |
| Recipient role | relationship |
| Closes / closed by | closes: — · closed by: — |
| Relations | split by date with `SIGNAL_EVENT` |
| Date gate | — (prompt rule: the event date is after the item date) |
| Relevance window | until the event date |
| Deal effect | per org rule; usual: none |

**Определение:** Компания будет участвовать в выставке, конференции, фестивале или отраслевом событии как экспонент, спикер или партнёр, и событие проходит после даты материала. Повод встретиться.

**Граница (не считается):** Событие прошло или дата не указана → `SIGNAL_EVENT`. Компания — спонсор → `SIGNAL_SPONSORING`. Клиент приглашает нас на встречу или дегустацию к себе → блок F (`MEETING_*`) или `TASTING_REQUESTED`. Наше участие — нет сигнала.

**Признаки для промпта (≤ 8):** «примет участие в выставке», «будет на форуме», «приглашаем на наш стенд», «выступит на конференции», «стенд №», «ждём вас на», «участвуем в фестивале в», «в программе форума»

**Синонимы и выражения (полный список):**
- Новости: «сеть представит новинки на выставке в феврале», «основатель ресторанной группы выступит на гастрономическом форуме», «бар примет участие в винном фестивале 12–14 декабря», «компания объявила об участии в отраслевой выставке»
- Деловая переписка: «в феврале будем на выставке, стенд B-12, заходите», «я выступаю на форуме ретейла 3 декабря, увидимся там?»
- Чаты / мессенджеры (разговорный стиль): «они в феврале на выставке будут», «на фесте у них свой бар будет», «едут на форум»
- Сокращения и термины: «выставка», «стенд», «экспонент», «спикер», «форум», «фестиваль», «деловая программа»
- Устойчивые конструкции / маркеры: «[компания] примет участие в [событии] [дата]», «приглашаем на стенд [номер]», «[руководитель] выступит на [событии]»

**Похоже, но не это (анти-признаки):** «по итогам выставки подписали соглашения» → `SIGNAL_EVENT`; «станем генеральным спонсором фестиваля» → `SIGNAL_SPONSORING`; «приезжайте к нам в ресторан на дегустацию в четверг» → `TASTING_REQUESTED` / блок F

**Пример (evidence):** «Ресторанная группа «Северный ветер» представит новый проект на гастрономическом фестивале 12–14 декабря в Москве.»
**Контрпример:** «Ресторанная группа «Северный ветер» представила новый проект на прошедшем фестивале» → событие прошло, `SIGNAL_EVENT`.

**Заметка для карточки:** Назовите событие и дату; шаг — до события договориться с контактом клиента о встрече на площадке и там узнать потребности; без предложения до встречи.

## I · Недоставка писем

| Code | Название (RU) | W | Class | Kind | Score rule | Effort | Asks us | Inbound only | Amount | Stage (pack) | IN4COM | Profile | Recipient | Family |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `MAILERDEMON_RECEIVED` | Письмо не доставлено | 5 | risk | event | inherited | quick | no | yes | no | active | on | inherited; fallback D4 | account | contact |

### `MAILERDEMON_RECEIVED` — Письмо не доставлено

| Field | Value |
|---|---|
| Pack · block · family | base · I · contact |
| Weight · class · kind · score rule | 5 (fallback) · risk · event · inherited |
| Effort · asks us · inbound only · amount | quick · no · yes (proposal) · no |
| Emitted by | both (v204); in this design the deterministic bounce detector (spec §5.2 gate 5) emits it without the LLM, with `facts.bouncedMessageIds` |
| Stage (pack default) · IN4COM | active · on |
| Display profile | inherited from the open card of the bounced mail; fallback 5 → D4 (Maslov D4) |
| Recipient role | account (Maslov «Аккаунт») — the sender of the bounced mail |
| Closes / closed by | closes: — · closed by: — (a later successful send to a corrected address ends the topic manually) |
| Relations | attaches to the topic of the bounced mail |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual: none |

**Определение:** Почтовая система возвращает уведомление о том, что наше письмо клиенту не доставлено: адрес не существует, ящик переполнен, домен не найден, письмо отклонено. Оценка берётся у открытой карточки недоставленного письма; если её нет — 5.

**Граница (не считается):** Автоответ об отпуске → `CONTACT_OOO`. Письмо доставлено, но клиент не ответил → `SALES_OFFER_NO_RESPONSE` или нет сигнала. Временная задержка доставки с повторной попыткой («доставка отложена») — нет сигнала, пока нет окончательного отказа. Недоставка рассылки, не адресованной клиенту лично, — нет сигнала. Клиент пишет, что сменил адрес → `CONTACT_NEW_KNOWN_ORG` / обновление контакта, не этот код.

**Признаки для промпта (≤ 8):** «Недоставленное сообщение», «Не удалось доставить сообщение», «Сообщение не доставлено», «Ошибка доставки», «Возвращённое письмо», «адрес не существует», «Mail Delivery Subsystem», «Undelivered Mail Returned to Sender»

**Синонимы и выражения (полный список):**
- Системные уведомления (рус.): «Недоставленное сообщение», «Не удалось доставить сообщение следующим получателям», «Сообщение не доставлено», «Ошибка доставки почты», «Возвращённое письмо», «Почтовый ящик получателя не существует», «Ящик получателя переполнен», «Сообщение отклонено сервером получателя», «Адрес электронной почты не найден»
- Системные уведомления (англ., приходят и в русской переписке): «Undelivered Mail Returned to Sender», «Delivery Status Notification (Failure)», «Mail delivery failed: returning message to sender», «Address not found», «550 5.1.1 User unknown», «Mailbox full», «Recipient address rejected»
- Отправители: «MAILER-DAEMON», «Mail Delivery Subsystem», «postmaster», «mailer-daemon@yandex.ru», «mailer-daemon@corp.mail.ru»
- Сокращения и термины: «DSN», «баунс», «550», «5.1.1», «5.2.2», «NDR»
- Устойчивые конструкции / маркеры: тема с «Недоставленное» / «Undeliverable» / «Delivery Status Notification» и вложение с исходным письмом (message/rfc822 или message/delivery-status)

**Похоже, но не это (анти-признаки):** «Автоответ: нахожусь в отпуске до 20.11» → `CONTACT_OOO`; «Delivery Status Notification (Delay): повторная попытка» → нет сигнала; «я больше не работаю в компании, пишите на новый адрес» → `CONTACT_LEAVING`; «отписаться от рассылки» → нет сигнала

**Пример (evidence):** «Не удалось доставить сообщение следующим получателям: zakupki@severveter.example — 550 5.1.1 Почтовый ящик не существует.»
**Контрпример:** «Автоматический ответ: я в отпуске до 20 ноября, по срочным вопросам пишите Ольге» → это `CONTACT_OOO`.

**Заметка для карточки:** Назовите адрес и тему недоставленного письма; шаг — отправителю: найти рабочий адрес или другой канал (телефон, мессенджер) и отправить письмо повторно, особенно если это КП, счёт или подтверждение заказа.

## J · Команда (внутренние сигналы)

Block J is internal-only: the server drops these codes on every external item (spec §5.4 step 2). The block is never offered to the `press` profile. All six codes are `gated` in v204. The export does not say what opens the gate. The entries are complete so that the registry is complete. A J code describes what a COLLEAGUE writes in internal mail or an internal chat. The client is the subject of the message, not its author.

| Code | Название (RU) | W | Class | Kind | Score rule | Effort | Asks us | Inbound only | Amount | Stage (pack) | IN4COM | Profile | Recipient | Family |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `TEAM_HANDOVER` | Передача аккаунта между коллегами | 7 | fyi | event | fixed | medium | no | no | no | gated | off | P6 | team | team |
| `TEAM_ESCALATION` | Внутренняя эскалация по клиенту | 6 | risk | event | fixed | medium | no | no | no | gated | off | P6 | team | team |
| `TEAM_INSIDER` | Коллега поделился важным контекстом клиента | 5 | fyi | event | fixed | medium | no | no | no | gated | off | D4 | team | team |
| `TEAM_DEAL_LOST` | Коллега сообщил о проигрыше | 5 | risk | event | fixed | medium | no | no | no | gated | off | D4 | team | team |
| `TEAM_CAPACITY` | Нехватка ресурсов или необходимость замены | 4 | risk | event | fixed | medium | no | no | no | gated | off | D4 | team | team |
| `TEAM_DEAL_WON` | Коллега сообщил о победе | 3 | chance | event | fixed | medium | no | no | no | gated | off | W1 | team | team |

### `TEAM_HANDOVER` — Передача аккаунта между коллегами

| Field | Value |
|---|---|
| Pack · block · family | base · J · team |
| Weight · class · kind · score rule | 7 · fyi · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | gated · off |
| Display profile | from weight (P6) |
| Recipient role | team |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual effect: none (the deal owner changes in the CRM by hand, not by the signal) |

**Определение:** Коллега сообщает, что клиент (аккаунт, сеть, регион) переходит от одного менеджера к другому: увольнение, отпуск по уходу, перераспределение клиентов, новая зона ответственности. Само по себе не негативное событие.

**Граница (не считается):** Временная замена на время отпуска или болезни → `TEAM_CAPACITY`. Смена контактного лица на стороне клиента → `CONTACT_LEAVING` / `CONTACT_NEW_KNOWN_ORG`. Письмо клиенту «теперь вашим менеджером будет Андрей» от нас наружу — внешний элемент, блок J на нём отбрасывается.

**Признаки для промпта (≤ 8):** «передаю клиента», «передаю тебе аккаунт», «с понедельника сеть ведёт», «теперь за клиентом закреплён», «забираешь моих клиентов», «перераспределили клиентов», «зона ответственности меняется», «введи в курс по клиенту»

**Синонимы и выражения (полный список):**
- Деловая переписка: «прошу принять клиента в работу», «с 01.12 ответственным менеджером по клиенту назначается», «в связи с моим уходом передаю клиентов», «передача дел по клиенту», «акт передачи клиентской базы», «закрепить клиента за», «смена ответственного менеджера»
- Чаты / мессенджеры (разговорный стиль): «забирай Ромашку», «теперь ты ведёшь Азбуку», «я ухожу, мои рестораны делим так», «кидаю тебе контакты по сети», «введу тебя в курс по клиенту», «с понедельника это твой клиент»
- Сокращения и термины: «КАМ», «аккаунт», «ответственный», «ЛПР клиента», «клиентская база»
- Устойчивые конструкции / маркеры: «передаю / передаём» + клиента / аккаунт / сеть; «теперь ведёт / отвечает» + имя коллеги; «закреплён за» + коллега

**Похоже, но не это (анти-признаки):** «подмени меня на время отпуска» → `TEAM_CAPACITY`; «наш сомелье у клиента сменился» → `CONTACT_NEW_DECISION_MAKER`; «Ирина больше не работает в ресторане» → `CONTACT_LEAVING`.

**Пример (evidence):** «Коллеги, с 1 декабря сеть "Винотека на Садовой" передаю Андрею, все договорённости по скидке и отсрочке в карточке клиента.»
**Контрпример:** «Андрей, подстрахуй меня по "Винотеке" на две недели, я в отпуске» → временная замена, это `TEAM_CAPACITY`.

**Заметка для карточки:** Назвать клиента и нового ответственного по роли; шаг — новому менеджеру представиться клиенту и сверить открытые вопросы (заказы, счета, договорённости).

### `TEAM_ESCALATION` — Внутренняя эскалация по клиенту

| Field | Value |
|---|---|
| Pack · block · family | base · J · team |
| Weight · class · kind · score rule | 6 · risk · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | gated · off |
| Display profile | from weight (P6) |
| Recipient role | team |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual effect: risk trigger (client dissatisfied) |

**Определение:** Коллега внутри компании поднимает проблему по клиенту на уровень выше (руководителю, другому отделу), часто без ведома ответственного менеджера: клиент недоволен, грозит уйти, есть конфликт.

**Граница (не считается):** Клиент сам пишет нашему руководителю или ставит его в копию → `COMPLAINT_ESCALATED`. Обычная внутренняя просьба помочь с заказом без проблемы клиента → нет сигнала.

**Признаки для промпта (≤ 8):** «эскалирую», «клиент очень недоволен», «нужна твоя помощь с клиентом», «грозятся уйти к другому поставщику», «надо срочно разобраться с», «подключи руководителя», «ситуация выходит из-под контроля», «звонил директор ресторана, ругался»

**Синонимы и выражения (полный список):**
- Деловая переписка: «довожу до вашего сведения ситуацию с клиентом», «прошу подключиться к вопросу», «выношу вопрос на уровень коммерческого директора», «требуется решение руководства», «клиент выражает серьёзное недовольство»
- Чаты / мессенджеры (разговорный стиль): «там с Ромашкой полный трэш», «клиент рвёт и мечет», «Саша, глянь срочно, у нас пожар по сети», «они говорят, что уйдут», «подключись, я не вытягиваю»
- Сокращения и термины: «эскалация», «ЛПР», «коммерческий», «КД» (коммерческий директор)
- Устойчивые конструкции / маркеры: «эскалирую / поднимаю вопрос» + клиент; «клиент недоволен» + «внутр.»; «нужно решение» + руководитель

**Похоже, но не это (анти-признаки):** письмо клиента с копией нашему директору → `COMPLAINT_ESCALATED`; «клиент спросил про отсрочку, что ответить?» → нет сигнала (рабочий вопрос).

**Пример (evidence):** «Олег Викторович, эскалирую: у "Гастробара 12" третья недовозка за месяц, управляющий сказал, что со следующего месяца переходят к другому поставщику.»
**Контрпример:** «Олег Викторович, клиент просит отгрузку в субботу, согласуем?» → рабочий вопрос без конфликта, нет сигнала.

**Заметка для карточки:** Назвать клиента и суть проблемы; шаг — ответственному менеджеру связаться с коллегой, который эскалировал, и согласовать один ответ клиенту.

### `TEAM_INSIDER` — Коллега поделился важным контекстом клиента

| Field | Value |
|---|---|
| Pack · block · family | base · J · team |
| Weight · class · kind · score rule | 5 · fyi · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | gated · off |
| Display profile | from weight (D4) |
| Recipient role | team |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual effect: none |

**Определение:** Коллега во внутренней переписке сообщает о клиенте то, чего нет в переписке с клиентом: планы, слухи с рынка, смену собственника, договорённости с конкурентом. По сути нейтрально.

**Граница (не считается):** Событие, которое видно из письма самого клиента, кодируется кодом этого события (например, `CONTACT_LEAVING`). Новость из СМИ → коды блока H. Проблема клиента, которую коллега эскалирует → `TEAM_ESCALATION`.

**Признаки для промпта (≤ 8):** «между нами», «по моей информации», «слышал от знакомого», «неофициально», «имей в виду, что», «они собираются», «мне шепнули», «на рынке говорят»

**Синонимы и выражения (полный список):**
- Деловая переписка: «для информации: по нашим данным», «неофициально стало известно», «учтите при переговорах», «конфиденциально, не для клиента»
- Чаты / мессенджеры (разговорный стиль): «чисто между нами», «слышал на дегустации, что они», «мне шепнули», «на рынке говорят», «знакомый сомелье сказал», «имей в виду»
- Сокращения и термины: «инсайд», «по секрету», «НДА не нарушаю»
- Устойчивые конструкции / маркеры: «по моей информации» + клиент + план; «они собираются / планируют» + действие

**Похоже, но не это (анти-признаки):** «клиент написал, что уходит сомелье» → `CONTACT_LEAVING`; статья о закрытии ресторана → `SIGNAL_DOWNSIZING`.

**Пример (evidence):** «Имей в виду: по моей информации, "Бистро Лаванда" в январе меняет собственника и будет пересматривать всех поставщиков.»
**Контрпример:** «Бистро Лаванда прислали заказ на пятницу» → рабочее сообщение, нет сигнала.

**Заметка для карточки:** Кратко передать контекст и источник (по роли); шаг — держать в виду к следующему разговору с клиентом, не ссылаться на источник.

### `TEAM_DEAL_LOST` — Коллега сообщил о проигрыше

| Field | Value |
|---|---|
| Pack · block · family | base · J · team |
| Weight · class · kind · score rule | 5 · risk · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | gated · off |
| Display profile | from weight (D4) |
| Recipient role | team |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual effect: none (the lost deal is about a similar client, not the one on the card) |

**Определение:** Коллега сообщает, что мы проиграли сделку, тендер или ввод в ассортимент у похожего клиента, и называет причину (цена, условия оплаты, ассортимент, конкурент).

**Граница (не считается):** Отказ, полученный от самого клиента → `SALES_OFFER_DECLINED`. Победа → `TEAM_DEAL_WON`. Сообщение без связи с клиентским сегментом, без причины и без клиента → нет сигнала.

**Признаки для промпта (≤ 8):** «проиграли тендер», «не взяли нас», «выбрали другого поставщика», «цена выше на», «не прошли по условиям оплаты», «ушли к конкуренту», «отказали в листинге», «причина отказа»

**Синонимы и выражения (полный список):**
- Деловая переписка: «по итогам тендера победил другой участник», «наше предложение не принято», «причина — цена выше рынка на», «клиент выбрал поставщика с отсрочкой 60 дней», «в ввод в ассортимент отказано»
- Чаты / мессенджеры (разговорный стиль): «слили сеть», «пролетели с тендером», «проиграли тендер, цена выше на 7 %», «Винный Альянс дал дешевле», «не взяли нас, говорят, нет нужных позиций»
- Сокращения и термины: «тендер», «листинг», «ввод», «НМЦК», «отсрочка»
- Устойчивые конструкции / маркеры: «проиграли / не взяли / отказали» + причина

**Похоже, но не это (анти-признаки):** «клиент пишет: ваше предложение нам не подходит» → `SALES_OFFER_DECLINED`; «выиграли тендер у отеля» → `TEAM_DEAL_WON`.

**Пример (evidence):** «Коллеги, проиграли тендер гостиничной группы: цена выше на 7 %, победил дистрибьютор с отсрочкой 45 дней.»
**Контрпример:** «Тендер гостиничной группы перенесли на январь» → нет проигрыша, нет сигнала.

**Заметка для карточки:** Назвать сегмент, причину и конкурента по роли; шаг — проверить, не грозит ли та же причина нашим похожим клиентам.

### `TEAM_CAPACITY` — Нехватка ресурсов или необходимость замены

| Field | Value |
|---|---|
| Pack · block · family | base · J · team |
| Weight · class · kind · score rule | 4 · risk · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | gated · off |
| Display profile | from weight (D4) |
| Recipient role | team |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual effect: none |

**Определение:** Коллега сообщает, что он или другой сотрудник будет недоступен (отпуск, больничный, командировка, перегрузка), и просит замену или объявляет, кто подменяет.

**Граница (не считается):** Постоянная передача клиентов → `TEAM_HANDOVER`. Автоответ клиента «я в отпуске» → `CONTACT_OOO`. Наш собственный автоответ → нет сигнала (автоматическое письмо).

**Признаки для промпта (≤ 8):** «подменишь», «на больничном до», «в отпуске с», «меня не будет», «кто подстрахует», «не успеваю», «завал», «нужна замена»

**Синонимы и выражения (полный список):**
- Деловая переписка: «на период моего отсутствия вопросы решает», «прошу назначить замещающего», «буду в командировке с 10 по 14», «не хватает ресурса на отгрузки», «склад перегружен»
- Чаты / мессенджеры (разговорный стиль): «подменишь меня по Ромашке?», «я на больничном до среды», «кто возьмёт мои заявки?», «я не успеваю, помогите», «у нас завал»
- Сокращения и термины: «замещающий», «и.о.», «больничный», «отпуск»
- Устойчивые конструкции / маркеры: «меня не будет / я в отпуске / на больничном» + срок; «подменишь / подстрахуешь» + клиент

**Похоже, но не это (анти-признаки):** «передаю клиента насовсем» → `TEAM_HANDOVER`; «Автоответ: нахожусь в отпуске» от клиента → `CONTACT_OOO`.

**Пример (evidence):** «Я на больничном до 20.11, Марина, подменишь по моим ресторанам? Заказы на пятницу уже в системе.»
**Контрпример:** «Марина, с декабря ты ведёшь мои рестораны насовсем» → `TEAM_HANDOVER`.

**Заметка для карточки:** Назвать, кто недоступен, до какой даты и кто подменяет; шаг — убедиться, что открытые заказы и вопросы клиентов не останутся без ответа.

### `TEAM_DEAL_WON` — Коллега сообщил о победе

| Field | Value |
|---|---|
| Pack · block · family | base · J · team |
| Weight · class · kind · score rule | 3 · chance · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | gated · off |
| Display profile | from weight (W1) |
| Recipient role | team |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual effect: none (the won deal is about a similar client) |

**Определение:** Коллега сообщает о выигранной сделке, тендере или вводе в ассортимент у похожего клиента — повод повторить подход у своих клиентов.

**Граница (не считается):** Заказ или подтверждение от самого клиента → `SALES_BOOKING_RECEIVED` / `ORDER_REQUESTED`. Проигрыш → `TEAM_DEAL_LOST`.

**Признаки для промпта (≤ 8):** «выиграли тендер», «зашли в сеть», «взяли в карту», «подписали договор поставки», «нас выбрали», «закрыли сделку», «ввели в ассортимент», «дожали»

**Синонимы и выражения (полный список):**
- Деловая переписка: «по итогам тендера наше предложение признано лучшим», «подписан договор поставки с», «наши позиции введены в ассортимент», «согласован листинг»
- Чаты / мессенджеры (разговорный стиль): «ура, зашли в сеть!», «нас взяли в винную карту», «дожали отель», «закрыли сделку с Ромашкой», «победа по тендеру»
- Сокращения и термины: «листинг», «ввод», «СТМ», «тендер»
- Устойчивые конструкции / маркеры: «выиграли / взяли / зашли / подписали» + клиент + условия

**Похоже, но не это (анти-признаки):** «клиент прислал заказ на 20 коробок» → `ORDER_REQUESTED`; «тендер ещё идёт» → нет сигнала.

**Пример (evidence):** «Коллеги, зашли в карту "Гриль-бара Север" с тремя позициями игристого — помогла дегустация для персонала.»
**Контрпример:** «Север просит образцы игристого» → `SAMPLES_REQUESTED`, это не победа.

**Заметка для карточки:** Назвать клиента-пример, сегмент и что сработало; шаг — проверить, каким нашим похожим клиентам подходит тот же подход.

## K · Аккаунт (данные CRM)

All K codes are made by a scheduled process from CRM data (spec §5.6, origin `system_of_record`, phase 8). The LLM never emits them. They are not in the extraction prompt.

Common data rules for every K code (apply them to each trigger rule below):

- **Revenue data:** table `order` with `status IN ('confirmed', 'finalized')`, business date = `order.order_date`, amount = order total net of the per-client discount (`order.discount_percent`). Use the same CTE as the `/analytics` page, so a card number never differs from the dashboard number. `draft`, `awaiting_client` and `cancelled` orders are not revenue.
- **Line data:** `order_item` joined to `product` (product key = `product.id`; group = `product.category`).
- **Client data:** `client` (status `active` only; `blocked` and `deleted` clients never get a K card), `client.responsible_user_id` = recipient (role `account`).
- **Org scope:** the process runs per org and binds the org id. It never reads other orgs.
- **Insufficient data → no instance.** A K code never gives a definitive warning on thin data (Q24-11).
- **Evidence:** a Russian data fact in one line (for example «последний заказ 14.03.2026; обычный ритм 30 дней»). All numbers also go to `facts` (amounts in RUB, dates, counts).
- **Cooldown:** `cards.trendCooldownDays` = 90 (v204) per client + code, counted from the close or expiry of the last card. A change of direction (decline → growth, or growth → decline) makes a new card at once.
- **Months:** a "full month" is a closed calendar month in the org time zone. The run uses the months before the run date, never the current month.

| Code | Название (RU) | W | Class | Kind | Score rule | Effort | Asks us | Inbound only | Amount | Stage (pack) | IN4COM | Profile | Recipient | Family |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `ACCOUNT_REVENUE_STAGNATION` | Стагнация выручки по клиенту | 5 | risk | trend | fixed | medium | no | — | no | onHold | off | D4 (trend ceiling D4) | account | account |
| `ACCOUNT_REVENUE_DECLINE_YOY` | Снижение выручки по клиенту год к году | 5 | risk | trend | fixed | medium | no | — | no | active | review | D4 (trend ceiling D4) | account | account |
| `ACCOUNT_DORMANT` | Клиент перестал покупать | 5 | risk | watchdog | fixed | medium | no | — | no | active | review | D4 | account | account |
| `ACCOUNT_PRODUCT_NEW` | Клиент впервые купил позицию | 4 | chance | event | fixed | medium | no | — | no | onHold | off | D4 | account | account |
| `ACCOUNT_PRODUCT_STOPPED` | Клиент перестал покупать позицию | 5 | risk | trend | fixed | medium | no | — | no | active | review | D4 (trend ceiling D4) | account | account |
| `ACCOUNT_REVENUE_GROWTH_YOY` | Рост выручки по клиенту год к году | 4 | chance | trend | fixed | medium | no | — | no | active | review | D4 (trend ceiling D4) | account | account |
| `ACCOUNT_CROSS_SELL_GAP` | Неиспользованная возможность перекрёстной продажи | 4 | chance | trend | fixed | medium | no | — | no | parked | off | D4 (trend ceiling D4) | account | account |
| `ACCOUNT_MEETING_OVERDUE` | Давно не было встречи с клиентом | 4 | risk | trend | fixed | medium | no | — | no | onHold | off | D4 (trend ceiling D4) | account | account |
| `ACCOUNT_SEGMENT_UPGRADED` | Повысился сегмент клиента | 4 | chance | event | fixed | medium | no | — | no | parked | off | D4 | account | account |
| `ACCOUNT_SEGMENT_DOWNGRADED` | Снизился сегмент клиента | 5 | risk | event | fixed | medium | no | — | no | parked | off | D4 | account | account |
| `ACCOUNT_NEW_FOLLOWUP` | Пора обсудить результат первого заказа | 4 | chance | event | fixed | medium | no | — | no | onHold | off | D4 | account | account |
| `ACCOUNT_REACTIVATION_DUE` | Пора возобновить контакт с бывшим клиентом | 4 | chance | watchdog | fixed | quick | no | — | no | active | review | D4 | account | account |

### `ACCOUNT_REVENUE_STAGNATION` — Стагнация выручки по клиенту

| Field | Value |
|---|---|
| Pack · block · family | base · K · account |
| Weight · class · kind · score rule | 5 · risk · trend · fixed |
| Effort · asks us · inbound only · amount | medium · no · — · no |
| Emitted by | process |
| Stage (pack default) · IN4COM | onHold · off |
| Display profile | from weight (D4); trend ceiling D4 |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: — (expires; a later `ACCOUNT_REVENUE_GROWTH_YOY` is a change of direction) |
| Relations | `ACCOUNT_REVENUE_DECLINE_YOY` leads over this code (the current loss leads; the stagnation is context) |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual: none |

**Определение:** Выручка по клиенту за несколько лет не растёт: хотя бы в одном из последних трёх полных календарных лет она упала на заданный порог или больше, и последние 12 месяцев не выше лучшего из этих лет.

**Граница (не считается):** Текущее падение последних 12 месяцев к прошлому году → `ACCOUNT_REVENUE_DECLINE_YOY` (он ведёт). Клиент совсем перестал заказывать → `ACCOUNT_DORMANT`. Разовое падение одного года на фоне общего роста — не стагнация.

**Признаки для промпта:** — (not in the extraction prompt; emitted by process)

**Правило срабатывания (trigger rule):**
- RU: Данные — подтверждённые и завершённые заказы клиента по годам. Окно — три последних полных календарных года + скользящие 12 полных месяцев. База — выручка предыдущего года для каждого из трёх лет. Минимум данных — заказы в каждом из четырёх последних календарных лет и выручка лучшего года не ниже `cards.revenueTrendMinRub` (предложение: 100 000 ₽). Порог — падение год к году не меньше `cards.revenueStagnationThresholdPct` (предложение: 5 %) хотя бы в одном из трёх лет, и выручка последних 12 месяцев не выше лучшего года больше чем на `cards.revenueGrowthThresholdPct` (10 %). Запуск — ежемесячно, 3-го числа, 07:00. Повтор — не раньше `cards.trendCooldownDays` (90 дней) по клиенту и коду. Если в том же запуске срабатывает `ACCOUNT_REVENUE_DECLINE_YOY`, этот код идёт в карточку только как контекст.
- EN: Data = the client's confirmed + finalized orders per calendar year. Window = the last 3 full calendar years + the rolling last 12 full months. Baseline = the previous year for each of the 3 years. Minimum data = orders in each of the last 4 calendar years and best-year revenue ≥ `cards.revenueTrendMinRub` (proposed 100 000 RUB). Threshold = a year-on-year drop ≥ `cards.revenueStagnationThresholdPct` (proposed 5 %) in at least one of the 3 years, and the last 12 months not more than `cards.revenueGrowthThresholdPct` (10 %) above the best year. Run monthly, day 3, 07:00. Cooldown 90 days per client + code.
- Evidence format: «выручка 2024: 1,8 млн ₽; 2025: 1,6 млн ₽ (−11 %); последние 12 мес.: 1,7 млн ₽».

**Пример (evidence):** «выручка 2023: 2,1 млн ₽; 2024: 1,9 млн ₽ (−10 %); 2025: 2,0 млн ₽; последние 12 мес.: 1,95 млн ₽»
**Контрпример:** «выручка 2024: 1,5 млн ₽; 2025: 1,9 млн ₽ (+27 %)» → рост, не стагнация.

**Заметка для карточки:** Напиши, что клиент годами не растёт у нас, и предложи менеджеру при следующем контакте узнать планы клиента и чем мы можем помочь расти, без ценового предложения первым шагом.

### `ACCOUNT_REVENUE_DECLINE_YOY` — Снижение выручки по клиенту год к году

| Field | Value |
|---|---|
| Pack · block · family | base · K · account |
| Weight · class · kind · score rule | 5 · risk · trend · fixed |
| Effort · asks us · inbound only · amount | medium · no · — · no |
| Emitted by | process |
| Stage (pack default) · IN4COM | active · review |
| Display profile | from weight (D4); trend ceiling D4 |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: — (expires; a later `ACCOUNT_REVENUE_GROWTH_YOY` makes a new card at once) |
| Relations | leads over `ACCOUNT_REVENUE_STAGNATION`; `SALES_BOOKING_CANCELLED` leads over this code (one cancellation card, the decline is context in it) |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual: risk trigger «Клиент покупает меньше» on an open supply-agreement / listing deal of this client; no stage move |

**Определение:** Клиент покупает у нас заметно меньше: выручка за последние 12 полных месяцев ниже, чем за те же 12 месяцев год назад, на порог или больше. Клиент при этом продолжает заказывать.

**Граница (не считается):** Клиент не заказывает дольше своего ритма → `ACCOUNT_DORMANT` (не этот код). Перестал брать отдельную позицию, а общий объём держится → `ACCOUNT_PRODUCT_STOPPED`. Клиент сам написал, что выводит наши позиции из карты или ассортимента → `DELISTING_RISK` (пакет distribution). Падение ниже порога или на малой базе — нет сигнала. Отмена конкретного заказа в письме → `SALES_BOOKING_CANCELLED` (он ведёт).

**Признаки для промпта:** — (not in the extraction prompt; emitted by process)

**Правило срабатывания (trigger rule):**
- RU: Данные — подтверждённые и завершённые заказы клиента, сумма за вычетом скидки клиента. Окно — последние 12 полных месяцев (скользящие; сезонность, например декабрьский пик, так выравнивается). База — те же 12 месяцев годом раньше. Минимум данных — первый заказ клиента не позже чем за 24 месяца до запуска, в базовом периоде не меньше 3 заказов и выручка базы не ниже `cards.revenueTrendMinRub` (предложение: 100 000 ₽). Порог — падение не меньше `cards.revenueDeclineThresholdPct` (предложение: 15 %) и не меньше `cards.revenueDeclineMinRub` (предложение: 100 000 ₽) в рублях. Не создавать, если в текущем окне нет ни одного заказа или по клиенту открыт `ACCOUNT_DORMANT` — это случай «перестал покупать». Запуск — ежемесячно, 3-го числа, 07:00. Повтор — не раньше `cards.trendCooldownDays` (90 дней) по клиенту и коду; смена направления (рост) создаёт новую карточку сразу.
- EN: Data = the client's confirmed + finalized orders, net of the client discount. Window = the last 12 full months (rolling; this evens out seasonality such as the December peak). Baseline = the same 12 months one year earlier. Minimum data = first order ≥ 24 months before the run, ≥ 3 orders in the baseline, baseline revenue ≥ `cards.revenueTrendMinRub` (proposed 100 000 RUB). Threshold = decline ≥ `cards.revenueDeclineThresholdPct` (proposed 15 %) AND ≥ `cards.revenueDeclineMinRub` (proposed 100 000 RUB). Skip when the window has no order or `ACCOUNT_DORMANT` is open for the client. Run monthly, day 3, 07:00. Cooldown 90 days per client + code; a change of direction makes a new card at once.
- Evidence format: «выручка за 12 мес. (11.2025–10.2026): 1,2 млн ₽; год назад: 1,6 млн ₽ (−25 %, −400 тыс. ₽); заказов 9 против 14».

**Пример (evidence):** «выручка за 12 мес. (11.2025–10.2026): 840 тыс. ₽; за 11.2024–10.2025: 1,15 млн ₽ (−27 %); заказов 11 против 17»
**Контрпример:** «выручка за 12 мес.: 1,02 млн ₽; год назад: 1,10 млн ₽ (−7 %)» → ниже порога 15 %, сигнала нет.

**Заметка для карточки:** Напиши, что клиент покупает у нас меньше, чем год назад (цифры и период), и предложи менеджеру связаться с закупщиком или сомелье клиента (по роли), чтобы узнать причину и планы, пока следующий период открыт; ценовое предложение только после этого.

### `ACCOUNT_DORMANT` — Клиент перестал покупать

| Field | Value |
|---|---|
| Pack · block · family | base · K · account |
| Weight · class · kind · score rule | 5 · risk · watchdog · fixed (class fyi when the pause is longer than 2× the rhythm — the process sets it) |
| Effort · asks us · inbound only · amount | medium · no · — · no |
| Emitted by | process |
| Stage (pack default) · IN4COM | active · review |
| Display profile | from weight (D4) |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: a new confirmed or finalized order of this client (the watchdog closes the card on the next run) |
| Relations | — (v204 has no relation for this code); boundary with `ACCOUNT_REVENUE_DECLINE_YOY`: the process does not emit the decline while this card is open |
| Date gate | — |
| Relevance window | until the next order of the client, or card expiry |
| Deal effect | per org rule; usual: risk trigger «Клиент перестал заказывать» on an open supply-agreement / listing deal of this client; no stage move |

**Определение:** Клиент раньше регулярно покупал у нас (лучший год не ниже порога), но не сделал заказ в пределах своего обычного ритма, и вперёд ничего не заказано. Пауза длиннее ритма — риск потерять клиента; длиннее двух ритмов — клиент «затих», информационная карточка.

**Граница (не считается):** Клиент заказывает, но меньше → `ACCOUNT_REVENUE_DECLINE_YOY`. Не берёт одну позицию, а другие заказывает → `ACCOUNT_PRODUCT_STOPPED`. Нет вообще никакого контакта с бывшим клиентом или лидом → `ACCOUNT_REACTIVATION_DUE`. Клиент сам написал «больше не будем брать» → `DELISTING_RISK` или `CONTRACT_TERMINATED`. Есть заказ в статусе `draft` или `awaiting_client` — сигнала нет.

**Признаки для промпта:** — (not in the extraction prompt; emitted by process)

**Правило срабатывания (trigger rule):**
- RU: Данные — даты подтверждённых и завершённых заказов клиента (`order.order_date`). Ритм (v204): 3 и больше заказов — средний интервал между ними; 2 заказа — этот один интервал; 1 заказ — 12 месяцев; ритм не короче `cards.dormantRhythmFloorDays` (v204: 3 месяца = 90 дней). Минимум данных — лучший календарный год клиента у нас не ниже `cards.dormantMinBestYearRub` (предложение: 300 000 ₽; в v204 — 20 000 €). «Вперёд ничего не заказано» — у клиента нет заказа в статусе `draft`, `awaiting_client` или `confirmed` с датой после последнего заказа. Порог — пауза от последнего заказа до даты запуска больше ритма → risk; больше двух ритмов → fyi. Запуск — ежемесячно, 3-го числа, 07:00. Одна карточка на клиента и последний заказ: пока последний заказ тот же, новая карточка не создаётся (кулдаун 90 дней не нужен). Новый заказ закрывает вопрос.
- EN: Data = dates of the client's confirmed + finalized orders (`order.order_date`). Rhythm (v204): ≥ 3 orders → the average gap; 2 orders → that one gap; 1 order → 12 months; never shorter than `cards.dormantRhythmFloorDays` (v204: 3 months = 90 days). Minimum data = best calendar year with us ≥ `cards.dormantMinBestYearRub` (proposed 300 000 RUB; v204 uses EUR 20 000). Nothing booked ahead = no order in `draft`, `awaiting_client` or `confirmed` dated after the last order. Threshold = pause > rhythm → risk; pause > 2 × rhythm → fyi. Run monthly, day 3, 07:00. One card per client and last order; a new order closes it.
- Distributor proposal (open point): rhythm = the MEDIAN gap of the last 12 months (HoReCa orders weekly; one old gap must not stretch the average), floor 21 days instead of 90.
- Evidence format: «последний заказ 14.03.2026; обычный ритм 30 дней; пауза 230 дней; лучший год 2025: 1,4 млн ₽».

**Пример (evidence):** «последний заказ 02.08.2026; обычный ритм 21 день (средний интервал по 18 заказам); пауза 92 дня; лучший год 2025: 960 тыс. ₽»
**Контрпример:** «последний заказ 20.10.2026; обычный ритм 30 дней; пауза 22 дня» → пауза короче ритма, сигнала нет.

**Заметка для карточки:** Это возврат клиента, а не жалоба: назови, что и когда клиент заказывал в последний раз, его обычный ритм и лучший год; при риске предложи связаться с закупщиком клиента (по роли) и узнать причину и планы, при «затих» — сохранить к следующему разговору, без ценового предложения первым шагом.

### `ACCOUNT_PRODUCT_NEW` — Клиент впервые купил позицию

| Field | Value |
|---|---|
| Pack · block · family | base · K · account |
| Weight · class · kind · score rule | 4 · chance · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · — · no |
| Emitted by | process |
| Stage (pack default) · IN4COM | onHold · off |
| Display profile | from weight (D4) |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | 30 days from the order date |
| Deal effect | per org rule; usual: none |

**Определение:** Клиент впервые за всю историю заказал позицию (товар), которую раньше у нас не брал. Повод предложить сопутствующие или похожие позиции.

**Граница (не считается):** Первый заказ нового клиента вообще → `ACCOUNT_NEW_FOLLOWUP`. Клиент снова взял позицию после перерыва — не новая. Новый винтаж той же позиции, если в каталоге это та же позиция — не новая. Клиент в письме просит ввести позиции в карту → `LISTING_OPPORTUNITY` (пакет distribution).

**Признаки для промпта:** — (not in the extraction prompt; emitted by process)

**Правило срабатывания (trigger rule):**
- RU: Данные — `order_item` подтверждённых и завершённых заказов клиента. Условие — `product.id` нет ни в одном более раннем заказе клиента; у клиента есть хотя бы один более ранний заказ. Минимум данных — история заказов клиента не короче 6 месяцев. Одна карточка на заказ (все новые позиции заказа — в одной карточке). Запуск — ежедневно, 07:00, по заказам, подтверждённым за сутки.
- EN: Data = `order_item` of the client's confirmed + finalized orders. Condition = the `product.id` is in no earlier order of the client, and the client has at least one earlier order. Minimum data = ≥ 6 months of order history. One card per order (all new products of the order in one card). Run daily, 07:00, over orders confirmed in the last day.
- Evidence format: «заказ № 1245 от 05.11.2026: впервые взяли Шабли Премье Крю 2022 (12 бут.)».

**Пример (evidence):** «заказ № 1245 от 05.11.2026: впервые взяли 2 позиции — Шабли Премье Крю 2022 (12 бут.), Кальвадос Pays d'Auge (6 бут.)»
**Контрпример:** «заказ № 1250: Просекко DOC, последний раз брали в марте 2026» → позиция не новая.

**Заметка для карточки:** Назови новую позицию и предложи менеджеру при следующем контакте узнать, как она пошла у гостей или покупателей, и показать близкие позиции портфеля.

### `ACCOUNT_PRODUCT_STOPPED` — Клиент перестал покупать позицию

| Field | Value |
|---|---|
| Pack · block · family | base · K · account |
| Weight · class · kind · score rule | 5 · risk · trend · fixed |
| Effort · asks us · inbound only · amount | medium · no · — · no |
| Emitted by | process |
| Stage (pack default) · IN4COM | active · review |
| Display profile | from weight (D4); trend ceiling D4 (v204 kind = trend) |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: a new order of this product by the client |
| Relations | — |
| Date gate | — |
| Relevance window | until the next order of the product, or card expiry |
| Deal effect | per org rule; usual: risk trigger on an open listing deal that contains this product; no stage move |

**Определение:** Клиент регулярно брал у нас определённую позицию, но перестал её заказывать, хотя другие позиции продолжает брать.

**Граница (не считается):** Клиент вообще перестал заказывать → `ACCOUNT_DORMANT`. Позиция у нас выведена из каталога или её нет у поставщика → не этот код (`INTERNAL_PRODUCT_STATUS_UPDATE` или `SUPPLIER_DELIVERY_DELAY`). Клиент сам написал «убираем из карты» → `DELISTING_RISK` (пакет distribution). Общий объём упал, а позиция берётся → `ACCOUNT_REVENUE_DECLINE_YOY`.

**Признаки для промпта:** — (not in the extraction prompt; emitted by process)

**Правило срабатывания (trigger rule):**
- RU: Данные — `order_item` подтверждённых и завершённых заказов клиента по `product.id`. Ритм позиции — медианный интервал между заказами этой позиции. Минимум данных — позицию брали не меньше чем в `cards.productMinOrders` (предложение: 4) отдельных заказах за последние 24 месяца. Порог — последний заказ позиции старше max(2 × ритм позиции, `cards.productStoppedMinDays` — предложение: 90 дней). Условия — клиент за это время сделал другие заказы (последний заказ клиента в пределах его ритма, иначе это `ACCOUNT_DORMANT`); позиция активна в нашем каталоге (`product.status = 'active'`) и не числится в открытой задержке поставщика. Правило v204 (позиция с минимальной частотой три года подряд и ни разу за последние 12 месяцев) — как запасное, если у позиции меньше 4 заказов. Запуск — ежемесячно, 3-го числа, 07:00. Одна карточка на клиента и позицию; повтор — не раньше `cards.trendCooldownDays` (90 дней).
- EN: Data = `order_item` of the client's confirmed + finalized orders per `product.id`. Product rhythm = the median gap between orders of that product. Minimum data = the product in ≥ `cards.productMinOrders` (proposed 4) separate orders in the last 24 months. Threshold = the last order of the product is older than max(2 × product rhythm, `cards.productStoppedMinDays`, proposed 90 days). Conditions = the client placed other orders in that time (last order within the client rhythm, else `ACCOUNT_DORMANT`); the product is active in our catalogue (`product.status = 'active'`) and not under an open supplier delay. The v204 rule (bought at the minimum frequency 3 years running, none in the last 12 months) is the fallback when the product has < 4 orders. Run monthly, day 3, 07:00. One card per client and product; cooldown 90 days.
- Evidence format: «Риоха Крианса 2020: брали каждые ~28 дней (9 заказов за 24 мес.), последний раз 12.06.2026; другие позиции клиент заказывал 28.10.2026».

**Пример (evidence):** «Риоха Крианса 2020: 9 заказов за 24 мес., ритм 28 дней; последний заказ позиции 12.06.2026 (147 дней назад); последний заказ клиента 28.10.2026»
**Контрпример:** «Риоха Крианса 2020: последний заказ 12.06.2026; позиция снята с продажи (статус в каталоге — неактивна)» → причина у нас, не у клиента.

**Заметка для карточки:** Назови позицию, обычный ритм и дату последнего заказа; предложи менеджеру узнать у закупщика или сомелье клиента (по роли), почему позицию больше не берут, и только потом предложить её снова или замену, а не скидку.

### `ACCOUNT_REVENUE_GROWTH_YOY` — Рост выручки по клиенту год к году

| Field | Value |
|---|---|
| Pack · block · family | base · K · account |
| Weight · class · kind · score rule | 4 · chance · trend · fixed |
| Effort · asks us · inbound only · amount | medium · no · — · no |
| Emitted by | process |
| Stage (pack default) · IN4COM | active · review |
| Display profile | from weight (D4); trend ceiling D4 |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: — (expires; a later decline makes a new card at once) |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual: none |

**Определение:** Клиент покупает у нас заметно больше: выручка за последние 12 полных месяцев выше, чем за те же месяцы год назад, на порог или больше. Повод укрепить отношения и расширить ассортимент.

**Граница (не считается):** Один крупный заказ в письме → это заказ (`ORDER_REQUESTED` пакета distribution), не тренд. Рост ниже порога или на малой базе — нет сигнала. Клиент сам сообщил об открытии новой точки → `NEW_VENUE_OPENING` (пакет distribution).

**Признаки для промпта:** — (not in the extraction prompt; emitted by process)

**Правило срабатывания (trigger rule):**
- RU: Данные, окно, база и минимум данных — как у `ACCOUNT_REVENUE_DECLINE_YOY` (12 полных месяцев против тех же месяцев год назад; первый заказ не позже чем за 24 месяца; не меньше 3 заказов в базе; выручка базы не ниже `cards.revenueTrendMinRub`, предложение: 100 000 ₽). Порог — рост не меньше `cards.revenueGrowthThresholdPct` (v204: 10 %) и не меньше `cards.revenueGrowthMinRub` (предложение: 100 000 ₽). Запуск — ежемесячно, 3-го числа, 07:00. Повтор — не раньше `cards.trendCooldownDays` (90 дней); смена направления (снижение) создаёт новую карточку сразу.
- EN: Data, window, baseline and minimum data = as `ACCOUNT_REVENUE_DECLINE_YOY`. Threshold = growth ≥ `cards.revenueGrowthThresholdPct` (v204: 10 %) AND ≥ `cards.revenueGrowthMinRub` (proposed 100 000 RUB). Run monthly, day 3, 07:00. Cooldown 90 days; a change of direction makes a new card at once.
- Evidence format: «выручка за 12 мес. (11.2025–10.2026): 2,3 млн ₽; год назад: 1,7 млн ₽ (+35 %, +600 тыс. ₽)».

**Пример (evidence):** «выручка за 12 мес. (11.2025–10.2026): 2,3 млн ₽; за 11.2024–10.2025: 1,7 млн ₽ (+35 %); заказов 26 против 19»
**Контрпример:** «выручка за 12 мес.: 1,05 млн ₽; год назад: 1,00 млн ₽ (+5 %)» → ниже порога 10 %, сигнала нет.

**Заметка для карточки:** Это возможность, а не риск: назови рост в цифрах и предложи менеджеру узнать у клиента (по роли), что даёт рост и что планируется дальше, затем подобрать предложение по расширению ассортимента.

### `ACCOUNT_CROSS_SELL_GAP` — Неиспользованная возможность перекрёстной продажи

| Field | Value |
|---|---|
| Pack · block · family | base · K · account |
| Weight · class · kind · score rule | 4 · chance · trend · fixed |
| Effort · asks us · inbound only · amount | medium · no · — · no |
| Emitted by | process |
| Stage (pack default) · IN4COM | parked · off |
| Display profile | from weight (D4); trend ceiling D4 |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual: none |

**Определение:** Клиент берёт у нас только одну группу товаров (например, только вино), хотя по профилю похожих клиентов ему подходят и другие группы (крепкие напитки, игристое). Припарковано в v204: нет основания для рекомендации без отраслевого правила или сравнения клиентов.

**Граница (не считается):** Клиент сам спросил о другой группе → `SALES_NEW_DEMAND` или `SALES_PRICE_REQUEST`. Клиент по лицензии или формату не может брать группу (например, без крепкого алкоголя) — не пробел.

**Признаки для промпта:** — (not in the extraction prompt; emitted by process)

**Правило срабатывания (trigger rule):**
- RU: Данные — `product.category` в заказах клиента за 12 месяцев и в заказах похожих клиентов того же типа (`client.custom_fields.type`). Условие — клиент берёт одну категорию, а не меньше 60 % клиентов того же типа берут две и больше; выручка клиента за 12 месяцев не ниже `cards.revenueTrendMinRub`. Запуск — ежемесячно. Повтор — не раньше 90 дней. Код остаётся припаркованным, пока нет правила сравнения клиентов.
- EN: Data = `product.category` in the client's orders over 12 months and in the orders of clients of the same type. Condition = the client buys one category while ≥ 60 % of same-type clients buy two or more; 12-month revenue ≥ `cards.revenueTrendMinRub`. Run monthly. Cooldown 90 days. Stays parked until a client-comparison rule exists.
- Evidence format: «за 12 мес. только вино (100 % выручки); у 70 % ресторанов того же типа есть и крепкие напитки».

**Пример (evidence):** «за 12 мес. клиент брал только тихие вина (18 заказов); 72 % клиентов типа HoReCa берут ещё игристое и крепкие напитки»

**Заметка для карточки:** Предложи сочетание с другой группой только с понятной пользой для клиента (меню, гости, сезон), а не потому, что это больше выручки для нас.

### `ACCOUNT_MEETING_OVERDUE` — Давно не было встречи с клиентом

| Field | Value |
|---|---|
| Pack · block · family | base · K · account |
| Weight · class · kind · score rule | 4 · risk · trend · fixed |
| Effort · asks us · inbound only · amount | medium · no · — · no |
| Emitted by | process |
| Stage (pack default) · IN4COM | onHold · off |
| Display profile | from weight (D4); trend ceiling D4 |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: a registered meeting with the client (calendar invite or meeting record) |
| Relations | — |
| Date gate | — |
| Relevance window | until the next meeting, or card expiry |
| Deal effect | per org rule; usual: none |

**Определение:** С клиентом не было встречи дольше, чем требует частота для его сегмента. Проверка по всем подключённым источникам (календарные приглашения, встречи в переписке, задачи типа «встреча»).

**Граница (не считается):** Клиент отменил конкретную встречу → `MEETING_CANCEL`. Нет никакого контакта с бывшим клиентом → `ACCOUNT_REACTIVATION_DUE`. Переписка и заказы идут, а встречи нет — это этот код, только если у клиента задан сегмент.

**Признаки для промпта:** — (not in the extraction prompt; emitted by process)

**Правило срабатывания (trigger rule):**
- RU: Данные — встречи с клиентом из календарных приглашений (.ics в письмах), событий календаря и задач-встреч; сегмент клиента (поля сегмента в CRM пока нет — поэтому код отложен). Порог — с последней встречи прошло больше `cards.meetingFrequencyADays` / `BDays` / `CDays` (предложение: 30 / 90 / 180 дней). Минимум данных — у клиента задан сегмент и подключён хотя бы один календарный источник. Запуск — еженедельно, понедельник 07:00. Повтор — не раньше 90 дней.
- EN: Data = meetings with the client from calendar invites (.ics in mail), calendar events and meeting tasks; the client segment (no segment field exists yet — that is why the code is on hold). Threshold = the last meeting is older than `cards.meetingFrequencyADays` / `BDays` / `CDays` (proposed 30 / 90 / 180 days). Minimum data = a segment is set and at least one calendar source is connected. Run weekly, Monday 07:00. Cooldown 90 days.
- Evidence format: «сегмент A; последняя встреча 12.07.2026 (122 дня назад); норма — раз в 30 дней».

**Пример (evidence):** «сегмент A; последняя встреча 12.07.2026 (дегустация в ресторане); прошло 122 дня; норма — раз в 30 дней»

**Заметка для карточки:** Попроси менеджера назначить встречу или визит к клиенту (по роли), не проводить расследование.

### `ACCOUNT_SEGMENT_UPGRADED` — Повысился сегмент клиента

| Field | Value |
|---|---|
| Pack · block · family | base · K · account |
| Weight · class · kind · score rule | 4 · chance · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · — · no |
| Emitted by | process |
| Stage (pack default) · IN4COM | parked · off |
| Display profile | from weight (D4) |
| Recipient role | account |
| Closes / closed by | closes: `ACCOUNT_SEGMENT_DOWNGRADED` (an open card of the same client) · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual: none |

**Определение:** Сегмент клиента в CRM повысился (например, B → A). Припарковано в v204: модель сегментов не проработана; в CRM нет поля сегмента.

**Граница (не считается):** Рост выручки без смены сегмента → `ACCOUNT_REVENUE_GROWTH_YOY`. Ручная правка сегмента менеджером без изменения данных — не сигнал.

**Признаки для промпта:** — (not in the extraction prompt; emitted by process)

**Правило срабатывания (trigger rule):**
- RU: Данные — сегмент клиента, рассчитанный ежемесячно по выручке за 12 месяцев (предложение: A — верхние 20 % выручки организации, B — следующие 30 %, C — остальные). Условие — сегмент выше прошлого расчёта два месяца подряд. Запуск — ежемесячно, 3-го числа. Одна карточка на смену сегмента.
- EN: Data = the client segment, computed monthly from 12-month revenue (proposed: A = top 20 % of org revenue, B = next 30 %, C = the rest). Condition = the segment is higher than in the previous computation for 2 months in a row. Run monthly, day 3. One card per segment change.
- Evidence format: «сегмент B → A с 11.2026; выручка за 12 мес.: 3,1 млн ₽».

**Пример (evidence):** «сегмент B → A (октябрь и ноябрь 2026); выручка за 12 мес.: 3,1 млн ₽, 14-е место из 220 клиентов»

**Заметка для карточки:** Напиши, что клиент вырос до верхнего сегмента, и предложи менеджеру пересмотреть уровень сервиса и частоту контактов.

### `ACCOUNT_SEGMENT_DOWNGRADED` — Снизился сегмент клиента

| Field | Value |
|---|---|
| Pack · block · family | base · K · account |
| Weight · class · kind · score rule | 5 · risk · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · — · no |
| Emitted by | process |
| Stage (pack default) · IN4COM | parked · off |
| Display profile | from weight (D4) |
| Recipient role | account |
| Closes / closed by | closes: `ACCOUNT_SEGMENT_UPGRADED` (an open card of the same client) · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual: none |

**Определение:** Сегмент клиента в CRM понизился (например, B → C). Припарковано в v204: модель сегментов не проработана; в CRM нет поля сегмента.

**Граница (не считается):** Падение выручки без смены сегмента → `ACCOUNT_REVENUE_DECLINE_YOY`. Клиент перестал заказывать → `ACCOUNT_DORMANT`.

**Признаки для промпта:** — (not in the extraction prompt; emitted by process)

**Правило срабатывания (trigger rule):**
- RU: Как у `ACCOUNT_SEGMENT_UPGRADED`, но сегмент ниже прошлого расчёта два месяца подряд. Если в том же запуске есть `ACCOUNT_REVENUE_DECLINE_YOY` по клиенту — карточка одна, сегмент идёт как контекст.
- EN: As `ACCOUNT_SEGMENT_UPGRADED`, but the segment is lower than in the previous computation for 2 months in a row. When `ACCOUNT_REVENUE_DECLINE_YOY` fires for the client in the same run, write one card; the segment is context.
- Evidence format: «сегмент B → C с 11.2026; выручка за 12 мес.: 420 тыс. ₽».

**Пример (evidence):** «сегмент B → C (октябрь и ноябрь 2026); выручка за 12 мес.: 420 тыс. ₽ против 1,1 млн ₽ год назад»

**Заметка для карточки:** Напиши, что клиент опустился в сегменте, и предложи менеджеру узнать причину при следующем контакте с закупщиком клиента (по роли).

### `ACCOUNT_NEW_FOLLOWUP` — Пора обсудить результат первого заказа

| Field | Value |
|---|---|
| Pack · block · family | base · K · account |
| Weight · class · kind · score rule | 4 · chance · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · — · no |
| Emitted by | process |
| Stage (pack default) · IN4COM | onHold · off |
| Display profile | from weight (D4) |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: any contact with the client after the first order (outbound mail or message, meeting, call task done) or a second order |
| Relations | — |
| Date gate | — |
| Relevance window | 14 days after the trigger |
| Deal effect | per org rule; usual: none |

**Определение:** Новый клиент получил первый заказ заданное число дней назад, и после этого с ним не было контакта. Пора узнать, как прошла поставка и как продаются позиции, и подвести клиента ко второму заказу.

**Граница (не считается):** Клиент сам написал о проблеме с поставкой → `COMPLAINT_*` или `DELIVERY_DISCREPANCY`. Повторный клиент → не этот код. Новая позиция у постоянного клиента → `ACCOUNT_PRODUCT_NEW`.

**Признаки для промпта:** — (not in the extraction prompt; emitted by process)

**Правило срабатывания (trigger rule):**
- RU: Данные — первый заказ клиента в статусе `finalized` (отгружен), его дата; источники с привязкой к клиенту после этой даты (письма, сообщения, встречи, задачи) и заказы. Порог — прошло `cards.newClientFollowupDays` (предложение: 14 дней) с первого заказа, нет исходящего контакта и нет второго заказа. Запуск — ежедневно, 07:00. Одна карточка на клиента.
- EN: Data = the client's first order in status `finalized` (shipped) and its date; client-linked items after that date (mail, messages, meetings, tasks) and orders. Threshold = `cards.newClientFollowupDays` (proposed 14 days) since the first order, no outbound contact and no second order. Run daily, 07:00. One card per client.
- Evidence format: «первый заказ № 1188 отгружен 24.10.2026; с тех пор контакта не было (15 дней)».

**Пример (evidence):** «первый заказ № 1188 на 86 тыс. ₽ отгружен 24.10.2026; с тех пор ни письма, ни встречи, ни нового заказа (15 дней)»

**Заметка для карточки:** Предложи менеджеру коротко связаться с закупщиком или сомелье клиента (по роли): как прошла поставка, как позиции у гостей, и что нужно к следующему заказу.

### `ACCOUNT_REACTIVATION_DUE` — Пора возобновить контакт с бывшим клиентом

| Field | Value |
|---|---|
| Pack · block · family | base · K · account |
| Weight · class · kind · score rule | 4 · chance · watchdog · fixed |
| Effort · asks us · inbound only · amount | quick · no · — · no |
| Emitted by | process |
| Stage (pack default) · IN4COM | active · review |
| Display profile | from weight (D4) |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: any new contact with the client (mail, message, meeting, task, order, offer) |
| Relations | — (fallback: it fires only when no other code made a card for the client in the interval) |
| Date gate | — |
| Relevance window | until the next contact, or card expiry |
| Deal effect | per org rule; usual: none |

**Определение:** С бывшим клиентом (сотрудничество на паузе или завершено, или клиент отказался от нашего последнего предложения) или с лидом не было никакого контакта заданный срок: ни писем, ни сообщений, ни встреч, ни задач, ни заказов, ни предложений, ни карточек. Рутинный повод напомнить о себе.

**Граница (не считается):** Клиент покупает, но пропустил свой ритм → `ACCOUNT_DORMANT`. Покупает меньше → `ACCOUNT_REVENUE_DECLINE_YOY`. Был хоть один контакт в интервале (входящий или исходящий) — интервал начинается заново. Клиент в статусе `blocked` или `deleted` — не этот код.

**Признаки для промпта:** — (not in the extraction prompt; emitted by process)

**Правило срабатывания (trigger rule):**
- RU: Данные — клиенты организации без открытых заказов: бывшие (последний заказ старше 12 месяцев, или сделка в статусе отказа, или клиент отклонил последнее предложение) и лиды (вкладка «Потенциальные», заказов нет). Контакт — любой `source_item`, привязанный к клиенту или его контактам (входящий или исходящий), заказ в любом статусе, задача, сделка, тема или карточка. Порог — нет контакта `cards.reactivationIntervalDays` (предложение: 180 дней, как пример v204 «6 месяцев»). Условие запасного правила — за этот срок по клиенту не было другой карточки (в том числе `ACCOUNT_DORMANT`). Запуск — еженедельно, понедельник 07:00. Одна карточка на клиента и период тишины; любой контакт начинает интервал заново.
- EN: Data = org clients with no open order: former clients (last order older than 12 months, a lost deal, or the client declined our last offer) and leads (tab «Потенциальные», no orders). Contact = any `source_item` linked to the client or its contacts (inbound or outbound), an order in any status, a task, deal, topic or card. Threshold = no contact for `cards.reactivationIntervalDays` (proposed 180 days, the v204 example of 6 months). Fallback condition = no other card for the client in that time (incl. `ACCOUNT_DORMANT`). Run weekly, Monday 07:00. One card per client and silence; any contact restarts the interval.
- Evidence format: «последний контакт 03.04.2026 (письмо с прайсом); 220 дней без контакта; статус — бывший клиент».

**Пример (evidence):** «последний контакт 03.04.2026 (наше КП, клиент отказался); 220 дней без писем, встреч и заказов; статус — отказ»
**Контрпример:** «последний заказ 02.08.2026; ритм 21 день; пауза 92 дня» → клиент выпал из ритма, это `ACCOUNT_DORMANT`.

**Заметка для карточки:** Это рутинный повод напомнить о себе, не жалоба и не продажа: назови, с какого времени нет контакта и каким был последний; предложи короткий личный контакт с закупщиком клиента (по роли) с вопросом о планах, а для отказавшего — актуальны ли ещё причины отказа.

## L · Конкуренты и партнёры

Block L describes events of OTHER market players, not of our client. For a wine / spirits distributor: a **competitor** is another distributor or importer that sells what we sell to the same HoReCa and retail clients. A **partner** is a producer or supplier brand that we represent, or a logistics / service partner we work with. The competitor list and the partner list come from the org's watch list (clients with relation `competitor` / `partner`) or from the item itself. Block L is open to the `press` profile (web search, phase 11). Only `COMPETITOR_NEW_CLIENT` and `COMPETITOR_LOST_CLIENT` are `active` in v204; the other 14 codes are `onHold` and get shorter entries. All names in examples are fictitious.

| Code | Название (RU) | W | Class | Kind | Score rule | Effort | Asks us | Inbound only | Amount | Stage (pack) | IN4COM | Profile | Recipient | Family |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `COMPETITOR_NEW_CLIENT` | Конкурент выиграл клиента | 3 | fyi | event | fixed | medium | no | no | no | active | off | W1 | new_biz | competitor |
| `COMPETITOR_LOST_CLIENT` | Конкурент потерял клиента | 4 | chance | event | fixed | medium | no | no | no | active | off | D4 | new_biz | competitor |
| `COMPETITOR_PRODUCT_NEW` | Конкурент запустил продукт | 3 | fyi | event | fixed | medium | no | no | no | onHold | off | W1 | new_biz | competitor |
| `COMPETITOR_RATE_CHANGE` | Конкурент изменил цены | 3 | fyi | event | fixed | medium | no | no | no | onHold | off | W1 | new_biz | competitor |
| `COMPETITOR_FUNDING` | Конкурент привлёк финансирование | 3 | fyi | event | fixed | medium | no | no | no | onHold | off | W1 | new_biz | competitor |
| `COMPETITOR_EXPANSION` | Конкурент расширяет бизнес | 3 | fyi | event | fixed | medium | no | no | no | onHold | off | W1 | new_biz | competitor |
| `COMPETITOR_PERSONNEL` | У конкурента кадровые изменения | 2 | fyi | event | fixed | medium | no | no | no | onHold | off | W1 | new_biz | competitor |
| `COMPETITOR_AWARD` | Конкурент получил награду | 2 | fyi | event | fixed | medium | no | no | no | onHold | off | W1 | new_biz | competitor |
| `COMPETITOR_NEGATIVE_PRESS` | У конкурента репутационный кризис | 3 | fyi | event | fixed | medium | no | no | no | onHold | off | W1 | new_biz | competitor |
| `PARTNER_NEW_CLIENT` | Партнёр выиграл клиента | 3 | fyi | event | fixed | medium | no | no | no | onHold | off | W1 | new_biz | market |
| `PARTNER_PRODUCT_NEW` | Партнёр запустил продукт | 3 | fyi | event | fixed | medium | no | no | no | onHold | off | W1 | new_biz | market |
| `PARTNER_FUNDING` | Партнёр привлёк финансирование | 3 | fyi | event | fixed | medium | no | no | no | onHold | off | W1 | new_biz | market |
| `PARTNER_EXPANSION` | Партнёр расширяет бизнес | 3 | fyi | event | fixed | medium | no | no | no | onHold | off | W1 | new_biz | market |
| `PARTNER_PERSONNEL` | У партнёра кадровые изменения | 2 | fyi | event | fixed | medium | no | no | no | onHold | off | W1 | new_biz | market |
| `PARTNER_AWARD` | Партнёр получил награду | 2 | fyi | event | fixed | medium | no | no | no | onHold | off | W1 | new_biz | market |
| `PARTNER_NEGATIVE_PRESS` | У партнёра репутационный кризис | 4 | risk | event | fixed | medium | no | no | no | onHold | off | D4 | new_biz | market |

### `COMPETITOR_NEW_CLIENT` — Конкурент выиграл клиента

| Field | Value |
|---|---|
| Pack · block · family | base · L · competitor |
| Weight · class · kind · score rule | 3 · fyi · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · off |
| Display profile | from weight (W1) |
| Recipient role | new_biz |
| Closes / closed by | closes: — · closed by: — |
| Relations | — (boundary vs `SIGNAL_ACCOUNT_WIN`, `SIGNAL_COMPETITOR`) |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual effect: none |

**Определение:** Наш конкурент (другой дистрибьютор или импортёр из списка конкурентов либо прямо названный в тексте конкурентом) получил нового клиента: вошёл в ассортимент сети, в винную карту ресторана, выиграл тендер или стал эксклюзивным поставщиком. Выигранный клиент обычно назван в том же тексте.

**Граница (не считается):** Победитель не является нашим конкурентом → `SIGNAL_ACCOUNT_WIN` (или нет сигнала для дистрибьютора). Конкурент появился у НАШЕГО действующего клиента (клиент берёт у него часть позиций, сравнивает цены) → `SIGNAL_COMPETITOR`; клиент жалуется, что у конкурента дешевле → `COMPLAINT_PRICE`. Наша собственная победа → `TEAM_DEAL_WON` / `SALES_BOOKING_RECEIVED`. Конкурент лишь участвует в тендере, итог неизвестен → нет сигнала.

**Признаки для промпта (≤ 8):** «стал официальным поставщиком», «выиграл тендер», «вошёл в ассортимент сети», «зашёл в винную карту», «эксклюзивный дистрибьютор», «заключил договор поставки с», «теперь поставляет в», «новый клиент компании»

**Синонимы и выражения (полный список):**
- Деловая переписка: «по итогам тендера победителем признан», «заключён договор поставки», «определён поставщиком алкогольной продукции», «получил право эксклюзивной дистрибуции», «стал партнёром сети по винной категории»
- Чаты / мессенджеры (разговорный стиль): «Винный Альянс зашёл в Азбуку», «они забрали сеть», «теперь у них весь бар», «отель ушёл к Альянсу», «слышал, Альянс выиграл тендер у гостиничной группы»
- Сокращения и термины: «тендер», «44-ФЗ», «223-ФЗ», «листинг», «ввод в матрицу», «эксклюзив», «СТМ»
- Устойчивые конструкции / маркеры: имя конкурента + «выиграл / получил / зашёл / стал поставщиком» + клиент

**Похоже, но не это (анти-признаки):** «наш клиент берёт игристое у Альянса» → `SIGNAL_COMPETITOR`; «у Альянса на 10 % дешевле, пересмотрите цену» от клиента → `COMPLAINT_PRICE`; «Альянс потерял сеть» → `COMPETITOR_LOST_CLIENT`; «объявлен тендер, участвуют Альянс и мы» → нет сигнала.

**Пример (evidence):** «По итогам закупки ООО «Винный Альянс» признано поставщиком вина для ресторанов гостиничной группы «Северная корона» на 2027 год.»
**Контрпример:** «ООО «Винный Альянс» подало заявку на участие в закупке гостиничной группы» → итога нет, нет сигнала.

**Заметка для карточки:** Назвать конкурента и выигранного клиента и сказать, что действие сейчас не нужно; если выигранный клиент — наш клиент, карточку пишут как риск у этого клиента, а не как этот код.

### `COMPETITOR_LOST_CLIENT` — Конкурент потерял клиента

| Field | Value |
|---|---|
| Pack · block · family | base · L · competitor |
| Weight · class · kind · score rule | 4 · chance · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · off |
| Display profile | from weight (D4) |
| Recipient role | new_biz |
| Closes / closed by | closes: — · closed by: — |
| Relations | — (boundary vs `SIGNAL_AGENCY_CHANGE`, `SIGNAL_COMPETITOR`) |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual effect: none (a deal entry needs a real contact with the client) |

**Определение:** Наш конкурент (дистрибьютор или импортёр) потерял клиента или расстался с ним: сеть вывела его позиции, ресторан сменил поставщика, контракт не продлён, тендер объявлен заново. Это повод проверить, есть ли смысл в первом контакте с этим клиентом.

**Граница (не считается):** Клиент ушёл от НАС → коды риска у нашего клиента (`CONTRACT_TERMINATED`, `DELISTING_RISK`). Клиент, не наш клиент, меняет поставщика, но бывший поставщик не наш конкурент → `SIGNAL_AGENCY_CHANGE` в агентском смысле не применяется; для дистрибьютора нет сигнала. Конкурент сам закрывается или банкротится → `SIGNAL_INSOLVENCY` (если он в списке клиентов) или `COMPETITOR_NEGATIVE_PRESS`. Клиент лишь «присматривается к другим поставщикам» без решения → нет сигнала.

**Признаки для промпта (≤ 8):** «сменил поставщика», «отказался от поставок», «расторг договор с», «вывел из ассортимента позиции», «не продлил контракт», «тендер объявлен повторно», «ищет нового дистрибьютора», «прекратил сотрудничество с»

**Синонимы и выражения (полный список):**
- Деловая переписка: «прекращено сотрудничество с», «договор поставки не пролонгирован», «объявлена повторная закупка», «сеть исключила из матрицы продукцию дистрибьютора», «рассматриваем альтернативных поставщиков вина» (только если сказано, что прежний ушёл)
- Чаты / мессенджеры (разговорный стиль): «Ромашка ушла от Альянса», «Альянса выкинули из сети», «они больше не берут у Альянса», «отель ищет нового поставщика, Альянс всё», «у Альянса забрали бар»
- Сокращения и термины: «делистинг», «вывод из матрицы», «повторный тендер», «перезапуск закупки»
- Устойчивые конструкции / маркеры: клиент + «ушёл от / отказался от / расстался с» + конкурент; конкурент + «потерял / лишился» + клиента

**Похоже, но не это (анти-признаки):** «мы больше не будем брать ваши позиции» от нашего клиента → `DELISTING_RISK`; «Альянс выиграл тендер» → `COMPETITOR_NEW_CLIENT`; «наш клиент сравнивает наши цены с Альянсом» → `SIGNAL_COMPETITOR`.

**Пример (evidence):** «Сеть «Городские погреба» с января прекращает сотрудничество с ООО «Винный Альянс» и объявляет новый отбор поставщика импортного вина.»
**Контрпример:** «Сеть «Городские погреба» довольна ООО «Винный Альянс» и продлила договор» → потери нет, нет сигнала.

**Заметка для карточки:** Назвать конкурента и клиента, которого он потерял; шаг — коротко проверить, есть ли смысл в первом контакте; не писать, что клиент ищет именно нас.

### `COMPETITOR_PRODUCT_NEW` — Конкурент запустил продукт

| Field | Value |
|---|---|
| Pack · block · family | base · L · competitor |
| Weight · class · kind · score rule | 3 · fyi · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | onHold · off |
| Display profile | from weight (W1) |
| Recipient role | new_biz |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual effect: none |

**Определение:** Конкурент выводит на рынок новый продукт: новый бренд или производителя в портфеле, новую линейку, собственную торговую марку, новую услугу для HoReCa.

**Граница (не считается):** Новинка у производителя, которого представляем мы → `PARTNER_PRODUCT_NEW`. Новинка у нашего клиента → `SIGNAL_PRODUCT_NEWS`. Изменение цен конкурента → `COMPETITOR_RATE_CHANGE`.

**Признаки для промпта (≤ 8):** «пополнил портфель», «эксклюзивно представляет», «новый бренд в портфеле», «запустил собственную марку», «старт продаж», «новинка от», «расширил ассортимент»

**Синонимы и выражения (полный список):**
- Деловая переписка: «объявил о старте дистрибуции», «получил права на импорт», «представляет новую линейку», «запуск СТМ»
- Чаты / мессенджеры (разговорный стиль): «Альянс привёз новых грузин», «у них теперь своя марка просекко», «они взяли Бароло от нового хозяйства»
- Сокращения и термины: «портфель», «СТМ», «эксклюзив», «линейка»

**Похоже, но не это (анти-признаки):** «наш поставщик выпускает новое игристое» → `PARTNER_PRODUCT_NEW`; «клиент открыл новый ресторан» → `NEW_VENUE_OPENING`.

**Пример (evidence):** «ООО «Винный Альянс» пополнило портфель: с декабря компания эксклюзивно представляет в России вина хозяйства из Риохи.»
**Контрпример:** «ООО «Винный Альянс» подняло цены на Риоху» → `COMPETITOR_RATE_CHANGE`.

**Заметка для карточки:** Назвать конкурента и новинку; шаг — сохранить для следующего разговора с клиентами, у которых эта категория в закупке.

### `COMPETITOR_RATE_CHANGE` — Конкурент изменил цены

| Field | Value |
|---|---|
| Pack · block · family | base · L · competitor |
| Weight · class · kind · score rule | 3 · fyi · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | onHold · off |
| Display profile | from weight (W1) |
| Recipient role | new_biz |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual effect: none |

**Определение:** Конкурент меняет опубликованный прайс-лист или общие условия: повышение или снижение цен, новые скидки от объёма, новая отсрочка.

**Граница (не считается):** Клиент говорит, что у конкурента дешевле, и требует скидку → `COMPLAINT_PRICE`. Изменение цен нашего поставщика → `SUPPLIER_PRICE_CHANGE`. Изменение наших цен → `INTERNAL_PRICE_CHANGE`.

**Признаки для промпта (≤ 8):** «повышает цены с», «снизил цены на», «новый прайс у», «индексация цен», «акция у дистрибьютора», «скидка от объёма у», «отсрочка 60 дней у»

**Синонимы и выражения (полный список):**
- Деловая переписка: «объявил о повышении отпускных цен», «индексация прайс-листа», «новые условия работы для HoReCa»
- Чаты / мессенджеры (разговорный стиль): «Альянс опять поднял цены», «у них сейчас акция минус 15 на итальянцев», «они дают отсрочку 60 дней»
- Сокращения и термины: «прайс», «отпускные цены», «ретро-бонус», «отсрочка»

**Похоже, но не это (анти-признаки):** «у Альянса на 10 % дешевле, снизьте цену» от клиента → `COMPLAINT_PRICE`; «производитель поднимает цены с 01.01» → `SUPPLIER_PRICE_CHANGE`.

**Пример (evidence):** «ООО «Винный Альянс» с 1 января повышает отпускные цены на импортное вино в среднем на 8 %.»
**Контрпример:** «Клиент: у Альянса эта позиция на 200 рублей дешевле» → `COMPLAINT_PRICE`.

**Заметка для карточки:** Назвать конкурента, направление и размер изменения и дату; шаг — проверить, как это меняет нашу позицию в переговорах с общими клиентами.

### `COMPETITOR_FUNDING` — Конкурент привлёк финансирование

| Field | Value |
|---|---|
| Pack · block · family | base · L · competitor |
| Weight · class · kind · score rule | 3 · fyi · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | onHold · off |
| Display profile | from weight (W1) |
| Recipient role | new_biz |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual effect: none |

**Определение:** Конкурент получает инвестиции, кредит на развитие, нового акционера или сам становится объектом покупки.

**Граница (не считается):** Финансирование нашего клиента → `SIGNAL_FUNDING`; покупка нашего клиента → `SIGNAL_MERGER`. Расширение без денег (новый склад, филиал) → `COMPETITOR_EXPANSION`.

**Признаки для промпта (≤ 8):** «привлёк инвестиции», «новый акционер», «вошёл в капитал», «купил долю», «приобрёл компанию», «кредитная линия на развитие», «сделка по покупке дистрибьютора»

**Синонимы и выражения (полный список):**
- Деловая переписка: «завершена сделка по приобретению», «инвестфонд вошёл в капитал», «получил финансирование на расширение»
- Чаты / мессенджеры (разговорный стиль): «Альянс купили», «у них новый инвестор», «в Альянс зашли деньги»
- Сокращения и термины: «доля», «капитал», «M&A», «сделка»

**Похоже, но не это (анти-признаки):** «наш клиент привлёк инвестиции» → `SIGNAL_FUNDING`; «Альянс открыл склад в Казани» → `COMPETITOR_EXPANSION`.

**Пример (evidence):** «Инвестфонд «Восток Капитал» приобрёл 40 % ООО «Винный Альянс» для развития сети складов.»
**Контрпример:** «Винный Альянс открыл склад в Казани» → `COMPETITOR_EXPANSION`.

**Заметка для карточки:** Назвать конкурента и суть сделки; шаг — сохранить как контекст рынка, действие не нужно.

### `COMPETITOR_EXPANSION` — Конкурент расширяет бизнес

| Field | Value |
|---|---|
| Pack · block · family | base · L · competitor |
| Weight · class · kind · score rule | 3 · fyi · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | onHold · off |
| Display profile | from weight (W1) |
| Recipient role | new_biz |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual effect: none |

**Определение:** Конкурент расширяется в наших регионах: новый склад, филиал, новый регион доставки, новая команда продаж для HoReCa.

**Граница (не считается):** Расширение нашего клиента → `SIGNAL_EXPANSION`. Новый бренд в портфеле → `COMPETITOR_PRODUCT_NEW`. Расширение за пределами регионов организации → нет сигнала.

**Признаки для промпта (≤ 8):** «открыл склад», «новый филиал», «вышел в регион», «запустил доставку в», «расширяет команду продаж», «открывает представительство», «новый распределительный центр»

**Синонимы и выражения (полный список):**
- Деловая переписка: «объявил об открытии регионального представительства», «ввод в эксплуатацию склада», «расширение географии поставок»
- Чаты / мессенджеры (разговорный стиль): «Альянс зашёл в Питер», «у них теперь склад в Казани», «набирают торговых по HoReCa»
- Сокращения и термины: «РЦ», «филиал», «география», «торговые представители»

**Похоже, но не это (анти-признаки):** «наш клиент открывает второй ресторан» → `NEW_VENUE_OPENING`; «Альянс получил инвестиции» → `COMPETITOR_FUNDING`.

**Пример (evidence):** «ООО «Винный Альянс» открыло распределительный центр в Екатеринбурге и запускает доставку по Уралу.»
**Контрпример:** «ООО «Винный Альянс» открыло офис в Ереване» → вне наших регионов, нет сигнала.

**Заметка для карточки:** Назвать конкурента и новый регион; шаг — проверить наших клиентов в этом регионе и держать в виду к следующим переговорам.

### `COMPETITOR_PERSONNEL` — У конкурента кадровые изменения

| Field | Value |
|---|---|
| Pack · block · family | base · L · competitor |
| Weight · class · kind · score rule | 2 · fyi · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | onHold · off |
| Display profile | from weight (W1) |
| Recipient role | new_biz |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual effect: none |

**Определение:** У конкурента меняется руководство или ключевые сотрудники: генеральный, коммерческий директор, бренд-менеджер, известный сомелье-консультант.

**Граница (не считается):** Кадровые изменения у нашего клиента → `SIGNAL_C_LEVEL_CHANGE` / `CONTACT_NEW_DECISION_MAKER`. Сотрудник конкурента переходит к нам → `TEAM_INSIDER` (внутренне) или нет сигнала.

**Признаки для промпта (≤ 8):** «назначен коммерческим директором», «покинул компанию», «новый генеральный директор», «перешёл из», «возглавил направление HoReCa», «сменилось руководство»

**Синонимы и выражения (полный список):**
- Деловая переписка: «назначен на должность», «освобождён от должности», «кадровые перестановки в»
- Чаты / мессенджеры (разговорный стиль): «у Альянса новый коммерческий», «их бренд-шеф ушёл», «Петров теперь у Альянса»
- Сокращения и термины: «КД», «ГД», «бренд-менеджер», «HoReCa-директор»

**Похоже, но не это (анти-признаки):** «в ресторане новый сомелье» → `CONTACT_NEW_DECISION_MAKER`; «у клиента новый гендиректор» → `SIGNAL_C_LEVEL_CHANGE`.

**Пример (evidence):** «Коммерческим директором ООО «Винный Альянс» назначен бывший руководитель продаж крупной ресторанной группы.»
**Контрпример:** «Новым генеральным директором нашего клиента «Бистро Лаванда» назначен бывший управляющий сети» → `SIGNAL_C_LEVEL_CHANGE`.

**Заметка для карточки:** Назвать конкурента и должность (без имени); шаг — сохранить как контекст рынка.

### `COMPETITOR_AWARD` — Конкурент получил награду

| Field | Value |
|---|---|
| Pack · block · family | base · L · competitor |
| Weight · class · kind · score rule | 2 · fyi · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | onHold · off |
| Display profile | from weight (W1) |
| Recipient role | new_biz |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual effect: none |

**Определение:** Конкурент или вино из его портфеля получает награду, рейтинг или премию (конкурс, отраслевой рейтинг дистрибьюторов).

**Граница (не считается):** Награда нашего клиента → `SIGNAL_AWARD`. Награда вина нашего производителя → `PARTNER_AWARD`.

**Признаки для промпта (≤ 8):** «золотая медаль», «лучший дистрибьютор года», «победитель конкурса», «высший балл», «вошёл в рейтинг», «премия», «гран-при»

**Синонимы и выражения (полный список):**
- Деловая переписка: «удостоен награды», «признан лучшим импортёром», «по итогам дегустационного конкурса»
- Чаты / мессенджеры (разговорный стиль): «Альянс взял золото», «их Совиньон получил 95 баллов», «им дали премию»
- Сокращения и термины: «медаль», «балл», «рейтинг», «гран-при»

**Похоже, но не это (анти-признаки):** «наш ресторан-клиент попал в гид» → `SIGNAL_AWARD`; «вино нашего производителя получило золото» → `PARTNER_AWARD`.

**Пример (evidence):** «ООО «Винный Альянс» признано лучшим импортёром года по версии отраслевой премии.»
**Контрпример:** «Наш клиент «Бистро Лаванда» вошёл в ресторанный гид» → `SIGNAL_AWARD`.

**Заметка для карточки:** Назвать конкурента и награду; шаг не нужен, только контекст.

### `COMPETITOR_NEGATIVE_PRESS` — У конкурента репутационный кризис

| Field | Value |
|---|---|
| Pack · block · family | base · L · competitor |
| Weight · class · kind · score rule | 3 · fyi · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | onHold · off |
| Display profile | from weight (W1) |
| Recipient role | new_biz |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual effect: none |

**Определение:** О конкуренте выходит негативная информация: изъятие партии, проблемы с ЕГАИС или лицензией, судебный спор, проверка, массовые жалобы клиентов.

**Граница (не считается):** Негатив о нашем клиенте → `SIGNAL_NEGATIVE_PRESS`; банкротство клиента → `SIGNAL_INSOLVENCY`. Конкурент потерял конкретного клиента → `COMPETITOR_LOST_CLIENT`. Нельзя использовать этот код как повод очернять конкурента.

**Признаки для промпта (≤ 8):** «изъята партия», «приостановлена лицензия», «проверка Росалкогольтабакконтроля», «контрафакт», «иск к дистрибьютору», «срывает поставки», «жалобы клиентов на»

**Синонимы и выражения (полный список):**
- Деловая переписка: «приостановлено действие лицензии», «выявлена продукция без маркировки», «возбуждено дело», «арбитражный иск»
- Чаты / мессенджеры (разговорный стиль): «у Альянса забрали лицензию», «у них проблемы с ЕГАИС», «рестораны жалуются, что Альянс не возит»
- Сокращения и термины: «РАР», «ЕГАИС», «ФСМ», «контрафакт», «арбитраж»

**Похоже, но не это (анти-признаки):** «у нашего клиента приостановлена лицензия» → `LICENSE_EXPIRING`; «Альянс ушёл из сети» → `COMPETITOR_LOST_CLIENT`.

**Пример (evidence):** «Росалкогольтабакконтроль приостановил лицензию ООО «Винный Альянс» на оптовую торговлю алкоголем.»
**Контрпример:** «У нашего клиента приостановили лицензию» → `LICENSE_EXPIRING` (distribution pack).

**Заметка для карточки:** Назвать конкурента и суть события без оценок; шаг — проверить, каких общих клиентов это может затронуть, и быть готовыми к запросам.

### `PARTNER_NEW_CLIENT` — Партнёр выиграл клиента

| Field | Value |
|---|---|
| Pack · block · family | base · L · market |
| Weight · class · kind · score rule | 3 · fyi · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | onHold · off |
| Display profile | from weight (W1) |
| Recipient role | new_biz |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual effect: none |

**Определение:** Наш партнёр (производитель, которого мы представляем, или логистический / сервисный партнёр) получает нового клиента или крупный контракт.

**Граница (не считается):** Победа конкурента → `COMPETITOR_NEW_CLIENT`. Наша собственная победа → `TEAM_DEAL_WON`. Партнёр сам поставляет нашему клиенту в обход нас → `SIGNAL_COMPETITOR`.

**Признаки для промпта (≤ 8):** «стал поставщиком», «заключил контракт с», «новый клиент», «выиграл тендер», «вошёл в сеть», «подписал соглашение»

**Синонимы и выражения (полный список):**
- Деловая переписка: «заключено соглашение о поставках», «определён победителем закупки»
- Чаты / мессенджеры (разговорный стиль): «наш логист взял ещё сеть», «хозяйство зашло в дьюти-фри»
- Сокращения и термины: «контракт», «тендер», «листинг»

**Похоже, но не это (анти-признаки):** «Винный Альянс выиграл тендер» → `COMPETITOR_NEW_CLIENT`.

**Пример (evidence):** «Наш транспортный партнёр «СеверЛогистик» заключил контракт на доставку для крупной ресторанной группы.»
**Контрпример:** «ООО «Винный Альянс» заключил контракт с ресторанной группой» → `COMPETITOR_NEW_CLIENT`.

**Заметка для карточки:** Назвать партнёра и нового клиента; шаг — проверить, даёт ли это нам повод для совместного предложения.

### `PARTNER_PRODUCT_NEW` — Партнёр запустил продукт

| Field | Value |
|---|---|
| Pack · block · family | base · L · market |
| Weight · class · kind · score rule | 3 · fyi · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | onHold · off |
| Display profile | from weight (W1) |
| Recipient role | new_biz |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual effect: none |

**Определение:** Производитель, которого мы представляем, или другой партнёр выпускает новый продукт: новое вино, урожай, линейку, кюве, новую услугу.

**Граница (не считается):** Новый прайс производителя → `SUPPLIER_PRICE_CHANGE`. Новинка конкурента → `COMPETITOR_PRODUCT_NEW`. Ввод позиции в НАШ каталог (изменение в CRM) → `INTERNAL_PRODUCT_STATUS_UPDATE`.

**Признаки для промпта (≤ 8):** «новый урожай», «новое кюве», «выпускает новую линейку», «новинка от хозяйства», «первый винтаж», «лимитированный выпуск», «новое игристое»

**Синонимы и выражения (полный список):**
- Деловая переписка: «рады представить новый винтаж», «презентация новой линейки», «старт продаж лимитированной серии»
- Чаты / мессенджеры (разговорный стиль): «хозяйство выпустило оранж», «пришёл новый винтаж», «у них новое пет-нат»
- Сокращения и термины: «винтаж», «кюве», «линейка», «лимитка»

**Похоже, но не это (анти-признаки):** «с 01.12 новые цены на винтаж 2023» → `SUPPLIER_PRICE_CHANGE`.

**Пример (evidence):** «Хозяйство «Долина Солнца» выпускает первое игристое методом классической шампанизации, старт продаж в феврале.»
**Контрпример:** «Хозяйство «Долина Солнца» повышает цены с 1 февраля» → `SUPPLIER_PRICE_CHANGE`.

**Заметка для карточки:** Назвать партнёра, продукт и дату старта; шаг — решить, предлагать ли новинку клиентам, у которых эта категория в карте.

### `PARTNER_FUNDING` — Партнёр привлёк финансирование

| Field | Value |
|---|---|
| Pack · block · family | base · L · market |
| Weight · class · kind · score rule | 3 · fyi · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | onHold · off |
| Display profile | from weight (W1) |
| Recipient role | new_biz |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual effect: none |

**Определение:** Наш партнёр (производитель, поставщик, логистический партнёр) получает инвестиции, нового владельца или сам покупается другой компанией.

**Граница (не считается):** Финансирование конкурента → `COMPETITOR_FUNDING`; клиента → `SIGNAL_FUNDING` / `SIGNAL_MERGER`.

**Признаки для промпта (≤ 8):** «новый владелец», «приобрёл хозяйство», «вошёл в капитал», «привлёк инвестиции», «сменил собственника», «сделка по покупке»

**Синонимы и выражения (полный список):**
- Деловая переписка: «завершена сделка по приобретению винодельни», «смена конечного бенефициара»
- Чаты / мессенджеры (разговорный стиль): «хозяйство купил холдинг», «у винодельни новый хозяин»
- Сокращения и термины: «доля», «бенефициар», «холдинг»

**Похоже, но не это (анти-признаки):** «Винный Альянс купили» → `COMPETITOR_FUNDING`.

**Пример (evidence):** «Винодельня «Долина Солнца» перешла под контроль агрохолдинга, договоры дистрибуции будут пересмотрены.»
**Контрпример:** «Винодельня «Долина Солнца» открыла дегустационный зал» → `PARTNER_EXPANSION`.

**Заметка для карточки:** Назвать партнёра и суть сделки; шаг — уточнить у партнёра, меняется ли что-то в нашем договоре дистрибуции.

### `PARTNER_EXPANSION` — Партнёр расширяет бизнес

| Field | Value |
|---|---|
| Pack · block · family | base · L · market |
| Weight · class · kind · score rule | 3 · fyi · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | onHold · off |
| Display profile | from weight (W1) |
| Recipient role | new_biz |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual effect: none |

**Определение:** Партнёр расширяется: новые виноградники, рост производства, новый склад или регион у логистического партнёра, новая команда.

**Граница (не считается):** Расширение конкурента → `COMPETITOR_EXPANSION`; клиента → `SIGNAL_EXPANSION`.

**Признаки для промпта (≤ 8):** «расширяет производство», «новые виноградники», «открыл склад», «новый регион доставки», «увеличил мощности», «новый цех розлива»

**Синонимы и выражения (полный список):**
- Деловая переписка: «ввод новых производственных мощностей», «расширение площади виноградников»
- Чаты / мессенджеры (разговорный стиль): «хозяйство посадило ещё 20 га», «логист открыл терминал в Новосибе»
- Сокращения и термины: «га», «мощности», «терминал», «розлив»

**Похоже, но не это (анти-признаки):** «Винный Альянс открыл склад» → `COMPETITOR_EXPANSION`.

**Пример (evidence):** «Наш перевозчик «СеверЛогистик» открывает терминал в Новосибирске и берёт грузы по Сибири с января.»
**Контрпример:** «Наш клиент открывает ресторан в Новосибирске» → `NEW_VENUE_OPENING`.

**Заметка для карточки:** Назвать партнёра и что расширяется; шаг — проверить, даёт ли это нам новые объёмы или новую географию.

### `PARTNER_PERSONNEL` — У партнёра кадровые изменения

| Field | Value |
|---|---|
| Pack · block · family | base · L · market |
| Weight · class · kind · score rule | 2 · fyi · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | onHold · off |
| Display profile | from weight (W1) |
| Recipient role | new_biz |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual effect: none |

**Определение:** У партнёра меняется руководство или ключевой контакт: экспорт-менеджер производителя, энолог, директор логистической компании.

**Граница (не считается):** Изменения у клиента → `SIGNAL_C_LEVEL_CHANGE` / `CONTACT_LEAVING`; у конкурента → `COMPETITOR_PERSONNEL`.

**Признаки для промпта (≤ 8):** «новый экспорт-менеджер», «новый энолог», «назначен директором», «покидает компанию», «теперь ваш контакт», «сменился менеджер по России»

**Синонимы и выражения (полный список):**
- Деловая переписка: «сообщаем о назначении», «с 1 декабря по всем вопросам обращайтесь к»
- Чаты / мессенджеры (разговорный стиль): «у хозяйства новый экспорт-менеджер», «Марко ушёл, теперь Лука»
- Сокращения и термины: «экспорт-менеджер», «энолог», «KAM»

**Похоже, но не это (анти-признаки):** «у клиента новый закупщик» → `CONTACT_NEW_DECISION_MAKER`.

**Пример (evidence):** «С 1 декабря экспорт-менеджером винодельни по России назначен новый сотрудник, прежний покидает компанию.»
**Контрпример:** «Наш закупщик в ресторане сменился» → `CONTACT_NEW_DECISION_MAKER`.

**Заметка для карточки:** Назвать партнёра и должность; шаг — представиться новому контакту и сверить открытые поставки.

### `PARTNER_AWARD` — Партнёр получил награду

| Field | Value |
|---|---|
| Pack · block · family | base · L · market |
| Weight · class · kind · score rule | 2 · fyi · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | onHold · off |
| Display profile | from weight (W1) |
| Recipient role | new_biz |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual effect: none |

**Определение:** Производитель, которого мы представляем, или его вино получает награду, высокий балл критика или место в рейтинге — аргумент для продаж.

**Граница (не считается):** Награда конкурента → `COMPETITOR_AWARD`; клиента → `SIGNAL_AWARD`.

**Признаки для промпта (≤ 8):** «золотая медаль», «95 баллов», «лучшее вино», «вошло в топ», «победитель конкурса», «гран-при», «высшая оценка»

**Синонимы и выражения (полный список):**
- Деловая переписка: «удостоено золотой медали», «получило высшую оценку жюри»
- Чаты / мессенджеры (разговорный стиль): «наше Пино взяло золото», «95 баллов у критика»
- Сокращения и термины: «медаль», «балл», «топ-100»

**Похоже, но не это (анти-признаки):** «вино Альянса получило золото» → `COMPETITOR_AWARD`.

**Пример (evidence):** «Пино нуар хозяйства «Долина Солнца» урожая 2022 года получило золотую медаль на международном конкурсе.»
**Контрпример:** «Ресторан клиента получил звезду гида» → `SIGNAL_AWARD`.

**Заметка для карточки:** Назвать вино и награду; шаг — использовать как аргумент в следующих предложениях клиентам.

### `PARTNER_NEGATIVE_PRESS` — У партнёра репутационный кризис

| Field | Value |
|---|---|
| Pack · block · family | base · L · market |
| Weight · class · kind · score rule | 4 · risk · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | onHold · off |
| Display profile | from weight (D4) |
| Recipient role | new_biz |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual effect: none |

**Определение:** О партнёре выходит негативная информация: отзыв партии, фальсификат, проблемы с сертификацией, санкции, суд. Это риск для самого партнёрства и для наших продаж его продукции.

**Граница (не считается):** Задержка поставки от партнёра → `SUPPLIER_DELIVERY_DELAY`. Негатив о конкуренте → `COMPETITOR_NEGATIVE_PRESS`; о клиенте → `SIGNAL_NEGATIVE_PRESS`.

**Признаки для промпта (≤ 8):** «отзыв партии», «фальсификат», «отозван сертификат», «попал под санкции», «запрет ввоза», «скандал», «судебный иск к производителю»

**Синонимы и выражения (полный список):**
- Деловая переписка: «Роспотребнадзор приостановил ввоз», «выявлено несоответствие», «отзыв продукции с рынка»
- Чаты / мессенджеры (разговорный стиль): «у хозяйства скандал с подделкой», «их запретили ввозить», «партию отзывают»
- Сокращения и термины: «РПН», «декларация соответствия», «отзыв», «санкции»

**Похоже, но не это (анти-признаки):** «контейнер от производителя задерживается» → `SUPPLIER_DELIVERY_DELAY`.

**Пример (evidence):** «Роспотребнадзор приостановил ввоз продукции винодельни «Долина Солнца» из-за несоответствия маркировки.»
**Контрпример:** «Поставка от «Долины Солнца» сдвигается на две недели» → `SUPPLIER_DELIVERY_DELAY`.

**Заметка для карточки:** Назвать партнёра и суть проблемы; шаг — проверить остатки и открытые заказы с его продукцией и подготовить ответ клиентам.

## M · Внутреннее: наши цены и продукт

Block M codes are emitted by a process over our own `product` catalogue, never by the LLM. Both codes are `onHold` in v204. The process compares two catalogue snapshots (daily). The card goes to the team so that the account managers know of a change before the client asks.

| Code | Название (RU) | W | Class | Kind | Score rule | Effort | Asks us | Inbound only | Amount | Stage (pack) | IN4COM | Profile | Recipient | Family |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `INTERNAL_PRICE_CHANGE` | Изменились наши цены | 3 | fyi | event | fixed | medium | no | — | no | onHold | off | W1 | team | internal |
| `INTERNAL_PRODUCT_STATUS_UPDATE` | Изменился статус нашего товара / позиции | 3 | fyi | event | fixed | medium | no | — | no | onHold | off | W1 | team | internal |

### `INTERNAL_PRICE_CHANGE` — Изменились наши цены

| Field | Value |
|---|---|
| Pack · block · family | base · M · internal |
| Weight · class · kind · score rule | 3 · fyi · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · — · no |
| Emitted by | process |
| Stage (pack default) · IN4COM | onHold · off |
| Display profile | from weight (W1) |
| Recipient role | team |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual effect: none |

**Определение:** Изменилась наша отпускная цена на активную позицию каталога. Менеджер должен знать об этом раньше, чем спросит клиент.

**Граница (не считается):** Поставщик прислал нам новый прайс → `SUPPLIER_PRICE_CHANGE`. Клиент просит цены → `SALES_PRICE_REQUEST`. Индивидуальная скидка клиента (`client.custom_fields.discount`) — не изменение цены каталога, нет сигнала.

**Признаки для промпта:** — (not in the extraction prompt; emitted by process)

**Правило срабатывания (trigger rule):**
- RU: Ежедневно сравнить цену каждой активной позиции `product` с прошлым снимком. Сигнал, если цена изменилась не менее чем на 5 % (настройка `internal.priceChangeThresholdPct`, предложение 5) или изменилась цена позиции, которую клиент заказывал за последние 12 месяцев (любое изменение). Одна карточка на изменение прайса за день: все изменённые позиции в одном списке; адресаты — менеджеры клиентов, которые брали эти позиции. Повтор по той же позиции — не раньше чем через 30 дней, кроме смены направления (рост → снижение). Нет прошлого снимка — нет сигнала.
- EN: Daily, compare the price of each active `product` row with the last snapshot. Emit when the price changed by at least 5 % (setting `internal.priceChangeThresholdPct`, proposed 5), or when any price changed for a SKU that a client ordered in the last 12 months. One card per price-list change per day, with all changed SKUs in one list; recipients are the account managers of clients who bought these SKUs. Cooldown per SKU: 30 days, except a change of direction. No previous snapshot → no signal.
- Evidence (RU, data fact): «Цена «Пино нуар Долина Солнца 2022, 0,75» изменилась с 1 850 ₽ до 2 040 ₽ (+10,3 %) с 01.12.2026; позицию брали 7 клиентов за 12 месяцев.»

**Пример (evidence):** «Цена «Просекко DOC Брют, 0,75» снижена с 1 120 ₽ до 990 ₽ (−11,6 %) с 15.11.2026.»
**Контрпример:** «Клиенту «Бистро Лаванда» установлена скидка 7 %» → индивидуальная скидка, нет сигнала.

**Заметка для карточки:** Назвать позицию, старую и новую цену и дату; шаг — проверить открытые предложения и заказы с этой позицией и предупредить ключевых клиентов до того, как они спросят.

### `INTERNAL_PRODUCT_STATUS_UPDATE` — Изменился статус нашего товара / позиции

| Field | Value |
|---|---|
| Pack · block · family | base · M · internal |
| Weight · class · kind · score rule | 3 · fyi · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · — · no |
| Emitted by | process |
| Stage (pack default) · IN4COM | onHold · off |
| Display profile | from weight (W1) |
| Recipient role | team |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual effect: none |

**Определение:** Наша позиция каталога сменила статус: введена новая позиция, позиция выведена из ассортимента, закончилась на складе или снова появилась в наличии, сменился винтаж.

**Граница (не считается):** Новинка у производителя, ещё не заведённая в наш каталог → `PARTNER_PRODUCT_NEW`. Поставщик сообщает о задержке → `SUPPLIER_DELIVERY_DELAY`. Изменение только цены → `INTERNAL_PRICE_CHANGE`.

**Признаки для промпта:** — (not in the extraction prompt; emitted by process)

**Правило срабатывания (trigger rule):**
- RU: Ежедневно сравнить статус и остаток каждой позиции `product` с прошлым снимком. Сигнал при одном из событий: позиция добавлена в каталог; позиция стала неактивной (выведена); остаток стал 0 у позиции, которую клиенты заказывали за последние 90 дней; остаток снова больше 0 после нуля; сменился винтаж (год урожая). Одна карточка на позицию и событие; повтор того же события по той же позиции — не раньше чем через 30 дней. Адресаты — менеджеры клиентов, которые брали позицию за 12 месяцев; для новой позиции — команда продаж.
- EN: Daily, compare status and stock of each `product` row with the last snapshot. Emit on: SKU added; SKU set inactive (withdrawn); stock reaches 0 for a SKU that clients ordered in the last 90 days; stock above 0 again after zero; vintage changed. One card per SKU and event; cooldown for the same event on the same SKU: 30 days. Recipients: account managers of clients who bought the SKU in 12 months; for a new SKU, the sales team.
- Evidence (RU, data fact): «Позиция «Риоха Крианса 2020, 0,75» выведена из ассортимента 10.11.2026; за 12 месяцев её заказывали 4 клиента.»

**Пример (evidence):** «Остаток «Шабли Премьер Крю 2021, 0,75» — 0 бут. с 12.11.2026; за 90 дней позицию заказывали 3 клиента.»
**Контрпример:** «Остаток «Шабли» снизился со 120 до 96 бут.» → обычное движение склада, нет сигнала.

**Заметка для карточки:** Назвать позицию и новый статус; шаг — предупредить клиентов, которые её берут, и предложить замену, если позиции нет.

## N · Поставщики и закупки

Block N covers mail from OUR suppliers (producers, importers, carriers): we are the buyer. Customer codes are never emitted on such mail (spec §5.3). Both codes are `active` in v204 and on for IN4COM (draft §2).

| Code | Название (RU) | W | Class | Kind | Score rule | Effort | Asks us | Inbound only | Amount | Stage (pack) | IN4COM | Profile | Recipient | Family |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `SUPPLIER_DELIVERY_DELAY` | Поставщик задерживает поставку | 4 | fyi | event | fixed | quick | no | yes | no | active | on (review: 4 → 5 risk?) | D4 | logistics | supplier |
| `SUPPLIER_PRICE_CHANGE` | Новый прайс или изменение цен поставщика | 3 | fyi | event | fixed | quick | no | yes | yes | active | on | W1 | logistics | supplier |

### `SUPPLIER_DELIVERY_DELAY` — Поставщик задерживает поставку

| Field | Value |
|---|---|
| Pack · block · family | base · N · supplier |
| Weight · class · kind · score rule | 4 · fyi · event · fixed |
| Effort · asks us · inbound only · amount | quick · no · yes · no |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · on (draft question 6: weight 5 and class risk, because a delay means no stock for clients) |
| Display profile | from weight (D4) |
| Recipient role | logistics |
| Closes / closed by | closes: — · closed by: — |
| Relations | — (boundary vs `COMPLAINT_TIMING`, `DELIVERY_SCHEDULE_REQUEST`) |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual effect: risk trigger «Нет товара для поставки» (draft §4) when the SKU is in a listing or tender deal |

**Определение:** Наш поставщик (производитель, импортёр, экспедитор) сообщает, что товар, который МЫ заказали, придёт позже, частично или не придёт: перенос даты отгрузки, задержка контейнера, таможни, производства, позиции нет в наличии у производителя. От этого могут зависеть заказы наших клиентов.

**Граница (не считается):** Клиент жалуется на НАШУ задержку → `COMPLAINT_TIMING`. Клиент спрашивает, когда мы привезём → `DELIVERY_SCHEDULE_REQUEST`. Наше письмо поставщику «когда отгрузите?» без ответа о задержке → нет сигнала (inbound only). Поставщик меняет цены → `SUPPLIER_PRICE_CHANGE`.

**Признаки для промпта (≤ 8):** «контейнер задерживается», «задержка на таможне», «поставка от производителя переносится», «нет в наличии у производителя», «отгрузка частичная», «бэкордер», «новая дата отгрузки», «не успеваем отгрузить к»

**Синонимы и выражения (полный список):**
- Деловая переписка: «сообщаем о переносе даты отгрузки», «ориентировочная дата прибытия сдвигается на», «груз задержан на таможенном посту», «товар будет поставлен частично», «позиция временно недоступна к заказу», «производитель не подтверждает объём», «задержка розлива», «судно прибывает позже плана», «акцизные марки не получены, отгрузка откладывается»
- Чаты / мессенджеры (разговорный стиль): «контейнер встал в Новороссийске», «фура задерживается на границе», «завод не успевает, сдвиг на неделю», «этого вина нет, остаток уйдёт в бэкордер», «приедет только половина», «таможня держит, ждём выпуска»
- Сокращения и термины: «ETA», «ETD», «бэкордер», «backorder», «ДТ» (декларация на товары), «СВХ», «ФСМ», «коносамент», «частичная отгрузка»
- Устойчивые конструкции / маркеры: «задерживается / переносится / сдвигается» + поставка / отгрузка / контейнер; «нет в наличии» + у производителя / на складе поставщика; «новая дата» + прибытия / отгрузки

**Похоже, но не это (анти-признаки):** «где наш заказ? вы обещали в понедельник» от клиента → `COMPLAINT_TIMING`; «во сколько привезёте в пятницу?» от клиента → `DELIVERY_SCHEDULE_REQUEST`; «с 1 декабря новые цены» от поставщика → `SUPPLIER_PRICE_CHANGE`; «контейнер вышел по плану, ETA 20.11» → нет сигнала (нет задержки).

**Пример (evidence):** «Контейнер с вашим заказом задержан на таможне в Новороссийске, ориентировочная дата прибытия на склад — 28.11 вместо 18.11.»
**Контрпример:** «Контейнер вышел из порта по графику, прибытие 18.11» → задержки нет, нет сигнала.

**Заметка для карточки:** Назвать наш заказ, позицию и новую дату; шаг — если клиенты ждут эти позиции, сообщить им новую дату и предложить замену, иначе действие не нужно.

### `SUPPLIER_PRICE_CHANGE` — Новый прайс или изменение цен поставщика

| Field | Value |
|---|---|
| Pack · block · family | base · N · supplier |
| Weight · class · kind · score rule | 3 · fyi · event · fixed |
| Effort · asks us · inbound only · amount | quick · no · yes · yes |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · on |
| Display profile | from weight (W1) |
| Recipient role | logistics (purchasing; the enum has no `purchasing` role) |
| Closes / closed by | closes: — · closed by: — |
| Relations | — (boundary vs `SALES_PRICE_REQUEST`, `INTERNAL_PRICE_CHANGE`) |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule; usual effect: none |

**Определение:** Поставщик или производитель, у которого мы покупаем или который предлагает нам поставки, присылает новый или изменённый прайс, новые закупочные или дилерские цены, повышение цен на товары, которые мы покупаем или можем купить.

**Граница (не считается):** Клиент просит НАШИ цены → `SALES_PRICE_REQUEST`. Изменилась наша отпускная цена → `INTERNAL_PRICE_CHANGE`. Конкурент изменил свои цены для клиентов → `COMPETITOR_RATE_CHANGE`. Рекламная рассылка нового поставщика без цен → нет сигнала.

**Признаки для промпта (≤ 8):** «новый прайс», «повышение цен с 01.12», «изменение закупочных цен», «дилерские цены», «курсовая корректировка», «индексация цен», «прайс-лист во вложении», «цены действуют с»

**Синонимы и выражения (полный список):**
- Деловая переписка: «направляем актуальный прайс-лист», «уведомляем об изменении цен с», «в связи с ростом акцизов цены увеличиваются на», «индексация отпускных цен», «новые условия для дистрибьюторов», «корректировка цен в связи с курсом евро», «цены указаны с учётом НДС и акциза», «прайс на урожай 2024»
- Чаты / мессенджеры (разговорный стиль): «кинул новый прайс», «с декабря плюс 7 %», «евро вырос, поднимаем», «скинули цены на остатки 2021», «вот дилерские на новый винтаж»
- Сокращения и термины: «прайс», «ПЛ», «EXW», «FCA», «DAP», «дилерская цена», «закупочная цена», «акциз», «курсовая разница»
- Устойчивые конструкции / маркеры: «цены действуют / вступают в силу» + дата; «повышение / снижение / индексация» + цен + процент; «прайс-лист» + во вложении

**Похоже, но не это (анти-признаки):** «пришлите ваш прайс» от клиента → `SALES_PRICE_REQUEST`; «мы поднимаем отпускные цены» (наше решение) → `INTERNAL_PRICE_CHANGE`; «у Альянса новые цены» → `COMPETITOR_RATE_CHANGE`; «контейнер задерживается» → `SUPPLIER_DELIVERY_DELAY`.

**Пример (evidence):** «Уведомляем, что с 01.12.2026 закупочные цены на всю линейку игристых увеличиваются на 6 % в связи с ростом ставки акциза. Новый прайс во вложении.»
**Контрпример:** «Добрый день! Пришлите, пожалуйста, ваш актуальный прайс на игристое» от клиента → `SALES_PRICE_REQUEST`.

**Заметка для карточки:** Назвать поставщика, с какой даты и что меняется; шаг — проверить, нужно ли менять наши отпускные цены и открытые предложения с этими товарами, иначе действие не нужно.

## Attributes (атрибуты)

Attributes modify the weight of the dominant code. They are exclusive within a group; the total effect is capped at ±2. `message` scope is read by the LLM; `account` / `contact` scope is derived on the server (no LLM cues). Weights and stages are from v204; Russian names follow Maslov Appendix A.

| Code | Group | Scope | Название (RU) | Weight | Stage | Признаки (RU) | Анти-признаки (RU) |
|---|---|---|---|---|---|---|---|
| `ATTR_EMOTION_ANGRY` | Emotion | message | Гнев | 2 | active | «возмутительно», «неприемлемо», «это безобразие», «досудебная претензия», «будем вынуждены», «обратимся в суд», «расторгнем договор», «сколько это будет продолжаться», «вопиющий случай», «это уже за гранью» | Деловое требование без эмоции («просим заменить бутылку») — не гнев; простая констатация проблемы («пришёл бой, 2 бут.») — `ATTR_EMOTION_NEUTRAL`; разочарование без угроз → `ATTR_EMOTION_FRUSTRATED` |
| `ATTR_EMOTION_FRUSTRATED` | Emotion | message | Разочарование | 2 | active | «к сожалению, опять», «разочарованы», «ожидали большего», «уже не первый раз», «жаль, что так вышло», «не этого мы ждали», «очень неприятно», «расстроены» | Вежливое «к сожалению» без упрёка («к сожалению, не сможем встретиться в четверг») — нет атрибута; угрозы и претензия → `ATTR_EMOTION_ANGRY` |
| `ATTR_EMOTION_IMPATIENT` | Emotion | message | Нетерпение | 1 | active | «срочно», «сколько можно», «жду ответа», «ASAP», «нужно сегодня», «до конца дня», «горит», «когда уже», «третий раз пишу», «ответьте наконец» | Обычный срок без нажима («ответьте, пожалуйста, до пятницы») — не нетерпение; «срочно» в подписи или шаблоне темы — нет атрибута |
| `ATTR_EMOTION_NEUTRAL` | Emotion | message | Нейтральная эмоция | 0 | active | Эмоциональных маркеров нет: деловой стиль, вопросы и факты без оценок («просим выставить счёт», «подтвердите отгрузку на 14.11») | Любой явный маркер гнева, разочарования, нетерпения или радости → соответствующий атрибут |
| `ATTR_EMOTION_POSITIVE` | Emotion | message | Позитивная эмоция | -1 | active | «очень довольны», «гостям очень понравилось», «спасибо огромное», «вы нас выручили», «рады сотрудничеству», «отлично», «супер», «восторг» | Дежурная вежливость («спасибо», «хорошего дня», «с уважением») — нет атрибута; сарказм («спасибо, конечно, за очередную задержку») → `ATTR_TONE_NEGATIVE` |
| `ATTR_SALUTATION_SIE` | Salutation | message | Формальное обращение | 0 | active; по умолчанию выключено для русского (§10.3) | Обращение на «Вы» / «вы», «Уважаемый / Уважаемая», имя-отчество («Добрый день, Ирина Сергеевна»), «Вам», «Ваш», «просим Вас» | Отдельное приветствие «Добрый день» без формы глагола ничего не решает; корпоративная рассылка — нет атрибута |
| `ATTR_SALUTATION_DU` | Salutation | message | Неформальное обращение | -1 | active; по умолчанию выключено для русского (§10.3) | Обращение на «ты»: «тебе», «тебя», «твой», «скинь», «посмотри», «привет, Саш», имя без отчества в уменьшительной форме («Лен, глянь») | Если в тексте есть имя-отчество, «Уважаемый» или «Вы / Вам» — это `ATTR_SALUTATION_SIE` (коррекция в одну сторону); «вы» во множественном числе к команде («коллеги, вы получили?») — не ты-форма |
| `ATTR_TONE_BRIEF` | Brevity | message | Краткий ответ | 1 | active | Ответ меньше 3 предложений на длинное письмо, без объяснений и вопросов: «Нет.», «Не актуально.», «Получили.», «Ок», «Посмотрим.» — только если виден процитированный длинный вопрос | Короткий ответ на короткий вопрос («Да, подходит» на «Подходит пятница?») — нет атрибута; без видимой цитаты — нет атрибута |
| `ATTR_TONE_NEGATIVE` | Tone | message | Негативный тон | 1 | active | Упрёк или оценка, а не факт: «опять ничего не прислали», «уже вторая задержка подряд», «как всегда, всё в последний момент», «снова те же ошибки», «мы вам не первый раз пишем», «ну спасибо за сервис» | Констатация факта без оценки: «пока не получили», «заказ ещё не пришёл», «в накладной другая цена» — нет атрибута |
| `ATTR_TONE_POSITIVE` | Tone | message | Позитивный тон | -1 | active | «с удовольствием», «давайте», «отлично, договорились», «звучит хорошо», «будем рады», «конечно, сделаем», «поддерживаем», «хорошая идея» | Формальное согласие без окраски («согласовано», «принято») — нет атрибута; радость как эмоция → `ATTR_EMOTION_POSITIVE` (другая группа, могут быть оба) |
| `ATTR_CLIENT_HIGH_VALUE` | Client value | account | Высокая ценность клиента | 2 | onHold | Выводится на сервере: выручка клиента за последние 12 месяцев (оплаченные и подтверждённые заказы, `finalized` + `confirmed`) в верхних 20 % клиентов организации | Не из текста письма; слова «мы крупный клиент» не дают атрибут |
| `ATTR_CLIENT_MID_VALUE` | Client value | account | Средняя ценность клиента | 1 | onHold | Выводится на сервере: выручка за 12 месяцев в диапазоне от 50-го до 80-го перцентиля клиентов организации | Не из текста письма |
| `ATTR_CLIENT_LOW_VALUE` | Client value | account | Низкая ценность клиента | 0 | onHold | Выводится на сервере: выручка за 12 месяцев ниже 50-го перцентиля или менее 3 заказов за 12 месяцев | Не из текста письма; новый клиент без истории → `ATTR_REL_DURATION_NEW`, не низкая ценность |
| `ATTR_CLIENT_HIGH_POTENTIAL` | Client value | account | Высокий потенциал | 2 | onHold | Выводится на сервере: отметка «высокий потенциал» в карточке клиента или открытая сделка (листинг, тендер, годовой договор) с суммой выше порога организации | Не из текста письма; единичный крупный заказ без сделки не даёт атрибут |
| `ATTR_REL_DURATION_NEW` | Relationship duration | account | Новые отношения | 1 | onHold | Выводится на сервере: первый заказ клиента менее 6 месяцев назад (или клиент без заказов, созданный менее 6 месяцев назад) | Не из текста письма |
| `ATTR_REL_DURATION_ESTABLISHED` | Relationship duration | account | Установившиеся отношения | 0 | onHold | Выводится на сервере: первый заказ от 6 месяцев до 2 лет назад | Не из текста письма |
| `ATTR_REL_DURATION_LONGTERM` | Relationship duration | account | Длительные отношения | -1 | onHold | Выводится на сервере: первый заказ более 2 лет назад и хотя бы один заказ за последние 12 месяцев | Не из текста письма; давний клиент без заказов за 12 месяцев — не длительные отношения, а кандидат в `ACCOUNT_DORMANT` |
| `ATTR_COMM_SHORTER_COOLER` | Communication pattern | contact | Письма короче и холоднее | 2 | parked | Выводится на сервере: средняя длина писем контакта за 30 дней короче базовой (90 дней) на 40 % и более, меньше приветствий и благодарностей | Не из одного письма; мало писем (менее 5 за период) — нет атрибута |
| `ATTR_COMM_SLOWER_RESPONSE` | Communication pattern | contact | Ответы медленнее | 2 | parked | Выводится на сервере: медианное время ответа контакта за 30 дней выше базовой медианы (90 дней) в 2 раза и более | Не из одного письма; отпуск контакта (`CONTACT_OOO`) исключает период |
| `ATTR_COMM_LONGER_WARMER` | Communication pattern | contact | Письма длиннее и теплее | -1 | parked | Выводится на сервере: письма контакта за 30 дней длиннее базовых на 40 % и более, больше благодарностей и личных фраз | Не из одного письма; длинная претензия — не «теплее» |
| `ATTR_REL_QUALITY_GOOD` | Relationship quality | contact | Хорошие отношения | -1 | parked | Выводится на сервере: за 90 дней преобладают позитивные эмоция и тон, нет жалоб | Не из одного письма |
| `ATTR_REL_QUALITY_NEUTRAL` | Relationship quality | contact | Нейтральные отношения | 0 | parked | Выводится на сервере: за 90 дней нет явного перевеса позитивных или негативных атрибутов | Не из одного письма |
| `ATTR_REL_QUALITY_BAD` | Relationship quality | contact | Плохие отношения | 2 | parked | Выводится на сервере: за 90 дней 2 и более жалобы или преобладают негативные эмоция и тон | Не из одного письма; одна жалоба — не плохие отношения |
| `ATTR_REL_TREND_RISING` | Relationship trend | contact | Отношения улучшаются | -1 | parked | Выводится на сервере: доля позитивных атрибутов за последние 30 дней выше, чем за предыдущие 60 | Не из одного письма |
| `ATTR_REL_TREND_STABLE` | Relationship trend | contact | Стабильные отношения | 0 | parked | Выводится на сервере: доля позитивных и негативных атрибутов за 30 дней в пределах базовой (90 дней) | Не из одного письма |
| `ATTR_REL_TREND_DECLINING` | Relationship trend | contact | Отношения ухудшаются | 2 | parked | Выводится на сервере: доля негативных атрибутов за последние 30 дней выше, чем за предыдущие 60 | Не из одного письма; мало данных — нет атрибута |

**Salutation correction:** a `ATTR_SALUTATION_DU` verdict whose own evidence carries a formal marker (имя-отчество, «Уважаемый», «Вы / Вам / Ваш») is flipped to `ATTR_SALUTATION_SIE`. One direction only.

## Relations

`leads_over`: when both codes are detected, write the card around A and name B. `both`: both codes belong on the card. These two never change the score. `outranks`: B is context only and does not count; A scores and leads.

| Kind | Code A | Code B | Почему (RU) |
|---|---|---|---|
| leads_over | `SIGNAL_AGENCY_CHANGE` | `SIGNAL_AD_ACTIVITY` | Решение о смене агентства важнее кампании, которую оно сделало |
| outranks | `SIGNAL_MERGER` | `SIGNAL_INSOLVENCY` | Если вместе с банкротством сообщают о покупке (спасение, продажа бизнеса из процедуры), новость — покупка; банкротство только контекст и не даёт оценку |
| leads_over | `SIGNAL_MERGER` | `SIGNAL_PARTNERSHIP` | Когда меняется контроль, сделка важнее партнёрства |
| leads_over | `SALES_BOOKING_CANCELLED` | `ACCOUNT_REVENUE_DECLINE_YOY` | Одна карточка отмены заказа; падение выручки — контекст и подтверждение тенденции, а не отдельная карточка |
| both | `SIGNAL_ACCOUNT_WIN` | `SIGNAL_AGENCY_CHANGE` | Один тендер с двух сторон: агентство выиграло, рекламодатель сменил агентство; писать для той стороны, которая наш клиент, и называть другую |
| leads_over | `SIGNAL_INSOLVENCY` | `SIGNAL_NEGATIVE_PRESS` | Угроза существованию важнее репутационной |
| leads_over | `SIGNAL_NEW_MARKETING_LEAD` | `SIGNAL_C_LEVEL_CHANGE` | При смене директора по маркетингу ведёт маркетинговый код |
| leads_over | `COMPLAINT_QUANTITY` | `COMPLAINT_QUALITY` | Если привезли меньше, чем заказано, это жалоба на количество, даже если клиент называет это браком |
| leads_over | `SIGNAL_MERGER` | `SIGNAL_FUNDING` | Когда меняется контроль, покупка важнее инвестиции |
| leads_over | `SALES_OFFER_DECLINED` | `SALES_OFFER_NO_RESPONSE` | Явный отказ закрывает вопрос; «нет ответа» уже не актуально |
| leads_over | `CONTRACT_TERMINATED` | `CONTRACT_NOT_RENEWED` | Действие клиента (расторжение) важнее простого истечения срока |
| leads_over | `CONTRACT_RENEWAL_INTENT` | `CONTRACT_FRAME_EXPIRY` | Возможность продления важнее предупреждения об окончании договора |
| leads_over | `SALES_BOOKING_CANCELLED` | `SALES_BUDGET_CUT` | Конкретная потеря заказа важнее общего сокращения бюджета |
| leads_over | `SIGNAL_CHANNEL_SHIFT` | `SIGNAL_SPEND_DOWN` | Если общий бюджет почти не меняется, это перераспределение между каналами, а не сокращение |
| leads_over | `SIGNAL_REBRANDING` | `SIGNAL_PRODUCT_NEWS` | Если изменился сам бренд, ребрендинг важнее новости о продукте |
| leads_over | `ACCOUNT_REVENUE_DECLINE_YOY` | `ACCOUNT_REVENUE_STAGNATION` | Конкретное текущее падение выручки ведёт; стагнация — контекст |
| both | `COMPLAINT_ESCALATED` | `COMPLAINT_PRICE` | Эскалация и жалоба на цену под ней — обе в одной карточке |
| both | `COMPLAINT_ESCALATED` | `COMPLAINT_TIMING` | Эскалация и жалоба на сроки под ней — обе в одной карточке |
| both | `COMPLAINT_ESCALATED` | `COMPLAINT_COMM` | Эскалация и жалоба на коммуникацию под ней — обе в одной карточке |
| both | `COMPLAINT_ESCALATED` | `COMPLAINT_QUANTITY` | Эскалация и жалоба на количество под ней — обе в одной карточке |
| both | `COMPLAINT_ESCALATED` | `COMPLAINT_QUALITY` | Эскалация и жалоба на качество под ней — обе в одной карточке |
| both | `SALES_NEW_DEMAND` | `SALES_OFFER_REQUESTED` | Новая потребность — возможность, запрос КП — задача; обе в одной карточке |

## Open points

1. **Stage of blocks H, J, K, L, M in `base`.** Spec §4.3 says these blocks are imported `onHold` until needed. v204 has 36 H codes, 5 K codes and 2 L codes `active`. This file uses the v204 stage (task rule: v204 wins). Recommendation: keep the v204 stage in the pack seed and control use per org with the IN4COM column (activation); change the §4.3 text.
2. **`inbound_only` and `class_by_relation` per code are not in the v204 export** (it gives only the counts 38 and 19). Proposals in this file: inbound only — H no, I yes, J no, K «—», L no, M «—», N yes; class by relation = yes for `SIGNAL_AGENCY_CHANGE`, `SIGNAL_NEW_MARKETING_LEAD`, `SIGNAL_MERGER`, `SIGNAL_C_LEVEL_CHANGE`, `SIGNAL_STRATEGY_ANNOUNCEMENT`, `SIGNAL_CHANNEL_SHIFT`, `SIGNAL_JOB_POSTING`, `SIGNAL_TRACKING_VENDOR_CHANGE` (from the v204 card notes). Recommendation: read the real flags from the Truffalo `signal_category` table before the seed is loaded.
3. **Trend list vs `kind`.** `SIGNAL_SPEND_UP` / `SIGNAL_SPEND_DOWN` have kind `event` in v204 but are on the spec §5.6 trend list. `ACCOUNT_PRODUCT_STOPPED` has kind `trend` in v204 but is not on the spec list. Recommendation: apply the D4 ceiling to the union (kind `trend` OR on the list), and add `ACCOUNT_PRODUCT_STOPPED` to the spec trend list.
4. **`SIGNAL_CONTACT_QUIET` emitted by.** v204 says `both`; the trend rule says process only. The code is parked, so there is no effect now. Recommendation: keep `both` in the seed, keep it out of the prompt, decide when it is un-parked.
5. **`SIGNAL_NEGATIVE_PRESS` class.** v204 class is `chance` (agency view: crisis communication). For a distributor, a recall or a closure by Роспотребнадзор at a client is a risk. Recommendation: keep `chance` in `base`; override to `risk` in the `distribution` pack.
6. **`SIGNAL_INSOLVENCY` recipient.** Maslov gives `relationship`; for a distributor the main action is credit stop and receivables. Recommendation: IN4COM override → `finance` (with the client's responsible manager), profile P8 as in draft §3 question 3.
7. **No data source for `SIGNAL_SPEND_UP`, `SIGNAL_SPEND_DOWN`, `SIGNAL_NEW_TOP_SPENDER`.** The thresholds (±20 % per quarter, top-50) are proposals. Recommendation: keep `onHold` until an external feed exists.
8. **Agency-centric H codes in `base`** (`SIGNAL_AGENCY_CHANGE`, `SIGNAL_ACCOUNT_WIN`, `SIGNAL_AD_ACTIVITY`, `SIGNAL_CAMPAIGN_PLANNED`, `SIGNAL_CHANNEL_SHIFT`, `SIGNAL_TRACKING_*`). They follow v204 and stay in `base`, off for IN4COM. Recommendation: review later whether they move to the `agency` pack.
9. **Overlap `SIGNAL_EXPANSION` vs `NEW_VENUE_OPENING` (distribution).** Rule in this file: when the client confirms the opening in its own message, only `NEW_VENUE_OPENING`; news or third-party mention → `SIGNAL_EXPANSION`. Recommendation: write the same boundary into the distribution pack file.
10. **Leadership freshness rule** (`SIGNAL_NEW_MARKETING_LEAD`, `SIGNAL_C_LEVEL_CHANGE`: not older than 6 months) is a prompt rule in v204, not a server date gate. Recommendation: add a date gate with fact `changeEffectiveDate` when the `press` profile starts (phase 11).
11. **K — revenue thresholds (proposals).** v204 reports every decline; proposal for a distributor: decline ≥ 15 % and ≥ 100 000 ₽ (`cards.revenueDeclineThresholdPct`, `cards.revenueDeclineMinRub`), baseline ≥ 100 000 ₽ and ≥ 3 orders. Growth: v204 `cards.revenueGrowthThresholdPct` = 10 plus a minimum of 100 000 ₽. Stagnation threshold 5 %. Recommendation: calibrate on IN4COM order history before phase 8.
12. **K — `ACCOUNT_DORMANT`.** v204: average gap, floor 90 days, best year ≥ €20 000. Proposal for a distributor: median gap of the last 12 months, floor 21 days, `cards.dormantMinBestYearRub` = 300 000 ₽; one card per client and last order. Also proposed: no `ACCOUNT_REVENUE_DECLINE_YOY` while `ACCOUNT_DORMANT` is open for the client (not a v204 relation). Recommendation: confirm with IN4COM.
13. **K — product key and missing data.** `ACCOUNT_PRODUCT_STOPPED` / `ACCOUNT_PRODUCT_NEW` use `product.id`; if each vintage is a separate catalogue row, they give false hits. The CRM has no client segment field, so `ACCOUNT_MEETING_OVERDUE` and `ACCOUNT_SEGMENT_*` cannot run (proposal only: A top 20 % / B next 30 % / C rest; meetings every 30 / 90 / 180 days). Other proposed defaults: `cards.reactivationIntervalDays` = 180, `cards.newClientFollowupDays` = 14, `cards.productMinOrders` = 4, `cards.productStoppedMinDays` = 90, cross-sell 60 %. Recommendation: group by product without vintage; add a segment field only when MEETING_OVERDUE is needed.
14. **M — trigger values are proposals** (price change ≥ 5 %, cooldown 30 days per SKU, 90-day window for out-of-stock). The product catalogue keeps no price history. Recommendation: store a price snapshot per catalogue import before M is switched on.
15. **N — recipient and weight.** The recipient enum has no `purchasing`; both N codes use `logistics`. `SUPPLIER_DELIVERY_DELAY`: v204 = 4 · fyi, IN4COM draft question 6 = 5 · risk. Recommendation: add a `purchasing` role (or IN4COM confirms logistics); decide the weight as an IN4COM override after the review.
16. **J gate.** All six J codes are `gated`; v204 does not say what opens the gate. Recommendation: keep gated, IN4COM off, define the gate when internal chats are connected.
17. **Attributes.** Server rules for `account` / `contact` attributes (revenue percentiles, relationship length, 30 / 90-day baselines) are proposals; v204 gives none. Salutation attributes stay `active` (v204) but spec §10.3 says off by default for Russian. Recommendation: per-org override `stage = off` for both salutation attributes in every Russian org (or a language default flag in the registry).
18. **Families without an exact match.** `PARTNER_*` → `market` (no `partner` family); `SIGNAL_COMPETITOR` → `competitor`; `SIGNAL_CONTACT_QUIET` → `account`; `MAILERDEMON_RECEIVED` → `contact`. Recommendation: accept, or add a `partner` family.

# Topics — signals: base pack, blocks A–G

> **Historical seed source — not updated (R22, 2026-11-14).** This file was the source of the registry seed (migration `0012`). After the seed **the DB is the master**; change signals in Settings → «Сигналы». Decision R22 (migration `0016_signals_generic_registry`) made the registry one generic set: it cleaned the DB texts of wine / alcohol / HoReCa examples and «IN4COM: …» notes, deleted 7 alcohol-only codes and dropped the IN4COM column / presets. This file still shows the old texts and the old «IN4COM» column; it is not updated. `04-distribution-pack-draft.md` and `05c-signals-distribution.md` are deleted (git history keeps them).

Status: draft for review · 2026-11-11 · seed data for the registry (spec §4)

**Sources.** Weights, score rules, classes, kinds, stages, "emitted by", amount and "asks us" flags, relations, closures and date gates come from the Truffalo taxonomy v204 (`truffalo-logic-2026-11-10-10-05/signals-taxonomy.md`). v204 wins over all other sources. Russian labels, display profiles and recipients come from the Maslov catalog v195 (§1 tables, §3 funnel, §4 risks, §5.5 merges, appendix B); the labels are made generic (not agency-only). Where v204 has no effort tier, the Maslov effort is used ("Средняя*" → medium). Field meanings, extraction rules, bands and the mandatory Russian cue examples come from `01-specification.md` §4.2, §5.3–5.5, §10.2. The IN4COM column and the wine-trade cues come from `04-distribution-pack-draft.md` §2 (`on` = in the §2 table, `off` = in the "Proposed off" line, `review` = everything else); deal-risk triggers come from 04 §4. Q24 decisions from `02-open-questions-answers.md` apply: no go / no-go and no senior-team routing (Q24-7); no-response rules (Q24-11); trend list (Q24-6 — no trend codes are in blocks A–G); repeated postponement = 2nd distinct postponement (Q24-3). v204 exports only the total count of inbound-only codes (38), not the per-code flag, so the "Inbound only" values here are inferred from each definition (author = client); see Open points. **Count check:** v204 blocks A–G hold 24 + 3 + 4 + 2 + 11 + 7 + 4 = **55 codes**; this file has 55 entries: 45 active, 6 onHold, 4 parked, 0 gated. All 20 v204 "asks us" codes are in these blocks.

Conventions used in all entries:

- "Inbound only = yes" → the server drops the code when `direction = outbound` (spec §5.4 step 2).
- "Display profile from weight" follows spec §5.5: 1–3 W1, 4–5 D4, 6–7 P6, 8–9 P8; state codes S0.
- Recipient roles follow the Maslov catalog (pack default). IN4COM may override them later (the 04 draft uses `sales` = `account`).
- "Deal effect" for base is always **per org rule** (`signal_stage_rule`, spec §9.2). The text after it is the usual effect, and for IN4COM the effect that 04 §2 / §4 proposes. Risks never move a stage (spec §9.2).
- Distribution-pack codes named in boundaries (`ORDER_*`, `DELIVERY_DISCREPANCY`, `PAYMENT_TERMS_REQUEST` and others) apply only in orgs where the `distribution` pack is on. Agency-pack codes (`PITCH_*`, `COMPLAINT_RESOLUTION_CONFIRMED` and others) apply only where the `agency` pack is on. Without that pack, the base code keeps the full meaning.

---

## A · Продажи

| Code | Название (RU) | W | Class | Kind | Score rule | Effort | Asks us | Inbound only | Amount | Stage (pack) | IN4COM | Profile | Recipient | Family |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `SALES_TENDER_INVITATION` | Приглашение к участию в тендере / закупке | 9 | chance | event | fixed | complex | yes | yes | yes | active | on | P8 | opportunity | offer |
| `CONTRACT_TERMINATED` | Клиент расторгает договор | 9 | risk | event | fixed | medium | — | yes | — | active | on | P8 | account | contract |
| `SALES_BOOKING_RECEIVED` | Клиент подтвердил заказ (твёрдое обязательство) | 8 | chance | event | fixed | medium | — | yes | yes | active | off | P8 | opportunity | order |
| `CONTRACT_FRAME_EXPIRY` | Рамочный или годовой договор заканчивается (менее 8 недель) | 8 | risk | watchdog | fixed | medium | yes | — | yes | active | on | P8 | account | contract |
| `SALES_BUDGET_CUT` | Клиент сокращает бюджет на работу с нами | 8 | risk | event | fixed | medium | — | yes | yes | active | off | P8 | opportunity | account |
| `CONTRACT_NOT_RENEWED` | Договор истёк и не продлён | 8 | risk | watchdog | fixed | medium | — | — | — | onHold | review | P8 | account | contract |
| `SALES_OFFER_SENT` | Мы отправили коммерческое предложение | 0 | — | state | state | — | — | — | yes | active | on | S0 | opportunity | offer |
| `SALES_OFFER_NO_RESPONSE` | Нет ответа на отправленное КП | 7 | risk | watchdog | fixed | medium | — | — | yes | onHold | review | P6 | opportunity | offer |
| `SALES_OFFER_REQUESTED` | Запрошено коммерческое предложение | 7 | chance | event | fixed | complex | yes | yes | yes | active | on | P6 | opportunity | offer |
| `SALES_BOOKING_CANCELLED` | Клиент отменил размещённый заказ | 7 | risk | event | fixed | medium | — | yes | yes | active | off | P6 | opportunity | order |
| `SALES_RENEGOTIATION` | Клиент хочет пересмотреть согласованные условия | 7 | risk | event | fixed | medium | — | yes | yes | active | on | P6 | opportunity | contract |
| `SALES_NEW_DEMAND` | Дополнительная потребность действующего клиента | 7 | chance | event | fixed | medium | — | yes | yes | active | review | P6 | opportunity | offer |
| `SALES_BUDGET_INCREASE` | Клиент увеличивает бюджет на работу с нами | 7 | chance | event | fixed | medium | — | yes | yes | active | off | P6 | opportunity | account |
| `CONTRACT_RENEWAL_INTENT` | Клиент сам поднял вопрос продления договора | 7 | chance | event | fixed | medium | yes | yes | — | active | on | P6 | account | contract |
| `SALES_PRICE_REQUEST` | Запрошены цены, прайс-лист или стандартные условия | 6 | chance | event | fixed | quick | yes | yes | yes | active | on | P6 | opportunity | offer |
| `SALES_MATERIAL_REQUESTED` | Запрошены индивидуальные материалы (концепция, макет, презентация) | 6 | chance | event | fixed | complex | yes | yes | yes | active | off | P6 | opportunity | offer |
| `SALES_ORDER_CONFIRMATION_REQUESTED` | Клиент просит подтвердить заказ | 6 | chance | event | fixed | quick | yes | yes | yes | active | review | P6 | opportunity | order |
| `SALES_OFFER_DECLINED` | Клиент отклонил предложение | 6 | risk | event | fixed | medium | — | yes | — | active | on | P6 | opportunity | offer |
| `SALES_ORDER_CONFIRMATION_OPEN` | Обещанное подтверждение заказа не отправлено | 5 | risk | watchdog | fixed | medium | — | — | yes | onHold | review | D4 | opportunity | order |
| `SALES_ORDER_CONFIRMATION_SENT` | Мы отправили подтверждение заказа | 0 | — | state | state | — | — | — | — | active | review | S0 | opportunity | order |
| `SALES_MATERIAL_NO_RESPONSE` | Нет реакции на индивидуальные материалы | 5 | risk | watchdog | fixed | medium | — | — | yes | onHold | off | D4 | opportunity | offer |
| `SALES_PRICE_NO_RESPONSE` | Нет реакции на отправленные цены | 5 | risk | watchdog | fixed | medium | — | — | yes | onHold | review | D4 | opportunity | offer |
| `SALES_CATALOG_REQUESTED` | Запрошен каталог или обзор ассортимента / услуг | 5 | chance | event | fixed | quick | yes | yes | — | active | on | D4 | opportunity | offer |
| `SALES_BUDGET_MENTIONED` | Клиент назвал бюджет конкретной задачи | 4 | chance | event | fixed | medium | — | yes | yes | active | off | D4 | opportunity | offer |

Block A: 24 codes — 19 active, 5 onHold (all watchdogs, emitted by process).

### `SALES_TENDER_INVITATION` — Приглашение к участию в тендере / закупке

| Field | Value |
|---|---|
| Pack · block · family | base · A · offer |
| Weight · class · kind · score rule | 9 · chance · event · fixed |
| Effort · asks us · inbound only · amount | complex · yes · yes · yes |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · on |
| Display profile | from weight (P8) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: — (outcome of the tender is a separate event) |
| Relations | — in v204. Agency pack: merges with `CONTRACT_RETENDER_ANNOUNCED` into one re-pitch card (Maslov §5.5). |
| Date gate | — (the application deadline goes to `facts.deadlines`, owner = us) |
| Relevance window | until the application deadline («срок подачи заявок»); default when no deadline is given |
| Deal effect | per org rule. Usual: deal entry (deal type «тендер»). IN4COM: **deal entry** (chains, hotel groups, state buyers). Agency: stage 1 «Новая возможность». |

**Определение:** Клиент или заказчик приглашает нас участвовать в тендере, конкурсе, запросе котировок или запросе предложений с процедурой выбора и сроком подачи; либо становится известна публичная закупка, прямо подходящая под наши товары или услуги. Обычно есть срок подачи заявок, документация и порядок определения победителя.

**Граница (не считается):** Просьба прислать КП без процедуры отбора и без срока подачи — `SALES_OFFER_REQUESTED`. Просьба прислать прайс для сравнения — `SALES_PRICE_REQUEST`. Рассылка торговой площадки или агрегатора тендеров «вам может быть интересно» без связи с нашим профилем — нет сигнала. Итоги тендера (победа, проигрыш) — не этот код. Наш собственный поиск закупок — не сигнал клиента.

**Признаки для промпта (≤ 8):** «тендер», «закупка», «44-ФЗ», «223-ФЗ», «котировка», «НМЦК», «срок подачи заявок», «приглашаем принять участие»

**Синонимы и выражения (полный список):**
- Деловая переписка: «приглашаем принять участие в закупке», «приглашаем к участию в конкурсе», «просим направить коммерческое предложение в рамках запроса котировок», «объявлен тендер на поставку», «конкурсная документация во вложении», «закупочная процедура», «отбор поставщиков», «прошу подать заявку до», «проводим конкурентный отбор»
- Чаты / мессенджеры (разговорный стиль): «у нас тендер на вино, будете участвовать?», «скинула ссылку на закупку», «запускаем отбор поставщиков, хотите поучаствовать?», «закупка висит на площадке до пятницы»
- Сокращения и термины: «44-ФЗ», «223-ФЗ», «НМЦК», «НМЦД», «ЕИС», «zakupki.gov.ru», «ЭТП», «РТС-тендер», «Сбербанк-АСТ», «B2B-Center», «запрос котировок», «запрос предложений», «аукцион в электронной форме», «RFP», «RFQ», «RFI», «ТЗ», «обеспечение заявки»
- Устойчивые конструкции / маркеры: «приглашаем к участию в» + «тендере / конкурсе / закупке»; «срок подачи заявок до» + дата; «просим направить заявку»; «тендер на поставку» + товар; «включены в список участников» (дистрибуция: тендер сети, отельной группы, госзаказчика)

**Похоже, но не это (анти-признаки):** «пришлите КП на 200 бутылок к празднику» → `SALES_OFFER_REQUESTED`; «скиньте прайс, сравниваем поставщиков» → `SALES_PRICE_REQUEST`; «по итогам закупки победителем признан» → нет сигнала (исход); рассылка «Подборка тендеров за неделю» от сервиса → нет сигнала.

**Пример (evidence):** «Приглашаем вашу компанию принять участие в запросе котировок на поставку вин для ресторанов сети, срок подачи заявок — до 25.11 включительно, НМЦК 4,8 млн руб.»
**Контрпример:** «Подготовьте, пожалуйста, коммерческое предложение на винную карту нового ресторана» → это `SALES_OFFER_REQUESTED`: нет процедуры отбора и срока подачи заявок.

**Заметка для карточки:** Напиши, кто проводит закупку, предмет, срок подачи и НМЦК (если есть); шаги — изучить документацию, решить по участию, подготовить заявку к сроку.

### `CONTRACT_TERMINATED` — Клиент расторгает договор

| Field | Value |
|---|---|
| Pack · block · family | base · A · contract |
| Weight · class · kind · score rule | 9 · risk · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · yes · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · on |
| Display profile | from weight (P8) |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: — |
| Relations | leads over `CONTRACT_NOT_RENEWED` (an act beats the passing of time). |
| Date gate | — (termination date goes to `facts.deadlines`) |
| Relevance window | default |
| Deal effect | per org rule. Usual: outcome `lost` (or `cancelled`) for an open deal on this contract; otherwise context on the client. Never rewrites a won sale (Maslov §3.3). IN4COM: outcome for the supply-agreement deal. |

**Определение:** Клиент активно прекращает действующий договор: направляет уведомление о расторжении, отказ от исполнения или сообщает, что прекращает сотрудничество по договору с определённой даты.

**Граница (не считается):** Договор просто истёк, а продления нет — `CONTRACT_NOT_RENEWED` (watchdog). Отказ продлевать на следующий период до окончания срока — в агентском пакете `CONTRACT_RENEWAL_DECLINED`, в базе — этот код, только если клиент прямо прекращает отношения. Отмена одного заказа — `SALES_BOOKING_CANCELLED` (в дистрибуции `ORDER_CANCELLED`). Пауза в работе без расторжения — не этот код. Расторжение по нашей инициативе — не сигнал клиента. Угроза «будем вынуждены расторгнуть» без решения — `COMPLAINT_*` с эмоцией, не расторжение.

**Признаки для промпта (≤ 8):** «расторгаем договор», «уведомляем о расторжении», «односторонний отказ от исполнения договора», «соглашение о расторжении», «прекращаем сотрудничество», «договор прекращает действие с», «отказываемся от договора», «больше не будем с вами работать»

**Синонимы и выражения (полный список):**
- Деловая переписка: «настоящим уведомляем о расторжении договора поставки №», «направляем уведомление об одностороннем отказе от исполнения договора», «просим считать договор расторгнутым с», «во вложении соглашение о расторжении», «в соответствии с п. договора уведомляем о прекращении», «принято решение прекратить сотрудничество», «договор будет расторгнут по истечении 30 дней с даты уведомления»
- Чаты / мессенджеры (разговорный стиль): «мы с вами больше не работаем», «всё, расходимся, договор расторгаем», «руководство решило уйти от вас», «закрываем с вами договор»
- Сокращения и термины: «уведомление о расторжении», «соглашение о расторжении», «односторонний отказ», «ст. 450.1 ГК», «ст. 523 ГК», «досрочное расторжение»
- Устойчивые конструкции / маркеры: «уведомляем о» + «расторжении / прекращении»; «расторгнуть договор с» + дата; «прекращаем сотрудничество с» + дата

**Похоже, но не это (анти-признаки):** «договор заканчивается 31.12, продлевать пока не планируем» → `CONTRACT_FRAME_EXPIRY` (+ отказ от продления); «отменяем заказ на следующую неделю» → `SALES_BOOKING_CANCELLED` / `ORDER_CANCELLED`; «если так пойдёт дальше, будем вынуждены расторгнуть» → `COMPLAINT_*` (угроза, не решение); «приостанавливаем закупки до нового года» → нет этого кода.

**Пример (evidence):** «Настоящим уведомляем о расторжении договора поставки № 14/23 в одностороннем порядке с 01.12.2026 в соответствии с п. 9.3.»
**Контрпример:** «Если ситуация с поставками не изменится, мы будем вынуждены рассмотреть расторжение договора» → это угроза внутри жалобы (`COMPLAINT_TIMING` + эмоция), решение не принято.

**Заметка для карточки:** Укажи договор, дату прекращения и названную причину; шаги — связаться с ЛПР клиента, выяснить причину, оценить шанс сохранить отношения и закрыть взаиморасчёты.

### `SALES_BOOKING_RECEIVED` — Клиент подтвердил заказ (твёрдое обязательство)

| Field | Value |
|---|---|
| Pack · block · family | base · A · order |
| Weight · class · kind · score rule | 8 · chance · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · yes · yes |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · off (replaced by `ORDER_REQUESTED`) |
| Display profile | from weight (P8) |
| Recipient role | opportunity |
| Closes / closed by | closes: — (agency: closes the formalisation question of the chosen opportunity, Maslov §5.5) · closed by: — |
| Relations | — in v204. Successor of retired `SALES_ORDER_CONFIRM`. |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule. Usual: stage move to the final stage «Заказ подтверждён» (agency stage 5). IN4COM: off — orders are `ORDER_*` and never move deals in step one (Q26). |

**Определение:** Клиент даёт обязывающее подтверждение заказа: подписанный заказ или заявку, гарантийное письмо, «согласовываем, запускайте», подписанное КП или спецификацию. Есть твёрдое решение купить, а не намерение.

**Граница (не считается):** Намерение («скорее всего возьмём», «планируем заказать») — не этот код. Просьба выслать подтверждение заказа от нас — `SALES_ORDER_CONFIRMATION_REQUESTED`. В организации с пакетом дистрибуции регулярный товарный заказ («отгрузите 12 коробок») — `ORDER_REQUESTED`, не этот код. Устный выбор поставщика без оформления — агентский `PITCH_VERBAL_SELECTION`. Оплата счёта — `INVOICE_PAID`.

**Признаки для промпта (≤ 8):** «подтверждаем заказ», «согласовываем, запускайте», «подписанная спецификация во вложении», «гарантийное письмо», «КП согласовано», «принимаем ваше предложение», «оформляем заказ», «берём в работу по вашему КП»

**Синонимы и выражения (полный список):**
- Деловая переписка: «настоящим подтверждаем заказ», «направляем подписанную заявку», «согласовываем коммерческое предложение от», «просим приступить к выполнению», «гарантируем оплату», «подписанный договор-заявка во вложении», «принимаем ваше предложение в полном объёме», «утверждаем смету»
- Чаты / мессенджеры (разговорный стиль): «ок, берём», «согласовали, запускайте», «да, делаем по вашему варианту», «подписали, отправила скан», «го, заказываем»
- Сокращения и термины: «заявка», «спецификация», «ДС на поставку», «гарантийное письмо», «PO», «purchase order», «акцепт оферты»
- Устойчивые конструкции / маркеры: «подтверждаем» + «заказ / заявку / объём»; «согласовываем» + «КП / смету»; «просим приступить»

**Похоже, но не это (анти-признаки):** «думаю, возьмём, но надо согласовать с директором» → нет сигнала (намерение); «пришлите подтверждение заказа» → `SALES_ORDER_CONFIRMATION_REQUESTED`; «отгрузите, пожалуйста, 20 бут. Шабли» → `ORDER_REQUESTED` (дистрибуция); «оплатили счёт» → `INVOICE_PAID`.

**Пример (evidence):** «Коммерческое предложение от 12.11 согласовано, подписанную спецификацию направляем во вложении, просим приступить к поставке.»
**Контрпример:** «Ваше предложение нам в целом нравится, обсудим внутри и вернёмся» → интереса недостаточно, решения нет.

**Заметка для карточки:** Укажи, что именно подтверждено, сумму и срок; шаги — зафиксировать заказ, проверить документы, запустить исполнение.

### `CONTRACT_FRAME_EXPIRY` — Рамочный или годовой договор заканчивается (менее 8 недель)

| Field | Value |
|---|---|
| Pack · block · family | base · A · contract |
| Weight · class · kind · score rule | 8 · risk · watchdog · fixed |
| Effort · asks us · inbound only · amount | medium · yes · no · yes |
| Emitted by | both (parser with date gate; process from the contract end date) |
| Stage (pack default) · IN4COM | active · on |
| Display profile | from weight (P8) |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: — (the IN4COM risk clears with `CONTRACT_RENEWAL_INTENT` or a signed renewal) |
| Relations | `CONTRACT_RENEWAL_INTENT` leads over this code (the opportunity beats the warning). |
| Date gate | { fact: `contractEndDate`, test: within 0 to N days after the item, setting: `cards.frameExpiryWindowDays`, window: 56 } |
| Relevance window | until `contractEndDate` |
| Deal effect | per org rule. Usual: risk trigger. IN4COM: risk trigger «Договор заканчивается без продления» (no `CONTRACT_RENEWAL_INTENT` in the date window). |

**Определение:** В переписке обсуждается срок действия рамочного, годового или пролонгируемого договора, и указана дата его окончания; система проверяет, что до неё меньше 8 недель. Также процесс создаёт сигнал по дате окончания договора из CRM.

**Граница (не считается):** Модель не решает, «скоро ли» дата: она указывает код, когда обсуждается срок и заполнен `contractEndDate`; сервер отбрасывает код, если дата дальше окна. Клиент сам предлагает продлить — `CONTRACT_RENEWAL_INTENT` (ведёт). Клиент расторгает — `CONTRACT_TERMINATED`. Срок действия КП или цены («цены действительны до») — не договор. Разовый договор на один заказ — не этот код.

**Признаки для промпта (≤ 8):** «договор заканчивается», «срок действия договора до», «пролонгация», «продление договора», «доп. соглашение», «договор поставки заканчивается», «истекает срок договора», «автопролонгация»

**Синонимы и выражения (полный список):**
- Деловая переписка: «срок действия договора истекает 31.12.2026», «напоминаем, что договор действует до», «просим рассмотреть вопрос пролонгации», «необходимо подписать дополнительное соглашение о продлении», «договор не предусматривает автоматической пролонгации», «по окончании срока действия договора», «готовим документы на следующий год»
- Чаты / мессенджеры (разговорный стиль): «у нас договор до конца года, что дальше?», «договор кончается в декабре», «надо переподписать договор», «давайте решим с договором на следующий год»
- Сокращения и термины: «ДС», «доп. соглашение», «пролонгация», «автопролонгация», «рамочный договор», «годовой договор», «договор поставки», «срок действия»
- Устойчивые конструкции / маркеры: «договор действует до» + дата; «истекает» + дата; «пролонгировать на» + срок

**Похоже, но не это (анти-признаки):** «продлим договор на следующий год, пришлите ДС» → `CONTRACT_RENEWAL_INTENT`; «цены в КП действительны до 30.11» → нет сигнала (срок КП); «уведомляем о расторжении» → `CONTRACT_TERMINATED`.

**Пример (evidence):** «Напоминаем, что срок действия договора поставки № 7 истекает 31.12.2026, автоматической пролонгации договор не предусматривает.»
**Контрпример:** «Договор у нас бессрочный, условия обсудим весной» → нет даты окончания, нет сигнала.

**Заметка для карточки:** Укажи договор и дату окончания; шаги — проверить условия, связаться с клиентом по продлению, подготовить доп. соглашение заранее.

### `SALES_BUDGET_CUT` — Клиент сокращает бюджет на работу с нами

| Field | Value |
|---|---|
| Pack · block · family | base · A · account |
| Weight · class · kind · score rule | 8 · risk · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · yes · yes |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · off |
| Display profile | from weight (P8) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: — |
| Relations | `SALES_BOOKING_CANCELLED` leads over this code (the concrete loss counts). |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule. Usual: in-stage context (budget), no stage move. Agency: risk trigger «Сокращение бюджета» (Maslov risk 11). IN4COM: off. |

**Определение:** Клиент сообщает, что сокращает бюджет или объём закупок у нас в целом или на период (квартал, год, направление).

**Граница (не считается):** Один заказ меньше прошлого — не этот код. Отмена конкретного заказа — `SALES_BOOKING_CANCELLED` (ведёт). Просьба о скидке — `SALES_RENEGOTIATION`. Сокращение бюджета клиента вообще, без связи с нами (новость о компании), — блок H. В дистрибуции вывод наших позиций из ассортимента — `DELISTING_RISK`.

**Признаки для промпта (≤ 8):** «сокращаем бюджет», «урезали бюджет», «бюджет на следующий год меньше», «вынуждены сократить объёмы», «режем расходы», «оптимизация затрат», «секвестр», «заморозили бюджет»

**Синонимы и выражения (полный список):**
- Деловая переписка: «в связи с оптимизацией затрат бюджет на 2027 год сокращён на 30%», «вынуждены сократить объём закупок», «бюджет по направлению урезан», «пересмотр бюджета в сторону уменьшения», «лимиты на квартал снижены», «финансирование сокращено»
- Чаты / мессенджеры (разговорный стиль): «бюджет порезали», «денег дали меньше», «в этом году будем брать сильно меньше», «нам срезали лимиты»
- Сокращения и термины: «оптимизация», «секвестр», «лимиты», «бюджет на год», «план закупок»
- Устойчивые конструкции / маркеры: «сокращаем» + «бюджет / объёмы / закупки»; «бюджет меньше на» + %

**Похоже, но не это (анти-признаки):** «в этот раз возьмём поменьше» → нет сигнала (один заказ); «отменяем заказ» → `SALES_BOOKING_CANCELLED`; «дайте скидку, иначе не пройдём по бюджету» → `SALES_RENEGOTIATION`.

**Пример (evidence):** «Сообщаем, что бюджет на закупку на 2027 год утверждён на 25% ниже текущего, объёмы по договору придётся сократить.»
**Контрпример:** «На Новый год в этот раз возьмём на пару коробок меньше» → это один заказ, не сокращение бюджета.

**Заметка для карточки:** Укажи, на сколько и с какого срока сокращается бюджет; шаги — выяснить причину и приоритеты, предложить вариант в новом бюджете.

### `CONTRACT_NOT_RENEWED` — Договор истёк и не продлён

| Field | Value |
|---|---|
| Pack · block · family | base · A · contract |
| Weight · class · kind · score rule | 8 · risk · watchdog · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | process |
| Stage (pack default) · IN4COM | onHold · review |
| Display profile | from weight (P8) |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: — (watchdog clears when a renewal is recorded) |
| Relations | `CONTRACT_TERMINATED` leads over this code. |
| Date gate | — (uses the stored contract end date) |
| Relevance window | default |
| Deal effect | per org rule. Usual: risk trigger on the account; no stage move. |

**Определение:** Дата окончания договора прошла, а продления (ДС, нового договора, подтверждения) нет. Создаётся процессом, не моделью.

**Граница (не считается):** Активное расторжение клиентом — `CONTRACT_TERMINATED`. Договор ещё действует, но скоро заканчивается — `CONTRACT_FRAME_EXPIRY`. Молчание клиента — не отказ: этот код говорит только о том, что срок прошёл без продления.

**Признаки для промпта:** — (not in the extraction prompt; emitted by process)

**Правило срабатывания:** RU: дата окончания договора (`contractEndDate` из сигналов или из карточки договора) прошла; после неё нет подписанного продления, сигнала `CONTRACT_RENEWAL_INTENT` с подтверждением или нового договора; один сигнал на договор. EN: the stored contract end date has passed; no renewal, no confirmed `CONTRACT_RENEWAL_INTENT` and no new contract after it; one signal per contract.

**Пример (evidence):** Договор поставки истёк 31.10; на 01.11 в CRM нет ДС о продлении и нет переписки о продлении.

**Заметка для карточки:** Укажи договор и дату окончания; шаги — уточнить у клиента планы на следующий период, предложить продление.

### `SALES_OFFER_SENT` — Мы отправили коммерческое предложение

| Field | Value |
|---|---|
| Pack · block · family | base · A · offer |
| Weight · class · kind · score rule | 0 · — · state · state |
| Effort · asks us · inbound only · amount | — · no · no · yes |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · on |
| Display profile | S0 (state code, closes and makes no card) |
| Recipient role | opportunity |
| Closes / closed by | closes: `SALES_OFFER_REQUESTED` (same client / topic) · closed by: — |
| Relations | starts the `SALES_OFFER_NO_RESPONSE` watchdog (REPLY_WINDOW, or the countdown from `facts.offerValidUntil`). |
| Date gate | — |
| Relevance window | default |
| Deal effect | none — our own action never moves a stage (spec §9.2, author-only rule). |

**Определение:** Служебное событие: мы (наша организация) отправили клиенту коммерческое предложение, смету или расчёт. Не создаёт карточку; закрывает открытый запрос КП этого клиента и запускает ожидание ответа.

**Граница (не считается):** Предложение пришло НАМ от поставщика — нет этого кода (поставщики — блок N). Прайс-лист без индивидуального расчёта — не КП: для него нет state-кода (см. Open points). Обещание «пришлём КП завтра» — ещё не отправка. Это исключение из правила «только автор-клиент»: код описывает НАШЕ письмо.

**Признаки для промпта (≤ 8):** «направляем коммерческое предложение», «во вложении КП», «направляем предложение», «высылаем расчёт», «смета во вложении», «подготовили для вас предложение», «как договаривались, отправляю КП», «предложение действительно до»

**Синонимы и выражения (полный список):**
- Деловая переписка: «направляем в Ваш адрес коммерческое предложение», «во вложении КП на поставку», «по Вашему запросу подготовили предложение», «высылаем расчёт стоимости», «предложение действительно до 30.11», «готовы обсудить условия»
- Чаты / мессенджеры (разговорный стиль): «скинул КП на почту», «отправила подборку и цены», «вот расчёт, посмотрите», «КП в файле»
- Сокращения и термины: «КП», «ТКП», «смета», «расчёт», «оферта», «подборка» (дистрибуция: подборка вин в карту)
- Устойчивые конструкции / маркеры: «направляем / высылаем / отправляем» + «КП / предложение / расчёт»; «во вложении» + «КП»

**Похоже, но не это (анти-признаки):** «подготовим КП до пятницы» → нет сигнала (обещание); «во вложении наш прайс-лист» → нет этого кода; «направляем вам коммерческое предложение» от поставщика нам → не этот код (`SUPPLIER_PRICE_CHANGE` или нет сигнала).

**Пример (evidence):** «Добрый день! Во вложении коммерческое предложение на поставку вин для банкетного меню, предложение действительно до 30.11.»
**Контрпример:** «Коллеги, КП подготовим и направим до конца недели» → отправки ещё нет.

**Заметка для карточки:** Карточку не создавать; закрыть открытый запрос КП этого клиента и отметить дату отправки.

### `SALES_OFFER_NO_RESPONSE` — Нет ответа на отправленное КП

| Field | Value |
|---|---|
| Pack · block · family | base · A · offer |
| Weight · class · kind · score rule | 7 · risk · watchdog · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · yes |
| Emitted by | process |
| Stage (pack default) · IN4COM | onHold · review |
| Display profile | from weight (P6) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: any qualifying client reply on the topic (watchdog clears) |
| Relations | `SALES_OFFER_DECLINED` leads over this code (the explicit refusal closes the loop). |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule. Usual: none (context for the deal state; silence is never `lost`). |

**Определение:** Мы отправили КП (`SALES_OFFER_SENT`), а клиент не ответил в отведённое окно. Создаётся процессом.

**Граница (не считается):** Молчание — не отказ. Явный отказ — `SALES_OFFER_DECLINED`. Нет исходного КП (`SALES_OFFER_SENT`) — нет сигнала. Ответ клиента любого содержания («получили, посмотрим») снимает сигнал.

**Признаки для промпта:** — (not in the extraction prompt; emitted by process)

**Правило срабатывания:** RU (Q24-11): есть исходное событие `SALES_OFFER_SENT`; истёк срок ответа — согласованная дата, а если её нет, 7 календарных дней (`noResponseDefaultDays`); если известна дата действия КП (`facts.offerValidUntil`), вместо окна действует отсчёт до неё (OFFER_COUNTDOWN_STEPS); проверены все подключённые каналы (почта, мессенджеры) клиента; нет ответа клиента по этой теме. Недостаточно данных — сигнала нет. EN: an originating `SALES_OFFER_SENT` exists; the reply deadline passed (agreed date, else 7 calendar days; a known `offerValidUntil` replaces the window with the countdown); all connected channels checked; no qualifying client reply on the topic. Insufficient data → no signal.

**Пример (evidence):** КП отправлено 03.11, согласованной даты ответа нет; на 10.11 от клиента нет писем и сообщений по теме.

**Заметка для карточки:** Укажи, что и когда отправлено; шаги — коротко напомнить контакту, уточнить сроки решения, не давить скидкой первым шагом.

### `SALES_OFFER_REQUESTED` — Запрошено коммерческое предложение

| Field | Value |
|---|---|
| Pack · block · family | base · A · offer |
| Weight · class · kind · score rule | 7 · chance · event · fixed |
| Effort · asks us · inbound only · amount | complex · yes · yes · yes |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · on |
| Display profile | from weight (P6) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: `SALES_OFFER_SENT` |
| Relations | both with `SALES_NEW_DEMAND` (the opportunity and the task). Agency: a more precise `PITCH_*` code leads. |
| Date gate | — (the requested deadline goes to `facts.deadlines`, owner = us) |
| Relevance window | default |
| Deal effect | per org rule. Usual: stage move to «Запрошено предложение» (agency stage 2). IN4COM: **deal entry for new clients only** (wine card, event, chain); for an existing client — context or the matching distribution code. |

**Определение:** Клиент просит индивидуальное коммерческое предложение, смету или расчёт под конкретную задачу, проект, объём или мероприятие.

**Граница (не считается):** Просьба прислать стандартный прайс или условия без расчёта под задачу — `SALES_PRICE_REQUEST`. Каталог или портфель — `SALES_CATALOG_REQUESTED`. Тендер с процедурой и сроком подачи — `SALES_TENDER_INVITATION`. Концепция, макет, презентация — `SALES_MATERIAL_REQUESTED`. В дистрибуции: заказ с позициями и количеством — `ORDER_REQUESTED`; образцы — `SAMPLES_REQUESTED`; ввод в карту — `LISTING_OPPORTUNITY` (можно вместе с этим кодом). Наше собственное предложение без запроса — не сигнал.

**Признаки для промпта (≤ 8):** «пришлите КП», «коммерческое предложение», «просчитайте», «смета», «сколько будет стоить проект», «предложите подборку», «подготовьте предложение», «нужен расчёт»

**Синонимы и выражения (полный список):**
- Деловая переписка: «просим направить коммерческое предложение на поставку», «прошу подготовить КП с учётом объёма», «направьте, пожалуйста, ваше предложение по», «просим рассчитать стоимость», «ждём от вас предложение до», «прошу предоставить смету», «рассматриваем поставщиков, просим ваше предложение»
- Чаты / мессенджеры (разговорный стиль): «скиньте КП», «посчитайте, сколько выйдет», «можете прислать предложение на банкет на 80 человек?», «сделайте расчёт под нас», «подберите вина под меню и цены» (дистрибуция), «что предложите под новое меню?»
- Сокращения и термины: «КП», «ТКП», «смета», «расчёт», «RFP» (без процедуры отбора), «предложение под ключ»
- Устойчивые конструкции / маркеры: «просим / прошу + направить / подготовить / прислать» + «КП / предложение / расчёт»; «сколько будет стоить» + объём или проект; «предложите подборку» + повод (дистрибуция: винная карта, мероприятие, сеть)

**Похоже, но не это (анти-признаки):** «пришлите актуальный прайс» → `SALES_PRICE_REQUEST`; «какой у вас портфель по Италии?» → `SALES_CATALOG_REQUESTED`; «отгрузите 6 кор. Риохи» → `ORDER_REQUESTED`; «объявлен запрос котировок, срок подачи 20.11» → `SALES_TENDER_INVITATION`.

**Пример (evidence):** «Открываем второй ресторан в декабре, просим направить коммерческое предложение на винную карту — около 40 позиций, бюджет на бутылку до 3 500 руб.»
**Контрпример:** «Пришлите, пожалуйста, актуальный прайс-лист» → это `SALES_PRICE_REQUEST`: стандартный ответ, без расчёта под задачу.

**Заметка для карточки:** Укажи задачу, объём, бюджет и срок клиента; шаги — уточнить недостающее, подготовить КП к сроку, отправить ответственному контакту.

### `SALES_BOOKING_CANCELLED` — Клиент отменил размещённый заказ

| Field | Value |
|---|---|
| Pack · block · family | base · A · order |
| Weight · class · kind · score rule | 7 · risk · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · yes · yes |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · off (replaced by `ORDER_CANCELLED`) |
| Display profile | from weight (P6) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: — |
| Relations | leads over `SALES_BUDGET_CUT` (the concrete loss counts); leads over `ACCOUNT_REVENUE_DECLINE_YOY` (block K — the decline is context in the cancellation card). |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule. Usual: outcome `cancelled` for the linked deal only when the whole deal is cancelled; otherwise context. IN4COM: off. |

**Определение:** Клиент отзывает уже размещённый (подтверждённый) заказ полностью или существенную его часть.

**Граница (не считается):** Перенос сроков — не отмена (в дистрибуции `ORDER_CHANGE_REQUESTED`). Отказ от КП до заказа — `SALES_OFFER_DECLINED`. Расторжение договора целиком — `CONTRACT_TERMINATED`. В дистрибуции отмена товарного заказа — `ORDER_CANCELLED`.

**Признаки для промпта (≤ 8):** «отменяем заказ», «просим аннулировать заявку», «заказ больше не актуален», «отзываем заявку», «не запускайте», «снимаем заказ», «отказываемся от заказа», «заказ отменён»

**Синонимы и выражения (полный список):**
- Деловая переписка: «просим аннулировать заказ № от», «в связи с изменением планов заказ отменяем», «отзываем ранее направленную заявку», «прошу считать заказ недействительным», «мероприятие отменено, заказ просим снять»
- Чаты / мессенджеры (разговорный стиль): «отбой по заказу», «заказ отменяем, сорри», «не надо, мы передумали», «стопните заказ»
- Сокращения и термины: «аннулирование», «отзыв заявки», «отмена PO»
- Устойчивые конструкции / маркеры: «отменяем / аннулируем / отзываем» + «заказ / заявку»

**Похоже, но не это (анти-признаки):** «перенесите поставку на следующую неделю» → нет этого кода (`ORDER_CHANGE_REQUESTED` в дистрибуции); «ваше предложение нам не подходит» → `SALES_OFFER_DECLINED`; «расторгаем договор» → `CONTRACT_TERMINATED`.

**Пример (evidence):** «Корпоратив перенесли на неопределённый срок, поэтому заказ № 318 от 05.11 просим аннулировать.»
**Контрпример:** «Поставку по заказу 318 сдвиньте, пожалуйста, на 20-е» → это перенос, не отмена.

**Заметка для карточки:** Укажи заказ, сумму и названную причину; шаги — выяснить причину, предложить перенос или замену, проверить расходы, уже понесённые по заказу.

### `SALES_RENEGOTIATION` — Клиент хочет пересмотреть согласованные условия

| Field | Value |
|---|---|
| Pack · block · family | base · A · contract |
| Weight · class · kind · score rule | 7 · risk · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · yes · yes |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · on |
| Display profile | from weight (P6) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: — |
| Relations | — in v204. Often together with `COMPLAINT_PRICE` (complaint + request). |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule. IN4COM: risk trigger «Конкурент предлагает дешевле» (not at the first-contact stage) and a postponement event for «Решение откладывается» (2nd distinct postponement, Q24-3). |

**Определение:** Клиент хочет заново открыть уже согласованные условия: цену, скидку, бонус, срок оплаты, объём обязательств, условия поставки.

**Граница (не считается):** Только недовольство ценой без просьбы изменить условия — `COMPLAINT_PRICE` (бывают вместе). Первый запрос цены — `SALES_PRICE_REQUEST`. В дистрибуции просьба об отсрочке, лимите или работе без предоплаты — `PAYMENT_TERMS_REQUEST`, не этот код. Торг по ещё не согласованному КП — `SALES_OFFER_REQUESTED` / агентский `PITCH_FINAL_TERMS_DISCUSSION`.

**Признаки для промпта (≤ 8):** «пересмотреть условия», «пересмотреть скидку», «поднять скидку», «изменить условия», «снизить цену», «новые условия с 1 января», «перезаключить на других условиях», «изменить срок оплаты»

**Синонимы и выражения (полный список):**
- Деловая переписка: «просим пересмотреть условия договора», «предлагаем обсудить изменение коммерческих условий», «рассчитываем на увеличение скидки при сохранении объёмов», «просим зафиксировать цены на 2027 год», «готовы продлить при условии снижения цены», «просим изменить порядок оплаты»
- Чаты / мессенджеры (разговорный стиль): «давайте пересоберём условия», «можно скидку побольше?», «нам надо дешевле, иначе не потянем», «давайте пересмотрим бонус», «поднимите скидку до 15»
- Сокращения и термины: «скидка», «ретро-бонус», «бонус за объём», «отсрочка платежа» (без пакета дистрибуции), «фиксация цен», «ДС об изменении условий»
- Устойчивые конструкции / маркеры: «пересмотреть / изменить / обсудить» + «условия / скидку / цены»; «при условии» + «снижения / увеличения»

**Похоже, но не это (анти-признаки):** «у вас дорого» без просьбы → `COMPLAINT_PRICE`; «дайте отсрочку 60 дней» → `PAYMENT_TERMS_REQUEST` (дистрибуция); «пришлите прайс» → `SALES_PRICE_REQUEST`.

**Пример (evidence):** «С января просим пересмотреть скидку: при текущих объёмах рассчитываем на 12% вместо 8%, иначе будем смотреть альтернативы.»
**Контрпример:** «Цены у вас выросли, неприятно» → недовольство без просьбы изменить условия (`COMPLAINT_PRICE`).

**Заметка для карточки:** Укажи, какие условия клиент хочет изменить и на что; шаги — оценить маржу, подготовить позицию для переговоров, согласовать встречу.

### `SALES_NEW_DEMAND` — Дополнительная потребность действующего клиента

| Field | Value |
|---|---|
| Pack · block · family | base · A · offer |
| Weight · class · kind · score rule | 7 · chance · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · yes · yes |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · review |
| Display profile | from weight (P6) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: — |
| Relations | both with `SALES_OFFER_REQUESTED` (the opportunity and the task). |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule. Usual: deal entry (incremental opportunity, agency stage 1). IN4COM: under review — listings and new venues have own codes (`LISTING_OPPORTUNITY`, `NEW_VENUE_OPENING`). |

**Определение:** Действующий клиент просит то, чего раньше у нас не покупал: другую услугу, другую категорию товара или существенно больший объём того же. Нужна история заказов клиента.

**Граница (не считается):** Обычный повторный заказ — не этот код (в дистрибуции `ORDER_REQUESTED`). Изменение задач внутри уже оплаченного объёма — агентский `DELIVERY_CHANGE_REQUESTED`. Новый клиент без истории — не этот код (`SALES_OFFER_REQUESTED`, `PROSPECT_NEED_EXPRESSED`). Общие слова о планах без запроса — агентский `ACCOUNT_PRIORITIES_CHANGED` или нет сигнала. В дистрибуции ввод в карту — `LISTING_OPPORTUNITY`, новая точка — `NEW_VENUE_OPENING`.

**Признаки для промпта (≤ 8):** «хотим добавить», «а вы можете ещё и», «нам также нужно», «расширить сотрудничество», «рассматриваем у вас ещё», «новое направление», «увеличить объём в два раза», «интересует также»

**Синонимы и выражения (полный список):**
- Деловая переписка: «помимо текущих поставок нас интересует», «рассматриваем возможность расширить сотрудничество», «просим рассмотреть дополнительно поставку», «планируем увеличить объём закупок по», «хотели бы подключить ещё одну категорию», «есть потребность в»
- Чаты / мессенджеры (разговорный стиль): «а крепкое вы тоже возите?» (дистрибуция), «можете ещё и игристое закрыть?» (дистрибуция), «хотим у вас брать ещё и», «нам бы ещё», «расширяемся, давайте больше»
- Сокращения и термины: «допродажа», «кросс-продажа», «новая категория», «доп. объём»
- Устойчивые конструкции / маркеры: «помимо / кроме» + текущего; «также / ещё и» + новая категория или услуга; «увеличить объём» + цифра

**Похоже, но не это (анти-признаки):** «повторите прошлый заказ» → `ORDER_REQUESTED` / нет этого кода; «добавьте в заказ 2 кор.» → `ORDER_CHANGE_REQUESTED` (дистрибуция); «рассматриваем ваши вина в новую карту» → `LISTING_OPPORTUNITY` (дистрибуция).

**Пример (evidence):** «Сейчас берём у вас только вино, но с весны хотим закрыть у вас и крепкий алкоголь для бара — подготовьте, пожалуйста, предложение.»
**Контрпример:** «Пришлите, как обычно, 10 коробок Пино Гриджо» → обычный повторный заказ.

**Заметка для карточки:** Укажи, что нового хочет клиент и в каком объёме; шаги — уточнить потребность и сроки, подготовить предложение.

### `SALES_BUDGET_INCREASE` — Клиент увеличивает бюджет на работу с нами

| Field | Value |
|---|---|
| Pack · block · family | base · A · account |
| Weight · class · kind · score rule | 7 · chance · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · yes · yes |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · off |
| Display profile | from weight (P6) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule. Usual: in-stage context (budget), no stage move; the amount never enters the forecast automatically. IN4COM: off. |

**Определение:** Клиент сообщает, что увеличивает бюджет или плановый объём закупок у нас на период или направление.

**Граница (не считается):** Один крупный заказ — не этот код. Запрос новой категории — `SALES_NEW_DEMAND`. Сумма конкретной задачи — `SALES_BUDGET_MENTIONED`. Рост бюджета клиента вообще (новость) — блок H.

**Признаки для промпта (≤ 8):** «увеличиваем бюджет», «бюджет на следующий год больше», «планируем увеличить закупки», «добавили денег», «расширили лимит», «объём вырастет», «план закупок увеличен», «выделили дополнительный бюджет»

**Синонимы и выражения (полный список):**
- Деловая переписка: «бюджет на 2027 год утверждён с ростом на 20%», «планируем увеличить объём закупок у вас», «выделен дополнительный бюджет на направление», «лимит по договору увеличен»
- Чаты / мессенджеры (разговорный стиль): «бюджет дали больше», «в следующем году будем брать больше», «денег добавили, можем развернуться»
- Сокращения и термины: «лимит», «план закупок», «бюджет на год»
- Устойчивые конструкции / маркеры: «увеличиваем / расширяем» + «бюджет / лимит / объём»; «больше на» + %

**Похоже, но не это (анти-признаки):** «в этот раз нужно в два раза больше» → нет сигнала (один заказ) или `ORDER_REQUESTED`; «нужен бюджет 500 тыс. на мероприятие» → `SALES_BUDGET_MENTIONED`.

**Пример (evidence):** «Хорошие новости: бюджет на закупку на следующий год согласовали на 30% больше, хотим основную часть разместить у вас.»
**Контрпример:** «На корпоратив в этот раз возьмём побольше, человек будет 120» → один заказ, не бюджет.

**Заметка для карточки:** Укажи период и размер увеличения; шаги — обсудить, на что клиент хочет направить рост, подготовить предложение.

### `CONTRACT_RENEWAL_INTENT` — Клиент сам поднял вопрос продления договора

| Field | Value |
|---|---|
| Pack · block · family | base · A · contract |
| Weight · class · kind · score rule | 7 · chance · event · fixed |
| Effort · asks us · inbound only · amount | medium · yes · yes · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · on |
| Display profile | from weight (P6) |
| Recipient role | account |
| Closes / closed by | closes: — (clears the IN4COM risk «Договор заканчивается без продления») · closed by: — |
| Relations | leads over `CONTRACT_FRAME_EXPIRY` (the opportunity beats the warning). |
| Date gate | — |
| Relevance window | until the current contract end date, if known; else default |
| Deal effect | per org rule. IN4COM: **deal entry (renewal)**. Agency (Q24-10): stage 4 only when the contract / service is identifiable, the next period or scope is defined and the client explicitly confirms the choice; otherwise context. |

**Определение:** Клиент по своей инициативе поднимает продление действующего договора на следующий период: предлагает продлить, просит ДС о пролонгации, спрашивает об условиях на следующий год.

**Граница (не считается):** Наше напоминание о продлении — не сигнал клиента. Просто дата окончания без инициативы клиента — `CONTRACT_FRAME_EXPIRY`. Общее «надеемся на продолжение сотрудничества» — не этот код (Q24-10). Продление при условии новых цен — этот код вместе с `SALES_RENEGOTIATION`. Явное решение продолжить работу до оформления — в агентском пакете `CONTRACT_CONTINUATION_CONFIRMED`. Отказ от продления — не этот код.

**Признаки для промпта (≤ 8):** «продлим договор на следующий год», «пришлите ДС о пролонгации», «хотим продлить договор», «давайте продлим», «условия на следующий год», «готовы пролонгировать», «переподпишем договор на 2027», «продление на тех же условиях»

**Синонимы и выражения (полный список):**
- Деловая переписка: «предлагаем продлить действие договора на 2027 год», «просим направить дополнительное соглашение о пролонгации», «планируем продолжить сотрудничество на следующий период, просим условия», «готовы пролонгировать договор на прежних условиях», «рассматриваем продление договора поставки»
- Чаты / мессенджеры (разговорный стиль): «давайте продлеваться», «договор на следующий год делаем?», «пришлите допник на продление», «продлеваем, кидайте документы»
- Сокращения и термины: «ДС», «допник», «доп. соглашение», «пролонгация», «перезаключение»
- Устойчивые конструкции / маркеры: «продлить / пролонгировать» + «договор / сотрудничество» + период; «условия на следующий год»

**Похоже, но не это (анти-признаки):** «надеемся на дальнейшее сотрудничество» → нет сигнала; «договор действует до 31.12» → `CONTRACT_FRAME_EXPIRY`; «продлевать не будем» → не этот код (`CONTRACT_RENEWAL_DECLINED` в агентском пакете; в базе — нет сигнала или `CONTRACT_TERMINATED`, если отношения прекращаются).

**Пример (evidence):** «Договор у нас до конца года, мы планируем продлить его на 2027 год — пришлите, пожалуйста, дополнительное соглашение и актуальные условия.»
**Контрпример:** «Спасибо за год работы, надеемся и дальше сотрудничать» → вежливость, нет конкретного продления.

**Заметка для карточки:** Укажи договор, период и условия, о которых говорит клиент; шаги — подготовить ДС, проверить условия и цены, согласовать подписание.

### `SALES_PRICE_REQUEST` — Запрошены цены, прайс-лист или стандартные условия

| Field | Value |
|---|---|
| Pack · block · family | base · A · offer |
| Weight · class · kind · score rule | 6 · chance · event · fixed |
| Effort · asks us · inbound only · amount | quick · yes · yes · yes |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · on |
| Display profile | from weight (P6) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: — (no "price list sent" state code; see Open points) |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule. Usual: none (a standard reply, not an individual offer). IN4COM: none. |

**Определение:** Клиент просит цены, прайс-лист, стандартные условия поставки или скидки. Это стандартный ответ, а не индивидуальное предложение.

**Граница (не считается):** Расчёт под конкретную задачу — `SALES_OFFER_REQUESTED`. Поставщик или производитель присылает НАМ свой прайс или дилерские цены — `SUPPLIER_PRICE_CHANGE`. Жалоба «дорого» — `COMPLAINT_PRICE`. В дистрибуции вопрос о наличии или остатках без цены — `STOCK_AVAILABILITY_REQUEST`; позиции с количеством — `ORDER_REQUESTED`.

**Признаки для промпта (≤ 8):** «прайс», «прайс-лист», «цены», «условия», «скидка от объёма», «какая цена», «актуальные цены», «спеццена»

**Синонимы и выражения (полный список):**
- Деловая переписка: «просим направить актуальный прайс-лист», «прошу сообщить стоимость и условия поставки», «укажите, пожалуйста, цену за единицу с НДС», «какие у вас условия по скидкам от объёма», «просим предоставить условия для HoReCa» (дистрибуция), «интересуют оптовые цены»
- Чаты / мессенджеры (разговорный стиль): «скиньте прайс плиз», «почём Шабли?» (дистрибуция), «сколько стоит?», «какая цена за коробку?», «есть спеццена на объём?», «киньте цены на игристое» (дистрибуция)
- Сокращения и термины: «прайс», «ПЛ», «опт», «РРЦ», «с НДС / без НДС», «спеццена», «скидка от объёма», «бонус за объём», «ДДП», «EXW»
- Устойчивые конструкции / маркеры: «пришлите / направьте» + «прайс / цены»; «сколько стоит / почём / какая цена» + товар; «какие условия по» + «скидкам / оплате / доставке»

**Похоже, но не это (анти-признаки):** «посчитайте нам банкет на 80 человек» → `SALES_OFFER_REQUESTED`; «во вложении наш новый прайс с 01.12» от производителя → `SUPPLIER_PRICE_CHANGE`; «у вас дорого» → `COMPLAINT_PRICE`; «есть ли в наличии Бароло?» → `STOCK_AVAILABILITY_REQUEST` (дистрибуция).

**Пример (evidence):** «Добрый день! Пришлите, пожалуйста, актуальный прайс-лист для HoReCa и условия по скидкам от объёма.»
**Контрпример:** «Направляем вам наш обновлённый прайс-лист, действует с 1 декабря» (письмо поставщика нам) → это `SUPPLIER_PRICE_CHANGE`.

**Заметка для карточки:** Укажи, какие цены и условия запрошены; шаги — отправить актуальный прайс или условия, уточнить объём и задачу клиента.

### `SALES_MATERIAL_REQUESTED` — Запрошены индивидуальные материалы (концепция, макет, презентация)

| Field | Value |
|---|---|
| Pack · block · family | base · A · offer |
| Weight · class · kind · score rule | 6 · chance · event · fixed |
| Effort · asks us · inbound only · amount | complex · yes · yes · yes |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · off |
| Display profile | from weight (P6) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: — |
| Relations | — in v204. Agency: `PITCH_SOLUTION_REQUESTED` leads; one card (Maslov §5.5). Successor area of retired `SALES_CONCEPT`, `SALES_MOCKUP`, `SALES_PRESENTATION`. |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule. Agency: stage move to stage 2 only when no more precise `PITCH_*` code applies. IN4COM: off. |

**Определение:** Клиент просит материалы, которые мы делаем индивидуально: концепцию, макет, презентацию под задачу клиента, план, дизайн, проект.

**Граница (не считается):** Готовый каталог или общая презентация компании — `SALES_CATALOG_REQUESTED`. Цена или расчёт — `SALES_PRICE_REQUEST` / `SALES_OFFER_REQUESTED`. В дистрибуции образцы товара — `SAMPLES_REQUESTED`; дегустация — `TASTING_REQUESTED`; POS-материалы и промо — `PROMO_SUPPORT_REQUESTED`. Кейсы и анкеты для отбора — агентский `PITCH_CREDENTIALS_REQUESTED`.

**Признаки для промпта (≤ 8):** «подготовьте концепцию», «нужен макет», «сделайте презентацию под нас», «пришлите визуализацию», «нужен проект», «разработайте предложение по оформлению», «покажите, как это будет выглядеть», «нужна концепция мероприятия»

**Синонимы и выражения (полный список):**
- Деловая переписка: «просим подготовить концепцию проекта», «направьте, пожалуйста, макет для согласования», «прошу подготовить презентацию решения для руководства», «просим разработать дизайн-проект», «нужна визуализация к совещанию»
- Чаты / мессенджеры (разговорный стиль): «накидайте концепт», «сделайте макетик», «покажите пару вариантов», «нужна презуха под нас»
- Сокращения и термины: «концепция», «концепт», «макет», «визуал», «мудборд», «презентация», «ТЗ», «бриф»
- Устойчивые конструкции / маркеры: «подготовьте / разработайте / сделайте» + «концепцию / макет / презентацию» + «под нас / под задачу»

**Похоже, но не это (анти-признаки):** «пришлите презентацию компании» → `SALES_CATALOG_REQUESTED`; «пришлите образцы» → `SAMPLES_REQUESTED` (дистрибуция); «нужны воблеры и POS» → `PROMO_SUPPORT_REQUESTED` (дистрибуция).

**Пример (evidence):** «Подготовьте, пожалуйста, концепцию оформления стенда под нашу выставку и пару вариантов макета к среде.»
**Контрпример:** «Пришлите, пожалуйста, общую презентацию вашей компании» → готовый материал, `SALES_CATALOG_REQUESTED`.

**Заметка для карточки:** Укажи, какой материал и к какому сроку нужен; шаги — уточнить бриф, согласовать объём работы и срок, назначить исполнителя.

### `SALES_ORDER_CONFIRMATION_REQUESTED` — Клиент просит подтвердить заказ

| Field | Value |
|---|---|
| Pack · block · family | base · A · order |
| Weight · class · kind · score rule | 6 · chance · event · fixed |
| Effort · asks us · inbound only · amount | quick · yes · yes · yes |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · review |
| Display profile | from weight (P6) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: `SALES_ORDER_CONFIRMATION_SENT` |
| Relations | the `SALES_ORDER_CONFIRMATION_OPEN` watchdog starts when we promise the confirmation. |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule. Usual: none. IN4COM: none (orders are outside deals in step one, Q26). |

**Определение:** Клиент просит нас письменно подтвердить его заказ: подтверждение приёма заказа, сроков, цены или наличия, подписанную нами заявку, счёт как подтверждение.

**Граница (не считается):** Клиент сам подтверждает заказ — `SALES_BOOKING_RECEIVED` (или `ORDER_REQUESTED` в дистрибуции). Вопрос о статусе доставки — не этот код (в дистрибуции `DELIVERY_SCHEDULE_REQUEST`). Запрос документов по отгрузке (УПД, ТТН) — `DOCUMENTS_REQUESTED` (дистрибуция). В дистрибуции этот код пересекается с `ORDER_REQUESTED` → `ORDER_CONFIRMED`; см. Open points.

**Признаки для промпта (≤ 8):** «подтвердите заказ», «подтвердите получение заявки», «пришлите подтверждение», «подтвердите сроки и цену», «заказ принят?», «выставите счёт на заказ», «подтвердите наличие по заказу», «ждём подтверждения»

**Синонимы и выражения (полный список):**
- Деловая переписка: «просим подтвердить принятие заказа в работу», «прошу подтвердить сроки поставки по заявке», «направьте, пожалуйста, подтверждение заказа», «подтвердите, пожалуйста, цену и количество», «ждём счёт для подтверждения заказа»
- Чаты / мессенджеры (разговорный стиль): «заявку получили?», «подтвердите, что всё ок по заказу», «скиньте счёт, чтобы мы понимали, что заказ принят», «маякните, что взяли в работу»
- Сокращения и термины: «подтверждение заказа», «order confirmation», «счёт на предоплату», «акцепт заявки»
- Устойчивые конструкции / маркеры: «подтвердите / прошу подтвердить» + «заказ / заявку / сроки / цену»

**Похоже, но не это (анти-признаки):** «подтверждаем заказ» (клиент) → `SALES_BOOKING_RECEIVED`; «когда привезёте?» → `DELIVERY_SCHEDULE_REQUEST` (дистрибуция); «пришлите УПД» → `DOCUMENTS_REQUESTED` (дистрибуция).

**Пример (evidence):** «Направили вчера заявку на 18 позиций, подтвердите, пожалуйста, что всё есть в наличии и срок поставки до 28.11.»
**Контрпример:** «Заказ подтверждаем, запускайте» → это подтверждение клиента, `SALES_BOOKING_RECEIVED`.

**Заметка для карточки:** Укажи заказ и что именно нужно подтвердить; шаги — проверить наличие, сроки и цену, отправить подтверждение.

### `SALES_OFFER_DECLINED` — Клиент отклонил предложение

| Field | Value |
|---|---|
| Pack · block · family | base · A · offer |
| Weight · class · kind · score rule | 6 · risk · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · yes · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · on |
| Display profile | from weight (P6) |
| Recipient role | opportunity |
| Closes / closed by | closes: — (ends the `SALES_OFFER_NO_RESPONSE` wait) · closed by: — |
| Relations | leads over `SALES_OFFER_NO_RESPONSE` (the explicit refusal closes the loop). Agency: one outcome card with `PITCH_EXCLUDED` (Maslov §5.5). |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule. Usual: outcome `lost` only when the refusal covers the whole deal; a refusal of one offer version may keep the deal open (Maslov §3.2). |

**Определение:** Клиент прямо отказывается от нашего предложения: выбрал другого поставщика, решил не покупать или говорит, что предложение не подходит.

**Граница (не считается):** Молчание — не отказ (`SALES_OFFER_NO_RESPONSE`). Просьба изменить предложение («дороговато, пересчитайте») — не отказ (`COMPLAINT_PRICE` / `SALES_RENEGOTIATION`). Перенос решения — не отказ. Отмена уже размещённого заказа — `SALES_BOOKING_CANCELLED`.

**Признаки для промпта (≤ 8):** «не подходит», «выбрали другого поставщика», «вынуждены отказаться», «решили не продолжать», «приняли решение в пользу другой компании», «ваше предложение не прошло», «не будем заказывать», «отказываемся от предложения»

**Синонимы и выражения (полный список):**
- Деловая переписка: «благодарим за предложение, однако приняли решение в пользу другого поставщика», «к сожалению, ваше предложение нам не подходит», «по итогам рассмотрения вынуждены отказаться», «в текущем году закупку проводить не будем», «ваше предложение не прошло согласование»
- Чаты / мессенджеры (разговорный стиль): «не, не берём», «спасибо, но мы пас», «взяли у других», «руководство не одобрило, увы», «не зашло»
- Сокращения и термины: «отказ», «не прошли по цене», «не согласовано»
- Устойчивые конструкции / маркеры: «вынуждены отказаться от»; «выбрали / остановились на» + другой поставщик; «не подходит» + по цене / по срокам / по ассортименту

**Похоже, но не это (анти-признаки):** «дорого, можете пересчитать?» → `COMPLAINT_PRICE` / `SALES_RENEGOTIATION`; «вернёмся к вопросу после нового года» → нет этого кода (перенос); тишина после КП → `SALES_OFFER_NO_RESPONSE`.

**Пример (evidence):** «Спасибо за предложение, но по итогам сравнения мы выбрали другого поставщика — у них условия по отсрочке лучше.»
**Контрпример:** «Пока не готовы принять решение, вернёмся в январе» → это перенос, не отказ.

**Заметка для карточки:** Укажи, от чего отказался клиент и названную причину; шаги — поблагодарить, уточнить причину и условия победителя, договориться о следующем контакте.

### `SALES_ORDER_CONFIRMATION_OPEN` — Обещанное подтверждение заказа не отправлено

| Field | Value |
|---|---|
| Pack · block · family | base · A · order |
| Weight · class · kind · score rule | 5 · risk · watchdog · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · yes |
| Emitted by | process |
| Stage (pack default) · IN4COM | onHold · review |
| Display profile | from weight (D4) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: `SALES_ORDER_CONFIRMATION_SENT` |
| Relations | follows `SALES_ORDER_CONFIRMATION_REQUESTED`. |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule. Usual: none. |

**Определение:** Клиент запросил подтверждение заказа, мы его обещали, но оно не ушло в срок. Создаётся процессом.

**Граница (не считается):** Это наша задержка, а не жалоба клиента: если клиент пишет «сколько ждать подтверждения?», это `COMPLAINT_TIMING`. Без исходного запроса или обещания — нет сигнала.

**Признаки для промпта:** — (not in the extraction prompt; emitted by process)

**Правило срабатывания:** RU: есть открытый `SALES_ORDER_CONFIRMATION_REQUESTED` (или наше обещание с датой в `facts.deadlines`, owner = us); срок прошёл (согласованная дата, иначе окно ответа организации); нет `SALES_ORDER_CONFIRMATION_SENT` по этой теме. EN: an open `SALES_ORDER_CONFIRMATION_REQUESTED` (or our dated promise, owner = us); the deadline passed (agreed date, else the org reply window); no `SALES_ORDER_CONFIRMATION_SENT` on the topic.

**Пример (evidence):** Клиент 10.11 просил подтвердить заказ, менеджер ответил «подтвердим завтра»; 12.11 подтверждения в переписке нет.

**Заметка для карточки:** Укажи заказ и дату обещания; шаги — отправить подтверждение сегодня или сообщить клиенту новый срок.

### `SALES_ORDER_CONFIRMATION_SENT` — Мы отправили подтверждение заказа

| Field | Value |
|---|---|
| Pack · block · family | base · A · order |
| Weight · class · kind · score rule | 0 · — · state · state |
| Effort · asks us · inbound only · amount | — · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · review |
| Display profile | S0 (state code, closes and makes no card) |
| Recipient role | opportunity |
| Closes / closed by | closes: `SALES_ORDER_CONFIRMATION_REQUESTED`, `SALES_ORDER_CONFIRMATION_OPEN` (same client / topic) · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | none — our own action. |

**Определение:** Служебное событие: мы отправили клиенту подтверждение заказа (письмо, подписанную заявку, счёт как подтверждение). Закрывает запрос подтверждения и ожидание.

**Граница (не считается):** Подтверждение заказа от поставщика НАМ — не этот код. Клиент подтверждает свой заказ — `SALES_BOOKING_RECEIVED`. В дистрибуции подтверждение товарного заказа — `ORDER_CONFIRMED` (см. Open points).

**Признаки для промпта (≤ 8):** «подтверждаем принятие заказа», «заказ принят в работу», «подтверждаем сроки поставки», «во вложении подтверждение заказа», «счёт на оплату по заказу во вложении», «заявка принята», «отгрузка запланирована на»

**Синонимы и выражения (полный список):**
- Деловая переписка: «подтверждаем получение и принятие заказа № в работу», «подтверждаем наличие и срок поставки», «направляем подтверждение заказа и счёт», «заявка принята, отгрузка запланирована на 25.11»
- Чаты / мессенджеры (разговорный стиль): «заказ взяли, всё ок», «подтверждаю, отгрузим в четверг», «приняли, счёт скинул»
- Сокращения и термины: «подтверждение заказа», «order confirmation», «счёт», «акцепт»
- Устойчивые конструкции / маркеры: «подтверждаем» + «заказ / сроки / наличие» (в НАШЕМ письме)

**Похоже, но не это (анти-признаки):** «подтверждаем заказ, запускайте» (клиент) → `SALES_BOOKING_RECEIVED`; «ваш заказ у производителя подтверждён» (поставщик нам) → нет этого кода.

**Пример (evidence):** «Подтверждаем принятие заказа № 412 в работу, все позиции в наличии, отгрузка запланирована на 26.11, счёт во вложении.»
**Контрпример:** «Подтвердим заказ после проверки склада» → обещание, подтверждения ещё нет.

**Заметка для карточки:** Карточку не создавать; закрыть открытый запрос подтверждения по этому заказу.

### `SALES_MATERIAL_NO_RESPONSE` — Нет реакции на индивидуальные материалы

| Field | Value |
|---|---|
| Pack · block · family | base · A · offer |
| Weight · class · kind · score rule | 5 · risk · watchdog · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · yes |
| Emitted by | process |
| Stage (pack default) · IN4COM | onHold · off |
| Display profile | from weight (D4) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: any qualifying client reply on the topic (watchdog clears) |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule. Usual: none (silence is never `lost`). |

**Определение:** Мы отправили клиенту запрошенные индивидуальные материалы (концепцию, макет, презентацию), а реакции нет в отведённое окно. Создаётся процессом.

**Граница (не считается):** Молчание — не отказ. Без исходного запроса (`SALES_MATERIAL_REQUESTED`) и нашей отправки — нет сигнала. Любой ответ клиента по теме снимает сигнал.

**Признаки для промпта:** — (not in the extraction prompt; emitted by process)

**Правило срабатывания:** RU (Q24-11): есть исходный запрос `SALES_MATERIAL_REQUESTED` и наша отправка материала по этой теме; истёк срок ответа (согласованная дата, иначе 7 календарных дней, `noResponseDefaultDays`); проверены подключённые каналы; нет ответа клиента. EN: an originating `SALES_MATERIAL_REQUESTED` and our sending exist; the reply deadline passed (agreed date, else 7 calendar days); channels checked; no client reply.

**Пример (evidence):** Макеты отправлены 02.11 по запросу клиента; до 09.11 ответа ни в почте, ни в мессенджере нет.

**Заметка для карточки:** Укажи, какой материал и когда отправлен; шаги — уточнить, посмотрел ли клиент, предложить короткий созвон для обсуждения.

### `SALES_PRICE_NO_RESPONSE` — Нет реакции на отправленные цены

| Field | Value |
|---|---|
| Pack · block · family | base · A · offer |
| Weight · class · kind · score rule | 5 · risk · watchdog · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · yes |
| Emitted by | process |
| Stage (pack default) · IN4COM | onHold · review |
| Display profile | from weight (D4) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: any qualifying client reply on the topic (watchdog clears) |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule. Usual: none. |

**Определение:** Мы отправили клиенту запрошенный прайс-лист или условия, а реакции нет в отведённое окно. Создаётся процессом.

**Граница (не считается):** Молчание — не отказ. Без исходного `SALES_PRICE_REQUEST` и нашей отправки прайса — нет сигнала. Рассылка прайса всем клиентам по нашей инициативе — не основание.

**Признаки для промпта:** — (not in the extraction prompt; emitted by process)

**Правило срабатывания:** RU (Q24-11): есть исходный `SALES_PRICE_REQUEST` и наша отправка прайса или условий по этой теме; истёк срок ответа (согласованная дата, иначе 7 календарных дней); проверены подключённые каналы; нет ответа клиента. Для фиксации отправки прайса сейчас нет state-кода — процессу нужен факт отправки (см. Open points). EN: an originating `SALES_PRICE_REQUEST` and our price-list sending exist; reply deadline passed (agreed date, else 7 days); channels checked; no client reply. A "price list sent" fact is needed (see Open points).

**Пример (evidence):** Прайс для HoReCa отправлен 05.11 по запросу ресторана; к 12.11 клиент не ответил и не сделал заказ.

**Заметка для карточки:** Укажи, что и когда отправлено; шаги — уточнить, какие позиции интересны, предложить подборку или образцы.

### `SALES_CATALOG_REQUESTED` — Запрошен каталог или обзор ассортимента / услуг

| Field | Value |
|---|---|
| Pack · block · family | base · A · offer |
| Weight · class · kind · score rule | 5 · chance · event · fixed |
| Effort · asks us · inbound only · amount | quick · yes · yes · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · on |
| Display profile | from weight (D4) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule. Usual: none. IN4COM: none. |

**Определение:** Клиент просит готовый каталог, портфель, обзор ассортимента или услуг, общую презентацию компании. Материал отправляется готовым, не создаётся под клиента.

**Граница (не считается):** Цены — `SALES_PRICE_REQUEST` (часто вместе: «каталог с ценами» → оба кода допустимы, ведёт цена по весу). Материал под задачу клиента — `SALES_MATERIAL_REQUESTED`. Подборка под конкретный повод с расчётом — `SALES_OFFER_REQUESTED`. Кейсы для отбора — агентский `PITCH_CREDENTIALS_REQUESTED`.

**Признаки для промпта (≤ 8):** «каталог», «портфель», «что есть из Бургундии», «пришлите ассортимент», «презентация компании», «обзор услуг», «какие бренды у вас есть», «полный список позиций»

**Синонимы и выражения (полный список):**
- Деловая переписка: «просим направить каталог продукции», «прошу прислать презентацию компании и перечень услуг», «направьте, пожалуйста, ваш портфель», «интересует полный ассортимент по категории», «просим ознакомить с линейкой»
- Чаты / мессенджеры (разговорный стиль): «скиньте каталог», «что у вас есть по Италии?» (дистрибуция), «есть что-нибудь из Бургундии?» (дистрибуция), «какие хозяйства возите?» (дистрибуция), «покажите, что вообще делаете»
- Сокращения и термины: «каталог», «портфель», «портфолио», «ассортиментная матрица», «линейка», «SKU-лист»
- Устойчивые конструкции / маркеры: «пришлите / направьте» + «каталог / портфель / ассортимент / презентацию компании»; «что есть из / по» + регион или категория (дистрибуция)

**Похоже, но не это (анти-признаки):** «прайс с ценами для HoReCa» → `SALES_PRICE_REQUEST`; «подберите 10 вин под новое меню» → `SALES_OFFER_REQUESTED`; «есть ли в наличии 12 бут. Шабли Премьер Крю?» → `STOCK_AVAILABILITY_REQUEST` (дистрибуция).

**Пример (evidence):** «Пришлите, пожалуйста, ваш актуальный портфель — что есть из Бургундии и Пьемонта, хотим обновить винную карту.»
**Контрпример:** «Пришлите прайс на игристое» → это `SALES_PRICE_REQUEST`.

**Заметка для карточки:** Укажи, какой каталог или раздел запрошен; шаги — отправить актуальный каталог, уточнить интерес и предложить следующий шаг.

### `SALES_BUDGET_MENTIONED` — Клиент назвал бюджет конкретной задачи

| Field | Value |
|---|---|
| Pack · block · family | base · A · offer |
| Weight · class · kind · score rule | 4 · chance · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · yes · yes |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · off |
| Display profile | from weight (D4) |
| Recipient role | opportunity |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule. Usual: in-stage context (budget); never a stage move by the amount, never in the forecast automatically. IN4COM: off. |

**Определение:** Клиент называет сумму или бюджет конкретной задачи или проекта, на которую готов ориентироваться.

**Граница (не считается):** Сумма счёта, оплаты или долга — не этот код (`INVOICE_*`). Цифра без намерения (оборот компании, цена из новостей) — нет сигнала. Изменение бюджета на работу с нами в целом — `SALES_BUDGET_CUT` / `SALES_BUDGET_INCREASE`. Сумма в нашем КП — `SALES_OFFER_SENT`.

**Признаки для промпта (≤ 8):** «бюджет на проект», «рассчитываем уложиться в», «готовы потратить до», «бюджет до», «в пределах суммы», «бюджет на мероприятие», «лимит на закупку», «ориентируемся на сумму»

**Синонимы и выражения (полный список):**
- Деловая переписка: «бюджет проекта составляет около 2 млн руб.», «рассчитываем уложиться в 500 тыс. руб. с НДС», «на эту задачу выделено до», «ориентировочный бюджет мероприятия», «максимальная сумма закупки»
- Чаты / мессенджеры (разговорный стиль): «у нас на это 300к», «бюджет около ляма», «больше 200 не дадут», «в 150 тыс. уложимся?»
- Сокращения и термины: «бюджет», «лимит», «т.р.», «тыс.», «млн», «к» (300к), «с НДС / без НДС»
- Устойчивые конструкции / маркеры: «бюджет / лимит» + сумма + задача; «уложиться в» + сумма; «до» + сумма + «на» + задачу

**Похоже, но не это (анти-признаки):** «оплатили 240 000 руб.» → `INVOICE_PAID`; «оборот сети — 3 млрд» → нет сигнала; «бюджет на следующий год урезали» → `SALES_BUDGET_CUT`.

**Пример (evidence):** «На новогодний корпоратив у нас бюджет на напитки около 350 тыс. руб., предложите что-то в эти рамки.»
**Контрпример:** «Счёт на 350 тыс. руб. оплатим в пятницу» → это оплата, не бюджет задачи.

**Заметка для карточки:** Укажи задачу и сумму; шаги — сверить бюджет с вариантами, предложить решение в рамках суммы.

---

## B · Договоры и право

| Code | Название (RU) | W | Class | Kind | Score rule | Effort | Asks us | Inbound only | Amount | Stage (pack) | IN4COM | Profile | Recipient | Family |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `CONTRACT_DPA` | Соглашение (поручение) об обработке персональных данных | 4 | fyi | event | fixed | medium | yes | — | — | active | off | D4 | account | contract |
| `CONTRACT_NDA` | Подписано соглашение о конфиденциальности (NDA) | 2 | fyi | event | fixed | medium | yes | — | — | active | off | W1 | account | contract |
| `CONTRACT_COMPLIANCE_DECLARATION` | Запрошена анкета или заверение о соответствии (санкции, проверка контрагента, ESG) | 4 | fyi | event | fixed | quick | yes | — | — | active | review | D4 | account | contract |

Block B: 3 codes — 3 active.

### `CONTRACT_DPA` — Соглашение (поручение) об обработке персональных данных

| Field | Value |
|---|---|
| Pack · block · family | base · B · contract |
| Weight · class · kind · score rule | 4 · fyi · event · fixed |
| Effort · asks us · inbound only · amount | medium · yes · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · off |
| Display profile | from weight (D4) |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule. Usual: none. |

**Определение:** Запрошено, отправлено или подписано соглашение об обработке персональных данных: поручение на обработку ПДн по 152-ФЗ, соглашение о защите персональных данных, приложение о ПДн к договору.

**Граница (не считается):** Соглашение о конфиденциальности (коммерческая тайна) — `CONTRACT_NDA`. Анкеты по санкциям, проверке контрагента, ESG — `CONTRACT_COMPLIANCE_DECLARATION`. Согласие на рассылку или политика конфиденциальности сайта в подписи письма — нет сигнала. Основной договор поставки или услуг — не этот код.

**Признаки для промпта (≤ 8):** «поручение на обработку персональных данных», «соглашение об обработке ПДн», «152-ФЗ», «персональные данные», «приложение о защите персональных данных», «DPA», «обработка ПДн по поручению», «соглашение о защите данных»

**Синонимы и выражения (полный список):**
- Деловая переписка: «просим подписать поручение на обработку персональных данных», «направляем соглашение об обработке ПДн к договору», «необходимо приложение о защите персональных данных в соответствии с 152-ФЗ», «во вложении подписанное соглашение о ПДн», «просим подтвердить меры по защите ПДн»
- Чаты / мессенджеры (разговорный стиль): «юристы просят допник по персданным», «нужно подписать бумагу по ПДн», «пришлите соглашение по персональным данным»
- Сокращения и термины: «ПДн», «152-ФЗ», «DPA», «поручение оператора», «РКН», «локализация ПДн», «ст. 6 152-ФЗ»
- Устойчивые конструкции / маркеры: «поручение / соглашение / приложение» + «об обработке / о защите» + «персональных данных»

**Похоже, но не это (анти-признаки):** «подписали NDA» → `CONTRACT_NDA`; «заполните анкету контрагента» → `CONTRACT_COMPLIANCE_DECLARATION`; дисклеймер «письмо содержит персональные данные» в подписи → нет сигнала.

**Пример (evidence):** «Для запуска рассылки по нашей базе гостей юристы просят подписать поручение на обработку персональных данных — проект во вложении.»
**Контрпример:** «Настоящее сообщение и вложения конфиденциальны и могут содержать персональные данные» (подпись) → нет сигнала.

**Заметка для карточки:** Укажи, какой документ по ПДн и в каком статусе; шаги — передать юристу, согласовать текст, подписать.

### `CONTRACT_NDA` — Подписано соглашение о конфиденциальности (NDA)

| Field | Value |
|---|---|
| Pack · block · family | base · B · contract |
| Weight · class · kind · score rule | 2 · fyi · event · fixed |
| Effort · asks us · inbound only · amount | medium · yes · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · off |
| Display profile | from weight (W1) |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule. Usual: none — NDA is a separate fact, never a stage move (Maslov §3). |

**Определение:** Подписано соглашение о конфиденциальности (о неразглашении, о коммерческой тайне). Это подтверждение факта, а не задача.

**Граница (не считается):** Анкеты и заверения (санкции, экспортный контроль, ESG, проверка контрагента) — `CONTRACT_COMPLIANCE_DECLARATION`. Договор поставки, услуг или агентский договор, присланный на подпись, — не этот код. Соглашение о ПДн — `CONTRACT_DPA`. Стандартный дисклеймер о конфиденциальности в подписи — нет сигнала.

**Признаки для промпта (≤ 8):** «NDA подписано», «соглашение о конфиденциальности подписано», «соглашение о неразглашении», «режим коммерческой тайны», «подписанный NDA во вложении», «договор о конфиденциальности», «соглашение о неразглашении информации»

**Синонимы и выражения (полный список):**
- Деловая переписка: «направляем подписанное соглашение о конфиденциальности», «соглашение о неразглашении подписано с нашей стороны», «во вложении скан подписанного NDA», «просим подписать соглашение о конфиденциальности до передачи документации»
- Чаты / мессенджеры (разговорный стиль): «NDA подписали, кидаю скан», «эндиэй подписан», «подписали бумагу о неразглашении»
- Сокращения и термины: «NDA», «КТ» (коммерческая тайна), «98-ФЗ», «соглашение о конфиденциальности»
- Устойчивые конструкции / маркеры: «подписан(о) / подписали» + «NDA / соглашение о конфиденциальности / о неразглашении»

**Похоже, но не это (анти-признаки):** «заполните анкету по санкциям» → `CONTRACT_COMPLIANCE_DECLARATION`; «направляем договор поставки на подпись» → нет этого кода; «информация в письме конфиденциальна» → нет сигнала.

**Пример (evidence):** «Соглашение о конфиденциальности подписано с нашей стороны, скан во вложении — можем передавать вам техническое задание.»
**Контрпример:** «Направляем на подпись договор поставки на 2027 год» → это не NDA.

**Заметка для карточки:** Отметь, что NDA подписано и с какой датой; шаг — сохранить документ в карточке клиента.

### `CONTRACT_COMPLIANCE_DECLARATION` — Запрошена анкета или заверение о соответствии (санкции, проверка контрагента, ESG)

| Field | Value |
|---|---|
| Pack · block · family | base · B · contract |
| Weight · class · kind · score rule | 4 · fyi · event · fixed |
| Effort · asks us · inbound only · amount | quick · yes · no · no |
| Emitted by | parser |
| Stage (pack default) · IN4COM | active · review |
| Display profile | from weight (D4) |
| Recipient role | account (not in Maslov v195; block B default) |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule. Usual: none. |

**Определение:** Клиент, госзаказчик или тендер просит у нас анкету, заверение или декларацию о соответствии требованиям — либо мы отправляем её: санкционные заверения и конечное использование, проверка контрагента (должная осмотрительность), антикоррупционные заверения, кодекс поставщика, ESG / анкета устойчивого развития.

**Граница (не считается):** Соглашение о конфиденциальности — `CONTRACT_NDA`; о ПДн — `CONTRACT_DPA`. В организации с пакетом дистрибуции документы на товар (сертификат, декларация соответствия ЕАЭС, удостоверение качества, справки А/Б к ТТН) — `DOCUMENTS_REQUESTED`, не этот код. Пакет документов в составе тендерной заявки — часть `SALES_TENDER_INVITATION`, если отдельного запроса нет.

**Признаки для промпта (≤ 8):** «анкета контрагента», «проверка контрагента», «заверения об обстоятельствах», «санкционная оговорка», «заверение о конечном использовании», «антикоррупционная оговорка», «кодекс поставщика», «ESG-анкета»

**Синонимы и выражения (полный список):**
- Деловая переписка: «для проверки контрагента просим заполнить анкету и предоставить пакет документов», «просим подписать заверения об обстоятельствах (ст. 431.2 ГК)», «требуется гарантийное письмо об отсутствии санкционных ограничений», «просим подтвердить, что конечный получатель не находится под санкциями», «просим ознакомиться и подписать кодекс поведения поставщика», «служба безопасности запросила документы для согласования поставщика», «просим заполнить анкету по устойчивому развитию»
- Чаты / мессенджеры (разговорный стиль): «СБ просит анкету на вас», «служба безопасности не пропускает без пакета документов», «надо заполнить анкету поставщика, скинула форму», «подпишите антикоррупционку»
- Сокращения и термины: «СБ», «KYC», «должная осмотрительность», «ст. 431.2 ГК», «антикоррупционная оговорка», «санкционная оговорка», «ESG», «кодекс поставщика», «выписка ЕГРЮЛ», «карточка предприятия», «ОКВЭД»
- Устойчивые конструкции / маркеры: «просим заполнить / подписать» + «анкету / заверения / декларацию / кодекс»; «для проверки / согласования» + «контрагента / поставщика»

**Похоже, но не это (анти-признаки):** «пришлите сертификаты и декларации на поставленный товар» → `DOCUMENTS_REQUESTED` (дистрибуция); «подписали NDA» → `CONTRACT_NDA`; «пришлите ваши реквизиты для счёта» → нет сигнала.

**Пример (evidence):** «Служба безопасности просит заполнить анкету контрагента и подписать заверения об обстоятельствах — без этого не можем завести вас в систему поставщиков.»
**Контрпример:** «Пришлите, пожалуйста, декларации соответствия на партию из последней поставки» → документы на товар (`DOCUMENTS_REQUESTED` в дистрибуции).

**Заметка для карточки:** Укажи, какую анкету или заверение просят и к какому сроку; шаги — собрать документы, согласовать текст с юристом, отправить.

---

## C · Исполнение и отчётность

| Code | Название (RU) | W | Class | Kind | Score rule | Effort | Asks us | Inbound only | Amount | Stage (pack) | IN4COM | Profile | Recipient | Family |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `DELIVERY_REPORT_REQUESTED` | Клиент запросил отчёт | 6 | fyi | event | fixed | medium | yes | yes | — | active | off | P6 | account | delivery |
| `DELIVERY_REPORT_OPEN` | Запрошенный отчёт ещё не предоставлен | 4 | risk | watchdog | fixed | medium | — | — | — | onHold | off | D4 | account | delivery |
| `DELIVERY_PROTOCOL` | Получен протокол или итоги встречи от клиента | 2 | fyi | event | fixed | medium | — | yes | — | active | review | W1 | account | delivery |
| `THREAD_DEADLINE_NEAR` | До срока по теме осталось не более двух дней | 4 | risk | derived | fixed | medium | — | — | — | parked | review | D4 | account | delivery |

Block C: 4 codes — 2 active, 1 onHold, 1 parked.

### `DELIVERY_REPORT_REQUESTED` — Клиент запросил отчёт

| Field | Value |
|---|---|
| Pack · block · family | base · C · delivery |
| Weight · class · kind · score rule | 6 · fyi · event · fixed |
| Effort · asks us · inbound only · amount | medium · yes · yes · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · off |
| Display profile | from weight (P6) |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: — (no "report sent" state code; see Open points) |
| Relations | the `DELIVERY_REPORT_OPEN` watchdog follows this code. |
| Date gate | — (the report deadline goes to `facts.deadlines`, owner = us) |
| Relevance window | until the report deadline, if given; else default |
| Deal effect | per org rule. Usual: none. |

**Определение:** Клиент просит отчёт о выполненной работе, итоговый или промежуточный отчёт, отчёт по результатам, статистику, отчёт по продажам или промо.

**Граница (не считается):** Закрывающие бухгалтерские документы (акт, УПД, счёт-фактура) — не отчёт (в дистрибуции `DOCUMENTS_REQUESTED`). Акт сверки — `RECONCILIATION_REQUESTED` (дистрибуция) или нет сигнала. Протокол встречи от клиента — `DELIVERY_PROTOCOL`. Жалоба «отчёта до сих пор нет» — `COMPLAINT_TIMING`.

**Признаки для промпта (≤ 8):** «пришлите отчёт», «нужен отчёт по итогам», «отчёт за месяц», «итоговый отчёт», «предоставьте статистику», «отчёт по продажам», «отчёт о выполнении», «промежуточный отчёт»

**Синонимы и выражения (полный список):**
- Деловая переписка: «просим предоставить отчёт о проделанной работе за октябрь», «направьте, пожалуйста, итоговый отчёт по проекту», «прошу подготовить отчёт по результатам акции», «необходим отчёт для руководства до», «просим отчёт по исполнению договора»
- Чаты / мессенджеры (разговорный стиль): «скиньте отчётик за месяц», «где посмотреть результаты?», «нужна статистика по акции», «пришлите цифры по продажам нашей сети» (дистрибуция)
- Сокращения и термины: «отчёт», «отчётность», «статистика», «sell-out», «sell-in», «KPI», «итоги»
- Устойчивые конструкции / маркеры: «пришлите / подготовьте / предоставьте» + «отчёт / статистику / итоги» + период или проект

**Похоже, но не это (анти-признаки):** «пришлите УПД и счёт-фактуру» → `DOCUMENTS_REQUESTED` (дистрибуция); «пришлите акт сверки» → `RECONCILIATION_REQUESTED` (дистрибуция); «отчёт обещали ещё в понедельник» → `COMPLAINT_TIMING`.

**Пример (evidence):** «Подготовьте, пожалуйста, итоговый отчёт по результатам промо в наших магазинах за ноябрь до 10 декабря.»
**Контрпример:** «Пришлите акты за октябрь для бухгалтерии» → закрывающие документы, не отчёт.

**Заметка для карточки:** Укажи, какой отчёт, за какой период и к какому сроку; шаги — собрать данные, подготовить отчёт, отправить к сроку.

### `DELIVERY_REPORT_OPEN` — Запрошенный отчёт ещё не предоставлен

| Field | Value |
|---|---|
| Pack · block · family | base · C · delivery |
| Weight · class · kind · score rule | 4 · risk · watchdog · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | process |
| Stage (pack default) · IN4COM | onHold · off |
| Display profile | from weight (D4) |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: a recorded report sending on the topic (no state code today) |
| Relations | follows `DELIVERY_REPORT_REQUESTED`. |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule. Usual: none. |

**Определение:** Клиент запросил отчёт, мы его обещали, но отчёт не отправлен в срок. Создаётся процессом.

**Граница (не считается):** Жалоба клиента на задержку отчёта — `COMPLAINT_TIMING`. Без исходного `DELIVERY_REPORT_REQUESTED` — нет сигнала.

**Признаки для промпта:** — (not in the extraction prompt; emitted by process)

**Правило срабатывания:** RU: есть открытый `DELIVERY_REPORT_REQUESTED`; срок (`facts.deadlines`, owner = us, или окно организации) прошёл; в теме нет нашего письма с отчётом. EN: an open `DELIVERY_REPORT_REQUESTED`; the deadline (owner = us, else the org window) passed; no outgoing report on the topic.

**Пример (evidence):** Клиент просил отчёт до 10.12; на 11.12 в теме нет нашего письма с отчётом.

**Заметка для карточки:** Укажи отчёт и пропущенный срок; шаги — отправить отчёт или сообщить клиенту новый срок.

### `DELIVERY_PROTOCOL` — Получен протокол или итоги встречи от клиента

| Field | Value |
|---|---|
| Pack · block · family | base · C · delivery |
| Weight · class · kind · score rule | 2 · fyi · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · yes · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · review |
| Display profile | from weight (W1) |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule. Usual: none (deal-state context). |

**Определение:** От клиента пришёл протокол, итоги или резюме встречи, совещания или звонка. Для информации.

**Граница (не считается):** Наш собственный исходящий протокол — не этот код. Повестка будущей встречи — нет сигнала. Если в протоколе есть новая задача для нас (запрос КП, отчёта, жалоба) — указать ещё и соответствующий код; протокол сам по себе — только информация.

**Признаки для промпта (≤ 8):** «протокол встречи», «итоги встречи», «по итогам совещания», «резюме звонка», «фиксируем договорённости», «протокол во вложении», «краткие итоги», «договорились о следующем»

**Синонимы и выражения (полный список):**
- Деловая переписка: «направляем протокол рабочей встречи от 12.11», «по итогам совещания фиксируем следующие договорённости», «во вложении протокол переговоров», «кратко резюмирую итоги нашего звонка», «прошу проверить протокол и дать комментарии»
- Чаты / мессенджеры (разговорный стиль): «закинула итоги созвона», «фиксирую, о чём договорились», «по встрече: 1) 2) 3)», «вот наши записи со встречи»
- Сокращения и термины: «протокол», «MoM», «минутки», «резюме», «follow-up», «итоги»
- Устойчивые конструкции / маркеры: «по итогам» + «встречи / совещания / звонка»; «фиксируем / договорились» + список пунктов

**Похоже, но не это (анти-признаки):** «направляем протокол нашей встречи» (наше письмо) → нет сигнала; «повестка на четверг» → нет сигнала; «по итогам встречи просим КП до пятницы» → `SALES_OFFER_REQUESTED` (+ этот код допустим).

**Пример (evidence):** «Коллеги, направляем протокол встречи от 12.11: согласовали запуск дегустаций в трёх ресторанах, следующая встреча — 26.11.»
**Контрпример:** «Предлагаю повестку на четверг: ассортимент, условия, логистика» → будущая встреча, протокола нет.

**Заметка для карточки:** Кратко перечисли договорённости из протокола; шаг — сверить с нашими записями и внести сроки в задачи.

### `THREAD_DEADLINE_NEAR` — До срока по теме осталось не более двух дней

| Field | Value |
|---|---|
| Pack · block · family | base · C · delivery |
| Weight · class · kind · score rule | 4 · risk · derived · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | process |
| Stage (pack default) · IN4COM | parked · review |
| Display profile | from weight (D4) |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: — (the deadline is met or moved) |
| Relations | — |
| Date gate | — |
| Relevance window | until the deadline |
| Deal effect | per org rule. Usual: none. |

**Определение:** Ближайший открытый срок по теме (наш срок) наступает не позже чем через два дня. Вычисляется процессом; припаркован вместе с логикой тредов.

**Граница (не считается):** Срок клиента (owner = them) — не этот код. В Topics эту задачу частично решает эскалация по сроку (спец. §8.2), поэтому код остаётся припаркованным.

**Признаки для промпта:** — (not in the extraction prompt; emitted by process)

**Правило срабатывания:** RU: у темы есть открытый срок из `facts.deadlines` с owner = us; до него ≤ 2 рабочих дней по производственному календарю РФ; тема не закрыта. EN: the topic has an open deadline (owner = us) at most 2 working days away (Russian production calendar); the topic is open.

**Пример (evidence):** Клиент просил КП к 14.11; 12.11 КП ещё не отправлено.

**Заметка для карточки:** Укажи срок и что нужно сдать; шаг — закрыть задачу до срока или предупредить клиента.

---

## D · Счета

| Code | Название (RU) | W | Class | Kind | Score rule | Effort | Asks us | Inbound only | Amount | Stage (pack) | IN4COM | Profile | Recipient | Family |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `INVOICE_OVERDUE` | Наш счёт клиенту не оплачен в срок или оспорен | 7 | risk | event | fixed | medium | — | — | yes | active | on | P6 | finance | invoice |
| `INVOICE_PAID` | Клиент оплатил счёт | 0 | — | state | state | — | — | — | — | active | on | S0 | finance | invoice |

Block D: 2 codes — 2 active.

### `INVOICE_OVERDUE` — Наш счёт клиенту не оплачен в срок или оспорен

| Field | Value |
|---|---|
| Pack · block · family | base · D · invoice |
| Weight · class · kind · score rule | 7 · risk · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · yes |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · on |
| Display profile | from weight (P6) |
| Recipient role | finance |
| Closes / closed by | closes: — · closed by: `INVOICE_PAID` |
| Relations | — in v204. Agency: one card with `INVOICE_DISPUTE_RAISED` (a dispute does not replace the overdue fact, Maslov §5.5). Distribution: `PAYMENT_PROMISE` attaches to this topic. |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule. IN4COM: risk trigger «Долг клиента» (open deal of this client); clears with `INVOICE_PAID` or a kept `PAYMENT_PROMISE`. |

**Определение:** Наш (исходящий) счёт клиенту не оплачен в срок, есть задолженность, или клиент оспаривает счёт. Код ставится и на наше письмо-напоминание об оплате, и на сообщение клиента о задержке или споре.

**Граница (не считается):** Входящий счёт поставщика НАМ — не этот код. Счёт ещё не просрочен и вопросов нет — нет сигнала. Клиент обещает оплатить к дате — `PAYMENT_PROMISE` (дистрибуция) на той же теме; в базе — контекст к этому коду. Запрос акта сверки без долга — `RECONCILIATION_REQUESTED` (дистрибуция). Просьба об отсрочке на будущее — `PAYMENT_TERMS_REQUEST` (дистрибуция) / `SALES_RENEGOTIATION`.

**Признаки для промпта (≤ 8):** «напоминаем об оплате», «просрочка», «задолженность», «акт сверки показывает долг», «просрочка оплаты», «дебиторка», «счёт не оплачен», «оспариваем счёт»

**Синонимы и выражения (полный список):**
- Деловая переписка: «напоминаем, что срок оплаты по счёту № истёк», «за вами числится задолженность в размере», «просим погасить просроченную задолженность», «по акту сверки на 01.11 задолженность составляет», «досудебная претензия об оплате», «не согласны с суммой счёта, просим скорректировать», «оплата задерживается в связи с»
- Чаты / мессенджеры (разговорный стиль): «когда оплатите?», «у вас долг висит с октября», «бухгалтерия пока не провела», «оплата съехала на следующую неделю», «счёт неверный, не будем пока платить»
- Сокращения и термины: «ДЗ», «дебиторка», «просрочка», «акт сверки», «претензия», «пени», «неустойка», «отсрочка истекла», «ПП не поступало»
- Устойчивые конструкции / маркеры: «срок оплаты» + «истёк / прошёл»; «задолженность в размере» + сумма; «просим оплатить / погасить»; «не согласны со счётом»

**Похоже, но не это (анти-признаки):** «во вложении счёт от поставщика на оплату» (нам) → нет сигнала; «оплатили, платёжка во вложении» → `INVOICE_PAID`; «оплатим до пятницы» → `PAYMENT_PROMISE` (дистрибуция); «пришлите акт сверки за квартал» → `RECONCILIATION_REQUESTED` (дистрибуция).

**Пример (evidence):** «Напоминаем, что по счёту № 1187 от 02.10 на 214 600 руб. срок оплаты истёк 16.10, просим погасить задолженность до конца недели.»
**Контрпример:** «Счёт № 1240 получили, оплатим в установленный договором срок» → просрочки нет.

**Заметка для карточки:** Укажи счёт, сумму, дату и число дней просрочки; шаги — связаться с бухгалтерией клиента, выяснить причину, согласовать дату оплаты.

### `INVOICE_PAID` — Клиент оплатил счёт

| Field | Value |
|---|---|
| Pack · block · family | base · D · invoice |
| Weight · class · kind · score rule | 0 · — · state · state |
| Effort · asks us · inbound only · amount | — · no · no · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · on |
| Display profile | S0 (state code, closes and makes no card) |
| Recipient role | finance |
| Closes / closed by | closes: `INVOICE_OVERDUE` (same client / invoice topic) · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule. IN4COM: clears the risk «Долг клиента». Payment is a separate fact, never a stage move. |

**Определение:** Служебное событие: клиент сообщает об оплате нашего счёта или мы фиксируем поступление денег. Закрывает открытый вопрос просрочки по этому счёту; карточку не создаёт.

**Граница (не считается):** Обещание оплатить — не оплата (`PAYMENT_PROMISE` в дистрибуции). Урегулирование спора без оплаты — не этот код (агентский `INVOICE_DISPUTE_RESOLVED`). Наша оплата поставщику — не этот код. Частичная оплата закрывает только оплаченную часть: если долг остаётся, `INVOICE_OVERDUE` остаётся открытым.

**Признаки для промпта (≤ 8):** «оплатили», «платёжка», «деньги ушли», «платёжное поручение», «оплата прошла», «оплата поступила», «счёт оплачен», «перевели»

**Синонимы и выражения (полный список):**
- Деловая переписка: «оплата по счёту № произведена, платёжное поручение во вложении», «денежные средства перечислены», «подтверждаем оплату», «задолженность погашена в полном объёме», «оплата поступила на расчётный счёт»
- Чаты / мессенджеры (разговорный стиль): «оплатили, кидаю платёжку», «деньги ушли», «перевели сегодня», «закинули оплату», «платёжка в почте»
- Сокращения и термины: «ПП», «п/п», «платёжка», «платёжное поручение», «выписка банка», «зачисление»
- Устойчивые конструкции / маркеры: «оплачен(о) / оплатили» + счёт; «перечислили / перевели» + сумма; «платёжное поручение во вложении»

**Похоже, но не это (анти-признаки):** «оплатим в пятницу» → `PAYMENT_PROMISE` (дистрибуция); «отправили платёжку на согласование директору» → нет сигнала (ещё не оплачено); «спор по счёту сняли» → `INVOICE_DISPUTE_RESOLVED` (агентский пакет).

**Пример (evidence):** «Счёт № 1187 оплатили сегодня, платёжное поручение во вложении.»
**Контрпример:** «Платёж поставили в реестр на следующую неделю» → это обещание, оплаты ещё нет.

**Заметка для карточки:** Карточку не создавать; закрыть открытую просрочку по этому счёту, при частичной оплате оставить остаток открытым.

---

## E · Обратная связь

| Code | Название (RU) | W | Class | Kind | Score rule | Effort | Asks us | Inbound only | Amount | Stage (pack) | IN4COM | Profile | Recipient | Family |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `COMPLAINT_PRICE` | Жалоба на цену или условия | 8 | risk | event | fixed | medium | yes | yes | — | active | on | P8 | account | complaint |
| `COMPLAINT_ESCALATED` | Жалоба передана на более высокий уровень | 8 | risk | event | fixed | medium | yes | yes | — | active | on | P8 | account | complaint |
| `COMPLAINT_TIMING` | Жалоба на сроки и задержку с нашей стороны | 7 | risk | event | fixed | medium | yes | yes | — | active | on | P6 | account | complaint |
| `COMPLAINT_COMM` | Жалоба на коммуникацию и недоступность | 7 | risk | event | fixed | medium | yes | yes | — | active | on | P6 | account | complaint |
| `COMPLAINT_QUANTITY` | Жалоба на недопоставку (меньше согласованного) | 7 | risk | event | fixed | medium | yes | yes | — | active | on | P6 | account | complaint |
| `COMPLAINT_QUALITY` | Жалоба на качество, брак или ошибку | 7 | risk | event | fixed | medium | yes | yes | — | active | on | P6 | account | complaint |
| `FEEDBACK_REFERRAL` | Клиент рекомендует нас или даёт контакт | 5 | chance | event | fixed | medium | — | yes | — | active | on | D4 | account | contact |
| `FEEDBACK_QUALITY_PRAISE` | Похвала качеству | 3 | fyi | event | fixed | medium | — | yes | — | active | on | W1 | account | account |
| `FEEDBACK_COMM_PRAISE` | Похвала работе менеджера и коммуникации | 2 | fyi | event | fixed | medium | — | yes | — | active | review | W1 | account | account |
| `FEEDBACK_PRICE_PRAISE` | Клиент подтвердил, что условия справедливые | 2 | fyi | event | fixed | medium | — | yes | — | active | review | W1 | account | account |
| `THREAD_UNANSWERED_FOLLOWUP` | Повторные напоминания клиента остались без ответа | 3 | risk | derived | fixed | medium | — | — | — | parked | review | W1 | account | complaint |

Block E: 11 codes — 10 active, 1 parked.

Shared rule for all six `COMPLAINT_*` codes: the complaint is about US (our goods, service, people, terms). The emotion and tone go into attributes (`ATTR_EMOTION_*`, `ATTR_TONE_NEGATIVE`), not into a separate code. Base has no complaint-closing state code; see Open points.

### `COMPLAINT_PRICE` — Жалоба на цену или условия

| Field | Value |
|---|---|
| Pack · block · family | base · E · complaint |
| Weight · class · kind · score rule | 8 · risk · event · fixed |
| Effort · asks us · inbound only · amount | medium · yes · yes · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · on |
| Display profile | from weight (P8) |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: — (agency: `COMPLAINT_RESOLUTION_CONFIRMED`) |
| Relations | both with `COMPLAINT_ESCALATED` (the escalation and the complaint underneath it). Often together with `SALES_RENEGOTIATION`. |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule. IN4COM: risk trigger **«Конкурент предлагает дешевле»** (incl. a competitor's cheaper offer; not at the first-contact stage). |

**Определение:** Клиент недоволен нашей ценой или условиями: считает дорого, ссылается на более дешёвое предложение конкурента, возмущается ростом цен или условиями оплаты и поставки.

**Граница (не считается):** Конкретная просьба изменить согласованные условия — `SALES_RENEGOTIATION` (может быть вместе с этим кодом). Отказ от КП из-за цены — `SALES_OFFER_DECLINED`. Нейтральный вопрос о цене — `SALES_PRICE_REQUEST`. Поставщик повышает цены НАМ — `SUPPLIER_PRICE_CHANGE`. Ошибка в цене в счёте — `INVOICE_OVERDUE` (спор по счёту).

**Признаки для промпта (≤ 8):** «у другого поставщика дешевле», «нам предложили по цене ниже», «слишком дорого», «цены неприемлемы», «опять подняли цены», «у конкурентов условия лучше», «не можем работать по таким ценам», «цена не рыночная»

**Синонимы и выражения (полный список):**
- Деловая переписка: «ваши цены существенно выше рыночных», «нам поступило предложение на аналогичную позицию на 15% дешевле», «повышение цен с 1 декабря для нас неприемлемо», «условия оплаты не соответствуют рынку», «просим обосновать повышение стоимости», «при таких ценах вынуждены рассмотреть других поставщиков»
- Чаты / мессенджеры (разговорный стиль): «чего так дорого?», «вы опять цены задрали», «у других то же самое дешевле на сотку», «нам у соседей дали лучше», «ну это грабёж», «за такие деньги не возьмём»
- Сокращения и термины: «наценка», «РРЦ», «спеццена», «рыночная цена», «конкурентное предложение», «прайс конкурента»
- Устойчивые конструкции / маркеры: «дорого / дороже / выше рынка»; «у других / у конкурентов / нам предложили» + «дешевле / по цене ниже»; «повышение цен» + «неприемлемо / не согласны»

**Похоже, но не это (анти-признаки):** «просим поднять скидку до 12%» → `SALES_RENEGOTIATION`; «сколько стоит Шабли?» → `SALES_PRICE_REQUEST`; «производитель повышает цены с января» (письмо поставщика) → `SUPPLIER_PRICE_CHANGE`; «цены хорошие, всё устраивает» → `FEEDBACK_PRICE_PRAISE`.

**Пример (evidence):** «Нам предложили то же Просекко у другого поставщика по 690 руб. за бутылку, а у вас 820 — честно говоря, не понимаем, почему такая разница.»
**Контрпример:** «Подскажите, какая цена на Просекко при заказе от 10 коробок?» → это нейтральный запрос цены.

**Заметка для карточки:** Укажи, на что жалуется клиент и какую цену конкурента называет; шаги — проверить сравнимость предложения, подготовить аргументы или вариант условий, связаться с ЛПР.

### `COMPLAINT_ESCALATED` — Жалоба передана на более высокий уровень

| Field | Value |
|---|---|
| Pack · block · family | base · E · complaint |
| Weight · class · kind · score rule | 8 · risk · event · fixed |
| Effort · asks us · inbound only · amount | medium · yes · yes · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · on |
| Display profile | from weight (P8) |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: — (agency: `COMPLAINT_RESOLUTION_CONFIRMED` closes the complaint and the linked escalation) |
| Relations | both with `COMPLAINT_PRICE`, `COMPLAINT_TIMING`, `COMPLAINT_COMM`, `COMPLAINT_QUANTITY`, `COMPLAINT_QUALITY` (the escalation and the complaint underneath it; one incident card, Maslov §5.5). |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule. IN4COM: risk trigger **«Повторные жалобы»** (one escalated complaint is enough). |

**Определение:** Клиент поднимает проблему на более высокий уровень: подключает своего руководителя, пишет нашему руководству, ставит их в копию, грозит официальной претензией или обращается «выше».

**Граница (не считается):** Обычная жалоба без вовлечения руководства — только соответствующий `COMPLAINT_*`. Руководитель клиента просто в копии рабочей переписки без жалобы — нет сигнала. Внутренняя эскалация у нас (коллега пишет коллеге) — блок J (`TEAM_ESCALATION`, gated). Угроза расторжения без решения — этот код + жалоба, не `CONTRACT_TERMINATED`.

**Признаки для промпта (≤ 8):** «ставлю в копию руководство», «пишу вашему директору», «вынуждены обратиться к руководству», «передаю вопрос генеральному», «досудебная претензия», «направляем официальную претензию», «эскалируем», «прошу подключить вашего руководителя»

**Синонимы и выражения (полный список):**
- Деловая переписка: «в связи с отсутствием реакции ставлю в копию вашего генерального директора», «вопрос передан на уровень коммерческого директора», «направляем официальную претензию», «будем вынуждены обратиться к руководству вашей компании», «прошу руководителя отдела продаж взять ситуацию на контроль», «досудебная претензия во вложении»
- Чаты / мессенджеры (разговорный стиль): «я уже нашему директору пожаловалась», «если не решите, иду к вашему начальству», «дайте контакт вашего руководителя», «подключаю шефа, разбирайтесь»
- Сокращения и термины: «эскалация», «претензия», «досудебка», «ГД», «КД», «в копии», «на контроле у руководства»
- Устойчивые конструкции / маркеры: «ставлю в копию» + руководитель; «обратиться / передать» + «руководству / директору»; «официальная / досудебная претензия»

**Похоже, но не это (анти-признаки):** руководитель клиента в копии письма о графике поставок без жалобы → нет сигнала; «опять задержка» без вовлечения руководства → только `COMPLAINT_TIMING`; коллега пишет нам внутри компании «клиент недоволен» → нет этого кода (блок J).

**Пример (evidence):** «Это уже третья задержка за месяц, ставлю в копию вашего коммерческого директора и прошу взять ситуацию на личный контроль.»
**Контрпример:** «Ставлю в копию нашего директора, чтобы он видел график поставок на декабрь» → информирование, не эскалация жалобы.

**Заметка для карточки:** Укажи, кто подключён и какая проблема под эскалацией; шаги — ответить в тот же день с позиции руководителя, дать план решения и срок.

### `COMPLAINT_TIMING` — Жалоба на сроки и задержку с нашей стороны

| Field | Value |
|---|---|
| Pack · block · family | base · E · complaint |
| Weight · class · kind · score rule | 7 · risk · event · fixed |
| Effort · asks us · inbound only · amount | medium · yes · yes · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · on |
| Display profile | from weight (P6) |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: — (agency: `COMPLAINT_RESOLUTION_CONFIRMED`) |
| Relations | both with `COMPLAINT_ESCALATED`. |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule. IN4COM: risk trigger **«Повторные жалобы»** (≥ 2 complaints of this client in 30 days). |

**Определение:** Клиент жалуется на задержку с нашей стороны: поставка, результат, документ, отчёт или обещанный ответ по задаче пришли позже срока или до сих пор не пришли.

**Граница (не считается):** Поставщик сообщает НАМ, что его поставка задерживается, — `SUPPLIER_DELIVERY_DELAY`. Клиент не может до нас дозвониться, нам не отвечают на письма вообще — `COMPLAINT_COMM` (здесь — задержка конкретного результата или обещания). Нейтральный вопрос «когда привезёте?» без упрёка — не жалоба (в дистрибуции `DELIVERY_SCHEDULE_REQUEST`). Задержка по вине клиента — нет этого кода.

**Признаки для промпта (≤ 8):** «сорвали сроки», «опять задержка», «мы до сих пор ждём», «не привезли вовремя», «обещали ещё в понедельник», «срок прошёл», «сколько можно ждать», «у нас из-за вас простой»

**Синонимы и выражения (полный список):**
- Деловая переписка: «поставка по заказу № не выполнена в согласованный срок», «вы нарушили сроки, установленные договором», «до настоящего времени товар не получен», «обещанный отчёт так и не поступил», «просим объяснить причины задержки», «из-за задержки мы сорвали открытие»
- Чаты / мессенджеры (разговорный стиль): «ну что там по доставке??», «где машина?», «опять не привезли», «вы обещали к обеду, уже вечер», «третий раз переносите», «гости ждут, а вина нет» (дистрибуция)
- Сокращения и термины: «просрочка поставки», «срыв сроков», «неустойка за просрочку», «пени», «SLA»
- Устойчивые конструкции / маркеры: «до сих пор / так и не» + «не получили / не пришло»; «опять / снова / в который раз» + «задержка / перенос»; «обещали к» + дата

**Похоже, но не это (анти-признаки):** «контейнер задерживается на таможне» (письмо поставщика нам) → `SUPPLIER_DELIVERY_DELAY`; «третий день не можем до вас дозвониться» → `COMPLAINT_COMM`; «подскажите, в какое окно привезёте?» → `DELIVERY_SCHEDULE_REQUEST` (дистрибуция); «пока не получили» (факт без упрёка) → нет сигнала или нейтральный вопрос.

**Пример (evidence):** «Заказ должны были привезти во вторник, сегодня пятница — мы до сих пор ждём, и это уже вторая задержка подряд.»
**Контрпример:** «Поставку пока не получили, подскажите, пожалуйста, ориентировочное время» → нейтральный вопрос, без упрёка.

**Заметка для карточки:** Укажи, что задерживается и на сколько; шаги — выяснить статус, дать клиенту точный срок, предложить компенсацию при повторе.

### `COMPLAINT_COMM` — Жалоба на коммуникацию и недоступность

| Field | Value |
|---|---|
| Pack · block · family | base · E · complaint |
| Weight · class · kind · score rule | 7 · risk · event · fixed |
| Effort · asks us · inbound only · amount | medium · yes · yes · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · on |
| Display profile | from weight (P6) |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: — (agency: `COMPLAINT_RESOLUTION_CONFIRMED`) |
| Relations | both with `COMPLAINT_ESCALATED`. |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule. Usual: none (not in the IN4COM risk list). |

**Определение:** Клиент жалуется, что до нас не достучаться: не отвечаем на письма и звонки, отвечаем медленно, путаем, не держим в курсе, меняем контактных лиц без предупреждения.

**Граница (не считается):** Задержка конкретного результата, поставки или документа — `COMPLAINT_TIMING`. Клиент просто повторно пишет без упрёка — не жалоба (повторы считает `THREAD_UNANSWERED_FOLLOWUP`, parked). Жалоба на грубость или ошибки сотрудника в работе — этот код, если про общение; если про результат — `COMPLAINT_QUALITY`.

**Признаки для промпта (≤ 8):** «не можем до вас дозвониться», «вы не отвечаете», «жду ответа третий день», «никто не перезвонил», «нас не держат в курсе», «невозможно связаться с менеджером», «пишу уже не первый раз», «отвечаете через неделю»

**Синонимы и выражения (полный список):**
- Деловая переписка: «на наши письма от 05.11 и 08.11 ответа не поступило», «не можем связаться с закреплённым менеджером», «просим назначить контактное лицо, которое будет отвечать», «информацию приходится запрашивать по несколько раз», «нас не уведомили об изменениях»
- Чаты / мессенджеры (разговорный стиль): «ау, есть кто живой?», «вы вообще читаете?», «третий раз пишу», «до менеджера не дозвониться», «почему никто не отвечает?», «игнорите?»
- Сокращения и термины: «нет обратной связи», «ОС», «не на связи», «менеджер недоступен»
- Устойчивые конструкции / маркеры: «не можем / невозможно» + «дозвониться / связаться»; «не отвечаете / не ответили» + срок; «уже не первый раз пишу»

**Похоже, но не это (анти-признаки):** «где обещанное КП, срок был вчера?» → `COMPLAINT_TIMING`; «напоминаю о своём вопросе» без упрёка → нет сигнала; «спасибо, что всегда на связи» → `FEEDBACK_COMM_PRAISE`.

**Пример (evidence):** «Третий день не можем дозвониться до вашего менеджера, на письма тоже тишина — с кем вообще можно решить вопрос?»
**Контрпример:** «Добрый день, напомню про мой вопрос по ассортименту, когда будет возможность — ответьте» → вежливое напоминание без упрёка.

**Заметка для карточки:** Укажи, сколько клиент ждёт ответа и по какому вопросу; шаги — ответить сегодня, назвать контактное лицо и способ связи.

### `COMPLAINT_QUANTITY` — Жалоба на недопоставку (меньше согласованного)

| Field | Value |
|---|---|
| Pack · block · family | base · E · complaint |
| Weight · class · kind · score rule | 7 · risk · event · fixed |
| Effort · asks us · inbound only · amount | medium · yes · yes · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · on |
| Display profile | from weight (P6) |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: — (distribution: `DELIVERY_DISCREPANCY_RESOLVED` when the case is a discrepancy) |
| Relations | leads over `COMPLAINT_QUALITY` (when too little was delivered); both with `COMPLAINT_ESCALATED`. |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule. Usual: none (not in the IN4COM risk list). |

**Определение:** Клиент получил меньше, чем согласовано: не тот объём, не хватает позиций, количество меньше заказанного. «Мало» — это объём, даже если клиент называет это браком.

**Граница (не считается):** Неверное качество, вкус, дефект товара — `COMPLAINT_QUALITY`. В организации с пакетом дистрибуции расхождение, выявленное при приёмке конкретной поставки (недовложение, бой, пересорт, акт ТОРГ-2), — `DELIVERY_DISCREPANCY`; этот код остаётся для жалобы на объём в целом (систематическая недопоставка, урезанный объём заказа без согласования). Наша плановая частичная отгрузка, о которой клиент знает, — нет сигнала.

**Признаки для промпта (≤ 8):** «пришло меньше», «не хватает позиций», «недопоставка», «недогруз», «отгрузили не всё», «заказывали 50, пришло 30», «урезали заказ», «объём не соответствует заказу»

**Синонимы и выражения (полный список):**
- Деловая переписка: «поставка выполнена не в полном объёме», «по заказу № отгружено 30 из 50 единиц», «отсутствуют позиции, указанные в спецификации», «объём выполненных работ не соответствует договору», «систематически поставляете меньше заказанного»
- Чаты / мессенджеры (разговорный стиль): «пришло меньше, чем заказывали», «опять не всё привезли», «где ещё две коробки?», «вы нам ползаказа привезли», «половины позиций нет»
- Сокращения и термины: «недопоставка», «недогруз», «недовложение» (в дистрибуции → `DELIVERY_DISCREPANCY`), «частичная отгрузка», «отгрузка не в полном объёме»
- Устойчивые конструкции / маркеры: «заказывали столько-то, а пришло меньше»; «не хватает» + позиции / штук; «не в полном объёме»

**Похоже, но не это (анти-признаки):** «две бутылки пришли битые» → `DELIVERY_DISCREPANCY` (дистрибуция) / `COMPLAINT_QUALITY`; «вино пробковое» → `COMPLAINT_QUALITY`; «по акту приёмки недовложение 3 бутылки» → `DELIVERY_DISCREPANCY` (дистрибуция); «остаток заказа довезите в четверг, как договаривались» → нет сигнала.

**Пример (evidence):** «Уже второй раз подряд вы отгружаете не весь заказ: заказывали 40 коробок, пришло 28, остальное никто не согласовывал.»
**Контрпример:** «При приёмке обнаружили недовложение 2 бутылок, составили акт ТОРГ-2» → в организации с пакетом дистрибуции это `DELIVERY_DISCREPANCY`.

**Заметка для карточки:** Укажи заказ, сколько заказано и сколько пришло; шаги — проверить отгрузку, согласовать довоз или корректировку документов.

### `COMPLAINT_QUALITY` — Жалоба на качество, брак или ошибку

| Field | Value |
|---|---|
| Pack · block · family | base · E · complaint |
| Weight · class · kind · score rule | 7 · risk · event · fixed |
| Effort · asks us · inbound only · amount | medium · yes · yes · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · on |
| Display profile | from weight (P6) |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: — (agency: `COMPLAINT_RESOLUTION_CONFIRMED`) |
| Relations | `COMPLAINT_QUANTITY` leads over this code (when too little was delivered); both with `COMPLAINT_ESCALATED`. Successor of retired `COMPLAINT_ERROR`. |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule. IN4COM: risk trigger **«Повторные жалобы»** (≥ 2 complaints of this client in 30 days). |

**Определение:** То, что мы поставили или сделали, с дефектом: брак, ошибка, не тот товар или результат, техническая неисправность, рекламация. В вине: пробковый тон, окисление, осадок, подтёк, повреждённая этикетка.

**Граница (не считается):** Пришло меньше — `COMPLAINT_QUANTITY` (ведёт). В организации с пакетом дистрибуции бой, недовложение и пересорт при приёмке — `DELIVERY_DISCREPANCY`; просьба вернуть товар — `RETURN_REQUESTED` (вместе с этим кодом, если причина — брак). Ошибка в счёте — `INVOICE_OVERDUE` (спор). Вкусовое «нам не понравилось» без дефекта — нет сигнала или `SALES_OFFER_DECLINED`.

**Признаки для промпта (≤ 8):** «брак», «ошибка», «не то», «претензия», «рекламация», «возврат», «пробковый», «повреждена этикетка»

**Синонимы и выражения (полный список):**
- Деловая переписка: «направляем претензию по качеству поставленного товара», «выявлены дефекты», «товар не соответствует заявленным характеристикам», «просим заменить бракованную продукцию», «прошу принять рекламацию», «в результате допущена ошибка в», «требуем возврата денежных средств за некачественный товар»
- Чаты / мессенджеры (разговорный стиль): «вино пробковое» (дистрибуция), «бутылка окислилась» (дистрибуция), «в бутылках осадок, гости вернули» (дистрибуция), «подтёк по пробке» (дистрибуция), «этикетки рваные» (дистрибуция), «прислали не то», «опять косяк», «это брак, заберите»
- Сокращения и термины: «брак», «рекламация», «претензия», «несоответствие», «пересорт» (в дистрибуции → `DELIVERY_DISCREPANCY`), «пробковый тон», «TCA», «окислено», «осадок» (дистрибуция)
- Устойчивые конструкции / маркеры: «претензия / рекламация по» + товар или работа; «не соответствует» + требованию; «просим заменить / вернуть» + из-за дефекта

**Похоже, но не это (анти-признаки):** «пришло 30 вместо 50» → `COMPLAINT_QUANTITY`; «при приёмке 3 бутылки бой» → `DELIVERY_DISCREPANCY` (дистрибуция); «хотим вернуть нераспроданное» без дефекта → `RETURN_REQUESTED` (дистрибуция); «гостям не зашло, слишком кислое» → нет сигнала.

**Пример (evidence):** «Из последней партии Шабли уже четыре бутылки с пробковым тоном, гости вернули — просим заменить и разобраться с партией.»
**Контрпример:** «Гостям больше понравилось Совиньон, чем Шардоне, в следующий раз возьмём его» → предпочтение, не дефект.

**Заметка для карточки:** Укажи товар или работу, суть дефекта и партию; шаги — запросить фото и документы, согласовать замену или возврат, проверить партию.

### `FEEDBACK_REFERRAL` — Клиент рекомендует нас или даёт контакт

| Field | Value |
|---|---|
| Pack · block · family | base · E · contact |
| Weight · class · kind · score rule | 5 · chance · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · yes · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · on |
| Display profile | from weight (D4) |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule. Usual: none for the referring client; the referred company is a new lead (its own request creates its own deal). |

**Определение:** Клиент рекомендует нас другим компаниям или людям, даёт конкретный контакт, знакомит нас; либо новый контакт пишет, что нас ему рекомендовал наш клиент.

**Граница (не считается):** Общая похвала без рекомендации — `FEEDBACK_QUALITY_PRAISE` / `FEEDBACK_COMM_PRAISE`. Предложение познакомить с конкретным человеком в агентском пакете — `PROSPECT_INTRODUCTION_OFFERED`. Новый контакт у того же клиента — `CONTACT_NEW_KNOWN_ORG`. Рекомендация поставщика нам — нет сигнала.

**Признаки для промпта (≤ 8):** «рекомендовали вас», «порекомендовал вас коллегам», «передал ваш контакт», «знакомлю вас с», «вас нам посоветовали», «могу дать контакт», «свяжитесь с», «рассказал о вас партнёрам»

**Синонимы и выражения (полный список):**
- Деловая переписка: «рекомендовали вашу компанию нашим партнёрам», «передали ваши контакты в», «позвольте представить вам», «знакомлю вас с коммерческим директором», «к вам обратится наш партнёр, он в курсе», «нам вас рекомендовала компания»
- Чаты / мессенджеры (разговорный стиль): «дал ваш номер знакомому ресторатору» (дистрибуция), «скинула ваш контакт подруге, у неё бар» (дистрибуция), «вас советуют», «наберите Ивану, он ждёт звонка», «добавила вас в чат с»
- Сокращения и термины: «рекомендация», «реферал», «интро», «тёплый контакт»
- Устойчивые конструкции / маркеры: «рекомендовал(а) вас» + кому; «передал ваш контакт» + кому; «знакомлю вас с» + человек; «вас нам рекомендовал(а)» + кто

**Похоже, но не это (анти-признаки):** «работаем с вами с удовольствием» → `FEEDBACK_QUALITY_PRAISE` / `FEEDBACK_COMM_PRAISE`; «теперь по закупкам пишите Анне» → `CONTACT_NEW_KNOWN_ORG`; «могу познакомить с директором сети, если интересно» → `PROSPECT_INTRODUCTION_OFFERED` (агентский пакет) / этот код в базе.

**Пример (evidence):** «Рекомендовали вас нашим друзьям из ресторана на Патриарших, передала ваш контакт их управляющему — он напишет на этой неделе.»
**Контрпример:** «Спасибо, всё отлично, будем работать дальше» → похвала без рекомендации.

**Заметка для карточки:** Укажи, кому клиент нас рекомендовал и есть ли контакт; шаги — поблагодарить клиента, связаться с рекомендованным контактом.

### `FEEDBACK_QUALITY_PRAISE` — Похвала качеству

| Field | Value |
|---|---|
| Pack · block · family | base · E · account |
| Weight · class · kind · score rule | 3 · fyi · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · yes · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · on |
| Display profile | from weight (W1) |
| Recipient role | account |
| Closes / closed by | closes: — (praise never closes a complaint, Maslov §5.5) · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule. Usual: none. |

**Определение:** Клиент хвалит качество нашего товара, работы или результата. Действие не требуется.

**Граница (не считается):** Похвала менеджеру или общению — `FEEDBACK_COMM_PRAISE`. Похвала цене — `FEEDBACK_PRICE_PRAISE`. Вежливое «спасибо, получили» — нет сигнала. Похвала не закрывает чужую жалобу и не означает заказ.

**Признаки для промпта (≤ 8):** «гостям очень понравилось», «отличное качество», «всё на высшем уровне», «очень довольны результатом», «вино прекрасно зашло», «претензий нет, всё идеально», «превзошли ожидания», «прекрасная работа»

**Синонимы и выражения (полный список):**
- Деловая переписка: «благодарим за качественно выполненную работу», «результат полностью соответствует ожиданиям», «отмечаем высокое качество продукции», «руководство высоко оценило результат»
- Чаты / мессенджеры (разговорный стиль): «гостям очень понравилось» (дистрибуция), «вино на ура» (дистрибуция), «огонь!», «супер, всё чётко», «шикарно получилось», «топ»
- Сокращения и термины: «качество», «результат», «без замечаний»
- Устойчивые конструкции / маркеры: «очень понравилось / понравился / понравилась»; «отличное / прекрасное» + качество / результат; «благодарим за качественно»

**Похоже, но не это (анти-признаки):** «спасибо, получили» → нет сигнала; «Анна всегда быстро отвечает, спасибо» → `FEEDBACK_COMM_PRAISE`; «гостям понравилось, давайте ещё 10 коробок» → `ORDER_REQUESTED` (дистрибуция) + этот код.

**Пример (evidence):** «Хотим сказать спасибо за подборку на банкет — гостям очень понравилось, особенно Бароло.»
**Контрпример:** «Спасибо, документы получили» → вежливость, не похвала.

**Заметка для карточки:** Отметь, что именно понравилось клиенту; шаг — использовать как повод для следующего предложения или отзыва.

### `FEEDBACK_COMM_PRAISE` — Похвала работе менеджера и коммуникации

| Field | Value |
|---|---|
| Pack · block · family | base · E · account |
| Weight · class · kind · score rule | 2 · fyi · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · yes · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · review |
| Display profile | from weight (W1) |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule. Usual: none. |

**Определение:** Клиент хвалит работу нашего менеджера, скорость ответа, сопровождение и общение. Действие не требуется.

**Граница (не считается):** Похвала товару или результату — `FEEDBACK_QUALITY_PRAISE`. Обычное «спасибо за быстрый ответ» в конце деловой переписки — нет сигнала, если нет оценки работы. Похвала не закрывает жалобу.

**Признаки для промпта (≤ 8):** «спасибо за оперативность», «всегда на связи», «приятно с вами работать», «отличное сопровождение», «ваш менеджер — молодец», «быстро решили вопрос», «чёткая коммуникация», «благодарим за внимательное отношение»

**Синонимы и выражения (полный список):**
- Деловая переписка: «выражаем благодарность вашему менеджеру за профессиональное сопровождение», «отмечаем оперативность и внимательность», «с вами комфортно работать», «благодарим за слаженную работу команды»
- Чаты / мессенджеры (разговорный стиль): «вы лучшие, всегда на связи», «спасибо, что так быстро», «Мария — золото», «с вами легко»
- Сокращения и термины: «сервис», «сопровождение», «клиентский сервис», «персональный менеджер»
- Устойчивые конструкции / маркеры: «спасибо / благодарим за» + «оперативность / сопровождение / внимание»; «приятно / комфортно работать»

**Похоже, но не это (анти-признаки):** «спасибо за ответ» (формула вежливости) → нет сигнала; «вино отличное» → `FEEDBACK_QUALITY_PRAISE`; «наконец-то ответили» → `COMPLAINT_COMM` (упрёк).

**Пример (evidence):** «Отдельное спасибо вашему менеджеру — за выходные помог собрать срочный заказ, с вами очень комфортно работать.»
**Контрпример:** «Спасибо за ответ, хорошего дня» → вежливость, не оценка.

**Заметка для карточки:** Отметь, кого и за что похвалил клиент; шаг — передать благодарность сотруднику и руководителю.

### `FEEDBACK_PRICE_PRAISE` — Клиент подтвердил, что условия справедливые

| Field | Value |
|---|---|
| Pack · block · family | base · E · account |
| Weight · class · kind · score rule | 2 · fyi · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · yes · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · review |
| Display profile | from weight (W1) |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule. Usual: none; may be cited as evidence that the IN4COM risk «Конкурент предлагает дешевле» is cleared («клиент подтверждает наше предложение»). |

**Определение:** Клиент говорит, что наши цены или условия справедливые, выгодные, устраивают. Действие не требуется.

**Граница (не считается):** Согласие с КП как решение купить — `SALES_BOOKING_RECEIVED`. Нейтральное «цены получили» — нет сигнала. Ирония («ну и цены у вас, конечно») — `COMPLAINT_PRICE`.

**Признаки для промпта (≤ 8):** «цены адекватные», «условия устраивают», «хорошее соотношение цены и качества», «цены честные», «выгоднее, чем у других», «по цене всё ок», «справедливые условия», «довольны ценами»

**Синонимы и выражения (полный список):**
- Деловая переписка: «условия поставки нас полностью устраивают», «отмечаем конкурентный уровень цен», «ваше предложение выгоднее альтернатив», «соотношение цены и качества оптимальное»
- Чаты / мессенджеры (разговорный стиль): «по ценам норм», «цены огонь», «дешевле, чем у других, берём вас», «за эти деньги — супер»
- Сокращения и термины: «цена-качество», «конкурентные цены», «рыночный уровень»
- Устойчивые конструкции / маркеры: «устраивают» + «цены / условия»; «выгоднее, чем» + у других

**Похоже, но не это (анти-признаки):** «ну и цены у вас» → `COMPLAINT_PRICE`; «согласовали КП, запускайте» → `SALES_BOOKING_RECEIVED`; «прайс получили» → нет сигнала.

**Пример (evidence):** «Сравнили с двумя другими поставщиками — у вас самые адекватные условия, так что продолжаем работать.»
**Контрпример:** «Прайс получили, изучим» → нет оценки.

**Заметка для карточки:** Отметь, что клиент считает условия выгодными; шаг — сохранить как аргумент при будущих переговорах о цене.

### `THREAD_UNANSWERED_FOLLOWUP` — Повторные напоминания клиента остались без ответа

| Field | Value |
|---|---|
| Pack · block · family | base · E · complaint |
| Weight · class · kind · score rule | 3 · risk · derived · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | process |
| Stage (pack default) · IN4COM | parked · review |
| Display profile | from weight (W1) |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: our reply on the thread |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule. Usual: none. |

**Определение:** Клиент написал нам по одной теме два раза и больше, а мы не ответили. Вычисляется процессом; припаркован вместе с логикой тредов.

**Граница (не считается):** Если в напоминании есть упрёк, модель ставит `COMPLAINT_COMM` сама; этот код — только подсчёт повторов. Наши повторные письма клиенту — не этот код.

**Признаки для промпта:** — (not in the extraction prompt; emitted by process)

**Правило срабатывания:** RU: в теме (Topics: `topic`, sub-state `waiting_on_us`) ≥ 2 входящих сообщений клиента после нашего последнего ответа, и последнее входящее старше рабочего окна организации; учитываются все каналы. EN: on the topic (sub-state `waiting_on_us`) at least 2 inbound client messages after our last reply, the last one older than the org working window; all channels counted.

**Пример (evidence):** Клиент написал 10.11 и 11.11 «напомню про мой вопрос по отгрузке», на 12.11 ответа от нас нет.

**Заметка для карточки:** Укажи, сколько раз и с какого дня клиент ждёт ответа; шаг — ответить сегодня по существу.

---

## F · Встречи

| Code | Название (RU) | W | Class | Kind | Score rule | Effort | Asks us | Inbound only | Amount | Stage (pack) | IN4COM | Profile | Recipient | Family |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `MEETING_CANCEL` | Клиент отменил встречу без новой даты | 7 | risk | event | fixed | medium | — | yes | — | active | on | P6 | account | meeting |
| `MEETING_URGENT` | Клиент просит необычно скорую встречу (интерес) | 6 | chance | event | fixed | quick | yes | yes | — | active | on | P6 | account | meeting |
| `MEETING_URGENT_ISSUE` | Срочная встреча из-за нерешённой проблемы | 7 | risk | event | fixed | quick | — | yes | — | active | on | P6 | account | meeting |
| `MEETING_NEW_STAKEHOLDER` | На встрече новый участник со стороны клиента | 5 | chance | event | fixed | medium | — | yes | — | active | review | D4 | account | meeting |
| `MEETING_DELAYED` | Клиент предлагает встречу необычно далеко | 4 | risk | event | fixed | medium | yes | yes | — | active | review | D4 | account | meeting |
| `MEETING_SLOW` | Согласование встречи затягивается | 5 | risk | derived | fixed | medium | — | — | — | parked | review | D4 | account | meeting |
| `MEETING_KEY_MISSING` | На регулярной встрече нет ключевого участника | 5 | risk | derived | fixed | medium | — | — | — | parked | review | D4 | account | meeting |

Block F: 7 codes — 5 active, 2 parked.

Shared rule: a calendar reply without `.ics` («Принято:», «Отклонено:», «Под вопросом:») is handled by the deterministic gate (spec §5.2 gate 7), not by the LLM. «Отклонено:» alone is not `MEETING_CANCEL` unless the client cancels the meeting itself.

### `MEETING_CANCEL` — Клиент отменил встречу без новой даты

| Field | Value |
|---|---|
| Pack · block · family | base · F · meeting |
| Weight · class · kind · score rule | 7 · risk · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · yes · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · on |
| Display profile | from weight (P6) |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: — (a new agreed date makes it context) |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule. IN4COM: postponement event for the risk «Решение откладывается» (fires from the 2nd distinct postponement of the same decision with no new date and next step, Q24-3). Agency: risk «Снижение вовлечённости» (Maslov risk 21). |

**Определение:** Клиент отменяет назначенную встречу и не предлагает новую дату.

**Граница (не считается):** Перенос на конкретную новую дату — не этот код (если дата далеко — `MEETING_DELAYED`). Отмена с нашей стороны — не сигнал. Автоматический ответ календаря «Отклонено» без слов клиента — обрабатывает детерминированный фильтр; код ставить, только если ясно, что встреча отменена. Отмена дегустации в дистрибуции — этот код, если это встреча с клиентом.

**Признаки для промпта (≤ 8):** «встречу отменяем», «вынуждены отменить встречу», «давайте пока без встречи», «встреча не состоится», «отменим, потом вернёмся», «не получится встретиться, позже напишу», «снимаем встречу», «пока не до встречи»

**Синонимы и выражения (полный список):**
- Деловая переписка: «к сожалению, вынуждены отменить запланированную встречу», «встреча 14.11 не состоится, о новой дате сообщим дополнительно», «просим отменить совещание», «в текущей ситуации встречу проводить нецелесообразно»
- Чаты / мессенджеры (разговорный стиль): «завтра не получится, давайте потом», «отбой по встрече», «сорри, встречу снимаю», «пока не до этого, вернусь позже», «давайте без встречи, напишу»
- Сокращения и термины: «отмена встречи», «созвон отменяется», «слот освобождаю»
- Устойчивые конструкции / маркеры: «отменяем / отменить / не состоится» + встреча; «о новой дате сообщим» (без даты)

**Похоже, но не это (анти-признаки):** «давайте перенесём на четверг в 15:00» → нет этого кода (перенос с датой); «предлагаю встретиться в феврале» → `MEETING_DELAYED`; «Отклонено: Встреча по ассортименту» (автоответ календаря) → детерминированный фильтр, не модель.

**Пример (evidence):** «Завтрашнюю встречу вынуждены отменить, у нас сейчас реорганизация — о новой дате сообщим позже.»
**Контрпример:** «Завтра не успеваем, давайте перенесём на пятницу на 11:00» → перенос с новой датой.

**Заметка для карточки:** Укажи, какая встреча отменена и названную причину; шаги — уточнить причину, предложить конкретные варианты дат.

### `MEETING_URGENT` — Клиент просит необычно скорую встречу (интерес)

| Field | Value |
|---|---|
| Pack · block · family | base · F · meeting |
| Weight · class · kind · score rule | 6 · chance · event · fixed |
| Effort · asks us · inbound only · amount | quick · yes · yes · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · on |
| Display profile | from weight (P6) |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | until the requested meeting date (usually 1–5 days) |
| Deal effect | per org rule. Usual: none. |

**Определение:** Клиент хочет встретиться необычно скоро — сегодня, завтра, на этой неделе — из интереса: новая возможность, срочный проект, хочет быстро обсудить сотрудничество.

**Граница (не считается):** Срочная встреча из-за проблемы, ошибки или конфликта — `MEETING_URGENT_ISSUE`. Обычное приглашение на встречу через 1–3 недели — нет сигнала. В дистрибуции просьба о дегустации или обучении персонала — `TASTING_REQUESTED` (если ещё и срочно — оба кода).

**Признаки для промпта (≤ 8):** «можем встретиться сегодня?», «давайте завтра созвонимся», «срочно нужно обсудить новый проект», «на этой неделе обязательно встретиться», «подъедете сегодня?», «нужно увидеться как можно скорее», «есть интересная тема, давайте быстро обсудим», «можем завтра с утра?»

**Синонимы и выражения (полный список):**
- Деловая переписка: «предлагаем провести встречу в ближайшие дни», «хотели бы оперативно обсудить расширение сотрудничества», «просим о встрече на этой неделе в связи с открытием», «готовы встретиться завтра в любое удобное время»
- Чаты / мессенджеры (разговорный стиль): «можете сегодня заскочить?», «давайте завтра кофе», «го созвон через час», «надо срочно пообщаться, есть тема», «до пятницы встретимся?»
- Сокращения и термины: «созвон», «зум», «ВКС», «встреча на объекте», «срочно», «ASAP»
- Устойчивые конструкции / маркеры: «встретиться / созвониться» + «сегодня / завтра / на этой неделе / как можно скорее»; повод — интерес, новая задача

**Похоже, но не это (анти-признаки):** «срочно нужна встреча, у нас пропал товар с полки» → `MEETING_URGENT_ISSUE`; «давайте в конце месяца пересечёмся» → нет сигнала; «нужна дегустация для персонала до открытия» → `TASTING_REQUESTED` (дистрибуция).

**Пример (evidence):** «Открываем новую точку раньше плана — можете завтра подъехать и обсудить винную карту?»
**Контрпример:** «Завтра срочно нужна встреча: третья поставка подряд с ошибками» → проблема, `MEETING_URGENT_ISSUE`.

**Заметка для карточки:** Укажи повод и желаемый срок встречи; шаги — подтвердить время сегодня, подготовить материалы под повод.

### `MEETING_URGENT_ISSUE` — Срочная встреча из-за нерешённой проблемы

| Field | Value |
|---|---|
| Pack · block · family | base · F · meeting |
| Weight · class · kind · score rule | 7 · risk · event · fixed |
| Effort · asks us · inbound only · amount | quick · no · yes · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · on |
| Display profile | from weight (P6) |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: — |
| Relations | — in v204. Usually together with a `COMPLAINT_*` code. |
| Date gate | — |
| Relevance window | until the requested meeting date |
| Deal effect | per org rule. Usual: none; the underlying complaint carries the risk. |

**Определение:** Клиент хочет встретиться необычно скоро потому, что что-то не работает, не пришло или пошло не так. Повод — проблема, а не интерес.

**Граница (не считается):** Срочная встреча из интереса — `MEETING_URGENT`. Жалоба без просьбы о встрече — только `COMPLAINT_*`. Плановая встреча по итогам квартала — нет сигнала.

**Признаки для промпта (≤ 8):** «нужно срочно встретиться и разобраться», «давайте сегодня созвонимся по проблеме», «ситуация критическая, нужна встреча», «приезжайте, будем разбираться», «срочно собираемся по поставкам», «нужен разговор с руководителем сегодня», «так дальше нельзя, давайте встретимся», «надо обсудить, что происходит»

**Синонимы и выражения (полный список):**
- Деловая переписка: «просим о срочной встрече в связи с систематическими срывами поставок», «предлагаем незамедлительно провести совещание для урегулирования ситуации», «требуется встреча с ответственными лицами до конца недели», «прошу организовать встречу с вашим руководством в ближайшее время»
- Чаты / мессенджеры (разговорный стиль): «приезжайте, будем разбираться», «надо срочно созвониться, у нас ЧП», «сегодня нужен созвон, всё сломалось», «давайте встретимся, пока я не пошла к директору»
- Сокращения и термины: «разбор», «совещание», «ЧП», «инцидент», «срочно»
- Устойчивые конструкции / маркеры: «срочно / сегодня / немедленно» + «встретиться / созвониться» + «разобраться / по проблеме»

**Похоже, но не это (анти-признаки):** «давайте быстро встретимся, есть новый проект» → `MEETING_URGENT`; «опять задержка» без просьбы о встрече → `COMPLAINT_TIMING`; «встреча по итогам года в декабре» → нет сигнала.

**Пример (evidence):** «У нас третью неделю не сходятся остатки по вашим поставкам — предлагаю завтра встретиться и разобраться на месте.»
**Контрпример:** «Есть идея по новому меню, давайте завтра обсудим» → интерес, `MEETING_URGENT`.

**Заметка для карточки:** Укажи проблему и срок встречи; шаги — подтвердить встречу, собрать факты по проблеме, прийти с планом решения.

### `MEETING_NEW_STAKEHOLDER` — На встрече новый участник со стороны клиента

| Field | Value |
|---|---|
| Pack · block · family | base · F · meeting |
| Weight · class · kind · score rule | 5 · chance · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · yes · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · review |
| Display profile | from weight (D4) |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | until the meeting date |
| Deal effect | per org rule. Usual: in-stage context (people on the deal), no stage move (Maslov §3.1). |

**Определение:** Клиент приглашает на встречу или приводит на неё человека со своей стороны, которого раньше не было в общении (руководитель, закупщик, финансист, шеф-повар).

**Граница (не считается):** Новый человек в переписке без встречи — `CONTACT_NEW_KNOWN_ORG` или `CONTACT_NEW_DECISION_MAKER`. Участник с нашей стороны — нет сигнала. Новый адрес в копии без роли и без встречи — нет сигнала.

**Признаки для промпта (≤ 8):** «на встрече будет также наш директор», «подключаю к встрече», «пригласила на встречу финансового директора», «с нашей стороны добавится», «приду с коллегой из закупок», «к созвону присоединится», «будет новый управляющий», «добавила в приглашение»

**Синонимы и выражения (полный список):**
- Деловая переписка: «на встрече со стороны компании также будет присутствовать коммерческий директор», «добавила в приглашение руководителя отдела закупок», «к обсуждению присоединится наш финансовый директор», «прошу учесть, что на встрече будет новый управляющий»
- Чаты / мессенджеры (разговорный стиль): «возьму с собой шефа» (дистрибуция: шеф-повар), «будет наш новый бар-менеджер» (дистрибуция), «подтяну на созвон директора», «с нами ещё Олег из закупок»
- Сокращения и термины: «участники встречи», «приглашение», «ЛПР», «ФД», «КД», «закупщик»
- Устойчивые конструкции / маркеры: «на встрече будет / присоединится / подключу» + новый человек с ролью

**Похоже, но не это (анти-признаки):** «теперь по заказам пишите Анне» → `CONTACT_NEW_KNOWN_ORG`; «с нашей стороны будет руководитель направления» (наше письмо) → нет сигнала; новый адрес в копии без встречи → нет сигнала.

**Пример (evidence):** «На встрече в четверг с нашей стороны будет также новый управляющий сетью — хочет лично познакомиться с поставщиками.»
**Контрпример:** «Встреча в четверг в том же составе» → новых участников нет.

**Заметка для карточки:** Укажи нового участника и его роль; шаги — уточнить его интересы, подготовить материалы под его роль.

### `MEETING_DELAYED` — Клиент предлагает встречу необычно далеко

| Field | Value |
|---|---|
| Pack · block · family | base · F · meeting |
| Weight · class · kind · score rule | 4 · risk · event · fixed |
| Effort · asks us · inbound only · amount | medium · yes · yes · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · review |
| Display profile | from weight (D4) |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | { fact: `proposedMeetingDate`, test: more than N days after the item, setting: `cards.meetingDelayedMinDays`, window: 28 } |
| Relevance window | default |
| Deal effect | per org rule. IN4COM: postponement event for the risk «Решение откладывается» (2nd distinct postponement, Q24-3). |

**Определение:** Клиент предлагает встречу на дату, которая необычно далеко (больше 4 недель от письма). Модель ставит код, когда клиент предлагает встречу и заполнен `proposedMeetingDate`; далеко ли это, решает система.

**Граница (не считается):** Модель не оценивает «далеко ли»: при предложенной встрече она заполняет дату, сервер отбрасывает код, если дата ближе окна. Отмена без даты — `MEETING_CANCEL`. Встречу далеко предлагаем мы — не сигнал. Встреча по условию без даты («после бюджетного комитета») — не этот код (агентский `PROSPECT_FOLLOWUP_AGREED`).

**Признаки для промпта (≤ 8):** «давайте встретимся в январе», «вернёмся к разговору после праздников», «не раньше следующего квартала», «ближе к весне», «после 15 января», «в следующем месяце не получится, давайте в феврале», «предлагаю перенести на начало года», «окно есть только в конце декабря»

**Синонимы и выражения (полный список):**
- Деловая переписка: «предлагаем провести встречу в первой половине января», «готовы обсудить после утверждения бюджета в феврале», «ближайшая возможность — вторая половина декабря», «прошу перенести встречу на следующий квартал»
- Чаты / мессенджеры (разговорный стиль): «давайте после новогодних», «до весны вряд ли», «в декабре завал, давайте в январе», «напишите мне в феврале, встретимся»
- Сокращения и термины: «Q1», «в 1 кв.», «после НГ», «после праздников»
- Устойчивые конструкции / маркеры: «встретиться / обсудить / вернуться» + месяц или квартал далеко от даты письма; «не раньше» + дата

**Похоже, но не это (анти-признаки):** «давайте в следующий вторник» → нет сигнала (сервер отбросит); «вернёмся после бюджетного комитета» без даты → нет этого кода; «встречу отменяем, о дате сообщим» → `MEETING_CANCEL`.

**Пример (evidence):** «Сейчас сезон, раньше не получится — предлагаю встретиться и обсудить ассортимент после 20 января.»
**Контрпример:** «Давайте встретимся в среду на следующей неделе» → дата близко, сервер код отбросит.

**Заметка для карточки:** Укажи предложенную дату и причину; шаги — попробовать договориться о коротком созвоне раньше, держать контакт до встречи.

### `MEETING_SLOW` — Согласование встречи затягивается

| Field | Value |
|---|---|
| Pack · block · family | base · F · meeting |
| Weight · class · kind · score rule | 5 · risk · derived · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | process |
| Stage (pack default) · IN4COM | parked · review |
| Display profile | from weight (D4) |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: an agreed meeting date on the topic |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule. Usual: none; may count toward «Решение откладывается» only through the postponement rule (Q24-3). |

**Определение:** По теме несколько отмен или переносов встречи, а дата так и не найдена. Вычисляется процессом; припаркован вместе с логикой тредов.

**Граница (не считается):** Одна отмена — `MEETING_CANCEL`. Одна далёкая дата — `MEETING_DELAYED`. Переносы с нашей стороны не считаются.

**Признаки для промпта:** — (not in the extraction prompt; emitted by process)

**Правило срабатывания:** RU: в теме ≥ 2 отмен или переносов встречи со стороны клиента (`MEETING_CANCEL`, переносы с новой датой, которые потом снова сорваны) и нет согласованной будущей даты; учитываются все каналы и календарь. EN: on the topic at least 2 client-side cancellations or reschedules and no agreed future date; all channels and the calendar counted.

**Пример (evidence):** Клиент дважды переносил встречу (05.11 и 12.11) и 19.11 написал «давайте позже», новой даты нет.

**Заметка для карточки:** Укажи, сколько раз переносили и с какого числа нет даты; шаг — предложить два конкретных слота или короткий созвон.

### `MEETING_KEY_MISSING` — На регулярной встрече нет ключевого участника

| Field | Value |
|---|---|
| Pack · block · family | base · F · meeting |
| Weight · class · kind · score rule | 5 · risk · derived · fixed |
| Effort · asks us · inbound only · amount | medium · no · no · no |
| Emitted by | process |
| Stage (pack default) · IN4COM | parked · review |
| Display profile | from weight (D4) |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: the main contact attends again |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule. Usual: none. |

**Определение:** Известный основной контакт клиента больше не в списке участников регулярной встречи. Нужен источник календаря; припаркован.

**Граница (не считается):** Человек сообщил об уходе — `CONTACT_LEAVING`. Человек в отпуске с автоответом — `CONTACT_OOO`. Разовое отсутствие на одной встрече без повтора — нет сигнала.

**Признаки для промпта:** — (not in the extraction prompt; emitted by process)

**Правило срабатывания:** RU: у клиента есть регулярная встреча в календаре; основной контакт (по CRM) был участником прошлых встреч и отсутствует в списке участников последних двух встреч подряд; нет `CONTACT_OOO` на эти даты. EN: a recurring calendar meeting exists; the CRM main contact attended before and is missing from the last two consecutive attendee lists; no `CONTACT_OOO` for those dates.

**Пример (evidence):** Ежемесячная встреча с сетью: закупщица была на всех встречах до октября, в ноябре и декабре её нет в приглашении.

**Заметка для карточки:** Укажи, кто пропал из встреч и с какого времени; шаг — уточнить у клиента, кто теперь отвечает за вопрос.

---

## G · Новые контакты

| Code | Название (RU) | W | Class | Kind | Score rule | Effort | Asks us | Inbound only | Amount | Stage (pack) | IN4COM | Profile | Recipient | Family |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `CONTACT_LEAVING` | Контакт уходит из компании | 7 | risk | event | fixed | medium | — | yes | — | active | on | P6 | account | contact |
| `CONTACT_NEW_DECISION_MAKER` | Появился новый человек, принимающий решения (ЛПР) | 6 | chance | event | fixed | medium | — | yes | — | active | on | P6 | account | contact |
| `CONTACT_NEW_KNOWN_ORG` | Новый контакт у действующего клиента | 4 | chance | event | fixed | medium | — | yes | — | active | on | D4 | account | contact |
| `CONTACT_OOO` | Контакт отсутствует и указал заместителя | 4 | risk | event | fixed | medium | — | yes | — | active | on | D4 | account | contact |
| `CONTACT_BIRTHDAY` | День рождения контакта | 8 | chance | event | fixed | quick | — | — | — | active | on | P8 | account | contact |

Block G: 5 codes — 5 active. `CONTACT_BIRTHDAY` is a PROCESS code (added 2026-11-26, migration `0055`; never in the extraction prompt).

### `CONTACT_LEAVING` — Контакт уходит из компании

| Field | Value |
|---|---|
| Pack · block · family | base · G · contact |
| Weight · class · kind · score rule | 7 · risk · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · yes · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · on |
| Display profile | from weight (P6) |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: — |
| Relations | — in v204. Agency: the old company side is judged with `ACCOUNT_SPONSOR_SUPPORT_LOST`; the move itself is `PROSPECT_CONTACT_MOVED` (Q24-2). |
| Date gate | — (the last working day goes to `facts.deadlines`, owner = them) |
| Relevance window | until the last working day, then default |
| Deal effect | per org rule. IN4COM: risk trigger **«Смена закупщика / сомелье»** — only when the person is linked to the deal (`deal_contact`) and no new contact is confirmed. Agency: «Потеря ключевого контакта» (Q24-2). |

**Определение:** Контакт сообщает, что уходит из компании клиента (прощальное письмо, «последний рабочий день»), или клиент объявляет об этом.

**Граница (не считается):** Отпуск, больничный, командировка с возвратом — `CONTACT_OOO`. Смена роли внутри той же компании — не уход (может быть `CONTACT_NEW_DECISION_MAKER` для нового человека). Автоответ «больше не работает, пишите на» без прощального письма — этот код (это и есть объявление). Наш сотрудник уходит — блок J, не этот код.

**Признаки для промпта (≤ 8):** «я больше не работаю в компании», «последний рабочий день», «покидаю компанию», «ухожу из компании», «по всем вопросам теперь обращайтесь к», «перехожу в другую компанию», «больше не сотрудник», «новый сомелье»

**Синонимы и выражения (полный список):**
- Деловая переписка: «сообщаю, что с 15.11 я завершаю работу в компании», «это мой последний рабочий день», «благодарю за сотрудничество, дальше ваш вопрос ведёт», «Иванова И. И. больше не является сотрудником компании», «уволилась, письма не читаются»
- Чаты / мессенджеры (разговорный стиль): «я ухожу, всем спасибо», «я больше тут не работаю», «теперь пишите Свете, я ушла», «у нас новый сомелье, старый ушёл» (дистрибуция), «новый закупщик вместо меня» (дистрибуция)
- Сокращения и термины: «увольнение», «последний день», «передача дел», «преемник»
- Устойчивые конструкции / маркеры: «больше не работаю / не является сотрудником»; «последний рабочий день» + дата; «по всем вопросам обращайтесь к» + новый человек (вместе с уходом)

**Похоже, но не это (анти-признаки):** «в отпуске до 20.11, по срочным — к коллеге» → `CONTACT_OOO`; «перешла в отдел маркетинга, закупки теперь ведёт Олег» → не уход из компании (`CONTACT_NEW_DECISION_MAKER` / `CONTACT_NEW_KNOWN_ORG` для Олега); «наш менеджер уходит» (письмо коллеги) → нет этого кода.

**Пример (evidence):** «Коллеги, 22 ноября мой последний рабочий день в компании, дела по закупкам вина передаю Ольге Смирновой.»
**Контрпример:** «Я в отпуске до 25 ноября, по срочным вопросам — Ольга Смирнова» → временное отсутствие, `CONTACT_OOO`.

**Заметка для карточки:** Укажи, кто уходит, когда и кому передаёт дела; шаги — поблагодарить, познакомиться с преемником, подтвердить текущие договорённости.

### `CONTACT_NEW_DECISION_MAKER` — Появился новый человек, принимающий решения (ЛПР)

| Field | Value |
|---|---|
| Pack · block · family | base · G · contact |
| Weight · class · kind · score rule | 6 · chance · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · yes · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · on |
| Display profile | from weight (P6) |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: — |
| Relations | — in v204. Agency: risk «Смена руководства клиента» (Maslov risk 5). |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule. IN4COM: risk trigger **«Смена закупщика / сомелье»** (person linked to the deal; clears when the new person confirms the current terms); otherwise in-stage context (people). |

**Определение:** В общении впервые появляется человек со стороны клиента, который принимает решения или утверждает закупку: новый директор, руководитель закупок, управляющий, шеф-сомелье, бренд-менеджер сети.

**Граница (не считается):** Новый рядовой контакт (менеджер, бухгалтер, кладовщик) — `CONTACT_NEW_KNOWN_ORG`. Новый участник только на встрече — `MEETING_NEW_STAKEHOLDER` (может быть вместе). Смена руководства из новостей без появления человека в переписке — блок H. Уход прежнего ЛПР — `CONTACT_LEAVING`.

**Признаки для промпта (≤ 8):** «я новый директор по закупкам», «новый закупщик», «новый сомелье», «теперь решения по ассортименту принимаю я», «вступил в должность», «назначена руководителем», «будет утверждать закупки», «новый управляющий»

**Синонимы и выражения (полный список):**
- Деловая переписка: «представляюсь: с 01.11 я назначен коммерческим директором», «теперь вопросы закупки алкоголя курирую я», «прошу направлять предложения на моё имя», «новый руководитель отдела закупок — Петров П. П.», «согласование договоров теперь у финансового директора»
- Чаты / мессенджеры (разговорный стиль): «привет, я новый шеф-сомелье» (дистрибуция), «теперь карту согласовываю я» (дистрибуция), «я тут новый управляющий, давайте знакомиться», «закупки теперь на мне»
- Сокращения и термины: «ЛПР», «ГД», «КД», «ФД», «закупщик», «байер», «категорийный менеджер», «шеф-сомелье», «бар-менеджер»
- Устойчивые конструкции / маркеры: «я новый / назначен(а)» + руководящая роль; «теперь решения / согласование» + «за мной / у меня»

**Похоже, но не это (анти-признаки):** «по накладным теперь пишите Анне из бухгалтерии» → `CONTACT_NEW_KNOWN_ORG`; «у компании новый CEO» (новость) → блок H; «на встрече будет наш новый директор» → `MEETING_NEW_STAKEHOLDER` (+ этот код, если роль ЛПР ясна).

**Пример (evidence):** «Добрый день! Я новый директор по закупкам сети, с декабря все вопросы по винному ассортименту согласовываются через меня.»
**Контрпример:** «Теперь накладные и акты присылайте нашему новому бухгалтеру» → не ЛПР, `CONTACT_NEW_KNOWN_ORG`.

**Заметка для карточки:** Укажи нового ЛПР и его зону решений; шаги — назначить знакомство, рассказать о текущих условиях, узнать его приоритеты.

### `CONTACT_NEW_KNOWN_ORG` — Новый контакт у действующего клиента

| Field | Value |
|---|---|
| Pack · block · family | base · G · contact |
| Weight · class · kind · score rule | 4 · chance · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · yes · no |
| Emitted by | both |
| Stage (pack default) · IN4COM | active · on |
| Display profile | from weight (D4) |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: — |
| Relations | — |
| Date gate | — |
| Relevance window | default |
| Deal effect | per org rule. Usual: in-stage context (people). |

**Определение:** У существующего клиента появляется новый контактный человек: его представляют или он сам пишет впервые (менеджер, бухгалтер, логист, новый сотрудник закупок).

**Граница (не считается):** Новый человек с правом решения — `CONTACT_NEW_DECISION_MAKER`. Человек из новой компании (не клиента) — не этот код. Временный заместитель из автоответа — `CONTACT_OOO`. Технические адреса (noreply, рассылки) — нет сигнала.

**Признаки для промпта (≤ 8):** «теперь по заказам пишите», «познакомьтесь, это наш новый менеджер», «добавляю в переписку коллегу», «я новый сотрудник отдела закупок», «буду вести ваши поставки», «по документам теперь отвечает», «пишу вам впервые», «новый закупщик»

**Синонимы и выражения (полный список):**
- Деловая переписка: «прошу направлять заявки на адрес нового сотрудника», «представляю нового менеджера по работе с поставщиками», «с сегодняшнего дня ваш контакт по логистике — Сидорова А. В.», «добавляю в копию нашего бухгалтера»
- Чаты / мессенджеры (разговорный стиль): «добавила в чат Катю, она теперь заказы делает», «я новенькая, буду заказывать вино» (дистрибуция), «пишите теперь мне по накладным»
- Сокращения и термины: «контактное лицо», «ответственный», «новый сотрудник», «в копии»
- Устойчивые конструкции / маркеры: «теперь по» + вопрос + «пишите / обращайтесь к» + человек; «знакомьтесь / представляю» + новый сотрудник

**Похоже, но не это (анти-признаки):** «я новый коммерческий директор» → `CONTACT_NEW_DECISION_MAKER`; «в отпуске, замещает Ирина» → `CONTACT_OOO`; новый адрес в копии без представления → нет сигнала.

**Пример (evidence):** «Знакомьтесь, это Екатерина, наш новый менеджер по закупкам — заявки на поставку теперь будет присылать она.»
**Контрпример:** «Я в отпуске, по срочным вопросам — Екатерина» → временный заместитель, `CONTACT_OOO`.

**Заметка для карточки:** Укажи нового контакта и его участок; шаги — добавить контакт в CRM, поприветствовать, отправить нужные контакты с нашей стороны.

### `CONTACT_OOO` — Контакт отсутствует и указал заместителя

| Field | Value |
|---|---|
| Pack · block · family | base · G · contact |
| Weight · class · kind · score rule | 4 · risk · event · fixed |
| Effort · asks us · inbound only · amount | medium · no · yes · no |
| Emitted by | both (mostly the deterministic out-of-office detector, spec §5.2 gate 6; the LLM only for free-text notices) |
| Stage (pack default) · IN4COM | active · on |
| Display profile | from weight (D4) |
| Recipient role | account |
| Closes / closed by | closes: — · closed by: — (expires on the return date) |
| Relations | — |
| Date gate | — (return date and deputy go to facts) |
| Relevance window | until the return date |
| Deal effect | per org rule. Usual: none. |

**Определение:** Автоответ или сообщение контакта о временном отсутствии (отпуск, больничный, командировка), обычно с датой возвращения и заместителем.

**Граница (не считается):** Уход из компании — `CONTACT_LEAVING`. Новый постоянный контакт — `CONTACT_NEW_KNOWN_ORG`. Наш сотрудник в отпуске — не этот код. Автоответ «письмо получено, ответим в течение дня» без отсутствия — нет сигнала.

**Признаки для промпта (≤ 8):** «нахожусь в отпуске до», «буду на связи с», «по срочным вопросам обращайтесь к», «нет в офисе», «на больничном», «в командировке до», «автоответ», «вернусь»

**Синонимы и выражения (полный список):**
- Деловая переписка: «я нахожусь в отпуске с 10.11 по 24.11, доступ к почте ограничен», «по срочным вопросам прошу обращаться к», «в настоящее время отсутствую в офисе», «на период моего отсутствия меня замещает», «Автоматический ответ: Нет на месте»
- Чаты / мессенджеры (разговорный стиль): «я в отпуске до понедельника, пишите Оле», «на больничном, отвечу позже», «я в командировке, по заказам — к Диме», «до 20-го не на связи»
- Сокращения и термины: «автоответ», «OOO», «Out of Office», «замещает», «и. о.», «ВРИО»
- Устойчивые конструкции / маркеры: «в отпуске / на больничном / в командировке» + «до» + дата; «по срочным вопросам» + «к» + человек; тема «Автоответ», «Автоматический ответ», «Нет на месте»

**Похоже, но не это (анти-признаки):** «я больше не работаю в компании» → `CONTACT_LEAVING`; «ваше обращение зарегистрировано, ответим в течение 24 часов» → нет сигнала; «наш менеджер в отпуске» (наше письмо) → нет сигнала.

**Пример (evidence):** «Я в отпуске до 24 ноября, по срочным вопросам закупок обращайтесь к Ольге Смирновой, o.smirnova@restoran.ru.»
**Контрпример:** «Спасибо за письмо, ваше обращение принято в работу» → автоответ без отсутствия.

**Заметка для карточки:** Укажи дату возврата и заместителя; шаг — срочные вопросы вести через заместителя, остальные — после возврата.

---

### `CONTACT_BIRTHDAY` — День рождения контакта

| Field | Value |
|---|---|
| Pack · block · family | base · G · contact |
| Weight · class · kind · score rule | 8 · chance · event · fixed |
| Effort · asks us · inbound only · amount | quick · no · no · no |
| Emitted by | process — the CRM check `contact_birthday` (group «Контакты», `src/server/topics/checks/contacts.ts`), never the LLM |
| Stage (pack default) · IN4COM | active · on |
| Display profile | from weight (P8 → list «Сейчас», no daily P6 limit) |
| Recipient role | account (topic owner = the company's «Ответственный»; a contact without a company → every member) |
| Closes / closed by | closes: — · closed by: the check itself the next day (B5, «День рождения прошёл») |
| Relations | — |
| Date gate | — |
| Relevance window | 1 day |
| Deal effect | none |

Added 2026-11-26 (tester request «Поднимать карточку со срочностью „Сейчас“ в день рождения контакта»).

**Определение:** Сегодня (в часовом поясе организации) день рождения контакта: дата из поля «День рождения» карточки контакта (`contact.birthday`).

**Граница (не считается):** Упоминание праздника или дня рождения в переписке — не этот код (код только по полю карточки). Удалённые, заблокированные и объединённые контакты — нет сигнала.

**Правило срабатывания:** RU: проверка раз в день (07:00 по времени организации); сегодня совпадают день и месяц поля «День рождения» (29 февраля в невисокосный год — 28 февраля); одна тема на контакт и год (ключ `contact:<id>:birthday:<год>`); на следующий день условие снимается и тема закрывается. EN: daily check; today matches the day and month of the field (29 Feb → 28 Feb in a non-leap year); one topic per contact and year; cleared the next day.

**Пример (evidence):** «Иван Петров: день рождения сегодня (26.11); исполняется 45 лет» (круглая дата — «(юбилей)»).

**Заметка для карточки:** Напомни поздравить контакт с днём рождения сегодня; назови компанию и, если известно, сколько лет исполняется (круглая дата — юбилей). Шаги — позвонить или написать лично, при необходимости отправить подарок или открытку.

---

## Retired codes mapping into blocks A–G

v204 (and Maslov appendix B) retired these codes on 2026-09-25. The server maps a retired code to its successor before scoring (spec §5.4 step 1); a code with no successor is dropped. Old rows may still carry them. Do not reintroduce them as new codes.

| Retired code | Successor (v204) | Block | Note |
|---|---|---|---|
| `SALES_ORDER_CONFIRM` | `SALES_BOOKING_RECEIVED` | A | mapped |
| `SIGNAL_TENDER` | `SALES_TENDER_INVITATION` | A (was H) | mapped |
| `COMPLAINT_ERROR` | `COMPLAINT_QUALITY` | E | mapped (merged into quality) |
| `SALES_CONCEPT` | — | A | dropped; the meaning lives in `SALES_MATERIAL_REQUESTED` (no automatic mapping) |
| `SALES_MOCKUP` | — | A | dropped; meaning in `SALES_MATERIAL_REQUESTED` (no automatic mapping) |
| `SALES_PRESENTATION` | — | A | dropped; meaning in `SALES_MATERIAL_REQUESTED` (no automatic mapping) |
| `CONTRACT_LICENSE` | — | B | dropped |
| `CONTRACT_SLA` | — | B | dropped |
| `DELIVERY_REPORT` | — | C | dropped; the request side is `DELIVERY_REPORT_REQUESTED` |
| `DELIVERY_CONFIRM` | — | C | dropped |
| `DELIVERY_ACCEPTANCE` | — | C | dropped; agency pack proposes `DELIVERY_ACCEPTANCE_GRANTED` / `_WITHHELD` |

---

## Open points

1. **Inbound-only flags are inferred.** v204 gives only the total (38 codes, all blocks), not the per-code flag. This file marks 37 codes in A–G as inbound only (every client-authored event; not state, watchdog, derived, B-block or `INVOICE_*` codes). With the two block-N supplier codes that is 39, one more than v204. Recommendation: read the flag per code from the Truffalo DB dictionary before the seed load; until then use these values.
2. **No state code for "price list sent", "material sent" and "report sent".** `SALES_PRICE_NO_RESPONSE`, `SALES_MATERIAL_NO_RESPONSE` and `DELIVERY_REPORT_OPEN` need a "we sent it" fact, and `SALES_PRICE_REQUEST`, `SALES_MATERIAL_REQUESTED`, `DELIVERY_REPORT_REQUESTED` have no closing code. Recommendation: let `SALES_OFFER_SENT` also close `SALES_PRICE_REQUEST` and `SALES_MATERIAL_REQUESTED` when our reply carries the price list / material, or add one generic state code later (`SALES_MATERIAL_SENT` / `DELIVERY_REPORT_SENT`). Not blocking: all three watchdogs are onHold.
3. **No complaint-closing code in base.** `COMPLAINT_*` cards can only expire or be closed by hand. Maslov proposes `COMPLAINT_RESOLUTION_CONFIRMED` (agency pack, weight 3, S1). Recommendation: move it to `base` so IN4COM can close complaints and clear «Повторные жалобы».
4. **Overlap with the distribution pack (IN4COM).** `SALES_ORDER_CONFIRMATION_REQUESTED` / `_SENT` / `_OPEN` duplicate the `ORDER_REQUESTED` → `ORDER_CONFIRMED` flow; `COMPLAINT_QUANTITY` overlaps `DELIVERY_DISCREPANCY` (недовложение); `SALES_RENEGOTIATION` overlaps `PAYMENT_TERMS_REQUEST` (отсрочка); `INVOICE_OVERDUE` cue «акт сверки показывает долг» touches `RECONCILIATION_REQUESTED`. The boundaries above split them. Recommendation for IN4COM: `SALES_ORDER_CONFIRMATION_*` → off; keep `COMPLAINT_QUANTITY` on with the narrowed boundary; confirm in the IN4COM review (04 §3).
5. **`SALES_NEW_DEMAND` for IN4COM** is `review`: listings and new venues have their own distribution codes. Recommendation: on, with the boundary above (new category or much more volume of an existing client), recipient `account`.
6. **Block C for IN4COM.** 04 "Proposed off" names "block C delivery reports". This file sets `DELIVERY_REPORT_REQUESTED` / `_OPEN` = off and `DELIVERY_PROTOCOL` / `THREAD_DEADLINE_NEAR` = review. Recommendation: `DELIVERY_PROTOCOL` off for IN4COM too (weight 2, low value).
7. **`COMPLAINT_TIMING` vs `COMPLAINT_COMM`.** v204 puts "response time" under TIMING and "keine Antwort / warte seit Tagen" under COMM. This file splits by object: a late promised result, delivery, document or dated answer → TIMING; no reply or no reach at all → COMM. Recommendation: keep this split and test it in the golden set.
8. **Recipients.** Maslov roles are kept as pack defaults (`opportunity` for most A codes). The IN4COM draft routes to `sales` (= `account`). `CONTRACT_COMPLIANCE_DECLARATION` has no Maslov row; `account` is used. Recommendation: per-org override for IN4COM when functional roles arrive (Q33); no change to the pack default.
9. **`CONTRACT_NDA` effort.** v204 says "a confirmation, not a task" and has no effort, but sets asks us = yes; Maslov proposes medium. This file keeps medium and asks us = yes per the rules. Recommendation: effort quick, or asks us = no, in a later taxonomy version.
10. **`SALES_TENDER_INVITATION` and `CONTRACT_TERMINATED` at P8** for IN4COM match 04 §3 question 3 (always «Сейчас»); no override needed.

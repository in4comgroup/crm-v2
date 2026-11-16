# Custom deal funnel — specification

Status: **decided 2026-11-15** (Q1–Q13, see [02-open-questions.md](02-open-questions.md) § Decisions; Q4 and Q10 changed); **built 2026-11-15** (see [03-development-plan.md](03-development-plan.md) § Status). Questions: [02-open-questions.md](02-open-questions.md). Plan: [03-development-plan.md](03-development-plan.md). Source: `Описание требований.docx` (this folder).

Related: topics spec [../topics/01-specification.md](../topics/01-specification.md) §9.1–§9.5 (deal bridge, stage rules, deal state, risks, forecast), [../topics/10-deal-status-from-topics.md](../topics/10-deal-status-from-topics.md), `src/app/AGENTS.md` § "Deals" / "Pre-pipeline stage + «Настройки стадий»".

## 1. Requirements (from the source document)

The funnel tracks individual **commercial opportunities**: a new client, a significant additional order of an existing client, a repeated competition for the current contract. Before the funnel is **area 0 «Контакт до запроса»** (companies, people, relationship history); early contacts and hypotheses are never in the money forecast. The first active stage is «Новая возможность» — a concrete task or selection the org decided to take part in; an introduction, general interest or the org's own sales idea stays in area 0.

| # | Stage (CRM) | What it combines | Entry condition | Signals (plain language) |
|---|---|---|---|---|
| 0 | **Контакт до запроса** (area 0) | Work with a target company: people map, touches before an active opportunity | A company or a person is known; there may be no request and no sales decision. A relationship area, NOT a deal stage | Introduction, a reply to a mail, an event, a known person moving to another company; news / public mention as a reason to contact. Context, need hypothesis, relationship owner and next step are kept |
| 1 | **Новая возможность** | A concrete need, request or a suitable procurement; first assessment and **go / no-go = the condition to enter the pipeline** | The client has a concrete task, a personal invitation, or a suitable procurement; the org decided **go** | The client described a task, invited to a selection or announced a tender with a clear subject. The signal is stored at once; after the go decision new biz creates the linked opportunity. Not yet a creative round, not yet in the forecast |
| 2 | **Запрошены материалы или решение** | Qualification of the org and the request for a solution | The client asks for materials to assess the org, or for a proposal on a concrete task | Cases, questionnaires, documents or an RFI within a selection; a brief or RFP asking for an approach, concept, strategy or test task. A general «send your cases» without a task stays a touch in area 0 |
| 3 | **Финальный выбор** | Short list and final terms | The client confirmed the next round, or — after reviewing the solution — discusses the current terms | Short list / final confirmed; updated estimate requested; scope, price and procurement terms discussed after the solution. An early budget question alone does NOT move the stage |
| 4 | **Выбраны** | Oral choice and official win | The client said explicitly that the org is chosen; the commitment to order is not formalised yet | A message about the choice from an authorised person, or an official win notice. Praise of the solution or a guess of a client employee is NOT a choice |
| 5 | **Заказ подтверждён** | Confirmed order and hand-over to delivery | The client accepted the commitment to order the agreed work | A contract or amendment signed, a binding order placed, an offer accepted. A win without a confirmed order stays at 4. Payment is a separate fact |

**Rules** (source § «Правила работы»):

| # | Rule |
|---|---|
| W1 | **Entry**: the client's task signal is stored at once, even before the assessment. The go decision is taken by the senior team (with new biz and the future pitch lead) by fit, chances and resources. Only after **go** the opportunity enters the active pipeline. A **no-go** is kept in the history with a reason. The internal decision is an entry filter, not a stage and not a proof of client interest |
| W2 | **Automatic moves**: after entry, the stage changes only by a **confirmed client action found in communications**. Our proposal sent and internal tasks never move the stage. With an RFP already received or an order confirmed at once, the system may set that stage and skip the steps in between. Rework alone never moves the opportunity back |
| W3 | **In-stage events**: briefing, meeting the team, an invitation to present, comments, changed requirements and dates are kept as signals and tasks (no stage change). A tender announcement opens the subject history; the participation happens later (preparing and presenting the solution, price discussion) |
| W4 | **Outcomes**: a confirmed loss or cancellation closes the opportunity with a reason. An explicit client pause is tracked separately; **silence is not a loss**. The org's decision to stop is an internal outcome |
| W5 | **Forecast**: area 0 and the early stages are NOT in the money forecast. From stage 3 the person in charge uses the current amount and an **expert probability** after the solution and price were discussed; a short list without a current price is not enough. The director's upsell plan, the budget from the brief and the forecast of a concrete opportunity are kept **separately, never double-counted**. Order confirmation and receiving money are different events |

## 2. What exists today (check of 2026-11-15)

| Area | Today | Gap |
|---|---|---|
| Stages | `deal_funnel_stage`: system set (Qualification 0.05 … Negotiations 0.8, Closed 1.0, Rejected 0.0) or org-owned copies; area 0 = `is_pre_pipeline` («Контакт до запроса», out of forecast, never an engine target); «Настройки стадий» (owner): display name, hide, stage norm days. Won / lost = stages named «Closed» / «Rejected» | No stage meaning, description, entry condition, signals hint; no add / delete / reorder; forecast = Σ value × stage probability for every active deal — no «out of forecast» stages, no expert probability |
| IN4COM today | Area 0 «Контакты» + Qualification, Discovery, Pilot, Proposal, Negotiations, Closed, Rejected; deal types `new_location`, `listing`, `tender`, `supply_agreement`, `renewal`; stage rules copied from the old distribution templates (LISTING_OPPORTUNITY, NEW_VENUE_OPENING, SALES_OFFER_REQUESTED → S1 / S2 …) — **old vertical content** | Replaced by this spec |
| Engine (deal bridge) | Per-org stage rules (`signal_stage_rule`: code → effect create / move / in_stage / won / lost / pause / resume, target stage, guards); forward only, skips allowed, never into area 0 or a terminal stage by a move; **author-only** (our outbound / internal items never act — W2 already); low confidence never acts; one level below a rule's confidence → `stage_confirmation` card; auto-create with thresholds (`deals.autoCreate*`) else `deal_proposal` card; outcomes won / lost (terminal stage, reason in `outcome_reason`), pause / resume, `withdrawn` only by a user (= W4 internal outcome); deal state text + risks from linked topics; topics/10 auto-link of topics to the client's deal | No **entry gate** (decision topics Q24-7 said «no go / no-go anywhere» — W1 now asks for it, see Q1); no outcome reason lists; no forecast rules; **no generic signal codes** for «short list / final round», «client chose us», «contract signed», «RFI / brief within a selection» (the agency pack 05d with PITCH_* codes is a phase-9 document, not seeded) |
| Forecast UI | Board header «Взвешенный прогноз» = Σ value × probability over active non-terminal deals | W5 not met |

## 3. Generic org funnel model (for every org)

### 3.1 Stage definition

New columns on `deal_funnel_stage` (org-owned rows; system rows backfilled):

| Column | UI label | Meaning |
|---|---|---|
| `role` | «Роль» | `area0` (relationship area, never an engine target, out of forecast) / `active` / `won` / `lost`. Exactly one `won` and one `lost`, at most one `area0`, ≥ 1 `active` per funnel. Replaces the hard-coded names «Closed» / «Rejected» everywhere (engine, board, deals, companies tabs) |
| `code` | — | stable machine key per org (`s1`…, `won`, `lost`, `area0`, or a generated `st_…` for an owner-added stage); used by templates, import / export and rule templates. Never shown, never changes on rename |
| `description` | «Что объединяет» | ≤ 300 chars |
| `entry_condition` | «Условие входа» | ≤ 500 chars; shown on the board (column hint) and used by the AI (Q13) |
| `signals_hint` | «Сигналы (для людей)» | ≤ 800 chars, plain language; the machine rules are §3.3 |
| `in_forecast` | «В прогнозе» | false = deals in this stage never count in the money forecast |
| `probability_mode` | «Вероятность» | `stage` (the stage's `closure_probability`) or `expert` (the deal's expert probability, §3.4) |

Backfill (keeps today's behaviour for every org): pre-pipeline → `area0` / out of forecast; «Closed» → `won`; «Rejected» → `lost`; other stages `active`, `in_forecast = true`, `probability_mode = stage`; codes `s1`… by sort order.

Stage RULES point to stage ids (`signal_stage_rule.target_stage_id`, as today), so a rename or reorder never breaks them; templates use stage codes, resolved when applied. A funnel may have any number of active stages (≤ 15).

### 3.2 Entry gate (W1, Q1)

Org setting `deals.entryGate`: `none` (default — today) or `go_no_go`. With `go_no_go`:
- The engine never auto-creates a deal. A `create_deal` rule that fires produces a `deal_proposal` card titled «<Компания> — новая возможность: go / no-go?»; the topic (the stored client signal) exists before any decision.
- «Go» (= «Создать») creates the deal at the stage the rule targets (normally `s1`; with a strong signal — RFP, order confirmed — the rule's own target, W2 skip), as the user.
- «No-go» (= reject) requires a reason from the org's no-go list (§3.5) + optional text; kept in the card, the topic journal and a new line in the company history «Отказ от участия: <причина>».
- Who decides: Q2.
- Deals a person creates in the AI chat (draft card «Новая сделка», [ai-chat-tools](../ai-chat-tools/README.md) T3) are like deals made in the UI: no gate (ai-chat-tools Q11). The chat's `readSignals` evaluates the org's stage rules to suggest the type / stage, with the gate and the auto-create thresholds off.

### 3.3 Stage rules (W2–W4)

Unchanged engine, org-scoped rules (`signal_stage_rule`; edited by the org OWNER in the funnel dialog — simple editor, §7 — and by the platform admin in «Сигналы» — full editor with every guard): code → `create_deal` / `move_stage` (target `sN`) / `in_stage` / `outcome_won` / `outcome_lost` / `pause` / `resume`, with guards. Made explicit by this spec:
- W2: author-only (exists); forward only + skip (exists); rework never moves back (exists — no backward effect).
- W3: in-stage events = `in_stage` rules (journal + deal state, no move).
- W4: `outcome_lost` only from explicit loss / cancellation codes (never from «no response» watchdogs — silence ≠ loss); `pause` only from an explicit client pause; `withdrawn` stays a user action (internal outcome).
- Rule targets are stage ids (rename / reorder safe); templates and import / export use stage codes.

### 3.4 Forecast (W5, Q8, Q9)

- A deal counts in the forecast only when its stage is `in_forecast`, the deal is active (not paused), has an amount, and — for `probability_mode = expert` — an expert probability.
- New deal fields: `expert_probability` (0–100 %, «Экспертная вероятность», with who / when) and `brief_budget` («Бюджет из брифа», the client's figure; never in the forecast; Q9). `deal.value` = the opportunity forecast amount.
- Board header: «Прогноз» = Σ value × probability over counted deals; a second figure «Без оценки: N» (deals in forecast stages without amount / expert probability) so they are visible. Won (`won`) = actual, shown separately. Payment (INVOICE_PAID) never changes the stage or the forecast.
- The director's upsell plan is a company-level plan — not in this release (Q9).

### 3.5 Outcome reasons (W1, W4, Q11)

Org setting `deals.outcomeReasons` = `{ lost: [{ code, label }], noGo: […], withdrawn: […] }` (generic defaults; owner edits in «Настройки стадий» → «Причины»). Used by «Не состоялась» (lost), the no-go reject, «Мы вышли» (withdrawn). The reason code + text are stored (`deal.outcome_reason_code` + existing `outcome_reason`). *Also (2026-11-16):* the AI chat card «Перевести сделку» ([ai-chat-tools](../ai-chat-tools/README.md) T5) moves a deal to any stage or to won / lost through `moveDealStage` as the user (the same move + outcome-reason rules); a lost move needs a code of this lost list — the user's words matched to a label, else the card asks.

### 3.6 Deal types

Already per org (`deal_type`); the owner adds / renames / hides them in the funnel dialog. Rules may target types (exists).

### 3.7 Owner self-service — no code per org (decision Q10, changed)

Every funnel fact is DATA the owner edits in one dialog «Настройки воронки» (`/deals`): stages (§3.1), deal types (§3.6), reasons (§3.5), the entry gate (§3.2) and the stage RULES («Что переводит сюда»: per stage, signals picked from the shared generic catalog with their Russian names, each with an effect «создать сделку» / «перевести» / «итог: выиграли» / «итог: проиграли» / «пауза» / «снять с паузы» / «событие внутри стадии», «спрашивать подтверждение», optional deal types; confidence thresholds use safe defaults; advanced guards set by the admin are KEPT untouched). The engine reads only this data — never org ids, org names or stage names — so any org can build its own funnel without a code change.

- **One config shape** `FunnelConfig` (`src/lib/funnel/config.ts`): `{ v: 1, stages, dealTypes, reasons, entryGate, rules }`; used by the dialog save, templates, admin import / export and `applyFunnelConfig`.
- **Validation on save** (PURE, unit-tested, Russian messages; a broken funnel cannot be saved): exactly one `won` and one `lost`, ≤ 1 `area0`, 1–15 `active` stages, unique codes / names; a stage with deals cannot be removed (move them first); rules: the signal code exists in the catalog; `create_deal` / move targets are `active` stages (never `area0`, never terminal); `outcome_*` need no target; «no response» watchdog codes (`*_NO_RESPONSE`, `*_CONFIRMATION_OPEN`, `DELIVERY_REPORT_OPEN`) can never close a deal (silence ≠ loss); our-side codes (`*_SENT`, `ORDER_CONFIRMED`) can never move (author-only); ≤ 200 rules.
- **Preview «Что бы сдвинулось»** (dry run, nothing written): the edited rules over the org's counted signal instances of the last 30 days — per stage how many deals would be created / moved / closed, with examples.
- **Templates** (platform reference data, migration with fixed codes, generic wording, no company content): «Продажи B2B (стандарт)» (today's system funnel, Russian names) and «Тендеры и конкурсы (5 стадий)» (the funnel of §1 in generic words). «Начать с шаблона» in the dialog replaces the draft with the template (applied only on save). IN4COM starts from «Тендеры и конкурсы» — it is not a special case in code.
- **Only the platform** adds new signal CODES (catalog in «Сигналы», DB — no code change, + eval); owners pick from the catalog.

## 4. Configuration of IN4COM GmbH (tenant data, Q12)

| Meaning | Stage («Название») | In forecast | Probability | Entry condition (short) |
|---|---|---|---|---|
| area0 | Контакт до запроса | no | — | company / person known; no request needed |
| s1 | Новая возможность | no | stage 0 % | concrete task / invitation / suitable procurement + go |
| s2 | Запрошены материалы или решение | no | stage 0 % | materials or a solution requested for a concrete task |
| s3 | Финальный выбор | **yes** | **expert** | short list / final confirmed, or terms discussed after the solution |
| s4 | Выбраны | **yes** | **expert** | explicit choice / official win |
| won | Заказ подтверждён | actual | 100 % | contract / binding order / offer accepted |
| lost | Не состоялась | — | — | confirmed loss / cancellation (reason) |

(The source has five stages; stage 5 «Заказ подтверждён» is the `won` stage — Q3. Descriptions and signals hints = the source table, §1.)

Deal types (Q6): «Новый клиент», «Существенный допзаказ действующего клиента», «Повторный конкурс за текущий контракт»; the old types are hidden. Entry gate: `go_no_go`. No-go reasons: «Не наш профиль», «Низкие шансы», «Нет ресурсов», «Сроки не подходят», «Другое». Lost reasons: «Выбрали другого», «Клиент отменил закупку», «Цена», «Нет ответа после финала» (only when a person sets it — silence alone never closes), «Другое». Withdrawn reasons: «Решили не участвовать дальше», «Конфликт интересов», «Другое».

Stage rules (Q4, Q5) — codes of the generic registry + the new generic codes of §5 (bold):

| Code | Effect | Stage | Notes |
|---|---|---|---|
| SALES_TENDER_INVITATION | create_deal | s1 | invitation / tender with a clear subject |
| PROSPECT_NEED_EXPRESSED (if active) / SALES_NEW_DEMAND | create_deal | s1 | concrete task (existing `requiresFact` guard) |
| **SALES_RFI_REQUESTED** | move (create if none) | s2 | cases / questionnaire / RFI within a selection |
| SALES_MATERIAL_REQUESTED, **SALES_BRIEF_RECEIVED** | move (create if none) | s2 | brief / RFP asking for an approach, concept, test task |
| SALES_OFFER_REQUESTED | move | s2 | a proposal on a concrete task |
| **SALES_SHORTLISTED** | move | s3 | short list / final round confirmed |
| **SALES_FINAL_TERMS** | move | s3 | updated estimate / scope / price after the solution (an early budget question = SALES_BUDGET_MENTIONED → in_stage only) |
| **SALES_SELECTED** | move | s4 | explicit choice by an authorised person / official win notice |
| **CONTRACT_SIGNED**, SALES_BOOKING_RECEIVED | outcome_won | won | contract / amendment / binding order / offer accepted |
| SALES_OFFER_DECLINED, **SALES_LOST** | outcome_lost | lost | confirmed loss (requires confirmation) |
| DECISION_POSTPONED | pause | — | explicit pause only (requires confirmation) |
| MEETING_*, SALES_BUDGET_MENTIONED, FEEDBACK_*, CONTACT_NEW_DECISION_MAKER | in_stage | — | in-stage events (W3) |
| SALES_*_NO_RESPONSE, ORDER_*, INVOICE_* | — | — | never move (silence ≠ loss; payment ≠ stage) |

Existing IN4COM deals (Q7) move by a mapping of their old stages; old rules are disabled (kept as history).

## 5. New generic signal codes (Q4)

Industry-neutral codes added to the base registry (custom migration `0038_funnel_codes_and_templates`, version + 1), `stage = active` for every org (decision Q4: in every extraction prompt; a funnel needs only its own stage rules), block A «Продажи», with relations and platform stage-rule templates (S2 / S3 / S4 / won / lost, ids `tpl:base:26`–`34`). Labels ≤ 60 chars (registry rule), so two are shorter in the DB: SALES_RFI_REQUESTED «Запрос RFI, анкеты или кейсов для оценки в рамках отбора», CONTRACT_SIGNED «Подписан договор, оформлен твёрдый заказ или принята оферта». Codes: **SALES_RFI_REQUESTED** «Запрос материалов для оценки компании в рамках отбора (RFI, анкета, кейсы)», **SALES_BRIEF_RECEIVED** «Получен бриф / RFP с просьбой подготовить решение», **SALES_SHORTLISTED** «Клиент подтвердил шорт-лист / следующий тур», **SALES_FINAL_TERMS** «Обсуждение финальных условий после рассмотрения решения», **SALES_SELECTED** «Клиент сообщил о выборе нас», **CONTRACT_SIGNED** «Подписан договор / дополнение, оформлен обязательный заказ, принята оферта», **SALES_LOST** «Клиент выбрал другого / отменил закупку». Each with a cue text, boundaries (e.g. «похвала решению ≠ выбор», «ранний вопрос о бюджете ≠ финальные условия»), weight, family `offer` / `contract`. The extraction prompt of every org with the `base` pack changes → golden-set eval before relying on automatic moves (topics working rule).

## 6. AI use (Q13)

The deal-state summary and the stage-confirmation card get the current / target stage's name + entry condition («Условие входа …»), so the text and the person's decision refer to the org's own definition. Topics prompts → behind «Профиль в промптах» (`identity.promptContext`), like every topics prompt change.

## 7. UI

- «Настройки воронки» (renamed from «Настройки стадий»; owner edits, others read): tabs «Стадии» (list with drag order, add, hide, remove empty stages; per stage role, name, description, entry condition, signals hint, «В прогнозе», «Вероятность» (по стадии % / экспертная), norm days; block «Что переводит сюда» = the stage's rules), «Типы сделок», «Причины» (lost / no-go / withdrawn), «Правила входа» (the gate «Решение go / no-go перед воронкой»), «Начать с шаблона», «Проверить на данных» (preview), «Сохранить» (validation errors inline).
- Board: column header hint (entry condition), forecast header (§3.4), «Без оценки: N»; final column = the `won` + `lost` stages.
- Deal drawer: «Экспертная вероятность, %» (with who / when), «Бюджет из брифа», outcome dialogs with the reason lists.
- Cards: «Новая возможность: go / no-go?» with «Go» / «No-go» (no-go reasons).

## 8. API / server

- `GET /api/deals/funnel` → `{ config: FunnelConfig, stagesUsage: { [code]: dealCount }, catalog: [{ code, labelRu, family }], templates: [{ code, labelRu, description }], canManage }` (any member reads).
- `PUT /api/deals/funnel { config }` (owner) → validate → apply (stages upsert by id / code, removed empty stages deleted, types, reasons, gate, rules) → `{ config }`; 400 `{ error, issues[] }`.
- `POST /api/deals/funnel { action: "preview", config }` (owner) → preview; `{ action: "template", code }` → the template as a draft config (nothing written).
- Admin: `GET|PUT /api/admin/funnel?organizationId=` = export / import of any org (platform admin).
- Deal fields: `PUT /api/deals` accepts `expertProbability`, `briefBudget`, `outcomeReasonCode`.
- Server: `src/server/funnel-config.ts` (`getFunnelConfig`, `applyFunnelConfig(orgId, config, userId)`, `previewFunnelRules`, templates); engine reads roles (`outcomeStage` by role); pure helpers `src/lib/funnel/config.ts` (schema, validation) and `src/lib/funnel/forecast.ts` (forecast).

## 9. Acceptance checks

1. IN4COM board shows area 0 + the 4 active stages + «Заказ подтверждён» / «Не состоялась» with the new names and hints; other orgs unchanged.
2. A client task signal (tender invitation) creates a topic and a «go / no-go» card, no deal; «Go» creates the deal at «Новая возможность»; «No-go» needs a reason and is kept in history.
3. A brief / RFP from the client moves the deal to stage 2 (or creates it there after go); our proposal sent never moves it.
4. «Клиент выбрал вас» moves to «Выбраны»; praise of the solution does not.
5. A signed contract sets «Заказ подтверждён» (won); INVOICE_PAID changes nothing.
6. «Нет ответа» watchdogs never close a deal; an explicit pause pauses it (after confirmation).
7. Forecast counts only stages 3–4 deals with an amount and an expert probability; «Без оценки: N» shows the rest; won is shown apart; brief budgets are never summed into the forecast.
8. Renaming / reordering a stage keeps the stage rules working (id-based).
9. An owner of any org builds a funnel with an extra active stage and its own rules in the dialog — the engine moves deals by them with no code change; an invalid funnel (two won stages, a rule into area 0, «нет ответа» closing a deal) cannot be saved.
10. «Проверить на данных» shows the effect of the edited rules on the last 30 days without writing anything.

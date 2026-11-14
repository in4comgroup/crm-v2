# Topics — specification

Status: reviewed 2026-11-13; updated 2026-11-14 for R22 (one generic signal set) · no code changes
Inputs and findings: [00-source-analysis.md](00-source-analysis.md) · Open questions: [02-open-questions.md](02-open-questions.md) · Plan: [03-development-plan.md](03-development-plan.md)

All questions that change this spec were answered on 2026-11-10 (see `02-open-questions.md` → Decisions). Markers **[Qn]** point to the decision.

**Decisions 2026-11-13.** The product owner decided R1–R20 (see [02-open-questions.md](02-open-questions.md) § F). They are applied in place in this file; markers **[Rn]** point to them. Main points: the stack is this repo (Next.js on Vercel, Neon, Drizzle migrations from `0010`, Vercel Cron + Workflow) [R1]; every LLM step is an AI process of the AI layer `src/server/ai/` [R2]; topics run hourly [R3]; cost = the existing `ai_usage_event` ledger, budget in the AI layer [R4]; MVP seeds only `base` + `distribution` [R5]; the signals registry is DB data with a full editor [R11]. Q20 «dedicated environments» is superseded by R1. Later: R21 (2026-11-13) merged the two packs into one, `base`; **R22 (2026-11-14) made it one generic set for every org** — no wine / alcohol content, no IN4COM-specific signals or rules, no presets; the live prompt carries every `active` code (migration `0016`, supersedes R6).

Update 2026-11-10 (later): merged the Q24 answers ([02-open-questions-answers.md](02-open-questions-answers.md)) and the business requirements v2 ([Описание требований - v2.md](Описание%20требований%20-%20v2.md)): deal state text (§9.3), deal risk indicator (§9.4), forecast estimate (§9.5), no go / no-go anywhere, N7 profile removed, no limit on codes per item, W1 expiry, P6 repeat cap, trend list, deferred blocks H and J for the agency pack. Q28–Q34 answered the same day (`02-open-questions.md` → Decisions).

---

## 1. Goal

Today a card or a deal is created **per source item** by a free-text rule. Consecutive messages about one matter create duplicate cards. Deals are matched by name. Nothing explains *why* something is important.

Target: the system collects **signals** from three origins — **communications** (email, chats, files, transcripts), the **system of record** (orders, revenue, client history) and **external data** (web search for market signals) — groups them into **topics** (one business point each), scores each topic with a deterministic **attention engine**, and shows **one card per topic**. Signals that belong to a sales opportunity drive **deals** in the org's own funnel. Everything works on **Russian-language** sources first.

The MVP builds the communications origin end to end. The topic and signal model supports all three origins from day one; the system-of-record and external origins ship in later phases (plan phases 8 and 11).

### 1.1 In scope

1. Signal taxonomy as data (one platform pack `base` — R21 — with per-org activation of single codes; the pack model stays for later), with Russian cues. DB tables hold ALL parameters and settings; version 1 is seeded by a Drizzle custom migration; after that the DB is the master [R11]. Managed by the platform admin only in a new Settings tab «Сигналы» with a **full editor** in the MVP, and a Markdown export of the full current registry (decided Q3). MVP seeded the packs `base` and `distribution` only [R5]; since R21 / R22 there is one generic pack `base` for every org.
2. Signal extraction per source item (deterministic gates + one LLM call), server-side scoring.
3. Thread normalisation per provider.
4. Topic entity: resolution (attach / create), lifecycle, history.
5. Attention engine: topic score, band, display profile, recipient.
6. Card per topic (LLM writes text only), continuity NEW / UPDATE / NOOP.
7. Deal bridge: funnel signals create / propose deals and move them through the **org's own funnel stages** by per-org rules, journaled (decided Q21).
8. In-app attention lists («Сейчас» / «Сводка» / «Неделя»).
9. Evaluation set and metrics. LLM usage and cost come from the existing AI layer ledger `ai_usage_event` [R4].
10. **Deal state text** («Текущее состояние», requirements v2): ≤ 3 short sentences / ≤ 50 words on the deal card — where we are, what we wait for, what blocks, what is next. Stored, versioned, re-run on any new item or event of the deal, updated only on material change (§9.3) [R16].
11. **Deal risk indicator** («Есть риски», requirements v2): a badge on the deal card, a tooltip with the most critical risk, a card when a new risk appears, automatic clearing (§9.4).
12. **Exclusions from analysis** (requirements v2, pilot section): a deny-list of addresses, domains and chats, managed by the org owner, that the engine must never analyse (§5.2 gate 3a; Q31, R18).

### 1.2 Out of scope (later phases or separate specs)

- Outbound delivery (email digests, Telegram push to staff) — phase 7 in the plan. This includes the P6 daily limit and the evening reminders (§8.1).
- Watchdog / absence signals (`*_NO_RESPONSE`, offer countdown, reply window) — phase 8.
- System-of-record signals from order data (dormant clients, YoY, product stopped) — phase 8.
- External market signals via web search (the AI gateway's web-search capability, `capabilities: ["web_search"]`) — phase 11 [R2].
- Mailbox read-state timers (grace, "forgotten") — need per-user `\Seen` data we do not sync.
- **Files from Telegram chats / DMs** (audio, documents, images): parsing them is a separate task (decided Q11). Such a file can be its own topic or carry new client / contact info. Until that task ships, the topic engine sees only the text messages of Telegram windows.
- **Functional roles, rights and per-person routing** (Q13, Q33): a **separate task**, outside topics. MVP shows all topics to all org members.
- Learning from feedback (weights stay static; feedback is stored for offline tuning).
- **Dictated call notes** (voice messages to the bot, requirements v2): audio = the same separate task as Telegram files (Q11, Q32).
- **Telegram group chats** with the bot (requirements v2): ingestion is phase 3 of the Telegram source, not this spec (Q32). Topics handle them like other chat windows once they are ingested.
- Contact groups (alumni, expert club, contractors), pipeline import from spreadsheets, and the integration with finance data (1С): separate work, not topics.
- The weighted **forecast view** (§9.5 defines only the data rule).
- The **`agency` pack** (05d) and all agency-only content: PITCH_* rules, the role table §8.3, the forecast §9.5, the 26 agency risks, pitch examples. It stays a document until phase 9 (second pilot) [R5]. Text below marked «agency (phase 9)» is not built in the MVP.

---

## 2. Definitions

| Term | Definition |
|---|---|
| **Source item** | Existing `source_item` row: one email, chat message (group), file, transcript. Children (attachments, derived audio) are **evidence of the root**, never separate events. |
| **Thread** | Technical grouping from the provider (email thread, chat). A thread can hold many topics; a topic can span many threads. |
| **Signal (code)** | An entry in the taxonomy, e.g. `SALES_OFFER_REQUESTED` («Запрошено коммерческое предложение»). Has weight, class, kind, effort, flags. |
| **Signal instance** | One code found once, with evidence, confidence, subject and facts. Origin: `communication` (a source item; evidence = verbatim quote), `system_of_record` (a CRM check; evidence = the data fact, e.g. «последний заказ 14.03, обычный ритм 30 дней»), or `external` (web search; evidence = quote + URL). |
| **Attribute** | A modifier on how something was said (emotion, tone, brevity). Total effect capped at ±2. |
| **Subject** | One (counterparty × matter) pair inside an item, with reference numbers and product names. An item has 0–6 subjects. A subject is the unit that maps to a topic. |
| **Topic** | **One single point of business communication between the organisation and a client or vendor** (decided Q7): one question, request, problem or development that needs, or may need, action from us. It can come from a communication (the client wants something or complains), from the system of record (a client has not bought for a while), or from an external signal (market news about a client found by web search). It concerns a client (`client_id`) and/or a contact (`contact_id`): a topic may concern a person without a company [R14]. It has signals, a lifecycle, a history and at most one open card. Topics are *instances*, not categories: "Счёт №124 — Ромашка просрочен" and "Счёт №125 — Ромашка просрочен" are two topics. A topic may have no source item (system-of-record and external origins). |
| **Card** | What a person sees for one topic: headline, why now, what changed, ≤3 steps. One card relates to one topic only. A card has a **kind** that sets its actions: `topic`, `deal_proposal`, `stage_confirmation` (§9.1). |
| **Deal** | Existing entity = one commercial **opportunity** (Maslov «возможность»). One deal has many topics; a topic has at most one deal. A deal has a **deal type** (`deal.deal_type`, from a per-org type list) [R13]. |
| **Pack** | A named set of signal codes. **Today there is one generic pack, `base` (R21, R22)**: blocks A–N plus the generic B2B trade blocks O–U (orders, stock / samples / promo, client assortment and new locations, delivery and returns, documents, payment). Agency codes (Maslov N1–N4, phase 9) will be added to the same pack. An org switches the pack on; every code whose own stage is `active` then acts. Org overrides stay possible but are not used. |
| **Funnel taxonomy** | The org's own list of deal stages (`deal_funnel_stage`, org-scoped) plus the org's rules that map signals to stage effects (`signal_stage_rule`). Every org can have its own; Maslov's 0–5 stages are one org's configuration, not a built-in. |
| **Deal state** | ≤ 3 short sentences (≤ 50 words) in Russian that tell the current situation of one deal: what happens now, the next step and who must do it, what blocks. Stored with a version history and links to its sources (§9.3). It never repeats the stage name. |
| **Deal risk** | A named warning type («Затягивание решения», «Потеря ключевого контакта» …) from a per-pack dictionary (`deal_risk_type`, platform data; per-org stage guards in `deal_risk_stage_guard`). It becomes active on a deal when its trigger signals are found on a topic of that deal and its conditions are met; it clears when a clearing signal or outcome arrives (§9.4). A risk never moves the stage. |
| **Area 0** («Контакт до запроса», agency) | Work with a company or a person before a concrete request: topics on a client or contact **without a deal**, no amount, no forecast. Requirements v2: this is a relationship area, not a deal stage. **Decided Q34:** the engine never creates a deal in area 0; the existing pre-pipeline stage stays for manual use and is hidden for the agency org. **Area 0 vs auto-create:** `PROSPECT_NEED_EXPRESSED` creates a deal only when the guards of its stage rule say «concrete task»: confidence `high` AND a concrete need fact (what, scope or date) in `facts`. Otherwise it makes a topic on the client / contact only, with no deal. Agency (phase 9). |

**No go / no-go (Q24-7, Q24-1).** No internal approval is needed to create an opportunity or to move it. Creation and stage depend only on confirmed client events and a concrete task. The agency's own decision to stop is a separate internal outcome (`withdrawn`, §9.2), set by a user.

### 2.1 Topic granularity rules

These come from Maslov §5.5 and the concept diagram. They are the acceptance criteria for topic resolution.

1. Merge only within ONE business question.
2. A shared client or a shared thread is **not** a reason to merge. Two parallel pitches at one company, two invoices, a complaint and an unrelated price request → separate topics.
3. One business question across channels (email + Telegram + meeting notes) → one topic.
4. Same reference number (invoice, order, offer, contract №) + same counterparty → same topic.
5. A request and its own reminder → one topic. A complaint and its escalation → one topic (escalation amplifies).
6. A closing fact (offer sent, invoice paid, complaint resolution confirmed) attaches to the topic it closes. It never creates a new topic by itself.
7. Praise does not close a complaint. A verbal win does not close order formalisation.
8. Expiry or a «Готово» click is not settlement of a business risk; the history keeps the difference.
9. The counterparty can be a client **or a vendor / supplier**. A supplier delay is a topic with the supplier; affected client topics get a `topic_event` note (no automatic fan-out in MVP).
10. A market event about a client (external origin) is its own topic, unless the matcher links it to an open topic of the same matter.

Examples (the evaluation set must include these):

| Input | Expected |
|---|---|
| Email «Пришлите КП на корпоратив на 40 человек», then Telegram «Ну что, когда будет КП?» | 1 topic, 1 card (UPDATE: reminder, waiting on us) |
| One email: «Счёт 124 не оплачен, и ещё — пришлите прайс на осень» | 2 topics: invoice 124; price request |
| «Счёт 124 оплатили» a week later | Closes the invoice-124 topic; no new card |
| Agency (phase 9): «Вы в финале, обсудим обновлённую смету» | 1 topic on the pitch deal; deal → stage 3 proposed |
| Agency (phase 9): «Добавьте ещё два направления, бюджет и дата прежние» | 1 risk topic (REQUIREMENTS_CHANGED + SCOPE_WITHOUT_ADJUSTMENT merged); no stage change |
| «Исправление приняли, вопрос закрыт» | Closes the complaint topic (S1); stops repeats |
| Newsletter from a supplier | No signal → no topic |
| IN4COM: Telegram «Прошу отгрузить 12 коробок артикула 4410 к пятнице» | 1 topic (`ORDER_REQUESTED`, weight 5 → «Сводка»; deadline Friday escalates it to «Сейчас» when < 24 h) → card with «Создать заказ»; no deal [R7, R8] |
| IN4COM: «В поставке от 05.11 брак 3 единицы, акт приложили», then «Когда замените?» | 1 claim topic (delivery 05.11), UPDATE: waiting on us |
| IN4COM: «Пришлите, пожалуйста, исправленную УПД №4512, в ней ошибка в реквизитах» | 1 topic (documents, reference УПД 4512) |
| IN4COM: «Открываем второй магазин в марте, хотим обсудить ассортимент» | 1 topic (new location / listing) → deal of type `new_location` «новая точка» auto-created if confidence high and score ≥ 7 and no open deal of this client and type exists; else a «Новая возможность?» proposal |
| IN4COM: Telegram from a buyer with no known company: «Пришлите прайс на вашу продукцию» | 1 topic on the contact only (`contact_id`, no `client_id`) [R14] |
| IN4COM: «Замену получили, всё в порядке» with no open discrepancy topic | S1 code logged on the item; no topic, no card |
| Producer email (EN): «The container is delayed, new ETA 2 December» | 1 supplier topic (`SUPPLIER_DELIVERY_DELAY`, weight from the registry) [R20] |
| System of record: client «Альфа» ordered every ~30 days, last order 75 days ago | 1 topic (`ACCOUNT_DORMANT`, origin system_of_record), no source item (phase 8) |
| External: web search finds «Ромашка открывает 5 новых ресторанов» | 1 topic (`SIGNAL_EXPANSION`, origin external, URL as evidence) (phase 11) |
| Deal topic (generic risk «Решение откладывается»): «Решение по поставщику перенесём на после праздников», two weeks later «Пока не готовы, вернёмся позже» (no date, no next step) | Same topic, 2 postponements → risk active; deal state text updated; the topic card gets UPDATE with the risk; stage unchanged |
| Then: «Давайте встречу 20.11 с финдиректором, после неё решим» | Risk cleared (date + next step agreed), history kept; state text: next step = встреча 20.11 |
| «Спасибо, получили» on a deal topic | NOOP: no state change, no new card |

---

## 3. Architecture

```
          ┌──────────── existing ────────────┐   ┌──────────────────── new ─────────────────────────┐
 sync ──▶ source_item ──▶ parse (markdown, ──▶ 1 SIGNAL EXTRACTION ──▶ 2 TOPIC RESOLUTION ──▶ 3 ATTENTION ──▶ 4 CARD WRITER
          (+thread key)    entities, attrib.)   gates + LLM + scoring    keys + LLM matcher      deterministic     LLM text only
                                                       │   ▲                    │                    │
  CRM checks (orders, revenue) ── system_of_record ───────┤   │ (phase 8)          │                    │
  web search (market news) ───── external ───────────────┘   │ (phase 11)         │                    │
                                                       ▼                        ▼                    ▼
                                                signal_instance           topic, topic_item,     topic.score/band/
                                                                          topic_event            profile/owner
                                                                                │
                                                                                └──▶ 5 DEAL BRIDGE (funnel signals → deal proposals / moves)
                                                                                        └──▶ 6 DEAL STATE + RISKS (risk rules deterministic; state text LLM, stored)
```

Every LLM step is an **AI process** in `src/server/ai/processes.ts` (group «Темы и сигналы»), called only via `aiGenerateText` / `aiStreamText` from `@/server/ai/runtime` with a `ref` (e.g. `{ sourceItemId, topicId, dealId }`). The platform admin picks the model per process on /settings «Процессы ИИ» [R2]. All are background processes with `Output.object` (structured output):

| Process key | Step | When |
|---|---|---|
| `topics.signal_extraction` | §5 extraction | MVP |
| `topics.signal_block_classifier` | §5.3 pass 1 of two-pass extraction | only if the prompt is too big for one pass |
| `topics.topic_match` | §6.2 matcher | MVP |
| `topics.card_writer` | §9.1 card text, NEW / UPDATE / NOOP | MVP |
| `deals.state_summary` | §9.3–9.4 deal state + risk explanations | MVP |
| `topics.external_search` (`requires: ["web_search"]`) + `topics.external_extraction` | §5.6 external origin | phase 11 |

Ownership of decisions:

| Decision | Owner |
|---|---|
| Which codes, evidence, facts, subjects are in an item | LLM (AI process `topics.signal_extraction`) |
| Code valid, date gates, author / direction filters, score, band | Server (deterministic) |
| Which topic a subject belongs to | Server keys first, then LLM matcher (`topics.topic_match`) with a closed list of topic ids |
| Topic score, class, profile, recipient, card exists or not | Server (deterministic) |
| Card wording, lead code choice among detected codes | LLM (card writer, `topics.card_writer`) |
| Deal stage | Server rule from the org's `signal_stage_rule`; human confirms where the org's rule requires it |
| Deal risk active / cleared | Server rule from `deal_risk_type` (codes, occurrences, condition) + the org's `deal_risk_stage_guard`; LLM may only propose clearing with a cited item |
| Deal state text, risk explanation text | LLM (`deals.state_summary`), checked by the server; NOOP keeps the stored text; with NOOP a new risk uses the risk type's fixed text |

---

## 4. Signal taxonomy

Full registry (all codes, parameters, Russian cues, attributes, relations, risk types): [05-signals-registry.md](05-signals-registry.md) and files 05a–05d.

### 4.1 Storage

> **R21 (2026-11-13):** there is now **one** pack (`base`); «Дистрибуция» was merged into it (migration `0014`).
>
> **R22 (2026-11-14):** the pack is **one generic set for every org** (migration `0016_signals_generic_registry`): 7 alcohol-only codes deleted, blocks DS1–DS7 renamed O–U with neutral labels, all texts / risk types / rule templates neutral, no presets. Text below that speaks of the `distribution` pack means the generic trade codes (blocks O–U) inside the one pack.

Platform dictionary tables (data, not code) **[Q2, R11]**. They hold ALL parameters and settings of the registry. Version 1 was built from the reviewed catalogs (05a–05c; 05c is deleted since R22) and seeded by a Drizzle **custom migration** as platform reference data: fixed ids, `ON CONFLICT DO NOTHING` (root `AGENTS.md` rule 3). After that the DB is the master; there is no `db/seeds/*.json` and no seed script. Only `base` and `distribution` were seeded [R5]; since R21 / R22 there is one generic pack.

- `signal_pack` — `code` (`base` | `agency` | …), label RU. Today only `base` (R21, R22).
- `signal_block` — `code` (A…N, O…U, N1…N4), label RU, audience (`client_activity` | `colleagues_activity` | `business_info`), `internal_only`, `first_party_only`.
- `signal_category` — see 4.2.
- `signal_attribute` — code, group (exclusive), scope (`message` | `account` | `contact`), weight −1…+2, stage, profiles, RU cues.
- `signal_relation` — `outranks` | `leads_over` | `both` | `merges_into` (Maslov §5.5 merges) | `dampens` (06 §5.2 H4), A, B.
- `signal_pack_override` — a vertical pack's override of a base code: `weight`, `display_profile`, `recipient_role`, `stage`, `closes_codes` [R12].
- `signal_stage_rule` — **per org** (decided Q21): code → effect on the org's own stages. See §9.2 for fields. A pack may ship a template of rules; the admin copies and edits it per org.
- `signal_taxonomy_version` — integer version; every signal instance, topic and card stores the version it was computed with.
- `organization_signal_setting` — per org: active packs; per-code overrides (`stage` on/off, weight, display profile, recipient role). Resolution: org override → pack override → base value. `closes_codes` is not overridable per org.
- `deal_risk_type` (platform, per pack) and `deal_risk_stage_guard` (per org) — §9.4.
- `deal_type` — per-org list of deal types (§9.2) [R13].

**Signals registry (decided Q3, R11):** only the **platform admin** manages signals — the dictionary, per-org activation, per-org overrides, per-org stage rules and risk types. It is a new tab «Сигналы» in Settings (`/settings`, platform-admin only) with a **full editor in the MVP**: create and edit codes and all their fields, packs and pack overrides, per-org activation and overrides, stage rules, risk types and their stage guards. Every save is validated (05 §7); an invalid save is refused with the errors; a valid save increments the taxonomy version. Org owners and members have no signal settings in MVP; they see the signals on topics.

**Markdown export:** the tab has «Экспорт в Markdown». It downloads the actual registry with all parameters: version and date; packs; blocks; every code with all §4.2 fields (incl. Russian label, definition, boundary, cues, card note), attributes, relations, date gates, retired codes; and, when an org is selected, that org's activation, overrides and stage rules. The same export is a `server-only` function (no CLI scripts in this repo). It replaces hand-written taxonomy docs (like the Truffalo `signals-taxonomy.md`).

### 4.2 Category fields

| Field | Values | Notes |
|---|---|---|
| `code` | UPPER_SNAKE | Stable. Retired codes are kept with `retired_at`, `successor_code` (none exist since R23, `0017`). |
| `pack`, `block` | FK | |
| `label_ru`, `definition_ru` | text | Shown in UI and used in prompts. |
| `boundary_ru` | text | «Граница» — what does NOT count. Mandatory for every active code. |
| `cues_ru` | text[] | Russian cue words / phrases (see §10). Hints, not regexes. Supplier / producer codes also carry English cues, marked «(EN)» (§10.5) [R20]. |
| `weight` | 0–9 | |
| `score_rule` | `fixed` \| `state` \| `inherited` | `state` never scores; it closes. |
| `class` | `risk` \| `chance` \| `fyi` \| null | null for state codes. |
| `class_by_relation` | bool | Class depends on client relation (active / dormant / prospect, §7.2). |
| `kind` | `event` \| `watchdog` \| `state` \| `derived` \| `trend` | Trend is capped at the digest band. |
| `effort` | `quick` \| `medium` \| `complex` | Drives deadline lead days. |
| `stage` | `active` \| `onHold` \| `parked` \| `gated` | Only `active` acts. |
| `emitted_by` | `parser` \| `process` \| `both` | `process` codes are never in the extraction prompt. |
| `asks_us` | bool | Maslov «REQ»: sets topic sub-state `waiting_on_us`. |
| `carries_amount` | bool | |
| `inbound_only` | bool | Dropped on items authored by us. |
| `display_profile` | `W1` \| `D4` \| `P6` \| `P8` \| `S0` \| `S1` \| null | null = derive from score. The Maslov profile N7 is **removed** (Q24-1). |
| `recipient_role` | `relationship` \| `opportunity` \| `account` \| `finance` \| `accounting` \| `logistics` \| `team` \| `new_biz` \| `events` | Maslov roles + `logistics` for the trade blocks O–U, see §8.3. Stored only; no `orders` role in the MVP (IN4COM orders go to the client's sales manager). |
| `closes_codes` | text[] | Which codes on the same topic it closes. Allowed on `state` / S1 codes **and on event codes** [R12]: `INVOICE_PAID` closes `PAYMENT_PROMISE`; `ORDER_CANCELLED` closes `ORDER_REQUESTED`, `ORDER_CHANGE_REQUESTED`. A pack may change `closes_codes` of a base code. |
| `date_gate` | jsonb | `{ fact, test: within\|beyond, settingKey }`. |
| `card_note_ru` | text | Per-code writing guidance for the card writer. |

### 4.3 Packs at launch (decided: pilot = IN4COM; generic set — R22)

| Pack | Content | Source | Pilot (IN4COM) |
|---|---|---|---|
| `base` | Blocks A Sales, B Contracts, C Delivery, D Invoices, E Feedback, F Meetings, G Contacts, I Bounce, N Suppliers, H (market), J (team), K (account), L (competitors), M (internal), rewritten with RU definitions, boundaries, cues; each code has its own stage (`active` / `onHold` / `parked` / `gated`). **Plus the generic B2B trade blocks O–U** (24 codes, ex-«Дистрибуция», R21 + R22): O «Заказы», P «Наличие, образцы, промо», Q «Ассортимент клиента и новые точки», R «Доставка и возвраты», S «Документы», T «Оплата и взаиморасчёты», U «Предложено дополнительно». `ORDER_*` codes make topics and cards only, never deals; the `ORDER_REQUESTED` card gets «Создать заказ» (§9.1) [R7]. | Truffalo v204 tables + the former distribution codes, made generic by `0016` | **on**: the `base` pack is switched on, no overrides; every code whose own stage is `active` (≈109 then; 144 active / 123 in the prompt since R23) is in the live prompt (R22; supersedes R6) |
| `agency` | N1 PITCH (19), N2 PROSPECT (10), N3 account (15), N4 risks (18), with Maslov weights, profiles, recipients, closures, merges, plus the 26 deal risk types (§9.4). Q24 answers apply (see below). | Maslov catalog + Q24 answers | off; **not seeded in the MVP** — document only until phase 9 (second pilot after IN4COM, Q29, R5) |

**Agency pack rules from the Q24 answers** — agency (phase 9), not built in the MVP (values for the phase-9 seed; the full text is in `02-open-questions-answers.md`):

| Q24 | Rule in the seed |
|---|---|
| 1 | `PROSPECT_CONTENT_INTEREST` = interest in a topic or material without an own need: weight 3, W1. `PROSPECT_NEED_EXPRESSED` = the client describes an own relevant task: weight 7, P6, recipient `new_biz`. A concrete project → deal entry (no approval). A vague task stays in area 0. |
| 2 | `PROSPECT_CONTACT_MOVED` = chance, weight 5, D4 (a reason to talk to the person at the new place). Loss at the old company is judged by `CONTACT_LEAVING` / `ACCOUNT_SPONSOR_SUPPORT_LOST` and the risk condition in §9.4. |
| 8 | Blocks **J «Команда» (6 codes)** and **H «События компании и рынка» (40 codes)**: `stage = parked` for the agency pack. No processing, cards, notifications or risk triggers. |
| 10 | Renewal = stage 4 only when the contract / service is identifiable, the next period or scope is defined and the client explicitly confirms the choice of the agency. «Надеемся продолжить» does not count. Written into the boundary of the renewal code and the stage rule. |
| 13 | The five cited source documents are not system dependencies. The catalog is the authoritative spec. |

---

## 5. Signal extraction

This section covers the **communication** origin. System-of-record and external origins write `signal_instance` rows directly (§5.6).

### 5.1 Placement **[Q4: decided]**

A **separate step after parse** (AI process `topics.signal_extraction`, background, structured output) [R2], not inside each parser:

- One prompt for all providers; parsers stay unchanged.
- Re-runnable without re-parsing (taxonomy changes, prompt fixes).
- Input = parsed markdown + envelope + org context. Output = §5.3.
- The markdown is read with `getTextObject(markdown_r2_key)` from `@/server/storage`, because `source_item.parsed_markdown` is cleared after upload. Items not yet uploaded use `parsed_markdown`.
- The call is `aiGenerateText({ process: "topics.signal_extraction", orgId, userId: null, ref: { sourceItemId }, output: Output.object({ schema }), … })`. Every call writes one `ai_usage_event` row.

Cost: one extra LLM call per root item that passes the gates. Later, once stable, it can be folded into the parse call (Truffalo does one call).

### 5.2 Gates before the LLM (deterministic, zero cost)

In order. Each skip writes `signal_status = 'skipped'` + reason.

1. Item is a root (`parent_source_item_id IS NULL`); `parse_status = 'complete'`; the org flag `topics.enabled` (in `org_setting`) is `shadow` or `on`.
2. Junk verdict (`relevance.isJunk`) — skip, **unless** a later run finds an active code (Truffalo override; not possible before the call, so junk items are skipped in MVP **[Q10: decided]**).
3. Blocklist / own-org-only internal noise (existing `discovery_blocklist`, `org_identity`).
3a. **Exclusions from analysis** (requirements v2: «некоторые разговоры намеренно не должны попадать в CRM»): a per-org **deny-list** of email addresses, domains and chats (Telegram chat id, WhatsApp chat name). Managed by the **org owner** (Q31, R18). Where the provider allows a filter (IMAP / Nylas by address, Telegram by chat), excluded items are not synced at all. Where the provider cannot filter at sync, only the **dedupe id** is stored (no subject, no sender, no body), so the item is not fetched again: it is never parsed, never sent to an LLM, never attached to a topic and never used for deal state.
4. Automated sender (`is-automated-email.ts`; switch to token-anywhere match).
5. **Bounce detector** (RU + EN subjects, mail-system sender, DSN part) → emits `MAILERDEMON_RECEIVED` with `facts.bouncedMessageIds` without the LLM.
6. **Out-of-office detector** (headers first, then RU / EN subject and body cues) → emits `CONTACT_OOO` facts (return date, deputy) or skips.
7. Calendar reply without `.ics` (RU: «Принято:», «Отклонено:», «Под вопросом:» …) → meeting fact, no LLM.
8. **AI budget** (R4): the AI layer checks the org's daily AI budget before the call (`docs/specs/models/`). When it is reached, the background process stops: `signal_status = 'deferred'`, and the item is retried on the next hourly run after the budget day resets. Deterministic steps continue.

### 5.3 LLM output schema (flat, sentinel values — portable across gateway models)

```
signals[]   (all distinct confirmed events, strongest first; Q24-12 — no business limit;
             technical safety cap 12; semantic duplicates removed by the server)
  code            string   — must be in the ACTIVE list given in the prompt
  evidence        string   — verbatim quote from THIS item's own text (not quoted history)
  confidence      "high" | "medium" | "low"
  subjectIndex    int      — index into subjects[]; -1 = all
attributes[]  (≤1 per group: emotion, tone, brevity, salutation)
  code, evidence
subjects[]   (≤6, one per counterparty × matter)
  counterparty    string   — company the matter is with; "" = internal
  onBehalfOf      string   — real owner when counterparty is an agent / logistics / IT
  matter          string   — 3–8 words in Russian, nominative case («счёт 124 за октябрь»)
  references[]    { kind: invoice|order|offer|contract|claim|other, value: string }  copied exactly
  products[]      string   — copied exactly
facts
  amounts[]   (≤5) { value: number, currency: "RUB"|"USD"|"EUR"|"CNY"|"", scope: total|per_unit|per_month|per_year, vat: incl|excl|unknown, evidence, subjectIndex }
  deadlines[] (≤5) { date: YYYY-MM-DD, precision: exact|resolved, what (RU), owner: us|them|unknown, evidence, subjectIndex }
  contractEndDate     YYYY-MM-DD | ""
  proposedMeetingDate YYYY-MM-DD | ""
direction       "inbound" | "outbound" | "internal"   — cross-checked with org attribution
```

Prompt rules (Russian text, see §10.4):

- Evidence or nothing. Empty is normal: most items have no code.
- Judge only this item. Quoted history (below «От:», «-----Исходное сообщение-----», «… написал(а):», «>») is context only.
- Author-only: a code describes what the AUTHOR does. Our own initiative is never a client signal.
- Forwarded messages (requirements v2: staff forward client messages to the bot): the author is the **original sender** (Telegram `forward_origin`, email «Пересылаемое сообщение» header), not the employee who forwarded it. The envelope carries `forwardedBy` (our user) and `originalAuthor`.
- We are the buyer: when the author sells to us, never emit customer codes (use supplier codes).
- Vendor marketing to us is never demand.
- Relative dates are resolved against the item's own date, never "today".
- Copy references and product names exactly.
- The item may be in any language (Russian, English, French, Italian …). `matter` and Russian fields are always written in Russian; evidence is copied in the original language [R20].

Prompt size control **[Q5, R22]**: send only the org's **active** codes (with the `base` pack on and no overrides: every code whose own stage is `active` and is not a process code: 123 codes, ≈ 123k characters since R23; R22 superseded R6's «on» / «review» split); for each code send label, definition, boundary, ≤8 cues. If the prompt exceeds the model's budget, use two passes: (1) block classifier (process `topics.signal_block_classifier`, added only if needed), (2) codes of the chosen blocks.

Model choice **[Q5 → R2]**: a spike compares 2–3 gateway models, switched on «Процессы ИИ» and measured with `ai_usage_event` (cost, latency) and the golden set (quality).

### 5.4 Server post-processing (deterministic)

1. Drop unknown, retired (map to successor), non-active, `process`-only codes; drop entries with empty evidence; check evidence appears in the item text (fuzzy, whitespace-insensitive).
2. Drop `inbound_only` codes when `direction = outbound`; drop internal-only blocks on external items.
3. Date gates (e.g. `CONTRACT_FRAME_EXPIRY` only if `contractEndDate` within 56 days after the item date).
4. Apply `outranks`.
5. Low-confidence instances are stored but count 0.
5a. Remove semantic duplicates (same code + same subject → keep the strongest evidence) (Q24-12).
6. Item score = **max** weight of counted codes (tie-break risk > chance > fyi, then dictionary order) + sum of attribute weights capped to [−2, +2]; floor 0. **Trend codes have a D4 ceiling** («Сводка»), even when attributes raise the score (Q24-6).
7. Store instances in `source_item_signal`; store `signal_score`, `signal_band`, `taxonomy_version`, `signal_scanned_at` on the item. **A stored score is never re-scored** when weights change (only an explicit re-run does).

### 5.5 Bands

| Band | Score | Priority | Display profile (default) |
|---|---|---|---|
| none | 0 | — | no topic created (item may still attach as context, §6.4) |
| low | 1–3 | low | W1 weekly |
| normal | 4–5 | normal | D4 digest |
| high | 6–7 | high | P6 «Сейчас» (daily limit is phase 7; in the MVP P6 = P8 in-app) |
| very_high | 8–9 | critical | P8 «Сейчас», no limit |
| critical | ≥10 | critical | P8 |

A code's own `display_profile` (e.g. S0, S1) overrides the band default.

### 5.6 Other origins (later phases, same model)

| Origin | Producer | Evidence | Counterparty | Phase |
|---|---|---|---|---|
| `system_of_record` | Scheduled CRM checks over `order`, `order_item`, `client` (dormant by order rhythm, product stopped, revenue YoY, reactivation due) — deterministic, no LLM | The data fact in Russian («последний заказ 14.03; обычный ритм 30 дней») + the numbers in `facts` | The client of the check | 8 |
| `external` | Web search per client / watch list (AI process `topics.external_search` with `capabilities: ["web_search"]` of the gateway), then extraction in a `press` profile (process `topics.external_extraction`; only market codes; `about: subject \| other`) | Quote + URL | The client the article is about | 11 |

Both write `signal_instance` rows with `source_item_id = null` and go through the same scoring (§5.4), resolution (§6) and attention (§8). A trend cooldown (default 90 days per client + code) stops repeats.

Rules for absence, time-based and trend codes (Q24-6, Q24-11):

- **Trend list** (`kind = trend`, D4 ceiling): `SIGNAL_CONTACT_QUIET`; `ACCOUNT_REVENUE_STAGNATION`, `ACCOUNT_REVENUE_DECLINE_YOY`, `ACCOUNT_REVENUE_GROWTH_YOY`; `ACCOUNT_INCREMENTAL_WORK_SLOWDOWN`; `SIGNAL_SPEND_UP`, `SIGNAL_SPEND_DOWN`. `ACCOUNT_DORMANT`, `*_NO_RESPONSE` and overdue states are **not** trends. Being on this list does not switch on a parked code.
- Every calculated trend needs a configured observation window, a comparison baseline, a minimum data volume and a change threshold (per code, in `date_gate` / a new `trend_rule` jsonb). Too little data → no instance.
- **No-response** codes need: an originating request (an outbound item on the topic), an elapsed response deadline (agreed date, else default **7 calendar days**), all connected channels checked, and no qualifying response.
- `ACCOUNT_DORMANT` needs a configured no-purchase threshold based on the client's usual buying rhythm (for IN4COM: from order history).
- Agency (phase 9): `PITCH_FEEDBACK_MISSING` needs an agreed feedback deadline or a direct confirmation that substantive feedback is absent.
- **Insufficient data never produces a definitive warning.**

---

## 6. Thread normalisation and topic resolution

### 6.1 Thread key (fix per provider)

`source_item.thread_external_id` is kept; a new normalised `thread_key` is written at sync / ingest:

| Provider | `thread_key` |
|---|---|
| nylas | `nylas:<threadId>` |
| imap | `imap:<root Message-ID>` from `References[0]`, else `In-Reply-To`, else own Message-ID. Requires storing `References` in the envelope. |
| gchat | `gchat:<space>/<thread>` |
| telegram | `tg:<chat_id>:<window>` — a chat is split into windows by a time gap (same rule as WhatsApp: >1 h gap or >100 messages) **[Q11: decided]** |
| whatsapp | `wa:<archive chat>:<groupKey>` (existing group = window) |
| gdrive / dropoff / aichat | `null` (documents are standalone) |

A `thread` table is **not** required for MVP; the key is enough for matching. Thread states (`waiting_on_us`) live on the topic.

### 6.2 Resolution order

For each subject of an item that has ≥1 counted signal (or a state / S1 code):

1. **Resolve counterparty** to a client id and / or a contact id: existing `client` (name / aliases via `companyMatchKey`, sender domain, contact email) and existing `contact` (email, Telegram id, name via `personMatchKey`). A person with no company → `contact_id` only [R14]. Unknown → `client_id = null`, `contact_id = null`, keep the string; discovery may create the client / contact later and the topic is re-linked. In the steps below, «same counterparty» = same `client_id`, or same `contact_id` when there is no client.
2. **Hard key match** → attach to that topic:
   - same counterparty AND a shared reference (`kind + normalised value`) on an open or recently resolved topic.
3. **Candidate set** = open topics (and topics resolved in the last 14 days) of the same counterparty, plus open topics on the same `thread_key`. Ranked by recency. Max 10.
4. **Empty candidate set** → create a new topic.
5. **LLM topic matcher** (AI process `topics.topic_match`, `ref: { sourceItemId, topicId? }`) gets the subject (matter, references, products, amounts, codes with evidence) and the candidates (topic id, title, matter, lead code, references, last 3 events). It returns `{ topicId | "NEW", confidence, reason }`. The id must be copied from the list; any other value = NEW. **When the matcher is unsure** (confidence not `high`), the server attaches only if ALL are true: same counterparty, same matter family, and no conflicting reference, product or amount. Otherwise it creates a new topic [R15]. This keeps §2.1 rule 2 (a shared client is not a reason to merge).
6. State / S1 codes with no matching topic → stored on the item and **logged only**: no topic, no card (one card = one topic). They are visible in the review log.

Matter family = a coarse group used for candidate ranking and merges: `offer`, `order`, `invoice`, `contract`, `complaint`, `meeting`, `contact`, `pitch`, `delivery`, `account`, `market`, `supplier`. Each code has one family (new column `family` on `signal_category`).

### 6.3 Topic title

- The LLM proposes `matter` in Russian, nominative case.
- Display title = `<Компания> — <matter>` («Ромашка — счёт 124 за октябрь»). A topic with a contact only: `<Имя Фамилия> — <matter>`. The company short name strips the legal form (ООО, АО, ПАО, ИП, quotes) — existing `translit-ru` helpers.
- **Matching never uses the title string.** It uses ids, references and the matcher. This avoids the Russian inflection problem of Truffalo's label.

### 6.4 Items without counted signals

An item with band `none` that shares a `thread_key` or a reference with an open topic is attached as `role = context` (no score change, visible in history). Otherwise it is ignored by topics. **[Q9: decided]**

---

## 7. Topic entity and lifecycle

### 7.1 Status

```
            new signal / reopen (≤14 d after resolved / done)
   ┌─────────────────────────────────────────┐
   ▼                                         │
 open ──(state/S1 code closes last active)──▶ resolved ──(14 d after resolved)──▶ archived
   │ ├─(user «Готово»)───────────────────────▶ done
   │ ├─(no activity 21 d)───▶ dormant ──(no activity 60 d)──▶ expired
   │ └─(user merge)─────────▶ merged (→ merged_into_topic_id)
   └─(user «Не относится»)──▶ dismissed
```

The topic status has no `shadow` value: shadow mode is the org flag `topics.enabled = shadow` (§12), not a status of a topic or a card.

- Sub-state of `open`: `waiting_on_us` (last counted code `asks_us` and no later outbound item on the topic) | `waiting_on_them` (last item is ours) | `none`.
- `done` ≠ `resolved`: done is a human mark; resolved is confirmed by a closing signal (Maslov rule: expiry or «Готово» is not settlement).
- **Timers** (settings `topicReopenDays` 14, `topicDormantDays` 21, `topicExpireDays` 60):
  - Reopen window = 14 days from the topic's `closed_at` (the resolved or done date). A new matching item in this window reopens the topic; later it creates a new topic with `related_topic_id`. A `dormant` topic reopens on any new matching item (it was never closed).
  - Dormant = 21 days with no activity (from `last_activity_at`). Expired = 60 days with no activity (from `last_activity_at`, i.e. 39 days after it became dormant). An `expired` topic does not reopen; a new item creates a new topic with `related_topic_id`.
  - `resolved` → `archived` when its reopen window ends.
  - **Card expiry is independent of topic expiry.** The card expires by its display profile (06 §7.3: P8 10, P6 7, D4 5, W1 10 working days); the topic stays `open`. Topic expiry (60 days) ends the topic; it does not depend on the card.

### 7.2 Topic score

Full rules: [06-attention-engine.md](06-attention-engine.md) §4 (it wins over this section after review).

- Topic score = max over **active** signal instances on the topic (not closed by a state code, not low-confidence, not older than the code's relevance window) of the instance score.
- Recomputed on every attach / close. The card keeps the score it was born with.
- `lead_code` = the strongest active code (score tie-break); the card writer may pick another lead among detected codes for wording, never for the score.
- `class` = class of the lead code, or by relation for `class_by_relation` codes (active client → risk, prospect / dormant → chance). The relation is **derived**, not stored by hand: from the client's order history (IN4COM: active = orders in the usual rhythm; dormant = no order beyond the rhythm threshold; prospect = no order yet), plus the companies page tab classification (`/clients`: customers / potential / supplier / partner / unclassified) when there is no order history. Exact mapping: 06 §4.6.

### 7.3 Closing

- A `state` / S1 instance — or an event instance whose code has `closes_codes` [R12] — on a topic closes the instances listed in its `closes_codes` **on that topic** (not "same client" as in Truffalo). If no active instance remains → `resolved` + `closed_reason`. Examples: `INVOICE_PAID` closes `INVOICE_OVERDUE` and `PAYMENT_PROMISE`; `ORDER_CANCELLED` (event, scores itself) closes `ORDER_REQUESTED` / `ORDER_CHANGE_REQUESTED`.
- Outcome codes (`CONTRACT_TERMINATED`; agency (phase 9): `PITCH_EXCLUDED`, `PITCH_CANCELLED_BY_CLIENT` …) close the topic; the outcome is shown once.
- Agency (phase 9): `PITCH_PAUSED_BY_CLIENT` → topic `open` with `snoozed_until` = return date or condition; no repeats until then.

---

## 8. Attention engine (deterministic)

Full specification: [06-attention-engine.md](06-attention-engine.md) (boosts, state adjustments, escalation, lists, cycles, expiry, explanation, examples). It wins over this section after review.

### 8.1 Display profile → list

| Profile | List | Rule |
|---|---|---|
| P8 | «Сейчас» | No daily limit; repeat protection per card. |
| P6 | «Сейчас» | **MVP: P6 behaves like P8 in-app** (no per-person routing yet, Q13). The daily limit and the evening reminders are **phase 7** (delivery). Phase 7: ≤ `cards.dailyPushLimit` (3) distinct cards per user per local day; overflow → «Сводка». **Repeat cap (Q24-5, phase 7):** first display + at most **3 evening reminders per cycle**. A new material fact or a newly agreed deadline starts a new cycle; an unchanged background check does not. An approaching deadline overrides the daily limit on distinct cards, never the duplicate protection of the same card. End of the reminder cycle ≠ issue resolved. |
| D4 | «Сводка» | Morning digest list (07:30 local). Ceiling for trend codes. |
| W1 | «Неделя» | Weekly list (Fri 12:00). **Expiry (Q24-4):** 10 working days from the deadline, or from creation if there is no deadline, but never before its first weekly display. After expiry it stays in the weekly list for 7 more calendar days, then only in history. Expiry does not resolve the business risk. |
| S0 | — | No card; closes. |
| S1 | — | Updates the linked card; if nothing is linked → logged only, no card (§6.2 rule 6). |

The Maslov profile N7 is removed (Q24-1): `PROSPECT_CONTENT_INTEREST` is W1, `PROSPECT_NEED_EXPRESSED` is P6 (agency, phase 9).

MVP shows these lists **in-app** (dashboard), the same for every org member (Q13). The filter «Мои» keeps topics where `topic.owner_user_id` (the topic's assignee) is me **or** the linked deal's owner `deal.user_id` is me. The default assignee is the linked deal's owner; else the client's responsible user — a **new** nullable column `client.responsible_user_id` (it does not exist in this repo; added only if the pilot needs it); else none. A user can reassign a topic. External delivery is phase 7 (Q15: in-app → email digest → Telegram to staff).

Lists recompute on events (attach, close, user action, deal change) and on the hourly run [R3]. Deadline escalation and card expiry are also evaluated **when a list is read**, so a topic moves to «Сейчас» on time even between two runs.

### 8.2 Deadline escalation (MVP subset)

- A deadline (from `facts.deadlines`, owner = us) closer than `cards.deadlineImmediateHours` (24 h) → «Сейчас», no daily limit.
- Deadline before the next list point + 3 h → move up one list (W1 → D4 → P6).
- Example [R8]: `ORDER_REQUESTED` has weight 5 (D4 «Сводка»); a same-day or next-morning shipment date (< 24 h) moves it to «Сейчас».
- A **serious deal risk** (severity ≥ `deals.riskImmediateMinSeverity`, default 7) moves the linked topic to «Сейчас» (§9.4) [R17]. This is an escalation, not a score change.
- Dated topics return to «Сводка» N working days before the deadline (`complex 5 / medium 3 / quick 2`). Working days use the **Russian production calendar** (table `work_calendar_day`, loaded yearly).

### 8.3 Recipient (owner of attention) — separate task (Q33)

**Decided Q13:** functional roles are needed, and the business will give the role list. The first iteration skips them: every org member sees every topic; `topic.owner_user_id` = the topic's assignee (default: deal owner, else the new `client.responsible_user_id`, §8.1; display and «Мои» filter only). IN4COM orders go to the client's sales manager; there is no `orders` role in the MVP. The `recipient_role` field on codes is stored from the start, so routing can switch on later without a taxonomy change.

**Decided Q33:** functional roles and rights are a separate task, not part of topics. The table below is input for that task only; topics code does not depend on it. It is **agency (phase 9)** content. Requirements v2 gives the agency role list (`client.responsible_user_id` below = the new column of §8.1):

| Role (v2) | Code | Scope | Resolved to |
|---|---|---|---|
| Владелец связи | `relationship` | **per contact** (v2: "a role relative to a contact, not the whole company") | new `contact.relationship_owner_user_id`; else `client.responsible_user_id` (new); else client creator |
| Директор аккаунта / проекта | `account` | per client | `client.responsible_user_id` (new) |
| Pitch lead / ответственный за возможность | `opportunity` | **per deal** | deal owner (`deal.user_id`); no deal → `relationship` |
| New biz | `new_biz` | org | members with function `new_biz`; none → org owners |
| Финансовая роль | `finance` | org | members with function `finance` + `account` |
| Бухгалтерия | `accounting` | org | members with function `accounting` (payment facts; no deal decisions) |
| Менеджеры и эксперты | `team` | per deal / client | deal team (later); now: `account` |
| Контакты и мероприятия | `events` | org | members with function `events` (contact lists, invitations) |
| Логистика (trade blocks O–U) | `logistics` | org | members with function `logistics` + `account` (delivery, returns, documents) |

**Senior team («Старшая команда») gets no routing** (Q24-7): no go / no-go cards, no automatic risk distribution to it.

Functional roles need a new per-member attribute (`member_function`, several per member — v2: one person can hold several roles). The org role (owner / admin / member) stays for permissions only. The IN4COM role list and the rights come with that separate task.

Visibility: every org member sees all topics of the org (same as cards today). Per-recipient lists come with functional roles.

### 8.4 Parameters

Stored with the settings ladder user → org (`org_setting`, a new per-org key/value store like `platform_setting`) → platform (`platform_setting`) → code default (subset of Truffalo `cards.*`). Full table with defaults: 06 §13. Keys: `workingHours`, `timeZone` (per user; Russia spans UTC+2…+12), `dailyPushLimit` (phase 7), `digestVisibleItems`, `morningDigestTime`, `weeklyReview`, `deadlineImmediateHours`, `digestActionBufferHours`, `deadlineLeadDays`, `expiryDays` (per band; W1 = 10 working days, Q24-4), `weeklyGraceDays` (7), `p6RepeatMax` (3 evening reminders per cycle, Q24-5; phase 7), `telegramMaxPerCard7d` (2 incl. the first delivery, Q24-5; phase 7), `noResponseDefaultDays` (7, Q24-11; phase 8), `riskPostponementCount` (2, Q24-3), `topicReopenDays` (14), `topicDormantDays` (21), `topicExpireDays` (60); `topics.enabled` (`off` | `shadow` | `on`, org only, default `off`); `topics.runIntervalMinutes` (60, set by the cron, R3); deal settings (Q27, §9.2): `deals.autoCreateEnabled` (true), `deals.autoCreateMinScore` (7), `deals.autoCreateMinConfidence` (`high`), `deals.proposalMinScore` (5), `deals.stateDebounceMinutes` (10), `deals.riskImmediateMinSeverity` (7). The org owner cannot change these in the MVP (platform admin only); the exclusions list (§5.2 gate 3a) is the only owner-managed part.

---

## 9. Cards and deals

### 9.1 Card per topic

- `card.topic_id` (new). **At most one open card per topic** (partial unique index).
- Card exists only if the topic band ≥ low and the profile is not S0. An S1 code with no linked topic makes no card (§6.2 rule 6).
- Card status enum (new): `open` | `accepted` | `rejected` | `superseded` | `expired` | `closed`. The old `accepted` boolean is kept and written in parallel during the expand phase. There is no `shadow` status: in shadow mode (org flag) cards are stored normally and only the UI hides them.
- **Card kind** (new column `card.kind`, enum `card_kind`) sets the actions:

| Kind | Made by | Actions |
|---|---|---|
| `topic` | the attention engine, one per topic | «Принять» → task; «Отклонить» (reason code); «Готово»; «Отложить до…». `ORDER_REQUESTED` cards also get «Создать заказ» (below). |
| `deal_proposal` | the deal bridge (§9.2): medium confidence or score below the auto-create threshold | «Новая возможность?» — «Создать» (creates the deal of the proposed type, links the topic) / «Не сделка» (reason kept). |
| `stage_confirmation` | a `signal_stage_rule` with `requires_confirmation` (§9.2) | «Подтвердить» (moves the stage, journaled) / «Отклонить» (reason kept). |

  A `deal_proposal` / `stage_confirmation` card belongs to the same topic, but it does not count as the topic's open `topic` card (the partial unique index is per topic **and** kind).
- Continuity per topic: when a new item attaches, the card writer (AI process `topics.card_writer`, `ref: { topicId, sourceItemId }`) returns `NEW` (rare: lead matter changed), `UPDATE` (replace text of the open card, set `since_last`), or `NOOP` (nothing changed — "thanks", read receipt). UPDATE is never applied to an accepted / rejected card; a new card supersedes it.
- Card text (Russian, one language): headline ≤12 words «<Компания> — <наше действие>, <цель>»; «Почему сейчас» ≤20 words; «Что изменилось» ≤16 words (empty if nothing changed in the work); ≤3 numbered steps ≤15 words; roles not names; no congratulations; no invented facts or dates.
- **Events on the card (Q24-12):** the compact view lists at most **3 events**, in this order: critical risks and urgent actions → client decisions and commitments → changes to terms → other context. All other events of the topic open with «Ещё». S0 / S1 closing events are processed even when they are not in the compact view. Independent issues in one item are separate topics and cards (§2.1).
- Card fields from the engine (not LLM): `score`, `band`, `priority`, `display_profile`, `signal_class`, `lead_code`, `taxonomy_version`, recipient user ids.
- Accept / reject stays: accept creates a task, reject asks for a reason **code** (list) + optional text. Reasons are stored for evaluation.
- **«Создать заказ» [R7]:** the `ORDER_REQUESTED` topic card reuses the existing card → New Order dialog handoff (today's `new_order` card: `GET /api/cards?id=` → the New Order dialog on /products, prefilled with the client and the verbatim source message). The created order is stamped on `card.result_order_id`. When IN4COM topics are `on`, the old «Telegram orders» Custom card rule is **switched off**, so there are no duplicate cards. While IN4COM is in `shadow`, the old rule stays on.
- **Old card logic is removed** once topics are implemented (decided Q8): Custom-rule card generation (`/api/cards/generate`, Explore / Magic buttons, card rules), and the old `accepted` / `rejection_reason` columns after the contract migration. Until removal, it stays only for orgs with topics `off` or `shadow`.
- **Old cards are not migrated** into topics [R10]. They stay as read-only history with `topic_id` NULL.

### 9.2 Deal bridge

- `topic.deal_id` (nullable FK). One deal ↔ many topics.
- **Org-specific funnel taxonomy (decided Q21).** Every org has its own stages (`deal_funnel_stage`, org-scoped — the table already exists; the «Настройки стадий» dialog edits names and hiding) and its own signal rules. Maslov's 0–5 funnel is the agency org's configuration, not code.
- `signal_stage_rule` (per org, platform admin edits in «Сигналы»):
  - `code` → `effect`: `create_deal` | `enter_stage` (target stage id) | `in_stage` (context only) | `outcome` (`won` | `lost` | `cancelled` | `paused`) | `none`. **`paused` is a deal status, not a stage** (decided): the deal keeps its stage, gets `status = paused`, the return date / condition and the reason; reminders stop until the return date. Silence is never `lost` (v2). The outcome **`withdrawn`** (the agency / org decided to stop, Q24-7) is set only by a user, never by a signal, and is kept with its reason;
  - guards: `min_confidence`, `min_score`, `from_stages` (allowed current stages), `forward_only` (default true), `requires_confirmation` (a `stage_confirmation` card instead of an automatic move — an org-level choice for cautious orgs; **not** an internal go / no-go, Q24-7), `deal_type` (which kind of deal it creates or moves), `requires_fact` (e.g. «concrete task»: a concrete need fact in `facts` — used by the agency rule for `PROSPECT_NEED_EXPRESSED`, §2);
  - several rules per code are allowed (e.g. one rule for stage 2, another for stage 3 when the deal is already in 2).
- Rules for all orgs: risks never move stages; amounts never enter the forecast automatically; every move is journaled with the rule id, topic and evidence.
- **Deal vs order (decided Q26):** a **deal** is a general agreement / contract with the client (new client or location, listing in the client's assortment or a chain, tender, annual supply agreement, renewal). An **order** is a purchase of a specific product or service. **Step one covers deals only:** `ORDER_*` codes create topics and cards but never create or move deals; the order link is the «Создать заказ» action on the card (§9.1, R7).
- **Deal type [R13]:** new column `deal.deal_type` → a per-org type list (`deal_type` table: org, code, label_ru, sort, hidden). Generic types (R22; used by the stage-rule templates): `new_location` «Новый клиент / новая точка», `listing` «Ввод в ассортимент / листинг», `tender` «Тендер», `supply_agreement` «Годовой договор поставки», `renewal` «Продление». *(Before R22: IN4COM types `new_venue`, `wine_card_listing`, `chain_listing` — replaced.)* A stage rule's `deal_type` guard names the type; the auto-create dedupe uses it.
- Behaviour (decided Q12: the system may create deals itself; start values Q27, per-org settings `deals.autoCreate*`):
  - Topic with a deal-entry code, no open deal of this client and deal type (dedupe key = org + client + `deal_type` + deal status `active`/`paused`):
    - `deals.autoCreateEnabled` AND confidence ≥ `deals.autoCreateMinConfidence` (`high`) AND topic score ≥ `deals.autoCreateMinScore` (7) AND counterparty resolved to a client AND the rule's guards pass → **create the deal** (`createDeal`, actor = system agent user, badge «создал агент»), link `topic.deal_id`, journal in `deal_activity` with `topic_id` + `source_item_id` + evidence. The user can undo (deal status `deleted`, reason kept).
    - confidence `medium`, or score from `deals.proposalMinScore` (5) up to the auto-create threshold, or a contact with no client → **`deal_proposal`** card «Новая возможность?» with Создать / Не сделка.
    - lower → nothing.
  - Orgs may switch auto-create off (`deals.autoCreateEnabled = false`) and keep proposals only. Agency (phase 9): the agency pack uses the same auto-create: a concrete client task creates the opportunity without internal approval (Q24-1, Q24-7); `PROSPECT_NEED_EXPRESSED` passes only with the «concrete task» guard (§2, area 0).
  - A topic linked to a deal with a higher `enter_stage` code → move the deal forward (forward only; **skip allowed**, v2: an RFP or a direct order confirmation may set the matching stage at once) via `moveDealStage(actor: 'agent')`, which writes `deal_activity` with `source_item_id` and `topic_id` (new nullable columns). Backward moves only by outcome codes. Rework alone never moves a deal back (v2). Our own actions (offer sent, internal tasks) never move a stage (author-only rule).
  - In-stage codes update deal context (decision date, people, budget context) via `topic_event`, not the stage.
- The current name-based `/api/deals/discover` is removed together with the old card logic (Q8). Until then, deal discovery must write `deal_activity` for every move it makes (foundation work) [R9].
- **The mock deal agent is removed now, for all orgs [R9]:** the auto-apply of `src/server/deals-mock.ts` proposals via `GET /api/deals/proposals` (called on board load) goes away. Only real rules (this section) move deals.

### 9.3 Deal state («Текущее состояние», requirements v2)

Goal: a person who does not know the deal reads one block and knows **where we are, what we wait for, what blocks, what is next**.

- **Storage, not on-the-fly** (v2 recommends it): `deal.state_text`, `deal.state_updated_at`, plus an append-only `deal_state_version` (text, reason, source item ids, topic ids, actor `agent` | `user`, model, created_at). The kanban card and the drawer read the stored text; no LLM call on page open.
- **Trigger [R16]:** any new item or event linked to the deal — a new item on a topic of the deal (any role, **including `context` items**, and whatever the card decision was), a manual deal edit (amount, contacts, type, date), a stage move, a status / outcome change, a new or cleared risk — or a user request «Обновить». Debounce: one run per deal per `deals.stateDebounceMinutes` (10). The run has its own `UPDATE` / `NOOP` decision; it does not depend on the card's UPDATE / NOOP.
- **AI process `deals.state_summary`** (background, structured output, `ref: { dealId }`; Russian prompt). Input: deal (client, stage name, status, amount), linked topics (title, status, lead code, facts, last events), the last ≤8 items of those topics as markdown excerpts, active risks, the **previous state text**. Output: `{ decision: "UPDATE" | "NOOP", text, sourceItemIds[] }`. NOOP when the situation did not materially change (v2: «переформулировать не требуется»).
- **Rules in the prompt** (from v2): at most 3 short sentences / 50 words, connected text, not fields; do not repeat the stage; facts only, no intentions the sources do not state; use the deal history, not only the last item; show changes (new dates, new requirements, withdrawn agreements); always state the next step, or say it is not defined; make clear who must act (client or us); never invent a reason for a delay — silence is not refusal; no generic phrases.
- **Server checks** (deterministic, reject → keep the old text and log): length ≤ 3 sentences / ≤ 50 words [R16]; a stop list of generic phrases («работа со сделкой продолжается», «клиент заинтересован», «ведутся переговоры» …); the stage display name must not be the only content; every `sourceItemId` must be in the input.
- **Special cases:** no or too little data → the fixed text «Недостаточно информации о текущем состоянии сделки» (no LLM call if the deal has no linked topic); won → short result (what is agreed or bought); lost → the established reason, or no reason when unknown.
- **Sources:** «Источники» under the text opens the items in `sourceItemIds` (v2: the user must be able to open the sources).
- The state changes independently of the stage (v2). History of versions is visible in the deal drawer.
- Existing `deal.reasoning` / `deal.changes` (old discovery) stay for orgs with topics `off` / `shadow`; they are removed with the old logic (Q8).

### 9.4 Deal risks («Есть риски», requirements v2)

- **One model, two tables:**
  - `deal_risk_type` — **platform** data, per pack, edited in «Сигналы»: `code`, `label_ru` (e.g. «Затягивание решения»), `description_ru` (the fixed explanation text), `trigger_codes[]`, `clear_codes[]`, `severity` 1–9, `min_occurrences` (default 1), `trigger_scope` (`deal` | `client` | `org_sku`, former 05c open point 10), `condition` (named server check, optional), `reaction_role`, `stage`.
  - `deal_risk_stage_guard` — **per org**: risk type × org × allowed stage ids (the org's own `deal_funnel_stage` rows). v2: "no budget at an early stage is not necessarily a risk". No guard row for an org = the risk applies at every stage of that org.
  - Every org (IN4COM too) uses the **9 generic risk types** of `base` (seeded in `0012`, texts made neutral in `0016`, R22; the source files 04 / 05c are deleted). They are confirmed in the golden-set review (Q30). Agency (phase 9): the **26 Maslov risks** (05d, with their signals and «Снятие предупреждения») — not seeded in the MVP.
- **Activation** (deterministic): a trigger code is counted on a topic linked to the deal (or in the type's `trigger_scope`), the org's stage guard allows the deal's stage, the occurrence count is reached, the condition is true → `deal_risk` row `active` with the trigger instance ids. Examples from Q24 (agency wording; the same rules apply to the generic risk «Решение откладывается»):
  - «Затягивание решения» (Q24-3): `min_occurrences = 2` distinct postponements (`PITCH_DECISION_DELAYED_BY_CLIENT`) of the **same decision in the current selection cycle**, with no new date + next step agreed after them. Repeated mentions of one postponement and postponed unrelated meetings do not count. Agreeing a date and a next step clears it; history stays.
  - «Потеря ключевого контакта» (Q24-2): condition = the person **supported this deal** (linked in `deal_contact`) AND no handover / working access to the stakeholder is confirmed. A job move alone does not trigger it.
  - Risks referring to parked codes (blocks H, J for the agency pack) never trigger (Q24-8).
- **Clearing:** a `clear_codes` signal on a topic of the deal, a deal outcome, or a user action «Риск снят» (reason required). v2: «риск устранён, если новый входящий сигнал показал, что ситуация изменилась». The `deals.state_summary` run may also **propose** clearing with evidence; the server accepts it only with a cited item. Card expiry or «Готово» never clears a risk (Q24-4, §2.1 rule 8).
- **Display:** the deal card shows the badge «Есть риски» when ≥1 risk is active. The tooltip shows **only the most critical** one (highest severity × trigger score, then the newest): label + 1–2 sentences «в чём риск» and «на чём основана оценка». The text comes from the `deals.state_summary` run (field `riskExplanations[{riskId, text, sourceItemIds}]`); the same server checks as §9.3. **If that run is NOOP** (or fails the checks), the explanation is the risk type's fixed `description_ru` [R17]. The drawer lists all active and cleared risks.
- **Attention [R17]:** when a risk becomes active, the `topic` card of the linked topic (the topic with the trigger instance) is **forced to UPDATE** and shows the risk. A **serious** risk (severity ≥ `deals.riskImmediateMinSeverity`, default 7) raises that topic to «Сейчас» (escalation, 06 §6 I5; the score does not change). Otherwise the weight of the trigger code sets the list as usual (§8). v2: "a risk is also one of the morning cards, maybe a push". **No separate card type.**
- Risks never move the stage and never change the amount (§9.2).

### 9.5 Forecast estimate (agency (phase 9), Q24-9)

Not built in the MVP [R5]; the columns ship with phase 9.


- The weighted forecast uses only the **opportunity owner's estimate** of the win probability, with author, date and rationale (`deal.win_estimate` 0–100, `win_estimate_by`, `win_estimate_at`, `win_estimate_note`).
- No estimate → the deal is «не оценена»: its amount is in the unweighted pipeline and excluded from the weighted forecast.
- Signal weight, stage number and the stage `closure_probability` never replace the owner's estimate. Amounts never enter the forecast automatically (§9.2).
- Anyone who may edit the deal may enter the estimate (Q33: no role rights in this scope); author, date and note are always recorded. The forecast view itself is out of scope (§1.2).

---

## 10. Russian-language requirements

### 10.1 Deterministic patterns (code, unit-tested)

| Area | Patterns to add |
|---|---|
| Quote markers | «От:», «Отправлено:», «Кому:», «Тема:», «-----Исходное сообщение-----», «-------- Пересылаемое сообщение --------», «… пишет:», «… написал(а):», «>» lines |
| Reply / forward prefixes | Re:, Отв:, Ответ:, Fwd:, Пересл:, FW: (chains) |
| Bounce | «Недоставленное сообщение», «Не удалось доставить», «Ошибка доставки», «Сообщение не доставлено», «Возвращённое письмо» + EN DSN; Yandex / Mail.ru senders |
| Out-of-office | Subjects «Автоответ», «Автоматический ответ», «Нет на месте»; body «в отпуске до», «нахожусь в отпуске», «на больничном», «в командировке», «вернусь», «буду на связи с», «по срочным вопросам обращайтесь к», «нет в офисе» |
| Calendar replies | «Принято:», «Отклонено:», «Под вопросом:», «Предварительно принято:» |
| Money | thousands sep = space / NBSP / dot; decimal comma; «₽», «руб.», «р.», «RUB»; «тыс.», «т.р.», «млн», «млрд», «к»; «в т.ч. НДС», «без НДС», «с НДС» |
| Dates | genitive months («16 октября»), «к 15.11», «до пятницы», «на следующей неделе», «в течение 3 рабочих дней», «до конца месяца», quarters («в Q4», «в 4 кв.») — resolved by the LLM against the item date, validated by the server |
| Working days | Russian production calendar (moved working Saturdays, holidays) |
| Legal forms | ООО, АО, ПАО, ЗАО, НАО, ИП, ГУП, МУП, НКО, АНО + «ёлочки» / "quotes" (exists in `translit-ru.ts`) |
| Freemail | add rambler.ru, bk.ru, list.ru, inbox.ru, ya.ru, internet.ru, yandex.by/kz, mail.ua |
| Names | declension-insensitive matching via existing `personMatchKey`; name + patronymic detection |

### 10.2 Cues per code

Every active code in `base` (and `agency` in phase 9) needs `cues_ru` (written, not translated). Supplier / producer codes also need English cues (§10.5). Examples:

- SALES_OFFER_REQUESTED: «пришлите КП», «коммерческое предложение», «просчитайте», «смета», «сколько будет стоить проект».
- SALES_PRICE_REQUEST: «прайс», «цены», «условия», «скидка от объёма», «какая цена».
- INVOICE_OVERDUE (outgoing, client owes): «напоминаем об оплате», «просрочка», «задолженность», «акт сверки показывает долг».
- INVOICE_PAID: «оплатили», «платёжка», «деньги ушли», «платёжное поручение».
- COMPLAINT_QUALITY: «брак», «ошибка», «не то», «претензия», «рекламация», «возврат».
- COMPLAINT_TIMING: «сорвали сроки», «опять задержка», «мы до сих пор ждём».
- CONTRACT_FRAME_EXPIRY: «договор заканчивается», «пролонгация», «продление договора», «доп. соглашение».
- SALES_TENDER_INVITATION: «тендер», «закупка», «44-ФЗ», «223-ФЗ», «котировка», «НМЦК», «срок подачи заявок».
- PITCH_SHORTLISTED (agency, phase 9): «вы в финале», «вы в шорт-листе», «прошли во второй тур» (boundary: «мы рассматриваем» does NOT count).

### 10.3 Attributes in Russian

- Emotion: ANGRY («возмутительно», «неприемлемо», «досудебная претензия», «будем вынуждены»), FRUSTRATED («к сожалению, опять», «разочарованы»), IMPATIENT («срочно», «сколько можно», «жду ответа», «ASAP»).
- Tone negative: reproach («опять ничего не прислали») vs fact («пока не получили»).
- Salutation: **off by default** — Russian business mail almost always uses «Вы»; low signal value.

### 10.4 Prompt language **[Q6: decided]**

Prompts and taxonomy text are **in Russian**; field names and enum values stay English. No A/B test is needed.

### 10.5 Foreign-language mail **[R20]**

Mail from producers in English, French or Italian is in scope. Extraction works on any language: the prompt says the item may be in any language, evidence is copied in the original language, and `matter` / card text stay Russian. Supplier / producer codes (block N, family `supplier`, e.g. `SUPPLIER_DELIVERY_DELAY`, `SUPPLIER_PRICE_CHANGE`) and other codes producers use get **English cue phrases** marked «(EN)» (e.g. «shipment delayed», «new ETA», «price increase from», «new price list»). They are added in the IN4COM pack review. The deterministic gates (§5.2, §10.1) keep their EN patterns (bounce DSN, out-of-office, `Re:` / `Fwd:`). The golden set includes foreign-language producer mail.

---

## 11. Data model changes

All changes follow root `AGENTS.md` rule 3 (Drizzle migrations only) [R1]:

- Schema change: edit `src/db/schema.ts` → `pnpm db:generate --name <what>` → review the SQL → commit both.
- Reference data, backfills and anything `schema.ts` cannot express: `pnpm db:custom --name <what>`, safe to re-run (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, guarded `DO` blocks).
- Apply with `pnpm db:migrate` against each target DB **before** deploying the code that needs it; `pnpm db:check` validates the folder. Never `drizzle-kit push`, never ad-hoc SQL, never edit an applied migration.
- Expand first (new tables, nullable columns), contract later. A new enum value (`ALTER TYPE … ADD VALUE`) is not used in the same migration file.
- No out-of-band scripts (`scripts/` does not exist): one-time backfills are custom migrations or resumable engine steps.

**Done (2026-11-13):** `0010_topics_phase0_foundations` (org_setting + log, topics_run, topics_golden_item, topics_eval_result), `0011_signal_registry`, `0012_signals_registry_v1`, `0013_signals_registry_v2_fixes`, `0014_signals_single_pack` (R21). **Done (2026-11-14):** `0015_topics_phase2_signals` = the planned `0013_source_item_signals` **plus** `0018_analysis_exclusion` and a new `topics_eval_run` (stored eval metrics); `0016_signals_generic_registry` (custom, R22: 7 alcohol-only codes hard-deleted with their relations, stage-rule templates and org overrides; blocks DS1–DS7 → O–U; neutral texts, risk types and pack description; generic deal types in the rule templates; registry version 4 on a fresh DB). Status values are text columns validated in code (like the registry), not pg enums; extra item columns `signal_reason`, `signal_attempts`; instance columns `evidence_found`, `not_counted_reason`. `0017_signals_activate_onhold_drop_retired` (custom, R23: every `onHold` code `active`, the 11 retired codes deleted); `0018_topics_phase3` (= the planned `0014_topics`: `topic`, `topic_item`, `topic_event`, FK `signal_instance.topic_id`, `source_item.topic_*` progress columns; value lists as text validated in code). `0019_topics_phase4_attention_cards` (= the planned `card_topic` + the topic attention columns + `work_calendar_day`; card kind / status are text validated in code); `0020_work_calendar_ru_2026_2027` (custom, official production calendar 2026–2027, exceptions to Mon–Fri). `0021_topics_phase5_deal_bridge` (= the planned `deal_topic`: `deal_type`, `deal.deal_type_id`, status `paused` + `paused_until` / `pause_reason`, `outcome_reason`, `created_by_agent`, `deal_activity` provenance columns; `client.responsible_user_id` not added — the owner rule uses `client.user_id`). `0022_topics_phase5a_deal_state_risks` (= the planned `deal_state_risk`: `deal.state_text` / `state_source_item_ids` / `state_updated_at` / `state_dirty_at`, `deal_state_version`, `deal_risk`; status values as text validated in code). `0023_signals_rule_guard_cleanup` (custom, R22 follow-up: the `client_type = HoReCa` guard removed from the `LISTING_OPPORTUNITY` rule template). **The next free number is `0024`** (e.g. the next calendar year `work_calendar_…`, the agency win estimate, the contract migration of phase 12). The numbers and names below are the planned order; the real names come from `pnpm db:generate --name` / `pnpm db:custom`, and the order follows the plan (`03-development-plan.md`).

| Migration (planned) | Kind | Objects |
|---|---|---|
| `0010_org_setting` | generate | `org_setting` (org, key, value jsonb, updated_by, updated_at; unique org + key) + `org_setting_log` — a per-org key/value store like `platform_setting`, with typed keys in a server module (zod schema + default). Holds `topics.enabled` (`off` \| `shadow` \| `on`, default `off`), the attention / deal settings of §8.4 that an org overrides. |
| `0011_signal_registry` | generate | `signal_pack`, `signal_block`, `signal_category` (all §4.2 fields + 05 §2 columns: `family`, `relevance_days`, `cues_prompt_ru`, `synonyms_ru`, `anti_cues_ru`, `example_ru`, `counter_example_ru`, `trigger_rule`), `signal_attribute`, `signal_relation` (incl. kind `dampens`), `signal_pack_override` (pack × base code: weight, display_profile, recipient_role, stage, closes_codes), `organization_signal_setting` (org: active packs; org × code: stage, weight, display_profile, recipient_role), `signal_stage_rule` (per org: code, effect, target stage, outcome, guards incl. `deal_type`, `requires_confirmation`, `requires_fact`), `deal_risk_type` (platform, per pack, §9.4), `deal_risk_stage_guard` (org × risk type × stage ids), `signal_taxonomy_version`; enums `signal_class`, `signal_kind`, `signal_stage`, `signal_score_rule`, `signal_effort`, `display_profile`, `recipient_role`, `signal_relation_kind` |
| `0012_signals_registry_v1` | custom | Version 1 of the registry as platform reference data with **fixed ids** and `ON CONFLICT DO NOTHING` [R11]: packs `base` + `distribution` only [R5], blocks, codes, attributes, relations, pack overrides, risk types. Built from the reviewed 05a–05c (later: one pack — `0014`, R21; generic — `0016`, R22). Org activation, org overrides and org stage rules / stage guards are **tenant data**: they are not in a migration; the platform admin sets them in «Сигналы» (the rule templates in the DB are copied there). |
| `0013_source_item_signals` | generate | `signal_instance` (org, code, **origin** `communication`\|`system_of_record`\|`external`, source_item_id nullable, process_key nullable, external_url nullable, evidence, confidence, subject_index, counted, score_contrib, topic_id nullable, taxonomy_version, created_at); `source_item_subject` (item, index, counterparty, client_id, contact_id, on_behalf_of, matter, references jsonb, products text[]); `source_item` new nullable columns: `thread_key`, `signal_status` (incl. `skipped`, `deferred`), `signal_score`, `signal_band`, `signal_facts` jsonb, `signal_scanned_at`, `taxonomy_version`; index `(organization_id, signal_scanned_at)` |
| `0014_topics` | generate | `topic` (id, org, client_id nullable, **contact_id nullable** [R14], counterparty_raw, deal_id, title, matter, family, status, sub_state, lead_code, class, score, band, display_profile, owner_user_id, references jsonb, next_deadline_at, next_attention_check_at, attention jsonb, cycle fields, snoozed_until, first_seen_at, last_activity_at, closed_at, closed_reason, related_topic_id, merged_into_topic_id, taxonomy_version, timestamps); `topic_item` (topic, item, subject_index, role `origin`\|`update`\|`closing`\|`context`); `topic_event` (append-only journal: type, actor `agent`\|`user`, user id, payload jsonb, item id); enums `topic_status`, `topic_sub_state`, `topic_item_role` |
| `0015_card_topic` | generate | `card` new nullable columns: `topic_id`, **`kind`** (new enum `card_kind`: `topic` \| `deal_proposal` \| `stage_confirmation`; null = old card), `status` (new enum `card_status`), `score`, `band`, `display_profile`, `signal_class`, `lead_code`, `since_last`, `taxonomy_version`, `reject_reason_code`, `decided_at`, `deal_id` (for `deal_proposal` / `stage_confirmation`), `proposal` jsonb (proposed deal type / stage, rule id); partial unique index: one open card per topic and kind. Old cards keep `topic_id` NULL [R10]. |
| `0016_deal_topic` | generate | `deal_type` (org, code, label_ru, sort, is_hidden) + `deal.deal_type` nullable FK [R13]; `deal_activity` new nullable `source_item_id`, `topic_id`, `rule_id`; `deal_status` enum gets `paused` (used only by code / a later migration, never in the same file); `deal` new nullable `paused_until`, `pause_reason`, `outcome_reason`. Optional, only if the pilot needs it: `client.responsible_user_id` nullable (§8.1). IN4COM's deal types are tenant data (created in the UI), not part of the migration. |
| `0017_deal_state_risk` | generate | `deal` new nullable `state_text`, `state_updated_at`; `deal_state_version` (deal, text, reason, source_item_ids text[], topic_ids text[], actor, model, ai_usage_event_id, created_at); `deal_risk` (org, deal, risk_type, status `active`\|`cleared`, explanation_ru, trigger_instance_ids text[], source_item_ids text[], occurrences, detected_at, cleared_at, cleared_reason, cleared_by `signal`\|`outcome`\|`user`); enum `deal_risk_status` |
| `0018_analysis_exclusion` | generate | `analysis_exclusion` (org, kind `email`\|`domain`\|`chat`, value, normalized_value, created_by, created_at; unique per org + kind + normalized value) (Q31, R18). Excluded items that the provider cannot filter keep only their dedupe id (§5.2 gate 3a). |
| `0019_work_calendar` + `0020_work_calendar_<year>` | generate + custom | `work_calendar_day` (date, is_working, region); the Russian production calendar is platform reference data — one custom migration per year. |
| later (agency, phase 9) | generate | `deal` new nullable `win_estimate` (smallint 0–100), `win_estimate_by`, `win_estimate_at`, `win_estimate_note` (Q24-9) |
| separate task (roles, Q33) | — | `member_function`, `contact.relationship_owner_user_id` — not in this plan |

**No new cost tables** [R4]: LLM usage and cost come from the existing `ai_usage_event` (exact USD cost, `ref` with `sourceItemId` / `topicId` / `dealId`). There is no `llm_usage` and no `llm_model_price`. The daily AI budget is built in the AI layer (`docs/specs/models/`).

Cleanup migration (after all orgs run topics, Q8): drop the old card generation paths in code first; then a later contract migration removes `card.accepted` / `card.rejection_reason` and the `card_analysis_scanned_at` / `deal_analysis_scanned_at` stamps (two releases apart, rolling-deploy safe).

Teardown (`src/server/teardown.ts`) must delete topics / topic items / signals that its selected threads produced. `reparseSourceItem` must reset signal columns and detach the item from topics (re-resolution on next run).

---

## 12. Quality: evaluation and metrics

- **Golden set** (decided Q17) for the pilot: ≈ 200 real IN4COM Russian root items, anonymised, plus **synthetic** test messages for rare codes and for every §2.1 example. IN4COM business users review the annotations (codes, subjects, topic groups) and assess the results. Synthetic items carry `synthetic = true`; metrics are reported for real and synthetic items separately, and go-live gates use the real items.
- Metrics:
  - signal precision / recall per code (target precision ≥ 0.85 on P6 / P8 codes, recall ≥ 0.7);
  - topic grouping: pairwise precision / recall on "same topic" pairs (target ≥ 0.9 / ≥ 0.8);
  - over-split rate (one question → several topics) and over-merge rate;
  - card acceptance rate, reject reasons distribution, NOOP rate;
  - **deal state:** share of texts that pass the v2 quality test («Где мы? Чего ждём? Что мешает? Что дальше?») in a human review of ≥ 30 deals (target ≥ 80 %); zero invented facts / dates in the sample; NOOP correctness on unchanged updates;
  - **deal risks:** precision of active risks in a human review (target ≥ 0.8); share of risks cleared with a cited item;
  - cost per 100 items (from `ai_usage_event`, USD), p95 latency per AI process.
- **Shadow mode** = the org flag `topics.enabled = shadow` (in `org_setting`), not a status of a topic or a card. The engine runs and stores topics / cards normally; the UI hides them from users until the targets are met for the org. Then the platform admin sets the flag to `on`.
- ~~**Offline eval batch [R6]:** codes marked «review» run only here~~ — superseded by R22: there is no «review» set; every `active` code is in the live prompt. An optional batch over non-`active` codes (golden set + a sample of recent items) can test a code before the admin makes it `active`.
- **Evaluation harness:** a `server-only` engine function runs extraction + resolution on the golden set and stores the metrics; the platform admin starts it from «Сигналы» (no CLI script; `scripts/` does not exist). It has a recorded-response mode to avoid LLM cost. Unit tests of the deterministic parts run with `pnpm test` (vitest, added in phase 2); the 06 §16 attention tests are added in phase 4. The eval runner is on the «Темы» tab (phase 2), not on «Сигналы».

## 13. Operations

- **AI processes [R2]:** `topics.signal_extraction`, `topics.topic_match`, `topics.card_writer`, `deals.state_summary` (state text + risk explanations, §9.3–9.4); `topics.signal_block_classifier` only if two passes are needed; phase 11: `topics.external_search` (`requires: ["web_search"]`) + `topics.external_extraction`. They are added to `src/server/ai/processes.ts` (group «Темы и сигналы», kind background, structured output, a `defaultModelId`) and show up on /settings «Процессы ИИ», where the platform admin picks the model per process. Calls go only through `aiGenerateText` with a `ref` (`sourceItemId`, `topicId`, `dealId`). There is no `src/server/ai/config.ts`, no `AI_TASKS` and no Yandex registry.
- **Model spike (Q5 → R2):** 2–3 gateway models are switched on «Процессы ИИ» for `topics.signal_extraction` and measured on the golden set; cost and latency come from `ai_usage_event`.
- **Sign-in rule** (root `AGENTS.md` rule 4): engine functions take `organizationId` explicitly (cron-safe) and live in `import "server-only"` modules, never in a `"use server"` module. Every route handler and every exported `"use server"` function checks the session itself (`getServerSession()` + 401, or a `require*` helper); «Сигналы» routes require the platform admin, exclusion routes require the org owner. API routes call `src/server/` functions; no Drizzle in routes. Actor for agent writes = a per-org system user («Агент Truffalo», hidden from member lists) **[Q14: decided]**.
- **Environments [R1]:** Vercel (production + preview) on Neon Postgres, as for the rest of the app. Q20 «dedicated environments» is superseded. Migrations are applied with `pnpm db:migrate` to each target DB before the deploy.
- **Scheduling [R3]:** topics run **every 60 minutes**: a new hourly entry in `vercel.ts` `crons` (e.g. `/api/cron/topics`, `CRON_SECRET` like `/api/cron/daily`) starts a Vercel Workflow (`src/workflows/topics-pipeline.workflow.ts`, the only file with workflow directives) that calls the engine-agnostic `runTopicsPipeline({ trigger })` in `src/server/orchestration/`. Order per org: **intake** (sync → parse → upload of the org's automated sources, signal window only, built 2026-11-14) → signals → topic resolution → attention → cards → deal bridge → deal state (debounced). The daily pipeline (`runDailyPipeline`: sync → parse → upload) stays for all orgs; intake is skipped while it runs. Attention lists also recompute on events, and deadline escalation is evaluated when a list is read (§8.1). **Prerequisite:** a sub-daily Vercel cron needs the Vercel **Pro** plan.
- **Start history (Q16):** when an org switches to `shadow`, the engine processes items of the **last 7 days**; older items are not processed. Per-run caps: 200 items / org, concurrency 3. Each step is idempotent and resumable via `signal_scanned_at` / `topic_scanned_at` (no backfill script).
- Manual triggers stay: "Обработать" on the Sources page runs parse → upload → signals → topics for one item.
- `pipeline_run` gets counters for the new phases (or a new per-org `topic_run` table).
- **Feature flag per org:** `topics.enabled` (`off` | `shadow` | `on`) in `org_setting`. `shadow` = the engine runs and stores everything, the UI hides topics and topic cards.
- **Markdown input:** the engine reads parsed markdown through `@/server/storage` — `getTextObject(markdown_r2_key)` — because `source_item.parsed_markdown` is cleared after upload. Never `@aws-sdk/*` or `process.env.R2_*` directly.
- **Cost and budget [R4]:** cost = the existing `ai_usage_event` ledger (exact USD cost from the gateway, markup on top), shown on «Использование ИИ» (admin) and the owner usage tab on `/account`. **Q18 budget** = a per-organization daily AI budget in USD (default 5), built in the AI layer (runtime pre-check; background processes stop at the cap, interactive ones warn) — specified in `docs/specs/models/`, not here. Topics only react: a stopped background call leaves the item `deferred` (§5.2 gate 8); deterministic steps continue.
- **Model stats:** the existing «Использование ИИ» tab (calls, tokens, cost, latency, errors per process / model / org / day). No new stats tables.
- Privacy (Q19: decided): evidence quotes are personal data under 152-ФЗ; they follow the same retention and teardown as source items. No per-person processing restriction in MVP.

## 14. UI (MVP)

- Dashboard: three tabs «Сейчас» / «Сводка» / «Неделя» + «Все темы», the same for all org members, filter «Мои» (topic assignee or deal owner = me, §8.1) (Q13). Each item = the topic card, with the actions of its kind (§9.1): `topic` cards (incl. «Создать заказ» on `ORDER_REQUESTED`), `deal_proposal` cards «Новая возможность?», `stage_confirmation` cards. Hidden while the org flag is `shadow`. Old cards stay visible as read-only history.
- Topic detail drawer: title, company, deal link, status, signals with evidence quotes (Russian), timeline (items + events), actions: Принять → задача, Отклонить (reason code), Готово, Отложить до…, Объединить с…, Отвязать сообщение, Привязать к сделке.
- Company page and drawer: «Темы» tab (open + recent). Contact page: the same tab for topics on the contact (incl. topics with no company).
- Deal drawer: «Темы» tab; the «Происхождение» tab shows real provenance (replaces the mock).
- Deal card (kanban) and deal drawer: deal type; «Текущее состояние» text (≤ 3 sentences / ≤ 50 words) with «Источники»; version history in the drawer (§9.3). Badge «Есть риски» with a hover tooltip (most critical risk only); the drawer lists all active / cleared risks with evidence and the action «Риск снят» (§9.4).
- «Исключения из анализа» (Q31, R18): deny-list of addresses, domains and chats that are never analysed — managed by the **org owner** on the Sources page («Управление источниками организации»).
- Settings → «Процессы ИИ» and «Использование ИИ» (existing, platform admin): model per topics process; usage and cost per process / org / model / day; the org's daily budget status comes from the AI layer (`docs/specs/models/`). No new usage UI in topics.
- Settings → «Сигналы» (platform admin only), **full editor in the MVP** [R11]: registry table with filters (pack, block, stage, class, family); create / edit codes and all their fields; packs and pack overrides (incl. `closes_codes`); per-org activation and overrides; per-org stage rules (with the org's funnel stages and deal types); **deal risk types and their per-org stage guards**; per-org `topics.enabled` flag; validation on save (05 §7) with a version bump; taxonomy version history; offline eval batch; «Экспорт в Markdown» of the current list with all parameters (includes the risk types).
- Deal types: the org's list of deal types (§9.2) is edited by the org owner next to «Настройки стадий» on /deals.

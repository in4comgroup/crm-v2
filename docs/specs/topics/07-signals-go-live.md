# Topics — signals automation: go-live runbook

Status: **draft, 2026-11-14.** Covers the whole MVP (phases 0–6): foundations, signals registry, signal extraction, hourly intake, topic engine, attention, topic cards, deal bridge, deal state and risks, user UI. Extend it with delivery (phase 7) and system-of-record signals (phase 8).

Purpose: one step-by-step list of what to switch on / off and what to check, so the whole signals flow works in a **new environment** (the first production deployment). Today there is only one environment and one DB (the DB in `.env`, a test DB). Some parts cannot be tested there (§3), so they must be checked at the switch-on.

Related: spec [01-specification.md](01-specification.md) (§5 extraction, §13 operations) · plan [03-development-plan.md](03-development-plan.md) · registry [05-signals-registry.md](05-signals-registry.md) · decisions [02-open-questions.md](02-open-questions.md) (R22, R23).

---

## 1. The flow, end to end

| # | Step | Code | Trigger and timing |
|---|---|---|---|
| 1 | **Sync**: new messages from the source become `source_item` rows. Excluded addresses / chats are not stored (R18) | `src/server/sync/*`, `src/server/ingest/telegram.ts` | Mail (Nylas, IMAP), Google Chat, Drive: **every hour** for orgs in `shadow` / `on` (phase «intake» of the topics run), daily at 03:00 UTC for all orgs (`/api/cron/daily`), or the «Синхронизировать» button. Telegram: the webhook, at once |
| 2 | **Parse**: markdown, junk skip, own-org attribution, exclusion guard (`parse_status`) | `parseSourceItem` | Hourly «intake» (items of the signal window only, max 50 per org per run), daily run (max 200 per run), the «Обработать» buttons. Telegram: at once, after the webhook |
| 3 | **Upload**: markdown to object storage; the DB copy is cleared | `uploadSourceItem` | Hourly «intake» (max 200 per org), daily run (max 500 per run), «Обработать» |
| 4 | **Signals phase** (after «intake») of the hourly topics run, for each org in `shadow` / `on` | `runTopicsPipeline` → `runSignalsPhase` | **Every hour at :00 UTC** (`/api/cron/topics`), or «Запустить сейчас» on «Темы» |
| 4a | Eligible items: root items, `parse_status = complete`, created at most 7 days before the org's current switch-on, not scanned yet (or `deferred`, or `failed` with fewer than 3 attempts). Oldest first, max 200 per org per run, 3 in parallel | `runner.ts` | — |
| 4b | Gates without AI cost: exclusions → blocklist → bounce → out-of-office → calendar reply → automated sender (the last 4 for mail only) | `gates.ts` | — |
| 4c | AI call `topics.signal_extraction` with all the org's active codes (123 codes, ≈ 123k characters) | `extract-item.ts`, `prompt/extraction.ts` | Stops for the org when the daily AI budget is reached; the item stays `deferred` |
| 4d | Post-processing: drops (unknown code, evidence not in the author's own text, inbound-only / internal-only, date gates), outranks / merges, score and band | `postprocess.ts` | — |
| 4e | Store: `signal_instance`, `source_item_subject`, `source_item.signal_*` (status `done` / `skipped` / `deferred` / `failed`) | `extract-item.ts` | — |
| 5 | **Topics phase**: items with `signal_status = done`, same window, oldest first, one at a time, 200 / org / run → counterparty → hard reference key → candidates → AI matcher `topics.topic_match` → attach / new topic; closing, reopen, dormant / expired sweep; re-link of unresolved topics | `src/server/topics/resolve-phase.ts`, `resolver.ts`, `topic-store.ts` | Same hourly run, after «signals» |
| 6 | **Attention phase**: due topics (`next_attention_check_at ≤ now`, new, changed params) → profile, list («Сейчас / Сводка / Неделя»), escalations, cycle, card expiry (working days from `work_calendar_day`) | `src/server/topics/attention/` | Same hourly run, after «topics»; also right after every topic change |
| 7 | **Cards phase**: one open topic card per placed topic; AI `topics.card_writer` only on first placement / new cycle (≤ 40 / org / run); close / expire with the topic | `src/server/topics/cards/` | Same hourly run, after «attention». Cards are **hidden from users unless the org mode is `on`** |
| 8 | **Deals phase**: new signals of the last 30 days on topics (50 topics / run) → the org's stage rules → auto-create (score ≥ 7, high confidence, client resolved, no open deal of client + type) / `deal_proposal` card / forward move / `stage_confirmation` card / outcome / pause; every change journaled with topic, item, rule, evidence | `src/server/topics/deals/`, `src/server/deal-engine.ts` | Same hourly run, after «cards». **In `shadow`: dry run** — decisions and hidden cards are stored, deals are not changed. Without org stage rules the phase skips the org |
| 9 | **Deal state phase**: risk engine for touched deals (9 generic types, stage guards, conditions, clearing; new risk → forced card update, serious risk raises the topic to «Сейчас»), then `deals.state_summary` for dirty deals after the 10-min debounce (≤ 20 AI calls / org / run; fixed texts without AI for no data / won / lost) | `src/server/topics/deal-state/`, `src/server/deal-state.ts`, `src/server/deal-risks.ts` | Same hourly run, after «deals». State text and risks are **visible to users only in mode `on`** (deal board / drawer); the topic lists UI is phase 6 |

**Latency:** every message of an org in `shadow` / `on` gets signals in ≤ 1 hour (sync, parse and signals run in the same hourly run). The «intake» phase is skipped while a daily pipeline run is in progress (no double parse); the next hour catches up. Code: `src/server/topics/intake.ts`.

## 2. Switches

| Switch | Where | Values / default | Effect |
|---|---|---|---|
| Vercel plan | Vercel account | **Pro** required | Hobby rejects a deployment with an hourly cron |
| `CRON_SECRET` | Vercel env (Production) | 32 random bytes, base64 | Unset = every cron call is rejected (401); no run at all |
| `AI_GATEWAY_API_KEY` | Vercel env | key | Every AI call (parse + signals) |
| `DATABASE_URL`, storage vars (`R2_*`), `CREDENTIALS_ENCRYPTION_KEY` | Vercel env | — | DB; markdown in storage (signals read it there after upload); source credentials |
| `NEXT_PUBLIC_APP_URL` | Vercel env (build time) | public HTTPS origin | Telegram webhook registration on credential save |
| Crons | `vercel.ts` (and `ORCHESTRATION_CONFIG`) | daily `0 3 * * *`, topics `0 * * * *` | The two schedules |
| Migrations | `pnpm db:migrate` on the target DB **before** the deploy | `0000`–`0017` | Tables + registry seed (`0012`–`0014`, `0016`, `0017`) |
| Source automation | Sources → «Управление источниками организации» (owner) or `/settings` (admin): `automated_parsing_is_allowed` | Вкл (default) / Выкл | Off = the daily run does not sync / parse / upload this source → no signals from it |
| Model per process | `/settings` → «Процессы ИИ» → «Извлечение сигналов» (`topics.signal_extraction`) | default `google/gemini-2.5-flash` | Quality, cost, latency |
| Daily AI budget | `/settings` → «Использование ИИ» → «Дневной бюджет ИИ» | platform default 5 USD / day; org override | When reached, background AI stops for the org (parse too); items wait as `deferred` |
| Signals pack | `/settings` → «Сигналы» → org section → packs | `base` on / off | Off = no active code → the signals phase skips the org («no active signal codes») |
| Org code overrides | «Сигналы» → org section | none (R22) | Per-code stage / weight for one org. Keep empty unless a test needs it |
| Exclusions | Sources → «Исключения из анализа» (org owner) | list | Addresses / domains / chats never stored, parsed or sent to AI |
| Discovery blocklist | `/clients` blocklist (owner) | list | Gate 3: skips external authors on the list |
| Own-org identity | `/account` org profile + `api/org-identity` registry (owner) | names, sites, addresses | Parse-time attribution: inbound / outbound direction of every item |
| **Topics mode** | `/settings` → «Темы» → «Режим тем по организациям» | `off` (default) / `shadow` («Тень») / `on` («Включено») | `off`: org is not processed. `shadow`: engine runs and stores, users see nothing. `on`: same as shadow until phase 6 builds the UI. **Switching from `off` sets the 7-day history start** |

## 3. What the test environment cannot prove

| Item | Why not | Check at go-live (step) |
|---|---|---|
| Cron firing on schedule, `CRON_SECRET` from Vercel | Local runs use the manual buttons | T7, T9 |
| Hourly Vercel Workflow (`topics-pipeline.workflow.ts`) durability, function time limits | Only the manual run was used | T9 |
| Telegram webhook with the public URL | Local dev uses «Fetch» (getUpdates) | T6 |
| Real volume: hundreds of items per hour, the 200 / run cap, concurrency 3 | Small test data, the newest IN4COM items are older than the 7-day window | T10, M1 |
| Real cost per day vs the 5 USD budget, with the 123-code prompt | Only single items were run | T10, M3 |
| Several server instances: the 60-second registry / settings caches | One local process | T5 (wait ≥ 1 min after a change) |
| Signal quality on real, current IN4COM mail | Golden set not reviewed yet | B1–B4 |

## 4. Technical go-live steps

Do them in order. Each step has a check; do not go on when the check fails.

| # | Step | Check |
|---|---|---|
| T1 | Vercel **Pro** plan active; env vars of §2 set for Production (`CRON_SECRET` same value as used by any manual caller) | Vercel → Settings → Environment Variables lists them |
| T2 | `pnpm db:migrate` against the production `DATABASE_URL`; then `pnpm db:check` | Migration log ends with «migrations applied successfully»; `drizzle.__drizzle_migrations` has 18 rows (`0000`–`0017`) |
| T3 | Deploy | Vercel → Crons shows `/api/cron/daily` (`0 3 * * *`) and `/api/cron/topics` (`0 * * * *`) |
| T4 | «Модели»: «Синхронизировать» the catalog. «Процессы ИИ»: check the model of «Извлечение сигналов» and of the parse processes | The model is available and compatible (no warning on the process row) |
| T5 | «Сигналы» → pick the org → packs: `base` on; no overrides; **copy the stage-rule templates** and check the mapping S1–S5 / won / lost to the org's funnel stages. Wait ≥ 1 minute (cache) | Code list: «активно для организации: 144»; the org section lists the copied rules with the right target stages; «Экспорт в Markdown» opens |
| T5b | «Сигналы» → org section → risk stage guards; settings `deals.maxDeferralDays` / `deals.maxCreditLimitRub` if the org wants the «Жёсткие условия оплаты» risk | Guards only on the stages where each risk matters; empty guard = all stages |
| T5a | /deals → «Типы сделок» (org owner) | The 5 generic types exist; labels fit the business; rename or hide types the org does not use |
| T6 | Sources: every source connected (credentials «Configured ✓»), automation «Вкл»; Telegram: save the credentials once so the webhook registers | «Синхронизировать» returns new items; a test Telegram message appears in Sources within seconds |
| T7 | Press «Синхронизировать и обработать» per source once (the hourly «intake» takes over after T9; the daily run covers orgs in `off`) | Sources: new items with status «complete» |
| T8 | Exclusions, blocklist and own-org identity filled by the owner (B5) **before** switching on | Sources → «Исключения из анализа» shows the list; a test item from an excluded address is not stored |
| T9 | «Темы» → set the org to **`shadow`**. Then «Запустить сейчас» once (do not wait for :00) | «Запуски»: a row with status `success`, the org listed; phase «Загрузка и разбор» with `syncFailed = 0`; phase «signals» with `eligible > 0`, `done + skipped > 0`, `failed = 0` |
| T10 | Wait for 2–3 hourly runs | «Запуски» shows one row per hour; `eligible` goes down to the new-item rate; no row stays `running` > 120 min |
| T11 | «Сигналы сообщений» on «Темы»: open 10 items with signals and 10 skipped items | Evidence quotes are real text of the author; skip reasons make sense (automated, out-of-office, blocklist …) |
| T11b | «Темы (отладка)»: open 10 topics in «Сейчас» / «Сводка» | The «Внимание» section explains the list in plain Russian; card text follows §9.1 (headline «Компания — действие, цель», ≤ 3 steps, roles not names, no invented dates); no topic card is visible on the dashboard while the org is `shadow` |
| T11a | «Темы (отладка)» on «Темы»: phase «topics» in «Запуски» has `failed = 0`; open 10 topics | One business question per topic (§2.1); reminders joined to their request; two invoices = two topics; counterparty linked to the right client / contact; titles «Компания — вопрос» |
| T13 | After B7 (`on`): log in as an org member; open the dashboard | Tabs «Темы» / «История карточек»; «Сейчас» shows the open topic cards with actions; «Принять» makes a task; «Отклонить» asks for a reason code; «Создать заказ» opens the order dialog; the company page has «Темы»; «Найти в источниках» / Magic buttons are gone |
| T12 | «Использование ИИ»: filter process «Извлечение сигналов» | Cost per item and per day as expected (§6 M3); no budget block for the org |

## 5. Business go-live steps

| # | Step | Who | Done when |
|---|---|---|---|
| B1 | **Golden set**: ≈ 200 real items + synthetic items for rare codes on «Темы» → «Эталонный набор»; LLM pre-annotation, then human correction of the expected codes | IN4COM reviewers + platform admin | Every item reviewed (`reviewed`) |
| B2 | **Signal text review**: the RU labels, definitions, cues and examples of the 144 active codes («Экспорт в Markdown» from «Сигналы» as the review copy) | IN4COM reviewers | Corrections entered in «Сигналы» (each save = a new registry version) |
| B3 | **Eval** on «Оценка извлечения (eval)» with the chosen model | Platform admin | Gate passed: precision ≥ 0.85 on P6 / P8 codes, recall ≥ 0.7 (codes with < 5 occurrences = «мало данных»); cost per item recorded |
| B4 | **Shadow review**: 1–2 weeks of `shadow` on real traffic; reviewers read «Сигналы сообщений» and «Темы (отладка)» daily: missed situations, false signals, wrong skips, topics merged or split wrongly (fix with «Объединить с…» / «Отвязать сообщение» and note the case) | IN4COM reviewers | Agreed list of fixes done (texts, exclusions, blocklist, own-org identity); topic grouping precision ≥ 0.9 / recall ≥ 0.8 on the golden set |
| B5 | **Noise sources** decided by the owner: newsletters, service mailboxes, private chats → «Исключения из анализа»; irrelevant companies → blocklist; own names / domains → own-org identity | IN4COM owner | Lists filled before T9 |
| B6 | **Budget** agreed: daily AI USD per org from the measured cost (M3) × expected volume | Product owner | Org override set on «Дневной бюджет ИИ» if 5 USD is not enough |
| B7 | **Switch to `on`** («Темы» → org → «Включено») after the shadow review: users get the dashboard tabs «Сейчас / Сводка / Неделя / Все темы», the topic drawer, «Темы» tabs, agent deals, deal state and risks; the old Custom-rule cards (incl. «Telegram orders», R7) and the name-based deal discovery stop for the org | Product owner | Shadow review (B4) accepted |
| B8 | **Tuning loop** for 4 weeks after `on`: weekly read of reject reasons and missed items → registry edits in «Сигналы» → eval | IN4COM reviewers + platform admin | Go-live sign-off: Q23 targets for 2 consecutive weeks |

## 6. Monitoring after the switch-on

| # | Check | Where | Normal |
|---|---|---|---|
| M1 | Hourly runs | «Темы» → «Запуски» | One `success` row per hour; per-org phase «signals» without errors |
| M1d | Deal state + risks | Deal drawer (mode `on`) or «Темы (отладка)» → «Сделка»; «Использование ИИ» process of `deals.state_summary` | States answer «Где мы? Чего ждём? Что мешает? Что дальше?»; few REJECTED versions; risks match reality (precision ≥ 0.8) |
| M1c | Deals | /deals: badge «создал агент»; «Происхождение» tab; «Темы (отладка)» → «Сделка» decision log | Every agent deal and move has a topic and an evidence quote; few «Отменить» undos; proposals decided within days |
| M1b | Cards | «Темы (отладка)» card column; «Использование ИИ» process «Текст карточки темы» | Writer calls only on new cycles; duplicate cards per topic < 5 % (exit gate of phase 4) |
| M1a | Topics | «Темы (отладка)» counts per status | New topics per day in line with the counted signals; few `context`-only attaches; no growth of unresolved counterparties |
| M2 | Item status mix | «Темы» → «Сигналы сообщений» (stats) | Most items `done` or `skipped`; `failed` near 0; `deferred` only on budget days |
| M3 | Cost | «Использование ИИ» (process «Извлечение сигналов») | ≈ 1–3 cents per item with the 123-code prompt (re-measure in B3) |
| M4 | Budget hits | «Использование ИИ» → «Дневной бюджет ИИ»; usage events `blocked` | Rare; when frequent → raise the budget or narrow sources (B5) |
| M5 | Daily pipeline | Sources page / `pipeline_run` | `success` every day; parse backlog not growing (cap 200 / run) |

Read-only SQL for the Neon console (optional):

```sql
-- Item status per org, last 7 days
SELECT signal_status, signal_reason, count(*) FROM source_item
WHERE organization_id = '<org>' AND signal_scanned_at > now() - interval '7 days'
GROUP BY 1, 2 ORDER BY 3 DESC;

-- Top codes found
SELECT code, count(*) FILTER (WHERE counted) AS counted, count(*) AS total FROM signal_instance
WHERE organization_id = '<org>' AND created_at > now() - interval '7 days'
GROUP BY 1 ORDER BY 2 DESC;
```

## 7. Stop and roll back

| Situation | Action | Effect |
|---|---|---|
| Wrong signals, cost too high, any doubt | «Темы»: org → `off` | The next hourly run skips the org at once. Stored signals stay. Switching on again later sets a **new** 7-day history start |
| Cost spike | Lower the org budget on «Дневной бюджет ИИ» | Background AI stops for the org for the day; items wait as `deferred` |
| One noisy sender / chat | «Исключения из анализа» | Not stored / not analysed from now on; already parsed items need a re-parse to drop (O4) |
| Bad code text | Edit the code in «Сигналы» (new version), or set its stage to `onHold` | Next items use the new text; stored signals are not re-scored (re-run «Извлечь заново» per item if needed) |
| Wrong agent deals | Org setting `deals.autoCreateEnabled = false` (proposals only), or set the org back to `shadow` (deals: dry run) | No new automatic deals; existing ones can be undone with «Отменить» |
| Whole engine | Remove the topics cron from `vercel.ts` and redeploy | No hourly run for any org |

## 8. Re-checks after a change

- After a registry change: wait ≥ 1 minute (cache), then «Извлечь заново» on 2–3 known items.
- After a model change on «Процессы ИИ»: run the eval (B3) again before keeping it.
- After adding an exclusion: check the next sync stores nothing from it.

## 9. Open points

| # | Point | Impact | Proposal |
|---|---|---|---|
| O1 | ~~Mail / Google Chat / Drive synced and parsed only once a day~~ | — | **Done 2026-11-14:** phase «intake» (sync → parse → upload per org) runs first in the hourly topics run. Watch the run duration: the whole hourly run is one workflow step (parse ≤ 50 + signals ≤ 200 items per org) |
| O2 | The «Обработать» button on Sources runs parse → upload only (spec §13 says it should also run signals) | Manual processing does not give signals until the next hourly run | The separate admin action «Извлечь сигналы» exists; join them when the topics UI is built |
| O3 | 15 active process codes (watchdogs, CRM trends) have no process yet | They never fire until phase 8 | None now |
| O4 | Removing an exclusion does not bring items back; adding one does not remove parsed items | Manual re-parse needed | Accept for MVP |
| O5 | Attachments (child items) are not read by extraction | Signals only from the message body | Revisit with real data |
| O6 | Prompt is 123 codes / ≈ 123k characters | Cost and latency per item | Measure in B3; two-pass mode (block classifier) exists in the spike if needed |

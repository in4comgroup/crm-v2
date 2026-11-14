# Topics — signals automation: go-live runbook

Status: **draft, 2026-11-14.** Covers what is built: phases 0–2 (foundations, signals registry, signal extraction). Extend it when phases 3–6 add topics, cards and deal automation.

Purpose: one step-by-step list of what to switch on / off and what to check, so the whole signals flow works in a **new environment** (the first production deployment). Today there is only one environment and one DB (the DB in `.env`, a test DB). Some parts cannot be tested there (§3), so they must be checked at the switch-on.

Related: spec [01-specification.md](01-specification.md) (§5 extraction, §13 operations) · plan [03-development-plan.md](03-development-plan.md) · registry [05-signals-registry.md](05-signals-registry.md) · decisions [02-open-questions.md](02-open-questions.md) (R22, R23).

---

## 1. The flow, end to end

| # | Step | Code | Trigger and timing |
|---|---|---|---|
| 1 | **Sync**: new messages from the source become `source_item` rows. Excluded addresses / chats are not stored (R18) | `src/server/sync/*`, `src/server/ingest/telegram.ts` | Mail (Nylas, IMAP), Google Chat, Drive: **daily run at 03:00 UTC** (`/api/cron/daily`), or the «Синхронизировать» button. Telegram: the webhook, at once |
| 2 | **Parse**: markdown, junk skip, own-org attribution, exclusion guard (`parse_status`) | `parseSourceItem` | Daily run (max 200 items per run), the «Обработать» buttons. Telegram: at once, after the webhook |
| 3 | **Upload**: markdown to object storage; the DB copy is cleared | `uploadSourceItem` | Daily run (max 500 per run), «Обработать» |
| 4 | **Signals phase** of the hourly topics run, for each org in `shadow` / `on` | `runTopicsPipeline` → `runSignalsPhase` | **Every hour at :00 UTC** (`/api/cron/topics`), or «Запустить сейчас» on «Темы» |
| 4a | Eligible items: root items, `parse_status = complete`, created at most 7 days before the org's current switch-on, not scanned yet (or `deferred`, or `failed` with fewer than 3 attempts). Oldest first, max 200 per org per run, 3 in parallel | `runner.ts` | — |
| 4b | Gates without AI cost: exclusions → blocklist → bounce → out-of-office → calendar reply → automated sender (the last 4 for mail only) | `gates.ts` | — |
| 4c | AI call `topics.signal_extraction` with all the org's active codes (123 codes, ≈ 123k characters) | `extract-item.ts`, `prompt/extraction.ts` | Stops for the org when the daily AI budget is reached; the item stays `deferred` |
| 4d | Post-processing: drops (unknown code, evidence not in the author's own text, inbound-only / internal-only, date gates), outranks / merges, score and band | `postprocess.ts` | — |
| 4e | Store: `signal_instance`, `source_item_subject`, `source_item.signal_*` (status `done` / `skipped` / `deferred` / `failed`) | `extract-item.ts` | — |
| 5 | Topics, attention, cards, deals, deal state | `phases.ts` | **Not built** (stubs, phases 3–5a). Users see nothing from the engine yet, also in mode `on` |

**Latency today:** a Telegram message gets signals in ≤ 1 hour. A mail / Google Chat / Drive message gets signals only after the next daily run parses it, so up to ≈ 25 hours. See open point O1 (§9).

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
| T5 | «Сигналы» → pick the org → packs: `base` on; no overrides; copy the rule templates when phase 5 needs them. Wait ≥ 1 minute (cache) | Code list: «активно для организации: 144»; registry version shown; «Экспорт в Markdown» opens |
| T6 | Sources: every source connected (credentials «Configured ✓»), automation «Вкл»; Telegram: save the credentials once so the webhook registers | «Синхронизировать» returns new items; a test Telegram message appears in Sources within seconds |
| T7 | Wait for the first daily run (03:00 UTC) or press «Синхронизировать и обработать» per source | Sources: new items with status «complete»; `pipeline_run` row `success` |
| T8 | Exclusions, blocklist and own-org identity filled by the owner (B5) **before** switching on | Sources → «Исключения из анализа» shows the list; a test item from an excluded address is not stored |
| T9 | «Темы» → set the org to **`shadow`**. Then «Запустить сейчас» once (do not wait for :00) | «Запуски»: a row with status `success`, the org listed, phase «signals» with `eligible > 0`, `done + skipped > 0`, `failed = 0` |
| T10 | Wait for 2–3 hourly runs | «Запуски» shows one row per hour; `eligible` goes down to the new-item rate; no row stays `running` > 120 min |
| T11 | «Сигналы сообщений» on «Темы»: open 10 items with signals and 10 skipped items | Evidence quotes are real text of the author; skip reasons make sense (automated, out-of-office, blocklist …) |
| T12 | «Использование ИИ»: filter process «Извлечение сигналов» | Cost per item and per day as expected (§6 M3); no budget block for the org |

## 5. Business go-live steps

| # | Step | Who | Done when |
|---|---|---|---|
| B1 | **Golden set**: ≈ 200 real items + synthetic items for rare codes on «Темы» → «Эталонный набор»; LLM pre-annotation, then human correction of the expected codes | IN4COM reviewers + platform admin | Every item reviewed (`reviewed`) |
| B2 | **Signal text review**: the RU labels, definitions, cues and examples of the 144 active codes («Экспорт в Markdown» from «Сигналы» as the review copy) | IN4COM reviewers | Corrections entered in «Сигналы» (each save = a new registry version) |
| B3 | **Eval** on «Оценка извлечения (eval)» with the chosen model | Platform admin | Gate passed: precision ≥ 0.85 on P6 / P8 codes, recall ≥ 0.7 (codes with < 5 occurrences = «мало данных»); cost per item recorded |
| B4 | **Shadow review**: 1–2 weeks of `shadow` on real traffic; reviewers read «Сигналы сообщений» daily: missed situations, false signals, wrong skips | IN4COM reviewers | Agreed list of fixes done (texts, exclusions, blocklist, own-org identity) |
| B5 | **Noise sources** decided by the owner: newsletters, service mailboxes, private chats → «Исключения из анализа»; irrelevant companies → blocklist; own names / domains → own-org identity | IN4COM owner | Lists filled before T9 |
| B6 | **Budget** agreed: daily AI USD per org from the measured cost (M3) × expected volume | Product owner | Org override set on «Дневной бюджет ИИ» if 5 USD is not enough |
| B7 | **Switch to `on`**: only when the UI of phase 6 exists; until then `shadow` and `on` behave the same | Product owner | — |

## 6. Monitoring after the switch-on

| # | Check | Where | Normal |
|---|---|---|---|
| M1 | Hourly runs | «Темы» → «Запуски» | One `success` row per hour; per-org phase «signals» without errors |
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
| Whole engine | Remove the topics cron from `vercel.ts` and redeploy | No hourly run for any org |

## 8. Re-checks after a change

- After a registry change: wait ≥ 1 minute (cache), then «Извлечь заново» on 2–3 known items.
- After a model change on «Процессы ИИ»: run the eval (B3) again before keeping it.
- After adding an exclusion: check the next sync stores nothing from it.

## 9. Open points

| # | Point | Impact | Proposal |
|---|---|---|---|
| O1 | **Mail / Google Chat / Drive are synced and parsed only once a day** (03:00 UTC). The hourly run reads only parsed items | Signals for mail arrive up to ≈ 25 h late | Add «sync + parse» for orgs in `shadow` / `on` to the hourly run (before the signals phase), or run the daily pipeline hourly. Decision needed before go-live |
| O2 | The «Обработать» button on Sources runs parse → upload only (spec §13 says it should also run signals) | Manual processing does not give signals until the next hourly run | The separate admin action «Извлечь сигналы» exists; join them when the topics UI is built |
| O3 | 15 active process codes (watchdogs, CRM trends) have no process yet | They never fire until phase 8 | None now |
| O4 | Removing an exclusion does not bring items back; adding one does not remove parsed items | Manual re-parse needed | Accept for MVP |
| O5 | Attachments (child items) are not read by extraction | Signals only from the message body | Revisit with real data |
| O6 | Prompt is 123 codes / ≈ 123k characters | Cost and latency per item | Measure in B3; two-pass mode (block classifier) exists in the spike if needed |

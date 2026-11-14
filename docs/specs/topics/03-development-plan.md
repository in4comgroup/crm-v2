# Topics — development plan (final)

Status: **final, 2026-11-13. Progress: phases 0–5 built (not deployed); phase 5a next.** Rebased on this repository (crm-v2) after the review of 2026-11-13.
Spec: [01-specification.md](01-specification.md) · Decisions: [02-open-questions.md](02-open-questions.md) (§ F = R1–R24) · Registry: [05-signals-registry.md](05-signals-registry.md) · Attention: [06-attention-engine.md](06-attention-engine.md)

The plan of 2026-11-10 assumed another copy of the product (Yandex models, own PostgreSQL, K8s CronJob, `llm_usage`). It is replaced by this document. Its business content (phases, scope, gates) is kept.

## Assumptions

- One full-stack developer with AI assistance. Estimates are working weeks incl. tests, migrations and docs.
- **Pilot = IN4COM** (org `1dNkC4rBtl9FEvnK95Svlfs63oSU57Ni`). One **generic** signal set for every org (pack `base`, R21 + R22): no vertical codes, no org-specific signals or rules. IN4COM gets signals by switching the `base` pack on in «Сигналы» (no overrides): every code whose own stage is `active` is in the prompt (144 active codes, 123 of them read by the extraction prompt — R23). Specifics for tests are added later only if needed (R22). The agency is the second pilot (phase 9).
- IN4COM business users give ≈ 3–4 days: signal text and phrase review, golden-set review, result assessment. Synthetic test messages are allowed.
- Stack (R1, R2): Next.js on Vercel, Neon Postgres, Drizzle migrations, Vercel Cron + Workflow, all LLM calls through the AI layer (Vercel AI Gateway), object storage through `@/server/storage`.

## Prerequisites

| # | Item | Why | Owner |
|---|---|---|---|
| P1 | **Vercel Pro plan** | The topics cycle runs every 60 minutes (R3); Vercel Hobby allows cron jobs only once a day | Product owner |
| P2 | `CRON_SECRET` set on Vercel | All cron routes require it in every environment | Product owner |
| P3 | IN4COM people and data access for the golden set (≈ 200 items) | Quality gates of phases 2–5 | Product owner + IN4COM |
| P4 | Per-org AI budget agreed: 5 USD / day default (R4) | Cost guard for background AI | Decided |

## Current state (2026-11-13) — what we build on

| Area | Exists | Use in topics |
|---|---|---|
| AI layer | `src/server/ai`: 23 processes (incl. 5 topics processes, group «Темы и сигналы»), daily AI budget per org (5 USD default), per-process model choice («Процессы ИИ»), usage ledger `ai_usage_event` with exact USD cost, markup, model policy, model registry («Модели»), lint boundaries | Every topics LLM step is a new **process**; cost per item from `ai_usage_event.ref` |
| Sources / parse | Sync for Nylas, IMAP, Google Chat / Drive, Telegram (webhook), Drop Off, WhatsApp, AI chat; `parseSourceItem` with `metadata_json` analysis, junk skip, own-org attribution; markdown in storage after upload | Input of signal extraction. Markdown read with `getTextObject(markdown_r2_key)` (the DB copy is cleared after upload) |
| Matching | `companyMatchKey` / `personMatchKey`, discovery, blocklist, own-org identity | Counterparty resolution, gates |
| Cards | `card` + `card_client` / `card_user` / `card_contact`, accept → task, `new_order` → order dialog, process `cards.generation` (one card per item, Custom rules) | Keep table and junctions; add topic link, kind, status. Old generation removed in phase 12 |
| Deals | `deal`, `deal_contact`, per-org funnel stages (incl. pre-pipeline), `deal_activity` journal, kanban | Deal bridge writes journaled moves through org-explicit helpers |
| Deal discovery | Process `deals.discovery` (name match); since phase 0 it journals every stage move (`deal_activity`) | Replaced in phase 5, removed in phase 12 |
| Mock agent | Removed in phase 0 (R9) | — |
| Orchestration | Daily cron `0 3 * * *` → `runDailyPipeline` (model catalog sync + cost check, sync → parse → upload), `pipeline_run`; **hourly** cron `0 * * * *` → `runTopicsPipeline` (phase «signals» built in phase 2; the others are stubs), `topics_run` | Phases 3–5a fill the stubs |
| DB process | Drizzle migrations `0000`–`0021` (topics: `0010` foundations, `0011`–`0014` + `0016`–`0017` signals registry, `0015` signal extraction, `0018` topics, `0019` attention + cards, `0020` production calendar 2026–2027, `0021` deal bridge), reference data in migrations | Next topics migration: **0022** |
| Topics foundations (phase 0) | `org_setting` (`topics.enabled`, budget override), system actor «Агент», «Темы» tab (modes, runs, golden set, model spike) | Used by every later phase |
| Signals registry (phase 1) | DB registry (one generic pack; 158 codes after `0017`: 144 `active`, 8 `parked`, 6 `gated`, no retired codes; attributes, relations, 9 risk types, rule templates), `getEffectiveSignals(orgId)`, «Сигналы» tab with the full editor, Markdown export (preset mechanism kept, no presets defined — R22) | Extraction prompt reads it |
| Signal extraction (phase 2) | `src/server/topics/signals/` (gates, extraction, post-processing, storage, hourly runner, manual action), `signal_instance`, `source_item_subject`, `source_item.signal_*`, `analysis_exclusion` (owner UI on Sources), `src/lib/ru-mail/`, eval runner with stored metrics, signal review on «Темы» | Input of topic resolution (phase 3): counted instances + subjects per item |
| Access | Sign-in gate `src/proxy.ts`; routes check the session; `"use server"` modules are session-bound | Engine code is `server-only` and takes `organizationId` explicitly |

Missing today: deal state / risks (phase 5a), the user UI (lists «Сейчас / Сводка / Неделя», topic drawer — phase 6). (Thread keys, topics, the hourly intake, attention, the production calendar, topic cards, deal types and the deal bridge are built — phases 3–5.)

## Overview

| Phase | Name | Weeks | Output | Visible to users | Status |
|---|---|---|---|---|---|
| 0 | Foundations | 1.5 | Mock agent removed, deal discovery journaled, per-org AI budget, `org_setting` + topics flag, system actor, AI processes, hourly cycle skeleton, golden set, model spike | Admin only | ✅ built |
| 1 | Signals registry | 3 | DB registry (all parameters, one pack — R21), seed v1 by migration, «Сигналы» tab with **full editor**, per-org activation / overrides, Markdown export | Admin only | ✅ built |
| 2 | Signal extraction | 2.5 | Gates, `topics.signal_extraction`, scoring, storage, exclusions, forwarded mail, eval runner | No (shadow) | ✅ built |
| 3 | Topic engine | 3 | `thread_key`, topics, resolver + `topics.topic_match`, lifecycle, journal, teardown / reparse, debug page | No (shadow) | ✅ built |
| 4 | Attention and cards | 2 | Attention engine (06, A1–A8), production calendar, card per topic with kinds, `topics.card_writer` | No (shadow) | ✅ built |
| 5 | Deal bridge | 2 | Deal types, stage rules, auto-create + proposals, journaled moves, «Происхождение» | No (shadow) | ✅ built |
| 5a | Deal state and risks | 1.5 | `deals.state_summary`, risk engine, «Есть риски» | No (shadow) | next |
| 6 | UI and pilot | 2 | «Сейчас / Сводка / Неделя», topic drawer, company / deal tabs, «Создать заказ» on order topics, IN4COM switch-on | **Yes (IN4COM)** |  |
| **MVP** | | **≈ 17.5** | | |  |
| 7 | Delivery | 2 | Email digest, Telegram to staff, P6 evening reminders and daily limit | Yes |  |
| 8 | System-of-record signals and watchdogs | 2.5 | Order-rhythm topics for IN4COM, then no-response / countdown / contract expiry | Yes |  |
| 9 | Agency codes (second pilot) | 2 | 05d codes added to the one pack by migration, agency funnel and 26 risks, area 0, win estimate | Yes |  |
| 10 | Orders link | 1 | `ORDER_CONFIRMED` from order status, topic ↔ order link both ways | Yes |  |
| 11 | External market signals | 2 | `topics.external_search` (gateway web search) → external signal instances | Yes |  |
| 12 | Cleanup of old logic | 1 | Remove Custom-rule cards, `cards.generation`, `deals.discovery`; contract migration | — |  |

Phases 2–5a run in **shadow mode** (org flag `topics.enabled = shadow`): the engine writes data, users see nothing. Quality gates decide when phase 6 switches IN4COM to `on`.

Critical path: phase 0 (golden set + spike) → 1 → 2 → 3 → 4 → 5 → 5a → 6.

## Cost estimate (per meaningful item)

| Step | Process | Input tokens | Calls |
|---|---|---|---|
| Signal extraction | `topics.signal_extraction` | ≈ 15k (static code block, cached prefix) + item | 1 (2 if two-pass) |
| Topic match | `topics.topic_match` | ≈ 2–4k | 0–1 (only without a hard key) |
| Card text | `topics.card_writer` | ≈ 2–3k | 0–1 (NEW / UPDATE) |
| Deal state | `deals.state_summary` | ≈ 3–5k | 0–1 (deal topics, debounced) |

At Flash-class prices (≈ $0.1–0.3 / M input tokens) this is ≈ $0.005–0.01 per item: 300 items / day ≈ $1.5–3 / day, inside the 5 USD budget. The phase-0 spike replaces these numbers with measured ones (`ai_usage_event` grouped by `ref`).

---

## Phase 0 — Foundations (1.5 weeks)

1. **Remove the mock deal agent (R9):** delete the auto-apply in `src/server/deals-mock.ts` and `/api/deals/proposals` (keep only what the board still needs for display); deal discovery writes `deal_activity` for every stage move.
2. **Per-org daily AI budget (R4)** — in the AI layer, spec update in `docs/specs/models/`: platform setting `ai.budget.daily_usd` (default 5) + per-org override; runtime pre-check on today's cost of the org (`ai_usage_event`); background processes stop with `AiBudgetExceededError`, interactive ones run and warn; budget line on «Использование ИИ» (admin) and `/account` (owner).
3. **Per-org settings store:** migration `org_setting` (org id, key, jsonb, change log), mirroring `platform_setting`; key `topics.enabled = off | shadow | on` (default `off`); admin control per org.
4. **System actor:** per-org user «Агент» for automatic writes (Q14), created lazily, hidden from member lists and pickers, never a better-auth member with rights.
5. **AI processes (R2):** group «Темы и сигналы» in `src/server/ai/processes.ts`: `topics.signal_extraction`, `topics.signal_block_classifier` (only if two-pass), `topics.topic_match`, `topics.card_writer`, `deals.state_summary` (all background, `structured_output`). Every call passes `ref` (`sourceItemId`, `topicId`, `dealId`).
6. **Hourly cycle (R3):** `src/server/topics/` (org-explicit, `server-only`) and the engine-agnostic `runTopicsPipeline({ trigger })` in `src/server/orchestration/` (no-op for `off` orgs); hourly cron `/api/cron/topics` (`0 * * * *`, `CRON_SECRET`) in `vercel.ts` + `src/server/orchestration/config.ts` → workflow `src/workflows/topics-pipeline.workflow.ts` (spec §13); run log (counts per phase, errors); manual «Run now» for the admin.
7. **Golden set:** ≈ 200 IN4COM root items (anonymised export inside the app, admin only) + synthetic items for rare codes and for every spec §2.1 example (marked `synthetic`); LLM pre-annotation; IN4COM review together with the generic signal phrases (R22; the former pack draft 04 is deleted).
8. **Model spike:** 50 golden items through 2–3 gateway models on `topics.signal_extraction` (switched on «Процессы ИИ»), single-pass vs two-pass; measure codes vs the annotation, tokens, cost, latency, structured-output failures.

Exit: mock agent gone; budget live; flag, actor and hourly cycle deployed (no effect for `off` orgs); spike report with chosen model, prompt strategy and cost per item; IN4COM phrase confirmations collected.

**Status 2026-11-13 — code done, not deployed; tasks 7–8 wait for IN4COM (P3).**

| Task | State |
|---|---|
| 1 Mock agent | Done: `/api/deals/proposals` + generator removed; deal discovery writes `deal_activity` for every stage change |
| 2 AI budget | Done and live-tested: `src/server/ai/budget.ts`, spec `docs/specs/models/07-daily-budget.md`, admin block «Дневной бюджет ИИ», owner warning |
| 3 Org settings | Done: `org_setting` (+ log), `src/server/org-settings.ts`, `topics.enabled`; migration `0010_topics_phase0_foundations` applied |
| 4 System actor | Done: `agent-<orgId>` («Агент», role `agent`, banned, not a member), hidden from user lists |
| 5 AI processes | Done: 5 processes in group «Темы и сигналы» |
| 6 Hourly cycle | Done and tested end to end (shadow org → 6 stub phases, actor created once, `topics_run` row): cron `/api/cron/topics` `0 * * * *`, workflow, «Темы» tab with modes, runs, «Запустить сейчас». Needs the Vercel Pro plan (P1) |
| 7 Golden set | Tools done: sample real items, synthetic items, JSON editor for the expected answer, LLM pre-annotation (on + review codes). **Waiting:** IN4COM reviewers fill and check the set |
| 8 Model spike | Tools done: batched runs per model (switch the model on «Процессы ИИ» between runs), single / two-pass, live / review code sets, report (failures, latency, tokens, cost, precision / recall per code). Smoke test on 2 real IN4COM items: both correct, ≈ 17.4k input tokens, ≈ $0.0075 per item with `google/gemini-2.5-flash`. **Waiting:** a reviewed golden set for precision / recall |

Measured prompt size (catalog v0: 90 codes, 49 "on" in the prompt): system prompt 55.7k characters (≈ 17k tokens) for the live set, 81.5k for live + review. The phase-0 cost estimate above holds.

Follow-ups found in phase 0 (carried into later phases):
- ~~Anti-cues of "on" codes name some "review" codes (e.g. `PREORDER_REQUESTED`, `STOCK_AVAILABILITY_REQUEST`), which the live prompt does not contain.~~ Mostly resolved by R22: the live prompt now carries every `active` code (incl. `STOCK_AVAILABILITY_REQUEST`). Anti-cues that still name `onHold` / `parked` codes (e.g. `PREORDER_REQUESTED`) can return unknown codes; they are dropped and counted.
- The golden set copies the item text into `topics_golden_item.text` (real client text in a second table; same tenant, admin only). Teardown / reparse integration (phase 3, task 7) must also clean or detach golden items; anonymised export is not built. *(Phase 3 task 7: golden items do not reference topics; a teardown detaches them through the FK `source_item_id → set null` and keeps the frozen `text` — clean-up of that text stays open; a reparse does not touch them.)*
- ~~`catalog-v0.ts` stop-gap~~ — done in phase 1: the prompt builder, golden set and spike read the DB registry (`getEffectiveSignals`); `catalog-v0.ts` and its converter are deleted.
- Agent users stay in `user` after their org is deleted (no FK to the org); harmless (banned, no membership), clean up with org deletion later.

## Phase 1 — Signals registry (3 weeks)

**Status 2026-11-13 — built, not deployed.**
- Migrations (all applied): `0011_signal_registry` (13 tables); `0012_signals_registry_v1` (generated seed from 05a–05c: 165 codes + 11 retired, 26 attributes, 61 relations, 9 risk types, 25 rule templates; version 1); `0013_signals_registry_v2_fixes` (5 rows that broke the registry rules; version 2); `0014_signals_single_pack` (**R21: one pack** — «Дистрибуция» merged into `base`; version 3); `0016_signals_generic_registry` (**R22: generic registry** — 7 alcohol-only codes hard-deleted with their relations, rule templates and org overrides; blocks DS1–DS7 → O–U with neutral labels; all texts, risk types and the pack description neutral; deal types `listing` / `new_location` / `tender` / `supply_agreement` / `renewal`; version 4 on a fresh DB); `0017_signals_activate_onhold_drop_retired` (**R23** — the 35 `onHold` codes become `active`, the 11 retired codes are deleted; version 5 on a fresh DB). 05c and the seed generator `tools/topics/` are deleted.
- Server `src/server/signals/`: registry read + effective parameters per org, validation of 05 §7 (Russian messages), versioned saves (one batch: rows + version + change log), preset mechanism (no presets defined since R22; `distribution-pilot` removed), rule-template copy, Markdown export. API `api/admin/signals*`.
- Tab «Сигналы»: code table with filters and org columns, full editor, org section (packs, stage rules, risk guards), platform sections, history, export.
- The extraction prompt (spike / golden set) reads `getEffectiveSignals(orgId)`; the temporary catalog of phase 0 is deleted. Live prompt for IN4COM: ~~50 codes, ≈ 57k characters (≈ 18k tokens)~~ since R22 / R23 every `active` code of `base`: 123 codes in the prompt, **123k characters** (measured 2026-11-14; ≈ 2.2× the phase-0 prompt — cost per item to re-measure in the next eval run).
- Whole-registry check (codes, risk types, relations; re-run 2026-11-14 after `0017`): 0 errors.
- **Open:** IN4COM review of the generic texts and the English supplier cues (task 6). Admin steps in «Сигналы» for IN4COM: switch the `base` pack on (no overrides; done on the dev DB, where all earlier IN4COM overrides were deleted), copy the rule templates (map S1–S5 / won / lost to the IN4COM funnel).


1. **Migration (registry tables):** packs; `signal_category` with all fields of 05 §2–§4 incl. the R1 additions (`family`, `relevance_days`, `cues_prompt_ru`, `synonyms_ru`, `anti_cues_ru`, `example_ru`, `counter_example_ru`, `trigger_rule`, English cues); relations (`closes`, `outranks`, `dampens`, …) with pack-level changes allowed (R12); per-org pack activation and code overrides; per-org `signal_stage_rule`; `deal_risk_type` + per-org risk activation / stage guards; taxonomy version + change log.
2. **Seed v1 (R11):** custom migration with fixed ids and `ON CONFLICT DO NOTHING`, generated once from the reviewed catalogs: `base` (IN4COM "on" codes `active`, the rest `onHold` / `parked`) and `distribution` (later merged — R21 — and made generic — R22, `0016`); ~~IN4COM activation~~; always-P8 list and weights from the pack decisions (`ORDER_REQUESTED` = 5, `SUPPLIER_DELIVERY_DELAY` = risk at 5). The agency pack is **not** seeded (R5). After this migration the DB is the master.
3. **Server:** `src/server/signals/` — cached registry read per org (effective parameters), validation on save (05 §7, with R12), version bump, change log.
4. **Settings tab «Сигналы»** (platform admin): registry table with filters (pack, block, stage, profile, org status, search); **full editor** for every field of a code (RU texts, cues, anti-cues, examples, relations, trigger rule); per-org activation and overrides; stage rules editor; risk types editor; validation messages; version history.
5. **«Экспорт в Markdown»:** the current registry with all parameters, plus the selected org's activation, overrides, stage rules and risks.
6. RU texts and English supplier cues (R20) for every `active` code (generic, R22); IN4COM sign-off.

Exit: seed applies on an empty DB and on the dev DB; editor round trip (edit → validate → version → export); IN4COM signs off the texts of all active codes.

## Phase 2 — Signal extraction (2.5 weeks)

**Status 2026-11-14 — built, not deployed.** Migration `0015_topics_phase2_signals` (applied to the dev DB). Unit tests: `pnpm test` (vitest, new).

| Task | State |
|---|---|
| 1 RU / EN library | Done: `src/lib/ru-mail/` (quotes, reply prefixes, forwards, bounce + message ids, out-of-office + return date + deputy, calendar replies, money parser, freemail, token-anywhere automated sender), unit-tested |
| 2 Exclusions (R18) | Done: `analysis_exclusion` + owner section «Исключения из анализа» on Sources («Управление источниками организации»); filters at sync (IMAP, Nylas, Google Chat; Telegram ignores the chat), WhatsApp keeps only a placeholder row, parse-time guard (`parse_status = skipped`, `excluded: …`), engine gate 3a. Details: `src/app/AGENTS.md` |
| 3 Forwarded messages | Done: Telegram `forwardOrigin` stored at ingest; mail forward headers detected; envelope `forwardedBy` / `originalAuthor` |
| 4 Migration | Done: `signal_instance`, `source_item_subject`, `source_item.signal_*` + `thread_key` (filled in phase 3), `analysis_exclusion` (planned as a separate migration, merged into `0015`), `topics_eval_run` |
| 5 Extraction | Done: prompt from the org's effective registry (unchanged from phase 1), input = the `## Content` section of the parsed markdown only (the parser summary is never evidence) |
| 6 Post-processing | Done: `postprocess.ts` (pure, unit-tested) — spec §5.4 rules 1–7 incl. retired → successor, evidence in the author's own text (not quoted history), direction cross-check with the parse-time attribution, date gates, outranks / merges, attributes on the dominant instance (06 A2), trend ceiling. R19 needs topics → phase 3/4 |
| 7 Runner | Done: phase «signals» of the hourly run (oldest first, 200 / org / run, concurrency 3, budget-aware, retries failed items 3×, 7-day window from the current switch-on); manual «Извлечь заново» (admin review block, Sources row action) |
| 8 Eval runner | Done: eval = spike + post-processing; precision / recall on counted codes, real vs synthetic, quality-gate verdict, metrics stored per run (`topics_eval_run`); review-code batch over recent non-golden items |
| 9 Hourly intake (added 2026-11-14) | Done: phase «intake» before «signals» — sync → parse → upload of the org's automated sources (parse: signal window only, 50 / org / run; upload 200), skipped while a daily run is in progress. Live check on IN4COM: 1 source, 16 new items, 5 parsed (1 complete, 4 junk), 2 uploaded, 76 s |

Live check on the dev DB (IN4COM, 8 recent items, with the former preset — before R22): Telegram orders → `ORDER_REQUESTED` (score 5–6), a new decision maker in mail → `CONTACT_NEW_DECISION_MAKER` (7), a blocklisted sender skipped without a call, others none; ≈ $0.007 and 7–15 s per item with `google/gemini-2.5-flash`. The hourly run in shadow ran the phase with 0 eligible items (the newest IN4COM item is older than the 7-day window); the org was set back to `off`.

**Open:** the exit gate (precision ≥ 0.85 on P6 / P8 codes, recall ≥ 0.7) needs the reviewed golden set (P3, step 4 of the next steps).

Follow-ups found in phase 2:
- The model still returns codes that are not in the prompt when anti-cues name them; they are dropped as `unknown_code` and listed in the item's `dropped`. Since R22 / R23 the prompt carries every `active` code, so this applies only to `parked` / `gated` codes and to agency codes named in anti-cues; reword such anti-cues in the IN4COM text review.
- Gate 3 uses only the discovery blocklist (email / domain of the author). «Own-org-only internal noise» is left to the model (`direction = internal`) and the internal-only block filter — revisit with real data.
- Child items (attachments) are not read by extraction yet: the root text only. Revisit when files matter (spec §2: children are evidence of the root).
- `parseMoneyRu` reads «$1,500» as 1.5 (comma = decimal); amounts come from the LLM, the parser is a helper only.
- Exclusions do not delete or revive already parsed items: removing an entry needs a manual re-parse.

1. Deterministic RU / EN library `src/lib/ru-mail/` (unit tests): quote and forward markers, reply prefixes, bounce, out-of-office, calendar replies, money parser (₽, тыс. / млн, НДС), freemail list, automated sender.
2. **Exclusions (R18):** migration; org-owner list «Исключения из анализа» on the Sources page; filter at sync where the provider allows it, else store only the dedupe id; never parse, never send to an LLM.
3. **Forwarded messages (Q32):** Telegram `forward_origin`, email forward headers; the original sender is the author.
4. Migration: signal columns on `source_item` (stamp, version), `signal_instance`, subjects and facts.
5. **`topics.signal_extraction`:** prompt built from the org's effective registry (only `active` codes — R22 superseded R6's IN4COM "on" list; the code block first as a stable prefix), flat output schema (spec §5.3); markdown from storage.
6. Server post-processing (spec §5.4): validation, evidence check, direction / internal filters, date gates, outranks, scoring, bands, R19 (a reminder counts once).
7. Runner in the hourly cycle for `shadow` / `on` orgs: eligibility, gates, budget-aware, idempotent, concurrency 3; manual action on a source item row.
8. **Eval runner (admin):** golden set → metrics per code, stored per run; ~~offline batch for "review" codes (R6)~~ — R22: no "review" set; the batch over non-`active` codes is optional.

Exit: precision ≥ 0.85 on P6 / P8 codes and recall ≥ 0.7 on the golden set; cost per item within the budget.

## Phase 3 — Topic engine (3 weeks)

**Status 2026-11-14 — built, not deployed.** Migration `0018_topics_phase3` (generated, applied to the `.env` DB). `pnpm test`: 153 tests.

| Task | State |
|---|---|
| 1 Thread key | Done: `src/lib/thread-key.ts` (pure, unit-tested) — `nylas:<thread>`, `imap:<root Message-ID>` (IMAP sync now stores `references[]` / `inReplyTo`), `gchat:<space>/<thread>`, `tg:<chat>:<first message id of the window>` (new window after > 1 h gap or 100 messages), `wa:<chat>:<group>`; written at sync / ingest; `backfillThreadKeys` fills older items in the hourly «intake» (500 / org / run). IN4COM: 104 / 104 root items keyed (76 mail in 67 threads, 28 Telegram in 19 windows) |
| 2 Migration | Done: `topic`, `topic_item` (role origin / update / closing / context), `topic_event` (journal, actor agent / user), FK `signal_instance.topic_id`, `source_item.topic_*` progress columns; value lists are text validated in code (`src/lib/topics/types.ts`) |
| 3 Counterparty | Done: `counterparty.ts` (client by match keys / aliases / domain / contact email; contact by email / Telegram / name; contact-only topics R14); re-link of unresolved topics in every run |
| 4 Resolver | Done: `resolver.ts` (pure, injectable matcher) — hard reference key → candidates (≤ 10) → `matcher.ts` (`topics.topic_match`, closed id list) → R15 bias; state codes with no topic logged only; context items (§6.4); titles «Компания — matter» |
| 5 Lifecycle | Done: `lifecycle.ts` — closing by `closes_codes` on the topic, reopen ≤ 14 d, dormant 21 d / expired 60 d / archived sweep, sub-state waiting on us / them; actions done / dismiss / merge / detach with journal (`topic-store.ts`) |
| 6 Score | Done: 06 §4.1–4.3 + §4.6 (instance activity incl. relevance window, base score, lead code, class by relation). Boosts / caps / profiles = phase 4; the stored score is recomputed on attach / detach / action only (scheduled recheck = phase 4) |
| 7 Integration | Done: reparse and the manual re-extract detach the item first; teardown preview / execute count, delete or recompute topics (bulk); deleting / blocking a client or contact unlinks it from topics (journal `relinked`), the hourly re-link links it again when it comes back. The CRM has no client merge |
| 8 Debug page | Done: block «Темы (отладка)» on «Темы» (org, status filter + counts, table, detail with items / signals / journal, actions Готово / Не относится / Объединить с… / Отвязать сообщение / Разобрать заново); API `api/admin/topics/topics`; Sources action «Извлечь сигналы и темы» |

Phase «topics» of the hourly run: items with `signal_status = done` and no `topic_scanned_at`, same 7-day window, oldest first, 200 / org / run, one at a time (order matters); budget stop → items wait.

Live check (IN4COM, manual action on 7 older items, ≈ $0.0015): 3 topics («ОРИКС — новый контакт» linked to client and contact; 2 order topics with an unknown counterparty), 1 context attach (same Telegram window), 3 items without counted signals ignored; re-run gave no duplicates. Real matcher, 3 cases right: reminder → same topic (high); invoice 125 vs a topic on invoice 124 → NEW; unrelated price request → NEW.

**Open:** the exit gate needs topic groups in the reviewed golden set (grouping precision ≥ 0.9 / recall ≥ 0.8) — the golden set has no `expected` topic-group field yet; add it with the review. The §2.1 examples that need no LLM run as unit tests with a fake matcher.

Follow-ups found in phase 3:
- A signal for all subjects (`subjectIndex = -1`) links to the first matching topic only (`signal_instance` has one `topic_id`).
- A topic's score does not drop by itself when a signal gets old (recheck in phase 4). Old test items show score 0 / band none because their signals are outside the relevance window — expected.
- When a detach deletes a topic, its context items are reset; if older than the 7-day window, the hourly run does not read them again.
- Restoring a deleted client re-links only topics with neither client nor contact.
- Rule B4 (user dismisses one signal) exists in the pure code only; nothing stores it yet (phase 4 / 6 UI).
- Teardown keeps the frozen text in `topics_golden_item.text` (privacy follow-up from phase 0).

1. `thread_key` for all providers (spec §6.1): IMAP stores `References` at sync from now on; existing items get a best-effort key in a resumable engine step (no script).
2. Migration: `topic` (with `client_id` and / or `contact_id`, R14), `topic_item`, `topic_event`.
3. Counterparty resolution (reuse `companyMatchKey`, domains, contact emails; org-explicit helpers); re-link when discovery creates the client later.
4. Resolver (spec §6.2): hard reference keys → candidates → `topics.topic_match` (closed list of ids, copied exactly) with the R15 bias; families; title building.
5. Lifecycle (spec §7): statuses, `waiting_on_us / waiting_on_them`, closing by state codes on the same topic, reopen within 14 days of resolution, dormant after 21 days, expired after 60.
6. Topic score, lead code, class (relationship status from order history + the companies tab).
7. Integration: reparse resets signals and detaches; source teardown deletes topics produced only by the selected threads; client merge / delete keeps topics consistent. *(Built 2026-11-14: `reparseSourceItem` + the manual re-extract detach first; teardown preview / execute plan deletes vs recomputes (`teardown-plan.ts`), counts in `teardown_log`; the CRM has no client / contact merge — soft delete / block unlinks the topics (journaled), the hourly re-link step links them again. See `src/app/AGENTS.md` § "Topics debug".)*
8. Admin debug page: topics with items and signals for the shadow review. *(Built 2026-11-14: block «Темы (отладка)» on «Темы», API `api/admin/topics/topics`; the manual Sources action is now «Извлечь сигналы и темы».)*

Exit: grouping precision ≥ 0.9 / recall ≥ 0.8; all spec §2.1 examples pass as automated tests.

## Phase 4 — Attention and cards (2 weeks)

**Status 2026-11-14 — built, not deployed.** Migrations `0019_topics_phase4_attention_cards` (topic attention columns, card topic columns, `work_calendar_day`) and `0020_work_calendar_ru_2026_2027` (custom: official production calendar 2026 — decree № 1466 of 24.09.2025, and 2027 — decree № 1187 of 17.09.2026; exceptions to Mon–Fri only, other years fall back to Mon–Fri). `pnpm test`: 217 tests + 1 todo (06 §16 test 12 = evening reminders, phase 7).

| Task | State |
|---|---|
| 1 Attention engine | Done: `src/server/topics/attention/engine.ts` (pure, steps A–L of 06: boosts R / O / C, trend cap, band + class, profiles G, state adjustments H incl. dampeners, escalations I1–I4 (I5 = deal risks, input empty until 5a), lists J, rank K, cycles + card expiry in working days L, next check, Russian explanation); 06 §16 tests 1–11, 13–20 and §14 examples E1–E9 as unit tests; working days / hours over `work_calendar_day` + org time zone; params = code defaults + `attention.params` override (org → platform). Store: `topic.display_profile`, `list`, `attention`, `next_attention_check_at`, cycle fields, `attention_changed` events; recompute after every topic change (attach, close, user action, detach). Phase «attention»: due topics (`next_attention_check_at ≤ now`, new topics, changed params), 500 / org / run. Read-time check `readTopicList` for the UI |
| 2 Migration | Done (`0019`): card `topic_id`, `kind`, `status`, engine snapshot (score, band, profile, class, lead code, taxonomy version), `expires_at`, `events`, reject code, decided by / at, `deal_id`, `proposal`; one open card per topic and kind (partial unique index); old `accepted` written in parallel |
| 3 Card writer | Done: `topics.card_writer` (NEW / UPDATE / NOOP with the copied id; Russian text trimmed to the §9.1 limits by code; roles, not names; the LLM never sees score / band / profile); runs only on first placement, a new display cycle or a forced rewrite; ≤ 40 calls / org / run |
| 4 Card lifecycle | Done: one open `topic` card per topic; closed when the topic is resolved / done / dismissed / merged / expired or loses its placement; `expired` after `expires_at`; accept → task, reject → reason code (8 codes) + text; `ORDER_REQUESTED` cards = `new_order` with the verbatim text («Создать заказ»); `forceTopicCardUpdate` for R17 (phase 5a). Topic cards are hidden from every user list (feed, search, notifications) unless the org mode is `on`. Debug block shows list, profile, attention explanation, the card and its history; action «Переписать карточку» |

Live check (IN4COM, one full hourly run in `shadow`, then back to `off`): intake 0 new; signals 1 item → 3 counted instances; topics: 2 new topics from one mail («maslov.agency — правки к договору», «… — запрос коммерческих условий»), 2 matcher calls; attention: both in «Сейчас» (P8 / P6, score 7); cards: 2 written, e.g. «maslov.agency — подготовить ответ по правкам, чтобы согласовать договор»; 0 topic cards visible to users. The 2 topics and cards stay in the DB for the review.

**Open:** exit gate = shadow cards reviewed with IN4COM on 2 weeks of real data, duplicate rate < 5 %. Interpretations to confirm in the review: a dampener ends at 08:00 of the promised date + 1 working day; in step G the explicit profile shift counts profile levels (very_high and critical are both P8); a date-only deadline means 18:00 org time.

Not in phase 4 (later): evening reminders, P6 daily limit, delivery (phase 7); the user lists «Сейчас / Сводка / Неделя», topic drawer and the card actions «Готово» / «Отложить до…» (phase 6); I5 deal risks (phase 5a).

1. Attention engine (pure functions + the 06 §16 tests): bands → profiles, boosts A1, attributes on the dominant instance A2, relevance windows A3, `waiting_on_them` A4, `dampens` A5, expiry A6, reminder cap A7, deadline escalation (also on list read, R3), Russian production calendar (yearly table seeded by migration).
2. Migration: card columns `topic_id`, `kind` (`topic` / `deal_proposal` / `stage_confirmation`), `status` enum, score snapshot (A8), one open card per topic; the old `accepted` boolean written in parallel (expand / contract).
3. **`topics.card_writer`:** Russian card text, NEW / UPDATE / NOOP with the copied card id; the LLM never sees the score; compact view ≤ 3 events.
4. Card lifecycle tied to the topic; reject reasons (list + free text); risk activation forces UPDATE (R17).

Exit: shadow cards reviewed with IN4COM on 2 weeks of real data; duplicate rate < 5 %.

## Phase 5 — Deal bridge (2 weeks)

**Status 2026-11-14 — built, not deployed.** Migration `0021_topics_phase5_deal_bridge` (deal status `paused`; table `deal_type`; `deal.deal_type_id`, `paused_until`, `pause_reason`, `outcome_reason`, `created_by_agent`; `deal_activity.topic_id`, `source_item_id`, `rule_id`, `evidence`). `pnpm test`: 253 tests + 1 todo.

| Task | State |
|---|---|
| 1 Migration + deal types | Done: `0021`; `src/server/deal-types.ts` — generic defaults (`new_location`, `listing`, `tender`, `supply_agreement`, `renewal`) created per org on first use (tenant data); editor «Типы сделок» next to «Настройки стадий» on /deals (org owner; types are hidden, never deleted); deal type in the deal forms and on the kanban card |
| 2 Deal helpers | Done: `src/server/deal-engine.ts` (server-only, org-explicit): create (agent or user), forward-only move (skip allowed), outcome won / lost (`withdrawn` only by a user), pause / resume, undo of an agent deal, topic link; every write = one batch with a `deal_activity` row (topic, item, rule, evidence). Owner of an agent deal: topic assignee → `client.user_id` (if still a member) → org owner → oldest member |
| 3 Rules | Done: `src/server/topics/deals/rules.ts` (pure, unit-tested) over the org's own `signal_stage_rule` rows (none → `skipped: no stage rules`): `ORDER_*` and low-confidence signals never act; author-only (our own items never create / move / close); area 0 is never a target; `requires_fact` / `PROSPECT_NEED_EXPRESSED` need a concrete task; forward only; one signal does not both create and move a deal. Create: open deal of client + type → link; else auto-create (settings `deals.autoCreateEnabled` true, `autoCreateMinScore` 7, `autoCreateMinConfidence` high, client resolved, guards) → else `deal_proposal` card (score ≥ `deals.proposalMinScore` 5, client or contact) → else nothing. Moves / outcomes → automatic or a `stage_confirmation` card; `in_stage` → `deal_context` topic event only. Phase «deals» after «cards»: new signals of the last 30 days, 50 topics / run, one `deal_decision` event per signal (idempotent). **In `shadow` the phase is a dry run:** decisions and hidden cards are stored, deals are not changed (deals are visible on the board) |
| 4 «Происхождение» | Done: deal drawer tab with the deal's topics and items (markdown links) and the journal (actor Агент / user, stage change, rule, evidence); badge «создал агент» + «Отменить» on the card and in the drawer; pause dialog (date + reason) and «Снять с паузы». Paused deals stay in their stage and count as open everywhere (`OPEN_DEAL_STATUSES` in `src/lib/deal-funnel.ts`) |
| Cards | `deal_proposal` «<Компания> — новая возможность: <тип>» (Создать / Не сделка) and `stage_confirmation` (Подтвердить / Отклонить): text by code, no LLM; `PUT /api/cards { action: "deal_execute" }`; reject codes `not_a_deal`, `deal_exists`, `wrong_stage`; visible only in mode `on` |
| Old discovery | `/api/deals/discover` stays until phase 12; in mode `on` it does not create a deal for a client with an open agent deal and does not move agent deals |

Live check (IN4COM): the admin step «copy rule templates» done on the test DB (23 rules; S1 «Квалификация», S2 «Потребности», S3 «Пилот», S4 «КП», S5 «Переговоры», won Closed, lost Rejected); test client «maslov.agency» created, the hourly re-link linked both maslov topics; the engine auto-created the deal «maslov.agency — запрос коммерческих условий» (type `new_location`, stage «Квалификация», SALES_OFFER_REQUESTED high, score 7, client new; journal with topic, item, rule `tpl:base:6`, evidence); a re-run did nothing. Smoke tests (move, backward refused, pause / resume, undo, confirmation card, «Не сделка», hidden cards) passed and were cleaned up. The test client, the 23 rules and the agent deal stay for the review; IN4COM mode `off`.

**Open:** exit gate = IN4COM users agree with the auto-created deals and moves in the shadow / first `on` weeks. Decided (R24): shadow = dry run for deals; paused deals count in the weighted forecast. Proposal / confirmation cards do not expire; a `pause` from a signal has no end date (no fact gives one). The mock «board intel» (`src/server/deals-mock.ts`, `/api/deals/intel`) is still used by the kanban — remove it with the old logic (phase 12).

1. Migration: `deal.deal_type` + per-org deal types (R13; generic list from R22: `new_location`, `listing`, `tender`, `supply_agreement`, `renewal`), `deal_activity.topic_id / source_item_id / rule_id`, deal status `paused` (+ until, reason).
2. Org-explicit, `server-only` deal helpers (create / move / outcome) acting as the system actor; every move journaled.
3. Rules (Q12, Q27): auto-create above the per-org threshold (confidence high, score ≥ 7, client resolved, no open deal of the same type), `deal_proposal` card below; area 0 never creates a deal (Q34); `PROSPECT_NEED_EXPRESSED` only with a concrete task; forward-only moves; `stage_confirmation` cards; `ORDER_*` codes have no deal effect; «создал агент» badge + undo.
4. Deal drawer «Происхождение» shows real topics and items.

Exit: every auto-created deal and move has a topic and an evidence quote; IN4COM users agree with ≥ 80 % (they review all auto-created deals in the first 2 weeks).

## Phase 5a — Deal state and risks (1.5 weeks)

1. Migration: deal state text + versions + sources; risk tables (if not in phase 1) and active risks.
2. **`deals.state_summary`:** runs on any new deal information (R16, debounced 10 min), UPDATE / NOOP, ≤ 3 sentences / 50 words, cited sources from the input only, fixed texts for «Недостаточно информации», won, lost.
3. Risk engine (pure functions): activation by trigger codes, occurrence counts, stage guards, clearing; parked codes never trigger; the 9 generic risk types (R22) confirmed in the IN4COM review.
4. Eval: human review of ≥ 30 deal states and all active risks.

Exit: ≥ 80 % of states pass «Где мы? Чего ждём? Что мешает? Что дальше?»; no invented facts; risk precision ≥ 0.8.

## Phase 6 — UI and pilot (2 weeks)

1. Dashboard: «Сейчас» / «Сводка» / «Неделя» + «Все темы»; same for all members, filter «Мои» (deal owner / topic assignee); compact cards + «Ещё».
2. Topic drawer: signals with evidence, timeline, actions (accept → task, reject, done, snooze, merge, detach item, link to deal).
3. «Темы» tab on the company page / drawer and the deal drawer; deal board: state text, «Есть риски» badge, risk list.
4. **Orders (R7):** «Создать заказ» on `ORDER_REQUESTED` topic cards (reuse the card → order dialog handoff); when IN4COM goes `on`, the old «Telegram orders» Custom rule is switched off.
5. On switch to `shadow`, process the last 7 days (Q16). Switch IN4COM to `on`; other orgs keep the old cards until phase 12.
6. Weekly tuning loop for 4 weeks: reject reasons and missed items → registry edits in the editor (platform admin) → new version → eval → deploy.

Exit (go-live sign-off): Q23 targets met for 2 consecutive weeks.

## Phases after the MVP

- **7 Delivery (2 w):** daily email digest per user; Telegram to staff (bind via the org bot, ≤ 2 per card per 7 days); P6 evening reminders and daily limit (Q24-5).
- **8 System-of-record and watchdogs (2.5 w):** IN4COM order data first (dormant by order rhythm, product stopped, YoY); then offer no-response (7 days), countdowns, contract expiry; "confirmed" rules for absence codes (Q24-11).
- **9 Agency pack (2 w):** seed 05d by migration; agency funnel without go / no-go; area 0; 26 risks; `deal.win_estimate*`; golden set; Telegram group chats and voice notes shipped before (separate tasks).
- **10 Orders link (1 w):** `ORDER_CONFIRMED` from order status; topic ↔ order link both ways.
- **11 External signals (2 w):** `topics.external_search` (gateway web search; today Google models only) + `topics.external_extraction`; watch list; trend cooldown.
- **12 Cleanup (1 w):** remove Custom-rule card generation, `/api/cards/generate`, `/api/deals/discover`, the processes `cards.generation` and `deals.discovery`, card rules on `/rules`; then a contract migration for the old card columns.

Out of this plan (separate tasks): functional roles and rights (Q33); Telegram group chats, voice notes and files (Q11, Q32).

## Next steps (2026-11-14, after phase 5)

Environment: there is **one DB only** — the DB in `.env`, a test DB. Migrations `0000`–`0021` are applied to it; nothing is pending. A future production environment follows the runbook [07-signals-go-live.md](07-signals-go-live.md).

Current state: phases 0–5 built, not deployed. Hourly run per org in `shadow` / `on`: intake → signals → topics → attention → cards → deals (dry run in `shadow`); deal state is a stub. IN4COM: `base` pack on, 23 stage rules, 5 deal types, topics mode `off`; test data from the live checks (topics, 2 hidden topic cards, test client «maslov.agency», 1 agent deal).

| # | Step | Who | Blocks |
|---|---|---|---|
| 1 | Review and commit phases 0–5 (incl. migrations `0016`–`0021`) | Product owner | — |
| 2 | IN4COM reviewers: golden set, signal texts, eval; shadow review of topics, cards and deal decisions in «Темы (отладка)» | IN4COM + platform admin | Exit gates of phases 2–5 |
| 3 | **Phase 5a — deal state and risks** (`deals.state_summary`, risk engine, «Есть риски», I5 escalation, R17 card update) | Development | Can start now |

Note: 15 of the codes made `active` by R23 are process codes (watchdogs, CRM-data trends). Nothing emits them until phase 8.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Long prompt degrades extraction quality | Low recall, schema failures | Spike on 2–3 models; active codes only (R22); two-pass fallback; static prefix for caching |
| Over-merging or over-splitting topics | Lost or duplicate attention | Hard reference keys first; R15 bias; closed-list matcher; eval gates; merge / detach actions |
| Hourly cycle too slow for urgent items | Late «Сейчас» | Deadline escalation on list read; manual run; revisit the interval after the pilot |
| Cost growth (3–5 calls per item) | Budget overrun | Per-org budget (phase 0), gates before the LLM, cost per item tracked in `ai_usage_event` |
| Registry edits drift between databases | Different behaviour per environment | Version + change log; Markdown export after each tuning round; new seeds only by migration |
| Seed weights come from other markets | Wrong priorities | Weekly calibration for 4 weeks by the platform admin from reject reasons and the golden set |
| Auto-created deals are wrong | Users stop trusting the funnel | Conservative threshold, badge + undo, full review for 2 weeks |
| Tenant time for annotation not available | No quality gates | LLM pre-annotation, small real set, synthetic items, agreed in phase 0 |
| Personal data in evidence quotes | Compliance | Same retention as source items; teardown and reparse clean signals and topics; model policy (ZDR / no training) available on «Процессы ИИ» |

## Working rules for the implementation

- Root `AGENTS.md` rules apply: Drizzle migrations only (from `0010`, reference data in migrations), docs in English and UI in Russian, nothing works without sign-in (engine code `server-only`, routes check the session), `AGENTS.md` updated with every change.
- Every LLM step is an AI process called through `aiGenerateText` / `aiStreamText` with `ref`; no direct SDK calls, no model ids in code (lint-enforced).
- Files go through `@/server/storage`.
- Every phase lands behind the org flag; `off` orgs see no change.
- Every LLM change ships with an eval run on the golden set.
- No `git commit` / `git push` by the assistant; the product owner commits and deploys.

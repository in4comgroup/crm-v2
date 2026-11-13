# Topics — development plan (final)

Status: **final, 2026-11-13.** Rebased on this repository (crm-v2) after the review of 2026-11-13.
Spec: [01-specification.md](01-specification.md) · Decisions: [02-open-questions.md](02-open-questions.md) (§ F = R1–R20) · Registry: [05-signals-registry.md](05-signals-registry.md) · Attention: [06-attention-engine.md](06-attention-engine.md)

The plan of 2026-11-10 assumed another copy of the product (Yandex models, own PostgreSQL, K8s CronJob, `llm_usage`). It is replaced by this document. Its business content (phases, scope, gates) is kept.

## Assumptions

- One full-stack developer with AI assistance. Estimates are working weeks incl. tests, migrations and docs.
- **Pilot = IN4COM** (wine / spirits distributor, org `1dNkC4rBtl9FEvnK95Svlfs63oSU57Ni`). Packs `base` (IN4COM "on" codes) + `distribution`. The agency is the second pilot (phase 9).
- IN4COM business users give ≈ 3–4 days: pack and phrase review, golden-set review, result assessment. Synthetic test messages are allowed.
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
| AI layer | `src/server/ai`: 18 processes, per-process model choice («Процессы ИИ»), usage ledger `ai_usage_event` with exact USD cost, markup, model policy, model registry («Модели»), lint boundaries | Every topics LLM step is a new **process**; cost per item from `ai_usage_event.ref` |
| Sources / parse | Sync for Nylas, IMAP, Google Chat / Drive, Telegram (webhook), Drop Off, WhatsApp, AI chat; `parseSourceItem` with `metadata_json` analysis, junk skip, own-org attribution; markdown in storage after upload | Input of signal extraction. Markdown read with `getTextObject(markdown_r2_key)` (the DB copy is cleared after upload) |
| Matching | `companyMatchKey` / `personMatchKey`, discovery, blocklist, own-org identity | Counterparty resolution, gates |
| Cards | `card` + `card_client` / `card_user` / `card_contact`, accept → task, `new_order` → order dialog, process `cards.generation` (one card per item, Custom rules) | Keep table and junctions; add topic link, kind, status. Old generation removed in phase 12 |
| Deals | `deal`, `deal_contact`, per-org funnel stages (incl. pre-pipeline), `deal_activity` journal, kanban | Deal bridge writes journaled moves through org-explicit helpers |
| Deal discovery | Process `deals.discovery` (name match); its stage moves write **no** journal | Fixed in phase 0, replaced in phase 5, removed in phase 12 |
| Mock agent | `src/server/deals-mock.ts` + `/api/deals/proposals` move ≈ every 3rd deal when the board loads | **Removed in phase 0** (R9) |
| Orchestration | Daily cron `0 3 * * *` → workflow → `runDailyPipeline` (model catalog sync + cost check, sync → parse → upload), `pipeline_run` | Add an hourly topics cycle |
| DB process | Drizzle migrations `0000`–`0009`, reference data in migrations | Topics migrations start at **0010** |
| Access | Sign-in gate `src/proxy.ts`; routes check the session; `"use server"` modules are session-bound | Engine code is `server-only` and takes `organizationId` explicitly |

Missing today: per-org settings store, per-org AI budget, system actor user, `thread_key`, signals registry, signals, topics, attention engine, deal types, deal state / risks, exclusions.

## Overview

| Phase | Name | Weeks | Output | Visible to users |
|---|---|---|---|---|
| 0 | Foundations | 1.5 | Mock agent removed, deal discovery journaled, per-org AI budget, `org_setting` + topics flag, system actor, AI processes, hourly cycle skeleton, golden set, model spike | Admin only |
| 1 | Signals registry | 3 | DB registry (all parameters), seed v1 by migration, «Сигналы» tab with **full editor**, per-org activation / overrides, Markdown export | Admin only |
| 2 | Signal extraction | 2.5 | Gates, `topics.signal_extraction`, scoring, storage, exclusions, forwarded mail, eval runner | No (shadow) |
| 3 | Topic engine | 3 | `thread_key`, topics, resolver + `topics.topic_match`, lifecycle, journal, teardown / reparse, debug page | No (shadow) |
| 4 | Attention and cards | 2 | Attention engine (06, A1–A8), production calendar, card per topic with kinds, `topics.card_writer` | No (shadow) |
| 5 | Deal bridge | 2 | Deal types, stage rules, auto-create + proposals, journaled moves, «Происхождение» | No (shadow) |
| 5a | Deal state and risks | 1.5 | `deals.state_summary`, risk engine, «Есть риски» | No (shadow) |
| 6 | UI and pilot | 2 | «Сейчас / Сводка / Неделя», topic drawer, company / deal tabs, «Создать заказ» on order topics, IN4COM switch-on | **Yes (IN4COM)** |
| **MVP** | | **≈ 17.5** | | |
| 7 | Delivery | 2 | Email digest, Telegram to staff, P6 evening reminders and daily limit | Yes |
| 8 | System-of-record signals and watchdogs | 2.5 | Order-rhythm topics for IN4COM, then no-response / countdown / contract expiry | Yes |
| 9 | Agency pack (second pilot) | 2 | 05d seeded by migration, agency funnel and 26 risks, area 0, win estimate | Yes |
| 10 | Orders link | 1 | `ORDER_CONFIRMED` from order status, topic ↔ order link both ways | Yes |
| 11 | External market signals | 2 | `topics.external_search` (gateway web search) → external signal instances | Yes |
| 12 | Cleanup of old logic | 1 | Remove Custom-rule cards, `cards.generation`, `deals.discovery`; contract migration | — |

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
7. **Golden set:** ≈ 200 IN4COM root items (anonymised export inside the app, admin only) + synthetic items for rare codes and for every spec §2.1 example (marked `synthetic`); LLM pre-annotation; IN4COM review together with the pack phrases (04 §3 items 5, 7).
8. **Model spike:** 50 golden items through 2–3 gateway models on `topics.signal_extraction` (switched on «Процессы ИИ»), single-pass vs two-pass; measure codes vs the annotation, tokens, cost, latency, structured-output failures.

Exit: mock agent gone; budget live; flag, actor and hourly cycle deployed (no effect for `off` orgs); spike report with chosen model, prompt strategy and cost per item; IN4COM pack confirmations collected.

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
- Anti-cues of "on" codes name some "review" codes (e.g. `PREORDER_REQUESTED`, `STOCK_AVAILABILITY_REQUEST`), which the live prompt does not contain; returned unknown codes are dropped and counted. Resolve in the IN4COM review (phase 1, task 6): switch those codes on or reword the anti-cues.
- The golden set copies the item text into `topics_golden_item.text` (real client text in a second table; same tenant, admin only). Teardown / reparse integration (phase 3, task 7) must also clean or detach golden items; anonymised export is not built.
- `src/server/topics/catalog/catalog-v0.ts` is a stop-gap generated by `tools/topics/catalog-to-ts.ts`; phase 1 seeds the DB registry from the same catalogs and deletes it.
- Agent users stay in `user` after their org is deleted (no FK to the org); harmless (banned, no membership), clean up with org deletion later.

## Phase 1 — Signals registry (3 weeks)

1. **Migration (registry tables):** packs; `signal_category` with all fields of 05 §2–§4 incl. the R1 additions (`family`, `relevance_days`, `cues_prompt_ru`, `synonyms_ru`, `anti_cues_ru`, `example_ru`, `counter_example_ru`, `trigger_rule`, English cues); relations (`closes`, `outranks`, `dampens`, …) with pack-level changes allowed (R12); per-org pack activation and code overrides; per-org `signal_stage_rule`; `deal_risk_type` + per-org risk activation / stage guards; taxonomy version + change log.
2. **Seed v1 (R11):** custom migration with fixed ids and `ON CONFLICT DO NOTHING`, generated once from the reviewed catalogs: `base` (IN4COM "on" codes `active`, the rest `onHold` / `parked`) and `distribution`; IN4COM activation; always-P8 list and weights from the pack decisions (`ORDER_REQUESTED` = 5, `SUPPLIER_DELIVERY_DELAY` = risk at 5). The agency pack is **not** seeded (R5). After this migration the DB is the master.
3. **Server:** `src/server/signals/` — cached registry read per org (effective parameters), validation on save (05 §7, with R12), version bump, change log.
4. **Settings tab «Сигналы»** (platform admin): registry table with filters (pack, block, stage, profile, org status, search); **full editor** for every field of a code (RU texts, cues, anti-cues, examples, relations, trigger rule); per-org activation and overrides; stage rules editor; risk types editor; validation messages; version history.
5. **«Экспорт в Markdown»:** the current registry with all parameters, plus the selected org's activation, overrides, stage rules and risks.
6. RU texts and English supplier cues (R20) for every code active for IN4COM; IN4COM sign-off.

Exit: seed applies on an empty DB and on the dev DB; editor round trip (edit → validate → version → export); IN4COM signs off the texts of all active codes.

## Phase 2 — Signal extraction (2.5 weeks)

1. Deterministic RU / EN library `src/lib/ru-mail/` (unit tests): quote and forward markers, reply prefixes, bounce, out-of-office, calendar replies, money parser (₽, тыс. / млн, НДС), freemail list, automated sender.
2. **Exclusions (R18):** migration; org-owner list «Исключения из анализа» on the Sources page; filter at sync where the provider allows it, else store only the dedupe id; never parse, never send to an LLM.
3. **Forwarded messages (Q32):** Telegram `forward_origin`, email forward headers; the original sender is the author.
4. Migration: signal columns on `source_item` (stamp, version), `signal_instance`, subjects and facts.
5. **`topics.signal_extraction`:** prompt built from the org's effective registry (R6: only active codes; the code block first as a stable prefix), flat output schema (spec §5.3); markdown from storage.
6. Server post-processing (spec §5.4): validation, evidence check, direction / internal filters, date gates, outranks, scoring, bands, R19 (a reminder counts once).
7. Runner in the hourly cycle for `shadow` / `on` orgs: eligibility, gates, budget-aware, idempotent, concurrency 3; manual action on a source item row.
8. **Eval runner (admin):** golden set → metrics per code, stored per run; offline batch for "review" codes (R6).

Exit: precision ≥ 0.85 on P6 / P8 codes and recall ≥ 0.7 on the golden set; cost per item within the budget.

## Phase 3 — Topic engine (3 weeks)

1. `thread_key` for all providers (spec §6.1): IMAP stores `References` at sync from now on; existing items get a best-effort key in a resumable engine step (no script).
2. Migration: `topic` (with `client_id` and / or `contact_id`, R14), `topic_item`, `topic_event`.
3. Counterparty resolution (reuse `companyMatchKey`, domains, contact emails; org-explicit helpers); re-link when discovery creates the client later.
4. Resolver (spec §6.2): hard reference keys → candidates → `topics.topic_match` (closed list of ids, copied exactly) with the R15 bias; families; title building.
5. Lifecycle (spec §7): statuses, `waiting_on_us / waiting_on_them`, closing by state codes on the same topic, reopen within 14 days of resolution, dormant after 21 days, expired after 60.
6. Topic score, lead code, class (relationship status from order history + the companies tab).
7. Integration: reparse resets signals and detaches; source teardown deletes topics produced only by the selected threads; client merge / delete keeps topics consistent.
8. Admin debug page: topics with items and signals for the shadow review.

Exit: grouping precision ≥ 0.9 / recall ≥ 0.8; all spec §2.1 examples pass as automated tests.

## Phase 4 — Attention and cards (2 weeks)

1. Attention engine (pure functions + the 06 §16 tests): bands → profiles, boosts A1, attributes on the dominant instance A2, relevance windows A3, `waiting_on_them` A4, `dampens` A5, expiry A6, reminder cap A7, deadline escalation (also on list read, R3), Russian production calendar (yearly table seeded by migration).
2. Migration: card columns `topic_id`, `kind` (`topic` / `deal_proposal` / `stage_confirmation`), `status` enum, score snapshot (A8), one open card per topic; the old `accepted` boolean written in parallel (expand / contract).
3. **`topics.card_writer`:** Russian card text, NEW / UPDATE / NOOP with the copied card id; the LLM never sees the score; compact view ≤ 3 events.
4. Card lifecycle tied to the topic; reject reasons (list + free text); risk activation forces UPDATE (R17).

Exit: shadow cards reviewed with IN4COM on 2 weeks of real data; duplicate rate < 5 %.

## Phase 5 — Deal bridge (2 weeks)

1. Migration: `deal.deal_type` + per-org deal types (R13; IN4COM list), `deal_activity.topic_id / source_item_id / rule_id`, deal status `paused` (+ until, reason).
2. Org-explicit, `server-only` deal helpers (create / move / outcome) acting as the system actor; every move journaled.
3. Rules (Q12, Q27): auto-create above the per-org threshold (confidence high, score ≥ 7, client resolved, no open deal of the same type), `deal_proposal` card below; area 0 never creates a deal (Q34); `PROSPECT_NEED_EXPRESSED` only with a concrete task; forward-only moves; `stage_confirmation` cards; `ORDER_*` codes have no deal effect; «создал агент» badge + undo.
4. Deal drawer «Происхождение» shows real topics and items.

Exit: every auto-created deal and move has a topic and an evidence quote; IN4COM users agree with ≥ 80 % (they review all auto-created deals in the first 2 weeks).

## Phase 5a — Deal state and risks (1.5 weeks)

1. Migration: deal state text + versions + sources; risk tables (if not in phase 1) and active risks.
2. **`deals.state_summary`:** runs on any new deal information (R16, debounced 10 min), UPDATE / NOOP, ≤ 3 sentences / 50 words, cited sources from the input only, fixed texts for «Недостаточно информации», won, lost.
3. Risk engine (pure functions): activation by trigger codes, occurrence counts, stage guards, clearing; parked codes never trigger; IN4COM risk list from the review.
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

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Long prompt degrades extraction quality | Low recall, schema failures | Spike on 2–3 models; active codes only (R6); two-pass fallback; static prefix for caching |
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

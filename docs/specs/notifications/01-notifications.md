# Notifications — specification

Status: **built 2026-11-15** (migrations `0040_notifications`, `0041_drop_notification_read_state`, applied on the test DB; not deployed). §10 = what was built. Questions: [02-open-questions.md](02-open-questions.md). Plan: [03-development-plan.md](03-development-plan.md).

## 1. Goal (product owner, 2026-11-15)

Turn the bell in the page header («Уведомления», top right) into a real notification system:

| # | Requirement |
|---|---|
| N1 | Show new notifications and their count |
| N2 | Categories of notifications |
| N3 | Two priorities: **important** («Важное») and **info** («Информация») |
| N4 | One engine that every existing and future producer writes to: AI usage limits (70 % info, 90 % important), billing and payments (later), company profile quality reminders, running processes (stats, warnings, errors), task reminders (day before due = info, due day = important), and more (§5) |

## 2. What exists today (check of 2026-11-15)

| Part | Today | Code |
|---|---|---|
| Bell | `<NotificationsDrawer/>` in the page header (`page-header-actions.tsx`): polls `GET /api/notifications` every 45 s, badge = unread count (9+), right-hand sheet grouped by date, toasts (≤ 3) for events that appeared since the last poll | `src/components/blocks/notifications-drawer.tsx` |
| Data | **Not stored.** `listNotifications` DERIVES events at read time: the newest 15 companies / contacts / open deals / cards by `created_at` (the whole org, whoever created them), pending «Ответственный» handovers to the viewer, pending «Контакт сменил компанию?» proposals. Top 20 by date | `src/server/notifications.ts` |
| Read state | ONE watermark per user and org (`notification_read_state.last_seen_at`); opening the sheet marks everything as seen. No read flag per notification, no dismiss | `notification_read_state` |
| Categories / priority | None (an entity icon per type) | — |
| Warnings that live elsewhere | AI limits: banner on `/account` + card on «Использование ИИ» (`aiMonthlyLimitState`, warning at ≥ 80 % — changed to 70 / 90 % by Q3 —, exceeded at 100 %; the daily budget «лимит исчерпан»); org profile incomplete: banner on `/dashboard` + `/account` (`getOrgProfileBanner`, owner only); topic reminders «Напоминание N» on dashboard cards; topics e-mail digests (`topic_delivery`); source sync errors on the Sources page | `src/lib/ai-budget.ts`, `ai-limit-banner.tsx`, `org-profile-banner.tsx`, `src/server/topics/delivery/` |
| Jobs | Cron daily 03:00 UTC (`/api/cron/daily`: catalog, sync, parse, upload) and hourly (`/api/cron/topics`, only orgs with topics `shadow` / `on`) | `vercel.ts`, `src/server/orchestration/` |

## 3. Model

### 3.1 Table `notification` (one row per RECIPIENT)

| Column | Meaning |
|---|---|
| `id`, `organization_id`, `user_id` | recipient (tenant-checked; never «Агент») |
| `kind` | code of the notification type (§4, e.g. `ai.limit.month.90`, `task.due_today`) |
| `category` | from the kind (§3.3), stored for filters |
| `priority` | `important` / `info` (default from the kind; a producer may raise it) |
| `title`, `body` | Russian text, written by code (no LLM) |
| `href` | where a click leads (`/tasks?openTask=…`, `/account?tab=ai`, …) |
| `entity_type`, `entity_id` | optional link (task, deal, client, contact, source, topic, order) |
| `dedupe_key` | unique per recipient: the same condition never notifies twice (e.g. `ai.limit.month:2026-11:90`, `task.due_today:<taskId>:2026-11-16`) |
| `payload` | jsonb (numbers for the text, e.g. `{ spent, limit, share }`) |
| `created_at`, `read_at`, `dismissed_at` | read = opened or marked read; dismissed = removed from the list by the user |
| `resolved_at` | set by the producer when the condition is gone (the limit went back below 70 % in a new month, the task was done, the profile was completed) — the notification is greyed out «уже не актуально» and leaves the unread count |
| `expires_at` | after this the row is hidden and later deleted (§3.5) |

`notification_read_state` (watermark) is replaced; toasts use «new since the last poll» as today.

### 3.2 Engine (`src/server/notifications/`)

- **One write path** `notify(orgId, { kind, recipients, priority?, title, body, href, entity?, dedupeKey, payload?, expiresAt? })` — resolves recipients (§3.4), drops muted categories (§6), inserts with `ON CONFLICT (user_id, dedupe_key) DO NOTHING`, never throws (a notification never breaks the action that produced it). `resolveNotifications(orgId, dedupeKeyPrefix)` marks a condition as gone.
- **Kind registry** (code, like AI processes): `NOTIFICATION_KINDS[kind] = { category, priority, labelRu, recipients, expiresDays, mutable }`. A new producer = one registry line + one `notify()` call.
- **Two kinds of producers:**
  - **Event producers** — call `notify()` where the event happens (handover, «Контакт сменил компанию?», a new high-severity deal risk, an order confirmed by the client, a member joined, …).
  - **Condition checks** — `runNotificationChecks(orgId, now)`: an HOURLY job for EVERY org (not only topics orgs) that evaluates conditions (task due dates, AI usage share, profile completeness, source health, …). Each check is pure logic over loaded data (unit-tested) + `notify` / `resolve`. Time-of-day rules use the org time zone (`attention.params`, default Europe/Vienna) and working days.

### 3.3 Categories (N2)

| Code | «Label» | Examples |
|---|---|---|
| `tasks` | «Задачи» | due tomorrow, due today, overdue, assigned to you |
| `sales` | «Сделки и темы» | new deal risk, an urgent topic for you, a deal / stage card waiting, order confirmed by the client |
| `clients` | «Компании и контакты» | handover to you, «Контакт сменил компанию?», profile proposals from the web, enrichment review |
| `ai` | «ИИ и лимиты» | monthly limit 70 % / 90 % / 100 %, daily budget used up, background AI stopped |
| `processes` | «Процессы и источники» | source sync failing, credentials invalid, Telegram webhook errors, run errors, daily stats |
| `organization` | «Организация» | org profile incomplete, a member joined, invitation accepted, golden-set review waiting |
| `billing` | «Оплата» | reserved — producers come with billing (TBD) |
| `platform` | «Платформа» | platform admins only: catalog sync failed, cron run failed, AI policy left a process without a model |

### 3.4 Recipients

Rules a kind can use (resolved at write time, human members only, banned users skipped):

| Rule | Who |
|---|---|
| `user` | a given user (task assignee, deal owner, topic assignee) |
| `owners` | org owners |
| `admins` | org owners + admins |
| `responsible` | the «Ответственный» of a company (fallback: owners) |

**Q3:** AI usage, billing, company profile and process stats / warnings / errors → `owners` only. A person's own work → that `user`.
| `members` | every member |
| `platform_admins` | users with platform role admin |

### 3.5 Lifetime

- **info**: hidden after **3 days**; **important**: after **5 days** (Q11), unless the user closes («Скрыть») it earlier. Rows are deleted 30 days after expiry (daily job).
- Unread count = not read, not dismissed, not resolved, not expired.

## 4. Producers (first set)

| Kind | Category | Priority | Trigger | Recipients | Resolve |
|---|---|---|---|---|---|
| `ai.limit.month.70` | ai | info | monthly end-user AI cost ≥ 70 % of the org limit (check, hourly) | owners | new month |
| `ai.limit.month.90` | ai | important | ≥ 90 % | owners | new month |
| `ai.limit.month.100` | ai | important | ≥ 100 % — background AI stopped | owners | new month / limit raised |
| `ai.budget.day` | ai | important | the daily budget used up (background AI paused till 00:00 UTC) | owners | next day |
| `profile.org.incomplete` | organization | important while topics are `shadow` / `on`, else info | the org profile minimum is not complete (6 items) — at once, then weekly (Monday 09:00) | owners | profile complete |
| `profile.client.proposals` | clients | info | pending «Профиль компании» proposals from the web (daily digest: N companies) | owners (Q3) | none pending |
| `task.due_tomorrow` | tasks | info | an open task (`todo` / `in_progress`) is due tomorrow — 09:00 org time on the working day before | assignee | done / closed / date moved |
| `task.due_today` | tasks | important | due today — 09:00 org time (or at creation when created on the day) | assignee | done / closed / date moved |
| `task.overdue` | tasks | important | the due date passed, still open — once, the next morning | assignee (+ creator, Q7) | done / closed |
| `task.assigned` | tasks | info | someone else assigned a task to you | assignee | — |
| `source.sync_failing` | processes | important | a source's sync failed 3 runs in a row / credentials invalid / Telegram webhook error | owners | next successful sync |
| `process.run_failed` | processes | important | the org's daily pipeline or topics run ended `failed` | owners | next successful run |
| `process.daily_stats` | processes | info | daily summary of the org's runs: items synced / parsed / failed, topics, AI cost (Q6) | owners | — |
| `client.handover` | clients | important | a company handed over to you (today derived) | the receiving owner | decided |
| `contact.link_proposal` | clients | info | «Контакт сменил компанию?» (today derived) | responsible of X and Y | decided |
| `billing.*` | billing | — | reserved (billing TBD) | owners | — |

## 5. Suggested more producers (Q5)

| Kind | Category | Priority | Why |
|---|---|---|---|
| `deal.risk_new` | sales | important (severity ≥ 7) / info | a new deal risk for the deal owner (today only on the board) |
| `topic.now` | sales | important (P8) / info (P6) | a topic entered «Сейчас» for its assignee — the in-app twin of the Telegram push (topics/08 T2) |
| `deal.card_waiting` | sales | info | a «Новая сделка?» / «Перевести стадию?» / «К какой сделке?» card waits for the deal owner > 1 working day |
| `deal.stale` | sales | info | a deal over its stage norm «N дн без активности» (weekly, owner) |
| `order.confirmed_by_client` | sales | important | the client confirmed an order through the guest link (order creator) |
| `member.joined` | organization | info | a member accepted an invitation (owners) |
| `golden.review_waiting` | organization | info | golden-set items wait for review (reviewers) |
| `document.too_large` | processes | info | a file could not be stored / parsed (too large, unsupported) — to the person who uploaded it |
| `discovery.new_records` | clients | info | the automatic discovery created N companies / contacts (one summary instead of one notification per record — replaces today's «Новая компания: …» list) |
| `platform.*` | platform | important | catalog sync failed, a cron run failed, AI policy refused a process — platform admins |

## 6. User settings

`/account` → «Уведомления» (the tab exists for topic e-mails): per category «В приложении» on / off (important notifications of `tasks`, `ai`, `processes` cannot be switched off — Q8). Later: e-mail / Telegram for important (Q9).

## 7. UI

- **Bell badge**: unread count; **red** when at least one unread important, **grey** when only info (Q10).
- **Sheet** «Уведомления»: tabs «Все» / «Важные» + a category filter; each row: category icon, priority mark (red dot for important), title, body (2 lines), time, «уже не актуально» when resolved; click = mark read + open `href`; row menu «Отметить прочитанным» / «Скрыть»; header button «Прочитать все». Date groups as today.
- **Toasts**: only for NEW important notifications (info goes to the badge only).
- Banners stay where they are (AI limit on `/account`, org profile on `/dashboard`); they are the page-level view of the same condition.

## 8. API

`GET /api/notifications?filter=all|important&category=&limit=&before=` → `{ items, unreadCount, unreadImportant }`; `POST /api/notifications { action: "read", ids } | { action: "readAll" } | { action: "dismiss", ids }`; `GET|PUT /api/account/notification-prefs`. Any member, own notifications only (`user_id` = session user, org = active org).

## 9. Acceptance checks

1. The org uses 72 % of its monthly AI limit → one info notification to each owner; at 91 % one important; no repeat within the month; in a new month both show «уже не актуально».
2. A task due tomorrow → info to the assignee at 09:00 org time on the working day before; on the due day at 09:00 → important; marking the task done resolves both.
3. Badge counts unread only; red with an unread important.
4. «Прочитать все» → badge 0; a new important → toast + badge.
5. A member never sees another member's notifications; another org's notifications are never returned.
6. A producer error never fails its action (e.g. a task save).
7. The hourly check runs for an org with topics `off` as well.

## 10. Built (2026-11-15)

| Part | Where |
|---|---|
| Tables `notification`, `notification_pref`; watermark table dropped | `src/db/schema.ts`, migrations `0040`, `0041` |
| Registry (categories, priorities, kinds, recipients, lifetime 3 / 5 days, always-on rule) | `src/lib/notifications/kinds.ts` |
| Engine: `notify`, `resolveNotifications`, `wasNotified`, list / read / dismiss, prefs, purge | `src/server/notifications/engine.ts` |
| Hourly checks (tasks, AI usage, org profile, client-profile proposals, sources, topics runs) + `onTaskChanged` | `src/server/notifications/checks.ts`, pure `src/lib/notifications/rules.ts` (+ tests), cron `src/app/api/cron/notifications/route.ts` (`15 * * * *`, `vercel.ts` + `ORCHESTRATION_CONFIG.notifications`) |
| Event producers | handover (`client-responsible.ts`), contact-link proposals (`contact-links.ts`), deal risk (`risk-store.ts`), topic «Сейчас» (`attention/store.ts`), order confirmed (`order-links.ts`), member joined (`src/lib/auth.ts`), task assigned + hooks (`tasks.ts`), platform (`orchestration/daily-pipeline.ts`, `topics-pipeline.ts`) |
| API | `GET/POST /api/notifications`, `GET/PUT /api/account/notification-prefs` |
| UI | bell `notifications-drawer.tsx`; `/account` «Уведомления» → `account-notification-prefs.tsx`; AI limit steps 70 / 90 / 100 % (`src/lib/ai-budget.ts` `aiLimitStep`, banner + usage card) |

Notes and differences:
- **Org profile**: ONE key per week period (`profile.org.incomplete:<ISO week of the last Monday 09:00>`) instead of «first» + weekly keys — gives «at once, then every Monday» without a double notice on a Monday.
- **Sources**: no per-source sync-error columns exist; «failing» = the latest finished daily run has a sync error for the source and `last_synced_at` is not newer (+ 3 hours passed, or 3 runs in a row). Telegram webhook errors are not stored anywhere, so they are not covered.
- **Runs**: owners get `process.run_failed` for the org's failed topics runs; the daily pipeline is platform-wide → `platform.run_failed` / `platform.catalog_sync_failed` to platform admins.
- **Daily budget** text has no numbers (it is gateway cost; owners never see it).
- **Not built**: `process.daily_stats` (Q6: optional, off by default — needs a per-kind setting), `discovery.new_records` (no AUTOMATIC discovery exists today; a user's own discovery run notifies nobody, Q2), `billing.*` (billing TBD), the later set of Q5 (`deal.card_waiting`, `deal.stale`, `golden.review_waiting`, `document.too_large`).
- **Live check (test DB, 2026-11-15)**: notify + dedupe, list, read, hide; a task due today → «Срок задачи сегодня» (important) at once, done → «уже не актуально»; the hourly checks of one org → «Профиль организации заполнен на 1 из 6». All test rows removed.

# Notifications — open questions

Status: **decided 2026-11-15** (see Decisions).

| # | Question | Options | Recommendation |
|---|---|---|---|
| Q1 | Storage | (a) a `notification` table, one row per recipient, read / dismiss / resolve per row; the old watermark goes; (b) keep deriving at read time | **(a)** — priorities, per-item read state, resolve and dedupe need rows |
| Q2 | Today's «Новая компания / контакт / сделка / карточка» list (every new record of the whole org) | (a) drop it; automation results become ONE summary (`discovery.new_records`), a person's own creations notify nobody; new cards stay on the dashboard; (b) keep it as category info | **(a)** — it is noise for most members and hides the important items |
| Q3 | AI limit thresholds | (a) 70 % info, 90 % important, 100 % important; the `/account` banner and the «Использование ИИ» card switch from 80 % to the same 70 / 90 steps; (b) notifications at 70 / 90, banner stays at 80 % | **(a)** — one rule everywhere |
| Q4 | «Company profile quality reminders» — which profile | (a) the ORG profile («Профиль организации», owner): at once, then weekly while incomplete; + a daily digest of pending client-profile proposals to the responsible members; (b) also a quality score of every CLIENT profile (missing industry / role / size) as reminders to the responsible member | **(a)** now; (b) later if wanted (needs a score definition) |
| Q5 | Extra producers (spec §5) | (a) build now: `deal.risk_new`, `topic.now`, `order.confirmed_by_client`, `member.joined`, `discovery.new_records`, `platform.*`; later: `deal.card_waiting`, `deal.stale`, `golden.review_waiting`, `document.too_large`; (b) another set | **(a)** |
| Q6 | Process stats | (a) errors / warnings as they happen (sync failing 3×, run failed) + an optional daily summary (`process.daily_stats`, off by default per user); (b) errors only | **(a)** |
| Q7 | Task reminders — who and when | (a) assignee only; due tomorrow at 09:00 org time on the working day before (Friday for a Monday task), due today at 09:00, overdue once the next morning (assignee + creator when different); tasks with a time of day: «today» at 09:00 or 2 h before, whichever is earlier; (b) calendar days, assignee only, no overdue | **(a)** |
| Q8 | Can users switch notifications off | (a) per category in /account «Уведомления»; important `tasks` / `ai` / `processes` always on; (b) no settings now | **(a)** |
| Q9 | Other channels | (a) in-app only now; important by e-mail / Telegram later (reuse the topics delivery channels, topics/08 T1–T2); (b) e-mail for important now | **(a)** |
| Q10 | Badge | (a) unread count, red when an important is unread, grey for info only; toasts only for important; (b) one count, always red, toasts for all | **(a)** |
| Q11 | Retention | (a) info 30 days, important 90 days, read + resolved deleted after 90 days; (b) keep everything | **(a)** |
| Q12 | Platform notifications | (a) category «Платформа» for platform admins (catalog sync, cron failures, AI policy) in the same bell; (b) none | **(a)** |

## Decisions

| # | Decision (2026-11-15, product owner) |
|---|---|
| Q1, Q2, Q4–Q10, Q12 | As recommended |
| Q3 | Thresholds 70 % info / 90 % important / 100 % important everywhere (banner + card too). **Recipients:** AI usage, billing, company profile (org profile AND the client-profile proposals digest) and process stats / warnings / errors (sources, runs) go to the **org OWNER(S) only**. Notifications about a person's own work (task reminders, deal risks of their deals, topics assigned to them, orders they created, handovers to them, contact-link proposals of companies they are responsible for) go to that person |
| Q11 | **info: 3 days, important: 5 days** — then hidden automatically; the user may close (hide) one earlier. Read rows also stay until expiry; a daily job deletes rows 30 days after expiry |

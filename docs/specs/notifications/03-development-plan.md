# Notifications — development plan

Status: **built 2026-11-15** (NF1–NF5; see spec §10). One developer with AI assistance, working days.

| Phase | Name | Days | Output |
|---|---|---|---|
| NF1 | Model + engine | 1 | migration `notification` (+ drop the watermark table use), kind registry, `notify` / `resolveNotifications`, recipient rules, retention job; API `GET/POST /api/notifications`; unit tests of dedupe / recipients |
| NF2 | Bell UI | 1 | badge (red / grey), sheet with «Все» / «Важные» + category filter, read / dismiss / «Прочитать все», resolved state, toasts for important only |
| NF3 | Condition checks | 1.5 | hourly job for every org (cron `/api/cron/notifications` or a phase in the existing hourly route), org time zone + working days; checks: AI limit 70 / 90 / 100 + daily budget, org profile, client-profile proposals digest, task due tomorrow / today / overdue, source sync failing, run failed |
| NF4 | Event producers | 1 | handover + contact-link proposals moved from «derived» to `notify`; Q5 set (deal risk, topic «Сейчас», order confirmed, member joined, discovery summary, platform) |
| NF5 | Settings + docs | 0.5 | /account «Уведомления» categories; AGENTS.md / docs; live check of acceptance 1–7 |

Total ≈ 5 days. Migration: NF1 (schema only).

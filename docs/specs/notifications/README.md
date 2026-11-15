# Notifications

Specs for in-app notifications (the bell «Уведомления» in the page header): stored notifications per user with categories and two priorities (important / info), one engine for event producers and hourly condition checks (AI limits, profile reminders, processes, task reminders, …).

Status: **built 2026-11-15** (not deployed). Spec §10 = what was built.

| File | Content |
|---|---|
| [01-notifications.md](01-notifications.md) | What exists, model (`notification` table, engine, kind registry), categories, recipients, lifetime, producers, suggested producers, settings, UI, API, acceptance checks |
| [02-open-questions.md](02-open-questions.md) | Q1–Q12 with recommendations; decisions log |
| [03-development-plan.md](03-development-plan.md) | Phases NF1–NF5, ≈ 5 days |

# Topics (Темы)

A Topic is one business question extracted from one or more source items, scored by signals and an attention engine, and shown as one card. Deal-related signals drive the sales funnel.

| File | Content |
|---|---|
| [00-source-analysis.md](00-source-analysis.md) | What the inputs say: concept diagram, Maslov catalog, Truffalo export, current repo; main conclusions |
| [01-specification.md](01-specification.md) | What to build: definitions, taxonomy, extraction, topic resolution, lifecycle, attention, cards, deals, Russian-language rules, data model, evaluation, operations, UI |
| [02-open-questions.md](02-open-questions.md) | Questions to answer before development (blocking ones marked), with recommendations |
| [03-development-plan.md](03-development-plan.md) | Phases, estimates, exit criteria, risks |
| [02-open-questions-answers.md](02-open-questions-answers.md) | Business answers (Q24 = Maslov catalog gaps), source text |
| [05-signals-registry.md](05-signals-registry.md) | Signals registry: fields, weight scale, Russian cue rules, activation, prompt building, validation. Per-pack code lists: [05a](05a-signals-base-a-g.md) base A–G · [05b](05b-signals-base-h-n.md) base H–N + attributes + relations · [05d](05d-signals-agency.md) agency + 26 risks (**phase-9 document**: the `agency` pack is not seeded or built in the MVP, R5) |
| [06-attention-engine.md](06-attention-engine.md) | Attention engine: instance score, topic score with several signals, boosts, profiles, deadlines, lists, reminders, expiry, explanation, examples |
| [07-signals-go-live.md](07-signals-go-live.md) | Go-live runbook for the signals automation: the flow end to end, every switch, what the test environment cannot prove, technical and business switch-on steps with checks, monitoring, stop / rollback, open points |

Pilot: **IN4COM** (decided 2026-11-10). **R22 (2026-11-14):** the signals registry is **one generic set for every org** (R23, `0017`: every proposed code is `active`, no retired codes) — no wine / alcohol content, no IN4COM-specific signals or rules, no presets (migration `0016_signals_generic_registry`). IN4COM switches the `base` pack on and gets every `active` code. `04-distribution-pack-draft.md` and `05c-signals-distribution.md` are deleted (git history keeps them).

Inputs (unchanged): `topics concept.png`, `Сигналы_Маслов_каталог_и_правила.docx`, `truffalo-logic-2026-11-10-10-05/`, `Описание требований - v2.md` (business requirements v2: deal state, deal risks, agency roles, scenarios, funnel).

Status: Reviewed 2026-11-13: decisions R1–R23 (see [02-open-questions.md](02-open-questions.md) § F); final plan in [03-development-plan.md](03-development-plan.md). **Phases 0 and 1 built 2026-11-13, phase 2 built 2026-11-14** (not deployed): foundations (budget, org settings, agent user, hourly run, golden set, model spike), the signals registry (DB, one generic pack, «Сигналы» editor) and signal extraction (gates, exclusions, extraction + post-processing in the hourly run, eval runner, signal review). Next: phase 3 (topic engine). Drafted 2026-11-10; registry and attention specs added 2026-11-11.

`00-source-analysis.md` describes an older copy of the repo; the real current state is in `03-development-plan.md` «Current state (2026-11-13)». `05d` (agency pack) stays a document until phase 9 (second pilot).

The catalogs 05a–05b (and the deleted 05c) are the **historical source** of the registry seed (migration `0012`). After the seed the DB is the master; change signals in «Сигналы». R22 (`0016`) cleaned the DB texts; 05a / 05b are not updated and still show the old «IN4COM» column. The former distribution blocks DS1–DS7 are the generic blocks O–U in the DB.

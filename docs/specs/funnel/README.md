# Funnel (custom deal funnel per organization)

Org-specific deal funnel: stages with their meaning, entry conditions and signals, the entry gate (go / no-go), automatic stage moves from client actions, outcomes with reasons, and forecast rules — configurable per organization and used by the topics deal bridge. First org: the test account **IN4COM GmbH** (`1dNkC4rBtl9FEvnK95Svlfs63oSU57Ni`), with the funnel of the requirements document; every other org keeps its funnel unchanged.

Status: **built 2026-11-15** (Q1–Q13; Q4 generic codes for every org; Q10 owner self-service incl. rules, templates, validation, preview). Migrations `0037_custom_funnel` + `0038_funnel_codes_and_templates` applied on the test DB; IN4COM GmbH runs «Тендеры и конкурсы» (applied from `in4com-funnel.json`). Not deployed. Open: F5 golden-set eval before relying on the new codes. 2026-11-16: the AI chat creates deals (no gate) and moves deals with the org's lost reasons after the user confirms a card ([ai-chat-tools](../ai-chat-tools/README.md); 01 §3.2, §3.5).

| File | Content |
|---|---|
| `Описание требований.docx` | Source: «Структура воронки агентства» (product owner) — area 0 + 5 stages, entry conditions, signals, rules (entry gate, automatic moves, in-stage events, outcomes, forecast) |
| [01-specification.md](01-specification.md) | Requirements in English, current state (what the engine already does, the gaps), the generic org funnel model, engine changes, the IN4COM configuration, UI, API, data, acceptance checks |
| [02-open-questions.md](02-open-questions.md) | Q1–Q13 with recommendations (incl. the conflict with the earlier decision «no go / no-go», topics Q24-7); decisions log |
| [03-development-plan.md](03-development-plan.md) | Phases, estimates, migrations, the one-time IN4COM setup |
| [in4com-funnel.json](in4com-funnel.json) | Tenant data: the IN4COM `FunnelConfig` (= template `tenders_5` + the old deal types hidden), applied once through `applyFunnelConfig` / admin import — never a migration. Checked by `src/lib/funnel/templates.test.ts` |

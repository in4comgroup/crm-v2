# Custom deal funnel — development plan

Status: **F1–F4 built 2026-11-15**; F5 (eval) open. One developer with AI assistance, working days.

| Phase | Name | Days | Output |
|---|---|---|---|
| F1 | Model | 1.5 | migration: `deal_funnel_stage.role | code | description | entry_condition | signals_hint | in_forecast | probability_mode` (+ backfill), `funnel_template` (platform reference data), `deal.expert_probability | expert_probability_by | _at | brief_budget | outcome_reason_code`; org settings `deals.entryGate`, `deals.outcomeReasons`; role-based `outcomeStage` (every name-based «Closed» / «Rejected» check replaced); pure forecast helper (unit-tested) |
| F2 | Engine | 1.5 | entry gate (go / no-go card, reasons, history line); outcome reasons; forecast rules on the board; stage definition in the deal-state / confirmation prompts (gated); 7 generic signal codes (custom migration `0038`, `active` for every org — Q4) + stage-rule templates |
| F3 | UI | 3 | «Настройки воронки» dialog (stages, rule editor per stage, deal types, reasons, gate, templates, preview, validation errors); board hints + forecast header; deal drawer fields + outcome dialogs; go / no-go card |
| F4 | Config + templates + IN4COM | 1.5 | `FunnelConfig` + validation + `applyFunnelConfig` + preview + admin import / export; 2 platform templates (migration); IN4COM = template «Тендеры и конкурсы» + its reasons / types, one-time apply + deal stage mapping (Q7); old rules disabled |
| F5 | Eval | — | golden-set eval of IN4COM extraction with the new codes before relying on automatic moves |

Total ≈ 7.5 days. Migrations: F1 (schema), F2 (registry codes, custom). Tenant data (IN4COM) only through `applyFunnelConfig`, never a migration.

## Status (2026-11-15)

| Phase | Status | Notes |
|---|---|---|
| F1 | Done | Migration `0037_custom_funnel` (stage role / code / texts / forecast fields + backfill, deal expert probability / brief budget / reason code, `funnel_template`). Role-based logic everywhere (`deal-engine.ts`, `deals.ts`, `clients.ts`, deal bridge, `deal-board.ts` / `deal-funnel.ts` helpers, reactivation check); no stage-name checks left |
| F2 | Done | Migration `0038_funnel_codes_and_templates`: 7 generic codes (active for every org with the `base` pack), 9 platform rule templates, 2 funnel templates (source `src/lib/funnel/templates-source.ts`, test compares with the SQL). Entry gate (`proposal.gate`, «Go» / «No-go» with `nogo:<code>`, journal `deal_no_go`), outcome reasons, stage entry condition in the deal-state prompt (gated) and the deal cards |
| F3 | Done | «Настройки воронки» (stages, rule editor, types, reasons, gate, templates, preview, validation), board (roles, forecast «Прогноз» / «Без оценки» / «Выиграно», column hints, reason dialogs), drawer (expert probability, brief budget, «Мы вышли» with reason), go / no-go card, create form by role |
| F4 | Done | `src/server/funnel-config.ts` + `api/deals/funnel` + admin `api/admin/funnel`; stages / types without an id are matched by CODE before validation (templates / imports onto an org with deals). IN4COM: deals mapped first (Pilot → s2: 6, Proposal → s3: 7, Negotiations → s3: 3; one `deal_activity` row each), then `in4com-funnel.json` applied: 7 stages, gate `go_no_go`, 26 rules (the old distribution rules removed), 3 new deal types + 5 old hidden, reason lists; a second apply changes nothing |
| F5 | Open | Golden-set eval of extraction with the 7 new codes before relying on automatic moves |

Known limits: the preview is an approximation (ignores admin guards and existing deal types); a no-go is kept in the card + topic journal (no company-history feed reads it); the old default deal types of a NEW org (`ensureDefaultDealTypes`) and the type sets of the deal-risk engine are still distribution wording — follow-up.


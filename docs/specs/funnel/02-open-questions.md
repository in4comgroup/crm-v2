# Custom deal funnel — open questions

Status: **answered 2026-11-15** (Q4 changed: generic codes active for every org).

| # | Question | Options | Recommendation |
|---|---|---|---|
| Q1 | **Go / no-go gate.** The topics decision Q24-7 (2026-11-10) said «no go / no-go anywhere: creation and stage depend only on client events». The new document (W1) requires a go decision before the pipeline | (a) an ORG setting `deals.entryGate = go_no_go` (IN4COM on, every other org off — Q24-7 stays the default); (b) no gate (keep Q24-7); (c) gate for every org | **(a)** — with the gate the engine never auto-creates; every new opportunity is a card «go / no-go?» (go = create, no-go = reason) |
| Q2 | Who may decide go / no-go and who switches the gate | (a) any member decides on the card; the owner switches the gate in «Настройки стадий»; (b) only the owner decides; (c) a role «new biz / pitch lead» (needs functional roles — separate work O1) | **(a)** now, (c) when roles exist |
| Q3 | Stage 5 «Заказ подтверждён» | (a) it IS the won (terminal) stage — a confirmed order closes the opportunity as won; (b) an active stage + a separate won | **(a)** — «победа без подтверждённого заказа остаётся на стадии 4»; payment is separate |
| Q4 | Signal codes for stages 2–5 and loss | (a) 7 new GENERIC codes in the base registry (§5), `onHold` for every org, active only for IN4COM; (b) seed the agency pack 05d (PITCH_*) for IN4COM (topics phase 9); (c) only existing codes (stages 3–4 then only by hand) | **(a)** — industry-neutral, small, IN4COM-only; eval before relying |
| Q5 | The code → stage table of §4 | confirm / change | as in §4 |
| Q6 | IN4COM deal types | (a) the 3 kinds of the document («Новый клиент», «Существенный допзаказ действующего клиента», «Повторный конкурс за текущий контракт»); old types hidden (kept for history); (b) keep the old types | **(a)** — the old types are old vertical content |
| Q7 | Existing IN4COM deals (55; 15 active) in old stages | (a) map: Qualification → «Новая возможность», Discovery / Pilot → «Запрошены материалы или решение», Proposal / Negotiations → «Финальный выбор», Closed → «Заказ подтверждён», Rejected → «Не состоялась», area 0 stays; (b) all active → «Новая возможность»; (c) delete test deals | **(a)**, journaled as one system move per deal |
| Q8 | Forecast | (a) stages 0–2 out; 3–4 in with the deal's amount × EXPERT probability (both required, else «Без оценки»); won shown apart as actual; (b) stage probabilities for 3–4 | **(a)** — W5 |
| Q9 | Amounts | (a) `deal.value` = the opportunity forecast; new «Бюджет из брифа» on the deal (never in the forecast); the director's upsell plan = a later company-level plan; (b) only `deal.value` | **(a)** |
| Q10 | Owner editor of the funnel | (a) add / rename / describe / reorder / hide / forecast settings / reasons / gate; delete only empty stages; stage RULES stay with the platform admin («Сигналы»), shown read-only per stage; (b) owner also edits the rules | **(a)** |
| Q11 | Outcome reasons | (a) per-org lists (lost / no-go / withdrawn) with generic defaults, owner edits; IN4COM gets the lists of §4; (b) free text only (today) | **(a)** |
| Q12 | How the IN4COM configuration is applied (tenant data must not go into a migration) | (a) a generic server function `applyFunnelConfig(orgId, config)` + admin JSON import / export on `/settings`; the IN4COM JSON kept next to this spec and applied once; (b) entered by hand in the UI; (c) a reusable platform template «Агентство» for other orgs | **(a)**; (c) later if other orgs want it |
| Q13 | Stage definitions in the AI | (a) deal state + stage-confirmation card see the stage name + entry condition (behind «Профиль в промптах»); (b) not now | **(a)** |

## Decisions

| # | Decision (2026-11-15) |
|---|---|
| Q1 | (a) org setting `deals.entryGate = go_no_go`; on for IN4COM only; Q24-7 stays the default for other orgs |
| Q2 | (a) any member decides on the card; the owner switches the gate |
| Q3 | (a) «Заказ подтверждён» = the won stage |
| Q4 | **Changed:** the 7 codes are GENERIC and ACTIVE for every org (a custom funnel needs only its own stage rules, not its own codes) + added to the platform stage-rule templates (s2 / s3 / s4 / won / lost); golden-set eval before relying on automatic moves |
| Q5 | as in §4 |
| Q6 | (a) the 3 deal types of the document; old types hidden |
| Q7 | (a) old → new stage mapping |
| Q8 | (a) forecast: stages 3–4 with amount × expert probability; «Без оценки»; won apart |
| Q9 | (a) `deal.value` = forecast; «Бюджет из брифа»; upsell plan later |
| Q10 | **Changed:** the owner edits EVERYTHING of the funnel in the dialog, incl. the stage rules (simple editor with safe defaults; the admin keeps the full editor and its advanced guards are kept), with validation on save, a preview «Что бы сдвинулось» and platform templates («Продажи B2B (стандарт)», «Тендеры и конкурсы (5 стадий)»); IN4COM starts from the template — no code per org (spec §3.7) |
| Q11 | (a) per-org reason lists |
| Q12 | (a) `applyFunnelConfig` + admin JSON import / export; one-time IN4COM apply |
| Q13 | (a) stage definitions in the deal-state / confirmation prompts (gated) |

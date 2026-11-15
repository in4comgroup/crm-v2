# Daily AI budget per organization

Status: **implemented 2026-11-13** (topics plan phase 0, decision R4 in
`docs/specs/topics/02-open-questions.md` § F).

## 1. Rule

Each organization has a daily AI budget: gateway cost in USD per UTC day
(`coalesce(cost_actual_usd, cost_estimate_usd)` of its `ai_usage_event` rows
since 00:00 UTC).

| Process kind | When the budget is used up |
| --- | --- |
| `background` (parsing, generation, topics engine) | **Refused before the call**: a usage event with `status = blocked`, `error_type = budget_exceeded` is written, then `AiBudgetExceededError` is thrown. The caller treats it like any AI failure (e.g. a parse becomes `failed` and is retried by the next run). |
| `interactive` (AI chat, assistants, enrichment, order split) | **Runs anyway** (a user is waiting); a warning is logged. |
| Calls without an organization (`systemCall`) | Not budgeted. |

## 2. Settings

| Key | Where | Default | Meaning |
| --- | --- | --- | --- |
| `ai.budget.daily_usd` | `platform_setting` | 5 | Default budget for every organization |
| `ai.budget.daily_usd` | `org_setting` (per org) | null | Override for one organization; null = default; 0 = no background AI |

Both are edited by the platform admin in the «Дневной бюджет ИИ» block on
`/settings` → «Использование ИИ» (`api/admin/ai/settings`: `budgetDefaultUsd`,
`orgBudget`). Changes are logged (`platform_setting_log`, `org_setting_log`).

## 3. Implementation

- `src/server/ai/budget.ts`: `getOrgBudgetStatus`, spend cache (one DB sum
  per org per 30 s plus the cost of calls recorded by this instance —
  `noteSpend` from the usage recorder), `listOrgBudgets` (admin view).
- `src/server/ai/runtime.ts`: `enforceBudget` after process resolution, in
  both `aiGenerateText` and `aiStreamText`.
- Overshoot: other server instances' spend appears within 30 s, and one call
  can cost more than the remaining budget. Accepted; the budget is a guard,
  not a billing limit.
- Owners: `/account` → «Использование ИИ» shows «Дневной лимит ИИ исчерпан»
  without amounts (the budget is gateway cost, which owners never see).
- Since 2026-11-15 a second limit exists: the MONTHLY limit in end-user
  cost, shown to owners — [08-monthly-limit.md](08-monthly-limit.md). The
  admin block is now «Лимиты ИИ по организациям» (both limits).
- The usage tab status filter has «Остановлено бюджетом».

## 4. Tested (2026-11-13)

With an org override of 0: a background call (`parsing.email`) was refused
and recorded as `blocked / budget_exceeded`; an interactive call
(`chat.session_analysis`) ran and was logged; the admin list showed the
spend. Test rows removed.

# Monthly AI limit per organization

Status: **implemented 2026-11-15** (product owner request). Related: daily
budget [07-daily-budget.md](07-daily-budget.md), markup
[05-markup-and-end-user-cost.md](05-markup-and-end-user-cost.md).

## 1. Rule

Each organization has a monthly AI limit in **end-user cost** (USD):
Σ `coalesce(cost_actual_usd, cost_estimate_usd) × (1 + markup_percent / 100)`
of its `ai_usage_event` rows since the 1st of the calendar month, 00:00 UTC.
It is the same money the owner sees on `/account` → «Использование ИИ», so
the owner can see the limit and the spend (unlike the daily budget, which is
gateway cost and stays hidden).

| State | When | Effect |
| --- | --- | --- |
| `ok` | spend < 80 % | — |
| `warning` | 80 % ≤ spend < 100 % | Amber warning for the owner on `/account` |
| `exceeded` | spend ≥ limit (a limit of 0 = always) | Red warning; **background** AI processes are refused like with the daily budget (usage event `status = blocked`, `error_type = monthly_limit_exceeded`, `AiBudgetExceededError` with `period = "month"`); **interactive** ones run and are logged. Resets on the 1st of the next month (UTC) |

Both limits are checked by the same runtime gate (`enforceBudget`); background
AI stops when EITHER is used up. Pure state: `aiMonthlyLimitState` in
`src/lib/ai-budget.ts` (threshold `AI_MONTHLY_WARN_SHARE` = 0.8, unit-tested).

## 2. Settings

| Key | Where | Default | Meaning |
| --- | --- | --- | --- |
| `ai.budget.monthly_usd` | `platform_setting` | **20** | Default monthly limit for every organization |
| `ai.budget.monthly_usd` | `org_setting` (per org) | null | Override for one organization; null = default; 0 = no background AI |

Edited by the platform admin in the block «Лимиты ИИ по организациям» on
`/settings` → «Использование ИИ» (`api/admin/ai/settings`:
`monthlyLimitDefaultUsd`, `orgMonthlyLimit { organizationId, monthlyUsd }`),
next to the daily budget; the table shows each org's spend this month (with
markup), its share and the effective limit. Changes are logged
(`platform_setting_log`, `org_setting_log`). An empty override is stored as
NO row (`setOrgSetting` with null deletes the row — `org_setting.value` is
NOT NULL; this also fixed «reset to default» of the daily override).

## 3. Owner view (`/account`)

- Tab «Использование ИИ»: card «Месячный лимит ИИ» — spend of this month of
  the limit, %, progress bar, remaining, reset date; the warning text above
  it when the state is not `ok` (also «Дневной лимит ИИ исчерпан» without
  amounts).
- Banner on every other `/account` tab (like the «Профиль организации»
  banner, `ai-limit-banner.tsx`): owner only, `GET
  /api/account/ai-usage?banner=1` (non-owners get `{ show: false }`). Later
  the same states go to the general notifications.

## 4. Implementation

- `src/server/ai/budget.ts`: `getOrgMonthlyLimitUsd`, `queryOrgSpendMonthUsd`,
  month spend cache (30 s, plus `noteSpend(orgId, usd, markupPercent)` from
  the usage recorder), `getOrgBudgetStatus` → `{ exceeded, budgetUsd,
  spentUsd, dailyExceeded, monthly }`, `listOrgBudgets` (+ monthly columns).
- `src/server/ai/runtime.ts`: `enforceBudget` picks the period (month wins
  when both are used up). Callers that show a message read
  `AiBudgetExceededError.period`.
- Tested 2026-11-15 on the test DB: an org override of $0.05 → state
  `exceeded`, a background call refused with `monthly_limit_exceeded`; reset
  to default → no row, limit $20 again. Test rows removed.

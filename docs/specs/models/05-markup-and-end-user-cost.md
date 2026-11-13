# Markup and end-user cost (R5, part 2)

## 1. Goal

The platform admin sets one global markup %. End users see AI cost as
gateway cost plus markup; they never see the raw gateway cost.

## 2. Table `platform_setting`

Generic key/value store for platform-wide settings (also used by the model
policy in 03 §7).

| Column | Type | Note |
| --- | --- | --- |
| `key` | text PK | e.g. `ai.markup_percent` |
| `value` | jsonb | e.g. `25` |
| `updated_by_user_id` | text FK → user | |
| `updated_at` | timestamp | |

Changes are logged in `platform_setting_log` (key, old, new, who, when).

Keys for this spec:

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `ai.markup_percent` | number 0–1000 | 0 | Markup on top of gateway cost |
| `ai.policy.zdr_only` | boolean | false | 03 §7 |
| `ai.policy.no_training_only` | boolean | false | 03 §7 |
| `ai.policy.allowed_vendors` | string[] | [] (= all) | 03 §7 |

## 3. Calculation

```
end_user_cost = cost × (1 + markup_percent / 100)
cost          = coalesce(cost_actual_usd, cost_estimate_usd)
```

- Each usage event stores the markup **in force at the time of the call**
  (`ai_usage_event.markup_percent`). Changing the markup does not change past
  amounts; it applies to new calls only.
- Rounding: stored with full precision; shown rounded to 2 decimals (cents).
  Very small amounts show «< $0.01».

## 4. Admin UI

On the «Использование ИИ» tab, block «Наценка»:

- Field «Наценка, %» + «Сохранить». Shows who changed it last and when.
- Example line: «Себестоимость $10.00 → для клиента $12.50».
- History (last 10 changes).

## 5. End-user display (decided 2026-11-13: Q1, Q3)

- **Where:** organization page `/account`, new tab «Использование ИИ», for
  org **owners**.
- **Content:** period filter; KPIs «Вызовы», «Стоимость» (with markup);
  table per process («Разбор писем», «ИИ чат», …) with calls and cost; per
  user for interactive processes.
- **Never shown to end users:** gateway cost, markup %, model ids (shown as
  the process name only).
- **Currency:** USD (gateway prices are USD).

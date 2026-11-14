# ToDo — postponed work

Work that is decided but **not scheduled**. Each item names its source in the specs. When an item is scheduled, move it into the spec folder of its topic (`docs/specs/<topic>/`) and delete it here.

Last update: 2026-11-14.

## Topics engine (`docs/specs/topics/`)

| # | Item | What | Source | Notes |
|---|---|---|---|---|
| T1 | **Phase 11 — external market signals** (important) | AI process `topics.external_search` (web search per client / watch list through the AI gateway, `capabilities: ["web_search"]`; today only Google models can search) → `topics.external_extraction` (market codes only, quote + URL, `signal_instance.origin = external`, `external_url`) → the same topic / attention flow. Watch list per org, 90-day trend cooldown per client + code. Also the data source for SIGNAL_SPEND_UP / SPEND_DOWN / NEW_TOP_SPENDER / TRACKING_GAP (`CHECKS_NOT_BUILT` in `src/lib/topics/checks.ts`) | Plan phase 11 (`03-development-plan.md`); spec 01 §1.2, §5.6 | ≈ 2 weeks. AI cost per client and run → agree a budget first. Process codes can reuse the phase 8 check framework (`src/server/topics/checks/`) |
| T2 | **Telegram** (inbound groups, files, voice notes; outbound staff pushes) | See the reference file | [08-telegram-and-topics.md](../specs/topics/08-telegram-and-topics.md) | Needs a deployed environment (public webhook URL) |
| T3 | Weighted forecast view | A screen for the weighted deal forecast; the data rule exists (spec 01 §9.5: stage probability × amount, the owner's win estimate) | Spec 01 §1.2, §9.5 | Agency pilot (phase 9) needs `deal.win_estimate*` first |
| T4 | Learning from feedback | Weights stay fixed today; reject reasons and missed items are stored for manual tuning only. Later: suggest weight / text changes from the feedback | Spec 01 §1.2 | After the 4-week tuning loop gives data |
| T5 | Mailbox read-state timers | «grace» / «forgotten» timers from per-user read state (`\Seen`) | Spec 01 §1.2 | Needs per-user read flags from the mail sync (not synced today) |

## Other areas (named by the topics spec as separate work)

| # | Item | What | Source |
|---|---|---|---|
| O1 | Functional roles, rights and per-person routing | Roles per org, who sees which topics / deals; routing of topics by role | Q13, Q33 — a separate spec topic later (`docs/specs/roles/`) |
| O2 | Contact groups | Alumni, expert club, contractors as contact groups | Spec 01 §1.2 |
| O3 | Pipeline import from spreadsheets | Import deals / pipeline from XLSX / Google Sheets | Spec 01 §1.2 |
| O4 | Finance integration (1С) | Invoices, payments, debts from 1С as system-of-record data (would feed INVOICE_* codes and the CLIENT_DEBT risk) | Spec 01 §1.2 |

# ToDo — postponed work

Work that is decided but **not scheduled**. Each item names its source in the specs. When an item is scheduled, move it into the spec folder of its topic (`docs/specs/<topic>/`) and delete it here.

Last update: 2026-11-16.

## Topics engine (`docs/specs/topics/`)

| # | Item | What | Source | Notes |
|---|---|---|---|---|
| T1 | **Phase 11 — external market signals** (important) | AI process `topics.external_search` (web search per client / watch list through the AI gateway, `capabilities: ["web_search"]`; today only Google models can search) → `topics.external_extraction` (market codes only, quote + URL, `signal_instance.origin = external`, `external_url`) → the same topic / attention flow. Watch list per org, 90-day trend cooldown per client + code. Also the data source for SIGNAL_SPEND_UP / SPEND_DOWN / NEW_TOP_SPENDER / TRACKING_GAP (`CHECKS_NOT_BUILT` in `src/lib/topics/checks.ts`) | Plan phase 11 (`03-development-plan.md`); spec 01 §1.2, §5.6 | ≈ 2 weeks. AI cost per client and run → agree a budget first. Process codes can reuse the phase 8 check framework (`src/server/topics/checks/`) |
| T2 | **Telegram** — outbound staff pushes (T1–T6), the staff «note about a client» rule (I3), media edits / deletions (I4). Inbound groups + files: built 2026-11-15 in [telegram/](../specs/telegram/README.md) | See the reference file | [08-telegram-and-topics.md](../specs/topics/08-telegram-and-topics.md) | Needs a deployed environment (public webhook URL) |
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

## AI chat (`docs/specs/ai-chat/`, `docs/specs/ai-chat-tools/`)

Write actions from the chat (former O5) are built: [ai-chat-tools/](../specs/ai-chat-tools/README.md), 2026-11-16.

| # | Item | What | Source |
|---|---|---|---|
| A1 | Overwrite existing values from the chat | «Дополнить» today only fills empty fields and adds extra addresses / aliases (Q3 B). Later: also change a filled value, with an old → new diff in the card | [ai-chat-tools/02-open-questions.md](../specs/ai-chat-tools/02-open-questions.md) Q3 («C later») |

## Tests and commercial setup

| # | Item | What | Source | Notes |
|---|---|---|---|---|
| C1 | **Decide the work calendar** | All orgs use ONE work calendar today: the Russian state holidays 2026–2027 (`work_calendar_day`, migration `0020`; exceptions only — a year with no rows = plain Mon–Fri). It drives the «Сейчас» / «Сводка» / «Неделя» lists, deadlines, card expiry, digests and the Friday review (`src/lib/topics/attention-calendar.ts`). This is old content. Options: (a) keep the Russian calendar for every org; (b) a calendar per country chosen per org (org setting + rows per country); (c) remove it — every org uses plain Mon–Fri. Recommendation: (b), built when the first org outside Russia starts | Topics spec 06 §6 (calendar), plan phase 4 | Decide before the tests with real orgs and before the commercial setup. The default time zone is already Europe/Vienna (2026-11-15) |
| C2 | **Generic product catalog** | The products module is built for ONE catalog shape: drinks (attributes `sugar`, `aging`, `bottleVolume`, `color`, `region`, `countryName`, `appelacion`, `rating`, `awards`; Search V2 generated columns `is_drink` / `is_gift` / `region_norm` in `migrations/0002`; analytics product slices by country / region / colour / type / sugar; price-list export region → colour → vendor; order-from-request split fields + the drink stop-word list in `src/server/order-requests.ts`). This shape came with the old code. Rebuild it generic: catalog attributes defined per org (name, type, filterable, sort), filters / search / analytics / export / order split read that definition. IN4COM's 16,815 SKUs keep working through an attribute definition for their data | Product owner, 2026-11-15 (cleanup of old content) | Separate spec `docs/specs/catalog/` first. Until then the module stays as it is |
| C3 | **Generic default deal types + deal-risk type sets** | `ensureDefaultDealTypes` (`src/server/deal-types.ts`) still creates the distribution types `new_location`, `listing`, `tender`, `supply_agreement`, `renewal` for every org (and re-adds missing ones), and the deal-risk engine (`src/server/topics/deal-state/risk-engine.ts`) has hard-coded type sets (`LISTING_DEAL_TYPES`, `RENEWAL_DEAL_TYPES`) — old vertical content. Replace by the generic types of the template «Продажи B2B (стандарт)» and make the risk conditions read a type ROLE (e.g. `renewal`) from data | `docs/specs/funnel/03-development-plan.md` § Status (known limits) | Changing the defaults adds types to existing orgs (ensure re-adds missing ones) — needs a short migration plan |

## Deployment checklist

Steps to do on the deployed environment, once, when the related code ships.

| # | Item | What | Source |
|---|---|---|---|
| D1 | **Telegram bot: privacy mode off** | In @BotFather: `/setprivacy` → choose the bot → **Disable**. Then remove the bot from each group and add it again (or make it a group admin). Without this the bot sees in groups only commands, replies to the bot and @mentions. Check: the Telegram source settings → «Группы» shows «Бот читает все сообщения групп» | [telegram/01-telegram-files.md](../specs/telegram/01-telegram-files.md) §6 G1 |
| D2 | **Telegram bot: register the webhook again** | Save the bot credentials of each Telegram source again (Sources → «Учётные данные»). This re-registers the webhook with the new update list (`message` + `my_chat_member` = group membership) and runs the privacy check. A running webhook keeps the old list until then | telegram §7 «Deployed bots» |
| D3 | **Own Telegram names** | Each member adds their Telegram name in /profile → «Мои рабочие адреса», so their Telegram messages count as ours (outbound / internal), are never linked as a contact, and give the counterparty of group messages | telegram Q11 |
| D4 | **Real Telegram test** | Send the bot a PDF in a private chat and in a group (with and without caption), a photo, a file > 20 MB and a voice note. Check: «Документы» of the sender's contact / company (file stored, linked); the reply in the private chat (Russian), no reply in the group; within the hourly run — signals / a topic from the file text; the 20 MB file listed as «больше 20 МБ» | telegram §5 acceptance checks 1–13 |
| D5 | **Notifications cron** | The new hourly cron `/api/cron/notifications` (`15 * * * *`, in `vercel.ts`) needs the Vercel Pro plan like the topics cron and the same `CRON_SECRET`. After the deploy check in Vercel → Cron Jobs that it runs, and that the bell shows notices (an org profile reminder for an incomplete profile is the first one to expect) | [notifications/01-notifications.md](../specs/notifications/01-notifications.md) §10 |

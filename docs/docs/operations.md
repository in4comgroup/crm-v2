# Operations

[Back to index](./README.md)

## Local setup

Prerequisites: Node.js (version with native `fetch`; the scripts pass
`--dns-result-order=ipv4first`), pnpm, access to a Neon database, an R2 bucket,
and a Vercel AI Gateway key.

1. Clone `https://github.com/in4comgroup/crm-v2` (branch "design").
2. `pnpm install`
3. Create `.env` in the repository root with the variables listed below
   (ask the team for values; never commit `.env` — `.env*` is git-ignored).
4. `pnpm dev` and open `http://localhost:3000`.
5. Sign in with an email OTP code (sent through the configured email provider).
   A new email creates a user and a default organization.

The current database is a Neon Postgres copy that already holds data
(2 organizations, 7 users). Treat it as shared; do not run destructive scripts
against it.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Next.js dev server (8 GB heap, IPv4-first DNS) |
| `pnpm build` | Production build. **Type errors do not fail the build** (`typescript.ignoreBuildErrors: true`). |
| `pnpm start` | Serve the production build |
| `pnpm lint` | ESLint (`eslint.config.mjs`, Next.js config) |
| `pnpm exec tsc --noEmit` | Type check. There is no `typecheck` script; run this by hand or in CI, because the build does not check types. |
| `pnpm db:generate --name <what>` | Generate a migration from `schema.ts` changes |
| `pnpm db:custom --name <what>` | Create an empty custom SQL migration |
| `pnpm db:migrate` | Apply pending migrations to `DATABASE_URL` |
| `pnpm db:check` | Check the migration folder |
| `pnpm test` | Unit tests (vitest, `vitest.config.mts`; `src/**/*.test.ts`; `@/` alias; `server-only` is stubbed so pure server modules can be tested). Pure modules only: e.g. the Russian mail library `src/lib/ru-mail/`, topics post-processing / gates / attention / cards / deal rules, the AI chat contracts (`src/lib/chat/`: grounding, due dates, stream filter), the Telegram pure modules (`src/lib/telegram/`: render, resolve, inbox, push), spreadsheet rendering, the responsible rules, and a few component render tests of the chat. |
| `pnpm chat:eval` | AI chat eval (`vitest.chat-eval.config.mts`, `src/server/chat/eval/`) through the real `/api/chat` and real models on the `.env` DB, plus the Telegram cases (real router / worker / model, Bot API mocked) — see "Known gaps" below for the gate. Costs money (≈ $1 per full run) and counts against the test org's monthly AI limit. |

Unit tests cover only pure functions (plus a few render tests of chat
components); there are no integration or browser UI tests.

## Environment variables

Names only. Values live in `.env` locally and in Vercel project settings.

### Core

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | Neon Postgres connection string (app and `drizzle.config.ts`) |
| `BETTER_AUTH_SECRET` | better-auth signing secret (read by better-auth itself) |
| `BETTER_AUTH_URL` | Public origin of the app for better-auth |
| `NEXT_PUBLIC_APP_URL` | Public origin: invitation links, guest order links, Telegram webhook URL, client auth base URL. Baked into the client bundle at build. |
| `NODE_ENV` | Set by Next.js (`development` / `production`) |

### AI

| Variable | Meaning |
| --- | --- |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway key; the only key needed for all LLM calls |

### Email (system mail: OTP codes, invitations)

| Variable | Meaning |
| --- | --- |
| `NYLAS_API_KEY`, `NYLAS_API_URI` | Platform Nylas application; also fallback app for email sources without their own `apiKey`/`apiUri` |
| `NYLAS_GRANT_ID` | Platform mailbox that sends system mail; fallback grant for un-migrated email sources (logs a warning) |

### Storage and secrets

| Variable | Meaning |
| --- | --- |
| `STORAGE_PROVIDER` | Optional. Object storage provider key; default `cloudflare-r2` (the only one today) |
| `R2_ACCOUNT_ID` | Cloudflare account id (used to build the endpoint if `R2_ENDPOINT` / `R2_PUBLIC_URL` are empty) |
| `R2_ENDPOINT` | Optional preferred name for the S3 endpoint (wins over `R2_PUBLIC_URL`) |
| `R2_JURISDICTION` | Optional `eu` / `fedramp` for a jurisdictional bucket when the endpoint is built from the account id |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | R2 S3 API credentials |
| `R2_BUCKET_NAME` | Bucket name — `business-os-2` |
| `R2_PUBLIC_URL` | S3 **endpoint** of the account, e.g. `https://<account>.r2.cloudflarestorage.com` or the `.eu.` form. **Without the bucket name in the path.** |
| `CREDENTIALS_ENCRYPTION_KEY` | Base64 of 32 random bytes; AES-256-GCM key for `source.credentials_ref` |

### Scheduling and integrations

| Variable | Meaning |
| --- | --- |
| `CRON_SECRET` | Base64 of 32 random bytes; every `/api/cron/*` route (daily, topics, notifications) requires `Authorization: Bearer <value>` in every environment; unset = every call rejected |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET_TOKEN` | Optional fallback bot for a Telegram source with no stored credentials (both required) |
| `TELEGRAM_BOT_USERNAME` | Not read at runtime today (the bot's @username comes from `getMe` / `provider_config`) |

### AI chat eval only (`pnpm chat:eval`, optional)

| Variable | Meaning |
| --- | --- |
| `CHAT_EVAL_ONLY` | Comma list of case ids or prefixes to run (e.g. `p01,d`; `tg` = the Telegram cases) |
| `CHAT_EVAL_REPEAT` | Runs of the whole set (default 1) |
| `CHAT_EVAL_ACTION_REPEAT` | Runs of each draft-card case (default 3; pass = 2 of 3) |
| `CHAT_EVAL_MODEL` | Another chat model for this eval run only (no admin setting changes) |
| `CHAT_EVAL_JUDGE` | `0` = no LLM judge |
| `CHAT_EVAL_CONCURRENCY` | Cases run at the same time (default 3) |

### Not read by the application code

These appear in older notes but the current `src/` does not read them:
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`,
`GITHUB_CLIENT_SECRET` (OAuth removed), `POLAR_ACCESS_TOKEN`,
`POLAR_SUCCESS_URL` (billing removed), `NEXT_PUBLIC_API_URL`,
`NEXT_PUBLIC_BASE_URL`, `NEXT_PUBLIC_PRODUCTION_URL` (`oAuthProxy` removed),
`GOOGLE_CHAT_CREDENTIALS`, `GOOGLE_CHAT_IMPERSONATE_USER`,
`GOOGLE_CHAT_PROJECT_NUMBER` (now per-source credentials; only the one-off
migration script used them), `NYLAS_CLIENT_ID`, `NYLAS_CALLBACK_URI`,
`EMAIL_PROVIDER`, `RESEND_API_KEY`, `RESEND_FROM` (Resend removed 2026-11-16;
system mail is Nylas only).
They can be removed from environments after a check.

## Database changes

Schema source: `src/db/schema.ts`. Config: `drizzle.config.ts`. Migrations:
`migrations/` (SQL files + `meta/` snapshots and journal). The applied
migrations of each DB are recorded in the table `drizzle.__drizzle_migrations`.

**Rule: every structure change is a Drizzle migration** (also in root
`AGENTS.md` → "Working rules → 3"). Never use `drizzle-kit push`, ad-hoc SQL,
one-off scripts or the Neon console to change the schema.

| Case | Steps |
| --- | --- |
| Change expressible in `schema.ts` (table, column, enum value, index, FK) | Edit `src/db/schema.ts` → `pnpm db:generate --name <what>` → review the SQL in `migrations/` → commit |
| Change `schema.ts` cannot express (extension, SQL function, generated column kept out of the schema, data backfill) | `pnpm db:custom --name <what>` → write SQL into the new empty file → commit |
| Apply to a DB | `pnpm db:migrate` with `DATABASE_URL` pointing at that DB — before deploying code that needs it |
| Check the folder | `pnpm db:check` |

Never edit a migration that is already applied; write a new one.

### Baseline (2026-11-13)

| File | Content |
| --- | --- |
| `0000_extensions_and_functions.sql` | Custom: extensions `pg_trgm`, `unaccent`; SQL functions `immutable_unaccent`, `translit_cyr_lat`, `to_or_tsquery` |
| `0001_baseline.sql` | Generated: all 35 tables, enums, indexes and FKs from `schema.ts` |
| `0002_search_v2_product_columns.sql` | Custom: the 5 Search V2 generated columns on `product` and their 4 indexes |
| `0003_align_constraint_names.sql` | Custom: renames hand-made constraint/index names on the old production DB to Drizzle names (no-op on a fresh DB) |
| `0004_seed_reference_data.sql` | Custom: platform reference data — 9 source templates + 7 system funnel stages (fixed ids, `ON CONFLICT DO NOTHING`) |

A fresh, empty Postgres DB is fully rebuilt with `pnpm db:migrate`, including
the reference data it needs to work. The production DB was baselined by
recording `0000` + `0001` as applied, then running `0002`–`0004` (`0004` was a
no-op there: the rows already existed). Detail: [../specs/db-migrations/README.md](../specs/db-migrations/README.md).

**Search V2 columns** (`name_norm`, `region_norm`, `is_drink`, `is_gift`,
`search_vector`) are deliberately not in `schema.ts`: Drizzle `select()` would
load them on every product query. They exist only in migration `0002`.

**Reference data vs tenant data:** platform reference data (source templates,
system funnel stages) is in migration `0004`; there are no system rules today (the `rule` table is kept as a data record only).
Migration `0028_cards_contract_old_columns` drops `source_item.card_analysis_scanned_at` and `source_item.deal_analysis_scanned_at`. The latest migration is `0050` — `0050_contact_name_native_required` (2026-11-21: backfills blank `contact.name_native` with `name`, then NOT NULL) is **NOT yet applied**: deploy the code first, then `pnpm db:migrate` (the code before 2026-11-21 writes NULL there; the new code works with and without the constraint). Earlier: `0049` (`0039` contact ↔ company links, `0040` notifications, `0041` drops `notification_read_state` (2026-11-15); `0042` AI chat history `ai_chat_thread` / `ai_chat_message`, `0043` AI chat draft cards `ai_chat_action` (2026-11-16); `0044` Telegram bot binding, buttons, send log, AI chat inbox + `ai_chat_thread.channel`, `0045` Telegram pushes and notification copies (data part: `telegram_enabled` → true, older notifications `not_sent`), `0046` Telegram ids on `contact_address`, `0047` Telegram chats ↔ companies (data part: known groups → `telegram_chat` rows) (2026-11-17); `0048` contact «Ведётся на уровне», `0049` `client_co_responsible` (2026-11-19)); all are applied on the test DB (the only DB today).
Tenant data (organizations, users, companies, products, org-owned stages and
rules) is never in migrations. The team's old scripts (`scripts/`), reference
specs (`refs/`) and catalog loader (`data_migration/`) remain git-ignored and
are not needed to build a DB.

## Deployment (Vercel)

- Hosting is Vercel. The user deploys; never push or deploy from automation.
- `next.config.ts` wraps the config with `withWorkflow()` (Vercel Workflow SDK).
  Routes under `src/app/.well-known/workflow/` are generated at build and
  git-ignored.
- `vercel.ts` (replaces `vercel.json`) declares three crons: `/api/cron/daily`
  at `0 3 * * *` (03:00 UTC), `/api/cron/topics` (topics engine with Telegram
  pushes — spec `docs/specs/topics/`) and `/api/cron/notifications`
  (notification checks for every org + held Telegram copies — spec
  `docs/specs/notifications/`); all three are mirrored in
  `src/server/orchestration/config.ts` — change both together. **A cron more
  often than daily needs the Vercel Pro plan; a Hobby deployment with it is
  rejected.** By design topics run hourly (`0 * * * *`) and notifications at
  `15 * * * *`. The test deployment is on Vercel Hobby, so since 2026-11-18
  they run once a day: topics `0 8 * * *`, notifications `0 9 * * *` (UTC;
  09:00 / 10:00 Vienna time in winter, inside working hours, so Telegram
  pushes and copies can go). Set them back to hourly on Pro
  (`docs/todo/README.md` D8). Set
  `CRON_SECRET` as a Vercel env var — Vercel then sends the bearer header.
  The daily run first syncs the AI model catalog (prices) and fetches exact
  costs still missing in the AI usage ledger, turns due AI chat segments into
  source items, deletes AI chat threads with no
  message for 90 days (and threads users deleted ≥ 2 days ago), then runs
  sync → parse → upload. When the cron did not run (local dev, a failed run), use
  `/settings` → «Использование ИИ» → «Синхронизировать цены и стоимость»
  (prices + costs) and «Run pipeline» for sources.
- `NEXT_PUBLIC_*` values are baked in at build time. Changing
  `NEXT_PUBLIC_APP_URL` needs a new deployment.
- `NEXT_PUBLIC_APP_URL` must be the public HTTPS origin in production, or the
  Telegram webhook is not registered automatically when credentials are saved.
- One-time steps per deployment are listed in `docs/todo/README.md` →
  «Deployment checklist» (Telegram privacy mode + webhook re-registration, own
  Telegram names, a real Telegram file test, the notifications cron;
  migrations `0044`–`0047` before the code and the bot credentials saved
  again — the webhook then gets the update list with `callback_query` /
  `edited_message` and the bot commands; the real Telegram test of the AI
  chat; crons back to hourly). The Telegram real-phone check is
  `docs/specs/telegram/05-finalization.md` F4, test guide
  `docs/specs/telegram/06-test-guide.md`.
- Add any new production origin to `trustedOrigins` in `src/lib/auth.ts`.
- Long-running routes set `maxDuration` (up to 300 s: parse, process, uploads,
  teardown, admin pipeline run, the Telegram webhook and fetch — files are
  parsed right after a message —, the notifications cron; 120 s: AI chat, chat
  actions, «Передать в источники сейчас»).
- Seed data must exist before new orgs are created: the org-creation hook
  creates default sources from `source_template` rows; with no templates the
  new org gets no sources (the error is logged, not raised).

## Object storage (Cloudflare R2)

- Provider-neutral layer `src/server/storage` (spec `docs/specs/s3-r2/`); the
  active provider is `STORAGE_PROVIDER` (default `cloudflare-r2`). Lazy: the app
  starts without storage configured and fails only when storage is used.
- Bucket: `business-os-2`. R2 env: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
  `R2_BUCKET_NAME`, and the endpoint — `R2_ENDPOINT`, or the legacy
  `R2_PUBLIC_URL`, or built from `R2_ACCOUNT_ID` (+ optional `R2_JURISDICTION`
  `eu` / `fedramp`).
- `R2_PUBLIC_URL` is the S3 endpoint of the account, not a public bucket URL and
  not `<endpoint>/<bucket>`. The bucket name comes from `R2_BUCKET_NAME`.
- Keys: parsed Markdown `org_<orgId>/source_<sourceId>/item_<itemId>.md`;
  original document files `org_<orgId>/files/<itemId>/<name>` (≤ 50 MB; mail,
  Google Chat, Telegram attachments, Drive, uploads); avatars
  `avatars/user_<userId>`.
- After a successful upload the Markdown is removed from
  `source_item.parsed_markdown`; R2 becomes the only copy. Losing the bucket
  loses parsed content (items can be re-parsed only where raw data is still at
  the provider or a stored original exists — drop-off and AI chat files; not
  for AI chat segments or WhatsApp items).

## Credentials encryption key

- `CREDENTIALS_ENCRYPTION_KEY` encrypts every `source.credentials_ref`
  (`src/lib/credentials-crypto.ts`, AES-256-GCM, version byte `0x01`).
- **If the key is lost or changed, every stored source credential becomes
  unreadable** and each source must be configured again. Keep it as an
  encrypted Vercel env var, never commit it, and do not rotate it without a
  re-encryption plan (the format already has a version byte for that).
- Generate a new key with `openssl rand -base64 32`.

## Known gaps (from the code, 2026-11-13)

- Sync does not detect deletions or edits at the provider; an edited Drive file
  is not re-parsed automatically (#1, #2).
- Sync reads up to 100 items per call; a large backlog needs repeated syncs (#5).
- Little sync observability beyond `last_synced_at` and `pipeline_run` (#7).
- Pipeline schedule and caps are hard-coded constants (#8).
- AI chat search over source items matches DB columns only (subject, filename,
  summary / participants in `metadata_json`, Search V2 normalisation), not the
  stored body; no full-text or vector search (#10).
- Batch controls have no server-side rate-limit handling; there is a client
  "slow mode" (#11).
- WhatsApp: one archive source per org; re-import does not detect edited
  history (#12, #13).
- Outbound email is platform-only; no "send from the org's mailbox" (#17).
- Contact identification when the body signer differs from the envelope sender
  is not solved (#19).
- Telegram: files above 20 MB cannot be fetched by a bot (listed only); group
  authors with unknown Telegram names are not discovery candidates; no rate
  limit on ingest, no edit / delete handling of client messages, no webhook
  health view (#20). No Telegram Business and no channels (postponed,
  `docs/todo/README.md` TG7, TG8); no topic digests by Telegram. The staff
  interface (binding, AI chat, pushes) is not yet checked with a real phone
  (`docs/specs/telegram/05-finalization.md` F4).
- Test deployment (Vercel Hobby): topics and notification crons run once a
  day, not hourly (D8).
- Source trust step 2 (who said it and with what authority) is not built;
  only step 1 (R26: relayed notes capped and never moving deals alone).
- Product backlog: company event feed, home page as a dashboard, selectable
  sales methodology (#21).
- Companies feed sorts up to 500 rows in the browser; needs server-side sorting
  at scale (#22).
- Debug `console.log` calls remain in LLM pipelines (#15).
- Guest order link has no rate limiting.
- Unit tests only for a few pure modules (`pnpm test`); type errors do not fail the build.
- AI chat eval: `pnpm chat:eval` (42 golden questions + 41 draft-card cases = 83 web cases — synthetic business cards, voice notes, meeting notes, a mail with a prompt injection, `c01`–`c05` the company of a new contact — in `src/server/chat/eval/fixtures/`, plus 24 Telegram cases `tg01`–`tg24`; real models, test DB; gate: ≥ 90 % of cases (draft-card cases run 3 × and pass at 2 of 3), no adversarial failure in any run, 0 ungrounded contact values; report in `.chat-eval/`; `CHAT_EVAL_MODEL=<id>` answers with another chat model inside the run only). Run it before changing the chat prompt, tools or default model. A full run is ≈ 150 turns, ≈ 15 min, ≈ $1. Last full run 2026-11-16: 78 / 78; on 2026-11-19 the T7 subset passed 17 / 17, but the full run stopped at the test org's monthly AI limit ($20). The product owner keeps the limit at $20 and runs no evals for now (2026-11-19); note that every eval run counts against the test org's monthly AI limit.

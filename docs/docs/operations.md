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

There are no automated tests in the repository.

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
| `EMAIL_PROVIDER` | `nylas` (default) or `resend` |
| `NYLAS_API_KEY`, `NYLAS_API_URI` | Platform Nylas application; also fallback app for email sources without their own `apiKey`/`apiUri` |
| `NYLAS_GRANT_ID` | Platform mailbox that sends system mail; fallback grant for un-migrated email sources (logs a warning) |
| `RESEND_API_KEY`, `RESEND_FROM` | Resend provider and sender address (only when `EMAIL_PROVIDER=resend`) |

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
| `CRON_SECRET` | Base64 of 32 random bytes; `/api/cron/daily` requires `Authorization: Bearer <value>` in every environment; unset = every call rejected |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET_TOKEN` | Optional fallback bot for a Telegram source with no stored credentials (both required) |

### Not read by the application code

These appear in older notes but the current `src/` does not read them:
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`,
`GITHUB_CLIENT_SECRET` (OAuth removed), `POLAR_ACCESS_TOKEN`,
`POLAR_SUCCESS_URL` (billing removed), `NEXT_PUBLIC_API_URL`,
`NEXT_PUBLIC_BASE_URL`, `NEXT_PUBLIC_PRODUCTION_URL` (`oAuthProxy` removed),
`GOOGLE_CHAT_CREDENTIALS`, `GOOGLE_CHAT_IMPERSONATE_USER`,
`GOOGLE_CHAT_PROJECT_NUMBER` (now per-source credentials; only the one-off
migration script used them), `NYLAS_CLIENT_ID`, `NYLAS_CALLBACK_URI`.
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
system funnel stages) is in migration `0004`; there are no system rules today.
Tenant data (organizations, users, companies, products, org-owned stages and
rules) is never in migrations. The team's old scripts (`scripts/`), reference
specs (`refs/`) and catalog loader (`data_migration/`) remain git-ignored and
are not needed to build a DB.

## Deployment (Vercel)

- Hosting is Vercel. The user deploys; never push or deploy from automation.
- `next.config.ts` wraps the config with `withWorkflow()` (Vercel Workflow SDK).
  Routes under `src/app/.well-known/workflow/` are generated at build and
  git-ignored.
- `vercel.ts` (replaces `vercel.json`) declares one cron:
  `/api/cron/daily` at `0 3 * * *` (03:00 UTC). The same expression is in
  `src/server/orchestration/config.ts`; change both together. Set
  `CRON_SECRET` as a Vercel env var — Vercel then sends the bearer header.
  The daily run first syncs the AI model catalog (prices) and fetches exact
  costs still missing in the AI usage ledger, then runs sync → parse →
  upload. When the cron did not run (local dev, a failed run), use
  `/settings` → «Использование ИИ» → «Синхронизировать цены и стоимость»
  (prices + costs) and «Run pipeline» for sources.
- `NEXT_PUBLIC_*` values are baked in at build time. Changing
  `NEXT_PUBLIC_APP_URL` needs a new deployment.
- `NEXT_PUBLIC_APP_URL` must be the public HTTPS origin in production, or the
  Telegram webhook is not registered automatically when credentials are saved.
- Add any new production origin to `trustedOrigins` in `src/lib/auth.ts`.
- Long-running routes set `maxDuration` (up to 300 s: parse, process, uploads,
  cards/deals generation, teardown, admin pipeline run).
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
  avatars `avatars/user_<userId>`.
- After a successful upload the Markdown is removed from
  `source_item.parsed_markdown`; R2 becomes the only copy. Losing the bucket
  loses parsed content (items can be re-parsed only where raw data is still at
  the provider; not for Drop Off or AI chat items).

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
- AI chat source search is ILIKE over `metadata_json`, not full-text or vector
  search (#10).
- Batch controls have no server-side rate-limit handling; there is a client
  "slow mode" (#11).
- WhatsApp: one archive source per org; re-import does not detect edited
  history (#12, #13).
- Outbound email is platform-only; no "send from the org's mailbox" (#17).
- Contact identification when the body signer differs from the envelope sender
  is not solved (#19).
- Telegram: text DMs only; no attachments, groups, rate limit, or webhook health
  view (#20).
- Product backlog: company event feed, home page as a dashboard, selectable
  sales methodology (#21).
- Companies feed sorts up to 500 rows in the browser; needs server-side sorting
  at scale (#22).
- Debug `console.log` calls remain in LLM pipelines (#15).
- Deal agent auto-move, deal risk and some deal "state" texts are mocks.
- Guest order link has no rate limiting.
- Seven API routes still access the database directly (see
  [architecture.md](./architecture.md#layering-rule)).
- No automated tests; type errors do not fail the build.

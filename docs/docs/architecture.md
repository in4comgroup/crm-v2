# Architecture

[Back to index](./README.md)

## Tech stack

| Area | Technology | Notes |
| --- | --- | --- |
| Framework | Next.js 16.2 (App Router), React 19.2, TypeScript 5.9 | Turbopack. `next.config.ts` sets `typescript.ignoreBuildErrors: true`, so the build does not fail on type errors. |
| Styling / UI | Tailwind CSS v4, shadcn/ui (New York), Radix UI, lucide-react, motion | Light and dark theme via next-themes. |
| Forms | React Hook Form + Zod 4 | |
| Auth | better-auth 1.5 | Email OTP only; plugins `emailOTP`, `organization`, `admin`, `apiKey`, `nextCookies`. |
| Database | Neon Postgres (serverless HTTP driver) + Drizzle ORM 0.45 | Schema in `src/db/schema.ts`, client in `src/db/drizzle.ts`. No transactions on the HTTP driver. |
| Object storage | S3-compatible via `@aws-sdk/client-s3`, Cloudflare R2 today | Parsed Markdown, original document files and user avatars. Provider-neutral layer `src/server/storage` (generic S3 core + provider registry, `STORAGE_PROVIDER`); spec `docs/specs/s3-r2/`. |
| LLM | Vercel AI SDK v7 (`ai` 7, `@ai-sdk/react` 4) through the Vercel AI Gateway | Only through the AI layer `src/server/ai` (`aiGenerateText` / `aiStreamText` with a process key). Model per process is chosen on `/settings` «Процессы ИИ» (defaults: Gemini 2.5 Flash for parsing, Gemini 3.1 Flash Lite elsewhere). Every call is recorded with tokens and exact cost (`ai_usage_event`). Daily AI budget and monthly AI limit per org: background processes stop; interactive processes, and calls marked `interactive` (a person waits for them, e.g. a chat file parsed at send), pass the daily budget gate. Spec `docs/specs/models/`. |
| AI UI | ai-elements (7 copied components), streamdown 2.7 (+ code / math / CJK / mermaid plugins), json-render 0.22 (`@json-render/*`) | Chat rendering and structured AI output. |
| Background jobs | Vercel Workflow SDK (`workflow` ≥ 4.8) + Vercel Cron | Daily workflow: AI model catalog sync + usage cost check + AI chat segments → source items + AI chat retention + Telegram row retention, then source sync → parse → upload. Topics workflow (`runTopicsPipeline`) and notification checks route (no workflow, `runNotificationChecks`): hourly by design (needs Vercel Pro); on the test deployment (Vercel Hobby, since 2026-11-18) once a day — see "Background pipeline". |
| Data viz / tables | Recharts 3 (shadcn charts), @tanstack/react-table 9, @dnd-kit (kanban) | |
| Integrations | Nylas SDK v8, imapflow + mailparser, node-ical, googleapis, grammY (Telegram) | Telegram is two-way: inbound webhook + one sender for bot messages (`src/server/telegram/sender.ts`). |
| File parsing | mammoth (.docx), jszip + @xmldom/xmldom (.pptx), ExcelJS (.xlsx reading since 2026-11-19, and the price-list export); `.csv` read by code | PDF, image, audio, video go to Gemini as file parts. Spreadsheet tables are built by code (`src/lib/spreadsheet-markdown.ts`); the model writes only the summary and metadata. Legacy `.xls` / `.doc` are not supported. |
| Package manager | pnpm | |

Node-only packages `imapflow`, `mailparser`, `node-ical`, `exceljs` are listed in
`serverExternalPackages` so Turbopack does not bundle them.

## Route groups and public routes

| Path | Access | Purpose |
| --- | --- | --- |
| `src/app/page.tsx` (`/`) | Public | Landing page with links to sign-in and sign-up. |
| `src/app/(auth)/` — `/sign-in`, `/sign-up` | Public; signed-in users are redirected to `/dashboard` | OTP sign-in / sign-up forms. |
| `src/app/accept-invitation/[id]` | Public | Invitation acceptance. Deliberately outside `(auth)` so a signed-in user is not redirected away. |
| `src/app/(protected)/` | Session required (checked in `layout.tsx`, redirect to `/sign-in`) | All product pages. The layout mounts the sidebar and the global AI chat panel once, and gives every client component the org time (`OrgTimeProvider` → `useOrgTime()`: org time zone + default task due time, server `loadOrgTime`; 2026-11-26). |
| `src/app/o/[token]` | Public, token is the authorization | Guest order review and confirmation. |
| `src/app/api/webhooks/telegram/[sourceId]` | Public, path id + secret header are the authorization | Telegram bot webhook. One router (`src/server/telegram/router.ts`): button presses, commands (`/start <code>` staff binding, `/stop`, `/new`, `/help`), a bound member's private message → the AI chat over Telegram (when the owner switched it on), everything else → ingest of private-chat and group messages: text, voice notes and files (parsed as attachments; specs `docs/specs/telegram/`, `docs/specs/ai-chat-telegram/`). |
| `src/app/api/cron/daily` | Bearer `CRON_SECRET`, required in every environment | Starts the daily pipeline workflow. |
| `src/app/api/cron/topics`, `api/cron/notifications` | Same Bearer `CRON_SECRET` | Topics run (with Telegram topic pushes); notification checks + Telegram copies held back outside working hours + clean-up of expired notifications. Hourly by design; daily on the test deployment. |
| `src/app/api/invitations/[id]`, `api/invitations/check` | Public | Invitation lookup and "has pending invite" check. |
| `src/app/api/**` (all other routes) | Session required; most need an active org | JSON API used by the UI. |

Two layers (since 2026-11-13): the central sign-in gate `src/proxy.ts` rejects
every request without a session (API → 401, page → `/sign-in`) except the
public-by-design entries above; then each API route / server function
validates the session itself. Rule and allowlist:
[../specs/auth/api-access.md](../specs/auth/api-access.md).

## Layering rule

```
UI (client components)  →  src/app/api/**/route.ts  →  src/server/*  →  src/db (Drizzle) / external APIs
                            (thin: session, parse,       (business logic,
                             map errors to HTTP)          tenant checks, SQL)
```

- **Rule (lint-enforced):** only `src/server/` touches the database. API routes,
  pages, layouts, components and `src/lib` must not use Drizzle; they call a server
  function. Exceptions: `src/db/` (client + schema) and the better-auth adapter in
  `src/lib/auth.ts`. `import type` from the schema is allowed anywhere. ESLint
  (`DB_ACCESS` in `eslint.config.mjs`) fails on any other DB import.
- Server modules are either `"use server"` (server actions, callable as RPC) or
  `import "server-only"` (plain server modules that export classes, sync helpers
  or types — for example `teardown.ts`, `blocklist.ts`, `order-links.ts`,
  `parsers/org-attribution.ts`).
- Route files re-export the types that client components need, so a client
  component never imports a `"use server"` module just for a type.
- Shared pure logic that both server and browser use lives in `src/lib/`
  (for example `entity-search.ts`, `orders-format.ts`, `client-custom-fields.ts`).

The rule is fully met today: no route, page or layout imports `@/db/*` or
`drizzle-orm` values (the earlier route exceptions were moved into
`src/server/`; `(protected)/layout.tsx` reads the org logo through
`getOrganizationLogo` in `src/server/organizations.ts`). The only allowed
exception is the better-auth adapter in `src/lib/auth.ts`.

## Multi-tenancy

- The tenant is the **organization**. The session carries `activeOrganizationId`,
  `activeOrganizationName`, `activeOrganizationSlug` (set in
  `databaseHooks.session.create.before`).
- Every feature table has `organization_id` (sources use `owner_organization_id`).
  Every server function reads the org id **from the session**, never from client
  input, and asserts that the target row belongs to it (helpers such as
  `requireOrgContext`, `assertSourceInScope`, `assertSourceItemInScope`,
  `assertDealInOrg`, `assertOrderInOrg`). Wrong-org ids return 403 or 404.
- Permission checks for org roles live in the module servers (`requireOrgOwner`,
  `requireOwnerOrg`, `requireAdmin`, `getActiveOrgRole`).
- `source_item.organization_id` is denormalised from its source so listing
  queries need no join.
- The org logo is **not** on the session: the session is cached in a signed
  cookie, and a base64 logo overflowed the HTTP header limit (431 errors). The
  sidebar loads the logo server-side. User avatars are stored in R2 and served
  by `/api/avatars/[userId]`, never as data URLs.

Documented exceptions to "one org only":

| Exception | Why |
| --- | --- |
| Admin source teardown (`/api/admin/teardown/*`) | Platform admin picks any org's source; the tool then works inside that source's org. |
| Platform admin screens (`/settings`) | Users, orgs, memberships, templates, all sources. Gated by `requireAdmin()` (`user.role === 'admin'`). |
| Guest order link (`/o/[token]`) | The token is the capability; the order is loaded strictly by `grant.order_id`. |
| Telegram webhook | Source resolved by the path id; secret header verified. A bot button or a draft-card confirm acts as the bound member: `runAsMember` (`src/server/acting-member.ts`) sets a scoped session (AsyncLocalStorage, one call chain) that `getServerSession()` returns first, only after the caller verified an active binding and org membership. |
| System rows | `rule.type = 'System'`, `source.is_system`, `deal_funnel_stage.is_system`, `source_template` are platform-wide. |

## Authentication and session (summary)

- Sign-in and sign-up are **email OTP only**: a 6-digit code sent by email,
  valid 5 minutes. The first valid code for an unknown email creates the
  account (`disableSignUp: false`). There is no password, no OAuth, no
  email-verification link.
- Pages: `/sign-in`, `/sign-up`, `/accept-invitation/[id]`. All use the shared
  form `src/components/forms/form-email-otp.tsx`.
- New users get a default org «Моя организация» unless they have a pending
  invitation. New orgs get default sources from templates.
- Sessions last 7 days; a 5-minute signed cookie cache avoids a DB hit per
  request. Server code reads the session through `src/lib/get-session.ts`.
- The active organization is picked at sign-in (first membership). Platform
  admins can switch it from the sidebar (2026-11-19, `POST
  /api/account/active-organization` → better-auth `setActiveOrganization`);
  `databaseHooks.session.update.before` keeps the session's organization name /
  slug in step with the new id (also after accepting an invitation).
- OTP and invitation emails go through `sendEmails` in `src/lib/email.ts`
  (Nylas only; Resend was removed 2026-11-16). Since 2026-11-18 they name the
  product: subject «Ваш код для входа SalesDaily», invitation «… в системе
  SalesDaily».
- Full detail: [../specs/auth/README.md](../specs/auth/README.md).

## Background pipeline

```
Vercel Cron (03:00 UTC, vercel.ts)
  → GET /api/cron/daily            (checks Bearer CRON_SECRET in every environment)
  → start(dailyPipelineWorkflow)   (src/workflows/daily-pipeline.workflow.ts, Vercel Workflow SDK)
  → runDailyPipeline({trigger})    (src/server/orchestration/daily-pipeline.ts, engine-agnostic)
       0. syncAllModelCatalogs()   AI model catalog + prices; reconcileUsageCosts() exact costs;
          ingestDueChatThreads()   AI chat segments → «AI Chat» source items;
          purgeChatThreads()       chats with no message for 90 days / deleted ≥ 2 days ago;
          purgeTelegramRows()      bot technical rows (update ids 7 d, buttons, bind codes,
                                   AI chat inbox 30 d, send log 90 d)
          (phase 0 errors are logged as phase "catalog" and never stop the run)
       1. runFullSync()            sync every remote-sync source
       2. parseSourceItem() loop   over listPendingParseIds()   (cap 200 per run)
       3. uploadSourceItem() loop  over listPendingUploadIds()  (cap 500 per run)
  → one pipeline_run row with per-phase counters + errors_json
```

- Phases run sequentially. A failure on one item is recorded in
  `pipeline_run.errors_json` and does not stop the run.
- **Per-source automation flag** `source.automated_parsing_is_allowed`: all three
  phases skip sources where it is false (including items already queued under
  them). Manual buttons on the Sources page ignore the flag.
- Only providers with `supportsAutomatedPipeline` take part (nylas, imap, gchat,
  gdrive, telegram). Only providers with `supportsRemoteSync` are synced (nylas,
  imap, gchat, gdrive). Telegram is push-only (webhook).
- The workflow file is the only file that imports the Workflow SDK; replacing the
  scheduler means replacing that file and the cron route.
- Admins can run the same pipeline synchronously with `POST /api/admin/pipeline/run`
  and read run history with `GET /api/admin/pipeline/stats`.
- The cron expression is duplicated in `vercel.ts` and
  `src/server/orchestration/config.ts`; keep them equal.
- Topics run (`/api/cron/topics`, `runTopicsPipeline`) and notification
  checks (`/api/cron/notifications`) are hourly by design (`0 * * * *`,
  `15 * * * *`). A sub-daily cron needs the Vercel Pro plan, so the test
  deployment on Vercel Hobby runs them once a day since 2026-11-18:
  `0 8 * * *` and `0 9 * * *` (UTC). Until they are back to hourly
  (`docs/todo/README.md` D8), signals, topics, Telegram pushes and
  notification checks run once a day.

Discovery of companies and contacts (no LLM, it reads the parsed metadata)
runs on a button («Найти в источниках») and, since 2026-11-24, also
automatically after the daily parse and the hourly topics intake for orgs with
the org setting `discovery.autoApply` on (`src/server/discovery-auto.ts`; the
org owner switches it on Sources → «Управление», a platform admin on
/settings → «Источники» → «Автоматическая обработка»). The LLM batch web
enrichment has no UI button since 2026-11-21 and is not scheduled.

## External services

| Service | Used for | Code |
| --- | --- | --- |
| Neon Postgres | Main database | `src/db/drizzle.ts` (adds `Connection: close` to every request for resilience) |
| Object storage — Cloudflare R2 today (provider-neutral layer, spec `docs/specs/s3-r2/`) | Parsed Markdown (`org_<orgId>/source_<sourceId>/item_<itemId>.md`), original document files incl. AI chat uploads (`org_<orgId>/files/<itemId>/<name>`), avatars (`avatars/user_<id>`) | `src/server/storage`, `src/server/upload-source-item.ts` |
| Vercel AI Gateway | All LLM calls (parsing, topics and cards, deal state, chat incl. draft cards and chat files, analytics assistant, web lookup and enrichment) | Only through `src/server/ai/runtime.ts` (process key → model from `/settings` «Процессы ИИ» or the code default in `src/server/ai/processes.ts`); Vercel specifics in `src/server/ai/gateways/vercel-ai-gateway/`. ESLint enforces the boundary |
| Nylas | Email source (read) and system email (send) | `src/lib/nylas.ts`, `src/server/sync/nylas.ts`, `src/lib/email.ts` |
| IMAP servers | Email source without Nylas | `src/lib/imap.ts`, `src/server/sync/imap.ts`, `src/server/parsers/imap.ts` |
| Google Chat / Drive APIs | Chat and Drive sources (service account, optional domain-wide delegation) | `src/lib/google-*.ts`, `src/server/sync/{gchat,gdrive}.ts` |
| Telegram Bot API | Telegram source (webhook + manual fetch); bot messages to staff (AI chat answers, topic pushes, notification copies) | `src/lib/telegram.ts`, `src/server/ingest/telegram.ts`, `src/server/telegram/` (router, bindings, sender, chat worker, chats ↔ companies, identity directory), `src/lib/telegram/` (pure: render, HTML, resolve, push) |
| Vercel | Hosting, Cron, Workflow | `vercel.ts`, `next.config.ts` (`withWorkflow`) |

## Component diagram

```mermaid
flowchart TB
  subgraph Browser
    UI[Pages in (protected)<br/>sidebar, header: search, AI chat, notifications]
    Guest[/o/token guest page/]
  end
  subgraph "Next.js on Vercel"
    API[API routes<br/>src/app/api]
    SRV[Server modules<br/>src/server]
    WF[Daily workflow<br/>src/workflows]
    AUTH[better-auth<br/>/api/auth/*]
  end
  CRON[Vercel Cron] --> API
  UI --> API
  UI --> AUTH
  Guest --> SRV
  API --> SRV
  API --> WF
  WF --> SRV
  SRV --> DB[(Neon Postgres)]
  AUTH --> DB
  SRV --> R2[(Cloudflare R2)]
  SRV --> GW[Vercel AI Gateway<br/>Gemini / GPT / Claude]
  SRV --> EXT[Nylas, IMAP, Google APIs, Telegram]
  TG[Telegram] -->|webhook| API
  SRV -->|bot messages| TG
  AUTH --> MAIL[Nylas email]
```

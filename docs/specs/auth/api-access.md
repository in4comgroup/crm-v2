# Access rule: nothing works without sign-in

Decided by the product owner on 2026-11-13. Status: **implemented, tested
locally, not yet deployed.**

## 1. Rule

Every page, API route and server action requires a signed-in user, except a
short allowlist of entry points that are public **by design** and protected by
something else (a secret, an unguessable id or token).

## 2. Two layers

| Layer | Where | What it does |
| --- | --- | --- |
| 1. Central gate | `src/proxy.ts` (Next.js 16 proxy, formerly middleware) | Rejects every request without a better-auth session cookie: API → `401 {"error":"Unauthorized"}`, page → redirect to `/sign-in?redirect=<path>`. Optimistic (cookie present), as Next.js recommends |
| 2. Real check | each route / server function | Validates the session (`getServerSession()` + 401, or a `require*` helper that throws). Required even behind the gate: a cookie can be stale or forged |

The gate does not run on Next.js internals (`/_next/*`), the Vercel Workflow
runtime routes (`/.well-known/*`) and static files (paths with a file
extension).

## 3. Public by design (allowlist in `src/proxy.ts`)

| Entry point | Why public | Protected by |
| --- | --- | --- |
| `/` | Landing page, static, links to sign-in / sign-up | No data |
| `/sign-in`, `/sign-up` | Sign-in itself | — |
| `/api/auth/*` except `/api/auth/keys` | better-auth (OTP send / verify, session) | better-auth rate limits |
| `/accept-invitation/[id]`, `/api/invitations/*` | An invited person has no account yet | Unguessable invitation id; the check endpoint returns only true/false |
| `/o/[token]` (+ its server actions) | Guest order confirmation for a client without an account | Opaque token = the capability; actions are pinned to that order |
| `/api/webhooks/telegram/[sourceId]` | Called by Telegram | Per-source secret header, constant-time compare |
| `/api/cron/daily` | Called by Vercel Cron | `Authorization: Bearer $CRON_SECRET`, required in every environment; a missing `CRON_SECRET` rejects all calls |
| `/api/cron/topics`, `/api/cron/notifications` | Called by Vercel Cron (hourly; notifications since 2026-11-15) | Same `Bearer $CRON_SECRET` check; covered by the `/api/cron/*` pattern in `src/proxy.ts` |

**Adding a public entry point** requires: a reason, its own protection, a row
in this table, and a pattern in `src/proxy.ts`. Never widen a pattern to a
whole prefix that also covers private routes (see the `/api/auth/keys`
exception).

## 4. Fixes made (audit 2026-11-13)

| Finding | Severity | Fix |
| --- | --- | --- |
| `/api/chat` worked without sign-in: an anonymous caller ran a paid LLM agent (choice of model, up to 10 steps, web search) | High | Session + active org required, checked before any work (401 / 403) |
| `/api/organization?userId=X` returned any user's organization (name, contacts, logo), even anonymously | High | Session required; the user id comes only from the session; `userId` is ignored |
| `addMember` (could add anyone to any org as owner), `removeMember`, `getUsers`, `getOrganizationBySlug`, `getOrganizations`, `isAdmin` (returned a truthy object on error) — unguarded `"use server"` exports | High (latent) | Unused: files `src/server/members.ts`, `users.ts`, `permissions.ts` deleted; unused functions removed from `organizations.ts` |
| `instantiateFromTemplate`, `bootstrapDefaultsForOrg` — write into any org, in a `"use server"` module | Medium (latent) | Moved to `src/server/templates-instantiate.ts` with `import "server-only"` (not callable as a server action) |
| Sync functions (`syncSource`, `syncNylasEmails`, `syncGoogleChatMessages`, `syncGoogleDriveFiles`) take any source id, in `"use server"` modules | Medium (latent) | Switched to `import "server-only"`; callers (sync route, cron) check access |
| `getActiveOrganization(userId)` in a `"use server"` module | Medium | `organizations.ts` is now `server-only` |
| `listRecentDealActivity(organizationId)` exported from a `"use server"` module | Medium (latent) | Takes the org from the session itself; no org parameter |
| `/api/cron/daily`: no check outside production; `Bearer undefined` passed when `CRON_SECRET` was unset | Medium | Secret required everywhere; unset secret rejects |
| `/api/profile/avatar` buffered the upload before the session check | Low | Session checked first |
| `/api/auth/keys` answered 200/201 with `{}` without a session | Low | 401 for every method |
| `/api/session`: dead route | Low | Deleted |
| `/sign-in?redirect=` accepted any URL (open redirect after sign-in) | Low | Only same-app paths (`/…`, not `//…`) |

## 5. Verification (2026-11-13, dev server)

- Without a session: **76 of 81** API routes answer 401 on GET and POST. The
  other 5 are the public-by-design entries of §3, and none gives access
  (unknown better-auth path 404, cron 401, invitation 400 / 404, Telegram
  webhook 404).
- Without a session: all app pages redirect to `/sign-in?redirect=…`;
  `/`, `/sign-in`, `/sign-up`, `/accept-invitation/…`, `/o/…` and static
  files load.
- With a session: pages and APIs answer 200; `/api/organization?userId=<other
  user>` returns the caller's own organization.
- `tsc --noEmit`: 0 errors; ESLint: 0 errors.

## 6. Rule for new code

- Every new route handler and every exported function of a `"use server"`
  module checks the session itself (or calls a `require*` helper).
- Internal helpers that take an org / user id as a parameter must NOT be in a
  `"use server"` module: use `import "server-only"`.
- The gate in `src/proxy.ts` is a safety net, not a replacement for layer 2.

# Migration and rollout

## 1. Code changes (inventory)

Auth changes only. The Polar removal that shipped in the same change set has its
own inventory in [../billing/polar-removal.md](../billing/polar-removal.md).

### Removed files

| File | What it was |
| --- | --- |
| `src/app/(auth)/forgot-password/page.tsx`, `forgot-password-form.tsx` | Password-reset page |
| `src/app/(auth)/sign-in/otp/page.tsx` | Separate OTP page (OTP is now `/sign-in` itself) |
| `src/components/forms/form-sign-in-otp.tsx` | Old OTP form (sign-in only) |
| `src/components/forms/form-reset-password.tsx` | Change-password dialog (account/profile) |
| `src/components/forms/form-admin-set-password.tsx` | Admin "set password" dialog |
| `src/components/blocks/password-input.tsx` | Password field with show/hide |
| `src/components/icons/GoogleIcon.tsx`, `GitHubIcon.tsx` | OAuth button icons |
| `src/lib/validation.ts` | `passwordSchema` |

### Moved files

| From | To |
| --- | --- |
| `src/app/(auth)/accept-invitation/[id]/*` | `src/app/accept-invitation/[id]/*` |

### New files

| File | Purpose |
| --- | --- |
| `src/components/forms/form-email-otp.tsx` | Shared two-step OTP form |

### Changed files

| File | Change |
| --- | --- |
| `src/lib/auth.ts` | OTP-only config, sign-up enabled for OTP, name fallback hook, removed password/OAuth/verification/oAuthProxy/lastLoginMethod |
| `src/lib/email.ts` | Resend client created lazily |
| `src/components/forms/form-sign-in.tsx` | Rewritten on `EmailOtpForm` |
| `src/components/forms/form-sign-up.tsx` | Rewritten on `EmailOtpForm`, keeps the invitation guard |
| `src/app/accept-invitation/[id]/accept-invitation-content.tsx` | Sign-up branch uses `EmailOtpForm` |
| `src/app/(protected)/profile/page.tsx` | Removed change-password and verification-email buttons |
| `src/components/tables/table-admin-users.tsx` | Removed admin set-password action |
| `src/server/users.ts` | Removed unused `signIn` / `signUp` (password) helpers |
| `AGENTS.md`, `src/app/AGENTS.md`, `src/lib/AGENTS.md` (then named `CLAUDE.md`) | Updated notes |

## 2. Data changes (already applied to the new DB on 2026-11-13)

| Change | Detail |
| --- | --- |
| `account` table emptied | 9 rows deleted: 6 `credential` (password hashes) and 3 `google` links. OTP does not use this table. The table stays (better-auth schema). |
| No schema change | No tables, columns or enums were added or removed for the auth change |

Users keep their `user` rows. Every existing user signs in with the same email
address and receives a code. No user action is needed beyond that.

## 3. Environment variables

| Variable | Status |
| --- | --- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | **Remove** (OAuth gone) |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | **Remove** (OAuth gone) |
| `NEXT_PUBLIC_PRODUCTION_URL` | **Remove** (was used only by `oAuthProxy`) |
| `RESEND_API_KEY` | Optional; needed only when `EMAIL_PROVIDER=resend` |
| `BETTER_AUTH_SECRET` | Required. **Generate a new one** for the new deployment (`openssl rand -base64 32`). Changing it signs out all users |
| `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL` | Required; must be the real HTTPS origin in production (invitation links use `NEXT_PUBLIC_APP_URL`) |
| `NYLAS_API_KEY`, `NYLAS_API_URI`, `NYLAS_GRANT_ID` | Required for sending codes in the default Nylas mode; the grant needs a send scope |
| `EMAIL_PROVIDER` | Optional: `nylas` (default) or `resend` |

Local `.env` is already cleaned. Vercel env vars still need the same cleanup.

## 4. Deploy checklist

1. Commit and push the change set.
2. On Vercel (Production and Preview): delete the vars marked **Remove** above;
   set a new `BETTER_AUTH_SECRET`; check `BETTER_AUTH_URL` and
   `NEXT_PUBLIC_APP_URL`.
3. Check that `trustedOrigins` in `src/lib/auth.ts` contains the production
   origin (today: `app.truffalo.ai`, `business-os-demo.vercel.app`,
   `salesdaily-demo.vercel.app`, `localhost:3000`). Add the new domain if it
   differs.
4. Deploy. `NEXT_PUBLIC_*` values are baked in at build time, so redeploy
   after changing them.
5. Smoke test on production: sign in with a real account (code arrives,
   sign-in works); open an invitation link while signed in; check that
   `/forgot-password` returns 404.
6. Tell users: sign-in is now by email code only; old passwords and Google
   sign-in no longer work.

## 5. Rollback

Revert the commit and restore the removed env vars. Note: password hashes and
Google links were deleted from the `account` table, so after a rollback users
would need to reset passwords (the old DB copy still has the rows if needed).

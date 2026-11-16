# Open items and recommended follow-ups

Ordered by importance. None of them blocks the current release.

| # | Item | Risk | Recommendation |
| --- | --- | --- | --- |
| O1 | **Open registration.** Anyone who can receive email at an address can create an account and a «Моя организация» org (the `/sign-in` form registers too). | Spam accounts and orgs; noise in admin lists | Decide the policy: (a) invite-only — set `disableSignUp: true` and create users only through invitations; or (b) allow-list of email domains in `user.create.before`; or (c) keep open sign-up for self-service onboarding |
| O2 | **Rate limits are in memory.** better-auth stores rate-limit counters in process memory by default, and enables them only in production. On Vercel each function instance has its own counters. | Brute-force or email-flood protection is weaker than it looks | Set `rateLimit: { enabled: true, storage: "database" }` (or a Redis secondary storage) in `auth.ts` |
| O3 | **Codes stored in plain text** in `verification.value`. | A DB read leak exposes live codes (5-minute window) | Set `emailOTP({ storeOTP: "hashed" })` |
| O4 | **Email delivery is a single point of failure.** If Nylas is down or the grant loses its send scope, nobody can sign in. | Full lock-out | Monitor send failures; a second provider would be new work (the Resend alternative was removed 2026-11-16 — Nylas only) |
| O5 | **Invitation check enumeration.** `GET /api/invitations/check` tells anyone whether an email has a pending invitation. | Low (information leak) | Rate-limit it, or move the check server-side into the send step |
| O6 | **Hard-coded platform admin** in `admin({ adminUserIds: [...] })`. | Admin access tied to one user id in code | Rely on `user.role = "admin"` only, or move the list to an env var |
| O7 | **Stale `trustedOrigins`** (`business-os-demo.vercel.app`, `app.truffalo.ai`) from the old project. | Low | Keep only the real origins of this deployment |
| O8 | **No self-service email change.** Only platform admins can change an email. | Support load | Enable better-auth `changeEmail` with OTP confirmation if needed |
| O9 | **Hydration warning** in the browser console on the auth pages ("attributes of the server rendered HTML didn't match"). | Cosmetic | Investigate (likely a client-only attribute such as theme) |
| O10 | **Hidden API-keys card** (`SHOW_PREVIEW_API_KEYS = false`) and the `apiKey` plugin remain. | Dead UI code | Decide whether API keys are part of the product; remove or finish |

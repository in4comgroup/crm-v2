# Auth specs

Specifications for the authentication changes made on 2026-11-13, when the
project moved to the new repository (`in4comgroup/crm-v2`) and was rebased on
the design branch.

Status: **implemented, tested locally, not yet deployed.**

## Summary of the change

| Before | After |
| --- | --- |
| Email + password sign-in and sign-up | Removed |
| Password reset by email link | Removed |
| Google and GitHub OAuth | Removed |
| Email OTP sign-in (existing users only) | **The only method.** Signs in existing users and registers new ones |
| Email verification by link | Removed. A successful OTP sign-in marks the email as verified |
| Invitation page inside the `(auth)` route group | Moved out of `(auth)`, so signed-in users can accept invitations |

UI text stays in Russian. All system documentation is in English.

Related, separate topic: the Polar payments plugin was removed in the same
change set because it broke sign-up — see
[../billing/polar-removal.md](../billing/polar-removal.md).

## Documents

| File | Content |
| --- | --- |
| [email-otp-auth.md](email-otp-auth.md) | Main spec: the OTP flow, server config, UI, API, data, security limits |
| [invitation-flow.md](invitation-flow.md) | Invitation acceptance with OTP, the route move, all page states |
| [migration-and-rollout.md](migration-and-rollout.md) | Removed files, DB data changes, env vars, deploy checklist |
| [testing.md](testing.md) | Test plan, how to test locally, what was verified |
| [api-access.md](api-access.md) | Access rule «nothing works without sign-in»: central gate `src/proxy.ts`, public-by-design allowlist, audit fixes |
| [open-items.md](open-items.md) | Known limits and recommended follow-ups |

## Key files

| File | Role |
| --- | --- |
| `src/lib/auth.ts` | better-auth server config (plugins, hooks, session) |
| `src/lib/auth-client.ts` | better-auth client (`authClient`) |
| `src/components/forms/form-email-otp.tsx` | The shared two-step OTP form |
| `src/components/forms/form-sign-in.tsx` | `/sign-in` card |
| `src/components/forms/form-sign-up.tsx` | `/sign-up` card + pending-invitation guard |
| `src/app/accept-invitation/[id]/` | Invitation page (outside `(auth)`) |
| `src/app/(auth)/layout.tsx` | Redirects signed-in users away from `/sign-in` and `/sign-up` |
| `src/lib/get-session.ts` | Cached server session + active-organization backfill |
| `src/proxy.ts` | Central sign-in gate for every page and API route |
| `src/lib/email.ts` | `sendEmails` dispatcher (Nylas default, Resend optional) |

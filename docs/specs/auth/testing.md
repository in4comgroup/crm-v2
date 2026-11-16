# Testing

## 1. Test cases

| # | Case | Expected |
| --- | --- | --- |
| T1 | `/sign-in`, existing email, correct code | Signed in, redirect to `/dashboard` (or `?redirect=`) |
| T2 | `/sign-in`, wrong code | Error shown; after 3 wrong tries the code is dead (`TOO_MANY_ATTEMPTS`) |
| T3 | Code older than 5 minutes | Rejected; «Отправить код повторно» sends a new one |
| T4 | `/sign-in`, unknown email | Account created; name = email local part; own org «Моя организация» |
| T5 | `/sign-up`, new email + name | Account created with that name; own org |
| T6 | `/sign-up`, email with a pending invitation | Amber banner, no code sent |
| T7 | Invitation link, not signed in, new person | Code → user created without own org → joins inviter's org |
| T8 | Invitation link, not signed in, existing account | Code signs in → accept → joins the org |
| T9 | Invitation link, signed in with the same email | «Принять приглашение» button visible (no redirect to `/dashboard`) |
| T10 | Invitation link, signed in with another email | «Не тот аккаунт» + sign-out |
| T11 | Signed-in user opens `/sign-in` or `/sign-up` | Redirect to `/dashboard` |
| T12 | Typing the code digit by digit | Every digit stays in its box |
| T13 | Pasting `" 123 456\n"` | Field shows `123456` |
| T14 | Typing letters into the code field | Letters ignored |
| T15 | «Изменить email», new email, new code | Works; the code field starts empty |
| T16 | Password / OAuth / reset endpoints | 400 / 404 as listed in [email-otp-auth.md](email-otp-auth.md) §5.2 |
| T17 | `/forgot-password`, `/sign-in/otp` | 404 |
| T18 | Re-registration of a deleted email | Succeeds (it failed while Polar created customers at sign-up — see [../billing/polar-removal.md](../billing/polar-removal.md)) |
| T19 | `/profile` | No «Сменить пароль»; email status shown; admin email change shows the "verified at next sign-in" note |
| T20 | (obsolete 2026-11-16: Resend removed; codes always go out via Nylas) | — |

## 2. How to test locally without a real inbox

- Use plus-addresses of your own mailbox (`you+test1@domain`) for new users.
- Read the code from the DB instead of the inbox:
  ```sql
  select value from verification
  where identifier = 'sign-in-otp-you+test1@domain'
  order by created_at desc limit 1;
  -- value = "<otp>:<attempts>"
  ```
- To test only the UI with no email at all, intercept
  `POST /api/auth/email-otp/send-verification-otp` in the browser tool
  (Playwright `page.route`) and answer `{ "success": true }`.
- Test users get their own org «Моя организация». Delete the org (cascades
  its data) and then the user after the test.
- The dev server must run on the origin in `BETTER_AUTH_URL` / `trustedOrigins`
  (default `http://localhost:3000`). To run on another port, start it with
  `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` set to that origin.

## 3. Verification done (2026-11-13)

Local dev server, real DB copy, Playwright browser:

- T1, T2, T4, T5 via API with real codes read from the DB.
- T7, T9 in the browser through the real UI (name → code → accept → `/dashboard`).
- T11, T12, T13, T14, T15 in the browser with the send endpoint mocked.
- T16, T17, T18 via HTTP.
- `/dashboard`, `/clients`, `/contacts`, `/deals`, `/products`, `/tasks`,
  `/sources`, `/account`, `/profile` load with no page errors after the change.
- `tsc --noEmit`: 0 errors. ESLint: 0 errors.

Not yet verified: production deployment, T3 (expiry) and T10 (wrong account).

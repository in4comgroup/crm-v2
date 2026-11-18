# Email OTP authentication

## 1. Goal

One simple and safe way to sign in and to register: a one-time code (OTP)
sent to the user's email address. No passwords to store, reset or leak. No
third-party identity providers.

## 2. Decisions

| # | Decision | Reason |
| --- | --- | --- |
| D1 | Email OTP is the only auth method | Fewer flows to maintain and secure; the email address is the identity in this B2B product |
| D2 | The OTP sign-in also registers new users (`disableSignUp: false`) | One flow for sign-in, sign-up and invitations |
| D3 | `/sign-up` asks for a name, `/sign-in` does not | Sign-up should give a real display name; sign-in stays one field |
| D4 | A new user without a name gets the email local part as name | Avoids empty names in lists (`ivan@acme.com` → `ivan`) |
| D5 | Successful OTP sign-in sets `emailVerified = true` | Receiving the code proves ownership of the address; no separate verification link |
| D6 | Keep both pages `/sign-in` and `/sign-up` | Familiar UX; `/sign-up` adds the name and the pending-invitation guard |

## 3. User flows

### 3.1 Sign-in (`/sign-in`)

1. User enters the email and clicks «Отправить код» (Send code).
2. Server sends a 6-digit code to that address.
3. The form switches to the code step: «Введите 6-значный код, отправленный на …» (Enter the 6-digit code sent to …).
4. User types or pastes the code and clicks «Войти» (Sign in).
5. On success: toast «Вход выполнен!», redirect to `?redirect=` or `/dashboard`.

If the email has no account yet, step 4 creates one (see §5). Links: «Нет аккаунта? Зарегистрироваться» (No account? Register) → `/sign-up`.

### 3.2 Sign-up (`/sign-up`)

1. User enters «Имя» (Name) and email, clicks «Отправить код».
2. Before sending, the form calls `GET /api/invitations/check?email=…`.
   If the email has a live invitation, the form stops and shows an amber
   banner «У вас есть активное приглашение.» (You have an active invitation)
   telling the user to use the invitation link. If the check fails (network),
   the form continues (fail-open).
3. Code step as in 3.1; the button reads «Создать аккаунт» (Create account).
4. On success: toast «Регистрация прошла успешно!», redirect to `/dashboard`.

If the email already has an account, the code simply signs the user in; the
entered name is ignored.

### 3.3 Invitation

See [invitation-flow.md](invitation-flow.md).

### 3.4 Code step controls

- «Изменить email» (Change email) / «Назад» (Back, when the email is fixed) — returns to step 1.
- «Отправить код повторно» (Send the code again) — sends a new code to the same address.
- Wrong or expired code: red message under the form + toast (server message, e.g. "Invalid OTP").

## 4. UI component: `EmailOtpForm`

File: `src/components/forms/form-email-otp.tsx`. Used by `/sign-in`, `/sign-up`
and the invitation page.

Props:

| Prop | Type | Use |
| --- | --- | --- |
| `askName` | `boolean` | Show a required «Имя» field (sign-up, invitation) |
| `fixedEmail` | `string` | Lock the email (invitation) |
| `sendLabel`, `verifyLabel` | `string` | Button labels |
| `beforeSend` | `(email) => Promise<boolean>` | Hook before sending; return `false` to stop (sign-up invitation guard) |
| `onSignedIn` | `() => void \| Promise<void>` | Called after a successful sign-in |

Implementation rules (both caused real bugs, keep them):

1. **Each step's `<Form>` has its own `key`** (`"details"` / `"otp"`). The two
   steps use two `useForm` instances. Without the keys React reuses the
   details-step field component for the OTP field at the same tree position,
   and that field stays subscribed to the old form: typed digits disappear and
   submit fails with «Введите 6-значный код». (Fixed 2026-11-13.)
2. **Digits only.** `pattern={REGEXP_ONLY_DIGITS}` and
   `pasteTransformer={(t) => t.replace(/\D/g, "")}`. A code copied from an
   email often contains spaces or a line break (`" 123 456\n"`); without the
   transformer it was cut to `"123 4"` by `maxLength`.

Other details: the OTP input has `autoFocus` and `autoComplete="one-time-code"`
(lets mobile keyboards offer the code). The name is sent only on verify
(`signIn.emailOtp({ email, otp, name })`) and is used by the server only when
it creates a new user.

## 5. Server behaviour

### 5.1 Configuration (`src/lib/auth.ts`)

- Plugins: `nextCookies`, `emailOTP`, `organization`, `admin`, `apiKey`.
- Removed: `emailAndPassword`, `emailVerification`, `socialProviders`,
  `oAuthProxy`, `lastLoginMethod` (see [migration-and-rollout.md](migration-and-rollout.md)).
  The Polar payments plugin was removed too — a billing topic, see
  [../billing/polar-removal.md](../billing/polar-removal.md).
- `emailOTP({ disableSignUp: false, sendVerificationOTP })`. Defaults from
  better-auth 1.5.6 apply: 6 digits, expiry 300 s, max 3 wrong attempts per
  code, OTP stored as plain text in the `verification` table.
- The email uses `sendEmails()` from `src/lib/email.ts`. Subject for sign-in:
  «Ваш код для входа SalesDaily» (Your SalesDaily sign-in code). Body: «Ваш
  код подтверждения для входа в систему SalesDaily:» (Your code to sign in to
  SalesDaily), the code and «Срок действия кода — 5 минут» (valid for 5
  minutes).
- Client: `src/lib/auth-client.ts` registers `organizationClient`,
  `adminClient`, `apiKeyClient`, `emailOTPClient`.

### 5.2 Endpoints used

| Endpoint | Body | Result |
| --- | --- | --- |
| `POST /api/auth/email-otp/send-verification-otp` | `{ email, type: "sign-in" }` | `200 { success: true }`; code stored and emailed |
| `POST /api/auth/sign-in/email-otp` | `{ email, otp, name? }` | `200` + session cookies; `400 INVALID_OTP`, `OTP_EXPIRED` or `TOO_MANY_ATTEMPTS` |

Endpoints of removed methods now answer:

| Endpoint | Response |
| --- | --- |
| `POST /api/auth/sign-in/email` | `400 EMAIL_PASSWORD_DISABLED` |
| `POST /api/auth/sign-up/email` | `400 EMAIL_PASSWORD_SIGN_UP_DISABLED` |
| `POST /api/auth/sign-in/social` | `404 PROVIDER_NOT_FOUND` |
| `POST /api/auth/request-password-reset` | `400 RESET_PASSWORD_DISABLED` |

### 5.3 OTP storage

Table `verification`: `identifier = "sign-in-otp-<email>"`,
`value = "<otp>:<attempts>"`, `expires_at = now + 5 min`. A new request
replaces the old code. After 3 wrong attempts the code is rejected even if
correct; the user must request a new one.

### 5.4 New user creation (first successful code)

Order of hooks:

1. `user.create.before` — if `name` is empty, set it to the email local part.
2. User row inserted with `emailVerified = true`.
3. `user.create.after` — if the email has a pending, non-expired invitation,
   do nothing (the user joins the inviter's org on accept). Otherwise create
   the org «Моя организация» (My organization) with the user as `owner`.
4. `organization.create.after` — bootstraps the default sources from
   `source_template` rows with `is_default = true`. Failures are logged and
   never block the sign-up.
5. `session.create.before` — sets `activeOrganizationId/Name/Slug` from the
   user's organization.
6. `getServerSession()` (`src/lib/get-session.ts`) backfills the active
   organization on the session if it is still empty.

No row is written to the `account` table: OTP users have no password and no
external provider.

### 5.5 Existing user

The code signs the user in. Name is not changed. If `emailVerified` was
`false` (for example after an admin changed the address), it becomes `true`.

### 5.6 Sessions

Unchanged: 7-day sessions, expiry extended once a day, signed cookie cache of
5 minutes (`session.cookieCache`). Signed-in users opening `/sign-in` or
`/sign-up` are redirected to `/dashboard` by `src/app/(auth)/layout.tsx`.

## 6. Profile and admin surfaces

- `/profile`: the «Сменить пароль» (Change password) button was removed.
- Email change (platform admins only, via `authClient.admin.updateUser`) sets
  the new address with `emailVerified = false`. No verification email is sent;
  the next OTP sign-in to the new address verifies it. The page shows «Email
  не подтверждён — подтвердится при следующем входе по коду» (not verified —
  will be verified at the next sign-in with a code).
- `/settings` → Users: the admin «set password» dialog was removed. Edit user,
  role, ban and organization membership tools are unchanged.
- Platform admin is still designated by `admin({ adminUserIds: [...] })` plus
  `user.role = "admin"`.

## 7. Email delivery

`sendEmails()` sends through Nylas, from the mailbox of `NYLAS_GRANT_ID`
(the grant needs a send scope). The former Resend alternative
(`EMAIL_PROVIDER`, `RESEND_API_KEY`) was removed 2026-11-16 — Nylas is the
only provider.

If email delivery fails, the send endpoint returns an error and the form shows
«Не удалось отправить код» (Could not send the code). Nobody can sign in while
email delivery is down — see [open-items.md](open-items.md).

## 8. Security notes

- Codes: 6 random digits, 5-minute life, 3 attempts → about 3 in 1,000,000
  chance to guess one code.
- better-auth rate limits (defaults; active only in production, in-memory
  storage): `/email-otp/send-verification-otp` 3 requests / 60 s and
  `/sign-in/*` 3 requests / 10 s per IP.
- Codes are stored in plain text in the DB (better-auth default).
- Anyone can register with any email they can receive. There is no
  allow-list. See [open-items.md](open-items.md) for hardening options.

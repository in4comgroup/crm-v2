# Invitation flow (with email OTP)

## 1. Summary

An organization owner invites a person by email. The invitee opens the link,
proves the address with a one-time code, and joins the organization. The same
code either signs in an existing account or creates a new one.

## 2. Route move

| | Path on disk | URL |
| --- | --- | --- |
| Before | `src/app/(auth)/accept-invitation/[id]/` | `/accept-invitation/<id>` |
| After | `src/app/accept-invitation/[id]/` | `/accept-invitation/<id>` (unchanged) |

Reason: `src/app/(auth)/layout.tsx` redirects every signed-in user to
`/dashboard`. Inside `(auth)`, a signed-in user who opened an invitation link
never saw the «Принять приглашение» (Accept invitation) button. The URL in
already-sent invitation emails did not change. A comment in `page.tsx`
explains why the page must stay outside `(auth)`.

## 3. End-to-end flow

1. Owner opens `/account` → tab «Участники» (Members) → «Пригласить» (Invite),
   which calls `authClient.organization.inviteMember({ email, role,
   organizationId, resend: true })`.
2. better-auth calls `sendInvitationEmail` (in `src/lib/auth.ts`), which sends
   the link `${NEXT_PUBLIC_APP_URL}/accept-invitation/<invitationId>` via
   `sendEmails()`.
3. The invitee opens the link. `page.tsx` loads the invitation server-side
   with `getInvitationForAcceptance(id)` (public-safe fields only).
4. `accept-invitation-content.tsx` shows one of the states in §4.
5. On accept: `authClient.organization.acceptInvitation({ invitationId })` →
   `authClient.organization.setActive({ organizationId })` → redirect to
   `/dashboard`.

## 4. Page states

| State | What the user sees |
| --- | --- |
| Session loading | Spinner «Загрузка приглашения…» |
| Invitation not found, expired or not `pending` | «Недействительное приглашение» (Invalid invitation) + button to `/sign-in` |
| Not signed in | Card «Вас пригласили» (You are invited): «Имя» field, the invited email (locked), «Отправить код»; then the code step with button «Принять приглашение» |
| Signed in, same email | «Вы вошли как …» (Signed in as …) + «Принять приглашение» |
| Signed in, different email | «Не тот аккаунт» (Wrong account) + «Выйти» (Sign out); after sign-out the page shows the not-signed-in state |
| Accepted | «Приглашение принято!» (Invitation accepted), then redirect |

## 5. Not-signed-in branch in detail

The page uses `EmailOtpForm` with `fixedEmail = invitation.email` and
`askName`. The code goes only to the invited address, so nobody can join with
another email.

- New person: the code creates the user. Because a pending invitation exists,
  `user.create.after` does **not** create «Моя организация»; the user then
  accepts and joins only the inviter's organization.
- Existing account: the code signs in; the entered name is ignored (the card
  says so: «Если у вас уже есть аккаунт с этим email, код войдёт в него. Имя
  тогда не изменится.»).

After `signIn.emailOtp` succeeds, the page calls `acceptInvitation` and
`setActive` in sequence.

## 6. Sign-up guard

`/sign-up` calls `GET /api/invitations/check?email=…` before sending a code.
If a live invitation exists, sign-up stops and asks the user to use the
invitation link, so the user does not end up in a fresh «Моя организация».
The check is fail-open on network errors. Known trade-off: the endpoint lets
anyone test whether an email has a pending invitation (see
[open-items.md](open-items.md)).

## 7. Server functions and APIs

| Item | Location |
| --- | --- |
| `getInvitationForAcceptance(id)` | `src/server/invitations.ts` |
| `hasPendingInvitationForEmail(email)` | `src/server/invitations.ts` |
| `GET /api/invitations/[id]` | public invitation details |
| `GET /api/invitations/check` | public pending-invitation check |
| Accept / set active | better-auth organization plugin (`/api/auth/organization/*`) |

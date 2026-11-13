# Polar removal

## 1. Background

Polar (polar.sh) was integrated as a better-auth plugin for payments. It ran
in **sandbox** mode with one test product («Test-credit»). In the UI it showed
preview-only billing cards on the account page: «Баланс счёта» (Account
balance, hard-coded numbers), three «Купить» (Buy) buttons linking to a
sandbox checkout, «История покупок» (Purchase history) and «История
использования» (Usage history, sample data). In the design branch these cards
were already hidden behind a `false` flag. No real payments ever ran.

## 2. Problem that triggered the removal

The plugin was configured with `createCustomerOnSignUp: true`. Every new user
was also created as a Polar customer, with the user id as `external_id`. When
a user was deleted from our DB and the same email signed up again, Polar
rejected the new customer ("Customer external ID cannot be updated"). Result:

- The sign-up request failed with HTTP 500.
- A half-created user stayed in our DB without an organization.

This affects every email that ever existed and was deleted (for example the
users removed in the 2026-11-13 data cleanup).

## 3. Decision

Remove Polar completely. The product has no billing today. If billing is
needed later, it gets its own spec (checkout created on demand, not at
sign-up).

## 4. What was removed

| Area | Item |
| --- | --- |
| Server auth | `polar({ client, createCustomerOnSignUp, use: [checkout, portal, usage] })` plugin and the `Polar` SDK client in `src/lib/auth.ts` |
| Client auth | `polarClient()` in `src/lib/auth-client.ts` |
| API routes | `src/app/api/auth/polar/{state,orders,invoices}/route.ts` (now 404) |
| Types | `src/types/polar.ts` |
| UI | `src/components/tables/table-user-orders.tsx`, `table-user-usage.tsx`; the three billing cards and the Polar state fetch on `src/app/(protected)/account/page.tsx` |
| Flag | `SHOW_PREVIEW_BILLING_BLOCKS` renamed to `SHOW_PREVIEW_API_KEYS`; it now gates only the hidden «Управление API-ключами» (API keys) card |
| Packages | `@polar-sh/better-auth`, `@polar-sh/sdk` (package.json + lockfile) |
| Env vars | `POLAR_ACCESS_TOKEN`, `POLAR_SUCCESS_URL` |

The DB schema had no Polar tables or columns, so no data migration was needed.

## 5. Not affected

- Recharts `PolarGrid` / `PolarAngleAxis` (radar charts) — a chart type, not the payments service.
- The better-auth `apiKey` plugin stays.

## 6. Verification

- Sign-up with an email that failed before (re-registration of a deleted
  user) now succeeds.
- `/api/auth/polar/state` returns 404.
- `/account` loads without billing cards and without console errors.
- `grep -ri polar src` finds only the chart components.

## 7. External leftovers

Test customers created in the Polar sandbox during development stay in the
sandbox account. They have no effect on the app.

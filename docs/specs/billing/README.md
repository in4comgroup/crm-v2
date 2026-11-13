# Billing specs

Specifications for billing and payments.

Status: the app has **no billing** since 2026-11-13. The Polar integration was
removed (implemented, tested locally, not yet deployed).

## Documents

| File | Content |
| --- | --- |
| [polar-removal.md](polar-removal.md) | Why the Polar payments plugin was removed, what was removed, verification |

## Related

- [../auth/README.md](../auth/README.md) — the Polar plugin created a customer
  at every sign-up; that broke re-registration, which is why it was removed
  together with the auth change.

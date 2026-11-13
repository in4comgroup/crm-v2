# Database migrations specs

How the database structure is changed, and the baseline that started the
process.

Status: **implemented and applied** to the project DB (Neon) on 2026-11-13.

## Summary

Before: schema changes were applied with `drizzle-kit push` or with one-off
SQL scripts (git-ignored, not in the repo). The repo could not rebuild the DB,
and `push` wanted to drop the Search V2 columns.

After: every structure change is a Drizzle migration file in `migrations/`,
committed with the code. A 5-file baseline describes the full current DB,
including the platform reference data a fresh DB needs (`0004`). The
production DB records applied migrations in `drizzle.__drizzle_migrations`.

## Documents

| File | Content |
| --- | --- |
| [baseline.md](baseline.md) | The baseline: why 5 files, what each contains (incl. reference data), how the live DB was baselined, how it was verified |
| [workflow.md](workflow.md) | The day-to-day process for schema and non-schema changes, deploy order, do and don't |

The rule itself is in the root `AGENTS.md` → "Working rules → 3. Database
changes". The operator summary is in
[../../docs/operations.md](../../docs/operations.md#database-changes).

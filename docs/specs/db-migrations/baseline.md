# Migrations baseline (2026-11-13)

## 1. Goal

1. The repo alone can build the full DB structure on an empty Postgres DB.
2. The existing DB (a copy of the old production DB) is recorded as "at the
   baseline", without dropping or rewriting any data.
3. From now on, every structure change is a migration.

## 2. Starting point

`drizzle-kit pull` (read-only introspection) of the live DB, compared field by
field with `src/db/schema.ts`:

| Finding | Count |
| --- | --- |
| Tables, columns, types, defaults, enums (values) | Identical (35 tables) |
| Objects only in the DB: extensions `pg_trgm`, `unaccent`; functions `immutable_unaccent`, `translit_cyr_lat`, `to_or_tsquery` | 2 + 3 |
| Objects only in the DB: Search V2 generated columns on `product` (`name_norm`, `region_norm`, `is_drink`, `is_gift`, `search_vector`) + 4 indexes | 5 + 4 |
| Constraint names chosen by Postgres (`*_fkey`, `*_pkey`) where Drizzle names them `*_fk`, `*_pk` — 7 tables first created with hand-written SQL | 15 FKs, 1 PK |
| Index names in lower case where `schema.ts` uses camelCase | 3 |
| Enum value order differs (values appended later): `source_provider`, `task_type` | 2 |
| `order.discount_percent` default written as `0` instead of `'0'::numeric` (same value) | 1 |

## 3. Design

| # | Decision | Reason |
| --- | --- | --- |
| D1 | Keep `src/db/schema.ts` as the single source for tables | It already matched the DB; the app types come from it |
| D2 | Keep the Search V2 columns **out of** `schema.ts`; define them in a custom migration | Drizzle `select()` returns every schema column; `search_vector` is large and would be loaded on every product query. The retriever reads them with raw `sql` |
| D3 | Align the live DB to Drizzle's names (rename), not `schema.ts` to the DB | Keeps `schema.ts` clean; future generated migrations refer to Drizzle names. Renames are metadata-only |
| D4 | Edit the generated baseline so enum value order equals the live DB | A fresh DB then sorts enum values the same way as production |
| D5 | Make all custom SQL safe to re-run (`IF NOT EXISTS`, guarded `DO` blocks) | The same files run on a fresh DB and on the existing DB |

## 4. Files

| File | Kind | Content | On a fresh DB | On the existing DB |
| --- | --- | --- | --- | --- |
| `0000_extensions_and_functions.sql` | custom | `CREATE EXTENSION IF NOT EXISTS pg_trgm, unaccent`; `CREATE OR REPLACE FUNCTION` × 3 | creates | recorded as applied (not run) |
| `0001_baseline.sql` | generated | 35 tables, 28 enums, indexes, FKs; enum order edited (D4) | creates | recorded as applied (not run) |
| `0002_search_v2_product_columns.sql` | custom | `ADD COLUMN IF NOT EXISTS … GENERATED ALWAYS AS (…) STORED` × 5, `CREATE INDEX IF NOT EXISTS` × 4 | creates | run; no-op (all exist) |
| `0003_align_constraint_names.sql` | custom | renames 15 FKs + 1 PK + 3 indexes if the old name exists; sets the `discount_percent` default | no-op | run; renames applied |
| `0004_seed_reference_data.sql` | custom | 9 `source_template` rows + 7 system `deal_funnel_stage` rows, fixed ids, `ON CONFLICT (id) DO NOTHING` | inserts | run; no-op (rows exist) |

Snapshots in `migrations/meta/`: `0001_snapshot.json` holds the full schema;
custom migrations keep the previous snapshot, so `pnpm db:generate` diffs
against `schema.ts` only.

## 5. How the existing DB was baselined

1. Created `drizzle.__drizzle_migrations` and inserted the rows for `0000` and
   `0001` (`hash` = sha256 of the file content, `created_at` = the journal
   `when` value) — exactly what `drizzle-kit migrate` writes.
2. Ran `drizzle-kit migrate`: it applied `0002` (no-op) and `0003` (renames)
   in one transaction. `0004` (seed) was added the same day and applied the
   same way: no-op, row counts and `updated_at` values unchanged.

The Drizzle migrator applies every journal entry whose `when` is later than
the newest `created_at` in that table, so the recorded rows make it skip
`0000` and `0001`.

## 6. Verification

No local DB was used. The checks ran against the Neon DB:

1. **Fresh-build test**: inside one transaction, all 4 migrations were applied
   into a temporary schema `mig_check` (243 statements), then every column
   (type, nullability, default, generation expression), constraint, index,
   enum (with value order) and the 3 functions were compared with `public`.
   The transaction was rolled back; `mig_check` never persisted.
   - Before `0003` ran on the live DB: only the planned name differences.
   - After: **0 differences in 910 objects.**
2. A second `pnpm db:migrate`: nothing to apply (5 rows in the table after `0004`).
   The fresh-build test was repeated with `0004`: structure 0 differences, and
   the 9 templates + 7 system stages are identical field by field to the live
   DB; running `0004` twice is a no-op.
3. `pnpm db:generate`: "No schema changes" — `schema.ts` and the migrations agree.
4. App smoke test: pages load; a product search using `search_vector` and the
   trigram index on `name_norm` returns results.

## 7. Reference (seed) data — `0004`

Two kinds of platform-wide rows are needed by every DB:

| Data | Rows | Why it is needed |
| --- | --- | --- |
| `source_template` | 9 | New orgs get their default sources from `is_default = true` templates (Files Drop Off, AI Chat); the «Добавить источник» (Add source) picker lists the visible ones |
| `deal_funnel_stage` with `owner_organization_id IS NULL` | 7 (Qualification … Rejected) | The funnel every org uses until it defines its own stages (org-or-system fallback in `listDealFunnelStages`) |

There are no system rules (all rules belong to an org). The rows were taken
from the live DB with their ids; the templates hold no secrets (default
configs are `{}` or `{"mailbox":"INBOX"}`). Tenant data is never seeded.

## 8. Limits

- On a fresh DB, `0000` needs a role that may run `CREATE EXTENSION` (Neon's
  owner role can).

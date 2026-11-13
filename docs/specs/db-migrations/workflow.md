# Database change workflow

## 1. Schema change (expressible in `src/db/schema.ts`)

New table, column, enum value, index, FK, default:

1. Edit `src/db/schema.ts`.
2. `pnpm db:generate --name <short-description>` → new `migrations/NNNN_<name>.sql` + snapshot.
3. Read the SQL. Check for anything destructive (`DROP`, type changes that rewrite a table, `NOT NULL` without a default on a filled table).
4. If needed, edit the SQL before it is applied (comment why). Example: add a backfill `UPDATE` before a `SET NOT NULL`.
5. Commit the schema change, the SQL file and `migrations/meta/*` together with the code that uses them.

## 2. Change `schema.ts` cannot express

Extensions, SQL functions, triggers, generated columns kept out of the schema,
data backfills, careful renames:

1. `pnpm db:custom --name <short-description>` → new empty SQL file.
2. Write the SQL. Prefer re-runnable statements (`IF NOT EXISTS`, `CREATE OR REPLACE`, guarded `DO $$ … $$` blocks).
3. Separate statements with `--> statement-breakpoint`.
4. Commit.

## 3. Platform reference data

Rows every DB needs (source templates, system funnel stages) are seeded by
migrations (`0004`). To add or change them, write a NEW custom migration:
`INSERT … ON CONFLICT (id) DO NOTHING` for new rows, `UPDATE … WHERE id = …`
for changes. Use fixed ids. Never put tenant data in a migration.

## 4. Apply

- `pnpm db:migrate` applies all pending migrations to the DB in `DATABASE_URL`,
  in one transaction, and records them in `drizzle.__drizzle_migrations`.
- Order: **migrate first, then deploy** the code that needs the change. Prefer
  backward-compatible steps (add column → deploy code → later drop old
  column in a separate migration) so the running app never breaks.
- Every environment (each DB) is migrated the same way. Never fix one DB by
  hand.

## 5. Don't

| Don't | Why |
| --- | --- |
| `drizzle-kit push` | Applies changes without a record; would drop the Search V2 columns |
| Ad-hoc SQL, one-off scripts, Neon console for structure changes | Not reproducible; the next fresh DB would differ |
| Edit a migration that is already applied | The DB that ran it will never see the edit; write a new migration |
| Delete or reorder files in `migrations/` or `meta/_journal.json` | Breaks the history and the snapshots |
| Put large generated columns into `schema.ts` | Drizzle `select()` would load them everywhere |

## 6. Useful checks

- `pnpm db:check` — consistency of the migration folder.
- `pnpm db:generate` with no schema edits must say "No schema changes". If it
  generates SQL, someone changed `schema.ts` without a migration.

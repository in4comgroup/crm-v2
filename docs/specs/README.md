# Specs

Specifications of changes to the system, one topic per sub-folder.

## Rules

- One sub-folder per topic, kebab-case name. A folder holds **only** specs for
  its topic (`auth/` is only for authentication). Unrelated work gets its own
  folder, even when it ships in the same change set; link between folders
  instead of mixing them.
- Every topic folder has a `README.md`: summary, status, date, index of files.
- Add a row to the table below when you create a topic folder.
- Language: English. Quote Russian UI labels exactly, with an English gloss on
  first use, e.g. «Компании» (Companies).
- General system documentation (not change specs) lives in [../docs/](../docs/README.md).

The same rules are in the root `AGENTS.md` → "Working rules".

## Topics

| Folder | Topic | Status |
| --- | --- | --- |
| [auth/](auth/README.md) | Authentication: email OTP only, invitation flow | Implemented 2026-11-13, not yet deployed |
| [billing/](billing/README.md) | Billing / payments: Polar removal | Implemented 2026-11-13, not yet deployed |
| [db-migrations/](db-migrations/README.md) | Database change process: Drizzle migrations baseline + reference (seed) data | Implemented and applied to the DB 2026-11-13 |

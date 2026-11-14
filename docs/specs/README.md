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
| [topics/](topics/README.md) | Topics («Темы»): business questions extracted from source items, scored by signals and an attention engine, shown as cards; drives the sales funnel. Pilot IN4COM; one generic signal set for every org (R22) | Final plan 2026-11-13 (R1–R23); phases 0–3 built (foundations, signals registry, signal extraction, topic engine), not deployed; phase 4 next |
| [s3-r2/](s3-r2/README.md) | Object storage: generic S3-compatible core + provider registry (Cloudflare R2 today) | Phase 1 implemented 2026-11-13; Phase 2 (rename legacy `r2` columns/routes) planned |
| [models/](models/README.md) | AI models: gateway providers, model registry, per-process model selection, usage statistics, markup | Implemented P1–P4 (registry, per-process models, runtime layer, usage ledger, markup, owner usage view, model policy) 2026-11-13, not yet deployed |

# Migration and rollout

## 1. Before (2026-11-13)

- One module `src/lib/r2.ts`: built an `S3Client` from `R2_*` env vars at
  module load, exported `putMarkdownToR2`, `getMarkdownFromR2`,
  `putBinaryToR2`, `getBinaryFromR2`, `deleteFromR2`.
- 7 importers: `server/r2/upload-source-item.ts`, `server/source-items.ts`,
  `server/cards-generation.ts`, `server/deals-discovery.ts`,
  `server/teardown.ts`, `server/user-avatar.ts`,
  `app/api/sources/items/[id]/markdown/route.ts`.
- Vendor name in the UI: «…из R2», «Сохранить в R2», «Загружено … в R2».
- Vendor name in data / URLs: `source_item.markdown_r2_key`,
  `r2_upload_status` (enum `r2_upload_status`), `r2_uploaded_at`,
  `markdown_r2_size_bytes`; routes `/api/sources/r2/save`,
  `/api/sources/r2/pending-ids`; `teardown_log.counts.r2Objects`.

## 2. Phase 1 — done (2026-11-13)

| Change | Where |
| --- | --- |
| Generic S3 core (only `@aws-sdk/*` importer) | `src/server/storage/s3/client.ts` |
| Types + errors | `src/server/storage/types.ts` |
| Provider registry, `STORAGE_PROVIDER` (default `cloudflare-r2`) | `src/server/storage/providers/index.ts` |
| Cloudflare R2 provider | `src/server/storage/providers/cloudflare-r2.ts` |
| Business API | `src/server/storage/index.ts` |
| `src/lib/r2.ts` removed; 7 importers switched to `@/server/storage` | see §1 |
| `src/server/r2/upload-source-item.ts` → `src/server/upload-source-item.ts` (it is source-item logic, not storage); failure reason `r2_failed` → `storage_failed` | importers updated |
| UI text: «R2» → «хранилище» (storage) | sources tables, client content, parsed-source UI, batch upload control |
| ESLint boundaries (01 §3) | `eslint.config.mjs` |

No env change, no DB change, no behaviour change: same bucket, same keys,
same endpoint.

## 3. Legacy names kept (on purpose)

Decided by the product owner on 2026-11-13: keep the `r2` names; rename
only together with a second provider (Phase 2).

The DB columns and enum (`markdown_r2_key`, `r2_upload_status`,
`r2_uploaded_at`, `markdown_r2_size_bytes`), the two `/api/sources/r2/*`
routes, the component file `r2-batch-upload-control.tsx` and the
`r2Objects` count key keep their names. They mean "object storage". Renaming
them touches ~116 references in 17 files plus a DB migration, and gives no
capability today.

## 4. Phase 2 — planned, do with the second provider

1. Migration (custom, guarded): `ALTER TABLE source_item RENAME COLUMN
   markdown_r2_key TO storage_key` (and `r2_upload_status →
   storage_upload_status`, `r2_uploaded_at → storage_uploaded_at`,
   `markdown_r2_size_bytes → storage_size_bytes`); `ALTER TYPE
   r2_upload_status RENAME TO storage_upload_status`; rename the partial
   index. Then `schema.ts` + code.
2. Routes `/api/sources/r2/*` → `/api/sources/storage/*` (client callers in
   the same change).
3. If two providers must coexist (gradual move), add
   `source_item.storage_provider` (nullable = the default provider) and make
   the business API take it.

## 5. Testing (Phase 1)

- Type check and lint (incl. the new boundary rules).
- Live round trip against the configured bucket, under a temporary key
  prefix, deleted afterwards: `checkStorage`, `putTextObject` /
  `getTextObject`, `putObject` / `getObject` (binary + content type),
  `getObject` of a missing key → `null`, `getTextObject` of a missing key →
  `StorageObjectNotFoundError`, `deleteObjects` (idempotent on missing keys).
- Endpoint rules of the R2 provider: `R2_ENDPOINT` / `R2_PUBLIC_URL` /
  account + jurisdiction; missing vars → `StorageNotConfiguredError` listing
  them.

## 6. Results (Phase 1, 2026-11-13)

- `tsc`: 0 errors. ESLint: 0 errors. The boundary rules were checked per
  folder scope with a probe file: business code gets all errors (AWS SDK,
  storage env, plus the AI rules); `s3/` may import the SDK; `providers/`
  may read storage env vars; AI rules still apply everywhere.
- Found while building: in ESLint flat config a later block setting the
  same rule REPLACES the earlier one — a separate storage block had silently
  switched off the AI boundary rules. Fixed by building all boundary rules
  per folder scope from shared parts (`eslint.config.mjs`, "Layer
  boundaries").
- Live round trip on `business-os-2` under `__storage-test/<ts>/` (removed):
  `checkStorage` ok; text put/get (UTF-8, Cyrillic) ok; binary put/get with
  content type ok; missing key → `null` / `StorageObjectNotFoundError`;
  `deleteObjects` of 2 existing + 1 missing key ok; empty delete → 0.
- R2 endpoint rules: account → `https://acc.r2.cloudflarestorage.com`;
  account + `EU` → `https://acc.eu.r2.cloudflarestorage.com`; `R2_ENDPOINT`
  wins; missing vars are listed. Unknown `STORAGE_PROVIDER` → clear error.

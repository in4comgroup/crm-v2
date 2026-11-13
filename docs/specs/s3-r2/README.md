# Object storage (S3-compatible) specs

Generic, provider-neutral object storage for the files the app keeps outside
the database (parsed-source markdown, user avatars). Cloudflare R2 is today's
only provider, plugged in through a provider registry, so another
S3-compatible service (AWS S3, Backblaze B2, Wasabi, MinIO, Google Cloud
Storage interop, …) can be added without touching business code.

Status: **Phase 1 implemented** (2026-11-13): generic S3 core, provider
registry with `cloudflare-r2`, business API, lint boundary, vendor names
removed from the UI. Phase 2 (rename of the legacy `r2` DB columns / routes)
is planned, not started — do it together with the second provider.

## Requirement (from the product owner)

Generalize the storage code so that the standard S3-compatible part is
generic and vendor details are served by vendor-specific logic. Make the
current Cloudflare R2 setup one of the providers in a registry. Do not add a
new provider now.

## Documents

| File | Content |
| --- | --- |
| [01-architecture.md](01-architecture.md) | Layers, interfaces, provider registry, configuration, errors, boundaries, how to add a provider |
| [02-migration-and-rollout.md](02-migration-and-rollout.md) | Current state before the change, Phase 1 changes, legacy names, Phase 2 plan, testing |

## Terms

| Term | Meaning |
| --- | --- |
| Object storage | A bucket of objects (key → bytes + content type), reached through the S3 API |
| Provider | One S3-compatible service and its specifics (endpoint rules, env vars, quirks). Today: `cloudflare-r2` |
| Core | The provider-neutral S3 client code (`src/server/storage/s3/`) |
| Business API | The functions business code calls (`@/server/storage`) |

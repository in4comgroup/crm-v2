# Architecture

## 1. Goal

Business code stores and reads objects by **key**. It never knows which
service holds them, never imports the AWS SDK, and never reads a provider's
env vars. The S3 protocol is implemented once (the open standard every
target speaks); each provider only says how to connect and what is special
about it.

Same pattern as the AI gateway layer (`docs/specs/models/01-gateway-providers.md`):
standard protocol in a core, specifics in a provider module, a registry,
lint-enforced boundaries.

## 2. Standard reused

| Concern | Standard | How we use it |
| --- | --- | --- |
| Object API | **Amazon S3 REST API** (de facto standard; R2, B2, Wasabi, MinIO, GCS interop all implement the subset we use) | One generic client on `@aws-sdk/client-s3`: `PutObject`, `GetObject`, `DeleteObjects` (≤ 1,000 keys per call), `HeadBucket` |
| Auth | **AWS Signature V4** | Access key id + secret, region string; supplied by the provider |

We use only the portable subset. No provider-specific API (R2 bindings,
Workers, public `r2.dev` URLs) is used: the bucket is private and objects are
served through authenticated app routes.

## 3. Layers

```
business code (source items, parsers, teardown, avatars, AI chat tools)
   │  imports ONLY  @/server/storage   (putObject, getObject, getTextObject, …)
   ▼
src/server/storage/index.ts          ← business API (provider-neutral)
   ▼
src/server/storage/s3/client.ts      ← generic S3 core: the ONLY file that imports @aws-sdk/*
   ▲  connection config
src/server/storage/providers/<key>.ts ← vendor specifics (env vars, endpoint rules, client options)
src/server/storage/providers/index.ts ← registry + active-provider selection
```

Rules (ESLint, `eslint.config.mjs`):

1. Outside `src/server/storage/s3/**`: importing `@aws-sdk/*` is an error.
2. Outside `src/server/storage/providers/**`: reading a provider env var
   (`process.env.R2_*`) is an error.
3. Business code imports only `@/server/storage` (the package's index).

## 4. Interfaces

```ts
// What a provider resolves from its configuration (src/server/storage/types.ts)
type S3ConnectionConfig = {
  endpoint?: string            // undefined = the SDK's AWS default
  region: string               // R2: "auto"
  bucket: string
  credentials: { accessKeyId: string; secretAccessKey: string }
  forcePathStyle?: boolean     // MinIO-style servers need true
  clientOptions?: Record<string, unknown>  // extra S3Client options (quirks)
}

interface StorageProvider {
  key: string                  // "cloudflare-r2"
  label: string                // "Cloudflare R2"
  // Read the provider's own env vars. Returns a reason when incomplete.
  resolveConfig(env: NodeJS.ProcessEnv): S3ConnectionConfig | { missing: string[] }
  // Safe, secret-free description for logs / admin screens.
  describe(config: S3ConnectionConfig): Record<string, string>
  // Max keys per DeleteObjects call (S3 standard: 1000).
  maxDeleteBatch?: number
  // Extra "object not found" detection on top of the S3 standard
  // (NoSuchKey / NotFound / HTTP 404).
  isNotFound?(error: unknown): boolean
}

// Business API (src/server/storage/index.ts)
putObject(key, bytes, contentType)        → { key, sizeBytes }
putTextObject(key, text, contentType)     → { key, sizeBytes }   // UTF-8
getObject(key)                            → { bytes, contentType } | null   // null = no such key
getTextObject(key)                        → string                // throws StorageObjectNotFoundError
deleteObjects(keys)                       → number                // chunked, idempotent
checkStorage()                            → { ok, provider, details, error? }  // HeadBucket
storageInfo()                             → { provider, label, details }       // no secrets
```

Errors: core throws `StorageNotConfiguredError` (lists the missing env vars
of the active provider) and `StorageObjectNotFoundError`. Everything else is
the SDK error, unchanged.

## 5. Registry and configuration

- Providers are registered in code (`providers/index.ts`). One active
  provider per deployment, chosen by env `STORAGE_PROVIDER` (default
  `cloudflare-r2`, so today's setup needs no env change).
- Each provider reads **its own** env var names (vendor detail). Secrets stay
  in env (Vercel encrypted vars); nothing about storage is in the DB.
- Why env and not a DB table (unlike `ai_gateway`): storage holds data. A
  provider switch is a data migration (copy the objects), not a runtime
  choice, and there is exactly one active bucket. Switching at runtime from a
  table would orphan every stored key.
- The S3 client is created lazily on first use and cached; the app boots
  without storage configured (as before).

## 6. Provider: `cloudflare-r2`

| Item | Value |
| --- | --- |
| Env | `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` (required); `R2_ENDPOINT` or legacy `R2_PUBLIC_URL` (S3 API endpoint — despite the name, not a public URL); else built from `R2_ACCOUNT_ID` + optional `R2_JURISDICTION` (`eu`, `fedramp`) |
| Endpoint | `https://<account>.r2.cloudflarestorage.com`, or `https://<account>.<jurisdiction>.r2.cloudflarestorage.com` for jurisdictional buckets |
| Region | `auto` (R2 ignores it, SigV4 needs a value) |
| Delete batch | 1,000 keys |
| `describe` | provider, bucket, endpoint host, jurisdiction (from the host) |

## 7. Adding a provider later

1. Create `src/server/storage/providers/<key>.ts` implementing
   `StorageProvider` (its env vars, endpoint rules, quirks such as
   `forcePathStyle` or checksum options in `clientOptions`).
2. Add one line to the registry.
3. Set `STORAGE_PROVIDER=<key>` + its env vars, copy the objects (keys are
   provider-neutral: `org_<org>/source_<source>/item_<item>.md`,
   `avatars/user_<id>`, and — added later — the original document files
   `org_<org>/files/<item>/<safe name>` ([attachments](../attachments/README.md)
   §3.2, 2026-11-15) and the AI chat upload parts
   `org_<org>/chat-uploads/<item>/part-<n>` (≤ 4 MB each, joined into the
   original through `storeDocumentOriginal` and deleted on «complete»,
   `src/server/chat/files.ts`; [ai-chat-tools](../ai-chat-tools/README.md) T0,
   2026-11-16)), deploy.

No business code changes. A generic `s3-compatible` provider (reads
`STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`,
`STORAGE_SECRET_ACCESS_KEY`, `STORAGE_FORCE_PATH_STYLE`) would cover most
services with config only; it is designed, not built (not requested now).

## 8. Out of scope

- A second provider; running two providers at once (would need a per-row
  storage id — see 02 §4).
- Presigned URLs / direct browser uploads (not used today).
- Renaming the legacy `r2` DB columns and routes (Phase 2, 02 §4).

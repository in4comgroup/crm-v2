import "server-only"

import type { StorageProvider } from "@/server/storage/types"

// Cloudflare R2 (docs/specs/s3-r2/01-architecture.md §6). All R2 specifics
// live here: its env var names, endpoint rules and region.
//
// Endpoint precedence:
//   1. R2_ENDPOINT
//   2. R2_PUBLIC_URL — legacy name kept for existing deployments. Despite
//      the name it is the S3 API endpoint, not a public bucket URL.
//   3. built from R2_ACCOUNT_ID (+ R2_JURISDICTION "eu" / "fedramp" for
//      jurisdictional buckets).

const JURISDICTIONS = new Set(["eu", "fedramp"])

export const cloudflareR2Provider: StorageProvider = {
  key: "cloudflare-r2",
  label: "Cloudflare R2",
  maxDeleteBatch: 1000,

  resolveConfig(env) {
    const accessKeyId = env.R2_ACCESS_KEY_ID
    const secretAccessKey = env.R2_SECRET_ACCESS_KEY
    const bucket = env.R2_BUCKET_NAME
    const accountId = env.R2_ACCOUNT_ID
    const jurisdiction = env.R2_JURISDICTION?.trim().toLowerCase()
    const endpoint =
      env.R2_ENDPOINT ||
      env.R2_PUBLIC_URL ||
      (accountId
        ? `https://${accountId}.${jurisdiction && JURISDICTIONS.has(jurisdiction) ? `${jurisdiction}.` : ""}r2.cloudflarestorage.com`
        : undefined)

    const missing: string[] = []
    if (!accessKeyId) missing.push("R2_ACCESS_KEY_ID")
    if (!secretAccessKey) missing.push("R2_SECRET_ACCESS_KEY")
    if (!bucket) missing.push("R2_BUCKET_NAME")
    if (!endpoint) missing.push("R2_ENDPOINT (or R2_ACCOUNT_ID)")
    if (missing.length) return { missing }

    return {
      endpoint,
      // R2 ignores the region, but SigV4 signing needs one; "auto" is what
      // Cloudflare documents.
      region: "auto",
      bucket: bucket!,
      credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
    }
  },

  describe(config) {
    const host = config.endpoint ? new URL(config.endpoint).host : ""
    const m = host.match(/^[^.]+\.([a-z]+)\.r2\.cloudflarestorage\.com$/)
    return {
      bucket: config.bucket,
      endpoint: host,
      jurisdiction: m ? m[1] : "default",
    }
  },
}

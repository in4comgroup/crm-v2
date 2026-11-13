import "server-only"

// Provider-neutral object storage types (docs/specs/s3-r2/01-architecture.md §4).

/** How to reach an S3-compatible bucket; resolved by a provider. */
export type S3ConnectionConfig = {
  // undefined = the SDK's AWS default endpoint for `region`.
  endpoint?: string
  region: string
  bucket: string
  credentials: { accessKeyId: string; secretAccessKey: string }
  // Path-style addressing (MinIO-like servers need true).
  forcePathStyle?: boolean
  // Extra S3Client options for provider quirks (e.g. checksum behaviour).
  clientOptions?: Record<string, unknown>
}

/** One S3-compatible service. The ONLY place with vendor specifics. */
export interface StorageProvider {
  key: string
  label: string
  // Read the provider's own env vars; list what is missing when incomplete.
  resolveConfig(env: NodeJS.ProcessEnv): S3ConnectionConfig | { missing: string[] }
  // Safe, secret-free description (logs, admin screens).
  describe(config: S3ConnectionConfig): Record<string, string>
  // Max keys per DeleteObjects call (S3 standard: 1000).
  maxDeleteBatch?: number
  // Extra "object not found" detection on top of the S3 standard.
  isNotFound?(error: unknown): boolean
}

export type StoredObject = { bytes: Uint8Array; contentType: string }

export class StorageNotConfiguredError extends Error {
  constructor(
    public readonly provider: string,
    public readonly missing: string[],
  ) {
    super(`Object storage (${provider}) is not configured: set ${missing.join(", ")}`)
    this.name = "StorageNotConfiguredError"
  }
}

export class StorageObjectNotFoundError extends Error {
  constructor(public readonly key: string) {
    super(`Storage object not found: ${key}`)
    this.name = "StorageObjectNotFoundError"
  }
}

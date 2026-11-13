import "server-only"

import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import type {
  S3ConnectionConfig,
  StorageProvider,
  StoredObject,
} from "@/server/storage/types"

// Generic S3-compatible core (docs/specs/s3-r2/01-architecture.md §3).
// The ONLY module that imports the AWS SDK (lint-enforced). It speaks the
// portable S3 subset every provider implements; connection details and
// quirks come from the provider's S3ConnectionConfig.

const S3_DELETE_BATCH = 1000

export class S3ObjectStore {
  private readonly client: S3Client
  private readonly bucket: string
  private readonly deleteBatch: number

  constructor(
    private readonly provider: StorageProvider,
    config: S3ConnectionConfig,
  ) {
    this.client = new S3Client({
      ...(config.clientOptions ?? {}),
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      ...(config.forcePathStyle !== undefined ? { forcePathStyle: config.forcePathStyle } : {}),
      credentials: config.credentials,
    })
    this.bucket = config.bucket
    this.deleteBatch = Math.min(provider.maxDeleteBatch ?? S3_DELETE_BATCH, S3_DELETE_BATCH)
  }

  /** S3-standard "no such object" (plus provider extras). */
  isNotFound(error: unknown): boolean {
    const e = error as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } }
    return (
      e?.name === "NoSuchKey" ||
      e?.name === "NotFound" ||
      e?.Code === "NoSuchKey" ||
      e?.$metadata?.httpStatusCode === 404 ||
      this.provider.isNotFound?.(error) === true
    )
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: contentType }),
    )
  }

  /** null when the object does not exist. */
  async get(key: string): Promise<StoredObject | null> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
      if (!res.Body) return null
      return {
        bytes: await res.Body.transformToByteArray(),
        contentType: res.ContentType ?? "application/octet-stream",
      }
    } catch (error) {
      if (this.isNotFound(error)) return null
      throw error
    }
  }

  /** Chunked batch delete. Idempotent: missing keys are not an error. */
  async delete(keys: string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += this.deleteBatch) {
      const chunk = keys.slice(i, i + this.deleteBatch)
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
        }),
      )
    }
  }

  /** Reachability + credentials check (HeadBucket). */
  async check(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }))
  }
}

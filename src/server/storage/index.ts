import "server-only"

import { getActiveStorageProvider } from "@/server/storage/providers"
import { S3ObjectStore } from "@/server/storage/s3/client"
import {
  StorageNotConfiguredError,
  StorageObjectNotFoundError,
  type StoredObject,
} from "@/server/storage/types"

// Object storage — business API (docs/specs/s3-r2/01-architecture.md §4).
//
// Business code stores and reads objects by KEY through these functions
// only. It never imports the AWS SDK or reads a provider's env vars
// (lint-enforced). The active provider (STORAGE_PROVIDER, default
// Cloudflare R2) is resolved lazily on first use, so the app boots without
// storage configured.

export { StorageNotConfiguredError, StorageObjectNotFoundError }
export type { StoredObject }

let store: S3ObjectStore | null = null

function getStore(): S3ObjectStore {
  if (store) return store
  const provider = getActiveStorageProvider()
  const config = provider.resolveConfig(process.env)
  if ("missing" in config) throw new StorageNotConfiguredError(provider.key, config.missing)
  store = new S3ObjectStore(provider, config)
  return store
}

/** Store bytes under `key` (overwrites). */
export async function putObject(
  key: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<{ key: string; sizeBytes: number }> {
  await getStore().put(key, bytes, contentType)
  return { key, sizeBytes: bytes.byteLength }
}

/** Store UTF-8 text under `key` (overwrites). */
export async function putTextObject(
  key: string,
  text: string,
  contentType = "text/plain; charset=utf-8",
): Promise<{ key: string; sizeBytes: number }> {
  return putObject(key, new TextEncoder().encode(text), contentType)
}

/** The object, or null when the key does not exist. */
export async function getObject(key: string): Promise<StoredObject | null> {
  return getStore().get(key)
}

/** The object as UTF-8 text. Throws StorageObjectNotFoundError when missing. */
export async function getTextObject(key: string): Promise<string> {
  const obj = await getStore().get(key)
  if (!obj) throw new StorageObjectNotFoundError(key)
  return new TextDecoder("utf-8").decode(obj.bytes)
}

/**
 * Delete objects by key (chunked to the provider's batch limit). Idempotent:
 * missing keys are not an error. Returns the number of keys requested.
 */
export async function deleteObjects(keys: string[]): Promise<number> {
  const cleaned = keys.filter((k) => typeof k === "string" && k.length > 0)
  if (cleaned.length === 0) return 0
  await getStore().delete(cleaned)
  return cleaned.length
}

/** Which provider and bucket are in use — no secrets. */
export function storageInfo(): { provider: string; label: string; details: Record<string, string> } {
  const provider = getActiveStorageProvider()
  const config = provider.resolveConfig(process.env)
  return {
    provider: provider.key,
    label: provider.label,
    details: "missing" in config ? { missing: config.missing.join(", ") } : provider.describe(config),
  }
}

/** Reachability + credentials check. Never throws. */
export async function checkStorage(): Promise<{
  ok: boolean
  provider: string
  details: Record<string, string>
  error?: string
}> {
  const info = storageInfo()
  try {
    await getStore().check()
    return { ok: true, provider: info.provider, details: info.details }
  } catch (e) {
    return {
      ok: false,
      provider: info.provider,
      details: info.details,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

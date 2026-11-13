import "server-only"

import type { StorageProvider } from "@/server/storage/types"
import { cloudflareR2Provider } from "./cloudflare-r2"

// Storage provider registry (docs/specs/s3-r2/01-architecture.md §5).
// One active provider per deployment, chosen by env STORAGE_PROVIDER
// (default "cloudflare-r2"). Adding a provider = one file in this folder +
// one line below.
const PROVIDERS: Record<string, StorageProvider> = {
  [cloudflareR2Provider.key]: cloudflareR2Provider,
}

export const DEFAULT_STORAGE_PROVIDER = cloudflareR2Provider.key

export function getActiveStorageProvider(env: NodeJS.ProcessEnv = process.env): StorageProvider {
  const key = env.STORAGE_PROVIDER?.trim() || DEFAULT_STORAGE_PROVIDER
  const provider = PROVIDERS[key]
  if (!provider) {
    throw new Error(
      `Unknown STORAGE_PROVIDER "${key}". Known: ${Object.keys(PROVIDERS).join(", ")}`,
    )
  }
  return provider
}

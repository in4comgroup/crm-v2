import "server-only"

import type { CatalogSource } from "@/server/ai/types"
import { gatewayApiSource } from "./gateway-api"
import { modelsDevSource } from "./models-dev"

// Catalog source registry. ai_gateway.catalog_sources lists these keys.
const SOURCES: Record<string, CatalogSource> = {
  [gatewayApiSource.key]: gatewayApiSource,
  [modelsDevSource.key]: modelsDevSource,
}

export function getCatalogSource(key: string): CatalogSource {
  const source = SOURCES[key]
  if (!source) throw new Error(`Unknown AI catalog source: ${key}`)
  return source
}

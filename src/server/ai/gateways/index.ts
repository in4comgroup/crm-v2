import "server-only"

import type { AiGatewayAdapter } from "@/server/ai/types"
import { vercelAiGatewayAdapter } from "./vercel-ai-gateway"

// Adapter registry. ai_gateway.adapter names one of these keys.
// Adding a gateway type = one new folder here + one line below.
const ADAPTERS: Record<string, AiGatewayAdapter> = {
  [vercelAiGatewayAdapter.key]: vercelAiGatewayAdapter,
}

export function getGatewayAdapter(key: string): AiGatewayAdapter {
  const adapter = ADAPTERS[key]
  if (!adapter) throw new Error(`Unknown AI gateway adapter: ${key}`)
  return adapter
}

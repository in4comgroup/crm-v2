import "server-only"

import { getGatewayAdapter } from "@/server/ai/gateways"
import type { CatalogSource } from "@/server/ai/types"

// The gateway's own catalog endpoint, read through its adapter. Usually the
// authoritative source: it decides which models exist and their gateway price.
export const gatewayApiSource: CatalogSource = {
  key: "gateway-api",
  async listModels(gw) {
    const adapter = getGatewayAdapter(gw.adapter)
    if (!adapter.listCatalog) {
      throw new Error(`Adapter ${adapter.key} has no catalog endpoint`)
    }
    return adapter.listCatalog(gw)
  },
}

// Page context of the AI chat (docs/specs/ai-chat Q12, spec §10 step 2):
// the record the user is looking at, read from the page address the chat
// sends. Pure + client-safe. The route checks the record in the org
// (getRecord) before it reaches the prompt — an address is never trusted.

import type { RecordType } from "@/lib/chat/records"

export type PageRecordRef = { type: RecordType; id: string }

// Query parameter → record type, per page (the deep links of recordHref).
const QUERY_LINKS: { path: string; param: string; type: RecordType }[] = [
  { path: "/contacts", param: "openContact", type: "contact" },
  { path: "/deals", param: "openDeal", type: "deal" },
  { path: "/tasks", param: "openTask", type: "task" },
  { path: "/products", param: "openOrder", type: "order" },
  { path: "/dashboard", param: "topic", type: "topic" },
  { path: "/sources", param: "item", type: "source_item" },
]

const PATH_LINKS: { re: RegExp; type: RecordType }[] = [
  { re: /^\/clients\/([^/?#]+)\/?$/, type: "client" },
  { re: /^\/cards\/([^/?#]+)\/?$/, type: "card" },
]

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

/** `/clients/abc` → { client, abc }; `/deals?openDeal=x` → { deal, x }; else null. */
export function parsePageRecord(page: string | null | undefined): PageRecordRef | null {
  if (typeof page !== "string" || !page.startsWith("/") || page.length > 500) return null
  let url: URL
  try {
    url = new URL(page, "http://local")
  } catch {
    return null
  }
  const path = url.pathname.replace(/\/+$/, "") || "/"
  for (const l of PATH_LINKS) {
    const m = l.re.exec(path)
    if (m) {
      const id = decodeURIComponent(m[1])
      return ID_RE.test(id) ? { type: l.type, id } : null
    }
  }
  for (const l of QUERY_LINKS) {
    if (path !== l.path) continue
    const id = url.searchParams.get(l.param)
    if (id && ID_RE.test(id)) return { type: l.type, id }
  }
  return null
}

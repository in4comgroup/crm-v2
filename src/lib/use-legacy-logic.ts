"use client"

import { useEffect, useState } from "react"

// Old Custom-rule card generation and name-based deal discovery are switched
// off for orgs in topics mode `on` (spec topics/01 §9.1, §9.2, R7). The
// buttons that start them ask the server once per page load and hide
// themselves when `enabled` is false. Unknown (loading / error) = hidden for
// a moment, then shown when the server allows it — the server refuses the
// call anyway (409), so a stale button can never create old cards / deals.

export type LegacyLogicKind = "cards" | "deals"

const ENDPOINT: Record<LegacyLogicKind, string> = {
  cards: "/api/cards/generate?status=1",
  deals: "/api/deals/discover?status=1",
}

// Per page load cache: several buttons share one request.
const pending = new Map<LegacyLogicKind, Promise<boolean>>()

function fetchEnabled(kind: LegacyLogicKind): Promise<boolean> {
  let p = pending.get(kind)
  if (!p) {
    p = fetch(ENDPOINT[kind])
      .then((r) => (r.ok ? r.json() : { enabled: true }))
      .then((d: { enabled?: unknown }) => d.enabled !== false)
      // Network error: show the button; the server still guards the call.
      .catch(() => true)
    pending.set(kind, p)
    // Re-ask on the next mount after a minute (org switch, mode change).
    setTimeout(() => pending.delete(kind), 60_000)
  }
  return p
}

/** null while unknown, then true (old logic allowed) / false (topics `on`). */
export function useLegacyLogicEnabled(kind: LegacyLogicKind): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  useEffect(() => {
    let cancelled = false
    fetchEnabled(kind).then((v) => {
      if (!cancelled) setEnabled(v)
    })
    return () => {
      cancelled = true
    }
  }, [kind])
  return enabled
}
